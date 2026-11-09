/**
 * 产物目录修剪：watch 不清空目录，改名/删除后的旧文件必须被清掉。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pruneOutDir } from '../src/artifact/assets.ts';

const silent = (): void => {};

function makeDirs() {
  const root = mkdtempSync(join(tmpdir(), 'vps-prune-'));
  const outDir = join(root, 'out');
  const publicDir = join(root, 'public');
  mkdirSync(outDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });
  return { root, outDir, publicDir };
}

function put(base: string, rel: string, content = 'x'): void {
  const full = join(base, rel);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

describe('pruneOutDir', () => {
  it('删掉不在保留集合里的文件', () => {
    const { root, outDir, publicDir } = makeDirs();
    put(outDir, 'index.js');
    put(outDir, 'stale-old.js');
    put(outDir, 'assets/old.png');

    pruneOutDir({ outDir, bundleFiles: ['index.js'], publicDir, readmeNames: [], log: silent });

    expect(existsSync(join(outDir, 'index.js'))).toBe(true);
    expect(existsSync(join(outDir, 'stale-old.js'))).toBe(false);
    expect(existsSync(join(outDir, 'assets/old.png'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('保留 public 副本与 README', () => {
    const { root, outDir, publicDir } = makeDirs();
    put(publicDir, 'plugin.json', '{}');
    put(publicDir, 'i18n/zh-CN.json', '{}');
    put(outDir, 'plugin.json', '{}');
    put(outDir, 'i18n/zh-CN.json', '{}');
    put(outDir, 'i18n/removed.json', '{}');
    put(outDir, 'README.md', '# r');
    put(outDir, 'index.js');

    pruneOutDir({
      outDir,
      bundleFiles: ['index.js'],
      publicDir,
      readmeNames: ['README.md'],
      log: silent,
    });

    expect(existsSync(join(outDir, 'plugin.json'))).toBe(true);
    expect(existsSync(join(outDir, 'i18n/zh-CN.json'))).toBe(true);
    expect(existsSync(join(outDir, 'README.md'))).toBe(true);
    expect(existsSync(join(outDir, 'i18n/removed.json'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });

  it('清理后删掉空目录', () => {
    const { root, outDir, publicDir } = makeDirs();
    put(outDir, 'assets/gone/old.png');
    put(outDir, 'index.js');

    pruneOutDir({ outDir, bundleFiles: ['index.js'], publicDir, readmeNames: [], log: silent });

    expect(existsSync(join(outDir, 'assets'))).toBe(false);
    expect(readdirSync(outDir)).toEqual(['index.js']);
    rmSync(root, { recursive: true, force: true });
  });

  it('保留 .vite 与 .git', () => {
    const { root, outDir, publicDir } = makeDirs();
    put(outDir, '.vite/manifest.json', '{}');
    put(outDir, '.git/config', 'x');
    put(outDir, 'index.js');

    pruneOutDir({ outDir, bundleFiles: ['index.js'], publicDir, readmeNames: [], log: silent });

    expect(existsSync(join(outDir, '.vite/manifest.json'))).toBe(true);
    expect(existsSync(join(outDir, '.git/config'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });

  it('产物目录不存在时静默返回', () => {
    const root = mkdtempSync(join(tmpdir(), 'vps-prune-'));
    expect(() =>
      pruneOutDir({ outDir: join(root, 'missing'), bundleFiles: [], publicDir: '', readmeNames: [], log: silent })
    ).not.toThrow();
    rmSync(root, { recursive: true, force: true });
  });

  it('保留集合里的路径用 / 分隔（Windows 反斜杠等价）', () => {
    const { root, outDir, publicDir } = makeDirs();
    put(outDir, 'assets/a.png');
    put(outDir, 'assets/b.png');

    pruneOutDir({
      outDir,
      bundleFiles: ['assets\\a.png'],
      publicDir,
      readmeNames: [],
      log: silent,
    });

    expect(existsSync(join(outDir, 'assets/a.png'))).toBe(true);
    expect(existsSync(join(outDir, 'assets/b.png'))).toBe(false);
    rmSync(root, { recursive: true, force: true });
  });
});

