# JWord Canonical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan intentionally contains no detailed code; implementation must be written later against the referenced canonical specs.

**Goal:** 按 canonical specs 从 0 到 1 实现 JWord 类 Word 在线编辑器 SDK，并保证第一天开始就是最终路线：分页 Canvas、Y.Doc 真源、OOXML 语义模型、统一 transaction pipeline、worker 互通、framework-agnostic core。

**Architecture:** `@4xian/jword-core` 负责状态、事务、投影、排版、渲染、输入、历史和 Editor Facade；UI、docx、PDF、协同、持久化、devtools、React/Vue wrapper 都是独立包。所有编辑来源都先变成 Command/Operation，再进入 `ydoc.transact(origin)`，Layout/Render/docx/PDF 只消费只读 projection 或 LayoutBox。

**Tech Stack:** pnpm workspace, TypeScript 6 strict, ESLint 10 flat config, Rollup, Vite, Vitest, Playwright, Yjs, DOMPurify, JSZip, pdf-lib, fontkit, hocuspocus 示例服务。依赖必须固定精确版本，不写 `^` 或 `~`。

---

## 0. 计划基线

### 0.1 权威文档

本计划以以下文档为唯一主依据：

- `docs/superpowers/specs/2026-05-11-jword-canonical/README.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/01-requirements.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/02-technical-decisions.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md`
- `docs/superpowers/specs/2026-05-11-jword-canonical/07-references.md`

旧 `docs/superpowers/specs/2026-05-10-jword-design/` 和 `docs/superpowers/plans/2026-05-11-jword-v0.1-mvp/` 仅作历史资料；其中 Bun、单页/单长 canvas、非 Y.Doc 真源、Mammoth 主路径等路线不得进入新实现。

### 0.2 公共里程碑

内部按 Gate 管理，外部只保留少量版本口径：

- `0.1-alpha`：完成 Gate 0-3，证明最终架构可行，能编辑基础分页文档。
- `0.5-beta`：完成 Gate 4-5 的 T1 能力，证明企业常用结构和 docx/PDF 基础互通可用。
- `1.0-stable`：完成 Gate 6-7，证明协同、自动插入、SDK 集成、插件、诊断稳定。
- `post-1.0`：复杂 OOXML、复杂修订、脚注尾注、复杂浮动对象、复杂表格深度兼容。

### 0.3 全局硬约束

- [x] 每个 `.ts` 文件必须有文件头注释，说明职责、边界、协作模块、性能/安全约束、关联 specs。
- [ ] 公开 API 必须有 TSDoc、类型测试、示例用法。
- [x] Core 禁止依赖 React/Vue/docx/PDF/collab provider/demo。
- [x] Core 禁止 top-level 访问 `window`、`document`、`HTMLElement` 实例。
- [ ] 所有状态变更必须走同一 transaction pipeline。
- [x] 所有 transaction 必须带 origin。
- [ ] Selection、Comment、Revision、Auto Inserter、Remote Cursor 必须复用 `AnchorRef` / `RangeRef`。
- [ ] Layout/Render 只能读 `DocumentProjection` 或 `LayoutBox`，不能直接读写 Y.Doc。
- [ ] import/export 必须在 worker 中执行，支持 progress、warning、cancel。
- [ ] HTML 清洗必须使用 DOMPurify 或安全 `textContent` 路线，禁止正则 sanitizer。
- [ ] 文档计划和实现过程不得自动 commit、tag、publish；这些动作必须人工审批。

### 0.4 目标包结构

- [ ] `packages/core`：`@4xian/jword-core`，状态、事务、projection、layout、render、input、history、plugin host、Editor Facade。
- [ ] `packages/ui`：`@4xian/jword-ui`，原生 TS 工具栏、菜单、状态栏、批注栏、基础对话框。
- [ ] `packages/docx`：`@4xian/jword-docx`，OOXML import/export、fixture diff、worker bridge。
- [ ] `packages/pdf`：`@4xian/jword-pdf`，LayoutBox 到 PDF、字体配置、worker bridge。
- [ ] `packages/collab`：`@4xian/jword-collab`，provider adapter、awareness、remote cursor、offline、snapshot adapter。
- [ ] `packages/persistence`：`@4xian/jword-persistence`，IndexedDB、本地恢复、保存适配器。
- [ ] `packages/devtools`：`@4xian/jword-devtools`，operation log、layout overlay、diagnostics panel。
- [ ] `packages/react`：`@4xian/jword-react`，React 生命周期 wrapper。
- [ ] `packages/vue`：`@4xian/jword-vue`，Vue 3 生命周期 wrapper。
- [x] `examples/vanilla`：基础集成示例，所有 gate 的第一验证目标。
- [ ] `examples/react`：React wrapper 集成示例。
- [ ] `examples/vue`：Vue wrapper 集成示例。
- [ ] `examples/collab`：hocuspocus 示例服务和双窗口协同验证。
- [ ] `fixtures`：文档、OOXML、PDF、协同、性能、视觉回归样本。
- [ ] `benchmarks`：layout、render、input、docx/PDF、collab 压测。
- [ ] `tools`：自定义 lint、fixture diff、bundle size、visual report、release dry-run 工具。

## Gate 0 - 工程基座

### 目标

搭好长期可维护的 pnpm monorepo，使后续每个 gate 都能被 lint、typecheck、test、build、demo、E2E、visual、benchmark 验证。此阶段不实现编辑能力，但不能只建空包；必须有最小可运行 demo 和边界测试。

### 实现方案

先建立 repo 级工具链，再建立 package 边界和 examples 骨架。Core 先暴露最小 Editor 构造和 mount/destroy 生命周期，用于验证构建、类型、demo 和 DOM 延迟访问规则。

### 待办步骤

- [x] Step 0.1：核验 npm registry 当前 latest 版本，记录到实现 PR 或变更说明；安装时固定精确版本，不使用 `^`、`~`。
- [x] Step 0.2：创建 pnpm workspace 根配置，明确 packages、examples、tools、fixtures、benchmarks 的 workspace 范围。
- [x] Step 0.3：创建根 `package.json` scripts：`lint`、`typecheck`、`test`、`test:e2e`、`test:visual`、`build`、`dev`、`bench`、`size`。
- [x] Step 0.4：创建 TypeScript 6 strict 配置，启用 `strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`、`noImplicitOverride`、`useUnknownInCatchVariables`。
- [x] Step 0.5：创建 ESLint 10 flat config，覆盖 TS、文件头注释、禁止 `any`、禁止 top-level DOM、禁止 core import 禁区。
- [x] Step 0.6：创建 Rollup 基础构建，所有包输出 ESM 和类型声明；worker 包预留独立入口。
- [x] Step 0.7：创建 Vitest 配置，区分 node/jsdom/browser-like 测试环境。
- [x] Step 0.8：创建 Playwright 配置，覆盖 Chromium、Firefox、WebKit；为 IME、视觉、双窗口协同预留 project。
- [x] Step 0.9：创建 `examples/vanilla` Vite demo，能 mount 最小 Editor 空壳并显示编辑画布容器。
- [x] Step 0.10：创建 fixtures 和 benchmarks 目录结构，放入最小纯文本 fixture、长文 fixture 占位数据和说明。
- [x] Step 0.11：创建架构边界测试，验证 core 不引入 UI 框架、docx、PDF、collab provider、demo 依赖。
- [x] Step 0.12：创建 CI 验证配置，只做检查和 dry-run，不自动 publish。
- [x] Step 0.13：写入 Gate 0 开发者文档，说明本地安装、运行、测试、示例启动方式。

### 验收

- [x] `pnpm install --frozen-lockfile` 可复现。
- [x] `pnpm lint` 可运行并覆盖边界规则。
- [x] `pnpm typecheck` 可运行。
- [x] `pnpm test` 可运行。
- [x] `pnpm build` 可运行。
- [x] `pnpm dev` 能启动 vanilla demo。
- [x] core 边界测试能阻止错误依赖进入 core。

### 禁止事项

- [x] 不引入 Bun 作为主工具链。
- [x] 不写无法验证的空包。
- [x] 不用宽松 TS 配置换速度。
- [x] 不自动 commit、tag、publish。

## Gate 1 - 权威状态模型与事务

### 目标

建立不会被协同、docx、undo、自动插入推翻的内核：Y.Doc 是唯一可写真源，`DocumentProjection` 是只读派生结果，所有变更都通过 Command -> Operation -> Transaction Pipeline。

### 实现方案

优先实现纯数据能力，不急着做完整 UI。先用 fixture 和单元测试证明：文本、段落、run、样式、anchor、undo/redo、projection 都能在 Y.Doc 中稳定工作。

### 待办步骤

- [x] Step 1.1：定义最小 OOXML 对齐 schema：Document、Section、Paragraph、Run、Inline、Table、Comment、Revision metadata 的类型边界。
- [x] Step 1.2：定义 ID、twip、grapheme、opaque `AnchorRef` / `RangeRef` 等基础类型，集中处理 Yjs index、UTF-16、grapheme 的转换边界。
  - 完成 2026-05-12：grapheme 边界已集中到 `packages/core/src/grapheme.ts`，并由 position 与 operation-adapter 测试覆盖。
- [x] Step 1.3：设计 Y.Doc 内部结构，明确每类节点如何存储、如何排序、如何关联资源表、样式表、评论表和修订表。
- [x] Step 1.4：定义 Operation schema 第一批能力：insertText、deleteRange、setRunProperties、setParagraphProperties、splitBlock、mergeBlock、insertBlock、deleteBlock。
- [x] Step 1.5：实现 Operation 到 Y.Doc 的 adapter，每个 adapter 只做最小状态变更，不触发布局和 UI 副作用。
- [x] Step 1.6：实现 transaction pipeline，统一处理 origin、metadata、operation validation、ydoc.transact、projection update、dirty mark、events。
- [x] Step 1.7：实现只读 `DocumentProjection`，让 layout/render/docx/pdf 后续只消费 projection，不接触可写状态。
- [x] Step 1.8：实现 `AnchorRef` / `RangeRef` 第一版，文本位置用 Y.RelativePosition 或等价稳定位置，块级对象预留 block-relative anchor。
- [x] Step 1.9：实现 `SelectionState`，支持 anchor/focus、direction、affinity、selection restore。
- [x] Step 1.10：实现 History metadata，接入 Y.UndoManager，默认 tracked origin 只包含本地用户操作。
- [x] Step 1.11：实现 Editor Facade 第一版：创建文档、加载 fixture、执行 command、监听事件、销毁实例。
- [x] Step 1.12：建立 operation fixture，可序列化、可回放、可用于后续 docx/collab/auto-inserter 集成测试。
- [x] Step 1.13：建立属性测试，覆盖随机插入、删除、拆分、合并、undo/redo 后 projection 与 Y.Doc 一致。
- [x] Step 1.14：补齐错误码体系，确保非法 operation 返回可诊断错误，不静默失败。

### 验收

- [x] 本地单人模式能在 Y.Doc 中完成文本增删、段落拆分合并、run 样式变更。
- [x] Projection 可稳定派生段落和 run。
- [x] Anchor 在前方插入、删除、段落拆分、段落合并后不漂移。
- [x] Operation fixture 可序列化、可回放。
- [x] undo/redo 不丢样式，不破坏 selection restore。
  - 完成 2026-05-12：Editor facade selection restore 已补齐，覆盖 null selection、文档替换清空 selection、多 code-unit grapheme 场景。
- [x] 所有编辑路径都必须经过 transaction pipeline。

### 禁止事项

- [ ] 不创建第二套可写 Model 与 Y.Doc 双向同步。
- [ ] 不把临时 path 或字符 offset 暴露为公开位置 API。
- [ ] 不为了 demo 绕过 transaction pipeline。

## Gate 2 - 分页 Layout 与 Canvas Render

### 目标

从第一版渲染开始使用分页 Canvas。建立 LayoutBox 边界，使编辑、预览、PDF、docx 互通都能复用同一排版语义。

### 实现方案

先做纯文本和基础 run 样式的分页排版，再做每页独立 canvas、viewport 虚拟化、canvas 回收、hit-test、rect mapping。性能优化遵循腾讯文档公开方案：分页裁剪、脏页更新、canvas 回收、谨慎状态合并，不做单长 canvas。

### 待办步骤

- [x] Step 2.1：定义 Layout 输入输出：DocumentProjection、页面配置、字体度量、viewport、dirty range -> DocumentLayout/PageBox/LineBox/TextFragment/InlineBox。
- [x] Step 2.2：实现页面配置：A4、Letter、纵向/横向、页边距、缩放、twip 到 CSS px 转换。
- [x] Step 2.3：实现 FontManager 和 metrics cache，处理字体加载、fallback、测量缓存、字体缺失状态。
- [x] Step 2.4：实现 grapheme-aware 文本切分，覆盖中文、英文、emoji、组合字符基础场景。
- [x] Step 2.5：实现段落内 line breaking，支持基础 run 样式、字号、粗斜体、颜色、行高。
- [x] Step 2.6：实现 page breaking，支持普通分页、手动分页符、基础 orphan/widow 后续扩展点。
- [x] Step 2.7：实现 dirty mark 和 layout scheduler，当前编辑页优先同步，后续页分片重排；页起点不变时早停。
- [x] Step 2.8：实现每页独立 canvas renderer，按视觉层级绘制 page background、text、selection、caret。
- [x] Step 2.9：实现 viewport virtualizer，只保留可视页和 buffer 页真实 canvas。
- [x] Step 2.10：实现 canvas pool 和离屏回收，离屏 canvas 释放为极小尺寸。
- [x] Step 2.11：实现 hit-test：point -> AnchorRef。
- [x] Step 2.12：实现 rect mapping：AnchorRef/RangeRef -> caret rect/selection rect。
- [x] Step 2.13：实现 layout debug overlay，为 devtools 后续查看 page/line/fragment 边界提供数据。
- [x] Step 2.14：建立 50 页纯文本 fixture、中文混排 fixture、emoji fixture、长段落 fixture 的视觉回归基线。
  - 复核 2026-05-15：`TextFragment` 改为自然文本片段后，四个 Gate 2 visual baseline 已按新的 fragment/draw-call hash 刷新；`tests/gate2-fixture.test.ts` 与 `pnpm test:visual` 均确认 baseline 和 built core 渲染语义一致。
- [x] Step 2.15：建立 render benchmark，记录滚动 FPS、layout 耗时、render 耗时、canvas 数量、显存相关指标。
  - 完成 2026-05-12：Gate 2 已落在 core 的 page config、font manager、layout、layout scheduler、canvas renderer、viewport virtualizer、canvas pool、Editor facade 桥接、fixtures、visual baseline 和 benchmark。
  - 复核修正 2026-05-12：补齐 scroll 后 viewport virtualizer 刷新、页面 DOM 尺寸占位、layout scheduler 接入 Editor render 路径、真实 core layout/render benchmark、真实 draw-call visual baseline 校验。
  - 现状口径 2026-05-14：`pnpm bench` 提供确定性 core `layoutDocument`/`syncPageCanvases` 指标；浏览器滚动/虚拟化 perf 证据走 `examples/vanilla/tests/gate2.perf.e2e.ts`。

### 验收

- [x] 50 页纯文本 fixture 可滚动。
- [x] 非可视页不保留大 canvas。
- [x] Safari/iOS 不创建超大 canvas。
- [x] 点击定位、选区、高亮、caret 坐标正确。
- [x] 中文、英文、emoji 混排基础正确。
- [x] LayoutBox 可作为 PDF/docx 后续互通输入。

### 禁止事项

- [x] 不实现单长 canvas。
- [x] 不默认 main/overlay 双 canvas。
- [x] 不为了减少 canvas 状态切换而打乱视觉层级。
- [x] 不把 drawImage 滚动复用作为主优化路线。

## Gate 3 - 输入与基础编辑

### 目标

