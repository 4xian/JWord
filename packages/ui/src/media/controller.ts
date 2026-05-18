/**
 * 职责：驱动 Gate 4 toolbar 内图片入口，连接上传适配器、URL 弹框和行内图片 command 对接点。
 * 边界：不实现上传协议或 core command builder 本体；这里只维护 UI 状态并调度宿主注入的命令适配器。
 * 协作模块：create-ui 负责装配，media dom 负责节点结构，宿主通过 media options 注入 adapter/commands。
 * 性能/安全约束：图片入口只保留行内插图，不再暴露块级模式或独立大面板。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */
import type { Editor } from '@4xian/jword-core'
import type {
  JWordMediaCommandAdapter,
  JWordMediaCommandResult,
  JWordMediaErrorState,
  JWordMediaOptions,
  JWordMediaPanelElements,
  JWordMediaResource,
  JWordMediaUploadFile,
  JWordMediaUploadSource,
  JWordUiLiveRegionController
} from '../types'
import {
  createMediaPanelDom,
  destroyMediaPanel,
  renderMediaPanel,
  resetMediaFileInput,
  type MediaPanelDom
} from './dom'
import { isAllowedJWordMediaUrl } from './policy'
import {
  applyMediaPanelFailure,
  applyMediaPanelProgress,
  applyMediaPanelUploadSuccess,
  createPendingMediaPanelItem,
  readDefaultDeferredMessage,
  readMediaSourceLabel,
  type MediaPanelItemState
} from './state'

interface CreateMediaControllerOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly media: JWordMediaOptions
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface MediaControllerHandle {
  readonly elements: JWordMediaPanelElements
  refresh(): void
  destroy(): void
}

