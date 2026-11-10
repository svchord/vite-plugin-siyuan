/**
 * 配置注入：契约键 / 口味键 / 模式键的合并语义。
 *
 * 这一层只测配置对象，不跑构建——契约键被改错时校验拦不住，必须在这里断言。
 */
import { describe, expect, it } from 'vitest';
import { mergeConfig } from 'vite';
import { applyBuildConfig, assertResolvedContract, buildSpecFor } from '../src/config.ts';

/** 模拟 Vite 的 runConfigHook：conf = mergeConfig(用户配置, 插件返回值)。 */
function finalConfig(userConfig: Parameters<typeof applyBuildConfig>[0], input: Parameters<typeof applyBuildConfig>[1]) {
  return mergeConfig(userConfig, applyBuildConfig(userConfig, input));
}

const THEME = { kind: 'theme' as const, watch: false, entry: '/p/src/main.css', installDir: null };
const THEME_WATCH = { kind: 'theme' as const, watch: true, entry: '/p/src/main.css', installDir: '/ws/data/themes/p' };
const PLUGIN = { kind: 'plugin' as const, watch: false, entry: '/p/src/index.ts', installDir: null };
const PLUGIN_WATCH = { kind: 'plugin' as const, watch: true, entry: '/p/src/index.ts', installDir: '/ws/data/plugins/p' };

describe('buildSpecFor', () => {
  it('theme 不注入 lib，只给 input 与 assetFileNames', () => {
    const spec = buildSpecFor(THEME_WATCH);
    expect(spec.base).toBe('./');
    expect(spec.build?.outDir).toBe('/ws/data/themes/p');
    expect(spec.build?.lib).toBeUndefined();
    expect(spec.build?.minify).toBe(false);
    expect(spec.build?.emptyOutDir).toBe(false);
  });

  it('plugin 注入 lib cjs 与 external', () => {
    const spec = buildSpecFor(PLUGIN);
    expect(spec.build?.lib).toMatchObject({ fileName: 'index', formats: ['cjs'] });
    expect(spec.build?.outDir).toBe('./dist');
    expect(spec.build?.minify).toBe(true);
    expect(spec.build?.emptyOutDir).toBe(true);
  });

  it('watch 时 outDir 就是思源安装目录', () => {
    const spec = buildSpecFor(PLUGIN_WATCH);
    expect(spec.build?.outDir).toBe('/ws/data/plugins/p');
  });

  it('Vite 8 用 rolldownOptions，旧版与版本未知用 rollupOptions', () => {
    const build = (viteMajor: number | null) =>
      buildSpecFor({ ...THEME, viteMajor }).build as Record<string, unknown>;
    expect(build(8)).toHaveProperty('rolldownOptions.input', THEME.entry);
    expect(build(8)).not.toHaveProperty('rollupOptions');
    // 旧版 Vite 不认识 rolldownOptions，会静默丢掉 input 并崩在 index.html。
    expect(build(7)).toHaveProperty('rollupOptions.input', THEME.entry);
    expect(build(null)).toHaveProperty('rollupOptions.input', THEME.entry);
    expect(buildSpecFor(THEME).build).toHaveProperty('rollupOptions.input', THEME.entry);
  });
});

describe('applyBuildConfig：模式键', () => {
  it('watch 时 outDir 钉死为安装目录、emptyOutDir 为 false', () => {
    const merged = applyBuildConfig({}, THEME_WATCH);
    expect(merged.build?.outDir).toBe('/ws/data/themes/p');
    expect(merged.build?.emptyOutDir).toBe(false);
  });

  it('build 时 outDir 缺省 dist、emptyOutDir 为 true', () => {
    const merged = applyBuildConfig({}, THEME);
    expect(merged.build?.outDir).toBe('dist');
    expect(merged.build?.emptyOutDir).toBe(true);
  });

  it('build 时用户写 outDir 生效', () => {
    const merged = applyBuildConfig({ build: { outDir: 'user-dist' } }, THEME);
    expect(merged.build?.outDir).toBe('user-dist');
  });

  it('watch 时用户写 outDir 直接报错', () => {
    expect(() => applyBuildConfig({ build: { outDir: 'user-dist' } }, THEME_WATCH)).toThrow(/build\.outDir 由插件管理/);
  });
});

describe('applyBuildConfig：口味键', () => {
  it('用户写 minify / target / sourcemap 时保留用户值', () => {
    const merged = finalConfig(
      { build: { minify: false, target: 'es2020', sourcemap: true } },
      PLUGIN
    );
    expect(merged.build?.minify).toBe(false);
    expect(merged.build?.target).toBe('es2020');
    expect(merged.build?.sourcemap).toBe(true);
  });

  it('用户没写 minify 时按模式给默认值', () => {
    expect(applyBuildConfig({}, PLUGIN_WATCH).build?.minify).toBe(false);
    expect(applyBuildConfig({}, PLUGIN).build?.minify).toBe(true);
  });

  it('用户自己的 define 保留，NODE_ENV 由插件按模式给默认值', () => {
    const merged = finalConfig({ define: { __MY_FLAG__: '"yes"' } }, PLUGIN);
    expect(merged.define?.['__MY_FLAG__']).toBe('"yes"');
    expect(merged.define?.['process.env.NODE_ENV']).toBe('"production"');
  });
});

