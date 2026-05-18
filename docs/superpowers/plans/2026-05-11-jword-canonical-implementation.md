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
- [ ] Step 3.3：实现 composition handler，覆盖 Chrome/Safari/Firefox 差异和 macOS/Windows 中文输入。
  完成 2026-05-14：当前宿主浏览器的 Chromium、Firefox、WebKit composition 事件链已由 `examples/vanilla/tests/gate3-input.e2e.ts` 验证；仍缺 Windows 中文输入实机证据，因此此项暂不勾选。
  回写 2026-05-15：按当前阶段决策，Windows 中文输入实机证据暂作为进入 Gate 4 的豁免项保留到 Alpha 发布前补证；此步骤因此不再阻塞 Gate 4 开发，但仍不记为完全完成。
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
  - 完成 2026-05-18：上标、下标的 command builder、Editor facade、public export 与 toolbar summary 已闭环；定点 Vitest 已覆盖 command/projection/facade/undo-redo，Kimi 浏览器实测 `toggleSuperscript()` 与 `toggleSubscript()` 互斥生效，`[data-jword-run-summary]` 同步显示 `上标 关 / 下标 开`。
- [x] Step 3.15：补齐 paragraph format v1：行距、段前、段后、首行缩进、悬挂缩进；要求 command -> projection -> layout -> toolbar 状态闭环。
  - 完成 2026-05-18：行距、段前、段后、首行缩进、悬挂缩进已串通 `command -> projection -> layout -> toolbar`；Kimi 浏览器实测 `1.8 / 120 / 180 / 360 / 480` 会准确回读到 `getSelectionFormattingState()` 与 `[data-jword-run-summary]`。
- [x] Step 3.16：补齐 structure/style baseline：有序列表、无序列表、基础多级列表、Heading 1-3；目录与 docx numbering/outline 后续只消费这套稳定语义，不直接从纯文本猜测结构。
  - 完成 2026-05-18：`paragraph.styleId` / `paragraph.list` 的稳定语义已打通 projection、formatting state、Editor facade 与 public export；Kimi 浏览器实测 `Heading2 + jword-list-ordered / L1` 与 `Heading3 + jword-list-bullet / L2` 都能稳定回读到 `getSelectionFormattingState()` 与 `[data-jword-run-summary]`。
- [x] 补充说明：以上三项不回滚 Gate 4 准入结论，但在 Gate 4 `Step 4.11` 目录闭环和 Gate 5 docx T1 列表/标题 fixture 进入稳定验证前应完成。
  - 完成 2026-05-18：3.14 / 3.15 / 3.16 已在当前 checkout 收口，不再保留为 Gate 4 `Step 4.11` 与 Gate 5 docx T1 的前置缺口。

### 验收

- [ ] macOS 和 Windows 中文输入可用。
  现状 2026-05-14：当前宿主浏览器的 composition 链已在 Chromium、Firefox、WebKit 上验证；仓库和当前环境都没有 Windows 实机或远程验证通道，因此此项暂不勾选。
  - 阶段决策 2026-05-15：Windows 中文输入实机证据暂作为进入 Gate 4 的豁免项保留到 Alpha 发布前补证，不再阻塞下一阶段开发。
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
  - 已知 carry-over：Windows 中文输入实机证据、Alpha 性能目标 `输入热路径 P95 < 50ms`、`INP P95 < 150ms`。
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
- [ ] carry-over 仍保留：Windows 中文输入实机证据、Alpha 性能目标 `输入热路径 P95 < 50ms`、`INP P95 < 150ms`。

### 推荐执行顺序

1. 先冻结 Gate 4 fixtures、错误模型和目录落点，再进入第一个纵向能力。
2. 先做图片纵线 `Step 4.1 -> 4.2 -> 4.3`，用它验证 `core` / `ui` 新边界、资源状态和失败恢复。
3. 再做表格纵线 `Step 4.4 -> 4.5 -> 4.6 -> 4.7`，因为它会直接压到块级 model、layout、render 和 cell hit-test。
4. 然后做批注与超链接 `Step 4.8 -> 4.9 -> 4.10`，验证非 toolbar UI 是否真正脱离 demo 主文件。
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
- [ ] 收口选区浮动工具栏、右键菜单、失焦消失的联动行为：
  - 实现子项：
    - 浮动工具栏只在有效选区存在且编辑器保持聚焦时显示
    - 右键菜单只绑定当前稳定选区，不沿用旧选区状态
    - 编辑器失焦后，浮动工具栏和右键菜单都要收起
  - 验收子项：
    - 真实浏览器里覆盖“选区出现 -> 打开工具栏 -> 右键 -> 点击编辑器外部失焦”四条路径
    - 验证浮动工具栏、右键菜单的显示与隐藏一致
    - 验证失焦后两者都立即收起，不残留旧状态