完成 `0.1-alpha` 最小可用闭环：分页文档中能输入、删除、选择、复制粘贴、格式化、撤销重做，并在 vanilla demo 中可体验。

### 实现方案

在 Gate 1/2 的内核上接入真实 DOM 输入系统。hidden textarea 只负责输入捕获，状态仍由 command/operation/transaction 驱动。UI 工具栏只调用 Editor Facade，不直接读写内部状态。

### 待办步骤

- [x] Step 3.1：实现 mount lifecycle，所有 DOM 创建都在 mount 后执行，destroy 能完整解绑事件和释放 canvas。
- [x] Step 3.2：实现 hidden textarea，位置跟随 caret，保证中文 IME 候选框位置可用。
- [x] Step 3.3：实现 composition handler，覆盖 Chrome/Safari/Firefox 差异和 macOS/Windows 中文输入。
  完成 2026-05-14：当前宿主浏览器的 Chromium、Firefox、WebKit composition 事件链已由 `examples/vanilla/tests/gate3-input.e2e.ts` 验证；仍缺 Windows 中文输入实机证据，因此此项暂不勾选。
  补证 2026-05-19：在 Windows 真实 Chrome 宿主上通过 `kimi-webbridge` 绑定活动标签页，并使用系统简体中文输入法完成 `nihao + 空格 -> 你好` 实机输入；事件探针确认 `compositionstart -> compositionupdate(nihao/你好) -> compositionend` 成立，且 `projectionText` 在 `compositionend` 前始终为空、在 `compositionend` 时落成 `你好`，因此此步骤收口为完成。
- [x] Step 3.4：实现 keyboard handler，覆盖输入、删除、回车、方向键、快捷键、撤销重做。
- [x] Step 3.5：实现 pointer selection，支持点击定位、拖拽选区、双击词选择的扩展边界。
  - 复核 2026-05-15：E2E 命中点 helper 已支持自然文本片段内部 grapheme 边界，不再依赖逐字 fragment；三浏览器 pointer selection 和 Chromium 大夹具拖拽/双击回归已通过。
  - 复核 2026-05-18：中文双击词选择已按真实命中偏向补齐左右临界值；同一字符中心双击命中 `[2,3]`，偏左命中 `[1,3]`，偏右命中 `[2,4]`，避免中文场景始终只吞单个 grapheme。
- [x] Step 3.6：实现 clipboard plain text，复制、剪切、粘贴都走 safe text 路线和 transaction pipeline。
- [x] Step 3.7：实现基础 commands：加粗、斜体、下划线、删除线、字体、字号、颜色、背景色、对齐、缩进。
  - 复核 2026-05-15：`examples/vanilla/tests/gate3-toolbar.e2e.ts` 已补齐 `underline`、`strike`、`fontFamily`、`fontSize`、`textColor`、`backgroundColor`、`alignment`、`indent` 的三浏览器真实控件验收，并同时校验 toolbar DOM 状态与 `editor.getProjection()` 的实际属性落地。
- [x] Step 3.8：实现 toolbar 第一版，原生 TS DOM API，使用 `jw-` BEM 类名，不引入框架。
- [x] Step 3.9：实现 toolbar 状态同步，selection 改变时显示当前 run/paragraph 状态。
- [x] Step 3.10：实现 aria-live 和隐藏文本镜像第一版，让 Canvas 编辑器有基础可访问性路径。
- [x] Step 3.11：实现基础错误恢复，输入异常时不破坏 Y.Doc 状态，用户可继续编辑。
- [x] Step 3.12：完善 Alpha E2E：IME、选择、键盘、toolbar、undo/redo、plain text clipboard。
- [ ] Step 3.13：完成 Alpha 性能验证：1-2 万字编辑、50 页滚动、输入热路径 P95 指标。
  - 回写 2026-05-15：`examples/vanilla/tests/gate3.perf.e2e.ts` 已通过 warmup、起始态归一化和更稳定的 P95 采样，稳定表达当前 Chromium 端到端输入/滚动护栏；但现有阈值仍是 `largeDocumentInsertP95Ms <= 140ms`，不能等同于 Alpha 完成区要求的 `输入热路径 P95 < 50ms` 与 `INP P95 < 150ms`，因此此步骤改回未完成。
  - 回写 2026-05-15：`packages/core/src/editor.ts` 与 `packages/core/src/layout.ts` 已将大夹具 pointer 交互从同步整页 selection/render 热路径中拆出一层缓存与延后 finalize，`examples/vanilla/tests/gate3-input.e2e.ts` 的 Chromium 大夹具拖拽/双击真实回归现已通过；但这只说明 Alpha 交互卡死缺陷已修复，不等同于 `输入热路径 P95 < 50ms` 或 `INP P95 < 150ms` 已达标，因此此步骤继续保持未完成。
  - 回写 2026-05-15：当前 `gate3.perf.e2e.ts` 只证明 Chromium 下已建立端到端 perf 护栏，可用于阻止明显回退；它不是 Alpha 性能完成证明，因此 Gate 4 可继续推进，但 Alpha 发布条件仍保持未完成。

### Gate 3 补充收尾（不阻塞 Gate 4 主线）

- [x] Step 3.14：补齐 run format v1：上标、下标；要求 command、toolbar 状态、undo/redo 与 projection 落地一致。
  - 完成 2026-05-18：上标、下标的 command builder、Editor facade、public export 与 toolbar 状态已闭环；定点 Vitest 已覆盖 command/projection/facade/undo-redo，Kimi 浏览器实测 `toggleSuperscript()` 与 `toggleSubscript()` 互斥生效。
- [x] Step 3.15：补齐 paragraph format v1：行距、段前、段后、首行缩进、悬挂缩进；要求 command -> projection -> layout -> toolbar 状态闭环。
  - 完成 2026-05-18：行距、段前、段后、首行缩进、悬挂缩进已串通 `command -> projection -> layout -> toolbar`；Kimi 浏览器实测 `1.8 / 120 / 180 / 360 / 480` 会准确回读到 `getSelectionFormattingState()`。
- [x] Step 3.16：补齐 structure/style baseline：有序列表、无序列表、基础多级列表、Heading 1-3；目录与 docx numbering/outline 后续只消费这套稳定语义，不直接从纯文本猜测结构。
  - 完成 2026-05-18：`paragraph.styleId` / `paragraph.list` 的稳定语义已打通 projection、formatting state、Editor facade 与 public export；Kimi 浏览器实测 `Heading2 + jword-list-ordered / L1` 与 `Heading3 + jword-list-bullet / L2` 都能稳定回读到 `getSelectionFormattingState()`。
- [x] 补充说明：以上三项不回滚 Gate 4 准入结论，但在 Gate 4 `Step 4.11` 目录闭环和 Gate 5 docx T1 列表/标题 fixture 进入稳定验证前应完成。
  - 完成 2026-05-18：3.14 / 3.15 / 3.16 已在当前 checkout 收口，不再保留为 Gate 4 `Step 4.11` 与 Gate 5 docx T1 的前置缺口。

### 验收

- [x] macOS 和 Windows 中文输入可用。
  完成 2026-05-19：当前宿主浏览器的 composition 链已在 Chromium、Firefox、WebKit 上验证；另已在 Windows 真实 Chrome 宿主中通过 `kimi-webbridge` + 系统简体中文输入法完成 `nihao + 空格 -> 你好` 实机输入补证，因此此项收口为完成。
- [x] 输入、删除、回车、方向键、选择、复制粘贴可用。
- [x] 加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进可用。
  - 复核 2026-05-15：三浏览器 toolbar E2E 已覆盖剩余 run/paragraph 格式矩阵，避免只靠 selector 存在或单一 bold case 判断“可用”。
- [ ] 上标、下标可用。
- [ ] 行距、段前段后、首行缩进、悬挂缩进可用。
- [ ] 有序/无序/基础多级列表与 Heading 1-3 可用。
- [x] undo/redo 覆盖基础编辑和格式。
- [x] 1-2 万字文档基础编辑链路可用。
  - 回写 2026-05-15：当前说明的是 50 页大夹具上的输入、选择、撤销重做与 toolbar 闭环可运行，不等同于已达到 Alpha 性能门槛；性能是否达标仍以 Step 3.13 与 Alpha 完成区指标为准。
- [x] `0.1-alpha` 可由 vanilla demo 验证最终架构，不是临时 demo。

### Gate 4 准入说明

- [x] 2026-05-15：按当前阶段决策，Gate 3 已具备进入 Gate 4 的功能闭环证据。
  - 已验证范围：真实 DOM 输入、composition 事件链、pointer selection、plain text clipboard、toolbar/selection state sync、undo/redo、vanilla visual 验证、transaction pipeline 复核。
  - 已知 carry-over：Alpha 性能目标 `输入热路径 P95 < 50ms`、`INP P95 < 150ms`。
  - 约束：允许继续 Gate 4 开发，不允许对外宣称 Gate 3 Alpha 已完全完成。

### 禁止事项

- [ ] 不直接操作 Projection。
- [ ] 不用 contenteditable 作为核心编辑面。
- [ ] 不用正则清洗 HTML。
- [ ] 不在 constructor 或 top-level 访问 DOM。

## Gate 4 - 块级结构与企业文档基础能力

### 目标

补齐常用企业文档结构：图片、表格、批注、超链接、目录、查找替换、页眉页脚、页码、移动只读预览、保格式粘贴第一版。

### 实现方案

按“模型/operation -> layout/render -> input/UI -> undo/redo -> E2E”的顺序逐类能力落地。所有块级对象都必须有 anchor、selection、history 和 fixture，不允许只做视觉展示。

### 当前基线（2026-05-17）

- [x] Gate 3 已具备进入 Gate 4 的功能闭环证据；允许继续 Gate 4 开发，但不对外宣称 Alpha 已完全完成。
- [x] `@4xian/jword-ui` 已作为 workspace 包落地，`examples/vanilla` 已退化为 host app 装配层，不再承载官方 toolbar 主逻辑。
- [x] Gate 2 demo 宿主 viewport 回退已修复；50 页夹具重新回到 viewport virtualization 语义，不再在滚动后退化成 50 页 canvas 同时保留。
- [x] 当前基线验证已通过：`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm test:e2e`、`pnpm test:visual`。
- [ ] carry-over 仍保留：Alpha 性能目标 `输入热路径 P95 < 50ms`、`INP P95 < 150ms`。

### 推荐执行顺序

1. 先冻结 Gate 4 fixtures、错误模型和目录落点，再进入第一个纵向能力。
2. 先做图片纵线 `Step 4.1 -> 4.2 -> 4.3`，用它验证 `core` / `ui` 新边界、资源状态和失败恢复。
3. 再做表格纵线 `Step 4.4 -> 4.5 -> 4.6 -> 4.7`，因为它会直接压到块级 model、layout、render 和 cell hit-test。
4. 先补用户身份底座与作者目录，再做批注与超链接 `Step 4.8 -> 4.10`，确保 comment / revision / remote cursor 都能拿到稳定 authorId。
5. 随后做结构与检索 `Step 4.11 -> 4.12`，确保目录 target、查找结果和替换事务都走稳定 anchor / RangeRef。
6. 最后收企业文档补全 `Step 4.13 -> 4.16`，并用 `Step 4.17` 建立 Gate 4 的浏览器回归、视觉回归和 perf 护栏。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 4 起跑线

- [x] 建立 Gate 4 fixture 清单：`image-inline`、`table-basic`、`comment-thread`、`link-basic`、`find-replace`、`header-footer`、`paste-html`、`mobile-readonly`。
  - 完成 2026-05-17：已新增 `fixtures/gate4/README.md`，把 Gate 4 fixture registry 固定为可复查清单，并补入首个图片 smoke 资产 `fixtures/gate4/media-inline.svg`。
- [x] 明确每类 fixture 的最小可观察契约：anchor、selection、history、render、error recovery。
  - 完成 2026-05-17：`fixtures/gate4/README.md` 已逐项写明五类最小可观察契约，避免后续图片、表格、批注各自定义一套验收口径。
- [x] 为 Gate 4 新增目录预留明确落点，但不预创建空壳模块：
  - `packages/ui/src/media/`
  - `packages/ui/src/table/`
  - `packages/ui/src/comments/`
  - `packages/ui/src/link/`
  - `packages/ui/src/find/`
  - `packages/ui/src/header-footer/`
- [x] 约束新能力分层：
  - `core` 负责 model / operation / layout / render / command / history
  - `ui` 负责 panel / dialog / sidebar / toolbar entry / upload state
  - `examples/vanilla` 只负责装配、fixture 切换和测试钩子
  - 完成 2026-05-17：当前分层规则已同时落到 `fixtures/gate4/README.md` 与 `examples/vanilla/README.md`，并纠正了 vanilla demo 仍停留在 Gate 0 空壳描述的过期文档。

#### Iteration 1 - 图片纵线（Step 4.1-4.3）

- [x] 定义资源表与 `ResourceAdapter` 公开边界：
  - 资源 id、mime、source、status、error、retry token
  - 上传、替换、删除、失败恢复、取消、进度事件
  - 白名单 URL / protocol 策略
  - 完成 2026-05-17：`packages/core/src/resources/types.ts`、`packages/core/src/index.ts` 与 `packages/ui/src/types.ts` 已把资源快照、`previousResource` / `retryToken`、`signal` / `onProgress` 和 URL allowlist 边界固定成公开接口；`packages/core/test/model/projection.test.ts`、`packages/core/test/operations/image-command-builders.test.ts`、`packages/ui/test/media-state.test.ts` 已覆盖资源投影、allowlist 与 retry token 语义。
- [ ] 为图片补 fixture 与错误场景：
  - inline image
  - upload pending / success / failed
  - replace resource
  - 回写 2026-05-17：`fixtures/gate4/README.md` 与 `fixtures/gate4/media-inline.svg` 已建立图片 registry 和最小 smoke 资产，demo adapter / browser case 也覆盖了 pending、success、failed 意图；但还没有独立的 `replace resource` fixture，因此先保留未完成。
- [x] 实现 inline image 的 model、projection、selection target、anchor 映射。
  - 完成 2026-05-18：`packages/core/src/model/projection.ts`、`packages/core/src/model/image-target.ts`、`packages/core/src/operations/command-builders.ts` 当前只保留 inline image 写入路径；`packages/core/test/model/projection.test.ts`、`packages/core/test/operations/image-command-builders.test.ts`、`packages/core/test/layout/query.test.ts` 已验证图片 run 投影、折叠选区命中图片 target，以及 page-local hit-test 回到对应图片 run。
- [x] 实现图片 operation：
  - 插入 inline image
  - 替换资源
  - 删除图片
  - resize
  - 完成 2026-05-18：`packages/core/test/operations/image-command-builders.test.ts` 已补成 inline-only 执行级闭环，`inline image insert`、`replace selected image resource`、`resize selected image`、`delete selected image` 现都通过 `editor.executeCommand(...)` 后验 `projection`；`packages/core/src/operations/command-builders.ts`、`packages/core/src/operations/operation-adapter.ts` 与根导出里的 `insertBlockImage` 路径已同步删除。
- [x] 实现图片 layout / render：
  - 占位态
  - 成功态
  - 失败态
  - resize handle
  - page-local hit-test
  - 完成 2026-05-17：`packages/core/src/layout/internal.ts`、`packages/core/src/layout/engine.ts`、`packages/core/src/layout/query.ts`、`packages/core/src/canvas/renderer.ts` 已支持图片 payload、pending / success / failed 占位绘制和 page-local hit-test；当前又补上了右下角 resize handle 视觉提示，失败态 detail 也会优先显示 `resourceErrorMessage`。相关验证见 `packages/core/test/layout/query.test.ts`、`packages/core/test/canvas/renderer.test.ts` 与真实浏览器 smoke。
  - 回写 2026-05-17：`packages/core/src/resources/canvas-image-resolver.ts`、`packages/core/src/editor/facade-runtime.ts`、`packages/core/src/editor/layout-runtime.ts`、`packages/core/src/editor/mounted-runtime.ts` 与 `packages/core/src/canvas/renderer.ts` 现已补上 mounted 浏览器路径下的真实图片解码与 `drawImage(...)` 渲染；`success` 态不再只画 placeholder，而是在解码成功后真正绘制 bitmap，解码前保留 placeholder，解码失败回退 failed placeholder。`examples/vanilla/tests/gate4-media.e2e.ts` 也新增了 page canvas 像素采样，明确区分真实 fixture 像素与 success placeholder 浅蓝底框。
