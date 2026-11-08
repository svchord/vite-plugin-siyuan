/**
 * 构建会话编排：链接 → 激活 → 刷新 → 校验 → 打包 → 汇报。
 *
 * 会话在首次产物落盘后才建（懒启动），避免 `vite build` 去连思源。
 */
import { relative, resolve } from 'node:path';
import { activate, reloadUI } from './siyuan/activate.ts';
import { copyReadmes, watchPublicFiles } from './artifact/assets.ts';
import { checkLinkedFiles, ensureLink } from './siyuan/link.ts';
import { kindSpec, readName } from './siyuan/kinds.ts';
import type { Kind } from './siyuan/kinds.ts';
import type { PreviewLogger } from './output/log.ts';
import { findKernelPort } from './siyuan/port.ts';
import { logPreviewLinks } from './output/preview-links.ts';
import { describeError, UserError } from './support/errors.ts';
import { TIMING } from './support/timing.ts';
import type { Logger } from './support/log.ts';
import { formatIssues, verifyTarget } from './artifact/verify.ts';
import { resolveInstallDir } from './siyuan/workspace.ts';
import { PACKAGE_NAME, writeZip } from './artifact/zip.ts';

/** 构建器归一化后的构建事实。 */
export interface BuildFacts {
  /** 项目根目录（绝对路径）。 */
  root: string;
  /** 产物目录（绝对路径）。 */
  outDir: string;
  /** public 目录的绝对路径；未配置时为空串。 */
  publicDir: string;
  /** 是否 watch 构建。 */
  watch: boolean;
}

export interface SessionOptions {
  /** 被测类型。 */
  kind: Kind;
  log: Logger;
  /** 预览入口排版用的 logger（需要 tag 与 info 图标）。 */
  previewLogger: PreviewLogger;
}

/** 会话内部的就绪状态。 */
interface Ready {
  port: number;
  name: string;
  linkedPath: string | null;
  missingFiles: string[];
  activation: { ok: boolean; message: string } | null;
  firstReload: { ok: boolean; message: string } | null;
}

/**
 * 造一个构建会话。所有可变状态在闭包里。
 *
 * 生命周期：
 *   onStart       把 public/** 登记为监听文件
 *   onWritten     首次建会话（链接 + 激活）；之后搬元数据 + 合并刷新
 *   onFinished    校验 + 打包（生产构建失败抛错）
 *   onEnd         打印会话汇报与预览入口（只一次）
 *   onClose       释放定时器
 */
