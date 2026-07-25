/**
 * 职责：创建并维护 JWord UI 的隐藏纯文本镜像，保留 Gate 3 的延迟同步与销毁清理语义。
 * 边界：只负责镜像 DOM、本地去重、延迟调度和清理，不决定业务文案，也不直接读取 editor 内部状态。
 * 协作模块：后续 createJWordUi 负责提供 readText 与 shouldDeferSync 回调，并在订阅事件里调用 sync。
 * 性能/安全约束：默认只保留一个延迟任务，大文档读全文延后到热路径之后；立即同步会先取消挂起任务。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export const DEFAULT_DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS = 40

export interface TextMirrorSyncOptions {
  readonly immediate?: boolean
}

export interface TextMirrorController {
  readonly host: HTMLElement
  readonly element: HTMLElement
  sync(options?: TextMirrorSyncOptions): void
  readText(): string
  destroy(): void
}

export interface CreateTextMirrorOptions {
  readonly host: HTMLElement
  readonly readText: () => string
  readonly shouldDeferSync?: () => boolean
  readonly syncDelayMs?: number
}

/**
 * 在指定宿主下创建隐藏文本镜像，并提供 Gate 3 兼容的同步控制。
 */
export function createTextMirror(options: CreateTextMirrorOptions): TextMirrorController {
  const ownerDocument = options.host.ownerDocument
  const element = ownerDocument.createElement('div')
  const syncDelayMs = options.syncDelayMs ?? DEFAULT_DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS
  let destroyed = false
  let lastText = ''
  let deferredSyncId: ReturnType<typeof setTimeout> | undefined

  configureTextMirrorElement(element)
  options.host.append(element)

  /**
   * 按当前文档规模选择立即或延迟同步；需要强制同步时可显式传 immediate。
   */
  function sync(syncOptions: TextMirrorSyncOptions = {}): void {
    if (destroyed) {
      return
    }

    if (syncOptions.immediate === true || !readShouldDeferSync(options)) {
      cancelDeferredSync()
      commitSync()
      return
    }

    scheduleDeferredSync()
  }

  /**
   * 读取最近一次已经写入 DOM 的纯文本快照。
   */
  function readText(): string {
    return lastText
  }

  /**
   * 取消挂起任务并移除镜像节点，避免销毁后继续读全文或写 DOM。
   */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    cancelDeferredSync()
    element.remove()
  }

  /**
   * 执行一次真实 DOM 同步，并跳过未变化的全文串联结果。
   */
  function commitSync(): void {
    const nextText = options.readText()

    if (nextText === lastText) {
      return
    }

    element.textContent = nextText
    lastText = nextText
  }

  /**
   * 为大文档只保留一个延迟同步任务，等热路径结束后再读全文。
   */
  function scheduleDeferredSync(): void {
    if (deferredSyncId !== undefined) {
      return
    }

    deferredSyncId = setTimeout(() => {
      deferredSyncId = undefined

      if (destroyed) {
        return
      }

      commitSync()
    }, syncDelayMs)
  }

  /**
   * 在切回立即同步或销毁前取消尚未执行的延迟任务。
   */
  function cancelDeferredSync(): void {
    if (deferredSyncId === undefined) {
      return
    }

    clearTimeout(deferredSyncId)
    deferredSyncId = undefined
  }

  return {
    host: options.host,
    element,
    sync,
    readText,
    destroy
  }
}

/**
 * 统一补齐 Gate 3 文本镜像节点的无障碍属性与隐藏样式。
 */
function configureTextMirrorElement(element: HTMLElement): void {
  element.setAttribute('data-jword-text-mirror', 'true')
  element.setAttribute('data-jword-ui-text-mirror', 'true')
  element.setAttribute('role', 'document')
  element.setAttribute('aria-label', 'JWord plain text mirror')
  applyVisuallyHiddenStyle(element)
}

/**
 * 用内联样式隐藏镜像节点，避免第一版抽离仍依赖 demo 专属 class。
 */
function applyVisuallyHiddenStyle(element: HTMLElement): void {
  element.style.position = 'absolute'
  element.style.left = '0'
  element.style.top = '0'
  element.style.width = '1px'
  element.style.height = '1px'
  element.style.padding = '0'
  element.style.margin = '-1px'
  element.style.overflow = 'hidden'
  element.style.clipPath = 'inset(50%)'
  element.style.whiteSpace = 'pre-wrap'
  element.style.border = '0'
}

/**
 * 读取组合层给出的延迟条件，默认按小文档即时同步处理。
 */
function readShouldDeferSync(options: CreateTextMirrorOptions): boolean {
  return options.shouldDeferSync?.() === true
}
