/**
 * 构建配置注入：把思源的加载机制翻译成 Vite 配置形状。
 *
 * 键分三类：契约键（改错了思源加载不了，插件固定）、口味键（用户优先）、
 * 模式键（watch / build 语义不同）。
 */
import { version as viteVersion } from 'vite';
import type { UserConfig } from 'vite';
import { kindSpec } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';
import { UserError } from './support/errors.ts';

/** 生成构建片段所需的事实。 */
export interface BuildSpecInput {
  kind: Kind;
  watch: boolean;
  /** 入口文件绝对路径。必填：产物名是固定契约，入口不能靠猜。 */
  entry: string;
  /** watch 时的思源安装目录（绝对路径）；build 时为 null。 */
  installDir: string | null;
}

const ASSET_DIR = 'assets';

/** 允许用户写的 base 值：必须是相对路径。Vite 用 '' 或 './' 都表示相对。 */
const RELATIVE_BASES = new Set(['', '.', './']);

/** 插件产物的固定入口名。 */
const ENTRY_FILE_NAME = '[name].js';

/** 资源名：CSS 固定名，其余一律放 assets/ 下。`assetFileNames` 的 `info.name` 只有 basename，当前无法按源目录区分同名资源。 */
function assetNamer(cssName: string) {
  return (info: { name?: string | null }): string => {
    const name = info.name ?? 'asset';
    return name.endsWith('.css') ? cssName : `${ASSET_DIR}/${name}`;
  };
}

/** Vite ≥8 的等价键是 build.rolldownOptions；build.rollupOptions 作为已弃用别名仍可用。 */
function defaultOptionsKey(): 'rollupOptions' | 'rolldownOptions' {
  return Number.parseInt(viteVersion, 10) >= 8 ? 'rolldownOptions' : 'rollupOptions';
}

/** 两个键不能同时出现（Vite 只会读其中一个）；用户写了哪个就沿用它。 */
function optionsKey(userConfig: UserConfig): 'rollupOptions' | 'rolldownOptions' {
  const build = userConfig.build;
  if (build && 'rollupOptions' in build) return 'rollupOptions';
  if (build && 'rolldownOptions' in build) return 'rolldownOptions';
  return defaultOptionsKey();
}

