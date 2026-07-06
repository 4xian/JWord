# JWord Canonical Implementation Plan

> **For agentic workers:** Follow the current repository `AGENTS.md` and remediation workflow before executing any task. Steps use checkbox (`- [ ]`) syntax for tracking. This plan intentionally contains no detailed code; implementation must be written later against the referenced canonical specs.

**Goal:** 按 canonical specs 从 0 到 1 实现 JWord 类 Word 在线编辑器 SDK，并保证第一天开始就是最终路线：分页 Canvas、Y.Doc 真源、OOXML 语义模型、统一 transaction pipeline、worker 互通、framework-agnostic core。

**Architecture:** `@4xian/jword-core` 负责状态、事务、投影、排版、渲染、输入、历史和 Editor Facade；UI、JWord 原生格式、docx、PDF、协同、协同服务端、授权、devtools、React/Vue wrapper 都是独立包。基础编辑器必须能用 JWord 原生 `.jword` 格式保存和打开；DOCX/PDF 互通、多人协作、离线和自动插入属于商业高级能力。所有编辑来源都先变成 Command/Operation，再进入 `ydoc.transact(origin)`，Layout/Render/native/docx/PDF 只消费公开 canonical model、只读 projection 或 LayoutBox。

**Tech Stack:** pnpm workspace, TypeScript 6 strict, ESLint 10 flat config, Rollup, Vite, Vitest, Playwright, Yjs, DOMPurify, JSZip, Web Crypto, pdf-lib, fontkit, hocuspocus self-host 服务。依赖必须固定精确版本，不写 `^` 或 `~`。

---

## 0. 计划基线

### 0.1 权威文档

> 执行日志已归档到 `docs/superpowers/plans/2026-05-11-jword-canonical-execution-log.md`。本主计划只保留目标、任务状态、验收标准、禁止事项和当前基线摘要；历史过程记录、回写和补证细节进入执行日志。

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

> Checkbox 语义（2026-07-06 状态审计）：待办步骤勾选表示实现已完成；验收项勾选表示已有可复查证据；禁止事项勾选表示已核实当前实现未违反。未勾选只表示未完成或证据不足，不表示计划反对该事项。

- [x] 每个 `.ts` 文件必须有文件头注释，说明职责、边界、协作模块、性能/安全约束、关联 specs。
- [ ] 公开 API 必须有 TSDoc、类型测试、示例用法。
- [x] Core 禁止依赖 React/Vue/docx/PDF/collab provider/demo。
- [x] Core 禁止 top-level 访问 `window`、`document`、`HTMLElement` 实例。
- [x] 所有状态变更必须走同一 transaction pipeline。
- [x] 所有 transaction 必须带 origin。
- [ ] Selection、Comment、Revision、Auto Inserter、Remote Cursor 必须复用 `AnchorRef` / `RangeRef`。
- [ ] Layout/Render 只能读 `DocumentProjection` 或 `LayoutBox`，不能直接读写 Y.Doc。
- [ ] import/export 必须在 worker 中执行，支持 progress、warning、cancel。
- [x] HTML 清洗必须使用 DOMPurify 或安全 `textContent` 路线，禁止正则 sanitizer。
- [ ] 免费基础包不得 import 商业高级包；商业高级包只能通过公开 facade 和中立 hook 接入 core。
- [ ] 商业高级能力必须有授权边界、版本兼容策略、诊断错误码和真实第三方集成示例。
- [x] 文档计划和实现过程不得自动 commit、tag、publish；这些动作必须人工审批。

### 0.4 目标包结构

- [x] `packages/core`：`@4xian/jword-core`，状态、事务、projection、layout、render、input、history、Editor Facade；plugin host 仍按 Gate 7 前置改造推进。
- [x] `packages/ui`：`@4xian/jword-ui`，原生 TS 工具栏、菜单、状态栏、批注栏、基础对话框。
- [x] `packages/native`：`@4xian/jword-native`，免费 `.jword` 原生保存/打开、资源打包、schema migration、worker bridge。
- [x] `packages/docx`：`@4xian/jword-docx`，商业高级 OOXML import/export、fixture diff、worker bridge、授权校验。
- [x] `packages/pdf`：`@4xian/jword-pdf`，商业高级 LayoutBox 到 PDF、字体配置、worker bridge、授权校验。
- [x] `packages/collab`：`@4xian/jword-collab`，商业高级 provider adapter、awareness、remote cursor、offline、snapshot adapter、auto-insert client。
- [x] `packages/collab-server`：`@4xian/jword-collab-server`，商业高级 self-host 协同服务、history API、auth/tenant/storage/license hook。
- [x] `packages/license`：`@4xian/jword-license`，商业授权 entitlement 类型、签名验证、feature matrix 和 client/server handshake 契约。
- [x] `packages/persistence`：`@4xian/jword-persistence`，基础 storage contract、商业离线恢复和协作 history 后端复用的存储适配器。
- [ ] `packages/devtools`：`@4xian/jword-devtools`，operation log、layout overlay、diagnostics panel。
- [ ] `packages/react`：`@4xian/jword-react`，React 生命周期 wrapper。
- [ ] `packages/vue`：`@4xian/jword-vue`，Vue 3 生命周期 wrapper。
- [x] `examples/vanilla`：基础集成示例，所有 gate 的第一验证目标。
- [ ] `examples/react`：React wrapper 集成示例。
- [ ] `examples/vue`：Vue wrapper 集成示例。
- [x] `examples/collab`：真实第三方接入式协作示例，只使用公开包入口和 self-host server。
- [x] `fixtures`：文档、OOXML、PDF、协同、性能、视觉回归样本。
- [x] `benchmarks`：layout、render、input、docx/PDF、collab 压测。
- [x] `tools`：自定义 lint、fixture diff、bundle size、visual report、release dry-run 工具。

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
- [x] 所有编辑路径都必须经过 transaction pipeline。

### 禁止事项

