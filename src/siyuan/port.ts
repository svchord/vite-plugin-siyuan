/**
 * kernel API 调用与端口发现。
 *
 * 只放与被测类型无关的原语：调 API、探端口、拼前端 URL。
 *
 * ## 为什么需要 PID
 *
 * `port.json` 是 `{ "PID": "端口" }` 的映射表，本机常有十几条历史遗留的死记录。
 * 只靠逐个探测会把多个仍存活的实例都算进来，分不清「哪个是我的」；猜错工作区的
 * 唯一症状是「改动没生效」，排查成本极高。用进程名拿到自己的 PID，再查表拿端口，
 * 是唯一能精确命中的线索。
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import psList from 'ps-list';
import { UserError } from '../support/errors.ts';
import { readJsonFile } from '../support/fs.ts';
import { isRecord, isString } from '../support/guards.ts';
import { TIMING } from '../support/timing.ts';

/** kernel API 的统一响应形状。 */
export interface KernelResponse<T = unknown> {
  code: number;
  msg?: string | undefined;
  data: T | null;
}

/** 调 kernel API。开了 API token 时从 SIYUAN_TOKEN 读。 */
export async function callKernel<T = unknown>(
  port: number,
  path: string,
  body: unknown = {},
  timeoutMs: number | null = null
): Promise<KernelResponse<T>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.SIYUAN_TOKEN) headers.Authorization = `Token ${process.env.SIYUAN_TOKEN}`;
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(timeoutMs !== null ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
  });
  const text = await response.text();
  if (!text) return { code: 0, data: null };
  const parsed: unknown = JSON.parse(text);
  if (!isRecord(parsed)) return { code: -1, data: null, msg: text.slice(0, 200) };
  const msg: unknown = parsed['msg'];
  return {
    code: typeof parsed['code'] === 'number' ? parsed['code'] : -1,
    ...(typeof msg === 'string' ? { msg } : {}),
    data: ('data' in parsed ? parsed['data'] : null) as T | null,
  };
}

/**
 * 思源配置目录候选路径。
 *
 * 常见位置按平台不同，但 `~/.config/siyuan` **不是 Linux 专有**：本机（Windows）
 * 的 port.json / workspace.json 就在这里。所以它作为兜底对所有平台都加。
 */
function siyuanConfigDirs(): string[] {
  const dirs: string[] = [];
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA;
    if (appData) dirs.push(join(appData, 'SiYuan'), join(appData, 'SiYuan-Electron'));
  } else if (process.platform === 'darwin') {
    dirs.push(join(homedir(), 'Library', 'Application Support', 'SiYuan'));
  }
  dirs.push(join(homedir(), '.config', 'siyuan'));
  return dirs;
}

/** kernel 的 PID→端口映射文件候选路径。导出仅为可测性。 */
export function portMapCandidates(): string[] {
  return siyuanConfigDirs().map((dir) => join(dir, 'port.json'));
}

/** 读 workspace.json：内容是工作区绝对路径的字符串数组。 */
export function readWorkspacePaths(): string[] {
  for (const dir of siyuanConfigDirs()) {
    const file = join(dir, 'workspace.json');
    if (!existsSync(file)) continue;
    const data = readJsonFile(file);
    if (Array.isArray(data)) return data.filter(isString);
  }
  return [];
}

const DEFAULT_KERNEL_PORTS = [6806, 6807, 6808, 6809] as const;

/** 思源内核进程名（Windows 是 `SiYuan-Kernel.exe`，POSIX 上进程名不带后缀）。 */
const KERNEL_PROCESS_PATTERN = /SiYuan-Kernel/i;

/** 从进程列表里挑出 kernel 的 PID；找不到返回 null。导出仅为可测性。 */
export function pickKernelPid(processes: ReadonlyArray<{ pid: number; name: string }>): number | null {
  const kernel = processes.find((entry) => KERNEL_PROCESS_PATTERN.test(entry.name));
  return kernel ? kernel.pid : null;
}

async function findKernelPid(): Promise<number | null> {
  return pickKernelPid(await psList());
}

async function probeKernelPort(port: number): Promise<boolean> {
  if (!Number.isFinite(port)) return false;
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/system/status`, {
      signal: AbortSignal.timeout(TIMING.kernelProbe),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * 从 port.json 的一段记录里挑出所有可用的 kernel 端口。
 *
 * PID 命中优先，但**只在它真的应答时**才算数；否则探测全部记录。返回多个说明
 * 本机同时跑着多套 kernel（多工作区/多实例），调用方必须报错让人指定而不是猜一个：
 * 猜错就会量错工作区，且症状只是「改动没生效」。
 */
async function aliveRecordedPorts(data: Record<string, unknown>, pid: number | null): Promise<number[]> {
  const recorded = Object.values(data)
    .filter(isString)
    .map(Number)
    .filter((port) => Number.isInteger(port) && port > 0);

  if (pid !== null) {
    const own = Number(data[String(pid)]);
    if (Number.isInteger(own) && own > 0 && (await probeKernelPort(own))) return [own];
  }

  const alive: number[] = [];
  // 并行探测：端口多时串行等 kernelProbe 会累积成十几秒。
  await Promise.all(
    [...new Set(recorded)].map(async (port) => {
      if (await probeKernelPort(port)) alive.push(port);
    })
  );
  return alive.sort((a, b) => a - b);
}

/**
 * 找运行中的 kernel 端口：SIYUAN_PORT → PID 查 port.json → 兜底端口。
 *
 * 显式端口也必须探测：否则思源没起时会返回一个死端口，工具会一路走到
 * 「会话就绪」并打印必然 404 的预览链接，看着活着其实全废。
 */
export async function findKernelPort(): Promise<number> {
  const explicit = process.env.SIYUAN_PORT?.trim();
  if (explicit) {
    const port = Number(explicit);
    if (!Number.isFinite(port) || port <= 0) throw new UserError(`SIYUAN_PORT 不是有效端口：${explicit}（应为正整数）`);
    if (await probeKernelPort(port)) return port;
    throw new UserError(
      `SIYUAN_PORT=${port} 上的思源内核没有响应：确认思源已启动、端口正确，或去掉该环境变量让工具自动探测。`
    );
  }

  // ps-list 失败不影响主流程：退回「探测全部记录」这条路。
  const pid = await findKernelPid().catch(() => null);

  for (const file of portMapCandidates()) {
    if (!existsSync(file)) continue;
    const data = readJsonFile(file);
    if (!isRecord(data)) continue;
    const alive = await aliveRecordedPorts(data, pid);
    const [only] = alive;
    if (alive.length === 1 && only !== undefined) return only;
    if (alive.length > 1) {
      throw new UserError(
        `找到多个思源内核在响应：${alive.join('、')}（来自 ${file}）。\n` +
          '  无法判断该装到哪一个；请关掉多余实例，或设置 SIYUAN_PORT 指定端口。'
      );
    }
  }

  for (const port of DEFAULT_KERNEL_PORTS) {
    if (await probeKernelPort(port)) return port;
  }
  throw new UserError(
    `无法定位 SiYuan kernel 端口：确认思源已启动，或设置 SIYUAN_PORT。\n  查找过：${portMapCandidates().join('、')}`
  );
}

/** 前端入口。桌面与移动是两个独立构建，路径不同。 */
export type Frontend = 'desktop' | 'mobile';

/** 稳定预览地址（不带随机参数，给人复制用）。 */
export function frontendUrl(port: number, frontend: Frontend): string {
  return `http://127.0.0.1:${port}/stage/build/${frontend}/`;
}
