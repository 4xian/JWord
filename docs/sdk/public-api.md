# JWord Public API Catalog

Gate 7 Step 7.1 公开 API 清单。本文只记录当前仓库已经实现并通过 package export map 暴露的 API；wrapper、devtools 和插件能力如果尚未实现，只能标为未实现，不能作为 stable API 使用。

## 分级规则

- stable：允许第三方从正式 package 入口长期消费；后续破坏性调整必须走迁移和版本策略。
- experimental：允许第三方显式选择子路径试用；不承诺 1.0 兼容，必须在文档和类型名中保持清晰边界。
- internal：只能被当前 workspace 内部源码、测试或示例装配使用；不能出现在对外集成文档、第三方示例或 public export map 中。

## 导入边界

- 只允许从 package export map 入口导入，例如 package 根入口、明确公开的 `./worker` 或 `./experimental`。
- 禁止第三方导入 `packages/*/src/*`。
- 禁止公开 Y.Doc store、provider 内部类型、worker 内部 helper 和 demo runtime。
- 示例和文档只能演示 stable 或明确标注的 experimental API，不能把 monorepo 内部路径当作集成方式。

## Type tests / export audit

- `pnpm test:types` 运行 `tests/types/gate7-public-api-entrypoints.ts`、`tests/types/gate7-public-api-examples.ts` 与 `tests/types/gate7-free-quickstart.ts`，模拟第三方 TypeScript 项目只从 package 入口消费当前 stable API；该 fixture 由 `tests/types/tsconfig.gate7-public-api.json` 独立验收，不并入根 `pnpm typecheck`。
- `tests/architecture/gate7-api-export-audit.test.ts` 锁定 package export map 不暴露 `src`、provider 内部、Yjs 内部、worker 内部 helper 或 demo runtime。
- `tests/architecture/gate7-public-api-docs.test.ts` 锁定稳定导入符号具备贴近声明的 TSDoc 文档注释，并要求最小示例和诊断载荷文档同步。
- 免费基础版 quickstart 见 [`quickstart.md`](./quickstart.md)（路径：`docs/sdk/quickstart.md`）；最小接入示例见 [`public-api-examples.md`](./public-api-examples.md)（路径：`docs/sdk/public-api-examples.md`）；新增或改名 stable API 时，先更新本清单、类型测试、示例和 export audit，再更新文档站、wrapper 或示例。

## 浏览器支持矩阵

- 公开最低版本承诺见 [`browser-support.md`](./browser-support.md)。
- 桌面编辑支持 Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4。
- 窄屏仅承诺分页滚动预览与工具栏样式适配，不建立单独的窄屏平台能力口径。
- 发布包与示例构建 target 对齐 ES2022；Playwright Chromium / Firefox / WebKit 最新版项目用于浏览器族回归，不等同于最低版本实验室认证。

## Release / no-alias 验收

- Stable E2E 矩阵必须包含 `node tools/release/check-gate7-third-party-smoke.mjs`。
- 该 smoke 使用本地 tarball 安装当前已实现包，不使用 examples 源码 alias，覆盖 `tsc --noEmit`、`vite build` 和 Chromium 浏览器 smoke。
- 浏览器路径必须同时触达免费基础 layout 能力和至少一条付费授权能力；当前付费路径为 `pdf.export`。
- 真实 registry URL、移除 `private: true` 与任何 `publish` 动作仍需人工审批。

## Edition Matrix

- free：`@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native`、基础 `@4xian/jword-persistence` contract 和基础 diagnostics。
- free base contract：`@4xian/jword-persistence` 的基础 storage contract、基础 diagnostics、memory/storage adapter 类型；协作相关 persistence adapter 只有在 paid collaboration 场景中作为高级能力被消费。
- paid format：`@4xian/jword-docx`、`@4xian/jword-pdf`，feature key 来自 `GATE5_FORMAT_FEATURES`。
- paid collaboration：`@4xian/jword-collab`、`@4xian/jword-collab-server`、协作相关 persistence adapter 和 `@4xian/jword-license`，feature key 来自 `GATE6_COLLAB_FEATURES`。
- paid entitlement：`@4xian/jword-license` 负责授权 entitlement、feature key 和授权诊断，不读取用户文档内容。

## Gate 7 frozen surface sources