- [x] 不创建第二套可写 Model 与 Y.Doc 双向同步。
- [x] 不把临时 path 或字符 offset 暴露为公开位置 API。
- [x] 不为了 demo 绕过 transaction pipeline。

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
- [x] Step 2.15：建立 render benchmark，记录滚动 FPS、layout 耗时、render 耗时、canvas 数量、显存相关指标。
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
- [x] Step 3.4：实现 keyboard handler，覆盖输入、删除、回车、方向键、快捷键、撤销重做。
- [x] Step 3.5：实现 pointer selection，支持点击定位、拖拽选区、双击词选择的扩展边界。
- [x] Step 3.6：实现 clipboard plain text，复制、剪切、粘贴都走 safe text 路线和 transaction pipeline。
- [x] Step 3.7：实现基础 commands：加粗、斜体、下划线、删除线、字体、字号、颜色、背景色、对齐、缩进。
- [x] Step 3.8：实现 toolbar 第一版，原生 TS DOM API，使用 `jw-` BEM 类名，不引入框架。
- [x] Step 3.9：实现 toolbar 状态同步，selection 改变时显示当前 run/paragraph 状态。
- [x] Step 3.10：实现 aria-live 和隐藏文本镜像第一版，让 Canvas 编辑器有基础可访问性路径。
- [x] Step 3.11：实现基础错误恢复，输入异常时不破坏 Y.Doc 状态，用户可继续编辑。
- [x] Step 3.12：完善 Alpha E2E：IME、选择、键盘、toolbar、undo/redo、plain text clipboard。
- [ ] Step 3.13：完成 Alpha 性能验证：1-2 万字编辑、50 页滚动、输入热路径 P95 指标。

### Gate 3 补充收尾（不阻塞 Gate 4 主线）

- [x] Step 3.14：补齐 run format v1：上标、下标；要求 command、toolbar 状态、undo/redo 与 projection 落地一致。
- [x] Step 3.15：补齐 paragraph format v1：行距、段前、段后、首行缩进、悬挂缩进；要求 command -> projection -> layout -> toolbar 状态闭环。
- [x] Step 3.16：补齐 structure/style baseline：有序列表、无序列表、基础多级列表、Heading 1-3；目录与 docx numbering/outline 后续只消费这套稳定语义，不直接从纯文本猜测结构。
- [x] 补充说明：以上三项不回滚 Gate 4 准入结论，但在 Gate 4 `Step 4.11` 目录闭环和 Gate 5 docx T1 列表/标题 fixture 进入稳定验证前应完成。

### 验收

- [x] macOS 和 Windows 中文输入可用。
- [x] 输入、删除、回车、方向键、选择、复制粘贴可用。
- [x] 加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进可用。
- [x] 上标、下标可用。
- [x] 行距、段前段后、首行缩进、悬挂缩进可用。
- [x] 有序/无序/基础多级列表与 Heading 1-3 可用。
- [x] undo/redo 覆盖基础编辑和格式。
- [x] 1-2 万字文档基础编辑链路可用。
- [x] `0.1-alpha` 可由 vanilla demo 验证最终架构，不是临时 demo。

### Gate 4 准入说明

- [x] 2026-05-15：按当前阶段决策，Gate 3 已具备进入 Gate 4 的功能闭环证据。
  - 已验证范围：真实 DOM 输入、composition 事件链、pointer selection、plain text clipboard、toolbar/selection state sync、undo/redo、vanilla visual 验证、transaction pipeline 复核。
  - 已知 carry-over：Alpha 性能目标 `输入热路径 P95 < 50ms`、`INP P95 < 150ms`。
  - 约束：允许继续 Gate 4 开发，不允许对外宣称 Gate 3 Alpha 已完全完成。

### 禁止事项

- [x] 不直接操作 Projection。
- [x] 不用 contenteditable 作为核心编辑面。
- [x] 不用正则清洗 HTML。
- [x] 不在 constructor 或 top-level 访问 DOM。

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
- [x] 明确每类 fixture 的最小可观察契约：anchor、selection、history、render、error recovery。
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

#### Iteration 1 - 图片纵线（Step 4.1-4.3）

- [x] 定义资源表与 `ResourceAdapter` 公开边界：
  - 资源 id、mime、source、status、error、retry token
  - 上传、替换、删除、失败恢复、取消、进度事件
  - 白名单 URL / protocol 策略
- [ ] 为图片补 fixture 与错误场景：
  - inline image
  - upload pending / success / failed
  - replace resource
- [x] 实现 inline image 的 model、projection、selection target、anchor 映射。
- [x] 实现图片 operation：
  - 插入 inline image
  - 替换资源
  - 删除图片
  - resize
- [x] 实现图片 layout / render：
  - 占位态
  - 成功态
  - 失败态
  - resize handle
  - page-local hit-test
- [x] 在 `packages/ui/src/media/` 实现图片插入 UI：
  - 上传入口
  - 进度态
  - 失败重试
  - 恢复提示
- [x] 为图片纵线补齐单测、layout/render 测试、Chromium E2E，再补三浏览器 focused smoke。

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
- [x] 收尾现有图片路径的真实 bug：
  - 这一项只在计划里标记为待修复 / 待验收，不在本轮展开代码细节
  - 以现有图片路径修复闭环为完成条件，修复后再回填实现与验证记录
  - 验收：真实浏览器复测现有图片路径，不再出现已知 bug 的回退表现

#### Iteration 2 - 表格纵线（Step 4.4-4.7）

- [x] 定义 table / row / cell / grid / border / cell props / cell text content 的 model。
- [x] 明确 cell anchor、selection、caret、history 语义，禁止把表格当“一个大块文本”绕过去。
- [x] 实现表格 operation：
  - 插入表格
  - 插入 / 删除行列
  - 合并单元格
  - 更新边框
  - 单元格文本编辑
- [x] 实现表格 layout / render：
  - grid 几何
  - cell content layout
  - 跨页基础策略
  - cell 内 hit-test
- [x] 在 `packages/ui/src/table/` 实现表格 UI：
  - 行列选中
  - 插入 / 删除菜单
  - 边框基础控件
- [ ] 补表格 fixture、Undo/Redo 回归、三浏览器 E2E 与 visual baseline。

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
- [ ] 让所有“带作者”的数据都写入同一条身份链：
  - 批注写入 `authorId`
  - 修订写入 `authorId`
  - 后续远端光标、用户颜色高亮和协同状态复用同一套用户记录
- [x] 为身份底座补齐 fixture / 回归口径：
  - 单用户批注显示作者名
  - 同文档不同用户颜色区分
  - 缺省用户信息时的 fallback 展示

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
  - 布局决策 2026-05-23：本轮不把 `jw-editor__page` 改成 `width: 100% + flex center`。当前 page wrapper 的 margin-left 由 renderer 根据 canvas container 和 device-pixel 对齐计算，selection / image / table / comment overlay 都依赖 pageElement 的 offset 几何；若改 flex 居中，需要独立重验 hit-test、虚拟化、overlay、截图基线。批注先通过页内 rail + canvas overlay 实现一体化，不在本轮改 core 页面居中算法。
- [x] 实现超链接 model 与 protocol allowlist：
  - 插入 / 编辑 / 删除链接
  - 显示文本与目标地址分离
  - allowlist 默认至少覆盖 `http` / `https` / `mailto`
  - 点击已有链接时在快捷工具里提供“打开链接”与“编辑链接”
