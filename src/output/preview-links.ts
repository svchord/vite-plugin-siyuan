/**
 * 开发预览入口的排版：绿色箭头 + 加粗端名 + 青色链接，端口单独加粗。
 *
 * 配色对齐 Vite 的 `printServerUrls()`；用 `consola/utils` 的 `colors`，
 * 调色板做成参数是为了可测——`colors` 在模块加载时按进程环境定型。
 */
import { colors } from 'consola/utils';
import type { Frontend } from '../siyuan/port.ts';
import { frontendUrl } from '../siyuan/port.ts';
import type { PreviewLogger } from './log.ts';

/** 排版用到的三个颜色函数。 */
export interface PreviewPalette {
  green: (text: string) => string;
  bold: (text: string) => string;
  cyan: (text: string) => string;
}

const FRONTEND_LABELS: Record<Frontend, string> = {
  desktop: '桌面端',
  mobile: '移动端',
};

/**
 * 只给 URL 上色，并把端口单独加粗（和 Vite 一样）。
 *
 * 端口是唯一会变的部分：多个思源实例、自定义 `SIYUAN_PORT` 时，
 * 一眼看出打的是哪个端口比看清整条路径更有用。
 */
function colorUrl(url: string, palette: PreviewPalette): string {
  return palette.cyan(url.replace(/:(\d+)(?=\/|$)/, (_, port: string) => `:${palette.bold(port)}`));
}

/** 把预览入口排成若干行：第一行标题，之后每个前端一行。 */
export function formatPreviewLinks(port: number, palette: PreviewPalette): string[] {
  const frontends: Frontend[] = ['desktop', 'mobile'];
  return [
    '开发预览',
    ...frontends.map(
      (frontend) =>
        `  ${palette.green('➜')}  ${palette.bold(FRONTEND_LABELS[frontend])}:  ${colorUrl(frontendUrl(port, frontend), palette)}`
    ),
  ];
}

/**
 * 打印预览入口，标题行带 logger 的 tag 与级别图标。
 *
 * 必须走 info，不能走 log：consola 的 `log` 级别既没有图标也不带 tag 前缀，
 * 于是这一块会与上面几条日志断成两截。走 info 后标题行拿到 tag 前缀，
 * 两条链接行不带前缀，靠缩进归属这一块。
 */
export function logPreviewLinks(logger: PreviewLogger, port: number, palette: PreviewPalette = colors): void {
  logger.info(formatPreviewLinks(port, palette).join('\n'));
}