- Edition matrix：本文件 `Edition Matrix` 与各 package 小节。
- Export surface：本文件每个 package 的 Stable / Experimental / Internal 清单与 package export map。
- Event payload：`EditorEvent`、Plugin diagnostics/telemetry、collab/server handshake、license diagnostics 和 support bundle 字段必须先在本文件或生成诊断文档登记。
- Diagnostics naming：`fixtures/collab/diagnostics-registry.json` 是单一真源，公开清单由 [`diagnostic-codes.md`](./diagnostic-codes.md) 生成。
- Browser support：[`browser-support.md`](./browser-support.md) 是浏览器最低版本、窄屏适配边界和构建 target 的公开真源。

Docs, type tests, wrappers and examples must consume these frozen sources. 需要新增或改名时，先更新冻结来源和对应 architecture guard，再更新文档站、类型测试、wrapper 或示例。

## Diagnostics payload contract

公开诊断载荷统一使用以下稳定字段，字段含义与完整 code registry 以 [`diagnostic-codes.md`](./diagnostic-codes.md) 为准：

- `code`：稳定诊断码，必须存在于 `fixtures/collab/diagnostics-registry.json` 及生成文档。
- `severity`：`warning` 或 `error`，用于宿主决定展示层级。
- `recoverable`：宿主是否可以重试、降级、重新授权或要求用户缩小 payload。
- `recommendedAction`：面向宿主的动作短语，例如停止任务、提示重新授权或丢弃非法 payload。
- `metadataTags`：机器可读分类标签，例如 `authorization`、`worker`、`payload-limit`、`server`。
- `JWordDiagnosticsSnapshot.registry`：生成快照时采用的 registry 摘要。
- `JWordDiagnosticsSnapshot.privacy`：固定声明文档正文、字符串 details 和 details key 已裁剪。
- `JWordDiagnosticsSnapshot.packageVersions`：只包含 package name/version，不包含安装路径。
- `JWordDiagnosticsSnapshot.featureFlags`：只包含 feature key、enabled 和来源。
- `JWordDiagnosticsSnapshot.license`：只包含授权状态和 feature key，不包含 token、签名或 private key。
- `JWordDiagnosticsSnapshot.operations`：只包含 transaction count、最近 command/origin、operation count 和 operation kind，不包含 operation payload。
- `JWordDiagnosticsSnapshot.layout`：只包含 page/line/block/table/debug box 计数，不包含正文。
- `JWordDiagnosticsSnapshot.selection`：只包含 anchor/focus 位置 ID 和 grapheme index，不包含正文。
- `JWordDiagnosticsSnapshot.collaboration` / `server`：只包含 handshake/server 摘要，不包含 token、cookie 或 secret。
- `JWordDiagnosticsSnapshot.plugins`：插件诊断只保留 `pluginName`、`code`、`lifecycle`、`commandName`、`reasonCode` 与 `recoverable`。

Feature key handoff：Gate 5 高级格式能力必须使用 `GATE5_FORMAT_FEATURES`；Gate 6 协同、离线、历史、服务端和自动插入能力必须使用 `GATE6_COLLAB_FEATURES`。授权失败诊断只允许携带 feature key、customer id、稳定诊断码和可恢复标记，不携带用户文档内容。

## @4xian/jword-core

Edition：free

Stable：

