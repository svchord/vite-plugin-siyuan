/**
 * 清单文件的读取。
 *
 * 清单**只从 `public/` 读**：它是思源要求的产物根文件，而 `public/` 是 Vite
 * 唯一「原样复制到产物根」的机制。项目根那份官方 sample 布局不做支持——
 * 探测到它却复制不进 `dist/`，只会得到「产物缺少 theme.json」这种半截行为。
 *
 * 构建产物里的清单由调用方通过 `extraDirs` 显式传入（校验解包后的包时用），
 * 不作为默认候选——否则上一次构建留下的 `dist/theme.json` 会盖住源码里的新清单。
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
  const dirs = [join(root, 'public'), ...extraDirs];
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
