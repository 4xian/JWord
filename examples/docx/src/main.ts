/**
 * 职责：装配 Gate 5 DOCX/PDF 手动验收入口，连接导入、导出、roundtrip diff 和 PDF 下载。
 * 边界：只做 demo host 接线，不实现 DOCX/PDF 包内部语义，不提供 PDF 导入查看或编辑能力。
 * 协作模块：core editor facade、官方 UI、@4xian/jword-docx 和 @4xian/jword-pdf。
 * 性能/安全约束：互通能力只在 examples/docx 路由加载，不进入 examples/vanilla 首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---建立-examplesdocx-手动验收入口。
 */
import { createEditor } from '@4xian/jword-core'
import type { Document, DocumentLayout, DocumentProjection } from '@4xian/jword-core'
import type {
  DocxBinaryInput,
  DocxImportDocument,
  DocxRoundtripDiffResult,
  DocxWarning,
  ExportDocxResult,
  ImportDocxResult
} from '@4xian/jword-docx'
import {
  assertJWordFeatureEntitled,
  createJWordLicenseSignature,
  isJWordLicenseDiagnosticCode,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey,
  type JWordLicenseSignaturePayload
} from '@4xian/jword-license'
import type { ExportPdfResult, PdfProgressEvent, PdfWarning } from '@4xian/jword-pdf'
import { createJWordUi } from '@4xian/jword-ui'
import {
  createDocxDemoTaskController,
  isDocxDemoTaskCancelled,
  type DocxDemoTaskSession
} from './task-session'
import '@4xian/jword-ui/styles.css'
import './styles.css'

type DocxRuntime = typeof import('@4xian/jword-docx')
type PdfRuntime = typeof import('@4xian/jword-pdf')

interface DocxDemoIntegrationRuntime {
  assertFeature(feature: JWordLicenseFeatureKey): void
  importDocx(input: DocxBinaryInput, options: DocxDemoTaskRuntimeOptions): Promise<ImportDocxResult>
  exportDocx(document: DocumentProjection, options: DocxDemoTaskRuntimeOptions): Promise<ExportDocxResult>
  exportPdf(layout: DocumentLayout, options: DocxDemoPdfTaskRuntimeOptions): Promise<ExportPdfResult>
  diffDocxRoundtrip(bytes: ArrayBuffer, options: DocxDemoTaskRuntimeOptions): Promise<DocxRoundtripDiffResult>
  convertDocxImportDocumentToCoreDocument(document: DocxImportDocument): Promise<Document>
}

interface DocxDemoIntegrationOptions {
  readonly license: JWordLicenseEntitlement | null
}

interface DocxDemoTaskRuntimeOptions {
  readonly feature: JWordLicenseFeatureKey
  readonly requestId: string
  readonly signal?: AbortSignal
}

interface DocxDemoPdfTaskRuntimeOptions extends DocxDemoTaskRuntimeOptions {
  readonly onProgress?: (event: PdfProgressEvent) => void
  readonly onWarning?: (warning: PdfWarning) => void
}

const editorHost = requireElement<HTMLElement>('#jword-editor', 'DOCX demo requires #jword-editor.')
const toolbarHost = requireElement<HTMLElement>('#jword-toolbar', 'DOCX demo requires #jword-toolbar.')
const statusHost = requireElement<HTMLElement>('#jword-status', 'DOCX demo requires #jword-status.')
const assistiveMirrorHost = requireElement<HTMLElement>(
  '#jword-assistive-mirror',
  'DOCX demo requires #jword-assistive-mirror.'
)
const fileInput = requireElement<HTMLInputElement>('#jword-docx-file', 'DOCX demo requires #jword-docx-file.')
const fixtureSelect = requireElement<HTMLSelectElement>('#jword-docx-fixture', 'DOCX demo requires #jword-docx-fixture.')
const importButton = requireElement<HTMLButtonElement>('#jword-docx-import', 'DOCX demo requires #jword-docx-import.')
const exportDocxButton = requireElement<HTMLButtonElement>('#jword-docx-export', 'DOCX demo requires #jword-docx-export.')
const exportPdfButton = requireElement<HTMLButtonElement>('#jword-pdf-export', 'DOCX demo requires #jword-pdf-export.')
const cancelTaskButton = requireElement<HTMLButtonElement>('#jword-task-cancel', 'DOCX demo requires #jword-task-cancel.')
const warningsHost = requireElement<HTMLElement>('#jword-docx-warnings', 'DOCX demo requires #jword-docx-warnings.')
const roundtripHost = requireElement<HTMLElement>('#jword-docx-roundtrip', 'DOCX demo requires #jword-docx-roundtrip.')
const docxOutputHost = requireElement<HTMLElement>('#jword-docx-output', 'DOCX demo requires #jword-docx-output.')
const pdfOutputHost = requireElement<HTMLElement>('#jword-pdf-output', 'DOCX demo requires #jword-pdf-output.')
const taskController = createDocxDemoTaskController()

