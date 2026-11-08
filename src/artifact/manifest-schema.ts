/**
 * 思源清单的 schema：唯一的形状来源。
 *
 * 为什么需要：思源的失败模式是**静默的**。`name: 123` 不会被思源报错，
 * 只是主题不出现在列表里。旧实现只检查字段是否存在，类型错了照样通过。
 *
 * 清单允许额外的集市字段（icon / preview / readme 的 i18n 对象等），
 * 所以这里**不** `.strict()`——未知字段是正常的。真正要拦的是已知字段的类型。
 */
import { parse } from 'semver';
import { z } from 'zod';

/**
 * 只认 `x.y.z`（与思源集市一致）：排除前导零、`v` 前缀、prerelease、build。
 *
 * 不用正则：正则的 `\d+` 会接受 `01.2.3`，而 semver 规范里这是非法的；
 * 也会接受超出安全整数范围的 `999999999999999999999.0.0`。
 * `semver.parse()` 按规范收窄，再按三点确认：可解析、`parsed.version === value`
 * （排除 `v1.2.3` 与带 build 的 `1.2.3+build`）、无 prerelease（排除 `1.2.3-beta`）。
 */
function isSemver(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const parsed = parse(value);
  if (parsed === null) return false;
  if (parsed.version !== value) return false;
  return parsed.prerelease.length === 0;
}

const semverShape = z.string({ error: '必须是字符串' }).refine(isSemver, {
  error: '必须是 主.次.修订 形式的 semver，如 1.2.3',
});

/** i18n 对象：思源按 default 回退，缺了会显示空白。 */
const i18nFieldShape = z
  .union([z.string(), z.record(z.string(), z.string(), { error: 'i18n 对象的值必须是字符串' })], {
    error: '必须是字符串或 { default: string, ... } 的 i18n 对象',
  })
  .refine((value) => typeof value === 'string' || 'default' in value, {
    error: '是 i18n 对象但没有 default 项（思源按 default 回退，缺了会显示空白）',
  });

/** 主题与插件共有的清单字段。 */
const baseManifestShape = z.object({
  name: z.string({ error: '必须是字符串' }).min(1, { error: '不能为空' }),
  author: z.string({ error: '必须是字符串' }).min(1, { error: '不能为空' }),
  url: z.string({ error: '必须是字符串' }).min(1, { error: '不能为空' }),
  version: semverShape,
  displayName: i18nFieldShape.optional(),
  description: i18nFieldShape.optional(),
  readme: i18nFieldShape.optional(),
  icon: z.string({ error: '必须是字符串' }).optional(),
  preview: z.string({ error: '必须是字符串' }).optional(),
});

/** 主题清单：modes 决定思源的主题列表。 */
export const themeManifestShape = baseManifestShape.extend({
  modes: z
    .array(z.enum(['light', 'dark'], { error: '只接受 light / dark' }), { error: '必须是数组' })
    .min(1, { error: '必须是非空数组，如 ["light", "dark"]' }),
});

/** 插件清单：minAppVersion 决定思源能否安装。 */
export const pluginManifestShape = baseManifestShape.extend({
  minAppVersion: semverShape,
});

/** 把 zod 的路径转成人能读的位置。 */
function pathLabel(path: ReadonlyArray<PropertyKey>): string {
  let label = '';
  for (const segment of path) {
    if (typeof segment === 'number') label += `[${segment}]`;
    else label += label ? `.${String(segment)}` : String(segment);
  }
  return label;
}

/** 一条 zod 问题转成一句中文（不含字段名前缀，调用方自己拼）。 */
export function manifestIssueMessage(issue: z.core.$ZodIssue): { message: string; hint?: string } {
  const label = pathLabel(issue.path) || '清单';
  if (issue.code === 'invalid_type' && issue.expected === 'string') {
    return { message: `${label} 必须是字符串` };
  }
  return { message: `${label} ${issue.message}` };
}
