# JWord Canonical Implementation Plan Review

> 审查日期：2026-07-02
> 审查范围：`docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`（2758 行，Gate 0-7）
> 对照文档：`docs/superpowers/specs/2026-05-11-jword-canonical/` 01-07 全部规范文件

---

## 一、关键问题（Critical）

### 1.1 单文件过大已成为系统性风险

**问题描述**：多个核心源文件行数超过 1000 行，且计划文档中已明确承认（Iteration 14 执行记录提到 `packages/docx/src/index.ts` 和 `packages/docx/test/public-api.test.ts` 已超过约 1000 行），但未安排拆分迭代。当前实际代码中最大文件为 `packages/ui/src/create-ui.ts`（2037 行）、`packages/core/src/operations/command-builders.ts`（1702 行）、`packages/core/src/editor/text-editing-runtime.ts`（1650 行）、`packages/ui/src/toolbar/controller.ts`（1536 行）、`packages/core/src/operations/operation-adapter.ts`（1361 行）、`packages/core/src/model/document-store.ts`（1154 行）。

**影响范围**：代码可维护性、CR 效率、合并冲突概率、新人上手成本。

**修改建议**：
- 在 Gate 7 稳定化之前增加一个专门的"模块拆分"迭代，目标是所有 `src` 文件不超过 600 行。
- `command-builders.ts` 按 operation 类型拆分为 `text-commands.ts`、`block-commands.ts`、`table-commands.ts`、`image-commands.ts`、`comment-commands.ts` 等。
- `create-ui.ts` 按 UI 区域拆分为 `toolbar-setup.ts`、`sidebar-setup.ts`、`overlay-setup.ts`、`ui-lifecycle.ts`。
- `operation-adapter.ts` 按 operation kind 拆分。
- `document-store.ts` 至少拆出 `store-readers.ts` 和 `store-writers.ts`。

**优先级**：P0（已经影响开发效率）

### 1.2 Alpha 性能目标长期未达标

**问题描述**：Gate 3 的 Step 3.13（Alpha 性能验证）至今仍标记为未完成。计划多次回写说明当前阈值 `largeDocumentInsertP95Ms <= 140ms` 远高于 Alpha 完成区要求的 `输入热路径 P95 < 50ms` 和 `INP P95 < 150ms`。Gate 4 在未达标的情况下继续推进，且后续 Gate 5、Gate 6 都已完成，但 Alpha 性能问题至今无明确修复计划。

**影响范围**：用户体验（编辑卡顿）、产品信誉（对外宣称 Alpha 但核心指标未达标）、后续 Beta/Stable 更高性能要求的基础。

**修改建议**：
- 在 Gate 7 之前增加专项性能优化迭代，至少包含：layout 增量计算优化、dirty range 缩小、render batch 合并、font metrics 缓存命中率提升。
- 建立持续性能回归门禁，而不仅是记录当前值。
- 明确 P95 < 50ms 的达标条件和验证方法（哪些设备、哪些文档规模、哪些操作类型）。

**优先级**：P0（Alpha 宣称的前提条件）

### 1.3 `packages/docx` 最初的 `index.ts` 职责过重

**问题描述**：从 Iteration 4 到 Iteration 18 的执行记录可以看到，DOCX 的 OPC 读取、XML 解析、style/numbering/relationship/media/comments/header-footer 索引建立、T1 import mapping、导入中间模型定义、core 结构化写入桥接全部最初写在 `packages/docx/src/index.ts` 一个文件中。虽然后续拆出了 `export.ts`、`package.ts`、`import.ts`、`import-readers.ts`，但导入路径的职责仍然过于集中。

**影响范围**：DOCX 互通能力的可维护性和可测试性。

**修改建议**：
- 将 DOCX 导入拆为 `opc-reader.ts`、`ooxml-indexes.ts`、`import-mapping.ts`、`import-model.ts`。
- 将导出拆为 `export-document.ts`、`export-styles.ts`、`export-numbering.ts`、`export-media.ts`。
- 使 roundtrip diff 和 compatibility report 成为独立的 consumer，不依赖内部类型。

**优先级**：P0（影响后续 T2/T3 能力扩展）