- [ ] 收口图片原始尺寸、6 点缩放、顶部工具栏、旋转、拖拽鬼影的交互行为：
  - 实现子项：
    - 图片默认按原始尺寸进入文档视图
    - 缩放手柄固定为 6 点位
    - 顶部工具栏保留图片操作入口，并从这里触发旋转
    - 拖拽时保留鬼影反馈，不直接破坏原图定位
  - 验收子项：
    - 真实浏览器里覆盖原始尺寸、6 点缩放、顶部工具栏、旋转、拖拽鬼影五条路径
    - 验证图片进入视图后的默认尺寸就是原始尺寸
    - 验证缩放、旋转、拖拽时的视觉反馈与状态同步一致
- [ ] 收尾现有图片路径的真实 bug：
  - 这一项只在计划里标记为待修复 / 待验收，不在本轮展开代码细节
  - 以现有图片路径修复闭环为完成条件，修复后再回填实现与验证记录
  - 验收：真实浏览器复测现有图片路径，不再出现已知 bug 的回退表现

#### Iteration 2 - 表格纵线（Step 4.4-4.7）

- [ ] 定义 table / row / cell / grid / border / cell props / cell text content 的 model。
- [ ] 明确 cell anchor、selection、caret、history 语义，禁止把表格当“一个大块文本”绕过去。
- [ ] 实现表格 operation：
  - 插入表格
  - 插入 / 删除行列
  - 合并单元格
  - 更新边框
  - 单元格文本编辑
- [ ] 实现表格 layout / render：
  - grid 几何
  - cell content layout
  - 跨页基础策略
  - cell 内 hit-test
- [ ] 在 `packages/ui/src/table/` 实现表格 UI：
  - 行列选中
  - 插入 / 删除菜单
  - 边框基础控件
- [ ] 补表格 fixture、Undo/Redo 回归、三浏览器 E2E 与 visual baseline。

#### Iteration 3 - 批注与超链接（Step 4.8-4.10）

- [ ] 实现批注 model / operation：
  - 添加
  - 回复
  - 解决
  - 重新打开
  - 删除
  - 定位
- [ ] 批注 anchor 必须绑定稳定 anchor / RangeRef，禁止退回普通字符 offset。
- [ ] 在 `packages/ui/src/comments/` 实现批注侧边栏：
  - 线程列表
  - 当前定位
  - 解决 / 重开 / 删除
  - 编辑后跟随文本移动
- [ ] 实现超链接 model 与 protocol allowlist。
- [ ] 在 `packages/ui/src/link/` 实现超链接编辑弹窗与打开行为。
- [ ] 补 comment / link fixtures、文本编辑后 anchor 稳定性回归、focused E2E。

#### Iteration 4 - 结构、检索与企业文档补全（Step 4.11-4.16）

- [ ] 基于稳定 heading 语义实现标题结构与基础目录生成，目录项点击跳转到稳定 anchor。
- [ ] 若 Gate 3 `Step 3.16` 的 Heading baseline 仍未闭环，先补 heading source 与 toolbar/command 入口，再接目录 block，禁止目录阶段临时扫描纯文本猜测标题层级。
- [ ] 实现查找替换：
  - 结果位置使用 `RangeRef`
  - 替换操作走 transaction pipeline
  - 不允许直接改 projection
- [ ] 实现分节模型、分节符、页眉页脚与页码基础能力，要求支持最小 section-aware 分页：`next-page` / `continuous` 分节、`same as previous`、页码 `restart` / `continue`，并确保 layout 结果可被后续 PDF/docx 复用。
- [ ] 实现修订 metadata 与最小 markup v1：记录插入、删除、格式变更，并提供文内或侧栏可见化；接受/拒绝深度流程保留到 post-1.0。
- [ ] 实现 DOMPurify 保格式粘贴 v1：
  - 覆盖 Word HTML 常见片段
  - 保留安全降级到纯文本能力
  - 不产生 XSS
