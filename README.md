# vite-plugin-siyuan

思源主题/插件开发的 Vite 插件：注入构建配置、写入工作区、热重载、校验产物、打包。

## 安装

要求 Node.js ≥ 22.18、Vite ≥ 6。

```bash
pnpm add -D vite-plugin-siyuan
```

## 使用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import siyuan from 'vite-plugin-siyuan';

export default defineConfig({
  plugins: [siyuan({ entry: 'src/main.css' })],
});
```

```bash
pnpm vite build --watch
```

只支持 `vite build`（`apply: 'build'`）：思源从磁盘读产物，`vite dev` 只在内存里编译。watch 需要思源正在运行。

## 项目结构

除 `README.md` 外，其余文件都放 `public/`：

```
你的项目/
├── README.md             ← 唯一放项目根的
├── public/
│   ├── theme.json        ← 插件则是 plugin.json
│   ├── icon.png
│   ├── preview.png
│   └── i18n/
├── src/
│   └── main.css          ← entry
└── vite.config.ts
```

`public/` 是 Vite 唯一「原样复制到产物根」的机制，而思源正从产物根读清单与资源。构建会监听 `public/**`，改清单也会重建。

`README.md` 由插件从项目根复制进产物（清单的 `readme` 可指定文件名，缺省 `README*.md`）；`public/` 下有同名文件时以 `public/` 为准。

清单声明的 `icon` / `preview` / `readme` 缺失时，生产构建报错，watch 只提示。

`publicDir` 可改成别的目录，但**不能设为 `false`**（清单无处安放，`config` 阶段即报错）。不支持项目根布局——官方 sample 不是 Vite 项目。

## 选项

| 选项 | 说明 |
|---|---|
| `entry` | **必填**。入口，相对 Vite root；主题指 CSS，插件指 TS/JS |
| `kind` | `'theme'` / `'plugin'`；缺省按 `publicDir` 下的清单推断 |
| `devDir` | watch 时项目根下的开发链接目录名，缺省 `dev`。Windows 为目录联接（junction），其他平台为符号链接；指向思源安装目录，只给开发者/IDE 看 |

产物名是固定契约（`theme.css` / `index.js`），入口猜错不报错，只会静默加载不到。

## 行为

**watch**：注入配置（`base: './'`、不压缩、输出目录为思源安装目录、不清空）→ 在项目根建立 `<devDir>` 开发链接（Windows 为目录联接 junction）指向安装目录 → 激活（主题 `setAppearance`，插件 `setPetalEnabled`）→ 产物变化合并 250ms 广播 `reloadUI` → 校验，未通过只告警。

**生产**：不探测思源，产物写 `dist`（或用户 `build.outDir`，构建前清空）→ 只校验 + 打包，在项目根写出 `package.zip`，不通过则抛错中止；不写工作区、不激活。

## 输出

默认只打印结果与待处理问题，内部过程需 `SIYUAN_DEBUG=1`。watch 首轮不打印，之后每次热重载一行：

```
[vite-plugin-siyuan] build #12 ready · theme · watch
[vite-plugin-siyuan] build #12 failed · theme · watch
```

生产成功为 `build #1 ready · theme · package.zip`。watch 首次就绪还会打印桌面端 / 移动端预览地址。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口；缺省按 PID 匹配 `port.json`，再探测记录端口与 6806–6809 |
| `SIYUAN_THEME_DIR` | 主题安装父目录，装到 `{该目录}/{name}` |
| `SIYUAN_PLUGIN_DIR` | 插件安装父目录，同上 |
| `SIYUAN_TOKEN` | 开了 API token 时使用 |
| `SIYUAN_NO_ELEVATION=1` | 不弹 UAC 提权 |
| `SIYUAN_DEBUG=1` | 输出内部调试日志 |

工作区顺序：上面两个目录变量 → 内核自报的 `workspaceDir` → 内核列表中唯一运行中的工作区 → `workspace.json` 的唯一登记项。登记多条历史工作区不算歧义。

旧名 `SYD_NO_ELEVATION` / `SYD_DEBUG` 兼容。

## 配套 CLI

测量真实渲染用 [siyuan-devtools](https://github.com/svchord/siyuan-devtools)。

## 参与开发

PR 标题需符合 [Conventional Commits](https://www.conventionalcommits.org/)（CI 检查），合并用 **Squash and merge**，标题即最终 commit。版本由 release-please 按类型计算：`feat` 次版本，`fix` / `perf` / `revert` 补丁版本，破坏性变更主版本（1.0 前只升次版本），其余类型不发版也不进 CHANGELOG。

本地提交同样受 commitlint 约束（husky 的 `commit-msg` / `pre-push`，规则见 `commitlint.config.js`）。`package.json` 的 `version` 由 Release PR 更新，不要手改。