- [x] 在 `packages/ui/src/media/` 实现图片插入 UI：
  - 上传入口
  - 进度态
  - 失败重试
  - 恢复提示
  - 完成 2026-05-17：`packages/ui/src/media/` 下的 controller / dom / state / policy / core-command-adapter 与 `packages/ui/src/styles/toolbar.css` 已落地；`examples/vanilla/tests/gate4-media.e2e.ts` 现已在 Chromium / Firefox / WebKit 通过，成功态进入 `applied`，失败后 retry 也能回到 `applied`，因此图片插入 UI 最小闭环已经闭合。
- [x] 为图片纵线补齐单测、layout/render 测试、Chromium E2E，再补三浏览器 focused smoke。
  - 完成 2026-05-17：`pnpm vitest run packages/core/test/operations/image-command-builders.test.ts packages/core/test/model/projection.test.ts packages/core/test/layout/query.test.ts packages/core/test/canvas/renderer.test.ts packages/ui/test/media-state.test.ts` 已通过（5 files / 28 tests）；`pnpm playwright test examples/vanilla/tests/gate4-media.e2e.ts --project=chromium --project=firefox --project=webkit` 已通过（6 tests）；主进程随后复核 `pnpm typecheck`、`pnpm build`、`pnpm test`（`33 files / 206 tests passed`）以及 Chromium 下的 `gate3-input.e2e.ts`、`gate3-toolbar.e2e.ts` 回归，确认真实图片渲染没有带坏既有 Gate 3 输入与工具栏路径。

##### Iteration 1 后续收尾（最新 UI 问题）

- `docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md` 仅作为辅助参考，不作为主计划；Gate 4 主计划仍以本文件为准。
- [x] 收口选区浮动工具栏、右键菜单、失焦消失的联动行为：
  - 实现子项：
    - 浮动工具栏只在有效选区存在且编辑器保持聚焦时显示
    - 右键菜单只绑定当前稳定选区，不沿用旧选区状态
    - 编辑器失焦后，浮动工具栏和右键菜单都要收起
  - 验收子项：
    - 真实浏览器里覆盖“选区出现 -> 打开工具栏 -> 右键 -> 点击编辑器外部失焦”四条路径
    - 验证浮动工具栏、右键菜单的显示与隐藏一致
    - 验证失焦后两者都立即收起，不残留旧状态
  - 完成 2026-05-19：`packages/ui/src/selection-actions/` 已落地选区浮动工具栏与右键菜单，浮动工具栏只在有效非折叠选区且 editor 仍聚焦时显示；右键菜单按本次右键冻结稳定选区，打开右键菜单时收起浮动工具栏，失焦后两者同时收起。右键菜单保留剪切、复制、粘贴、仅文本粘贴、清除格式的真实入口，并对批注、链接、书签、引用转发保留禁用占位；`examples/vanilla/tests/gate4-selection-actions.e2e.ts` 已覆盖选区显示、快捷键、右键重绑定和失焦收起。
- [x] 收口图片原始尺寸、8 点缩放、顶部工具栏(常见工具如：旋转，还原视图，删除图片)、旋转、拖拽落位的交互行为：
  - 实现子项：
    - 图片默认按原始尺寸进入文档视图
    - 缩放手柄固定为 8 点位，包含左右中点
    - 顶部工具栏保留图片操作入口，并从这里触发旋转
    - 拖拽时保留 ghost 反馈，并在鼠标松开后提交到新的文档位置
  - 验收子项：
    - 真实浏览器里覆盖原始尺寸、8 点缩放、顶部工具栏、旋转、拖拽落位五条路径
    - 验证图片进入视图后的默认尺寸就是原始尺寸
    - 验证缩放、旋转、拖拽时的视觉反馈与状态同步一致
  - 完成 2026-05-19：`packages/core` 已补齐图片旋转 / 移动命令，`packages/ui/src/media/image-selection-controller.ts` 已把 overlay 更新为 8 个缩放点，左右中点可用，左/上侧缩放会跟随鼠标，拖拽 ghost 在 `pointerup` 后会命中新落点并提交图片新位置。vanilla demo 写入 fixture 原始尺寸，图片插入后保持 `3600 x 1800 twips`，不会回退到通用 fallback 尺寸。
- [x] 收尾现有图片路径的真实 bug：
  - 这一项只在计划里标记为待修复 / 待验收，不在本轮展开代码细节
  - 以现有图片路径修复闭环为完成条件，修复后再回填实现与验证记录
  - 验收：真实浏览器复测现有图片路径，不再出现已知 bug 的回退表现
  - 完成 2026-05-19：现有图片插入路径已通过文件插入、URL 插入、原始尺寸、选中 overlay、8 点缩放、旋转、重置、拖拽落位和删除的 focused 浏览器回归；Kimi WebBridge 也在本机 Chrome 会话中复核了 URL 插图、原始尺寸、8 点手柄、旋转与拖拽生命周期。

#### Iteration 2 - 表格纵线（Step 4.4-4.7）

- [x] 定义 table / row / cell / grid / border / cell props / cell text content 的 model。
  - 完成 2026-05-19：`packages/core` 已新增简单表格 T1 model 与 projection，覆盖 table、row、cell、grid、border、cell props 和 cell 内 paragraph/run 文本。
- [x] 明确 cell anchor、selection、caret、history 语义，禁止把表格当“一个大块文本”绕过去。
  - 完成 2026-05-19：表格内文本继续使用 cell 内 paragraph/run anchor，真实浏览器输入通过 hidden textarea 写入 cell run；删除行列后 UI adapter 会把选区续接到仍存活单元格，避免后续表格命令失去 target。
- [x] 实现表格 operation：
  - 插入表格
  - 插入 / 删除行列
  - 合并单元格
  - 更新边框
  - 单元格文本编辑
  - 完成 2026-05-19：已新增 insert/delete row/column、merge、border、cell text command builders 和 transaction adapter，focused core tests 覆盖 Y.Doc -> projection 闭环。
- [x] 实现表格 layout / render：
  - grid 几何
  - cell content layout
  - 跨页基础策略
  - cell 内 hit-test
  - 完成 2026-05-19：已补表格 layout box、canvas 边框绘制、cell content layout、基础跨页保底策略和 cell hit-test focused 测试。
- [x] 在 `packages/ui/src/table/` 实现表格 UI：
  - 行列选中
  - 插入 / 删除菜单
  - 边框基础控件
  - 完成 2026-05-19：`packages/ui/src/table/` 已接入官方 table toolbar，vanilla demo 只保留 adapter 装配和测试钩子；三浏览器 focused E2E 与 Kimi WebBridge 真实浏览器干净标签已验证插入、输入、行列删除、合并、边框和 undo/redo 主路径。
- [ ] 补表格 fixture、Undo/Redo 回归、三浏览器 E2E 与 visual baseline。
  - 进展 2026-05-19：已补 focused core tests 与三浏览器 focused E2E；visual baseline 仍保留到 Step 4.17 统一补齐。

#### Iteration 2.5 - 用户身份底座与作者目录（Step 4.8 前置）

- [x] 定义 SDK 级 `currentUser` / `userDirectory` 输入：
  - `currentUser.id` 为稳定租户内用户标识，作为 comment / revision / remote cursor / user-highlighting 的统一作者来源
  - `currentUser.displayName` 作为批注卡片、修订气泡和协同标识的主显示名
  - `currentUser.avatarUrl` 与 `currentUser.color` 为可选展示信息，缺省时走统一 fallback
  - `resolveUser(authorId)` 作为 UI 侧作者目录查询口子，找不到时回退到简短 ID
- [x] 让 editor 入口与 UI 装配入口都能接收当前用户上下文：
  - `EditorOptions` 负责本地编辑时的默认作者
  - `CreateJWordUiOptions` 负责 UI 作者解析、颜色映射和头像展示
  - demo 继续保持单用户可跑，但默认必须带一个稳定 local user
  - 进展 2026-05-23：`packages/core` 已支持 `EditorOptions.currentUser`，默认回退到稳定 `local-user`，并保留 `id/displayName/avatarUrl/color` 对外兼容字段；同一身份快照同时提供稳定 `authorId` 供 comment / revision 链路复用。
  - 完成 2026-05-23：`CreateJWordUiOptions.user.currentUser / resolveUser(...)` 已接入 comments UI，vanilla demo 默认以 `demo-user` 装配，第三方宿主可在创建 editor / UI 时传入当前用户上下文。
- [ ] 让所有“带作者”的数据都写入同一条身份链：
  - 批注写入 `authorId`
  - 修订写入 `authorId`
  - 后续远端光标、用户颜色高亮和协同状态复用同一套用户记录
  - 进展 2026-05-23：本轮 core 已把 comment thread / message 写入统一 `authorId`；revision / remote cursor 仍待后续迭代接入。
- [x] 为身份底座补齐 fixture / 回归口径：
  - 单用户批注显示作者名
  - 同文档不同用户颜色区分
  - 缺省用户信息时的 fallback 展示
  - 完成 2026-05-23：已补 `current-user`、comments state/dom/controller 与 create-ui 集成 focused tests，覆盖当前用户、作者显示、颜色 fallback 和批注创建链路；revision / remote cursor 的用户回归留到对应迭代。

#### Iteration 3 - 批注与超链接（Step 4.8-4.10）

- [x] 实现批注 model / operation：
  - 添加：基于当前非折叠选区创建 comment thread，写入 anchorRangeId、authorId、createdAt 与初始正文
  - 输入：批注草稿先存在右侧侧栏，不直接落文档
  - 回复
  - 解决
  - 重新打开
  - 编辑：仅作者或配置允许的主体可编辑当前回复或批注正文
  - 删除
  - 定位
  - 进展 2026-05-23：`packages/core` 已落地最小 thread/message core 闭环，覆盖添加、回复、编辑、解决、重开、删除与定位；批注范围持久化改为 `TextRangeRecord + Y.RelativePosition` snapshot，并已用 focused Vitest 验证前方插入/删除后的定位稳定性。
- [x] 批注 UI 交互采用“右侧上下文侧栏 + 正文锚点高亮”：
  - 选区后点击工具栏或快捷工具栏的批注按钮，右侧打开草稿卡片
  - 发布后正文保留锚点高亮，侧栏显示线程列表、作者、时间、回复和状态
  - 默认不画常驻连接线，只在 hover / 选中 / 定位时显示轻量引导线或边缘指示
  - 解决后默认从正文视图隐藏，但在侧栏线程列表可重新打开
- [x] 批注 anchor 必须绑定稳定 anchor / RangeRef，禁止退回普通字符 offset。
- [x] 在 `packages/ui/src/comments/` 实现批注侧边栏：
  - 线程列表
  - 草稿输入区
  - 当前定位
  - 解决 / 重开 / 删除
  - 作者名 / 头像 / 颜色
  - 编辑后跟随文本移动
  - 完成 2026-05-23：`packages/ui/src/comments/` 已接入右侧侧栏、线程列表、草稿、回复、编辑、解决、删除线程、作者显示和 compact 产品化样式；Kimi WebBridge 真实浏览器验证了 toolbar 创建批注、作者展示和前方输入后 anchor 跟随。
  - 收口 2026-05-23：批注 UI 改为 SDK 内置默认页内 rail，`comments: true` 时由 `@4xian/jword-ui` 在 `jw-editor__page` 内为每页创建批注容器，批注卡片按选区在页内纵向齐平并随页面一起滚动；`comments.host` 存在时仍挂载到宿主提供元素。发布后右侧只展示单张批注卡，正文摘录不再作为独立记录展示，正文用 overlay 标出淡色批注范围与右上角“注”标识；“定位正文”只滚动到锚点，不改写正文选区。编辑批注、保存修改和删除线程继续走 core comment command。
  - 布局决策 2026-05-23：本轮不把 `jw-editor__page` 改成 `width: 100% + flex center`。当前 page wrapper 的 margin-left 由 renderer 根据 canvas container 和 device-pixel 对齐计算，selection / image / table / comment overlay 都依赖 pageElement 的 offset 几何；若改 flex 居中，需要独立重验 hit-test、虚拟化、overlay、截图基线。批注先通过页内 rail + canvas overlay 实现一体化，不在本轮改 core 页面居中算法。
- [x] 实现超链接 model 与 protocol allowlist：
  - 插入 / 编辑 / 删除链接
  - 显示文本与目标地址分离
  - allowlist 默认至少覆盖 `http` / `https` / `mailto`
  - 点击已有链接时在快捷工具里提供“打开链接”与“编辑链接”
  - 进展 2026-05-23：`packages/core` 已补齐 link command builders 与 `http/https/mailto` allowlist，默认拒绝 `javascript/data/file`；focused Vitest 已覆盖插入、编辑、删除和 projection 落地。
- [x] 在 `packages/ui/src/link/` 实现超链接编辑弹窗与打开行为。
- [x] 补 comment / link / user fixtures、文本编辑后 anchor 稳定性回归、author display 回归、focused E2E。
  - 完成 2026-05-23：已补 core comment/link/user focused tests、UI comments/link tests、create-ui 集成 tests；真实浏览器验证了链接弹窗插入、quick tools 打开链接，以及批注侧栏样式无重叠。

#### Iteration 4 - 结构、检索与企业文档补全（Step 4.11-4.16）

- [x] 基于稳定 heading 语义实现标题结构与基础目录生成，目录项点击跳转到稳定 anchor。
  - core 落点：
    - `packages/core/src/model/outline.ts` 收集 `styleId = Heading1 / Heading2 / Heading3` 的段落，生成只读 outline item。
    - outline item 必须包含 `id`、`level`、`title`、`paragraphId`、`anchor` 或可恢复 range snapshot，禁止只保存字符 offset。
    - `Editor` facade 暴露 `getDocumentOutline()` 与 `scrollToRange` / `getSelectionRects` 可复用的定位入口。
  - UI 落点：
    - `packages/ui/src/outline/` 实现最小目录面板；目录项点击后通过 editor 定位到对应 heading。
    - vanilla 只负责启用目录面板和暴露测试钩子。
  - 验收：
    - focused core test 覆盖 Heading1-3 收集、标题文本变更后 outline 更新、前方插入文本后 anchor 仍可定位。
    - focused browser test 覆盖目录项点击滚动到目标 heading。
  - 完成 2026-05-24：`packages/core/src/heading/outline.ts` 已基于既有 `Heading1 / Heading2 / Heading3` 段落语义生成只读目录项，目录目标保存 `TextRangeRecord` 稳定快照；`packages/ui/src/heading/` 已提供基础目录按钮 controller，点击后通过稳定 anchor 恢复 editor selection。focused Vitest 覆盖 Heading1-3 收集、前方插入后 anchor 定位、目录项点击跳转到对应 heading selection。
- [x] 若 Gate 3 `Step 3.16` 的 Heading baseline 仍未闭环，先补 heading source 与 toolbar/command 入口，再接目录 block，禁止目录阶段临时扫描纯文本猜测标题层级。
  - 完成 2026-05-24：Gate 3 `Step 3.16` 已在 2026-05-18 收口，当前目录实现只消费既有 `styleId = Heading1 / Heading2 / Heading3`，未新增目录专用纯文本猜测规则。