- [ ] 在 `packages/ui/src/header-footer/` 与 `packages/ui/src/find/` 落控制 UI。
- [ ] 实现移动 Web 只读分页预览，不承诺完整移动编辑。

#### Iteration 5 - Gate 4 回归与基线（Step 4.17）

- [ ] 建立 Gate 4 focused tests：
  - resource adapter / image command
  - table operation / layout
  - comment anchor stability
  - link allowlist
  - find / replace pipeline
  - paste sanitizer
- [ ] 建立 Gate 4 E2E：
  - 图片插入 / 替换 / 失败恢复
  - 表格编辑 / 行列操作 / undo redo
  - 批注定位 / 解决 / 重开
  - 目录跳转
  - 页眉页脚 / 页码
  - 移动只读预览
- [ ] 建立 Gate 4 visual baselines：
  - 图片占位 / 成功 / 失败态
  - 表格边框与跨页
  - 批注高亮与侧栏
  - 页眉页脚 / 页码
- [ ] 建立 Gate 4 perf 护栏，至少记录：
  - 表格大页滚动
  - 图片混排文档滚动
  - 查找替换结果量上升时的交互延迟
- [ ] 验证新能力全部落在 `core` / `ui`，不回塞到 `examples/vanilla/src/main.ts`。

### 待办步骤

- [x] Step 4.1：实现资源表和 ResourceAdapter，定义图片上传、替换、失败恢复、白名单 URL 策略。
- [x] Step 4.2：实现 inline image 的 model、operation、layout、render、resize handle。
- [x] Step 4.3：实现图片插入 UI 和上传状态 UI，失败时保留用户可恢复状态。
- [ ] Step 4.4：实现简单表格 model：table、row、cell、grid、border、cell props、cell text content。
- [ ] Step 4.5：实现表格 operation：插入表格、插入/删除行列、合并单元格、更新边框、单元格文本编辑。
- [ ] Step 4.6：实现表格 layout/render，支持跨页基础策略和 cell 内 hit-test。
- [ ] Step 4.7：实现表格 UI：选中行列、插入删除菜单、边框基础控件。
- [ ] Step 4.8：实现批注 model 和 operation：添加、回复、解决、重新打开、删除、定位。
- [ ] Step 4.9：实现批注侧边栏，批注 anchor 随文本编辑稳定移动。
- [ ] Step 4.10：实现超链接 model、protocol allowlist、编辑弹窗、打开行为。
- [ ] Step 4.11：基于稳定 heading 语义实现标题结构和基础目录生成，目录点击能跳转到对应 anchor。
- [ ] Step 4.12：实现查找替换，结果位置使用 RangeRef，替换操作走 transaction pipeline。
- [ ] Step 4.13：实现分节模型、分节符、页眉页脚和页码基础能力，支持最小 `same as previous` 与页码 `restart` / `continue` 规则，排版结果可被 PDF/docx 后续复用。
- [ ] Step 4.14：实现修订 metadata 与最小 markup 第一版，记录插入、删除、格式变更并提供可见化；接受/拒绝深度流程保留到 post-1.0。
- [ ] Step 4.15：实现 DOMPurify 保格式粘贴 v1，覆盖 Word HTML 常见片段并保留安全降级到纯文本能力。
- [ ] Step 4.16：实现移动 Web 只读分页预览，不支持完整移动编辑。
- [ ] Step 4.17：完善 Beta 前半段 E2E 和视觉回归：表格、图片、批注、目录、页眉页脚、移动预览。

### 验收

- [ ] 表格内文本编辑与 undo/redo 正确。
- [ ] 图片上传成功可替换资源，失败可恢复。
- [ ] 批注 anchor 在文本编辑后仍定位正确。
- [ ] 查找替换不会绕过 transaction pipeline。
- [ ] 页眉页脚和页码参与分页布局。
- [ ] 修订插入、删除、格式变更至少可查看、可定位、可解释。
- [ ] 粘贴 HTML 不产生 XSS。
- [ ] 移动端只读分页预览可阅读。

### 禁止事项

- [ ] 不直接信任外部图片 URL。
- [ ] 不用不稳定字符 offset 保存批注、查找结果或目录目标。
- [ ] 不把复杂修订接受/拒绝作为 `1.0-stable` 强承诺。