describe('applyBuildConfig：契约键', () => {
  it('base 为绝对路径时报错', () => {
    expect(() => applyBuildConfig({ base: '/' }, THEME)).toThrow(/base 由插件固定/);
    expect(() => applyBuildConfig({ base: 'https://cdn.example.com/' }, THEME)).toThrow(/base 由插件固定/);
  });

  it('base 为相对路径时通过', () => {
    for (const base of ['', '.', './']) {
      expect(() => applyBuildConfig({ base }, THEME)).not.toThrow();
    }
  });

  it('plugin 的 lib.formats 含 cjs 以外的格式时报错', () => {
    expect(() => applyBuildConfig({ build: { lib: { formats: ['cjs', 'es'] } } }, PLUGIN)).toThrow(/lib\.formats 不能包含 es/);
    expect(() => applyBuildConfig({ build: { lib: { formats: ['es'] } } }, PLUGIN)).toThrow(/lib\.formats 不能包含 es/);
  });

  it('plugin 的 lib.formats 为 [cjs] 或不写时通过', () => {
    expect(() => applyBuildConfig({ build: { lib: { formats: ['cjs'] } } }, PLUGIN)).not.toThrow();
    expect(() => applyBuildConfig({}, PLUGIN)).not.toThrow();
  });

  it('plugin 关闭 build.lib 时报错', () => {
    expect(() => applyBuildConfig({ build: { lib: false } }, PLUGIN)).toThrow(/build\.lib 不能关闭/);
  });

  it('plugin 改 lib.fileName / cssFileName 时报错', () => {
    expect(() => applyBuildConfig({ build: { lib: { fileName: 'custom' } } }, PLUGIN)).toThrow(/lib\.fileName 由插件固定/);
    expect(() => applyBuildConfig({ build: { lib: { cssFileName: 'custom' } } }, PLUGIN)).toThrow(/lib\.cssFileName 由插件固定/);
  });

  it('plugin 改 entryFileNames / assetFileNames 时报错', () => {
    expect(() =>
      applyBuildConfig({ build: { rolldownOptions: { output: { entryFileNames: 'custom.js' } } } }, PLUGIN)
    ).toThrow(/entryFileNames 由插件固定/);
    expect(() =>
      applyBuildConfig({ build: { rolldownOptions: { output: { assetFileNames: 'x' } } } }, PLUGIN)
    ).toThrow(/assetFileNames 由插件固定/);
  });

  it('关闭 copyPublicDir / write、开启 ssr 时报错', () => {
    expect(() => applyBuildConfig({ build: { copyPublicDir: false } }, PLUGIN)).toThrow(/copyPublicDir 不能关闭/);
    expect(() => applyBuildConfig({ build: { write: false } }, PLUGIN)).toThrow(/build\.write 不能关闭/);
    expect(() => applyBuildConfig({ build: { ssr: true } }, PLUGIN)).toThrow(/build\.ssr 不能开启/);
  });

  it('theme 写 build.lib 时报错', () => {
    expect(() => applyBuildConfig({ build: { lib: { formats: ['es'] } } }, THEME)).toThrow(/theme 不能用 build\.lib/);
  });
});

describe('applyBuildConfig：external 合并', () => {
  it('用户追加 external 时 Vite 会把用户值与插件值拼接', () => {
    const merged = finalConfig({ build: { rolldownOptions: { external: ['my-lib'] } } }, PLUGIN);
    const external = (merged.build as { rolldownOptions?: { external?: unknown[] } }).rolldownOptions?.external;
    expect(external).toEqual(['my-lib', 'siyuan', 'process']);
  });

  it('用户写 empty external 时插件值仍在', () => {
    const merged = finalConfig({ build: { rolldownOptions: { external: [] } } }, PLUGIN);
    const external = (merged.build as { rolldownOptions?: { external?: unknown[] } }).rolldownOptions?.external;
    expect(external).toEqual(['siyuan', 'process']);
  });
});

describe('assertResolvedContract：Vite 合并后的最终值', () => {
  const resolvedPlugin = (overrides: Record<string, unknown> = {}) => ({
    base: './',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      copyPublicDir: true,
      write: true,
      lib: { formats: ['cjs'], fileName: 'index', cssFileName: 'index' },
      rolldownOptions: { output: { entryFileNames: '[name].js' } },
      ...overrides,
    },
  });

  it('正常配置通过', () => {
    expect(() => assertResolvedContract(resolvedPlugin(), 'plugin', false, null)).not.toThrow();
  });

  it('base 被其他插件覆盖时报错', () => {
    expect(() => assertResolvedContract({ ...resolvedPlugin(), base: '/' }, 'plugin', false, null)).toThrow(/base 最终值/);
  });

  it('lib.formats 被其他插件覆盖时报错', () => {
    expect(() =>
      assertResolvedContract(resolvedPlugin({ lib: { formats: ['cjs', 'es'], fileName: 'index', cssFileName: 'index' } }), 'plugin', false, null)
    ).toThrow(/formats 最终值/);
  });

  it('重复的 cjs 视为合法（Vite 外层数组会拼接）', () => {
    expect(() =>
      assertResolvedContract(resolvedPlugin({ lib: { formats: ['cjs', 'cjs'], fileName: 'index', cssFileName: 'index' } }), 'plugin', false, null)
    ).not.toThrow();
  });

  it('entryFileNames 被覆盖时报错', () => {
    expect(() =>
      assertResolvedContract(resolvedPlugin({ rolldownOptions: { output: { entryFileNames: 'custom.js' } } }), 'plugin', false, null)
    ).toThrow(/entryFileNames 最终值/);
  });

  it('watch 时 outDir 偏离安装目录报错', () => {
    expect(() => assertResolvedContract(resolvedPlugin({ outDir: 'dev', emptyOutDir: false }), 'plugin', true, '/ws/data/plugins/p')).toThrow(
      /outDir 最终值/
    );
  });

  it('watch 时 emptyOutDir 不为 false 报错', () => {
    expect(() =>
      assertResolvedContract(resolvedPlugin({ outDir: '/ws/data/plugins/p', emptyOutDir: true }), 'plugin', true, '/ws/data/plugins/p')
    ).toThrow(/emptyOutDir 最终值/);
  });
});
