/**
 * 职责：提供 Gate 7 Step 7.3 可编译的最小公开接口示例。
 * 边界：只做类型层示例，不运行 SDK，不导入内部源码、provider 内部类型或 demo runtime。
 * 协作模块：公开 API 清单、导出审计和文档示例共同证明外部项目能从包入口接入。
 * 约束：本文件只能使用 package 名称导入；新增示例必须保持无副作用并通过 `pnpm test:types`。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createEditor,
  createEditorSharedDocument,
  createTextInserter,
  buildSetBoldCommand,
  type Document,
  type Editor,
  type JWordDiagnosticsSnapshot
} from '@4xian/jword-core'
import {
  createJWordUi,
  type CreateJWordUiOptions,
  type JWordUiInstance
} from '@4xian/jword-ui'
import {
  loadJWordDocument,
  saveJWordDocument,
  type LoadJWordDocumentResult,
  type SaveJWordDocumentResult
} from '@4xian/jword-native'
import {
  exportDocx,
  importDocx,
  type ExportDocxResult,
  type ImportDocxResult
} from '@4xian/jword-docx'
import {
  exportPdfFromLayout,
  type ExportPdfResult
} from '@4xian/jword-pdf'
import {
  createMemoryPersistenceAdapter,
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage,
  type JWordPersistenceDiagnostic,
  type JWordVersionRecord
} from '@4xian/jword-persistence'
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type JWordCollaborationConnection
} from '@4xian/jword-collab'
import {
  createJWordCollabRequestHandler,
  createJWordCollabServer,
  type JWordCollabServerState
} from '@4xian/jword-collab-server'
import {
  GATE5_FORMAT_FEATURES,
  assertJWordFeatureEntitled,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey
} from '@4xian/jword-license'

declare const editorHost: HTMLElement
declare const liveRegionHost: HTMLElement
declare const binaryInput: Blob
declare const docxProjection: Parameters<typeof exportDocx>[0]
declare const pdfLayout: Parameters<typeof exportPdfFromLayout>[0]
declare const collaborationEditor: Parameters<typeof connectJWordCollaboration>[0]
declare const entitlement: JWordLicenseEntitlement

declare function renderDiagnosticMessages(messages: readonly string[]): void

/** 创建免费基础版 editor 和原生 UI。 */
export function createFreeEditorExample(): { readonly editor: Editor, readonly ui: JWordUiInstance } {
  const editor = createEditor({
    initialText: 'Hello JWord'
  })
  const uiOptions: CreateJWordUiOptions = {
    editor,
    editorHost,
    liveRegionHost
  }

  return {
    editor,
    ui: createJWordUi(uiOptions)
  }
}

/** 保存并重新打开 `.jword` 原生文档。 */
export async function roundtripNativePackageExample(editor: Editor): Promise<LoadJWordDocumentResult> {
  const saved: SaveJWordDocumentResult = await saveJWordDocument(editor, {
    requestId: 'save-1'
  })

  return loadJWordDocument(saved.blob, {
    requestId: 'load-1'
  })
}

/** 使用基础 persistence adapter 保存宿主版本历史。 */
export async function persistenceExample(document: Document): Promise<readonly JWordVersionRecord[]> {
  createEditorSharedDocument()
  const memoryAdapter = createMemoryPersistenceAdapter()
  const storageAdapter = createStoragePersistenceAdapter({
    storage: createVolatileHistoryStorage()
  })
  const inserter = createTextInserter(createEditor(), {
    requestId: `insert-${document.id}`
  })

  inserter.abort('example-finished')
  await memoryAdapter.listVersions(document.id)
  return storageAdapter.listVersions(document.id)
}

/** 接入 Gate 5 高级格式能力并使用稳定 feature key。 */
export async function paidFormatExample(): Promise<{
  readonly docxImport: ImportDocxResult
  readonly docxExport: ExportDocxResult
  readonly pdfExport: ExportPdfResult
}> {
  assertJWordFeatureEntitled(entitlement, GATE5_FORMAT_FEATURES.docxImport)
  const docxImport = await importDocx(binaryInput, {
    license: entitlement
  })
  const docxExport = await exportDocx(docxProjection, {
    license: entitlement
  })
  const pdfExport = await exportPdfFromLayout(pdfLayout, {
    license: entitlement
  })

  return {
    docxImport,
    docxExport,
    pdfExport
  }
}

/** 接入 Gate 6 协同 client 和 self-host server。 */
export async function paidCollaborationExample(): Promise<{
  readonly connection: JWordCollaborationConnection
  readonly serverState: JWordCollabServerState
}> {
  const provider = createMemoryCollabProviderAdapter({
    documentId: 'doc-1',
    roomId: 'room-1',
    clientId: 'client-1'
  })
  const server = createJWordCollabServer({
    authHook: () => ({ ok: true, userId: 'user-1' }),
    licenseHook: () => ({ ok: true })
  })
  const serverState = await server.start()
  const connection = await connectJWordCollaboration(collaborationEditor, {
    serverUrl: serverState.httpUrl,
    documentId: 'doc-1',
    roomId: 'room-1',
    user: { id: 'user-1', name: 'User 1' },
    token: 'demo-token',
    license: entitlement,
    features: [GATE6_COLLAB_FEATURES.multiplayer],
    provider
  })

  createJWordCollabRequestHandler({
    authHook: () => ({ ok: true, userId: 'user-1' }),
    licenseHook: () => ({ ok: true })
  })

  await server.stop()

  return {
    connection,
    serverState
  }
}

/** 读取公开诊断快照并只展示已裁剪的稳定字段。 */
export function diagnosticsPayloadExample(snapshot: JWordDiagnosticsSnapshot): readonly string[] {
  const pluginMessages = snapshot.plugins.map((entry) => `${entry.pluginName}:${entry.code}`)
  renderDiagnosticMessages(pluginMessages)

  return [
    snapshot.generatedAt,
    snapshot.privacy.contentIncluded ? 'unexpected-content' : 'content-redacted',
    ...pluginMessages
  ]
}

/** 保留公开类型和 feature key 的最小外部消费形状。 */
export function stableTypeHandoffExample(
  diagnostic: JWordPersistenceDiagnostic,
  feature: JWordLicenseFeatureKey = GATE6_COLLAB_FEATURES.history
): string {
  const boldCommandBuilder = buildSetBoldCommand
  return `${diagnostic.code}:${feature}:${boldCommandBuilder.name}`
}