- [x] 在 `packages/ui/src/link/` 实现超链接编辑弹窗与打开行为。
- [x] 补 comment / link / user fixtures、文本编辑后 anchor 稳定性回归、author display 回归、focused E2E。

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
- [x] 若 Gate 3 `Step 3.16` 的 Heading baseline 仍未闭环，先补 heading source 与 toolbar/command 入口，再接目录 block，禁止目录阶段临时扫描纯文本猜测标题层级。
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
- [x] 在 `packages/ui/src/header-footer/` 与 `packages/ui/src/find-replace/` 落控制 UI。
  - UI 控件必须属于 `@4xian/jword-ui`，vanilla 不得重新实现官方逻辑。
  - CSS 继续使用 flex，不使用 grid / gap。
- [x] 保留移动 Web 分页预览可阅读，不承诺完整移动编辑。
  - UI / host 落点：
    - `packages/ui` 保留同一套 editor/canvas 渲染，不新增移动端第二套只读模式。
    - 保留分页 canvas、横向适配和基础缩放。
    - vanilla 增加移动视口分页回归入口，不能变成第二套 demo editor。
  - 验收：
    - mobile viewport browser test 覆盖可滚动阅读和分页 canvas 非空。
    - 视觉检查确认移动宽度下文本和按钮不重叠。

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
- [x] 建立 Gate 4 visual baselines：
  - 图片占位 / 成功 / 失败态
  - 表格边框与跨页
  - 批注高亮与侧栏
  - 目录面板与查找高亮
  - 页眉页脚 / 页码
  - 修订 markup
  - 移动视口分页
- [x] 建立 Gate 4 perf 护栏，至少记录：
  - 表格大页滚动
  - 图片混排文档滚动
  - 查找替换结果量上升时的交互延迟
  - 批注 / 目录 / 修订 overlay 同屏时的滚动延迟
- [x] 验证新能力全部落在 `core` / `ui`，不回塞到 `examples/vanilla/src/main.ts`。
  - architecture check 必须覆盖 `packages/ui/src/find/`、`packages/ui/src/header-footer/`、`packages/ui/src/outline/`、全局只读入口和 paste adapter。
  - 主进程验收必须包含真实浏览器证据；Kimi WebBridge 优先，Playwright 作为自动化回归补充。

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

### 验收

- [x] 表格内文本编辑与 undo/redo 正确。
- [x] 图片上传成功可替换资源，失败可恢复。
- [x] 批注 anchor 在文本编辑后仍定位正确。
- [x] 查找替换不会绕过 transaction pipeline。
- [x] 页眉页脚和页码参与分页布局。
- [x] 修订插入、删除、格式变更至少可查看、可定位、可解释。
- [x] 粘贴 HTML 不产生 XSS。
- [x] 移动视口分页预览可阅读。

### 禁止事项

- [x] 不直接信任外部图片 URL。
- [x] 不用不稳定字符 offset 保存批注、查找结果或目录目标。
- [x] 不把复杂修订接受/拒绝作为 `1.0-stable` 强承诺。

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


#### Iteration 11 - 实现 T1 DOCX import：列表与编号

- [x] 解析 `numbering.xml`。
- [x] 解析 `w:numPr`。
- [x] 映射 bullet list。
- [x] 映射 decimal ordered list。
- [x] 映射基础 multi-level list。
- [x] 保留原始 numbering id 和 level metadata，供 export roundtrip 使用。
- [x] 对复杂编号格式输出 warning。
- [x] 验证：`docx-t1-lists` 导入后列表 marker、缩进、层级稳定。


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


#### Iteration 14 - 实现 T1 DOCX import：页面设置与分页符

- [x] 解析 section properties。
- [x] 映射页面宽高。
- [x] 映射页边距。
- [x] 映射 page break。
- [x] 映射基础 section break。
- [x] 不支持 columns、复杂纸张方向或复杂 section 继承时输出 warning。
- [x] 验证：`docx-t1-page-setup` 导入后 page config 和分页截图稳定。


#### Iteration 15 - 实现 warning 与 opaque preservation 策略

- [x] 未知 OOXML 节点必须输出 warning。
- [x] 未知样式必须输出 warning，并尽量继承 default style。
- [x] relationship 断裂必须输出 warning 或错误。
- [x] unsupported part 保留原始 part bytes/text。
- [x] unsupported relationship 保留原始 relationship metadata。
- [x] 编辑后无法安全恢复的 opaque 内容必须标记为 `unsafeToPreserveAfterEdit`。
- [x] 导出时只对未被编辑影响的 opaque part 做 preserve。
- [x] 验证：含 T3 内容的 fixture 不崩溃，不静默丢内容。


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


#### Iteration 17 - 实现 T1 DOCX export：文本、样式、段落

- [x] 从 JWord projection 生成 `w:p`、`w:r`、`w:t`。
- [x] 输出 run direct formatting。
- [x] 输出 paragraph formatting。
- [x] 输出 Heading 1-3 style。
- [x] 输出 styles part 中的基础 style 定义。
- [x] 正确处理 XML escape、空格保留和换行。
- [x] 验证：T1 文本与样式 fixture export 后重新 import 不丢样式。


#### Iteration 18 - 实现 T1 DOCX export：列表、表格、图片

- [x] 输出 numbering definitions。
- [x] 输出 paragraph numbering refs。
- [x] 输出基础 table XML。
- [x] 输出表格 grid、border、cell text。
- [x] 输出 inline image DrawingML。
- [x] 输出 media part 和 image relationship。
- [x] WPS-only 验证：列表、表格、图片导出后 WPS 可打开，重新导入结构一致。


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


#### Iteration 23 - 实现 PDF 中文字体、图片、表格线和页眉页脚

