# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

JWord 是一个 Word 风格的文档编辑器 SDK（pnpm monorepo）：Y.Doc 作为唯一状态真源，自研分页排版引擎，按页 Canvas 渲染，支持 docx/pdf 互通、多人协同和 `.jword` 原生格式。规范文档见 `docs/superpowers/specs/2026-05-11-jword-canonical/`（架构、工程标准、Gate 验收），公开 API 目录见 `docs/sdk/public-api.md`。

## 常用命令

环境要求：Node `>=20.19.0`，pnpm 固定 `9.14.2`。

```bash
pnpm install --frozen-lockfile   # 安装依赖
pnpm lint                        # ESLint + 版本锁定检查 + 边界检查 + 中文注释检查
pnpm typecheck                   # tsc --noEmit
pnpm test                        # Vitest 全量单测
pnpm vitest run <文件路径>        # 运行单个测试文件（根 vitest.config.ts 把 @4xian/jword-* 别名到各包 src，无需先构建）
pnpm vitest run <路径> -t "名称"  # 运行单个用例
pnpm test:e2e                    # Playwright（chromium/firefox/webkit + perf-chromium）
pnpm exec playwright test <文件> --project=chromium   # 单个 e2e
pnpm build                       # Rollup 构建 + dist 相对导入归一化
pnpm dev                         # 启动 examples/vanilla 开发服务
pnpm bench / pnpm size / pnpm test:visual   # 基准 / 包体积门禁 / 视觉检查
```

示例应用：`pnpm --filter @4xian/jword-example-vanilla dev`（另有 `-docx`、`-collab`；collab 的服务端用 `dev:server`）。

## 架构

### 分层（依赖只能向下）

```
Host App → Framework Wrapper → JWord UI → Editor Facade
  → Command/Input/History/Selection/Plugin → Transaction Pipeline
  → Y.Doc 状态 (± Collab Provider / IndexedDB)
  → DocumentProjection（只读投影）→ Layout Engine → Page Canvas Renderer
```

核心不变式：

- **Y.Doc 是唯一可写状态**。本地单人模式同样建 Y.Doc，只是不挂 provider。`DocumentProjection` 是从 Y.Doc 派生的只读快照，供 layout/render/docx/pdf 消费；禁止出现第二套可写 Model 与 Y.Doc 双向同步。
- **所有变更走同一 Transaction Pipeline**：Input/API/Remote → Command → Operation → `ydoc.transact(origin)` → 投影更新 → 布局调度 → 渲染 → 事件。每个 transaction 必须带 origin；Layout 只读 Projection，Renderer 只消费 LayoutBox 不读状态树。
- **docx/pdf 互通在 Worker 中执行**（不访问 DOM，支持 AbortSignal/progress），导入结果必须进入 transaction pipeline，不得直接替换内部状态。
- 布局内部单位是 twip，渲染时转 CSS px；按页分配/复用 canvas，禁止全文单 canvas。
- History 双层：Y.UndoManager 负责回滚，JWord 元数据负责 command 名称/selection 恢复/分组；remote 与 AI 自动插入默认不进用户 undo。

### 包职责（packages/）

- `core`：编辑器核心（Editor facade、operations、model、layout、canvas），**框架无关**，只依赖 yjs
- `ui`：DOM 工具栏/菜单/批注/修订等 UI SDK（dompurify）
- `docx` / `pdf`：docx 导入导出、pdf 导出（jszip、pdf-lib、fontkit）
- `native`：`.jword` zip 原生格式的保存/打开/校验
- `collab` / `collab-server` / `persistence`：Yjs 协同 provider（hocuspocus）、示例服务端、y-indexeddb 离线持久化
- `license`：商业授权 entitlement 与 feature matrix 的纯函数契约，被 docx/pdf/collab 复用

### 机器强制的边界（违反会挂 lint / 架构测试）

- `packages/core` 禁止导入 react、vue、UI/docx/pdf/collab 包、hocuspocus、jszip、pdf-lib、fontkit、vite、playwright，且不得有顶层 DOM 访问（`tools/lint/check-boundaries.mjs` + `tests/architecture/core-boundary.test.ts`）。
- `tests/architecture/` 下的 gate 测试强制执行包体积预算、文件行数预算、import 图、包导出面和公开 API 目录等约束；改动导致这些测试失败说明违反了工程门禁，应调整实现而不是放宽测试。
- 根 package.json 所有依赖必须精确 semver（禁止 `^`/`~`），packageManager 固定 pnpm@9.14.2（`tools/lint/check-package-versions.mjs`）。

## 代码规范

- TypeScript ESM；单引号、无分号、无尾逗号、禁止 `any`。
- 每个 `.ts` 文件必须以头部注释开始，包含：职责 / 边界 / 协作模块 / 性能安全约束 / Specs（指向 docs 中的规范条目）。参考任意现有源文件。
- `.ts/.tsx/.js/.mjs` 中的注释必须用中文（`tools/lint/check-comments.mjs` 限制单段注释最多约 5 个英文单词；代码标识符、路径、URL 不计）。
- 测试文件禁止放在任何 `src` 目录下：包级测试放该包的 `test/`，仓库级集成/架构测试放根 `tests/`，命名 `.test.ts` 或 `.spec.ts`。
- 提交使用 Conventional Commits（commitlint + husky 强制）。

## 发布安全

未经人类明确批准，禁止执行 `git commit`、`git tag`、`npm publish`、`pnpm publish` 或任何发布自动化。
