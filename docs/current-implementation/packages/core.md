# @4xian/jword-core 当前实现摘要

## 包职责

`@4xian/jword-core` 是 JWord 的框架无关编辑器内核。它负责文档真源、事务管线、命令体系、选择区、分页布局、Canvas 渲染、输入运行时、资源模型、协作 update 桥接、自动插入、插件核心契约、diagnostics 与 telemetry 入口。

核心设计事实：

- Yjs `Y.Doc` 是运行期可写状态；外部消费只读 `DocumentProjection`、`DocumentLayout`、`Document` 等公开结构。
- 所有编辑写入走 `Command -> Operation -> TransactionPipeline`，不鼓励外部直接改 projection 或 store。
- 顶层导入不访问 DOM；真实 DOM、Canvas、hidden textarea、事件监听只在 `editor.mount(host)` 之后创建。
- core 不依赖 UI、DOCX、PDF、React/Vue、collab provider 或 demo；运行时依赖只有 `yjs`。

## 入口与导出

- 包名：`@4xian/jword-core`
- Export map：仅 `.`。
- 产物入口：`dist/index.js` / `dist/index.d.ts`。
- 当前 manifest：`private: true`，`publishConfig.access: public`。

## 公开 API 摘要

根入口主要导出：

- Editor facade：`createEditor()`、`Editor`、`EditorOptions`、editor events、command options、fixture/model input。
- 文档模型：`Document`、`Section`、`Paragraph`、`Run`、`Table`、`Comment`、`RevisionMetadata`、资源模型与 projection 类型。
- 位置/选择：`AnchorRef`、`RangeRef`、`createRangeRef()`、`SelectionState`、`createSelectionState()`、text anchor/location API。
- 命令构造器：文本格式、段落格式、section 属性、资源、图片、表格、批注、链接、修订。
- 布局与渲染：`layoutDocument()`、`hitTestDocumentLayout()`、`getCaretRect()`、`getSelectionRects()`、`renderPageCanvas()`、`syncPageCanvases()`、viewport virtualizer。
- 字体与页面：font manager、page config、text measurer、canvas pool。
- 协作桥接：sync update encode/apply/replace、shared document bridge、`createTextInserter()`。
- 插件与 diagnostics：plugin command/middleware/keybinding/decoration/adapter 类型、diagnostics snapshot、telemetry 类型。

## 主要模块目录

- `canvas/`：Canvas pool、分页 canvas 渲染、viewport retained pages 计算。
- `collaboration/`：自动文本插入器。
- `editor/`：Editor facade、mount/input/pointer/layout/runtime 分层、协作 update、diagnostics、observability。
- `find-replace/`：查找、单项替换、全部替换。
- `heading/`：Heading 1-3 目录生成与定位。
- `layout/`：分页布局引擎、字体度量、增量布局、表格布局、命中测试、page config。
- `link/`、`links/`：链接 URL allowlist。
- `model/`：文档模型、Y.Doc store adapter、projection、selection、formatting state、comments/revisions/resources projection。
- `operations/`：command builders、operation adapter、transaction pipeline、history。
- `plugins/`：核心插件契约、adapter registry、plugin host。
- `resources/`：资源表、上传适配器、URL policy、canvas 图片解析。
- `shared/`：错误与 grapheme 工具。

## 已实现能力

### 文档与模型

- 文档结构覆盖 document、section、paragraph、run、text inline、break、image inline、bookmark、comment marker、table、comment thread、revision metadata、resource snapshot。
- 支持纯文本 fixture、结构化 document model、资源表快照、section/page 配置。
- projection 是只读快照，供 layout、render、UI、DOCX/PDF/native 等包消费。

### 事务与命令

- `TransactionPipeline` 包装 Y.Doc transaction。
- operation union 覆盖文本、段落、section、block、resource、image、table、comment、link、revision。
- 事务结果包含 projection、dirty scope、diagnostic、update byte length、origin/source metadata。
- undo/redo 由 history manager 管理，支持用户历史作用域与 remote/auto-insert 等非用户来源区分。

### Editor facade

- 支持 `createDocument()`、`loadFixture()`、`loadDocumentModel()`、`getProjection()`、`getLayout()`。
- 支持 `executeCommand()`、`pasteRichTextFragment()`、undo/redo、subscribe、mount/focus/blur/destroy。
- 支持 selection、formatting state、anchor/range snapshot、location 查询、scroll to location。
- 支持 plugin command、plugin middleware、plugin diagnostics、diagnostics export。

### 布局与渲染

- 从 `DocumentProjection` 生成分页 `DocumentLayout`。
- 支持 page box、paragraph line box、text fragment、table block、header/footer、list marker、inline image。
- 支持 hit-test、caret rect、selection rect、debug overlay、增量布局、dirty page 和 continuation。
- Canvas 渲染按页绘制；viewport virtualizer 控制 retained pages，避免单长 canvas。

### 输入运行时

- mount 后创建 editor shell、canvas container、hidden textarea、live region、text mirror。
- 绑定 beforeinput/input/keyboard/clipboard/pointer/composition/scroll。
- 文本编辑、删除、段落拆分、富文本 fragment 粘贴、IME/composition、指针定位、键盘导航均在 core runtime 中处理。

### 企业基础能力