- [x] 使用 fontkit 注册自定义字体。
- [x] 字体不支持字符时返回可恢复错误。
- [x] 缺少中文字体时禁止输出乱码 PDF。
- [x] 嵌入 PNG/JPEG 图片。
- [x] 输出表格线。
- [x] 输出页眉页脚。
- [x] 输出页码。
- [x] 验证：`pdf-chinese-font`、`pdf-missing-font`、`pdf-table-image`、`pdf-header-footer-page-number` 都有确定结果。


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
- [x] Step 5.4：建立统一 warning/error schema，覆盖未知节点、未知样式、外链资源、断裂 relationship、缺字体、用户取消。
- [x] Step 5.5：创建 `@4xian/jword-docx` 最小可测包和 import/export/inspect API。
- [x] Step 5.6：实现 OPC package reader，解析 `[Content_Types].xml`、root rels、main document、document rels 和 part graph。
- [x] Step 5.7：实现 XML parse/serialize 抽象和 namespace-aware helper。
- [x] Step 5.8：建立 style、numbering、relationship、media、comments、header/footer indexes。
- [x] Step 5.9：定义 DOCX import 中间模型和 opaque preservation metadata。
- [x] Step 5.10：补 core 结构化导入入口，经统一 transaction/mutation 写入 Y.Doc。
- [x] Step 5.11：实现 T1 DOCX import：段落、run、文本、run 样式。
- [x] Step 5.12：实现 T1 DOCX import：段落格式、Heading 1-3、缩进、行距、段距。
- [x] Step 5.13：实现 T1 DOCX import：基础有序/无序/多级列表。
- [x] Step 5.14：实现 T1 DOCX import：简单表格、边框、单元格文本、基础列宽。
- [x] Step 5.15：实现 T1 DOCX import：inline 图片、资源、尺寸、alt text。
- [x] Step 5.16：实现 T1 DOCX import：页面尺寸、页边距、分页符。
- [x] Step 5.17：实现 unknown warning 和 opaque preservation，禁止静默丢弃未支持 OOXML。
- [x] Step 5.18：实现 DOCX export package foundation，生成 Transitional DOCX 基础 package。
- [x] Step 5.19：实现 T1 DOCX export：文本、run 样式、段落格式、Heading。
- [x] Step 5.20：实现 T1 DOCX export：列表、表格、inline 图片、media relationships。
- [x] Step 5.21：建立 DOCX roundtrip diff，导出后重新导入并比较 T1 核心结构和样式。
- [x] Step 5.22：建立 WPS-only 人工兼容矩阵，并保留 Open XML validation / Word / LibreOffice pending 记录。
- [x] Step 5.23：创建 `@4xian/jword-pdf` 最小可测包和 PDF worker。
- [x] Step 5.24：实现 PDF 字体配置 API，支持 URL、File、ArrayBuffer。
- [x] Step 5.25：实现 LayoutBox -> PDF 基础页面和文本输出。
- [x] Step 5.26：实现 PDF 图片、表格线、页眉页脚和页码输出。
- [x] Step 5.27：处理中文字体缺失和字符不支持错误，禁止输出乱码 PDF。
- [x] Step 5.28：建立 PDF.js 渲染截图对比和 Canvas baseline 差异报告。
- [x] Step 5.29：建立 `examples/docx` 手动验收入口。
- [x] Step 5.30：建立 import/export/PDF benchmark。
- [x] Step 5.31：验证 DOCX/PDF worker lazy load，不进入 vanilla 首屏 bundle。
- [x] Step 5.32：推进 T2 种子，未完成项必须 warning 或 preserve。
- [x] Step 5.33：跑 Gate 5 总验收，回写每个完成项和遗留项。

- [x] Step 5.34：补 Gate 5 商业 edition matrix，明确 `.jword` 原生保存/打开免费，DOCX 导入、DOCX 导出和 PDF 导出属于高级格式互通。
- [x] Step 5.35：接入 `@4xian/jword-license` entitlement 校验，worker task 在未授权、授权过期或 feature 不匹配时 fail-fast，且不读取或输出用户文档内容。
- [x] Step 5.36：补 `examples/docx` 真实第三方集成模式，只通过公开高级包 API 传入 license、feature、editor 和文件，不 import `packages/docx/src`、`packages/pdf/src` 或 worker 内部模块。
- [x] Step 5.37：建立未授权失败 E2E：DOCX 导入、DOCX 导出和 PDF 导出分别返回稳定 diagnostic，编辑器正文、selection 和 active task 状态不被破坏。
- [x] Step 5.38：建立商业包发布检查：私有 registry 说明、`npm pack` 内容审计、types/export map 审计、基础 bundle 扫描和高级包按需加载扫描。
- [x] Step 5.39：把 Gate 5 公开 API 清单、授权错误码、feature key、集成步骤和收费边界加入 Gate 7 文档站计划。


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

版本历史主路径为 Yjs update log + periodic snapshot + metadata index。版本恢复不是把 DOCX 覆盖回编辑器，也不是把 projection JSON 当主存；恢复应基于目标 snapshot/update 在隔离 Y.Doc 中生成 readonly preview，用户确认后通过受控 restore transaction 写入当前 Y.Doc，并保留失败诊断和本地未同步变更保护。技术决策见 `docs/superpowers/plans/2026-07-06-gate6-history-yjs-gc-decision.md`：版本历史禁止依赖 `Y.Snapshot` 和全生命周期 `gc = false`；默认每 200 个 update 或 5 分钟生成一个 snapshot，compaction 保留最近 50 个 snapshot，更旧数据通过宿主 storage hook 归档。

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

#### Iteration 1 - core 协同 hook、origin 和 history scope（Step 6.1 / 6.4 / 6.8 / 6.9）

- [x] 审查 `TransactionPipeline`、`createHistoryManager()`、`EditorCommandOptions.origin`、`AnchorRef` / `RangeRef` 和 `loadDocumentModel()` 的当前边界。
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
- [x] 使用 Yjs update API 实现：
  - 追加 incremental update。
  - `Y.mergeUpdates()` 合并 update。
  - `Y.encodeStateVectorFromUpdate()` 建版本索引。
  - 必要时加载到隔离 Y.Doc 做 garbage collection / projection preview。
  - 禁止依赖 `Y.Snapshot` 或为了历史预览关闭全生命周期 `gc = false`；JWord snapshot record 只是 state update checkpoint。
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
- [x] 补 R2 技术决策：`docs/superpowers/plans/2026-07-06-gate6-history-yjs-gc-decision.md` 冻结 `update log + 隔离 Y.Doc 重放` 路线和 update log 增长治理；每 200 个 update 或 5 分钟生成 snapshot，保留最近 50 个 snapshot，更旧数据通过宿主 storage hook 归档。

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
- [x] 补真实浏览器验收：
  - 启动 AI streaming 插入。
  - 插入期间用户继续输入。
  - 插入期间远端用户继续输入。
  - abort 后 editor 仍可输入。
  - 用户 undo 不撤销 AI 内容，独立 AI undo scope 可撤销 AI 内容。
- [x] 验证：auto inserter 不使用普通字符 offset，不阻塞本地输入，不绕过 Editor transaction。

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

#### Iteration 9 - lazy-load、bundle、benchmark 与 Gate 6 总验收

