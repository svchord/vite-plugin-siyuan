/**
 * 校验只扫本次产物目录，不扫项目根。
 *
 * 扫项目根会把 `node_modules/**` 当成产物，报出几百条
 * 「主题产物里出现 JavaScript」。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyTarget } from '../src/artifact/verify.ts';

/** 造一个项目：清单在根，产物目录不存在，但根下有 node_modules。 */
function projectWithNodeModules(): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'vps-verify-'));
  writeFileSync(
    join(dir, 'theme.json'),
    JSON.stringify({ name: 'T', author: 'a', url: 'https://e.com', version: '1.0.0', modes: ['light'] })
  );
  mkdirSync(join(dir, 'node_modules', 'some-dep'), { recursive: true });
  writeFileSync(join(dir, 'node_modules', 'some-dep', 'index.js'), 'module.exports = 1;');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 't', version: '1.0.0' }));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe('verifyTarget 的扫描范围', () => {
  it('产物目录不存在时只报「目录不存在」，不把 node_modules 当产物', () => {
    const project = projectWithNodeModules();
    try {
      const result = verifyTarget('theme', { root: project.dir, publicDir: join(project.dir, 'public'), outDir: './dev' });
      const messages = result.issues.map((issue) => issue.message);

      // 只该报产物目录不存在
      expect(messages.some((message) => message.includes('产物目录不存在'))).toBe(true);
      // 绝不该出现 node_modules 里的 js
      expect(messages.some((message) => message.includes('node_modules'))).toBe(false);
      expect(messages.some((message) => message.includes('主题产物里出现 JavaScript'))).toBe(false);
    } finally {
      project.cleanup();
    }
  });

  it('产物目录存在时只扫该目录', () => {
    const project = projectWithNodeModules();
    try {
      mkdirSync(join(project.dir, 'dev'), { recursive: true });
      writeFileSync(join(project.dir, 'dev', 'theme.css'), '.x{color:red}');
      writeFileSync(join(project.dir, 'dev', 'theme.json'), '{"name":"T","modes":["light"]}');
      // 产物目录里放一个 js：这才应该被报出来
      writeFileSync(join(project.dir, 'dev', 'extra.js'), 'var a = 1;');

      const result = verifyTarget('theme', { root: project.dir, publicDir: join(project.dir, 'public'), outDir: './dev' });
      const messages = result.issues.map((issue) => issue.message);

      expect(messages.some((message) => message.includes('主题产物里出现 JavaScript'))).toBe(true);
      expect(messages.some((message) => message.includes('node_modules'))).toBe(false);
    } finally {
      project.cleanup();
    }
  });
});
