/**
 * 日志：consola 带 tag 前缀，保留级别图标与配色。
 *
 * 用 `compact: false` 让多行消息保持原样——预览入口那块靠它维持缩进。
 * `SYD_DEBUG=1` 时降到 debug 级别；用精确比较而不是 truthiness：
 * `SYD_DEBUG=0` 在 shell 里很常见，truthiness 会把它读成「开」。
 */
import { createConsola } from 'consola';
import type { LogLevel } from '../support/log.ts';

/** 预览入口的排版日志：只需要 info 一个方法。 */
export interface PreviewLogger {
  info: (message: string) => void;
}

/** 同时满足文本日志与预览排版两种用法。 */
export interface TaggedLogger {
  (message: string, level?: LogLevel): void;
  info: (message: string) => void;
}

export function createTaggedLogger(tag: string): TaggedLogger {
  const logger = createConsola({
    level: process.env.SYD_DEBUG === '1' ? 5 : 3,
    formatOptions: { compact: false },
  }).withTag(tag);

  const log = (message: string, level: LogLevel = 'info'): void => {
    switch (level) {
      case 'success':
        logger.success(message);
        break;
      case 'warn':
        logger.warn(message);
        break;
      case 'error':
        logger.error(message);
        break;
      default:
        logger.info(message);
    }
  };

  // 预览排版只用到 info：consola 的 log 级别既没有图标也不带 tag 前缀。
  return Object.assign(log, { info: (message: string) => logger.info(message) });
}
