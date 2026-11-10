/**
 * 文件系统工具：目录遍历与文件读取。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

/** 递归列出的一个文件。 */
export interface WalkedFile {
  /** 相对起始目录的路径，统一 `/` 分隔（也用作 zip 条目名）。 */
  name: string;
  /** 磁盘上的绝对路径。 */
  path: string;
}

/**
 * 递归列出目录下所有文件；目录不存在时返回空数组。
 *
 * 顺序由本函数的显式 sort 保证（`readdirSync` 不保证返回顺序），
 * 这样 zip 条目顺序才稳定、可复现。
 */
export function walkFiles(dir: string): WalkedFile[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const name = relative(dir, join(entry.parentPath, entry.name)).replaceAll('\\', '/');
      return { name, path: join(entry.parentPath, entry.name) };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 读一个 JSON 文件；不存在、坏 JSON 都返回 null。 */
export function readJsonFile(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

/** 读文本文件；不存在返回 null。 */
export function readTextFile(path: string): string | null {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
}

/** 比较两个路径是否指向同一处（忽略末尾斜杠与大小写）。 */
export function samePath(left: string, right: string): boolean {
  if (!left.trim() || !right.trim()) return false;
  const normalize = (value: string): string => {
    const normalized = resolve(value).replace(/[\\/]+$/, '');
    return process.platform === 'linux' ? normalized : normalized.toLowerCase();
  };
  return normalize(left) === normalize(right);
}