- 图片资源与 inline image command：插入、替换、移动、调整大小、旋转、删除。
- 表格 command：插入表格、增删行列、设置列宽/行高、边框、单元格文本、合并右侧单元格。
- 批注线程、回复、编辑、resolve/reopen/delete。
- 超链接插入、编辑、删除、URL policy。
- Heading outline、查找替换、页眉页脚/页码 section 属性。
- 修订 metadata、接受/拒绝修订。

### 协作与自动插入

- core 提供 Yjs sync update encode/apply/replace 和 shared document bridge。
- core 不内置 provider、WebSocket、awareness UI、IndexedDB 或授权服务。
- `createTextInserter()` 支持 insert/append/replace，并把 flush 转成 core command 或 sync update。

### 插件与 diagnostics

- plugin host 支持 command、middleware、keybinding、decoration、adapter registry、lifecycle listener。
- adapter registry 支持 resource、persistence、import、export、collabProvider。
- 插件异常进入 diagnostics，不直接破坏 editor 主流程。
- diagnostics export 做隐私裁剪；telemetry 默认关闭，只有宿主提供 sink 时才发送。

## 内部实现方案

- 写入路径统一：外部或 UI 构造 `Command`，由 `editor.executeCommand()` 进入 plugin middleware，再进入 `TransactionPipeline.run()`，最后由 operation adapter 写入 Y.Doc。
- 读取路径隔离：layout、render、docx、pdf、ui 读取 `DocumentProjection` / `DocumentLayout`，不直接读写 Y.Doc store。
- DOM 延迟：core 可在 Node/SSR 环境导入与创建 editor；DOM 只在 mount 后创建。
- 安全边界：core 不解析 HTML；HTML 粘贴由 UI/宿主清洗后转成结构化 `EditorRichTextFragment` 再进入 core。
- 资源边界：资源 URL 默认只允许 data/blob；外部 URL 由宿主 policy 放行。
- 插件边界：插件拿 facade 和只读快照，通过命令或 adapter 扩展，不暴露 document-store、Y.Doc 内部结构或 canvas context。

## 与其它包关系

- `ui` 通过 core facade、command builders、layout geometry 和 resource/link policy 装配 DOM UI。
- `native` 消费 core `Editor`、`DocumentProjection` 或 canonical `Document` 保存 `.jword`。
- `docx` 消费/生成 core canonical document 和 projection。
- `pdf` 消费 core `DocumentLayout` 导出 PDF。
- `collab` 消费 sync update、shared document、text anchor、text inserter。
- `persistence` 保存 Yjs update/snapshot，不保存 core projection JSON。
- `devtools` 只读消费 `editor.exportDiagnostics()`。
- `react` / `vue` 通过 `createEditor()` 和 `createJWordUi()` 做生命周期 wrapper。

## 主要测试/验收入口

- `packages/core/test/`
- `packages/core/test/index.test.ts`
- `packages/core/test/model/`
- `packages/core/test/operations/`
- `packages/core/test/editor/`
- `packages/core/test/layout/`
- `packages/core/test/canvas/`
- `packages/core/test/collaboration/`
- `tests/architecture/core-boundary.test.ts`
- `tests/architecture/core-file-budget.test.ts`
- `tests/architecture/phase5-architecture-purity.test.ts`
- `tests/architecture/phase5-small-correctness.test.ts`
- `tests/architecture/gate7-api-export-audit.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/types/gate7-public-api-entrypoints.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-core typecheck`：校验 core 公开类型与内部实现类型。
- `pnpm --filter @4xian/jword-core test`：运行 core 包内 model/operation/editor/layout/canvas/collaboration 单测。
- `pnpm --filter @4xian/jword-core build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/core-boundary.test.ts tests/architecture/core-file-budget.test.ts tests/architecture/phase5-architecture-purity.test.ts tests/architecture/phase5-small-correctness.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归 core 边界、文件预算、架构纯度和公开 API。
- `pnpm test:types`：验证第三方类型入口只能消费公开 package API。

## 当前限制/注意点

- 当前 manifest 仍是 `private: true`，不能据此宣称已完成 registry 发布。
- Plugin API、decoration、observability/telemetry 当前应视为可用但仍需稳定化审查的高级能力。
- core 不是 UI 包；toolbar、面板、DOM 交互策略在 `@4xian/jword-ui`。
- core 不是协同服务；provider、server、history/offline 持久化由 collab/persistence/collab-server 组合。
- core 不是 HTML sanitizer；粘贴安全由 UI/宿主负责清洗后再进入结构化 fragment。

## 关键文件

- `packages/core/package.json`
- `packages/core/src/index.ts`
- `packages/core/src/editor/runtime.ts`
- `packages/core/src/editor/types.ts`
- `packages/core/src/editor/facade-runtime.ts`
- `packages/core/src/editor/mount-facade-runtime.ts`
- `packages/core/src/editor/collaboration-runtime.ts`
- `packages/core/src/model/projection.ts`
- `packages/core/src/operations/transaction.ts`
- `packages/core/src/layout/engine.ts`
- `packages/core/src/canvas/renderer.ts`
- `packages/core/src/plugins/types.ts`
- `packages/core/src/plugins/adapter-registry.ts`
- `packages/core/src/editor/observability.ts`

