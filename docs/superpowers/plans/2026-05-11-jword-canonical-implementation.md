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

- [ ] 每个 `.ts` 文件必须有文件头注释，说明职责、边界、协作模块、性能/安全约束、关联 specs。
- [ ] 公开 API 必须有 TSDoc、类型测试、示例用法。
- [ ] Core 禁止依赖 React/Vue/docx/PDF/collab provider/demo。
- [ ] Core 禁止 top-level 访问 `window`、`document`、`HTMLElement` 实例。
- [ ] 所有状态变更必须走同一 transaction pipeline。
- [ ] 所有 transaction 必须带 origin。
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
- [ ] `examples/vanilla`：基础集成示例，所有 gate 的第一验证目标。
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

- [ ] 不引入 Bun 作为主工具链。
- [ ] 不写无法验证的空包。
- [ ] 不用宽松 TS 配置换速度。
- [ ] 不自动 commit、tag、publish。

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
- [ ] Step 1.12：建立 operation fixture，可序列化、可回放、可用于后续 docx/collab/auto-inserter 集成测试。
- [ ] Step 1.13：建立属性测试，覆盖随机插入、删除、拆分、合并、undo/redo 后 projection 与 Y.Doc 一致。
- [ ] Step 1.14：补齐错误码体系，确保非法 operation 返回可诊断错误，不静默失败。

### 验收

- [ ] 本地单人模式能在 Y.Doc 中完成文本增删、段落拆分合并、run 样式变更。
- [ ] Projection 可稳定派生段落和 run。
- [ ] Anchor 在前方插入、删除、段落拆分、段落合并后不漂移。
- [ ] Operation fixture 可序列化、可回放。
- [ ] undo/redo 不丢样式，不破坏 selection restore。
- [ ] 所有编辑路径都必须经过 transaction pipeline。

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

- [ ] Step 2.1：定义 Layout 输入输出：DocumentProjection、页面配置、字体度量、viewport、dirty range -> DocumentLayout/PageBox/LineBox/TextFragment/InlineBox。
- [ ] Step 2.2：实现页面配置：A4、Letter、纵向/横向、页边距、缩放、twip 到 CSS px 转换。
- [ ] Step 2.3：实现 FontManager 和 metrics cache，处理字体加载、fallback、测量缓存、字体缺失状态。
- [ ] Step 2.4：实现 grapheme-aware 文本切分，覆盖中文、英文、emoji、组合字符基础场景。
- [ ] Step 2.5：实现段落内 line breaking，支持基础 run 样式、字号、粗斜体、颜色、行高。
- [ ] Step 2.6：实现 page breaking，支持普通分页、手动分页符、基础 orphan/widow 后续扩展点。
- [ ] Step 2.7：实现 dirty mark 和 layout scheduler，当前编辑页优先同步，后续页分片重排；页起点不变时早停。
- [ ] Step 2.8：实现每页独立 canvas renderer，按视觉层级绘制 page background、text、selection、caret。
- [ ] Step 2.9：实现 viewport virtualizer，只保留可视页和 buffer 页真实 canvas。
- [ ] Step 2.10：实现 canvas pool 和离屏回收，离屏 canvas 释放为极小尺寸。
- [ ] Step 2.11：实现 hit-test：point -> AnchorRef。
- [ ] Step 2.12：实现 rect mapping：AnchorRef/RangeRef -> caret rect/selection rect。
- [ ] Step 2.13：实现 layout debug overlay，为 devtools 后续查看 page/line/fragment 边界提供数据。
- [ ] Step 2.14：建立 50 页纯文本 fixture、中文混排 fixture、emoji fixture、长段落 fixture 的视觉回归基线。
- [ ] Step 2.15：建立 render benchmark，记录滚动 FPS、layout 耗时、render 耗时、canvas 数量、显存相关指标。

### 验收

