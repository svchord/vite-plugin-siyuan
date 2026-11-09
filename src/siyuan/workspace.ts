/**
 * 工作区与安装目录解析：主题装到 `data/themes`，插件装到 `data/plugins`。
 *
 * 环境变量优先（SIYUAN_THEME_DIR / SIYUAN_PLUGIN_DIR）：CI 与自定义工作区
 * 要能绕过探测，否则一台机器上跑多工作区就没法脚本化。
 *
 * 端口确定后，安装目录的唯一正确答案是「这个内核正在服务的工作区」：装到
 * 别处、激活却发给这个内核，症状只会是「改动没生效」。因此先问
 * `/api/system/getWorkspaceInfo`；老版本内核没有该接口时，才退回工作区列表
 * （只认 `closed === false`）与 `workspace.json` 注册表。
 */
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { UserError } from '../support/errors.ts';
import { isRecord, isString } from '../support/guards.ts';
import { TIMING } from '../support/timing.ts';
import { callKernel, readWorkspacePaths } from './port.ts';
import type { Kind } from './kinds.ts';

/** 工作区来源：内核自报 / 内核报告为运行中 / 配置文件注册表。 */
export type WorkspaceSource = 'kernel-info' | 'kernel-open' | 'config';

/** 工作区探测结果；失败时带上候选路径，便于调用方拼可读错误。 */
export type WorkspaceProbe =
  | { ok: true; root: string; source: WorkspaceSource }
  | { ok: false; reason: 'none' | 'multiple-open' | 'multiple-registered'; paths: string[] };

/** 内核自报的工作区目录；接口不可用、字段缺失或为空时返回 null。 */
async function workspaceFromKernelInfo(port: number): Promise<string | null> {
  try {
    const response = await callKernel(port, '/api/system/getWorkspaceInfo', {}, TIMING.workspacesProbe);
    const data = response.data;
    if (!isRecord(data)) return null;
    const dir = data['workspaceDir'];
    if (!isString(dir)) return null;
    const trimmed = dir.trim();
    return trimmed ? trimmed : null;
  } catch {
    // 旧版本内核可能没有该接口：不是错误，继续走列表
    return null;
  }
}

/** 内核登记的工作区列表；`closed` 缺省用 null 表示旧版本没有该字段。 */
async function workspacesFromKernel(port: number): Promise<Array<{ path: string; closed: boolean | null }>> {
  try {
    const response = await callKernel(port, '/api/system/getWorkspaces', {}, TIMING.workspacesProbe);
    const data = response.data;
    if (!Array.isArray(data)) return [];
    const entries: Array<{ path: string; closed: boolean | null }> = [];
    for (const item of data) {
      if (!isRecord(item)) continue;
      const path = item['path'];
      if (!isString(path)) continue;
      const trimmed = path.trim();
      if (!trimmed) continue;
      const closed = item['closed'];
      entries.push({ path: trimmed, closed: typeof closed === 'boolean' ? closed : null });
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * 探测工作区根目录。
 *
 * 顺序：内核自报 → 内核列表里唯一 `closed === false` 的项 → `workspace.json`。
 *
 * `workspace.json` 会保留历史工作区（`removeWorkspaceDir` 才会删），所以「登记了
 * 多条」本身不是歧义：先问内核就足够。只有拿不到内核信息、且注册表里也不止一条时，
 * 才需要用户显式指定安装目录。
 */
export async function probeWorkspace(port: number | null): Promise<WorkspaceProbe> {
  if (port !== null) {
    const info = await workspaceFromKernelInfo(port);
    if (info) return { ok: true, root: info, source: 'kernel-info' };

    const entries = await workspacesFromKernel(port);
    const open = entries.filter((entry) => entry.closed === false);
    if (open.length === 1) {
      const only = open[0];
      if (only) return { ok: true, root: only.path, source: 'kernel-open' };
    }
    if (open.length > 1) {
      return { ok: false, reason: 'multiple-open', paths: open.map((entry) => entry.path) };
    }
  }

  const paths = readWorkspacePaths();
  if (paths.length === 1) {
    const only = paths[0];
    if (only) return { ok: true, root: only, source: 'config' };
  }
  if (paths.length > 1) return { ok: false, reason: 'multiple-registered', paths };
  return { ok: false, reason: 'none', paths: [] };
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

  const probe = await probeWorkspace(port);
  if (!probe.ok) {
    const list = probe.paths.map((path) => `  - ${path}`).join('\n');
    if (probe.reason === 'multiple-open') {
      throw new UserError(
        `找到多个正在运行的思源工作区：\n${list}\n` +
          `  无法判断该装到哪一个（当前类型：${kind}）。请设置 ${dirEnv} 指向 <workspace>/data/${subdir}。`
      );
    }
    if (probe.reason === 'multiple-registered') {
      throw new UserError(
        `找到多个已登记的思源工作区，且无法确认当前运行的是哪一个：\n${list}\n` +
          `  请设置 ${dirEnv} 指向 <workspace>/data/${subdir}（当前类型：${kind}）。`
      );
    }
    throw new UserError(
      `找不到思源工作区：确认思源已启动，或设置 ${dirEnv} 为 <workspace>/data/${subdir}（当前类型：${kind}）`
    );
  }

  const root = probe.root;
  const dataDir = join(root, 'data');
  if (!existsSync(dataDir)) {
    throw new UserError(
      `工作区路径下没有 data 目录：${root}。workspace.json 可能残留了旧路径；请确认当前打开的工作区，或设置 ${dirEnv} 指向正确的 <workspace>/data/${subdir}。`
    );
  }
  return resolve(join(dataDir, subdir, name));
}
