/**
 * 把构建产物目录链接到思源的安装目录，让思源直接读 `dev/`。
 *
 * Windows 上建目录链接有两种方式，差别是真实的：
 *   symlink   真正的符号链接，需要开发者模式或管理员权限；思源（Go）按
 *             ModeSymlink 识别它。
 *   junction  目录联接，普通用户就能建；但 Go 的 Lstat 报 ModeDir|ModeIrregular，
 *             **不认作符号链接**。
 * 实测主题用 junction 能正常加载，所以主题允许 junction 兜底；插件目录必须是
 * 真 symlink。这条不变式对「新建」和「已存在的链接」同样成立。
 */
import { existsSync, lstatSync, readlinkSync, symlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { envFlag } from '../support/env.ts';
import { errorCode } from '../support/errors.ts';
import { samePath } from '../support/fs.ts';
import { TIMING } from '../support/timing.ts';

type LinkType = 'symlink' | 'junction';

export interface LinkResult {
  ok: boolean;
  changed: boolean;
  linkType: LinkType | null;
  reason: string | null;
}

/** 检查链接现状，不修改任何东西。 */
function inspectLink(
  srcPath: string,
  targetPath: string
): { status: 'absent' | 'linked' | 'conflict'; reason: string | null } {
  let stat;
  try {
    stat = lstatSync(targetPath);
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return { status: 'absent', reason: null };
    throw cause;
  }
  if (!stat.isSymbolicLink()) {
    return { status: 'conflict', reason: `${targetPath} 已存在且不是链接（是个普通目录/文件）` };
  }
  const existing = resolve(dirname(targetPath), readlinkSync(targetPath));
  if (samePath(existing, srcPath)) return { status: 'linked', reason: null };
  return { status: 'conflict', reason: `${targetPath} 已链接到别处：${existing}` };
}

/**
 * 读已存在链接的类型。
 *
 * Windows 上唯一的可靠判据是**重解析点 tag**，不能用 readlink 的形态：
 *   junction  tag = 0xa0000003（IO_REPARSE_TAG_MOUNT_POINT）
 *   symlink   tag = 0xa000000c（IO_REPARSE_TAG_SYMLINK）
 * junction 的 readlink 也会被 Node 规范成绝对路径，与用绝对 target 创建的
 * symlink 完全同形——按形态判会把老链接一律误判成 junction 并拒绝启动。
 */
function detectLinkType(targetPath: string): LinkType | null {
  try {
    if (!lstatSync(targetPath).isSymbolicLink()) return null;
    if (process.platform !== 'win32') return 'symlink';
    const result = spawnSync('fsutil', ['reparsepoint', 'query', targetPath], { encoding: 'utf8' });
    if (result.status !== 0 || !result.stdout) return null;
    const match = /0x([0-9a-fA-F]{8})/.exec(result.stdout);
    if (!match?.[1]) return null;
    const tag = match[1].toLowerCase();
    if (tag === 'a0000003') return 'junction';
    if (tag === 'a000000c') return 'symlink';
    return null;
  } catch (cause) {
    if (errorCode(cause) === 'ENOENT') return null;
    throw cause;
  }
}

/** 无人值守时不弹 UAC：弹窗没人点会阻塞 120s，比退化成 junction 更糟。 */
function canPromptElevation(): boolean {
  if (process.platform !== 'win32') return false;
  if (envFlag('SIYUAN_NO_ELEVATION', 'SYD_NO_ELEVATION')) return false;
  if (process.env.CI) return false;
  return Boolean(process.stdout.isTTY);
}

/** 权限不足时，只提权这一条 `New-Item -ItemType SymbolicLink` 命令。 */
function elevateSymlink(srcPath: string, targetPath: string): boolean {
  if (process.platform !== 'win32') return false;
  const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `New-Item -ItemType SymbolicLink -Path ${quote(targetPath)} -Target ${quote(srcPath)} | Out-Null`,
  ].join('; ');
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const command = [
    "$p = Start-Process -FilePath 'powershell.exe'",
    `-ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encoded}')`,
    '-Verb RunAs -Wait -PassThru',
    '; exit $p.ExitCode',
  ].join(' ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: 'inherit',
    windowsHide: false,
    timeout: TIMING.uacPromptTimeout,
  });
  if (result.status !== 0) return false;
  try {
    return lstatSync(targetPath).isSymbolicLink();
  } catch {
    return false;
  }
}