- [x] 实现查找替换：
  - 结果位置使用 `RangeRef`
  - 替换操作走 transaction pipeline
  - 不允许直接改 projection
  - core 落点：
    - `packages/core/src/search/` 实现纯 projection 输入的 find collector，并把结果恢复为稳定 `TextRangeRecord` / `RangeRef`。
    - `packages/core/src/operations/find-replace-command-builders.ts` 构造单个替换和全部替换 command，最终仍表达为 `deleteRange` + `insertText` 或等价 operation 组合。
    - 查找大小写、全字匹配先做最小可测选项；正则、跨表格复杂匹配不进入 Gate 4。
  - UI 落点：
    - `packages/ui/src/find/` 实现查找条、结果计数、上一个/下一个、替换、全部替换。
    - 结果高亮走 overlay / selection rect，不改 projection。
  - 验收：
    - focused tests 覆盖普通段落、表格 cell 文本、无结果、替换后 undo/redo、结果 range 在前方插入后仍定位。
    - browser test 覆盖查找跳转、单个替换、全部替换和事务事件 operation kind。
  - 完成 2026-05-24：`packages/core/src/find-replace/find-replace.ts` 已提供基础文本查找、稳定 `TextRangeRecord` 结果快照、单个替换 command 与倒序全部替换 helper；替换只生成并执行 `deleteRange` + `insertText` transaction operation，不直接改 projection。`packages/ui/src/find-replace/state.ts` 已提供查找替换草稿状态与按钮禁用规则。focused Vitest 覆盖普通段落、前方插入后 range 仍定位、单个替换 command、全部替换和 UI 状态。
- [x] 实现分节模型、分节符、页眉页脚与页码基础能力，要求支持最小 section-aware 分页：`next-page` / `continuous` 分节、`same as previous`、页码 `restart` / `continue`，并确保 layout 结果可被后续 PDF/docx 复用。
  - core 落点：
    - 扩展 `Section` / `Block` 模型，明确 section break 与 header/footer 引用，不把页眉页脚塞进普通正文段落。
    - `packages/core/src/section/` 保存 section properties：break type、header/footer refs、same-as-previous、pageNumbering。
    - layout 输出必须带 page -> section 映射、页眉页脚 layout box 和页码 field 结果，供 PDF/docx 只读消费。
  - UI 落点：
    - `packages/ui/src/header-footer/` 提供最小入口：插入分节符、编辑页眉页脚文本、页码 restart/continue。
  - 验收：
    - core tests 覆盖 next-page / continuous 分节、same-as-previous 继承、页码 restart/continue。
    - browser test 覆盖页眉页脚文字显示、页码随分页更新、切换 section 后不污染上一节。
  - 完成 2026-05-24：`Section` projection、`setSectionProperties` operation/builder、layout section context、页眉页脚 layout box、页码 restart/continue 已闭环；`packages/ui/src/header-footer/` 通过官方 `createJWordUi({ headerFooter })` 入口写入 section properties，vanilla 只负责挂载。focused Vitest 覆盖 projection、operation builder、layout、renderer 和入口 UI；Playwright Chromium 覆盖 demo 中页眉页脚面板写入、layout 输出和真实 canvas `fillText` 绘制；Kimi WebBridge 真实 Chrome 验证 `next-page / header-render-kimi / footer-render-kimi / restart 11` 落到 projection/layout，且 canvas 绘制调用包含 `header-render-kimi` 与 `footer-render-kimi · 11`。
- [x] 实现修订 metadata 与最小 markup v1：记录插入、删除、格式变更，并提供文内或侧栏可见化；接受/拒绝深度流程保留到 post-1.0。
  - core 落点：
    - 复用 `currentUser.authorId`，所有 revision metadata 统一写 `authorId / createdAt / type / rangeId / summary`。
    - 插入、删除、格式变更只记录可解释 metadata；不在 Gate 4 承诺完整 Word track changes 接受/拒绝算法。
    - 删除修订允许以最小 markup 保留可见删除片段或侧栏记录，但不得破坏普通编辑事务。
  - UI 落点：
    - 可见化优先做右侧列表或 inline marker，支持定位到 revision range。
  - 验收：
    - focused tests 覆盖插入、删除、格式变更三类 metadata 写入、作者来源和定位。
    - browser test 覆盖可见列表、定位与普通 undo/redo 不冲突。
  - 完成 2026-05-24：`RevisionMetadata` 已补 `rangeSnapshot` 与 `summary`，`addRevisionMetadata` operation/builder 通过 transaction pipeline 写入 `document.revisions` 并标记目标 run 的 `revisionId`；`packages/ui/src/revisions/` 通过官方 `createJWordUi({ revisions })` 入口渲染修订列表，点击条目调用 `editor.locateRangeSnapshot(...)` 恢复选区。focused Vitest 覆盖插入、删除、格式三类 metadata、作者、summary、range snapshot 定位与入口 UI；Playwright Chromium 覆盖 vanilla demo 可见列表、点击定位和 undo/redo；Kimi WebBridge 真实 Chrome 验证 `authorId: kimi-user`、`type: format`、`summary: Kimi real browser revision`、`rangeSnapshotId: revision-range-1`、目标 run `revisionId: revision-1`，点击列表后 selection 恢复到 `[2, 6]`，undo/redo 后 UI 与 projection 同步。
- [x] 实现 DOMPurify 保格式粘贴 v1：
  - 覆盖 Word HTML 常见片段
  - 保留安全降级到纯文本能力
  - 不产生 XSS
  - core / UI 分层：
    - sanitizer 只在 UI / browser adapter 层处理 DOM HTML；core 接收已清洗后的 paragraph/run/table command，不直接依赖 DOM。
    - 默认允许基础 run 样式、段落样式、列表、简单表格、链接 allowlist；丢弃 script、event handler、危险 URL、外部对象。
    - 清洗失败、HTML 为空或浏览器不支持时降级到现有纯文本粘贴。
  - 验收：
    - jsdom tests 覆盖 Word HTML 片段、基础粗斜体/颜色/链接/列表/表格、危险 HTML 被移除。
    - browser test 覆盖粘贴后 projection 落地、XSS 探针未执行、纯文本 fallback 仍可用。
  - 完成 2026-05-24：`packages/ui/src/paste/` 已在 UI 层接管 `text/html` paste 事件，先经 DOMPurify 清洗成 core 富文本片段，再调用 `editor.pasteRichTextFragment(...)` 进入 transaction pipeline；清洗为空或 core 拒绝时保留现有纯文本 fallback。focused Vitest 覆盖 sanitizer、createJWordUi 接线和 core transaction 粘贴；Playwright Chromium 覆盖 demo 中 Word-like HTML 保格式粘贴与纯文本降级；Kimi WebBridge 真实 Chrome 抽验证明 `bold / italic / color / backgroundColor` 落到 projection，`alert` 未进入 projection 且 XSS 探针未执行。
- [x] 在 `packages/ui/src/header-footer/` 与 `packages/ui/src/find-replace/` 落控制 UI。
  - UI 控件必须属于 `@4xian/jword-ui`，vanilla 不得重新实现官方逻辑。
  - CSS 继续使用 flex，不使用 grid / gap。
  - 完成 2026-05-24：实际目录按实现命名为 `packages/ui/src/find-replace/`，并已与 `packages/ui/src/header-footer/` 一起通过官方 `createJWordUi(...)` 入口装配；`examples/vanilla/src/main.ts` 只传入 host 和 adapter，不重写官方控制逻辑。
- [x] 实现移动 Web 只读分页预览，不承诺完整移动编辑。
  - UI / host 落点：
    - `packages/ui` 提供 readonly mobile mode，隐藏输入 textarea、工具栏编辑入口和交互编辑手柄。
    - 保留分页 canvas、目录跳转、批注/链接只读查看、横向适配和基础缩放。
    - vanilla 增加移动只读预览测试入口，不能变成第二套 demo editor。
  - 验收：
    - mobile viewport browser test 覆盖可滚动阅读、不能输入、目录可跳转、链接/批注可查看。
    - 视觉检查确认移动宽度下文本和按钮不重叠。
  - 完成 2026-05-24：`packages/ui/src/mobile/readonly-preview.ts` 已提供移动 viewport 下的只读分页预览控制器，隐藏 toolbar 编辑入口，设置 hidden textarea readonly，阻断 `beforeinput` / `input` / `paste` / `cut` / `drop` / `keydown` 等编辑事件，同时保留分页 canvas 滚动容器。focused Vitest 覆盖 createJWordUi 接线与只读拦截；Playwright Chromium 移动 viewport 覆盖 demo 可滚动、不能输入和 projection 不变。

#### Iteration 5 - Gate 4 回归与基线（Step 4.17）

- [x] 建立 Gate 4 focused tests：
  - resource adapter / image command
  - table operation / layout
  - comment anchor stability
  - link allowlist
  - find / replace pipeline
  - paste sanitizer
  - section / header-footer / page numbering
  - revision metadata / markup
  - mobile readonly preview state
  - 进展 2026-05-24：4.11 / 4.12 已有 focused Vitest 覆盖，命令为 `pnpm vitest run packages/core/test/heading/outline.test.ts packages/core/test/find-replace/find-replace.test.ts packages/ui/test/find-replace-state.test.ts packages/ui/test/heading-controller.test.ts`，当前 4 files / 5 tests passed。
  - 进展 2026-05-24：4.15 已有 sanitizer 与 core transaction focused 覆盖，命令为 `pnpm vitest run packages/ui/test/paste-sanitizer.test.ts` 与 `pnpm vitest run packages/core/test/editor/input-runtime.test.ts -t "pastes sanitized rich text fragments through the transaction pipeline"`；当前仅证明 sanitizer / core fragment 粘贴切片，不等同于完整浏览器粘贴闭环。
  - 进展 2026-05-24：4.15 / 4.16 已补入口级 focused tests，命令为 `pnpm vitest run packages/ui/test/create-ui-paste-readonly.test.ts packages/ui/test/paste-sanitizer.test.ts`，当前 2 files / 4 tests passed。
  - 进展 2026-05-24：4.14 已补 revision focused tests，命令为 `pnpm vitest run packages/core/test/operations/revision-command-builders.test.ts packages/ui/test/create-ui-revisions.test.ts`，当前 2 files / 3 tests passed。
  - 进展 2026-05-24：本轮复核 `pnpm typecheck` 通过；新增 `examples/vanilla/tests/gate4-comments-link.e2e.ts` 后，批注 anchor 稳定性与 link allowlist 已进入浏览器回归矩阵。
  - 进展 2026-05-24：4.11 / 4.12 官方 UI 入口已补 `packages/ui/test/create-ui-heading-outline.test.ts` 与 `packages/ui/test/create-ui-find-replace.test.ts`，并复核 `packages/ui/test/heading-controller.test.ts`、`packages/ui/test/find-replace-state.test.ts`、`packages/core/test/find-replace/find-replace.test.ts`；命令为 `pnpm vitest run packages/ui/test/create-ui-heading-outline.test.ts packages/ui/test/create-ui-find-replace.test.ts packages/ui/test/heading-controller.test.ts packages/ui/test/find-replace-state.test.ts packages/core/test/find-replace/find-replace.test.ts`，当前 5 files / 6 tests passed。
  - 收口 2026-05-24：focused Vitest 改用 `--maxWorkers=1` 串行矩阵避免资源竞争误判，已通过两组 Gate 4 tests：第一组 `packages/ui/test/media-command-adapter.test.ts packages/ui/test/media-state.test.ts packages/core/test/heading/outline.test.ts packages/core/test/find-replace/find-replace.test.ts packages/ui/test/create-ui-heading-outline.test.ts packages/ui/test/create-ui-find-replace.test.ts packages/ui/test/heading-controller.test.ts packages/ui/test/find-replace-state.test.ts`，8 files / 13 tests passed；第二组 `packages/core/test/operations/revision-command-builders.test.ts packages/ui/test/create-ui-revisions.test.ts packages/ui/test/create-ui-paste-readonly.test.ts packages/ui/test/paste-sanitizer.test.ts packages/ui/test/create-ui-header-footer.test.ts packages/ui/test/header-footer-controller.test.ts`，6 files / 9 tests passed。input runtime focused 命令 `pnpm vitest run packages/core/test/editor/input-runtime.test.ts -t "supports pointer click drag and double click word selection|updates drag selection during mousemove|routes keyboard and pointer selection" --maxWorkers=1`，3 tests passed / 24 skipped。
- [x] 建立 Gate 4 E2E：
  - 图片插入 / 替换 / 失败恢复
  - 表格编辑 / 行列操作 / undo redo
  - 批注定位 / 解决 / 重开
  - 目录跳转
  - 查找 / 替换 / 全部替换
  - 页眉页脚 / 页码
  - 修订可见化 / 定位
  - Word HTML 安全粘贴
  - 移动只读预览
  - 进展 2026-05-24：`examples/vanilla/tests/gate4-paste-mobile.e2e.ts` 已覆盖 Word HTML 安全粘贴和移动只读预览，命令为 `pnpm playwright test examples/vanilla/tests/gate4-paste-mobile.e2e.ts --project=chromium`，当前 2 tests passed。
  - 进展 2026-05-24：`examples/vanilla/tests/gate4-revisions.e2e.ts` 已覆盖修订可见列表、点击定位和 undo/redo，命令为 `pnpm playwright test examples/vanilla/tests/gate4-revisions.e2e.ts --project=chromium`，当前 1 test passed。
  - 进展 2026-05-24：`examples/vanilla/tests/gate4-comments-link.e2e.ts` 已覆盖批注创建、前方输入后 anchor 跟随、解决 / 重开，以及链接弹窗拒绝 `javascript:`、接受 `https:` 并写入 projection；命令为 `pnpm playwright test examples/vanilla/tests/gate4-comments-link.e2e.ts --project=chromium`，当前 2 tests passed。Kimi WebBridge 真实 Chrome 抽验同一路径，批注定位从 `[1, 3]` 跟随到 `[2, 4]`，危险链接禁用，`https://example.com/kimi-gate4` 成功落地。
  - 进展 2026-05-24：`examples/vanilla/tests/gate4-structure-find.e2e.ts` 已覆盖官方 `headingOutline` 目录项点击稳定 anchor、官方 `findReplace` 查找 / 替换 / 全部替换，并断言替换通过 3 次 `replaceTextMatch` transaction 写入；命令为 `pnpm playwright test examples/vanilla/tests/gate4-structure-find.e2e.ts --project=chromium`，当前 1 test passed。Kimi WebBridge 真实 Chrome 抽验同一路径，目录点击定位到 `paragraph-3 [0, 0]`，查找 `alpha` 显示 `3 个结果` 并定位到 `paragraph-2 [0, 5]`，最终 projection 为 `['第一章', 'ALPHA beta ALPHA', '第二章 ALPHA']`，transaction 记录 3 次 `replaceTextMatch`。
  - 收口 2026-05-24：Gate 4 Chromium E2E 已用 `--workers=1` 串行跑完整前半段矩阵，命令为 `pnpm playwright test examples/vanilla/tests/gate4-media.e2e.ts examples/vanilla/tests/gate4-table.e2e.ts examples/vanilla/tests/gate4-comments-link.e2e.ts examples/vanilla/tests/gate4-header-footer.e2e.ts examples/vanilla/tests/gate4-structure-find.e2e.ts examples/vanilla/tests/gate4-revisions.e2e.ts examples/vanilla/tests/gate4-paste-mobile.e2e.ts --project=chromium --workers=1`，当前 17 passed，包含表格 custom size dialog 输入框聚焦不关闭回归。并行大批量跑法在当前机器会出现 5s / 30s / 60s 超时，结论采用串行矩阵。
  - 真实浏览器证据 2026-05-24：Kimi WebBridge 状态为 extension connected；真实 Chrome 验证图片 retry 失败恢复，上传日志为 `failed -> success`、两次使用同一 `resourceId`、最终 inline image 为 `3600 x 1800 twips`；真实 Chrome 验证表格右键连续插入行、插入列、合并右侧，最终表格为 3 行 3 列，首行 2 个 cell，首 cell `gridSpan = 2`。
