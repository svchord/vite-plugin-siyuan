/** 环境变量读取。 */

/**
 * 读 `=1` 形式的开关。
 *
 * `legacy` 也必须识别：已有环境只配置 `SYD_*`，不能因此失效。
 */
export function envFlag(primary: string, legacy?: string): boolean {
  if (process.env[primary] === '1') return true;
  return legacy !== undefined && process.env[legacy] === '1';
}
