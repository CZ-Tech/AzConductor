# CLAUDE.md

本项目的完整指南见 [AGENTS.md](./AGENTS.md)（技术栈、命令、目录结构、约定）。

要点：
- 纯静态 Vite + TypeScript(strict) + Preact 项目，根目录即项目根；旧 Kotlin 版只在分支 `legacy-kotlin`。
- 改动后至少运行 `npm run typecheck && npm test`；涉及界面或同步流程时再 `npm run build && npm run e2e`。
- `src/core` 与 `src/net` 保持无 DOM / 无 UI 框架依赖。