/** 等待时长与超时的唯一来源。 */

export const TIMING = {
  /** 合并窗口：一次构建常同时写多个文件。 */
  batchMs: 250,
  /** reloadUI 广播的超时。 */
  kernelReloadTimeout: 10000,
  /** UAC 提权弹窗等待上限。 */
  uacPromptTimeout: 120000,
  /** kernel 端口探测超时。 */
  kernelProbe: 1500,
  /** 问工作区信息 / 工作区列表的超时。 */
  workspacesProbe: 3000,
} as const;
