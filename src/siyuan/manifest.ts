/**
 * 清单文件的读取。
 *
 * 清单可能出现在三处：`public/`（源码）、`dist/`（构建产物）、项目根
 * （解包后的 `package.zip` 就是这种布局）。
 */
import { join } from 'node:path';
import { readJsonFile } from '../support/fs.ts';
import { isRecord } from '../support/guards.ts';

/** 一份读到的清单。 */
export interface ManifestFile {
  path: string;
  data: Record<string, unknown>;
}

/** 清单候选路径，按优先级排列。 */
export function manifestCandidates(root: string, manifest: string, extraDirs: readonly string[] = []): string[] {
  const dirs = [join(root, 'public'), join(root, 'dist'), root, ...extraDirs];
  return dirs.map((dir) => join(dir, manifest));
}

/** 读一份清单与其路径；都读不到返回 null。 */
export function readManifest(root: string, manifest: string, extraDirs: readonly string[] = []): ManifestFile | null {
  for (const path of manifestCandidates(root, manifest, extraDirs)) {
    const data = readJsonFile(path);
    if (isRecord(data)) return { path, data };
  }
  return null;
}