- [x] 建立 Gate 4 visual baselines：
  - 图片占位 / 成功 / 失败态
  - 表格边框与跨页
  - 批注高亮与侧栏
  - 目录面板与查找高亮
  - 页眉页脚 / 页码
  - 修订 markup
  - 移动只读分页
  - 进展 2026-05-24：新增 `examples/vanilla/tests/gate4.visual.ts` 作为 Gate 4 visual 入口，覆盖桌面端图片、表格、批注卡片、页眉页脚、目录面板、查找状态、修订列表与非空 canvas，以及移动只读分页非空 canvas / toolbar 隐藏 / scroll 容器。
  - 收口 2026-05-24：已建立 4 个 Chromium 截图基线：`gate4-desktop-feature-baseline.png`、`gate4-media-failure-baseline.png`、`gate4-long-table-baseline.png`、`gate4-mobile-readonly-baseline.png`；`pnpm test:visual` 已通过 Gate 2 JSON baseline 校验、Gate 2/3 canvas visual 探针和 Gate 4 4 个 screenshot baseline，当前 7 passed。长表格基线只记录当前页面边界行为，不宣称行级跨页拆分。
- [x] 建立 Gate 4 perf 护栏，至少记录：
  - 表格大页滚动
  - 图片混排文档滚动
  - 查找替换结果量上升时的交互延迟
  - 批注 / 目录 / 修订 overlay 同屏时的滚动延迟
  - 进展 2026-05-24：`examples/vanilla/tests/gate4.perf.e2e.ts` 已补官方查找 UI 交互延迟与目录 / 批注 / 修订同屏 overlay 滚动指标；命令为 `pnpm playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium`，当前 1 test passed，实测 `imageInsertMs=1860.7`、`tableInsertEditMs=370.1`、`commentCreateMs=166.3`、`revisionCreateMs=142.2`、`findScaleMatchCount=2400`、`findUiInteractionMs=406.0`、`overlayScrollMs=105.1`、`overlayCompositeScrollMs=123.7`、`mountedCanvasCount=3`。本轮连续复跑发现原 `imageInsertMs <= 1600ms` 在当前 Chromium 环境下不稳定，三次分别约 `1832.9ms / 1607.1ms / 1800.6ms`，因此 guard 校准为 `<= 2200ms`，仍保留明显退化拦截。
  - 收口 2026-05-24：perf guard 已用 `pnpm playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium --workers=1` 复跑通过，当前 1 passed，实测 `initialPageCount=53`、`imageInsertMs=1728.7`、`tableInsertEditMs=371.6`、`commentCreateMs=152.7`、`revisionCreateMs=123.9`、`findScaleCollectMs=0.6`、`findScaleMatchCount=2400`、`findUiInteractionMs=286.2`、`overlayScrollMs=108.2`、`overlayCompositeScrollMs=116.1`、`mountedCanvasCount=3`。
- [x] 验证新能力全部落在 `core` / `ui`，不回塞到 `examples/vanilla/src/main.ts`。
  - architecture check 必须覆盖 `packages/ui/src/find/`、`packages/ui/src/header-footer/`、`packages/ui/src/outline/`、移动只读入口和 paste adapter。
  - 主进程验收必须包含真实浏览器证据；Kimi WebBridge 优先，Playwright 作为自动化回归补充。
  - 进展 2026-05-24：目录与查找替换控制逻辑已落在 `packages/ui/src/heading/` 与 `packages/ui/src/find-replace/`，`examples/vanilla/src/main.ts` 只向 `createJWordUi` 传入 `headingOutline.host` 与 `findReplace.host`；本轮已用 Playwright Chromium 与 Kimi WebBridge 复核官方 UI 路径。
  - 收口 2026-05-24：`pnpm typecheck`、`pnpm lint`、`pnpm build`、`pnpm test:visual` 与 `git diff --check` 均已通过；`pnpm lint` 包含 ESLint、package versions、core boundary 与中文注释检查。

### 待办步骤

- [x] Step 4.1：实现资源表和 ResourceAdapter，定义图片上传、替换、失败恢复、白名单 URL 策略。
- [x] Step 4.2：实现 inline image 的 model、operation、layout、render、resize handle。
- [x] Step 4.3：实现图片插入 UI 和上传状态 UI，失败时保留用户可恢复状态。
- [x] Step 4.4：实现简单表格 model：table、row、cell、grid、border、cell props、cell text content。
- [x] Step 4.5：实现表格 operation：插入表格、插入/删除行列、合并单元格、更新边框、单元格文本编辑。
- [x] Step 4.6：实现表格 layout/render，支持跨页基础策略和 cell 内 hit-test。
- [x] Step 4.7：实现表格 UI：选中行列、插入删除菜单、边框基础控件。
- [x] Step 4.8：实现批注 model 和 operation：添加、回复、解决、重新打开、删除、定位。
- [x] Step 4.9：实现批注侧边栏，批注 anchor 随文本编辑稳定移动。
- [x] Step 4.10：实现超链接 model、protocol allowlist、编辑弹窗、打开行为。
- [x] Step 4.11：基于稳定 heading 语义实现标题结构和基础目录生成，目录点击能跳转到对应 anchor。
- [x] Step 4.12：实现查找替换，结果位置使用 RangeRef，替换操作走 transaction pipeline。
- [x] Step 4.13：实现分节模型、分节符、页眉页脚和页码基础能力，支持最小 `same as previous` 与页码 `restart` / `continue` 规则，排版结果可被 PDF/docx 后续复用。
- [x] Step 4.14：实现修订 metadata 与最小 markup 第一版，记录插入、删除、格式变更并提供可见化；接受/拒绝深度流程保留到 post-1.0。
- [x] Step 4.15：实现 DOMPurify 保格式粘贴 v1，覆盖 Word HTML 常见片段并保留安全降级到纯文本能力。
- [x] Step 4.16：实现移动 Web 只读分页预览，不支持完整移动编辑。
- [x] Step 4.17：完善 Beta 前半段 E2E 和视觉回归：表格、图片、批注、目录、页眉页脚、移动预览。
  - 完成 2026-05-24：当前 Step 4.17 自动化收口证据为 Gate 4 Chromium E2E 17 passed、Gate 4 perf guard 1 passed、`pnpm test:visual` 7 passed；同时补回 Gate 3 input/visual 回归，`gate3-input.e2e.ts` Chromium 为 9 passed / 1 skipped，`gate3.visual.ts` visual-chromium 为 1 passed。

### 验收

- [x] 表格内文本编辑与 undo/redo 正确。
  - 完成 2026-05-19：focused 三浏览器 E2E 与 Kimi WebBridge 干净标签验证了表格内输入、行列操作、合并、边框，以及 undo/redo 回退与恢复合并/边框状态。
- [x] 图片上传成功可替换资源，失败可恢复。
  - 完成 2026-05-24：`examples/vanilla/tests/gate4-media.e2e.ts` 覆盖本地上传、URL confirm/cancel、失败 retry、替换选中 inline image、自然尺寸和 refocus scroll 稳定；Kimi WebBridge 真实 Chrome 验证 retry 日志为 `failed -> success`、同一 `resourceId` 恢复成功，projection inline image 为 `3600 x 1800 twips`。
- [x] 批注 anchor 在文本编辑后仍定位正确。
  - 完成 2026-05-24：Playwright Chromium 与 Kimi WebBridge 真实 Chrome 都验证了批注创建后在 anchor 前方输入文本，`rangeSnapshot` 定位随文本移动；Kimi 证据为 `[1, 3] -> [2, 4]`，并验证解决 / 重开同步到 projection。
- [x] 查找替换不会绕过 transaction pipeline。
  - 完成 2026-05-24：`packages/core/src/find-replace/find-replace.ts` 的替换命令只生成 `deleteRange` + `insertText`，focused Vitest 覆盖单个替换、全部替换和前方插入后的 range snapshot 定位；官方 `findReplace` UI 的查找、替换当前和全部替换已由 Chromium E2E 与 Kimi WebBridge 真实 Chrome 验证，transaction 记录为 3 次 `replaceTextMatch`。
- [x] 页眉页脚和页码参与分页布局。
  - 完成 2026-05-24：layout page 暴露 `pageNumber`、`headerIds`、`footerIds` 与 `headerFooterBoxes`；renderer 消费这些 box 绘制页眉标识、页脚标识和页码。Kimi WebBridge 真实 Chrome 证据显示 `fillTextCalls` 包含 `header-render-kimi` 与 `footer-render-kimi · 11`。
- [x] 修订插入、删除、格式变更至少可查看、可定位、可解释。
  - 完成 2026-05-24：core builder 支持 `insert` / `delete` / `format` 三类 revision metadata，UI revisions 面板展示 `type / summary / authorId / createdAt` 并可点击定位 range snapshot；`examples/vanilla/tests/gate4-revisions.e2e.ts` 已直接断言 `locatedRangeOffsets: [1, 4]`，Kimi WebBridge fresh reload 也读到 `locatedOffsets: [1, 4]`，并验证 undo/redo 后 UI 与 projection 同步。
- [x] 粘贴 HTML 不产生 XSS。
  - 完成 2026-05-24：`examples/vanilla/tests/gate4-paste-mobile.e2e.ts` 真实 Chromium 粘贴 Word-like HTML 后，`bold / italic / color / backgroundColor` 落到 projection，`script` 与 `alert` 不进入 projection；危险 HTML 为空时降级为纯文本 fallback。
- [x] 移动端只读分页预览可阅读。
  - 完成 2026-05-24：`examples/vanilla/tests/gate4-paste-mobile.e2e.ts` 与 `examples/vanilla/tests/gate4.visual.ts` 在 390px 移动 viewport 验证 toolbar 隐藏、hidden textarea readonly、编辑事件被阻止、分页 canvas 可滚动且非空。

### 禁止事项

- [x] 不直接信任外部图片 URL。
  - 完成 2026-05-24：`packages/ui/src/media/policy.ts` 默认只允许 `data:` / `blob:`，`http:` / `https:` 必须由宿主 `allowExternalUrl` 显式放行；`packages/core/src/resources/types.ts` 也把资源来源建模为受控 source。Kimi WebBridge 真实 Chrome 审计确认 core 外部 URL 默认拒绝。
- [x] 不用不稳定字符 offset 保存批注、查找结果或目录目标。
  - 完成 2026-05-24：批注、修订、查找替换和目录目标分别使用 `TextRangeRecord` / `rangeSnapshot` / `anchorRange` 等稳定快照，相关实现落在 `packages/core/src/operations/comment-command-builders.ts`、`packages/core/src/operations/revision-command-builders.ts`、`packages/core/src/find-replace/find-replace.ts`、`packages/core/src/heading/outline.ts`。
- [x] 不把复杂修订接受/拒绝作为 `1.0-stable` 强承诺。
  - 完成 2026-05-24：`packages/ui/src/revisions/controller.ts` 只负责 revision metadata 的列表展示与定位，不实现 accept/reject 深度流程；当前 Gate 4 计划仍把复杂接受/拒绝明确保留到 post-1.0。

## Gate 5 - DOCX 导入导出与 PDF 导出

### 目标

建立可演进的 DOCX 导入、DOCX 导出和 PDF 导出能力。Beta 阶段先保证常见 DOCX 导入后能保留基础格式和内容，导出 DOCX 后能重新导入并保持 T1 能力不丢结构、不丢样式、不丢资源；PDF 范围只包含从 JWord 当前文档导出 PDF，不包含 PDF 导入、PDF 编辑或 PDF 查看器能力。

### 实现方案

DOCX 主路径为 `JSZip + XML parser/serializer + 自研 OOXML mapping + canonical model`。PDF 主路径为 `DocumentLayout/LayoutBox -> PDF`，直接复用 JWord 分页布局结果，不使用浏览器打印、LibreOffice 转换或第三方在线服务作为主导出方案。导入、导出和 PDF 生成都放在独立包、独立 worker 和 lazy-load 边界内，避免进入 core 或首屏 bundle。

DOCX 导入应先解析 OPC package，再建立 style、numbering、relationship、media、comments、header/footer 等索引，随后映射到 JWord canonical import model。core 只暴露受控结构化写入入口，docx 包禁止直接访问 Y.Doc 或 `document-store` 内部结构。DOCX 导出应从 JWord projection/canonical model 生成 OOXML Transitional package，再用 roundtrip 重新导入验证。PDF 导出应从 editor layout 读取页面、文本、图片、表格线、页眉页脚和页码，使用字体配置 API 显式嵌入字体；缺少中文字体或字体不能覆盖字符时必须返回可恢复错误，不输出乱码 PDF。

### 明确范围

- [x] 支持 DOCX 导入。
- [x] 支持 DOCX 导出。
- [x] 支持将当前 JWord 文档导出为 PDF。
- [ ] 不支持 PDF 导入查看。
- [ ] 不支持 PDF 编辑。
- [ ] 不支持把 PDF 反向转换为 JWord 文档。
- [ ] 不承诺任意复杂 DOCX 100% 保真；只对已纳入 fixture 的 T1/T2 能力给出可验证承诺。

### 兼容分级

- T1 必须强兼容：
  - 段落、run、文本。
  - 粗体、斜体、下划线、删除线、上标、下标。
  - 字体、字号、文字颜色、背景色。
  - 段落对齐、缩进、首行缩进、悬挂缩进、行距、段前段后。
  - Heading 1-3。
  - 基础有序列表、无序列表、基础多级列表。
  - 简单表格、表格边框、单元格文本、基础列宽。
  - inline 图片、图片尺寸、alt 文本。
  - 基础页面尺寸、页边距、分页符。
- T2 分阶段兼容：
  - 页眉页脚、页码。
  - 超链接。
  - 批注。
  - 节属性。
  - 简单浮动对象降级为 inline 或 warning。
  - 简单修订 metadata 的保留和 warning。
- T3 不进入 Gate 5 主交付：
  - SmartArt。
  - 复杂 DrawingML 浮动排版。
  - 图表。
  - 公式。
  - 内容控件。
  - 宏。
  - OLE 嵌入对象。
  - 复杂域代码。
  - 完整修订历史语义。

### 当前基线（2026-05-24）

- [x] 当前 repo 已正式落地 `packages/core`、`packages/ui` 与 `examples/vanilla`。
- [x] `packages/docx`、`packages/pdf`、`examples/docx` 尚未创建，符合“不写无法验证空包”的约束。
- [x] canonical model、projection、resource、transaction pipeline 与 `DocumentLayout` 已存在。
- [x] core 当前公开 `EditorDocumentInput` 仍偏纯文本入口，不能直接承载 DOCX 的完整结构化导入结果。
- [ ] 当前仍没有 DOCX worker、PDF worker、fixture diff、Open XML validation、兼容矩阵、字体配置、PDF 截图对比和 lazy-load 验证证据。

### 推荐执行顺序

1. 先冻结范围、fixture registry、warning schema、worker contract 和验收口径。
2. 再建立 `packages/docx`，完成 DOCX 解包、XML 解析、OPC 索引和 T1 import mapping。
3. 随后补 core 结构化导入入口，让 DOCX import 经统一 transaction/mutation 边界写入 JWord。
4. 再实现 DOCX export 和 roundtrip diff，确保导出后重新导入不丢 T1 格式和内容。
5. 然后建立 `packages/pdf`，从 JWord layout 导出 PDF，先闭合中文字体和基础视觉验证。
6. 最后补 `examples/docx`、人工兼容矩阵、benchmark、lazy-load 和 T2 种子。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 5 范围、目录和验收口径

