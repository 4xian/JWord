/**
 * 职责：装配 Gate 6 collab 第三方集成 demo，先创建基础 editor/UI，再按需加载高级协作 runtime。
 * 边界：只做 demo host 接线；高级协作、离线、历史和自动插入能力都通过懒加载 runtime 进入页面。
 * 协作模块：@4xian/jword-core、@4xian/jword-ui、createCollabDemoRuntime、examples/collab/tests 和 Vite dev server。
 * 性能/安全约束：基础 editor/UI 首屏可用，高级协作 runtime 只在 provider query 启用时按需加载。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 collaboration/auto-insert。
 */
import {
  createEditor,
  createEditorSharedDocument,
  createEditorWithSharedDocument,
  type DocumentProjection,
  type Editor,
  type EditorOptions,
  type EditorSharedDocument,
  type EditorTextLocation
} from '@4xian/jword-core'
import { createJWordUi } from '@4xian/jword-ui'
import {
  createInsecureTestOnlyJWordLicenseSignature,
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '@4xian/jword-license'
import {
  type CollabDemoDebugApi,
  type CollabDemoRuntime,
  type VersionHistoryEntry
} from './runtime'
import { createPresenceDisplayUsers } from './awareness-order'
import '@4xian/jword-ui/styles.css'
import './styles.css'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

const editorHost = requireElement<HTMLElement>('#jword-collab-editor', 'Collab demo requires #jword-collab-editor.')
const statusHost = requireElement<HTMLElement>('#jword-collab-status', 'Collab demo requires #jword-collab-status.')
const liveRegionHost = requireElement<HTMLElement>('#jword-collab-live-region', 'Collab demo requires #jword-collab-live-region.')
const assistiveMirrorHost = requireElement<HTMLElement>('#jword-collab-assistive-mirror', 'Collab demo requires #jword-collab-assistive-mirror.')
const appHost = requireElement<HTMLElement>('#jword-collab-app', 'Collab demo requires #jword-collab-app.')
const awarenessHost = requireElement<HTMLElement>('#jword-collab-awareness', 'Collab demo requires #jword-collab-awareness.')
const remotePresenceHost = requireElement<HTMLElement>('#jword-collab-remote-presence', 'Collab demo requires #jword-collab-remote-presence.')
const offlineHost = requireElement<HTMLElement>('#jword-collab-offline', 'Collab demo requires #jword-collab-offline.')
const historyHost = requireElement<HTMLElement>('#jword-collab-history', 'Collab demo requires #jword-collab-history.')
const historySelect = requireElement<HTMLSelectElement>('#jword-collab-history-select', 'Collab demo requires #jword-collab-history-select.')
const historyPreviewButton = requireElement<HTMLButtonElement>('#jword-collab-history-preview', 'Collab demo requires #jword-collab-history-preview.')
const historyRestoreButton = requireElement<HTMLButtonElement>('#jword-collab-history-restore', 'Collab demo requires #jword-collab-history-restore.')
const historyPreviewHost = requireElement<HTMLOutputElement>('#jword-collab-history-preview-text', 'Collab demo requires #jword-collab-history-preview-text.')
const autoHost = requireElement<HTMLElement>('#jword-collab-auto', 'Collab demo requires #jword-collab-auto.')
const disconnectButton = requireElement<HTMLButtonElement>('#jword-collab-disconnect', 'Collab demo requires #jword-collab-disconnect.')
const reconnectButton = requireElement<HTMLButtonElement>('#jword-collab-reconnect', 'Collab demo requires #jword-collab-reconnect.')
const autoStartButton = requireElement<HTMLButtonElement>('#jword-collab-auto-start', 'Collab demo requires #jword-collab-auto-start.')
const autoAbortButton = requireElement<HTMLButtonElement>('#jword-collab-auto-abort', 'Collab demo requires #jword-collab-auto-abort.')
const activeProviderClientId = readActiveProviderClientId()
let presenceExpiryTimer: number | null = null
const typingExpiresMs = 1200
const presenceOverlapOffsetPx = 6
const demoLicenseDurationMs = 30 * 24 * 60 * 60 * 1000
const integrationContext = readThirdPartyIntegrationContext()
const editorBundle = createDemoEditorBundle(integrationContext)

applyThirdPartyIntegrationAttributes(appHost, integrationContext)
editorBundle.editor.mount(editorHost)
const jwordUi = createJWordUi({
  editor: editorBundle.editor,
  editorHost,
  liveRegionHost,
  assistiveMirrorHost,
  user: {
    currentUser: integrationContext.user,
    resolveUser(authorId) {
      return authorId === integrationContext.user.id ? integrationContext.user : null
    }
  },
  comments: true,
  link: {
    openLink(url) {
      statusHost.textContent = `打开链接：${url}`
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  },
  headerFooter: {},
  headingOutline: {},
  findReplace: {},
  revisions: {}
})

void loadSelectedRuntime().then((runtime) => {
  mountCollabDemo(runtime)
}).catch((error: unknown) => {
  statusHost.textContent = 'failed'
  throw error
})

/** 按第三方集成模式创建可见 editor；provider 模式额外暴露共享文档给协作 SDK。 */
function createDemoEditorBundle(context: ThirdPartyIntegrationContext): DemoEditorBundle {
  const options = createDemoEditorOptions(context)

  if (context.providerMode === 'hocuspocus') {
    const sharedDocument = createEditorSharedDocument()

    return {
      editor: createEditorWithSharedDocument(sharedDocument, options),
      sharedDocument
    }
  }

  return {
    editor: createEditor(options)
  }
}

/** 创建 demo editor 的稳定选项，避免协作和非协作模式出现不同首屏行为。 */
function createDemoEditorOptions(context: ThirdPartyIntegrationContext): EditorOptions {
  const initialText = context.providerMode === 'hocuspocus'
    ? undefined
    : 'Gate 6 collaboration document'

  return {
    ...(initialText === undefined ? {} : { initialText }),
    currentUser: {
      id: context.user.id,
      displayName: context.user.name,
      color: context.user.color
    },
    layout: {
      keepLatinWordWholeOnWrap: true
    }
  }
}

/** 根据 URL query 选择内存 runtime 或真实 Hocuspocus runtime。 */
async function loadSelectedRuntime(): Promise<CollabDemoRuntime> {
  const parameters = new URLSearchParams(window.location.search)

  if (parameters.get('provider') !== 'hocuspocus') {
    const { loadCollabDemoRuntime } = await import('./lazy-runtime')

    return loadCollabDemoRuntime()
  }

  const webSocketUrl = parameters.get('ws')
  const roomId = parameters.get('room')
  const clientId = parameters.get('client')
  const offline = parameters.get('offline')
  const token = parameters.get('token')
  const historyApiUrl = parameters.get('history')
  if (webSocketUrl === null || roomId === null || !isCollabClientId(clientId)) {
    throw new Error('Hocuspocus demo requires ws, room and client query parameters.')
  }

  const { loadHocuspocusDemoRuntime } = await import('./lazy-runtime')
  const serverUrl = readCollaborationServerUrl(parameters, webSocketUrl)

  return loadHocuspocusDemoRuntime({
    webSocketUrl,
    roomId: integrationContext.roomId,
    clientId,
    serverUrl,
    documentId: integrationContext.documentId,
    editor: editorBundle.editor,
    sharedDocument: requireEditorSharedDocument(editorBundle),
    user: integrationContext.user,
    license: integrationContext.license,
    features: integrationContext.features,
    ...(offline === 'indexeddb' ? { offline: 'indexeddb' } : {}),
    ...(token === null ? {} : { token }),
    ...(historyApiUrl === null ? {} : { historyApiUrl })
  })
}

/** 读取 provider 模式必须持有的共享文档 token。 */
function requireEditorSharedDocument(bundle: DemoEditorBundle): EditorSharedDocument {
  if (bundle.sharedDocument === undefined) {
    throw new Error('Hocuspocus demo requires a shared editor document.')
  }

  return bundle.sharedDocument
}

/** 创建对外 debug API，隐藏订阅和销毁能力。 */
function createDebugApi(source: CollabDemoRuntime): CollabDemoDebugApi {
  return Object.freeze({
    focusEditor() {
      editorBundle.editor.focus()
    },
    readCollabState: source.readCollabState,
    readAwarenessState: source.readAwarenessState,
    readOfflineState: source.readOfflineState,
    readVersionHistory: source.readVersionHistory,
    readTextFormatRanges: source.readTextFormatRanges,
    readCommentRanges: source.readCommentRanges,
    startAutoInsert: source.startAutoInsert,
    abortAutoInsert: source.abortAutoInsert,
    retryAutoInsert: source.retryAutoInsert,
    simulateDisconnect: source.simulateDisconnect,
    simulateReconnect: source.simulateReconnect,
    undoLocalUserEdit: source.undoLocalUserEdit,
    formatClientRange: source.formatClientRange,
    addCommentRange: source.addCommentRange,
    importDocxForCollabAcceptance: source.importDocxForCollabAcceptance
  })
}

/** 装配已懒加载完成的 runtime、DOM 事件和卸载清理。 */
function mountCollabDemo(runtime: CollabDemoRuntime): void {
  window.__jwordCollabDemo = createDebugApi(runtime)

  disconnectButton.addEventListener('click', () => {
    runtime.simulateDisconnect()
  })
  reconnectButton.addEventListener('click', () => {
    runtime.simulateReconnect()
  })
  autoStartButton.addEventListener('click', () => {
    runtime.startAutoInsert()
  })
  autoAbortButton.addEventListener('click', () => {
    runtime.abortAutoInsert()
  })
  historyPreviewButton.addEventListener('click', () => {
    void Promise.resolve(runtime.previewVersion(historySelect.value)).then((preview) => {
      historyPreviewHost.textContent = preview?.text ?? ''
    })
  })
  historyRestoreButton.addEventListener('click', () => {
    void Promise.resolve(runtime.restoreVersion(historySelect.value)).then(() => {
      render(runtime)
    })
  })

  const unsubscribe = runtime.subscribe(() => {
    render(runtime)
  })
  const unsubscribeEditor = editorBundle.editor.subscribe((event) => {
    if (event.kind === 'transaction') {
      render(runtime)
      return
    }
    if (event.kind === 'selectionChange') {
      syncEditorSelectionToRuntime(runtime)
    }
  })

  render(runtime)

  window.addEventListener('beforeunload', () => {
    if (presenceExpiryTimer !== null) {
      window.clearTimeout(presenceExpiryTimer)
      presenceExpiryTimer = null
    }
    unsubscribe()
    unsubscribeEditor()
    runtime.destroy()
    jwordUi.destroy()
    editorBundle.editor.destroy()
  })
}

/** 把可见 editor 的 selection 发布给当前 provider client 的 awareness。 */
function syncEditorSelectionToRuntime(runtime: CollabDemoRuntime): void {
  const clientId = activeProviderClientId

  if (clientId === null) {
    return
  }

  const selection = readEditorSelectionOffsets(editorBundle.editor)

  if (selection === null) {
    return
  }

  runtime.updateClientSelection(clientId, selection.start, selection.end)
}

/** 刷新页面上所有 collab smoke 面板。 */
function render(runtime: CollabDemoRuntime): void {
  const collabState = runtime.readCollabState()
  const offlineState = runtime.readOfflineState()
  const history = runtime.readVersionHistory()

  statusHost.textContent = collabState.providerMode === 'hocuspocus'
    ? offlineState.lastEvent
    : offlineState.connected ? 'connected' : 'disconnected'
  const awarenessState = runtime.readAwarenessState()
  renderRemotePresence(awarenessState)
  awarenessHost.textContent = formatJson(awarenessState)
  offlineHost.textContent = formatJson(offlineState)
  syncHistorySelect(history)
  historyHost.textContent = formatJson(history)
  autoHost.textContent = formatJson(collabState.autoInsert)
  disconnectButton.disabled = !offlineState.connected
  reconnectButton.disabled = offlineState.connected
  autoStartButton.disabled = collabState.autoInsert.running
  autoAbortButton.disabled = !collabState.autoInsert.running
  schedulePresenceExpiryRender(runtime, awarenessState)
}

/** 渲染远端光标和远端选区的可见状态。 */
function renderRemotePresence(awarenessState: ReturnType<CollabDemoRuntime['readAwarenessState']>): void {
  remotePresenceHost.replaceChildren(...createPresenceDisplayUsers(awarenessState.users, {
    now: Date.now(),
    typingExpiresMs,
    overlapOffsetPx: presenceOverlapOffsetPx
  }).map((user) => {
    const item = document.createElement('div')
    const cursor = document.createElement('span')
    const selection = document.createElement('span')
    const selectionText = user.selectionStart === user.selectionEnd
      ? 'collapsed'
      : `${user.selectionStart}-${user.selectionEnd}`

    item.className = 'jw-collab-demo__presence-item'
    item.title = user.name
    item.setAttribute('role', 'listitem')
    cursor.className = 'jw-collab-demo__presence-cursor'
    cursor.dataset.jwordRemoteCursor = user.clientId
    cursor.style.borderColor = user.color
    cursor.style.transform = `translateX(${user.cursorOffsetPx}px)`
    cursor.title = user.cursorLabel
    cursor.setAttribute('aria-label', user.cursorLabel)
    cursor.textContent = user.cursorLabel
    selection.className = 'jw-collab-demo__presence-selection'
    selection.dataset.jwordRemoteSelection = user.clientId
    selection.style.backgroundColor = user.color
    selection.style.color = resolveReadableTextColor(user.color)
    selection.title = user.name
    selection.setAttribute('aria-label', `${user.name} 远端选区 ${selectionText}`)
    selection.textContent = `${user.name} selection ${selectionText}`
    item.append(cursor, selection)
    return item
  }))
}

/** 按背景色选择黑/白文字，保证远端选区标签尽量满足 WCAG AA。 */
function resolveReadableTextColor(backgroundColor: string): string {
  const background = parseHexColor(backgroundColor)

  if (background === null) {
    return '#ffffff'
  }

  const whiteContrast = calculateContrastRatio([255, 255, 255], background)
  const blackContrast = calculateContrastRatio([0, 0, 0], background)

  return blackContrast > whiteContrast ? '#000000' : '#ffffff'
}

/** 解析 demo 当前使用的十六进制色值。 */
function parseHexColor(color: string): readonly [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    return null
  }

  return [
    Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16),
    Number.parseInt(color.slice(5, 7), 16)
  ]
}

