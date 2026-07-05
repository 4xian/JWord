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

## Release / no-alias 验收

- Stable E2E 矩阵必须包含 `node tools/release/check-gate7-third-party-smoke.mjs`。
- 该 smoke 使用本地 tarball 安装当前已实现包，不使用 examples 源码 alias，覆盖 `tsc --noEmit`、`vite build` 和 Chromium 浏览器 smoke。
- 浏览器路径必须同时触达免费基础 layout 能力和至少一条付费授权能力；当前付费路径为 `pdf.export`。
- 真实 registry URL、移除 `private: true` 与任何 `publish` 动作仍需人工审批。

## Edition Matrix

- free：`@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native`、基础 `@4xian/jword-persistence` contract 和基础 diagnostics。
- paid format：`@4xian/jword-docx`、`@4xian/jword-pdf`，feature key 来自 `GATE5_FORMAT_FEATURES`。
- paid collaboration：`@4xian/jword-collab`、`@4xian/jword-collab-server`、协作相关 persistence adapter 和 `@4xian/jword-license`，feature key 来自 `GATE6_COLLAB_FEATURES`。
- paid entitlement：`@4xian/jword-license` 负责授权 entitlement、feature key 和授权诊断，不读取用户文档内容。

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
- diagnostics / error API：`JWordError`、`JWordErrorCode`、`JWordErrorDetails`、`TransactionDiagnostic`。

Experimental：当前无。

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
- `BUILTIN_JWORD_TOOL_IDS`
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
- style entry：`@4xian/jword-ui/styles.css`。

Experimental：当前无。

Internal：

- DOM controller internals、toolbar rendering helpers、panel wiring internals and test hooks。
- 任何未通过 `packages/ui/src/index.ts` 或 `./styles.css` export map 暴露的路径。

## @4xian/jword-native

Edition：free

Stable：

- `saveJWordDocument()`
- `loadJWordDocument()`
- `validateJWordPackage()`
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

Experimental：当前无。

Internal：

- zip implementation details、checksum helper、migration helper and worker-local helper functions。
- resource packing internals and fixture-only utilities。

## @4xian/jword-docx

Edition：paid format

Stable：

- `importDocx()`
- `exportDocx()`
- `inspectDocxPackage()`
- `convertDocxImportDocumentToCoreDocument()`
- `createDocxCompatibilityReport()`
- `diffDocxRoundtrip()`
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

Compatibility evidence：

- 当前 `fixtures/docx/compatibility-results.json` 中 14 个 T1/T2 DOCX 导出 fixture 已通过自动 package graph、roundtrip diff 与 Open XML validator 检查。
- 当前人工办公套件证据只覆盖 WPS；Microsoft Word 桌面版与 LibreOffice 仍为 `pending/not-run`，对外材料不得声明已完成 Word 桌面版兼容验证。
- Word 桌面版补证必须按 `fixtures/docx/evidence-templates/manual-compatibility-results.template.json` 记录打开、编辑、保存、重开结果，并保留 export artifact 的 byteLength 与 SHA-256 绑定字段。

Experimental：当前无。

Internal：

- XML parser helpers、OPC package readers, JSZip wiring, worker-local helper functions and fixture diff internals not listed above。
- Unsupported OOXML preservation internals that are not surfaced through warning / opaque preservation result types。

## @4xian/jword-pdf

Edition：paid format

Stable：

- `exportPdfFromLayout()`
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

Stable：

- `createMemoryPersistenceHistoryService()`
- `createMemoryPersistenceAdapter()`
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
- `JWORD_COLLAB_SERVER_PROTOCOL_VERSION`
- `JWORD_COLLAB_SERVER_PACKAGE_VERSION`
- `GATE6_COLLAB_FEATURES`

Security defaults：`createJWordCollabServer()` and `createJWordCollabRequestHandler()` deny protected HTTP routes when `authHook` is omitted (`401` / `JWORD_COLLAB_AUTH_HOOK_REQUIRED`), and paid feature checks deny when `licenseHook` is omitted (`403` / `JWORD_COLLAB_LICENSE_HOOK_REQUIRED`). Hosts must pass explicit allow hooks for local demos or test-only deployments. Same-document history operations are serialized with bounded backpressure; `maxHistoryDocumentLockQueueDepth` controls the queue depth and overflow returns `429` / `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED`. Configured `rateLimit` applies a per-client sliding window to protected business routes and returns `429` / `JWORD_COLLAB_SERVER_RATE_LIMITED` with `retryAfterMs` when exceeded.

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

状态：未实现，不能作为 stable API 使用

Edition：future wrapper

Stable：当前无。

Experimental：当前无。

Internal：Gate 7 Step 7.7 前不得公开 React wrapper API。

## @4xian/jword-vue

状态：未实现，不能作为 stable API 使用

Edition：future wrapper

Stable：当前无。

Experimental：当前无。

Internal：Gate 7 Step 7.8 前不得公开 Vue wrapper API。

## @4xian/jword-devtools

状态：未实现，不能作为 stable API 使用

Edition：future devtools

Stable：当前无。

Experimental：当前无。

Internal：Gate 7 Step 7.10 前不得公开 devtools API。