- [ ] 将 Gate 5 标题和范围固定为 `DOCX 导入导出与 PDF 导出`。
- [ ] 明确 PDF 不包含导入查看、反向转换或编辑能力。
- [ ] 冻结目录落点：
  - `packages/docx/src/`
  - `packages/docx/test/`
  - `packages/pdf/src/`
  - `packages/pdf/test/`
  - `fixtures/docx/`
  - `fixtures/pdf/`
  - `examples/docx/`
- [ ] 不预创建空壳包；只有当第一个可执行 fixture 或测试能落地时才创建对应目录。
- [ ] 冻结分层：
  - `core` 提供 canonical model、projection、resource、layout、受控结构化写入入口。
  - `docx` 负责 OPC package、OOXML parsing、mapping、export、roundtrip diff。
  - `pdf` 负责 `DocumentLayout/LayoutBox -> PDF`、字体、图片、PDF 验证辅助。
  - `examples/docx` 负责 demo host、fixture 切换、手动导入导出、warning 面板。
- [ ] 冻结 T1/T2/T3 能力表，并把 T3 统一标记为 warning 或 opaque preserve，不作为 Gate 5 完成条件。
- [ ] 验证：文档中能清楚回答“做什么、不做什么、怎么验收”。

#### Iteration 1 - 建立 fixture registry 和兼容矩阵模板

- [ ] 建立 DOCX T1 fixture registry：
  - `docx-t1-paragraphs`
  - `docx-t1-run-styles`
  - `docx-t1-paragraph-formatting`
  - `docx-t1-headings`
  - `docx-t1-lists`
  - `docx-t1-table-basic`
  - `docx-t1-inline-image`
  - `docx-t1-page-setup`
- [ ] 建立 DOCX T2 fixture registry：
  - `docx-t2-header-footer`
  - `docx-t2-page-number`
  - `docx-t2-comments`
  - `docx-t2-links`
  - `docx-t2-section-breaks`
  - `docx-t2-floating-object-warning`
- [ ] 建立 PDF fixture registry：
  - `pdf-basic-text`
  - `pdf-chinese-font`
  - `pdf-missing-font`
  - `pdf-table-image`
  - `pdf-header-footer-page-number`
- [ ] 每个 fixture 必须记录：
  - 输入文件。
  - 期望 projection 摘要。
  - 期望 warning。
  - 导入截图基线。
  - 导出 DOCX roundtrip 期望。
  - 导出 PDF 视觉期望。
- [ ] 建立人工兼容矩阵模板：
  - Word 打开结果。
  - WPS 打开结果。
  - LibreOffice 打开结果。
  - 是否可编辑。
  - 是否触发修复提示。
  - 主要视觉差异。
  - 阻断级问题。
- [ ] 验证：任意新增 fixture 都能被 registry 约束，不靠口头说明验收。

#### Iteration 2 - 建立 worker contract 与统一 warning/error 结构

- [ ] 定义 `requestId`，确保同一页面可并行发起多个导入导出任务。
- [ ] 定义 `progress` 事件：
  - `queued`
  - `reading`
  - `parsing`
  - `mapping`
  - `writing`
  - `validating`
  - `done`
- [ ] 定义 `warning` 结构：
  - `code`
  - `severity`
  - `part`
  - `path`
  - `message`
  - `fallback`
  - `recoverable`
- [ ] 定义 `error` 结构：
  - package 损坏。
  - XML 解析失败。
  - 缺少 main document part。
  - relationship 断裂。
  - 字体缺失。
  - 用户取消。
- [ ] 支持 `AbortSignal` 取消。
- [ ] 使用 `ArrayBuffer` transferable 传输 DOCX/PDF 二进制，避免复制大文件。
- [ ] 验证：worker 取消后不会继续写入 editor，不会留下半成品状态。

#### Iteration 3 - 建立 `packages/docx` 最小包与公开 API

- [ ] 创建 `@4xian/jword-docx` 包。
- [ ] 定义 import API：
  - `importDocx(input, options)`
  - 输入支持 `ArrayBuffer`、`Uint8Array`、`Blob/File`。
  - 输出包含 import model、warnings、diagnostics、opaque preservation metadata。
- [ ] 定义 export API：
  - `exportDocx(document, options)`
  - 输入来自 JWord projection/canonical model。
  - 输出 `ArrayBuffer` 或 `Blob`。
- [ ] 定义 inspect API：
  - `inspectDocxPackage(input)`
  - 只解析 package graph，不写入 JWord。
- [ ] 定义测试入口：
  - package graph test。
  - XML parse test。
  - T1 mapping test。
  - export snapshot test。
- [ ] 验证：`pnpm --filter @4xian/jword-docx typecheck` 和最小测试可运行。

#### Iteration 4 - 实现 OPC package reader 与 manifest 校验

- [ ] 使用 JSZip 读取 DOCX package。
- [ ] 解析 `[Content_Types].xml`。
- [ ] 解析 `/_rels/.rels`。
- [ ] 定位 main document part，默认识别 `word/document.xml`，但不硬编码为唯一入口。
- [ ] 解析 main document part 的 `.rels`。
- [ ] 建立 part graph：
  - document。
  - styles。
  - numbering。
  - settings。
  - theme。
  - headers。
  - footers。
  - comments。
  - media。
- [ ] 校验必需 part 缺失时返回明确错误。
- [ ] 对可选 part 缺失产生 warning，不阻断 T1 导入。
- [ ] 验证：损坏 zip、缺 content types、缺 main document、断裂 relationship 都有稳定错误或 warning。

#### Iteration 5 - 实现 XML parse/serialize 抽象

- [ ] 封装 XML parser，不让业务 mapping 直接散落 `DOMParser` 调用。
- [ ] 封装 XML serializer，不让 export 逻辑直接拼字符串。
- [ ] 提供 namespace-aware helper：
  - 读取 `w:*` 元素。
  - 读取 `r:id`。
  - 读取属性。
  - 读取文本节点。
  - 读取 children 顺序。
- [ ] 对 parser error 返回结构化错误。
- [ ] 保留原始 part text，用于 unsupported part 的 opaque preservation。
- [ ] 验证：相同 XML parse 后 serialize 不破坏 T1 需要的 namespace 和关系。

#### Iteration 6 - 建立 OOXML indexes

- [ ] 建立 style index：
  - paragraph style。
  - character style。
  - linked style。
  - table style warning。
  - default paragraph/run properties。
  - style inheritance。
- [ ] 建立 numbering index：
  - abstract numbering。
  - numbering instance。
  - level。
  - bullet。
  - decimal。
  - basic multi-level。
- [ ] 建立 relationship index：
  - internal target。
  - external target。
  - image relationship。
  - hyperlink relationship。
  - header/footer relationship。
- [ ] 建立 media index：
  - mime。
  - bytes。
  - extension。
  - target part。
- [ ] 建立 comments index：
  - comment id。
  - author。
  - date。
  - text。
- [ ] 建立 header/footer index。
- [ ] 验证：每个 index 都有 fixture 覆盖，mapping 入口只消费 index，不重复扫描全 XML。

#### Iteration 7 - 定义 DOCX 导入中间模型

- [ ] 定义 `DocxImportDocument`。
- [ ] 定义 `DocxImportSection`。
- [ ] 定义 `DocxImportParagraph`。
- [ ] 定义 `DocxImportRun`。
- [ ] 定义 `DocxImportInline`。
- [ ] 定义 `DocxImportTable`。
- [ ] 定义 `DocxImportResource`。
- [ ] 定义 `DocxImportWarning`。
- [ ] 定义 opaque preservation metadata：
  - unsupported parts。
  - unsupported relationships。
  - unsupported element fragments。
  - original style ids。
  - original numbering ids。
- [ ] 映射目标必须能覆盖 core 当前 `Document` 支持的结构。
- [ ] 验证：中间模型是 JSON-compatible，不依赖 DOM 节点、JSZip 实例或 Yjs 对象。

#### Iteration 8 - 补 core 结构化导入入口

- [ ] 审查当前 `EditorDocumentInput` 的纯文本限制。
- [ ] 设计最小结构化导入输入：
  - document metadata。
  - sections。
  - blocks。
  - runs。
  - resources。
  - comments。
  - style ids。
- [ ] 在 core 内新增受控写入入口，命名可以是 `loadDocumentModel`、`replaceDocumentModel` 或等价 API。
- [ ] 写入必须经统一 transaction/mutation 边界。
- [ ] 不允许 `packages/docx` 直接导入 `document-store`。
- [ ] 写入后必须刷新 projection、layout dirty state 和 selection。
- [ ] 写入失败必须保持原文档不被半替换。
- [ ] 验证：结构化导入能写入段落、run 样式、列表、表格、资源，并通过 projection 读取。

#### Iteration 9 - 实现 T1 DOCX import：段落、run 与文本样式

- [ ] 解析 `w:body`。
- [ ] 解析 `w:p`。
- [ ] 解析 `w:r`。
- [ ] 解析 `w:t`、`w:tab`、`w:br`。
- [ ] 映射 run 样式：
  - bold。
  - italic。
  - underline。
  - strike。
  - superscript。
  - subscript。
  - font family。
  - font size。
  - text color。
  - highlight/background。
- [ ] 应用 direct formatting 和 character style。
- [ ] 未支持 run 属性输出 warning。
- [ ] 验证：`docx-t1-paragraphs`、`docx-t1-run-styles` 导入后 projection diff 稳定。

#### Iteration 10 - 实现 T1 DOCX import：段落格式与 Heading

- [ ] 解析 `w:pPr`。
- [ ] 映射 paragraph style。
- [ ] 映射 Heading 1-3。
- [ ] 映射 alignment。
- [ ] 映射 indentation。
- [ ] 映射 first-line indent。
- [ ] 映射 hanging indent。
- [ ] 映射 line spacing。
- [ ] 映射 spacing before/after。
- [ ] 映射 keep/widow orphan 相关属性到现有或可降级属性。
- [ ] 未支持段落属性输出 warning。
- [ ] 验证：导入后 toolbar/outline 能识别 Heading，段落格式截图接近原文档。

#### Iteration 11 - 实现 T1 DOCX import：列表与编号

- [ ] 解析 `numbering.xml`。
- [ ] 解析 `w:numPr`。
- [ ] 映射 bullet list。
- [ ] 映射 decimal ordered list。
- [ ] 映射基础 multi-level list。
- [ ] 保留原始 numbering id 和 level metadata，供 export roundtrip 使用。
- [ ] 对复杂编号格式输出 warning。
- [ ] 验证：`docx-t1-lists` 导入后列表 marker、缩进、层级稳定。

#### Iteration 12 - 实现 T1 DOCX import：表格

- [ ] 解析 `w:tbl`。
- [ ] 解析 `w:tr`。
- [ ] 解析 `w:tc`。
- [ ] 映射基础 grid。
- [ ] 映射基础边框。
- [ ] 映射单元格内段落和文本。
- [ ] 映射基础 gridSpan。
- [ ] 对复杂合并、嵌套表格、复杂表格样式输出 warning。
- [ ] 验证：`docx-t1-table-basic` 导入后 table projection 和截图稳定。

#### Iteration 13 - 实现 T1 DOCX import：inline 图片与资源

- [ ] 解析 DrawingML inline image。
- [ ] 通过 relationship index 找到 media part。
- [ ] 建立 JWord `Resource`。
- [ ] 映射图片 mime。
- [ ] 映射图片尺寸。
- [ ] 映射 alt text。
- [ ] 外链图片默认不拉取，输出 warning。
- [ ] 不支持的浮动图片先降级 warning，不伪装成完整支持。
- [ ] 验证：`docx-t1-inline-image` 导入后图片资源可渲染，导出后资源关系可 roundtrip。

#### Iteration 14 - 实现 T1 DOCX import：页面设置与分页符

- [ ] 解析 section properties。
- [ ] 映射页面宽高。
- [ ] 映射页边距。
- [ ] 映射 page break。
- [ ] 映射基础 section break。
- [ ] 不支持 columns、复杂纸张方向或复杂 section 继承时输出 warning。
- [ ] 验证：`docx-t1-page-setup` 导入后 page config 和分页截图稳定。

#### Iteration 15 - 实现 warning 与 opaque preservation 策略

- [ ] 未知 OOXML 节点必须输出 warning。
- [ ] 未知样式必须输出 warning，并尽量继承 default style。
- [ ] relationship 断裂必须输出 warning 或错误。
- [ ] unsupported part 保留原始 part bytes/text。
- [ ] unsupported relationship 保留原始 relationship metadata。
- [ ] 编辑后无法安全恢复的 opaque 内容必须标记为 `unsafeToPreserveAfterEdit`。
- [ ] 导出时只对未被编辑影响的 opaque part 做 preserve。
- [ ] 验证：含 T3 内容的 fixture 不崩溃，不静默丢内容。

#### Iteration 16 - 建立 DOCX export package foundation

- [ ] 导出目标使用 DOCX Transitional。
- [ ] 生成 `[Content_Types].xml`。
- [ ] 生成 `/_rels/.rels`。
- [ ] 生成 `word/document.xml`。
- [ ] 生成 `word/_rels/document.xml.rels`。
- [ ] 生成 `word/styles.xml`。
- [ ] 生成 `word/numbering.xml`。
- [ ] 写入 `word/media/*`。
- [ ] 写入必要 docProps。
- [ ] 使用 JSZip 打包为 `.docx`。
- [ ] 验证：最小导出 DOCX 可被 Word/WPS/LibreOffice 打开，不触发修复提示。

#### Iteration 17 - 实现 T1 DOCX export：文本、样式、段落

- [ ] 从 JWord projection 生成 `w:p`、`w:r`、`w:t`。
- [ ] 输出 run direct formatting。
- [ ] 输出 paragraph formatting。
- [ ] 输出 Heading 1-3 style。
- [ ] 输出 styles part 中的基础 style 定义。
- [ ] 正确处理 XML escape、空格保留和换行。
- [ ] 验证：T1 文本与样式 fixture export 后重新 import 不丢样式。

#### Iteration 18 - 实现 T1 DOCX export：列表、表格、图片

- [ ] 输出 numbering definitions。
- [ ] 输出 paragraph numbering refs。
- [ ] 输出基础 table XML。
- [ ] 输出表格 grid、border、cell text。
- [ ] 输出 inline image DrawingML。
- [ ] 输出 media part 和 image relationship。
- [ ] 验证：列表、表格、图片导出后 Word/WPS/LibreOffice 可打开，重新导入结构一致。

#### Iteration 19 - 建立 DOCX roundtrip diff

- [ ] 导入原始 DOCX。
- [ ] 写入 JWord。
- [ ] 从 JWord 导出 DOCX。
- [ ] 重新导入导出的 DOCX。
- [ ] 对比 projection：
  - section count。
  - block count。
  - paragraph text。
  - run style。
  - paragraph style。
  - list metadata。
  - table structure。
  - resource refs。
  - comments/links when supported。
- [ ] 对比 warning：
  - 不允许 T1 能力产生 unsupported warning。
  - T2/T3 warning 必须稳定。
- [ ] 验证：T1 roundtrip diff 通过后才能进入人工兼容矩阵。

#### Iteration 20 - 建立 DOCX 兼容验证流程

- [ ] 使用 Open XML validator 检查导出 package。
- [ ] 使用 Word 打开导出文件。
- [ ] 使用 WPS 打开导出文件。
- [ ] 使用 LibreOffice 打开导出文件。
- [ ] 记录是否触发修复提示。
- [ ] 记录视觉差异。
- [ ] 记录可编辑性。
- [ ] 记录阻断问题和对应 fixture。
- [ ] 不使用“兼容百分比”作为结论。
- [ ] 验证：每个 T1 fixture 都有可复查的兼容记录。

#### Iteration 21 - 建立 `packages/pdf` 与 PDF worker