- `createEditor()`
- `Editor`
- `EditorOptions`
- `EditorEvent`
- `EditorEventListener`
- `EditorCommandOptions`
- `EditorDocumentInput`
- `EditorFixture`
- `EditorUser`
- `EditorUserInput`
- `EditorSyncUpdateInput`
- `EditorApplyUpdateOptions`
- `EditorTextAnchorInput`
- `EditorTextLocation`
- `EditorTextQueryResult`
- `EditorLocationQuery`
- `EditorAnchorSnapshot`
- `EditorRangeSnapshot`
- `EditorRangeSnapshotInput`
- `EditorSelectionSnapshot`
- `createTextInserter()`
- `TextInserter`
- `TextInserterOptions`
- `TextInserterRetryInput`
- `TextInserterProgressEvent`
- `TextInserterErrorEvent`
- `TextInserterUndoScope`
- `createRangeRef()`
- `createDocumentProjection()`
- shared document bridge API：`EditorSharedDocument`、`createEditorSharedDocument()`、`createEditorWithSharedDocument()`、`readEditorSharedDocument()`、`refreshEditorSharedDocument()`；只用于 provider adapter 与 Editor 绑定同一文档真源，宿主不得依赖内部 shared type 名称或直接改写 store 容器。
- `AnchorRef`
- `RangeRef`
- `Document`
- `DocumentProjection`
- `Block`
- `Paragraph`
- `Run`
- `Section`
- `Table`
- `TableRow`
- `TableCell`
- `Comment`
- `CommentThread`
- `CommentMessage`
- `RevisionMetadata`
- `ImageInline`
- command builder API：`buildSetBoldCommand()`、`buildSetItalicCommand()`、`buildSetUnderlineCommand()`、`buildSetTextColorCommand()`、`buildSetParagraphAlignmentCommand()`、`buildInsertTableCommand()`、`buildInsertInlineImageCommand()`、`buildInsertLinkCommand()`、`buildAddCommentThreadCommand()` 等根入口已导出的 command builders。
- layout / render API：`layoutDocument()`、`renderPageCanvas()`、`syncPageCanvases()`、`hitTestDocumentLayout()`、`getCaretRect()`、`getSelectionRects()`、`createPageConfig()`、`computeViewportPages()`。
- font measurement API：`createFontManager()`、`createCanvasTextMeasurer()`、`FontManager`、`FontManagerOptions`、`TextMeasurer`、`TextMeasurementMetrics`；core 默认保持无 DOM 近似测量，浏览器运行时只能在 mount 后由宿主 DOM 创建 canvas context 注入真实测量器。
- resources API：`Resource`、`ResourceAdapter`、`ResourceUploadRequest`、`ResourceUploadResult`、`ResourceUrlPolicy`、`DEFAULT_RESOURCE_URL_POLICY`、`isAllowedResourceUrl()`。
- diagnostics / error API：`JWordError`、`JWordErrorCode`、`JWordErrorDetails`、`TransactionDiagnostic`。统一错误码清单由 `fixtures/collab/diagnostics-registry.json` 生成，公开参考见 [`diagnostic-codes.md`](./diagnostic-codes.md)。

Experimental：

- Plugin core API：`PluginDefinition`、`PluginContext`、`PluginAdapterRegistry`、`PluginAdapterSlot`、`PluginAdapterResolution`、`PluginAdapterRegistration`、`PluginPersistenceAdapterDescriptor`、`PluginImportAdapterDescriptor`、`PluginExportAdapterDescriptor`、`PluginCollabProviderAdapterDescriptor`、`PluginCommandDefinition`、`PluginCommandMiddleware`、`PluginKeyBindingDefinition`、`PluginLifecycleEventName`、`PluginDiagnostic`、`PluginDiagnosticCode`；当前仅供 Gate 7 Plugin API M2-M6 内部消费者与试用路径使用，不承诺 1.0 兼容。
- Plugin error isolation：setup、command、middleware、keybinding、decoration、lifecycle dispose 和 adapter 回调异常会被转换为 `error` 事件与 `PluginDiagnostic`，adapter 调用失败时返回 failed resource 或 `undefined`；这不是权限沙箱，插件仍运行在宿主同一 JS realm，不能用于隔离恶意代码或替代 license/auth enforcement。
- Plugin decoration API：`ExperimentalDecorationProvider`、`PluginDecoration`、`PluginDecorationReadInput`、`PluginDecorationReadReason`、`PluginTextHighlightDecoration`、`PluginPageOverlayDecoration`、`PluginResolvedDecoration`；当前仅供 Gate 7 Plugin API M3 只读装饰路径试用，不承诺 1.0 兼容。
- `PluginContext.registerDecorationProvider()`；provider 只能读取 projection/layout/selection 快照并返回装饰描述，不能访问 canvas context 或直接写文档。
- Observability / telemetry API：`JWordTelemetryOptions`、`JWordTelemetrySink`、`JWordTelemetryEvent`、`JWordPluginDiagnosticTelemetryEvent`、`JWordDiagnosticsSnapshot`、`JWordDiagnosticsPluginEntry`、`JWordDiagnosticsPrivacySummary`、`JWordDiagnosticsPackageVersion`、`JWordDiagnosticsFeatureFlag`、`JWordDiagnosticsOperationSummary`、`JWordDiagnosticsLayoutMetrics`、`JWordDiagnosticsSelectionSummary`、`JWordDiagnosticsLicenseState`、`JWordDiagnosticsCollaborationSummary`、`JWordDiagnosticsServerSummary`；当前仅供 Gate 7 observability/devtools 路径试用，不承诺 1.0 兼容。
- `EditorOptions.telemetry` 与 `Editor.exportDiagnostics()`：telemetry 默认关闭且必须宿主 opt-in；diagnostics export 会携带 registry、package versions、feature flags、license state、operation summary、layout metrics、selection/anchor、collab/server 摘要并裁剪插件 message、字符串 details 与 details key，不包含文档正文、token、license private key 或原始 HTML。