/** 生成构建契约配置（不含用户值）。 */
export function buildSpecFor(input: BuildSpecInput): UserConfig {
  const spec = kindSpec(input.kind);
  const outDir = input.watch ? (input.installDir ?? './dev') : './dist';
  const options: Record<string, unknown> = { input: input.entry };
  if (input.kind === 'plugin') {
    options.external = ['siyuan', 'process'];
    options.output = {
      entryFileNames: ENTRY_FILE_NAME,
      assetFileNames: assetNamer(spec.cssName),
    };
  } else {
    // theme 不能走 lib：lib 隐含 cssCodeSplit:false，与 CSS 入口冲突、Vite 直接报错。
    options.output = { assetFileNames: assetNamer(spec.cssName) };
  }

  const build: Record<string, unknown> = {
    outDir,
    // watch 不清空（目录就是思源安装目录）；build 必须清空，否则残留会进 package.zip。
    emptyOutDir: !input.watch,
    // watch 产物不压缩：落盘文件要能直接读；生产构建用默认压缩。
    minify: !input.watch,
  };
  if (input.kind === 'plugin') {
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
 * 契约键校验：这些键改错了思源加载不了，而产物校验发现不了（文件名全对、
 * 文件也都在），所以在 config 阶段直接报错。
 */
export function assertContractKeys(userConfig: UserConfig, kind: Kind, watch: boolean): void {
  const base = userConfig.base;
  if (base !== undefined && !RELATIVE_BASES.has(base)) {
    throw new UserError(
      `base 由插件固定为相对路径，不能设为 ${JSON.stringify(base)}。\n` +
        '  思源从 /appearance/themes|plugins/<name>/ 提供产物，绝对 base 会让字体/图片 404，\n' +
        '  而产物校验发现不了这种错误。'
    );
  }

  if (watch && userConfig.build?.outDir !== undefined) {
    throw new UserError(
      'watch 模式下 build.outDir 由插件管理（直接写入思源安装目录），不能手动设置。\n' +
        "  需要自定义项目根下的开发链接目录名，请用 devDir 选项（默认 'dev'）。"
    );
  }

  const build = userConfig.build;
  if (build?.copyPublicDir === false) {
    throw new UserError(
      'build.copyPublicDir 不能关闭：theme.json / plugin.json 靠它复制到产物根，关了思源不显示该主题/插件。'
    );
  }
  if (build?.write === false) {
    throw new UserError('build.write 不能关闭：插件要在构建结束时校验并打包产物。');
  }
  if (build?.ssr) {
    throw new UserError('build.ssr 不能开启：思源插件/主题是浏览器端产物，不是 SSR 构建。');
  }

  const optionsKeyName = optionsKey(userConfig);
  const options = build?.[optionsKeyName] as Record<string, unknown> | undefined;
  const output = options?.output as Record<string, unknown> | undefined;
  const entryFileNames = output?.entryFileNames;
  if (entryFileNames !== undefined && entryFileNames !== ENTRY_FILE_NAME) {
    throw new UserError(
      `build.${optionsKeyName}.output.entryFileNames 由插件固定为 ${JSON.stringify(ENTRY_FILE_NAME)}，` +
        `不能设为 ${JSON.stringify(entryFileNames)}。思源按固定名加载产物。`
    );
  }
  if (output?.assetFileNames !== undefined) {
    throw new UserError(
      `build.${optionsKeyName}.output.assetFileNames 由插件固定（主题 theme.css / 插件 index.css），不能覆盖。`
    );
  }

  // theme 不走 Lib 模式，下面只约束 plugin。
  if (kind !== 'plugin') {
    if (build?.lib !== undefined && build.lib !== false) {
      throw new UserError('theme 不能用 build.lib：lib 隐含 cssCodeSplit:false，与 CSS 入口冲突，Vite 会直接报错。');
    }
    return;
  }

  const lib = build?.lib;
  if (lib === false) {
    throw new UserError('build.lib 不能关闭：插件必须是 CJS 单文件（思源用 window.eval 执行，且只认 CommonJS）。');
  }
  if (lib === undefined) return;
  const unsupported = (lib.formats ?? ['cjs']).filter((format) => format !== 'cjs');
  if (unsupported.length > 0) {
    throw new UserError(
      `build.lib.formats 不能包含 ${unsupported.join('、')}：思源用 window.eval 执行插件 JS，只认 CJS。\n` +
        "  加 es 会让 ESM 产物覆盖 index.js，而产物校验发现不了。当前只允许 ['cjs']。"
    );
  }
  if (lib.fileName !== undefined && lib.fileName !== 'index') {
    throw new UserError(`build.lib.fileName 由插件固定为 'index'（产物 index.js），不能设为 ${JSON.stringify(lib.fileName)}。`);
  }
  if (lib.cssFileName !== undefined && lib.cssFileName !== 'index') {
    throw new UserError(
      `build.lib.cssFileName 由插件固定为 'index'（产物 index.css），不能设为 ${JSON.stringify(lib.cssFileName)}。`
    );
  }
}

/**
 * 校验 Vite 合并后的最终配置。
 *
 * config 钩子的返回值还会被 Vite 用 `mergeConfig(conf, res)` 再合并一次，
 * 之后的插件（尤其 `enforce: 'post'`）还能覆盖契约键，所以必须按最终值再查一遍。
 */
export function assertResolvedContract(
  resolved: { base: string; build: Record<string, unknown> },
  kind: Kind,
  watch: boolean,
  installDir: string | null
): void {
  if (!RELATIVE_BASES.has(resolved.base)) {
    throw new UserError(
      `base 最终值是 ${JSON.stringify(resolved.base)}，不是相对路径。可能有其他插件覆盖了它；` +
        '思源要求相对 base，否则字体/图片 404。'
    );
  }

  const build = resolved.build;
  if (watch) {
    if (installDir !== null && String(resolvePath(build.outDir)) !== resolvePath(installDir)) {
      throw new UserError(
        `watch 模式的 outDir 最终值是 ${JSON.stringify(build.outDir)}，不是思源安装目录 ${installDir}。\n` +
          '  可能有其他插件覆盖了 build.outDir。'
      );
    }
    if (build.emptyOutDir !== false) {
      throw new UserError('watch 模式的 emptyOutDir 最终值不是 false：每次重建会清空思源安装目录。');
    }
  }
  if (build.copyPublicDir === false) {
    throw new UserError('build.copyPublicDir 最终值是 false：theme.json / plugin.json 不会进产物根。');
  }
  if (build.write === false) {
    throw new UserError('build.write 最终值是 false：不会落盘，无法校验和打包。');
  }
  if (build.ssr) {
    throw new UserError('build.ssr 最终值为真：思源插件/主题是浏览器端产物。');
  }

  const options = (build['rolldownOptions'] ?? build['rollupOptions']) as Record<string, unknown> | undefined;
  const output = options?.output as Record<string, unknown> | undefined;
  if (output?.entryFileNames !== undefined && output.entryFileNames !== ENTRY_FILE_NAME) {
    throw new UserError(
      `entryFileNames 最终值是 ${JSON.stringify(output.entryFileNames)}，不是 ${JSON.stringify(ENTRY_FILE_NAME)}。`
    );
  }

  if (kind !== 'plugin') return;
  const lib = build.lib as Record<string, unknown> | undefined;
  if (!lib) throw new UserError('build.lib 最终值缺失：插件必须是 CJS 单文件。');
  const formats = Array.isArray(lib.formats) ? lib.formats : [];
  const unique = [...new Set(formats)];
  if (unique.length !== 1 || unique[0] !== 'cjs') {
    throw new UserError(
      `build.lib.formats 最终值是 ${JSON.stringify(formats)}，必须只有 cjs。` +
        ' 可能有其他插件覆盖了它；ESM 产物在思源里会报 export is not defined。'
    );
  }
  if (lib.fileName !== 'index') {
    throw new UserError(`build.lib.fileName 最终值是 ${JSON.stringify(lib.fileName)}，必须是 'index'。`);
  }
  if (lib.cssFileName !== 'index') {
    throw new UserError(`build.lib.cssFileName 最终值是 ${JSON.stringify(lib.cssFileName)}，必须是 'index'。`);
  }
}

/** 归一化路径用于比较（仅用于最终值校验）。 */
function resolvePath(value: unknown): string {
  return String(value ?? '').replaceAll('\\', '/').replace(/\/+$/, '');
}

/**
 * 生成给 Vite 的配置：契约键由插件固定，口味键先算好默认值（用户写了就用用户的），
 * 模式键按 watch / build 决定。深合并和数组拼接交给 Vite 的 `mergeConfig`。
 *
 * `lib.formats` 例外：用户已写时不返回，否则 Vite 会拼成 `['cjs','cjs']`。
 */
export function applyBuildConfig(userConfig: UserConfig, input: BuildSpecInput): UserConfig {
  assertContractKeys(userConfig, input.kind, input.watch);
  const spec = buildSpecFor(input);
  const userBuild = (userConfig.build ?? {}) as Record<string, unknown>;
  const build = { ...(spec.build as Record<string, unknown>) };

  // 口味键 + 模式键
  build.minify = userBuild.minify ?? !input.watch;
  build.emptyOutDir = !input.watch;
  build.outDir = input.watch ? input.installDir : (userBuild.outDir ?? 'dist');

  const userLib = userBuild.lib as Record<string, unknown> | undefined;
  const specLib = build.lib as Record<string, unknown> | undefined;
  if (input.kind === 'plugin' && specLib) {
    if (userLib && userLib.formats !== undefined) {
      const libWithoutFormats = { ...specLib };
      delete libWithoutFormats.formats;
      build.lib = libWithoutFormats;
    }
  }

  // NODE_ENV 默认值按模式给；用户显式写了就以用户为准
  const userDefine = (userConfig.define ?? {}) as Record<string, unknown>;
  const define = { ...(spec.define as Record<string, unknown>) };
  if (userDefine['process.env.NODE_ENV'] !== undefined) {
    define['process.env.NODE_ENV'] = userDefine['process.env.NODE_ENV'];
  }

  return {
    ...spec,
    build,
    define,
  } as UserConfig;
}
