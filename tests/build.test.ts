/**
 * 真实构建的契约：产物名、`base`、资源路径重写。
 *
 * 清单必须写全（name/author/url/version），否则插件收尾的校验会按设计拒绝打包。
 */
import { describe, expect, it } from 'vitest';
import { buildProject } from './fixtures/real-build.ts';

const THEME_MANIFEST = JSON.stringify({
  name: 'Test Theme',
  author: 'tester',
  url: 'https://example.com',
  version: '1.0.0',
  modes: ['light', 'dark'],
});

const THEME_FILES = {
  'public/theme.json': THEME_MANIFEST,
  'src/main.css': '.x{background:url(./img/a.woff2)}',
  'src/img/a.woff2': 'x'.repeat(2000),
};

describe('theme 构建', () => {
  it('产出 theme.css，其余资源归 assets/', async () => {
    const project = await buildProject(THEME_FILES);
    try {
      const { files } = await project.build({ noInline: true });
      expect(files).toContain('theme.css');
      expect(files.some((file) => file.startsWith('assets/'))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('base 为相对路径，字体在宿主下不会 404', async () => {
    const project = await buildProject(THEME_FILES);
    try {
      const { css } = await project.build({ noInline: true });
      expect(css).not.toBeNull();
      expect(css).not.toMatch(/url\(\/assets\//);
    } finally {
      project.cleanup();
    }
  });

  it('产物里出现 package.zip（非 watch 构建收尾打包）', async () => {
    const project = await buildProject(THEME_FILES);
    try {
      await project.build();
      const { readdirSync } = await import('node:fs');
      const names = readdirSync(project.dir);
      expect(names).toContain('package.zip');
    } finally {
      project.cleanup();
    }
  });
});

describe('plugin 构建', () => {
  it('lib cjs 产出 index.js 与 index.css', async () => {
    const project = await buildProject({
      'public/plugin.json': JSON.stringify({
        name: 'test-plugin',
        author: 'tester',
        url: 'https://example.com',
        version: '1.0.0',
        minAppVersion: '3.1.0',
      }),
      'src/index.ts': "import './index.css';\nexport default class TestPlugin { constructor() {} }",
      'src/index.css': '.p{color:red}',
    });
    try {
      const { files } = await project.build({ kind: 'plugin', entry: 'src/index.ts' });
      expect(files).toContain('index.js');
      expect(files).toContain('index.css');
    } finally {
      project.cleanup();
    }
  });
});
