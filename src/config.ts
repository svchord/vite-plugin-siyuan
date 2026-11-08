/**
 * 构建配置注入：把思源的加载机制翻译成 Vite 配置形状。
 *
 * `build.lib`、`rollupOptions`、`base` 是**思源加载机制决定的契约**，不是项目口味，
 * 必须由插件设；但用户显式写的值优先。
 *
 * 用 Vite 公共 API `mergeConfig(spec, userConfig)`：**用户放后面**，深度合并后用户胜出。
 * 直接返回 spec 会覆盖用户值（实测 `user-dist` 被改成 `dev`）；原地 mutate + 手写
 * 一堆 `??=` 也不是 Vite 推荐写法。函数值 `assetFileNames` 实测能正确合并。
 */
import { mergeConfig, version as viteVersion } from 'vite';
import type { UserConfig } from 'vite';
import { kindSpec } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';

/** 生成构建片段所需的事实。 */
export interface BuildSpecInput {
  kind: Kind;
  watch: boolean;
  /** 入口文件绝对路径；不给则保留项目自己的 input/lib。 */
  entry: string | null;
  /** 插件选项里显式给的产物目录。 */
  outDir: string | null;
}

const ASSET_DIR = 'assets';

/** 资源名：CSS 固定名，其余按源目录归到 assets/ 下（避免不同目录的同名文件被去重）。 */
function assetNamer(cssName: string) {
  return (info: { name?: string | null }): string => {
    const name = info.name ?? 'asset';
    return name.endsWith('.css') ? cssName : `${ASSET_DIR}/${name}`;
  };
}

/** Vite 8 把 build.rollupOptions 改名为 build.rolldownOptions（旧名仍可用）。 */
function defaultOptionsKey(): 'rollupOptions' | 'rolldownOptions' {
  return Number.parseInt(viteVersion, 10) >= 8 ? 'rolldownOptions' : 'rollupOptions';
}

/** 用户已经写了哪个键就跟着用哪个，避免两个键同时出现；否则按版本选。 */
function optionsKey(userConfig: UserConfig): 'rollupOptions' | 'rolldownOptions' {
  const build = userConfig.build;
  if (build && 'rollupOptions' in build) return 'rollupOptions';
  if (build && 'rolldownOptions' in build) return 'rolldownOptions';
  return defaultOptionsKey();
}

/** 生成插件契约配置（不含用户值）。 */
export function buildSpecFor(input: BuildSpecInput): UserConfig {
  const spec = kindSpec(input.kind);
  const outDir = input.outDir ?? (input.watch ? './dev' : './dist');
  const options: Record<string, unknown> = {};

  if (input.entry) options.input = input.entry;
  if (input.kind === 'plugin') {
    options.external = ['siyuan', 'process'];
    options.output = {
      entryFileNames: '[name].js',
      assetFileNames: assetNamer(spec.cssName),
    };
  } else {
    // theme 不能走 lib：lib 隐含 cssCodeSplit:false，与 CSS 入口冲突、Vite 直接报错。
    options.output = { assetFileNames: assetNamer(spec.cssName) };
  }

  const build: Record<string, unknown> = {
    outDir,
    emptyOutDir: false,
    // watch 不压缩（便于直接看落盘产物），生产用默认压缩器。
    minify: !input.watch,
  };
  if (input.entry && input.kind === 'plugin') {
    // 插件入口是 `export default class ...`，必须走 lib：lib cjs 产出
    // `module.exports = 类`；普通 input 只得到 `exports.default`，思源报
    // "plugin xxx has no export"。
    build.lib = { entry: input.entry, fileName: 'index', cssFileName: 'index', formats: ['cjs'] };
  }
  build[defaultOptionsKey()] = options;

  return {
    // 思源从 /appearance/themes/<name>/ 提供主题；Vite 默认 base:'/' 会产出
    // 根绝对 URL，字体/图片在宿主下 404。
    base: './',
    build,
    // 插件 JS 在思源前端 eval 执行，而前端没有 process 对象；React 等依赖会读
    // process.env.NODE_ENV。
    define: { 'process.env.NODE_ENV': JSON.stringify(input.watch ? 'development' : 'production') },
  } as UserConfig;
}

/**
 * 把契约配置与用户配置合并，返回给 `config()` 钩子。
 *
 * 用户若已写了旧键名 `rollupOptions` 而当前 Vite 用新键名，先把 spec 里的那一块
 * 换到旧键名下，再合并——避免出现两个键同时存在、优先级不确定的情况。
 */
export function applyBuildConfig(userConfig: UserConfig, input: BuildSpecInput): UserConfig {
  const spec = buildSpecFor(input);
  const key = optionsKey(userConfig);
  const specBuild = spec.build as Record<string, unknown> | undefined;
  if (specBuild && key in specBuild === false) {
    const other = key === 'rollupOptions' ? 'rolldownOptions' : 'rollupOptions';
    const value = specBuild[other];
    if (value !== undefined) {
      specBuild[key] = value;
      delete specBuild[other];
    }
  }
  return mergeConfig(spec, userConfig);
}