/** 创建 Gate 4 toolbar 图片入口 controller。 */
export function createMediaController(options: CreateMediaControllerOptions): MediaControllerHandle {
  const dom = createMediaPanelDom(options.host, options.media.title ?? '图片')
  const adapter = options.media.adapter
  const commands = options.media.commands
  const liveRegion = options.assistive.liveRegion
  const signalController = new AbortController()
  let items: MediaPanelItemState[] = []
  let menuOpen = false
  let urlDialogOpen = false
  let urlDraft = ''
  let urlError = ''
  let busy = false
  let activeUrlItemId: string | null = null
  const unsubscribeEditor = options.editor.subscribe((event) => {
    if (event.kind !== 'destroyed') {
      return
    }

    menuOpen = false
    urlDialogOpen = false
    busy = false
    urlError = 'JWord editor 已销毁，无法继续插入图片。'
    refresh()
    liveRegion?.announce('JWord editor 已销毁，图片入口已关闭。', { force: true })
  })

  /** 统一触发 live region 播报。 */
  function announce(message: string): void {
    liveRegion?.announce(message, { force: true })
  }

  /** 用当前内存状态刷新 toolbar 图片入口。 */
  function refresh(): void {
    renderMediaPanel(dom, {
      menuOpen,
      urlDialogOpen,
      urlValue: urlDraft,
      urlError,
      busy
    })
  }

  /** 关闭下拉菜单。 */
  function closeMenu(): void {
    if (!menuOpen) {
      return
    }

    menuOpen = false
    refresh()
  }

  /** 关闭 URL 弹框并清空当前草稿。 */
  function closeUrlDialog(): void {
    if (busy) {
      return
    }

    urlDialogOpen = false
    urlDraft = ''
    urlError = ''
    activeUrlItemId = null
    refresh()
  }

  /** 打开 URL 弹框。 */
  function openUrlDialog(): void {
    menuOpen = false
    urlDialogOpen = true
    urlDraft = ''
    urlError = ''
    activeUrlItemId = null
    refresh()
    queueMicrotask(() => {
      dom.urlDialogInput.focus()
      dom.urlDialogInput.select()
    })
  }

  /** 根据 itemId 读取当前最新 item。 */
  function readItem(itemId: string): MediaPanelItemState | undefined {
    return items.find((item) => item.id === itemId)
  }

  /** 把最新 item 写回数组。 */
  function upsertItem(nextItem: MediaPanelItemState): void {
    const index = items.findIndex((item) => item.id === nextItem.id)

    if (index < 0) {
      items = [...items, nextItem]
      return
    }

    items = items.map((item) => item.id === nextItem.id ? nextItem : item)
  }

  /** 为 URL 提交创建或复用一个 item，保证 retry token 可复用。 */
  function prepareUrlItem(url: string): MediaPanelItemState {
    const source: JWordMediaUploadSource = {
      kind: 'url',
      url
    }
    const currentItem = activeUrlItemId === null ? undefined : readItem(activeUrlItemId)

    if (currentItem === undefined || currentItem.source.kind !== 'url' || currentItem.source.url !== url) {
      const nextItem = createPendingMediaPanelItem({
        source
      })

      activeUrlItemId = nextItem.id
      upsertItem(nextItem)

      return nextItem
    }

    const nextItem = applyMediaPanelProgress({
      ...currentItem,
      source
    }, {
      loaded: 0,
      total: 100
    })

    upsertItem(nextItem)

    return nextItem
  }

  /** 执行一次真实上传，并把结果写回当前 item。 */
  async function runUpload(item: MediaPanelItemState, source: JWordMediaUploadSource): Promise<void> {
    try {
      const request = buildMediaUploadRequest(item, source)
      const result = await adapter.upload(request, {
        onProgress: (progress) => {
          const currentItem = readItem(item.id)

          if (currentItem === undefined) {
            return
          }

          upsertItem(applyMediaPanelProgress(currentItem, progress))
        }
      })
      const commandResult = await applyMediaCommand(result.resource, commands, options.editor)
      const currentItem = readItem(item.id) ?? item
      const nextItem = applyMediaPanelUploadSuccess(currentItem, result.resource, commandResult)

      upsertItem(nextItem)
      busy = false

      if (source.kind === 'url' && activeUrlItemId === item.id) {
        urlDialogOpen = false
        urlDraft = ''
        urlError = ''
        activeUrlItemId = null
      }

      announce(`图片资源已就绪：${readMediaSourceLabel(source)}。`)
      refresh()
    } catch (error) {
      const normalizedError = normalizeMediaError(error)
      const currentItem = readItem(item.id) ?? item
      const nextItem = applyMediaPanelFailure(currentItem, normalizedError.error, normalizedError.retryToken)

      upsertItem(nextItem)
      busy = false

      if (source.kind === 'url' && activeUrlItemId === item.id) {
        urlDialogOpen = true
        urlDraft = source.url
        urlError = normalizedError.error.message
      }

      announce(`图片上传失败：${normalizedError.error.message}`)
      refresh()
    }
  }

  /** 提交当前文件输入。 */
  function submitSelectedFile(file: JWordMediaUploadFile): void {
    const pendingItem = createPendingMediaPanelItem({
      source: {
        kind: 'file',
        file
      }
    })

    upsertItem(pendingItem)
    busy = true
    announce(`图片上传已开始：${file.name}。`)
    refresh()
    void runUpload(pendingItem, pendingItem.source)
  }

  /** 提交当前 URL 输入。 */
  function submitCurrentUrl(): void {
    if (busy) {
      return
    }

    const url = dom.urlDialogInput.value.trim()

    urlDraft = url

    if (url.length === 0) {
      urlError = '请输入一个图片 URL。'
      announce(urlError)
      refresh()
      return
    }

    if (!isAllowedJWordMediaUrl(url, options.media.urlPolicy)) {
      urlError = '当前 URL 不在 allowlist 中；请改用同源、data:、blob: 或宿主放行的地址。'
      announce(urlError)
      refresh()
      return
    }

    const pendingItem = prepareUrlItem(url)

    busy = true
    urlError = ''
    announce(`图片上传已开始：${url}。`)
    refresh()
    void runUpload(pendingItem, pendingItem.source)
  }

  /** 当文件输入变化时立即按行内模式提交。 */
  function handleFileSelection(): void {
    const nextFile = dom.fileInput.files?.item(0)

    resetMediaFileInput(dom)
    closeMenu()

    if (nextFile === null || nextFile === undefined) {
      return
    }

    submitSelectedFile(nextFile)
  }

  /** 绑定 toolbar 级事件。 */
  function bindEvents(): void {
    dom.triggerButton.addEventListener('click', () => {
      if (busy) {
        return
      }

      menuOpen = !menuOpen
      refresh()
    }, { signal: signalController.signal })
    dom.fileActionButton.addEventListener('click', () => {
      if (busy) {
        return
      }

      closeMenu()
      dom.fileInput.click()
    }, { signal: signalController.signal })
    dom.urlActionButton.addEventListener('click', () => {
      if (busy) {
        return
      }

      openUrlDialog()
    }, { signal: signalController.signal })
    dom.fileInput.addEventListener('change', () => {
      handleFileSelection()
    }, { signal: signalController.signal })
    dom.urlDialogInput.addEventListener('input', () => {
      urlDraft = dom.urlDialogInput.value

      if (urlError.length > 0) {
        urlError = ''
      }

      refresh()
    }, { signal: signalController.signal })
    dom.urlDialogConfirmButton.addEventListener('click', () => {
      submitCurrentUrl()
    }, { signal: signalController.signal })
    dom.urlDialogCancelButton.addEventListener('click', () => {
      closeUrlDialog()
    }, { signal: signalController.signal })
    dom.urlDialog.addEventListener('click', (event) => {
      if (event.target === dom.urlDialog) {
        closeUrlDialog()
      }
    }, { signal: signalController.signal })
    document.addEventListener('pointerdown', (event) => {
      if (!(event.target instanceof Node) || dom.host.contains(event.target)) {
        return
      }

      closeMenu()
    }, { signal: signalController.signal })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') {
        return
      }

      if (urlDialogOpen) {
        closeUrlDialog()
        return
      }

      closeMenu()
    }, { signal: signalController.signal })
  }

  bindEvents()
  refresh()

  return {
    elements: dom,
    refresh,
    destroy(): void {
      signalController.abort()
      unsubscribeEditor()
      destroyMediaPanel(dom)
    }
  }
}