---

## 二、重要问题（Major）

### 2.1 协同层的文本输入适配器设计存在脆弱性

**问题描述**：Gate 6 Iteration 7 的执行记录暴露了大量真实并发问题：旧基线覆盖远端后缀、同位置输入重复、删除吞掉远端插入、格式化范围删除残留。这些问题的修复都集中在 `examples/collab/src/runtime/hocuspocus-text-command.ts` 这个 demo 级文件中，通过 `previousText -> nextText` diff 和 `rebase` 来处理。这不是一个健壮的协同输入方案——它把本应由 CRDT 自动处理的冲突解决下放到了应用层的文本 diff 中。

**影响范围**：多人协同编辑的正确性和可靠性。

**修改建议**：
- 协同输入不应通过 textarea value diff 来推断用户意图。应该在 core 层面让 Yjs 的 CRDT 自动合并，textarea 只负责捕获本地输入事件并通过 command/operation 写入本地 Y.Doc。
- 远端更新通过 `Y.applyUpdate` 自动合并后，只需刷新 projection/layout/render。
- 当前的 `hocuspocus-text-command.ts` 中的 rebase 逻辑应该被视为临时方案，需要在 core 层面提供更健壮的协同输入适配。

**优先级**：P1

### 2.2 Y.Doc 内部结构与 OOXML 语义的映射边界不清晰

**问题描述**：规范要求"文档模型对齐 OOXML 语义"，但 Y.Doc 是 CRDT 数据结构，其内部以 `Y.Map`、`Y.Array`、`Y.Text` 等类型组织。计划中只在 Gate 1 Step 1.3 提到"设计 Y.Doc 内部结构，明确每类节点如何存储"，但没有文档化这个映射关系。这意味着：
- 后续修改 Y.Doc 内部结构时，缺少评估影响范围的依据。
- schema migration（Gate 4.5）依赖的 `schemaVersion` 无法精确关联到具体的 Y.Doc 结构变更。
- 第三方如果需要在服务端操作 Y.Doc（比如服务端渲染或批量处理），没有公开的结构文档。

**影响范围**：长期维护、schema migration 的正确性、服务端集成能力。

**修改建议**：
- 新增一份 `Y.Doc Internal Schema Reference` 文档，描述每类节点在 Y.Doc 中的存储结构、ID 规则、引用关系。
- 每次变更 Y.Doc 结构时必须更新 schemaVersion 并提供 migration。
- 明确禁止外部直接操作 Y.Doc 结构，只通过 Editor Facade 操作。

**优先级**：P1

### 2.3 PDF 中文字体方案不够完整

**问题描述**：计划要求"中文字体由集成方配置 URL、File 或 ArrayBuffer"，但实际实现中只用了一个约 4KB 的 Noto Sans SC 小子集（`NotoSansSC-gate5-subset.ttf`，仅包含"中文PDF导出"几个字）来验证。真实场景中：
- 中文字体文件通常 5-15MB，加载、解析、嵌入的性能开销未评估。
- 字体 fallback 链未设计——当主字体不包含某个字符时应如何处理。
- 字体子集化未设计——嵌入完整字体会导致 PDF 文件过大。

**影响范围**：PDF 导出的实用性和性能。

**修改建议**：
- 在 Gate 7 前增加字体完整性迭代：支持字体子集化（使用 fontkit 提取文档中用到的字符），benchmark 中文字体嵌入耗时和 PDF 文件大小。
- 设计字体 fallback 链：用户配置主字体 -> 系统 fallback -> 缺字警告。
- 明确大字体文件的加载策略：流式加载、缓存、按页嵌入。

**优先级**：P1

### 2.4 可访问性（A11y）验收缺乏实质进展

**问题描述**：规范文件 04-engineering-standards.md 4.8 节和 06-acceptance-and-testing.md 6.7 节都对可访问性提出了明确要求（aria-live、隐藏文本镜像、keyboard navigation、WCAG AA 对比度、屏幕阅读器支持），Gate 3 Step 3.10 也标记为已实现"aria-live 和隐藏文本镜像第一版"。但在后续所有 Gate 的验收中，a11y 相关的验证几乎没有出现。Gate 4-7 新增的表格、图片、批注、查找替换、协同等功能都没有 a11y 验收记录。

