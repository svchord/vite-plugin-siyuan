/**
 * 项目根的镜像链接：让开发者/IDE 在项目里看到思源安装目录的实时产物。
 *
 * 思源读的是真实安装目录，项目根的 junction 只用于查看，因此不需要管理员权限。
 */
import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { errorCode, UserError } from '../support/errors.ts';
import { samePath } from '../support/fs.ts';

/** 判断 child 是否在 parent 内部（含相等由调用方另行判断）。 */
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * 校验并解析 devDir。
 *
 * 必须位于项目根内、不能与 outDir 重叠：项目本身住在安装目录里时（官方
 * plugin-sample 推荐布局），`<root>/dev` 会成为 outDir 的子目录，junction
 * 指回父目录会形成自引用环，walkFiles / zip 都会把同一份产物展开几十层。
 */
export function resolveDevMirrorPath(root: string, devDir: string, outDir: string): string {
  const trimmed = devDir.trim();
  if (!trimmed) throw new UserError('devDir 不能为空字符串：它决定项目根下镜像链接的名字。');
  if (isAbsolute(trimmed)) {
    throw new UserError(`devDir 必须是相对项目根的路径，不能是绝对路径：${devDir}`);
  }
  const devPath = resolve(root, trimmed);
  if (devPath === resolve(root)) {
    throw new UserError('devDir 不能指向项目根本身。');
  }
  if (!isInside(devPath, resolve(root))) {
    throw new UserError(`devDir 不能逃出项目根：${devPath}`);
  }
  if (samePath(devPath, outDir) || isInside(devPath, outDir) || isInside(outDir, devPath)) {
    throw new UserError(
      `devDir 与产物目录重叠：devDir=${devPath}，outDir=${outDir}。\n` +
        '  junction 会形成自引用环（构建产物被展开成几十层），请换一个名字。'
    );
  }
  return devPath;
}

export interface MirrorResult {
  ok: boolean;
  changed: boolean;
  reason: string | null;
}

/**
 * 建立/校验项目根到安装目录的 junction。
 *
 * 已存在同名真实目录时**绝不覆盖**（可能是用户自己的文件夹），直接报可读错误。
 */
export function ensureDevMirror(linkPath: string, targetPath: string): MirrorResult {
  let stat;
  try {
    stat = lstatSync(linkPath);
  } catch (cause) {
    if (errorCode(cause) !== 'ENOENT') throw cause;
    stat = null;
  }

  if (stat) {
    if (!stat.isSymbolicLink()) {
      return {
        ok: false,
        changed: false,
        reason: `${linkPath} 已存在且不是链接（是个普通目录/文件）。请改名 devDir，或手动移除后重试；工具不会覆盖已有目录。`,
      };
    }
    const existing = resolve(dirname(linkPath), readlinkSync(linkPath));
    if (samePath(existing, targetPath)) return { ok: true, changed: false, reason: null };
    return {
      ok: false,
      changed: false,
      reason: `${linkPath} 已链接到别处：${existing}。请移除或改名后重试。`,
    };
  }

  mkdirSync(targetPath, { recursive: true });
  mkdirSync(dirname(linkPath), { recursive: true });
  // Windows 上 junction 不需要管理员权限；POSIX 上 type 参数被忽略，等同普通符号链接。
  symlinkSync(targetPath, linkPath, 'junction');
  return { ok: true, changed: true, reason: null };
}
