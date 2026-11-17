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

## 指令重载与可选参数

连接提供新重载元数据的固件后，运行页和节点编辑器会自动识别必填/可选参数。
连续且名称、类型前缀一致的重载合并为一个表单；参数数量有断档或含义不同的重载
通过“调用签名”单独选择，切换签名时清空原草稿，避免把旧值按另一种类型提交。

- 留空的可选尾参不下发，由固件选择真正的短重载；`false`、`0` 都是明确的参数值。
- `paramDefaults: null` 不等于必填，也不会推断无参重载内部使用的默认值。
- 后面的参数已填而前面留空时，仅允许用明确的注解默认值补齐中间空位，否则阻止运行。
- 已存节点参数数量不匹配时会提示选择签名，不会自动截断；无参重载不会被误报缺参。
- 旧固件没有新元数据时，仍保留原有默认值补全方式。路径参数和远程指令参数均为字符串数组。

## 航点命令列表与路径 JSON v2

每个航点可以添加、删除和上下调整多条指令。指令仍来自固件目录，聚合指令（如
`auto.shoot`）和等待指令 `auto.waitMillis` 都按普通 command 编辑，不在前端解释 Java。
同一点按列表顺序执行，不同点的任务可并行，指令不自动停车。路径运动结束后固件等待
所有已启动任务完成；STOP 取消任务。`auto.waitMillis` 的参数单位是毫秒，只等待当前
指令列表；节点“到点等待”仍是以秒计的底盘停留，两者不能互相转换。

新导出、上传的单路径 JSON 包含外层格式版本号（不是 HTTP 路线 revision）：

```json
{
  "version": 2,
  "frames": [
    {
      "x": 0,
      "y": 0,
      "commands": [
        { "name": "intaker.intakerIn", "params": ["1"] },
        { "name": "auto.waitMillis", "params": ["1000"] },
        { "name": "intaker.intakerArmStop", "params": [] }
      ]
    }
  ]
}
```

- 旧的裸节点/帧数组视作 v1，旧 `command` / `commandParams` 在读取时迁移为列表。
- 本地存档保留机器人分组结构，每条路线记录 `version: 2` 和完整 `points`。
- 未知版本、错误封装、新旧非空命令字段冲突会报错，不自动降级或丢弃。
- 带事件的独立 wait 帧无法无损折叠为控制点，导入时明确拒绝。
- 规范比较不包含外层版本；旧零条/单条指令的语义指纹保持兼容。
- v2 路径必须配套支持该封装的固件；不能依赖旧固件忽略未知字段继续运行。
- 运行页的单指令试运行返回“已受理”不等于动作完成，不会自动替换其他任务；
  几何预览不模拟 Java 聚合指令的执行时间或状态。

## 与旧 Kotlin 版的有意差异

旧的 Kotlin Multiplatform 版保留在分支 `legacy-kotlin`，`main` 只含本项目。

- 本地删除路径会写“删除墓碑”，同步时删除机器上的副本，不再复活；机器侧之后又改过则报冲突。
- 同步比较的是解析后的规范结构，不比原始文本；曲线用精确三次 Bézier 绘制；回放用真实时间。
- SSE 由连接状态机控制重连（指数退避、心跳看门狗、409 遵守 retryAfterMs）。
- 指令参数逐项输入，不再用逗号拆分。
