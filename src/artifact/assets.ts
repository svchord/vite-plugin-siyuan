/**
 * 思源产物契约：让 `public/` 的改动也触发重建，并搬运唯一必须放项目根的文件。
 *
 * ## 文件放哪
 *
 * **只有 README 必须放项目根**：GitHub 只展示仓库根的 README，而思源集市要求
 * 它出现在产物根。这一份由本模块搬进产物。
 *
 * 其他一切（`theme.json` / `plugin.json` / `icon` / `preview` / `i18n/` / 图片字体
 * 等静态资源）都放 `public/`，由 Vite 的 `publicDir` 原样复制到产物根，本模块不介入。
 *
 * ## 为什么要监听 public/
 *
 * `public/` 不在模块图里，改它不会触发重建，于是改了 `theme.json` 的 modes 或
 * 版本号，不重启就永远不生效。所以要把 `public/**` 显式加进监听集合。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, rmdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonFile, walkFiles } from '../support/fs.ts';
import { describeError } from '../support/errors.ts';
import { isRecord } from '../support/guards.ts';
import type { Logger } from '../support/log.ts';
import { declaredAssets } from '../siyuan/manifest.ts';

const README_PATTERN = /^README.*\.md$/;

/** 修剪时始终保留的目录：版本库与 Vite 自己的元数据。 */
const PROTECTED_PREFIXES = ['.git/', '.vite/'];

/** 把 publicDir 下的文件逐个交给构建器登记监听。 */
export function watchPublicFiles(publicDir: string, registerWatchFile: (file: string) => void, log: Logger): void {
  if (!publicDir || !existsSync(publicDir)) {
    // 清单缺失会在校验阶段报错；这里只是内部流程信息，不该默认打扰用户。
    log(`publicDir 不存在，跳过监听：${publicDir}`, 'debug');
    return;
  }
  for (const file of walkFiles(publicDir)) registerWatchFile(file.path);
}

/**
 * 把 README 从项目根搬进产物目录（GitHub 只认根目录，思源要求产物根）。
 *
 * 清单声明的 README 优先；没声明时按 `README*.md` 兜底。
 *
 * **publicDir 优先**：若同名文件已经在 publicDir 下，Vite 已经把它复制进产物，
 * 这里直接跳过——否则项目根那份会静默覆盖用户放在 publicDir 的版本。
 *
 * watch 下复制失败只报错继续（一次文件锁不该停掉开发服务器）；
 * 生产构建必须失败——否则 package.zip 会缺 README。
 *
 * 返回本次搬进产物的 README 文件名，供修剪时作为保留集合。
 */
export function copyReadmes({
  root,
  publicDir,
  outDir,
  manifestName,
  watch,
  log,
}: {
  root: string;
  publicDir: string;
  outDir: string;
  manifestName: string;
  watch: boolean;
  log: Logger;
}): string[] {
  const absoluteOutDir = resolve(root, outDir);
  mkdirSync(absoluteOutDir, { recursive: true });

  const manifestPath = publicDir ? join(publicDir, manifestName) : join(root, 'public', manifestName);
  const parsed = readJsonFile(manifestPath);
  const declared = isRecord(parsed) ? declaredAssets(parsed, ['readme']) : null;
  // 清单问题由构建收尾的校验统一报；这里只是 README 搬运的内部兜底过程。
  if (!isRecord(parsed)) log(`读不到或无法解析清单 ${manifestPath}；README 按 README*.md 兜底`, 'debug');

  const names: string[] = [];
  if (declared?.length) {
    names.push(...declared);
  } else {
    log(`清单 ${manifestPath} 没声明 readme，按 README*.md 兜底搬运`, 'debug');
    names.push(
      ...readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && README_PATTERN.test(entry.name))
        .map((entry) => entry.name)
    );
  }

  const failures: string[] = [];
  const copied: string[] = [];
  for (const name of names) {
    // publicDir 优先：Vite 已复制过，不再覆盖。
    if (publicDir && existsSync(join(publicDir, name))) {
      copied.push(name);
      continue;
    }
    const source = resolve(root, name);
    if (!existsSync(source)) {
      failures.push(`${name}：项目根与 public 目录下都不存在`);
      continue;
    }
    try {
      const destination = join(absoluteOutDir, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
      copied.push(name);
    } catch (cause) {
      failures.push(`${name}：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (failures.length) {
    const detail = failures.join('；');
    if (watch) log(`README 复制失败 ${detail}`, 'error');
    else throw new Error(`README 复制失败：${detail}`);
  }
  return copied;
}

/**
 * 删除产物目录里不属于本次构建的文件。
 *
 * watch 下 `emptyOutDir` 必须是 false（目录就是思源安装目录，清空会让宿主短暂读到
 * 空目录），于是改名/删除源文件后旧产物会一直留着。这里按「本次产物 + public 副本
 * + README」算出保留集合，其余删掉。
 *
 * 安装目录完全由本插件管理（插件运行时数据在 data/storage/petal 下），删多余文件
 * 不会误伤；代价是用户手动放进该目录的文件也会被清理。
 */
export function pruneOutDir({
  outDir,
  bundleFiles,
  publicDir,
  readmeNames,
  log,
}: {
  /** 产物目录绝对路径。 */
  outDir: string;
  /** 本次构建写出的文件（相对产物目录，`/` 分隔）。 */
  bundleFiles: string[];
  /** public 目录绝对路径；未配置时为空串。 */
  publicDir: string;
  /** README 文件名（相对产物根）。 */
  readmeNames: string[];
  log: Logger;
}): void {
  if (!existsSync(outDir)) return;

  const keep = new Set<string>([...bundleFiles, ...readmeNames].map((name) => name.replaceAll('\\', '/')));
  if (publicDir && existsSync(publicDir)) {
    for (const file of walkFiles(publicDir)) keep.add(file.name);
  }

  const removed: string[] = [];
  for (const file of walkFiles(outDir)) {
    if (keep.has(file.name)) continue;
    if (PROTECTED_PREFIXES.some((prefix) => file.name.startsWith(prefix))) continue;
    try {
      rmSync(file.path, { force: true });
      removed.push(file.name);
    } catch (cause) {
      log(`清理旧产物失败：${file.name}（${describeError(cause)}）`, 'debug');
    }
  }
  removeEmptyDirs(outDir, outDir);
  if (removed.length) log(`已清理 ${removed.length} 个旧产物：${removed.slice(0, 5).join('、')}${removed.length > 5 ? ' …' : ''}`, 'debug');
}

/** 自底向上删掉空目录（保留根）。 */
function removeEmptyDirs(root: string, dir: string): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = join(dir, entry.name);
    removeEmptyDirs(root, child);
    try {
      if (readdirSync(child).length === 0) rmdirSync(child);
    } catch {
      // 并发写入或权限问题：留给下一轮
    }
  }
}