Internal：

- Y.Doc store、operation adapter、runtime 内部对象、layout scheduler 内部状态、canvas pool 实现细节。
- 任何不在 `packages/core/src/index.ts` 根入口导出的文件级 helper。
- `packages/core/src/collaboration/inserter.ts` 内部旧命名 `createInserter` / `Inserter*` 只作为实现和内部测试遗留，不是 stable API。

## @4xian/jword-ui

Edition：free

Stable：

- `createJWordUi()`
- `CreateJWordUiOptions`
- `JWordUiInstance`
- `JWordUiElements`
- `JWordToolbarElements`
- `JWordToolbarOptions`
- `JWordToolbarToolId`
- `JWordStatusBarOptions`
- `JWordStatusBarItemId`
- `JWordStatusBarElements`
- `JWordStatusBarLocale`
- `JWordStatusBarZoomOptions`
- `JWordStatusBarThemeSwitcherOptions`
- `JWordStatusBarLocaleSwitcherOptions`
- `JWordStatusBarBrandOptions`
- `JWordStatusBarBrandProtectionMode`
- `JWordStatusBarDocumentStats`
- `JWordWatermarkOptions`
- `BUILTIN_JWORD_TOOL_IDS`
- Theme contract：`JWordUiThemeOptions`、`JWordUiThemeName`、`JWordUiThemeToken`、`DEFAULT_JWORD_UI_THEME_TOKENS`；UI 只写 `jw-root`、`data-theme` 与 `--jw-*` CSS custom properties，不把 theme 状态写入 core。`JWordUiInstance.setTheme(...)` 支持创建后动态刷新 toolbar/statusBar。
- i18n contract：`JWordUiI18nOptions`、`JWordUiI18nDictionary`、`JWordUiI18nKey`、`DEFAULT_JWORD_UI_I18N_DICTIONARY`、`resolveJWordUiI18n()`；缺失 key 回退内建中文，core 诊断码不本地化。`JWordUiInstance.setLocale(...)` 首批支持 `zh-CN` / `en-US` 动态刷新 toolbar/statusBar。
- `createCoreMediaCommandAdapter()`
- `createCoreTableCommandAdapter()`
- `JWordMediaAdapter`
- `JWordMediaCommandAdapter`
- `JWordTableCommandAdapter`
- `createFindReplaceController()`
- `FindReplaceControllerHandle`
- `createHeaderFooterController()`
- `HeaderFooterControllerHandle`
- `createHeadingOutlineController()`
- `HeadingOutlineControllerHandle`
- comments / link / revision / readonly / user option types exported from the root entry.
- media and link policy API：`DEFAULT_JWORD_MEDIA_URL_POLICY`、`isAllowedJWordMediaUrl()`、`DEFAULT_JWORD_LINK_PROTOCOL_ALLOWLIST`、`isAllowedJWordLinkUrl()`。
- style entry：`@4xian/jword-ui/styles.css`；当前样式使用 `jw-` BEM class 与 `--jw-color-*` / `--jw-focus-ring` token，支持 `data-theme="light" | "dark"`。

Current UI behavior:

- `createJWordUi({ editor, editorHost })` 默认启用专业 Tab toolbar 与底部 statusBar；`toolbarHost` / `statusBar.host` 未传时由 SDK 在 `editorHost` 内组织 `toolbar / editor shell / statusBar`。
- toolbar 支持 `professional` / `common` 双模式；旧 `visibleTools` 用法兼容为常用工具列表。
- statusBar 默认提供文档统计、页码、选区统计、缩放、适应宽度/整页、全屏、演示模式、主题和语言入口；协作/保存/批注/修订汇总、企业治理、diagnostics/support bundle、AI 助手不属于 MVP。
- `JWordUiInstance.setWatermark(...)`、`clearWatermark()`、`getWatermark()` 提供实例级页面水印；水印挂载在 UI canvas container 内，不写入 core 文档模型或协作事务。
- statusBar `brand.protection` 支持 `hidden`、`restore`、`watermarkFallback`；版权水印与用户页面水印分层管理，`clearWatermark()` 不会清除版权水印。

