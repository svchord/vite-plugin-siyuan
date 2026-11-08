/**
 * 产物与清单校验。
 *
 * 思源的失败模式是**静默的**：theme.json 缺 modes → 主题不出现在列表里；
 * 版本号不一致 → 集市判为旧版；产物缺 index.js → 插件加载不到。
 */
import { existsSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { readJsonFile, readTextFile, walkFiles } from '../support/fs.ts';
import { isRecord } from '../support/guards.ts';
import { readManifest } from '../siyuan/manifest.ts';
import { kindSpec } from '../siyuan/kinds.ts';
import type { Kind } from '../siyuan/kinds.ts';
import { manifestIssueMessage, pluginManifestShape, themeManifestShape } from './manifest-schema.ts';

export interface VerifyIssue {
  message: string;
  hint?: string;
}

export interface VerifyResult {
  ok: boolean;
  issues: VerifyIssue[];
}

/** 去掉 CSS 注释：watch 产物不压缩，注释里常写着「别写 rgb(var(--b3-*))」。 */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** 统计 `rgb(var(--b3-...))` 这类双重包装（整条声明会被浏览器静默丢弃）。 */
function findDoubleWrappedColors(css: string): string[] {
  const problems: string[] = [];
  const pattern = /\brgba?\(\s*var\(\s*(--b3-[\w-]+)\s*\)\)?/g;
  for (const match of stripCssComments(css).matchAll(pattern)) {
    if (match[1] !== undefined) problems.push(`${match[1]} 被 rgb() 双重包装：${match[0]}`);
  }
  return problems;
}

/** 校验一个目标的清单与产物；返回问题列表，空表示通过。 */
export function verifyTarget(kind: Kind, { root, outDir }: { root: string; outDir: string }): VerifyResult {
  const spec = kindSpec(kind);
  const issues: VerifyIssue[] = [];
  const declaredOutDir = isAbsolute(outDir) ? outDir : join(root, outDir);

  // 只校验本次构建的产物目录。不做「产物目录不存在就改扫项目根」的兜底：
  // 插件永远在真实构建之后校验，那种兜底只会把 node_modules 当成产物扫进来。
  const absOutDir = declaredOutDir;

  const walked = walkFiles(absOutDir);
  const files = walked.map((file) => file.name);
  const byName = new Map(walked.map((file) => [file.name, file.path]));
  const readOutput = (file: string): string | null => {
    const path = byName.get(file);
    return path ? readTextFile(path) : null;
  };

  const manifest = readManifest(root, spec.manifestName, [absOutDir])?.data ?? null;
  const packageJsonRaw = readJsonFile(join(root, 'package.json'));
  const packageJson = isRecord(packageJsonRaw) ? packageJsonRaw : null;

  // ---- 通用：清单存在与形状 ----
  if (!manifest) {
    issues.push({
      message: `读不到清单：${spec.manifestName}（找过 public/、dist/、项目根）`,
      hint: '思源按清单识别主题/插件，缺了它不会出现在列表里。',
    });
  } else {
    // 形状交给 schema：字段缺失、类型错误、semver 格式、i18n 缺 default
    // 都在这里一次报完。思源对这些错误都是静默的（`name: 123` 只是不出现）。
    const shape = kind === 'theme' ? themeManifestShape : pluginManifestShape;
    const parsed = shape.safeParse(manifest);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) issues.push(manifestIssueMessage(issue));
    }

    // 跨文件一致性：集市按清单版本判新旧，不一致会导致更新不推送。
    if (packageJson && manifest['version'] && packageJson['version'] !== manifest['version']) {
      issues.push({
        message: `版本不一致：package.json=${String(packageJson['version'])}，清单=${String(manifest['version'])}`,
        hint: '集市按清单版本判新旧，不一致会导致更新不推送。',
      });
    }
  }

  // ---- 通用：产物目录存在与必需文件 ----
  if (!existsSync(absOutDir)) {
    issues.push({ message: `产物目录不存在：${absOutDir}`, hint: '先跑一次构建。' });
  } else {
    for (const expected of spec.expectedFiles) {
      if (!files.includes(expected)) {
        issues.push({ message: `产物缺少 ${expected}`, hint: '思源按固定文件名加载，缺了不会报错、只是加载不到。' });
      }
    }
  }

  // ---- 类型特有的产物检查（清单形状已由上面的 schema 覆盖） ----
  if (existsSync(absOutDir) && kind === 'theme') {
    const scripts = files.filter((file) => file.endsWith('.js'));
    if (scripts.length) {
      issues.push({ message: `主题产物里出现 JavaScript：${scripts.join('、')}`, hint: '主题只交付 CSS。检查 rollupOptions.input 与 lib 配置。' });
    }
    const css = readOutput('theme.css') ?? '';
    if (stripCssComments(css).includes('@layer')) {
      issues.push({ message: 'theme.css 含 @layer，会被未分层的 base.css 压制', hint: '移除 @layer 包装，让主题规则保持 unlayered。' });
    }
    for (const problem of findDoubleWrappedColors(css)) {
      issues.push({ message: problem, hint: '--b3-* 已是完整色值，直接 var() 使用；rgb(var(--rc-*)) 才是正确写法。' });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** 把问题列表排成可读文本。 */
export function formatIssues(issues: VerifyIssue[]): string {
  return issues.map((issue) => (issue.hint ? `  ${issue.message}\n    ${issue.hint}` : `  ${issue.message}`)).join('\n');
}
