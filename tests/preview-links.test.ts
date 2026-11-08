/**
 * 预览入口的排版：标题 + 每个前端一行，端口单独加粗。
 */
import { describe, expect, it } from 'vitest';
import { formatPreviewLinks } from '../src/output/preview-links.ts';

/** 恒等调色板：断言纯文本结构，不依赖终端是否着色。 */
const plain = {
  green: (text: string) => text,
  bold: (text: string) => text,
  cyan: (text: string) => text,
};

describe('formatPreviewLinks', () => {
  it('第一行是标题，之后每个前端一行', () => {
    const lines = formatPreviewLinks(6806, plain);
    expect(lines[0]).toBe('开发预览');
    expect(lines).toHaveLength(3);
  });

  it('桌面端与移动端都给出稳定地址（不带随机参数）', () => {
    const lines = formatPreviewLinks(6806, plain);
    expect(lines[1]).toContain('桌面端');
    expect(lines[1]).toContain('http://127.0.0.1:6806/stage/build/desktop/');
    expect(lines[2]).toContain('移动端');
    expect(lines[2]).toContain('http://127.0.0.1:6806/stage/build/mobile/');
    expect(lines.join('\n')).not.toContain('?r=');
  });

  it('打印真实端口，多实例时不误导', () => {
    const lines = formatPreviewLinks(6808, plain);
    expect(lines[1]).toContain(':6808/');
  });

  it('端口单独交给 bold 处理', () => {
    const calls: string[] = [];
    const tracking = {
      green: (text: string) => text,
      cyan: (text: string) => text,
      bold: (text: string) => {
        calls.push(text);
        return text;
      },
    };
    formatPreviewLinks(6806, tracking);
    // 端口号 + 两个端名
    expect(calls).toContain('6806');
    expect(calls).toContain('桌面端');
    expect(calls).toContain('移动端');
  });
});
