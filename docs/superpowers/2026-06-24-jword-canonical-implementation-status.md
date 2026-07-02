# JWord Canonical Implementation 当前完成度审计报告

审计时间：2026-06-24

审计对象：

- 计划文档：`docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`
- 当前 checkout：`/Users/jian/Desktop/study/JWord`
- 代码、测试、示例、脚本、架构测试和计划内历史验收记录

## 结论摘要

当前项目不是最终完成状态。按 canonical plan 的 Gate 划分，当前代码最合理的阶段判断是：

- Gate 0-2：实现证据完整，属于基本完成，仍需要在当前机器 fresh run 验证。
- Gate 3：核心功能完成，但 Alpha 性能目标仍未完成，不能算完全完成。
- Gate 4：企业文档基础能力基本完成，仍有 fixture 与浏览器矩阵补证风险。
- Gate 4.5：`.jword` 原生保存/打开基本完成，已有包、示例、E2E、pack、size、benchmark 证据。
- Gate 5：DOCX/PDF 商业高级格式互通在 WPS-only 口径下基本完成；Open XML validator、Word、LibreOffice 是 pending/not-run，不应写成已通过。
- Gate 6：协作、离线、历史、自动插入、server、授权和商业包边界基本完成。
- Gate 7：只完成 Public API catalog 的最小闭环，React/Vue wrapper、Plugin API、Devtools、文档站、release dry-run、外部空项目总体验收和 Stable E2E 仍未完成。

因此当前整体处于“Gate 6 基本收口，Gate 7 刚开始”的阶段。不能宣称 `1.0-stable` 或 canonical plan 最终完成。

## 审计口径

本轮以只读审计为主，使用了主进程本地核对和子代理并行审查：

- Nash：Gate 0-2 静态审计完成。
- Hypatia：Gate 3-4 静态审计完成。
- Ptolemy：Gate 7 静态审计完成。
- Archimedes：模型容量错误，未作为证据。
- Hilbert：等待 5 分钟未返回，未作为证据。

