# vite-plugin-siyuan

思源主题/插件开发的 Vite 插件：注入构建配置、链接到工作区、热重载、校验产物、打包。

## 安装

```bash
pnpm add -D vite-plugin-siyuan
```

## 使用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import siyuan from 'vite-plugin-siyuan';

export default defineConfig({
  plugins: [siyuan()],
});
```

```bash
pnpm vite build --watch
```

`vite dev` 不适用：思源从磁盘读产物，而 dev server 只在内存里编译。

## 选项

| 选项 | 说明 |
|---|---|
| `kind` | `'theme'` / `'plugin'`；缺省从 `theme.json` / `plugin.json` 推断 |
| `outDir` | 产物目录；缺省 `./dev`（watch）/ `./dist`（生产） |
| `entry` | 构建入口，相对项目根；缺省保留项目自己的 `input` / `lib` |

## 做什么

1. **注入构建配置**：`theme` 产出 `theme.css`，`plugin` 走 `lib` CJS 单文件产出 `index.js`；`base: './'` 保证宿主下资源不 404。用 `mergeConfig` 合并，**用户已写的值优先**。
2. **链接产物**：把 `dev/` 链接到 `<workspace>/data/themes|plugins/<name>`。插件目录必须是真 symlink（思源 Go 运行时按 `ModeSymlink` 判定），主题可用 junction 兜底。
3. **激活**：主题调 `setAppearance` 选中它；插件调 `setPetalEnabled` 启用。
4. **热重载**：产物变化后合并 250ms 广播 `reloadUI`，思源整页刷新。
5. **校验与打包**：检查清单字段、版本一致性、必需产物、主题的 `@layer` 与双重包装颜色；生产构建写出 `package.zip`。

## 输出

每轮构建结束时打印一行，供 agent 判断「可以测量了」：

```
[vite-plugin-siyuan] build #12 ready · theme · watch
```

watch 模式首次就绪后还会打印两个稳定预览入口。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口；缺省自动探测（`port.json` → 6806–6809） |
| `SIYUAN_THEME_DIR` | 直接指定主题安装目录 |
| `SIYUAN_PLUGIN_DIR` | 直接指定插件安装目录 |
| `SIYUAN_TOKEN` | 开了 API token 时使用 |
| `SYD_NO_ELEVATION=1` | 不弹 UAC 提权 |

## 配套 CLI

测量真实渲染用 [siyuan-devtools](../siyuan-devtools)。