## Gate 5 - docx/PDF 互通

### 目标

建立可演进的 OOXML/PDF 互通层。Beta 阶段先做到 T1 docx 导入导出和基础 PDF 导出，T2 能力按 fixture 逐步推进，不用虚假百分比表达保真度。

### 实现方案

互通能力独立包、独立 worker、lazy load。docx 主路径为 JSZip + DOMParser/XMLSerializer + 自研 OOXML mapping。PDF 主路径为 LayoutBox -> PDF，不使用浏览器打印作为主导出方案。

### 当前基线（2026-05-17）

- [x] Gate 4 已验证首个图片纵线闭环，证明 `core -> ui -> host app -> browser` 的交付方式可继续复用到互通层。
- [x] 当前 repo 已正式落地 `packages/core`、`packages/ui` 与 `examples/vanilla`；`packages/docx`、`packages/pdf`、`examples/docx` 尚未创建，符合“不写无法验证空包”的约束。
- [x] canonical model、projection 与 LayoutBox 边界已经存在，docx import/export 与 PDF 导出都应复用这套只读/可写中介，不重新引入第二套状态模型。
- [ ] 当前仍没有 docx/PDF worker、fixture diff、兼容矩阵、字体配置和截图对比的可执行证据。

### 推荐执行顺序

1. 先冻结 Gate 5 fixture registry、worker message contract 和目录落点，再启动任一互通包。
2. 先做 docx import foundation `Step 5.1 -> 5.7`，因为 export 与 PDF 都必须建立在同一 canonical model 上。
3. 再做 docx export 与人工兼容矩阵 `Step 5.8 -> 5.10`，避免只在导入侧闭环。
4. 随后做 PDF 主路径 `Step 5.11 -> 5.14`，直接复用 LayoutBox，不允许并行长出第二套排版。
5. 最后收 T2 fixture、benchmark 与 lazy-load 验证 `Step 5.15 -> 5.16`。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 5 起跑线

- [ ] 建立 Gate 5 fixture registry：
  - `docx-t1-paragraphs`
  - `docx-t1-run-styles`
  - `docx-t1-lists`
  - `docx-t1-table-basic`
  - `docx-t1-inline-image`
  - `pdf-basic-text`
  - `pdf-chinese-font`
  - `pdf-missing-font`
  - `docx-t2-header-footer`
  - `docx-t2-comments-links`
- [ ] 为 Gate 5 明确目录落点，但不预创建空壳包：
  - `packages/docx/src/`
  - `packages/pdf/src/`
  - `fixtures/docx/`
  - `fixtures/pdf/`
  - `examples/docx/`
- [ ] 冻结互通分层：
  - `core` 只提供 canonical model / projection / LayoutBox / command 接入点
  - `docx` 负责 OOXML parsing / mapping / export / fixture diff
  - `pdf` 负责 LayoutBox -> PDF 与字体配置
  - `examples` 只负责 host 装配、fixture 切换和人工检查入口

#### Iteration 1 - worker bridge 与验证基座（Step 5.1 / 5.9 / 5.10）

- [ ] 先定义 import/export worker message contract：
  - `requestId`
  - `progress`
  - `warning`
  - `result`
  - `error`
  - `cancel`
- [ ] 建立 docx/PDF 统一 warning 结构，要求未知节点、缺字体、外链资源、安全降级都能被 host 看到。
- [ ] 建立人工兼容检查模板：
  - Word
  - WPS
  - LibreOffice
  - 打开结果
  - 视觉差异
  - 阻断级问题

#### Iteration 2 - docx import foundation（Step 5.2-5.7）

- [ ] 实现 docx 解包与 manifest 校验，先识别 `document`、`styles`、`numbering`、`rels`、`media`。
- [ ] 建立 style / numbering / relationship / media 索引，禁止把解析逻辑散落到多个入口。
- [ ] 将 T1 import 统一落到 canonical model，再经 transaction pipeline 写入 Y.Doc，不允许直接替换内部状态。
- [ ] 对未知 OOXML 节点、未知样式、外链图片和不支持对象产生明确 warning，不静默吞掉。

#### Iteration 3 - docx export 与 roundtrip（Step 5.8-5.10）

