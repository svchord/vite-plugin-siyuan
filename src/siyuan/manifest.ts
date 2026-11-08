/**
 * 清单文件的读取与 publicDir 解析。
 *
 * 清单**只从 publicDir 读**：它是思源要求的产物根文件，而 `publicDir` 是 Vite
 * 唯一「原样复制到产物根」的机制。项目根那份官方 sample 布局不做支持——
 * 探测到它却复制不进产物，只会得到「产物缺少 theme.json」这种半截行为。
 *
 * 构建产物里的清单由调用方通过 `extraDirs` 显式传入（校验时用），
 * 不作为默认候选——否则上一次构建留下的旧清单会盖住源码里的新清单。
 */
import { join, resolve } from 'node:path';
import { readJsonFile } from '../support/fs.ts';
import { isRecord } from '../support/guards.ts';

/** 一份读到的清单。 */
export interface ManifestFile {
  path: string;
  data: Record<string, unknown>;
}

/**
 * 解析实际生效的 publicDir 绝对路径；`publicDir: false` 时返回空串。
 *
 * Vite 的 `publicDir` 可以指向任意目录（默认 `public`），也可以关掉。
 * 所有找清单/资源的地方都必须走这里，不能拼死 `'public'`。
 */
export function resolvePublicDir(root: string, configured: string | false | undefined): string {
  if (configured === false) return '';
  if (typeof configured === 'string' && configured) return resolve(root, configured);
  return join(root, 'public');
}

/** 清单候选路径，按优先级排列。publicDir 关闭时只剩显式传入的目录。 */
export function manifestCandidates(
  publicDir: string,
  manifest: string,
  extraDirs: readonly string[] = []
): string[] {
  const dirs = [...(publicDir ? [publicDir] : []), ...extraDirs];
  return dirs.map((dir) => join(dir, manifest));
}

/** 读一份清单与其路径；都读不到返回 null。 */
export function readManifest(
  publicDir: string,
  manifest: string,
  extraDirs: readonly string[] = []
): ManifestFile | null {
  for (const path of manifestCandidates(publicDir, manifest, extraDirs)) {
    const data = readJsonFile(path);
    if (isRecord(data)) return { path, data };
  }
  return null;
}

/** 清单里引用外部文件名的字段名。 */
const ASSET_KEYS = ['readme', 'icon', 'preview'] as const;

/**
 * 从清单里收集引用到的文件名。
 *
 * `readme` 可能是字符串，也可能是 `{ default, zh_CN, ... }` 的 i18n 对象；
 * `icon` / `preview` 只能是字符串。`keys` 用于只取其中一部分（比如只搬 README）。
 */
export function declaredAssets(
  manifest: Record<string, unknown>,
  keys: readonly string[] = ASSET_KEYS
): string[] {
  const names = new Set<string>();
  if (keys.includes('readme')) {
    const readme: unknown = manifest['readme'];
    if (typeof readme === 'string') names.add(readme);
    else if (isRecord(readme)) {
      for (const value of Object.values(readme)) if (typeof value === 'string') names.add(value);
    }
  }
  for (const key of keys) {
    if (key === 'readme') continue;
    const value: unknown = manifest[key];
    if (typeof value === 'string') names.add(value);
  }
  return [...names];
}
