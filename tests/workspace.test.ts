/**
 * 安装目录解析：工作区来源与歧义判定。
 *
 * 回归重点：`workspace.json` 会保留历史工作区，不能仅凭「登记了多条」就报错；
 * 内核自己报告的 `workspaceDir` 才是唯一正确的安装目标。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserError } from '../src/support/errors.ts';
import { probeWorkspace, resolveInstallDir } from '../src/siyuan/workspace.ts';

const kernel = vi.hoisted(() => ({
  callKernel: vi.fn(),
  readWorkspacePaths: vi.fn(),
}));

vi.mock('../src/siyuan/port.ts', () => ({
  callKernel: kernel.callKernel,
  readWorkspacePaths: kernel.readWorkspacePaths,
}));

const PLUGIN = { kind: 'plugin' as const, subdir: 'plugins', dirEnv: 'SIYUAN_PLUGIN_DIR', name: 'demo' };

let roots: string[] = [];
let originalPluginDir: string | undefined;

/** 造一个含 `data/plugins` 与 `data/themes` 的临时工作区。 */
function makeWorkspace(withData = true): string {
  const root = mkdtempSync(join(tmpdir(), 'siyuan-ws-'));
  roots.push(root);
  if (withData) {
    mkdirSync(join(root, 'data', 'plugins'), { recursive: true });
    mkdirSync(join(root, 'data', 'themes'), { recursive: true });
  }
  return root;
}

beforeEach(() => {
  kernel.callKernel.mockReset();
  kernel.readWorkspacePaths.mockReset();
  kernel.readWorkspacePaths.mockReturnValue([]);
  originalPluginDir = process.env.SIYUAN_PLUGIN_DIR;
  delete process.env.SIYUAN_PLUGIN_DIR;
});

afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots = [];
  if (originalPluginDir === undefined) delete process.env.SIYUAN_PLUGIN_DIR;
  else process.env.SIYUAN_PLUGIN_DIR = originalPluginDir;
});

describe('resolveInstallDir 的环境变量优先级', () => {
  it('设置了安装目录就不探测内核', async () => {
    const dir = join(makeWorkspace(), 'data', 'plugins');
    process.env.SIYUAN_PLUGIN_DIR = dir;

    const result = await resolveInstallDir({ ...PLUGIN, port: 6806 });

    expect(result).toBe(join(dir, 'demo'));
    expect(kernel.callKernel).not.toHaveBeenCalled();
  });

  it('环境变量指向的目录不存在时报可读错误', async () => {
    process.env.SIYUAN_PLUGIN_DIR = join(tmpdir(), 'siyuan-missing-dir-for-test');

    await expect(resolveInstallDir({ ...PLUGIN, port: 6806 })).rejects.toThrow(/指向的目录不存在/);
  });
});

describe('resolveInstallDir 的工作区来源', () => {
  it('优先使用内核自报的 workspaceDir，历史工作区不参与判断', async () => {
    const root = makeWorkspace();
    kernel.readWorkspacePaths.mockReturnValue(['/stale/one', '/stale/two']);
    kernel.callKernel.mockResolvedValueOnce({ code: 0, data: { workspaceDir: root } });

    const result = await resolveInstallDir({ ...PLUGIN, port: 6806 });

    expect(result).toBe(join(root, 'data', 'plugins', 'demo'));
    expect(kernel.callKernel).toHaveBeenCalledWith(6806, '/api/system/getWorkspaceInfo', {}, expect.any(Number));
    expect(kernel.readWorkspacePaths).not.toHaveBeenCalled();
  });

  it('getWorkspaceInfo 不可用时只认 closed === false 的工作区', async () => {
    const closedRoot = makeWorkspace();
    const openRoot = makeWorkspace();
    kernel.callKernel
      .mockResolvedValueOnce({ code: -1, data: null })
      .mockResolvedValueOnce({
        code: 0,
        data: [
          { path: closedRoot, closed: true },
          { path: openRoot, closed: false },
        ],
      });

    const result = await resolveInstallDir({ ...PLUGIN, port: 6806 });

    expect(result).toBe(join(openRoot, 'data', 'plugins', 'demo'));
    expect(kernel.callKernel).toHaveBeenNthCalledWith(2, 6806, '/api/system/getWorkspaces', {}, expect.any(Number));
  });

  it('内核列表为空时退回 workspace.json 的唯一登记项', async () => {
    const root = makeWorkspace();
    kernel.callKernel.mockResolvedValue({ code: -1, data: null });
    kernel.readWorkspacePaths.mockReturnValue([root]);

    const result = await resolveInstallDir({ ...PLUGIN, port: 6806 });

    expect(result).toBe(join(root, 'data', 'plugins', 'demo'));
  });

  it('没有端口时只读 workspace.json', async () => {
    const root = makeWorkspace();
    kernel.readWorkspacePaths.mockReturnValue([root]);

    const result = await resolveInstallDir({ ...PLUGIN, port: null });

    expect(result).toBe(join(root, 'data', 'plugins', 'demo'));
    expect(kernel.callKernel).not.toHaveBeenCalled();
  });

  it('probeWorkspace 报告来源，便于排查', async () => {
    const root = makeWorkspace();
    kernel.callKernel.mockResolvedValueOnce({ code: 0, data: { workspaceDir: root } });

    await expect(probeWorkspace(6806)).resolves.toEqual({ ok: true, root, source: 'kernel-info' });
  });
});

describe('resolveInstallDir 的歧义与缺失', () => {
  it('多个运行中工作区时报错并列出候选', async () => {
    const first = makeWorkspace();
    const second = makeWorkspace();
    kernel.callKernel
      .mockResolvedValueOnce({ code: -1, data: null })
      .mockResolvedValueOnce({
        code: 0,
        data: [
          { path: first, closed: false },
          { path: second, closed: false },
        ],
      });

    const cause = await resolveInstallDir({ ...PLUGIN, port: 6806 }).catch((error: unknown) => error);

    expect(cause).toBeInstanceOf(UserError);
    const message = (cause as Error).message;
    expect(message).toContain('多个正在运行的思源工作区');
    expect(message).toContain(first);
    expect(message).toContain(second);
    expect(message).toContain('SIYUAN_PLUGIN_DIR');
  });

  it('多个已登记但都未运行时给出方向明确的报错', async () => {
    const first = makeWorkspace();
    const second = makeWorkspace();
    kernel.callKernel.mockResolvedValue({ code: -1, data: null });
    kernel.readWorkspacePaths.mockReturnValue([first, second]);

    const cause = await resolveInstallDir({ ...PLUGIN, port: 6806 }).catch((error: unknown) => error);

    expect(cause).toBeInstanceOf(UserError);
    const message = (cause as Error).message;
    expect(message).toContain('多个已登记的思源工作区');
    expect(message).toContain(first);
    expect(message).toContain(second);
    expect(message).toContain('SIYUAN_PLUGIN_DIR');
  });

  it('完全找不到工作区时提示启动思源或设置环境变量', async () => {
    kernel.callKernel.mockResolvedValue({ code: -1, data: null });

    await expect(resolveInstallDir({ ...PLUGIN, port: 6806 })).rejects.toThrow(/找不到思源工作区/);
  });

  it('工作区下没有 data 目录时报错，而不是静默新建', async () => {
    const root = makeWorkspace(false);
    kernel.callKernel.mockResolvedValueOnce({ code: 0, data: { workspaceDir: root } });

    await expect(resolveInstallDir({ ...PLUGIN, port: 6806 })).rejects.toThrow(/没有 data 目录/);
  });
});
