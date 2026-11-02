# 仓库指南

AzConductor：FTC 机器人路径规划器的纯静态网页版（可直接部署到 GitHub Pages，支持 PWA 离线）。
旧的 Kotlin Multiplatform 版在分支 `legacy-kotlin`，本分支不含 Kotlin 代码。

## 技术栈

Vite 8 + TypeScript 7（strict、noUncheckedIndexedAccess、exactOptionalPropertyTypes）+ Preact 11 + @preact/signals；
样式为原生 CSS；hash 路由；vite-plugin-pwa（Workbox）；测试用 Vitest；端到端用 playwright-core（驱动本机 Edge/Chrome）。
Node >= 22（见 `.nvmrc`）。

## 命令

| 命令 | 作用 |
|---|---|
| `npm ci` | 安装依赖 |
| `npm run dev` | 开发服务器 |
| `npm run mock` | 本地模拟机器人（Network V2，默认 8888 端口） |
| `npm test` | Vitest（单元 + 对 mock 机器人的 HTTP/SSE 集成测试） |
| `npm run typecheck` | `tsc --noEmit`（含 src、tests、e2e） |
| `npm run build` | 类型检查 + 构建 + PWA，产物在 `dist/` |
| `npm run e2e` | 端到端冒烟（需先 build；用 mock 机器人 + 真实浏览器 + PWA 离线） |
| `npm run visual` | 截图用于人工视觉检查，输出 `e2e/vis/`（已忽略） |
| `npm run live` | 对已部署的线上页面做连通验证 |

## 结构

- `src/core`：纯函数内核（样条/Bézier、路径时间轴、契约校验、机器人线格式、存档格式、场地坐标、回放），不依赖 DOM 与 UI 框架。
- `src/net`：Network V2（transport、api、connection 状态机、sync 同步引擎、baselines），不依赖 UI 框架。
- `src/state`：docStore（撤销栈、防抖保存、跨标签页）、session（连接 + Web Locks）、sync 接线、robotData、settings。
- `src/ui`：路径管理页、编辑器、运行页、对话框；界面文字集中在 `src/ui/strings.ts`；节点编辑表单由 `src/ui/nodeFields.ts` 字段表驱动（给 `ControlNode` 加字段必须在此登记，否则编译不过）。`components/` 下的 `icons.tsx`（内联 SVG 图标）、`menu.tsx`（Popover 下拉菜单）、`connection.tsx`（连接胶囊与设置对话框）为共用件；颜色走 `styles.css` 的令牌，场地上的绘制用不随深浅色变化的 `--f-*` 色板。
- `src/tools/mock-robot.ts`：Node 版模拟机器人，测试与本地联调用，不进发布产物。
- `tests/`、`e2e/`：Vitest 测试与真实浏览器端到端脚本。

## 约定

- 提交信息：中文描述 + 英文前缀（`feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `ci:`），一行为宜。
- 所有"本地与远端是否相同"的比较用解析后的规范结构（`canonicalRoute`），不比较原始文本；可选字段缺省时省略，永不输出 `null`。
- 机器人 Network V2 的线格式、状态码、CORS 要求以机器人侧代码为准；改动 `src/net` 要同步更新 mock 与测试。
- 运行页指令试运行对应固件的 `POST /api/v2/commands/run`（`RobotApiRouter.handleCommandRun`，固件提交 b83b346）：只在 OpMode `RUNNING` 且该 OpMode 挂载了 `commandDispatcher` 时接受（目前仅 `RemoteCommand Test`，TeleOp）；校验顺序和错误码在 mock 的 `handleCommandRun` 里逐条移植。目录 `GET /commands` 带 `paramDefaults`，末尾带默认值的参数可省略，但客户端下发时一律补全（`resolveArgs`），不依赖固件补默认值。旧固件没有这个端点（404 `not_found`）。改固件接口时同步改 `RobotApiClient.runCommand`、mock 和 `src/core/commandArgs.ts`（校验规则对齐固件 `CommandArgs.convert`）。
- 部署：推送 `main` 触发 `.github/workflows/pages.yml`（`npm ci → test → build → deploy-pages`）。