Experimental：

- Plugin UI extension API：`JWordUiPluginExtension`、`JWordToolbarPluginItem`、`JWordMenuPluginItem`、`JWordMenuPluginAction`、`JWordUiPluginRenderContext`；当前仅供 Gate 7 Plugin API M4-M6 toolbar/menu 扩展与内部 `jword.ui` 消费者试用，不承诺 1.0 兼容。
- 插件 UI action 可选 `announce(context)` 保留 live region 播报；UI 层只负责渲染和触发 core plugin command，不保存第二套编辑状态。

Internal：

- DOM controller internals、toolbar rendering helpers、panel wiring internals and test hooks。
- 任何未通过 `packages/ui/src/index.ts` 或 `./styles.css` export map 暴露的路径。

## @4xian/jword-native

Edition：free

Stable：

- `saveJWordDocument()`
- `loadJWordDocument()`
- `validateJWordPackage()`
- `detectJWordNativeWorkerCapability()`
- `JWORD_NATIVE_WORKER_CSP_DIRECTIVES`
- `SaveJWordDocumentOptions`
- `SaveJWordDocumentResult`
- `LoadJWordDocumentOptions`
- `LoadJWordDocumentResult`
- `ValidateJWordPackageOptions`
- `ValidateJWordPackageResult`
- `JWordPackageManifest`
- `JWordPackageMetadata`
- `JWordPackageChecksums`
- `JWordPackageDiagnostic`
- `JWordPackageDiagnosticCode`
- `JWordPackageErrorCode`
- `JWordPackageWarningCode`
- `JWordPackageWarning`
- `JWordPackageMigrationReport`
- `JWORD_NATIVE_FORMAT_VERSION`
- `JWORD_NATIVE_SCHEMA_VERSION`
- `JWordNativePackageError`
- message helper API exported from the root entry for worker orchestration：`createSaveJWordNativeRequest()`、`createLoadJWordNativeRequest()`、`createValidateJWordNativeRequest()`、`createCancelJWordNativeRequest()`、`createJWordNativeTransferables()`。
- `./worker` is a public worker entry for the native package pipeline。
- Worker capability policy：宿主应先调用 `detectJWordNativeWorkerCapability()`；不可用时返回 `JWORD_NATIVE_WORKER_UNAVAILABLE` 诊断，`fallback` 固定为 `none`，不提供同线程 fallback。
- CSP baseline：`worker-src 'self' blob:`；若 bundler 以 Blob URL 生成 module worker，还需要 `script-src 'self' blob:`。

Experimental：当前无。

Internal：

- zip implementation details、checksum helper、migration helper and worker-local helper functions。
- resource packing internals and fixture-only utilities。

## @4xian/jword-docx

Edition：paid format

Stable：

- `importDocx()`
- `exportDocx()`
- `createDocxImportPluginAdapter()`
- `createDocxExportPluginAdapter()`
- `inspectDocxPackage()`
- `convertDocxImportDocumentToCoreDocument()`
- `createDocxCompatibilityReport()`
- `diffDocxRoundtrip()`
- `detectDocxWorkerCapability()`
- `DOCX_WORKER_CSP_DIRECTIVES`
- `DocxBinaryInput`
- `DocxImportDocument`
- `DocxImportMetadata`
- `DocxImportSection`
- `DocxImportParagraph`
- `DocxImportRun`
- `DocxImportInline`
- `DocxImportTable`
- `DocxImportResource`
- `ImportDocxOptions`
- `ImportDocxResult`
- `ExportDocxOptions`
- `ExportDocxResult`
- `InspectDocxPackageResult`
- `DocxWarning`
- `DocxError`
- `DocxProgressEvent`
- `DocxDiagnostics`
- `DocxOpaquePreservation`
- `DOCX_ERROR_CODE_METADATA`
- `DOCX_WARNING_CODE_METADATA`
- `isDocxErrorCode()`
- `GATE5_FORMAT_FEATURES` defines required paid format feature keys through `@4xian/jword-license`。
- `./worker` is a public worker entry for DOCX import/export/inspect orchestration。
- Worker capability policy：宿主应先调用 `detectDocxWorkerCapability()`；不可用时返回 `DOCX_WORKER_UNAVAILABLE` 诊断，`fallback` 固定为 `none`，不提供同线程 fallback。
- CSP baseline：`worker-src 'self' blob:`；若 bundler 以 Blob URL 生成 module worker，还需要 `script-src 'self' blob:`。