/** 计算两个 sRGB 颜色之间的 WCAG 对比度。 */
function calculateContrastRatio(
  foreground: readonly [number, number, number],
  background: readonly [number, number, number]
): number {
  const foregroundLuminance = calculateRelativeLuminance(foreground)
  const backgroundLuminance = calculateRelativeLuminance(background)
  const lighter = Math.max(foregroundLuminance, backgroundLuminance)
  const darker = Math.min(foregroundLuminance, backgroundLuminance)

  return (lighter + 0.05) / (darker + 0.05)
}

/** 计算 WCAG 相对亮度。 */
function calculateRelativeLuminance(color: readonly [number, number, number]): number {
  const [red, green, blue] = color.map((channel) => {
    const value = channel / 255

    return value <= 0.03928
      ? value / 12.92
      : ((value + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]

  return red * 0.2126 + green * 0.7152 + blue * 0.0722
}

/** 安排 typing 过期后的轻量重绘，避免 presence label 长时间停留。 */
function schedulePresenceExpiryRender(
  runtime: CollabDemoRuntime,
  awarenessState: ReturnType<CollabDemoRuntime['readAwarenessState']>
): void {
  if (presenceExpiryTimer !== null) {
    window.clearTimeout(presenceExpiryTimer)
    presenceExpiryTimer = null
  }

  const now = Date.now()
  const nextExpiry = awarenessState.users.reduce<number | null>((candidate, user) => {
    if (user.selectionLabel?.includes('正在输入') !== true || user.updatedAt === undefined) {
      return candidate
    }

    const expiry = user.updatedAt + typingExpiresMs

    if (expiry <= now) {
      return candidate
    }

    return candidate === null ? expiry : Math.min(candidate, expiry)
  }, null)

  if (nextExpiry === null) {
    return
  }

  presenceExpiryTimer = window.setTimeout(() => {
    presenceExpiryTimer = null
    render(runtime)
  }, Math.max(0, nextExpiry - now + 1))
}

/** 同步历史版本下拉菜单，保留当前选择。 */
function syncHistorySelect(history: readonly VersionHistoryEntry[]): void {
  const selectedValue = historySelect.value

  historySelect.replaceChildren(...history.map((entry) => {
    const option = document.createElement('option')
    option.value = entry.id
    option.textContent = `${entry.label} (${entry.id})`
    return option
  }))

  if (history.some((entry) => entry.id === selectedValue)) {
    historySelect.value = selectedValue
  }
}

/** 按选择器读取必需 DOM 节点。 */
function requireElement<T extends HTMLElement>(selector: string, message: string): T {
  const element = document.querySelector<T>(selector)

  if (element === null) {
    throw new Error(message)
  }

  return element
}

/** 判断 URL 中的 client 参数是否是 demo 支持的客户端。 */
function isCollabClientId(value: string | null): value is 'client-a' | 'client-b' | 'client-c' | 'client-d' | 'client-e' {
  return value === 'client-a' ||
    value === 'client-b' ||
    value === 'client-c' ||
    value === 'client-d' ||
    value === 'client-e'
}

/** 判断当前 URL 是否启用真实 provider 第三方集成模式。 */
function isHocuspocusProviderMode(parameters = new URLSearchParams(window.location.search)): boolean {
  return parameters.get('provider') === 'hocuspocus'
}

/** 读取 Hocuspocus 页面 URL 绑定的当前 client。 */
function readActiveProviderClientId(): string | null {
  const parameters = new URLSearchParams(window.location.search)
  const clientId = parameters.get('client')

  return isHocuspocusProviderMode(parameters) && isCollabClientId(clientId) ? clientId : null
}

/** 读取第三方宿主会传入高级协作 SDK 的稳定集成参数。 */
function readThirdPartyIntegrationContext(): ThirdPartyIntegrationContext {
  const parameters = new URLSearchParams(window.location.search)
  const userId = parameters.get('userId') ?? parameters.get('client') ?? 'client-a'
  const userName = parameters.get('userName') ?? readDefaultUserName(userId)
  const userColor = parameters.get('userColor') ?? readDefaultUserColor(userId)
  const features = readFeatureList(parameters.get('features'))
  const licenseToken = parameters.get('licenseToken') ?? 'collab-demo-license'
  const documentId = parameters.get('documentId') ?? 'jword-collab-browser-doc'

  return {
    providerMode: isHocuspocusProviderMode(parameters) ? 'hocuspocus' : 'memory',
    roomId: parameters.get('room') ?? documentId,
    documentId,
    serverUrl: readCollaborationServerUrl(parameters, parameters.get('ws')),
    user: {
      id: userId,
      name: userName,
      color: userColor
    },
    license: createDemoLicenseEntitlement({
      customerId: parameters.get('customerId') ?? 'collab-demo-customer',
      licenseToken,
      features
    }),
    features
  }
}

/** 创建 demo 宿主已从授权服务拿到的签名 entitlement。 */
function createDemoLicenseEntitlement(input: {
  readonly customerId: string
  readonly licenseToken: string
  readonly features: readonly DemoFeatureKey[]
}): JWordLicenseEntitlement {
  const issuedAt = new Date()
  const expiresAt = new Date(issuedAt.getTime() + demoLicenseDurationMs)
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: input.customerId,
    licenseToken: input.licenseToken,
    features: input.features,
    issuer: 'jword-demo-issuer',
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 把第三方集成身份写到宿主节点，供真实浏览器验收和外部排障读取。 */
function applyThirdPartyIntegrationAttributes(
  host: HTMLElement,
  context: ThirdPartyIntegrationContext
): void {
  host.dataset.jwordCollabRoomId = context.roomId
  host.dataset.jwordCollabDocumentId = context.documentId
  host.dataset.jwordCollabUserId = context.user.id
  host.dataset.jwordCollabServerUrl = context.serverUrl
}

/** 读取 URL 中的高级 feature 列表，未传时启用 demo 验收所需全功能。 */
function readFeatureList(value: string | null): readonly DemoFeatureKey[] {
  if (value === null || value.trim().length === 0) {
    return [
      'docx.import',
      'collaboration.multiplayer',
      'collaboration.offline',
      'collaboration.history',
      'collaboration.server',
      'automation.autoInsert'
    ]
  }

  return value.split(',')
    .map((feature) => feature.trim())
    .filter((feature): feature is DemoFeatureKey => isDemoFeatureKey(feature))
}

/** 判断 URL feature 是否属于 demo 支持的高级功能。 */
function isDemoFeatureKey(value: string): value is DemoFeatureKey {
  return value === 'docx.import' ||
    value === 'collaboration.multiplayer' ||
    value === 'collaboration.offline' ||
    value === 'collaboration.history' ||
    value === 'collaboration.server' ||
    value === 'automation.autoInsert'
}

/** 读取 demo 集成用户的默认显示名。 */
function readDefaultUserName(userId: string): string {
  if (userId === 'client-a') {
    return 'Client A'
  }
  if (userId === 'client-b') {
    return 'Client B'
  }

  return userId
}

/** 读取 demo 集成用户的默认颜色。 */
function readDefaultUserColor(userId: string): string {
  if (userId === 'client-b') {
    return '#0f8f6a'
  }

  return '#286fd6'
}

/** 从当前 editor selection 解析正文全局 offset。 */
function readEditorSelectionOffsets(editor: Editor): { readonly start: number, readonly end: number } | null {
  const snapshot = editor.readSelectionSnapshot()

  if (snapshot === null) {
    return null
  }

  const projection = editor.getProjection()
  const anchorOffset = findEditorLocationOffset(projection, snapshot.anchor.location)
  const focusOffset = findEditorLocationOffset(projection, snapshot.focus.location)

  if (anchorOffset === null || focusOffset === null) {
    return null
  }

  return {
    start: Math.min(anchorOffset, focusOffset),
    end: Math.max(anchorOffset, focusOffset)
  }
}

/** 把公开文本 location 映射到 demo 纯文本 offset。 */
function findEditorLocationOffset(
  projection: DocumentProjection,
  location: EditorTextLocation
): number | null {
  let offset = 0
  let paragraphSeen = false

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }
      if (paragraphSeen) {
        offset += 1
      }
      paragraphSeen = true
      for (const run of block.runs) {
        const text = run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
        const length = Array.from(text).length

        if (section.id === location.sectionId && block.id === location.blockId && run.id === location.runId) {
          return offset + Math.min(location.graphemeIndex, length)
        }
        offset += length
      }
    }
  }

  return null
}

/** 读取协作 SDK HTTP 服务地址；本地默认 ws 端口可自动推导 HTTP 端口。 */
function readCollaborationServerUrl(parameters: URLSearchParams, webSocketUrl: string | null): string {
  const explicitServerUrl = parameters.get('serverUrl') ?? parameters.get('history')

  if (explicitServerUrl !== null) {
    return explicitServerUrl
  }

  if (webSocketUrl === null) {
    return 'memory'
  }

  return inferLocalCollaborationServerUrl(webSocketUrl)
}

/** 从本地 Hocuspocus WebSocket 地址推导协作 SDK HTTP 握手地址。 */
function inferLocalCollaborationServerUrl(webSocketUrl: string): string {
  try {
    const url = new URL(webSocketUrl)

    if (url.protocol === 'ws:') {
      url.protocol = 'http:'
    } else if (url.protocol === 'wss:') {
      url.protocol = 'https:'
    }
    if ((url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.hostname === '::1') && url.port === '4188') {
      url.port = '4189'
    }
    url.pathname = ''
    url.search = ''
    url.hash = ''

    return url.toString()
  } catch {
    return webSocketUrl
  }
}

/** 格式化 debug 面板 JSON。 */
function formatJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

type DemoFeatureKey =
  | 'docx.import'
  | 'collaboration.multiplayer'
  | 'collaboration.offline'
  | 'collaboration.history'
  | 'collaboration.server'
  | 'automation.autoInsert'

interface ThirdPartyIntegrationContext {
  readonly providerMode: 'memory' | 'hocuspocus'
  readonly roomId: string
  readonly documentId: string
  readonly serverUrl: string
  readonly user: {
    readonly id: string
    readonly name: string
    readonly color: string
  }
  readonly license: {
    readonly customerId: string
    readonly licenseToken: string
    readonly features: readonly string[]
    readonly status?: 'valid' | 'server-unavailable'
    readonly signature?: string
  }
  readonly features: readonly DemoFeatureKey[]
}

interface DemoEditorBundle {
  readonly editor: Editor
  readonly sharedDocument?: EditorSharedDocument
}

declare global {
  interface Window {
    __jwordCollabDemo?: CollabDemoDebugApi
  }
}