- [x] `packages/collab` 和 `packages/persistence` 不进入 `examples/vanilla` 首屏 bundle。
- [x] `examples/collab` 按需加载 provider/offline/history 运行时。
- [x] 建立 Gate 6 benchmark：
  - [x] 双客户端 1k / 10k updates apply 时间。
  - [x] update byte length。
  - [x] snapshot create/load 时间。
  - [x] version preview 时间。
  - [x] auto inserter 1k / 10k 字写入期间输入响应。
  - [x] IndexedDB restore 时间。
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
- [x] Step 6.3：实现 awareness，展示在线用户、远端光标、远端选区；presence 不进入正文历史。
- [x] Step 6.4：实现 remote update 进入 projection/layout/render 的路径，确保仍走统一 Y.Doc 真源和受控 transaction hook。
- [x] Step 6.5：接入 `y-indexeddb` 或等价离线恢复能力，断网编辑后可恢复并同步。
- [x] Step 6.6：定义 snapshot adapter，支持 update log、snapshot 保存、snapshot 加载、版本列表、readonly preview 和 compaction；版本历史技术决策禁止 `Y.Snapshot + gc=false` 路线，固定走 update log 和隔离 Y.Doc 重放。
- [x] Step 6.7：实现 `createInserter()` API，支持 stable anchor/range、chunk、throttle、flush、abort、progress、error。
- [x] Step 6.8：实现 auto inserter origin 策略，默认不进入用户 undo 栈。
- [x] Step 6.9：实现可配置 undo scope，允许 AI/程序化写入进入独立 undo scope，但不混入本地用户 undo。
- [x] Step 6.10：实现 remote/local 并发测试：双用户同段输入、同位置输入、删除与格式化冲突、批注 anchor 远端编辑稳定、local undo 不撤销 remote。
- [x] Step 6.11：实现 AI 自动插入与用户手动编辑并发测试，确认不重复、不丢失、不阻塞输入、不污染 undo。
- [x] Step 6.12：实现断网恢复测试，失败时保留本地未同步变更并给出诊断事件。
- [x] Step 6.13：实现历史版本最小闭环：版本列表、只读预览、恢复、失败诊断；基于 update log / snapshot，不以 docx 覆盖真源。
- [x] Step 6.14：建立 Gate 6 fixture registry 和 diagnostics registry，约束 collab/offline/history/inserter 的输入、事件和预期。
- [x] Step 6.14a：把 Gate 5 DOCX 导入 fixture 纳入 Gate 6 registry，至少覆盖一个 T1 成功导入文档和一个 T2 warning 文档；验证导入后内容通过 `loadDocumentModel()` 写入同一 Y.Doc，并可参与协同、离线、历史和自动插入场景。
- [x] Step 6.15：实现 `examples/collab` debug API 与真实浏览器验收入口。
- [x] Step 6.16：验证 collab/offline/history/inserter lazy-load，不进入 vanilla 首屏 bundle。
- [x] Step 6.17：建立 Gate 6 benchmark，覆盖 update apply、snapshot create/load、version preview、offline restore 和 auto inserter streaming。
- [x] Step 6.18：跑 Gate 6 总验收，回写每个完成项、真实浏览器证据、失败项和遗留项。
- [x] Step 6.19：冻结 Gate 6 商业 edition matrix，明确免费基础版不包含多人协作、离线协作、协作历史、协作服务端或自动插入；付费高级版按 feature key 开启 `collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
- [x] Step 6.20：冻结 `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license` 的导出分级和 export map；stable API 只包含第三方可承诺入口，experimental 只包含可替换 provider/storage adapter，internal 不允许从包入口导出。
- [x] Step 6.21：建立商业边界架构测试和授权 diagnostics，证明 `packages/core`、`packages/native`、`examples/vanilla` 不 import collab/server/license 高级包；未授权、过期、feature 不匹配、license server 不可用分别返回稳定诊断，且不读取或泄漏用户文档内容。
- [x] Step 6.22：在 core 中补中立位置 API，命名必须保持基础能力语义，例如 selection snapshot、anchor snapshot、range snapshot、text location、query result；类型名和方法名不得带 `collab`、`ai`、`autoInsert` 等高级功能前缀。
- [x] Step 6.23：实现获取当前位置和查询内容位置的方法，支持从当前 selection 创建 anchor/range，也支持按文本、block id、heading、comment id 或 range snapshot 查询插入位置；返回值必须可序列化，供高级包、普通跳转和宿主业务共同使用。
- [x] Step 6.24：建立位置 API 的 focused tests、类型测试和真实浏览器验收，证明返回值不泄漏 Yjs RelativePosition、document-store、DOM Range、canvas 坐标或 provider 内部状态；自动插入和普通跳转都只能消费这层公开位置结果。
- [x] Step 6.25：定义 `connectJWordCollaboration(editor, options)` 公开入口，options 至少包含 `serverUrl`、`documentId`、`roomId`、`user`、`token`、`license`、`features`；初始化失败必须返回 diagnostic，不允许半连接状态。
- [x] Step 6.26：定义用户身份与 presence 配置，`user` 支持 `id`、`name`、`color`、`avatarUrl`，未传 `color` 时按 user id 生成稳定颜色；远端光标、选区和输入提示都从这份公开用户信息派生。
- [x] Step 6.27：定义 collaboration connection handle，至少包含 `status`、`diagnostics`、`awareness`、`history`、`offline`、`startAutoInsertSession()`、`disconnect()`、`destroy()`；handle 销毁后必须清理 provider、awareness、offline watcher 和 event listener。
- [x] Step 6.28：建立外部 TypeScript 消费测试，只从 `@4xian/jword-collab` 包入口导入 API，完成 connect、disconnect、history、offline 和 auto insert 调用；stable API 中不得出现 Hocuspocus、Y.Doc、Yjs update store 或 demo runtime 类型。
- [x] Step 6.29：从 `examples/collab/server` 抽出 `@4xian/jword-collab-server` 正式服务包，第三方不需要复制 demo server 源码；demo server 只能变成该正式包的最小启动器。
- [x] Step 6.30：提供 Node 服务入口和可嵌入 handler：`createJWordCollabServer(options)`、`startJWordCollabServer(options)`；同一服务包支持本地开发、第三方自托管和测试环境启动。
- [x] Step 6.31：定义 server options：`authHook`、`tenantHook`、`licenseHook`、`historyStorage`、`snapshotStorage`、`rateLimit`、`maxPayloadBytes`、`allowedOrigins`、`logger`；hook 返回值必须可诊断，不能把业务权限逻辑写进 core 或 client。2026-07-06 补充：正式 Hocuspocus WebSocket `authHook` 返回 per-user `read` / `comment` / `write`，1.0 中只有 `write` 可提交 update，`comment` 为 post-1.0 批注级 enforcement 预留角色。
- [x] Step 6.32：实现 `/health`、`/version`、`/history`、`/license/status` API，响应包含 `protocolVersion`、`packageVersion`、`featureFlags`、`minimumClientVersion`、`minimumServerVersion` 和可观测 request id。
- [x] Step 6.33：在服务端强制 license enforcement 和 history 并发边界；client-side license check 只用于 UX 提示，服务端必须在 WebSocket 连接、history API、auto-insert relay 和 storage 写入前校验 entitlement。
- [x] Step 6.34：提供 self-host 部署最小路径：本地 Node 启动、Dockerfile 或等价脚本、环境变量说明、反向代理 WebSocket 注意事项、health check 和日志字段；部署示例必须使用正式 server 包而不是 demo 源码。
- [x] Step 6.35：定义 client/server handshake contract，包含 `protocolVersion`、`clientPackageVersion`、`serverPackageVersion`、`featureFlags`、`minimumServerVersion`、`minimumClientVersion`；client 连接前必须先完成 handshake。
- [x] Step 6.36：实现版本不匹配诊断，server 过旧、client 过旧、protocol 不兼容或 featureFlags 缺失分别返回稳定错误；失败后编辑器仍保留本地单人编辑能力，不进入半协作状态。
- [x] Step 6.37：建立版本握手 E2E 和 diagnostics export，覆盖版本匹配成功、server 过旧失败、client 过旧失败、feature 缺失失败；client 和 server 导出的版本信息必须一致，便于第三方排障。
- [x] Step 6.38：远端 cursor 在光标附近显示用户名称和输入状态，显示格式为 `用户名称 正在输入`；只显示远端用户，不覆盖本地用户自己的光标 UI。
- [x] Step 6.39：多用户 cursor 颜色来自初始化 `user.color` 或稳定 fallback；相邻光标、选区和 label 需要稳定排序和轻量错位，避免遮挡当前用户正在输入的位置。
- [x] Step 6.40：typing activity 必须有节流、过期时间和断连清理；停止输入后自动隐藏 `正在输入`，但可继续显示远端 cursor / selection；presence 事件不进入版本历史、不进入 undo、不产生正文 transaction。
- [x] Step 6.41：真实浏览器多页面验收至少覆盖 2 个和 5 个用户，检查用户名、颜色、typing label、重叠 cursor、断连清理和屏幕滚动后的定位稳定性。
- [x] Step 6.42：定义 `startAutoInsertSession()` 公开 API，必须接收 `position` 或 `range`；位置来源可以是 selection snapshot、anchor/range snapshot、findText result 或 resolveLocation result，不能默认读取当前 live caret。
- [x] Step 6.43：自动插入 session 创建后不得调用 editor focus、不得修改用户当前 selection、不得依赖 DOM caret；用户在插入期间手动点击其它位置并输入时，自动插入仍在指定位置或 range 中推进。
- [x] Step 6.44：自动插入以虚拟远端 actor 进入协作体系，支持 actor `id`、`name`、`color`、`avatarUrl`，例如 `AI Assistant` 或业务方传入的机器人名称；该 actor 的内容、presence、diagnostics 和 undo scope 必须与真实用户区分。
- [x] Step 6.45：流式写入支持 progress、abort、error、requestId、chunk metadata、retry 和独立 undo scope；失败时保留已提交内容、返回可诊断状态，不做不可控回滚。
- [x] Step 6.46：真实浏览器验收覆盖自动插入进行中用户手动点击其它位置继续输入、远端用户同时输入、自动插入取消、位置被删除、版本恢复冲突和独立 undo；重点验证不抢光标、不丢内容、不污染用户 undo。
- [x] Step 6.47：重写 `examples/collab` 主入口为真实第三方集成方式：基础 editor/UI 初始化后动态 import 高级 client 包，连接正式 self-host server，传入 user/license/room/documentId/serverUrl/features。
- [x] Step 6.48：demo 和测试不得直接 import `packages/collab/src`、`packages/collab-server/src`、`examples/collab/src/runtime/*`、server 内部 service、Y.Doc store 或 core 内部 store；只能通过公开包入口、公开 facade 和浏览器用户行为完成验收。
- [x] Step 6.49：建立 import graph 架构测试扫描 examples/tests，禁止底层源码路径、测试 helper 和 demo runtime 代替公开 API；允许保留宿主级 debug hook，但 debug hook 不能成为第三方集成 API。
- [x] Step 6.50：双页面验收必须是两个浏览器页面、两个 user、同一 room、同一 documentId；主验收不得使用同一页面多个 textarea 实例，也不得只用内存双 Y.Doc 模拟替代真实 provider。
- [x] Step 6.51：补第三方集成 README 草稿和 smoke script，脚本从空项目安装基础包、高级包和 server 包，按公开 API 启动协作、自动插入、历史版本和未授权失败演示。
- [x] Step 6.52：建立私有 registry / `npm pack` 检查，高级 client、server、license 包只包含 dist、types、README、license metadata 和必要运行文件，不包含测试私有文件、内部 fixture 或源码路径泄漏。
- [x] Step 6.53：建立 bundle gate，证明 free vanilla 首屏不包含 collab、hocuspocus、license、IndexedDB offline runtime、server client code；高级示例必须按需加载，未启用高级功能时不拉取高级 chunk。
- [x] Step 6.54：扩展 diagnostics registry，覆盖授权、版本、server、network、offline、history、auto-insert、presence、storage、rate limit、payload limit 和 tenant/auth hook 失败。
- [x] Step 6.55：扩展 benchmark，覆盖 2/5/20 用户、1k/10k updates、离线重连、版本 snapshot、自动插入 1k/10k 字、server history API、license handshake 和版本握手。
- [x] Step 6.56：把 Gate 6 公开 API 清单、self-host server 部署、授权接入、client/server 版本策略、故障排查、收费能力边界和迁移指南加入 Gate 7 文档站计划。

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
- [x] 不让 demo/test 通过 `packages/*/src`、Y.Doc store、内部 runtime 或 server service 绕过公开 API。
- [x] 不把生产 server 只藏在 demo 目录；第三方必须能安装正式 server 包并以公开 options 启动。
- [x] 不把付费边界只放在浏览器 JS；用户拿到 client 包也不能绕过服务端或 worker/license enforcement。
- [x] 不在 core 稳定 API 中暴露 `collab`、`offline`、`autoInsert` 等高级产品 API 名称；core 只提供中立位置、anchor/range、transaction hook。
- [x] 不让自动插入读取 live caret、抢 focus 或修改用户手动 selection。
- [x] 不允许 client/server 版本不匹配时静默继续协作。

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
  - `@4xian/jword-persistence` 导出分级：stable 为基础 storage contract、diagnostics、memory/storage history adapter 类型和不可用 IndexedDB fallback；experimental 为 browser IndexedDB adapter 行为；internal 为 Yjs reconstruction、SHA-256 helper、storage serialization helper 和实现类。
- [ ] 冻结 edition matrix：
  - free：core、ui、native、基础 persistence contract、基础 diagnostics。
  - free base contract：基础 storage contract、基础 diagnostics、memory/storage adapter 类型。
  - paid format：docx import、docx export、PDF export。
  - paid collaboration：collab client、collab server、offline、history、auto insert、license；协作相关 persistence adapter 只随付费协作场景进入高级能力边界。
- [ ] 冻结 package / example 落点，但不预创建空壳：
  - `packages/native/src/`
  - `packages/license/src/`
  - `packages/persistence/src/`
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
- [x] 冻结浏览器支持矩阵：桌面编辑 Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4；移动端仅承诺只读分页预览，不承诺移动端编辑；构建 target 对齐 ES2022；Playwright Chromium / Firefox / WebKit 最新版作为浏览器族回归矩阵。公开口径见 `docs/sdk/browser-support.md`。
- [ ] 复核点 F 准入：Gate 7 Iteration 0 完成后按 `docs/superpowers/plans/2026-07-06-gate7-risk-checkpoint-f.md` 一次性冻结 edition matrix、导出面、事件 payload 与 diagnostics 命名；文档站、类型测试、wrapper 和示例只能消费复核点 F 冻结面。

#### Iteration 1 - Public API / TSDoc / 类型测试（Step 7.1-7.3）

- [x] 整理 Public API 清单，按 package 和 edition 明确哪些符号可对外承诺，哪些仍留在 `experimental`，哪些必须保持 internal。
  - 补证 2026-07-06：docx/pdf/native Worker 能力检测公开面已冻结，`detectDocxWorkerCapability()`、`detectPdfWorkerCapability()`、`detectJWordNativeWorkerCapability()` 只做同步 feature detection；不可用时返回 `DOCX_WORKER_UNAVAILABLE` / `PDF_WORKER_UNAVAILABLE` / `JWORD_NATIVE_WORKER_UNAVAILABLE`，`fallback` 固定为 `none`，CSP baseline 为 `worker-src 'self' blob:`。
- [x] 建立 API 导出审计，禁止 `src` 内部路径、provider/Yjs 内部类型、worker 内部类型和 demo runtime 进入 public export map。
  - 完成 2026-07-06：新增 `tests/architecture/gate7-api-export-audit.test.ts`，锁定公开 package manifest 只发布 `dist` / 公开资产、export map 不暴露 `src` / provider / Yjs / demo 子路径；新增 `tests/types/gate7-public-api-entrypoints.ts` 与 `pnpm test:types`，模拟第三方 TypeScript 项目只从 package 入口消费 stable API；根 `pnpm typecheck` 排除该外部式 fixture，由专门类型门禁负责。
- [x] 为稳定 API 补齐 TSDoc、类型测试和最小示例，确保外部 TypeScript 项目能直接消费。
  - 完成 2026-07-06：新增 `tests/architecture/gate7-public-api-docs.test.ts`，通过 TypeScript checker 反查 `tests/types/gate7-public-api-entrypoints.ts` 与 `tests/types/gate7-public-api-examples.ts` 的 package 入口导入，要求导入符号具备贴近声明的 TSDoc 文档注释；新增 `docs/sdk/public-api-examples.md` 和可编译示例 fixture，覆盖 free core/ui/native/persistence、Gate 5 docx/pdf/license、Gate 6 collab/collab-server/license 的最小消费路径。
- [ ] 确保导出符号、事件 payload、错误码命名稳定，不暴露内部 Yjs 细节。

#### Iteration 2 - 基础版文档、Plugin API 与 diagnostics（Step 7.4-7.6 / 7.10-7.11）

- [x] 建立免费基础版 quickstart：安装 core/ui/native，创建编辑器，保存 `.jword`，重新打开 `.jword`，继续编辑。
  - 完成 2026-07-06：新增 `docs/sdk/quickstart.md` 与 `tests/types/gate7-free-quickstart.ts`，覆盖安装 core/ui/native、初始化 editor/UI、基础编辑、保存 `.jword`、打开 `.jword`、继续编辑和基础错误处理；新增 `tests/architecture/gate7-free-quickstart.test.ts` 锁定 quickstart 只使用免费 package 入口。
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
- [ ] 建立 bundle size 单一预算真源，保证 docx/PDF/collab/hocuspocus/license/server/React/Vue wrapper/大字体不进入免费默认首屏；`tools/size/check-size.mjs` 是免费基础首屏预算真源，`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏，`tools/size/check-native-bundle.mjs` 只保留为 native 资源专项护栏；不再新增第三套会阻断 CI 的 size-limit 预算真源。
- [ ] 建立 release dry-run：changeset 草稿、构建产物检查、`npm pack` 检查、私有 registry 安装检查、示例外部项目安装检查；不自动 publish。
- [ ] 建立迁移指南和兼容策略：minor/patch 兼容规则、deprecation、protocolVersion、native format schema migration、license contract migration、Gate 6 client/server 版本策略和版本窗口。
- [ ] 完成 Stable E2E 矩阵：vanilla、React、Vue、native save/open、docx/PDF、collab client/server、license failure、插件错误隔离、diagnostics export。

