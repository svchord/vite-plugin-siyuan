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
├── README.md             ← 唯一放项目根的（GitHub 只展示仓库根的 README）
├── public/
│   ├── theme.json        ← 主题；插件则是 plugin.json
│   ├── icon.png
│   ├── preview.png
│   └── i18n/
├── src/
│   └── main.css          ← entry 指向这里
└── vite.config.ts
```

思源按固定路径从**产物根**加载清单和资源，而 `public/` 是 Vite 唯一「原样复制到产物根」的机制。放这里，dev 和 build 都自动生效，改清单也会触发重建。

`README.md` 是唯一例外：GitHub 只认仓库根的 README，思源集市要求它在产物根。插件会把它从项目根复制进产物（清单的 `readme` 字段可指定文件名，缺省按 `README*.md` 兜底）；如果你放 `public/README.md`，则以 `public/` 为准。

清单里声明的 `icon` / `preview` 若没出现在产物里，构建会**报错**——这类缺失思源不会报错，只会导致集市缺图。

### 关于 publicDir

默认就是 `public/`。如果改成别的目录（`publicDir: 'static'`），插件会跟着找，无需额外配置。

**不要设成 `false`**：思源要求清单出现在产物根，而没有 `publicDir` 就没有任何机制能把清单复制进去。插件会在 `config` 阶段直接报错。

### 不支持根目录布局

官方 [theme-sample](https://github.com/siyuan-note/theme-sample) 和 [plugin-sample](https://github.com/siyuan-note/plugin-sample) 把清单放项目根，但它们是**无构建步骤或 webpack 项目**，不是 Vite 项目。放到项目根会直接报错：

```
在 {publicDir} 下找不到 theme.json / plugin.json；请把清单放进该目录，或用 kind 选项显式指定类型
```

## 选项

| 选项 | 说明 |
|---|---|
| `entry` | **必填**。构建入口，相对项目根。主题指向 CSS，插件指向 TS/JS |
| `kind` | `'theme'` / `'plugin'`；缺省时按 `publicDir` 下的清单推断 |
| `outDir` | 产物目录；缺省 `./dev`（watch）/ `./dist`（生产） |

`entry` 必填是因为产物名是固定契约（主题 `theme.css`、插件 `index.js`）。入口猜错不会报错，只会静默产出思源加载不到的东西。

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

默认只打印用户需要知道的结果与需要处理的问题：链接/启用状态、校验失败、README 复制失败、打包结果与预览入口；端口探测、跳过监听这类内部过程只在 `SIYUAN_DEBUG=1` 时输出。

watch 首轮构建不打印 `build #N` 信号（此时「会话就绪 + 预览入口」已经说明可以开始了）；之后每次热重载打印一行，供 agent 判断「可以测量了」：

```
[vite-plugin-siyuan] build #12 ready · theme · watch
```

watch 构建失败（含校验未通过）对应的是：

```
[vite-plugin-siyuan] build #12 failed · theme · watch
```

生产构建成功时：

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
| `SIYUAN_DEBUG=1` | 输出内部调试日志（端口探测、跳过监听、README 兜底等） |

工作区自动探测的顺序：`SIYUAN_THEME_DIR` / `SIYUAN_PLUGIN_DIR` → 内核自报的 `workspaceDir`（`/api/system/getWorkspaceInfo`）→ 内核列表中唯一正在运行的工作区 → `workspace.json` 的唯一登记项。`workspace.json` 会保留历史工作区，登记多条不会导致报错；只有确实无法确认当前运行的是哪一个时，才需要显式指定安装目录。

旧名 `SYD_NO_ELEVATION` / `SYD_DEBUG` 仍然兼容。

## 配套 CLI

测量真实渲染用 [siyuan-devtools](https://github.com/svchord/siyuan-devtools)。

## 参与开发

### 提 PR

1. 先开 issue 对齐需求，避免白做。
2. PR 标题必须符合 [Conventional Commits](https://www.conventionalcommits.org/)，CI 会检查：
   - `feat:` → 次版本，`fix:` → 补丁版本
   - `feat!:` → 1.0 之前只升次版本
   - `docs:` / `chore:` / `ci:` / `test:` / `refactor:` → 不发版
3. 合并方式固定为 **Squash and merge**，PR 标题会成为最终 commit。

本地提交信息同样受约束：`pnpm install` 会通过 `prepare` 安装 husky 钩子，
`commit-msg` 用 commitlint 校验单条消息，`pre-push` 校验本次推送新增的提交，
规则见 `commitlint.config.js`。绕过钩子（`git commit --no-verify`）产生的提交会在 push 时被拦下；
确实需要绕过时用 `git push --no-verify`，并自行确认该提交不会进入 CHANGELOG。

### 发布流程

用 [release-please](https://github.com/googleapis/release-please) 自动管理版本，仓库里不手写版本号：

```
普通 PR 合入 main
  └─ release-please 开/更新 Release PR「chore(main): release x.y.z」
       └─ 合并该 PR
            ├─ 自动打 tag、建 GitHub Release、生成 CHANGELOG.md
            └─ 自动 stage 到 npm（OIDC trusted publishing）
                 └─ 你在 npmjs.com 用安全密钥批准后上线
```

`package.json` 的 `version` 由 Release PR 更新，不要手动改。
