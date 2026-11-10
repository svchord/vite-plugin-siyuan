/**
 * 清单 schema：类型错误必须在构建时就报出来。
 *
 * 思源对这些错误是静默的——`name: 123` 不会报错，只是主题不出现在列表里。
 * 这里专门锁住类型检查。
 */
import { describe, expect, it } from 'vitest';
import { pluginManifestShape, themeManifestShape } from '../src/artifact/manifest-schema.ts';

const THEME = {
  name: 'Test Theme',
  author: 'tester',
  url: 'https://example.com',
  version: '1.0.0',
  modes: ['light', 'dark'],
};

const PLUGIN = {
  name: 'test-plugin',
  author: 'tester',
  url: 'https://example.com',
  version: '1.0.0',
  minAppVersion: '3.1.0',
};

/** 取第一条错误消息。 */
function firstIssue(shape: { safeParse: (data: unknown) => { success: boolean; error?: { issues: Array<{ message: string }> } } }, data: unknown): string {
  const parsed = shape.safeParse(data);
  if (parsed.success) throw new Error('期望校验失败，但通过了');
  return parsed.error!.issues[0]!.message;
}

describe('theme 清单', () => {
  it('合法清单通过', () => {
    expect(themeManifestShape.safeParse(THEME).success).toBe(true);
  });

  it('name 是数字时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, name: 123 })).toContain('必须是字符串');
  });

  it('version 是数字时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, version: 456 })).toContain('必须是字符串');
  });

  it('version 不是 semver 时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, version: 'v1.0.0' })).toContain('semver');
    expect(firstIssue(themeManifestShape, { ...THEME, version: '1.0' })).toContain('semver');
    expect(firstIssue(themeManifestShape, { ...THEME, version: '01.0.0' })).toContain('semver');
    expect(firstIssue(themeManifestShape, { ...THEME, version: '1.0.0-beta' })).toContain('semver');
    expect(firstIssue(themeManifestShape, { ...THEME, version: '1.0.0+build' })).toContain('semver');
  });

  it('超出安全整数范围的版本号也拒绝（正则挡不住，semver.parse 能）', () => {
    // 手写正则挡不住这个版本号，必须交给 semver.parse
    expect(themeManifestShape.safeParse({ ...THEME, version: '999999999999999999999.0.0' }).success).toBe(false);
  });

  it('modes 是字符串时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, modes: 'light' })).toContain('必须是数组');
  });

  it('modes 为空时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, modes: [] })).toContain('非空数组');
  });

  it('modes 含无效值时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, modes: ['light', 'sepia'] })).toContain('light / dark');
  });

  it('缺 author 时报错', () => {
    const { author: _author, ...withoutAuthor } = THEME;
    expect(themeManifestShape.safeParse(withoutAuthor).success).toBe(false);
  });

  it('i18n 对象缺 default 时报错', () => {
    expect(firstIssue(themeManifestShape, { ...THEME, description: { 'zh-CN': 'x' } })).toContain('default');
  });

  it('i18n 对象带 default 时通过', () => {
    expect(themeManifestShape.safeParse({ ...THEME, description: { default: 'x', 'zh-CN': 'y' } }).success).toBe(true);
  });

  it('允许集市额外字段（不 strict）', () => {
    expect(themeManifestShape.safeParse({ ...THEME, icon: 'icon.png', preview: 'preview.png' }).success).toBe(true);
  });
});

describe('plugin 清单', () => {
  it('合法清单通过', () => {
    expect(pluginManifestShape.safeParse(PLUGIN).success).toBe(true);
  });

  it('缺 minAppVersion 时报错', () => {
    const { minAppVersion: _v, ...without } = PLUGIN;
    const parsed = pluginManifestShape.safeParse(without);
    expect(parsed.success).toBe(false);
  });

  it('minAppVersion 不是 semver 时报错', () => {
    expect(firstIssue(pluginManifestShape, { ...PLUGIN, minAppVersion: '3.1' })).toContain('semver');
  });
});
