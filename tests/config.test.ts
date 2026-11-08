/**
 * 配置注入的合并语义：契约值补缺，用户值优先。
 *
 * 这一层只测配置对象，不跑构建——用户改产物名时校验会按设计拒绝打包，
 * 那种组合不该用完整构建来断言。
 */
import { describe, expect, it } from 'vitest';
import { applyBuildConfig, buildSpecFor } from '../src/config.ts';

describe('buildSpecFor', () => {
  it('theme 不注入 lib，只给 input 与 assetFileNames', () => {
    const spec = buildSpecFor({ kind: 'theme', watch: true, entry: '/p/src/main.css', outDir: null });
    expect(spec.base).toBe('./');
    expect(spec.build?.lib).toBeUndefined();
    expect(spec.build?.outDir).toBe('./dev');
    expect(spec.build?.minify).toBe(false);
  });

  it('plugin 注入 lib cjs 与 external', () => {
    const spec = buildSpecFor({ kind: 'plugin', watch: false, entry: '/p/src/index.ts', outDir: null });
    expect(spec.build?.lib).toMatchObject({ fileName: 'index', formats: ['cjs'] });
    expect(spec.build?.outDir).toBe('./dist');
    expect(spec.build?.minify).toBe(true);
  });

  it('outDir 选项覆盖默认值', () => {
    const spec = buildSpecFor({ kind: 'theme', watch: true, entry: null, outDir: './custom' });
    expect(spec.build?.outDir).toBe('./custom');
  });
});

describe('applyBuildConfig', () => {
  it('用户没写时用契约值', () => {
    const merged = applyBuildConfig({}, { kind: 'theme', watch: true, entry: '/p/src/main.css', outDir: null });
    expect(merged.base).toBe('./');
    expect(merged.build?.outDir).toBe('./dev');
  });

  it('用户写了 outDir 时保留用户值', () => {
    const merged = applyBuildConfig(
      { build: { outDir: 'user-dist' } },
      { kind: 'theme', watch: true, entry: '/p/src/main.css', outDir: null }
    );
    expect(merged.build?.outDir).toBe('user-dist');
  });

  it('用户写了 assetFileNames 时保留用户值', () => {
    const merged = applyBuildConfig(
      { build: { rollupOptions: { output: { assetFileNames: 'custom-[name][extname]' } } } },
      { kind: 'theme', watch: true, entry: '/p/src/main.css', outDir: null }
    );
    const options = merged.build?.rollupOptions ?? merged.build?.rolldownOptions;
    const output = Array.isArray(options?.output) ? options.output[0] : options?.output;
    expect(output?.assetFileNames).toBe('custom-[name][extname]');
  });

  it('用户没写 define 时补 NODE_ENV', () => {
    const merged = applyBuildConfig({}, { kind: 'theme', watch: true, entry: '/p/src/main.css', outDir: null });
    expect(merged.define?.['process.env.NODE_ENV']).toBe('"development"');
  });
});