本轮没有运行 `pnpm install`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`、Playwright、benchmark 或 Kimi WebBridge。因此本文里的“完成度”是基于当前文件证据、计划历史记录和子代理静态审计的实现完成度，不等于当前机器 fresh verification 已通过。

## 总览表

| Gate | 当前完成度 | 当前判断 | 主要未完成/风险 |
| --- | ---: | --- | --- |
| Gate 0 工程基座 | 96% | 基本完成 | 当前机器未 fresh run；`examples/vanilla/README.md` 仍有旧绝对路径；依赖 latest 核验记录未单独找到 |
| Gate 1 权威状态模型与事务 | 94% | 基本完成 | 计划里的 Gate 1 禁止事项状态与实现证据不完全同步；需跑 public API/architecture 检查确认所有编辑入口走事务管线 |
| Gate 2 分页 Layout 与 Canvas Render | 95% | 基本完成 | 浏览器、visual、benchmark 未在本轮实跑；benchmark 需先 `pnpm build` |
| Gate 3 输入与基础编辑 | 88% | 部分完成 | Step 3.13 性能目标仍未完成；验收复选框有文档状态不一致 |
| Gate 4 块级结构与企业基础能力 | 93% | 基本完成 | 独立 replace resource fixture 不完整；后半段企业能力三浏览器矩阵不足；DOMPurify 粘贴需持续 XSS 回归 |
| Gate 4.5 原生保存与打开 | 97% | 基本完成 | 本轮未 fresh run；Gate 7 文档站仍需正式 `.jword` 格式文档 |
| Gate 5 DOCX/PDF 互通 | 96% | WPS-only 口径下基本完成 | Word/LibreOffice/Open XML validator 仍是 pending/not-run；正式文档站归 Gate 7 |
| Gate 6 协作与商业能力 | 96% | 基本完成 | 本轮未 fresh run；Gate 7 wrapper/plugin/devtools/docs/release 不包含在 Gate 6 完成范围 |
| Gate 7 SDK 稳定化 | 5% | 刚开始 | Step 7.2-7.24 未完成；缺 React/Vue/devtools 包和示例；不能宣称 stable |

## 当前仓库结构核对

已存在的核心包：

- `packages/core`
- `packages/ui`
- `packages/native`
- `packages/docx`
- `packages/pdf`
- `packages/license`
- `packages/collab`
- `packages/collab-server`
- `packages/persistence`

未发现的 Gate 7 包：

- `packages/react`
- `packages/vue`
- `packages/devtools`

已存在的示例：

- `examples/vanilla`
- `examples/docx`
- `examples/collab`

未发现的 Gate 7 示例：

- `examples/react`
- `examples/vue`

已存在的关键验证脚本：

- `tools/release/check-native-pack.mjs`
- `tools/release/check-gate5-commercial-pack.mjs`
- `tools/release/check-gate5-third-party-smoke.mjs`
- `tools/release/check-gate6-commercial-pack.mjs`
- `tools/release/check-gate6-third-party-smoke.mjs`
- `tools/compat/run-gate5-docx-compatibility.mjs`
- `tools/size/check-native-bundle.mjs`
- `tools/size/check-gate6-collab-bundle.mjs`
- `tools/visual/run-visual.mjs`
- `benchmarks/gate2-render-benchmark.mjs`
- `benchmarks/gate45-native-benchmark.mjs`
- `benchmarks/gate5-interop-benchmark.mjs`
- `benchmarks/gate6-collab-benchmark.mjs`

根 `package.json` 也已提供 `lint`、`typecheck`、`test`、`test:e2e`、`test:visual`、`build`、`dev`、`bench`、`size` 等脚本。

## Gate 0 - 工程基座

计划要求：建立 pnpm monorepo、严格 TypeScript/ESLint、Rollup/Vitest/Playwright/CI、vanilla demo、fixtures、benchmarks、架构边界测试和开发者文档。

完成度：96%。

当前证据：

- `package.json`、`pnpm-workspace.yaml`、`tsconfig.base.json`、`eslint.config.js`、`rollup.config.mjs`
- `vitest.config.ts`、`playwright.config.ts`、`.github/workflows/ci.yml`
- `tests/architecture/core-boundary.test.ts`
- `examples/vanilla`
- `fixtures/README.md`
- `benchmarks/README.md`
- `tools/dev/run-dev.mjs`

未完成/风险：

- 本轮没有执行安装、构建和测试，不能证明当前机器 fresh pass。
- `examples/vanilla/README.md` 仍有旧 checkout 绝对路径 `/Users/jian/Desktop/tools/JWord/...`，与当前 `/Users/jian/Desktop/study/JWord` 不一致。
- Step 0.1 要求记录 npm registry latest 核验，本轮未找到独立的核验记录；只能确认依赖版本被精确锁定。

建议验证：

```sh
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @4xian/jword-example-vanilla build
```

后续任务：

- 修正 demo README 里的旧绝对路径。
- 补充或归档依赖 latest 核验记录。
- 把 fresh verification 输出归档到当前审计或 PR 记录中。

## Gate 1 - 权威状态模型与事务

计划要求：Y.Doc 是唯一可写真源，`DocumentProjection` 只读派生，所有变更走 Command -> Operation -> Transaction Pipeline，并覆盖 schema、位置模型、operation adapter、transaction、projection、selection、history、facade、fixture、属性测试和错误码。

完成度：94%。

当前证据：

- `packages/core/src/model/types.ts`
- `packages/core/src/model/document-store.ts`
- `packages/core/src/model/position.ts`
- `packages/core/src/model/projection.ts`
- `packages/core/src/operations/transaction.ts`
- `packages/core/src/operations/operation-adapter.ts`
- `packages/core/src/operations/history.ts`
- `packages/core/src/editor/facade-runtime.ts`
- `packages/core/src/editor/runtime.ts`
- `packages/core/test/model/*`
- `packages/core/test/operations/*`
- `packages/core/test/editor/facade-runtime.test.ts`
- `fixtures/operation-fixtures/gate1-minimal-edit.json`

未完成/风险：

- 计划中 Gate 1 禁止事项仍有未同步痕迹，和实现证据不完全一致。
- 需要用架构测试和 public API 检查继续证明没有第二套可写 model、没有公开临时 path/字符 offset、没有 demo 绕过 transaction pipeline。

建议验证：

```sh
pnpm exec vitest run \
  packages/core/test/model/document-store.test.ts \
  packages/core/test/model/projection.test.ts \
  packages/core/test/model/position.test.ts \
  packages/core/test/model/selection.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/operations/operation-adapter.test.ts \
  packages/core/test/operations/operation-fixture.test.ts \
  packages/core/test/operations/operation-property.test.ts \
  packages/core/test/operations/history.test.ts \
  packages/core/test/editor/facade-runtime.test.ts \
  --reporter=dot
```

后续任务：

- 同步 Gate 1 禁止事项文档状态。
- 补或运行导出面检查，确认所有外部编辑入口都走 transaction pipeline。

## Gate 2 - 分页 Layout 与 Canvas Render

计划要求：从第一版渲染开始使用分页 Canvas，建立 LayoutBox 边界，实现 page config、FontManager、字素切分、line/page breaking、dirty scheduler、每页 canvas、viewport virtualizer、canvas pool、hit-test、rect mapping、debug overlay、visual baselines 和 render benchmark。

完成度：95%。

当前证据：

- `packages/core/src/layout/*`
- `packages/core/src/canvas/*`
- `packages/core/test/layout/*`
- `packages/core/test/canvas/*`
- `tests/gate2-fixture.test.ts`
- `examples/vanilla/tests/gate2.e2e.ts`
- `examples/vanilla/tests/gate2.visual.ts`
- `examples/vanilla/tests/gate2.perf.e2e.ts`
- `benchmarks/gate2-render-benchmark.mjs`
- `fixtures/plain-text/gate2-*.txt`
- `fixtures/visual-baselines/gate2-*.json`

未完成/风险：

- 本轮未实跑 Vitest、Playwright、visual 和 benchmark。
- `benchmarks/gate2-render-benchmark.mjs` 依赖构建产物，必须先 `pnpm build`。
- 性能阈值受机器环境影响，fresh run 时需要保留环境和指标。

建议验证：

```sh
pnpm exec vitest run \
  packages/core/test/layout/page-config.test.ts \
  packages/core/test/layout/font-manager.test.ts \
  packages/core/test/layout/runtime.test.ts \
  packages/core/test/layout/query.test.ts \
  packages/core/test/layout/scheduler.test.ts \
  packages/core/test/canvas/renderer.test.ts \
  packages/core/test/canvas/viewport-virtualizer.test.ts \
  packages/core/test/canvas/pool.test.ts \
  tests/gate2-fixture.test.ts \
  --reporter=dot

pnpm exec playwright test examples/vanilla/tests/gate2.e2e.ts examples/vanilla/tests/gate2.visual.ts examples/vanilla/tests/gate2.perf.e2e.ts --project=chromium --project=perf-chromium --reporter=line
pnpm build && node benchmarks/gate2-render-benchmark.mjs
```

后续任务：

- 跑 Gate 2 focused Vitest、Chromium Playwright 和 benchmark。
- 如果 perf 抖动，先记录环境与真实指标，再决定是否优化或调整阈值。

## Gate 3 - 输入与基础编辑

计划要求：完成 `0.1-alpha` 基础编辑闭环，包括 mount/destroy、hidden textarea、IME/composition、keyboard、pointer selection、plain text clipboard、基础 commands、toolbar、toolbar 状态、aria-live/text mirror、错误恢复、E2E 和性能验证。

完成度：88%。

当前证据：

- `packages/core/src/editor/input-runtime.ts`
- `packages/core/src/editor/text-editing-runtime.ts`
- `packages/core/src/editor/clipboard-runtime.ts`
- `packages/core/src/editor/pointer-runtime.ts`
- `packages/core/src/editor/mount-facade-runtime.ts`
- `packages/ui/src/toolbar/*`
- `packages/ui/src/assistive/live-region.ts`
- `packages/ui/src/assistive/text-mirror.ts`
- `packages/core/test/editor/input-runtime.test.ts`
- `packages/core/test/editor/facade-runtime.test.ts`
- `packages/core/test/operations/command-builders.test.ts`
- `examples/vanilla/tests/gate3-input.e2e.ts`
- `examples/vanilla/tests/gate3-toolbar.e2e.ts`
- `examples/vanilla/tests/gate3.perf.e2e.ts`
- `examples/vanilla/tests/gate3.visual.ts`

未完成/风险：

- Step 3.13 仍是未完成：Alpha 性能验证没有达成计划里“输入热路径 P95 < 50ms / INP P95 < 150ms”的完成定义。
- 当前 `gate3.perf.e2e.ts` 的 `largeDocumentInsertP95Ms <= 140ms` 更像退化护栏，不能等价为 Alpha 性能完成。
- Gate 3 验收区中上标/下标、段落格式、列表/Heading 有文档状态未同步风险；代码和测试已有证据，但计划复选框不完全一致。

建议验证：

```sh
pnpm vitest run packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/facade-runtime.test.ts packages/core/test/operations/command-builders.test.ts --maxWorkers=1
pnpm playwright test examples/vanilla/tests/gate3-input.e2e.ts examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium --workers=1
pnpm playwright test examples/vanilla/tests/gate3.perf.e2e.ts --project=perf-chromium --workers=1
```

后续任务：

- 单独建立 Gate 3 性能收口任务：要么继续优化到计划阈值，要么正式修改 Alpha 完成定义。
- 同步 Gate 3 验收复选框，避免计划状态和实现状态继续分叉。

## Gate 4 - 块级结构与企业文档基础能力

计划要求：实现图片、资源表、表格、批注、链接、目录、查找替换、页眉页脚、页码、修订 metadata、DOMPurify 保格式粘贴、移动分页预览，以及 Beta 前半段 E2E 和视觉回归。

完成度：93%。

当前证据：

- 图片/资源：`packages/core/src/resources/*`、`packages/core/src/model/image-target.ts`、`packages/ui/src/media/*`
- 表格：`packages/core/src/operations/table-operation-adapter.ts`、`packages/ui/src/table/*`
- 批注：`packages/core/src/operations/comment-command-builders.ts`、`packages/ui/src/comments/*`
- 链接：`packages/core/src/operations/link-command-builders.ts`、`packages/ui/src/link/*`
- 目录/查找替换：`packages/core/src/heading/outline.ts`、`packages/core/src/find-replace/find-replace.ts`
- 页眉页脚/页码：`packages/core/src/operations/section-command-builders.ts`、`packages/ui/src/header-footer/*`
- 修订：`packages/core/src/operations/revision-command-builders.ts`、`packages/ui/src/revisions/*`
- 粘贴/移动：`packages/ui/src/paste/*`
- E2E：`examples/vanilla/tests/gate4-*.e2e.ts`
- visual/perf：`examples/vanilla/tests/gate4.visual.ts`、`examples/vanilla/tests/gate4.perf.e2e.ts`

未完成/风险：

- 图片替换路径有 E2E，但独立 `replace resource` fixture 不完整。
- 后半段企业能力主要是 Chromium 串行收口，Firefox/WebKit 全量矩阵不足。
- DOMPurify 粘贴使用 sanitized HTML 再解析，必须持续保留 XSS 回归。
- remote cursor 不应算 Gate 4 缺口，它属于 Gate 6 协作语义。

建议验证：

```sh
pnpm vitest run packages/ui/test/paste-sanitizer.test.ts packages/ui/test/create-ui-header-footer.test.ts packages/core/test/operations/revision-command-builders.test.ts packages/core/test/find-replace/find-replace.test.ts --maxWorkers=1
pnpm playwright test examples/vanilla/tests/gate4-media.e2e.ts examples/vanilla/tests/gate4-table.e2e.ts examples/vanilla/tests/gate4-comments-link.e2e.ts examples/vanilla/tests/gate4-header-footer.e2e.ts examples/vanilla/tests/gate4-structure-find.e2e.ts examples/vanilla/tests/gate4-revisions.e2e.ts examples/vanilla/tests/gate4-paste-mobile.e2e.ts --project=chromium --workers=1
pnpm test:visual
pnpm playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium --workers=1
```

后续任务：

- 补独立 `replace resource` fixture，并纳入 fixture registry。
- 给 paste sanitizer、header-footer、revisions、mobile viewport 补 Firefox/WebKit smoke。
- 保留 script、event handler、dangerous URL、空 HTML fallback 等 XSS 回归。

## Gate 4.5 - JWord 原生保存与打开

计划要求：冻结 `.jword` 包结构和 manifest schema，建立 `@4xian/jword-native` 公开类型、worker message、diagnostics、fixture registry，实现保存/打开 roundtrip、资源打包、checksum、migration、示例集成、benchmark、bundle gate、format spec 文档计划和 release dry-run 检查。

完成度：97%。

当前证据：

- `packages/native`
- `packages/native/test`
- `examples/vanilla/src/demo-native.ts`
- `examples/vanilla/src/native-worker.ts`
- `examples/vanilla/tests/gate4_5-native.e2e.ts`
- `examples/vanilla/tests/gate4_5-native-boundary.test.ts`
- `tests/architecture/gate45-native-boundary.test.ts`
- `tests/architecture/gate45-native-bundle.test.ts`
- `tests/architecture/gate45-native-release.test.ts`
- `tests/architecture/gate45-native-benchmark.test.ts`
- `tools/release/check-native-pack.mjs`
- `tools/size/check-native-bundle.mjs`
- `benchmarks/gate45-native-benchmark.mjs`

未完成/风险：

- 本轮未 fresh run。
- `.jword` 正式格式文档仍属于 Gate 7 文档站范围，不能把 Gate 4.5 的“文档计划”写成 Gate 7 文档已完成。

建议验证：

```sh
pnpm --filter @4xian/jword-native test
pnpm --filter @4xian/jword-native typecheck
pnpm --filter @4xian/jword-native build
node tools/size/check-native-bundle.mjs
node tools/release/check-native-pack.mjs
node benchmarks/gate45-native-benchmark.mjs
pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate45-native-benchmark.test.ts examples/vanilla/tests/gate4_5-native-boundary.test.ts
pnpm exec playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium --reporter=line
```

真实浏览器建议：

- 用 Kimi WebBridge 打开 `examples/vanilla` demo。
- 验证 `.jword` 保存、打开、继续编辑、再次保存。
- 验证图片资源保存、缺失资源 warning、损坏文件 error 和取消保存。

后续任务：

- 在 Gate 7 中落地正式 `.jword` 格式文档、warning 文档、migration 文档和 API 示例。

## Gate 5 - 商业高级格式互通：DOCX 导入导出与 PDF 导出

计划要求：建立 DOCX/PDF 高级包、worker runtime、授权检查、fixture registry、DOCX import/export、PDF export、diagnostics、兼容性报告、WPS-only 真实验收、商业 pack 检查和第三方高级包 smoke。

完成度：96%。

当前证据：

- `packages/docx`
- `packages/pdf`
- `packages/license`
- `examples/docx`
- `fixtures/docx`
- `fixtures/pdf`
- `tools/compat/run-gate5-docx-compatibility.mjs`
- `tools/release/check-gate5-commercial-pack.mjs`
- `tools/release/check-gate5-third-party-smoke.mjs`
- `benchmarks/gate5-interop-benchmark.mjs`
- `tests/architecture/gate5-*`

关键口径：

- 当前 Gate 5 是 WPS-only 兼容验收。
- Open XML validator、Microsoft Word、LibreOffice 保留在报告 schema 与 pending/not-run 记录中，不作为 Gate 5 当前完成阻塞项。
- 不能把 Word/LibreOffice/Open XML validator 写成已通过。

未完成/风险：

- 本轮未 fresh run。
- 正式文档站、授权接入文档、付费能力边界文档仍归 Gate 7。
- 若未来把兼容验收从 WPS-only 扩展到 Word/LibreOffice/Open XML validator，需要重新开验收任务。

建议验证：

```sh
pnpm --filter @4xian/jword-license test
pnpm --filter @4xian/jword-docx test
pnpm --filter @4xian/jword-pdf test
pnpm --filter @4xian/jword-license typecheck
pnpm --filter @4xian/jword-docx typecheck
pnpm --filter @4xian/jword-pdf typecheck
node tools/compat/run-gate5-docx-compatibility.mjs
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate5-third-party-smoke.mjs
node benchmarks/gate5-interop-benchmark.mjs
pnpm exec playwright test examples/docx/tests/gate5-docx-demo.e2e.ts --project=chromium --reporter=line
```

真实浏览器建议：

- 用 Kimi WebBridge 验证 DOCX 导入后进入 canonical editor，可继续编辑。
- 验证 DOCX export、PDF export、worker progress/cancel。
- 验证未授权和 feature mismatch 路径，不允许 worker 在授权前读取 ZIP 或执行高级导出。

后续任务：

- 保持 WPS-only 证据与 pending/not-run 矩阵清晰分离。
- Gate 7 中补 Gate 5 对外文档、授权文档、warning schema、fixture 验收说明和按需加载说明。

## Gate 6 - 协作、离线、历史、自动插入与商业 server

计划要求：实现商业协作 client、self-host server、授权、版本握手、remote cursor、typing activity、offline queue、history、auto-insert、server-backed history、第三方公开 API 集成、商业 pack、bundle gate、diagnostics registry 和 benchmark。

完成度：96%。

当前证据：

- `packages/collab`
- `packages/collab-server`
- `packages/persistence`
- `packages/license`
- `examples/collab`
- `examples/collab/tests/*`
- `tests/architecture/gate6-*`
- `tools/release/check-gate6-commercial-pack.mjs`
- `tools/release/check-gate6-third-party-smoke.mjs`
- `tools/size/check-gate6-collab-bundle.mjs`
- `benchmarks/gate6-collab-benchmark.mjs`

未完成/风险：

- 本轮未 fresh run。
- Gate 7 的 React/Vue wrapper、Plugin API、Devtools、文档站、diagnostics export、总 release dry-run 不属于 Gate 6 完成范围。
- 需要持续保护 public API only 集成，不允许 demo/test 重新依赖 monorepo 内部路径或隐藏 textarea 时代的测试入口。

建议验证：

```sh
pnpm --filter @4xian/jword-collab test
pnpm --filter @4xian/jword-collab-server test
pnpm --filter @4xian/jword-persistence test
pnpm --filter @4xian/jword-collab typecheck
pnpm --filter @4xian/jword-collab-server typecheck
pnpm --filter @4xian/jword-persistence typecheck
pnpm --filter @4xian/jword-example-collab typecheck
pnpm exec vitest run tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-import-graph.test.ts tests/architecture/gate6-bundle-gate.test.ts tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-fixture-registry.test.ts
node tools/release/check-gate6-commercial-pack.mjs
node tools/release/check-gate6-third-party-smoke.mjs
node tools/size/check-gate6-collab-bundle.mjs
node benchmarks/gate6-collab-benchmark.mjs
pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts examples/collab/tests/collab-handshake.e2e.ts examples/collab/tests/collab-history-api.e2e.ts examples/collab/tests/collab-auto-insert-concurrency.e2e.ts examples/collab/tests/collab-docx-provider-history.e2e.ts examples/collab/tests/collab-visible-editor.e2e.ts --project=chromium --reporter=line
```

真实浏览器建议：

- 用 Kimi WebBridge 验证两个真实浏览器页面、两个 user、同一 room、同一 documentId 的同步。
- 验证 offline queue、history restore、auto-insert 不抢光标、本地用户和远端用户并发输入。
- 验证未授权、feature mismatch、server/client version mismatch 和 metadata-first 授权失败路径。

后续任务：

- 继续保持 collab demo 只通过公开包入口和 visible editor 用户行为验收。
- Gate 7 中补正式文档、wrapper、plugin、diagnostics export 和外部空项目总体验收。

## Gate 7 - SDK 稳定化、公开文档与商业交付

计划要求：交付可集成、可诊断、可维护、可销售的 `1.0-stable` SDK。外部项目能选择 vanilla、React、Vue 集成，能使用免费基础编辑和 `.jword` 原生保存/打开，也能授权接入 DOCX/PDF、协作、离线、历史、自动插入和 self-host server。

完成度：5%。

当前证据：

- `docs/sdk/public-api.md`
- `tests/architecture/gate7-public-api-catalog.test.ts`

当前已完成：

- Step 7.1：公开 API 清单最小闭环。
- API catalog 已明确 React/Vue/devtools 是 future/unimplemented，避免误标 stable。

明确未完成：

- Step 7.2：API 导出审计和类型测试。
- Step 7.3：稳定 API TSDoc、最小示例、diagnostics payload 文档。
- Step 7.4：免费基础版 quickstart。
- Step 7.5-7.6：Plugin API 和插件错误隔离。
- Step 7.7-7.8：React wrapper、Vue 3 wrapper。
- Step 7.9：主题系统和 i18n。
- Step 7.10：Devtools 面板。
- Step 7.11：diagnostics export。
- Step 7.12：vanilla/react/vue/native/docx/collab/performance examples 完善。
- Step 7.13-7.18：`.jword`、Gate 5、Gate 6、server、授权、文档站信息架构。
- Step 7.19：size-limit 和 bundle 分析。
- Step 7.20：release dry-run。
- Step 7.21：外部空项目集成验收。
- Step 7.22：迁移指南和兼容策略。
- Step 7.23：商业支持诊断包规范。
- Step 7.24：Stable E2E 矩阵。

建议验证当前已完成的最小范围：

```sh
pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose
```

后续任务：

1. 先做 Step 7.2-7.3：冻结 API 导出审计、类型测试、TSDoc、diagnostics payload。
2. 再做 Step 7.4 与 Step 7.13-7.18：免费 quickstart、`.jword`、Gate 5、Gate 6、server、授权和文档站信息架构。
3. 然后实现 Plugin API、插件错误隔离、diagnostics export。
4. 再实现 React/Vue wrapper、对应 examples、theme/i18n。
5. 最后做 Devtools、size-limit、release dry-run、外部空项目集成、迁移指南、商业支持诊断包和 Stable E2E 矩阵。

## 已完成阶段建议测试矩阵

### 最小全局回归

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

### 浏览器与视觉回归

```sh
pnpm test:e2e
pnpm test:visual
```

### 发布、包边界与体积

```sh
node tools/size/check-native-bundle.mjs
node tools/release/check-native-pack.mjs
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate5-third-party-smoke.mjs
node tools/release/check-gate6-commercial-pack.mjs
node tools/release/check-gate6-third-party-smoke.mjs
node tools/size/check-gate6-collab-bundle.mjs
pnpm size
```

### Benchmark

```sh
pnpm build
node benchmarks/gate2-render-benchmark.mjs
node benchmarks/gate45-native-benchmark.mjs
node benchmarks/gate5-interop-benchmark.mjs
node benchmarks/gate6-collab-benchmark.mjs
pnpm bench
```

### Kimi WebBridge 真实浏览器 smoke

建议至少覆盖：

- `examples/vanilla`：基础编辑、toolbar、`.jword` 保存/打开/继续编辑/再次保存。
- `examples/docx`：DOCX import、继续编辑、DOCX export、PDF export、未授权失败、feature mismatch。
- `examples/collab`：双页面协作、远端光标、typing label、offline queue、history、auto-insert 不抢光标、server 授权失败。
- Gate 7 后续新增后：React wrapper、Vue wrapper、Plugin API、Devtools、diagnostics export、外部空项目安装。

## 后续优先级

### P0：先补当前完成阶段的 fresh verification

- 运行 Gate 0-6 focused tests、pack、bundle、benchmark 和浏览器 smoke。
- 保存输出，避免只依赖计划里的历史记录。
- 若失败，按失败 Gate 单独开修复任务，不要混入 Gate 7 实现。

### P1：收口 Gate 3 性能定义

- 明确是否继续追 `P95 < 50ms / INP < 150ms`。
- 如果继续追，先建立稳定 profiling 和指标采集，再优化输入热路径。
- 如果不追，必须修改 canonical plan 的 Alpha 完成定义，不能让未完成 Step 长期悬空。

### P1：同步计划状态与实现状态

- Gate 1 禁止事项。
- Gate 3 验收复选框。
- Gate 4 fixture registry。
- Gate 5 WPS-only / pending-not-run 口径。

### P2：正式进入 Gate 7

Gate 7 不建议从 React/Vue wrapper 直接开始。更稳的顺序是：

1. API export audit + type tests。
2. TSDoc + diagnostics payload 文档。
3. 免费 quickstart + `.jword` 文档。
4. Gate 5/Gate 6/授权/server 文档。
5. Plugin API + diagnostics export。
6. React/Vue wrapper + examples。
7. Devtools。
8. release dry-run + 外部空项目 + Stable E2E。

## 最终判断

当前项目已经把 canonical plan 的主体实现推进到 Gate 6 基本收口；Gate 4.5、Gate 5、Gate 6 的代码和验证脚本证据尤其强。但最终版本仍未完成，原因是 Gate 7 只有 Public API catalog 最小闭环，稳定 SDK、公开文档、wrapper、plugin、devtools、release dry-run 和外部空项目验收还没有落地。

下一步不应宣称 `1.0-stable`。应先补 Gate 0-6 当前 checkout 的 fresh verification，再按 Gate 7 的 API-first 顺序推进稳定化。
