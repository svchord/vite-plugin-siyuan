/**
 * kernel 端口发现：PID 匹配与配置目录候选。
 *
 * 两个回归点：
 *  1. `pickKernelPid` 必须从进程名里认出 kernel（Windows 带 .exe，POSIX 不带）。
 *  2. `~/.config/siyuan` 不是 Linux 专有：Windows 上的 port.json 也可能在这里，
 *     所有平台都必须探测它。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickKernelPid, portMapCandidates } from '../src/siyuan/port.ts';

describe('pickKernelPid', () => {
  it('认出 Windows 的 SiYuan-Kernel.exe', () => {
    expect(pickKernelPid([{ pid: 42316, name: 'SiYuan-Kernel.exe' }])).toBe(42316);
  });

  it('认出 POSIX 的 SiYuan-Kernel', () => {
    expect(pickKernelPid([{ pid: 999, name: 'SiYuan-Kernel' }])).toBe(999);
  });

  it('大小写不敏感', () => {
    expect(pickKernelPid([{ pid: 7, name: 'siyuan-kernel' }])).toBe(7);
  });

  it('跳过其它进程', () => {
    const processes = [
      { pid: 1, name: 'SiYuan.exe' },
      { pid: 2, name: 'code.exe' },
      { pid: 3, name: 'SiYuan-Kernel.exe' },
    ];
    expect(pickKernelPid(processes)).toBe(3);
  });

  it('没有 kernel 进程时返回 null', () => {
    expect(pickKernelPid([{ pid: 1, name: 'node.exe' }])).toBeNull();
    expect(pickKernelPid([])).toBeNull();
  });

  it('多个 kernel 时取第一个（多实例由调用方报错，不在这里猜）', () => {
    const processes = [
      { pid: 10, name: 'SiYuan-Kernel.exe' },
      { pid: 20, name: 'SiYuan-Kernel.exe' },
    ];
    expect(pickKernelPid(processes)).toBe(10);
  });
});

describe('配置目录候选', () => {
  it('~/.config/siyuan/port.json 必须在候选里（所有平台）', () => {
    // Windows 上 port.json 也可能落在 ~/.config/siyuan；只查 %APPDATA% 会漏掉。
    const candidates = portMapCandidates();
    expect(candidates).toContain(join(homedir(), '.config', 'siyuan', 'port.json'));
  });

  it('候选都是 port.json 结尾', () => {
    for (const candidate of portMapCandidates()) expect(candidate.endsWith('port.json')).toBe(true);
  });
});