**影响范围**：法规合规（许多企业客户要求 WCAG 合规）、残障用户体验、Canvas 编辑器的固有可访问性挑战。

**修改建议**：
- 在 Gate 7 中增加 a11y 专项迭代，包括：Axe/Lighthouse 自动检测集成到 CI、屏幕阅读器手动验证矩阵、键盘导航完整路径测试。
- 每个新增 UI 组件（表格 UI、批注侧边栏、查找替换面板、协同状态栏）都需要补 aria 属性和键盘可达性。
- Canvas 内容的文本镜像需要支持表格、图片 alt text、页眉页脚等结构化内容。

**优先级**：P1

### 2.5 Gate 7 计划细节严重不足

**问题描述**：对比 Gate 0-6 每个都有详细的迭代任务清单、执行记录、验收标准和禁止事项，Gate 7 在规范文件中只有 14 行概述（Plugin API、React/Vue wrapper、主题、i18n、Devtools、文档站、错误诊断导出、size-limit），在实施计划中也没有展开具体步骤。作为交付 `1.0-stable` 的最后一个 Gate，缺乏详细计划意味着：
- 公开 API 面清理和类型导出的工作量被低估。
- Plugin API 的设计（command 扩展、menu 扩展、装饰层扩展）需要大量架构设计。
- React/Vue wrapper 需要处理 SSR、Suspense、严格模式等框架特有问题。
- 文档站需要 API 文档自动生成、示例代码、集成指南。

**影响范围**：1.0 发布的可行性和质量。

**修改建议**：
- 立即展开 Gate 7 的详细计划，至少包含：
  - Public API 审计和 breaking change 清单。
  - Plugin API 设计方案（参考 ProseMirror plugin、Monaco extension）。
  - React/Vue wrapper 的 SSR 策略、ref forwarding、事件代理方案。
  - 文档站技术选型和内容大纲。
  - i18n 方案（字符串外化、RTL 支持范围）。
  - 主题方案（CSS 变量、暗色模式）。
  - Devtools 面板功能范围和通信协议。

**优先级**：P1

### 2.6 计划文档本身已成为维护负担

**问题描述**：实施计划文档有 2758 行，包含大量执行记录、Kimi WebBridge 验证日志、多次"续做"和"回写"记录。这些内容对历史追溯有价值，但使计划文档难以用于其原始目的——指导后续开发。关键信息被淹没在大量过程记录中。

**影响范围**：开发效率、新成员理解项目状态、计划维护成本。

**修改建议**：
- 将执行记录和验证日志拆到独立的 `execution-log/` 目录，按 Gate 和日期组织。
- 计划文档只保留：目标、待办步骤（含完成状态）、验收标准、禁止事项、当前基线摘要。
- 每个 Gate 完成后，将详细过程归档并在计划文档中只留简要总结。

**优先级**：P1

---

## 三、建议改进（Suggestion）

### 3.1 缺少错误边界与崩溃恢复机制

**问题描述**：计划要求"基础错误恢复，输入异常时不破坏 Y.Doc 状态"，但未设计全局错误边界。在企业场景中，以下情况需要处理：
- Layout 计算异常导致无限循环或栈溢出。
- 字体度量返回异常值导致分页死循环。
- Y.Doc 内部一致性被破坏后的恢复策略。
- 插件错误隔离后的编辑器降级运行。

**修改建议**：
- 为 layout scheduler 增加超时和最大迭代次数保护。
- 为 transaction pipeline 增加 watchdog，单个 transaction 超过阈值自动回滚。
- 提供 `editor.getHealthStatus()` API 供宿主监控。
- 增加 Y.Doc 一致性校验函数，可在定时或手动触发时检测。

**优先级**：P2

### 3.2 缺少国际化（i18n）基础设施

**问题描述**：Gate 7 提到了 i18n，但在整个计划中没有任何 i18n 基础设施的设计。当前所有 UI 文本（toolbar 标签、错误提示、warning 消息、状态文本）都是硬编码的中文或英文。对于 SDK 产品，i18n 应该从早期就内建。