const editor = createEditor({
  initialText: 'Gate 5 DOCX manual acceptance',
  currentUser: {
    id: 'docx-demo-user',
    displayName: 'DOCX Demo User',
    color: '#2f6fcc'
  },
  layout: {
    keepLatinWordWholeOnWrap: true
  }
})
let currentDocxBytes: ArrayBuffer | null = null
let currentDocxUrl: string | null = null
let currentPdfUrl: string | null = null
let docxRuntimePromise: Promise<DocxRuntime> | null = null
let pdfRuntimePromise: Promise<PdfRuntime> | null = null
const builtInFixtureLicense = createSignedDocxDemoLicense({
  customerId: 'customer-docx-demo-fixture',
  licenseToken: 'token-docx-demo-fixture',
  features: ['docx.export'],
  issuer: 'jword-test-issuer',
  issuedAt: '2026-05-01T00:00:00Z',
  expiresAt: '2026-06-01T00:00:00Z',
  status: 'valid'
})

editor.mount(editorHost)

const jwordUi = createJWordUi({
  editor,
  editorHost,
  toolbarHost,
  liveRegionHost: statusHost,
  assistiveMirrorHost,
  headingOutline: {
    host: toolbarHost
  },
  user: {
    currentUser: {
      id: 'docx-demo-user',
      name: 'DOCX Demo User',
      color: '#2f6fcc'
    },
    resolveUser(authorId) {
      return authorId === 'docx-demo-user'
        ? {
            id: 'docx-demo-user',
            name: 'DOCX Demo User',
            color: '#2f6fcc'
          }
        : null
    }
  }
})

importButton.addEventListener('click', () => {
  void runDemoButtonTask(runDocxImport)
})
exportDocxButton.addEventListener('click', () => {
  void runDemoButtonTask(runDocxExport)
})
exportPdfButton.addEventListener('click', () => {
  void runDemoButtonTask(runPdfExport)
})
cancelTaskButton.addEventListener('click', () => {
  cancelActiveDemoTask()
})
fileInput.addEventListener('change', () => {
  setStatus(fileInput.files?.[0] === undefined ? '未选择文件，导入时使用内置 fixture。' : `已选择 ${fileInput.files[0].name}`)
})

/** 取消当前 demo 异步任务并恢复按钮状态。 */
function cancelActiveDemoTask(): boolean {
  if (taskController.cancelActiveTask()) {
    setBusy(false)
    setStatus('任务已取消，编辑器仍可继续输入。')

    return true
  }

  return false
}

window.__jwordDocxDemo = Object.freeze({
  editor,
  importSelectedFixture: runDocxImport,
  exportDocx: runDocxExport,
  exportPdf: runPdfExport,
  cancelActiveTask: cancelActiveDemoTask,
  readActiveTask: () => taskController.readActiveTask(),
  readStatus: () => statusHost.textContent ?? '',
  readWarningsText: () => warningsHost.textContent ?? '',
  readRoundtripText: () => roundtripHost.textContent ?? ''
})

setWarnings([])
setStatus('DOCX demo ready. 请选择文件或使用内置 fixture。')

window.addEventListener('beforeunload', () => {
  revokeCurrentUrls()
  jwordUi.destroy()
  editor.destroy()
})