### 待办步骤

- [x] Step 7.1：整理公开 API 清单，按 `@4xian/jword-core`、`ui`、`native`、`docx`、`pdf`、`collab`、`collab-server`、`license`、`persistence`、wrapper 包区分 stable、experimental、internal，不公开未实现 Future API。
- [x] Step 7.2：建立 API 导出审计和类型测试，确保外部 TypeScript 项目只能从包入口消费稳定 API，不能 import `src` 内部路径、Yjs/provider 内部类型、worker 内部类型或 demo runtime。完成 2026-07-06：`package.json` 新增 `test:types`，`tests/types/gate7-public-api-entrypoints.ts` 覆盖 core/ui/native/docx/pdf/persistence/collab/collab-server/license 的 package 入口导入；`tests/architecture/gate7-api-export-audit.test.ts` 锁定 export map、files 白名单、类型测试 fixture 和 public API 文档记录；根 `tsconfig.json` 排除 `tests/types/**/*.ts`，由专门 `pnpm test:types` 维护外部式类型门禁。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts --reporter=verbose` 修前 2 failed（缺 `test:types` 与文档记录）；修复后同命令 1 file / 4 passed，Gate 7 导出回归 3 files / 13 passed，`pnpm test:types`、`pnpm typecheck`、`pnpm lint`、相关文件 whitespace check 通过。
- [x] Step 7.3：为稳定 API 补 TSDoc、最小示例和 diagnostics payload 文档，确保导出符号、事件 payload、错误码、feature key 可被外部项目消费。完成 2026-07-06：新增 `tests/architecture/gate7-public-api-docs.test.ts`，锁定稳定类型测试导入符号的 TSDoc、最小示例文档和 diagnostics payload contract；新增 `docs/sdk/public-api-examples.md` 与 `tests/types/gate7-public-api-examples.ts`，并纳入 `pnpm test:types`；补齐 `createEditor`、`EditorOptions`、`Document`、native/docx/pdf result、persistence/collab/server/license 等当前示例消费符号的 TSDoc。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts --reporter=verbose` 修前 3 failed；修复后同命令 1 file / 3 passed，Gate 7 公开面回归 4 files / 16 passed，`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。
- [x] Step 7.4：建立免费基础版 quickstart，覆盖安装、初始化 editor/UI、基础编辑、保存 `.jword`、打开 `.jword`、继续编辑和基础错误处理。完成 2026-07-06：新增 `docs/sdk/quickstart.md`、`tests/types/gate7-free-quickstart.ts` 与 `tests/architecture/gate7-free-quickstart.test.ts`，quickstart 只从 `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` package 入口导入，不引入付费包或内部路径。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose` 修前 2 failed；修复后同命令 1 file / 2 passed，Gate 7 公开文档回归 5 files / 18 passed，`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。
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
- [ ] Step 7.19：建立 bundle size 单一预算真源，确保免费首屏包不包含 docx/PDF/collab/hocuspocus/license/server/React/Vue wrapper/大字体，高级包只在显式 import 后进入 chunk；`tools/size/check-size.mjs` 是免费基础首屏预算真源，`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏，`tools/size/check-native-bundle.mjs` 只保留为 native 资源专项护栏，不再新增第三套会阻断 CI 的 size-limit 预算真源。
- [ ] Step 7.20：建立 release dry-run：changeset 草稿、构建产物检查、`npm pack` 内容审计、私有 registry 安装检查、示例外部项目安装检查；不自动 publish。
- [ ] Step 7.21：建立外部空项目集成验收，从安装包开始分别接入免费基础版、Gate 5 高级格式包、Gate 6 协作 client/server 和 license，不允许依赖 monorepo alias。
- [ ] Step 7.22：建立迁移指南和兼容策略，覆盖 semver、deprecation、protocolVersion、native format schema migration、license contract migration、Gate 6 client/server 版本策略和版本窗口。
- [ ] Step 7.23：建立商业支持诊断包规范，定义客户报障时可导出的版本、feature、license、server、diagnostics、operation 摘要和隐私裁剪规则。
- [ ] Step 7.24：完成 Stable E2E 矩阵：vanilla、React、Vue、native save/open、docx/PDF、collab client/server、license failure、插件错误隔离、diagnostics export；Playwright Chromium / Firefox / WebKit 最新版只作为浏览器族自动回归，最低版本承诺以 `docs/sdk/browser-support.md` 为准。

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