function describeFailure(cause: unknown, requireSymlink: boolean, elevationFailed: boolean): string {
  const lines = [`无法建立目录链接：${cause instanceof Error ? cause.message : String(cause)}`];
  if (elevationFailed) {
    lines.push('  UAC 提权被拒绝或超时：请重新运行并在弹窗点「是」，或预先开启 Windows 开发者模式。');
    lines.push('  插件目录必须是真 symlink，不能用 junction 兜底。');
    return lines.join('\n');
  }
  if (process.platform === 'win32') {
    lines.push('  解决办法（任选其一）：');
    lines.push('    1. 开启 Windows 开发者模式：设置 → 系统 → 开发者选项');
    lines.push('    2. 用管理员身份运行终端后重试');
    if (requireSymlink) lines.push('  注意：该目录不能用 junction 兜底——思源的 Go 运行时按符号链接判定。');
  } else {
    lines.push('  解决办法：修正安装目录的写权限后重试');
  }
  return lines.join('\n');
}

/**
 * 建链接（已存在且指向同一处时幂等）。
 *
 * 源目录与安装父目录都必须已存在：造一个空目录再链过去会让思源静默加载不到，
 * 而工具还报「已链接」。
 */
export function ensureLink(
  srcPath: string,
  targetPath: string,
  { requireSymlink = false }: { requireSymlink?: boolean } = {}
): LinkResult {
  if (!existsSync(srcPath)) {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason: `产物目录不存在：${srcPath}。构建产物还没落盘，或 build.outDir 指错了；请先跑一次构建。`,
    };
  }

  const current = inspectLink(srcPath, targetPath);
  if (current.status === 'linked') {
    const existingType = detectLinkType(targetPath);
    if (requireSymlink && existingType === 'junction') {
      return {
        ok: false,
        changed: false,
        linkType: 'junction',
        reason:
          `${targetPath} 是 junction，插件目录必须是真正的符号链接（思源 Go 运行时按 ModeSymlink 判定）。\n` +
          '  请在思源中卸载/停用该插件，或手动移除这个 junction 后重试；工具不会覆盖已有目录。',
      };
    }
    return { ok: true, changed: false, linkType: existingType, reason: null };
  }
  if (current.status === 'conflict') {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason: `${current.reason}。请在思源中卸载/停用同名主题（插件），或手动移除/改名该目录后重试；工具不会覆盖已有目录。`,
    };
  }

  const parent = dirname(targetPath);
  if (!existsSync(parent)) {
    return {
      ok: false,
      changed: false,
      linkType: null,
      reason: `安装父目录不存在：${parent}。思源工作区路径可能不对，或该工作区还没初始化；也可设置 SIYUAN_THEME_DIR / SIYUAN_PLUGIN_DIR 指向正确的 <workspace>/data/<subdir>。`,
    };
  }

  const attempts: LinkType[] = requireSymlink ? ['symlink'] : ['symlink', 'junction'];
  const elevationAllowed = canPromptElevation();
  let elevationFailed = false;

  for (const linkType of attempts) {
    try {
      symlinkSync(srcPath, targetPath, linkType === 'junction' ? 'junction' : 'dir');
      return { ok: true, changed: true, linkType, reason: null };
    } catch (cause) {
      const code = errorCode(cause);
      if ((code === 'EPERM' || code === 'EACCES') && linkType === 'symlink') {
        if (elevationAllowed) {
          elevationFailed = !elevateSymlink(srcPath, targetPath);
          if (!elevationFailed) return { ok: true, changed: true, linkType: 'symlink', reason: null };
        }
        continue;
      }
      return { ok: false, changed: false, linkType: null, reason: describeFailure(cause, requireSymlink, elevationFailed) };
    }
  }

  return { ok: false, changed: false, linkType: null, reason: describeFailure(null, requireSymlink, elevationFailed) };
}

/** 链接建好后，确认思源该读的文件真的在（防止链到空目录还以为成功）。 */
export function checkLinkedFiles(targetPath: string, expectedFiles: string[]): string[] {
  return expectedFiles.filter((file) => !existsSync(resolve(targetPath, file)));
}
