/** 日志级别与回调契约（不含输出实现，实现在 output/log.ts）。 */

/** 日志级别。 */
export type LogLevel = 'info' | 'success' | 'warn' | 'error';

/** 日志回调。level 可选，缺省按 info 处理。 */
export type Logger = (message: string, level?: LogLevel) => void;