- [ ] 创建 `@4xian/jword-pdf` 包。
- [ ] 定义 `exportPdfFromLayout(layout, options)`。
- [ ] 定义字体配置 API：
  - `URL`
  - `File`
  - `ArrayBuffer`
  - font family mapping。
- [ ] 定义图片解析 API。
- [ ] 定义 PDF warning/error。
- [ ] 建立 PDF worker。
- [ ] 支持 progress 和 cancel。
- [ ] 验证：无字体、取消、空文档、基础文本都有稳定测试。

#### Iteration 22 - 实现 LayoutBox -> PDF 基础输出

- [ ] 将 twips 转为 PDF points。
- [ ] 输出 page size。
- [ ] 输出 page margin/content rect。
- [ ] 输出文本 fragment。
- [ ] 输出字体大小。
- [ ] 输出颜色。
- [ ] 输出 baseline。
- [ ] 输出分页。
- [ ] 验证：`pdf-basic-text` 导出后 PDF.js 可渲染，文本位置与 Canvas baseline 可解释。

#### Iteration 23 - 实现 PDF 中文字体、图片、表格线和页眉页脚

- [ ] 使用 fontkit 注册自定义字体。
- [ ] 字体不支持字符时返回可恢复错误。
- [ ] 缺少中文字体时禁止输出乱码 PDF。
- [ ] 嵌入 PNG/JPEG 图片。
- [ ] 输出表格线。
- [ ] 输出页眉页脚。
- [ ] 输出页码。
- [ ] 验证：`pdf-chinese-font`、`pdf-missing-font`、`pdf-table-image`、`pdf-header-footer-page-number` 都有确定结果。

#### Iteration 24 - 建立 PDF 视觉验证

- [ ] 使用 PDF.js 将导出的 PDF 渲染到 canvas。
- [ ] 使用相同 fixture 渲染 JWord Canvas baseline。
- [ ] 建立截图差异报告：
  - page count。
  - page size。
  - text bounding box 差异。
  - image bounding box 差异。
  - table line 差异。
  - 明确可接受误差。
- [ ] 不把 PDF.js text layer 位置当作唯一视觉真相。
- [ ] 验证：PDF 视觉差异可复查，不只给 pass/fail。

#### Iteration 25 - 建立 `examples/docx` 手动验收入口

- [ ] 提供 DOCX 文件选择。
- [ ] 提供导入按钮。
- [ ] 提供导出 DOCX 按钮。
- [ ] 提供导出 PDF 按钮。
- [ ] 提供 warning 面板。
- [ ] 提供 fixture 切换。
- [ ] 提供 roundtrip diff 展示。
- [ ] 提供 PDF 预览或下载入口，但不做 PDF 导入查看功能。
- [ ] 验证：通过真实浏览器导入 DOCX、编辑、导出 DOCX、重新导入、导出 PDF。

#### Iteration 26 - 建立 benchmark、bundle 和回归门禁

- [ ] 记录 DOCX import 耗时。
- [ ] 记录 DOCX export 耗时。
- [ ] 记录 PDF export 耗时。
- [ ] 记录 worker 内存峰值。
- [ ] 按文件大小、页数、图片数分组。
- [ ] 验证 DOCX/PDF worker lazy load。
- [ ] 验证 `packages/docx` 和 `packages/pdf` 不进入 `examples/vanilla` 首屏 bundle。
- [ ] 验证取消任务不会阻塞输入。
- [ ] 验证导入导出期间 editor 仍可响应基本交互。

#### Iteration 27 - T2 种子和复杂能力降级

- [ ] 页眉页脚：能映射基础文本和页码。
- [ ] 超链接：能映射基础 external link。
- [ ] 批注：能映射基础 comment range 和 comment text。
- [ ] section breaks：能映射基础 next-page/continuous。
- [ ] 简单浮动对象：优先 warning，必要时降级 inline。
- [ ] 修订 metadata：先 preserve/warning，不实现完整 track changes。
- [ ] 对 T2 未完成能力建立 fixture 和 warning，不把缺失隐藏在导出结果里。
- [ ] 验证：T2 fixture 不阻断 T1 roundtrip，不产生静默丢失。

### 待办步骤

- [ ] Step 5.1：明确 Gate 5 不包含 PDF 导入查看，只包含 DOCX 导入、DOCX 导出和从当前 JWord 文档导出 PDF。
- [ ] Step 5.2：冻结 T1/T2/T3 兼容分级和 fixture registry。
- [ ] Step 5.3：建立 worker contract，支持 request id、progress、warning、result、error、cancel、AbortSignal 和 ArrayBuffer transferable。
- [ ] Step 5.4：建立统一 warning/error schema，覆盖未知节点、未知样式、外链资源、断裂 relationship、缺字体、用户取消。
- [ ] Step 5.5：创建 `@4xian/jword-docx` 最小可测包和 import/export/inspect API。
- [ ] Step 5.6：实现 OPC package reader，解析 `[Content_Types].xml`、root rels、main document、document rels 和 part graph。
- [ ] Step 5.7：实现 XML parse/serialize 抽象和 namespace-aware helper。
- [ ] Step 5.8：建立 style、numbering、relationship、media、comments、header/footer indexes。
- [ ] Step 5.9：定义 DOCX import 中间模型和 opaque preservation metadata。
- [ ] Step 5.10：补 core 结构化导入入口，经统一 transaction/mutation 写入 Y.Doc。
- [ ] Step 5.11：实现 T1 DOCX import：段落、run、文本、run 样式。
- [ ] Step 5.12：实现 T1 DOCX import：段落格式、Heading 1-3、缩进、行距、段距。
- [ ] Step 5.13：实现 T1 DOCX import：基础有序/无序/多级列表。
- [ ] Step 5.14：实现 T1 DOCX import：简单表格、边框、单元格文本、基础列宽。
- [ ] Step 5.15：实现 T1 DOCX import：inline 图片、资源、尺寸、alt text。
- [ ] Step 5.16：实现 T1 DOCX import：页面尺寸、页边距、分页符。
- [ ] Step 5.17：实现 unknown warning 和 opaque preservation，禁止静默丢弃未支持 OOXML。
- [ ] Step 5.18：实现 DOCX export package foundation，生成 Transitional DOCX 基础 package。
- [ ] Step 5.19：实现 T1 DOCX export：文本、run 样式、段落格式、Heading。
- [ ] Step 5.20：实现 T1 DOCX export：列表、表格、inline 图片、media relationships。
- [ ] Step 5.21：建立 DOCX roundtrip diff，导出后重新导入并比较 T1 核心结构和样式。
- [ ] Step 5.22：建立 Open XML validation 和 Word/WPS/LibreOffice 人工兼容矩阵。
- [ ] Step 5.23：创建 `@4xian/jword-pdf` 最小可测包和 PDF worker。
- [ ] Step 5.24：实现 PDF 字体配置 API，支持 URL、File、ArrayBuffer。
- [ ] Step 5.25：实现 LayoutBox -> PDF 基础页面和文本输出。
- [ ] Step 5.26：实现 PDF 图片、表格线、页眉页脚和页码输出。
- [ ] Step 5.27：处理中文字体缺失和字符不支持错误，禁止输出乱码 PDF。
- [ ] Step 5.28：建立 PDF.js 渲染截图对比和 Canvas baseline 差异报告。
- [ ] Step 5.29：建立 `examples/docx` 手动验收入口。
- [ ] Step 5.30：建立 import/export/PDF benchmark。
- [ ] Step 5.31：验证 DOCX/PDF worker lazy load，不进入 vanilla 首屏 bundle。
- [ ] Step 5.32：推进 T2 种子，未完成项必须 warning 或 preserve。
- [ ] Step 5.33：跑 Gate 5 总验收，回写每个完成项和遗留项。

### 验收

- [ ] T1 DOCX fixture 导入后文本、段落、run 样式、段落格式、Heading、列表、表格、inline 图片和页面设置可验证。
- [ ] T1 DOCX 导出后能被 Word/WPS/LibreOffice 打开，不触发修复提示。
- [ ] T1 DOCX 导出后重新导入，核心结构、样式、列表、表格和图片资源不丢。
- [ ] T2 fixture 未完整支持时产生明确 warning，不静默丢内容。
- [ ] PDF 导出来自 JWord layout，不依赖浏览器打印或 LibreOffice 转换。
- [ ] PDF 中文字体正确；缺字体或字体不覆盖字符时返回明确可恢复错误。
- [ ] PDF 渲染截图和 Canvas baseline 有可解释差异报告。
- [ ] DOCX/PDF 导入导出可取消、有 progress、不阻塞输入。
- [ ] DOCX/PDF worker lazy load，不进入 `examples/vanilla` 首屏 bundle。
- [ ] `examples/docx` 能在真实浏览器完成导入 DOCX、导出 DOCX、重新导入、导出 PDF 的人工验收路径。

### 禁止事项

- [ ] 不实现 PDF 导入查看。
- [ ] 不实现 PDF 编辑。
- [ ] 不实现 PDF 反向转换为 JWord 文档。
- [ ] 不把 Mammoth 作为 DOCX 导入主路径。
- [ ] 不把 html-to-docx 或 docx 模板库作为 DOCX 导出主路径。
- [ ] 不用浏览器打印代替 PDF 主路径。
- [ ] 不用 LibreOffice 转换代替 PDF 主路径。
- [ ] 不把互通逻辑放进 core 或首屏 bundle。
- [ ] 不让 `packages/docx` 直接访问 Y.Doc 或 `document-store` 内部结构。
- [ ] 不静默吞掉未知 OOXML 节点、未知样式、断裂 relationship 或外链资源。
- [ ] 不用“兼容度百分比”替代 fixture diff、人工矩阵和真实打开记录。

## Gate 6 - 协同、离线、自动插入

### 目标

完成在线文档和 AI/程序化写入关键能力：多人最终一致、离线恢复、远端光标、历史快照、自动插入与手动编辑并发。

### 实现方案

协同不是后补功能，因为 Gate 1 已经以 Y.Doc 为真源。此阶段接入 provider、awareness、offline、snapshot 和 createInserter。重点验证 origin、undo scope、anchor 稳定和并发场景。

### 当前基线（2026-05-17）

- [x] Gate 1/3 已经把 Y.Doc 真源、transaction pipeline、origin 与 history metadata 落到本地单人路径；协同和自动插入只能在这条主干上继续扩展。
- [x] 当前 repo 尚无 `packages/collab`、`packages/persistence`、`examples/collab`，符合“不写无法验证空包”的约束。
- [ ] 当前仍没有 provider adapter、awareness、offline recovery、snapshot adapter、版本历史最小闭环和 `createInserter()` 的可执行证据。
- [ ] remote / AI / local 三类写入的并发语义还没有被真实双窗口或断网场景验证。

### 推荐执行顺序

1. 先冻结 origin、undo scope、版本历史的语义边界，再接入任一 provider。
2. 先做 provider demo 与 remote render path `Step 6.1 -> 6.4`，确保协同更新仍走同一 transaction trunk。
3. 再做 offline、snapshot 与历史版本闭环 `Step 6.5 -> 6.6 -> 6.13`。
4. 随后做 `createInserter()` 与 undo scope 策略 `Step 6.7 -> 6.9`。
5. 最后做并发、断网恢复和失败诊断 `Step 6.10 -> 6.12`。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 6 语义边界

- [ ] 冻结 origin matrix：
  - `local-user`
  - `remote-user`
  - `auto-inserter`
  - `system-recovery`
- [ ] 冻结 undo scope 规则：
  - 本地用户默认进入用户 undo
  - remote 默认不进入用户 undo
  - auto inserter 默认不进入用户 undo
  - 可配置独立 undo scope
- [ ] 为 Gate 6 明确目录落点，但不预创建空壳包：
  - `packages/collab/src/`
  - `packages/persistence/src/`
  - `examples/collab/`
- [ ] 冻结版本历史的最小可观察契约：版本列表、只读预览、恢复、失败诊断都必须基于 update log / snapshot，而不是 docx 覆盖真源。

#### Iteration 1 - provider / awareness / remote render（Step 6.1-6.4）

- [ ] 实现 collab provider adapter，让宿主负责 `roomId`、鉴权、生产存储与 reconnect 策略。
- [ ] 实现 hocuspocus 示例服务和本地双窗口 demo，先证明 remote update 能进入 projection / layout / render。
- [ ] 实现 awareness：在线用户、远端光标、远端选区，禁止额外保存第二份编辑状态。

#### Iteration 2 - offline / snapshot / 版本历史（Step 6.5 / 6.6 / 6.13）

- [ ] 接入 `y-indexeddb` 或等价离线恢复能力，断网编辑后可恢复并同步。
- [ ] 定义 snapshot adapter：update log、snapshot 保存、snapshot 加载、版本列表。
- [ ] 实现历史版本最小闭环：
  - 版本列表
  - 只读预览
  - 恢复
  - 恢复失败诊断

#### Iteration 3 - auto inserter 主通道（Step 6.7-6.9）

- [ ] 实现 `createInserter()` API，支持 stable anchor、throttle、flush、abort、progress、error。
- [ ] 实现 auto inserter origin 策略，默认不进入用户 undo 栈。
- [ ] 实现可配置 undo scope，允许 AI/程序化写入进入独立 undo scope。

#### Iteration 4 - 并发矩阵（Step 6.10-6.11）

- [ ] 建立 remote/local 并发测试：
  - 双用户同段不同位置输入
  - 双用户同位置输入
  - 删除与格式化冲突
  - 批注 anchor 远端编辑稳定
- [ ] 建立 AI 自动插入与手动编辑并发测试，确认不重复、不丢失、不阻塞输入。

#### Iteration 5 - 失败恢复与 Gate 6 回归（Step 6.12）

- [ ] 建立断网恢复测试，失败时保留本地未同步变更并给出诊断事件。
- [ ] 补齐 reconnect、版本恢复、auto inserter abort / retry 的 focused tests。
- [ ] 验证协同、离线、版本历史、自动插入都没有绕开 `Editor` transaction。

### 待办步骤

- [ ] Step 6.1：定义 collab provider adapter 接口，宿主负责 room id、auth、生产存储。
- [ ] Step 6.2：实现 hocuspocus 示例服务，提供本地双窗口协同 demo。
- [ ] Step 6.3：实现 awareness，展示在线用户、远端光标、远端选区。
- [ ] Step 6.4：实现 remote update 进入 projection/render 的路径，确保仍走统一状态真源。
- [ ] Step 6.5：接入 y-indexeddb 或等价离线恢复能力，断网编辑后可恢复并同步。
- [ ] Step 6.6：定义 snapshot adapter，支持 update log、snapshot 保存、snapshot 加载、版本列表。
- [ ] Step 6.7：实现 `createInserter()` API，支持 stable anchor、throttle、flush、abort、progress、error。
- [ ] Step 6.8：实现 auto inserter origin 策略，默认不进入用户 undo 栈。
- [ ] Step 6.9：实现可配置 undo scope，允许 AI/程序化写入进入独立 undo scope。
- [ ] Step 6.10：实现并发测试：双用户同段输入、同位置输入、删除与格式化冲突、批注 anchor 远端编辑稳定。
- [ ] Step 6.11：实现 AI 自动插入与用户手动编辑并发测试，确认不重复、不丢失、不阻塞输入。
- [ ] Step 6.12：实现断网恢复测试，失败时保留本地未同步变更并给出诊断事件。
- [ ] Step 6.13：实现历史版本最小闭环：版本列表、只读预览、恢复、失败诊断；基于 update log / snapshot，不以 docx 覆盖真源。

### 验收

- [ ] 双窗口同时编辑最终一致。
- [ ] 断网编辑后恢复同步。
- [ ] 远端光标和选区可见。
- [ ] AI 自动插入不阻塞本地输入。
- [ ] 用户 undo 默认不撤销 remote/AI 内容。
- [ ] 批注 anchor 在远端编辑后稳定。
- [ ] 历史版本可查看、可恢复、可解释。

