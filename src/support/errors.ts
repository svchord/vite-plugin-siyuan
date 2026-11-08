/** 错误类型与描述。 */

/** 取错误里带的 code；不是带 code 的错误返回 null。 */
export function errorCode(cause: unknown): string | null {
  if (typeof cause !== 'object' || cause === null || !('code' in cause)) return null;
  const code: unknown = cause.code;
  return typeof code === 'string' ? code : null;
}

/** 错误消息。 */
export function describeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

/**
 * 用户/agent 可见的错误：参数不对、依赖的服务没起、配置没开。
 * 构建日志只打 message，不甩堆栈。
 */
export class UserError extends Error {
  override readonly name = 'UserError';
}