/** 图片入口当前只走行内图片 command。 */
async function applyMediaCommand(
  resource: JWordMediaResource,
  commands: JWordMediaCommandAdapter | undefined,
  editor: Editor
): Promise<JWordMediaCommandResult> {
  const projection = editor.getProjection()
  const selection = editor.getSelection()
  const target = commands?.resolveSelectedImageTarget?.(projection, selection) ?? null

  if (commands === undefined) {
    return {
      kind: 'deferred',
      message: readDefaultDeferredMessage()
    }
  }

  if (target !== null && commands.replaceSelectedImageResource !== undefined) {
    return await commands.replaceSelectedImageResource({
      editor,
      projection,
      selection,
      resource,
      target
    })
  }

  if (commands.insertInlineImage === undefined) {
    return {
      kind: 'deferred',
      message: readDefaultDeferredMessage()
    }
  }

  return await commands.insertInlineImage({
    editor,
    projection,
    selection,
    resource
  })
}

/** 把各种 throw 形状收敛成统一错误快照。 */
function normalizeMediaError(error: unknown): { readonly error: JWordMediaErrorState, readonly retryToken?: string } {
  if (isMediaErrorLike(error)) {
    const retryTokenPatch = error.retryToken === undefined
      ? {}
      : { retryToken: error.retryToken }

    return {
      error: {
        code: error.code,
        message: error.message
      },
      ...retryTokenPatch
    }
  }

  if (error instanceof Error) {
    return {
      error: {
        code: 'MEDIA_UPLOAD_FAILED',
        message: error.message
      }
    }
  }

  return {
    error: {
      code: 'MEDIA_UPLOAD_FAILED',
      message: '媒体上传失败。'
    }
  }
}

/** 判断 throw 的对象是否已经是媒体错误形状。 */
function isMediaErrorLike(
  error: unknown
): error is { readonly code: string, readonly message: string, readonly retryToken?: string } {
  return typeof error === 'object'
    && error !== null
    && typeof Reflect.get(error, 'code') === 'string'
    && typeof Reflect.get(error, 'message') === 'string'
}

/** 为 exactOptionalPropertyTypes 生成最小上传请求对象。 */
function buildMediaUploadRequest(
  item: MediaPanelItemState,
  source: JWordMediaUploadSource
): {
  readonly resourceId: string
  readonly source: JWordMediaUploadSource
  readonly previousResource?: JWordMediaResource
  readonly retryToken?: string
} {
  return {
    resourceId: item.resourceId,
    source,
    ...(item.resource === null ? {} : { previousResource: item.resource }),
    ...(item.retryToken === undefined ? {} : { retryToken: item.retryToken })
  }
}