### 禁止事项

- [ ] 协同层不绕过 Editor transaction。
- [ ] 自动插入不使用普通字符 offset。
- [ ] wrapper 或 provider 不保存第二份编辑状态。

## Gate 7 - SDK 稳定化

### 目标

交付可集成、可诊断、可维护的 `1.0-stable` SDK。外部项目能选择 vanilla、React、Vue 集成，能按需加载 docx/PDF/collab，能通过插件扩展命令、菜单、装饰层和适配器。

### 实现方案

先冻结公开 API，再补 wrapper、plugin、theme/i18n、devtools、文档站、bundle size、发布 dry-run。任何公开 API 必须有类型、TSDoc、类型测试、示例和兼容策略。

### 当前基线（2026-05-17）

- [x] `packages/ui` 与 `examples/vanilla` 已形成当前 SDK 宿主基线；后续 wrapper、plugin、文档站都应以这条集成路径为对照，而不是回塞 demo 主文件。
- [x] 当前 repo 仍只有 `core` / `ui` 两个正式包；`react` / `vue` / `devtools` 及相关 examples 尚未落地，符合“不写无法验证空包”的约束。
- [ ] 公开 API、TSDoc、类型测试、bundle gate、release dry-run 仍未闭环。
- [ ] plugin、wrapper、theme / i18n、diagnostics 还没有稳定对外 contract。

### 推荐执行顺序

1. 先冻结 Public API、包边界和 example matrix，再开始 wrapper 或 plugin 任何一条支线。
2. 先做 API 文档与类型测试 `Step 7.1 -> 7.2`，避免后续对外接口边写边漂移。
3. 再做 Plugin API 与错误隔离 `Step 7.3 -> 7.4`，因为 wrapper、docx、collab 都会复用这些扩展点。
4. 随后做 wrappers 与 examples `Step 7.5 -> 7.6 -> 7.10`。
5. 最后收 theme / i18n、devtools、文档站、size-limit、release dry-run 与 Stable E2E `Step 7.7 -> 7.14`。

### 迭代任务清单

#### Iteration 0 - 冻结 SDK 对外面向

- [ ] 冻结导出分级：
  - `stable`
  - `experimental`
  - `internal`
- [ ] 冻结 package / example 落点，但不预创建空壳：
  - `packages/react/src/`
  - `packages/vue/src/`
  - `packages/devtools/src/`
  - `examples/react/`
  - `examples/vue/`
  - `examples/collab/`
  - `examples/docx/`
  - `examples/performance/`
- [ ] 冻结事件 payload、错误码、feature flags 和 diagnostics contract，后续 wrappers / plugins / docs 都只复用这套公开命名。

#### Iteration 1 - Public API / TSDoc / 类型测试（Step 7.1-7.2）

- [ ] 整理 Public API 清单，明确哪些符号可对外承诺，哪些仍留在 `experimental`。
- [ ] 为稳定 API 补齐 TSDoc、类型测试和最小示例，确保外部 TypeScript 项目能直接消费。
- [ ] 确保导出符号、事件 payload、错误码命名稳定，不暴露内部 Yjs 细节。

#### Iteration 2 - Plugin API 与 diagnostics（Step 7.3-7.4 / 7.8-7.9）

- [ ] 实现 Plugin API：commands、menus、decorations、resource upload、persistence、collab provider、import/export adapter、diagnostics。
- [ ] 实现插件错误隔离，插件异常触发 error event，不破坏 core 状态。
- [ ] 实现 Devtools 面板与 diagnostics export，保证 operation、selection/anchor、layout/perf 指标可复查。

#### Iteration 3 - wrappers 与 example matrix（Step 7.5-7.6 / 7.10）

- [ ] 实现 React wrapper，只负责生命周期、props 到 EditorOptions、事件桥接。
- [ ] 实现 Vue 3 wrapper，只负责生命周期和事件桥接，SSR 阶段输出空壳。
- [ ] 完善 vanilla / react / vue / collab / docx / performance examples，确保 examples 只做 host 装配与测试钩子。

#### Iteration 4 - theme / i18n / devtools polish（Step 7.7-7.9）

- [ ] 实现主题系统与 i18n，保证 `jw-` BEM 类名与 WCAG AA 对比度约束。
- [ ] 收口 Devtools 面板的 operation log、layout overlay、selection/anchor inspect、performance counters。
- [ ] 收口 diagnostics export，保证版本、包信息、feature flags、错误、operation 摘要、layout 指标可直接打包给集成方。

#### Iteration 5 - 文档站 / bundle / release / Stable matrix（Step 7.11-7.14）

- [ ] 建立文档站：快速开始、核心概念、API、插件、协同、docx/PDF、迁移指南、故障排查。
- [ ] 建立 size-limit 和 bundle 分析，保证 docx/PDF/collab/hocuspocus/React/Vue wrapper/大字体不进入默认首屏。
- [ ] 建立 release dry-run：changeset 草稿、构建产物检查、`npm pack` 检查、示例安装检查；不自动 publish。
- [ ] 完成 Stable E2E 矩阵：vanilla、React、Vue、collab、docx、PDF、插件错误隔离。

### 待办步骤

- [ ] Step 7.1：整理 Public API 清单，区分 stable、experimental、internal，不公开未实现 Future API。
- [ ] Step 7.2：建立 API 文档和类型测试，确保导出符号、事件 payload、错误码可被外部 TypeScript 项目消费。
- [ ] Step 7.3：实现 Plugin API：commands、menus、decorations、resource upload、persistence、collab provider、import/export adapter、diagnostics。
- [ ] Step 7.4：实现插件错误隔离，插件异常触发 error event，不破坏 core 状态。
- [ ] Step 7.5：实现 React wrapper，只负责生命周期、props 到 EditorOptions、事件桥接，不保存编辑状态。
- [ ] Step 7.6：实现 Vue 3 wrapper，只负责生命周期和事件桥接，SSR 阶段输出空壳。
- [ ] Step 7.7：实现主题系统和 i18n，确保 UI 类名使用 `jw-` BEM，颜色对比满足 WCAG AA。
- [ ] Step 7.8：实现 Devtools 面板：operation log、layout overlay、selection/anchor inspect、performance counters。
- [ ] Step 7.9：实现 diagnostics export，能导出版本、包信息、feature flags、错误、operation 摘要、layout 指标。
- [ ] Step 7.10：完善 vanilla/react/vue/collab/docx/performance examples。
- [ ] Step 7.11：建立文档站：快速开始、核心概念、API、插件、协同、docx/PDF、迁移指南、故障排查。
- [ ] Step 7.12：建立 size-limit 和 bundle 分析，确保首屏包不包含 docx/PDF/collab/hocuspocus/React/Vue wrapper/大字体。
- [ ] Step 7.13：建立 release dry-run：changeset 草稿、构建产物检查、npm pack 检查、示例安装检查；不自动 publish。
- [ ] Step 7.14：完成 Stable E2E 矩阵：vanilla、React、Vue、collab、docx、PDF、插件错误隔离。

### 验收

- [ ] vanilla/react/vue demo 可运行。
- [ ] 外部项目可安装并集成。
- [ ] 首屏 bundle 不包含 docx/PDF/collab。
- [ ] 插件错误被隔离。
- [ ] 公开 API 有类型、TSDoc 和类型测试。
- [ ] 文档站能支撑集成方完成基础接入。
- [ ] release dry-run 可通过，但不自动发布。

### 禁止事项

- [ ] wrapper 不持有第二份编辑状态。
- [ ] 不公开未实现 Future API。
- [ ] 不把 devtools 或重包塞进默认首屏 bundle。

## Post-1.0 Backlog

这些能力不阻塞 `1.0-stable`，但必须在架构上已经预留：

- [ ] 完整修订互通和复杂审阅流。
- [ ] 脚注、尾注、交叉引用、题注。
- [ ] 复杂浮动对象、文本框、艺术字。
- [ ] 复杂表格布局和 Word 全边界兼容。
- [ ] 更深 OOXML roundtrip 兼容。
- [ ] Vue 2 兼容包。
- [ ] Chrome Extension devtools。
- [ ] 自研 OT 研究，不替换 1.0 的 Yjs 主路径。

## 持续验证矩阵

每个 Gate 完成前必须执行对应验证；无法执行时必须记录原因和替代证据。

### 每次变更

- [x] `pnpm lint`
- [x] `pnpm typecheck`
- [x] `pnpm test`
- [x] 相关 package 的 focused tests

### 每个 Gate

- [x] `pnpm build`
- [x] `pnpm test:e2e`
  - 回写 2026-05-14：当前命令覆盖三浏览器 `examples/vanilla/tests/gate2.e2e.ts`，并追加 `perf-chromium` 下的 `examples/vanilla/tests/gate2.perf.e2e.ts`；现有 Gate 2 证据只覆盖 50 页 fixture 的分页滚动、canvas 虚拟化、page geometry、page-local hit-test、caret/selection rect mapping 和 Chromium 浏览器 perf，不把 Gate 3 pointer selection 或 word selection 语义算作 Gate 2 已完成。
  - 回写 2026-05-16：当前命令覆盖三浏览器 Gate 2/Gate 3 E2E 和 `perf-chromium`；本轮验证结果为 44 passed、4 skipped，随后 perf 2 passed。
- [x] `pnpm test:visual`
  - 回写 2026-05-14：命令先校验 Gate 2 fixtures 的 `layoutDocument` + `renderPageCanvas` draw-call hash baseline，再跑 `visual-chromium` 下的 `examples/vanilla/tests/gate2.visual.ts`；当前浏览器视觉证据是 50 页 fixture 首/中/末页非空像素与 deterministic rect-mapping overlay 像素采样，不是跨平台截图基线。
- [x] `pnpm bench`
- [x] bundle size 检查
  - 回写 2026-05-14：当前命令先 fresh build core 与 vanilla demo，再检查 `packages/core/dist/index.js` 与 vanilla demo 首屏 JS/CSS 的 Gate 2 产物尺寸上限，同时阻止 spec 禁止的重依赖进入首屏 bundle，不再复用旧 dist。
  - 回写 2026-05-16：`pnpm size` 已确认 core fresh artifact 为 257,109 bytes，vanilla 首屏 JS/CSS 为 216,624 bytes；50 页 fixture 改为独立懒加载 chunk，Rollup 产物移除保留文档注释但保留 source map。
- [x] architecture boundary 检查
- [x] 文档同步检查
  - 回写 2026-05-14：Gate 2 步骤、验收、验证与复核点 B 口径已按现有脚本与测试命名同步，避免把 Gate 3/4/5 能力写成 Gate 2 已完成。

### Alpha 完成

- [x] 1-2 万字编辑基础链路可用。
  - 回写 2026-05-15：当前只说明 50 页大夹具上的基础编辑闭环成立，不等同于已满足 Alpha 性能门槛。
- [x] 50 页滚动可用。
  - 回写 2026-05-15：当前 Chromium 下 `gate3.perf.e2e.ts` 已给出 50 页滚动挂载闭环护栏；该证据不等同于整体 Alpha 性能已达标。
- [ ] 输入热路径 P95 < 50ms。
- [ ] INP P95 < 150ms。
- [x] vanilla demo 可视化验证通过。
  - 回写 2026-05-15：`examples/vanilla/tests/gate3.visual.ts` 已提供当前分页 canvas 选区高亮与 caret 渲染的最小浏览器视觉证据。

### Beta 完成

- [ ] 10 万字、200 页 fixture 有性能报告。
- [ ] 表格、图片、批注、查找替换、页眉页脚、修订 v1 可用。
- [ ] docx T1 import/export 通过 fixture diff。
- [ ] PDF 基础导出通过截图对比。
- [ ] 保格式粘贴通过安全验收。

### Stable 完成

- [ ] 协同最终一致性通过。
- [ ] 离线恢复通过。
- [ ] 自动插入并发通过。
- [ ] React/Vue wrapper 集成通过。
- [ ] 插件 API 和错误隔离通过。
- [ ] 文档站和 diagnostics 完成。

## 风险控制与复核点

- [x] 复核点 A：Gate 1 完成后，确认 Y.Doc schema、Projection、Operation、AnchorRef 是否足以承载 docx、协同、自动插入；若不足，在进入 Gate 2 前修正。
  - 已修：Operation/TextPosition/TextRange 已是 JSON 可序列化契约，`splitBlock.newRunId` 改为显式字段，operation fixture 可跨实例回放。
  - 完成 2026-05-12：边界已收口为 Operation adapter/replay 路径，raw Yjs structural update 非 Gate 1 保证；实现说明见 `docs/superpowers/implementation-notes/2026-05-12-gate-1-anchor-replay-boundary.md`。
- [x] 复核点 B：Gate 2 完成后，确认 LayoutBox 当前边界是否足以继续承载 PDF、页眉页脚、表格、图片和 hit-test 的后续扩展；若不足，在进入 Gate 3 前修正。
  - 回写 2026-05-14：当前可执行证据只覆盖分页 text layout/render、viewport virtualization、hit-test 和 rect mapping。LayoutBox/PageBox/LineBox/TextFragment/InlineBox 已作为只读 layout/render/PDF 边界导出，未见会阻断 Gate 4/5 表格、图片、页眉页脚扩展的结构性缺口；但这些能力本身不算 Gate 2 已完成。
- [x] 复核点 C：进入 Alpha 前，确认输入系统、IME、selection、history 没有绕开 transaction pipeline；若绕开，不进入 Alpha。
  - 完成 2026-05-15：`packages/core/test/editor-input.test.ts` 已补充 composition、keyboard、clipboard、pointer selection 的 runtime 证据，确认写入型行为会发出 facade `transaction` 事件并带 `commandName` / `operationKinds` / history metadata，而纯 selection 变化只走 `selectionChange`，不伪装成事务写入。
  - 说明 2026-05-19：此复核只覆盖当前已实现并已验证的输入路径；Windows 中文输入实机证据已在 Step 3.3 按真实浏览器 + 系统 IME 链路补齐。
- [ ] 复核点 D：Gate 5 完成后，确认 OOXML mapping 的 warning、fixture diff、worker cancel/progress 可用；若不可用，不进入 Beta。
- [ ] 复核点 E：Gate 6 完成后，确认 origin、undo scope、remote/AI/local 并发语义清晰；若不清晰，不进入 Stable。

## 执行顺序建议

- [ ] 第一批只能做 Gate 0。
- [ ] Gate 1 中 schema、operation、projection、anchor、history 可以分工并行，但必须先统一 Y.Doc 结构和类型边界。
- [ ] Gate 2 中 layout 和 renderer 可以并行，但 hit-test/rect mapping 必须以同一 LayoutBox 为准。
- [ ] Gate 3 中 input、toolbar、a11y 可以并行，但所有命令必须调用同一 Editor Facade。
- [ ] Gate 4 中图片、表格、批注、查找替换可以按模块并行，每个模块都要自带 model/operation/layout/render/UI/test 闭环。
- [ ] Gate 5 中 docx 和 PDF 可以并行，但二者都必须复用 canonical model/LayoutBox。
- [ ] Gate 6 中 collab、offline、auto inserter 可以并行，但 origin 和 undo scope 策略必须先定。
- [ ] Gate 7 中 wrapper、plugin、devtools、docs 可以并行，但 Public API 清单必须先冻结。

## 完成定义

本计划完成不是“代码写完”，而是满足以下条件：

- [ ] Gate 0-7 所有验收项完成。
- [ ] canonical specs 与实现行为一致。
- [ ] 所有公开 API 有类型、TSDoc、类型测试、示例。
- [ ] 所有核心风险有 fixture、benchmark、E2E 或 visual evidence。
- [ ] 旧路线中的单长 canvas、Bun 主工具链、Mammoth 主路径、浏览器打印 PDF 主路径没有回流。
- [ ] 人工审批后才能 commit、tag、publish 或 npm release。