- [ ] 50 页纯文本 fixture 可滚动。
- [ ] 非可视页不保留大 canvas。
- [ ] Safari/iOS 不创建超大 canvas。
- [ ] 点击定位、选区、高亮、caret 坐标正确。
- [ ] 中文、英文、emoji 混排基础正确。
- [ ] LayoutBox 可作为 PDF/docx 后续互通输入。

### 禁止事项

- [ ] 不实现单长 canvas。
- [ ] 不默认 main/overlay 双 canvas。
- [ ] 不为了减少 canvas 状态切换而打乱视觉层级。
- [ ] 不把 drawImage 滚动复用作为主优化路线。

## Gate 3 - 输入与基础编辑

### 目标

完成 `0.1-alpha` 最小可用闭环：分页文档中能输入、删除、选择、复制粘贴、格式化、撤销重做，并在 vanilla demo 中可体验。

### 实现方案

在 Gate 1/2 的内核上接入真实 DOM 输入系统。hidden textarea 只负责输入捕获，状态仍由 command/operation/transaction 驱动。UI 工具栏只调用 Editor Facade，不直接读写内部状态。

### 待办步骤

- [ ] Step 3.1：实现 mount lifecycle，所有 DOM 创建都在 mount 后执行，destroy 能完整解绑事件和释放 canvas。
- [ ] Step 3.2：实现 hidden textarea，位置跟随 caret，保证中文 IME 候选框位置可用。
- [ ] Step 3.3：实现 composition handler，覆盖 Chrome/Safari/Firefox 差异和 macOS/Windows 中文输入。
- [ ] Step 3.4：实现 keyboard handler，覆盖输入、删除、回车、方向键、快捷键、撤销重做。
- [ ] Step 3.5：实现 pointer selection，支持点击定位、拖拽选区、双击词选择的扩展边界。
- [ ] Step 3.6：实现 clipboard plain text，复制、剪切、粘贴都走 safe text 路线和 transaction pipeline。
- [ ] Step 3.7：实现基础 commands：加粗、斜体、下划线、删除线、字体、字号、颜色、背景色、对齐、缩进。
- [ ] Step 3.8：实现 toolbar 第一版，原生 TS DOM API，使用 `jw-` BEM 类名，不引入框架。
- [ ] Step 3.9：实现 toolbar 状态同步，selection 改变时显示当前 run/paragraph 状态。
- [ ] Step 3.10：实现 aria-live 和隐藏文本镜像第一版，让 Canvas 编辑器有基础可访问性路径。
- [ ] Step 3.11：实现基础错误恢复，输入异常时不破坏 Y.Doc 状态，用户可继续编辑。
- [ ] Step 3.12：完善 Alpha E2E：IME、选择、键盘、toolbar、undo/redo、plain text clipboard。
- [ ] Step 3.13：完成 Alpha 性能验证：1-2 万字编辑、50 页滚动、输入热路径 P95 指标。

### 验收

- [ ] macOS 和 Windows 中文输入可用。
- [ ] 输入、删除、回车、方向键、选择、复制粘贴可用。
- [ ] 加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进可用。
- [ ] undo/redo 覆盖基础编辑和格式。
- [ ] 1-2 万字文档编辑不卡顿。
- [ ] `0.1-alpha` 可由 vanilla demo 验证最终架构，不是临时 demo。

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

### 待办步骤

