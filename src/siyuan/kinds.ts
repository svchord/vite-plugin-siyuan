/**
 * 思源主题/插件的契约常量。
 *
 * 两种类型各自有一套清单与加载方式。编排层只认 kind，不写死清单名。
 */
import { existsSync } from 'node:fs';
import { UserError } from '../support/errors.ts';
import { readJsonFile } from '../support/fs.ts';
import { isRecord } from '../support/guards.ts';
import { manifestCandidates } from './manifest.ts';

export type Kind = 'theme' | 'plugin';

export interface KindSpec {
  /** 清单文件名。 */
  manifestName: string;
  /** 工作区 data 下的安装子目录。 */
  installSubdir: string;
  /** 覆盖安装目录的环境变量名。 */
  dirEnv: string;
  /** 链接后必须存在的文件。 */
  expectedFiles: string[];
  /** 安装目录是否必须被 Go 识别为真 symlink（插件是，主题可用 junction 兜底）。 */
  requireSymlink: boolean;
  /** 产物变化时是否值得广播整页刷新。 */
  matchArtifact(filename: string): boolean;
  /** 产物里的 CSS 固定名。 */
  cssName: string;
}

const SPECS: Record<Kind, KindSpec> = {
  theme: {
    manifestName: 'theme.json',
    installSubdir: 'themes',
    dirEnv: 'SIYUAN_THEME_DIR',
    expectedFiles: ['theme.css', 'theme.json'],
    requireSymlink: false,
    matchArtifact: (name) => name.endsWith('theme.css'),
    cssName: 'theme.css',
  },
  plugin: {
    manifestName: 'plugin.json',
    installSubdir: 'plugins',
    dirEnv: 'SIYUAN_PLUGIN_DIR',
    expectedFiles: ['index.js', 'plugin.json'],
    requireSymlink: true,
    matchArtifact: (name) => name.endsWith('index.js') || name.endsWith('index.css'),
    cssName: 'index.css',
  },
};

export function kindSpec(kind: Kind): KindSpec {
  return SPECS[kind];
}

const KIND_NAMES: Kind[] = ['theme', 'plugin'];

/**
 * 从项目目录推断类型：看 publicDir 下存在哪份清单。
 * 同时存在多种时必须让人指定——装错类型的产物名会静默加载不到。
 */
export function detectKind(publicDir: string): Kind {
  // publicDir 关掉时清单无处安放：思源要求清单在产物根，而没有 publicDir 就没有
  // 「原样复制到产物根」的机制。这里直接说清楚，不要让用户去猜「产物缺少」。
  if (!publicDir) {
    throw new UserError(
      'publicDir 已关闭，清单（theme.json / plugin.json）无处安放。\n' +
        '  思源要求清单出现在产物根，而 publicDir 是 Vite 唯一能原样复制到产物根的机制。\n' +
        '  请移除 publicDir: false，或改成指向存放清单的目录。'
    );
  }
  const matches = KIND_NAMES.filter((kind) =>
    manifestCandidates(publicDir, SPECS[kind].manifestName).some((file) => existsSync(file))
  );
  const [only] = matches;
  if (matches.length === 1 && only !== undefined) return only;
  throw new UserError(
    matches.length === 0
      ? `在 ${publicDir} 下找不到 theme.json / plugin.json；请把清单放进该目录，或用 kind 选项显式指定类型`
      : `同时匹配到多种类型：${matches.join('、')}；请用 kind 选项显式指定`
  );
}

/** 读被测对象的名字；读不到抛可读错误，不猜默认值。 */
export function readName(publicDir: string, kind: Kind): string {
  for (const file of manifestCandidates(publicDir, SPECS[kind].manifestName)) {
    const data = readJsonFile(file);
    if (isRecord(data)) {
      const name: unknown = data['name'];
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
  }
  throw new UserError(`读不到 ${kind} 的名字：确认 ${SPECS[kind].manifestName} 里有 name 字段`);
}