export function createBuildSession(facts: BuildFacts, options: SessionOptions) {
  const { kind, log, previewLogger } = options;
  const spec = kindSpec(kind);
  let ready: Ready | null = null;
  let starting: Promise<Ready> | null = null;
  let reported = false;
  let buildCount = 0;
  let pendingTimer: NodeJS.Timeout | null = null;
  let pendingFiles: string[] = [];
  let chain: Promise<void> = Promise.resolve();

  /** 建会话：找端口 → 解析安装目录 → 链接 → 激活。失败抛可读错误。 */
  async function start(): Promise<Ready> {
    const current = facts;
    const name = readName(current.root, kind);
    const port = await findKernelPort();
    const installPath = await resolveInstallDir({
      kind,
      subdir: spec.installSubdir,
      dirEnv: spec.dirEnv,
      name,
      port,
    });

    const link = ensureLink(current.outDir, installPath, { requireSymlink: spec.requireSymlink });
    if (!link.ok) throw new UserError(link.reason ?? '建立链接失败');
    if (link.changed) log(`已链接：${installPath}`, 'success');
    const missing = checkLinkedFiles(installPath, spec.expectedFiles);
    if (missing.length) log(`链接目录缺少 ${missing.join('、')}，构建完成后会补齐`, 'warn');

    const activation = await activate(kind, port, name);
    if (!activation.ok) throw new UserError(activation.message);

    // 首次启用插件必须补一次刷新：思源配置刚变，不刷新页面不会加载它。
    const firstReload = activation.changed ? { ok: await reloadUI(port), message: '' } : null;
    if (firstReload) {
      firstReload.message = firstReload.ok ? '已广播刷新，思源正在加载' : '刷新广播失败，请手动刷新思源窗口';
      log(firstReload.message, firstReload.ok ? 'success' : 'warn');
    }

    return {
      port,
      name,
      linkedPath: link.ok ? installPath : null,
      missingFiles: missing,
      activation: { ok: activation.ok, message: activation.message },
      firstReload,
    };
  }

  function ensure(): Promise<Ready> {
    if (ready) return Promise.resolve(ready);
    if (starting) return starting;
    starting = start()
      .then((value) => {
        ready = value;
        return value;
      })
      .finally(() => {
        starting = null;
      });
    return starting;
  }

  /** 一批变更合并成一次刷新，且刷新串行。 */
  function flush(): void {
    const files = pendingFiles;
    pendingFiles = [];
    if (!files.length) return;
    const matched = files.filter((file) => spec.matchArtifact(file));
    if (!matched.length) return;
    chain = chain.then(async () => {
      if (!ready) return;
      const ok = await reloadUI(ready.port);
      log(ok ? `页面已刷新：${matched[0]}` : `刷新未生效：${matched[0]}`, ok ? 'success' : 'warn');
    });
  }

  return {
    /** 构建开始：把 public/** 逐个交给构建器登记监听。 */
    onStart(registerWatchFile: (file: string) => void): void {
      watchPublicFiles(facts.publicDir, registerWatchFile, log);
    },

    /** 产物写完。 */
    async onWritten(files: string[]): Promise<void> {
      const current = facts;
      // 元数据搬运先做：校验时文件必须已经就位。
      copyReadmes({
        root: current.root,
        publicDir: current.publicDir,
        outDir: relative(current.root, current.outDir) || '.',
        manifestName: spec.manifestName,
        watch: current.watch,
        log,
      });
      if (!current.watch) return;

      // 会话还没起来：启动它，本轮不通知重载。
      // 这一条同时覆盖「首轮构建」与「上次启动失败后重试」。
      if (!ready) {
        try {
          await ensure();
        } catch (cause) {
          throw new UserError(`watch 模式需要思源在运行：${describeError(cause)}`);
        }
        return;
      }

      pendingFiles.push(...files);
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        flush();
      }, TIMING.batchMs);
    },

    /** 一轮结束：校验 + 打包。 */
    onFinished(): void {
      const current = facts;
      buildCount += 1;
      const result = verifyTarget(kind, { root: current.root, outDir: current.outDir });
      if (!result.ok) {
        const text = formatIssues(result.issues);
        if (current.watch) {
          // 开发中中断会让 watch 退出，得手动重开，代价太大。
          log(`产物校验未通过，开发模式仅提示：\n${text}`, 'warn');
        } else {
          throw new Error(`产物校验未通过：\n${text}`);
        }
      }
      if (current.watch) return;

      const outFile = resolve(current.root, PACKAGE_NAME);
      const packed = writeZip(current.outDir, outFile);
      log(`已打包：${PACKAGE_NAME}，${packed.files} 个文件，${packed.bytes} 字节`, 'success');
    },

    /** 本轮最后：打印会话汇报与预览入口（只一次），再打构建完成日志。 */
    onEnd(): void {
      const current = facts;
      if (current.watch && ready && !reported) {
        reported = true;
        log(`已链接到思源 ${ready.linkedPath}`, 'success');
        if (ready.missingFiles.length) log(`链接目录缺少 ${ready.missingFiles.join('、')}`, 'warn');
        if (ready.activation) log(ready.activation.message, ready.activation.ok ? 'success' : 'error');
        if (ready.firstReload) log(ready.firstReload.message, ready.firstReload.ok ? 'success' : 'warn');
        log('会话就绪，改源码会自动刷新页面', 'success');
        logPreviewLinks(previewLogger, ready.port);
      }

      // agent 的构建完成信号：纯文本、序号递增，便于从 stdout 里认。
      const files = current.watch ? 'watch' : PACKAGE_NAME;
      console.log(`[vite-plugin-siyuan] build #${buildCount} ready · ${kind} · ${files}`);
    },

    /** 释放定时器（幂等）。 */
    async onClose(): Promise<void> {
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
      pendingFiles = [];
      await chain;
    },
  };
}

/** 会话类型，供插件入口使用。 */
export type BuildSession = ReturnType<typeof createBuildSession>;
