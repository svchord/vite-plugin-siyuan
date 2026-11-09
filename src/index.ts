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
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { applyBuildConfig } from './config.ts';
import { detectKind } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';
import { resolvePublicDir } from './siyuan/manifest.ts';
import { createTaggedLogger } from './output/log.ts';
import { createBuildSession } from './session.ts';
import type { BuildSession } from './session.ts';
import { describeError, UserError } from './support/errors.ts';

const NAME = 'vite-plugin-siyuan';

export interface SiYuanOptions {
  /**
   * 构建入口，相对项目根。必填：主题要产出固定名 `theme.css`、插件要产出
   * CJS 单文件 `index.js`，产物名是思源加载机制决定的契约，入口不能靠猜——
   * 猜错不会报错，只会静默产出思源加载不到的东西。
   */
  entry: string;
  /** 被测类型（theme / plugin）；缺省从清单推断。 */
  kind?: Kind | null;
  /** 产物目录；缺省 `./dev`（watch）/ `./dist`（生产）。 */
  outDir?: string | null;
}

export default function siyuan(options: SiYuanOptions): Plugin {
  const log = createTaggedLogger(NAME);
  let session: BuildSession | null = null;
  let kind: Kind | null = options.kind ?? null;

  return {
    name: NAME,
    apply: 'build',

    config(userConfig) {
      const root = typeof userConfig.root === 'string' ? resolve(userConfig.root) : process.cwd();
      const entry = resolve(root, options.entry);
      if (!existsSync(entry)) {
        throw new UserError(`entry 指向的文件不存在：${entry}（选项值：${options.entry}）`);
      }
      // entry 必填意味着用户确实在建思源产物，所以识别不到类型是真错误，
      // 不能像以前那样 warn 后跳过——那会让构建继续跑，最后崩在 Vite 的
      // "Cannot resolve entry module index.html" 上，完全指错方向。
      // publicDir 在这里还没解析（configResolved 才给），先按用户配置算一遍。
      const publicDir = resolvePublicDir(root, userConfig.publicDir);
      kind ??= detectKind(publicDir);
      const watch = Boolean(userConfig.build?.watch);
      return applyBuildConfig(userConfig, { kind, watch, entry, outDir: options.outDir ?? null });
    },

    configResolved(resolvedConfig: ResolvedConfig) {
      const root = resolvedConfig.root;
      const outDir = resolvedConfig.build.outDir;
      const publicDir = resolvedConfig.publicDir;
      const watch = resolvedConfig.command === 'build' && Boolean(resolvedConfig.build.watch);
      if (!kind) {
        // 正常情况下 config 阶段已确定类型或抛错；走到这里说明状态异常，
        // 不能只 warn 后跳过校验——静默产出思源加载不到的东西更难排查。
        throw new UserError('识别不到被测类型：请确认 publicDir 下的 theme.json / plugin.json，或用 kind 选项显式指定');
      }
      session = createBuildSession(
        { root, outDir: resolve(root, outDir), publicDir, watch },
        { kind, log, previewLogger: log }
      );
      // 生产构建的最终结果由「已打包 + build #N ready」体现，模式说明只对排查有用。
      if (!watch) log('生产构建：不启动热重载会话，只校验产物并打包', 'debug');
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