> Gate 收口前必须按 0.3 的 checkbox 语义复核本 Gate 的待办、验收和禁止事项；未有可复查证据的项保持未勾选。

- [x] `pnpm build`
- [x] `pnpm test:e2e`
- [x] `pnpm test:visual`
- [x] `pnpm bench`
- [x] bundle size 检查
- [x] architecture boundary 检查
- [x] 文档同步检查

### Alpha 完成

- [x] 1-2 万字编辑基础链路可用。
- [x] 50 页滚动可用。
- [ ] 输入热路径 P95 < 50ms。
- [ ] INP P95 < 150ms。
- [x] vanilla demo 可视化验证通过。

### Beta 完成

- [x] 10 万字、200 页 fixture 有性能报告。
- [ ] 表格、图片、批注、查找替换、页眉页脚、修订 v1 可用。
- [x] `.jword` 原生保存/打开 roundtrip 通过真实浏览器和 worker 验收。
- [x] Gate 5 商业高级 DOCX T1 import/export 通过 fixture diff。
- [x] Gate 5 商业高级 PDF 基础导出通过截图对比。
- [x] Gate 5 未授权、过期和 feature 不匹配失败路径通过。
- [x] 保格式粘贴通过安全验收。

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
- [x] 复核点 B：Gate 2 完成后，确认 LayoutBox 当前边界是否足以继续承载 PDF、页眉页脚、表格、图片和 hit-test 的后续扩展；若不足，在进入 Gate 3 前修正。
- [x] 复核点 C：进入 Alpha 前，确认输入系统、IME、selection、history 没有绕开 transaction pipeline；若绕开，不进入 Alpha。
- [x] 复核点 C2：Gate 4.5 完成后，确认 `.jword` 原生格式可保存、打开、迁移、校验资源和继续编辑；若不可用，不进入 Beta。
- [x] 复核点 D：Gate 5 技术互通完成后，确认 OOXML mapping 的 warning、fixture diff、worker cancel/progress 可用；若不可用，不进入 Beta。
- [x] 复核点 D2：Gate 5 商业化完成后，确认授权、worker/license enforcement、私有 package 检查、未授权失败和第三方高级包示例可用；若不可用，不进入 Beta。
- [x] 复核点 E：Gate 6 完成后，确认 origin、undo scope、remote/AI/local 并发语义、授权、server package、client/server version handshake 和第三方公开 API 集成清晰；若不清晰，不进入 Stable。
- [ ] 复核点 F：Gate 7 Iteration 0 完成后，一次性冻结 edition matrix、导出面、事件 payload 与 diagnostics 命名；文档站、类型测试、wrapper 和示例只能消费复核点 F 冻结面，不能边实现边漂移。详细准入见 `docs/superpowers/plans/2026-07-06-gate7-risk-checkpoint-f.md`。