/** 从选择的文件或内置 fixture 导入 DOCX。 */
async function runDocxImport(): Promise<void> {
  await runTask('import', '正在导入 DOCX...', async (session) => {
    const integration = createDocxDemoIntegrationRuntime({ license: readDemoLicense() })

    integration.assertFeature('docx.import')
    const input = await readSelectedDocxInput()
    const result = await integration.importDocx(input, {
      feature: 'docx.import',
      requestId: session.requestId,
      signal: session.signal
    })
    const document = await integration.convertDocxImportDocumentToCoreDocument(result.document)

    if (!session.canCommit()) {
      return
    }

    syncEditorPageConfigFromDocument(document)
    editor.loadDocumentModel({ document })
    jwordUi.refresh()
    setWarnings(result.warnings)
    roundtripHost.textContent = '已导入。导出 DOCX 后会刷新 roundtrip diff。'
    setStatus(`导入完成：${result.diagnostics.mainDocumentPart ?? 'word/document.xml'}`)
  })
}

/** 从当前 editor projection 导出 DOCX 并刷新 roundtrip diff。 */
async function runDocxExport(): Promise<ArrayBuffer> {
  return runTask('export-docx', '正在导出 DOCX...', async (session) => {
    const integration = createDocxDemoIntegrationRuntime({ license: readDemoLicense() })
    const result = await integration.exportDocx(editor.getProjection(), {
      feature: 'docx.export',
      requestId: session.requestId,
      signal: session.signal
    })

    if (!session.canCommit()) {
      return result.bytes
    }

    await updateRoundtrip(result.bytes, session)

    if (!session.canCommit()) {
      return result.bytes
    }

    setWarnings(result.warnings)
    currentDocxBytes = result.bytes
    setDownloadLink('docx', result.bytes, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    setStatus('DOCX 导出完成，可下载或重新导入。')

    return result.bytes
  })
}

/** 从当前 editor layout 导出 PDF 并生成下载入口。 */
async function runPdfExport(): Promise<ArrayBuffer> {
  return runTask('export-pdf', '正在导出 PDF...', async (session) => {
    const integration = createDocxDemoIntegrationRuntime({ license: readDemoLicense() })
    const warnings: PdfWarning[] = []
    const progress: string[] = []
    const result = await integration.exportPdf(editor.getLayout(), {
      feature: 'pdf.export',
      requestId: session.requestId,
      signal: session.signal,
      onWarning(warning) {
        warnings.push(warning)
      },
      onProgress(event) {
        progress.push(event.stage)

        if (session.canCommit()) {
          setStatus(`PDF ${event.stage}`)
        }
      }
    })

    if (!session.canCommit()) {
      return result.bytes
    }

    setWarnings(warnings)
    setDownloadLink('pdf', result.bytes, 'application/pdf')
    pdfOutputHost.append(createPre(`progress: ${progress.join(' -> ')}`))
    setStatus('PDF 导出完成，可下载预览；当前入口不提供 PDF 导入查看。')

    return result.bytes
  })
}

/** 读取当前手动验收 DOCX 输入。 */
async function readSelectedDocxInput(): Promise<DocxBinaryInput> {
  const selectedFile = fileInput.files?.[0]

  if (selectedFile !== undefined) {
    return selectedFile
  }

  if (fixtureSelect.value === 'demo-basic') {
    return createBuiltInDocxFixture()
  }

  return createBuiltInDocxFixture()
}

/** 把导入文档第一节页面设置同步到 demo editor 的分页配置。 */
function syncEditorPageConfigFromDocument(document: Document): void {
  const page = document.sections[0]?.page

  if (page === undefined) {
    return
  }

  editor.setPageConfig({
    ...(page.widthTwips === undefined ? {} : { widthTwips: page.widthTwips }),
    ...(page.heightTwips === undefined ? {} : { heightTwips: page.heightTwips }),
    ...(page.marginTwips === undefined ? {} : { marginTwips: page.marginTwips })
  })
}

/** 生成内置 DOCX fixture bytes，不在仓库落二进制占位文件。 */
async function createBuiltInDocxFixture(): Promise<ArrayBuffer> {
  const fixtureEditor = createEditor()
  const integration = createDocxDemoIntegrationRuntime({ license: builtInFixtureLicense })

  try {
    const projection = fixtureEditor.loadDocumentModel({
      document: createBuiltInCoreDocument()
    })
    const result = await integration.exportDocx(projection, {
      feature: 'docx.export',
      requestId: 'examples-docx-built-in-fixture'
    })

    return result.bytes
  } finally {
    fixtureEditor.destroy()
  }
}

/** 创建用于浏览器手动验收的最小 core 文档。 */
function createBuiltInCoreDocument(): Document {
  return {
    kind: 'document',
    id: 'document-examples-docx',
    styleIds: ['Normal', 'Heading1', 'Heading2'],
    sections: [
      {
        kind: 'section',
        id: 'section-examples-docx',
        page: {
          widthTwips: 12240,
          heightTwips: 15840,
          marginTwips: {
            top: 1440,
            right: 1440,
            bottom: 1440,
            left: 1440
          }
        },
        blocks: [
          {
            kind: 'paragraph',
            id: 'paragraph-docx-heading',
            styleId: 'Heading1',
            properties: {
              styleId: 'Heading1',
              spacingAfterTwips: 240
            },
            runs: [
              {
                kind: 'run',
                id: 'run-docx-heading',
                properties: {
                  bold: true,
                  fontSizeTwips: 480
                },
                inlines: [{ kind: 'text', text: 'Gate 5 DOCX Demo' }]
              }
            ]
          },
          {
            kind: 'paragraph',
            id: 'paragraph-docx-body',
            runs: [
              {
                kind: 'run',
                id: 'run-docx-body',
                inlines: [{ kind: 'text', text: 'Import, edit, export DOCX, then export PDF.' }]
              }
            ]
          },
          {
            kind: 'paragraph',
            id: 'paragraph-docx-list',
            properties: {
              listNumberingId: '1',
              listLevel: 0
            },
            list: {
              numberingId: '1',
              level: 0
            },
            runs: [
              {
                kind: 'run',
                id: 'run-docx-list',
                inlines: [{ kind: 'text', text: 'Roundtrip diff is shown in the side panel.' }]
              }
            ]
          },
          {
            kind: 'table',
            id: 'table-docx-demo',
            grid: [2400, 2400],
            border: {
              color: '#c0c0c0',
              widthTwips: 15
            },
            rows: [
              {
                id: 'table-docx-demo-row-1',
                cells: [
                  {
                    id: 'table-docx-demo-row-1-cell-1',
                    blocks: [createTableCellParagraph('cell-a', 'Cell A')]
                  },
                  {
                    id: 'table-docx-demo-row-1-cell-2',
                    blocks: [createTableCellParagraph('cell-b', 'Cell B')]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

/** 创建内置 fixture 表格单元格段落。 */
function createTableCellParagraph(id: string, text: string): Document['sections'][number]['blocks'][number] {
  return {
    kind: 'paragraph',
    id: `paragraph-${id}`,
    runs: [
      {
        kind: 'run',
        id: `run-${id}`,
        inlines: [{ kind: 'text', text }]
      }
    ]
  }
}

/** 更新 DOCX roundtrip diff 面板。 */
async function updateRoundtrip(bytes: ArrayBuffer, session: DocxDemoTaskSession): Promise<void> {
  const integration = createDocxDemoIntegrationRuntime({ license: readDemoLicense() })
  const diff = await integration.diffDocxRoundtrip(bytes, {
    feature: 'docx.export',
    requestId: `${session.requestId}-roundtrip`,
    signal: session.signal
  })

  if (!session.canCommit()) {
    return
  }

  roundtripHost.textContent = JSON.stringify({
    matches: diff.matches,
    differences: diff.differences,
    importWarnings: diff.importWarnings,
    exportWarnings: diff.exportWarnings,
    reimportWarnings: diff.reimportWarnings
  }, null, 2)
}

/** 写入 warning 面板。 */
function setWarnings(warnings: readonly (DocxWarning | PdfWarning)[]): void {
  warningsHost.textContent = JSON.stringify(warnings, null, 2)
}

/** 创建下载链接并写入对应输出区域。 */
function setDownloadLink(kind: 'docx' | 'pdf', bytes: ArrayBuffer, type: string): void {
  const blob = new Blob([bytes], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')

  link.href = url
  link.download = kind === 'docx' ? 'jword-gate5-export.docx' : 'jword-gate5-export.pdf'
  link.textContent = kind === 'docx' ? '下载 DOCX' : '下载 PDF'

  if (kind === 'docx') {
    if (currentDocxUrl !== null) {
      URL.revokeObjectURL(currentDocxUrl)
    }
    currentDocxUrl = url
    docxOutputHost.textContent = ''
    docxOutputHost.append(link)
    return
  }

  if (currentPdfUrl !== null) {
    URL.revokeObjectURL(currentPdfUrl)
  }
  currentPdfUrl = url
  pdfOutputHost.textContent = ''
  pdfOutputHost.append(link)
}

/** 运行带按钮状态保护的异步任务。 */
async function runTask<T>(
  kind: 'import' | 'export-docx' | 'export-pdf',
  message: string,
  task: (session: DocxDemoTaskSession) => Promise<T>
): Promise<T> {
  const session = taskController.start(kind)

  setStatus(message)
  setBusy(true)

  try {
    return await task(session)
  } catch (error) {
    const messageText = readErrorMessage(error)

    if (isDocxDemoTaskCancelled(session, error)) {
      throw error
    }

    if (session.canCommit()) {
      setStatus(messageText)
    }
    throw error
  } finally {
    if (taskController.finishTask(session.requestId)) {
      setBusy(false)
    }
  }
}

/** 运行按钮触发的任务，并吞掉用户主动取消产生的预期异常。 */
async function runDemoButtonTask(task: () => Promise<unknown>): Promise<void> {
  try {
    await task()
  } catch (error) {
    if (isKnownCancelledTaskError(error) || isKnownLicenseDiagnosticError(error)) {
      return
    }

    throw error
  }
}

/** 判断按钮任务捕获到的异常是否是用户取消。 */
function isKnownCancelledTaskError(error: unknown): boolean {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true
  }

  if (!(error instanceof Error)) {
    return false
  }

  return error.name === 'AbortError' ||
    (error as { readonly code?: unknown }).code === 'PDF_EXPORT_CANCELLED' ||
    (error as { readonly code?: unknown }).code === 'DOCX_WORKER_CANCELLED'
}

/** 判断异常是否是授权诊断，避免 demo 触发未处理异常。 */
function isKnownLicenseDiagnosticError(error: unknown): boolean {
  if (!isObjectRecord(error)) {
    return false
  }

  return typeof error.code === 'string' && isJWordLicenseDiagnosticCode(error.code)
}

/** 写入状态文字。 */
function setStatus(message: string): void {
  statusHost.textContent = message
}

/** 切换主操作按钮忙碌状态。 */
function setBusy(isBusy: boolean): void {
  importButton.disabled = isBusy
  exportDocxButton.disabled = isBusy
  exportPdfButton.disabled = isBusy
  cancelTaskButton.disabled = !isBusy
}

/** 创建 pre 文本节点。 */
function createPre(text: string): HTMLPreElement {
  const pre = document.createElement('pre')

  pre.textContent = text

  return pre
}

/** 读取错误消息。 */
function readErrorMessage(error: unknown): string {
  if (isObjectRecord(error) && typeof error.code === 'string' && typeof error.message === 'string') {
    if (error.message.startsWith(`${error.code}:`)) {
      return error.message
    }

    return `${error.code}: ${error.message}`
  }

  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

/** 创建第三方集成形态的高级格式 runtime。 */
function createDocxDemoIntegrationRuntime(
  options: DocxDemoIntegrationOptions
): DocxDemoIntegrationRuntime {
  return {
    assertFeature(feature) {
      assertJWordFeatureEntitled(options.license, feature)
    },
    async importDocx(input, taskOptions) {
      assertJWordFeatureEntitled(options.license, taskOptions.feature)

      const { importDocx } = await loadDocxRuntime()

      return importDocx(input, {
        requestId: taskOptions.requestId,
        ...(taskOptions.signal === undefined ? {} : { signal: taskOptions.signal }),
        license: options.license
      })
    },
    async exportDocx(document, taskOptions) {
      assertJWordFeatureEntitled(options.license, taskOptions.feature)

      const { exportDocx } = await loadDocxRuntime()

      return exportDocx(document, {
        requestId: taskOptions.requestId,
        ...(taskOptions.signal === undefined ? {} : { signal: taskOptions.signal }),
        license: options.license
      })
    },
    async exportPdf(layout, taskOptions) {
      assertJWordFeatureEntitled(options.license, taskOptions.feature)

      const { exportPdfFromLayout } = await loadPdfRuntime()

      return exportPdfFromLayout(layout, {
        requestId: taskOptions.requestId,
        ...(taskOptions.signal === undefined ? {} : { signal: taskOptions.signal }),
        license: options.license,
        ...(taskOptions.onProgress === undefined ? {} : { onProgress: taskOptions.onProgress }),
        ...(taskOptions.onWarning === undefined ? {} : { onWarning: taskOptions.onWarning })
      })
    },
    async diffDocxRoundtrip(bytes, taskOptions) {
      assertJWordFeatureEntitled(options.license, taskOptions.feature)

      const { diffDocxRoundtrip } = await loadDocxRuntime()

      return diffDocxRoundtrip(bytes, {
        requestId: taskOptions.requestId,
        ...(taskOptions.signal === undefined ? {} : { signal: taskOptions.signal }),
        license: options.license
      })
    },
    async convertDocxImportDocumentToCoreDocument(document) {
      const { convertDocxImportDocumentToCoreDocument } = await loadDocxRuntime()

      return convertDocxImportDocumentToCoreDocument(document)
    }
  }
}

/** 读取 demo 查询参数里的授权状态。 */
function readDemoLicense(): JWordLicenseEntitlement | null {
  const mode = new URLSearchParams(window.location.search).get('license') ?? 'valid'

  if (mode === 'missing') {
    return null
  }

  if (mode === 'expired') {
    return createSignedDocxDemoLicense({
      customerId: 'customer-docx-demo',
      licenseToken: 'token-docx-demo',
      features: ['docx.import', 'docx.export', 'pdf.export'],
      issuer: 'jword-test-issuer',
      issuedAt: '2026-05-01T00:00:00Z',
      expiresAt: '2026-05-01T00:00:00Z',
      status: 'valid'
    })
  }

  if (mode === 'feature-mismatch') {
    return createSignedDocxDemoLicense({
      customerId: 'customer-docx-demo',
      licenseToken: 'token-docx-demo',
      features: ['docx.import'],
      issuer: 'jword-test-issuer',
      issuedAt: '2026-05-01T00:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
      status: 'valid'
    })
  }

  if (mode === 'server-unavailable') {
    return createSignedDocxDemoLicense({
      customerId: 'customer-docx-demo',
      licenseToken: 'token-docx-demo',
      features: ['docx.import', 'docx.export', 'pdf.export'],
      issuer: 'jword-test-issuer',
      issuedAt: '2026-05-01T00:00:00Z',
      expiresAt: '2026-06-01T00:00:00Z',
      status: 'server-unavailable'
    })
  }

  return createSignedDocxDemoLicense({
    customerId: 'customer-docx-demo',
    licenseToken: 'token-docx-demo',
    features: ['docx.import', 'docx.export', 'pdf.export'],
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-06-01T00:00:00Z',
    status: 'valid'
  })
}

/** 为 DOCX demo 创建带确定性签名的本地测试授权。 */
function createSignedDocxDemoLicense(
  entitlement: JWordLicenseSignaturePayload
): JWordLicenseEntitlement {
  return {
    ...entitlement,
    signature: createJWordLicenseSignature(entitlement)
  }
}

/** 按需加载 DOCX runtime，避免进入示例入口首个静态 chunk。 */
function loadDocxRuntime(): Promise<DocxRuntime> {
  docxRuntimePromise ??= import('@4xian/jword-docx')

  return docxRuntimePromise
}

/** 按需加载 PDF runtime，避免进入示例入口首个静态 chunk。 */
function loadPdfRuntime(): Promise<PdfRuntime> {
  pdfRuntimePromise ??= import('@4xian/jword-pdf')

  return pdfRuntimePromise
}

/** 释放当前 demo 创建的 Blob URL。 */
function revokeCurrentUrls(): void {
  if (currentDocxUrl !== null) {
    URL.revokeObjectURL(currentDocxUrl)
    currentDocxUrl = null
  }

  if (currentPdfUrl !== null) {
    URL.revokeObjectURL(currentPdfUrl)
    currentPdfUrl = null
  }
}

/** 查询必需 DOM 元素。 */
function requireElement<T extends HTMLElement>(selector: string, message: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) {
    throw new Error(message)
  }

  return element
}

/** 判断未知值是否是对象记录。 */
function isObjectRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}