Compatibility evidence：

- 当前 `fixtures/docx/compatibility-results.json` 中 14 个 T1/T2 DOCX 导出 fixture 已通过自动 package graph、roundtrip diff 与 Open XML validator 检查。
- Microsoft Word 桌面版仍为 `pending/not-run`，对外材料不得声明已完成 Word 桌面版兼容验证。当前 API 只提供 DOCX import/export，不提供旧二进制 `.doc` 直接读写；`.doc` 只作为 Word 另存人工观察边界。
- Word 桌面版补证必须按 `fixtures/docx/evidence-templates/manual-compatibility-results.template.json` 记录打开、编辑、保存、重开结果，并保留 export artifact 的 byteLength 与 SHA-256 绑定字段。

Experimental：当前无。

Internal：

- XML parser helpers、OPC package readers, JSZip wiring, worker-local helper functions and fixture diff internals not listed above。
- Unsupported OOXML preservation internals that are not surfaced through warning / opaque preservation result types。

## @4xian/jword-pdf

Edition：paid format

Stable：

- `exportPdfFromLayout()`
- `createPdfExportPluginAdapter()`
- `detectPdfWorkerCapability()`
- `PDF_WORKER_CSP_DIRECTIVES`
- `ExportPdfOptions`
- `ExportPdfResult`
- `PdfProgressEvent`
- `PdfWarning`
- `PdfError`
- `PdfFontConfig`
- `PdfFontSource`
- `PdfPageGeometry`
- `PdfExportImageInput`
- `PdfImageAsset`
- `createPdfVisualReport()`
- `PDF_ERROR_CODE_METADATA`
- `PDF_WARNING_CODE_METADATA`
- `GATE5_FORMAT_FEATURES` defines required paid format feature keys through `@4xian/jword-license`。
- `./worker` is a public worker entry for PDF export orchestration。
- Worker capability policy：宿主应先调用 `detectPdfWorkerCapability()`；不可用时返回 `PDF_WORKER_UNAVAILABLE` 诊断，`fallback` 固定为 `none`，不提供同线程 fallback。
- CSP baseline：`worker-src 'self' blob:`；若 bundler 以 Blob URL 生成 module worker，还需要 `script-src 'self' blob:`。

Worker-only（`@4xian/jword-pdf/worker`）：

- `createPdfProgressResponse()`
- `createPdfErrorResponse()`
- `createCancelPdfWorkerRequest()`
- `createPdfTransferables()`
- `readPdfImageAsset()`
- `handlePdfWorkerRequest()`

Experimental：当前无。

Internal：

- pdf-lib/fontkit adapter details, renderer helper types, worker-local helper functions and visual fixture internals not listed above。
- PDF import, PDF edit and PDF viewer API are not implemented and must not be documented as stable。

## @4xian/jword-persistence

Edition：free base contract

导出分级摘要：stable 覆盖基础 storage contract、diagnostics、memory/storage history adapter 类型和不可用 IndexedDB fallback；experimental 覆盖浏览器 IndexedDB adapter 行为；internal 覆盖 Yjs reconstruction、SHA-256 helper、storage serialization helper 和实现类。协作相关 persistence adapter 只在 paid collaboration 场景中作为高级能力消费。

版本历史实现边界：以 `docs/current-implementation/packages/persistence.md` 和当前 persistence/collab 源码为准；公开 API 只承诺 update log、JWord snapshot record 和隔离 Y.Doc 重放路线，不公开 Yjs `Y.Snapshot` 或 `gc = false` 作为集成能力。

Stable：

- `createMemoryPersistenceHistoryService()`
- `createMemoryPersistenceAdapter()`
- `createJWordPersistencePluginAdapter()`
- `createUnavailableIndexedDbOfflineAdapter()`
- `createStoragePersistenceAdapter()`
- `createVolatileHistoryStorage()`
- `createIndexedDbOfflineAdapter()`
- `JWordPersistenceSnapshotAdapter`
- `JWordOfflineAdapter`
- `JWordPersistenceDiagnostic`
- `JWordUpdateLogRecord`
- `JWordSnapshotRecord`
- `JWordVersionRecord`
- `AppendJWordUpdateInput`
- `AppendJWordUpdateResult`
- `CreateJWordSnapshotInput`
- `CreateJWordSnapshotResult`
- `LoadJWordVersionInput`
- `LoadJWordVersionResult`
- `RestoreJWordVersionInput`
- `RestoreJWordVersionResult`
- `CompactJWordVersionInput`
- `CompactJWordVersionResult`
- `PERSISTENCE_DIAGNOSTIC_CODE_METADATA`