## 执行顺序建议

- [x] 第一批只能做 Gate 0。
- [x] Gate 1 中 schema、operation、projection、anchor、history 可以分工并行，但必须先统一 Y.Doc 结构和类型边界。
- [x] Gate 2 中 layout 和 renderer 可以并行，但 hit-test/rect mapping 必须以同一 LayoutBox 为准。
- [x] Gate 3 中 input、toolbar、a11y 可以并行，但所有命令必须调用同一 Editor Facade。
- [x] Gate 4 中图片、表格、批注、查找替换可以按模块并行，每个模块都要自带 model/operation/layout/render/UI/test 闭环。
- [x] Gate 4.5 必须在 Gate 5 商业格式互通前完成，基础保存/打开统一由 `.jword` 原生格式承担。
- [x] Gate 5 中 DOCX 和 PDF 可以并行，但二者都必须复用 canonical model/LayoutBox，并在发布前补齐授权、私有包和第三方集成边界。
- [x] Gate 6 中 collab、offline、history、auto inserter 可以并行，但 edition matrix、origin/undo scope、license contract、server package 和 client/server protocol 必须先定。
- [ ] Gate 7 中 wrapper、plugin、devtools、docs 可以并行，但 Public API 清单、edition matrix、feature key 和诊断码必须先冻结；文档站、类型测试、wrapper 和示例只能消费复核点 F 冻结面。

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