**修改建议**：
- 设计字符串外化方案，推荐使用简单的 key-value 映射 + locale 注入，不引入重型 i18n 框架。
- UI 包所有用户可见文本使用 `t('key')` 形式引用。
- 错误码和诊断消息分离 code（机器可读）和 message（人类可读、可本地化）。

**优先级**：P2

### 3.3 缺少离线优先（Offline-First）架构考量

**问题描述**：Gate 6 的离线恢复基于 `y-indexeddb`，但设计中将"离线"视为"在线协同的临时中断"而非一等模式。在企业场景中（尤其是政务、医疗、交通等内网环境），用户可能大部分时间处于离线状态。当前方案的问题：
- IndexedDB 存储容量限制（通常 50MB-无限制，但浏览器可能主动清理）。
- 长期离线后的 update 合并可能产生大量冲突。
- 没有离线到在线的 update 压缩策略。
- 缺少离线状态下的本地版本管理。

**修改建议**：
- 评估 IndexedDB 存储限制和浏览器清理策略的影响。
- 设计 update 压缩方案（`Y.mergeUpdates` + GC）。
- 考虑提供可选的本地文件系统保存（通过 File System Access API）。
- 为长期离线场景提供本地 `.jword` 自动保存。

**优先级**：P2

### 3.4 缺少大文档增量加载能力

**问题描述**：性能指标要求 Stable 阶段支持 50-100 万字符和 1000 页的压力测试，但整个计划中没有提到大文档的增量加载策略。当前方案是完整加载整个 Y.Doc 后建立 DocumentProjection 再排版。对于百万字文档：
- 初始加载时间过长。
- 内存占用过大。
- 全量 projection 更新成本高。

**修改建议**：
- 评估是否需要 Y.Doc 的懒加载或分片加载。
- Layout Engine 已有"分片增量重排"，但 Projection 是否支持按需计算需要确认。
- 考虑虚拟化不仅在渲染层（已有 viewport virtualizer），还在数据层。

**优先级**：P2

### 3.5 商业授权机制需要防绕过设计

**问题描述**：Gate 5 和 Gate 6 都提到了商业授权（entitlement、feature key、license check），但方案主要依赖 JavaScript 层面的检查。SDK 分发的 npm 包是明文 JavaScript，容易被：
- 直接 import 内部模块绕过授权检查。
- 修改打包后的代码移除 license check。
- 在 worker 层面跳过 entitlement validation。

**修改建议**：
- 授权检查不能只在客户端。计划中提到了"server-side license enforcement"，应将其作为主要防线。
- 考虑在 DOCX/PDF 导出结果中嵌入水印或 license 标识。
- 提供托管的 license server SDK，使企业客户无需自建。
- 明确文档中的授权粒度：按文档数、按用户数、按功能模块、按导出次数。

**优先级**：P2

### 3.6 测试覆盖存在结构性盲区

**问题描述**：
- **属性测试**：Gate 1 Step 1.13 标记已完成"属性测试，覆盖随机插入、删除、拆分、合并、undo/redo 后 projection 与 Y.Doc 一致"，但后续 Gate 未扩展属性测试到表格、图片、批注等新能力。
- **跨浏览器覆盖不均**：大量验收只在 Chromium 下完成，Firefox 和 WebKit 的覆盖主要靠 Gate 3 的 focused smoke。Gate 4-6 的复杂功能（表格编辑、批注锚点、协同）几乎没有 Firefox/WebKit 验证。
- **压力测试缺失**：Beta 要求"10 万字、200 页以内 fixture 有性能报告"，但当前 benchmark 只有 50 页纯文本和几千字的 fixture。
- **安全测试不够深入**：安全验收清单中的 SVG payload、data URL 图片、Word HTML 中的 `mso-*` 样式、docx 外链图片、不可信插件返回 DOM/HTML 等场景没有看到专项测试。

**修改建议**：
- 扩展属性测试到表格操作、批注 anchor、图片资源状态等。
- Gate 7 前对 Gate 4-6 功能补充 Firefox/WebKit 回归。
- 建立 10 万字 + 200 页的 benchmark fixture。
- 增加安全 fuzzing 测试，覆盖恶意 OOXML、恶意粘贴内容。

