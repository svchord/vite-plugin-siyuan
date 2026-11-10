/**
 * 让思源用上构建产物：切换主题 / 启用插件 / 广播整页刷新。
 *
 * 产物一变就统一广播整页刷新：主题 CSS、插件 CSS、插件 JS 三种产物的加载
 * 机制不同，整页刷新让思源自己重新走一遍启动流程，三种产物一并拿到磁盘真值。
 */
import { TIMING } from '../support/timing.ts';
import type { Kind } from './kinds.ts';
import { callKernel } from './port.ts';

interface AppearanceConfig {
  themeLight?: string;
  themeDark?: string;
}

interface SystemConf {
  conf?: {
    appearance?: AppearanceConfig;
  };
}

/** `/api/bazaar/getInstalledPlugin` 的响应：只用到启用状态。 */
interface InstalledPackages {
  packages?: Array<{ name?: string; enabled?: boolean }>;
}

/** 让思源选中指定主题（明暗都设成它）；已经是它时不动，避免无谓重载。 */
async function selectTheme(port: number, themeName: string): Promise<{ ok: boolean; changed: boolean; reason: string | null }> {
  const conf = await callKernel<SystemConf>(port, '/api/system/getConf');
  const appearance = conf.data?.conf?.appearance;
  if (!appearance) return { ok: false, changed: false, reason: '读不到思源配置（appearance）' };
  if (appearance.themeLight === themeName && appearance.themeDark === themeName) {
    return { ok: true, changed: false, reason: null };
  }
  const result = await callKernel(port, '/api/setting/setAppearance', {
    themeLight: themeName,
    themeDark: themeName,
  });
  if (result.code !== 0) return { ok: false, changed: false, reason: `切换主题失败：${result.msg || '未知错误'}` };
  return { ok: true, changed: true, reason: null };
}

/**
 * 读插件当前的启用状态。
 *
 * 必须用 `getInstalledPlugin` 的 `enabled`：`conf.petal` 在 3.8.x 不存在
 * （conf.json 也不存），读它只会得到恒 false 的 `wasEnabled`，每次误判成「刚启用」
 * 并白广播一次整页刷新。`enabled` 随 `setPetalEnabled` 实时变化。
 *
 * 读失败返回 null 而不是 false：宁可多广播一次刷新，也不要让日志把状态说反。
 */
async function isPluginEnabled(port: number, pluginName: string): Promise<boolean | null> {
  try {
    const result = await callKernel<InstalledPackages>(
      port,
      '/api/bazaar/getInstalledPlugin',
      { frontend: 'desktop' },
      TIMING.kernelReloadTimeout
    );
    const found = result.data?.packages?.find((item) => item.name === pluginName);
    return typeof found?.enabled === 'boolean' ? found.enabled : null;
  } catch {
    return null;
  }
}

/**
 * 让思源启用指定插件。首次写入插件目录后，思源配置里还没有「启用」这条记录，
 * 不调这一步页面刷新多少次都不会加载它。
 *
 * **始终启用，包括用户手动禁用过的插件**：watch 是开发流程，插件不加载就看不到
 * 任何改动，会被误判成热重载坏了。但覆盖了用户的禁用意图，所以 `wasEnabled`
 * 一路带回报告层，让日志能明说是「原本被禁用、已自动启用」而不是含糊的「已启用」。
 *
 * `setPetalEnabled` 幂等、不回报「原本是否启用」，所以先读一次启用状态。
 * 这个 changed 决定要不要广播一次刷新：漏了它，第一次启用的插件永远不加载。
 */
async function enablePlugin(
  port: number,
  pluginName: string
): Promise<{ ok: boolean; changed: boolean; wasEnabled: boolean | null; reason: string | null }> {
  const wasEnabled = await isPluginEnabled(port, pluginName);
  const result = await callKernel(port, '/api/petal/setPetalEnabled', { packageName: pluginName, enabled: true }, TIMING.kernelReloadTimeout);
  if (result.code !== 0) return { ok: false, changed: false, wasEnabled, reason: `启用插件失败：${result.msg || '未知错误'}` };
  // 读不到现状时按「变了」处理：多刷一次是无害的，漏刷会让插件一直不加载。
  return { ok: true, changed: wasEnabled !== true, wasEnabled, reason: null };
}

/** 按类型激活；返回是否真的改变了宿主状态（变了才需要补一次刷新）。 */
export async function activate(kind: Kind, port: number, name: string): Promise<{ ok: boolean; changed: boolean; message: string }> {
  if (kind === 'theme') {
    const selected = await selectTheme(port, name);
    if (!selected.ok) return { ok: false, changed: false, message: selected.reason ?? '切换主题失败' };
    return { ok: true, changed: selected.changed, message: selected.changed ? `已切换到：${name}` : `思源已选中：${name}` };
  }
  const enabled = await enablePlugin(port, name);
  if (!enabled.ok) return { ok: false, changed: false, message: enabled.reason ?? '启用插件失败' };
  // 禁用是用户的明确意图，被自动改回来必须让他看见，不能混在「已启用」里。
  const message =
    enabled.wasEnabled === true
      ? `插件已是启用状态：${name}`
      : enabled.wasEnabled === false
        ? `插件原本被禁用，已自动启用：${name}`
        : `插件已启用：${name}`;
  return { ok: true, changed: enabled.changed, message };
}

/** 广播整页刷新。返回是否成功（code === 0）。 */
export async function reloadUI(port: number): Promise<boolean> {
  const result = await callKernel(port, '/api/ui/reloadUI', {}, TIMING.kernelReloadTimeout);
  return result.code === 0;
}