Experimental：

- IndexedDB adapter behavior is available as a package API, but browser storage behavior remains a Gate 7 integration target until external empty-project validation is finished。

Internal：

- Yjs reconstruction details, SHA-256 helpers, storage serialization helpers and adapter implementation classes。
- Any direct storage schema dependency outside exported serialized record types。

## @4xian/jword-collab

Edition：paid collaboration

Stable：

- `connectJWordCollaboration()`
- `ConnectJWordCollaborationOptions`
- `JWordCollaborationConnection`
- `JWordCollaborationEditor`
- `JWordCollaborationHandshake`
- `JWordCollaborationStatus`
- `JWordCollaborationAwarenessHandle`
- `JWordCollaborationPresenceInput`
- `JWordCollaborationOfflineState`
- `JWordCollaborationOfflineHandle`
- `JWordCollaborationHistoryHandle`
- `JWordCollaborationHistoryVersion`
- `JWordCollaborationHistoryPreview`
- `JWordCollaborationHistoryRestoreResult`
- `JWordCollaborationAutoInsertSession`
- `JWordCollaborationAutoInsertSessionInput`
- `JWordCollaborationAutoInsertPosition`
- `JWordCollaborationAutoInsertRange`
- `JWordCollaborationAutoInsertRetryInput`
- `JWordCollaborationAutoInsertWriteResult`
- `JWordCollabProviderAdapter`
- `createJWordCollabProviderPluginAdapter()`
- `JWordCollabAwarenessAdapter`
- `JWordCollabProviderStatus`
- `JWordCollabDiagnostic`
- `JWordCollabProviderError`
- `JWordAwarenessUser`
- `JWordAwarenessState`
- `JWordAwarenessTextAnchorRecord`
- `JWordAwarenessRangeSnapshot`
- `createMemoryCollabProviderAdapter()`
- `createJWordCollabFeatureGate()`
- `serializeAwarenessState()`
- `parseAwarenessState()`
- `cleanupStaleAwarenessStates()`
- `downgradeUnresolvedAnchorToPresence()`
- `GATE6_COLLAB_FEATURES`
- `JWORD_COLLAB_CLIENT_PROTOCOL_VERSION`
- `JWORD_COLLAB_CLIENT_PACKAGE_VERSION`

Experimental：

- `./experimental`
- `createHocuspocusCollabProviderAdapter()`
- `CreateHocuspocusCollabProviderAdapterOptions`

Internal：

- Hocuspocus provider implementation details outside `./experimental`。
- concrete provider instance types, WebSocket internals, Yjs provider internals, demo runtime and browser harness。
- server service internals from `examples/collab` or `packages/collab-server/src/*` that are not exported by formal package entries。

## @4xian/jword-collab-server

Edition：paid collaboration

Stable：

- `createJWordCollabServer()`
- `startJWordCollabServer()`
- `createJWordCollabRequestHandler()`
- `createJWordCollabHistoryService()`
- `createJWordCollabHocuspocusServer()`
- `CreateJWordCollabServerOptions`
- `JWordCollabServerState`
- `JWordCollabServer`
- `JWordCollabNodeRequestHandler`
- `JWordCollabServerFeatureFlag`
- `JWordCollabServerAuthHook`
- `JWordCollabServerAuthHookInput`
- `JWordCollabServerAuthHookResult`
- `JWordCollabServerTenantHook`
- `JWordCollabServerLicenseHook`
- `JWordCollabServerLogger`
- `JWordCollabHistoryService`
- `CreateJWordCollabHistoryServiceOptions`
- `RecordJWordCollabHistoryVersionInput`
- `RecordJWordCollabHistoryVersionResult`
- `JWordCollabHocuspocusServer`
- `CreateJWordCollabHocuspocusServerOptions`
- `JWordCollabHocuspocusServerState`
- `JWordCollabHocuspocusRole`
- `JWordCollabHocuspocusAuthHook`
- `JWordCollabHocuspocusAuthHookInput`
- `JWordCollabHocuspocusAuthHookResult`
- `JWORD_COLLAB_SERVER_PROTOCOL_VERSION`
- `JWORD_COLLAB_SERVER_PACKAGE_VERSION`
- `GATE6_COLLAB_FEATURES`

