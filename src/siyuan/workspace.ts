/**
 * 工作区与安装目录解析：主题装到 `data/themes`，插件装到 `data/plugins`。
 *
 * 环境变量优先（SIYUAN_THEME_DIR / SIYUAN_PLUGIN_DIR）：CI 与自定义工作区
 * 要能绕过探测，否则一台机器上跑多工作区就没法脚本化。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UserError } from '../support/errors.ts';
import { isRecord, isString } from '../support/guards.ts';
import { TIMING } from '../support/timing.ts';
import { callKernel, readWorkspacePaths } from './port.ts';
import type { Kind } from './kinds.ts';

/** 列工作区：先问内核，问不到再读文件；内核不可用不是错误。 */
async function listWorkspaces(port: number | null): Promise<string[]> {
  if (port !== null) {
    try {
      const response = await callKernel(port, '/api/system/getWorkspaces', {}, TIMING.workspacesProbe);
      const data: unknown = response.data;
      if (Array.isArray(data)) {
        const paths = data
          .map((item) => (isRecord(item) ? item['path'] : undefined))
          .filter((value): value is string => isString(value));
        if (paths.length) return paths;
      }
    } catch {
      // 内核不可用，回退到桌面端记录
    }
  }
  return readWorkspacePaths();
}

/** 解析 `<workspace>/data/<subdir>/<name>`。 */
export async function resolveInstallDir({
  kind,
  subdir,
  dirEnv,
  name,
  port,
}: {
  kind: Kind;
  subdir: string;
  dirEnv: string;
  name: string;
  port: number | null;
}): Promise<string> {
  const explicitDir = process.env[dirEnv]?.trim();
  if (explicitDir) {
    const dir = resolve(explicitDir);
    if (!existsSync(dir)) {
      throw new UserError(
        `${dirEnv} 指向的目录不存在：${dir}。请指向思源工作区的 <workspace>/data/${subdir}（当前类型：${kind}），或去掉该环境变量让工具自动探测。`
      );
    }
    return join(dir, name);
  }

  const workspaces = await listWorkspaces(port);
  const [first] = workspaces;
  if (workspaces.length > 1) {
    throw new UserError(
      `找到多个思源工作区：\n${workspaces.map((path) => `  - ${path}`).join('\n')}\n` +
        `  无法判断该装到哪一个（当前类型：${kind}）。请设置 ${dirEnv} 指向 <workspace>/data/${subdir}。`
    );
  }
  const root = first ?? null;
  if (!root) {
    throw new UserError(
      `找不到思源工作区：确认思源已启动，或设置 ${dirEnv} 为 <workspace>/data/${subdir}（当前类型：${kind}）`
    );
  }
  const dataDir = join(root, 'data');
  if (!existsSync(dataDir)) {
    throw new UserError(
      `工作区路径下没有 data 目录：${root}。workspace.json 可能残留了旧路径；请确认当前打开的工作区，或设置 ${dirEnv} 指向正确的 <workspace>/data/${subdir}。`
    );
  }
  return resolve(join(dataDir, subdir, name));
}
