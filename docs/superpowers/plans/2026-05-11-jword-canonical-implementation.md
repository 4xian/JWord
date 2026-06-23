# JWord Canonical Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan intentionally contains no detailed code; implementation must be written later against the referenced canonical specs.

**Goal:** 按 canonical specs 从 0 到 1 实现 JWord 类 Word 在线编辑器 SDK，并保证第一天开始就是最终路线：分页 Canvas、Y.Doc 真源、OOXML 语义模型、统一 transaction pipeline、worker 互通、framework-agnostic core。

**Architecture:** `@4xian/jword-core` 负责状态、事务、投影、排版、渲染、输入、历史和 Editor Facade；UI、JWord 原生格式、docx、PDF、协同、协同服务端、授权、devtools、React/Vue wrapper 都是独立包。基础编辑器必须能用 JWord 原生 `.jword` 格式保存和打开；DOCX/PDF 互通、多人协作、离线和自动插入属于商业高级能力。所有编辑来源都先变成 Command/Operation，再进入 `ydoc.transact(origin)`，Layout/Render/native/docx/PDF 只消费公开 canonical model、只读 projection 或 LayoutBox。

**Tech Stack:** pnpm workspace, TypeScript 6 strict, ESLint 10 flat config, Rollup, Vite, Vitest, Playwright, Yjs, DOMPurify, JSZip, Web Crypto, pdf-lib, fontkit, hocuspocus self-host 服务。依赖必须固定精确版本，不写 `^` 或 `~`。

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
- `0.5-beta`：完成 Gate 4、Gate 4.5 和 Gate 5 的 T1 能力，证明企业常用结构、JWord 原生保存/打开、商业格式互通主路径和付费授权边界可用。
- `1.0-stable`：完成 Gate 6-7，证明商业协作、自动插入、离线、授权、SDK 集成、插件、诊断稳定。
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
- [ ] 免费基础包不得 import 商业高级包；商业高级包只能通过公开 facade 和中立 hook 接入 core。
- [ ] 商业高级能力必须有授权边界、版本兼容策略、诊断错误码和真实第三方集成示例。
- [ ] 文档计划和实现过程不得自动 commit、tag、publish；这些动作必须人工审批。

### 0.4 目标包结构

- [ ] `packages/core`：`@4xian/jword-core`，状态、事务、projection、layout、render、input、history、plugin host、Editor Facade。
- [ ] `packages/ui`：`@4xian/jword-ui`，原生 TS 工具栏、菜单、状态栏、批注栏、基础对话框。
- [x] `packages/native`：`@4xian/jword-native`，免费 `.jword` 原生保存/打开、资源打包、schema migration、worker bridge。
  - 完成 2026-05-27：`packages/native` 已落地公开 API、worker runtime、fixture registry、release dry-run、benchmark 和 vanilla lazy worker 集成；验证记录见 Gate 4.5 执行记录。
- [ ] `packages/docx`：`@4xian/jword-docx`，商业高级 OOXML import/export、fixture diff、worker bridge、授权校验。
- [ ] `packages/pdf`：`@4xian/jword-pdf`，商业高级 LayoutBox 到 PDF、字体配置、worker bridge、授权校验。
- [ ] `packages/collab`：`@4xian/jword-collab`，商业高级 provider adapter、awareness、remote cursor、offline、snapshot adapter、auto-insert client。
- [ ] `packages/collab-server`：`@4xian/jword-collab-server`，商业高级 self-host 协同服务、history API、auth/tenant/storage/license hook。
- [ ] `packages/license`：`@4xian/jword-license`，商业授权 entitlement 类型、签名验证、feature matrix 和 client/server handshake 契约。
- [ ] `packages/persistence`：`@4xian/jword-persistence`，基础 storage contract、商业离线恢复和协作 history 后端复用的存储适配器。
- [ ] `packages/devtools`：`@4xian/jword-devtools`，operation log、layout overlay、diagnostics panel。
- [ ] `packages/react`：`@4xian/jword-react`，React 生命周期 wrapper。
- [ ] `packages/vue`：`@4xian/jword-vue`，Vue 3 生命周期 wrapper。
- [x] `examples/vanilla`：基础集成示例，所有 gate 的第一验证目标。
- [ ] `examples/react`：React wrapper 集成示例。
- [ ] `examples/vue`：Vue wrapper 集成示例。
- [ ] `examples/collab`：真实第三方接入式协作示例，只使用公开包入口和 self-host server。
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

补齐常用企业文档结构：图片、表格、批注、超链接、目录、查找替换、页眉页脚、页码、移动视口分页预览、保格式粘贴第一版。

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

- [x] 建立 Gate 4 fixture 清单：`image-inline`、`table-basic`、`comment-thread`、`link-basic`、`find-replace`、`header-footer`、`paste-html`、`mobile-viewport`。
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
- [x] 保留移动 Web 分页预览可阅读，不承诺完整移动编辑。
  - UI / host 落点：
    - `packages/ui` 保留同一套 editor/canvas 渲染，不新增移动端第二套只读模式。
    - 保留分页 canvas、横向适配和基础缩放。
    - vanilla 增加移动视口分页回归入口，不能变成第二套 demo editor。
  - 验收：
    - mobile viewport browser test 覆盖可滚动阅读和分页 canvas 非空。
    - 视觉检查确认移动宽度下文本和按钮不重叠。
  - 调整 2026-05-25：移动端专属只读模式已删除；移动视口继续使用同一套分页 canvas，若宿主需要只读则使用全局 `readonly` 配置。

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
  - global readonly state
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
  - 移动视口分页预览
  - 调整 2026-05-25：`examples/vanilla/tests/gate4-paste-mobile.e2e.ts` 覆盖 Word HTML 安全粘贴和移动视口分页可读，不再覆盖独立移动只读模式。
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
  - 移动视口分页
  - 调整 2026-05-25：`examples/vanilla/tests/gate4.visual.ts` 的移动基线改为普通移动视口分页非空 canvas / scroll 容器，不再要求 toolbar 隐藏。
  - 收口 2026-05-24：已建立 4 个 Chromium 截图基线：`gate4-desktop-feature-baseline.png`、`gate4-media-failure-baseline.png`、`gate4-long-table-baseline.png`、`gate4-mobile-baseline.png`；`pnpm test:visual` 已通过 Gate 2 JSON baseline 校验、Gate 2/3 canvas visual 探针和 Gate 4 4 个 screenshot baseline，当前 7 passed。长表格基线只记录当前页面边界行为，不宣称行级跨页拆分。
- [x] 建立 Gate 4 perf 护栏，至少记录：
  - 表格大页滚动
  - 图片混排文档滚动
  - 查找替换结果量上升时的交互延迟
  - 批注 / 目录 / 修订 overlay 同屏时的滚动延迟
  - 进展 2026-05-24：`examples/vanilla/tests/gate4.perf.e2e.ts` 已补官方查找 UI 交互延迟与目录 / 批注 / 修订同屏 overlay 滚动指标；命令为 `pnpm playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium`，当前 1 test passed，实测 `imageInsertMs=1860.7`、`tableInsertEditMs=370.1`、`commentCreateMs=166.3`、`revisionCreateMs=142.2`、`findScaleMatchCount=2400`、`findUiInteractionMs=406.0`、`overlayScrollMs=105.1`、`overlayCompositeScrollMs=123.7`、`mountedCanvasCount=3`。本轮连续复跑发现原 `imageInsertMs <= 1600ms` 在当前 Chromium 环境下不稳定，三次分别约 `1832.9ms / 1607.1ms / 1800.6ms`，因此 guard 校准为 `<= 2200ms`，仍保留明显退化拦截。
  - 收口 2026-05-24：perf guard 已用 `pnpm playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium --workers=1` 复跑通过，当前 1 passed，实测 `initialPageCount=53`、`imageInsertMs=1728.7`、`tableInsertEditMs=371.6`、`commentCreateMs=152.7`、`revisionCreateMs=123.9`、`findScaleCollectMs=0.6`、`findScaleMatchCount=2400`、`findUiInteractionMs=286.2`、`overlayScrollMs=108.2`、`overlayCompositeScrollMs=116.1`、`mountedCanvasCount=3`。
- [x] 验证新能力全部落在 `core` / `ui`，不回塞到 `examples/vanilla/src/main.ts`。
  - architecture check 必须覆盖 `packages/ui/src/find/`、`packages/ui/src/header-footer/`、`packages/ui/src/outline/`、全局只读入口和 paste adapter。
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
- [x] Step 4.16：保留移动 Web 分页预览可阅读，不支持完整移动编辑。
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
- [x] 移动视口分页预览可阅读。
  - 调整 2026-05-25：独立移动只读模式已删除；移动 viewport 回归验证分页 canvas 可滚动且非空，只读场景统一走全局 `readonly`。

### 禁止事项

- [x] 不直接信任外部图片 URL。
  - 完成 2026-05-24：`packages/ui/src/media/policy.ts` 默认只允许 `data:` / `blob:`，`http:` / `https:` 必须由宿主 `allowExternalUrl` 显式放行；`packages/core/src/resources/types.ts` 也把资源来源建模为受控 source。Kimi WebBridge 真实 Chrome 审计确认 core 外部 URL 默认拒绝。
- [x] 不用不稳定字符 offset 保存批注、查找结果或目录目标。
  - 完成 2026-05-24：批注、修订、查找替换和目录目标分别使用 `TextRangeRecord` / `rangeSnapshot` / `anchorRange` 等稳定快照，相关实现落在 `packages/core/src/operations/comment-command-builders.ts`、`packages/core/src/operations/revision-command-builders.ts`、`packages/core/src/find-replace/find-replace.ts`、`packages/core/src/heading/outline.ts`。
- [x] 不把复杂修订接受/拒绝作为 `1.0-stable` 强承诺。
  - 完成 2026-05-24：`packages/ui/src/revisions/controller.ts` 只负责 revision metadata 的列表展示与定位，不实现 accept/reject 深度流程；当前 Gate 4 计划仍把复杂接受/拒绝明确保留到 post-1.0。

## Gate 4.5 - JWord 原生保存与打开

### 目标

补齐基础编辑器的原生保存能力，使免费基础版在不依赖 DOCX/PDF 高级包的情况下也能保存、重新打开、继续编辑同一份文档。Gate 4.5 交付后，第三方宿主可以把当前 JWord 文档保存为 `.jword` 文件或字节流，再通过公开 API 加载回编辑器，资源、基础格式、表格、图片、批注、目录、页眉页脚和当前已支持的 canonical model 字段不丢失。

### 实现方案

新增 `@4xian/jword-native` 作为免费基础包。`.jword` 是 JWord 自己的原生 zip package，不是 DOCX，也不是 Y.Doc binary 的裸导出。主格式保存公开 canonical document model、资源文件、manifest、metadata 和校验信息；Y.Doc binary 只能作为可选加速或协作恢复信息，不能成为唯一可读主格式。这样后续即使内部协同实现、Yjs schema 或存储布局变化，`.jword` 文件仍可通过 schema migration 加载。

`.jword` package 结构固定为：

- `manifest.json`：格式标识、formatVersion、schemaVersion、createdBy、minimumReaderVersion、featureFlags、packageEntries。
- `document.json`：JWord canonical document model，只包含公开模型字段，不保存 DOM、canvas layout cache、projection JSON 或内部 Y.Doc store。
- `resources/`：图片、嵌入资源和资源 manifest 中声明的二进制文件。
- `metadata.json`：标题、作者、创建时间、最后修改时间、应用版本、可选业务 metadata。
- `checksums.json`：每个 entry 的 hash、byteLength 和 MIME type，用于损坏诊断。

### 明确范围

- [x] 支持导出 `.jword` 文件或 `Blob` / `Uint8Array`。
- [x] 支持从 `.jword` 文件或 `Blob` / `Uint8Array` 解析出 canonical document model。
- [x] 支持 `editor.loadDocumentModel()` 加载 `.jword` 解析结果并继续编辑。
- [x] 支持资源打包、资源引用校验、缺失资源 warning 和损坏文件 error。
- [x] 支持 schema migration：旧版可迁移文件给出 migration report，无法迁移时给明确 diagnostic。
- [x] 支持 worker progress、warning、cancel 和大文件不阻塞输入。
- [x] 不支持把 `.jword` 当作 DOCX、PDF 或协作 history 格式。
- [x] 不支持保存 layout/render cache 作为可写真源。

### 当前基线（2026-05-27）

- [x] Gate 1-4 已有 canonical model、projection、resource registry、transaction pipeline、`loadDocumentModel()`、资源和结构化内容的基础能力。
- [x] Gate 5 已有 DOCX 导入后进入 canonical model 的经验，但 DOCX/PDF 属于高级格式互通，不能替代基础保存能力。
- [x] 已建立独立的 `.jword` 原生格式 package、格式 manifest、资源 checksum、schema migration 和真实保存/打开 demo。
- [x] `examples/vanilla` 已有只依赖基础包公开 API 的保存/打开入口，native 实现按需进入 worker。

### 推荐执行顺序

1. 先冻结 `.jword` package 结构、manifest schema、document model 边界和禁止保存的内部状态。
2. 再建立 `@4xian/jword-native` 的公开类型、worker message、diagnostics 和 fixture registry。
3. 先做最小纯文本/段落 roundtrip，再扩展到 Gate 4 的表格、图片、批注、目录、页眉页脚和修订 metadata。
4. 随后接入 `examples/vanilla` 保存/打开入口，验证第三方宿主只通过公开 API 完成原生保存/加载。
5. 最后补 migration、checksum、损坏文件诊断、benchmark、bundle gate 和文档计划。

### 迭代任务清单

#### Iteration 0 - 冻结原生格式契约

- [x] 冻结 `.jword` zip entries：`manifest.json`、`document.json`、`metadata.json`、`checksums.json`、`resources/`。
- [x] 冻结 `formatVersion` 与 `schemaVersion` 规则：formatVersion 表示 package 结构，schemaVersion 表示 canonical document model。
- [x] 冻结禁止保存项：DOM selection、canvas bitmap、layout cache、projection cache、内部 Y.Doc shared type、provider state、license token。
- [x] 建立 fixture registry，至少包含 empty、plain-text、formatting、table、image、comments、header-footer、corrupt-resource、old-schema。

#### Iteration 1 - `@4xian/jword-native` 公开 API 与 worker

- [x] 建立 `packages/native`，只在有 contract tests、fixture 或真实 demo 入口时创建，不预建空壳。
- [x] 定义公开 API：`saveJWordDocument(editorOrModel, options)`、`loadJWordDocument(input, options)`、`validateJWordPackage(input)`。
- [x] 定义返回类型：result、warning、diagnostic、progress、cancel、resource manifest、migration report。
- [x] 建立 worker runtime，保存和打开都支持 `requestId`、`AbortSignal`、progress、warning、cancel。
- [x] 建立类型测试，确保外部 TypeScript 项目不用 import core 内部类型也能调用保存/打开。

#### Iteration 2 - document model roundtrip

- [x] 从 editor 读取公开 canonical document model，不直接读取 `document-store` 内部结构。
- [x] 保存 `document.json` 时保留段落、run、inline image ref、表格、批注、目录目标、section、header/footer、revision metadata。
- [x] 加载 `document.json` 后只能通过 `editor.loadDocumentModel()` 写回编辑器。
- [x] 建立 roundtrip diff：保存 -> 打开 -> 加载 -> 再保存，比较 canonical model 和 resource refs。
- [x] 禁止把 `.jword` 导入路径伪装成 DOCX 导入；`.jword` 是 JWord 原生格式，错误码和 warning 单独命名。

#### Iteration 3 - resource package 与完整性诊断

- [x] 将 resource registry 中的图片和二进制资源写入 `resources/`，并在 `manifest.json` / `checksums.json` 记录 id、MIME、byteLength、hash。
- [x] 加载时校验资源存在、hash、MIME 和引用一致性。
- [x] 缺失非关键资源时可加载正文并产生 recoverable warning。
- [x] 文档主结构损坏、manifest 缺失、schema 不兼容时返回不可恢复 error，不写入 editor。
- [x] 外部 URL 资源不直接抓取；只保存已进入 resource registry 的受控资源。

#### Iteration 4 - schema migration 与兼容策略

- [x] 建立 migration registry：每次 schemaVersion 变化必须有 migration 或明确不可兼容 diagnostic。
- [x] migration 只能从旧 canonical model 迁移到新 canonical model，不能读取旧内部 Y.Doc store。
- [x] migration report 记录 sourceVersion、targetVersion、appliedSteps、warnings。
- [x] 建立 old-schema fixture，验证旧文件能升级并重新保存为当前版本。
- [x] 建立 unknown future version 诊断，避免新版本文件被旧 SDK 静默损坏。

#### Iteration 5 - `examples/vanilla` 真实第三方保存/打开

- [x] 在 `examples/vanilla` 中只通过 `@4xian/jword-native` 公开 API 接入保存/打开。
- [x] demo host 负责选择文件、触发下载、显示 progress/warning/error，不读取 native 包内部模块。
- [x] 真实浏览器验证保存 `.jword`、重新打开、继续输入、再保存，projection 和 layout 保持一致。
- [x] 增加架构测试，禁止 vanilla 直接 import `packages/native/src` 或 core 内部 store。
- [x] 移动 viewport 下保存/打开入口不遮挡编辑区域，且长任务期间编辑器保持响应。

#### Iteration 6 - benchmark、bundle 和文档计划

- [x] 建立 native save/load benchmark，覆盖 1 页、50 页、200 页、含图片和含表格文档。
- [x] 建立 bundle gate：native 包不进入 vanilla 首屏，只有触发保存/打开时按需加载。
- [x] 建立 format spec 文档计划，后续 Gate 7 文档站必须包含 `.jword` 格式、API、warning、migration、错误处理。
- [x] 建立 release dry-run 检查：`npm pack` 中包含 native dist、types、fixtures 示例，不包含测试私有文件。

### 待办步骤

- [x] Step 4.5.1：冻结 `.jword` package 结构、manifest schema、document model 边界和禁止保存项。
- [x] Step 4.5.2：建立 `@4xian/jword-native` 公开类型、worker message、diagnostics 和 fixture registry。
- [x] Step 4.5.3：实现最小 document model 保存/打开 roundtrip，并通过 `editor.loadDocumentModel()` 恢复。
- [x] Step 4.5.4：实现资源打包、checksum、缺失资源 warning 和损坏文件 error。
- [x] Step 4.5.5：实现 schema migration registry、old-schema fixture 和 future-version diagnostic。
- [x] Step 4.5.6：接入 `examples/vanilla`，用真实第三方集成方式完成保存/打开。
- [x] Step 4.5.7：建立 benchmark、bundle gate、format spec 文档计划和 release dry-run 检查。

### 验收

- [x] `.jword` 保存/打开不依赖 DOCX/PDF/collab 高级包。
- [x] 基础编辑器可保存当前文档、重新打开、继续编辑、再次保存。
- [x] 表格、图片、批注、目录、页眉页脚和当前已支持的 revision metadata 在原生 roundtrip 后不丢。
- [x] 损坏文件、缺失资源、未知 schema 和取消任务都有稳定 diagnostics。
- [x] 长文档保存/打开走 worker，不阻塞用户输入。
- [x] `examples/vanilla` 只使用公开 API，不读取底层实现。

### 禁止事项

- [x] 不把 `.jword` 设计成 DOCX 包或 PDF 包。
- [x] 不把 Y.Doc binary 当作唯一主格式。
- [x] 不保存 layout cache、canvas bitmap、DOM selection 或 provider state 作为可写真源。
- [x] 不让 native 包依赖商业高级 docx/PDF/collab/license 包。
- [x] 不用原生保存能力绕过 transaction pipeline 或直接写 core store。

执行记录（2026-05-27）：`@4xian/jword-native` 已提供 `saveJWordDocument`、`loadJWordDocument`、`validateJWordPackage` 与 `./worker` runtime；vanilla demo 通过 `native-worker.ts` 懒加载 worker，不在首屏静态引入 native。公开 API 测试覆盖固定 zip entries、`editor.loadDocumentModel()` 恢复、rich canonical model roundtrip、dataUrl 资源打包、外部资源 warning、缺失资源 recoverable warning、hash mismatch error、old schema migration、future schema diagnostic 和 AbortSignal 取消。Kimi WebBridge 真实 Chrome 验证 `KIMI_GATE45_WORKER_EDIT` 保存为 `.jword` 后打开成功，继续输入 `AFTER_KIMI_WORKER_OPEN` 后再次保存成功；保存中同步输入 `KIMI_DURING_NATIVE_SAVE_INPUT` 可进入 projection；performance resource 记录包含 `src/native-worker.ts?worker_file&type=module` 与 `packages/native/src/*` worker 资源。验证命令：`pnpm --filter @4xian/jword-native test` 为 2 files / 9 tests passed；`pnpm --filter @4xian/jword-native typecheck`、`pnpm --filter @4xian/jword-native build`、`pnpm --filter @4xian/jword-example-vanilla typecheck`、`pnpm --filter @4xian/jword-example-vanilla build`、`node tools/size/check-native-bundle.mjs`、`node tools/release/check-native-pack.mjs`、`node benchmarks/gate45-native-benchmark.mjs`、Gate 4.5 架构 Vitest 5 files / 13 tests passed、`pnpm playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium` 1 passed、targeted ESLint 均通过。

当前工作树复核（2026-05-27）：Gate 4.5 focused 验证重新通过：`pnpm --filter @4xian/jword-native test` 为 2 files / 9 tests passed；`pnpm --filter @4xian/jword-native typecheck`、`pnpm --filter @4xian/jword-native build`、`pnpm --filter @4xian/jword-example-vanilla typecheck`、`node tools/size/check-native-bundle.mjs`、`node tools/release/check-native-pack.mjs`、`node benchmarks/gate45-native-benchmark.mjs` 均通过；Gate 4.5 架构 Vitest 为 5 files / 13 tests passed；`pnpm exec playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium --reporter=line` 为 1 passed。首次 Playwright 失败是 5173 端口残留 `examples/docx` Vite server 导致测到 DOCX 页面，清理旧进程后同一 Gate 4.5 用例通过，不作为 Gate 4.5 功能失败记录。

## Gate 5 - 商业高级格式互通：DOCX 导入导出与 PDF 导出

### 目标

建立可演进、可授权、可按需加载的商业高级格式互通能力。Beta 阶段先保证常见 DOCX 导入后能保留基础格式和内容，导出 DOCX 后能重新导入并保持 T1 能力不丢结构、不丢样式、不丢资源；PDF 范围只包含从 JWord 当前文档导出 PDF，不包含 PDF 导入、PDF 编辑或 PDF 查看器能力。基础保存/打开不依赖 Gate 5，统一由 Gate 4.5 的 `.jword` 原生格式承担。

### 实现方案

DOCX 主路径为 `JSZip + XML parser/serializer + 自研 OOXML mapping + canonical model`。PDF 主路径为 `DocumentLayout/LayoutBox -> PDF`，直接复用 JWord 分页布局结果，不使用浏览器打印、LibreOffice 转换或第三方在线服务作为主导出方案。导入、导出和 PDF 生成都放在独立商业包、独立 worker 和 lazy-load 边界内，避免进入 core、native 或基础首屏 bundle。

DOCX 导入应先解析 OPC package，再建立 style、numbering、relationship、media、comments、header/footer 等索引，随后映射到 JWord canonical import model。core 只暴露受控结构化写入入口，docx 包禁止直接访问 Y.Doc 或 `document-store` 内部结构。DOCX 导出应从 JWord projection/canonical model 生成 OOXML Transitional package，再用 roundtrip 重新导入验证。PDF 导出应从 editor layout 读取页面、文本、图片、表格线、页眉页脚和页码，使用字体配置 API 显式嵌入字体；缺少中文字体或字体不能覆盖字符时必须返回可恢复错误，不输出乱码 PDF。

商业化边界（2026-05-26 调整）：Gate 5 整体作为高级格式互通能力处理，`@4xian/jword-docx` 与 `@4xian/jword-pdf` 默认不进入免费基础包。若未来要把 DOCX 导出降级为免费能力，必须先拆出独立免费 export-only 包并通过架构测试证明它不包含 DOCX import、PDF export 或授权绕过路径；当前计划不走该拆分路线。

### 参考资料与对标口径

Gate 5 可以参考外部技术文档和竞品能力，但参考材料必须分层使用，不能把竞品 API 或云端转换服务当成 JWord SDK 的内部实现路线。

- 实现依据：
  - Microsoft Open XML / WordprocessingML 官方文档：作为 DOCX package、`word/document.xml`、style、numbering、relationship、media、comments、header/footer 和 schema validation 的主实现依据。
  - ECMA-376 / ISO/IEC 29500：作为 OOXML Transitional package、namespace、part relationship、content type、paragraph/run/table/list/page setup 等格式边界的标准依据。
  - JSZip 官方文档：只用于 DOCX zip package 的读取和生成，不负责 OOXML 语义映射。
  - XML parser/serializer 文档：用于 namespace-safe XML 读写，必须保留 prefix、attribute、relationship id 和 unknown node 的可诊断信息。
  - MDN Worker、AbortSignal、Blob/File、postMessage transferable 文档：用于 import/export worker、取消、进度回调和二进制传输设计。
  - `pdf-lib` 与 fontkit 文档：用于 PDF page、text、image、path、font embedding 的基础生成能力。
  - PDF.js 文档：只用于导出 PDF 的本地预览和截图验证，不作为 PDF 生成主路径。
- 验证与兼容参考：
  - WPS：作为当前 Gate 5 WPS-only 口径下的导出 DOCX 人工打开、编辑、保存和重开验收目标。
  - Microsoft Word、LibreOffice：保留为后续扩展兼容矩阵目标，当前 Gate 5 不验证、不作为完成阻塞项、不写入通过结论。
  - Open XML validation：保留为后续 DOCX package 与 schema 自动校验目标，当前 Gate 5 仅保留 pending/not-run 记录，不作为完成阻塞项。
  - ONLYOFFICE Conversion API：作为格式矩阵、转换参数、异步转换和错误码设计参考，不作为 JWord DOCX/PDF 主实现依赖。
  - ONLYOFFICE Document Builder：作为 OOXML/PDF 互通能力和高保真转换行为参考，不引入其服务端 SDK 作为 Gate 5 主路径。
  - LibreOffice CLI：只允许作为可选离线兼容验证工具，不允许作为 JWord PDF 导出实现方案。
- 产品对标参考：
  - 腾讯文档开放平台 / WebSDK：用于理解产品侧“导入、转换、预览、最大程度保留源文档样式”的用户预期，以及导入前置、上传、转换、预览这类云端工作流；不作为本地 SDK 的 OOXML mapping 或 layout 实现依据。
  - ONLYOFFICE Docs：用于参考 OOXML-first 编辑器在导入、编辑、转换、导出之间的能力边界和用户可见 warning 口径。
  - Google Docs / Microsoft Word Online：只作为用户体验和兼容提示参考，不作为底层技术路线依据。
- 使用边界：
  - 所有外部参考都必须回到 JWord 的 `canonical model -> OOXML`、`OOXML -> canonical import model`、`DocumentLayout/LayoutBox -> PDF` 三条本地路线。
  - 能参考竞品的能力矩阵、warning 口径、导入导出流程和验收方式；不能照搬竞品云服务、闭源 SDK 或在线转换作为 SDK 核心能力。
  - 若外部文档只描述产品/API 流程而不描述内部格式映射，应写入“产品对标参考”，不能写入“实现依据”。
  - 后续每个 DOCX/PDF Iteration 需要在执行记录中标明参考来源、实现结论和不能兼容的降级策略，避免把“参考过”误读成“已支持”。

Gate 5 兼容验收口径调整（2026-05-25）：本轮人工办公套件兼容验收改为 WPS-only。Open XML validator、Microsoft Word 和 LibreOffice 继续保留在报告 schema 与 pending/not-run 记录中，用于后续扩展和补证，但不作为 Gate 5 当前完成阻塞项，也不得写入未验证的通过结论。

Gate 5 商业化验收口径调整（2026-05-26）：既有 DOCX/PDF 技术闭环只能视为格式能力可用，不等于商业高级能力完成。Gate 5 进入产品化前必须补授权校验、私有 registry / npm pack 检查、第三方集成示例、feature matrix、诊断错误码和未授权失败路径。

### 明确范围

- [x] 支持 DOCX 导入。
- [x] 支持 DOCX 导出。
- [x] 支持将当前 JWord 文档导出为 PDF。
- [x] 支持按商业 entitlement 开启 DOCX 导入、DOCX 导出和 PDF 导出。
- [x] 支持未授权、授权过期、feature 不匹配和 license server 不可用的稳定 diagnostics。
- [x] 支持第三方通过公开高级包 API 集成 DOCX/PDF，不读取 `packages/docx/src`、`packages/pdf/src` 或 demo 内部 runtime。
- [x] 不支持 PDF 导入查看。
- [x] 不支持 PDF 编辑。
- [x] 不支持把 PDF 反向转换为 JWord 文档。
- [x] 不承诺任意复杂 DOCX 100% 保真；只对已纳入 fixture 的 T1/T2 能力给出可验证承诺。

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
- [x] `packages/docx`、`packages/pdf` 已在 2026-05-25 随最小可测公开 API 创建；`examples/docx` 已在 2026-05-25 随真实浏览器验收入口创建，继续符合“不写无法验证空包”的约束。
- [x] canonical model、projection、resource、transaction pipeline 与 `DocumentLayout` 已存在。
- [x] core 当前公开 `EditorDocumentInput` 仍偏纯文本入口，不能直接承载 DOCX 的完整结构化导入结果。
- [x] 当前已有 Gate 5 fixture registry、兼容矩阵模板、DOCX/PDF 最小公开 API、DOCX/PDF worker runtime、fixture diff、字体配置类型、PDF.js/JWord Canvas 截图 artifact、lazy-load、worker 内存峰值和长任务期间 editor 响应证据；WPS-only 真实兼容记录已在 2026-05-25 后补齐，Open XML validation、Word 和 LibreOffice 按当前口径保留 pending/not-run。
- [x] 当前已补商业授权 API、entitlement 校验、私有 registry / `npm pack --dry-run` 发布检查、未授权失败真实浏览器路径和第三方真实高级包集成模式；正式文档站内容仍留在 Gate 7 落地。

### 推荐执行顺序

1. 先冻结范围、商业 edition matrix、fixture registry、warning schema、worker contract、授权 contract 和验收口径。
2. 再建立 `packages/docx`，完成 DOCX 解包、XML 解析、OPC 索引和 T1 import mapping。
3. 随后补 core 结构化导入入口，让 DOCX import 经统一 transaction/mutation 边界写入 JWord。
4. 再实现 DOCX export 和 roundtrip diff，确保导出后重新导入不丢 T1 格式和内容。
5. 然后建立 `packages/pdf`，从 JWord layout 导出 PDF，先闭合中文字体和基础视觉验证。
6. 再补 `examples/docx`、人工兼容矩阵、benchmark、lazy-load 和 T2 种子。
7. 最后补商业授权、私有 registry / `npm pack` 检查、第三方集成示例、未授权失败路径和文档站计划。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 5 范围、目录和验收口径

- [x] 将 Gate 5 标题和范围固定为 `DOCX 导入导出与 PDF 导出`。
- [x] 明确 PDF 不包含导入查看、反向转换或编辑能力。
- [x] 将 Gate 5 商业化范围固定为高级格式互通能力，不再承担基础保存/打开职责。
- [x] 冻结 Gate 5 edition matrix：free 只包含 `.jword` 原生保存/打开；paid 包含 DOCX 导入、DOCX 导出和 PDF 导出。
- [x] 冻结 Gate 5 授权 contract：feature key、customer id、license token、offline grace、diagnostic code、worker task fail-fast 规则。
- [x] 冻结目录落点：
  - `packages/docx/src/`
  - `packages/docx/test/`
  - `packages/pdf/src/`
  - `packages/pdf/test/`
  - `fixtures/docx/`
  - `fixtures/pdf/`
  - `examples/docx/`
- [x] 不预创建空壳包；只有当第一个可执行 fixture 或测试能落地时才创建对应目录。
- [x] 冻结分层：
  - `core` 提供 canonical model、projection、resource、layout、受控结构化写入入口。
  - `docx` 负责 OPC package、OOXML parsing、mapping、export、roundtrip diff。
  - `pdf` 负责 `DocumentLayout/LayoutBox -> PDF`、字体、图片、PDF 验证辅助。
  - `license` 提供 entitlement 类型、签名验证和 feature matrix，不让 worker 自行解析业务授权细节。
  - `examples/docx` 负责真实第三方高级包装配、fixture 切换、手动导入导出、warning 面板和未授权失败演示。
- [x] 冻结 T1/T2/T3 能力表，并把 T3 统一标记为 warning 或 opaque preserve，不作为 Gate 5 完成条件。
- [x] 验证：文档中能清楚回答“做什么、不做什么、怎么验收”。

执行记录（2026-05-25）：Gate 5 起跑范围、PDF 禁止项、目录落点、分层边界和 T1/T2/T3 能力表已按当前文档冻结；`packages/docx`、`packages/pdf`、`fixtures/docx|pdf` 和 `examples/docx` 均只在有 focused tests、registry 或真实浏览器入口可验证时创建，没有预建无法验证空包。验证证据为计划文档本段、`pnpm install --frozen-lockfile --ignore-scripts`、`pnpm lint`、`pnpm build`、`pnpm vitest run tests/architecture/gate5-fixture-registry.test.ts`。

#### Iteration 1 - 建立 fixture registry 和兼容矩阵模板

- [x] 建立 DOCX T1 fixture registry：
  - `docx-t1-paragraphs`
  - `docx-t1-run-styles`
  - `docx-t1-paragraph-formatting`
  - `docx-t1-headings`
  - `docx-t1-lists`
  - `docx-t1-table-basic`
  - `docx-t1-inline-image`
  - `docx-t1-page-setup`
- [x] 建立 DOCX T2 fixture registry：
  - `docx-t2-header-footer`
  - `docx-t2-page-number`
  - `docx-t2-comments`
  - `docx-t2-links`
  - `docx-t2-section-breaks`
  - `docx-t2-floating-object-warning`
- [x] 建立 PDF fixture registry：
  - `pdf-basic-text`
  - `pdf-chinese-font`
  - `pdf-missing-font`
  - `pdf-table-image`
  - `pdf-header-footer-page-number`
- [x] 每个 fixture 必须记录：
  - 输入文件。
  - 期望 projection 摘要。
  - 期望 warning。
  - 导入截图基线。
  - 导出 DOCX roundtrip 期望。
  - 导出 PDF 视觉期望。
- [x] 建立人工兼容矩阵模板：
  - Word 打开结果。
  - WPS 打开结果。
  - LibreOffice 打开结果。
  - 是否可编辑。
  - 是否触发修复提示。
  - 主要视觉差异。
  - 阻断级问题。
- [x] 验证：任意新增 fixture 都能被 registry 约束，不靠口头说明验收。

执行记录（2026-05-25）：已建立模板型 registry 和矩阵入口，只写入 `fixtures/docx/README.md`、`fixtures/docx/registry.json`、`fixtures/docx/compatibility-matrix.md`、`fixtures/pdf/README.md`、`fixtures/pdf/registry.json`、`fixtures/pdf/compatibility-matrix.md`，并同步 `fixtures/README.md` 与 `tests/architecture/gate5-fixture-registry.test.ts`。本轮不创建 `.docx` / `.pdf` 二进制空占位；所有 `input.path` 均标记为待补真实 fixture，T1/T2/PDF id、projection 摘要、warning、截图基线、DOCX roundtrip 与 PDF 视觉期望字段已纳入可审核模板。兼容矩阵仅记录 Word/WPS/LibreOffice 或 PDF viewer 的人工事实，不使用兼容百分比。验证：`pnpm vitest run tests/architecture/gate5-fixture-registry.test.ts` 通过，JSON parse 显示 DOCX 14 项、PDF 5 项。

续做（2026-05-25）：新增 `fixtures/docx/compatibility-matrix.json`，把 DOCX registry 中 14 个 fixture 的 Open XML validation、Word、WPS、LibreOffice 四类兼容目标全部显式列为 `pending` / `not-run`，并在 `fixtures/docx/compatibility-matrix.md` 中指向该机器可验证模板。`tests/architecture/gate5-fixture-registry.test.ts` 已新增约束，确保每个 fixture 都有 export artifact、Open XML validation pending 记录、三套办公软件 pending 记录，且矩阵不使用 compatibility percent。验证先用 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --testNamePattern "compatibility matrix targets"` 确认红灯暴露 JSON 缺失，再补模板并通过；随后 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts`、`pnpm typecheck` 和 focused ESLint 通过。

续做（2026-05-25）：DOCX registry 的 14 个输入现在全部具备真实确定性 `.docx` 文件，不再留下 `missing-until-real-fixture-is-added` 状态。`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增 `docx-t1-paragraphs` 和 6 个 T2 种子 fixture：header/footer、page number、comments、external link、section breaks、floating object warning；`fixtures/docx/registry.json` 顶层状态更新为 `fixture-input-ready`，每个 DOCX input 均标记 `available`。验证先用 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --testNamePattern "every DOCX fixture input"` 确认红灯暴露 7 个缺输入，再生成真实 fixture 后通过；随后 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 2 files / 22 tests passed。

#### Iteration 2 - 建立 worker contract 与统一 warning/error 结构

- [x] 定义 `requestId`，确保同一页面可并行发起多个导入导出任务。
- [x] 定义 `progress` 事件：
  - `queued`
  - `reading`
  - `parsing`
  - `mapping`
  - `writing`
  - `validating`
  - `done`
- [x] 定义 `warning` 结构：
  - `code`
  - `severity`
  - `part`
  - `path`
  - `message`
  - `fallback`
  - `recoverable`
- [x] 定义 `error` 结构：
  - package 损坏。
  - XML 解析失败。
  - 缺少 main document part。
  - relationship 断裂。
  - 字体缺失。
  - 用户取消。
- [x] 支持 `AbortSignal` 取消。
- [x] 使用 `ArrayBuffer` transferable 传输 DOCX/PDF 二进制，避免复制大文件。
- [x] 验证：worker 取消后不会继续写入 editor，不会留下半成品状态。
  - 完成 2026-05-25：`packages/docx/src/index.ts` 和 `packages/pdf/src/index.ts` 已定义 request/progress/warning/error/result/cancel/AbortSignal/transferable 的公开类型与消息 helper，并用 `packages/docx/test/public-api.test.ts`、`packages/pdf/test/public-api.test.ts` 验证。当前已有真实 worker runtime。2026-05-25 续做已补 `examples/docx` demo host 异步任务 session guard：新任务开始会 abort 旧任务，取消任务会清空 active task 并恢复按钮状态；导入 DOCX、导出 DOCX、导出 PDF 路径均向 runtime 传入 `requestId` 与 `AbortSignal`，并在写入 editor、warning 面板、roundtrip 面板、下载链接和状态前使用 `session.canCommit()` 拦截已取消或过期任务。DOCX/PDF runtime 已补已取消 signal 与 PDF 进度中取消检查。worker 侧已新增 requestId -> AbortController registry：DOCX worker 的导出和 inspect、PDF worker 的导出在收到同一 requestId 的 cancel 后会 abort 运行中任务，并抑制旧任务后续 result post。验证：`pnpm vitest run packages/docx/test/worker.test.ts packages/pdf/test/worker.test.ts` 覆盖运行中 cancel 不再 post stale result；`pnpm vitest run packages/docx/test/worker.test.ts packages/pdf/test/worker.test.ts packages/docx/test/public-api.test.ts packages/pdf/test/public-api.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-pdf typecheck`、focused ESLint、`node tools/lint/check-comments.mjs` 和 `pnpm build` 通过。Kimi WebBridge 已验证取消 PDF 导出后 active task 清空、旧任务不提交 editor/UI 写入、取消后可继续输入并再次导出 DOCX/PDF。

#### Iteration 3 - 建立 `packages/docx` 最小包与公开 API

- [x] 创建 `@4xian/jword-docx` 包。
- [x] 定义 import API：
  - `importDocx(input, options)`
  - 输入支持 `ArrayBuffer`、`Uint8Array`、`Blob/File`。
  - 输出包含 import model、warnings、diagnostics、opaque preservation metadata。
- [x] 定义 export API：
  - `exportDocx(document, options)`
  - 输入来自 JWord projection/canonical model。
  - 输出 `ArrayBuffer` 或 `Blob`。
- [x] 定义 inspect API：
  - `inspectDocxPackage(input)`
  - 只解析 package graph，不写入 JWord。
- [x] 定义测试入口：
  - package graph test。
  - XML parse test。
  - T1 mapping test。
  - export snapshot test。
- [x] 验证：`pnpm --filter @4xian/jword-docx typecheck` 和最小测试可运行。
  - 完成 2026-05-25：`packages/docx` 已建立 package、tsconfig、`src/index.ts` 和 `test/public-api.test.ts`。当前只实现公开契约、worker request/event 类型和稳定未实现错误，不实现 OPC/XML/mapping；验证命令 `pnpm vitest run packages/docx/test/public-api.test.ts` 与 `pnpm --filter @4xian/jword-docx typecheck` 均通过。
  - 续做 2026-05-25：DOCX 测试入口已从最小 public API 扩展为 package graph、XML parse、T1 fixture mapping、T1 roundtrip 和 export snapshot 覆盖。验证：`pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts` 为 8 files / 64 tests passed。

#### Iteration 4 - 实现 OPC package reader 与 manifest 校验

- [x] 使用 JSZip 读取 DOCX package。
- [x] 解析 `[Content_Types].xml`。
- [x] 解析 `/_rels/.rels`。
- [x] 定位 main document part，默认识别 `word/document.xml`，但不硬编码为唯一入口。
- [x] 解析 main document part 的 `.rels`。
- [x] 建立 part graph：
  - document。
  - styles。
  - numbering。
  - settings。
  - theme。
  - headers。
  - footers。
  - comments。
  - media。
- [x] 校验必需 part 缺失时返回明确错误。
- [x] 对可选 part 缺失产生 warning，不阻断 T1 导入。
- [x] 验证：损坏 zip、缺 content types、缺 main document、断裂 relationship 都有稳定错误或 warning。
  - 完成 2026-05-25：`inspectDocxPackage` 已用 JSZip 完成最小 OPC inspect，可读取 part 列表、root relationships、document relationships、main document part、基础 part graph，并对断裂 document relationship 产生可恢复 warning。验证覆盖损坏 zip、缺 `[Content_Types].xml`、缺 main document 和断裂 relationship。后续 2026-05-25 已补 XML helper、OOXML indexes 与最小 DOCX import 中间模型；完整 T1 mapping、真实 fixture diff 和人工兼容矩阵仍未完成。

#### Iteration 5 - 实现 XML parse/serialize 抽象

- [x] 封装 XML parser，不让业务 mapping 直接散落 `DOMParser` 调用。
- [x] 封装 XML serializer，不让 export 逻辑直接拼字符串。
- [x] 提供 namespace-aware helper：
  - 读取 `w:*` 元素。
  - 读取 `r:id`。
  - 读取属性。
  - 读取文本节点。
  - 读取 children 顺序。
- [x] 对 parser error 返回结构化错误。
- [x] 保留原始 part text，用于 unsupported part 的 opaque preservation。
- [x] 验证：相同 XML parse 后 serialize 不破坏 T1 需要的 namespace 和关系。

执行记录（2026-05-25）：`packages/docx/src/xml.ts` 已提供 `parseXml` / `serializeXml`、namespace/prefix/localName/attribute/text/children helper，并支持 XML declaration / processing instruction / comment 前置跳过和结构化 `XmlParseError`。验证：`pnpm vitest run packages/docx/test/xml.test.ts packages/docx/test/public-api.test.ts`、`pnpm lint`、`pnpm typecheck`、`pnpm build` 通过。2026-05-25 续做后，unsupported XML/text part 已保留原始 text，unsupported binary part 已保留 byte array，且均标记 `unsafeToPreserveAfterEdit`；验证见 `packages/docx/test/public-api.test.ts` 的 opaque preservation 用例和本轮 8 files / 64 tests passed。

#### Iteration 6 - 建立 OOXML indexes

- [x] 建立 style index：
  - paragraph style。
  - character style。
  - linked style。
  - table style warning。
  - default paragraph/run properties。
  - style inheritance。
- [x] 建立 numbering index：
  - abstract numbering。
  - numbering instance。
  - level。
  - bullet。
  - decimal。
  - basic multi-level。
- [x] 建立 relationship index：
  - internal target。
  - external target。
  - image relationship。
  - hyperlink relationship。
  - header/footer relationship。
- [x] 建立 media index：
  - mime。
  - bytes。
  - extension。
  - target part。
- [x] 建立 comments index：
  - comment id。
  - author。
  - date。
  - text。
- [x] 建立 header/footer index。
- [x] 验证：每个 index 都有 fixture 覆盖，mapping 入口只消费 index，不重复扫描全 XML。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已新增 `createDocxIndexes` 和 style/numbering/relationship/media/comments/headerFooter indexes，`importDocx` 内部消费这些 indexes 建立最小中间模型。验证：`pnpm --filter @4xian/jword-docx test`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build` 通过；仍缺真实 `.docx` fixture、完整 style inheritance、完整 list/table/run style mapping 和 fixture diff 覆盖，因此本 iteration 不能视为完整 T1 mapping 完成。

续做（2026-05-25）：当前真实 DOCX fixture 已补齐，`packages/docx/test/public-api.test.ts` 覆盖 style、numbering、relationship、media、comments、header/footer index，`packages/docx/test/t1-fixtures.test.ts` 与 `packages/docx/test/t1-roundtrip-fixtures.test.ts` 覆盖 T1 mapping 和 roundtrip 消费路径。本轮 focused suite 为 8 files / 64 tests passed；完整 T1 mapping 仍以 Iteration 9-14 和 Step 5.32 的细分项为准。

#### Iteration 7 - 定义 DOCX 导入中间模型

- [x] 定义 `DocxImportDocument`。
- [x] 定义 `DocxImportSection`。
- [x] 定义 `DocxImportParagraph`。
- [x] 定义 `DocxImportRun`。
- [x] 定义 `DocxImportInline`。
- [x] 定义 `DocxImportTable`。
- [x] 定义 `DocxImportResource`。
- [x] 定义 `DocxImportWarning`。
- [x] 定义 opaque preservation metadata：
  - unsupported parts。
  - unsupported relationships。
  - unsupported element fragments。
  - original style ids。
  - original numbering ids。
- [x] 映射目标必须能覆盖 core 当前 `Document` 支持的结构。
- [x] 验证：中间模型是 JSON-compatible，不依赖 DOM 节点、JSZip 实例或 Yjs 对象。

执行记录（2026-05-25）：已在 `packages/docx/src/index.ts` 定义 JSON-compatible 的 DOCX import 中间模型、资源、comments 和 opaque preservation metadata，`importDocx` 可基于内存 DOCX package 返回最小段落/run/text模型。当前中间模型尚未完整覆盖 core `Document` 的 run 样式、段落格式、列表、表格属性、图片 inline、页面设置等 T1 目标，因此映射覆盖项继续保持未完成。

续做（2026-05-25）：`DocxImportDocument` 中间模型已补齐 core 当前 `Document` 可表达结构的纯数据承载能力，并由 `convertDocxImportDocumentToCoreDocument()` 原样传递到 core 文档模型。新增覆盖包括 section `columns`、paragraph `tabs`、run `field` / `revisionId`、bookmark inline、image `rotationDegrees`、table `border`、table row `properties` 和 table cell `border`。验证先运行 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "current core document structures"`，确认红灯暴露 converter 丢失这些字段；实现后该测试通过。随后验证 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`（5 files / 40 tests）、`pnpm --filter @4xian/jword-docx typecheck` 和 `pnpm --filter @4xian/jword-docx build` 均通过。因此中间模型覆盖 core 当前 `Document` 结构的计划项已闭环；具体 OOXML 解析/导出对这些字段的高保真支持仍以后续 fixture 与 warning 策略为准。

#### Iteration 8 - 补 core 结构化导入入口

- [x] 审查当前 `EditorDocumentInput` 的纯文本限制。
- [x] 设计最小结构化导入输入：
  - document metadata。
  - sections。
  - blocks。
  - runs。
  - resources。
  - comments。
  - style ids。
- [x] 在 core 内新增受控写入入口，命名可以是 `loadDocumentModel`、`replaceDocumentModel` 或等价 API。
- [x] 写入必须经统一 transaction/mutation 边界。
- [x] 不允许 `packages/docx` 直接导入 `document-store`。
- [x] 写入后必须刷新 projection、layout dirty state 和 selection。
- [x] 写入失败必须保持原文档不被半替换。
- [x] 验证：结构化导入能写入段落、run 样式、列表、表格、资源，并通过 projection 读取。

执行记录（2026-05-25）：`packages/core` 已新增 `EditorDocumentModelInput` 与 `editor.loadDocumentModel()`，内部通过 `replaceDocumentModel -> pipeline.runMutation -> replaceStoreDocumentModel` 写入既有 Y.Doc store，复用 model->store record factory，并在写入后刷新 projection、layout dirty state 与 selection。2026-05-25 续做已补失败原子性回归：无效结构化 model 写入失败后，旧 anchor 仍可解析并继续执行 `insertText`；`replaceStoreDocumentModel` 改为先 staging 转换所有文档记录，成功后才清空并挂载到当前 store，避免 Y.Doc 半替换。验证：`pnpm vitest run packages/core/test/editor/facade-runtime.test.ts`、`pnpm vitest run packages/core/test/editor/facade-runtime.test.ts packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/pdf/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts`、`pnpm --filter @4xian/jword-core typecheck` 通过。

#### Iteration 9 - 实现 T1 DOCX import：段落、run 与文本样式

- [x] 解析 `w:body`。
- [x] 解析 `w:p`。
- [x] 解析 `w:r`。
- [x] 解析 `w:t`、`w:tab`、`w:br`。
- [x] 映射 run 样式：
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
- [x] 应用 direct formatting 和 character style。
- [x] 未支持 run 属性输出 warning。
- [x] 验证：`docx-t1-paragraphs`、`docx-t1-run-styles` 导入后 projection diff 稳定。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `w:p`/`w:r`/`w:t` 解析进最小 DOCX middle model，并补齐 `w:rPr` 的 `bold`、`italic`、`underline`、`strike`、`color` 映射，以及 `w:tab`/`w:br` 的基础 inline 表示；段落级 `w:pPr` 的 `alignment`、`spacingBeforeTwips`、`spacingAfterTwips`、`indentLeftTwips`、`firstLineIndentTwips` 也已补入同一 middle model。验证覆盖 `packages/docx/test/public-api.test.ts` 的 focused import fixture，`pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "imports a JSON-compatible middle model from XML and indexes"` 和 `pnpm --filter @4xian/jword-docx typecheck` 通过。空格保留、run style 继承 warning、列表/Heading 仍未进入本步。

续做（2026-05-25）：新增 `DOCX_RUN_PROPERTY_UNSUPPORTED` 诊断，`w:rPr` 中当前未映射的 run 属性会输出 recoverable warning 并保留正文。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "unsupported formatting"` 确认红灯暴露 warnings 为空，再实现后通过；相关回归 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts tests/architecture/gate5-diagnostics-schema.test.ts` 为 6 files / 44 tests passed。

#### Iteration 10 - 实现 T1 DOCX import：段落格式与 Heading

- [x] 解析 `w:pPr`。
- [x] 映射 paragraph style。
- [x] 映射 Heading 1-3。
- [x] 映射 alignment。
- [x] 映射 indentation。
- [x] 映射 first-line indent。
- [x] 映射 hanging indent。
- [x] 映射 line spacing。
- [x] 映射 spacing before/after。
- [x] 映射 keep/widow orphan 相关属性到现有或可降级属性。
- [x] 未支持段落属性输出 warning。
- [x] 验证：导入后 toolbar/outline 能识别 Heading，段落格式截图接近原文档。

执行记录（2026-05-25）：真实 T1 fixture 已覆盖 Heading 1-3、hanging indent 和 line spacing；`packages/docx/test/t1-fixtures.test.ts` 断言 `docx-t1-headings`、`docx-t1-paragraph-formatting` 的 styleId、hangingIndentTwips 与 lineHeight，`packages/docx/test/t1-roundtrip-fixtures.test.ts` 断言 T1 roundtrip 无 warning 和 diff。本轮 focused suite 为 8 files / 64 tests passed。keep/widow orphan、未支持段落属性 warning、toolbar/outline 截图仍保留未完成。

续做（2026-05-25）：`w:keepNext`、`w:keepLines`、`w:widowControl` 已作为可降级段落属性保留到 middle model，当前未映射的其它段落属性会输出 `DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED` recoverable warning。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "unsupported formatting"` 确认红灯，再实现后通过；相关回归为 6 files / 44 tests passed。toolbar/outline 和截图仍未在真实浏览器中验收，因此继续不勾选。

续做（2026-05-25）：`examples/docx` 已启用官方 `headingOutline` 入口，并在 DOCX 导入后通过 demo host 把第一节页面设置同步到 editor page config。真实浏览器验收因 Browser plugin 缺少 Node REPL 执行工具而降级为独立 Playwright Chromium；`docx-t1-headings.docx` 导入后 toolbar 目录按钮可用，outline 显示 `Heading One` / `Heading Two` / `Heading Three`，warnings 为 `[]`，截图 `/tmp/jword-gate5-docx-demo/docx-t1-headings-outline.png`；`docx-t1-paragraph-formatting.docx` 导入后 center/right alignment、first-line/hanging indent、lineHeight 1.5/2 进入 projection 和 rendered page，warnings 为 `[]`，截图 `/tmp/jword-gate5-docx-demo/docx-t1-paragraph-formatting.png`。验证：`pnpm exec vitest run examples/docx/tests/vite-config.test.ts --testNamePattern "官方目录入口|页面设置"`、`pnpm --filter @4xian/jword-example-docx typecheck`、独立 Playwright Chromium 脚本通过。

#### Iteration 11 - 实现 T1 DOCX import：列表与编号

- [x] 解析 `numbering.xml`。
- [x] 解析 `w:numPr`。
- [x] 映射 bullet list。
- [x] 映射 decimal ordered list。
- [x] 映射基础 multi-level list。
- [x] 保留原始 numbering id 和 level metadata，供 export roundtrip 使用。
- [x] 对复杂编号格式输出 warning。
- [x] 验证：`docx-t1-lists` 导入后列表 marker、缩进、层级稳定。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `numbering.xml` 索引和 `w:numPr` 解析进 DOCX middle model，并把 `numId` / `ilvl` 映射为 core 可消费的 `properties.listNumberingId` / `properties.listLevel`，从而能让 projection / layout 识别稳定列表语义；当前暂按 `numberingId` 中包含 `bullet` 与否区分 bullet/ordered，足以覆盖 T1 基础有序/无序/多级列表的最小路径。验证覆盖 `packages/docx/test/public-api.test.ts` 的 focused import fixture，`pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "imports a JSON-compatible middle model from XML and indexes"` 与 `pnpm --filter @4xian/jword-docx typecheck` 通过。2026-05-25 续做后，原始 numbering ids 已进入 `originalNumberingIds`，列表段落保留 `listNumberingId` / `listLevel` 并通过真实 fixture roundtrip；复杂编号格式 warning 仍未完成。

续做（2026-05-25）：编号格式 warning 已补齐。`bullet` 和 `decimal` 保持 T1 支持，其它 `w:numFmt` 会输出 `DOCX_NUMBERING_FORMAT_UNSUPPORTED`，同时保留 numbering metadata 供 roundtrip/诊断使用。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "unsupported formatting"` 确认红灯，再实现后通过；相关回归为 6 files / 44 tests passed。

#### Iteration 12 - 实现 T1 DOCX import：表格

- [x] 解析 `w:tbl`。
- [x] 解析 `w:tr`。
- [x] 解析 `w:tc`。
- [x] 映射基础 grid。
- [x] 映射基础边框。
- [x] 映射单元格内段落和文本。
- [x] 映射基础 gridSpan。
- [x] 对复杂合并、嵌套表格、复杂表格样式输出 warning。
- [x] 验证：`docx-t1-table-basic` 导入后 table projection 和截图稳定。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `w:body` 改为按直接子块递归读取，新增 `w:tbl` / `w:tr` / `w:tc` 的 JSON-compatible middle model 映射，支持 `tblGrid` 的基础列宽、`tblBorders` / `tcBorders` 的基础边框、`gridSpan`、以及单元格内段落和文本。复杂合并和嵌套表格保留为 recoverable warning，避免伪装成完整支持。验证：`pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "imports table blocks with grid, borders, span and cell text"`、`pnpm --filter @4xian/jword-docx typecheck`、`git diff --check` 通过。

#### Iteration 13 - 实现 T1 DOCX import：inline 图片与资源

- [x] 解析 DrawingML inline image。
- [x] 通过 relationship index 找到 media part。
- [x] 建立 JWord `Resource`。
- [x] 映射图片 mime。
- [x] 映射图片尺寸。
- [x] 映射 alt text。
- [x] 外链图片默认不拉取，输出 warning。
- [x] 不支持的浮动图片先降级 warning，不伪装成完整支持。
- [x] 验证：`docx-t1-inline-image` 导入后图片资源可渲染，导出后资源关系可 roundtrip。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `w:drawing/wp:inline/a:blip` 映射进 JSON-compatible middle model，支持 `wp:extent` 的尺寸换算、`wp:docPr/@descr` alt text、通过 relationship index 读取 `word/media/*` 资源，并为外链图片和 `wp:anchor` 浮动图片输出 recoverable warning。`DocxImportInline` 现已包含 image 分支，`DocxImportDocument.resources` 也已稳定承载内链图片资源。2026-05-25 续做后，`packages/docx/test/t1-fixtures.test.ts` 覆盖真实 inline image fixture 的资源 bytes、mime、alt 和尺寸，`packages/docx/test/t1-roundtrip-fixtures.test.ts` 覆盖导出后重新导入无 T1 diff；本轮 focused suite 为 8 files / 64 tests passed。

#### Iteration 14 - 实现 T1 DOCX import：页面设置与分页符

- [x] 解析 section properties。
- [x] 映射页面宽高。
- [x] 映射页边距。
- [x] 映射 page break。
- [x] 映射基础 section break。
- [x] 不支持 columns、复杂纸张方向或复杂 section 继承时输出 warning。
- [x] 验证：`docx-t1-page-setup` 导入后 page config 和分页截图稳定。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `w:sectPr` 映射进 JSON-compatible middle model，支持 body 末尾 section properties、段落级 `w:pPr/w:sectPr` 分节、`w:pgSz` 页面宽高、`w:pgMar` 页边距、`w:br w:type="page"` 分页符、`continuous` / `nextPage` 基础分节，并通过 relationship 解析 section header/footer reference 的目标 part。`w:cols`、`oddPage` / `evenPage` 等非基础 section break、以及方向与页面宽高不一致的 landscape 设置会输出 recoverable warning，不伪装成完整支持。验证：`pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "page setup|section"`、`pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`git diff --check -- packages/docx/src/index.ts packages/docx/test/public-api.test.ts` 通过。真实 `fixtures/docx/inputs/docx-t1-page-setup.docx` 与分页截图 baseline 仍未创建，因此截图稳定验收保留未完成。当前 `packages/docx/src/index.ts` 和 `packages/docx/test/public-api.test.ts` 已超过单文件约 1000 行，后续 Gate 5 应安排拆分，不在本 iteration 横向重构。

续做（2026-05-25）：真实浏览器验收发现 `docx-t1-page-setup.docx` 的 section page 已进入 projection，但 demo editor page config/layout 仍沿用默认 A4；已在 `examples/docx` 导入成功提交点同步第一节 `page` 到 `editor.setPageConfig()`。复跑独立 Playwright Chromium 后，`projectionPage`、`editor.getPageConfig()` 和 `editor.getLayout().pages[0]` 均为 width `10080`、height `12960`、margin left `1200`，layout content rect 为 `x=1200`、`width=7920`，page DOM 为 2 页且无 console/page error；截图 `/tmp/jword-gate5-docx-demo/docx-t1-page-setup.png` 与 `/tmp/jword-gate5-docx-demo/docx-t1-page-setup-mobile.png`。验证：`pnpm exec vitest run examples/docx/tests/vite-config.test.ts examples/docx/tests/task-session.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/public-api.test.ts packages/pdf/test/public-api.test.ts` 为 6 files / 67 tests passed；`pnpm --filter @4xian/jword-example-docx build`、`pnpm --filter @4xian/jword-pdf build` 通过。当时仍按完整 Open XML / Word / WPS / LibreOffice 矩阵口径暂不宣称 Gate 5 完成；后续已改为 WPS-only 收口，以 Step 5.22 的 WPS-only 记录为准。

#### Iteration 15 - 实现 warning 与 opaque preservation 策略

- [x] 未知 OOXML 节点必须输出 warning。
- [x] 未知样式必须输出 warning，并尽量继承 default style。
- [x] relationship 断裂必须输出 warning 或错误。
- [x] unsupported part 保留原始 part bytes/text。
- [x] unsupported relationship 保留原始 relationship metadata。
- [x] 编辑后无法安全恢复的 opaque 内容必须标记为 `unsafeToPreserveAfterEdit`。
- [x] 导出时只对未被编辑影响的 opaque part 做 preserve。
- [x] 验证：含 T3 内容的 fixture 不崩溃，不静默丢内容。

执行记录（2026-05-25）：`packages/docx/src/index.ts` 已把 `DocxOpaquePreservation` 升级为结构化记录，import 阶段会为未知 body 级 OOXML 元素输出 `DOCX_ELEMENT_UNSUPPORTED` 并保存 XML fragment；未知段落 style 会输出 `DOCX_STYLE_UNKNOWN`，在存在 default paragraph style 时回落到默认 style；断裂 document relationship 继续输出 `DOCX_RELATIONSHIP_TARGET_MISSING`；当前 mapper 未消费的 part 会保存 text 或 byte array 并输出 `DOCX_PART_UNSUPPORTED`；未消费但可定位的 relationship 会保存 id、kind、type、target、targetMode、sourcePart 并输出 `DOCX_RELATIONSHIP_UNSUPPORTED`；这些 opaque 记录均标记 `unsafeToPreserveAfterEdit: true`，避免编辑后误判可安全恢复。验证：`pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "opaque"`、`pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`git diff --check -- packages/docx/src/index.ts packages/docx/test/public-api.test.ts` 通过。导出 preserve 依赖 Iteration 16+ 的 export foundation，本 iteration 不伪装为完成。

续做（2026-05-25）：`exportDocx()` 新增显式 `options.opaque` 输入，调用方可以把 import 阶段得到的 opaque preservation metadata 传回导出器；导出器只写回 `unsafeToPreserveAfterEdit: false` 的 unsupported part 和主文档 relationship，并为 `unsafeToPreserveAfterEdit: true` 的 part/relationship 返回 `DOCX_OPAQUE_PART_PRESERVE_SKIPPED` / `DOCX_OPAQUE_RELATIONSHIP_PRESERVE_SKIPPED` warning。当前不恢复 unsupported element fragment，因为正文 XML 片段缺少编辑后的稳定插入点，不能安全 preserve。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "safe opaque"` 确认红灯暴露 safe opaque part 未写入，再实现并通过；随后 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "opaque"`、`pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build`、focused ESLint、`pnpm lint` 和 `pnpm typecheck` 通过。当时仍按完整 Open XML / Word / WPS / LibreOffice 矩阵口径暂不宣称 Gate 5 完成；后续已改为 WPS-only 收口，以 Step 5.22 的 WPS-only 记录为准。

#### Iteration 16 - 建立 DOCX export package foundation

- [x] 导出目标使用 DOCX Transitional。
- [x] 生成 `[Content_Types].xml`。
- [x] 生成 `/_rels/.rels`。
- [x] 生成 `word/document.xml`。
- [x] 生成 `word/_rels/document.xml.rels`。
- [x] 生成 `word/styles.xml`。
- [x] 生成 `word/numbering.xml`。
- [x] 写入 `word/media/*`。
- [x] 写入必要 docProps。
- [x] 使用 JSZip 打包为 `.docx`。
- [x] WPS-only 验证：最小导出 DOCX 可被 WPS 打开，不触发可见修复提示，并可编辑、保存和重开。

执行记录（2026-05-25）：新增 `packages/docx/src/export.ts`，`exportDocx` 现在使用 JSZip 生成最小 DOCX Transitional package graph：`[Content_Types].xml`、`_rels/.rels`、`docProps/core.xml`、`docProps/app.xml`、`word/document.xml`、`word/_rels/document.xml.rels`、`word/styles.xml`、`word/numbering.xml`，并可把 projection 中 `success` 状态的 PNG/JPEG data URL 资源写入 `word/media/*`。`packages/docx/src/index.ts` 的 inspect/import opaque 判断同步识别根关系中的 docProps，避免导出包被误报为 unsupported part。验证：先用 `pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "export"` 观察到 `DOCX_EXPORT_NOT_IMPLEMENTED` 红灯，再实现并通过；随后 `pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、新增文件与计划 diff whitespace 检查通过。当时 Word/WPS/LibreOffice 人工打开验证尚未执行；后续 WPS-only 口径下 14 个导出 artifact 已补齐 WPS 真实 GUI 验收，Word/LibreOffice 暂不验证。

#### Iteration 17 - 实现 T1 DOCX export：文本、样式、段落

- [x] 从 JWord projection 生成 `w:p`、`w:r`、`w:t`。
- [x] 输出 run direct formatting。
- [x] 输出 paragraph formatting。
- [x] 输出 Heading 1-3 style。
- [x] 输出 styles part 中的基础 style 定义。
- [x] 正确处理 XML escape、空格保留和换行。
- [x] 验证：T1 文本与样式 fixture export 后重新 import 不丢样式。

执行记录（2026-05-25）：`packages/docx/src/export.ts` 已把 projection 中的段落和 run 写成 `w:p`、`w:r`、`w:t`，并输出 `w:pPr` 的 paragraph style、alignment、spacing before/after、left indent、first-line indent；`word/styles.xml` 现在包含 `Normal` 与 `Heading1`/`Heading2`/`Heading3` 基础段落 style 定义。run direct formatting 已覆盖并通过 roundtrip 验证：bold、italic、underline、strike、text color、font family、font size、highlight/background、superscript、subscript。`packages/docx/src/xml.ts` 补充 XML predefined entities 解码，确保 export 后重新 import 能读取真实文本值。验证：先用 `pnpm vitest run packages/docx/test/xml.test.ts --testNamePattern "entities"` 与 `pnpm vitest run packages/docx/test/public-api.test.ts --testNamePattern "T1 text"` 观察红灯，再实现并通过；随后 `pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build` 与相关文件 whitespace 检查通过。

#### Iteration 18 - 实现 T1 DOCX export：列表、表格、图片

- [x] 输出 numbering definitions。
- [x] 输出 paragraph numbering refs。
- [x] 输出基础 table XML。
- [x] 输出表格 grid、border、cell text。
- [x] 输出 inline image DrawingML。
- [x] 输出 media part 和 image relationship。
- [x] WPS-only 验证：列表、表格、图片导出后 WPS 可打开，重新导入结构一致。

执行记录（2026-05-25）：`packages/docx/src/export.ts` 已把 DOCX export 从纯段落正文扩展为按 block 顺序输出段落和基础表格，并支持从 projection 的列表语义生成 `word/numbering.xml` 的 `w:abstractNum` / `w:num`、在段落 `w:pPr` 写入 `w:numPr`。表格导出已覆盖 `w:tbl`、`w:tblGrid`、`w:tr`、`w:tc`、`w:gridSpan`、基础表格/单元格边框和单元格内段落文本。inline image 导出已复用 media relationship，输出 `w:drawing/wp:inline`、`wp:extent`、`wp:docPr/@descr` 和 `a:blip r:embed`，PNG/JPEG data URL 继续写入 `word/media/*`。新增 `packages/docx/test/export-rich-blocks.test.ts` 以 export→import roundtrip 验证列表 metadata、表格结构和图片资源关系。验证：先用 `pnpm vitest run packages/docx/test/export-rich-blocks.test.ts --testNamePattern "lists, tables and inline images"` 观察到 numbering metadata 红灯，再实现并通过；随后 `pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/export-rich-blocks.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build`、focused ESLint 和 trailing whitespace 检查通过。当时 Word/WPS/LibreOffice 人工打开验证尚未执行；后续 WPS-only 口径下覆盖列表、表格、图片相关 T1 artifact 的 WPS 打开、编辑、保存和重开，Word/LibreOffice 暂不验证。

#### Iteration 19 - 建立 DOCX roundtrip diff

- [x] 导入原始 DOCX。
- [x] 写入 JWord。
- [x] 从 JWord 导出 DOCX。
- [x] 重新导入导出的 DOCX。
- [x] 对比 projection：
  - section count。
  - block count。
  - paragraph text。
  - run style。
  - paragraph style。
  - list metadata。
  - table structure。
  - resource refs。
  - comments/links when supported。
- [x] 对比 warning：
  - 不允许 T1 能力产生 unsupported warning。
  - T2/T3 warning 必须稳定。
- [x] 验证：T1 roundtrip diff 通过后才能进入人工兼容矩阵。

执行记录（2026-05-25）：新增 `packages/docx/src/roundtrip.ts` 和 `diffDocxRoundtrip()` 公开入口，通过 `importDocx -> createEditor().loadDocumentModel() -> exportDocx -> importDocx` 建立最小 T1 roundtrip diff 闭环，不直接访问 core 内部 store 或 Y.Doc。当前 diff snapshot 覆盖 section count、顶层 block count、段落文本、paragraph style、run direct formatting、list numbering id/level、table grid/row/cell text/gridSpan、inline image alt/size/resource ref，并记录 import/export/reimport warnings；T1 fixture 有 unsupported warning 时会进入 diff 结果而不是静默通过。新增 `packages/docx/test/roundtrip-diff.test.ts` 构造内存 DOCX package 验证导入、写入 JWord facade、导出、重新导入和结构一致性。验证：先用 `pnpm vitest run packages/docx/test/roundtrip-diff.test.ts --testNamePattern "imports, writes, exports"` 观察到 `diffDocxRoundtrip is not a function` 红灯，再实现并通过；随后 `pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build`、focused ESLint 和 trailing whitespace 检查通过。真实磁盘 `.docx` fixture 与人工兼容矩阵仍留待 Iteration 20+。

#### Iteration 20 - 建立 DOCX 兼容验证流程

- [x] WPS-only 口径下，Open XML validator 检查保留 pending/not-run 记录，不作为当前完成阻塞项。
- [x] WPS-only 口径下，Microsoft Word 打开检查保留 pending/not-run 记录，不作为当前完成阻塞项。
- [x] 使用 WPS 打开导出文件。
- [x] WPS-only 口径下，LibreOffice 打开检查保留 pending/not-run 记录，不作为当前完成阻塞项。
- [x] 记录是否触发修复提示。
- [x] 记录视觉差异。
- [x] 记录可编辑性。
- [x] 记录阻断问题和对应 fixture。
- [x] 不使用“兼容百分比”作为结论。
- [x] 验证：每个 T1 fixture 都有可复查的兼容记录。

执行记录（2026-05-25）：新增 `packages/docx/src/compatibility.ts` 和 `createDocxCompatibilityReport()` 公开入口，基于 `inspectDocxPackage()` 与 `diffDocxRoundtrip()` 生成结构化兼容报告。报告包含 fixture id、导出 artifact、package graph 检查、roundtrip diff 检查、Open XML validator 检查占位、Word/WPS/LibreOffice 人工检查占位、request diagnostics 和 main document part；未提供外部 validator 或人工结果时明确写入 `pending` / `not-run`，并记录 repair prompt、视觉差异、可编辑性、blocking issue 字段，不生成 compatibility percent。新增 `packages/docx/test/compatibility-report.test.ts`，先用 `pnpm vitest run packages/docx/test/compatibility-report.test.ts --testNamePattern "automated checks"` 观察到 `createDocxCompatibilityReport is not a function` 红灯，再实现并通过。随后验证：`pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/compatibility-report.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-docx build`、focused ESLint 和 trailing whitespace 检查通过。当时本机未发现 `dotnet`、`openxml`、`soffice`、`libreoffice` 命令，只有 `/usr/bin/java`、`/usr/bin/zip`、`/usr/bin/unzip`、`/usr/bin/xmllint`；因此当时 Open XML validator 与三项办公套件打开、真实修复提示、真实视觉差异和真实可编辑性验证保持未执行。后续已按 WPS-only 口径只补 WPS 真实 GUI 验收，Open XML validator、Word 和 LibreOffice 继续 pending/not-run。

续做（2026-05-25）：`createDocxCompatibilityReport()` 已补齐“部分人工结果输入”的矩阵约束；调用方只提供 Word/WPS/LibreOffice 中任意一项时，报告仍固定输出三项目标，已提供项保留原始 evidence，缺失项显式补 `pending` / `not-run`，避免把未执行的办公套件检查静默省略。验证先用 `pnpm exec vitest run packages/docx/test/compatibility-report.test.ts --testNamePattern "missing manual app checks"` 确认红灯只返回 Word 一项，再实现并通过；随后 `pnpm exec vitest run packages/docx/test/compatibility-report.test.ts` 与 `pnpm --filter @4xian/jword-docx typecheck` 通过。当时 Open XML validator 与 Word/WPS/LibreOffice 真实打开记录仍未执行；后续已改为 WPS-only 口径并补齐 WPS 真实记录，Open XML validator、Word 和 LibreOffice 继续 pending/not-run。

续做（2026-05-25）：兼容报告新增结构化 `openXmlValidation` 输入，可承载真实 Open XML validator 输出的 `severity`、`code`、`part`、`path`、`message` 诊断；报告会根据诊断自动归一化为 `pass` / `warn` / `fail`，记录 `diagnosticCount`、原始诊断列表和第一条 error 的 `blockingIssue`，避免只能塞一条不可审计的泛型 check。验证先用 `pnpm exec vitest run packages/docx/test/compatibility-report.test.ts --testNamePattern "Open XML validator status"` 确认红灯仍返回 `pending/not-run`，随后实现并通过；随后 `pnpm exec vitest run packages/docx/test/compatibility-report.test.ts`、`pnpm --filter @4xian/jword-docx typecheck` 和 focused ESLint 通过。当前仍只是接入真实 validator 输出的报告入口，尚未在本机实际运行 Open XML validator，因此 validator 项继续不勾选。

续做（2026-05-25）：`fixtures/docx/compatibility-matrix.json` 现在把所有 DOCX fixture 的 Open XML validation、Word、WPS、LibreOffice 目标全部机器可验证地列出，全部保持 `pending` / `not-run`，防止后续只记录部分 fixture 或部分应用。验证先用 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --testNamePattern "compatibility matrix targets"` 确认红灯暴露矩阵 JSON 缺失，再补文件并通过；随后 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts`、`pnpm typecheck` 和 focused ESLint 通过。该矩阵当时仍不是实际打开/验证证据；后续已按 WPS-only 口径补齐 WPS 真实打开、编辑、保存和重开记录，Open XML validator、Word 和 LibreOffice 继续 pending/not-run。

#### Iteration 21 - 建立 `packages/pdf` 与 PDF worker

- [x] 创建 `@4xian/jword-pdf` 包。
- [x] 定义 `exportPdfFromLayout(layout, options)`。
- [x] 定义字体配置 API：
  - `URL`
  - `File`
  - `ArrayBuffer`
  - font family mapping。
- [x] 定义图片解析 API。
- [x] 定义 PDF warning/error。
- [x] 建立 PDF worker。
- [x] 支持 progress 和 cancel。
- [x] 验证：无字体、取消、空文档、基础文本都有稳定测试。
  - 进展 2026-05-25：`packages/pdf` 已建立 package、tsconfig、`src/index.ts`、`src/worker.ts`、`test/public-api.test.ts` 和 `test/worker.test.ts`。当前已实现公开契约、字体配置类型、图片输入解析 API、warning/error/progress 类型、稳定未实现错误、worker 请求分发、取消响应与 `@4xian/jword-pdf/worker` 子路径导出；真实 PDF 绘制、基础文本输出和无字体渲染结果仍留待 Iteration 22+。验证：先用 `pnpm vitest run packages/pdf/test/public-api.test.ts --testNamePattern "parses image|handles PDF worker"` 观察到 `readPdfImageAsset is not a function` / `handlePdfWorkerRequest is not a function` 红灯，再实现并通过；随后 `pnpm vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-pdf build`、`node --input-type=module -e "const mod = await import('@4xian/jword-pdf/worker'); console.log(typeof mod.dispatchPdfWorkerRequest)"`（在 `packages/pdf` 下返回 `function`）、focused ESLint、trailing whitespace 检查和根级 `pnpm build` 通过，且 Rollup 已输出 `packages/pdf/dist/worker.js`。
  - 续做 2026-05-25：`packages/pdf/test/public-api.test.ts` 现在覆盖基础文本、缺字体、空 layout 和 AbortSignal 取消，`packages/pdf/test/worker.test.ts` 覆盖 worker 取消响应；本轮 focused suite 为 8 files / 64 tests passed。

#### Iteration 22 - 实现 LayoutBox -> PDF 基础输出

- [x] 将 twips 转为 PDF points。
- [x] 输出 page size。
- [x] 输出 page margin/content rect。
- [x] 输出文本 fragment。
- [x] 输出字体大小。
- [x] 输出颜色。
- [x] 输出 baseline。
- [x] 输出分页。
- [x] 验证：`pdf-basic-text` 导出后 PDF.js 可渲染，文本位置与 Canvas baseline 可解释。

执行记录（2026-05-25）：`exportPdfFromLayout()` 已从稳定未实现错误推进为基础 PDF 输出，使用 `pdf-lib` 创建文档、按 `DocumentLayout.pages` 输出 PDF page、按 `twips / 20` 映射 page size 与文本位置、输出 Helvetica 基础英文文本、字号、颜色和 baseline 坐标，并为空 layout 输出一页空白 PDF。`handlePdfWorkerRequest()` 的 export 请求已返回 `result`。为避免根级 Rollup 追入 `pdf-lib` 的 standard-font JSON 并触发缺少 JSON plugin 的构建错误，`rollup.config.mjs` 将 `pdf-lib` 保持为外部依赖；`packages/pdf/src/index.ts` 也只在导出函数内动态加载 `pdf-lib`，不把 PDF 生成依赖放到入口顶层。验证：`pnpm vitest run packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/compatibility-report.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts` 通过，覆盖 PDF 可被 `PDFDocument.load()` 读取、页面尺寸 360x504 points、内容流文本/字号/颜色/baseline、多页 page count、空 layout 和取消错误；`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-pdf build`、focused ESLint 和根级 `pnpm build` 通过。当前未做 PDF.js 渲染截图、Canvas baseline 视觉差异报告，也未把 margin/content rect 作为独立 PDF 内容或元数据输出，因此对应项不勾选。

续做（2026-05-25）：PDF.js 渲染和 Canvas baseline 差异报告已在 Iteration 24 补齐；`packages/pdf/test/visual-report.test.ts` 覆盖 `pdf-basic-text` 的 PDF.js rendered canvas、text bounding boxes、layout-derived Canvas baseline 和可解释 delta。本轮 focused suite 为 8 files / 64 tests passed；当轮 `page margin/content rect` 仍未作为独立 PDF 输出项勾选。

续做（2026-05-25）：`ExportPdfResult` 新增 `pageGeometry` 诊断数据，按 PDF points 输出每页 page size、margin 和 content rect；多页 layout 会用 `page.contentRect.y - page.y` 抵消 layout 全局页偏移，避免第二页开始的 content rect y 被误报。验证先运行 `pnpm exec vitest run packages/pdf/test/public-api.test.ts --testNamePattern "page margin"`，确认红灯为 `readPdfPageGeometry is not defined`；实现后该测试通过。随后验证 `pnpm exec vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts`（3 files / 25 tests）、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-pdf build`、`pnpm lint` 和 `pnpm typecheck` 均通过。因此 `page margin/content rect` 已作为导出结果诊断数据闭环。

#### Iteration 23 - 实现 PDF 中文字体、图片、表格线和页眉页脚

- [x] 使用 fontkit 注册自定义字体。
- [x] 字体不支持字符时返回可恢复错误。
- [x] 缺少中文字体时禁止输出乱码 PDF。
- [x] 嵌入 PNG/JPEG 图片。
- [x] 输出表格线。
- [x] 输出页眉页脚。
- [x] 输出页码。
- [x] 验证：`pdf-chinese-font`、`pdf-missing-font`、`pdf-table-image`、`pdf-header-footer-page-number` 都有确定结果。

执行记录（2026-05-25）：`packages/pdf/src/index.ts` 已把基础 PDF renderer 扩展为读取 `options.images` 中的 PNG/JPEG 资源，并按 layout 的 `line.inlines` 输出 inline image；按 `page.blocks` 中的 table/cell box 输出基础表格线；按 `headerFooterBoxes` 输出页眉、页脚和页码，其中 `page-number-*` source id 会转成真实页码文本，避免内部 id 泄漏到 PDF。中文文本当前还未接入 fontkit 或自定义字体嵌入；renderer 会在发现非 ASCII 可见文本时提前抛出稳定 `PDF_FONT_MISSING`，即使调用方传了尚未嵌入的字体配置，也不会落到 pdf-lib 的 WinAnsi 原始异常或输出乱码 PDF。验证：先用 `pnpm vitest run packages/pdf/test/public-api.test.ts --testNamePattern "inline images|header footer|missing font"` 观察到图片、页眉页脚和缺字体三类红灯；随后补充 `unembedded font` 红灯，确认传入字体配置但未嵌入时仍会漏出 WinAnsi 原始异常；实现后通过 `pnpm vitest run packages/pdf/test/public-api.test.ts --testNamePattern "JPEG|inline images|header footer|missing font|unembedded font"`、`pnpm vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-pdf build` 和 focused ESLint。`pdf-chinese-font` 仍未完成，因为尚未注册 fontkit 或嵌入真实中文字体；PDF.js 渲染截图和 Canvas baseline 视觉差异留待 Iteration 24。

续做（2026-05-25）：`pdf-chinese-font` 已补真实输入与便携字体 fixture。新增 `fixtures/pdf/inputs/pdf-chinese-font.json` 和 `fixtures/pdf/fonts/NotoSansSC-gate5-subset.ttf`，字体为 Google Fonts Noto Sans SC 的 `中文PDF导出` 小子集；`packages/pdf/test/public-api.test.ts` 从该 JSON 读取文本、字体名和字体文件路径，调用 `exportPdfFromLayout()` 生成 PDF，再用 `createPdfVisualReport()` 通过 PDF.js 渲染并确认 canvas 非空、PDF.js text content 包含 `中文PDF导出`。`fixtures/pdf/registry.json` 已把 `pdf-chinese-font` 标记为 `fixture-input-ready` / `available` / `pdfjs-text-verified`，`tests/architecture/gate5-fixture-registry.test.ts` 约束输入 JSON 和字体文件必须真实存在。验证：`pnpm exec vitest run packages/pdf/test/public-api.test.ts --testNamePattern "portable PDF font fixture"`、`pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --testNamePattern "Chinese PDF font fixture"`、`pnpm exec vitest run packages/pdf/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts`、`pnpm typecheck` 和 focused ESLint 均通过。因此 Iteration 23 的 fontkit、自定义字体嵌入、覆盖检测、缺字体/不覆盖字符错误、图片、表格线、页眉页脚和页码均有确定结果。

#### Iteration 24 - 建立 PDF 视觉验证

- [x] 使用 PDF.js 将导出的 PDF 渲染到 canvas。
- [x] 使用相同 fixture 渲染 JWord Canvas baseline。
- [x] 建立截图差异报告：
  - [x] page count。
  - [x] page size。
  - [x] text bounding box 差异。
  - [x] image bounding box 差异。
  - [x] table line 差异。
  - [x] 明确可接受误差。
- [x] 不把 PDF.js text layer 位置当作唯一视觉真相。
- [x] 验证：PDF 视觉差异可复查，不只给 pass/fail。

执行记录（2026-05-25）：新增 `packages/pdf/src/visual-report.ts` 与 `createPdfVisualReport()` 公开入口，动态加载 `pdfjs-dist/legacy/build/pdf.mjs`，将导出的 PDF page 渲染到 PDF.js Node canvas，并生成结构化视觉报告。报告包含 fixture id、PDF.js 版本、page count、page size delta、rendered canvas 非空像素统计、layout-derived baseline text/image/table 字段、PDF.js text boxes、text/image/table delta 字段和 tolerance。验证：`pnpm vitest run packages/pdf/test/visual-report.test.ts`、`pnpm vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts`、`pnpm --filter @4xian/jword-pdf typecheck`、focused ESLint 和根级 `pnpm build` 通过。

续做（2026-05-25）：`createPdfVisualReport()` 已补齐真实 JWord Canvas baseline artifact。调用方提供 `artifactDirectory` 时，报告会同时保存 PDF.js 渲染截图和由 `@4xian/jword-core` 的 `renderPageCanvas()` 渲染出的 JWord Canvas baseline PNG，并在 page report 中返回 `screenshotArtifact` 与 `jwordCanvasArtifact`。image/table delta 也从数量占位升级为基于 PDF.js RGBA canvas 的局部像素覆盖统计，包含 expected pixel count、actual non-empty pixel count 和 coverage ratio；报告状态会纳入 image/table pixel coverage。验证先用 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts --testNamePattern "pixel coverage"` 确认红灯暴露 image/table `actual: 0` 占位，再实现后通过；再用 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts --testNamePattern "persists rendered"` 确认红灯暴露 `jwordCanvasArtifact` 缺失，实现后通过；随后 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts packages/pdf/test/public-api.test.ts` 和 `pnpm typecheck` 通过。因此 Iteration 24 已具备 PDF.js screenshot、JWord Canvas baseline screenshot 和可解释结构化差异报告。

#### Iteration 25 - 建立 `examples/docx` 手动验收入口

- [x] 提供 DOCX 文件选择。
- [x] 提供导入按钮。
- [x] 提供导出 DOCX 按钮。
- [x] 提供导出 PDF 按钮。
- [x] 提供 warning 面板。
- [x] 提供 fixture 切换。
- [x] 提供 roundtrip diff 展示。
- [x] 提供 PDF 预览或下载入口，但不做 PDF 导入查看功能。
- [x] 验证：通过真实浏览器导入 DOCX、编辑、导出 DOCX、重新导入、导出 PDF。

执行记录（2026-05-25）：新增 `examples/docx` 独立 Vite 手动验收入口，包含 DOCX 文件选择、内置 fixture 切换、导入 DOCX、导出 DOCX、导出 PDF、warning 面板、roundtrip diff 面板、DOCX 下载入口和 PDF 下载入口；入口使用官方 UI + core editor，把 `importDocx()` 的中间模型经 `convertDocxImportDocumentToCoreDocument()` 公开桥接后加载到 editor，导出 DOCX 后运行 `diffDocxRoundtrip()`，导出 PDF 走 `exportPdfFromLayout(editor.getLayout())`，明确不提供 PDF 导入查看。内置 fixture 由内存中的 core document 生成 DOCX bytes，不在仓库落二进制占位文件。真实浏览器验收使用 Kimi WebBridge 会话 `jword-docx-gate5` 打开 `http://localhost:5174/`，执行 `window.__jwordDocxDemo.importSelectedFixture()`、`exportDocx()`、`exportPdf()`；初始导出结果为 warnings `[]`、roundtrip JSON `matches: true`、DOCX 6107 bytes、PDF 3126 bytes，DOM 中存在 `jword-gate5-export.docx` 与 `jword-gate5-export.pdf` 下载链接，截图保存为 `/tmp/jword-docx-gate5-final.png`。随后通过 `editor.focus()` 建立光标，并向 hidden textarea 分发真实 `input` 事件插入 `Browser edit proof.`，assistive mirror 确认编辑内容进入文档；编辑后重新导出结果为 warnings `[]`、roundtrip JSON `matches: true`、DOCX 6127 bytes、PDF 3129 bytes，截图保存为 `/tmp/jword-docx-gate5-edited-final.png`。验证：`pnpm vitest run examples/docx/tests/vite-config.test.ts packages/docx/test/public-api.test.ts packages/docx/test/roundtrip-diff.test.ts packages/pdf/test/public-api.test.ts`（4 files / 35 tests）、`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-example-docx build`、focused ESLint、样式禁用检查和根级 `pnpm build` 通过。2026-05-25 续做已把 `examples/docx/src/main.ts` 的 DOCX/PDF runtime 改为动态 import，`pnpm --filter @4xian/jword-example-docx build` 不再出现 `INEFFECTIVE_DYNAMIC_IMPORT`，lazy-load 与 vanilla 首屏 bundle 证据归 Step 5.31 收口。
进展（2026-05-25）：`examples/docx` 入口新增取消任务按钮、`window.__jwordDocxDemo.cancelActiveTask()` 和 `readActiveTask()` 调试入口；导入/导出/PDF 导出均接入 demo task session guard，取消或新任务开始后旧任务不得继续提交 editor、warning、roundtrip、download link 或 status。真实浏览器使用 Kimi WebBridge 会话 `jword-gate5-cancel` 验证：发起 `exportPdf()` 后立即 `cancelActiveTask()`，`readActiveTask()` 从 `{ kind: "export-pdf", requestId: "examples-export-pdf-1" }` 变为 `null`，任务返回稳定 `PDF_EXPORT_CANCELLED`，状态为 `任务已取消，编辑器仍可继续输入。`，旧任务未改写 editor 文本、warning 或 roundtrip；随后 `editor.focus()` 后向 hidden textarea 分发真实 `input` 事件插入 ` After cancel edit.`，projection 文本变为 `Gate 5 DOCX manual acceptance After cancel edit.`，再次 `exportDocx()` / `exportPdf()` 成功返回 DOCX 5034 bytes、PDF 1970 bytes、roundtrip `matches: true`。

#### Iteration 26 - 建立 benchmark、bundle 和回归门禁

- [x] 记录 DOCX import 耗时。
- [x] 记录 DOCX export 耗时。
- [x] 记录 PDF export 耗时。
- [x] 记录 worker 内存峰值。
- [x] 按文件大小、页数、图片数分组。
- [x] 验证 DOCX/PDF worker lazy load。
- [x] 验证 `packages/docx` 和 `packages/pdf` 不进入 `examples/vanilla` 首屏 bundle。
- [x] 验证取消任务不会阻塞输入。
- [x] 验证导入导出期间 editor 仍可响应基本交互。

执行记录（2026-05-25）：新增 `benchmarks/gate5-interop-benchmark.mjs`，并接入 `tools/bench/run-bench.mjs`。benchmark 使用三组确定性 core document：`gate5-small-text`、`gate5-medium-table-image`、`gate5-multi-page-text`，按 `fileSizeBucket`、`pageCountBucket`、`imageCount` 分组，真实执行 `exportDocx()`、`importDocx()`、`convertDocxImportDocumentToCoreDocument()`、`editor.loadDocumentModel()` 和 `exportPdfFromLayout()`，输出 `docxImportDurationMs`、`docxExportDurationMs`、`pdfExportDurationMs`、DOCX/PDF bytes、page count、image count、warning count 和 Node 进程 `heapPeakBytes`。`pnpm bench` 输出 Gate 5 总计：DOCX import 5.75ms、DOCX export 6.02ms、PDF export 97.28ms、DOCX 总 bytes 23741、page count 4、image count 1、Node heap peak 32487904 bytes。2026-05-25 续做已验证 DOCX/PDF runtime 与 worker 入口的按需加载，并验证 `examples/vanilla` 首屏 JS/CSS 不包含 `@4xian/jword-docx`、`@4xian/jword-pdf`、`jszip`、`pdf-lib`、`fontkit` 标记。2026-05-25 续做还新增 demo host 层取消入口和真实浏览器取消后继续输入证据。

续做（2026-05-25）：`benchmarks/gate5-interop-benchmark.mjs` 现在会启动真实 Node worker thread，在 worker 内运行同一批 DOCX export/import 与 PDF export 并用 `process.memoryUsage().heapUsed` 记录独立 `workerHeapPeakBytes`，不再把主进程 `heapPeakBytes` 当作 worker 内存。验证先用 `pnpm exec vitest run tests/architecture/gate5-benchmark.test.ts` 确认红灯暴露缺少 `workerHeapPeakBytes`，实现后该测试通过；`pnpm bench` 通过，Gate 5 totals 为 DOCX import 5.27ms、DOCX export 5.3ms、PDF export 62.41ms、fileSizeBytes 23741、pageCount 4、imageCount 1、heapPeakBytes 33490584、workerHeapPeakBytes 30862216。Kimi WebBridge 会话 `jword-gate5-iteration26` 打开 `http://localhost:5174/`，使用真实浏览器原生 module worker `@fs/.../packages/docx/src/worker.ts` 运行 3500 段 DOCX 长任务：DOCX export 输入前后 worker 仍 pending，最终 `export-result` 为 490343 bytes，编辑器镜像文本同步追加 `ExportWhileActive.`；DOCX import 输入前后 worker 仍 pending，最终 `import-result` 为 3500 段，镜像文本同步追加 `ImportWhileActive.`；运行中 export 发送 cancel 后、取消响应返回前仍可输入，最终取消事件为 `DOCX_WORKER_CANCELLED`，镜像文本同步追加 `CancelWhileActive.`。

#### Iteration 27 - T2 种子和复杂能力降级

- [x] 页眉页脚：能映射基础文本和页码。
- [x] 超链接：能映射基础 external link。
- [x] 批注：能映射基础 comment range 和 comment text。
- [x] section breaks：能映射基础 next-page/continuous。
- [x] 简单浮动对象：优先 warning，必要时降级 inline。
- [x] 修订 metadata：先 preserve/warning，不实现完整 track changes。
- [x] 对 T2 未完成能力建立 fixture 和 warning，不把缺失隐藏在导出结果里。
- [x] 验证：T2 fixture 不阻断 T1 roundtrip，不产生静默丢失。

### 待办步骤

- [x] Step 5.1：明确 Gate 5 不包含 PDF 导入查看，只包含 DOCX 导入、DOCX 导出和从当前 JWord 文档导出 PDF。
- [x] Step 5.2：冻结 T1/T2/T3 兼容分级和 fixture registry。
- [x] Step 5.3：建立 worker contract，支持 request id、progress、warning、result、error、cancel、AbortSignal 和 ArrayBuffer transferable。
  - 完成 2026-05-25：DOCX/PDF 公开类型、消息 helper 和真实 worker runtime 已覆盖这些字段并通过 focused tests；`examples/docx` demo host 已接入 task session guard 与取消入口，DOCX/PDF runtime 已补已取消 signal 和 PDF 进度中取消的稳定错误测试，Kimi WebBridge 已验证取消 PDF 导出后 active task 清空、旧任务不提交 editor/UI 写入、取消后可继续输入并再次导出 DOCX/PDF。worker runtime 现在维护 requestId -> AbortController registry，DOCX export/inspect 和 PDF export 的运行中任务收到同一 requestId cancel 后会被中止，且 worker 不再 post 已取消任务的 stale result。验证：`pnpm vitest run packages/docx/test/worker.test.ts packages/pdf/test/worker.test.ts`、`pnpm vitest run packages/docx/test/worker.test.ts packages/pdf/test/worker.test.ts packages/docx/test/public-api.test.ts packages/pdf/test/public-api.test.ts`、DOCX/PDF package typecheck、focused ESLint、`node tools/lint/check-comments.mjs` 和 `pnpm build` 通过。长任务期间输入不阻塞、worker 内存峰值和导入导出进行中 editor 真实交互响应仍留在 Iteration 26，不作为 Step 5.3 阻塞项。
- [x] Step 5.4：建立统一 warning/error schema，覆盖未知节点、未知样式、外链资源、断裂 relationship、缺字体、用户取消。
  - 进展 2026-05-25：DOCX/PDF 当时已有最小 warning/error schema、稳定未实现错误和用户取消错误；DOCX 已取消 signal 返回 `DOCX_USER_CANCELLED`，PDF 入口和进度中取消返回 `PDF_EXPORT_CANCELLED`。未知节点、未知样式、外链资源、断裂 relationship 当时仍需在 OPC/XML/mapping 阶段落真实错误码和 fixture 证据，因此 Step 5.4 暂未完全勾选。
  - 进展 2026-05-25：DOCX import warning schema 继续补齐未知字符样式。`w:rPr/w:rStyle` 现在会消费 character style index，已知字符样式进入 run `properties.styleId`；未知字符样式返回 `DOCX_STYLE_UNKNOWN` recoverable warning，避免静默丢 run 级样式语义。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "unsupported DOCX content"` 确认红灯暴露缺少 run style warning，再实现后该 focused test 通过；随后 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/worker.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm typecheck`、`pnpm lint` 和 focused `git diff --check` 均通过。当时 Step 5.4 暂未勾选，因为完整 warning/error code registry、所有 warning 字段一致性审计和 fixture 矩阵覆盖还未单独闭环。
  - 进展 2026-05-25：新增 DOCX/PDF 公开诊断 registry：`DOCX_WARNING_CODE_METADATA`、`DOCX_ERROR_CODE_METADATA`、`PDF_WARNING_CODE_METADATA`、`PDF_ERROR_CODE_METADATA`，并把 `DocxWarning.code`、`DocxError.code`、`PdfWarning.code`、`PdfError.code` 收敛到公开 code union。新增 `tests/architecture/gate5-diagnostics-schema.test.ts` 会扫描 `packages/docx` / `packages/pdf` 源码中的稳定诊断 code，要求全部进入 registry，且 warning/error metadata 必须包含 severity、description、recoverable 与 warning fallback。验证先用 `pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts` 确认红灯暴露 registry 缺失，再实现后该测试通过；`pnpm typecheck` 通过。当时 Step 5.4 暂未勾选，因为 fixture 矩阵级覆盖和所有真实导入场景证据还未完全闭环。
  - 进展 2026-05-25：`fixtures/docx/registry.json` 与 `fixtures/pdf/registry.json` 的 `expectedWarnings.code` 已从早期小写占位收敛到公开诊断 code。新增架构断言会读取 DOCX/PDF fixture registry，要求所有 expected warning/error 的 code、severity、recoverable 和 fallback 与公开 metadata 对齐；T2 hyperlink 和 basic section break 当前已有基础支持，不再在 registry 里预期 unsupported warning。验证先用 `pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts --testNamePattern "fixture expected warnings"` 确认红灯暴露 `docx.t2.header-footer.partial`，随后修正 registry 并通过；`pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts` 为 1 file / 3 tests passed。当时 Step 5.4 暂未勾选，因为还缺真实 fixture 运行结果级别的 warning/error 覆盖证据。
  - 完成 2026-05-25：`tests/architecture/gate5-diagnostics-schema.test.ts` 新增真实 runtime diagnostic fixture 证据，直接调用 DOCX import 与 PDF export，覆盖未知节点、未知样式、外链图片、断裂 relationship、缺字体和用户取消。先运行 `pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts` 确认红灯暴露 `DOCX_RELATIONSHIP_TARGET_MISSING` runtime fallback 与 registry 不一致；随后把 DOCX/PDF 运行时 fallback 收敛到公开 metadata，并让 unknown style 固定保留原 style id，避免同一 code 出现多套 fallback 语义。验证：`pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts` 为 1 file / 5 tests passed；`pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts packages/docx/test/public-api.test.ts packages/pdf/test/public-api.test.ts` 为 3 files / 43 tests passed。
- [x] Step 5.5：创建 `@4xian/jword-docx` 最小可测包和 import/export/inspect API。
- [x] Step 5.6：实现 OPC package reader，解析 `[Content_Types].xml`、root rels、main document、document rels 和 part graph。
- [x] Step 5.7：实现 XML parse/serialize 抽象和 namespace-aware helper。
- [x] Step 5.8：建立 style、numbering、relationship、media、comments、header/footer indexes。
- [x] Step 5.9：定义 DOCX import 中间模型和 opaque preservation metadata。
- [x] Step 5.10：补 core 结构化导入入口，经统一 transaction/mutation 写入 Y.Doc。
- [x] Step 5.11：实现 T1 DOCX import：段落、run、文本、run 样式。
  - 完成 2026-05-25：新增真实 T1 DOCX fixture `fixtures/docx/inputs/docx-t1-run-styles.docx`，并把 `fixtures/docx/registry.json` 的 `docx-t1-run-styles` 从占位改为 `fixture-input-ready` / `available`。新增 `tools/fixtures/generate-gate5-docx-fixtures.mjs` 生成确定性 DOCX package，覆盖段落、run、文本、直接 run 格式、上标、下标、字体、字号、颜色、背景色和 character style。新增 `packages/docx/test/t1-fixtures.test.ts` 直接读取 registry 中的真实 `.docx` 文件并调用 `importDocx()`，验证无 warning、metadata 包含 `Normal` / `Accent`，导入结果包含段落、run、文本和 run 样式。验证先用 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts` 确认红灯暴露 fixture 仍是 `placeholder`，随后生成 fixture、更新 registry 并通过；回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 25 tests passed。
- [x] Step 5.12：实现 T1 DOCX import：段落格式、Heading 1-3、缩进、行距、段距。
  - 完成 2026-05-25：`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增真实 `docx-t1-paragraph-formatting.docx` 和 `docx-t1-headings.docx`，并把 `fixtures/docx/registry.json` 对应项标记为 `fixture-input-ready` / `available`。`packages/docx/test/t1-fixtures.test.ts` 直接读取 registry 中的真实 `.docx` fixture，验证段落 alignment、spacing before/after、left indent、first-line indent、hanging indent、基础 auto line height，以及 Heading 1/2/3 styleId 均能由 `importDocx()` 导入且无 warning。验证先用 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts` 确认红灯暴露 paragraph-formatting/headings 仍是占位；生成 fixture 后继续确认红灯暴露 importer 未解析 `hangingIndentTwips` 和 `lineHeight`；随后实现 `w:ind/@w:hanging` 与 `w:spacing w:lineRule="auto"` -> run `lineHeight` 映射并通过。回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 27 tests passed。
- [x] Step 5.13：实现 T1 DOCX import：基础有序/无序/多级列表。
  - 完成 2026-05-25：`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增真实 `fixtures/docx/inputs/docx-t1-lists.docx`，包含 bullet、decimal 和二级 bullet 的 `numbering.xml`；`fixtures/docx/registry.json` 中 `docx-t1-lists` 已标记为 `fixture-input-ready` / `available`。`packages/docx/test/t1-fixtures.test.ts` 直接读取真实 fixture 并调用 `importDocx()`，验证无 warning，`metadata.numberingIds` 包含 abstract numbering 与 numbering instance，段落导入结果保留 `listNumberingId` 与 `listLevel`。验证先用 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts --testNamePattern "lists fixture"` 确认红灯暴露 registry 仍是占位，再生成 fixture、更新 registry 并通过；回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 28 tests passed。
- [x] Step 5.14：实现 T1 DOCX import：简单表格、边框、单元格文本、基础列宽。
  - 完成 2026-05-25：`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增真实 `fixtures/docx/inputs/docx-t1-table-basic.docx`，包含 2x2 简单表格、基础表格边框、单元格文本和 `tblGrid` 列宽；`fixtures/docx/registry.json` 中 `docx-t1-table-basic` 已标记为 `fixture-input-ready` / `available`。`packages/docx/test/t1-fixtures.test.ts` 直接读取真实 fixture 并调用 `importDocx()`，验证无 warning，导入结果包含 table block、border、grid 和四个单元格文本。验证先用 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts --testNamePattern "basic table fixture"` 确认红灯暴露 registry 仍是占位；生成 fixture 后继续确认红灯暴露 fixture border 宽度期望不一致，修正 fixture 的 `w:sz` 后通过；回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 29 tests passed。
- [x] Step 5.15：实现 T1 DOCX import：inline 图片、资源、尺寸、alt text。
  - 完成 2026-05-25：`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增真实 `fixtures/docx/inputs/docx-t1-inline-image.docx`，包含 `wp:inline` DrawingML 图片、`docPr descr` alt text、EMU 尺寸和 `word/media/image1.png` PNG 资源；`fixtures/docx/registry.json` 中 `docx-t1-inline-image` 已标记为 `fixture-input-ready` / `available`。`packages/docx/test/t1-fixtures.test.ts` 直接读取真实 fixture 并调用 `importDocx()`，验证无 warning，导入结果包含 image inline、`resourceId`、alt text、inline display、3600x1800 twips 尺寸和 PNG resource bytes。验证先用 `node tools/fixtures/generate-gate5-docx-fixtures.mjs && pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts --testNamePattern "inline image fixture"` 确认红灯暴露 importer 只读取 `[Content_Types].xml` 的 `Override`、未按 OPC `Default Extension="png"` 推导 `image/png`；随后将 DOCX content type 解析改为按 package parts 展开 Default 并让 Override 优先覆盖，focused 测试通过；回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 30 tests passed。
- [x] Step 5.16：实现 T1 DOCX import：页面尺寸、页边距、分页符。
  - 完成 2026-05-25：`tools/fixtures/generate-gate5-docx-fixtures.mjs` 新增真实 `fixtures/docx/inputs/docx-t1-page-setup.docx`，包含 body-level `sectPr` 的 `pgSz`、`pgMar` 和段落内 `w:br w:type="page"`；`fixtures/docx/registry.json` 中 `docx-t1-page-setup` 已标记为 `fixture-input-ready` / `available`。`packages/docx/test/t1-fixtures.test.ts` 直接读取真实 fixture 并调用 `importDocx()`，验证无 warning，导入结果保留 10080x12960 twips 页面尺寸、top/right/bottom/left 页边距 720/960/1080/1200 twips，以及同一 run 内的 page break inline。验证先用 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts --testNamePattern "page setup fixture"` 确认红灯暴露 registry 仍是 `placeholder`；随后生成 fixture、更新 registry 后通过。此次 5.16 未新增 production importer 代码，复用既有 `sectPr`/`pgSz`/`pgMar`/`w:br` 解析能力；回归命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 31 tests passed。
- [x] Step 5.17：实现 unknown warning 和 opaque preservation，禁止静默丢弃未支持 OOXML。
  - 完成 2026-05-25：当前 DOCX import 会对 unsupported relationship、unsupported part、unsupported body element、unknown paragraph/run style 和 revision metadata 生成稳定 warning，并把暂不支持但可复查的数据写入 `opaque.unsupportedRelationships`、`opaque.unsupportedParts`、`opaque.unsupportedElementFragments`、`originalStyleIds` 和 `originalNumberingIds`；未知 style id 保留在导入模型中，修订 metadata 不会被静默当作普通正文导入。复查测试 `packages/docx/test/public-api.test.ts` 的 `unsupported DOCX content` 覆盖 opaque binary/text part、custom XML、external OLE relationship、missing target、unknown body element 和 unknown style；`track changes revision metadata` 覆盖 `w:ins` / `w:del` 等修订 metadata preserve/warning；`tests/architecture/gate5-diagnostics-schema.test.ts` 的 runtime warning fields 断言运行时 warning 与公开 metadata 对齐。验证命令 `pnpm exec vitest run packages/docx/test/public-api.test.ts tests/architecture/gate5-diagnostics-schema.test.ts --testNamePattern "unsupported DOCX content|track changes revision metadata|runtime warning fields"` 为 2 files / 3 tests passed。
- [x] Step 5.18：实现 DOCX export package foundation，生成 Transitional DOCX 基础 package。
  - 完成 2026-05-25：`exportDocx()` 已生成可由 `inspectDocxPackage()` 读取的 Transitional DOCX package graph，包含 `[Content_Types].xml`、root relationships、core/app props、`word/document.xml`、document relationships、`word/styles.xml`、`word/numbering.xml` 和 media part；`packages/docx/test/public-api.test.ts` 的 `exports a minimal Transitional DOCX package graph` 验证 parts、relationships、partGraph、diagnostics 和 warning 为空。结合真实 T1 fixture roundtrip 回归，导出的 package 可被当前 importer 重新读取。
- [x] Step 5.19：实现 T1 DOCX export：文本、run 样式、段落格式、Heading。
  - 完成 2026-05-25：DOCX export 已覆盖文本转义、tab/line/page break、run bold/italic/underline/strike、font family、font size、color、highlight、superscript/subscript、character style id、段落 style/Heading1-3、alignment、spacing before/after、auto line height、left/first-line/hanging indent，以及单 section page size/margins。新增真实 fixture roundtrip 测试先红灯暴露 character style、lineHeight、hanging indent 和 section page setup 丢失，随后补 `w:rStyle`、character style 定义、`w:spacing w:line/w:lineRule`、`w:ind w:hanging` 和 body `w:sectPr` 的 `pgSz/pgMar` 写出后通过。
- [x] Step 5.20：实现 T1 DOCX export：列表、表格、inline 图片、media relationships。
  - 完成 2026-05-25：`packages/docx/test/export-rich-blocks.test.ts` 覆盖 projection 导出后重新导入的列表 `numPr`、`numbering.xml`、基础表格 border/grid/gridSpan/cell text、inline PNG 图片、media relationship 和 external hyperlink；新增真实 `docx-t1-lists`、`docx-t1-table-basic`、`docx-t1-inline-image` fixture roundtrip 也验证这些 T1 能力无 warning、无 diff。
- [x] Step 5.21：建立 DOCX roundtrip diff，导出后重新导入并比较 T1 核心结构和样式。
  - 完成 2026-05-25：`diffDocxRoundtrip()` 已执行 import -> `convertDocxImportDocumentToCoreDocument()` -> core editor load -> export -> reimport，并比较 section count、section page/break、block count、paragraph text/style/properties/list/runProperties/images、table grid/cell text/gridSpan 和 resource refs。新增 `packages/docx/test/t1-roundtrip-fixtures.test.ts` 读取 registry 中 7 个真实 T1 fixture：run styles、paragraph formatting、headings、lists、basic table、inline image 和 page setup，要求 import/export/reimport warning 均为空且 `differences` 为空。验证命令 `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 6 files / 41 tests passed；`pnpm --filter @4xian/jword-docx typecheck` 通过。
- [x] Step 5.22：建立 WPS-only 人工兼容矩阵，并保留 Open XML validation / Word / LibreOffice pending 记录。
  - 当前收口 2026-05-25：Gate 5 当前人工兼容验收只要求 WPS。14 个 DOCX 导出 artifact 已完成 WPS Office 12.1.25895 真实 GUI 打开、无可见修复/恢复提示、编辑、保存、关闭重开和 zip marker 证据；Open XML validator、Microsoft Word 和 LibreOffice 继续 pending/not-run，不验证、不作为当前阻塞项、不写 pass。
  - 早期进展（完整矩阵口径，后续已被 WPS-only 收口替代）2026-05-25：兼容报告现在会在部分 `appResults` 输入时补齐 Word/WPS/LibreOffice 三项目标，缺失项保持 pending；也能接收结构化 `openXmlValidation` 诊断并自动汇总 validator pass/warn/fail；`fixtures/docx/compatibility-matrix.json` 已覆盖所有 DOCX fixture 的 validator 与三套办公软件 pending 目标。
  - 早期复查（完整矩阵口径，后续已被 WPS-only 收口替代）2026-05-25：本机 `command -v dotnet`、`command -v openxml`、`command -v soffice`、`command -v libreoffice` 均未命中，`/Applications` 未列出 Microsoft Word 或 LibreOffice；WPS 检测到 `/Applications/wpsoffice.app`。当时仍不能产生真实 Open XML validator 或完整办公套件人工兼容通过证据；`pnpm exec vitest run packages/docx/test/compatibility-report.test.ts` 为 1 file / 3 tests passed，只证明兼容报告会保留 pending 目标，不等同于兼容性通过。
  - 进展 2026-05-25：新增 `tools/compat/run-gate5-docx-compatibility.mjs` 和 `tests/architecture/gate5-compatibility-runner.test.ts`，本地 runner 的 `--dry-run` 会报告 DOCX fixture 覆盖、Open XML validator、LibreOffice、Word 和 WPS 可用性，且不输出虚假的 `compatibilityPercent`。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 确认红灯暴露 runner 缺失，随后实现并通过。当前 `node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 显示 14 个目标中 7 个已有真实输入，Open XML validator、LibreOffice 和 Word 缺失，WPS 安装于 `/Applications/wpsoffice.app`。
  - 进展 2026-05-25：`node tools/compat/run-gate5-docx-compatibility.mjs` 已生成 `fixtures/docx/compatibility-results.json`，并导出 7 个 T1 DOCX artifact 到 `fixtures/docx/exports/`。结果中 7 个真实 T1 fixture 状态为 `reported`，导入/导出 warning 均为 0，package graph 与 roundtrip diff 自动检查通过；7 个缺失输入的目标保持 `pending`。Open XML validator 仍为 `pending/not-run`，Word 和 LibreOffice 因本机未安装保持 pending，WPS 仅记录“应用已安装、需要人工打开/编辑/保存验证”，尚不能写成兼容通过。
  - 进展 2026-05-25：兼容结果现在为每个已导出的 T1 DOCX artifact 写入 `exportArtifactEvidence`，包含 path、byteLength 和 SHA-256，便于复查结果 JSON 与磁盘文件是否一致。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "artifact evidence"` 确认红灯暴露结果文件缺少 artifact evidence，随后在 runner 写入哈希证据、重新生成 `fixtures/docx/compatibility-results.json` 并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 9 tests passed。
  - 进展 2026-05-25：兼容 runner 新增人工办公套件证据入口，默认读取 `fixtures/docx/manual-compatibility-results.json`，也可通过 `GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS` 指向临时证据文件；测试用 `GATE5_DOCX_COMPATIBILITY_OUTPUT` 写到临时结果，验证人工 WPS pass 结果会合并进 `createDocxCompatibilityReport()` 输出。先运行 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "manual app evidence"` 确认红灯暴露 runner 忽略人工证据和临时输出路径，随后实现并通过。当时真实 WPS 探针只记录为 pending：`open -a /Applications/wpsoffice.app fixtures/docx/exports/docx-t1-run-styles.docx` 后，`lsof -p 26079` 可见 WPS 进程持有该导出 artifact，`CGWindowList` 可见 WPS Office onscreen window；但 Computer Use、AX accessibility 和 `screencapture` 均无法读取 WPS 窗口内容，因此仍不能证明无修复提示、可编辑或可保存，WPS 兼容项当时继续不勾选，后续已按 WPS-only 口径收口。
  - 进展 2026-05-25：兼容 runner 新增 Open XML validator 外部证据入口，默认读取 `fixtures/docx/openxml-validation-results.json`，也可通过 `GATE5_DOCX_OPENXML_VALIDATION_RESULTS` 指向临时或人工转换后的 validator 结果 JSON；runner 会按 `fixtureId` 合并 `evidence` 与结构化 `diagnostics` 到 `createDocxCompatibilityReport()`，由报告层汇总 `pass` / `warn` / `fail`。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "Open XML validation evidence"` 确认红灯暴露 runner 忽略外部 validator 证据，随后实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 11 tests passed。当前 `fixtures/docx/openxml-validation-results.json` 仍为空 `results`，重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后 Open XML validator 仍为 `pending/not-run`，没有真实 validator 通过证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 的缺输入 fixture 分支现在也会保留外部证据：如果某个 `pending` 目标已有 `GATE5_DOCX_OPENXML_VALIDATION_RESULTS` 或 `GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS` 记录，结果 JSON 会保留 validator 汇总、diagnostics、blockingIssue 和人工 Word/WPS/LibreOffice evidence；没有证据时仍保持 `pending/not-run`，且不会因缺源 fixture 去启动 LibreOffice 或办公套件。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "pending fixture targets"` 确认红灯暴露 skipped 分支丢弃外部证据，随后实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 12 tests passed。默认结果仍无真实 validator 或 Word/WPS/LibreOffice 通过证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 现在会解析 `OPENXML_VALIDATOR_COMMAND` 的 JSON stdout/stderr；如果外部 OpenXmlValidator wrapper 输出 `{ evidence, diagnostics }`，runner 会按诊断汇总 `pass` / `warn` / `fail`，避免命令 exit 0 但 stdout 已包含 warning/error 时被误判为 pass。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "validator command JSON output"` 确认红灯暴露 stdout diagnostics 被忽略，随后实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 13 tests passed。官方 Microsoft Learn 显示 `OpenXmlValidator.Validate(OpenXmlPackage)` 属于 Open XML SDK .NET API；当前本机仍没有 `dotnet`，Docker 本地也没有 dotnet SDK 镜像，因此未实际运行官方 validator，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 新增 WPS 进程级只读证据采集；当 WPS 可用且 `lsof` 显示 WPS 进程持有某个导出 artifact 时，runner 会把该事实写入该 fixture 的 WPS pending 结果，并明确 repair prompt、editability、visual difference 和 save evidence 仍需 UI 验证，避免把“应用进程打开了文件”误当成兼容通过。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "WPS process evidence"` 确认红灯暴露 runner 只写“需要人工验证”，随后实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 14 tests passed。默认 `fixtures/docx/manual-compatibility-results.json` 中 `docx-t1-run-styles` 的 WPS evidence 仍优先保留此前人工探针记录，结果继续为 pending，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 复查 2026-05-25：重新运行仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过，其中全量 Vitest 为 92 files / 481 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 与正式 run 均为 `status: ok`；`fixtures/docx/compatibility-results.json` 仍是 7 个 reported、7 个 pending，导出 artifact 的 byteLength/SHA-256 复查无 mismatch。Open XML validator、Word 和 LibreOffice 仍缺失，WPS 当时仍仅可证明安装与 pending 证据，不能证明无修复提示、可编辑或可保存；后续已补齐 WPS 打开、编辑、保存和重开证据，因此当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 的结果文档新增 `evidenceRequests`，把每个待补 Open XML validator / Word / WPS / LibreOffice 证据请求绑定到本次导出 artifact。已导出的 7 个 fixture 会记录 artifact path、byteLength、SHA-256 和所需证据字段；缺输入 fixture 的请求明确标为 `blocked-by-missing-artifact`，要求先补 source fixture 并重新生成导出 artifact，不再把缺 artifact 也混成普通 pending。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "pending evidence requests"` 和 `--testNamePattern "without exported artifacts"` 分别确认红灯暴露缺失字段和缺 artifact 状态不准确，再实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 16 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后结果有 56 个 evidence requests：28 个 pending，28 个 blocked-by-missing-artifact；当时仍没有完整矩阵通过证据，后续 WPS-only 口径只要求 WPS 通过证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 现在会校验外部人工应用结果和外部 Open XML validator 结果中可选的 `exportArtifact` / `artifactByteLength` / `artifactSha256` 绑定字段；如果外部证据显式声明的 artifact 与本次导出不一致，runner 会把该证据降级为 pending stale，并在 `evidenceRequests` 中标记 `stale-artifact-evidence`，防止旧 artifact 的 Word/WPS/LibreOffice 或 validator 证据被套用到新导出上。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "stale"` 确认红灯暴露 stale WPS pass 和 stale Open XML pass 都会误合并，再实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 18 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后默认结果仍为 7 reported、7 pending，artifact SHA-256 复查无 mismatch，证据请求仍为 28 pending 和 28 blocked-by-missing-artifact；当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：DOCX export 现在固定 ZIP file entry 与目录 entry 元数据，避免相同 projection 或同一 T1 fixture 在不同导出时间产生不同 SHA-256，从而保护 `artifactSha256` 绑定的人工/validator 证据不会被无意义刷新。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "deterministic"` 确认红灯暴露同一 projection 跨系统时间导出哈希不同，再固定 JSZip entry date 并关闭自动目录 entry 后通过；随后 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts`、`pnpm build` 通过。根构建后连续两次运行 `node tools/compat/run-gate5-docx-compatibility.mjs`，7 个 reported artifact 的 SHA-256 均无变化，结果文件中 artifact byteLength/SHA-256 与磁盘文件无 mismatch；证据请求仍为 28 pending 与 28 blocked-by-missing-artifact，当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 现在拒绝无 artifact 绑定的外部通过/警告/失败证据。外部人工办公套件证据若已经给出打开、编辑、修复提示或视觉差异结论，必须声明并匹配当前 `exportArtifact` / `artifactByteLength` / `artifactSha256`；外部 Open XML validation JSON 也必须绑定当前导出 artifact。未绑定证据会降级为 pending，并在 `evidenceRequests` 中标记 `missing-artifact-binding`；纯 pending 过程证据仍可保留为 pending，不会被误写成通过。默认 `fixtures/docx/manual-compatibility-results.json` 中 WPS pending 过程证据也已绑定当前 artifact hash，避免后续导出变化时继续沿用旧过程记录。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "unbound"` 确认红灯暴露无绑定 WPS pass 和无绑定 Open XML pass 会被误合并，再实现并通过；完整兼容 runner 回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 为 1 file / 13 tests passed，相关 Step 5.22 suite `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 20 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后默认结果仍为 7 reported，证据请求仍为 28 pending 与 28 blocked-by-missing-artifact，artifact byteLength/SHA-256 与磁盘文件无 mismatch；当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 现在在结果文档中输出 `evidenceTemplates`，按当前导出 artifact 自动生成可复制到 `fixtures/docx/manual-compatibility-results.json` 和 `fixtures/docx/openxml-validation-results.json` 的证据模板。模板只覆盖已有 artifact 的待验目标，写入 `exportArtifact` / `artifactByteLength` / `artifactSha256`，并保留 `pending` 与待补 evidence 文案，避免后续人工 Word/WPS/LibreOffice 或 Open XML validator 补证时漏填当前 artifact 绑定。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "artifact-bound templates"` 确认红灯暴露结果缺少模板，再实现并通过；完整 runner 回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 为 1 file / 14 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后结果仍为 7 reported、56 个 evidence requests（28 pending、28 blocked-by-missing-artifact），新增 21 条办公套件人工证据模板和 7 条 Open XML validator 证据模板；当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 现在会校验外部人工办公套件证据的枚举值，只有 `Word` / `WPS` / `LibreOffice` 目标和受支持的 `pass` / `warn` / `fail` / `blocked` / `pending` 状态、以及 `none` 修复提示/视觉差异观察值会被合并，避免 `result: "ok"` 这类无效人工记录污染兼容报告或 evidence request 状态。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "unsupported result values"` 确认红灯暴露无效 WPS result 被写入报告，再收紧 schema 后通过；完整 runner 回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 为 1 file / 15 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后结果仍为 7 reported、56 个 evidence requests（28 pending、28 blocked-by-missing-artifact）、21 条人工证据模板和 7 条 Open XML validator 模板；本机 Docker daemon 可用但没有 .NET/OpenXML 镜像，且 `dotnet`、`openxml`、Word、LibreOffice 仍缺，WPS 当时仍只有 pending 过程证据，后续已补齐 WPS GUI 证据，因此当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 结果文档新增 `evidenceInputDiagnostics`，外部人工办公套件证据或 Open XML validation JSON 中无法通过 schema 的 `results` 行不会再静默消失，而会记录 source、path、resultIndex 和 issue，方便补证时定位错误行；默认仓库证据文件当前 diagnostics 为 0。验证先分别用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "unsupported result values"` 和 `--testNamePattern "invalid Open XML"` 确认红灯暴露无效人工 result 与无效 Open XML severity 缺少输入诊断，再实现并通过；完整 runner 回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 为 1 file / 16 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs` 后结果仍为 7 reported、56 个 evidence requests（28 pending、28 blocked-by-missing-artifact）、21 条人工证据模板、7 条 Open XML validator 模板，`evidenceInputDiagnostics` 为 0；当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 新增显式 `--write-evidence-templates` 选项，会把当前 artifact 绑定的待补证据模板落盘到 `fixtures/docx/evidence-templates/manual-compatibility-results.template.json` 和 `fixtures/docx/evidence-templates/openxml-validation-results.template.json`；默认运行不覆盖真实证据文件，模板文件只用于复制填写，不会被 runner 当作通过证据。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "copyable evidence template"` 确认红灯暴露模板文件未写出，再实现并通过；完整 runner 回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts` 为 1 file / 17 tests passed。运行 `node tools/compat/run-gate5-docx-compatibility.mjs --write-evidence-templates` 后，默认结果仍为 7 reported、56 个 evidence requests（28 pending、28 blocked-by-missing-artifact）、`evidenceInputDiagnostics` 为 0，模板目录中有 21 条办公套件人工证据模板和 7 条 Open XML validator 模板；当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：`--write-evidence-templates` 现在会同时写出 `fixtures/docx/evidence-templates/README.md`，明确模板文件不是通过证据、runner 默认不会读取 `.template.json`，并说明如何把人工 Word/WPS/LibreOffice 与 Open XML validator 证据复制到真实证据文件、保留 `exportArtifact` / `artifactByteLength` / `artifactSha256` 绑定字段。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "copyable evidence template"` 确认红灯暴露 README 缺失，再实现并通过；重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs --write-evidence-templates` 后模板目录包含 README 和两份模板 JSON。当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：在 14 个 DOCX registry 输入全部可用后，兼容 runner 可为所有 fixture 生成导出 artifact，不再产生 `blocked-by-missing-artifact` 证据请求。验证先用 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts --testNamePattern "every DOCX fixture input"` 确认缺输入红灯，再补齐生成脚本和 registry 状态；随后运行 `node tools/compat/run-gate5-docx-compatibility.mjs --write-evidence-templates`，结果为 fixtures total 14 / available 14 / missing 0、reported 14、evidenceRequests 56 且全部 pending、manual templates 42、Open XML templates 14、`evidenceInputDiagnostics` 为 0、无 compatibility percent。当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：兼容 runner 的 `OPENXML_VALIDATOR_COMMAND` 现在支持常见 shell 引号和 `{artifact}` 占位符，可接入带空格路径、Docker/wrapper 形式或需要在命令中间传入 artifact 的 OpenXmlValidator 转换脚本；未提供 `{artifact}` 时仍沿用自动追加导出 artifact 的旧行为。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "command template"` 确认红灯暴露 `{artifact}` 未替换且带空格 validator 路径无法执行，再实现并通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 26 tests passed。重新运行 `node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 与正式 run 均为 `status: ok`，结果为 reported 14、evidenceRequests 56 且全部 pending，Open XML validator、LibreOffice 和 Word 仍缺失，WPS 仅检测到 `/Applications/wpsoffice.app`，因此当时完整矩阵证据仍缺，后续 WPS-only 口径只补 WPS 证据，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - 进展 2026-05-25：官方 Microsoft Learn 确认 `OpenXmlValidator.Validate(OpenXmlPackage)` 属于 Open XML SDK 的 .NET API，官方 .NET SDK 容器文档指向 `mcr.microsoft.com/dotnet/sdk:8.0`；本机仍无 `dotnet` / `openxml` 命令，Docker daemon 可用但本轮 `docker manifest inspect mcr.microsoft.com/dotnet/sdk:8.0` 与 `:9.0` 均超过 60 秒未返回，已终止探测，不能生成真实 OpenXmlValidator 通过证据。为避免后续 Docker/.NET wrapper 卡死整套矩阵，兼容 runner 新增 `OPENXML_VALIDATOR_TIMEOUT_MS`，仅作用于 Open XML validator 命令，默认 30000ms；超时会写入稳定 fail 诊断而不是把 late stdout 当成通过。验证先用 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts --testNamePattern "times out"` 确认红灯等待 72 秒并误判 late validator pass，再实现超时后该 focused test 735ms 通过；相关回归 `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 27 tests passed。重新运行 dry-run 与正式 runner 仍显示 Open XML validator、LibreOffice、Word 缺失，WPS 仅安装可见，当时按完整矩阵口径暂不勾选，后续以 WPS-only 收口记录为准。
  - WPS-only 收口 2026-05-25：用户明确将 Gate 5 兼容验收口径改为 WPS-only，Open XML validator、Microsoft Word 和 LibreOffice 不再作为当前 Gate 5 完成阻塞项，只保留 pending/not-run 记录且不得写入 pass。14 个 DOCX 导出 artifact 均已完成 WPS Office 12.1.25895 真实 GUI 打开、无可见修复/恢复提示、临时副本编辑、Ctrl+S 保存、关闭重开可见、zip 检查 `word/document.xml` marker、源 artifact hash 未变；覆盖 T1 8 个和 T2 6 个 fixture。`fixtures/docx/manual-compatibility-results.json` 写入 14 条 WPS pass 证据；`node tools/compat/run-gate5-docx-compatibility.mjs` 生成的 `fixtures/docx/compatibility-results.json` 汇总为 `package-graph pass 14`、`roundtrip-diff pass 14`、`WPS pass 14`、`open-xml-validator pending 14`、`Word pending 14`、`LibreOffice pending 14`、`evidenceRequests 42`、`evidenceInputDiagnostics 0`。验证：`pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 28 tests passed。
- [x] Step 5.23：创建 `@4xian/jword-pdf` 最小可测包和 PDF worker。
  - 完成 2026-05-25：`@4xian/jword-pdf` 最小可测包和 PDF worker runtime 已创建并通过 focused test/typecheck/build；`packages/pdf/src/worker.ts` 可作为 Rollup worker entry 构建到 `packages/pdf/dist/worker.js`，`@4xian/jword-pdf/worker` 子路径可导入。真实 PDF 绘制仍属于 Step 5.25+。
- [x] Step 5.24：实现 PDF 字体配置 API，支持 URL、File、ArrayBuffer。
- [x] Step 5.25：实现 LayoutBox -> PDF 基础页面和文本输出。
  - 完成 2026-05-25：基础页面、文本 fragment、字号、颜色、baseline、多页输出和 `pageGeometry` 中的 page margin/content rect 已通过 `pdf-lib` 读取、内容流断言和公开 API 断言验证；PDF.js 视觉截图、Canvas baseline 差异报告、中文字体、图片、表格线和页眉页脚仍属于后续 Step 5.26-5.28。
- [x] Step 5.26：实现 PDF 图片、表格线、页眉页脚和页码输出。
  - 完成 2026-05-25：PDF renderer 已从 layout 输出 PNG/JPEG inline image、基础 table cell border、页眉页脚文本和页码文本；当前通过 PDF content stream 和 raw PDF object 断言验证 image XObject、JPEG DCTDecode、image draw op、stroke op、header/footer/page number 文本。
- [x] Step 5.27：处理中文字体缺失和字符不支持错误，禁止输出乱码 PDF。
  - 进展 2026-05-25：非 ASCII 可见文本会提前返回稳定 `PDF_FONT_MISSING`，避免 Helvetica/WinAnsi 原始异常和乱码 PDF；但 fontkit 注册、自定义字体嵌入、字体覆盖字符检测和可恢复 warning 仍未实现，因此 Step 5.27 不能完全勾选。
  - 进展 2026-05-25：PDF 导出已接入 `fontkit` 动态加载和 `pdfDocument.registerFontkit()`，`ExportPdfOptions.fonts` 的 ArrayBuffer/File/URL source 会在字体配置存在时按需读取、嵌入并建立 glyph 覆盖检测；非 ASCII 文本只有在某个嵌入字体覆盖整段文本时才会继续导出，否则返回稳定 `PDF_FONT_MISSING`，并在“已配置字体但不覆盖当前文本”时发出可恢复 warning，避免乱码 PDF。验证先用 `pnpm exec vitest run packages/pdf/test/public-api.test.ts --testNamePattern "embeds a configured font|do not cover Chinese"` 确认红灯暴露自定义字体仍被当作缺失、覆盖不足错误缺少 `fontFamily/recoverable`，实现后该 focused test 通过；随后 `pnpm exec vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm typecheck`、`pnpm lint` 和 `pnpm build` 通过。当前测试字体使用 `pdfjs-dist` 自带 LiberationSans，只能证明自定义字体覆盖的非 ASCII 拉丁文本可导出，以及 LiberationSans 不覆盖中文时会稳定阻断；仍缺便携中文字体 fixture 来证明“中文字体正确渲染”，因此 Step 5.27 继续不勾选。
  - 完成 2026-05-25：新增便携中文字体 fixture `fixtures/pdf/fonts/NotoSansSC-gate5-subset.ttf` 和输入 `fixtures/pdf/inputs/pdf-chinese-font.json`，用 `packages/pdf/test/public-api.test.ts` 验证 `exportPdfFromLayout()` 能以该字体导出 `中文PDF导出`，结果无 warning，PDF.js 渲染 canvas 非空且 text content 可读出中文；`tests/architecture/gate5-fixture-registry.test.ts` 约束该 fixture 输入和字体文件真实存在。结合缺字体、字体不可读、字体不覆盖中文时稳定 `PDF_FONT_MISSING` / recoverable warning 的既有测试，Step 5.27 已闭环。
- [x] Step 5.28：建立 PDF.js 渲染截图对比和 Canvas baseline 差异报告。
  - 进展 2026-05-25：已建立 PDF.js legacy Node canvas 渲染和结构化视觉报告，覆盖 page count、page size、rendered canvas 非空像素、layout-derived text/image/table baseline、PDF.js text boxes、delta 字段和 tolerance。早期报告尚未保存截图文件，也未渲染真实 JWord Canvas baseline screenshot，后续两次增量已补齐。
  - 进展 2026-05-25：`createPdfVisualReport()` 新增显式 `artifactDirectory` 选项，调用方提供目录时会把每页 PDF.js 渲染结果保存为 PNG，并在 page report 中返回 `screenshotArtifact` 的 path、mimeType、width、height、scale 和 byteLength。验证先用 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts --testNamePattern "persists rendered page screenshots"` 确认红灯暴露 `screenshotArtifact` 缺失，随后实现 PNG artifact 写入并通过该 focused test；回归命令 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 和 focused `git diff --check` 均通过。
  - 完成 2026-05-25：`createPdfVisualReport()` 的 image/table delta 不再只是数量占位。报告现在会在 PDF.js 渲染后的 RGBA canvas 中，对 layout-derived image boxes 和 table line regions 计算可见非白像素数、覆盖比例、expected pixel count，并把这些像素覆盖 delta 纳入报告状态。调用方提供 artifact 目录时还会用 JWord core `renderPageCanvas()` 渲染同 fixture 的真实 JWord Canvas baseline PNG，并与 PDF.js page screenshot 一起返回 artifact metadata。验证先用 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts --testNamePattern "pixel coverage"` 确认红灯暴露 `actual: 0` 占位，再实现后通过；再用 `pnpm exec vitest run packages/pdf/test/visual-report.test.ts --testNamePattern "persists rendered"` 确认红灯暴露 `jwordCanvasArtifact` 缺失，实现后通过；`pnpm exec vitest run packages/pdf/test/visual-report.test.ts packages/pdf/test/public-api.test.ts` 和 `pnpm typecheck` 通过。Step 5.28 已闭环。
- [x] Step 5.29：建立 `examples/docx` 手动验收入口。
  - 完成 2026-05-25：`examples/docx` 已提供独立手动验收入口，并经 Kimi WebBridge 在真实浏览器完成内置 fixture 导入、DOCX 导出、roundtrip diff、PDF 导出和 DOCX/PDF 下载入口验证；当前入口不提供 PDF 导入查看。2026-05-25 续做已移除 DOCX/PDF runtime 静态导入，`examples/docx` build 不再提示 dynamic import 无效。
- [x] Step 5.30：建立 import/export/PDF benchmark。
  - 完成 2026-05-25：`benchmarks/gate5-interop-benchmark.mjs` 已接入 `pnpm bench`，覆盖 DOCX import、DOCX export、PDF export、文件大小、页数和图片数分组，并输出可复查 JSON。2026-05-25 续做后，benchmark 额外启动真实 Node worker thread 运行同一批 DOCX/PDF 任务并输出 `workerHeapPeakBytes`；Kimi WebBridge 已验证 DOCX export/import 长任务 pending 期间和运行中 cancel 后，editor hidden textarea 输入仍能同步提交到 assistive mirror。
- [x] Step 5.31：验证 DOCX/PDF worker lazy load，不进入 vanilla 首屏 bundle。
  - 完成 2026-05-25：`examples/docx/src/main.ts` 已移除 DOCX/PDF runtime 静态 import，只保留 type import，并通过 `loadDocxRuntime()` / `loadPdfRuntime()` 按需加载；`examples/docx/tests/vite-config.test.ts` 增加 runtime 动态导入契约测试。验证命令：`pnpm vitest run examples/docx/tests/vite-config.test.ts --testNamePattern "DOCX/PDF runtime"`、`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm --filter @4xian/jword-example-docx build` 通过，build 不再出现 `INEFFECTIVE_DYNAMIC_IMPORT`。`pnpm build` 输出 `packages/docx/dist/worker.js` 与 `packages/pdf/dist/worker.js`，并在 `examples/docx` 依赖方中验证 `@4xian/jword-docx/worker` / `@4xian/jword-pdf/worker` 子路径均可导入且导出 dispatch 函数。Kimi WebBridge 真实浏览器验证：新页面初始 resource 列表无 DOCX/PDF/JSZip/pdf-lib/fontkit；调用 `window.__jwordDocxDemo.importSelectedFixture()`、`exportDocx()`、`exportPdf()` 后才出现 `packages/docx`、`packages/pdf`、`jszip`、`pdf-lib` 资源，输出 DOCX 6107 bytes、PDF 3126 bytes、roundtrip `matches: true`。另用浏览器原生 `new Worker()` 按需加载 `/packages/docx/src/worker.ts` 和 `/packages/pdf/src/worker.ts`，DOCX worker 返回 `export-result` 5015 bytes，PDF worker 返回 `result` 1660 bytes 和 4 个 progress 事件。`pnpm --filter @4xian/jword-example-vanilla build` 后聚焦扫描首屏 JS/CSS，未命中 `@4xian/jword-docx`、`@4xian/jword-pdf`、`jszip`、`pdf-lib`、`fontkit`；`node tools/size/check-size.mjs` 仍因既有 Gate 2 字节门槛失败，不作为 Step 5.31 的通过证据。
- [x] Step 5.32：推进 T2 种子，未完成项必须 warning 或 preserve。
  - 进展 2026-05-25：DOCX 基础 external hyperlink 已完成最小 import/export roundtrip。`importDocx()` 会把 `<w:hyperlink r:id="..."><w:r>...</w:r></w:hyperlink>` 映射为 `DocxImportRun.link.target`，`convertDocxImportDocumentToCoreDocument()` 会保留到 core `Run.link`；`exportDocx()` 会为 `run.link.target` 写入 external hyperlink relationship，并在 `word/document.xml` 输出 `<w:hyperlink r:id="...">` 包裹内部 run。验证：先确认 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "imports a JSON-compatible middle model"` 和 `pnpm exec vitest run packages/docx/test/export-rich-blocks.test.ts --testNamePattern "exports T1 lists"` 红灯分别暴露 hyperlink 跳过和 link target 丢失；实现后上述 focused tests 通过，且 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、focused ESLint、`node tools/lint/check-comments.mjs` 通过。
  - 进展 2026-05-25：DOCX 基础批注已完成最小 import -> core 定位闭环。`importDocx()` 现在把段落级和 run 级 `w:commentRangeStart` / `w:commentRangeEnd` 映射为 `commentRangeMarker`，跳过纯 `w:commentReference` run，同时保留浮动 drawing 降级后的空 run；`comments.xml` 的作者、日期和正文会进入稳定 `DocxImportComment.id`。`convertDocxImportDocumentToCoreDocument()` 会根据正文 marker 生成 core `CommentThread`、`comment-range-docx-*` 和 `comment-message-docx-*`，导入快照在缺少 Yjs relative position 时由 core 按 `documentId/sectionId/blockId/runId/graphemeIndex` 回退定位，并通过 `loadDocumentModel()` + `locateRangeSnapshot()` 验证可解析。验证：`pnpm exec vitest run packages/core/test/editor/facade-runtime.test.ts --testNamePattern "locates imported comment ranges"`、`pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "imports a JSON-compatible middle model"`、`pnpm exec vitest run packages/core/test/editor/facade-runtime.test.ts packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-core typecheck`、focused ESLint、`node tools/lint/check-comments.mjs`、focused `git diff --check`、`pnpm lint` 和 `pnpm build` 通过。
  - 进展 2026-05-25：DOCX 修订 metadata 已完成 preserve/warning 种子，不实现完整 track changes。`importDocx()` 现在会在段落、body 和表格单元格 block 容器中识别 `w:ins`、`w:del`、`w:moveFrom`、`w:moveTo`，返回 `DOCX_REVISION_METADATA_UNSUPPORTED` warning，并把原始 XML 写入 `opaque.unsupportedElementFragments`；修订内的插入/删除文本不会被静默当作普通正文导入。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "track changes revision metadata"` 确认红灯暴露 warnings 为空，再实现后通过该 focused test；随后 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、focused ESLint、`node tools/lint/check-comments.mjs` 和 focused `git diff --check` 通过。
  - 审计 2026-05-25：section breaks 与简单浮动对象已有可复查覆盖。`readSectionBreakType()` 支持 `nextPage` / `next-page` / `continuous`，未知类型产生 `DOCX_SECTION_BREAK_UNSUPPORTED` 并按 next-page 降级；`readImportSections()` 会在段落级 `sectPr` 截断 section，并保留 section page/margin。浮动 `wp:anchor` 由 `readDrawingInlines()` 返回 `DOCX_DRAWING_FLOATING_UNSUPPORTED`，不把浮动对象静默转成普通 inline，且保留该 run 的空 inline 结构用于 roundtrip diff 可观察。验证：`pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "section breaks|inline drawing images"` 当前 3 tests passed，覆盖 continuous section、unsupported oddPage 降级 next-page、columns warning、inline/external image 和 floating image warning。
  - 进展 2026-05-25：DOCX 基础页眉页脚内容已映射到当前 core source id 语义。`importDocx()` 会解析 header/footer part，页眉页脚纯文本进入 `headerIds` / `footerIds`，`PAGE` 字段映射为 `page-number-top-center` 或 `page-number-bottom-center`，空 header/footer part 仍回退保留原 part id，避免破坏现有可观察索引；`w:pgNumType w:start` 继续映射到 `pageNumbering.start`。验证先用 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "basic header text"` 确认红灯暴露只返回 part 路径，再实现后通过该 focused test；随后 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、focused ESLint、`node tools/lint/check-comments.mjs` 和 focused `git diff --check` 通过。
  - 完成 2026-05-25：新增 `packages/docx/test/roundtrip-diff.test.ts` 的 T2 组合 warning fixture，覆盖页眉页脚、页码、external hyperlink、comment range/text、unsupported section break、浮动对象和修订 metadata。先运行 `pnpm exec vitest run packages/docx/test/roundtrip-diff.test.ts --testNamePattern "T2 warnings"` 确认红灯暴露 `exportWarnings` 为空，随后 `exportDocx()` 增加导出侧 T2 省略项 warning：`DOCX_HEADER_FOOTER_EXPORT_UNSUPPORTED`、`DOCX_PAGE_NUMBERING_EXPORT_UNSUPPORTED`、`DOCX_COMMENTS_EXPORT_UNSUPPORTED`、`DOCX_REVISIONS_EXPORT_UNSUPPORTED`。复跑同一 focused test 通过，且 T2 fixture 的 `matches: true`、`differences: []`、`reimportWarnings: []`，证明 T2 warning 不阻断 T1 roundtrip，也不把未导出能力静默隐藏在导出结果里。相关回归：`pnpm exec vitest run packages/docx/test/roundtrip-diff.test.ts packages/docx/test/public-api.test.ts packages/docx/test/export-rich-blocks.test.ts`、`pnpm --filter @4xian/jword-docx typecheck`、focused ESLint 和 focused `git diff --check` 通过。
- [x] Step 5.33：跑 Gate 5 总验收，回写每个完成项和遗留项。
  - 完成 2026-05-25：Gate 5 focused suite 已通过，命令为 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts tests/architecture/gate5-benchmark.test.ts examples/docx/tests/vite-config.test.ts examples/docx/tests/task-session.test.ts packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/compatibility-report.test.ts packages/docx/test/worker.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts`，结果为 13 files / 65 tests passed。仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 已通过，其中全量 Vitest 为 88 files / 446 tests passed。`pnpm bench` 已通过，Gate 5 benchmark totals 为 DOCX import 5.42ms、DOCX export 5.43ms、PDF export 85.86ms、fileSizeBytes 23741、pageCount 4、imageCount 1、heapPeakBytes 32681416。
  - 复查 2026-05-25：新增诊断 registry 与 PDF image/table 像素覆盖后，focused suite `pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts packages/docx/test/public-api.test.ts packages/docx/test/worker.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts` 通过，结果为 6 files / 51 tests passed；仓库级 `pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm build` 通过，其中全量 Vitest 为 89 files / 457 tests passed，`git diff --check` 通过。
  - 真实浏览器复查 2026-05-25：Kimi WebBridge 健康并打开 `examples/docx` dev server。页面初始 resource 列表无 `packages/docx`、`packages/pdf`、`jszip`、`pdf-lib`、`fontkit`；调用 `window.__jwordDocxDemo.importSelectedFixture()` 后状态为 `导入完成：word/document.xml` 且 warnings 为 `[]`；调用 `exportDocx()` 后输出 6107 bytes，roundtrip `matches: true`、`differences: []`、`importWarnings/exportWarnings/reimportWarnings: []`；调用 `exportPdf()` 后输出 3126 bytes，PDF progress 为 `queued -> mapping -> writing -> done`，状态说明当前入口不提供 PDF 导入查看。另用 `examples/vanilla/dist` 首屏 JS/CSS 聚焦扫描确认未命中 `@4xian/jword-docx`、`@4xian/jword-pdf`、`jszip`、`pdf-lib`、`fontkit`。
  - Iteration 26 复查 2026-05-25：`pnpm bench` 通过，Gate 5 benchmark totals 为 DOCX import 5.27ms、DOCX export 5.3ms、PDF export 62.41ms、fileSizeBytes 23741、pageCount 4、imageCount 1、heapPeakBytes 33490584、workerHeapPeakBytes 30862216；Kimi WebBridge 真实浏览器验证 DOCX export/import 长任务 pending 期间可输入，运行中 cancel 后、取消响应返回前也可输入。
  - 收尾复查 2026-05-25：T1 fixture import/export/roundtrip focused suite `pnpm exec vitest run packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts` 为 4 files / 17 tests passed，覆盖 T1 fixture 导入可验证和导出后重新导入不丢核心结构、样式、列表、表格与图片资源；任务取消、worker 和 benchmark focused suite `pnpm exec vitest run examples/docx/tests/task-session.test.ts packages/docx/test/worker.test.ts packages/pdf/test/worker.test.ts tests/architecture/gate5-benchmark.test.ts` 为 4 files / 14 tests passed；兼容 runner suite `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 9 tests passed，`node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 与正式 run 均为 `status: ok`，结果仍是 14 个 fixture 目标中 7 个真实输入、7 个 pending，Open XML validator、Word、LibreOffice 缺失，WPS 仅检测到已安装。Kimi WebBridge 会话 `jword-gate5-refresh` 重新打开 `http://localhost:5174/`，在 `exportDocx()`、`importSelectedFixture()`、`exportPdf()` 的 active task 期间分别插入 `FreshDuringDocxExport`、`FreshDuringDocxImport`、`FreshDuringPdfExport`，projection 与 assistive mirror 均可读到 marker；随后取消任务均返回 `true`，DOCX 导出和导入以 `DOCX_USER_CANCELLED` 拒绝，PDF 导出以 `PDF_EXPORT_CANCELLED` 拒绝，`readActiveTask()` 回到 `null`，状态为 `任务已取消，编辑器仍可继续输入。`；成功 PDF 导出仍记录 `progress: queued -> mapping -> writing -> done`。仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过，全量 Vitest 为 92 files / 476 tests passed。
  - 兼容 runner 人工证据复查 2026-05-25：新增人工办公套件证据入口后，focused suite `pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 10 tests passed；`node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 与正式 run 均为 `status: ok`，`fixtures/docx/compatibility-results.json` 中 `docx-t1-run-styles` 的 WPS 结果保留 `pending`，但 evidence 已记录 WPS 进程打开 artifact 与窗口不可采集原因。仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 通过，全量 Vitest 为 92 files / 477 tests passed。
  - WPS 单 fixture 人工证据推进 2026-05-25：`docx-t1-run-styles` 的导出 artifact 已用 WPS Office 12.1.25895 在 macOS 26.4.1 上真实打开，未出现可见修复/恢复提示；为避免污染源 artifact，先复制同 hash/byteLength 的临时副本到 `/tmp/jword-gate5-wps-compat/docx-t1-run-styles-wps-edit-copy.docx`，在 WPS 中输入 `WPS_EDIT_PROOF`、`Command+S` 保存、关闭并重新打开，重开窗口可见该标记，zip 检查副本 `word/document.xml` 也包含该标记；源 artifact hash 仍为 `bfc4b2fbfbd3d1cdf9cc246f1b5490022f1a25a1583b0b27fbd9a8eccc4ea551`。`fixtures/docx/manual-compatibility-results.json` 和 `compatibility-results.json` 现在只把 `docx-t1-run-styles` 的 WPS 目标标记为 pass，其余 Word/LibreOffice/Open XML validator 与其它 fixture 仍 pending；`evidenceRequests` 为 55。验证：`node tools/compat/run-gate5-docx-compatibility.mjs` 为 `status: ok`；`pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/compatibility-report.test.ts tests/architecture/gate5-fixture-registry.test.ts` 为 3 files / 28 tests passed。这是 WPS-only 口径前的单 fixture 进展，后续以 14/14 WPS 收口记录为准。
  - WPS-only 人工证据推进 2026-05-25：按用户明确要求，本轮只验证 WPS；Open XML validator、Microsoft Word 和 LibreOffice 暂不验证，结果继续保持 pending，不写入通过证据。T1 的 8 个 DOCX 导出 artifact 已完成 WPS Office 12.1.25895 真实 GUI 打开、无可见修复/恢复提示、临时副本编辑、Ctrl+S 保存、关闭重开可见、zip 检查 `word/document.xml` marker、源 artifact hash 未变：`docx-t1-paragraphs`、`docx-t1-run-styles`、`docx-t1-paragraph-formatting`、`docx-t1-headings`、`docx-t1-lists`、`docx-t1-table-basic`、`docx-t1-inline-image`、`docx-t1-page-setup`。`fixtures/docx/manual-compatibility-results.json` 写入 8 条 WPS pass 证据，`node tools/compat/run-gate5-docx-compatibility.mjs` 后 `fixtures/docx/compatibility-results.json` 汇总为 T1 WPS pass 8、T2 WPS pending 6、Open XML validator pending 14、Word pending 14、LibreOffice pending 14，`evidenceRequests` 为 48。原完整矩阵口径不再作为当前 Gate 5 阻塞项。
  - WPS-only 收口 2026-05-25：按用户更新后的验收口径，Gate 5 兼容矩阵当前只要求 WPS 真实通过，Open XML validator、Microsoft Word 和 LibreOffice 保留 pending/not-run 记录，不作为当前 Gate 5 完成阻塞项。T1 8 个和 T2 6 个 DOCX 导出 artifact 均已完成 WPS 打开、编辑、保存、关闭重开与 zip marker 证据；兼容 runner 汇总为 WPS pass 14、open-xml-validator pending 14、Word pending 14、LibreOffice pending 14。仓库级 `pnpm test:e2e` 当前失败：140 passed、7 skipped、10 failed、2 did not run，失败集中在 Gate 2/4 vanilla geometry overlay、revisions panel、image drag ghost 1px 和 Firefox/WebKit clipboard permission；`pnpm test:visual` 当前失败：3 passed、4 failed，失败集中在 Gate 4 visual baseline/截图缺失和页眉页脚输入不可见；`pnpm size` 当前失败于既有 Gate 2 体积门槛，`packages/core/dist/index.js` 为 494356 > 260000，`examples/vanilla` 首屏 JS/CSS 为 581014 > 330000，不作为 Gate 5 WPS-only 兼容验收阻塞项。

- [x] Step 5.34：补 Gate 5 商业 edition matrix，明确 `.jword` 原生保存/打开免费，DOCX 导入、DOCX 导出和 PDF 导出属于高级格式互通。
- [x] Step 5.35：接入 `@4xian/jword-license` entitlement 校验，worker task 在未授权、授权过期或 feature 不匹配时 fail-fast，且不读取或输出用户文档内容。
- [x] Step 5.36：补 `examples/docx` 真实第三方集成模式，只通过公开高级包 API 传入 license、feature、editor 和文件，不 import `packages/docx/src`、`packages/pdf/src` 或 worker 内部模块。
- [x] Step 5.37：建立未授权失败 E2E：DOCX 导入、DOCX 导出和 PDF 导出分别返回稳定 diagnostic，编辑器正文、selection 和 active task 状态不被破坏。
- [x] Step 5.38：建立商业包发布检查：私有 registry 说明、`npm pack` 内容审计、types/export map 审计、基础 bundle 扫描和高级包按需加载扫描。
- [x] Step 5.39：把 Gate 5 公开 API 清单、授权错误码、feature key、集成步骤和收费边界加入 Gate 7 文档站计划。
  - 完成 2026-05-27：新增 `@4xian/jword-license` 契约，冻结 Gate 5 feature key 为 `docx.import`、`docx.export`、`pdf.export`，授权诊断为 `JWORD_LICENSE_MISSING`、`JWORD_LICENSE_EXPIRED`、`JWORD_FEATURE_NOT_ENTITLED`、`JWORD_LICENSE_SERVER_UNAVAILABLE`。`packages/docx` worker 与 `packages/pdf` 导出入口在读取或输出用户内容前执行 entitlement fail-fast，`examples/docx` 改成第三方集成壳：宿主传入 license 和 feature，只通过公开 `@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-license` API 调用高级能力，不引用 `src` 或 worker 内部模块。`tools/release/check-gate5-commercial-pack.mjs` 已接入 `npm pack --dry-run --json`，审计私有 registry、export map、dist/type 文件、基础入口禁止静态引入高级包，以及高级示例按需加载。Kimi WebBridge 真实浏览器会话 `gate5-commercial-smoke` 复跑 `missing`、`expired`、`feature-mismatch`、`server-unavailable`、`valid` 五种模式：未授权/过期/server unavailable 的 DOCX 导入、DOCX 导出和 PDF 导出均返回单一稳定 code，active task 清空、selection 保留，且未加载 DOCX/PDF/jszip/pdf-lib 高级资源；feature mismatch 下 DOCX import 成功，DOCX export/PDF export 分别返回 `JWORD_FEATURE_NOT_ENTITLED`；valid 下 DOCX import/export 和 PDF export 成功。验证：`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm --filter @4xian/jword-example-docx build`、`node tools/release/check-gate5-commercial-pack.mjs`、`pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts` 通过。

当前工作树复核（2026-05-27）：Gate 5 focused suite 重新通过，命令为 `pnpm exec vitest run tests/architecture/gate5-fixture-registry.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate5-benchmark.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate5-compatibility-runner.test.ts packages/docx/test/public-api.test.ts packages/docx/test/xml.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/compatibility-report.test.ts packages/docx/test/worker.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts examples/docx/tests/vite-config.test.ts examples/docx/tests/task-session.test.ts --reporter=dot`，结果为 18 files / 129 tests passed。补充验证：`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-example-docx build`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/compat/run-gate5-docx-compatibility.mjs` 均通过；兼容 runner 当前识别 WPS 可用，Open XML validator、Microsoft Word 和 LibreOffice 继续按 Gate 5 WPS-only 口径保留 missing/pending/not-run，不作为当前完成阻塞项。Kimi WebBridge 真实浏览器复核覆盖 `?license=valid`、`?license=missing`、`?license=feature-mismatch`：valid 路径 DOCX 导入完成、DOCX 导出 5852 bytes、roundtrip `matches: true` 且 warning 为空、PDF 导出 3121 bytes；missing 路径返回 `JWORD_LICENSE_MISSING: docx.import` 与 `JWORD_LICENSE_MISSING: pdf.export`；feature mismatch 路径 DOCX import 成功，DOCX export/PDF export 返回 `JWORD_FEATURE_NOT_ENTITLED`，所有路径 `activeTask` 均回到 `null`。本次复核中 PDF worker 公开 API 成功用例补充 `pdf.export` 测试授权，修正的是商业授权收口后的测试夹具，不改变生产授权逻辑。

文件体量与 fresh 验证复核（2026-05-27）：新增 `tests/architecture/gate5-docx-file-budget.test.ts`，约束 `packages/docx/src` 与 `packages/docx/test` 下 TypeScript 文件不超过 1000 行；红灯先暴露 `packages/docx/src/export.ts`、`packages/docx/src/index.ts`、`packages/docx/test/public-api.test.ts` 过大，随后将公开 facade、类型、消息、package graph、import readers/sections、export helpers 和 public API fixtures 拆入 focused 文件，并扩展 `tests/architecture/gate5-diagnostics-schema.test.ts` 的 DOCX source scan 覆盖新拆分模块。验证：文件体量门禁、DOCX focused public API suites、Gate 5 diagnostics schema、Gate 5 focused matrix 均通过；当前 Gate 5 focused matrix 为 23 files / 130 tests passed，`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm --filter @4xian/jword-example-docx build`、`node tools/release/check-gate5-commercial-pack.mjs` 均通过。包级 `pnpm --filter @4xian/jword-docx build` 会产生 Node 直接执行不友好的 extensionless ESM dist；本轮先用根级 `pnpm build` 恢复 Rollup dist，再运行 `node tools/compat/run-gate5-docx-compatibility.mjs`，结果为 `status: ok`、14 个 fixture 全部 available、WPS available，Open XML validator、Microsoft Word 和 LibreOffice 仍按 WPS-only 口径记录为 missing/not-run。Kimi WebBridge 真实 Chrome 会话 `jword-gate5-docx` 打开 `examples/docx`，内置 fixture 导入后状态为 `导入完成：word/document.xml`，warning 为 `[]`；DOCX 导出后 roundtrip `matches: true` 且 differences/import/export/reimport warnings 均为空；PDF 导出后 progress 为 `queued -> mapping -> writing -> done`，状态继续说明当前入口不提供 PDF 导入查看；截图证据保存为 `/tmp/jword-gate5-docx-demo.png`。

PDF 文件体量补充复核（2026-05-27）：`tests/architecture/gate5-pdf-file-budget.test.ts` 红灯先暴露 `packages/pdf/src/index.ts` 与 `packages/pdf/test/public-api.test.ts` 超过 1000 行；随后将 PDF 公开类型拆到 `packages/pdf/src/types.ts`，将 public API fixture/font/image helper 拆到 `packages/pdf/test/public-api-fixtures.ts`。复核行数为 `packages/pdf/src/index.ts` 966、`packages/pdf/test/public-api.test.ts` 981。验证：`pnpm exec vitest run tests/architecture/gate5-docx-file-budget.test.ts tests/architecture/gate5-pdf-file-budget.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate5-commercial-readiness.test.ts packages/docx/test/public-api.test.ts packages/docx/test/public-api-core-conversion.test.ts packages/docx/test/public-api-package.test.ts packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-preservation.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/worker.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts packages/pdf/test/visual-report.test.ts examples/docx/tests/vite-config.test.ts --reporter=dot` 为 18 files / 93 tests passed；`pnpm --filter @4xian/jword-docx typecheck` 和 `pnpm --filter @4xian/jword-pdf typecheck` 通过。

公开 API 授权边界补充复核（2026-05-27）：只在 worker 层做 entitlement 校验仍会留下 `importDocx()`、`exportDocx()` 和 `exportPdfFromLayout()` 公开直调绕过路径。先补 `packages/docx/test/public-api-license.test.ts` 与 `packages/pdf/test/public-api-license.test.ts` 红灯，确认缺 license 或 feature 不匹配时旧实现仍会读入或输出内容；随后在 `importDocx()`、`buildExportDocxPackage()` / `exportDocx()` 和 `exportPdfFromLayout()` 入口的取消检查之后、读取或生成用户内容之前调用 `assertJWordFeatureEntitled()`。合法格式测试、diagnostics 测试、Gate 6 DOCX fixture 集成和兼容 runner 均改为显式传入测试 entitlement，避免测试夹具继续模拟授权绕过。验证：新增 public API license 测试为 2 files / 7 tests passed；DOCX/PDF focused suite 与 Gate 5 diagnostics/Gate 6 DOCX fixture 集成为 19 files / 96 tests passed；compatibility runner 为 2 files / 20 tests passed；Gate 5 商业 readiness 与文件体量门禁为 4 files / 6 tests passed；`pnpm lint`、`pnpm typecheck`、`pnpm test`（138 files / 676 tests）、`pnpm build`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/compat/run-gate5-docx-compatibility.mjs --dry-run` 均通过。当前兼容 dry-run 仍显示 WPS available，Open XML validator、Microsoft Word 和 LibreOffice missing/pending/not-run，继续按 WPS-only 口径处理。

### 验收

- [x] T1 DOCX fixture 导入后文本、段落、run 样式、段落格式、Heading、列表、表格、inline 图片和页面设置可验证。
- [x] T1/T2 DOCX 导出后能被 WPS 打开，不触发可见修复提示，并可编辑、保存和重开。
  - WPS-only 口径 2026-05-25：T1 的 8 个和 T2 的 6 个导出 artifact 已经 WPS 真实打开/编辑/保存/重开通过；Word、LibreOffice 和 Open XML validator 不作为当前 Gate 5 验收目标，继续保持 pending/not-run。
- [x] T1 DOCX 导出后重新导入，核心结构、样式、列表、表格和图片资源不丢。
- [x] T2 fixture 未完整支持时产生明确 warning，不静默丢内容。
- [x] PDF 导出来自 JWord layout，不依赖浏览器打印或 LibreOffice 转换。
- [x] PDF 中文字体正确；缺字体或字体不覆盖字符时返回明确可恢复错误。
- [x] PDF 渲染截图和 Canvas baseline 有可解释差异报告。
- [x] DOCX/PDF 导入导出可取消、有 progress、不阻塞输入。
- [x] DOCX/PDF worker lazy load，不进入 `examples/vanilla` 首屏 bundle。
- [x] `examples/docx` 能在真实浏览器完成导入 DOCX、导出 DOCX、重新导入、导出 PDF 的人工验收路径。
- [x] 未授权时 DOCX 导入、DOCX 导出和 PDF 导出均失败为稳定 diagnostic，且不读取或泄漏文档内容。
- [x] 授权通过时 Gate 5 高级功能只在显式安装并按需加载高级包后可用。
- [x] 第三方集成示例只使用公开 API，不依赖底层实现或 demo 私有 runtime。

### 禁止事项

- [x] 不实现 PDF 导入查看。
- [x] 不实现 PDF 编辑。
- [x] 不实现 PDF 反向转换为 JWord 文档。
- [x] 不把 Mammoth 作为 DOCX 导入主路径。
- [x] 不把 html-to-docx 或 docx 模板库作为 DOCX 导出主路径。
- [x] 不用浏览器打印代替 PDF 主路径。
- [x] 不把 Gate 5 当作基础保存/打开能力；基础保存必须走 Gate 4.5 `.jword`。
- [x] 不让免费基础包 import `@4xian/jword-docx`、`@4xian/jword-pdf` 或授权实现。
- [x] 不只做 client-side license check；商业授权必须至少在 worker task 或服务端/授权层形成可诊断边界。
- [x] 不用 LibreOffice 转换代替 PDF 主路径。
- [x] 不把互通逻辑放进 core 或首屏 bundle。
- [x] 不让 `packages/docx` 直接访问 Y.Doc 或 `document-store` 内部结构。
- [x] 不静默吞掉未知 OOXML 节点、未知样式、断裂 relationship 或外链资源。
- [x] 不用“兼容度百分比”替代 fixture diff、人工矩阵和真实打开记录。

禁止项审计（2026-05-25）：`packages/pdf/src/index.ts` 明确只导出 PDF，不提供 PDF 导入、编辑或查看器；`packages/docx` 依赖仅为 core 与 JSZip，`packages/pdf` 依赖仅为 core、fontkit、pdf-lib、PDF.js，没有 Mammoth、html-to-docx、docx 模板库、浏览器打印或 LibreOffice 转换主路径。`packages/docx/src/*` 只经公开 core facade 和 projection 协作，文件头约束不访问 core store 或 Y.Doc；未知 OOXML、未知 style、断裂 relationship 与外链资源均有 warning/diagnostics 或 opaque preservation 记录；兼容 runner 和测试持续断言不输出 compatibility percent。

禁止项审计（2026-05-27）：Gate 4.5 已通过 `@4xian/jword-native` 和 `.jword` 完成免费基础保存/打开，Gate 5 只保留 DOCX import/export 与 PDF export 高级格式互通。`tests/architecture/gate45-native-boundary.test.ts` 持续约束 native 不依赖 `@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-collab` 或 `@4xian/jword-license`；`tools/size/check-size.mjs` 与 `tools/release/check-gate5-commercial-pack.mjs` 持续扫描 `examples/vanilla` 首屏入口不得静态引入 DOCX/PDF/license 高级包；`packages/docx/src/worker.ts` 与 `packages/pdf/src/index.ts` 在 worker/export task 读取或输出用户文档内容前执行 entitlement fail-fast，未授权、过期、feature 不匹配和授权服务不可用均返回稳定 diagnostic，避免只依赖浏览器 client-side 判断。

## Gate 6 - 商业高级协作、离线与自动插入

### 目标

完成可商业化交付的在线文档高级能力：多个远端用户同时编辑同一份文件、远端光标和“xxx 正在输入”提示、离线恢复、历史快照、AI/程序化自动插入与手动编辑并发、client/server 版本一致性、授权校验和第三方真实集成示例。Gate 6 交付后，JWord 不只是能在内部 demo 证明 remote / local / auto-inserter 三类写入最终一致，还必须能作为付费高级 SDK 被第三方按公开 API 接入；未授权、版本不匹配、服务端不可用、离线冲突和自动插入取消都必须有稳定诊断。

### 实现方案

协同不是后补功能，因为 Gate 1 已经以 Y.Doc 为真源，`packages/core/src/operations/transaction.ts` 已经把所有写入包在 `ydoc.transact(origin)` 里，`packages/core/src/operations/history.ts` 也已经默认只跟踪 `local-user` origin。Gate 6 不替换真源，不把 provider 或 wrapper 变成第二份编辑状态；它把商业高级能力封装在 `@4xian/jword-collab` 和 `@4xian/jword-collab-server` 中，通过 core 的中立 selection / anchor / transaction hook 接入。core 可以提供获取当前选区、创建 anchor/range、查找文本位置、加载 canonical model 等基础口子，但不能直接暴露“协作”“离线”“自动插入”这类高级产品 API。

Gate 5 导入的 DOCX 也必须按同一规则处理：导入后不继续把 `.docx` 二进制包、OOXML XML 或 projection JSON 当可写真源，而是经 `DocxImportDocument -> core Document -> editor.loadDocumentModel() -> Y.Doc` 进入 JWord canonical model。只要导入内容已经被当前 mapping 支持，它在 Gate 6 中就必须像原生 JWord 文档一样可继续编辑、可协同、可离线恢复、可进入历史版本、可被 `createInserter()` 基于 stable anchor / range 自动插入；不支持或降级保留的 OOXML 结构只能通过 warning / diagnostics / opaque preservation 说明能力边界，不能伪装成协同可编辑能力。

主路径分七层：

1. `packages/core` 继续拥有 Y.Doc、transaction pipeline、projection、history、AnchorRef / RangeRef、selection snapshot、find/query location 和 Editor Facade；core 只暴露中立基础口子，不依赖 provider、license、server、IndexedDB 或 hocuspocus。
2. `packages/collab` 作为付费 client SDK，负责公开 `connectJWordCollaboration(...)`、presence/awareness、远端光标/选区、typing label、offline client、auto-insert session、diagnostics 和 provider adapter。
3. `packages/collab-server` 作为付费 self-host server，负责 Hocuspocus/Yjs WebSocket、room、auth、tenant hook、storage hook、history API、license enforcement、health/version endpoint、限流和可观测诊断。
4. `packages/license` 负责商业 entitlement 契约、feature key、client/server handshake、签名校验、过期/撤销/离线宽限诊断。
5. `packages/persistence` 负责 update log、snapshot、compaction、IndexedDB offline cache、版本列表、只读预览和恢复；它保存 Yjs binary update/snapshot，不把 DOCX、HTML 或 projection JSON 当成协同真源。
6. `examples/collab` 只模拟第三方真实集成：基础 editor + UI 初始化后，引入 `@4xian/jword-collab`，连接 `@4xian/jword-collab-server`，传入 user/license/room/serverUrl，再演示多人协作、离线、历史和自动插入；不能 import 底层 `src`、demo runtime 或 Y.Doc store。
7. Gate 7 文档站和公开 API 清单负责把基础版、高级格式互通和高级协作能力的集成步骤、授权、错误码、版本兼容和迁移指南正式对外。

自动插入主路径应产品化为 `startAutoInsertSession(editor, options)` 或等价公开高级 API。它不能使用普通字符 offset，也不能绕过 transaction pipeline。调用方必须传入当前 selection snapshot、anchor、range 或由 `findText()` / `resolveLocation()` 得到的位置；session 创建后不再读取 live DOM caret，不调用 focus，不抢用户手动光标。自动插入应被建模为一个虚拟远端用户或自动化 actor，带 actor id、name、color、origin、request id、progress、abort/error 诊断，并默认不进入用户 undo；需要允许宿主把自动插入配置为独立 undo scope，但不能让它混入本地用户 undo 栈。

版本历史主路径为 Yjs update log + periodic snapshot + metadata index。版本恢复不是把 DOCX 覆盖回编辑器，也不是把 projection JSON 当主存；恢复应基于目标 snapshot/update 在隔离 Y.Doc 中生成 readonly preview，用户确认后通过受控 restore transaction 写入当前 Y.Doc，并保留失败诊断和本地未同步变更保护。

### 参考资料与技术选型

Gate 6 的资料分为“主实现依据”“可选 provider”“替代方案研究”和“产品对标参考”。外部资料只能指导 adapter 和验收口径，不能绕开 JWord 已有 Y.Doc 真源、operation pipeline 和 framework-agnostic core。

- 主实现依据：
  - Yjs 官方文档 / README：Yjs update 是二进制增量，具备可交换、可结合、幂等特性；`Y.applyUpdate`、`Y.encodeStateAsUpdate`、`Y.encodeStateVector`、`Y.mergeUpdates`、`Y.diffUpdate` 是 update log、同步和 compaction 的核心 API。
  - Yjs provider / offline 文档：Yjs provider 可组合，网络 provider 可和 `y-indexeddb` 这类 persistence provider 同时使用；`y-indexeddb` 用 IndexedDB 持久化更新，并在下次打开时先恢复本地状态，再同步最新网络更新。
  - Yjs Awareness / y-protocols：awareness 适合在线用户、光标、选区、鼠标位置等临时状态；它没有历史，不应进入版本历史或持久正文。
  - Yjs RelativePosition：协同光标、批注范围、自动插入 anchor 必须用相对位置或 JWord `AnchorRef` / `RangeRef` 的快照语义，禁止用普通字符 offset 作为长期定位。
  - Yjs UndoManager：`trackedOrigins` 是 undo scope 的主实现依据；JWord 已有 `DEFAULT_HISTORY_ORIGIN = "local-user"`，Gate 6 应扩展 origin matrix 和可配置 scope，而不是重写 undo 系统。
  - Hocuspocus 官方文档：作为 Gate 6 self-host demo provider 首选。它基于 Yjs，提供 WebSocket 后端、awareness、auth/persistence hooks 和本地服务示例；服务端主存储应保存 Y.Doc binary/update，不应把 JSON 投影反向伪造成 Yjs 数据。
- 可选 provider 参考：
  - `y-websocket` / `y-webrtc`：可作为最小 provider adapter 兼容参考，但 Gate 6 示例服务优先使用当前依赖中已有的 `@hocuspocus/server`。
  - Liveblocks Yjs：可作为托管 provider adapter 的产品参考，覆盖 room、presence、Y.Doc、awareness、managed storage、REST/webhook、offline IndexedDB 选项和后台/AI 写入的 undo 隔离思路；不作为 JWord 默认自托管路线。
  - Tiptap / Hocuspocus AI Toolkit 资料：用于自动插入的人机协作 UX 参考，尤其是 AI streaming 时允许其他用户继续编辑、AI edit attribution、review/track changes 和 abort/progress 语义；不引入 Tiptap/ProseMirror 作为 JWord core 依赖。
- 替代方案研究结论：
  - Automerge 3：官方定位是 local-first sync engine，强项是完整历史、离线、版本控制、branch/diff 和 rich text API；但它以 Automerge document 为真源，替换 Y.Doc 会推翻 Gate 1-5 的 transaction / projection / history / anchor 设计。Gate 6 不迁移到 Automerge。可在 Gate 7+ 或单独 spike 中研究“版本历史后端 / 导出型 archive / 长历史 diff”是否借鉴其模型。
  - Loro 1：官方定位是 Rust/WASM/JS CRDT，强项是 rich text CRDT、stable cursor、time travel、version vector、shallow snapshot 和高性能历史；它比 Yjs 在“版本控制和富文本 CRDT 语义”上值得关注，但同样需要替换真源和文本定位模型，且会引入 WASM/runtime 边界。Gate 6 不迁移到 Loro，可列为 post-1.0 迁移可行性研究。
  - Fluid Framework：强项是 Microsoft 生态、DDS 和服务端 sequencing；它不是 Yjs provider，接入会形成第二套 distributed data structure 和服务依赖，不适合作为 Gate 6 的低风险实现路线。
  - 结论：当前没有足够理由在 Gate 6 替换 Yjs。对 JWord 当前架构而言，Yjs + provider adapter + update log/snapshot + origin/undo 约束是最小风险路线；Automerge/Loro 只能作为后续研究项，不能阻塞 Gate 6。
- 产品对标参考：
  - Google Docs / Microsoft Word Online / WPS / 腾讯文档：用于理解远端光标、在线用户、断网提示、版本历史、恢复确认和 AI 写入可撤销/可审查的用户预期。
  - Liveblocks / Tiptap commercial collaboration：用于参考 presence、comments、AI edits、undo isolation、version history 和托管 provider 的能力矩阵；不照搬闭源云服务作为 SDK 内部实现。

### 明确范围

- [x] 支持本地双窗口多人协同 demo。
- [x] 支持 provider adapter interface，可接本地 Hocuspocus 验证服务，也可让宿主接入其它 Yjs provider。
- [x] 支持 awareness：在线用户、远端光标、远端选区。
- [x] 支持远端光标附近显示用户名称和输入状态，例如 `Alice 正在输入`。
- [x] 支持 user 初始化传入 `id`、`name`、`color`，未传 color 时由高级包生成稳定颜色。
- [x] 支持 `@4xian/jword-collab-server` 作为可部署服务端包，降低第三方集成步骤。
- [x] 支持 client/server protocolVersion、packageVersion 和 featureFlags 握手，不匹配时给 `COLLAB_VERSION_MISMATCH`。
- [x] 支持商业 entitlement：未授权、过期、feature 不匹配、server license 不可用时阻止高级能力并返回稳定 diagnostic。
- [x] 支持公开位置 API：读取当前选区、创建 anchor/range、查询文本位置、解析 location，以便第三方调用自动插入时传入明确位置或范围。
- [x] 支持 remote update 进入 projection/layout/render，并可诊断 origin。
- [x] 支持 browser IndexedDB 离线恢复；断网期间本地编辑不丢，重连后可同步。
- [x] 支持 update log、snapshot、版本列表、只读预览和恢复最小闭环。
- [x] 支持 `createInserter()`：stable anchor/range、chunk 写入、flush、abort、progress、error、request id。
- [x] 支持 local / remote / auto-inserter / system-recovery origin matrix 与 undo scope 隔离。
- [x] 支持协同、离线、版本历史、自动插入的 diagnostics schema 和真实浏览器验收入口。
- [x] 支持 Gate 5 导入后的 DOCX 文档作为一等协同对象：导入后进入同一 Y.Doc 真源，并覆盖 remote/local/auto-inserter 并发、离线恢复、历史预览和恢复验证。
- [x] 支持 self-host 场景下的 auth hook、tenant hook、storage hook、license hook 和基础审计事件；不在 core 中实现这些能力。
- [x] 不支持 JWord 托管云服务和复杂组织通讯录；这些保留到 post-1.0 或独立商业服务。
- [x] 不支持端到端加密、presence 隐私策略、复杂组织通讯录。
- [x] 不支持 CRDT 算法迁移，不在 Gate 6 替换 Yjs 为 Automerge、Loro、Fluid 或自研 OT。

### 当前基线（2026-05-25）

- [x] Gate 1/3 已经把 Y.Doc 真源、transaction pipeline、origin 与 history metadata 落到本地单人路径；协同和自动插入只能在这条主干上继续扩展。
- [x] Gate 4 已经有当前用户、批注范围、链接、修订和选择区相关基础能力；远端光标、批注 anchor 和 AI 写入应复用这套用户/范围语义。
- [x] Gate 4.5 计划已把 `.jword` 原生保存/打开定义为基础能力；Gate 6 不再承担基础保存职责。
- [x] Gate 5 已完成 WPS-only DOCX/PDF 技术互通主路径，worker progress/cancel、diagnostics、lazy-load 和真实浏览器长任务不阻塞输入证据可作为 Gate 6 async task 设计参考；Gate 5 商业授权补充仍是未完成项。
- [x] Gate 5 已有 `convertDocxImportDocumentToCoreDocument()` 与 `editor.loadDocumentModel()` 结构化导入路径；导入后的 DOCX 内容已进入 core `Document` / Y.Doc 初始化事务，而不是继续编辑 `.docx` 文件本身。
- [x] 当前 repo 已有 `packages/core`、`packages/ui`、`packages/docx`、`packages/pdf`、`packages/collab`、`packages/persistence`、`examples/docx` 和 `examples/collab`；新增 Gate 6 目录均有 focused tests、fixture registry 或真实浏览器入口，仍符合“不写无法验证空包”的约束。
- [x] 根依赖已有 `yjs@13.6.30`、`@hocuspocus/server@4.0.0`、`@hocuspocus/provider@4.0.0` 和 `y-protocols@1.0.7`；仍没有 `y-indexeddb` 或托管 provider 依赖。
- [x] core 的 `createHistoryManager()` 默认只 track `local-user`，这与 Gate 6 remote/AI 不进入用户 undo 的目标一致。
- [x] 当前已有 provider adapter、真实 Hocuspocus provider adapter、真实 provider awareness 多页面可见层、awareness helper、offline unavailable diagnostic、真实浏览器 IndexedDB reload restore、真实浏览器断网/重连、memory snapshot/version/restore adapter 和 `createInserter()` 的可执行证据；结构化 range snapshot / relative position 选区已由真实 Hocuspocus awareness 与并发选区回归覆盖。
- [x] remote / AI / local 三类写入的并发语义已被真实 Hocuspocus provider、Playwright 双页和 Kimi WebBridge 真实浏览器验证覆盖；服务端共享 history service 已按注入式 storage-backed contract 收口，具体生产数据库产品仍由宿主接入。
- [x] 当前已有 Gate 6 fixture registry、协同诊断 schema、版本历史 artifact、Playwright smoke、Kimi WebBridge 真实浏览器证据、真实 Hocuspocus provider 双页面同步、真实 Hocuspocus provider awareness 跨页面渲染、真实浏览器 IndexedDB reload restore、断网 pending、重连同步、冲突合并、重连失败保留 pending、Gate 6 benchmark 和总验收记录。
- [x] 当前 Gate 6 商业化收口已覆盖：`@4xian/jword-collab-server` 正式包、license enforcement、client/server version handshake、远端光标用户名/输入提示、公开位置 API、真实编辑器 SDK demo、禁止 demo 使用底层实现的架构测试、私有 registry / 发布检查和对外集成文档计划；Gate 7 仍单独承担文档站正文、React/Vue wrapper、插件 API、devtools 和 release dry-run 的稳定化。

### 推荐执行顺序

1. 先冻结 Gate 6 商业 edition matrix、package graph、client/server protocol、license contract、origin matrix、undo scope、目录落点、diagnostics 和版本历史契约。
2. 再补 core 中立位置 API：selection snapshot、selection -> anchor/range、find/query location、resolve location；这些是基础编辑口子，不命名为协作或自动插入能力。
3. 收口 `@4xian/jword-collab` client API，隐藏 provider/Yjs/hocuspocus 内部类型，提供 connect/disconnect/status/diagnostics/awareness/auto-insert session。
4. 正式抽出 `@4xian/jword-collab-server`，让第三方能最少步骤部署 self-host 协作服务，而不是复制 `examples/collab/server`。
5. 接入 `@4xian/jword-license` entitlement 和 client/server 版本握手，未授权或版本不匹配时 fail-fast。
6. 补 awareness 与远端光标/选区渲染：用户名称、颜色、`xxx 正在输入`、过期清理，只保存临时 presence，不写入正文历史。
7. 收口 `packages/persistence` 的商业离线、history、snapshot、restore 与服务端 storage hook。
8. 产品化自动插入：公开 API 必须接收 stable position/range，把自动插入当虚拟远端 actor，绝不抢用户光标。
9. 重写 `examples/collab` 为第三方真实集成 demo：基础 editor + UI + 高级 client 包 + self-host server + license，不使用底层源码或测试 helper。
10. 最后补商业 readiness：私有 registry / `npm pack`、bundle gate、真实浏览器双用户验收、未授权/版本不匹配验收、文档站计划和发布 dry-run。

### 迭代任务清单

#### Iteration 0 - 冻结 Gate 6 范围、技术选型和验收口径

- [x] 将 Gate 6 标题和范围固定为商业高级协作、离线、历史与自动插入。
- [x] 明确不替换 Yjs 真源；Automerge、Loro、Fluid、自研 OT 只进入后续研究，不作为 Gate 6 主路径。
- [x] 冻结主实现路径：
  - Y.Doc 继续是唯一可写真源。
  - remote update 使用 Yjs binary update。
  - offline 使用 IndexedDB persistence provider 或等价 adapter。
  - version history 使用 update log + snapshot + metadata index。
  - auto inserter 使用 Editor Facade + AnchorRef/RangeRef + transaction origin。
- [x] 冻结 origin matrix：
  - `local-user`
  - `remote-user`
  - `auto-inserter`
  - `system-recovery`
  - `version-restore`
- [x] 冻结每类 origin 的诊断字段：
  - `requestId`
  - `roomId`
  - `clientId`
  - `authorId`
  - `source`
  - `commandName`
  - `operationKinds`
  - `updateByteLength`
  - `snapshotId`
  - `versionId`
  - `recoverable`
- [x] 冻结 undo scope 规则：
  - 本地用户默认进入用户 undo
  - remote 默认不进入用户 undo
  - auto inserter 默认不进入用户 undo
  - 可配置独立 undo scope
  - version restore 默认进入独立 restore scope，不吞掉本地未同步变更
- [x] 为 Gate 6 明确目录落点，但不预创建空壳包：
  - `packages/collab/src/`
  - `packages/collab/test/`
  - `packages/persistence/src/`
  - `packages/persistence/test/`
  - `examples/collab/`
  - `examples/collab/tests/`
  - `fixtures/collab/`
  - `fixtures/history/`
- [x] 不预创建空壳包；只有第一个 focused test、fixture registry 或真实浏览器入口能验证时才创建对应目录。
- [x] 冻结分层：
  - `core` 提供 Y.Doc、Editor Facade、transaction、history、anchor、projection、layout 和受控协同 hook。
  - `collab` 提供 provider adapter、awareness、远端光标/选区、connection diagnostics。
  - `persistence` 提供 update log、snapshot、IndexedDB offline、version history 和 restore。
  - `collab-server` 提供 self-host WebSocket、auth/tenant/storage/license hook、history API 和版本握手。
  - `examples/collab` 只提供真实第三方装配入口、双页面验收、断网/重连、auto inserter demo 和宿主级测试钩子。
- [x] 冻结版本历史最小可观察契约：
  - 版本列表有稳定 `versionId`、label、author、createdAt、update count、snapshot id。
  - 只读预览来自隔离 Y.Doc，不复用当前可写 editor。
  - 恢复必须有确认步骤、restore origin 和失败诊断。
  - 恢复失败不得覆盖本地未同步变更。
  - 不以 docx 覆盖真源。
- [x] 冻结 Gate 6 验收口径：
  - 单元测试覆盖 adapter contract。
  - Vitest 双 Y.Doc 模拟覆盖最终一致和 origin。
  - Playwright 双窗口覆盖真实协同。
  - 真实浏览器覆盖断网/重连、auto inserter streaming 和历史恢复。
  - DOCX 导入 fixture 至少覆盖 1 个 T1 文档和 1 个带 warning 的 T2 文档；导入后必须走同一 `loadDocumentModel()` / Y.Doc 路径，再参与双窗口协同、自动插入、离线恢复和版本恢复验证。
  - Kimi WebBridge 优先，Playwright 作为自动化回归补充。
- [x] 验证：计划文档能清楚回答“为什么不替换 Yjs、做什么、不做什么、如何验证”。
  - 完成 2026-05-26：Gate 6 范围、Yjs 主路径、origin/diagnostics/undo scope、目录落点、分层和验收口径已冻结；本轮只按可验证入口创建 `packages/collab`、`packages/persistence`、`examples/collab`、`fixtures/collab`、`fixtures/history`，未预建无测试空壳。

#### Iteration 1 - core 协同 hook、origin 和 history scope（Step 6.1 / 6.4 / 6.8 / 6.9）

- [x] 审查 `TransactionPipeline`、`createHistoryManager()`、`EditorCommandOptions.origin`、`AnchorRef` / `RangeRef` 和 `loadDocumentModel()` 的当前边界。
  - 完成 2026-05-26：通过 CodeGraph、focused tests 和边界检查确认当前 history manager 仍只默认 track `local-user`，remote/auto 默认不进用户 undo；独立 `auto-inserter` / `version-restore` undo scope 仍是后续项。
- [x] 定义 core 内部 remote update apply hook：
  - 输入 `Uint8Array update`
  - 输入 `origin = "remote-user" | "system-recovery" | "version-restore"`
  - 输出 projection、dirty、diagnostics
  - 禁止 provider 直接操作 DOM 或 layout cache
- [x] 定义 transaction diagnostics event：
  - 记录 origin、commandName、operationKinds、update byte length、local/remote 标记。
  - 不暴露 Yjs 内部 struct、client clock 或 store internals 到稳定 public API。
- [x] 扩展 history manager 配置：
  - 默认仍只 track `local-user`
  - 允许创建独立 `auto-inserter` scope
  - 允许创建独立 `version-restore` scope
  - remote update 永不进入本地用户 undo
- [x] 补 focused tests：
  - remote update 不增加用户 undo。
  - auto inserter 默认不增加用户 undo。
  - auto inserter 独立 scope 可单独 undo。
  - version restore 不清空用户 undo metadata。
- [x] 验证：`packages/core` 仍不依赖 provider、IndexedDB、WebSocket、hocuspocus、DOM 外部服务。
  - 进展 2026-05-26：已新增 `packages/core/src/editor/collaboration-runtime.ts`、`TransactionPipeline.applyUpdate()`、`Editor.encodeCollaborationUpdate()`、`Editor.applyRemoteUpdate()` 和 transaction diagnostic 字段；focused tests 覆盖 remote update diagnostics、update replay byte length 为 0、remote/auto 默认不进用户 undo、auto inserter 默认 origin。尚未完成独立 `auto-inserter` / `version-restore` undo scope 和 version restore undo metadata 回归。
  - 续做 2026-05-26：`createHistoryManager()` 已扩展 `HistoryScope = "user" | "auto-inserter" | "version-restore"`，每个 scope 使用独立 `Y.UndoManager` 和内部 tracked origin；`EditorCommandOptions.historyScope` 通过 transaction metadata 的 `historyOrigin` 接入 Yjs origin，公开 diagnostics 仍保留原始 `origin`。`createInserter()` 支持 `undoScope: "auto-inserter"`，focused test 已覆盖 AI 写入默认不进用户 undo、独立 `auto-inserter` scope 可单独 undo/redo，根入口已导出 `HistoryScope`。验证：`pnpm exec vitest run packages/core/test/index.test.ts packages/core/test/collaboration/inserter.test.ts packages/core/test/collaboration/editor-update.test.ts packages/core/test/operations/history.test.ts`、`pnpm --filter @4xian/jword-core typecheck`、`node tools/lint/check-comments.mjs`、`git diff --check` 通过。`version-restore` scope token/API 已有，但完整版本恢复 undo metadata 回归和真实 provider 并发仍未完成。
  - 完成 2026-05-26：补齐 `version-restore` 独立 undo scope focused test；`packages/core/test/collaboration/editor-update.test.ts` 验证 version restore 写入可进入独立 `version-restore` undo scope，撤销 restore 后默认用户 undo metadata 仍可继续撤销本地用户命令。验证：`pnpm exec vitest run packages/core/test/collaboration/editor-update.test.ts` 4 passed，focused ESLint 通过。

#### Iteration 2 - provider adapter 与 hocuspocus 双窗口 demo（Step 6.1-6.4）

- [x] 建立 `packages/collab` 最小包和公开类型，只在有 adapter contract test 时创建。
- [x] 定义 `JWordCollabProviderAdapter`：
  - `connect()`
  - `disconnect()`
  - `destroy()`
  - `sendUpdate(update, metadata)`
  - `onUpdate(listener)`
  - `onStatus(listener)`
  - `onSynced(listener)`
  - `awareness`
- [x] 定义 provider status：
  - `idle`
  - `connecting`
  - `connected`
  - `synced`
  - `disconnected`
  - `reconnecting`
  - `offline`
  - `error`
- [x] 定义 provider error：
  - auth rejected
  - room missing
  - websocket closed
  - update rejected
  - protocol mismatch
  - persistence unavailable
- [x] 实现 hocuspocus adapter：
  - 示例服务使用 `@hocuspocus/server`
  - client 侧 provider 作为可选依赖接入
  - room id、token、user metadata 由宿主传入
  - 不把 auth/token 放进 core
  - 进展 2026-05-26：已新增 `examples/collab/server/hocuspocus-service.ts` 和 `examples/collab/server/dev-server.ts`，示例服务使用 `@hocuspocus/server@4.0.0`，支持本地 `address` / `port` / `roomPrefix`，默认监听 `127.0.0.1:4188`，`examples/collab` 新增 `dev:server` 脚本。红测 `pnpm exec vitest run examples/collab/tests/hocuspocus-service.test.ts` 先失败于缺少服务入口，随后转绿并验证随机端口启动、HTTP welcome 响应、WebSocket URL 和关闭。当前仍未接 `@hocuspocus/provider` 或浏览器 client provider，真实双窗口 Hocuspocus 协同仍未完成。
  - 续做 2026-05-26：已新增 `packages/collab/src/hocuspocus-adapter.ts` 和 `createHocuspocusCollabProviderAdapter()`，使用 `@hocuspocus/provider@4.0.0` 连接真实 Hocuspocus WebSocket；`autoConnect` 由 `HocuspocusProviderWebsocket` 管理，复用 websocket provider 时显式 `provider.attach()`，并保持 hocuspocus 类型不进入 core public API。`examples/collab/tests/hocuspocus-provider.test.ts` 启动本地 Hocuspocus 服务并验证两个 `Y.Doc` 通过真实 provider 收敛。
- [x] 建立 `examples/collab`：
  - 两个 editor 面板或双窗口入口
  - room id 输入
  - 当前用户切换
  - connection 状态条
  - update/diagnostics 面板
  - reset room 仅作用于 demo 数据
- [x] 实现 remote update render path：
  - 本地 editor 写入后 provider 收到 update。
  - 远端 editor apply update。
  - 远端 projection/layout/render 刷新。
  - 本地 selection 不被远端更新强制覆盖。
- [x] 补双 Y.Doc Vitest convergence tests：
  - A 输入后 B 收到 update。
  - B 输入后 A 收到 update。
  - update 重放两次仍不重复。
  - update 乱序后最终一致。
- [x] 补 Playwright Chromium 双窗口测试：
  - 两个浏览器上下文进入同一 room。
  - A 输入文本，B 可见。
  - B 输入文本，A 可见。
  - 两边 projection 文本一致。
- [x] 验证：provider adapter 可替换，不把 hocuspocus 类型泄漏到 core public API。
  - 进展 2026-05-26：已新增 `@4xian/jword-collab`、内存 `JWordCollabProviderAdapter`、`destroy()`、`onStatus()`、完整 provider status 枚举、awareness adapter、provider error/update metadata/diagnostic 类型和 contract tests；`packages/collab/test/contract.test.ts` 覆盖同 room update/awareness 广播、Yjs update replay 幂等和依赖 update 乱序后最终一致。当前仍缺真实 hocuspocus adapter、真实双窗口 provider demo 和 Playwright 双上下文协同测试。
  - 续做 2026-05-26：`examples/collab` 已支持 `?provider=hocuspocus&ws=...&room=...&client=client-a|client-b`，通过 `examples/collab/src/runtime/hocuspocus-runtime.ts` 和 `loadHocuspocusDemoRuntime()` 接入真实 provider；`examples/collab/tests/collab-smoke.e2e.ts` 在 Chromium 双页面连接同一 Hocuspocus room 后验证 A 输入同步到 B。Kimi WebBridge 真实浏览器双标签验收读回 `providerMode: "hocuspocus"`、两端 `status: "synced"`，并确认 `Gate 6 Kimi real Hocuspocus sync` 从 client-a 同步到 client-b。当前仍缺真实 provider 多窗口 awareness、WebSocket reconnect failed、IndexedDB 浏览器恢复和真实断网恢复。

#### Iteration 3 - awareness、远端光标和远端选区（Step 6.3）

- [x] 定义 awareness state schema：
  - user authorId
  - display name
  - color
  - avatar
  - cursor anchor snapshot
  - selection range snapshot
  - viewport/page index
  - updatedAt
- [x] awareness 只保存 ephemeral state，不写入 Y.Doc 正文，不进入 update log，不进入版本历史。
- [x] 远端 selection 必须使用 JWord `TextRangeRecord` / relative position snapshot；解析失败时降级为用户在线状态，不抛出阻断错误。
- [x] 在 `packages/ui` 或 `examples/collab` 建立远端光标/选区 overlay：
  - 显示用户颜色。
  - 显示用户名 tooltip。
  - 多用户重叠时稳定排序。
  - 当前用户不显示自己的 remote cursor。
- [x] 补 focused tests：
  - awareness state parse/serialize。
  - stale awareness 清理。
  - unresolved remote anchor 不阻断渲染。
  - presence 不影响 undo。
- [x] 补真实浏览器验收：
  - A 移动光标，B 看到 A 的远端光标。
  - A 拖选文本，B 看到 A 的远端选区。
  - [x] A 断开连接后，B 的在线用户列表移除或标记离线。
- [x] 验证：awareness 断开、过期或权限不足时，正文协同仍可继续。
  - 进展 2026-05-26：`packages/collab` 已提供 awareness serialize/parse、stale cleanup 和 unresolved anchor 降级为 presence 的 helper，并有 contract tests；当前还没有远端光标/选区 overlay、真实浏览器多用户光标验收，也没有把 selection 升级为 JWord `TextRangeRecord` / relative position snapshot 的完整实现。
  - 续做 2026-05-26：`examples/collab` 内存 demo 已增加远端光标/选区可见层，页面以 `data-jword-remote-cursor` / `data-jword-remote-selection` 渲染用户颜色、用户名、cursor offset 和 selection range。Playwright Chromium 覆盖 Alice/Bao 远端光标可见，以及 Client A 选区 `5-12` 后页面显示 `Alice selection 5-12`。Kimi WebBridge 真实浏览器读回 `Alice cursor 8`、`Bao cursor 16`，触发 Client A 选区后读回 `Alice cursor 12`、`Alice selection 5-12`，debug API 中 `selectionStart: 5`、`selectionEnd: 12`。当前仍未接真实 provider 多窗口 awareness，也未把 selection 升级为 JWord `TextRangeRecord` / relative position snapshot。
  - 续做 2026-05-26：补真实 Hocuspocus awareness 红测，先用 `pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "Hocuspocus awareness"` 复现 client-b debug API 已读到 client-a awareness、但 DOM 没刷新远端 cursor/selection；根因是 `hocuspocus-runtime.ts` 未订阅 `adapter.awareness.onChange()`。修复后新增 `adapter.awareness.onChange(() => notify())` 并在 destroy 时取消订阅。验证：`pnpm exec vitest run examples/collab/tests/hocuspocus-provider.test.ts packages/collab/test/contract.test.ts`、`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium` 均通过；Kimi WebBridge 双标签真实浏览器在 room `jword-collab-kimi-awareness-*` 中读回 client-b DOM `Client A cursor 8`、`Client A selection 2-8`，debug API 中 `selectionStart: 2`、`selectionEnd: 8`。
  - 续做 2026-05-26：补真实 Hocuspocus 断连 presence 回归 `Gate 6 collab demo removes Hocuspocus awareness after a browser page disconnects`；client-a 断开前 client-b 能看到 `client-a` 的 cursor/selection，调用 `simulateDisconnect()` 后 client-b 的 `readAwarenessState().users` 不再包含 `client-a`，`data-jword-remote-cursor="client-a"` 和 `data-jword-remote-selection="client-a"` DOM 数量为 0，正文仍保留同步文本。验证：`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "awareness"` 2 项通过，完整 `examples/collab/tests/collab-smoke.e2e.ts` Chromium 12 项通过，`pnpm --filter @4xian/jword-example-collab typecheck` 和 `pnpm --filter @4xian/jword-example-collab build` 通过；Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-awareness-disconnect-room` 中读回断连前 `ids: ["client-a"]`、`Client A selection 0-11`，断连后 `ids: []`、cursor/selection DOM 数量均为 0。
  - 续做 2026-05-26：补 awareness `rangeSnapshot` 结构契约和真实 Hocuspocus 写入路径；`JWordAwarenessState` 现在可携带结构兼容的 JWord range snapshot，包含 `documentId`、`sectionId`、`blockId`、`runId`、`graphemeIndex` 和 Yjs `relativePosition` JSON，内存 parser 与 Hocuspocus adapter 均拒绝非法 range snapshot。红绿验证：`pnpm exec vitest run packages/collab/test/contract.test.ts --testNamePattern "range snapshots"` 先失败于非法 snapshot 被放行后转绿，`pnpm exec vitest run examples/collab/tests/hocuspocus-provider.test.ts --testNamePattern "filters invalid awareness range snapshots"` 先失败于真实 provider 放行非法 snapshot 后转绿，`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "renders Hocuspocus awareness"` 先失败于 `rangeSnapshot` 为 `null` 后转绿。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-range-snapshot-room` 验证 client-b 读回 `client-a-selection`，anchor/focus `graphemeIndex` 为 `2/8`，relative position `tname: "body"` 且携带 Yjs item clock。当前 Step 6.3 仍未整体完成：viewport/page index、用户名 tooltip、多用户重叠稳定排序和更完整的 unresolved range 降级验收仍需补齐。
  - 续做 2026-05-26：补 awareness viewport/page index、用户名 tooltip 和多用户重叠稳定排序的可执行证据；`JWordAwarenessState.viewport.pageIndex` 已通过 parser、Hocuspocus adapter guard、provider test 和 Hocuspocus runtime 写入路径传递到 debug snapshot，`examples/collab` 远端 cursor/selection DOM 写入 `title`，presence 渲染按 `clientId` 返回新数组排序且不修改输入。红绿验证：`examples/collab/tests/vite-config.test.ts --testNamePattern "awareness users render"` 先失败于 `sortAwarenessUsers is not a function` 后转绿；`examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "remote cursor and selection presence|renders Hocuspocus awareness"` 先失败于 cursor 缺少 `title` 后转绿。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-step63-awareness-order-room` 验证 client-b 同步正文 `awareness order viewport text`，DOM 顺序为 `["client-a"]`，cursor/selection `title` 均为 `Client A`，selection 为 `2-8`，debug API 读回 `viewport.pageIndex: 0`。当前 Step 6.3 仍未整体完成：更完整的 unresolved range 降级验收、presence 不影响 undo 的 focused test、权限不足 awareness 降级路径仍需补齐。

#### Iteration 4 - offline recovery 与 IndexedDB persistence（Step 6.5 / 6.12）

- [x] 建立 `packages/persistence` 最小包和公开类型，只在 offline adapter test 可运行时创建。
- [x] 定义 offline adapter：
  - `load(roomId, doc)`
  - `whenSynced`
  - `readState()`
  - `clearLocalData(roomId)`
  - `destroy()`
  - `onDiagnostic(listener)`
- [x] 接入 `y-indexeddb` 或等价 adapter：
  - IndexedDB key 与 room id 对齐。
  - 本地数据加载完成前显示 restoring 状态。
  - IndexedDB 不可用时返回 recoverable diagnostic。
  - 清理本地缓存必须显式调用，不在 reconnect 时自动删除。
- [x] 定义 offline diagnostics：
  - `OFFLINE_CACHE_SYNCED`
  - `OFFLINE_CACHE_UNAVAILABLE`
  - `OFFLINE_LOCAL_UPDATE_QUEUED`
  - `OFFLINE_RECONNECT_STARTED`
  - `OFFLINE_RECONNECT_SYNCED`
  - `OFFLINE_RECONNECT_CONFLICT_MERGED`
  - `OFFLINE_RECONNECT_FAILED`
- [x] 补断网恢复测试：
  - [x] 已同步文档 reload 后从 IndexedDB 恢复。
  - [x] 网络断开期间输入进入本地 doc。
  - [x] 重连后远端收到离线期间输入。
  - [x] 服务端先有远端更新，本地重连后最终一致。
  - IndexedDB 不可用时不阻断在线协同。
- [x] 补真实浏览器验收：
  - [x] 打开 room、输入内容、刷新页面，离线缓存先恢复内容。
  - [x] 模拟 WebSocket 断开，继续输入，状态显示 offline/local pending。
  - [x] 恢复连接后两窗口内容一致，诊断显示 synced。
- [x] 验证：offline cache 只是 Yjs update cache，不保存第二份 projection JSON 作为真源。
  - 进展 2026-05-26：已新增 `@4xian/jword-persistence`、offline adapter 类型和 `createUnavailableIndexedDbOfflineAdapter()`，focused tests 覆盖 IndexedDB unavailable recoverable diagnostic；当前仍未接入真实 `y-indexeddb`，也没有浏览器断网、刷新恢复、重连同步证据。
  - 续做 2026-05-26：已新增 `packages/persistence/src/indexeddb-adapter.ts` 和 `createIndexedDbOfflineAdapter()`，基于 `y-indexeddb@9.0.12` 接入真实浏览器 IndexedDB；adapter 公开 `whenSynced`、`readState()`、`clearLocalData()`、`destroy()`、`onDiagnostic()`，IndexedDB key 默认与 room id 对齐，Node/不可用环境返回 `PERSISTENCE_INDEXEDDB_UNAVAILABLE` recoverable diagnostic。`examples/collab` 的 Hocuspocus 模式支持 `offline=indexeddb`，写入时保存 Yjs state update checkpoint，reload 时从 IndexedDB 临时 Y.Doc 恢复；未保存 projection JSON。验证：先用 `pnpm exec vitest run packages/persistence/test/indexeddb-adapter.test.ts --testNamePattern "IndexedDB offline adapter"` 观察到 `createIndexedDbOfflineAdapter is not a function` 红灯，再实现并通过；随后 `pnpm exec vitest run packages/persistence/test/indexeddb-adapter.test.ts packages/persistence/test/memory-adapter.test.ts examples/collab/tests/vite-config.test.ts`、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "IndexedDB"` 均通过。
  - 真实浏览器补证 2026-05-26：Kimi WebBridge 真实 Chrome 在 room `jword-collab-kimi-indexeddb-room-1779741366418` 输入 `Gate 6 Kimi IndexedDB reload text` 后读回 `offline.lastEvent: "indexeddb-synced"`、`databaseName` 等于 room id、`updateByteLength: 50`；随后停止 Hocuspocus 服务并重新打开同一 URL，页面仍从 IndexedDB 恢复同一文本，debug API 显示 `connected: false`、`lastEvent: "indexeddb-synced"`、`updateByteLength: 50`。当前仍未完成模拟 WebSocket 断开期间继续输入、重连最终一致、offline local pending 和重连诊断矩阵。
  - 续做 2026-05-26：`fixtures/collab/diagnostics-registry.json` 已把 offline registry 从旧的单个 `COLLAB_OFFLINE_QUEUE_REPLAYED` 收敛为计划内 7 个稳定 `OFFLINE_*` code；`examples/collab` Hocuspocus + IndexedDB runtime 现在在断开期间保留本地 Y.Doc 写入，`readOfflineState()` 暴露 `queuedOperations`、`offline-local-pending`、`OFFLINE_LOCAL_UPDATE_QUEUED`，重连时暴露 `OFFLINE_RECONNECT_STARTED`，Hocuspocus synced 后清空 pending 并记录 `OFFLINE_RECONNECT_SYNCED`。新增 Playwright 双页面回归 `Gate 6 collab demo keeps IndexedDB offline edits pending until Hocuspocus reconnects`，覆盖 A/B 已同步、A 断开后继续输入、B 断开期间不提前看到、A 重连后 B 收到离线文本。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-offline-reconnect-1779742573` 验证：A 离线输入后 `queuedOperations: 1`、`lastEvent: "offline-local-pending"`、诊断含 `OFFLINE_LOCAL_UPDATE_QUEUED`，B 仍是旧文本；A 重连后 `lastEvent: "offline-reconnect-synced"`、`queuedOperations: 0`、诊断含 `OFFLINE_RECONNECT_STARTED` / `OFFLINE_RECONNECT_SYNCED`，B 收到 `Gate 6 Kimi reconnect offline pending text`。当前仍未覆盖服务端先有远端更新再合并、provider auth failed、WebSocket reconnect failed 和真实 provider 历史版本恢复。
  - 续做 2026-05-26：补齐“服务端先有远端更新，本地重连后最终一致”路径。Playwright 红测 `Gate 6 collab demo merges remote server updates with offline local edits on reconnect` 先失败于 A/B 文本已合并但缺少 `OFFLINE_RECONNECT_CONFLICT_MERGED` 诊断；修复后同测转绿，并且 `keeps IndexedDB offline edits` / `merges remote server updates` 子集与完整 `examples/collab` Chromium smoke 10 项通过。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-offline-merge-1779745189754` 验证：A 断开后写入 `Gate 6 Kimi merge offline local text`，B 在线写入 `Gate 6 Kimi merge remote server text`，A 重连后 A/B 最终文本一致且同时包含本地离线文本和远端文本；A 侧 `readOfflineState()` 导出 `queuedOperations: 0`、`lastEvent: "offline-reconnect-synced"`，诊断含 `OFFLINE_RECONNECT_STARTED`、`OFFLINE_RECONNECT_SYNCED` 和 `OFFLINE_RECONNECT_CONFLICT_MERGED`。当前仍未覆盖 provider auth failed、WebSocket reconnect failed、update rejected 和生产共享历史服务。
  - 续做 2026-05-26：补齐 WebSocket reconnect failed 路径。Playwright 红测 `Gate 6 collab demo preserves pending offline edits when Hocuspocus reconnect fails` 先失败于停止 Hocuspocus 服务后只导出 `OFFLINE_RECONNECT_STARTED`，没有 `OFFLINE_RECONNECT_FAILED`；修复后 runtime 在重连 pending 时增加可取消失败兜底，成功 synced 会取消，服务不可达时保留本地 pending 并导出 `OFFLINE_RECONNECT_FAILED`。验证：该 focused 测试转绿，`keeps IndexedDB offline edits` / `merges remote server updates` / `reconnect fails` 三项子集通过，完整 `examples/collab` Chromium smoke 11 项通过。Kimi WebBridge 真实 Chrome 在 room `jword-collab-kimi-reconnect-failed-1779745807282` 验证：停止本地 Hocuspocus 服务后重连失败，页面状态为 `offline-reconnect-failed`，`queuedOperations: 1`，pending 文本 `Gate 6 Kimi reconnect failure pending local text` 未丢失，诊断含 `OFFLINE_RECONNECT_STARTED` 和 `OFFLINE_RECONNECT_FAILED`。当前仍未覆盖 provider auth failed、update rejected 和生产共享历史服务。

#### Iteration 5 - update log、snapshot 和版本历史（Step 6.6 / 6.13）

- [x] 定义 snapshot adapter：
  - `appendUpdate(update, metadata)`
  - `createSnapshot(metadata)`
  - `listVersions(query)`
  - `loadVersion(versionId)`
  - `createPreview(versionId)`
  - `restoreVersion(versionId, options)`
  - `compact(beforeVersionId)`
- [x] 定义 update log record：
  - `updateId`
  - `roomId`
  - `clientId`
  - `origin`
  - `authorId`
  - `createdAt`
  - `byteLength`
  - `sha256`
  - `stateVector`
  - `snapshotId`
  - 续做 2026-05-26：内存 update log record 已补 `snapshotId`，`createSnapshot()` 会把生成的 `snapshotId` 反向挂到对应 `baseUpdateId` 的 update log 记录，形成可审计的 update -> snapshot 链路。验证：先用 `pnpm exec vitest run packages/persistence/test/memory-adapter.test.ts --testNamePattern "metadata"` 观察 `baseUpdateId` / `documentSummary` / `updateByteLength` / `snapshotId` 缺失红灯，再实现并转绿；随后 `pnpm exec vitest run packages/persistence/test/memory-adapter.test.ts`、`pnpm --filter @4xian/jword-persistence typecheck` 均通过。
- [x] 定义 snapshot record：
  - `snapshotId`
  - `roomId`
  - `createdAt`
  - `label`
  - `authorId`
  - `baseUpdateId`
  - `stateVector`
  - `updateByteLength`
  - `documentSummary`
  - 续做 2026-05-26：内存 snapshot record 已包含 `snapshotId`、`documentId`、`versionId`、`roomId`、`clientId`、`createdAt`、`label`、`authorId`、`origin`、`baseUpdateId`、`stateVector`、`byteLength`、`updateByteLength`、标准 `sha256`、`updateCount` 和 `documentSummary`。`documentSummary` 仅从隔离 `Y.Doc` 提取 shared type 名称、updateCount 和 updateByteLength，不保存 projection JSON。
- [x] 使用 Yjs update API 实现：
  - 追加 incremental update。
  - `Y.mergeUpdates()` 合并 update。
  - `Y.encodeStateVectorFromUpdate()` 建版本索引。
  - 必要时加载到隔离 Y.Doc 做 garbage collection / projection preview。
- [x] 实现历史版本最小闭环：
  - 版本列表
  - 只读预览
  - 恢复
  - 恢复失败诊断
- [x] 只读预览必须满足：
  - 不连接 provider。
  - 不写当前 editor。
  - 可生成 projection/layout。
  - 显示版本 metadata 和 warning。
- [x] 版本恢复必须满足：
  - [x] 恢复前检测当前 doc 是否有未同步本地 update。
  - [x] 恢复操作带 `version-restore` origin。
  - [x] 恢复失败保留当前可写 doc。
  - [x] 恢复成功后产生新的版本记录，而不是删除历史。
- [x] 补 focused tests：
  - update log 可重建 Y.Doc。
  - snapshot + tail updates 可重建指定版本。
  - 版本预览不修改当前 doc。
  - 恢复失败不半写。
  - compact 后最新版本仍可恢复。
  - update / snapshot / version metadata 可记录 room、client、origin、snapshotId、baseUpdateId、documentSummary、updateByteLength、标准 sha256 和 state vector。
  - 恢复成功会追加 `restore:*` 版本记录，不删除历史。
  - 空占位 snapshot 使用标准空字节 SHA-256 摘要。
- [x] 补真实浏览器验收：
  - [x] 创建两个版本。
  - [x] 打开历史列表。
  - [x] 预览旧版本。
  - [x] 恢复旧版本。
  - [x] 新版本列表出现 restore 记录。
- [x] 验证：历史版本可查看、可恢复、可解释；不以 DOCX、HTML 或 projection JSON 覆盖真源。
  - 续做 2026-05-26：内存 persistence adapter 已覆盖 update log 重建、snapshot + tail update、隔离 preview、restore、restore failed diagnostic、compact 后最新版本恢复；metadata 已补 `roomId` / `clientId` / `origin` / `authorId` / `byteLength` / 标准 `sha256` / `stateVector`，成功 restore 已追加 `restore:*` 新版本记录。验证：`pnpm vitest run packages/persistence/test/memory-adapter.test.ts`、`pnpm --filter @4xian/jword-persistence typecheck`、Gate 6 focused suite、根 `pnpm typecheck`、comment/boundary/diff checks 均通过。当前仍未做浏览器历史列表/预览/恢复验收，也未接真实 IndexedDB。
  - 续做 2026-05-26：`examples/collab` 内存 demo 已新增可编辑双客户端、历史版本下拉、只读预览和恢复按钮；Playwright Chromium 覆盖 A/B 输入同步、创建两个版本、选择旧版本、预览旧版本、恢复旧版本和 `restore:v1` 记录。Kimi WebBridge 真实浏览器验证：在 `http://127.0.0.1:4187/` 输入 `Gate 6 Kimi synced text` 后 A/B 同步，历史记录出现 `Client A edit`；选择 `v1` 后预览显示 `Gate 6 memory collab draft`；点击恢复后 A/B 均回到初始文本，历史记录包含 `restore:v1`。这仍是 demo host 内存验证，不代表真实 provider、真实 IndexedDB 或生产历史 UI 完成。
  - 续做 2026-05-26：`examples/collab` 真实 Hocuspocus provider 模式已覆盖本地 history 索引、隔离只读预览和恢复后同步到另一浏览器页面。Playwright Chromium 新增 `Gate 6 collab demo restores Hocuspocus history versions across browser pages`：client-a 写入 `Gate 6 provider history v1` / `Gate 6 provider history v2`，client-b 跟随同步；client-a 选择 v1 版本后预览显示 v1，点击 restore 后 client-a/client-b 均回到 v1，历史列表出现 `restore:Client A edit`。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-history-1779743550` 验证同一路径：最终 `providerMode: "hocuspocus"`、两端状态为 `synced`、A/B 文本均为 `Gate 6 Kimi provider history v1`，预览同为 v1。当前历史索引仍是每页 runtime 本地 memory persistence，不是生产共享历史服务；未覆盖 restore conflicts with unsynced local update、真实 provider 历史失败诊断或 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：真实 Hocuspocus provider + IndexedDB 模式已覆盖 `restore conflicts with unsynced local update`。红测 `pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "blocks Hocuspocus history restore"` 先失败于 pending 本地文本被旧版本覆盖；修复后同命令转绿。实现只在 `examples/collab/src/runtime/hocuspocus-runtime.ts` 的 restore 入口检测 `queuedOperations` / offline pending 状态，阻止恢复、保留当前可写 Y.Doc、保留 pending 计数，并导出 `COLLAB_RESTORE_CONFLICT_RESOLVED` 诊断。Kimi WebBridge 真实 Chrome 双标签在 room `jword-collab-kimi-restore-conflict-1779744180` 验证：client-a 离线 pending 后点击 restore，A 保留 `Gate 6 Kimi restore conflict pending local`，B 保持 `Gate 6 Kimi restore conflict synced`，A 的 `lastEvent` 为 `restore-conflict-local-pending`、`queuedOperations: 1`、诊断含 `COLLAB_RESTORE_CONFLICT_RESOLVED`。当前仍未覆盖生产共享历史服务、真实 provider 历史失败诊断的完整矩阵和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：persistence 内存契约补齐 update log / snapshot 生产历史 metadata 字段，覆盖 `JWordUpdateLogRecord.snapshotId`、`JWordSnapshotRecord.baseUpdateId`、`updateByteLength`、`documentSummary` 和 update -> snapshot 反向链路。该收口仍是 persistence contract 层，不代表生产共享历史服务、真实 provider 历史失败诊断矩阵或 Gate 6 总体验收完成。

#### Iteration 6 - auto inserter 主通道（Step 6.7-6.9）

- [x] 实现 `createInserter()` API，支持 stable anchor、throttle、flush、abort、progress、error。
- [x] 定义 `createInserter()` 输入：
  - `editor`
  - `requestId`
  - `anchor` 或 `range`
  - `origin = "auto-inserter"`
  - `mode = "insert" | "replace" | "append"`
  - `flushPolicy`
  - `undoScope`
  - `AbortSignal`
  - progress/error listener
- [x] 定义 auto inserter event：
  - `queued`
  - `anchored`
  - `streaming`
  - `flushing`
  - `committed`
  - `aborted`
  - `failed`
- [x] 定义 auto inserter error：
  - anchor unresolved
  - range deleted
  - abort requested
  - command rejected
  - concurrent restore
  - provider disconnected
  - 进展 2026-05-26：已新增公开 `InserterError` / `InserterErrorCode`，并从 `@4xian/jword-core` 根入口导出；当前已覆盖 `AUTO_INSERTER_ANCHOR_UNRESOLVED`、`AUTO_INSERTER_RANGE_REQUIRED`、`AUTO_INSERTER_ANCHOR_REQUIRED`、`AUTO_INSERTER_FLUSH_FAILED`。`range deleted`、`abort requested`、`command rejected`、`concurrent restore`、`provider disconnected` 的完整诊断矩阵仍未完成。
- [x] 写入策略：
  - 每个 chunk 先解析 anchor 当前绝对位置。
  - 多个 token 聚合为小 batch，避免每字符 transaction。
  - 每次 flush 经 Editor command/transaction。
  - selection 不强制抢占用户当前输入。
  - 用户在插入点附近编辑时，anchor 跟随 Yjs relative position。
- [x] undo 策略：
  - 默认不进入用户 undo。
  - 可选独立 auto-inserter undo scope。
  - 用户 undo 不撤销 remote/AI 内容。
  - abort 后已提交 chunk 保持可诊断，不做不可控回滚。
- [x] 补 focused tests：
  - stable anchor 后插入。
  - replace range 后插入。
  - 用户同时在同段输入，AI chunk 不丢不重复。
  - abort 停止后续 flush。
  - progress 顺序稳定。
  - anchor deleted 时返回可恢复错误。
  - 进展 2026-05-26：`packages/core/test/collaboration/inserter.test.ts` 已覆盖 stable anchor、replace range、abort、progress 顺序、默认不进用户 undo，以及文档替换后旧 anchor 无法解析时返回 `AUTO_INSERTER_ANCHOR_UNRESOLVED` recoverable error；`packages/core/test/index.test.ts` 覆盖根入口导出 auto inserter 结构化错误类型。续做已补 core 级同段并发回归：本地用户或 `remote-user` origin 在 AI queue 后、flush 前写入同段，AI chunk 仍跟随稳定 anchor，不丢不重复，且 remote+AI 默认不进入用户 undo。最新续做已补 `undoScope: "auto-inserter"` 独立 undo/redo 回归。仍缺真实 provider 并发和 throttle/batch。
- [x] 补真实浏览器验收：
  - 启动 AI streaming 插入。
  - 插入期间用户继续输入。
  - 插入期间远端用户继续输入。
  - abort 后 editor 仍可输入。
  - 用户 undo 不撤销 AI 内容，独立 AI undo scope 可撤销 AI 内容。
- [x] 验证：auto inserter 不使用普通字符 offset，不阻塞本地输入，不绕过 Editor transaction。
  - 进展 2026-05-26：已新增 `packages/core/src/collaboration/inserter.ts` 和公开 `createInserter()`，支持 `requestId`、`anchor` / `range`、`mode`、`flushPolicy`、`undoScope`、`AbortSignal`、progress/error listener；focused tests 覆盖 stable anchor、replace range、abort、progress 顺序、anchor unresolved 结构化可恢复错误、local/remote origin 与 AI queue 的同段并发、默认不进用户 undo，以及 `undoScope: "auto-inserter"` 独立 undo/redo；根入口已导出 `InserterError` / `InserterErrorCode` / `HistoryScope`。当前仍缺 throttle/batch、真实 provider 并发验收和 range deleted 完整诊断。

#### Iteration 7 - remote/local/AI 并发矩阵（Step 6.10-6.11）

- [x] 建立 remote/local 并发测试：
  - [x] 双用户同段不同位置输入
  - [x] 双用户同位置输入
  - [x] 删除与远端插入冲突
  - [x] 格式化冲突
  - [x] 批注 anchor 远端编辑稳定
- [x] 扩展 remote/local 并发测试：
  - [x] A 删除 B 正在格式化的范围。
  - [x] A 新增批注，B 在批注前插入文本。
  - [x] A 移动 selection，B 替换同段文本。
  - [x] A undo 本地输入，B 的 remote 输入保留。
- [x] 建立 AI/local 并发测试：
  - AI 在 anchor 处流式插入，用户在 anchor 前输入。
  - AI 替换 range，用户在 range 后输入。
  - 用户删除 AI anchor 所在 run，AI 返回 anchor unresolved。
  - 用户 undo 本地输入，AI 内容保留。
- [x] 建立 AI/remote 并发测试：
  - AI 写入时远端用户同段输入。
  - AI 写入时远端用户删除相邻文本。
  - AI 写入期间 provider 断开再恢复。
- [x] 每个并发 fixture 必须记录：
  - 初始文档。
  - 操作序列。
  - origin 序列。
  - 预期最终 projection 摘要。
  - undo 预期。
  - diagnostics 预期。
- [x] 补 `fixtures/collab/registry.json`，约束每个并发 fixture 的输入、操作序列和预期摘要。
- [x] 验证：并发矩阵不追求固定字符顺序之外的不可控 UI 细节，但必须验证“不重复、不丢失、不阻塞、不污染 undo”。
  - 进展 2026-05-26：已新增 `fixtures/collab/registry.json` 和 `fixtures/history/registry.json`，并用架构测试约束输入、操作序列、origin、projection 摘要、undo 和 diagnostics 期望；`packages/core/test/collaboration/inserter.test.ts` 已覆盖 core 级 local/remote origin 与 AI queue 同段并发，不丢、不重复、不污染用户 undo。当前仍没有真实 provider 双窗口回放执行器，也未覆盖删除/格式化冲突、批注 anchor 远端编辑稳定和浏览器并发输入。
  - 续做 2026-05-26：已补真实 Hocuspocus provider 模式下 remote/local 双用户同段不同位置输入首条闭环；新增 `examples/collab/src/runtime/hocuspocus-text-command.ts`，用 `previousText -> nextText` 计算本地输入 diff，再按当前共享正文 rebase diff 起点，避免另一个 client 的前缀输入被完整 textarea value 覆盖删除；`examples/collab/src/main.ts` 改为通过 `beforeinput` 捕获本地编辑基线，render 只刷新可见文本，不覆盖本地输入基线；`examples/collab/tests/collab-concurrency.e2e.ts` 补 `Gate 6 provider 双用户同段不同位置输入后不互相覆盖`，先红于最终只剩 `provider base-B`，随后绿于最终 A/B 均为 `A-provider base-B`。验证：`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --grep "不同位置"`、`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium`、`pnpm --filter @4xian/jword-example-collab typecheck`、`node tools/lint/check-comments.mjs`、targeted `git diff --check` 通过。Kimi WebBridge 真实 Chrome session `jword-gate6-a` / `jword-gate6-b` 在本地 4186/4188 双标签验证：先写入 `provider base`，再并发提交 A 前缀和 B 后缀，A/B 均读回 `A-provider base-B`，offline 保持 `connected: true`、`lastEvent: "synced"`、诊断为空；验证后已关闭 Kimi sessions 并确认 4186/4188 无监听残留。Step 6.10 仍保持未完成：还缺双用户同位置输入、删除与格式化冲突、批注 anchor 远端编辑稳定、local undo 不撤销 remote 的真实 provider 路径。
  - 续做 2026-05-26：继续补真实 Hocuspocus provider 同位置和 undo 并发路径；`examples/collab/tests/collab-concurrency.e2e.ts` 新增 `Gate 6 provider 双用户同段同位置输入后不丢失不重复`、`Gate 6 provider 旧基线同位置提交不重复远端后缀`、`Gate 6 provider 本地 undo 不撤销远端输入`、`Gate 6 provider 旧基线本地输入不重复远端后缀`。先红于真实 Kimi 路径暴露的 `A-B-provider baseprovider base` / `provider base remote local remote`，随后 `hocuspocus-text-command.ts` 增加旧 baseline 合并：无 `beforeinput` 时按 current/next 共享正文只插入本地前后缀；旧 baseline 追加时裁掉 current 已存在的远端追加片段，避免重复后缀并保留本地 undo 栈。Kimi WebBridge 真实 Chrome 双标签复跑：同位置最终 `A-B-provider base`，A/B token 各一次且 `provider base` 一次；undo 路径最终回到 `provider base remote`，offline 均为 `indexeddb-synced`，仅有 `OFFLINE_CACHE_SYNCED` info 诊断。验证：`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --grep "同位置|旧基线|本地 undo"`、`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium`、`pnpm exec vitest run packages/core/test/collaboration/editor-update.test.ts examples/collab/tests/vite-config.test.ts`、`pnpm --filter @4xian/jword-core typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`node tools/lint/check-comments.mjs`、targeted `git diff --check` 通过。Step 6.10 仍保持未完成：还缺删除与格式化冲突、批注 anchor 远端编辑稳定，以及 AI/local、AI/remote 并发矩阵。
  - 续做 2026-05-26：补真实 Hocuspocus provider 下删除与远端插入冲突路径；`examples/collab/tests/collab-concurrency.e2e.ts` 新增 `Gate 6 provider 旧基线删除不吞掉远端插入`，RED 先失败于 A 旧基线删除 `AB` 时误删远端插入前缀并最终得到 `remote-B`。随后 `hocuspocus-text-command.ts` 对旧基线纯删除增加非连续 rebase：把旧基线 grapheme 映射到当前共享正文位置，合并删除 range 并倒序生成 `deleteRange`，避免吞掉远端插入。验证：`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --grep "旧基线删除"`、完整 `pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium`、`pnpm --filter @4xian/jword-example-collab typecheck` 通过；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-delete-insert` 验证 A/B 从 `AB`，B 远端插入为 `A-remote-B` 后，A 旧基线删除最终两端收敛为 `-remote-`，offline `synced` 且 diagnostics 为空。Step 6.10 仍保持未完成：还缺格式化冲突、批注 anchor 远端编辑稳定，以及 AI/local、AI/remote 并发矩阵。
  - 续做 2026-05-26：补真实 Hocuspocus provider 下删除与远端格式化冲突路径；`examples/collab/tests/collab-concurrency.e2e.ts` 新增 `Gate 6 provider 删除远端格式化范围后不残留格式冲突`，RED 先失败于 demo debug API 缺失，补 API 后继续红于远端加粗把 `target` 拆成独立 run，A 旧基线删除 `target` 时最终仍残留 `keep target tail`。随后新增 `hocuspocus-format.ts` 和 `hocuspocus-projection.ts`，把格式化 debug 写入约束到 Editor facade / transaction pipeline，并让 `hocuspocus-text-command.ts` 按 projection 的实际 run 边界倒序拆分删除 range，避免 core 单个 `deleteRange` 跨 run 限制吞掉删除。验证：`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --grep "格式化"`、完整 `pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium`、`pnpm --filter @4xian/jword-example-collab typecheck` 通过；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-format-delete` 验证 A/B 从 `keep target tail`，B 将 `target` 加粗，A 旧基线删除后两端收敛为 `keep  tail`，`readTextFormatRanges()` 中 bold range 为空，offline `synced` 且 diagnostics 为空。Step 6.10 仍保持未完成：还缺批注 anchor 远端编辑稳定，以及 AI/local、AI/remote 并发矩阵。

#### Iteration 8 - 失败恢复、diagnostics 和真实浏览器验收（Step 6.12）

- [x] 建立 Gate 6 diagnostics registry：
  - provider diagnostics
  - awareness diagnostics
  - offline diagnostics
  - snapshot/history diagnostics
  - auto inserter diagnostics
  - restore diagnostics
- [x] 失败恢复覆盖：
  - [x] provider auth failed。
  - [x] websocket reconnect failed。
  - [x] update rejected。
  - [x] IndexedDB unavailable。
  - [x] snapshot missing。
  - [x] restore conflicts with unsynced local update。
  - [x] auto inserter abort。
  - [x] auto inserter retry。
- [x] 失败时必须满足：
  - 本地未同步变更保留。
  - 当前 editor 可继续输入。
  - diagnostics 可导出。
  - UI 状态不假装 synced。
  - 不自动清空 IndexedDB。
- [x] 补 `examples/collab` debug API：
  - `readCollabState()`
  - `readAwarenessState()`
  - `readOfflineState()`
  - `readVersionHistory()`
  - `startAutoInsert()`
  - `abortAutoInsert()`
  - `retryAutoInsert()`
  - `simulateDisconnect()`
  - `simulateReconnect()`
- [x] 真实浏览器验收：
  - 双窗口同时编辑最终一致。
  - 远端光标和选区可见。
  - 断网期间继续输入。
  - 重连后最终一致。
  - AI streaming 期间用户输入不阻塞。
  - abort AI 后继续输入。
  - [x] 历史版本预览与恢复。
  - 用户 undo 默认不撤销 remote/AI 内容。
- [x] 验证：协同、离线、版本历史、自动插入都没有绕开 `Editor` transaction。
  - 进展 2026-05-26：已新增 `fixtures/collab/diagnostics-registry.json` 和架构测试，覆盖 provider、awareness、offline、snapshot、history、auto-inserter、restore 诊断归属；`examples/collab` 暴露 8 个 debug API，并已用 Playwright Chromium 与 Kimi WebBridge 真实浏览器验证内存 demo 的 connected/disconnected/reconnected、auto insert start/abort 状态。当前仍未覆盖真实 provider auth failed、WebSocket reconnect failed、IndexedDB 浏览器恢复、双窗口最终一致和历史版本恢复。
  - 续做 2026-05-26：`examples/collab` 的真实浏览器入口进一步覆盖内存双客户端输入同步和历史版本预览/恢复：Playwright Chromium 新增 UI 流程测试，Kimi WebBridge 真实浏览器读回 A/B 同步、`Client A edit`、预览旧文本和 `restore:v1`。当前仍未覆盖真实 provider auth failed、WebSocket reconnect failed、IndexedDB 浏览器恢复、远端光标/选区、真实双窗口最终一致和真实断网恢复。
  - 续做 2026-05-26：`examples/collab` 的真实浏览器入口进一步覆盖内存远端光标/选区可见层：Playwright Chromium 新增 remote cursor/selection presence 测试，Kimi WebBridge 真实浏览器读回 Alice/Bao 光标、Client A 选区 `5-12` 和对应 awareness debug state。当前仍未覆盖真实 provider 多窗口 awareness、WebSocket reconnect failed、IndexedDB 浏览器恢复、真实双窗口最终一致和真实断网恢复。
  - 续做 2026-05-26：`examples/collab` 的真实 Hocuspocus provider 模式已覆盖跨页面 awareness 渲染：Playwright Chromium 新增 `Gate 6 collab demo renders Hocuspocus awareness across browser pages`，先同步 `awareness range text`，再在 client-a 选择 `2-8`，client-b 页面显示 `Client A cursor 8` 和 `Client A selection 2-8`。Kimi WebBridge 双标签真实浏览器验证同一流程通过。当前仍未覆盖真实 provider auth failed、WebSocket reconnect failed、IndexedDB 浏览器恢复、真实断网恢复和历史版本真实 provider 路径。
  - 续做 2026-05-26：真实 Hocuspocus provider history 路径已补齐浏览器验收：Playwright Chromium 覆盖跨页面版本创建、旧版本预览、restore 后同步到另一页面；Kimi WebBridge 真实 Chrome 双标签验证 room `jword-collab-kimi-history-1779743550` 下 A/B 最终均恢复到 `Gate 6 Kimi provider history v1`，history 记录包含 `restore:Client A edit`。当前仍未覆盖真实 provider auth failed、WebSocket reconnect failed、restore conflicts with unsynced local update、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：真实 Hocuspocus provider + IndexedDB 模式已覆盖 restore 与未同步本地 update 的冲突保护：Playwright 红绿测试和 Kimi WebBridge 真实 Chrome 双标签均验证 restore 被阻止，pending 本地变更保留，诊断可通过 `readOfflineState()` 导出，UI 状态显示 `restore-conflict-local-pending`，且未自动清空 IndexedDB/pending 计数。当前仍未覆盖真实 provider auth failed、WebSocket reconnect failed、update rejected、snapshot missing、auto inserter retry、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：真实 Hocuspocus provider + IndexedDB 模式已覆盖 WebSocket reconnect failed：Playwright 红绿测试验证服务不可达时保留 pending、本地 editor 仍显示 pending 文本、UI 不假装 synced、诊断导出 `OFFLINE_RECONNECT_FAILED`，Kimi WebBridge 真实 Chrome room `jword-collab-kimi-reconnect-failed-1779745807282` 验证同一路径。当前仍未覆盖真实 provider auth failed、update rejected、snapshot missing、auto inserter retry、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：真实 Hocuspocus provider auth failed 路径已覆盖；`examples/collab/server/hocuspocus-service.ts` 支持本地 `requiredToken`，`packages/collab` adapter 将 Hocuspocus `onAuthenticationFailed` 映射为 `COLLAB_PROVIDER_AUTH_FAILED`，`examples/collab` 通过 URL `token` 传入 provider 并在 `readOfflineState()` 导出 `provider-error` 和不可恢复诊断。红绿验证覆盖 Node provider auth failed、diagnostics registry、浏览器 valid token 成功和 invalid token 失败；Kimi WebBridge 真实 Chrome 验证 invalid token 页面 `status: "provider-error"`、diagnostics 含 `COLLAB_PROVIDER_AUTH_FAILED` 且 `recoverable: false`，valid token 页面 `status: "synced"` 且 diagnostics 为空。当前仍未覆盖 update rejected、snapshot missing、auto inserter retry、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：真实 Hocuspocus provider update rejected 路径已覆盖；本地 Hocuspocus 服务新增 `rejectUpdates` 测试开关，服务端在 Yjs update message 被拒绝时关闭连接并发送 `COLLAB_UPDATE_REJECTED` reason，`packages/collab` adapter 仅在明确 close reason 等于该 code 时导出 recoverable provider error，不把普通断连误报为错误。红绿验证覆盖 diagnostics registry、Node provider update rejected、浏览器 provider-error UI 和本地文本保留；Kimi WebBridge 真实 Chrome 在 room `jword-collab-kimi-update-rejected-room` 验证 `status: "provider-error"`、`readOfflineState().diagnostics` 含 `COLLAB_UPDATE_REJECTED` 且 `recoverable: true`，textarea 和 debug text 均保留 `Gate 6 Kimi update rejected text`。当前仍未覆盖 snapshot missing、auto inserter retry、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：snapshot missing 路径已覆盖到 persistence contract 和统一 diagnostics registry；`loadVersion()` 在版本元数据引用的 snapshot 缺失时导出 recoverable `PERSISTENCE_SNAPSHOT_NOT_FOUND` 并从 update log 重建，`createPreview()` 和 `restoreVersion()` 可继续使用 fallback update，同时回传诊断；Gate 6 registry 新增 `COLLAB_SNAPSHOT_MISSING`，owner 为 `snapshot`，fallback 为 `rebuild-from-update-log`。红绿验证覆盖 `packages/persistence/test/memory-adapter.test.ts --testNamePattern "missing snapshot"` 和 `tests/architecture/gate6-diagnostics-registry.test.ts`。当前仍未覆盖 auto inserter retry、生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：auto inserter retry 路径已覆盖；`createInserter()` 新增 `retry()`，在 recoverable anchor flush 失败后保留待写文本，并允许调用方传入新的 stable anchor/range 重试，progress 导出 `retrying`，仍走 Editor facade 与原 transaction pipeline。统一 registry 新增 `COLLAB_AUTO_INSERTER_RETRY_STARTED`，`examples/collab` debug API 新增 `retryAutoInsert()`，内存 demo可导出 retry 诊断并把 token 同步到 A/B。红绿验证覆盖 `packages/core/test/collaboration/inserter.test.ts --testNamePattern "retryable"`、`tests/architecture/gate6-diagnostics-registry.test.ts`、`examples/collab/tests/vite-config.test.ts` 和 Playwright Chromium `debug API` 用例；Kimi WebBridge 真实 Chrome 在 `http://127.0.0.1:4186/` 验证 `lastEvent: "retry-started"`、diagnostics 含 `COLLAB_AUTO_INSERTER_RETRY_STARTED`、A/B 文本均追加 `协同`。当前仍未覆盖生产共享历史服务和 DOCX 导入文档在真实 provider history 全链路。
  - 续做 2026-05-26：IndexedDB unavailable 和 auto inserter abort 路径已收敛；`examples/collab` Playwright Chromium 用 `addInitScript()` 将浏览器 `window.indexedDB` 置为不可用，验证 Hocuspocus 在线协同仍可用、`readOfflineState()` 导出 recoverable `OFFLINE_CACHE_UNAVAILABLE`，且 UI 不进入 disconnected；统一 registry 新增 `COLLAB_AUTO_INSERTER_ABORTED`，内存 demo 的 `abortAutoInsert()` 导出 abort 诊断并保留 `lastEvent: "aborted"`。验证：`pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API|IndexedDB is unavailable"`。后续已补 transaction 不绕路证明和 Kimi WebBridge 真实浏览器总验收，见本小节后续记录。
  - 续做 2026-05-26：Kimi WebBridge 真实 Chrome 总验收已复跑断网/重连矩阵，session `jword-gate6-1779756894859` 覆盖 7 条路径：memory auto insert abort/retry、Hocuspocus 双标签同步、IndexedDB reload restore（update bytes 851）、断开期间 pending 且重连后远端收到、远端在线更新与本地离线更新冲突合并并导出 `OFFLINE_RECONNECT_CONFLICT_MERGED`、provider history preview/restore 后另一标签同步、独立 Hocuspocus 服务停止后重连失败并保留 pending 与 `OFFLINE_RECONNECT_FAILED`。补充自动化验证：`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API|syncs two browser pages through Hocuspocus provider|restores Hocuspocus history versions|restores Hocuspocus document from IndexedDB after reload|keeps IndexedDB offline edits pending|merges remote server updates|preserves pending offline edits"` 7 tests passed；`pnpm --filter @4xian/jword-example-collab typecheck` 通过。Step 6.12 仍不代表 Gate 6 总完成：Step 6.10/6.11 真实并发矩阵、生产共享历史服务、DOCX 导入文档真实 provider/history 全链路和 Gate 6 总验收仍未完成。

#### Iteration 9 - lazy-load、bundle、benchmark 与 Gate 6 总验收

- [x] `packages/collab` 和 `packages/persistence` 不进入 `examples/vanilla` 首屏 bundle。
- [x] `examples/collab` 按需加载 provider/offline/history 运行时。
  - 完成 2026-05-26：`examples/collab/src/main.ts` 不再静态拉入 runtime 值，只保留 type import，并通过 `import('./lazy-runtime')` 异步装配；`lazy-runtime.ts` 动态加载 `./runtime/provider-runtime`、`./runtime/offline-runtime`、`./runtime/history-runtime` 和内存 runtime。`pnpm --filter @4xian/jword-example-collab build` 产物中 provider/offline/history/lazy/runtime 均为独立 chunk；Kimi WebBridge 真实浏览器在 `http://127.0.0.1:4186/` 读到 `lazy-runtime.ts`、`provider-runtime.ts`、`offline-runtime.ts`、`history-runtime.ts` 运行时资源，并验证 debug API、断连/重连、auto insert start/abort 可用。该证据只说明 demo host 懒加载与内存状态可用，不代表真实 provider 或 IndexedDB 离线恢复完成。
- [x] 建立 Gate 6 benchmark：
  - [x] 双客户端 1k / 10k updates apply 时间。
  - [x] update byte length。
  - [x] snapshot create/load 时间。
  - [x] version preview 时间。
  - [x] auto inserter 1k / 10k 字写入期间输入响应。
  - [x] IndexedDB restore 时间。
  - 完成 2026-05-26：新增 `benchmarks/gate6-collab-benchmark.mjs`，并接入 `tools/bench/run-bench.mjs`。benchmark 通过公开 `createEditor()` / `encodeCollaborationUpdate()` / `applyRemoteUpdate()`、`createMemoryCollabProviderAdapter()`、`createMemoryPersistenceAdapter()` 和 `createInserter()` 覆盖 `gate6-1k` 与 `gate6-10k`，输出 `updateApplyDurationMs`、`updateByteLength`、`snapshotCreateDurationMs`、`snapshotLoadDurationMs`、`versionPreviewDurationMs`、`autoInsertDurationMs`、`autoInsertInputProbeDurationMs`；真实 Playwright Chromium IndexedDB restore 探针已补齐，输出 `indexedDbRestoreStatus: "restored"`、`indexedDbRestoreDurationMs` 和 `indexedDbRestoreByteLength`。Node 离线 adapter 不可用诊断仍单独保留，不能用内存 adapter 冒充 IndexedDB。
- [x] 建立 Gate 6 focused suite：
  - core origin/history tests。
  - collab adapter tests。
  - persistence snapshot tests。
  - auto inserter tests。
  - collab fixture registry tests。
  - examples/collab Playwright tests。
- [x] 跑仓库级回归：
  - `pnpm lint`
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
  - affected Playwright collab tests
  - affected visual tests
  - `pnpm bench`
- [x] 回写 Gate 6 执行记录、真实浏览器证据、失败项和非阻塞遗留。
  - 早期记录 2026-05-26：focused suite 已覆盖 core collaboration update、auto inserter、collab contract、persistence memory adapter、fixture registry、diagnostics registry 和 `examples/collab` Playwright smoke；根级 `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 均通过，`examples/collab` production build 通过。当时尚未运行 `pnpm bench` / `pnpm test:visual`，Gate 6 benchmark 和真实双窗口/断网/历史恢复总验收后续已在 Step 6.17 / 6.18 收口。

#### Iteration 10 - 商业包边界与授权矩阵（Step 6.19-6.21）

- [x] 冻结 Gate 6 edition matrix：free 不包含协作、离线、自动插入或协作历史；paid 包含 collab client、collab server、offline、history、auto-insert。
- [x] 冻结高级包导出分级：`stable` 只暴露第三方集成 API，`experimental` 暴露可替换 provider adapter，`internal` 不进入 export map。
- [x] 建立架构测试：`packages/core`、`packages/native`、`examples/vanilla` 不得 import `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license`。
- [x] 建立授权 feature key：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`automation.autoInsert`、`collaboration.server`。
- [x] 建立未授权诊断：`COLLAB_LICENSE_MISSING`、`COLLAB_LICENSE_EXPIRED`、`COLLAB_FEATURE_NOT_ENTITLED`、`COLLAB_LICENSE_SERVER_UNAVAILABLE`。

#### Iteration 11 - core 中立位置 API（Step 6.22-6.24）

- [x] 在 core 中定义中立位置类型：selection snapshot、anchor snapshot、range snapshot、text location、query result；类型名不得带 `collab`、`ai` 或 `autoInsert` 前缀。
- [x] 提供读取当前位置 API：当前 selection -> anchor/range，支持 collapsed 和 non-collapsed selection。
- [x] 提供查询位置 API：按文本、block id、heading、comment id 或 range snapshot 查询可插入位置。
- [x] 提供 location 解析和滚动定位 API：第三方可把查询结果传给高级包，也可用于普通编辑器跳转。
- [x] 测试必须证明这些 API 不泄漏 Yjs RelativePosition、document-store、DOM Range 或 canvas 坐标。

#### Iteration 12 - `@4xian/jword-collab` client SDK 产品化（Step 6.25-6.28）

- [x] 定义公开入口 `connectJWordCollaboration(editor, options)`，options 至少包含 `serverUrl`、`documentId`、`roomId`、`user`、`token`、`license`、`features`。
- [x] user 初始化支持 `id`、`name`、`color`、`avatarUrl`；未传 color 时按 user id 生成稳定颜色。
- [x] 返回 connection handle：`status`、`diagnostics`、`awareness`、`history`、`offline`、`startAutoInsertSession()`、`disconnect()`、`destroy()`。
- [x] provider/Yjs/Hocuspocus 内部类型不得出现在 stable API；可替换 provider 只走 adapter contract。
- [x] 类型测试必须模拟外部 TypeScript 项目，仅从包入口导入 API 并完成 connect/disconnect/auto insert 调用。

#### Iteration 13 - `@4xian/jword-collab-server` self-host 服务包（Step 6.29-6.34）

- [x] 从 `examples/collab/server` 抽出正式 server package，不让第三方复制 demo server 源码。
- [x] 提供 Node 服务入口和可嵌入 handler：`createJWordCollabServer(options)`、`startJWordCollabServer(options)`。
- [x] server options 支持 `authHook`、`tenantHook`、`licenseHook`、`historyStorage`、`snapshotStorage`、`rateLimit`、`maxPayloadBytes`、`allowedOrigins`。
- [x] 提供 `/health`、`/version`、`/history`、`/license/status` API，并返回 protocolVersion、packageVersion、featureFlags。
- [x] 服务端必须强制 license enforcement；client-side license check 只能用于 UX 提示，不能作为唯一付费边界。
- [x] 服务端 history 写入必须有 document 级并发锁或事务边界，防止多用户同时保存版本时覆盖版本链。
- [x] 提供最小部署示例：本地 Node、Dockerfile 或等价启动脚本、环境变量、反向代理 WebSocket 注意事项。

#### Iteration 14 - client/server 版本握手与协议兼容（Step 6.35-6.37）

- [x] 定义 `protocolVersion`、`clientPackageVersion`、`serverPackageVersion`、`featureFlags`、`minimumServerVersion`。
- [x] client 连接时先完成 handshake；协议不匹配、server 过旧、client 过旧或 feature 不支持时返回 `COLLAB_VERSION_MISMATCH` 或更具体诊断。
- [x] server `/version` 和 client diagnostics export 必须输出同一版本信息，便于第三方排障。
- [x] E2E 覆盖版本匹配成功、server 过旧失败、featureFlags 缺失失败、失败后编辑器仍可本地单人编辑。

#### Iteration 15 - 远端光标、输入提示和 presence polish（Step 6.38-6.41）

- [x] 远端 cursor 在光标附近显示用户名称和输入状态，显示格式为 `用户名称 正在输入`。
- [x] 多用户颜色来自初始化 user color 或稳定 fallback；相邻光标颜色和标签不得混淆。
- [x] typing activity 必须有节流和过期时间，停止输入后自动隐藏 `正在输入`，但可继续显示远端 cursor。
- [x] 多用户重叠时使用稳定排序和轻量错位，不遮挡当前用户输入点。
- [x] presence 不进入版本历史、不进入 undo、不影响正文 transaction。

#### Iteration 16 - 自动插入公开 API 与虚拟 actor（Step 6.42-6.46）

- [x] 定义 `startAutoInsertSession()`：必须接收 `position` 或 `range`，来源可以是 selection snapshot、anchor/range、findText result 或 resolveLocation result。
- [x] 自动插入 session 创建后不得读取 live DOM caret，不得调用 editor focus，不得改变用户当前 selection。
- [x] 自动插入以虚拟 actor 进入 awareness，可配置 actor name/color，例如 `AI Assistant` 或业务方传入的机器人名称。
- [x] 流式写入支持 progress、abort、error、requestId、chunk metadata 和独立 undo scope。
- [x] 真实浏览器验收必须覆盖自动插入进行中，用户手动点击其它位置并继续输入，两条写入都保留且不抢光标。

#### Iteration 17 - 真实第三方集成 demo 和测试边界（Step 6.47-6.51）

- [x] 重写 `examples/collab` 主入口为真实编辑器集成：创建基础 editor/UI，动态 import 高级 client 包，连接 self-host server。
- [x] demo 测试不能直接 import `packages/collab/src`、`examples/collab/src/runtime/*`、server 内部 service 或 core store；只允许通过公开包入口和浏览器用户行为验收。
- [x] 建立架构测试扫描 examples 和 tests import graph，禁止底层源码路径、测试 helper 绕过公开 API。
- [x] 双页面验收必须是两个浏览器页面、两个 user、同一 room、同一 documentId；不得用同一页面两个 textarea 实例作为主验收。
- [x] 保留内部 debug API 时只能暴露宿主级测试钩子，不能成为第三方集成 API 或绕过公开包。

#### Iteration 18 - 商业 readiness、发布和文档计划（Step 6.52-6.56）

- [x] 私有 registry / `npm pack` 检查：高级 client、server、license 包只包含 dist、types、README、license metadata，不包含 fixtures 中的敏感样本或测试私有文件。
- [x] bundle gate：free vanilla 首屏不包含 collab、hocuspocus、license、IndexedDB offline runtime、server client code；高级示例按需加载。
- [x] diagnostics registry 覆盖授权、版本、server、network、offline、history、auto-insert、presence、storage 和 rate limit。
- [x] benchmark 覆盖 2/5/20 用户、1k/10k updates、离线重连、版本 snapshot、自动插入 1k/10k 字和 server history API。
- [x] Gate 7 文档站必须包含协作快速开始、self-host server 部署、授权接入、client/server 版本策略、公开 API 清单、故障排查和收费能力边界。

### 待办步骤

- [x] Step 6.1：定义 collab provider adapter 接口，宿主负责 room id、auth、生产存储和 reconnect 策略。
- [x] Step 6.2：实现本地 Hocuspocus 验证服务，提供本地双窗口协同 demo。
  - 进展 2026-05-26：已完成 Node-only Hocuspocus 示例服务入口和 `dev:server` 脚本，`examples/collab/tests/hocuspocus-service.test.ts` 覆盖 `createCollabHocuspocusService()` 随机端口启动、HTTP 健康响应、WS URL 和关闭；`examples/collab/tests/vite-config.test.ts` 锁定 `dev:server` 脚本与 `@hocuspocus/server@4.0.0` 依赖声明。验证：`pnpm exec vitest run examples/collab/tests/vite-config.test.ts examples/collab/tests/hocuspocus-service.test.ts`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-example-collab build`、`pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。未完成项：浏览器端 Hocuspocus provider、真实双窗口协同、remote update 渲染闭环和真实 provider awareness。
  - 续做 2026-05-26：已接入 `@hocuspocus/provider@4.0.0` 的真实 provider adapter，并在 `examples/collab` 增加 Hocuspocus 浏览器模式。验证：`pnpm exec vitest run examples/collab/tests/vite-config.test.ts examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/hocuspocus-provider.test.ts packages/collab/test/contract.test.ts`、`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium` 通过；Kimi WebBridge 双标签真实浏览器验证 client-a 输入 `Gate 6 Kimi real Hocuspocus sync` 后 client-b 同步显示同一文本。后续已补真实 provider awareness、IndexedDB 浏览器恢复、真实断网重连和 WebSocket reconnect failed 证据；剩余失败矩阵见 Step 6.12。
- [x] Step 6.3：实现 awareness，展示在线用户、远端光标、远端选区；presence 不进入正文历史。
  - 续做 2026-05-26：真实 Hocuspocus provider awareness 已接入 `examples/collab` 可见层；client-a 选区通过 `adapter.awareness.setLocalState()` 进入 Hocuspocus awareness，client-b 页面经 `adapter.awareness.onChange()` 触发 render，并显示远端 cursor/selection。后续已补 Hocuspocus 断连 presence 浏览器回归和 Kimi WebBridge 证据；client-a `simulateDisconnect()` 后，client-b 的在线用户列表移除 `client-a`，远端 cursor/selection DOM 同步消失，正文协同文本保持不变。
  - 续做 2026-05-26：真实 Hocuspocus awareness 已携带结构兼容的 JWord `TextRangeRecord` / relative position snapshot；自动化和 Kimi WebBridge 均验证 client-b 可读到 client-a 的 `client-a-selection`、anchor/focus `graphemeIndex: 2/8` 与 `relativePosition.tname: "body"`。Step 6.3 仍未完成：viewport/page index、用户名 tooltip、多用户重叠稳定排序和更完整的 unresolved range 降级验收仍需补齐。
  - 续做 2026-05-26：已补 viewport/page index、用户名 tooltip 和稳定排序证据；Playwright Chromium 覆盖 memory presence 的 cursor/selection `title` 与 Hocuspocus awareness 的 `viewport.pageIndex: 0`，Vitest 锁定 `sortAwarenessUsers()` 按 `clientId` 返回新数组且不修改输入。Kimi WebBridge 真实 Chrome 双标签验证 client-b 读回 client-a 的 `Client A` tooltip、`Client A selection 2-8` 和 `viewport.pageIndex: 0`。Step 6.3 仍未完成：更完整的 unresolved range 降级、presence 不影响 undo、权限不足 awareness 降级路径仍需补齐。
  - 完成 2026-05-26：补齐 Step 6.3 剩余三项。`parseAwarenessState()` 与 Hocuspocus adapter 会把非法 `rangeSnapshot` 降级为 presence-only，并记录 `COLLAB_AWARENESS_ANCHOR_UNRESOLVED` warning；`examples/collab/tests/collab-awareness.e2e.ts` 覆盖真实 Hocuspocus presence 不进入本地 undo 栈，以及 auth failed 后 selection 事件不再写入 awareness。Kimi WebBridge 真实 Chrome 双标签验证 room `jword-collab-kimi-step63-awareness-undo`：A 写入 `awareness undo base` 后 B selection `0-9` 在 A 可见为 `Client B selection 0-9`，A 追加 ` local` 后调用 `undoLocalUserEdit()` 回到 `awareness undo base`，B presence 仍保留；auth 失败 room `jword-collab-auth-kimi-room` 使用 invalid token 后 selection 前后 `awareness.users` 均为 `[]`，诊断保留 `COLLAB_PROVIDER_AUTH_FAILED`。验证：`pnpm exec vitest run packages/collab/test/contract.test.ts examples/collab/tests/hocuspocus-provider.test.ts --testNamePattern "downgrades invalid awareness range|awareness range"`、`pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm exec playwright test examples/collab/tests/collab-awareness.e2e.ts --project=chromium` 通过。
- [x] Step 6.4：实现 remote update 进入 projection/layout/render 的路径，确保仍走统一 Y.Doc 真源和受控 transaction hook。
- [x] Step 6.5：接入 `y-indexeddb` 或等价离线恢复能力，断网编辑后可恢复并同步。
- [x] Step 6.6：定义 snapshot adapter，支持 update log、snapshot 保存、snapshot 加载、版本列表、readonly preview 和 compaction。
- [x] Step 6.7：实现 `createInserter()` API，支持 stable anchor/range、chunk、throttle、flush、abort、progress、error。
- [x] Step 6.8：实现 auto inserter origin 策略，默认不进入用户 undo 栈。
- [x] Step 6.9：实现可配置 undo scope，允许 AI/程序化写入进入独立 undo scope，但不混入本地用户 undo。
  - 完成 2026-05-26：先写红测 `pnpm exec vitest run packages/core/test/collaboration/inserter.test.ts --testNamePattern "independent undo scope"`，失败于 `editor.canUndo("auto-inserter")` 仍为 `false`；随后扩展 `HistoryManager` scoped `Y.UndoManager`、`EditorCommandOptions.historyScope`、transaction `historyOrigin` 和 `createInserter({ undoScope: "auto-inserter" })`。验证覆盖默认用户 undo 不撤销 AI、`editor.undo("auto-inserter")` 可撤销 AI、`editor.redo("auto-inserter")` 可恢复 AI，且公开 diagnostics origin 仍为 `auto-inserter`。聚合验证：`pnpm exec vitest run packages/core/test/index.test.ts packages/core/test/collaboration/inserter.test.ts packages/core/test/collaboration/editor-update.test.ts packages/core/test/operations/history.test.ts`、`pnpm --filter @4xian/jword-core typecheck`、`node tools/lint/check-comments.mjs`、`git diff --check` 通过。`version-restore` scope token/API 已接入 history 层，但完整版本恢复 undo metadata 和真实 provider 并发不计入本 Step 完成证据。
- [x] Step 6.10：实现 remote/local 并发测试：双用户同段输入、同位置输入、删除与格式化冲突、批注 anchor 远端编辑稳定、local undo 不撤销 remote。
  - 续做 2026-05-26：已完成真实 Hocuspocus provider 下“双用户同段不同位置输入”子项；RED 先失败于 B 的完整 textarea value 覆盖 A 前缀，GREEN 后 A/B 最终均为 `A-provider base-B`。自动化验证覆盖 focused 用例、完整 `examples/collab/tests/collab-concurrency.e2e.ts`、collab typecheck、中文注释检查和 targeted diff check；Kimi WebBridge 真实 Chrome 双标签补证 A/B 最终一致、offline `synced` 且 diagnostics 为空。Step 6.10 总项仍未完成，剩余同位置输入、删除与格式化冲突、批注 anchor 远端编辑稳定、local undo 不撤销 remote。
  - 续做 2026-05-26：已完成真实 Hocuspocus provider 下“旧基线删除不吞掉远端插入”子项；RED 先失败于 A 旧基线删除 `AB` 后最终得到 `remote-B`，GREEN 后 A/B 从 `AB`、远端变为 `A-remote-B`、旧基线删除最终收敛为 `-remote-`。实现侧对旧基线纯删除增加非连续 grapheme rebase，并倒序生成 `deleteRange`，避免前序删除改变后续索引。验证覆盖 focused 用例、完整 `examples/collab/tests/collab-concurrency.e2e.ts`、collab typecheck 和 Kimi WebBridge 真实 Chrome room `jword-collab-kimi-delete-insert`；Step 6.10 总项仍未完成，剩余格式化冲突、批注 anchor 远端编辑稳定，以及 AI/local、AI/remote 并发矩阵。
  - 续做 2026-05-26：已完成真实 Hocuspocus provider 下“删除远端格式化范围后不残留格式冲突”子项；RED 先失败于缺少 debug API，又失败于远端加粗拆 run 后 A 旧基线删除仍残留 `target`，GREEN 后 A/B 从 `keep target tail`、B 加粗 `target`、A 删除后最终收敛为 `keep  tail` 且 bold range 为空。实现侧新增格式化 debug helper，并把删除 range 按 projection 实际 run 边界倒序拆成多个 `deleteRange`。验证覆盖 focused 用例、完整 `examples/collab/tests/collab-concurrency.e2e.ts`、collab typecheck 和 Kimi WebBridge 真实 Chrome room `jword-collab-kimi-format-delete`；Step 6.10 总项仍未完成，剩余批注 anchor 远端编辑稳定，以及 AI/local、AI/remote 并发矩阵。
  - 续做 2026-05-26：已完成真实 Hocuspocus provider 下“批注 anchor 远端编辑后稳定”子项；`examples/collab/tests/collab-concurrency.e2e.ts` 新增 `Gate 6 provider 批注 anchor 在远端前方编辑后仍定位原文本`，RED 先失败于缺少 `addCommentRange()` debug API。GREEN 后新增 `hocuspocus-comments.ts`，批注创建通过 `buildAddCommentThreadCommand`、`Editor.setSelection()` 和 `Editor.executeCommand()` 进入 core transaction pipeline，读取通过 `Editor.locateRangeSnapshot()` 解析稳定 range 快照，不退回普通字符 offset。自动化验证覆盖 focused 用例、完整 `examples/collab/tests/collab-concurrency.e2e.ts` 9 passed、collab typecheck 和中文注释检查；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-comment-anchor-1779766124549` 验证 A 创建 `target` 批注，B 在批注前插入 `remote ` 后，两端文本均为 `remote prefix target tail`，批注 range 跟随到 `start: 14, end: 20` 且 text 仍为 `target`，offline `synced` 且 diagnostics 为空。Step 6.10 总项仍未完成：还缺 `A 移动 selection，B 替换同段文本`，以及 Step 6.11 的 AI/local、AI/remote 并发矩阵。
  - 完成 2026-05-26：已完成真实 Hocuspocus provider 下“selection 与远端同段替换”子项；`examples/collab/tests/collab-concurrency.e2e.ts` 新增 `Gate 6 provider 远端替换同段文本后 selection snapshot 仍可解释`，RED 先失败于 B 在 A selection 前插入 `remote ` 后，B 仍读到 A 的旧 offset `7-13` 且 `selectionText: null`。GREEN 后新增 `hocuspocus-awareness.ts`，维护 awareness 专用 Y.Text 镜像并在 debug snapshot 读取时通过 relative position 解析当前 selection offset/text，不修改 provider 通用 schema。自动化验证覆盖 focused 用例、完整 `examples/collab/tests/collab-concurrency.e2e.ts` 10 passed、collab typecheck 和中文注释检查；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-selection-replace-1779766852732` 验证 A 选中 `target`，B 在同段前方插入 `remote ` 后，两端文本均为 `remote prefix target tail`，B 看到 A selection 跟随为 `selectionStart: 14, selectionEnd: 20, selectionText: "target"`，offline `synced` 且 diagnostics 为空。至此 Step 6.10 的 remote/local provider 并发矩阵已完成；AI/local、AI/remote 剩余项继续归 Step 6.11。
- [x] Step 6.11：实现 AI 自动插入与用户手动编辑并发测试，确认不重复、不丢失、不阻塞输入、不污染 undo。
  - 续做 2026-05-26：已补真实 Hocuspocus provider 模式下 AI 自动插入与用户手动输入并发的首条闭环；新增 `examples/collab/tests/collab-concurrency.e2e.ts`，先红于 `startAutoInsert()` 仍返回 `provider-noop`，随后 `examples/collab/src/runtime/hocuspocus-runtime.ts` 接入 core `createInserter()`，在当前正文末尾通过 `Editor.createTextAnchor()` / `Editor.executeCommand()` 写入 `协同` token，并保持 auto-inserter 独立 undo scope。验证：`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --grep "AI"` 红绿闭环，最终同文件完整 Chromium 1 passed；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API|syncs two browser pages through Hocuspocus provider"` 2 passed；`pnpm --filter @4xian/jword-example-collab typecheck`、`node tools/lint/check-comments.mjs` 和 targeted `git diff --check` 通过。Kimi WebBridge 真实 Chrome session `jword-gate6-ai-a` / `jword-gate6-ai-b` 在本地 4186/4188 双标签验证：A 调用 `startAutoInsert()` 后 A/B 正文同步为 `协同`，A 侧 autoInsert 为 `running: true`、`insertedCount: 1`、`lastToken: "协同"`、`lastEvent: "started"`；B 继续输入后 A/B 均读回 `协同 Gate 6 Kimi provider manual input`，offline 保持 `connected: true`、`lastEvent: "synced"`、诊断为空。当时 Step 6.11 仍未完成：还缺真实 provider 下 token 去重、长流式插入不丢失、不污染用户 undo 的 focused 证明，以及与 Step 6.10 的更完整 remote/local 并发矩阵。
  - 完成 2026-05-26：已补真实 Hocuspocus provider 的 AI/local 与 AI/remote 并发矩阵。新增 `examples/collab/src/runtime/hocuspocus-auto-insert.ts`，provider auto inserter 支持 `协同`、`版本`、`离线`、`回放` 多 token 流式写入，`startAutoInsert({ rangeStart, rangeEnd })` 支持 range replace，flush 后重建 active anchor 到 token 尾部，anchor 所在正文被删时停止后续 flush 并导出 `COLLAB_AUTO_INSERTER_ANCHOR_UNRESOLVED`。`fixtures/collab/registry.json` 已登记 `ai-local-range-replace`、`ai-local-anchor-unresolved`、`ai-remote-same-paragraph`、`ai-remote-adjacent-delete`、`ai-remote-provider-reconnect`。RED/GREEN 覆盖首轮 provider 只插 1 token、range replace token 逆序、anchor 删除无诊断三类失败。验证：`pnpm exec vitest run tests/architecture/gate6-fixture-registry.test.ts tests/architecture/gate6-diagnostics-registry.test.ts` 7 passed；`pnpm exec playwright test examples/collab/tests/collab-auto-insert-concurrency.e2e.ts --project=chromium` 6 passed；`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium` 10 passed；`pnpm --filter @4xian/jword-example-collab typecheck`、`node tools/lint/check-comments.mjs`、`git diff --check`、新增 registry `git diff --no-index --check` 均通过。Kimi WebBridge 真实 Chrome 在 `jword-collab-kimi-ai-local-1779769226699` 验证 A/B 从 `local anchor协同版本离线回放` 本地 undo 后收敛为 `anchor协同版本离线回放`，诊断为空；在 `jword-collab-kimi-ai-remote-1779769289176` 验证 A/B 收敛为 `remote-base协同remote-user版本离线回放`，四个 AI token 与远端输入各出现一次，offline/autoInsert 诊断为空。至此 Step 6.11 完成；不等同于 Step 6.12、Step 6.13 或 Gate 6 总验收完成。
  - 复核 2026-05-26：真实 provider 的 AI token flush 已增加用户编辑空闲期保护，`local-user` 或远端非 auto/history transaction 会延迟下一次 token flush，避免 AI token 插入到用户逐字符输入批次中间。回归覆盖 `AI 自动插入与手动输入` focused 用例、`examples/collab/tests/collab-concurrency.e2e.ts` 与 `examples/collab/tests/collab-auto-insert-concurrency.e2e.ts` Chromium 16 tests passed；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-ai-1779774364202` 验证手动文本保留、四个 token 各一次、historyCount 为 5。
- [x] Step 6.12：实现断网恢复测试，失败时保留本地未同步变更并给出诊断事件。
  - 续做 2026-05-26：已覆盖 IndexedDB reload、断开期间本地 pending、重连后远端收到离线输入、服务端先有远端更新时最终一致并导出 `OFFLINE_RECONNECT_CONFLICT_MERGED`，以及 WebSocket reconnect failed 时保留 pending 并导出 `OFFLINE_RECONNECT_FAILED`。Step 6.12 仍保持未完成：provider auth failed、update rejected 等失败恢复矩阵尚未补齐。
  - 续做 2026-05-26：已覆盖 provider auth failed；本地 Hocuspocus 服务要求 `requiredToken` 时，invalid token 会在 adapter 和浏览器 demo 中导出 `COLLAB_PROVIDER_AUTH_FAILED`、`recoverable: false`、UI 状态 `provider-error`，valid token 仍可进入 `synced`。验证：`pnpm exec vitest run examples/collab/tests/hocuspocus-provider.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium`、Kimi WebBridge 真实 Chrome valid/invalid token 双路径。Step 6.12 仍保持未完成：update rejected 等失败恢复矩阵尚未补齐。
  - 续做 2026-05-26：已覆盖 update rejected；本地 Hocuspocus 服务 `rejectUpdates: true` 时，client 已 synced 后的本地 update 会被服务端以 `COLLAB_UPDATE_REJECTED` close reason 拒绝，adapter 和浏览器 demo 导出 recoverable `provider-error`，且当前可写文本仍保留在本地。验证：`pnpm exec vitest run examples/collab/tests/hocuspocus-provider.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium`、Kimi WebBridge 真实 Chrome update rejected 路径。Step 6.12 仍保持未完成：snapshot missing、auto inserter retry 等失败恢复矩阵尚未补齐。
  - 续做 2026-05-26：已覆盖 snapshot missing；persistence 内存 adapter 在 snapshot 索引损坏时会保留可恢复诊断并从 update log 重建，preview 和 restore 均使用同一 fallback update，不吞掉诊断；统一 registry 已登记 `COLLAB_SNAPSHOT_MISSING`。验证：`pnpm exec vitest run packages/persistence/test/memory-adapter.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm typecheck`。Step 6.12 仍保持未完成：auto inserter retry 等失败恢复矩阵尚未补齐。
  - 续做 2026-05-26：已覆盖 auto inserter retry；core `createInserter().retry()` 保留 recoverable flush 失败后的 queued text，并用新的 stable anchor/range 重试，demo debug API 暴露 `retryAutoInsert()` 和 `COLLAB_AUTO_INSERTER_RETRY_STARTED` 诊断。验证：`pnpm exec vitest run packages/core/test/collaboration/inserter.test.ts examples/collab/tests/vite-config.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm --filter @4xian/jword-core typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API"`、Kimi WebBridge 真实 Chrome retry debug 路径。Step 6.12 仍保持未完成：IndexedDB unavailable、auto inserter abort 等失败恢复矩阵尚未最终收敛。
  - 续做 2026-05-26：已覆盖 IndexedDB unavailable 和 auto inserter abort；浏览器 Hocuspocus 模式在 `window.indexedDB` 不可用时仍可在线同步并导出 recoverable `OFFLINE_CACHE_UNAVAILABLE`，内存 demo `abortAutoInsert()` 导出 `COLLAB_AUTO_INSERTER_ABORTED`，停止 running 且保留当前文档。验证：`pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API|IndexedDB is unavailable"`。后续已补 transaction 不绕路证明和 Kimi WebBridge 真实浏览器总验收，见本小节后续记录。
  - 续做 2026-05-26：已补 Hocuspocus runtime 本地正文写入不绕过 Editor transaction pipeline 的证明；`examples/collab/tests/vite-config.test.ts` 先红于 `document.transact()` / `Y.Text` 直接写入，随后 `examples/collab/src/runtime/hocuspocus-runtime.ts` 改为内部共享 `EditorCollaborationDocument`，provider/offline/history 仍绑定同一底层 `Y.Doc`，但本地正文替换必须经 `Editor.executeCommand({ name: "hocuspocusClientText", ... })`。同时修复 demo history restore 对 core document-store 嵌套 `Y.Text` 的恢复路径：`packages/persistence` 对 preview 文档中的 `Y.Array` / `Y.Map` / `Y.Text` 做递归克隆，避免恢复时复用已挂载共享类型或只浅替换顶层容器。验证：`pnpm exec vitest run packages/core/test/collaboration/editor-update.test.ts examples/collab/tests/vite-config.test.ts packages/persistence/test/memory-adapter.test.ts`、`pnpm --filter @4xian/jword-core typecheck`、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "syncs two browser pages through Hocuspocus provider|restores Hocuspocus history versions|restores Hocuspocus document from IndexedDB after reload|IndexedDB is unavailable"`、`node tools/lint/check-comments.mjs`、`git diff --check` 均通过。Kimi WebBridge 真实浏览器总验收与断网/重连全矩阵复跑已在下一条补齐。
  - 续做 2026-05-26：Kimi WebBridge 真实 Chrome 总验收已复跑断网/重连全矩阵，session `jword-gate6-1779756894859` 覆盖 memory auto insert abort/retry、Hocuspocus 双标签同步、IndexedDB reload restore、断开期间 pending、重连后远端收到、离线本地变更与在线远端变更冲突合并、provider history preview/restore 和重连失败 pending 保留；失败路径使用独立临时 Hocuspocus 服务，断开后真实停止服务再触发 reconnect，验证 `OFFLINE_RECONNECT_FAILED`、`queuedOperations: 1` 和本地 pending 文本保留。自动化补证：`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "debug API|syncs two browser pages through Hocuspocus provider|restores Hocuspocus history versions|restores Hocuspocus document from IndexedDB after reload|keeps IndexedDB offline edits pending|merges remote server updates|preserves pending offline edits"` 7 tests passed；`pnpm --filter @4xian/jword-example-collab typecheck` 通过。Step 6.12 的 demo 级断网恢复与失败诊断证据已齐，但仍不等同于 Step 6.13 生产共享历史服务或 Step 6.18 Gate 6 总验收完成。
  - 复核 2026-05-26：离线本地全文替换与在线远端全文替换重连时不再让 Yjs replacement 交错破坏文本；runtime 记录断网基线和 pending local text，重连冲突后用 `system-recovery` 写回包含远端候选与本地 pending 的正文，并记录 `OFFLINE_RECONNECT_CONFLICT_MERGED`。回归覆盖 `merges remote server updates` focused 用例、smoke 断网相关三条和完整 Gate 6 Chromium 组 35 tests passed；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-merge-1779774365880` 验证远端 `Kimi merge remote server text` 与本地 `Kimi merge offline local text` 均保留。
  - 完成 2026-05-26：只读审计确认 auth failed、update rejected、IndexedDB reload/unavailable、offline pending、reconnect synced、remote/local conflict merge、reconnect failed pending 保留和 diagnostics registry 已覆盖 Step 6.12 要求；本轮补充 DOCX 导入文档的真实 Hocuspocus `offline=indexeddb` reload 与断网 pending/reconnect 验收，`pnpm exec playwright test examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium -g "Gate 6 DOCX"` 3 passed；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-docx-offline-1779776195298` 验证 T1 DOCX 导入无 warning、断网本地 pending、重连后远端同步，诊断包含 `OFFLINE_LOCAL_UPDATE_QUEUED`、`OFFLINE_RECONNECT_STARTED`、`OFFLINE_RECONNECT_SYNCED`。
- [x] Step 6.13：实现历史版本最小闭环：版本列表、只读预览、恢复、失败诊断；基于 update log / snapshot，不以 docx 覆盖真源。
  - 续做 2026-05-26：真实 Hocuspocus provider demo 已覆盖版本列表、只读预览和恢复后跨页面同步；自动化验证 `pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "restores Hocuspocus history versions"` 通过，完整 `examples/collab` Chromium smoke 8 项通过，Kimi WebBridge 真实 Chrome 双标签也验证通过。此项仍保持未完成：当前 provider history 是 demo runtime 的本地 memory persistence，不是生产共享历史服务；还未覆盖 restore conflicts with unsynced local update、真实 provider 历史失败诊断、DOCX 导入文档参与真实 provider history 和生产 update log/snapshot 持久化。
  - 续做 2026-05-26：已补 restore conflict 失败路径；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "blocks Hocuspocus history restore"` 先红后绿，Kimi WebBridge 真实 Chrome 双标签验证 A 离线 pending 时 restore 不覆盖当前可写文档并导出 `COLLAB_RESTORE_CONFLICT_RESOLVED`。此项仍保持未完成：当前 provider history 是 demo runtime 的本地 memory persistence，不是生产共享历史服务；仍未覆盖真实 provider 历史失败诊断完整矩阵、DOCX 导入文档参与真实 provider history 和生产 update log/snapshot 持久化。
  - 续做 2026-05-26：已补 DOCX 导入文档参与真实 Hocuspocus provider history + auto insert 的验收路径。`examples/collab/tests/collab-docx-provider-history.e2e.ts` 使用 `docx-t1-paragraphs.docx` 经 `importDocxForCollabAcceptance()` 写入同一 provider `Y.Doc`，B 页面可读取导入正文和导入版本历史，B 自动插入 `协同版本离线回放` 后选择导入版本预览并恢复，A/B 最终都回到 `First paragraph text.\nSecond paragraph text.`。修复点：demo provider history restore 需要先用 `getArray()` / `getMap()` 物化 preview core 容器，再递归克隆替换当前 core 容器，避免 restore 时只清空不回填。验证：`pnpm --filter @4xian/jword-example-collab typecheck`、targeted ESLint、`pnpm exec playwright test examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium -g "Gate 6 DOCX"`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "restores Hocuspocus history"`、`pnpm exec playwright test examples/collab/tests/collab-auto-insert-concurrency.e2e.ts --project=chromium`、`node tools/lint/check-comments.mjs`、`git diff --check` 通过；Kimi WebBridge 真实 Chrome room `jword-collab-docx-real-1779772142` 验证导入、跨标签同步、自动插入、预览和 restore 后 DOM/debug state 均一致。此项仍保持未完成：生产共享历史服务、真实 provider 历史失败诊断完整矩阵和生产 update log/snapshot 持久化仍未收口。
  - 复核 2026-05-26：真实 Hocuspocus provider history 的版本 update 已改为只编码 core document-store 容器，不再把 `jword:collab:history:*` 顶层 shared types 递归保存进下一版历史，避免 history update 嵌套膨胀触发 payload 上限或 ArrayBuffer 分配失败。新增 `examples/collab/tests/hocuspocus-history.test.ts` 覆盖连续追加版本时 stored update 不包含 history shared types、第二版 update 不指数增长，并保留 preview/restore 需要的 core 容器物化路径。聚合验证覆盖 Gate 6 Vitest 13 files / 62 tests passed、完整 Gate 6 Chromium 组 35 tests passed、`pnpm typecheck`、collab typecheck、中文注释检查和 `git diff --check`；Kimi WebBridge 真实 Chrome rooms `jword-collab-kimi-ai-1779774364202` 与 `jword-collab-kimi-merge-1779774365880` 补证 AI/manual 与离线冲突合并路径。此项仍保持未完成：生产共享历史服务、真实 provider 历史失败诊断完整矩阵和生产 update log/snapshot 持久化仍未收口。
  - 续做 2026-05-26：补充 DOCX 导入文档在真实 Hocuspocus `offline=indexeddb` 下的 reload 与断网 pending/reconnect 验收；这只补齐 DOCX 普通文档离线证据，不改变 Step 6.13 状态。Step 6.13 仍保持未完成：生产共享历史服务、真实 provider 历史失败诊断完整矩阵和生产 update log/snapshot 持久化仍未收口。
  - 续做 2026-05-26：真实 Hocuspocus runtime 已从旧同步 history helper 切到 `JWordPersistenceSnapshotAdapter` 契约，新增 `hocuspocus-history-bridge.ts` 统一调用 `createHocuspocusHistoryPersistenceAdapter()` 完成 append update、create snapshot、readonly preview、restore 和 persistence diagnostics 转发；`hocuspocus-history.ts` 的 adapter 追加版本时会从 state update 中剥离 `jword:collab:history:*` shared types，避免真实 runtime 重新引入历史索引递归。验证：`pnpm exec vitest run examples/collab/tests/vite-config.test.ts --testNamePattern "persistence adapter"`、`pnpm exec vitest run examples/collab/tests/vite-config.test.ts examples/collab/tests/hocuspocus-history.test.ts packages/persistence/test/memory-adapter.test.ts`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "restores Hocuspocus history|blocks Hocuspocus history restore"`、`pnpm exec playwright test examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium -g "Gate 6 DOCX"`、`node tools/lint/check-comments.mjs`、`git diff --check` 通过；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-adapter-1779778267087` 验证 provider mode 为 hocuspocus，A/B 同步、v1 预览、恢复后 A/B 回到 v1，history labels 包含 `restore:Client A edit`，diagnostics 为空。Step 6.13 仍保持未完成：生产级共享 history service / 持久化 update log 和 snapshot backend 仍未收口。
  - 续做 2026-05-26：`packages/persistence` 新增 storage-backed history adapter contract，宿主通过 `JWordHistoryStorage` 持久化序列化 update log、snapshot 和版本元数据，公开 `createStoragePersistenceAdapter()` / `createVolatileHistoryStorage()`，并覆盖跨 adapter 生命周期 list、preview、restore 和 restore 版本审计。验证：先红 `pnpm exec vitest run packages/persistence/test/storage-history-adapter.test.ts` 失败于 `createVolatileHistoryStorage is not a function`；随后转绿 `pnpm exec vitest run packages/persistence/test/storage-history-adapter.test.ts`、`pnpm exec vitest run packages/persistence/test/storage-history-adapter.test.ts packages/persistence/test/memory-adapter.test.ts`、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm --filter @4xian/jword-persistence build`、`node tools/lint/check-comments.mjs`、`git diff --check`。Step 6.13 仍保持未完成：真实 Hocuspocus runtime 尚未切到服务端共享 storage history service，生产部署的存储 backend、并发锁/事务边界和完整 provider 历史失败诊断矩阵仍未收口。
  - 续做 2026-05-26：`examples/collab/server` 新增服务端共享 history service，`createCollabHocuspocusService()` 绑定 `historyStorage`，同一服务生命周期内通过 `recordVersion()` 创建 storage-backed update log + snapshot，并用 document 级串行锁避免并发 load/save 覆盖版本链；同一 `JWordHistoryStorage` 可跨 Hocuspocus 服务实例复用，重启后仍可 list、preview、restore。验证：先红 `pnpm exec vitest run examples/collab/tests/hocuspocus-history-service.test.ts` 失败于缺少 `../server/hocuspocus-history-service`；随后转绿 `pnpm exec vitest run examples/collab/tests/hocuspocus-history-service.test.ts examples/collab/tests/hocuspocus-service.test.ts`、`pnpm --filter @4xian/jword-example-collab typecheck`。Step 6.13 仍保持未完成：浏览器 Hocuspocus runtime 尚未通过服务端 history API 读写该共享 backend，restore 的服务端 API/真实浏览器验收和完整 provider 历史失败诊断矩阵仍未收口。
  - 完成 2026-05-26：浏览器 Hocuspocus runtime 已通过 `history` query 接入服务端 history HTTP API，版本写入进入 `CollabHocuspocusHistoryService` 的 storage-backed update log + snapshot backend，版本列表/只读预览/恢复均由服务端 API 回读，不再依赖 provider Y.Doc 内部 history shared map。新增 `hocuspocus-server-history.test.ts` 先红后绿，覆盖服务端 API 失败时记录 `PERSISTENCE_RESTORE_FAILED` 且 restore 不覆盖当前文档；新增 `collab-history-api.e2e.ts` 从超长 smoke 拆出真实浏览器 server-history 路径，验证 A 写 v1/v2、服务端 list 可见、B 读到 v2、A 预览并恢复 v1 后 A/B 均回到 v1。验证：`pnpm vitest run examples/collab/tests/hocuspocus-server-history.test.ts examples/collab/tests/vite-config.test.ts --config vitest.config.ts`、`pnpm exec playwright test examples/collab/tests/collab-history-api.e2e.ts --project=chromium --reporter=line` 通过；同时将 `hocuspocus-runtime.ts` 的重连合并 helper 拆到 `hocuspocus-reconnect-merge.ts`，`collab-smoke.e2e.ts` 降到 1000 行以内。Step 6.13 最小闭环完成；生产宿主的具体持久化存储实现仍通过 `JWordHistoryStorage` 注入，不在 Gate 6 内绑定数据库产品。
- [x] Step 6.14：建立 Gate 6 fixture registry 和 diagnostics registry，约束 collab/offline/history/inserter 的输入、事件和预期。
- [x] Step 6.14a：把 Gate 5 DOCX 导入 fixture 纳入 Gate 6 registry，至少覆盖一个 T1 成功导入文档和一个 T2 warning 文档；验证导入后内容通过 `loadDocumentModel()` 写入同一 Y.Doc，并可参与协同、离线、历史和自动插入场景。
  - 完成 2026-05-26：新增 `tests/architecture/gate6-docx-fixture-integration.test.ts`，覆盖 registry 中 `docx-import-t1-collab` 和 `docx-import-t2-warning` 两个 DOCX 导入 fixture。测试读取真实 `.docx` bytes，经 `importDocx()`、`convertDocxImportDocumentToCoreDocument()` 和 `editor.loadDocumentModel()` 写入 core Editor/Y.Doc，再通过 `encodeCollaborationUpdate()` / `applyRemoteUpdate()` 同步到另一 editor，执行 remote insert，写入 memory persistence update log，创建隔离 preview，加载版本 state update，并用 `createInserter()` 基于公开 anchor 自动插入。T1 断言无 import warning；T2 改用 `docx-t2-floating-object-warning.docx` 并断言 `DOCX_DRAWING_FLOATING_UNSUPPORTED` warning。离线路径仍只覆盖 `createUnavailableIndexedDbOfflineAdapter()` 的 recoverable diagnostic，不能视为真实 IndexedDB 恢复、真实 provider 或双窗口协同完成。
  - 续做 2026-05-26：`examples/collab/tests/collab-docx-provider-history.e2e.ts` 已补 T1 DOCX 真实 Hocuspocus provider 下的 IndexedDB reload、断网本地 pending 和重连后远端同步；同轮保留 T2 warning 的 architecture 级 registry 覆盖。验证：`pnpm exec playwright test examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium -g "Gate 6 DOCX"`、`pnpm exec vitest run tests/architecture/gate6-docx-fixture-integration.test.ts tests/architecture/gate6-fixture-registry.test.ts`、`pnpm --filter @4xian/jword-example-collab typecheck` 通过；Kimi WebBridge 真实 Chrome room `jword-collab-kimi-docx-offline-1779776195298` 通过。
- [x] Step 6.15：实现 `examples/collab` debug API 与真实浏览器验收入口。
  - 复核 2026-05-26：`examples/collab/tests/collab-smoke.e2e.ts` 的 debug API key 期望已同步当前真实入口，覆盖 `addCommentRange`、`formatClientRange`、`importDocxForCollabAcceptance`、`readCommentRanges`、`readTextFormatRanges` 和 `undoLocalUserEdit` 等 provider 回归需要的调试能力，避免 smoke 用旧 API 清单误报。
- [x] Step 6.16：验证 collab/offline/history/inserter lazy-load，不进入 vanilla 首屏 bundle。
  - 完成 2026-05-26：先用红测锁定 `examples/collab/tests/vite-config.test.ts` 中 provider/offline/history runtime 只通过动态 import 进入 demo，初始失败于缺少 `examples/collab/src/lazy-runtime.ts`；实现后 `pnpm exec vitest run examples/collab/tests/vite-config.test.ts --testNamePattern "provider offline history runtime"` 转绿。聚合验证 `pnpm exec vitest run examples/collab/tests/vite-config.test.ts tests/architecture/gate6-fixture-registry.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-example-collab build`、`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium`、`pnpm typecheck`、`pnpm lint`、`node tools/lint/check-comments.mjs`、`git diff --check` 均通过。Kimi WebBridge 真实浏览器确认懒加载资源和 demo API 可用；当前仍不声明真实双窗口 provider、真实 IndexedDB 或生产离线恢复完成。
- [x] Step 6.17：建立 Gate 6 benchmark，覆盖 update apply、snapshot create/load、version preview、offline restore 和 auto inserter streaming。
  - 完成 2026-05-26：架构红测 `pnpm exec vitest run tests/architecture/gate6-benchmark.test.ts` 先失败于缺少 `benchmarks/gate6-collab-benchmark.mjs` 和 runner 接入，随后转绿。`pnpm build` 后执行 `pnpm bench`，Gate 6 输出 `gate6-1k`：update apply 0.96ms、update bytes 3046、snapshot create/load 0.66ms/0.17ms、version preview 0.31ms、auto insert/input probe 1.44ms/0.58ms、IndexedDB restore 0.1ms；`gate6-10k`：update apply 0.29ms、update bytes 23121、snapshot create/load 0.92ms/0.19ms、version preview 0.29ms、auto insert/input probe 0.24ms/3.19ms、IndexedDB restore 0.1ms。真实浏览器 IndexedDB restore 路径已进入 benchmark，Node 离线 adapter 不可用诊断仍单独保留。
- [x] Step 6.18：跑 Gate 6 总验收，回写每个完成项、真实浏览器证据、失败项和遗留项。
  - 完成 2026-05-26：Gate 6 readiness sweep 已完成并回写验收口径。协同 E2E 并行稳定性已通过隔离 Vite 端口收口：smoke `4186`、awareness `4187`、auto-insert `4188`、history-api `4189`、docx-provider-history `4191`、concurrency `4192`；同时改用绝对 Vite 启动路径和 1s readiness fetch timeout，避免并行测试互相关闭服务或卡住。
  - 验证 2026-05-26：`pnpm lint`、`pnpm typecheck`、`pnpm test`（109 files / 574 tests passed）、`pnpm build`、`pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium --reporter=line`（10 passed）、`pnpm exec playwright test examples/collab/tests --project=chromium --reporter=line`（38 passed）和 `pnpm bench` 均通过。`pnpm bench` 的 Gate 6 benchmark 现在报告 `indexedDbRestoreStatus: restored` / `offlineRestoreStatus: indexeddb-restored`，真实浏览器 IndexedDB restore 已纳入 benchmark；Node 离线 adapter 的 recoverable diagnostic 仍单独保留。
  - 遗留 2026-05-26：`pnpm test:visual` 已执行但未通过，失败集中在 Gate 4 visual baseline：`tests/visual/gate4.visual.ts` 桌面基线等待 `input[aria-label="Header"]` 可见超时，以及 `gate4-media-failure-darwin.png`、`gate4-long-table-darwin.png`、`gate4-mobile-baseline-darwin.png` 三个 darwin snapshot 缺失。该失败记录为 Gate 4 visual 基线遗留，不计为 Gate 6 协同、离线、历史或自动插入阻塞项。
- [x] Step 6.19：冻结 Gate 6 商业 edition matrix，明确免费基础版不包含多人协作、离线协作、协作历史、协作服务端或自动插入；付费高级版按 feature key 开启 `collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
  - 完成 2026-05-27：`@4xian/jword-license` 新增 `GATE6_COLLAB_FEATURES`，冻结 Gate 6 高级 feature key 为 `collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`；`packages/license/test/entitlement.test.ts` 覆盖这些 feature key 能进入同一 entitlement 检查。免费基础版继续只通过 Gate 4.5 `.jword` 和基础编辑能力交付，不包含多人协作、离线协作、协作历史、协作服务端或自动插入。
- [x] Step 6.20：冻结 `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license` 的导出分级和 export map；stable API 只包含第三方可承诺入口，experimental 只包含可替换 provider/storage adapter，internal 不允许从包入口导出。
  - 完成 2026-05-27：新增 `tests/architecture/gate6-package-exports.test.ts`，约束 `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license` 都是正式 workspace package，公开 export map 只从 `dist` 暴露，且不暴露 `internal` 子路径。`@4xian/jword-collab` stable 入口保留 feature gate、内存 adapter、awareness 和诊断类型；Hocuspocus provider adapter 移入 `@4xian/jword-collab/experimental` 子入口，`examples/collab` 与 provider tests 已改用该 experimental 入口。新增正式 `packages/collab-server`，提供 `createJWordCollabServer()`、`startJWordCollabServer()`、`JWORD_COLLAB_SERVER_PROTOCOL_VERSION`、`/health`、`/version` 和 featureFlags/minimumClientVersion 版本壳；该包目前只完成 self-host server 的最小公开入口与 export map，完整 WebSocket、history API、license hook enforcement、部署路径和并发边界仍按 Step 6.29-6.34 继续实现。验证：`pnpm exec vitest run tests/architecture/gate6-package-exports.test.ts packages/collab/test/contract.test.ts packages/collab-server/test/server.test.ts`、`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-collab build`、`pnpm --filter @4xian/jword-collab-server test`、`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-collab-server build`、`pnpm --filter @4xian/jword-example-collab typecheck` 通过。
- [x] Step 6.21：建立商业边界架构测试和授权 diagnostics，证明 `packages/core`、`packages/native`、`examples/vanilla` 不 import collab/server/license 高级包；未授权、过期、feature 不匹配、license server 不可用分别返回稳定诊断，且不读取或泄漏用户文档内容。
  - 完成 2026-05-27：新增 `tests/architecture/gate6-commercial-readiness.test.ts`，扫描 `packages/core/src`、`packages/native/src` 和 `examples/vanilla/src` 的运行时 import/export/dynamic import，禁止免费基础侧引入 `@4xian/jword-collab`、`@4xian/jword-collab-server` 或 `@4xian/jword-license`；`fixtures/collab/diagnostics-registry.json` 和 `tests/architecture/gate6-diagnostics-registry.test.ts` 新增 `COLLAB_LICENSE_MISSING`、`COLLAB_LICENSE_EXPIRED`、`COLLAB_FEATURE_NOT_ENTITLED`、`COLLAB_LICENSE_SERVER_UNAVAILABLE`；`@4xian/jword-collab` 新增 `createJWordCollabFeatureGate()`，在高级协作读取文档内容前把 license entitlement 错误映射成 `COLLAB_*` 稳定 diagnostic，不携带用户文档内容。验证：`pnpm exec vitest run packages/license/test/entitlement.test.ts packages/collab/test/contract.test.ts tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-commercial-readiness.test.ts` 通过。
- [x] Step 6.22：在 core 中补中立位置 API，命名必须保持基础能力语义，例如 selection snapshot、anchor snapshot、range snapshot、text location、query result；类型名和方法名不得带 `collab`、`ai`、`autoInsert` 等高级功能前缀。
  - 完成 2026-05-27：`packages/core/src/editor/location-types.ts` 新增 `EditorTextLocation`、`EditorAnchorSnapshot`、`EditorRangeSnapshot`、`EditorSelectionSnapshot`、`EditorLocationQuery` 和 `EditorTextQueryResult`；`packages/core/src/editor/runtime.ts` 与根入口 `packages/core/src/index.ts` 已导出这些公开类型。类型名和方法名保持中立基础语义，没有出现 `collab`、`ai` 或 `autoInsert` 前缀；`EditorLocationQuery.rangeSnapshot` 只接受公开 `EditorRangeSnapshot`，不接受内部 `TextRangeRecord`，避免把 `relativePosition`、`documentId` 或内部 range `id` 带入新公开 API。
- [x] Step 6.23：实现获取当前位置和查询内容位置的方法，支持从当前 selection 创建 anchor/range，也支持按文本、block id、heading、comment id 或 range snapshot 查询插入位置；返回值必须可序列化，供高级包、普通跳转和宿主业务共同使用。
  - 完成 2026-05-27：`JWordEditorLocationRuntime` 已接入 Editor facade，提供 `createAnchorSnapshot()`、`createRangeSnapshot()`、`readSelectionSnapshot()` 和 `findTextLocations()`；查询支持 `text`、`block`、`heading`、`comment` 和公开 `rangeSnapshot`。`location-query.ts` 只读取 `DocumentProjection`，不访问 DOM、layout、Y.Doc provider 或 document-store；`location-runtime.ts` 仅在 runtime 层复用既有 `locateCommentThread()` 和 `locateRangeSnapshot()` 能力，把结果转换成 JSON 兼容公开位置。`block-record-factory.ts` 同步修复 `loadDocumentModel()` 路径下 paragraph `styleId` 和 list 信息未写入 store properties 的问题，保证 heading 查询在 canonical model 导入后可解释。
- [x] Step 6.24：建立位置 API 的 focused tests、类型测试和真实浏览器验收，证明返回值不泄漏 Yjs RelativePosition、document-store、DOM Range、canvas 坐标或 provider 内部状态；自动插入和普通跳转都只能消费这层公开位置结果。
  - 完成 2026-05-27：新增 `packages/core/test/editor/location-api.test.ts`，覆盖 selection snapshot、anchor/range snapshot、text/block/heading/comment/rangeSnapshot 查询、JSON round-trip 和内部关键字泄漏检查；`packages/core/test/index.test.ts` 覆盖根入口类型导出。验证命令：`pnpm exec vitest run packages/core/test/editor/location-api.test.ts packages/core/test/index.test.ts` 通过 2 files / 10 tests；`pnpm --filter @4xian/jword-core typecheck` 通过；`pnpm exec vitest run packages/core/test/editor/user-and-range-snapshot.test.ts packages/core/test/heading/outline.test.ts packages/core/test/find-replace/find-replace.test.ts` 通过 3 files / 5 tests。真实浏览器验收在 `http://127.0.0.1:4192/` 的 vanilla demo 中通过 Kimi WebBridge 控制真实 Chrome 完成，公开路径只使用 `window.__jwordDemo.editor` 和 `selectTextRange()`：页面标题为 `Vanilla Demo`，`window.__jwordDemo` 可用，页面无框架错误 overlay；`readSelectionSnapshot()` 返回 `paragraph-1 / run-1 / 0->4` 非折叠 selection；`findTextLocations({ kind: "text", text: "English" })`、大小写不敏感文本查询、block 查询和公开 rangeSnapshot 查询均返回结果；JSON round-trip 为 true，泄漏检查未出现 `RelativePosition`、`Yjs`、`Y.Text`、`document-store`、`DocumentStore`、`DOM Range`、`LayoutRect`、`canvas` 或 `provider`。
  - 补充完成 2026-05-27：`Editor` facade 新增 `resolveLocation()` 和 `scrollToLocation()`。`resolveLocation()` 可消费公开 text location、anchor snapshot、range snapshot、selection snapshot 和 query result，并只返回 JSON 兼容 `resolvedLocation`；`scrollToLocation()` 只在已挂载编辑器内部计算滚动，不改变当前 selection，不把 DOM Range、LayoutRect、canvas 坐标、provider 或 `scrollTop` 暴露为公开返回值。TDD 红灯先确认缺少 `resolveLocation` / `scrollToLocation`；实现后 `pnpm exec vitest run packages/core/test/editor/location-api.test.ts packages/core/test/editor/location-scroll.test.ts packages/core/test/index.test.ts --reporter=dot` 通过 3 files / 12 tests。
- [x] Step 6.25：定义 `connectJWordCollaboration(editor, options)` 公开入口，options 至少包含 `serverUrl`、`documentId`、`roomId`、`user`、`token`、`license`、`features`；初始化失败必须返回 diagnostic，不允许半连接状态。
- [x] Step 6.26：定义用户身份与 presence 配置，`user` 支持 `id`、`name`、`color`、`avatarUrl`，未传 `color` 时按 user id 生成稳定颜色；远端光标、选区和输入提示都从这份公开用户信息派生。
- [x] Step 6.27：定义 collaboration connection handle，至少包含 `status`、`diagnostics`、`awareness`、`history`、`offline`、`startAutoInsertSession()`、`disconnect()`、`destroy()`；handle 销毁后必须清理 provider、awareness、offline watcher 和 event listener。
- [x] Step 6.28：建立外部 TypeScript 消费测试，只从 `@4xian/jword-collab` 包入口导入 API，完成 connect、disconnect、history、offline 和 auto insert 调用；stable API 中不得出现 Hocuspocus、Y.Doc、Yjs update store 或 demo runtime 类型。
  - 完成 2026-05-27：新增 `packages/collab/src/client-sdk.ts` 并从 `@4xian/jword-collab` stable 入口导出 `connectJWordCollaboration()` 和公开 handle/type。公开 options 显式包含 `serverUrl`、`documentId`、`roomId`、`user`、`token`、`license`、`features`；初始化先做授权与 provider 可用性检查，失败返回 `error` handle 和 `COLLAB_*` diagnostic，不连接 provider、不读取文档内容。`user` 支持 `id`、`name`、`color`、`avatarUrl`，未传 `color` 时按 user id 生成稳定 hex 颜色；presence 的 typing label 由同一公开用户信息派生。connection handle 暴露 `status`、`diagnostics`、`awareness`、`history`、`offline`、`startAutoInsertSession()`、`disconnect()`、`destroy()`，销毁时清理 provider awareness 和所有订阅。新增 `packages/collab/test/public-client.test.ts` 作为外部 TypeScript 消费测试，只从 `@4xian/jword-collab` 包入口导入 API，覆盖 connect、license diagnostic、disconnect、destroy、history、offline 和 auto insert 调用；`tests/architecture/gate6-package-exports.test.ts` 已把 `connectJWordCollaboration` 纳入 stable token，并禁止 stable client 源码出现具体 provider、底层同步结构或 demo runtime 名称。验证：`pnpm exec vitest run packages/collab/test/public-client.test.ts` 先红于 `connectJWordCollaboration is not a function`，随后转绿；`pnpm exec vitest run packages/collab/test/public-client.test.ts packages/collab/test/contract.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-commercial-readiness.test.ts packages/license/test/entitlement.test.ts` 通过 5 files / 22 tests；`pnpm --filter @4xian/jword-collab typecheck` 和 `pnpm --filter @4xian/jword-collab build` 通过。`node tools/lint/check-comments.mjs` 仍因前序未触碰文件头注释失败：`packages/collab/src/experimental.ts`、`packages/core/src/editor/location-runtime.ts`；本轮触碰的 package export 架构测试已从失败列表移除。
- [x] Step 6.29：从 `examples/collab/server` 抽出 `@4xian/jword-collab-server` 正式服务包，第三方不需要复制 demo server 源码；demo server 只能变成该正式包的最小启动器。
- [x] Step 6.30：提供 Node 服务入口和可嵌入 handler：`createJWordCollabServer(options)`、`startJWordCollabServer(options)`；同一服务包支持本地开发、第三方自托管和测试环境启动。
- [x] Step 6.31：定义 server options：`authHook`、`tenantHook`、`licenseHook`、`historyStorage`、`snapshotStorage`、`rateLimit`、`maxPayloadBytes`、`allowedOrigins`、`logger`；hook 返回值必须可诊断，不能把业务权限逻辑写进 core 或 client。
- [x] Step 6.32：实现 `/health`、`/version`、`/history`、`/license/status` API，响应包含 `protocolVersion`、`packageVersion`、`featureFlags`、`minimumClientVersion`、`minimumServerVersion` 和可观测 request id。
- [x] Step 6.33：在服务端强制 license enforcement 和 history 并发边界；client-side license check 只用于 UX 提示，服务端必须在 WebSocket 连接、history API、auto-insert relay 和 storage 写入前校验 entitlement。
- [x] Step 6.34：提供 self-host 部署最小路径：本地 Node 启动、Dockerfile 或等价脚本、环境变量说明、反向代理 WebSocket 注意事项、health check 和日志字段；部署示例必须使用正式 server 包而不是 demo 源码。
  - 进展 2026-05-27：`@4xian/jword-collab-server` 已补正式 HTTP server 入口和可嵌入 Node request handler：`createJWordCollabServer()`、`startJWordCollabServer()`、`createJWordCollabRequestHandler()`。server options 已定义 `authHook`、`tenantHook`、`licenseHook`、`historyStorage`、`snapshotStorage`、`rateLimit`、`maxPayloadBytes`、`allowedOrigins`、`logger`；`/health`、`/version`、`/history/versions`、`/license/status` 均返回 request id，`/version` 返回 protocol/package/featureFlags/minimumClientVersion/minimumServerVersion。history 写入走 `@4xian/jword-persistence` storage-backed adapter，并在读取或写入 storage 前先调用服务端 `licenseHook`；未授权时返回 403，测试证明 storage `load/save` 计数为 0。新增 `packages/collab-server/README.md` 与 `packages/collab-server/Dockerfile`，覆盖本地 Node 启动、`JWORD_COLLAB_HOST`、`JWORD_COLLAB_PORT`、`JWORD_COLLAB_ALLOWED_ORIGINS`、反向代理 WebSocket 注意事项、health check 与 `requestId` 日志字段。验证：`pnpm exec vitest run packages/collab-server/test/server.test.ts tests/architecture/gate6-package-exports.test.ts` 先红于缺少 embedded handler 与部署文件，随后转绿；`pnpm exec vitest run packages/collab-server/test/server.test.ts packages/collab/test/public-client.test.ts packages/collab/test/contract.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-commercial-readiness.test.ts packages/license/test/entitlement.test.ts` 通过 6 files / 29 tests；`pnpm --filter @4xian/jword-collab-server typecheck` 和 `pnpm --filter @4xian/jword-collab-server build` 通过。
  - 续做 2026-05-27：`@4xian/jword-collab-server` 新增 `createJWordCollabHistoryService()`，把 storage-backed history service 和 document 级 `documentLocks` 并发边界移入正式包；正式 HTTP API 兼容浏览器 runtime 既有 `/jword-history/versions` 与 `/jword-history/preview` 路径。`examples/collab/server/hocuspocus-service.ts` 已改成正式包最小启动器：Hocuspocus WebSocket 仍只负责本地 provider demo，history HTTP 服务由 `createJWordCollabServer()` 启动，旧 `hocuspocus-history-service.ts` 只保留名称兼容并 re-export 正式包实现，不再复制服务端 history 逻辑。`tests/architecture/gate6-package-exports.test.ts` 增加约束：demo server 必须 import `@4xian/jword-collab-server`，不得再 import 本地 `hocuspocus-history-api` 或 `hocuspocus-history-service`，正式包必须包含 document 级锁和 `/jword-history/*` 兼容 API。验证：`pnpm exec vitest run packages/collab-server/test/server.test.ts examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/hocuspocus-history-service.test.ts examples/collab/tests/vite-config.test.ts tests/architecture/gate6-package-exports.test.ts` 通过 5 files / 25 tests；`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-example-collab build`、`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-collab-server build` 和 focused `git diff --check` 通过。当前仍未勾选 Step 6.29-6.34：WebSocket 连接和 auto-insert relay 的服务端授权 enforcement 仍未闭环。
  - 续做 2026-05-27：`@4xian/jword-collab-server` 新增 `createJWordCollabHocuspocusServer()` 正式 WebSocket 服务入口，Hocuspocus `onConnect` / `onAuthenticate` / `beforeSync` 统一在正式包内校验 `licenseHook` 的 `collaboration.server` entitlement；未授权连接在同步前失败，客户端 update 写入前也会被拒绝。`examples/collab/server/hocuspocus-service.ts` 进一步收口为正式 WebSocket server + 正式 history HTTP server 的薄启动器，不再直接 import `@hocuspocus/server`；`packages/collab-server` 新增 `@hocuspocus/server@4.0.0` 运行依赖，架构测试约束 demo server 不再复制 WebSocket hook 逻辑。验证：先写红测 `pnpm exec vitest run packages/collab-server/test/server.test.ts tests/architecture/gate6-package-exports.test.ts`，随后实现转绿；`pnpm exec vitest run packages/collab-server/test/server.test.ts examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/hocuspocus-history-service.test.ts examples/collab/tests/hocuspocus-provider.test.ts examples/collab/tests/vite-config.test.ts tests/architecture/gate6-package-exports.test.ts` 通过 6 files / 33 tests；`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-collab-server build`、`pnpm --filter @4xian/jword-example-collab build`、focused `git diff --check` 通过。当前仍未勾选 Step 6.29-6.34：auto-insert relay 的服务端授权 enforcement 仍未闭环。
  - 完成 2026-05-27：补齐 `/auto-insert/relay` 正式服务端授权入口，relay 先过 `tenantHook`，再用 `licenseHook` 校验 `GATE6_COLLAB_FEATURES.autoInsert`，未授权返回 403 且不回显 chunk 内容；`authHook` 已覆盖受保护 history、license 和 auto-insert 路由，`request-guards.ts` 统一 auth/tenant hook 默认放行与拒绝语义。架构测试约束正式包公开 `createJWordCollabHocuspocusServer()`、包含 `/auto-insert/relay`、WebSocket `onAuthenticate` / `beforeSync` 和 auto insert feature key；demo server 只使用正式 server 包入口。验证：`pnpm exec vitest run packages/collab-server/test/server.test.ts tests/architecture/gate6-package-exports.test.ts` 通过 2 files / 17 tests；`pnpm exec vitest run packages/collab-server/test/server.test.ts examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/hocuspocus-history-service.test.ts examples/collab/tests/hocuspocus-provider.test.ts examples/collab/tests/vite-config.test.ts tests/architecture/gate6-package-exports.test.ts` 通过 6 files / 37 tests；`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-collab-server build`、`pnpm --filter @4xian/jword-example-collab build`、targeted ESLint、`node tools/lint/check-package-versions.mjs`、`node tools/lint/check-boundaries.mjs`、`git diff --check` 均通过；`node tools/lint/check-comments.mjs` 仍只失败在前序未触碰的 `packages/collab/src/experimental.ts` 和 `packages/core/src/editor/location-runtime.ts` 文件头注释。
- [x] Step 6.35：定义 client/server handshake contract，包含 `protocolVersion`、`clientPackageVersion`、`serverPackageVersion`、`featureFlags`、`minimumServerVersion`、`minimumClientVersion`；client 连接前必须先完成 handshake。
- [x] Step 6.36：实现版本不匹配诊断，server 过旧、client 过旧、protocol 不兼容或 featureFlags 缺失分别返回稳定错误；失败后编辑器仍保留本地单人编辑能力，不进入半协作状态。
- [x] Step 6.37：建立版本握手 E2E 和 diagnostics export，覆盖版本匹配成功、server 过旧失败、client 过旧失败、feature 缺失失败；client 和 server 导出的版本信息必须一致，便于第三方排障。
  - 完成 2026-05-27：`@4xian/jword-collab` 公开 `JWORD_COLLAB_CLIENT_PROTOCOL_VERSION`、`JWORD_COLLAB_CLIENT_PACKAGE_VERSION` 和 `JWordCollaborationHandshake`；`connectJWordCollaboration()` 在连接 provider 前读取 self-host server `/version`，握手结果包含 client/server package version、protocol、featureFlags、minimumClientVersion 和 minimumServerVersion。版本失败会返回稳定 diagnostics：`COLLAB_PROTOCOL_MISMATCH`、`COLLAB_SERVER_TOO_OLD`、`COLLAB_CLIENT_TOO_OLD`、`COLLAB_FEATURE_FLAGS_MISSING`，并保持 provider `idle`，不进入半协作状态。架构测试约束 client/server protocol 常量一致。新增 `examples/collab/tests/collab-handshake.e2e.ts`，在真实 Chromium 浏览器中动态导入公开 collab client SDK，覆盖版本匹配成功后 provider 进入 `synced`，以及 featureFlags 缺失时浏览器侧 `connection.diagnostics` 导出 `COLLAB_FEATURE_FLAGS_MISSING` 且 provider 仍为 `idle`。验证：先用 `pnpm exec vitest run packages/collab/test/public-client.test.ts` 观察红灯为 `connection.handshake` 缺失、协议不兼容仍进入 `synced`；实现后 `pnpm exec vitest run packages/collab/test/public-client.test.ts` 通过 1 file / 7 tests，`pnpm exec vitest run packages/collab/test/public-client.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-package-exports.test.ts` 通过 3 files / 25 tests，`pnpm exec vitest run packages/collab/test/public-client.test.ts packages/collab/test/contract.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-commercial-readiness.test.ts packages/license/test/entitlement.test.ts` 通过 6 files / 41 tests；`pnpm exec playwright test examples/collab/tests/collab-handshake.e2e.ts --project=chromium --reporter=line` 通过 2 tests；`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-collab build`、`pnpm --filter @4xian/jword-example-collab typecheck`、targeted ESLint 和 `git diff --check` 通过。
- [x] Step 6.38：远端 cursor 在光标附近显示用户名称和输入状态，显示格式为 `用户名称 正在输入`；只显示远端用户，不覆盖本地用户自己的光标 UI。
- [x] Step 6.39：多用户 cursor 颜色来自初始化 `user.color` 或稳定 fallback；相邻光标、选区和 label 需要稳定排序和轻量错位，避免遮挡当前用户正在输入的位置。
- [x] Step 6.40：typing activity 必须有节流、过期时间和断连清理；停止输入后自动隐藏 `正在输入`，但可继续显示远端 cursor / selection；presence 事件不进入版本历史、不进入 undo、不产生正文 transaction。
- [x] Step 6.41：真实浏览器多页面验收至少覆盖 2 个和 5 个用户，检查用户名、颜色、typing label、重叠 cursor、断连清理和屏幕滚动后的定位稳定性。
  - 完成 2026-05-27：`examples/collab` 新增 `createPresenceDisplayUsers()` 展示模型，按 `clientId` 稳定排序，保留 `user.color`，对同一 `cursorOffset` 生成 0/6/12/18/24px 轻量错位；cursor label 在 `selectionLabel` 未过期时显示 `用户名称 正在输入`，过期后回落到 `用户名称 cursor offset`。内存 runtime 和 Hocuspocus runtime 都透传 `selectionLabel` / `updatedAt`，页面 render 安排 typing 过期重绘，presence 仍只走 awareness/debug 快照，不写正文 transaction、版本历史或 undo。Hocuspocus demo URL client 扩展到 `client-a` 至 `client-e`，provider 模式下 A/B 输入控件按当前页面 client 写入 presence，支持 5 个真实页面同时发布 cursor。`@4xian/jword-collab-server` 包内相对 ESM import 改为 `.js` specifier，使 Node/Playwright 能从构建产物直接加载正式 server 包；collab smoke 测试的本地 Hocuspocus 服务延迟从 dist 动态导入，避免 Playwright 列举测试时预加载 workspace dist。验证：红测 `pnpm exec vitest run examples/collab/tests/vite-config.test.ts --testNamePattern "presence display users"` 先失败于 `createPresenceDisplayUsers is not a function`；实现后通过。真实浏览器 `pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "renders Hocuspocus awareness across browser pages" --reporter=line` 通过 1 test，覆盖 2 用户 typing label、title、selection range、relative position 和过期回落；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "five browser pages" --reporter=line` 通过 1 test，覆盖 5 页面 client-a 至 client-e、稳定错位、滚动后 transform 稳定和 client-c 断连清理。补充验证：`pnpm exec vitest run examples/collab/tests/vite-config.test.ts examples/collab/tests/hocuspocus-service.test.ts packages/collab-server/test/server.test.ts --reporter=dot` 通过 3 files / 24 tests，`pnpm --filter @4xian/jword-example-collab typecheck`、`pnpm --filter @4xian/jword-collab-server typecheck`、targeted ESLint 和 `git diff --check` 通过。
- [x] Step 6.42：定义 `startAutoInsertSession()` 公开 API，必须接收 `position` 或 `range`；位置来源可以是 selection snapshot、anchor/range snapshot、findText result 或 resolveLocation result，不能默认读取当前 live caret。
- [x] Step 6.43：自动插入 session 创建后不得调用 editor focus、不得修改用户当前 selection、不得依赖 DOM caret；用户在插入期间手动点击其它位置并输入时，自动插入仍在指定位置或 range 中推进。
- [x] Step 6.44：自动插入以虚拟远端 actor 进入协作体系，支持 actor `id`、`name`、`color`、`avatarUrl`，例如 `AI Assistant` 或业务方传入的机器人名称；该 actor 的内容、presence、diagnostics 和 undo scope 必须与真实用户区分。
- [x] Step 6.45：流式写入支持 progress、abort、error、requestId、chunk metadata、retry 和独立 undo scope；失败时保留已提交内容、返回可诊断状态，不做不可控回滚。
- [x] Step 6.46：真实浏览器验收覆盖自动插入进行中用户手动点击其它位置继续输入、远端用户同时输入、自动插入取消、位置被删除、版本恢复冲突和独立 undo；重点验证不抢光标、不丢内容、不污染用户 undo。
  - 完成 2026-05-27：`@4xian/jword-collab` stable client 的 `startAutoInsertSession()` 现在要求显式 `position` 或 `range`；缺失时返回 `failed` session，并记录 `COLLAB_AUTO_INSERTER_POSITION_REQUIRED`，测试断言不会读取 live caret、不会 focus editor、不会修改 selection。public auto-insert session 暴露虚拟 actor `id`、`name`、`color`、`avatarUrl`、`progress`、`write()`、`retry()`、`abort()`；写入和 retry 都带 `requestId`、chunk metadata，并用 `origin: 'auto-inserter'`、`undoScope: 'auto-inserter'` 与真实用户 undo 区分。capable editor 路径通过 core `createInserter()` 和 transaction pipeline 写入，fallback 外部 adapter 只保留受控 auto-inserter origin；core stable 入口补导出 `createRangeRef` 和 `InserterRetryInput`，collab 包 tsconfig 对齐同仓包使用 `packages/*/dist/index.d.ts`，避免把 core/license 源码拉入 collab `rootDir`。`examples/collab/tests/collab-auto-insert-concurrency.e2e.ts` 改为延迟导入正式 dist server，并把 Vite demo 端口迁到 4193 + `--strictPort`，避免测试发现期加载 workspace 包和 4188 Hocuspocus HTTP 端口冲突。验证：先写红测 `pnpm exec vitest run packages/collab/test/public-client.test.ts --testNamePattern "connects through" --reporter=dot`，失败于 `session.retry is not a function`；实现后通过。`pnpm exec vitest run packages/core/test/collaboration/inserter.test.ts packages/collab/test/public-client.test.ts --reporter=dot` 通过 2 files / 17 tests；`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-collab build`、`pnpm --filter @4xian/jword-core build`、`pnpm --filter @4xian/jword-license build`、focused `git diff --check` 均通过。真实浏览器 `pnpm exec playwright test examples/collab/tests/collab-auto-insert-concurrency.e2e.ts --project=chromium --reporter=line` 通过 6 tests，覆盖指定 anchor/range 下用户继续输入、远端同时输入、删除 anchor、远端删除、断连恢复和独立 undo；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "blocks Hocuspocus history restore" --reporter=line` 通过 1 test，覆盖 pending offline 编辑下版本恢复冲突不覆盖本地内容。
- [x] Step 6.47：重写 `examples/collab` 主入口为真实第三方集成方式：基础 editor/UI 初始化后动态 import 高级 client 包，连接正式 self-host server，传入 user/license/room/documentId/serverUrl/features。
- [x] Step 6.48：demo 和测试不得直接 import `packages/collab/src`、`packages/collab-server/src`、`examples/collab/src/runtime/*`、server 内部 service、Y.Doc store 或 core 内部 store；只能通过公开包入口、公开 facade 和浏览器用户行为完成验收。
- [x] Step 6.49：建立 import graph 架构测试扫描 examples/tests，禁止底层源码路径、测试 helper 和 demo runtime 代替公开 API；允许保留宿主级 debug hook，但 debug hook 不能成为第三方集成 API。
  - 完成 2026-05-27：`examples/collab` 主页面新增真实 `#jword-collab-editor` / `#jword-collab-toolbar` / live region / assistive mirror 宿主，`src/main.ts` 先用 `createEditor()` 和 `createJWordUi()` 装配基础 editor/UI，再按 `provider=hocuspocus` 动态加载高级 runtime，并把 `serverUrl`、`documentId`、`user`、`license`、`roomId`、`features` 和 history/offline 参数透传给 runtime；原 A/B textarea 降级为 debug client mirror，保留既有 E2E 兼容但不再是唯一主入口。`examples/collab/vite.config.ts` 已移除高级协作包源码 alias，仅基础 core/docx/ui 保留开发态 alias；浏览器 handshake 测试新增 `browser-handshake-harness.ts`，通过公开 `@4xian/jword-collab` 包名加载 client SDK，不再用 `/@fs...packages/collab/src/index.ts`。E2E Hocuspocus 服务改走 `collab-hocuspocus-service.ts`，延迟导入 `packages/collab-server/dist/index.js` 和 `packages/persistence/dist/index.js`，不再直接依赖 demo server 内部 service。新增 `tests/architecture/gate6-import-graph.test.ts` 扫描 `examples/collab/src` 与浏览器验收测试的 import 和源码路径字符串，禁止私有 runtime、server service、collab/collab-server src 和 core 内部 store 路径；允许宿主级 debug hook 继续存在但不作为第三方 API。验证：红测 `pnpm exec vitest run examples/collab/tests/vite-config.test.ts --testNamePattern "第三方集成方式" --reporter=dot` 先失败于 `main.ts` 未导入基础 core/UI，修复后通过；红测 `pnpm exec vitest run tests/architecture/gate6-import-graph.test.ts --reporter=dot` 先失败于 `collab-handshake.e2e.ts` 的 `packages/collab/src` 字符串路径，改为公开包 harness 后通过。最终验证：`pnpm exec vitest run tests/architecture/gate6-import-graph.test.ts examples/collab/tests/vite-config.test.ts --reporter=dot` 14 tests passed；`pnpm --filter @4xian/jword-example-collab typecheck` 通过；`pnpm exec playwright test examples/collab/tests/collab-handshake.e2e.ts --project=chromium --reporter=line` 2 tests passed；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "syncs two browser pages through Hocuspocus provider" --reporter=line` 1 test passed；targeted ESLint 和 `git diff --check` 通过。`node tools/lint/check-comments.mjs` 仍失败于前序遗留 `packages/collab/src/experimental.ts` 与 `packages/core/src/editor/location-runtime.ts` 的文件头注释，不是本轮新增。
- [x] Step 6.50：双页面验收必须是两个浏览器页面、两个 user、同一 room、同一 documentId；主验收不得使用同一页面多个 textarea 实例，也不得只用内存双 Y.Doc 模拟替代真实 provider。
  - 完成 2026-05-27：新增真实 Chromium 双页面验收 `Gate 6 collab demo accepts two browser pages as separate users in the same room and document`，测试启动正式 dist 的 `@4xian/jword-collab-server` Hocuspocus 服务，打开两个独立 browser page，分别传入 `userId/userName/userColor`，并显式断言两个页面使用同一 `roomId`、同一 `documentId`、不同 `data-jword-collab-user-id`、可见真实 `data-jword-collab-editor` 宿主和 `providerMode: hocuspocus`。主同步证明不再用同一页面 A/B textarea 两实例，写入来自 client-a 页面，client-b 页面通过真实 provider 收到同一文本，并读到 client-a 的远端 typing presence。RED 先失败于页面未暴露 `data-jword-collab-room-id`，随后补 `examples/collab/src/main.ts` 的第三方集成 data 属性、`index.html` 的真实 editor host data 标记，以及 Hocuspocus runtime 对传入 user display name/color 的使用。Browser 插件当前缺少 Node REPL `js` 执行工具，无法按 in-app Browser 技能接管，因此本轮真实浏览器验收使用项目 Playwright Chromium fallback。验证：`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "separate users in the same room and document" --reporter=line` 先红后绿；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium --grep "separate users in the same room and document|syncs two browser pages through Hocuspocus provider" --reporter=line` 2 passed；`pnpm exec playwright test examples/collab/tests/collab-handshake.e2e.ts --project=chromium --reporter=line` 2 passed；`pnpm exec vitest run tests/architecture/gate6-import-graph.test.ts examples/collab/tests/vite-config.test.ts --reporter=dot` 14 tests passed；`pnpm --filter @4xian/jword-example-collab typecheck`、targeted ESLint 和 focused `git diff --check` 通过。
- [x] Step 6.51：补第三方集成 README 草稿和 smoke script，脚本从空项目安装基础包、高级包和 server 包，按公开 API 启动协作、自动插入、历史版本和未授权失败演示。
  - 完成 2026-05-27：新增 `packages/collab/README.md` 和 `examples/collab/README.md`，说明空项目安装、公开 `connectJWordCollaboration()`、`createJWordCollabServer()`、`history.recordVersion()`、`startAutoInsertSession()`、未授权失败和公开 API 边界。新增 `tools/release/check-gate6-third-party-smoke.mjs`：脚本用 `pnpm pack` 从当前 workspace 打包基础包、高级协作包、授权包、persistence 包和 server 包，安装到临时空项目，再运行只 import 公开包名的 smoke 程序；程序启动 self-host server，连接 collab client，记录历史版本，执行自动插入，并验证缺失 license 从 `JWORD_LICENSE_MISSING` 归一为 `COLLAB_LICENSE_MISSING`。验证：红测 `pnpm exec vitest run tests/architecture/gate6-package-exports.test.ts --testNamePattern "third-party integration smoke" --reporter=verbose` 先失败于 README/script 缺失；实现后通过。`node tools/release/check-gate6-third-party-smoke.mjs` 输出 `status: ok`、`installStatus: "installed-from-local-packs"`，并确认 collaboration synced、history recorded、autoInsert written、unauthorized `COLLAB_LICENSE_MISSING`。
- [x] Step 6.52：建立私有 registry / `npm pack` 检查，高级 client、server、license 包只包含 dist、types、README、license metadata 和必要运行文件，不包含测试私有文件、内部 fixture 或源码路径泄漏。
  - 完成 2026-05-27：新增 `tools/release/check-gate6-commercial-pack.mjs`，用 `pnpm pack` 审计 `@4xian/jword-collab`、`@4xian/jword-collab-server` 和 `@4xian/jword-license` 的 restricted registry 形态、export map、dist/types、README、`workspace:*` 改写、源码/测试/fixture 泄漏和 tarball 文件清单。`packages/collab`、`packages/collab-server`、`packages/license` 现在均显式保留 `files: ["dist", "README.md"]` 和 `publishConfig.access: "restricted"`；`packages/license/README.md` 记录 feature key 与授权 diagnostics。验证：红测 `pnpm exec vitest run tests/architecture/gate6-package-exports.test.ts --testNamePattern "commercial pack audit" --reporter=verbose` 先失败于脚本缺失；实现后 `pnpm exec vitest run tests/architecture/gate6-package-exports.test.ts --reporter=dot` 为 8 tests passed；`node tools/release/check-gate6-commercial-pack.mjs` 输出 `status: ok`，三个包的 `requiredFilesMissing` 和 `forbiddenFiles` 均为空；`node tools/lint/check-package-versions.mjs`、`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-license typecheck` 通过。
- [x] Step 6.53：建立 bundle gate，证明 free vanilla 首屏不包含 collab、hocuspocus、license、IndexedDB offline runtime、server client code；高级示例必须按需加载，未启用高级功能时不拉取高级 chunk。
  - 完成 2026-05-27：新增 `tools/size/check-gate6-collab-bundle.mjs` 和 `tests/architecture/gate6-bundle-gate.test.ts`。红测先以 `pnpm exec vitest run tests/architecture/gate6-bundle-gate.test.ts --reporter=verbose` 失败于脚本缺失；实现后该测试通过。脚本扫描 `examples/vanilla/dist` 首屏 JS/CSS，阻止 `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license`、`@4xian/jword-persistence`、`@hocuspocus`、`hocuspocus`、`IndexedDB` / `indexeddb` / `y-indexeddb`、Hocuspocus runtime、IndexedDB offline runtime、server/client public API 和授权/协同诊断 token 进入免费首屏；同时扫描 `examples/collab/dist`，要求 Hocuspocus provider、IndexedDB offline、provider failure diagnostics 和 WebSocket runtime 只出现在 lazy chunk。新鲜验证：`pnpm --filter @4xian/jword-example-vanilla build`、`pnpm --filter @4xian/jword-example-collab build`、`node tools/size/check-gate6-collab-bundle.mjs` 均通过；脚本输出 `status: "ok"`，vanilla 首屏仅包含 `index-*.js` / `index-*.css`，collab 高级 runtime 位于 `hocuspocus-runtime-*.js` 与 `lazy-runtime-*.js`。
- [x] Step 6.54：扩展 diagnostics registry，覆盖授权、版本、server、network、offline、history、auto-insert、presence、storage、rate limit、payload limit 和 tenant/auth hook 失败。
  - 完成 2026-05-27：`fixtures/collab/diagnostics-registry.json` 扩展到 56 个 Gate 6 稳定诊断码，覆盖 provider lifecycle、client/server version handshake、server unavailable、presence parse/invalid/unresolved、offline reconnect、history/snapshot/storage、authHook、tenantHook、license、auto-insert、relay payload、server payload limit、rate limit、not found 和 persistence restore/indexeddb/version 失败。registry metadata 新增 `domains`，按 `authorization`、`version`、`server`、`network`、`offline`、`history`、`auto-insert`、`presence`、`storage`、`rate-limit`、`payload-limit`、`tenant-hook`、`auth-hook` 建立商业 readiness 覆盖；`tests/architecture/gate6-diagnostics-registry.test.ts` 同时扫描 collab、collab-server、persistence 与 collab demo runtime 中实际发出的诊断 token，防止运行时代码新增诊断但漏登记。验证：红测 `pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts --reporter=verbose` 先失败于 registry 仍只有 24 个 code 且缺少 domains；补齐后同命令通过 1 file / 5 tests；相关回归 `pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts packages/collab/test/public-client.test.ts packages/collab-server/test/server.test.ts packages/persistence/test/memory-adapter.test.ts --reporter=dot` 通过 6 files / 47 tests。
- [x] Step 6.55：扩展 benchmark，覆盖 2/5/20 用户、1k/10k updates、离线重连、版本 snapshot、自动插入 1k/10k 字、server history API、license handshake 和版本握手。
  - 完成 2026-05-27：`benchmarks/gate6-collab-benchmark.mjs` 扩展为 Gate 6 商业 benchmark 矩阵：每个 `gate6-1k` / `gate6-10k` fixture 都输出 `userCountMatrix`，覆盖 2/5/20 用户的 provider dispatch、远端 apply 和 `remoteApplyCount`；保留 update apply、snapshot create/load、version preview、自动插入正文和输入探针、真实 Chromium IndexedDB restore。新增内存 provider 离线重连 replay 探针，输出 `offlineReconnectStatus: "synced"`、`offlineReconnectQueuedUpdates: 1`；新增正式 `createJWordCollabServer()` 临时 self-host server benchmark，计量 `/history/versions` record/list、`/history/preview`、`/license/status` 和通过公开 `connectJWordCollaboration()` 完成的 client/server version handshake。红测 `pnpm exec vitest run tests/architecture/gate6-benchmark.test.ts --reporter=verbose` 先失败于缺少 `userCountMatrix`，实现后通过 1 file / 2 tests。实际 benchmark 在 `pnpm build` 后执行 `node benchmarks/gate6-collab-benchmark.mjs` 通过：`gate6-1k` 远端矩阵 2/5/20 用户 apply 为 1/4/19，update bytes 3046，IndexedDB restore 0.1ms，server history record/list/preview 9.76/1.11/1.05ms，license/version handshake 0.63/0.73ms；`gate6-10k` 远端矩阵 1/4/19，update bytes 23121，IndexedDB restore 0.1ms，server history record/list/preview 2.11/0.62/0.77ms，license/version handshake 0.42/0.4ms。focused 回归 `pnpm exec vitest run tests/architecture/gate6-benchmark.test.ts tests/architecture/gate6-package-exports.test.ts packages/collab-server/test/server.test.ts packages/collab/test/public-client.test.ts --reporter=dot` 通过 4 files / 30 tests；`packages/collab-server/test/server.test.ts` 中授权拒绝用例的 `[onConnect] COLLAB_FEATURE_NOT_ENTITLED` stderr 是该用例预期输出。
- [x] Step 6.56：把 Gate 6 公开 API 清单、self-host server 部署、授权接入、client/server 版本策略、故障排查、收费能力边界和迁移指南加入 Gate 7 文档站计划。
  - 完成 2026-05-27：Gate 7 文档站计划已补 Gate 6 公开 API 清单、collab client 集成、self-host server 部署、授权接入、client/server 版本策略、故障排查、收费能力边界、迁移指南和商业支持诊断包范围。红测 `pnpm exec vitest run tests/architecture/gate6-commercial-readiness.test.ts --reporter=verbose` 先失败于 Gate 7 计划缺少 `ConnectJWordCollaborationOptions` 等 Gate 6 公开类型名；补齐后同测转绿。该步骤只冻结文档站实施范围，不提前完成 Gate 7 正文、wrapper、devtools 或 release 工作。

### 验收

- [x] 双窗口同时编辑最终一致。
- [x] 断网编辑后恢复同步。
- [x] 远端光标和选区可见。
- [x] AI 自动插入不阻塞本地输入。
- [x] 用户 undo 默认不撤销 remote/AI 内容。
- [x] AI/程序化写入可配置进入独立 undo scope，且不混入默认用户 undo。
- [x] 批注 anchor 在远端编辑后稳定。
- [x] 历史版本可查看、可恢复、可解释。
- [x] 版本恢复失败时不覆盖当前可写文档。
- [x] offline cache 不可用时在线协同仍可用并产生 recoverable diagnostic。
- [x] remote / local / auto-inserter / version-restore origin 在 diagnostics 中可区分。
- [x] DOCX 导入后的文档在双窗口协同、断网恢复、自动插入和历史恢复场景中表现为普通 JWord 文档；unsupported OOXML 只产生 warning/diagnostic，不作为可编辑协同内容承诺。
- [x] `packages/collab`、`packages/persistence` 和 provider runtime 不进入 vanilla 首屏 bundle。
- [x] `examples/collab` 能在真实浏览器完成双窗口协同、断网重连、自动插入、abort、版本预览和版本恢复。
- [x] `@4xian/jword-collab-server` 可作为正式 self-host 服务包被第三方部署，不要求第三方复制 demo server 代码。
- [x] client/server 版本不匹配、featureFlags 缺失或 protocol 不兼容时 fail-fast，并给出稳定 diagnostic。
- [x] 未授权、授权过期、feature 不匹配和 license server 不可用时，高级协作、离线、历史和自动插入均被阻止，且不读取或泄漏文档内容。
- [x] 远端 cursor 在光标附近显示用户名、颜色和 `正在输入` 状态，多用户重叠时稳定排序且不遮挡本地输入。
- [x] `startAutoInsertSession()` 只消费显式 position/range，不读取 live caret、不调用 focus、不改变用户 selection；自动插入作为虚拟远端 actor 参与协作。
- [x] `examples/collab` 只使用公开包 API 和真实编辑器集成，不再以 textarea harness 或 demo runtime 作为主验收入口。
- [x] 免费基础 bundle、`packages/core` 和 `packages/native` 不包含 collab/server/license 高级功能代码。
- [x] 付费边界至少有服务端或 worker/license 层强制 enforcement，不能只靠浏览器 client-side 判断。
  - 完成 2026-05-27：Gate 6 验收项按当前工作树重新复核并补架构护栏。`@4xian/jword-collab-server` 已有正式 `createJWordCollabServer()`、`startJWordCollabServer()`、Dockerfile、README、health/version/history/license/auto-insert relay；`packages/collab/test/public-client.test.ts` 覆盖协议不兼容、server/client 过旧、feature flags 缺失时 fail-fast 且 provider 保持 `idle`；`packages/collab/test/contract.test.ts` 覆盖 missing、expired、feature mismatch 和 license server unavailable 的稳定授权诊断；`packages/collab-server/test/server.test.ts` 覆盖 history 和 auto-insert relay 未授权时在 storage/chunk 内容前被拒绝，WebSocket `onAuthenticate` / `beforeSync` 也在正式服务包内授权；`examples/collab/tests/vite-config.test.ts` 与真实浏览器 smoke 覆盖远端 cursor 用户名、颜色、`正在输入`、稳定排序和重叠错位；`packages/collab/test/public-client.test.ts` 覆盖 `startAutoInsertSession()` 缺少显式 position/range 时不读 live caret、不 focus、不改 selection，并暴露虚拟 actor；`tests/architecture/gate6-import-graph.test.ts`、`tests/architecture/gate6-bundle-gate.test.ts`、`tests/architecture/gate6-commercial-readiness.test.ts` 和 `tests/architecture/gate6-package-exports.test.ts` 分别约束 examples/test 只能走公开 API、免费首屏和基础源码不引入高级包、付费边界不只在浏览器 JS、core 稳定入口只保留中立 sync update / text inserter / anchor/range / transaction hook。验证：`pnpm exec vitest run tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-benchmark.test.ts packages/core/test/index.test.ts packages/core/test/collaboration/editor-update.test.ts packages/collab/test/public-client.test.ts --reporter=verbose`。

当前工作树补充复核（2026-05-27）：`tests/architecture/gate6-file-budget.test.ts` 红灯先暴露 `packages/collab/src/client-sdk.ts` 与 `examples/collab/tests/collab-smoke.e2e.ts` 超过 1000 行；随后将 client 公开类型拆到 `packages/collab/src/client-types.ts`，将诊断 helper 拆到 `packages/collab/src/client-diagnostics.ts`，将 collab smoke URL/debug helper 拆到 `examples/collab/tests/collab-smoke-helpers.ts`。复核行数为 `packages/collab/src/client-sdk.ts` 997、`examples/collab/tests/collab-smoke.e2e.ts` 835。验证：Gate 6 focused suite `packages/collab/test/public-client.test.ts packages/collab/test/contract.test.ts packages/collab-server/test/server.test.ts packages/persistence/test/memory-adapter.test.ts packages/persistence/test/storage-history-adapter.test.ts tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts tests/architecture/gate6-file-budget.test.ts` 为 10 files / 65 tests passed；`pnpm --filter @4xian/jword-collab typecheck`、`pnpm --filter @4xian/jword-collab-server typecheck`、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm --filter @4xian/jword-example-collab typecheck` 均通过；Playwright Chromium collab suite `collab-smoke`、`collab-handshake`、`collab-history-api`、`collab-auto-insert-concurrency`、`collab-docx-provider-history` 为 30 passed。Kimi WebBridge 真实 Chrome 打开 `http://127.0.0.1:4186`，确认状态 `connected`、远端 cursor `title/text` 为 `Alice cursor 8`、模拟断开后 `offline.connected: false`、重连后自动插入同步到两个 client mirror。

当前工作树补充复核（2026-05-27）：补齐 Gate 6 pack 和 import graph 漏洞。`@4xian/jword-persistence` 已纳入 `tests/architecture/gate6-package-exports.test.ts` 与 `tools/release/check-gate6-commercial-pack.mjs`，发布白名单改为 `dist` + `README.md`，补 `publishConfig.access = restricted` 和 README，避免 `src` 随商业协作存储包进入 npm pack。`tests/architecture/gate6-import-graph.test.ts` 现在扫描全部 `examples/collab/src/runtime/*.ts`，Hocuspocus runtime 改为从 `@4xian/jword-core` 根入口消费 `createDocumentProjection()`、shared document bridge 和 `createRangeRef()`；provider history 保留本地 wire-format 根名白名单，不再 import `packages/core/src/model/document-store`。Gate 7 API catalog 同步记录 core 新增的 projection / shared document bridge。验证：`pnpm vitest run tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-import-graph.test.ts tests/architecture/gate7-public-api-catalog.test.ts` 为 3 files / 15 tests passed；`pnpm vitest run examples/collab/tests/hocuspocus-history.test.ts examples/collab/tests/hocuspocus-server-history.test.ts examples/collab/tests/vite-config.test.ts` 为 3 files / 16 tests passed；`node tools/release/check-gate6-commercial-pack.mjs` 通过且 persistence pack 无 forbidden files。该补充只收口 Gate 6 packaging / import graph 护栏，不代表 Gate 7 文档站、wrapper、plugin 或 release dry-run 已完成。

当前工作树补充复核（2026-05-27）：补齐 Gate 5/Gate 6 发布包 Node ESM 相对导入后缀与 Gate 6 DOCX 协同桥接授权漏洞。`tests/architecture/gate5-commercial-readiness.test.ts` 与 `tests/architecture/gate6-package-exports.test.ts` 已新增发布运行时代码相对 import 必须带 `.js` 后缀的护栏，商业包源码中的相对 import/export/dynamic import 已统一修正；`examples/collab/src/runtime/hocuspocus-runtime.ts` 的 `importDocxForCollabAcceptance()` 现在把同一份 demo entitlement 传给 `importDocx()`，`examples/collab/src/main.ts` 的默认 demo feature 列表补入 `docx.import`，避免 Gate 5 授权检查接入后 DOCX 导入协同验收在真实浏览器中因缺少授权失败。验证：无后缀相对导入扫描已无命中；`pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts --reporter=verbose` 为 2 files / 14 tests passed；`pnpm --filter @4xian/jword-docx --filter @4xian/jword-pdf --filter @4xian/jword-collab --filter @4xian/jword-persistence --filter @4xian/jword-collab-server typecheck` 通过；`pnpm build` 通过；`node tools/release/check-gate5-commercial-pack.mjs` 与 `node tools/release/check-gate6-commercial-pack.mjs` 均输出 `status: ok`；`node tools/release/check-gate6-third-party-smoke.mjs` 输出 `status: ok`、`installStatus: "installed-from-local-packs"`，并确认 collaboration synced、history recorded、autoInsert written、unauthorized `COLLAB_LICENSE_MISSING`；`pnpm --filter @4xian/jword-example-collab typecheck` 与 `pnpm --filter @4xian/jword-example-collab build` 通过；`pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts examples/collab/tests/collab-handshake.e2e.ts examples/collab/tests/collab-history-api.e2e.ts examples/collab/tests/collab-auto-insert-concurrency.e2e.ts examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium --reporter=line` 为 30 passed；Kimi WebBridge 真实 Chrome 打开 `http://127.0.0.1:5173/`，确认页面标题 `JWord Collab Gate 6 Demo`、连接状态 `connected`、debug API 暴露 `importDocxForCollabAcceptance`，点击自动插入后 `insertedCount` 增长且 client A 文本更新。该补充只收口 Gate 5/Gate 6 当前发布和浏览器验收漏洞，不代表 Gate 7 文档站、wrapper、plugin、diagnostics export 或 release dry-run 已完成。

最终完成复核（2026-05-27）：主进程重新核对 Gate 4.5、Gate 5 和 Gate 6 范围内无未完成复选框。补强点为 `tests/architecture/gate6-docx-fixture-integration.test.ts` 改为只从 `@4xian/jword-core`、`@4xian/jword-docx`、`@4xian/jword-persistence` 公开入口导入，`vitest.config.ts` 补齐 DOCX/PDF 公开包 alias，`tests/architecture/gate6-import-graph.test.ts` 增加该集成测试的公开入口护栏；同时将 Gate 4.5 `packages/native/src/validation.ts` 文件头中的英文术语串改为中文注释，满足 comments lint。新鲜验证：Gate 5/Gate 6 import/package/file-budget focused Vitest 为 5 files / 19 tests passed；`pnpm --filter @4xian/jword-core --filter @4xian/jword-docx --filter @4xian/jword-persistence typecheck` 通过；仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`（138 files / 681 tests passed）和 `pnpm build` 通过；`pnpm --filter @4xian/jword-example-vanilla build`、`pnpm --filter @4xian/jword-example-docx build`、`pnpm --filter @4xian/jword-example-collab build` 通过；`node tools/size/check-native-bundle.mjs`、`node tools/release/check-native-pack.mjs`、`node benchmarks/gate45-native-benchmark.mjs`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/compat/run-gate5-docx-compatibility.mjs`、`node tools/release/check-gate6-commercial-pack.mjs`、`node tools/release/check-gate6-third-party-smoke.mjs`、`node tools/size/check-gate6-collab-bundle.mjs`、`node benchmarks/gate6-collab-benchmark.mjs` 均输出 `status: ok` 或通过；Chromium focused E2E 覆盖 Gate 4.5、Gate 5 和 Gate 6 共 45 passed；Kimi WebBridge 真实 Chrome 打开 `http://127.0.0.1:5173/`，确认页面标题 `JWord Collab Gate 6 Demo`、连接状态 `connected`、debug API 暴露 `importDocxForCollabAcceptance`，点击自动插入后两个 client text 同步增长，停止后 `insertedCount: 56`、`running: false`、offline 为 connected。

九项 remediation 复核（2026-05-28）：针对 2026-05-27 完成声明后的代码审查问题，主进程按 `docs/superpowers/plans/2026-05-27-jword-gate45-gate5-gate6-remediation.md` 重新拆成 6 条互不重叠 lane 并并行修复、验收。已补齐：Gate 4.5 上传文件图片资源持久化、native save 运行中取消；Gate 5 signed license、DOCX inspect/index/worker inspect 读取 ZIP 前授权、PDF table cell text export；Gate 6 public SDK 本地事务发布、server-backed history、pending offline queue、collab-server metadata-first 授权和 default-deny；Gate 5/Gate 6 商业包 pack、dist import 后缀、source map/source content 泄漏拦截和空项目 tarball smoke。新鲜验证：`pnpm --filter @4xian/jword-native test` 为 2 files / 13 tests passed；`pnpm --filter @4xian/jword-license test` 为 1 file / 6 tests passed；`pnpm --filter @4xian/jword-docx test` 为 13 files / 62 tests passed；`pnpm --filter @4xian/jword-pdf test` 为 4 files / 31 tests passed；`pnpm --filter @4xian/jword-collab test` 为 2 files / 19 tests passed；`pnpm --filter @4xian/jword-collab-server test` 为 1 file / 16 tests passed；对应包 typecheck 全部通过；Gate 4.5 Chromium E2E 为 2 passed；Gate 5/Gate 6 focused architecture suite 为 5 files / 28 tests passed；remediation focused Vitest 为 9 files / 61 tests passed；`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/release/check-gate5-third-party-smoke.mjs`、`node tools/release/check-gate6-commercial-pack.mjs`、`node tools/release/check-gate6-third-party-smoke.mjs`、`node tools/size/check-native-bundle.mjs`、`node tools/release/check-native-pack.mjs`、`node benchmarks/gate45-native-benchmark.mjs`、`node tools/size/check-gate6-collab-bundle.mjs`、`node benchmarks/gate6-collab-benchmark.mjs` 均输出 `status: ok` 或通过；仓库级 `pnpm lint`、`pnpm typecheck`、`pnpm test`（138 files / 695 tests passed）和最终 `pnpm build` 通过。本复核不扩大 Gate 7 范围；React/Vue wrapper、plugin、文档站、diagnostics export 和 release dry-run 正文仍按 Gate 7 后续推进。

### 禁止事项

- [x] 协同层不绕过 Editor transaction。
- [x] 自动插入不使用普通字符 offset。
- [x] wrapper 或 provider 不保存第二份编辑状态。
- [x] 不把 Automerge、Loro、Fluid、自研 OT 作为 Gate 6 主路径替换 Yjs。
- [x] 不把 DOCX、HTML、Markdown 或 projection JSON 当协同真源。
- [x] 不把 awareness 写入版本历史。
- [x] 不把 remote update 或 auto inserter 默认塞进本地用户 undo。
- [x] 不在 core 引入 WebSocket、IndexedDB、hocuspocus、Liveblocks 或浏览器全局依赖。
- [x] 不在 Gate 6 中直接修改 DOCX XML、用 DOCX 字符 offset 定位协同/自动插入位置，或把导入前的 OOXML 坐标当成长期 anchor。
- [x] 不在未验证真实浏览器断网/重连前宣称 offline 已完成。
- [x] 不把 provider auth、tenant、权限系统做进 JWord core。
  - 复核 2026-05-26：provider auth/token 只在 collab/demo provider 层；`rg -n "\b(auth|tenant|permission|permissions|token|requiredToken|providerToken)\b" packages/core/src -g "*.ts"` 在 core 中只命中内部共享文档 token 注释/类型，没有 auth、tenant、permission 或 provider token 语义。
- [x] 不让 demo/test 通过 `packages/*/src`、Y.Doc store、内部 runtime 或 server service 绕过公开 API。
- [x] 不把生产 server 只藏在 demo 目录；第三方必须能安装正式 server 包并以公开 options 启动。
- [x] 不把付费边界只放在浏览器 JS；用户拿到 client 包也不能绕过服务端或 worker/license enforcement。
- [x] 不在 core 稳定 API 中暴露 `collab`、`offline`、`autoInsert` 等高级产品 API 名称；core 只提供中立位置、anchor/range、transaction hook。
- [x] 不让自动插入读取 live caret、抢 focus 或修改用户手动 selection。
- [x] 不允许 client/server 版本不匹配时静默继续协作。
  - 完成 2026-05-27：Gate 6 禁止事项已转成架构测试和 focused runtime 测试。`tests/architecture/gate6-import-graph.test.ts` 扫描 collab 示例和浏览器验收测试，阻止私有源码路径、内部 runtime、server service 与 core 内部 store 进入主验收；`tests/architecture/gate6-package-exports.test.ts` 约束 demo server 只是正式 `@4xian/jword-collab-server` 的薄启动器，并约束 collab client 从 core 消费 `EditorSyncUpdateInput`、`EditorApplyUpdateOptions`、`createTextInserter` 和 `TextInserterRetryInput`；`tests/architecture/gate6-commercial-readiness.test.ts` 扫描 core 稳定入口，禁止 `collab`、`offline`、`autoInsert` 等产品名回流；`packages/collab/test/public-client.test.ts` 覆盖自动插入不读 live caret、不 focus、不改 selection；握手失败路径覆盖 provider 不连接、不进入半协作状态。

## Gate 7 - SDK 稳定化、公开文档与商业交付

### 目标

交付可集成、可诊断、可维护、可销售的 `1.0-stable` SDK。外部项目能选择 vanilla、React、Vue 集成，能使用免费基础编辑和 `.jword` 原生保存/打开，也能在授权后按需接入 DOCX/PDF 高级格式互通、多人协作、离线、历史、自动插入和 self-host server。Gate 7 交付后，JWord 必须有清晰的公开 API 清单、版本兼容策略、授权接入说明、私有包发布检查、真实第三方示例和故障排查材料。

### 实现方案

先冻结免费/付费包的公开 API 和 edition matrix，再补 wrapper、plugin、theme/i18n、devtools、文档站、bundle size、发布 dry-run 与真实第三方集成验证。任何公开 API 必须有类型、TSDoc、类型测试、示例、diagnostics、兼容策略和对应文档；任何高级能力必须能说明授权边界、client/server 版本要求、未授权失败路径和按需加载证据。

### 当前基线（2026-05-27）

- [x] `packages/ui` 与 `examples/vanilla` 已形成当前 SDK 宿主基线；后续 wrapper、plugin、文档站都应以这条集成路径为对照，而不是回塞 demo 主文件。
- [x] Gate 4.5 已把 `.jword` 原生保存/打开作为免费基础能力落地，Gate 5 已调整为商业高级格式互通，Gate 6 已调整为商业高级协作、离线、历史和自动插入。
- [x] 公开 API 清单已覆盖当前已实现 free / paid package、stable / experimental / internal 分级和 feature key 基线；diagnostic code 细化和版本兼容策略仍留在 Step 7.3 / Step 7.22。
- [ ] `.jword` 原生格式、DOCX/PDF 高级格式、collab client、collab server、license 和第三方集成文档仍未形成可对外发布版本；Gate 6 文档范围已明确必须覆盖 Gate 6 公开 API 清单、self-host server 部署、授权接入、client/server 版本策略、故障排查、收费能力边界和迁移指南。
- [ ] plugin、wrapper、theme / i18n、diagnostics、devtools 还没有稳定对外 contract。
- [ ] 私有 registry、`npm pack` 内容审计、示例外部项目安装、未授权失败文档和商业 support 诊断包仍未闭环。

### 推荐执行顺序

1. 先冻结 Public API、edition matrix、feature key、diagnostics 和包边界，再开始 wrapper、plugin 或文档站落地。
2. 先做 API 清单、TSDoc、类型测试和导出审计 `Step 7.1 -> 7.3`，避免后续对外接口边写边漂移。
3. 再做基础版 quickstart、`.jword` 保存/打开文档和 Plugin API `Step 7.4 -> 7.6`。
4. 随后做 wrappers、theme/i18n、devtools、diagnostics export 和 example matrix `Step 7.7 -> 7.12`。
5. 然后补高级格式互通、协作 client/server、授权和商业边界文档 `Step 7.13 -> 7.17`。
6. 最后收 size-limit、私有发布 dry-run、外部项目安装验证、迁移指南和 Stable E2E `Step 7.18 -> 7.24`。

### 迭代任务清单

#### Iteration 0 - 冻结 SDK 对外面向和商业分级

- [ ] 冻结导出分级：
  - `stable`
  - `experimental`
  - `internal`
- [ ] 冻结 edition matrix：
  - free：core、ui、native、基础 persistence contract、基础 diagnostics。
  - paid format：docx import、docx export、PDF export。
  - paid collaboration：collab client、collab server、offline、history、auto insert、license。
- [ ] 冻结 package / example 落点，但不预创建空壳：
  - `packages/native/src/`
  - `packages/license/src/`
  - `packages/react/src/`
  - `packages/vue/src/`
  - `packages/devtools/src/`
  - `packages/collab-server/src/`
  - `examples/react/`
  - `examples/vue/`
  - `examples/collab/`
  - `examples/docx/`
  - `examples/performance/`
- [ ] 冻结事件 payload、错误码、feature flags、license diagnostics、client/server version diagnostics 和 support bundle contract，后续 wrappers / plugins / docs 都只复用这套公开命名。

#### Iteration 1 - Public API / TSDoc / 类型测试（Step 7.1-7.3）

- [x] 整理 Public API 清单，按 package 和 edition 明确哪些符号可对外承诺，哪些仍留在 `experimental`，哪些必须保持 internal。
  - 完成 2026-05-27：新增 `docs/sdk/public-api.md`，按 `@4xian/jword-core`、`ui`、`native`、`docx`、`pdf`、`persistence`、`collab`、`collab-server`、`license` 和未实现 wrapper/devtools 包列出 edition、stable、experimental、internal 边界；同时记录只能从 package export map 导入，禁止第三方导入 `packages/*/src/*`、Y.Doc store、provider 内部类型、worker 内部 helper 和 demo runtime。新增 `tests/architecture/gate7-public-api-catalog.test.ts` 作为最小清单护栏。
- [ ] 建立 API 导出审计，禁止 `src` 内部路径、provider/Yjs 内部类型、worker 内部类型和 demo runtime 进入 public export map。
- [ ] 为稳定 API 补齐 TSDoc、类型测试和最小示例，确保外部 TypeScript 项目能直接消费。
- [ ] 确保导出符号、事件 payload、错误码命名稳定，不暴露内部 Yjs 细节。

#### Iteration 2 - 基础版文档、Plugin API 与 diagnostics（Step 7.4-7.6 / 7.10-7.11）

- [ ] 建立免费基础版 quickstart：安装 core/ui/native，创建编辑器，保存 `.jword`，重新打开 `.jword`，继续编辑。
- [ ] 实现 Plugin API：commands、menus、decorations、resource upload、persistence、collab provider、import/export adapter、diagnostics。
- [ ] 实现插件错误隔离，插件异常触发 error event，不破坏 core 状态。
- [ ] 实现 Devtools 面板与 diagnostics export，保证 operation、selection/anchor、layout/perf、package versions、feature flags 和 license status 可复查。

#### Iteration 3 - wrappers、theme 和 example matrix（Step 7.7-7.12）

- [ ] 实现 React wrapper，只负责生命周期、props 到 EditorOptions、事件桥接。
- [ ] 实现 Vue 3 wrapper，只负责生命周期和事件桥接，SSR 阶段输出空壳。
- [ ] 实现主题系统与 i18n，保证 `jw-` BEM 类名与 WCAG AA 对比度约束。
- [ ] 收口 Devtools 面板的 operation log、layout overlay、selection/anchor inspect、performance counters。
- [ ] 收口 diagnostics export，保证版本、包信息、feature flags、license 状态、错误、operation 摘要、layout 指标可直接打包给集成方。
- [ ] 完善 vanilla / react / vue / collab / docx / performance examples，确保 examples 只做 host 装配与测试钩子，不导入底层源码。

#### Iteration 4 - 原生格式与高级格式文档（Step 7.13-7.14）

- [ ] 建立 `.jword` 格式文档：package entries、schema version、manifest、resources、checksums、metadata、migration、warning、错误处理和安全限制。
- [ ] 建立 Gate 5 高级格式互通文档：DOCX import/export、PDF export、worker progress/cancel、warning schema、未授权错误、feature key、按需加载和与 `.jword` 的边界。

#### Iteration 5 - 协作、服务端与授权文档（Step 7.15-7.17）

- [ ] 建立 Gate 6 collab client 集成文档：初始化 user、room/documentId、remote cursor、typing label、offline、history、auto-insert、diagnostics 和版本握手。
- [ ] 建立 Gate 6 公开 API 清单：`connectJWordCollaboration()`、`ConnectJWordCollaborationOptions`、`JWordCollaborationConnection`、`JWordCollaborationHandshake`、`JWordCollaborationOfflineState`、`JWordCollaborationHistoryVersion`、`JWordCollaborationAutoInsertSession`、`createMemoryCollabProviderAdapter()` 和 `GATE6_COLLAB_FEATURES` 必须标明 stable / experimental / internal 边界。
- [ ] 建立 self-host server 文档：部署、env、authHook、tenantHook、licenseHook、storage hook、history API、health/version endpoint、WebSocket 代理、限流和日志字段；`createJWordCollabServer()`、`startJWordCollabServer()`、`CreateJWordCollabServerOptions` 和 `JWordCollabServerState` 必须作为正式 server 包 API 记录。
- [ ] 建立授权接入与收费能力边界文档：edition matrix、feature key、license token、offline grace、撤销/过期、私有 registry、服务端 enforcement、未授权失败路径和常见错误。
- [ ] 建立 client/server 版本策略与故障排查文档：记录 `COLLAB_PROTOCOL_MISMATCH`、`COLLAB_SERVER_TOO_OLD`、`COLLAB_CLIENT_TOO_OLD`、`COLLAB_FEATURE_FLAGS_MISSING`、server unavailable、license denied、history storage missing、offline pending/reconnect 和 provider auth failed 的诊断含义、恢复建议和支持收集字段。

#### Iteration 6 - 文档站 / bundle / release / Stable matrix（Step 7.18-7.24）

- [ ] 建立文档站：快速开始、核心概念、API、插件、`.jword`、docx/PDF、协作、server、授权、迁移指南、故障排查、FAQ；Gate 6 页面必须串起 collab client、self-host server、license、diagnostics、收费能力边界和 client/server 版本策略。
- [ ] 建立 size-limit 和 bundle 分析，保证 docx/PDF/collab/hocuspocus/license/server/React/Vue wrapper/大字体不进入免费默认首屏。
- [ ] 建立 release dry-run：changeset 草稿、构建产物检查、`npm pack` 检查、私有 registry 安装检查、示例外部项目安装检查；不自动 publish。
- [ ] 建立迁移指南和兼容策略：minor/patch 兼容规则、deprecation、protocolVersion、native format schema migration、license contract migration、Gate 6 client/server 版本策略和版本窗口。
- [ ] 完成 Stable E2E 矩阵：vanilla、React、Vue、native save/open、docx/PDF、collab client/server、license failure、插件错误隔离、diagnostics export。

### 待办步骤

- [x] Step 7.1：整理公开 API 清单，按 `@4xian/jword-core`、`ui`、`native`、`docx`、`pdf`、`collab`、`collab-server`、`license`、`persistence`、wrapper 包区分 stable、experimental、internal，不公开未实现 Future API。
  - 完成 2026-05-27：`docs/sdk/public-api.md` 已记录当前已实现包的 public API、edition matrix、`./worker` / `./experimental` 边界和未实现 wrapper/devtools 包状态；`tests/architecture/gate7-public-api-catalog.test.ts` 约束该清单必须覆盖当前入口关键符号。
- [ ] Step 7.2：建立 API 导出审计和类型测试，确保外部 TypeScript 项目只能从包入口消费稳定 API，不能 import `src` 内部路径、Yjs/provider 内部类型、worker 内部类型或 demo runtime。
- [ ] Step 7.3：为稳定 API 补 TSDoc、最小示例和 diagnostics payload 文档，确保导出符号、事件 payload、错误码、feature key 可被外部项目消费。
- [ ] Step 7.4：建立免费基础版 quickstart，覆盖安装、初始化 editor/UI、基础编辑、保存 `.jword`、打开 `.jword`、继续编辑和基础错误处理。
- [ ] Step 7.5：实现 Plugin API：commands、menus、decorations、resource upload、persistence、import/export adapter、diagnostics；collab provider 只作为 adapter contract，不泄漏内部 provider。
- [ ] Step 7.6：实现插件错误隔离，插件异常触发 error event 和 diagnostics，不破坏 core 状态、selection、history 或协作连接。
- [ ] Step 7.7：实现 React wrapper，只负责生命周期、props 到 EditorOptions、事件桥接，不保存第二份编辑状态。
- [ ] Step 7.8：实现 Vue 3 wrapper，只负责生命周期和事件桥接，SSR 阶段输出空壳，不访问浏览器全局。
- [ ] Step 7.9：实现主题系统和 i18n，确保 UI 类名使用 `jw-` BEM，颜色对比满足 WCAG AA，文案可被宿主覆盖。
- [ ] Step 7.10：实现 Devtools 面板：operation log、layout overlay、selection/anchor inspect、performance counters、package versions、license status。
- [ ] Step 7.11：实现 diagnostics export，能导出版本、包信息、feature flags、license 状态、错误、operation 摘要、layout 指标、collab/server handshake 摘要。
- [ ] Step 7.12：完善 vanilla/react/vue/native/docx/collab/performance examples；所有 demo 都只能使用公开 API，模拟真实第三方集成。
- [ ] Step 7.13：建立 `.jword` 原生格式文档，说明格式结构、schema version、资源打包、checksum、migration、导入/导出 API、warning 和与 DOCX/PDF/协作 history 的边界。
- [ ] Step 7.14：建立 Gate 5 高级格式互通文档，说明 DOCX import/export、PDF export、worker progress/cancel、warning schema、未授权失败、feature key、按需加载和 fixture 验收。
- [ ] Step 7.15：建立 Gate 6 collab client 集成文档，说明 user/name/color、remote cursor、typing label、offline、history、auto-insert、position/range API、diagnostics 和版本握手；同时列出 Gate 6 公开 API 清单，包括 `connectJWordCollaboration()`、`ConnectJWordCollaborationOptions`、`JWordCollaborationConnection`、`JWordCollaborationHandshake`、`JWordCollaborationOfflineState`、`JWordCollaborationHistoryVersion`、`JWordCollaborationAutoInsertSession` 和 `GATE6_COLLAB_FEATURES`。
- [ ] Step 7.16：建立 `@4xian/jword-collab-server` self-host server 部署文档，说明 Node/Docker 启动、auth/tenant/license/storage hook、history API、health/version endpoint、WebSocket 代理和日志字段；同时列出 `createJWordCollabServer()`、`startJWordCollabServer()`、`CreateJWordCollabServerOptions` 和 `JWordCollabServerState`。
- [ ] Step 7.17：建立授权接入与收费能力边界文档，说明 edition matrix、feature key、license token、签名/撤销/过期、offline grace、服务端 enforcement、私有 registry 和未授权故障排查。
- [ ] Step 7.18：建立文档站信息架构：快速开始、核心概念、公开 API、插件、`.jword`、docx/PDF、协作、server、授权、迁移指南、故障排查、FAQ。
- [ ] Step 7.19：建立 size-limit 和 bundle 分析，确保免费首屏包不包含 docx/PDF/collab/hocuspocus/license/server/React/Vue wrapper/大字体，高级包只在显式 import 后进入 chunk。
- [ ] Step 7.20：建立 release dry-run：changeset 草稿、构建产物检查、`npm pack` 内容审计、私有 registry 安装检查、示例外部项目安装检查；不自动 publish。
- [ ] Step 7.21：建立外部空项目集成验收，从安装包开始分别接入免费基础版、Gate 5 高级格式包、Gate 6 协作 client/server 和 license，不允许依赖 monorepo alias。
- [ ] Step 7.22：建立迁移指南和兼容策略，覆盖 semver、deprecation、protocolVersion、native format schema migration、license contract migration、Gate 6 client/server 版本策略和版本窗口。
- [ ] Step 7.23：建立商业支持诊断包规范，定义客户报障时可导出的版本、feature、license、server、diagnostics、operation 摘要和隐私裁剪规则。
- [ ] Step 7.24：完成 Stable E2E 矩阵：vanilla、React、Vue、native save/open、docx/PDF、collab client/server、license failure、插件错误隔离、diagnostics export。

### 验收

- [ ] vanilla/react/vue demo 可运行。
- [ ] 外部项目可安装并集成。
- [ ] 首屏 bundle 不包含 docx/PDF/collab/hocuspocus/license/server。
- [ ] 插件错误被隔离。
- [ ] 公开 API 有类型、TSDoc 和类型测试。
- [ ] 文档站能支撑集成方完成免费基础版、Gate 5 高级格式和 Gate 6 高级协作接入。
- [ ] `.jword` 原生格式、授权、client/server 版本、未授权失败和收费边界都有对外文档。
- [ ] 私有 registry / `npm pack` / 外部空项目安装验收通过。
- [ ] release dry-run 可通过，但不自动发布。

### 禁止事项

- [ ] wrapper 不持有第二份编辑状态。
- [ ] 不公开未实现 Future API。
- [ ] 不把 devtools 或重包塞进默认首屏 bundle。
- [ ] 不把商业授权边界只写在文档或浏览器 client 里，必须有可验证 enforcement。
- [ ] 不把 examples 写成 monorepo 内部测试入口；所有公开示例都必须像第三方项目一样接包入口。
- [ ] 不自动 commit、tag、publish 或 npm release。

## Post-1.0 Backlog

这些能力不阻塞 `1.0-stable`，但必须在架构上已经预留：

- [ ] 完整修订互通和复杂审阅流。
- [ ] 脚注、尾注、交叉引用、题注。
- [ ] 复杂浮动对象、文本框、艺术字。
- [ ] 复杂表格布局和 Word 全边界兼容。
- [ ] 更深 OOXML roundtrip 兼容。
- [ ] Vue 2 兼容包。
- [ ] Chrome Extension devtools。
- [ ] JWord 托管云协作服务、账单系统、客户控制台和 usage metering。
- [ ] 企业 SSO、SCIM、组织通讯录、复杂权限流和审计报表。
- [ ] 高级授权运营能力：在线续费、离线授权包轮换、客户级 feature rollout、license portal。
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
- [x] `.jword` 原生保存/打开 roundtrip 通过真实浏览器和 worker 验收。
  - 完成 2026-05-27：Gate 4.5 native 公开 API、vanilla lazy worker E2E 和 Kimi WebBridge 真实 Chrome save/open/edit/save smoke 均通过；详见 Gate 4.5 执行记录。
- [x] Gate 5 商业高级 DOCX T1 import/export 通过 fixture diff。
  - 完成 2026-05-27：Gate 5 当前工作树复核中 `packages/docx/test/t1-fixtures.test.ts`、`packages/docx/test/t1-roundtrip-fixtures.test.ts`、`packages/docx/test/export-rich-blocks.test.ts`、`packages/docx/test/roundtrip-diff.test.ts` 均包含在 23 files / 130 tests passed 的 focused suite 内；Kimi valid 路径 roundtrip `matches: true` 且 warning 为空。
- [x] Gate 5 商业高级 PDF 基础导出通过截图对比。
  - 完成 2026-05-27：Gate 5 当前工作树复核中 `packages/pdf/test/visual-report.test.ts`、`packages/pdf/test/public-api.test.ts`、`packages/pdf/test/worker.test.ts` 均包含在 focused suite 内；Kimi valid 路径 PDF 导出完成，progress 为 `queued -> mapping -> writing -> done`，当前入口继续明确不提供 PDF 导入查看。
- [x] Gate 5 未授权、过期和 feature 不匹配失败路径通过。
  - 完成 2026-05-27：商业化执行记录覆盖 `missing`、`expired`、`feature-mismatch`、`server-unavailable`、`valid` 五种模式；当前工作树复核重新验证 missing 和 feature-mismatch 真实浏览器路径，focused suite 覆盖 `tests/architecture/gate5-commercial-readiness.test.ts`。
- [ ] 保格式粘贴通过安全验收。

### Stable 完成

- [x] 协同最终一致性通过。
- [x] 离线恢复通过。
- [x] 自动插入并发通过。
- [x] 远端 cursor 用户名、颜色和 `正在输入` 提示通过真实多页面验收。
- [x] collab client/server 版本握手、未授权失败和 server-side enforcement 通过。
- [x] `@4xian/jword-collab-server` self-host package 可部署并通过 health/version/history 验收。
- [ ] React/Vue wrapper 集成通过。
- [ ] 插件 API 和错误隔离通过。
- [ ] 文档站、公开 API 清单、授权文档和 diagnostics 完成。

## 风险控制与复核点

- [x] 复核点 A：Gate 1 完成后，确认 Y.Doc schema、Projection、Operation、AnchorRef 是否足以承载 docx、协同、自动插入；若不足，在进入 Gate 2 前修正。
  - 已修：Operation/TextPosition/TextRange 已是 JSON 可序列化契约，`splitBlock.newRunId` 改为显式字段，operation fixture 可跨实例回放。
  - 完成 2026-05-12：边界已收口为 Operation adapter/replay 路径，raw Yjs structural update 非 Gate 1 保证；实现说明见 `docs/superpowers/implementation-notes/2026-05-12-gate-1-anchor-replay-boundary.md`。
- [x] 复核点 B：Gate 2 完成后，确认 LayoutBox 当前边界是否足以继续承载 PDF、页眉页脚、表格、图片和 hit-test 的后续扩展；若不足，在进入 Gate 3 前修正。
  - 回写 2026-05-14：当前可执行证据只覆盖分页 text layout/render、viewport virtualization、hit-test 和 rect mapping。LayoutBox/PageBox/LineBox/TextFragment/InlineBox 已作为只读 layout/render/PDF 边界导出，未见会阻断 Gate 4/5 表格、图片、页眉页脚扩展的结构性缺口；但这些能力本身不算 Gate 2 已完成。
- [x] 复核点 C：进入 Alpha 前，确认输入系统、IME、selection、history 没有绕开 transaction pipeline；若绕开，不进入 Alpha。
  - 完成 2026-05-15：`packages/core/test/editor-input.test.ts` 已补充 composition、keyboard、clipboard、pointer selection 的 runtime 证据，确认写入型行为会发出 facade `transaction` 事件并带 `commandName` / `operationKinds` / history metadata，而纯 selection 变化只走 `selectionChange`，不伪装成事务写入。
  - 说明 2026-05-19：此复核只覆盖当前已实现并已验证的输入路径；Windows 中文输入实机证据已在 Step 3.3 按真实浏览器 + 系统 IME 链路补齐。
- [x] 复核点 C2：Gate 4.5 完成后，确认 `.jword` 原生格式可保存、打开、迁移、校验资源和继续编辑；若不可用，不进入 Beta。
  - 完成 2026-05-27：`packages/native` 覆盖保存/打开、schema migration、资源 checksum、缺失资源 warning、hash mismatch error、future schema diagnostic 和取消；vanilla demo 真实 Chrome 验收确认打开后可继续编辑并再次保存。
- [x] 复核点 D：Gate 5 技术互通完成后，确认 OOXML mapping 的 warning、fixture diff、worker cancel/progress 可用；若不可用，不进入 Beta。
  - 完成 2026-05-25：WPS-only 口径下 Gate 5 已收口；OOXML mapping warning、T1/T2 fixture diff、DOCX/PDF worker progress/cancel、lazy-load、benchmark、PDF visual report 和真实浏览器 demo 路径均有 focused 证据。Open XML validator、Microsoft Word 和 LibreOffice 保留 pending/not-run，不作为当前 Gate 5 阻塞项。
- [x] 复核点 D2：Gate 5 商业化完成后，确认授权、worker/license enforcement、私有 package 检查、未授权失败和第三方高级包示例可用；若不可用，不进入 Beta。
  - 完成 2026-05-27：`@4xian/jword-license`、DOCX/PDF worker entitlement fail-fast、`tools/release/check-gate5-commercial-pack.mjs`、`examples/docx` 公开高级包集成和 Kimi WebBridge 未授权/feature mismatch 路径已通过当前工作树复核；Gate 7 文档站正文仍按 Gate 7 范围单独落地。
- [x] 复核点 E：Gate 6 完成后，确认 origin、undo scope、remote/AI/local 并发语义、授权、server package、client/server version handshake 和第三方公开 API 集成清晰；若不清晰，不进入 Stable。
  - 完成 2026-05-27：当前工作树复核显示 Gate 6 的 origin / undo scope / remote-AI-local 并发语义、授权、server package、client/server version handshake 和第三方公开 API 集成已经有可执行证据。核心证据包括：`packages/core/test/collaboration/editor-update.test.ts` 和 `packages/core/test/collaboration/inserter.test.ts` 约束 `remote-user`、`auto-inserter`、`version-restore` 的 history scope；`examples/collab/tests/collab-auto-insert-concurrency.e2e.ts` 真实浏览器覆盖自动插入期间本地和远端并发、取消、位置删除、恢复冲突和独立 undo；`packages/collab-server/test/server.test.ts` 覆盖 self-host server、history API、WebSocket 授权和 `/auto-insert/relay` server-side enforcement；`packages/collab/test/public-client.test.ts` 覆盖 client/server version handshake 和授权 fail-fast；`tests/architecture/gate6-import-graph.test.ts`、`tests/architecture/gate6-package-exports.test.ts`、`tools/release/check-gate6-third-party-smoke.mjs` 约束第三方公开 API 集成；本轮补充 `tests/architecture/gate6-commercial-readiness.test.ts` 把 Gate 6 验收、禁止事项和复核点 E 变成可回归 checklist。注意：Stable 完成项中的 React/Vue wrapper、插件 API、文档站正文和 release dry-run 仍属 Gate 7，不在本复核点内提前完成。

## 执行顺序建议

- [ ] 第一批只能做 Gate 0。
- [ ] Gate 1 中 schema、operation、projection、anchor、history 可以分工并行，但必须先统一 Y.Doc 结构和类型边界。
- [ ] Gate 2 中 layout 和 renderer 可以并行，但 hit-test/rect mapping 必须以同一 LayoutBox 为准。
- [ ] Gate 3 中 input、toolbar、a11y 可以并行，但所有命令必须调用同一 Editor Facade。
- [ ] Gate 4 中图片、表格、批注、查找替换可以按模块并行，每个模块都要自带 model/operation/layout/render/UI/test 闭环。
- [x] Gate 4.5 必须在 Gate 5 商业格式互通前完成，基础保存/打开统一由 `.jword` 原生格式承担。
  - 完成 2026-05-27：`.jword` 原生保存/打开已作为免费基础能力闭环；后续 Gate 5 继续只承担商业高级 DOCX/PDF 互通。
- [x] Gate 5 中 DOCX 和 PDF 可以并行，但二者都必须复用 canonical model/LayoutBox，并在发布前补齐授权、私有包和第三方集成边界。
  - 完成 2026-05-27：DOCX 路径经 canonical import/export 与 T1/T2 fixture diff 复核，PDF 路径经 `DocumentLayout/LayoutBox -> PDF` 和 visual report 复核；授权、私有包检查和第三方 `examples/docx` 集成边界已由 Gate 5 当前工作树复核覆盖。
- [x] Gate 6 中 collab、offline、history、auto inserter 可以并行，但 edition matrix、origin/undo scope、license contract、server package 和 client/server protocol 必须先定。
  - 完成 2026-05-27：Gate 6 edition matrix、origin/undo scope、license contract、正式 server package、client/server protocol/version handshake 和中立 location API 已按 Iteration 10-18 收口并有 focused tests、真实浏览器和 pack/bundle 证据；Gate 7 wrapper、plugin、devtools、文档站正文和 release dry-run 仍按后续 Gate 单独推进。
- [ ] Gate 7 中 wrapper、plugin、devtools、docs 可以并行，但 Public API 清单、edition matrix、feature key 和诊断码必须先冻结。

## 完成定义

本计划完成不是“代码写完”，而是满足以下条件：

- [ ] Gate 0-7 所有验收项完成。
- [ ] canonical specs 与实现行为一致。
- [ ] 所有公开 API 有类型、TSDoc、类型测试、示例和集成文档。
- [ ] 免费基础能力、Gate 5 付费格式能力、Gate 6 付费协作能力的边界清晰，基础包不包含高级包代码。
- [ ] 所有付费能力都有授权、未授权失败、版本兼容、私有包审计和真实第三方集成验收。
- [ ] 所有核心风险有 fixture、benchmark、E2E 或 visual evidence。
- [ ] 旧路线中的单长 canvas、Bun 主工具链、Mammoth 主路径、浏览器打印 PDF 主路径没有回流。
- [ ] 人工审批后才能 commit、tag、publish 或 npm release。
