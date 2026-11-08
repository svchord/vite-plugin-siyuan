# vite-plugin-siyuan

思源主题/插件开发的 Vite 插件：注入构建配置、链接到工作区、热重载、校验产物、打包。

## 安装

要求 Node.js >= 22.18、Vite >= 6。

```bash
pnpm add -D vite-plugin-siyuan
```

## 使用

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import siyuan from 'vite-plugin-siyuan';

export default defineConfig({
  // entry 必填：主题指向 CSS，插件指向 TS/JS
  plugins: [siyuan({ entry: 'src/main.css' })],
});
```

```bash
pnpm vite build --watch
```

`vite dev` 不适用：思源从磁盘读产物，而 dev server 只在内存里编译。插件的 `apply` 固定为 `'build'`。

## 项目结构

**除了 `README.md`，其余文件都放 `public/`。**

```
你的项目/
├── README.md             ← 唯一必须放项目根的（GitHub 只展示仓库根的 README）
├── public/
│   ├── theme.json        ← 主题；插件则是 plugin.json
│   ├── icon.png
│   ├── preview.png
│   └── i18n/
│       ├── en_US.json
│       └── zh_CN.json
├── src/
│   └── main.css          ← entry 指向这里
└── vite.config.ts
```

### 为什么

| 文件 | 放哪 | 谁负责搬进产物 |
|---|---|---|
| `theme.json` / `plugin.json` | `public/` | Vite 的 `publicDir` |
| `icon` / `preview` / `i18n/` / 图片字体 | `public/` | Vite 的 `publicDir` |
| `README.md` | **项目根** | 插件搬（见下） |

`theme.json` / `plugin.json` 等必须是**产物根**的文件（思源按固定位置加载），
而 `public/` 是 Vite 唯一「原样复制到产物根」的机制——放这里，dev 和 build 都自动生效，
改清单也会触发重建。

`README.md` 是唯一的例外：GitHub 只展示仓库根的 README，但思源集市要求它出现在产物根。
插件会把它从项目根复制进产物（清单的 `readme` 字段可指定文件名，缺省按 `README*.md` 兜底）。
如果你更想放 `public/README.md`，也支持——检测到已在 `public/` 下就不重复复制。

> 清单里声明的 `icon` / `preview` 如果没出现在产物里，构建会**报错**并提示放进 `public/`。
> 这类缺失思源不会报错，只会导致集市缺图。

### 不支持根目录布局

官方 [theme-sample](https://github.com/siyuan-note/theme-sample) 和
[plugin-sample](https://github.com/siyuan-note/plugin-sample) 把清单放项目根，但它们是
无构建步骤或 webpack 项目，不是 Vite 项目。若强行放根目录，插件会在 `config` 阶段直接报错：

```
在 <root>/public 下找不到 theme.json / plugin.json；请把清单放进 public/，或用 kind 选项显式指定类型
```

## 选项

| 选项 | 说明 |
|---|---|
| `entry` | **必填**。构建入口，相对项目根。主题指向 CSS，插件指向 TS/JS |
| `kind` | `'theme'` / `'plugin'`；缺省时按 `public/` 下存在的清单推断 |
| `outDir` | 产物目录；缺省 `./dev`（watch）/ `./dist`（生产） |

> `entry` 必填是因为产物名是固定契约（主题 `theme.css`、插件 `index.js`）。
> 入口猜错不会报错，只会静默产出思源加载不到的东西——所以宁可要求显式指定。

## 做什么

两种模式行为差别很大。

### watch（`vite build --watch`）

1. **注入构建配置**：主题产出 `theme.css`；插件走 `lib` CJS 单文件产出 `index.js`。`base: './'` 保证宿主下资源不 404。用 `mergeConfig` 合并，**用户已写的值优先**。
2. **链接产物**：把 `dev/` 链接到 `{workspace}/data/themes|plugins/{name}`。插件目录必须是真 symlink（思源 Go 运行时按 `ModeSymlink` 判定），主题可用 junction 兜底。
3. **激活**：主题调 `setAppearance` 选中它；插件调 `setPetalEnabled` 启用。
4. **热重载**：产物变化后合并 250ms 广播 `reloadUI`，思源整页刷新。

### 生产（`vite build`）

只做 **校验 + 打包**：检查清单字段、版本一致性、必需产物、主题的 `@layer` 与双重包装颜色；通过后在**项目根目录**写出 `package.zip`。

生产构建**不会**链接目录、不会切换主题/插件；校验不通过会直接抛错中止。

## 输出

每轮构建结束时打印一行，供 agent 判断「可以测量了」：

```
[vite-plugin-siyuan] build #12 ready · theme · watch
```

生产构建对应的是：

```
[vite-plugin-siyuan] build #1 ready · theme · package.zip
```

watch 模式首次就绪后还会打印桌面端 / 移动端两个稳定预览入口。

## 环境变量

| 变量 | 说明 |
|---|---|
| `SIYUAN_PORT` | kernel 端口；缺省用 kernel 进程 PID 匹配 `port.json`，再探测记录端口与 6806–6809 |
| `SIYUAN_THEME_DIR` | 主题安装父目录（`{workspace}/data/themes`），实际装到 `{该目录}/{name}` |
| `SIYUAN_PLUGIN_DIR` | 插件安装父目录（`{workspace}/data/plugins`），同上 |
| `SIYUAN_TOKEN` | 开了 API token 时使用 |
| `SIYUAN_NO_ELEVATION=1` | 不弹 UAC 提权（CI 环境自动不弹） |
| `SIYUAN_DEBUG=1` | 输出 debug 级日志 |

> 旧名 `SYD_NO_ELEVATION` / `SYD_DEBUG` 仍然兼容。

## 配套 CLI

测量真实渲染用 [siyuan-devtools](https://github.com/svchord/siyuan-devtools)。

## 参与开发

### 提 PR

1. 先开 issue 对齐需求，避免白做。
2. PR 标题必须符合 [Conventional Commits](https://www.conventionalcommits.org/)——CI 会检查：
   - `feat: ...` → 次版本（0.2.0）
   - `fix: ...` → 补丁版本（0.1.1）
   - `feat!: ...` → 1.0 之前只升次版本
   - `docs:` / `chore:` / `ci:` / `test:` / `refactor:` → 不发版
3. 合并方式固定为 **Squash and merge**，PR 标题会成为最终 commit。

### 发布流程

用 [release-please](https://github.com/googleapis/release-please) 自动管理版本，仓库里不手写版本号：

```
普通 PR 合入 main
  └─ release-please 开/更新 Release PR「chore(main): release x.y.z」
       └─ 合并该 PR
            ├─ 自动打 tag、建 GitHub Release、生成 CHANGELOG.md
            └─ 自动发布到 npm（OIDC trusted publishing）
```

`package.json` 的 `version` 由 Release PR 更新，不要手动改。