- [ ] Step 4.1：实现资源表和 ResourceAdapter，定义图片上传、替换、失败恢复、白名单 URL 策略。
- [ ] Step 4.2：实现 inline image 和 block image 的 model、operation、layout、render、resize handle。
- [ ] Step 4.3：实现图片插入 UI 和上传状态 UI，失败时保留用户可恢复状态。
- [ ] Step 4.4：实现简单表格 model：table、row、cell、grid、border、cell props、cell text content。
- [ ] Step 4.5：实现表格 operation：插入表格、插入/删除行列、合并单元格、更新边框、单元格文本编辑。
- [ ] Step 4.6：实现表格 layout/render，支持跨页基础策略和 cell 内 hit-test。
- [ ] Step 4.7：实现表格 UI：选中行列、插入删除菜单、边框基础控件。
- [ ] Step 4.8：实现批注 model 和 operation：添加、回复、解决、重新打开、删除、定位。
- [ ] Step 4.9：实现批注侧边栏，批注 anchor 随文本编辑稳定移动。
- [ ] Step 4.10：实现超链接 model、protocol allowlist、编辑弹窗、打开行为。
- [ ] Step 4.11：实现标题结构和基础目录生成，目录点击能跳转到对应 anchor。
- [ ] Step 4.12：实现查找替换，结果位置使用 RangeRef，替换操作走 transaction pipeline。
- [ ] Step 4.13：实现页眉页脚和页码基础能力，排版结果可被 PDF/docx 后续复用。
- [ ] Step 4.14：实现修订 metadata 第一版，记录插入、删除、格式变更；接受/拒绝深度流程保留到 post-1.0。
- [ ] Step 4.15：实现 DOMPurify 保格式粘贴 v1，覆盖 Word HTML 常见片段并保留安全降级到纯文本能力。
- [ ] Step 4.16：实现移动 Web 只读分页预览，不支持完整移动编辑。
- [ ] Step 4.17：完善 Beta 前半段 E2E 和视觉回归：表格、图片、批注、目录、页眉页脚、移动预览。

### 验收

- [ ] 表格内文本编辑与 undo/redo 正确。
- [ ] 图片上传成功可替换资源，失败可恢复。
- [ ] 批注 anchor 在文本编辑后仍定位正确。
- [ ] 查找替换不会绕过 transaction pipeline。
- [ ] 页眉页脚和页码参与分页布局。
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

### 验收

- [ ] 双窗口同时编辑最终一致。
- [ ] 断网编辑后恢复同步。
- [ ] 远端光标和选区可见。
- [ ] AI 自动插入不阻塞本地输入。
- [ ] 用户 undo 默认不撤销 remote/AI 内容。
- [ ] 批注 anchor 在远端编辑后稳定。

### 禁止事项

- [ ] 协同层不绕过 Editor transaction。
- [ ] 自动插入不使用普通字符 offset。
- [ ] wrapper 或 provider 不保存第二份编辑状态。

## Gate 7 - SDK 稳定化

### 目标

交付可集成、可诊断、可维护的 `1.0-stable` SDK。外部项目能选择 vanilla、React、Vue 集成，能按需加载 docx/PDF/collab，能通过插件扩展命令、菜单、装饰层和适配器。

### 实现方案

先冻结公开 API，再补 wrapper、plugin、theme/i18n、devtools、文档站、bundle size、发布 dry-run。任何公开 API 必须有类型、TSDoc、类型测试、示例和兼容策略。

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

- [ ] `pnpm lint`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] 相关 package 的 focused tests

### 每个 Gate

- [ ] `pnpm build`
- [ ] `pnpm test:e2e`
- [ ] `pnpm test:visual`
- [ ] `pnpm bench`
- [ ] bundle size 检查
- [ ] architecture boundary 检查
- [ ] 文档同步检查

### Alpha 完成

- [ ] 1-2 万字编辑可用。
- [ ] 50 页滚动可用。
- [ ] 输入热路径 P95 < 50ms。
- [ ] INP P95 < 150ms。
- [ ] vanilla demo 可视化验证通过。

### Beta 完成

- [ ] 10 万字、200 页 fixture 有性能报告。
- [ ] 表格、图片、批注、查找替换、页眉页脚可用。
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

- [ ] 复核点 A：Gate 1 完成后，确认 Y.Doc schema、Projection、Operation、AnchorRef 是否足以承载 docx、协同、自动插入；若不足，在进入 Gate 2 前修正。
- [ ] 复核点 B：Gate 2 完成后，确认 LayoutBox 是否能支撑 PDF、页眉页脚、表格、图片和 hit-test；若不足，在进入 Gate 3 前修正。
- [ ] 复核点 C：Gate 3 完成后，确认输入系统、IME、selection、history 没有绕开 transaction pipeline；若绕开，不进入 Alpha。
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
