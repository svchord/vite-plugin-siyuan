/** 环境变量读取：新名优先，兼容旧名。 */

/**
 * 读 `=1` 形式的开关。
 *
 * `legacy` 用于兼容从 siyuan-devtools 带过来的 `SYD_*` 旧名；新名生效后
 * 旧名仍可用，避免已经配好的环境失效。
 */
export function envFlag(primary: string, legacy?: string): boolean {
  if (process.env[primary] === '1') return true;
  return legacy !== undefined && process.env[legacy] === '1';
}
