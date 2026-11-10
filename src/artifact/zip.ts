/**
 * 打包：把一个目录写成 `package.zip`。
 *
 * `package.zip` 必须能被标准 zip 工具解开；写盘必须同步完成，
 * 构建结束时就要拿到最终文件。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { zipSync } from 'fflate';
import { walkFiles } from '../support/fs.ts';

/** 思源集市的发布产物名。 */
export const PACKAGE_NAME = 'package.zip';

/** 经典 zip 的条目数上限（16 位字段）。 */
const ZIP_MAX_ENTRIES = 0xffff;

export function writeZip(dir: string, outFile: string): { files: number; bytes: number } {
  const files = walkFiles(dir);
  if (files.length > ZIP_MAX_ENTRIES) throw new Error(`文件数 ${files.length} 超过 zip 格式上限 ${ZIP_MAX_ENTRIES}`);
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = new Uint8Array(readFileSync(file.path));
  const archive = zipSync(entries, { level: 6 });
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, archive);
  return { files: files.length, bytes: archive.length };
}
