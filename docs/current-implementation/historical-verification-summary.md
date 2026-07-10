# JWord 历史验证摘要归档

> 快照日期：2026-07-07。
> 本文对应 `JW-BACKLOG-007`。本文只保留当前代码、当前 fixture、当前 SDK 文档和当前验证入口仍能核对的审计结论，不依赖已删除的历史计划或过程文档。

## 结论索引

| 主题 | 保留结论 | 当前状态 | 当前事实入口 |
| --- | --- | --- | --- |
| 发布前命令矩阵 | 当前 checkout 已完成基础质量、第三方 tarball smoke、体积、视觉、三浏览器 E2E、perf E2E 和 benchmark fresh run。首次 E2E 暴露 Firefox 全选选区渲染红灯，已通过全文选择前刷新 layout 收口。 | 已验证 | `docs/current-implementation/verification-2026-07-07.md`、`packages/core/src/editor/runtime-selection.ts`、`examples/vanilla/tests/gate3-input-keyboard.e2e.ts`、`docs/sdk/stable-e2e-matrix.md` |
| 第三方 no-alias 消费 | 本地 tarball 可安装到第三方空项目，并完成 typecheck、Vite build 和 Chromium smoke；该路径不使用 monorepo alias。 | 已验证 | `tools/release/check-gate7-third-party-smoke.mjs`、`docs/current-implementation/verification-2026-07-07.md`、`docs/sdk/stable-e2e-matrix.md` |
| 真实 publish 边界 | 当前只完成 release dry-run 和 tarball smoke；所有 package manifest 仍为 `private: true`，真实 registry publish 必须人工审批。 | 已审计，未发布 | `docs/current-implementation/release-metadata-audit.md`、`tools/release/gate7-release-dry-run.mjs`、`packages/*/package.json` |
| DOCX 自动兼容证据 | 当前 14 个 T1/T2 DOCX fixture 已通过 package graph、roundtrip diff 和 Open XML validator 自动检查。该结果不等同于桌面 Word 全兼容。 | 自动证据已验证 | `fixtures/docx/compatibility-results.json`、`tools/compat/run-gate5-docx-compatibility.mjs`、`docs/sdk/public-api.md`、`docs/sdk/advanced-formats.md` |
| Microsoft Word 人工证据 | 当前 Microsoft Word 桌面版 14 个 fixture 仍为 `pending/not-run`。历史非 Word 辅助证据不再进入当前 runner、fixture matrix 或发布验收口径。 | 仍需补证 | `fixtures/docx/compatibility-results.json`、`docs/current-implementation/backlog.md#jw-backlog-002microsoft-word-桌面兼容证据docx--doc-边界`、`fixtures/docx/evidence-templates/manual-compatibility-results.template.json` |
| 屏幕阅读器人工验证 | 当前已有 axe-core serious/critical 扫描和键盘 smoke；这些自动化不能替代 VoiceOver、NVDA/JAWS 等真实朗读验证。 | 待人工复验 | `tests/e2e/a11y-axe.ts`、`examples/vanilla/tests/gate4-a11y.e2e.ts`、`examples/collab/tests/collab-a11y.e2e.ts`、`docs/current-implementation/backlog.md#jw-backlog-001屏幕阅读器人工验证矩阵`、`docs/current-implementation/screen-reader-manual-verification.md`、`docs/sdk/browser-support.md` |
| 窄屏适配边界 | 窄屏只是同一套桌面 Web 编辑器的响应式视口适配，只承诺分页 canvas 可滚动、可阅读、页面不空白，toolbar 不遮挡正文；不建立独立移动端 editor、platform 或输入链路。 | 边界已收口 | `docs/sdk/browser-support.md`、`docs/current-implementation/sdk/browser-and-e2e.md`、`examples/vanilla/tests/gate4-paste-narrow-viewport.e2e.ts`、`examples/vanilla/tests/gate4.visual.ts` |
| Plugin / decorations / observability | 当前实现已有 plugin host、toolbar/menu 扩展、decorations 和 diagnostics/telemetry 入口；评审结论是不升为 1.0 stable，继续作为 experimental 或内部试用能力。 | 已评审，保持 experimental | `docs/current-implementation/api-stability-review.md`、`docs/sdk/public-api.md`、`packages/core/src/plugins/*`、`packages/ui/src/toolbar/plugin-extensions.ts` |
| 浏览器支持口径 | 对外最低版本是 Chrome/Edge 114+、Firefox 115 ESR+、Safari 16.4+，构建 target 为 ES2022；Playwright 最新版三浏览器矩阵用于回归，不等同最低版本实验室认证。 | 已文档化 | `docs/sdk/browser-support.md`、`playwright.config.ts`、`tests/architecture/gate7-browser-support.test.ts` |

