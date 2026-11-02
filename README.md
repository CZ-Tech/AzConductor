# AzConductor（纯静态 TS 版）

FTC 机器人路径规划器的纯静态网页版：Vite + TypeScript(strict) + Preact。可直接部署到 GitHub Pages，支持 PWA 离线使用。
与机器人通过 Network V2（HTTP + SSE，默认端口 8888）通信。

## 开发

```bash
npm ci
npm run dev          # 开发服务器
npm run mock         # 本地模拟机器人 http://0.0.0.0:8888（含示例路径 / OpMode / 指令）
npm test             # Vitest 单元 + 集成测试（含对 mock 机器人的真实 HTTP/SSE 测试）
npm run build        # tsc + vite build + PWA（产物在 dist/）
npm run e2e          # 端到端冒烟（先 npm run build）：真实浏览器(本机 Edge/Chrome) + 构建产物 + mock 机器人 + PWA 离线
```

在页面右上角点击连接状态，填入机器人地址（`192.168.43.1`、`host:8888` 或完整 `https://域名:8888`）。
本地联调：先 `npm run mock`，地址填 `127.0.0.1:8888`。

## 结构

```
src/core     纯函数内核：样条/Bézier、路径时间轴、契约校验、机器人线格式、存档格式、场地坐标、回放
src/net      Network V2：transport(fetch + 自实现 SSE)、api、connection 状态机、sync 同步引擎、baselines
src/state    docStore(撤销栈/防抖保存/跨标签页)、session(连接+Web Locks)、sync 接线、robotData、settings
src/storage  localStorage 封装（键 robot_routes / az.settings 等，兼容旧版数据格式）
src/ui       路径管理页、编辑器、运行页、对话框、字段表驱动的节点编辑器
src/tools    mock-robot：Node 版 Network V2 机器人（测试与本地联调用，不进发布产物）
tests/ e2e/  Vitest 测试；Playwright(core) 端到端冒烟
```

## 部署

`.github/workflows/pages.yml`：推送到 `main` 时，`npm ci → test → build → deploy-pages`。
`base: './'`，hash 路由，无需服务器重写规则。

## 机器人连接与 HTTPS

页面若通过 HTTPS 访问（GitHub Pages），浏览器会拦截对 `http://<机器人IP>` 的请求（混合内容）。
请让机器人以 HTTPS 提供服务（受信任证书 + 域名指向机器人 IP），并在连接设置里填完整地址 `https://域名:8888`。
本机 `http://localhost` / `127.0.0.1` 不受此限制，可直接联调 mock。

## 与旧 Kotlin 版的有意差异

旧的 Kotlin Multiplatform 版保留在分支 `legacy-kotlin`，`main` 只含本项目。

- 本地删除路径会写“删除墓碑”，同步时删除机器上的副本，不再复活；机器侧之后又改过则报冲突。
- 同步比较的是解析后的规范结构，不比原始文本；曲线用精确三次 Bézier 绘制；回放用真实时间。
- SSE 由连接状态机控制重连（指数退避、心跳看门狗、409 遵守 retryAfterMs）。
- 指令参数逐项输入，不再用逗号拆分。
