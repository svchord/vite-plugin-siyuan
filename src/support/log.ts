/** 日志级别与回调契约（不含输出实现，实现在 output/log.ts）。 */

/**
 * 日志级别。
 *
 * 默认只应使用 info / success / warn / error 输出用户关心的结果与问题；
 * 探测端口、跳过监听、兜底读取这类过程信息走 debug，仅 `SIYUAN_DEBUG=1` 时可见。
 */
export type LogLevel = 'debug' | 'info' | 'success' | 'warn' | 'error';

/** 日志回调。level 可选，缺省按 info 处理。 */
export type Logger = (message: string, level?: LogLevel) => void;