**优先级**：P2

### 3.7 对标企业级文档编辑器的核心能力缺失

**问题描述**：对标腾讯文档、ONLYOFFICE、Google Docs、石墨文档等企业级产品，当前计划（含 post-1.0）缺少以下常见能力：

| 能力 | 现状 |
|---|---|
| 分栏排版 | 未提及 |
| 文本框/Shape | 明确延期到 post-1.0 |
| 脚注/尾注 | 明确延期到 post-1.0 |
| 交叉引用 | 明确延期到 post-1.0 |
| 域代码（TOC 自动更新、页码引用、日期域） | 未提及 |
| 邮件合并 | 明确不做 |
| 样式管理面板（创建/修改/删除自定义样式） | 未提及 |
| 文档比较/合并 | 未提及 |
| 水印 | 未提及 |
| 页面背景/纹理 | 未提及 |
| 表格自动套格式 | 未提及 |
| 拖拽排序/拖拽内容 | 未提及 |
| 数学公式编辑 | 明确不做 |
| 字数统计 | 未提及 |
| 大纲视图/草稿视图 | 未提及 |

**修改建议**：
- 不需要全部实现，但应在计划中建立明确的能力路线图，标明每个能力的优先级和预计阶段。
- 分栏排版、水印、字数统计、样式管理是企业客户高频需求，建议纳入 1.x 迭代。
- 域代码至少需要基础支持（TOC 自动更新依赖域代码）。

**优先级**：P2

### 3.8 TypeScript 6 的实际风险未评估

**问题描述**：计划选择了 TypeScript 6.0.3 作为语言版本。TypeScript 6 是一个较新的大版本（如果存在），主要编辑器和工具链的兼容性需要确认。生态中大量库的类型声明可能不兼容 TS 6 的新特性或 breaking changes。

**修改建议**：
- 确认 TypeScript 6 的具体 breaking changes 对 Yjs、DOMPurify、JSZip、pdf-lib、fontkit、hocuspocus 等依赖的影响。
- 保留降级到 TypeScript 5.x 的能力，以防第三方类型不兼容。
- 在 CLAUDE.md 和 README 中明确说明 TypeScript 版本要求。

**优先级**：P3

### 3.9 canvas 渲染缺少高 DPI 和色彩管理策略

**问题描述**：计划中提到了 canvas 渲染的各种优化策略，但缺少：
- 高 DPI 显示器（Retina）的 devicePixelRatio 处理策略。
- 色彩管理（是否使用 P3 色域、是否需要颜色空间转换）。
- 打印预览与屏幕显示的颜色差异处理。
- Canvas 渲染与 PDF 导出之间的颜色一致性。

**修改建议**：
- 明确 canvas 创建时的 devicePixelRatio 策略（当前代码中可能已处理，但计划中未提及）。
- 在 PDF 导出中确保颜色空间与 canvas 渲染一致。
- 为打印场景预留 CMYK 颜色空间支持的扩展点。

**优先级**：P3

### 3.10 缺少监控、遥测和崩溃上报基础设施

**问题描述**：作为企业级 SDK，需要提供基础的诊断和遥测能力供集成方使用。计划中提到了 devtools 面板，但缺少：
- 结构化诊断事件导出（operation 审计日志、性能指标、错误统计）。
- 可选的遥测接口（集成方可接入自己的监控系统）。
- 崩溃场景的状态快照和恢复建议。

**修改建议**：
- 在 Editor Facade 上提供 `onDiagnosticEvent(listener)` 接口。
- 定义诊断事件 schema：类型、严重程度、上下文、时间戳、可选 payload。
- 提供可选的 performance observer 接口，暴露 layout/render 耗时。

**优先级**：P3

---

## 四、架构设计评价

### 4.1 分层设计（优秀）

分层清晰且依赖方向严格向下，通过 `tools/lint/check-boundaries.mjs` 和 `tests/architecture/core-boundary.test.ts` 机器强制执行。Y.Doc 真源 -> DocumentProjection -> Layout Engine -> Canvas Renderer 的单向数据流设计合理，避免了双向同步的复杂性。免费/付费包的边界通过架构测试强制隔离，避免了意外依赖。