## 红灯与收口原因

### Firefox 全选选区渲染

- 现象：首次长矩阵 `pnpm test:e2e` 中，Firefox 用例 `Gate 3 runtime keeps keyboard Enter and select-all working after clicking page whitespace` 的 `selectionPixels` 为 `0`。
- 当前修复：`packages/core/src/editor/runtime-selection.ts` 在 `selectAllTextFromRuntime()` 提交 selection 前调用 `ensureCurrentLayout()`。
- 保留原因：该问题说明全文选择依赖当前 layout；如果未来重写 selection 或 incremental layout，必须保留“选区渲染前 layout 不可陈旧”的约束。
- 当前证据：`docs/current-implementation/verification-2026-07-07.md`、`examples/vanilla/tests/gate3-input-keyboard.e2e.ts`。

### Bundle size 临界收口

- 现象：Firefox 修复的中间条件判断版让 vanilla 首屏体积达到 `700021 > 700000`。
- 当前修复：收敛为一次直接 `ensureCurrentLayout()` 调用，最终首屏体积 `699953`，低于当前 `700000` 预算。
- 保留原因：Gate 7 体积预算很接近阈值，后续改动不能只看功能通过，还要继续跑 `pnpm size`。
- 当前证据：`docs/current-implementation/verification-2026-07-07.md`、`tools/size/check-size.mjs`。

## 不得对外扩大宣称的边界

| 领域 | 当前可以说 | 当前不能说 | 下一步入口 |
| --- | --- | --- | --- |
| 发布 | dry-run、tarball smoke、no-alias 第三方消费已通过。 | 已经 npm/registry 发布、可直接 publish、已完成 token/2FA/provenance/rollback。 | `docs/current-implementation/release-metadata-audit.md` |
| DOCX | 14 个 fixture 的自动 Open XML / package graph / roundtrip diff 已通过；Microsoft Word 桌面人工证据仍未完成。 | Microsoft Word 桌面版已完成兼容验证、`.doc` 已作为 JWord import/export 格式支持。 | `JW-BACKLOG-002` |
| a11y | 已有 axe-core serious/critical 扫描和键盘 smoke。 | 屏幕阅读器人工矩阵已通过、真实朗读顺序已验证。 | `JW-BACKLOG-001` |
| 窄屏 | 同一 Web 编辑器下的响应式预览和 toolbar 适配。 | 独立移动端编辑器、独立只读模式、独立触控输入链路。 | `docs/sdk/browser-support.md` |
| plugin / observability | 有实验性扩展和观测入口。 | 1.0 stable 插件写模型、自定义 operation union 或稳定 telemetry contract。 | `docs/current-implementation/api-stability-review.md`、`JW-ROADMAP-008` |

## 删除旧资料后的核对路径

1. 查当前能力：`docs/current-implementation/README.md`。
2. 查当前 backlog：`docs/current-implementation/backlog.md`。
3. 查发布前验证：`docs/current-implementation/verification-2026-07-07.md`。
4. 查发布边界：`docs/current-implementation/release-metadata-audit.md`。
5. 查浏览器、窄屏和 a11y 边界：`docs/sdk/browser-support.md`、`docs/sdk/stable-e2e-matrix.md`。
6. 查 DOCX/PDF 兼容边界：`docs/sdk/advanced-formats.md`、`docs/sdk/public-api.md`、`fixtures/docx/compatibility-results.json`。DOCX 是当前实现格式；`.doc` 仅作为 Word 另存人工观察边界。
7. 查工程约束证据：`docs/current-implementation/engineering-constraints.md`。

## 当前仍未闭环的历史补证项

- `JW-BACKLOG-001`：屏幕阅读器人工验证矩阵。
- `JW-BACKLOG-002`：Microsoft Word 桌面兼容证据（DOCX / DOC 边界）。
- `JW-BACKLOG-006` 的真实发布部分：dry-run 已完成，但真实 registry publish 仍需要人工审批；当前不把真实 publish 作为自动化完成项。
