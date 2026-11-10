/**
 * Vite 插件入口。
 *
 * 只支持 `vite build`（`apply: 'build'`）：思源从磁盘读产物，dev server 只在内存里
 * 编译；插件 JS 还要求 CJS 单文件（思源用 window.eval 执行）。
 *
 * watch：直接写 `<workspace>/data/themes|plugins/<name>`，并在项目根建 `<devDir>`
 *        开发链接指向它，方便开发者/IDE 查看。
 * build：不探测思源，产物写 `dist`（或用户 build.outDir），校验后打包。
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { applyBuildConfig, assertResolvedContract } from './config.ts';
import { detectKind, kindSpec, readName } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';
import { resolvePublicDir } from './siyuan/manifest.ts';
import { findKernelPort } from './siyuan/port.ts';
import { resolveInstallDir } from './siyuan/workspace.ts';
import { resolveDevLinkPath } from './siyuan/link.ts';
import { createTaggedLogger } from './output/log.ts';
import { createBuildSession } from './session.ts';
import type { BuildSession } from './session.ts';
import { describeError, UserError } from './support/errors.ts';

const NAME = 'vite-plugin-siyuan';

/**
 * 从插件上下文读宿主 Vite 主版本；读不到返回 null。
 *
 * 不 `import { version } from 'vite'`：vite 是 peer 依赖，会解析到本包自己那份副本，
 * 在配置模块图里多载入一个 Vite 实例和它的 rolldown 原生 binding。之后任何钩子抛错
 * 都会被 rolldown 降级成 `JavaScript Error / GenericFailure`，真实原因彻底丢失。
 * `meta.viteVersion` 由宿主注入，Vite 8 起才有。
 */
function readViteMajor(meta: { viteVersion?: string } | undefined): number | null {
  const version = meta?.viteVersion;
  if (typeof version !== 'string') return null;
  const major = Number.parseInt(version, 10);
  return Number.isNaN(major) ? null : major;
}

export interface SiYuanOptions {
  /**
   * 构建入口，相对项目根。必填：主题要产出固定名 `theme.css`、插件要产出
   * CJS 单文件 `index.js`，产物名是思源加载机制决定的契约，入口不能靠猜——
   * 猜错不会报错，只会静默产出思源加载不到的东西。
   */
  entry: string;
  /** 被测类型（theme / plugin）；缺省从清单推断。 */
  kind?: Kind | null;
  /**
   * watch 时在项目根建立的开发链接目录名（相对项目根），指向思源安装目录。
   * 缺省 `dev`。它只用于让开发者/IDE 看到实时产物，思源读的是真实目录。
   */
  devDir?: string | null;
}

export default function siyuan(options: SiYuanOptions): Plugin {
  const log = createTaggedLogger(NAME);
  let session: BuildSession | null = null;
  let kind: Kind | null = options.kind ?? null;
  /** config 阶段解析出的安装目录，供 configResolved 的最终值校验使用。 */
  let installDir: string | null = null;

  return {
    name: NAME,
    apply: 'build',

    async config(userConfig) {
      const root = typeof userConfig.root === 'string' ? resolve(userConfig.root) : process.cwd();
      const entry = resolve(root, options.entry);
      if (!existsSync(entry)) {
        throw new UserError(`entry 指向的文件不存在：${entry}（选项值：${options.entry}）`);
      }
      // entry 必填说明用户确实在建思源产物，识别不到类型必须直接报错：
      // 继续构建只会崩在 Vite 的 "Cannot resolve entry module index.html" 上，指错方向。
      // publicDir 在这里还没解析（configResolved 才给），先按用户配置算一遍。
      const publicDir = resolvePublicDir(root, userConfig.publicDir);
      kind ??= detectKind(publicDir);
      const watch = Boolean(userConfig.build?.watch);

      // watch 才需要知道思源装在哪；build 完全不碰宿主，CI 可跑。
      installDir = null;
      if (watch) {
        const spec = kindSpec(kind);
        const name = readName(publicDir, kind);
        const port = await findKernelPort();
        installDir = await resolveInstallDir({
          kind,
          subdir: spec.installSubdir,
          dirEnv: spec.dirEnv,
          name,
          port,
        });
      }
      return applyBuildConfig(userConfig, { kind, watch, entry, installDir, viteMajor: readViteMajor(this.meta) });
    },

    configResolved(resolvedConfig: ResolvedConfig) {
      const root = resolvedConfig.root;
      const outDir = resolve(root, resolvedConfig.build.outDir);
      const publicDir = resolvedConfig.publicDir;
      const watch = resolvedConfig.command === 'build' && Boolean(resolvedConfig.build.watch);
      if (!kind) {
        // 正常情况下 config 阶段已确定类型或抛错；走到这里说明状态异常。
        // 必须抛错：静默产出思源加载不到的东西更难排查。
        throw new UserError('识别不到被测类型：请确认 publicDir 下的 theme.json / plugin.json，或用 kind 选项显式指定');
      }
      // Vite 还会把 config 钩子返回值与用户配置再 merge 一次，之后的插件
      // （尤其 enforce:'post'）仍能覆盖契约键。所以按最终值再查一遍。
      assertResolvedContract(
        { base: resolvedConfig.base, build: resolvedConfig.build as unknown as Record<string, unknown> },
        kind,
        watch,
        installDir
      );
      const devLink = watch ? resolveDevLinkPath(root, options.devDir ?? 'dev', outDir) : null;
      session = createBuildSession(
        { root, outDir, publicDir, watch, devLink },
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