- [ ] 从 JWord canonical model 生成 T1 OOXML，先闭合段落、run 样式、列表、简单表格、inline 图片。
- [ ] 建立导出后重新导入 roundtrip，对核心结构和样式映射做差异比对。
- [ ] 建立 Word/WPS/LibreOffice 打开检查流程，输出可复查的人工记录，不用单一“兼容度百分比”。

#### Iteration 4 - PDF 主路径（Step 5.11-5.14）

- [ ] 实现 PDF worker 与字体配置 API，支持 `URL`、`File`、`ArrayBuffer`。
- [ ] 实现 LayoutBox -> PDF：文本、图片、表格线、页眉页脚、页码按页输出。
- [ ] 缺字体必须返回明确可恢复错误，禁止输出乱码 PDF。
- [ ] 建立 PDF 截图对比流程，输出和 Canvas baseline 的可解释差异报告。

#### Iteration 5 - T2 种子与 Gate 5 回归（Step 5.15-5.16）

- [ ] 推进第一批 T2 fixture：
  - 页眉页脚
  - 分页符
  - 超链接
  - 批注
  - 简单浮动对象
- [ ] 未支持的 T2 能力必须输出明确 warning，不把缺失隐藏在 roundtrip 结果里。
- [ ] 建立 import/export benchmark，按 fixture 大小、页数、图片数记录耗时和内存。
- [ ] 验证 `docx` / `pdf` 走 lazy load，不进入首屏 bundle。

### 待办步骤

- [ ] Step 5.1：建立 import/export worker bridge，支持 request id、progress、warning、result、error、AbortSignal。
- [ ] Step 5.2：实现 docx 解包和基础 manifest 校验，识别 document、styles、numbering、rels、media。
- [ ] Step 5.3：建立 OOXML style index，解析 paragraph/run style、默认样式、继承链。
- [ ] Step 5.4：建立 numbering index，解析有序/无序列表和基础多级列表。
- [ ] Step 5.5：建立 relationship/media index，处理 inline image、外链资源 warning、安全策略。
- [ ] Step 5.6：实现 T1 docx import：段落、run 样式、列表、简单表格、inline 图片。
- [ ] Step 5.7：将 import 结果通过 transaction pipeline 写入 Y.Doc，不直接替换内部状态。
- [ ] Step 5.8：实现 T1 docx export：从 JWord model 生成 OOXML，打包为 docx。
- [ ] Step 5.9：建立 docx fixture diff：XML 结构 diff、样式映射 diff、导入后截图、导出后 roundtrip。
- [ ] Step 5.10：建立 Word/WPS/LibreOffice 打开检查流程和人工记录模板。
- [ ] Step 5.11：实现 PDF worker 和字体配置 API，支持 URL、File、ArrayBuffer 字体来源。
- [ ] Step 5.12：实现 LayoutBox -> PDF：文本、图片、表格线、页眉页脚、页码按页输出。
- [ ] Step 5.13：处理中文字体缺失错误，禁止输出乱码 PDF。
- [ ] Step 5.14：建立 PDF 截图对比流程，和 Canvas 视觉基线做可解释差异报告。
- [ ] Step 5.15：推进 T2 fixture 第一批：页眉页脚、分页符、超链接、批注、简单浮动对象；未完成项必须明确 warning。
- [ ] Step 5.16：建立 import/export benchmark，按 fixture 大小、页数、图片数记录耗时和内存。

### 验收

- [ ] T1 fixture 导入后结构和样式可验证。
- [ ] 导出 docx 能被 Word/WPS/LibreOffice 打开。
- [ ] 导出 docx 重新导入后核心结构可 roundtrip。
- [ ] PDF 中文字体正确，缺字体时返回明确可恢复错误。
- [ ] import/export 可取消、有 progress、不阻塞输入。
- [ ] docx/PDF/collab 不进入首屏 bundle。

### 禁止事项

- [ ] 不把 Mammoth 作为主路径。
- [ ] 不用浏览器打印代替 PDF 主路径。
- [ ] 不把互通逻辑放进 core 首屏 bundle。
- [ ] 不静默吞掉未知 OOXML 节点，必须产生 warning。

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
  - 说明 2026-05-15：此复核只覆盖当前已实现并已验证的输入路径；Windows 中文输入实机证据按当前阶段决策另行补证。
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
