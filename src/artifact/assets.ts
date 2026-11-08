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
 * 主流构建器的 `publicDir` 都只在**启动时**复制进产物，之后不再监听它，
 * 而思源的清单恰恰在 `public/` 里——改个 `theme.json` 的 modes 或版本号，
 * 不重启就永远不生效。所以要把 `public/**` 显式加进监听集合。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { readJsonFile, walkFiles } from '../support/fs.ts';
import { isRecord } from '../support/guards.ts';
import type { Logger } from '../support/log.ts';

const README_PATTERN = /^README.*\.md$/;

/** 把 `public/**` 逐个交给构建器登记监听。 */
export function watchPublicFiles(publicDir: string, registerWatchFile: (file: string) => void, log: Logger): void {
  if (!publicDir || !existsSync(publicDir)) {
    log(`publicDir 不存在，跳过监听：${publicDir}`, 'warn');
    return;
  }
  for (const file of walkFiles(publicDir)) registerWatchFile(file.path);
}

/** 从清单的 readme 字段收集 README 文件名（string 或 i18n 对象）。 */
function declaredReadmes(manifestPath: string, log: Logger): string[] | null {
  const parsed = readJsonFile(manifestPath);
  if (!isRecord(parsed)) {
    log(`读不到或无法解析清单 ${manifestPath}；README 按 README*.md 兜底`, 'warn');
    return null;
  }
  const files = new Set<string>();
  const readme: unknown = parsed['readme'];
  if (typeof readme === 'string') files.add(readme);
  else if (isRecord(readme)) {
    for (const value of Object.values(readme)) if (typeof value === 'string') files.add(value);
  }
  return files.size ? [...files] : null;
}

/**
 * 把 README 从项目根搬进产物目录（GitHub 只认根目录，思源要求产物根）。
 *
 * 清单声明的 README 优先；没声明时按 `README*.md` 兜底。
 * 若同名文件已经在 `public/` 下，说明用户选了 public 布局，跳过不覆盖。
 *
 * watch 下复制失败只报错继续（一次文件锁不该停掉开发服务器）；
 * 生产构建必须失败——否则 package.zip 会缺 README。
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
}): void {
  const absoluteOutDir = resolve(root, outDir);
  mkdirSync(absoluteOutDir, { recursive: true });

  const manifestPath = join(root, 'public', manifestName);
  const declared = declaredReadmes(manifestPath, log);

  const names: string[] = [];
  if (declared) {
    names.push(...declared);
  } else {
    log(`清单 ${manifestPath} 没声明 readme，按 README*.md 兜底搬运`, 'warn');
    names.push(
      ...readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isFile() && README_PATTERN.test(entry.name))
        .map((entry) => entry.name)
    );
  }

  const failures: string[] = [];
  for (const name of names) {
    const source = resolve(root, name);
    if (!existsSync(source)) {
      // 用户把 README 放进了 public/，Vite 已经复制过，不覆盖。
      if (publicDir && existsSync(join(publicDir, name))) continue;
      failures.push(`${name}：项目根与 public/ 下都不存在`);
      continue;
    }
    try {
      const destination = join(absoluteOutDir, name);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(source, destination);
    } catch (cause) {
      failures.push(`${name}：${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }
  if (!failures.length) return;
  const detail = failures.join('；');
  if (watch) log(`README 复制失败 ${detail}`, 'error');
  else throw new Error(`README 复制失败：${detail}`);
}
