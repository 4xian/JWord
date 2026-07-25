/**
 * 职责：模拟第三方 TypeScript 项目只从 JWord package 入口消费公开 API。
 * 边界：只做类型层验收，不运行 SDK，不导入 monorepo src、demo runtime、provider 内部或 Yjs 内部类型。
 * 协作模块：Gate 7 公开接口目录、包导出映射和无别名冒烟共同验证对外消费边界。
 * 约束：本文件只能使用 package 名称导入；新增 stable API 时应先更新冻结清单和本类型测试。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
  type JWordDiagnosticsFeatureFlag,
  type JWordDiagnosticsOperationSummary,
  type JWordDiagnosticsSnapshot,
  type PluginAdapterRegistry,
  type PluginAdapterResolution,
  type PluginAdapterSlot,
  type PluginCollabProviderAdapterDescriptor,
  type PluginDefinition,
  type PluginExportAdapterDescriptor,
  type PluginImportAdapterDescriptor,
  type PluginPersistenceAdapterDescriptor,
  type ResourceAdapter
} from '@4xian/jword-core'
import {
  BUILTIN_JWORD_TOOL_IDS,
  DEFAULT_JWORD_UI_I18N_DICTIONARY,
  DEFAULT_JWORD_UI_THEME_TOKENS,
  createCoreMediaCommandAdapter,
  createJWord,
  createJWordUi,
  resolveJWordUiI18n,
  type CreateJWordUiOptions,
  type CreateJWordOptions,
  type JWordEditorShell,
  type JWordEditorShellSlots,
  type JWordEditorShellUiOptions,
  type JWordToolbarPluginItem,
  type JWordUiI18nDictionary,
  type JWordUiI18nOptions,
  type JWordUiInstance,
  type JWordUiThemeOptions,
  type JWordUiThemeToken
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
  createDocxExportPluginAdapter,
  createDocxImportPluginAdapter,
  detectDocxWorkerCapability,
  exportDocx,
  importDocx,
  type ExportDocxResult,
  type ImportDocxResult
} from '@4xian/jword-docx'
import {
  PDF_WORKER_CSP_DIRECTIVES,
  createPdfExportPluginAdapter,
  detectPdfWorkerCapability,
  exportPdfFromLayout,
  type ExportPdfResult,
  type PdfWarning
} from '@4xian/jword-pdf'
import {
  createMemoryPersistenceAdapter,
  createJWordPersistencePluginAdapter,
  createStoragePersistenceAdapter,
  type JWordPersistenceDiagnostic,
  type JWordPersistenceSnapshotAdapter,
  type JWordVersionRecord
} from '@4xian/jword-persistence'
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createJWordCollabProviderPluginAdapter,
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
  JWORD_FEATURES,
  activateJWordLicense,
  assertJWordFeatureEntitled,
  assertJWordFeatureLicensed,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed,
  type JWordFeature,
  type JWordLicense,
  type JWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey,
  type JWordLicenseTransfer,
  type JWordLicenseToken
} from '@4xian/jword-license'
import {
  JWordReactEditor,
  JWordReactErrorBoundary,
  JWordEditorProvider,
  useJWordEditor,
  useJWordEditorHandle,
  type JWordReactEditorHandle,
  type JWordReactEditorProps
} from '@4xian/jword-react'
import {
  JWORD_VUE_EDITOR_KEY,
  JWordVueEditor,
  useJWordEditor as useJWordVueEditor,
  useJWordEditorHandle as useJWordVueEditorHandle,
  type JWordVueEditorHandle,
  type JWordVueEditorProps
} from '@4xian/jword-vue'
import {
  attachJWordDevtools,
  type AttachJWordDevtoolsOptions,
  type JWordDevtoolsHandle
} from '@4xian/jword-devtools'

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
expectType<JWordDiagnosticsFeatureFlag>({ key: 'diagnostics.export', enabled: true, source: 'core' })
expectType<JWordDiagnosticsOperationSummary>({ transactionCount: 1 })
expectType<PluginDefinition>(undefined as unknown as PluginDefinition)
expectType<PluginAdapterRegistry>(undefined as unknown as PluginAdapterRegistry)
expectType<PluginAdapterSlot<ResourceAdapter>>(undefined as unknown as PluginAdapterSlot<ResourceAdapter>)
expectType<PluginAdapterResolution<ResourceAdapter>>(undefined as unknown as PluginAdapterResolution<ResourceAdapter>)
expectType<PluginPersistenceAdapterDescriptor>(undefined as unknown as PluginPersistenceAdapterDescriptor)
expectType<PluginImportAdapterDescriptor>(undefined as unknown as PluginImportAdapterDescriptor)
expectType<PluginExportAdapterDescriptor>(undefined as unknown as PluginExportAdapterDescriptor)
expectType<PluginCollabProviderAdapterDescriptor>(undefined as unknown as PluginCollabProviderAdapterDescriptor)
expectType<ResourceAdapter>(undefined as unknown as ResourceAdapter)
expectType<typeof JWordError>(JWordError)

expectType<typeof createJWord>(createJWord)
expectType<CreateJWordOptions>({ host: undefined as unknown as HTMLElement })
expectType<JWordEditorShell>(undefined as unknown as JWordEditorShell)
expectType<JWordEditorShellSlots>({ comments: undefined as unknown as HTMLElement })
expectType<JWordEditorShellUiOptions>({ toolbar: false })
expectType<typeof createJWordUi>(createJWordUi)
expectType<CreateJWordUiOptions>({
  editor: undefined as unknown as Editor,
  theme: {
    name: 'dark',
    tokens: { colorAccent: '#2563eb' }
  },
  i18n: {
    locale: 'zh-CN',
    messages: { 'toolbar.format.bold.label': '加粗' }
  }
})
expectType<JWordUiInstance>(undefined as unknown as JWordUiInstance)
expectType<typeof createCoreMediaCommandAdapter>(createCoreMediaCommandAdapter)
expectType<readonly string[]>(BUILTIN_JWORD_TOOL_IDS)
expectType<typeof DEFAULT_JWORD_UI_THEME_TOKENS>(DEFAULT_JWORD_UI_THEME_TOKENS)
expectType<typeof DEFAULT_JWORD_UI_I18N_DICTIONARY>(DEFAULT_JWORD_UI_I18N_DICTIONARY)
expectType<typeof resolveJWordUiI18n>(resolveJWordUiI18n)
expectType<JWordUiThemeToken>('colorAccent')
expectType<JWordUiThemeOptions>({ name: 'dark' })
expectType<JWordUiI18nDictionary>({ 'diagnostics.pluginAdapterFailed': '插件适配器执行失败。' })
expectType<JWordUiI18nOptions>({ locale: 'en-US' })
expectType<JWordToolbarPluginItem>(undefined as unknown as JWordToolbarPluginItem)

expectType<typeof attachJWordDevtools>(attachJWordDevtools)
expectType<AttachJWordDevtoolsOptions>({})
expectType<JWordDevtoolsHandle>(undefined as unknown as JWordDevtoolsHandle)

expectType<typeof JWordReactEditor>(JWordReactEditor)
expectType<typeof JWordReactErrorBoundary>(JWordReactErrorBoundary)
expectType<typeof JWordEditorProvider>(JWordEditorProvider)
expectType<() => Editor | null>(useJWordEditor)
expectType<() => JWordReactEditorHandle | null>(useJWordEditorHandle)
expectType<JWordReactEditorProps>({ defaultValue: { text: 'React fixture' } })
expectType<typeof JWordVueEditor>(JWordVueEditor)
expectType<typeof JWORD_VUE_EDITOR_KEY>(JWORD_VUE_EDITOR_KEY)
expectType<typeof useJWordVueEditor>(useJWordVueEditor)
expectType<typeof useJWordVueEditorHandle>(useJWordVueEditorHandle)
expectType<JWordVueEditorProps>({ defaultValue: { text: 'Vue fixture' } })
expectType<JWordVueEditorHandle>(undefined as unknown as JWordVueEditorHandle)

expectType<typeof saveJWordDocument>(saveJWordDocument)
expectType<typeof loadJWordDocument>(loadJWordDocument)
expectType<SaveJWordDocumentResult>(undefined as unknown as SaveJWordDocumentResult)
expectType<LoadJWordDocumentResult>(undefined as unknown as LoadJWordDocumentResult)
expectType<number>(JWORD_NATIVE_FORMAT_VERSION)
expectType<typeof detectJWordNativeWorkerCapability>(detectJWordNativeWorkerCapability)

expectType<typeof importDocx>(importDocx)
expectType<typeof exportDocx>(exportDocx)
expectType<ReturnType<typeof createDocxImportPluginAdapter>>(createDocxImportPluginAdapter())
expectType<ReturnType<typeof createDocxExportPluginAdapter>>(createDocxExportPluginAdapter())
expectType<ImportDocxResult>(undefined as unknown as ImportDocxResult)
expectType<ExportDocxResult>(undefined as unknown as ExportDocxResult)
expectType<readonly string[]>(DOCX_WORKER_CSP_DIRECTIVES)
expectType<typeof detectDocxWorkerCapability>(detectDocxWorkerCapability)

expectType<typeof exportPdfFromLayout>(exportPdfFromLayout)
expectType<ReturnType<typeof createPdfExportPluginAdapter>>(createPdfExportPluginAdapter())
expectType<ExportPdfResult>(undefined as unknown as ExportPdfResult)
expectType<PdfWarning>(undefined as unknown as PdfWarning)
expectType<readonly string[]>(PDF_WORKER_CSP_DIRECTIVES)
expectType<typeof detectPdfWorkerCapability>(detectPdfWorkerCapability)

expectType<JWordPersistenceSnapshotAdapter>(createMemoryPersistenceAdapter())
expectType<PluginPersistenceAdapterDescriptor<void, JWordPersistenceSnapshotAdapter>>(createJWordPersistencePluginAdapter(
  createMemoryPersistenceAdapter()
))
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
expectType<PluginCollabProviderAdapterDescriptor<void, JWordCollabProviderAdapter>>(createJWordCollabProviderPluginAdapter(
  createMemoryCollabProviderAdapter({
    documentId: 'doc-1',
    clientId: 'client-1'
  })
))
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
expectType<JWordFeature>(JWORD_FEATURES.formats)
expectType<JWordLicense>(activateJWordLicense(undefined as unknown as JWordLicenseToken))
expectType<JWordLicenseTransfer>(createJWordLicenseTransfer(undefined as unknown as JWordLicense))
expectType<boolean>(isJWordFeatureLicensed(undefined, JWORD_FEATURES.formats))
expectType<void>(assertJWordFeatureLicensed(undefined, JWORD_FEATURES.formats))
