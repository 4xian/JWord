/**
 * 职责：模拟第三方 TypeScript 项目只从 JWord package 入口消费公开 API。
 * 边界：只做类型层验收，不运行 SDK，不导入 monorepo src、demo runtime、provider 内部或 Yjs 内部类型。
 * 协作模块：Gate 7 公开接口目录、包导出映射和无别名冒烟共同验证对外消费边界。
 * 约束：本文件只能使用 package 名称导入；新增 stable API 时应先更新冻结清单和本类型测试。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-72建立-api-导出审计和类型测试。
 */

import {
  JWordError,
  buildSetBoldCommand,
  createEditor,
  createEditorSharedDocument,
  createTextInserter,
  type Document,
  type Editor,
  type EditorEvent,
  type EditorOptions,
  type EditorSharedDocument,
  type JWordDiagnosticsSnapshot,
  type PluginDefinition,
  type ResourceAdapter
} from '@4xian/jword-core'
import {
  BUILTIN_JWORD_TOOL_IDS,
  createCoreMediaCommandAdapter,
  createJWordUi,
  type CreateJWordUiOptions,
  type JWordToolbarPluginItem,
  type JWordUiInstance
} from '@4xian/jword-ui'
import {
  JWORD_NATIVE_FORMAT_VERSION,
  detectJWordNativeWorkerCapability,
  loadJWordDocument,
  saveJWordDocument,
  type LoadJWordDocumentResult,
  type SaveJWordDocumentResult
} from '@4xian/jword-native'
import {
  DOCX_WORKER_CSP_DIRECTIVES,
  detectDocxWorkerCapability,
  exportDocx,
  importDocx,
  type ExportDocxResult,
  type ImportDocxResult
} from '@4xian/jword-docx'
import {
  PDF_WORKER_CSP_DIRECTIVES,
  detectPdfWorkerCapability,
  exportPdfFromLayout,
  type ExportPdfResult,
  type PdfWarning
} from '@4xian/jword-pdf'
import {
  createMemoryPersistenceAdapter,
  createStoragePersistenceAdapter,
  type JWordPersistenceDiagnostic,
  type JWordPersistenceSnapshotAdapter,
  type JWordVersionRecord
} from '@4xian/jword-persistence'
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type ConnectJWordCollaborationOptions,
  type JWordCollabProviderAdapter,
  type JWordCollaborationConnection,
  type JWordCollaborationHandshake
} from '@4xian/jword-collab'
import {
  JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
  createJWordCollabRequestHandler,
  createJWordCollabServer,
  type CreateJWordCollabServerOptions,
  type JWordCollabHocuspocusAuthHook,
  type JWordCollabServerState
} from '@4xian/jword-collab-server'
import {
  GATE5_FORMAT_FEATURES,
  assertJWordFeatureEntitled,
  type JWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey
} from '@4xian/jword-license'

/** 在不运行代码的前提下断言表达式类型。 */
declare function expectType<T>(value: T): void

expectType<typeof createEditor>(createEditor)
expectType<Editor>(undefined as unknown as Editor)
expectType<EditorOptions>({})
expectType<EditorEvent>(undefined as unknown as EditorEvent)
expectType<Document>(undefined as unknown as Document)
expectType<EditorSharedDocument>(createEditorSharedDocument())
expectType<typeof buildSetBoldCommand>(buildSetBoldCommand)
expectType<typeof createTextInserter>(createTextInserter)
expectType<JWordDiagnosticsSnapshot>(undefined as unknown as JWordDiagnosticsSnapshot)
expectType<PluginDefinition>(undefined as unknown as PluginDefinition)
expectType<ResourceAdapter>(undefined as unknown as ResourceAdapter)
expectType<typeof JWordError>(JWordError)

expectType<typeof createJWordUi>(createJWordUi)
expectType<CreateJWordUiOptions>(undefined as unknown as CreateJWordUiOptions)
expectType<JWordUiInstance>(undefined as unknown as JWordUiInstance)
expectType<typeof createCoreMediaCommandAdapter>(createCoreMediaCommandAdapter)
expectType<readonly string[]>(BUILTIN_JWORD_TOOL_IDS)
expectType<JWordToolbarPluginItem>(undefined as unknown as JWordToolbarPluginItem)

expectType<typeof saveJWordDocument>(saveJWordDocument)
expectType<typeof loadJWordDocument>(loadJWordDocument)
expectType<SaveJWordDocumentResult>(undefined as unknown as SaveJWordDocumentResult)
expectType<LoadJWordDocumentResult>(undefined as unknown as LoadJWordDocumentResult)
expectType<number>(JWORD_NATIVE_FORMAT_VERSION)
expectType<typeof detectJWordNativeWorkerCapability>(detectJWordNativeWorkerCapability)

expectType<typeof importDocx>(importDocx)
expectType<typeof exportDocx>(exportDocx)
expectType<ImportDocxResult>(undefined as unknown as ImportDocxResult)
expectType<ExportDocxResult>(undefined as unknown as ExportDocxResult)
expectType<readonly string[]>(DOCX_WORKER_CSP_DIRECTIVES)
expectType<typeof detectDocxWorkerCapability>(detectDocxWorkerCapability)

expectType<typeof exportPdfFromLayout>(exportPdfFromLayout)
expectType<ExportPdfResult>(undefined as unknown as ExportPdfResult)
expectType<PdfWarning>(undefined as unknown as PdfWarning)
expectType<readonly string[]>(PDF_WORKER_CSP_DIRECTIVES)
expectType<typeof detectPdfWorkerCapability>(detectPdfWorkerCapability)

expectType<JWordPersistenceSnapshotAdapter>(createMemoryPersistenceAdapter())
expectType<typeof createStoragePersistenceAdapter>(createStoragePersistenceAdapter)
expectType<JWordVersionRecord>(undefined as unknown as JWordVersionRecord)
expectType<JWordPersistenceDiagnostic>(undefined as unknown as JWordPersistenceDiagnostic)

expectType<typeof connectJWordCollaboration>(connectJWordCollaboration)
expectType<ConnectJWordCollaborationOptions>(undefined as unknown as ConnectJWordCollaborationOptions)
expectType<JWordCollaborationConnection>(undefined as unknown as JWordCollaborationConnection)
expectType<JWordCollaborationHandshake>(undefined as unknown as JWordCollaborationHandshake)
expectType<JWordCollabProviderAdapter>(createMemoryCollabProviderAdapter({
  documentId: 'doc-1',
  clientId: 'client-1'
}))
expectType<JWordLicenseFeatureKey>(GATE6_COLLAB_FEATURES.multiplayer)

expectType<typeof createJWordCollabServer>(createJWordCollabServer)
expectType<typeof createJWordCollabRequestHandler>(createJWordCollabRequestHandler)
expectType<CreateJWordCollabServerOptions>(undefined as unknown as CreateJWordCollabServerOptions)
expectType<JWordCollabServerState>(undefined as unknown as JWordCollabServerState)
expectType<JWordCollabHocuspocusAuthHook>(undefined as unknown as JWordCollabHocuspocusAuthHook)
expectType<string>(JWORD_COLLAB_SERVER_PROTOCOL_VERSION)

expectType<typeof assertJWordFeatureEntitled>(assertJWordFeatureEntitled)
expectType<JWordLicenseFeatureKey>(GATE5_FORMAT_FEATURES.docxImport)
expectType<JWordLicenseEntitlement>(undefined as unknown as JWordLicenseEntitlement)
expectType<JWordLicenseDiagnosticCode>(undefined as unknown as JWordLicenseDiagnosticCode)
