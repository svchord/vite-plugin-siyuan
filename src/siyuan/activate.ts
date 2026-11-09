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
    petal?: Record<string, { enabled?: boolean } | boolean>;
  };
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

function petalEnabled(entry: { enabled?: boolean } | boolean | undefined): boolean {
  return typeof entry === 'boolean' ? entry : entry?.enabled === true;
}

/**
 * 让思源启用指定插件。首次写入插件目录后，思源配置里还没有「启用」这条记录，
 * 不调这一步页面刷新多少次都不会加载它。
 *
 * `setPetalEnabled` 幂等、不回报「原本是否启用」，所以先读 conf.petal。
 * 这个 changed 决定要不要广播一次刷新：漏了它，第一次启用的插件永远不加载。
 */
async function enablePlugin(port: number, pluginName: string): Promise<{ ok: boolean; changed: boolean; reason: string | null }> {
  const conf = await callKernel<SystemConf>(port, '/api/system/getConf', {}, TIMING.kernelReloadTimeout);
  const wasEnabled = petalEnabled(conf.data?.conf?.petal?.[pluginName]);
  const result = await callKernel(port, '/api/petal/setPetalEnabled', { packageName: pluginName, enabled: true }, TIMING.kernelReloadTimeout);
  if (result.code !== 0) return { ok: false, changed: false, reason: `启用插件失败：${result.msg || '未知错误'}` };
  return { ok: true, changed: !wasEnabled, reason: null };
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
  return { ok: true, changed: enabled.changed, message: enabled.changed ? `插件已启用：${name}` : `插件已是启用状态：${name}` };
}

/** 广播整页刷新。返回是否成功（code === 0）。 */
export async function reloadUI(port: number): Promise<boolean> {
  const result = await callKernel(port, '/api/ui/reloadUI', {}, TIMING.kernelReloadTimeout);
  return result.code === 0;
}