Security defaults：`createJWordCollabServer()` and `createJWordCollabRequestHandler()` deny protected HTTP routes when `authHook` is omitted (`401` / `JWORD_COLLAB_AUTH_HOOK_REQUIRED`), and paid feature checks deny when `licenseHook` is omitted (`403` / `JWORD_COLLAB_LICENSE_HOOK_REQUIRED`). Hosts must pass explicit allow hooks for local demos or test-only deployments. Same-document history operations are serialized with bounded backpressure; `maxHistoryDocumentLockQueueDepth` controls the queue depth and overflow returns `429` / `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED`. Configured `rateLimit` applies a per-client sliding window to protected business routes and returns `429` / `JWORD_COLLAB_SERVER_RATE_LIMITED` with `retryAfterMs` when exceeded.

WebSocket permission contract：formal Hocuspocus server auth uses per-user read/comment/write roles. `read` and `comment` roles may connect and receive sync but cannot submit Yjs updates; any update from these roles is rejected in `beforeSync` with `COLLAB_PERMISSION_DENIED`. `comment` is reserved for post-1.0 comment-specific enforcement because comments are still Yjs updates and cannot be distinguished cheaply at the server boundary. Client-side `readonly` is only UX and is not a security boundary.

Experimental：当前无。

Internal：

- HTTP routing helpers, request guard internals, Hocuspocus server implementation internals, auto-insert relay internals and demo server wrappers。
- history storage implementation details outside exported service and persistence adapter contracts。

## @4xian/jword-license

Edition：paid entitlement

Stable：

- `GATE5_FORMAT_FEATURES`
- `GATE6_COLLAB_FEATURES`
- `assertJWordFeatureEntitled()`
- `createJWordLicenseError()`
- `isJWordLicenseDiagnosticCode()`
- `JWordLicenseFeatureKey`
- `JWordLicenseDiagnosticCode`
- `JWordLicenseStatus`
- `JWordLicenseDiagnosticCodeMetadata`
- `JWordLicenseEntitlement`
- `JWordLicenseValidationOptions`
- `JWordLicenseValidationResult`
- `JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA`
- `JWordLicenseError`

Experimental：当前无。

Internal：

- license message formatting helper and time parsing helper。
- any future network license validation or customer portal integration until it is implemented and exported。

## @4xian/jword-react

Edition：free wrapper

Stable：

- `JWordReactEditor`
- `JWordReactEditorProps`
- `JWordReactEditorHandle`
- `JWordReactErrorBoundary`
- `JWordEditorProvider`
- `useJWordEditor()`
- `useJWordEditorHandle()`

Experimental：当前无。

Internal：

- wrapper 内部 DOM refs、React effect 调度、UI/editor 实例持有细节。
- React wrapper 错误边界不是权限沙箱；插件与 wrapper 仍运行在宿主同一 JS realm。

## @4xian/jword-vue

Edition：free wrapper

Stable：

- `JWordVueEditor`
- `JWordVueEditorProps`
- `JWordVueEditorHandle`
- `JWORD_VUE_EDITOR_KEY`
- `useJWordEditor()`
- `useJWordEditorHandle()`

Experimental：当前无。

Internal：

- wrapper 内部 DOM refs、Vue lifecycle 调度、UI/editor 实例持有细节。
- Vue wrapper expose/provide 不是权限沙箱；插件与 wrapper 仍运行在宿主同一 JS realm。

## @4xian/jword-devtools

Edition：free diagnostics

Stable：

- `attachJWordDevtools()`
- `AttachJWordDevtoolsOptions`
- `JWordDevtoolsHandle`

Experimental：当前无。

Internal：

- Devtools 只消费 `Editor.exportDiagnostics()` 返回的隐私裁剪 snapshot，不读取 editor runtime、Y.Doc、provider、worker 或 package `src` 内部路径。
- 初版只提供 opt-in 浮动面板，不实现 Chrome Extension；默认不进入免费首屏 bundle。
- 面板错误不得影响 editor，`destroy()` 后必须移除 DOM/listener。
