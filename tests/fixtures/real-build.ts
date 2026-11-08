/**
 * 真实 Vite 构建夹具。
 *
 * 构建配置的**交互**（`assetFileNames` × `base` × CSS 里的 `url()` 重写、
 * `mergeConfig` 的用户值优先）只在真实构建里才发生，单元断言证明不了。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import type { InlineConfig } from 'vite';
import siyuan from '../../src/index.ts';

export interface RealProject {
  dir: string;
  build(options?: {
    kind?: 'theme' | 'plugin';
    userConfig?: InlineConfig;
    entry?: string;
    /** 关掉资源内联，才能断言 assets/ 目录与 url() 重写。 */
    noInline?: boolean;
  }): Promise<{ files: string[]; css: string | null }>;
  cleanup(): void;
}

function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? walk(join(dir, entry.name), `${prefix}${entry.name}/`) : [`${prefix}${entry.name}`]
  );
}

/** 造一个最小项目：`src/main.css` 是入口，清单与其余文件按相对路径落盘。 */
export async function buildProject(files: Record<string, string>): Promise<RealProject> {
  const dir = mkdtempSync(join(tmpdir(), 'vps-build-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, Buffer.from(content, 'utf8'));
  }

  return {
    dir,
    async build(options = {}) {
      const kind = options.kind ?? 'theme';
      const userConfig: InlineConfig = {
        root: dir,
        logLevel: 'silent',
        configFile: false,
        plugins: [siyuan({ kind, entry: options.entry ?? join(dir, 'src', 'main.css') })],
        ...(options.noInline ? { build: { assetsInlineLimit: 0 } } : {}),
        ...options.userConfig,
      };
      await build(userConfig);
      const outDirs = readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== 'src' && entry.name !== 'public')
        .map((entry) => entry.name);
      const outDir = join(dir, outDirs[0] ?? 'dev');
      const files = walk(outDir);
      const cssName = kind === 'theme' ? 'theme.css' : 'index.css';
      const cssPath = join(outDir, cssName);
      return {
        files,
        css: existsSync(cssPath) ? readFileSync(cssPath, 'utf8') : null,
      };
    },
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
