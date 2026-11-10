/**
 * 日志级别契约：默认只输出用户关心的 info/success/warn/error，
 * 内部过程走 debug，只有 `SIYUAN_DEBUG=1`（兼容旧名 `SYD_DEBUG=1`）时才出现。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTaggedLogger } from '../src/output/log.ts';

/** 只截获 stdout，避免断言依赖终端渲染。 */
function captureStdout(run: () => void): string {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
    chunks.push(String(chunk));
    return true;
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return chunks.join('');
}

afterEach(() => {
  delete process.env['SIYUAN_DEBUG'];
  delete process.env['SYD_DEBUG'];
});

describe('createTaggedLogger', () => {
  it('默认不输出 debug，只输出用户可见的日志', () => {
    const output = captureStdout(() => {
      const log = createTaggedLogger('test');
      log('用户可见', 'success');
      log('内部过程', 'debug');
    });
    expect(output).toContain('用户可见');
    expect(output).not.toContain('内部过程');
  });

  it('SIYUAN_DEBUG=1 时输出 debug', () => {
    process.env['SIYUAN_DEBUG'] = '1';
    const output = captureStdout(() => {
      const log = createTaggedLogger('test');
      log('内部过程', 'debug');
    });
    expect(output).toContain('内部过程');
  });

  it('旧名 SYD_DEBUG=1 仍然生效', () => {
    process.env['SYD_DEBUG'] = '1';
    const output = captureStdout(() => {
      const log = createTaggedLogger('test');
      log('内部过程', 'debug');
    });
    expect(output).toContain('内部过程');
  });

  it('=0 不会被当成开启', () => {
    process.env['SIYUAN_DEBUG'] = '0';
    const output = captureStdout(() => {
      const log = createTaggedLogger('test');
      log('内部过程', 'debug');
    });
    expect(output).not.toContain('内部过程');
  });
});
