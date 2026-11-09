/**
 * 构建会话编排：链接 → 激活 → 刷新 → 校验 → 打包 → 汇报。
 *
 * 会话在首次产物落盘后才建（懒启动），避免 `vite build` 去连思源。
 */
import { relative, resolve } from 'node:path';
import { activate, reloadUI } from './siyuan/activate.ts';
import { copyReadmes, pruneOutDir, watchPublicFiles } from './artifact/assets.ts';
import { ensureDevLink } from './siyuan/link.ts';
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
  /** 产物目录（绝对路径）。watch 时就是思源安装目录。 */
  outDir: string;
  /** public 目录的绝对路径；未配置时为空串。 */
  publicDir: string;
  /** 是否 watch 构建。 */
  watch: boolean;
  /** watch 时项目根下开发链接的绝对路径；build 时为 null。 */
  devLink: string | null;
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
  /** 开发链接：首轮新建要报给用户，复用则只对排查有用。 */
  devLink: { link: string; target: string; changed: boolean };
  activation: { ok: boolean; message: string };
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
  let failed = false;
  let wrote = false;
  let signaled = false;
  let pendingTimer: NodeJS.Timeout | null = null;
  let pendingFiles: string[] = [];
  let chain: Promise<void> = Promise.resolve();

  /** 建会话：找端口 → 解析安装目录 → 建开发链接 → 激活。失败抛可读错误。 */
  async function start(): Promise<Ready> {
    const current = facts;
    const name = readName(current.publicDir, kind);
    const port = await findKernelPort();
    // 产物目录就是安装目录；这里再解析一次仅为兜底（config 阶段已解析过）。
    const installPath = await resolveInstallDir({
      kind,
      subdir: spec.installSubdir,
      dirEnv: spec.dirEnv,
      name,
      port,
    });

    if (current.devLink === null) {
      throw new UserError('内部错误：watch 会话缺少 devLink 路径');
    }
    const devLink = ensureDevLink(current.devLink, installPath);
    if (!devLink.ok) throw new UserError(devLink.reason ?? '建立开发链接失败');

    const activation = await activate(kind, port, name);
    if (!activation.ok) throw new UserError(activation.message);

    // 首次启用插件必须补一次刷新：思源配置刚变，不刷新页面不会加载它。
    // 成功是预期结果，不单独占一行；失败才需要提醒用户手动刷新。
    const firstReload = activation.changed
      ? { ok: await reloadUI(port), message: '刷新广播失败，请手动刷新思源窗口' }
      : null;

    return {
      port,
      devLink: { link: current.devLink, target: installPath, changed: devLink.changed },
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
      // 每次保存都成功刷新是正常工作过程，不刷屏；失败必须让用户看到。
      log(ok ? `页面已刷新：${matched[0]}` : `刷新未生效：${matched[0]}`, ok ? 'debug' : 'warn');
    });
  }

  return {
    /** 构建开始：把 public/** 逐个交给构建器登记监听。 */
    onStart(registerWatchFile: (file: string) => void): void {
      // 每轮开始重置状态：上一轮失败不能污染下一轮的成功信号。
      buildCount += 1;
      failed = false;
      wrote = false;
      signaled = false;
      watchPublicFiles(facts.publicDir, registerWatchFile, log);
    },

    /** 产物写完。 */
    async onWritten(files: string[]): Promise<void> {
      const current = facts;
      wrote = true;
      // 元数据搬运先做：校验时文件必须已经就位。
      let readmeNames: string[] = [];
      try {
        readmeNames = copyReadmes({
          root: current.root,
          publicDir: current.publicDir,
          outDir: relative(current.root, current.outDir) || '.',
          manifestName: spec.manifestName,
          watch: current.watch,
          log,
        });
      } catch (cause) {
        failed = true;
        throw cause;
      }
      // watch 的 emptyOutDir 必须是 false，旧产物不会自己消失，这里补一次修剪。
      if (current.watch) {
        try {
          pruneOutDir({
            outDir: current.outDir,
            bundleFiles: files,
            publicDir: current.publicDir,
            readmeNames,
            log,
          });
        } catch (cause) {
          // 清理失败不该中断开发：留到下一轮再试。
          log(`清理旧产物失败：${describeError(cause)}`, 'debug');
        }
      }
      if (!current.watch) return;

      // 会话还没起来：启动它，本轮不通知重载。
      // 这一条同时覆盖「首轮构建」与「上次启动失败后重试」。
      if (!ready) {
        try {
          await ensure();
        } catch (cause) {
          failed = true;
          // UserError 已经是可读文案（安装目录不存在、多个工作区…），
          // 再套一层「思源在运行」会把权限问题误指成思源没启动。
          if (cause instanceof UserError) throw cause;
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
      // 构建在 writeBundle 之前就失败，或 writeBundle 已经失败：跳过校验/打包，
      // 否则「产物目录不存在」会盖住真正的构建错误。
      if (!wrote || failed) {
        failed = true;
        return;
      }
      const result = verifyTarget(kind, {
        root: current.root,
        publicDir: current.publicDir,
        outDir: current.outDir,
      });
      if (!result.ok) {
        const text = formatIssues(result.issues);
        if (current.watch) {
          // 开发中中断会让 watch 退出，得手动重开，代价太大。
          failed = true;
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
      // Vite 在构建失败时可能多次触发 closeBundle；每轮只发一次完成信号。
      if (signaled) return;
      signaled = true;
      if (current.watch && ready && !reported && !failed) {
        reported = true;
        // 会话汇报整体放在这里，而不是建会话时逐条打：建会话发生在 writeBundle，
        // 紧接着 Vite 还要打印产物清单与 built in，插件日志会被夹在中间割成两截。
        // 收拢到 closeBundle 之后，用户看到的是「Vite 汇报完 → 插件汇报」的完整两块。
        log(`已链接：${ready.devLink.link} → ${ready.devLink.target}`, ready.devLink.changed ? 'success' : 'debug');
        // 激活的成功路径已由上面的 message 体现，这里不再重复；刷新失败才需要处理。
        log(ready.activation.message, 'success');
        if (ready.firstReload && !ready.firstReload.ok) log(ready.firstReload.message, 'warn');
        log('会话就绪，改源码会自动刷新页面', 'success');
        logPreviewLinks(previewLogger, ready.port);
      }

      // agent 的构建完成信号：纯文本、序号递增，便于从 stdout 里认。
      // watch 首轮不打印：此时「会话就绪 + 预览入口」已经说明可以开始了，
      // 只有后续热重载才需要这个信号。失败仍然要打印。
      const files = current.watch ? 'watch' : PACKAGE_NAME;
      if (!wrote || failed) {
        console.log(`[vite-plugin-siyuan] build #${buildCount} failed · ${kind} · ${files}`);
        return;
      }
      if (current.watch && buildCount === 1) return;
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
