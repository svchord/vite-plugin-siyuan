/**
 * 激活的启用状态判断。
 *
 * 启用状态必须来自 `/api/bazaar/getInstalledPlugin` 的 `enabled` 字段：
 * 思源 3.8.x 的 `getConf` 响应没有 `conf.petal`，据此判断会让 `changed` 恒为 true，
 * 日志误报「插件已启用」并每轮白广播整页刷新。
 */
import { describe, expect, it, vi } from 'vitest';
import { activate, reloadUI } from '../src/siyuan/activate.ts';

const kernel = vi.hoisted(() => ({ callKernel: vi.fn() }));

vi.mock('../src/siyuan/port.ts', () => ({ callKernel: kernel.callKernel }));

/** 让 getConf 返回**没有 petal 键**的真实形状（3.8.x）。 */
function confWithoutPetal() {
  return { code: 0, data: { conf: { appearance: { themeLight: '', themeDark: '' } } } };
}

/** 已安装插件列表；enabled 就是 bazaar 报的真实启用状态。 */
function installed(entries: Array<{ name: string; enabled: boolean }>) {
  return { code: 0, data: { packages: entries } };
}

function routes(handlers: Record<string, () => unknown>) {
  kernel.callKernel.mockImplementation((_port: number, path: string) => {
    const handler = handlers[path];
    if (!handler) return Promise.resolve({ code: 0, data: null });
    return Promise.resolve(handler());
  });
}

describe('activate plugin', () => {
  it('插件已启用时报告 changed=false，不额外广播刷新', async () => {
    routes({
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'demo', enabled: true }]),
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    expect(result.ok).toBe(true);
    expect(result.changed).toBe(false);
    expect(result.message).toBe('插件已是启用状态：demo');
  });

  it('插件未启用时报告 changed=true，需要补一次刷新', async () => {
    routes({
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'demo', enabled: false }]),
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    expect(result.changed).toBe(true);
    expect(result.message).toBe('插件原本被禁用，已自动启用：demo');
  });

  it('列表里没有该插件（首次写入）按未启用处理', async () => {
    routes({
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'other', enabled: true }]),
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    expect(result.changed).toBe(true);
    expect(result.message).toBe('插件已启用：demo');
  });

  it('用户手动禁用的插件会被自动重新启用，且日志明示这件事', async () => {
    routes({
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'demo', enabled: false }]),
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    // 覆盖用户禁用是既定行为（watch 不启用就什么都看不到），但必须能看出来。
    expect(result.message).toContain('原本被禁用');
    expect(result.message).toContain('自动启用');
    const setCall = kernel.callKernel.mock.calls.find((call) => call[1] === '/api/petal/setPetalEnabled');
    expect(setCall?.[2]).toEqual({ packageName: 'demo', enabled: true });
  });

  it('读不到启用状态时按「变了」处理：多刷一次好过漏刷', async () => {
    routes({
      // 模拟接口不可用：`isPluginEnabled` 会吞掉异常返回 null，changed 必须按 true 处理。
      '/api/bazaar/getInstalledPlugin': () => {
        throw new Error('kernel 没这个接口');
      },
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    expect(result.changed).toBe(true);
    expect(result.message).toBe('插件已启用：demo');
  });

  it('用 bazaar 的已安装列表判断状态', async () => {
    routes({
      '/api/system/getConf': () => confWithoutPetal(),
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'demo', enabled: true }]),
      '/api/petal/setPetalEnabled': () => ({ code: 0, data: null }),
    });

    await activate('plugin', 6806, 'demo');

    const paths = kernel.callKernel.mock.calls.map((call) => call[1]);
    expect(paths).toContain('/api/bazaar/getInstalledPlugin');
    expect(paths).not.toContain('/api/system/getConf');
  });

  it('setPetalEnabled 失败时报可读错误，不谎报成功', async () => {
    routes({
      '/api/bazaar/getInstalledPlugin': () => installed([{ name: 'demo', enabled: false }]),
      '/api/petal/setPetalEnabled': () => ({ code: -1, msg: '权限不足', data: null }),
    });

    const result = await activate('plugin', 6806, 'demo');

    expect(result.ok).toBe(false);
    expect(result.message).toContain('权限不足');
  });
});

describe('activate theme', () => {
  it('已是当前主题时 changed=false', async () => {
    routes({
      '/api/system/getConf': () => ({
        code: 0,
        data: { conf: { appearance: { themeLight: 'demo', themeDark: 'demo' } } },
      }),
    });

    await expect(activate('theme', 6806, 'demo')).resolves.toMatchObject({ changed: false });
  });

  it('切换主题成功时 changed=true', async () => {
    routes({
      '/api/system/getConf': () => ({
        code: 0,
        data: { conf: { appearance: { themeLight: 'other', themeDark: 'other' } } },
      }),
      '/api/setting/setAppearance': () => ({ code: 0, data: null }),
    });

    await expect(activate('theme', 6806, 'demo')).resolves.toMatchObject({
      changed: true,
      message: '已切换到：demo',
    });
  });
});

describe('reloadUI', () => {
  it('code 为 0 才算成功', async () => {
    kernel.callKernel.mockResolvedValueOnce({ code: 0, data: null });
    await expect(reloadUI(6806)).resolves.toBe(true);
    kernel.callKernel.mockResolvedValueOnce({ code: -1, data: null });
    await expect(reloadUI(6806)).resolves.toBe(false);
  });
});
