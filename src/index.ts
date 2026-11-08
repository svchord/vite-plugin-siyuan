/**
 * Vite 插件入口：把构建会话接到 Vite 生命周期上。
 *
 * ## 为什么只挂 build
 *
 * 思源从磁盘读 `<workspace>/data/themes/<name>/theme.css`，而 `vite dev` 只在内存
 * 里编译、不落盘。插件 JS 更严格——思源用 `window.eval(...)` 执行，需要 CJS 单文件，
 * dev server 给的是 ESM 模块图。所以父项目必须跑 `vite build --watch`。
 *
 * ## 钩子映射
 *
 *   config         注入构建配置（mergeConfig，用户值优先）
 *   configResolved 取 root / outDir / publicDir / watch，创建会话
 *   buildStart     把 public/** 逐个 addWatchFile
 *   writeBundle    搬运元数据 + 通知刷新
 *   closeBundle    校验 + 打包 + 汇报 + 构建完成日志
 *   closeWatcher   释放定时器
 */
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { applyBuildConfig } from './config.ts';
import { detectKind } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';
import { createTaggedLogger } from './output/log.ts';
import { createBuildSession } from './session.ts';
import type { BuildSession } from './session.ts';
import { describeError, UserError } from './support/errors.ts';

const NAME = 'vite-plugin-siyuan';

export interface SiYuanOptions {
  /** 被测类型（theme / plugin）；缺省从清单推断。 */
  kind?: Kind | null;
  /** 产物目录；缺省 `./dev`（watch）/ `./dist`（生产）。 */
  outDir?: string | null;
  /** 构建入口，相对项目根；缺省保留项目自己写的 input/lib。 */
  entry?: string | null;
}

export default function siyuan(options: SiYuanOptions = {}): Plugin {
  const log = createTaggedLogger(NAME);
  let session: BuildSession | null = null;
  let kind: Kind | null = options.kind ?? null;

  return {
    name: NAME,
    apply: 'build',

    config(userConfig) {
      const root = typeof userConfig.root === 'string' ? resolve(userConfig.root) : process.cwd();
      try {
        kind ??= detectKind(root);
      } catch (cause) {
        // 没有清单就不知道产物该叫什么；交给项目自己配，不在这里报错。
        log(`跳过构建配置注入：${describeError(cause)}`, 'warn');
        return undefined;
      }
      const watch = Boolean(userConfig.build?.watch);
      const entry = options.entry ? resolve(root, options.entry) : null;
      return applyBuildConfig(userConfig, { kind, watch, entry, outDir: options.outDir ?? null });
    },

    configResolved(resolvedConfig: ResolvedConfig) {
      const root = resolvedConfig.root;
      const outDir = resolvedConfig.build.outDir;
      const publicDir = resolvedConfig.publicDir;
      const watch = resolvedConfig.command === 'build' && Boolean(resolvedConfig.build.watch);
      if (!kind) {
        log('识别不到被测类型，跳过链接与校验', 'warn');
        return;
      }
      session = createBuildSession(
        { root, outDir: resolve(root, outDir), publicDir, watch },
        { kind, log, previewLogger: log }
      );
      if (!watch) log('生产构建：不启动热重载会话，只校验产物并打包');
    },

    buildStart() {
      session?.onStart((file) => this.addWatchFile(file));
    },

    async writeBundle(_options, bundle) {
      if (!session) return;
      try {
        await session.onWritten(Object.keys(bundle));
      } catch (cause) {
        throw cause instanceof UserError ? cause : new Error(describeError(cause));
      }
    },

    closeBundle() {
      if (!session) return;
      session.onFinished();
      session.onEnd();
    },

    async closeWatcher() {
      await session?.onClose();
    },
  };
}