### 4.2 Transaction Pipeline（优秀）

所有变更统一走 Command -> Operation -> `ydoc.transact(origin)` 的设计是正确的，它使得 undo/redo、协同、自动插入都能在同一语义下工作。origin 矩阵（local-user、remote-user、auto-inserter、system-recovery、version-restore）和对应的 undo scope 隔离设计精细且合理。

### 4.3 OOXML 对齐策略（良好但有风险）

文档模型对齐 OOXML 语义是正确的技术决策，但当前的实现只覆盖了 OOXML 的一小部分。随着能力扩展，model 的复杂度会急剧增长。建议在 model 中明确区分"已实现"和"placeholder"字段，避免半实现的字段被误用。

### 4.4 Canvas 渲染决策（良好）

分页 Canvas、viewport 虚拟化、canvas 回收的设计参考了腾讯文档的公开方案，是经过验证的技术路线。明确禁止单长 canvas 和双 canvas 叠加方案也是正确的约束。但需要注意的是，随着功能增加（浮动对象、文本框），单 canvas 方案可能需要引入局部叠加层，需要预留扩展机制。

---

## 五、实施方案评价

### 5.1 Gate 顺序（合理）

Gate 0-3 建立基础 -> Gate 4 企业结构 -> Gate 4.5 原生保存 -> Gate 5 格式互通 -> Gate 6 协同 -> Gate 7 稳定化，顺序合理且依赖关系清晰。Gate 4.5 作为独立阶段插入，解决了"免费版也需要保存"的产品问题，设计得当。

### 5.2 验收方式（优秀但需精简）

三层验收（Vitest focused tests -> Playwright E2E -> Kimi WebBridge 真实浏览器）的设计很好，保证了从单元到集成到真实环境的覆盖。但真实浏览器验证的记录过于详细地写入了计划文档，应该独立归档。

### 5.3 商业化策略（合理但需强化）

免费基础版（core + ui + native）和付费高级版（docx + pdf + collab + collab-server + license）的分级清晰。但授权机制主要依赖客户端检查，服务端强制执行的细节不够完善。建议参考 ONLYOFFICE 的 license server 模式，提供独立的授权服务。

---

## 六、总结

| 维度 | 评级 | 关键发现 |
|---|---|---|
| 架构设计 | A- | 分层清晰、真源统一、边界机器强制；欠缺 Y.Doc 内部结构文档 |
| 技术选型 | B+ | 主流技术栈、合理的渲染决策；TS 6 兼容性风险、PDF 字体方案不完整 |
| 实施方案 | B | Gate 顺序合理、验收严格；单文件过大未治理、Alpha 性能未达标 |
| 性能设计 | B- | 有分页/虚拟化/回收；大文档增量加载缺失、性能指标长期未达标 |
| 安全设计 | B+ | DOMPurify、protocol allowlist、资源白名单完善；SVG/插件安全深度不足 |
| 可维护性 | B- | 多个核心文件超 1000 行、计划文档 2758 行；需要系统性拆分 |
| 商业化 | B | 免费/付费边界清晰；授权防绕过不足、定价模型未设计 |
| 测试策略 | B+ | 三层验收、属性测试、视觉回归；跨浏览器覆盖不均、压力测试缺失 |
| 企业能力 | B- | 基础能力完整；分栏/水印/样式管理/域代码等高频能力缺失 |
| A11y | C | 基础方案已设计；实质验收几乎没有 |

**总体评价**：规划文档在架构设计、技术决策和 Gate 划分上体现了较高的专业水平，特别是 Y.Doc 真源、Transaction Pipeline、Canvas 分页渲染和商业化边界的设计经过了充分思考。主要风险集中在：（1）Alpha 性能目标长期未达标；（2）核心文件过大影响可维护性；（3）A11y 验收形同虚设；（4）Gate 7 计划严重不足。建议在推进 Gate 7 之前，先安排一轮专项治理迭代，解决性能、文件拆分和 A11y 三个关键问题。
