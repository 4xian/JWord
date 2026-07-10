/**
 * 职责：提供顶部工具栏与底部状态栏共享的视图状态读写。
 * 边界：只集中处理视图级缩放、全屏、演示和共享属性，不创建可见 DOM。
 * 协作模块：toolbar/controller 与 status-bar/controller 共同读写这些属性并监听变更事件。
 * 性能/安全约束：共享状态落在实例宿主与 editor facade 上，fit 计算只读取容器尺寸。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  twipsToCssPx,
  type Editor
} from '@4xian/jword-core'

export type JWordUiViewFitMode = 'width' | 'page' | null

export const JWORD_UI_VIEW_STATE_CHANGE_EVENT = 'jword-view-statechange'

export interface JWordUiViewZoomOptions {
  readonly minPercent: number
  readonly maxPercent: number
  readonly stepPercent: number
}

export interface CreateJWordUiViewControllerOptions {
  readonly editor: Editor
  readonly editorHost?: HTMLElement
  readonly fullscreenHost: HTMLElement
  readonly zoomOptions: JWordUiViewZoomOptions
  readonly presentationHosts?: readonly HTMLElement[]
  readonly presentationHiddenHosts?: readonly HTMLElement[]
  readonly presentationPeekHosts?: readonly HTMLElement[]
}

export interface ApplyJWordUiViewZoomOptions {
  readonly preserveFitMode?: boolean
}

export interface JWordUiViewControllerHandle {
  readonly stateHost: HTMLElement
  readonly fullscreenHost: HTMLElement
  readZoomPercent(): number
  applyZoomPercent(percent: number, options?: ApplyJWordUiViewZoomOptions): number
  applyZoomStep(direction: -1 | 1): number
  applyFitScale(mode: Exclude<JWordUiViewFitMode, null>): number | null
  readFitMode(): JWordUiViewFitMode
  readPresentation(): boolean
  writePresentation(active: boolean): boolean
  togglePresentation(): boolean
  syncPresentationAttributes(active?: boolean): void
  writePresentationPeek(visible: boolean): void
  readFullscreenAvailable(): boolean
  readFullscreenActive(): boolean
  toggleFullscreen(): Promise<boolean>
}

/** 创建 toolbar 与 status bar 共享的视图控制器。 */
export function createJWordUiViewController(
  options: CreateJWordUiViewControllerOptions
): JWordUiViewControllerHandle {
  const stateHost = options.fullscreenHost
  const presentationHosts = dedupeViewHosts([
    stateHost,
    ...(options.presentationHosts ?? [])
  ])
  const presentationHiddenHosts = dedupeViewHosts(options.presentationHiddenHosts ?? [])
  const presentationPeekHosts = dedupeViewHosts(options.presentationPeekHosts ?? presentationHiddenHosts)

  return {
    stateHost,
    fullscreenHost: options.fullscreenHost,
    /** 读取当前缩放百分比。 */
    readZoomPercent(): number {
      return readJWordUiZoomPercent(options.editor, options.zoomOptions)
    },
    /** 应用指定缩放百分比。 */
    applyZoomPercent(percent, applyOptions): number {
      return applyZoomPercent(percent, applyOptions)
    },
    /** 按配置步长缩放。 */
    applyZoomStep(direction): number {
      const currentPercent = readJWordUiZoomPercent(options.editor, options.zoomOptions)

      return applyZoomPercent(currentPercent + options.zoomOptions.stepPercent * direction)
    },
    /** 应用或取消指定自适应缩放模式。 */
    applyFitScale(mode): number | null {
      if (readJWordUiViewFitMode(stateHost) === mode) {
        return applyZoomPercent(100)
      }

      const rawScale = readFitScale(options.editor, options.editorHost ?? options.fullscreenHost, mode)

      if (rawScale === null) {
        return null
      }

      const nextPercent = writeZoomPercent(rawScale * 100, true, false)

      writeJWordUiViewFitMode(stateHost, mode)
      dispatchJWordUiViewStateChange(stateHost)

      return nextPercent
    },
    /** 读取当前自适应缩放模式。 */
    readFitMode(): JWordUiViewFitMode {
      return readJWordUiViewFitMode(stateHost)
    },
    /** 读取演示模式状态。 */
    readPresentation(): boolean {
      return readJWordUiPresentation(stateHost)
    },
    /** 写入演示模式状态。 */
    writePresentation(active): boolean {
      return writePresentationState(active)
    },
    /** 切换演示模式状态。 */
    togglePresentation(): boolean {
      return writePresentationState(!readJWordUiPresentation(stateHost))
    },
    /** 同步演示模式宿主属性。 */
    syncPresentationAttributes(active): void {
      syncPresentationAttributes(active)
    },
    /** 写入演示模式临时显示状态栏状态。 */
    writePresentationPeek(visible): void {
      writePresentationPeek(visible)
    },
    /** 读取全屏能力是否可用。 */
    readFullscreenAvailable(): boolean {
      return readJWordUiFullscreenAvailable(options.fullscreenHost)
    },
    /** 读取当前全屏状态。 */
    readFullscreenActive(): boolean {
      return readJWordUiFullscreenActive(options.fullscreenHost)
    },
    /** 切换全屏状态。 */
    async toggleFullscreen(): Promise<boolean> {
      if (!readJWordUiFullscreenAvailable(options.fullscreenHost)) {
        return readJWordUiFullscreenActive(options.fullscreenHost)
      }

      try {
        if (readJWordUiFullscreenActive(options.fullscreenHost)) {
          await options.fullscreenHost.ownerDocument.exitFullscreen?.()
        } else {
          await options.fullscreenHost.requestFullscreen?.()
        }
      } catch {
        return readJWordUiFullscreenActive(options.fullscreenHost)
      }

      dispatchJWordUiViewStateChange(stateHost)

      return readJWordUiFullscreenActive(options.fullscreenHost)
    }
  }

  /** 应用具体缩放百分比，并在必要时退出自适应模式。 */
  function applyZoomPercent(percent: number, applyOptions: ApplyJWordUiViewZoomOptions = {}): number {
    return writeZoomPercent(percent, applyOptions.preserveFitMode === true, true)
  }

  /** 写入缩放值并按需派发共享视图刷新事件。 */
  function writeZoomPercent(percent: number, preserveFitMode: boolean, emit: boolean): number {
    const nextPercent = clampJWordUiViewZoomPercent(percent, options.zoomOptions)

    if (!preserveFitMode) {
      writeJWordUiViewFitMode(stateHost, null)
    }

    options.editor.setPageConfig({
      scale: nextPercent / 100
    })

    if (emit) {
      dispatchJWordUiViewStateChange(stateHost)
    }

    return nextPercent
  }

  /** 写入演示模式状态并派发共享刷新事件。 */
  function writePresentationState(active: boolean): boolean {
    writeJWordUiPresentation(stateHost, active)
    syncPresentationAttributes(active)
    dispatchJWordUiViewStateChange(stateHost)

    return active
  }

  /** 同步演示模式属性到所有关联宿主。 */
  function syncPresentationAttributes(active = readJWordUiPresentation(stateHost)): void {
    const value = active ? 'true' : 'false'

    for (const host of presentationHosts) {
      host.setAttribute('data-jword-presentation', value)
    }

    syncPresentationHiddenAttributes(active)
    if (!active) {
      writePresentationPeek(false)
    }
  }

  /** 同步演示模式下应隐藏的宿主。 */
  function syncPresentationHiddenAttributes(active: boolean): void {
    for (const host of presentationHiddenHosts) {
      if (active) {
        host.setAttribute('data-jword-presentation-hidden', 'true')
        continue
      }

      host.removeAttribute('data-jword-presentation-hidden')
    }
  }

  /** 写入演示模式下状态栏临时显示属性。 */
  function writePresentationPeek(visible: boolean): void {
    const shouldShow = visible && readJWordUiPresentation(stateHost)

    for (const host of presentationPeekHosts) {
      if (shouldShow) {
        host.setAttribute('data-jword-presentation-peek', 'true')
        continue
      }

      host.removeAttribute('data-jword-presentation-peek')
    }
  }
}

/** 读取 editor 当前缩放百分比。 */
export function readJWordUiZoomPercent(editor: Editor, options: JWordUiViewZoomOptions): number {
  return clampJWordUiViewZoomPercent(editor.getPageConfig().scale * 100, options)
}

/** 把缩放百分比限制在 UI 允许范围内。 */
export function clampJWordUiViewZoomPercent(percent: number, options: JWordUiViewZoomOptions): number {
  const rounded = Math.round(percent)

  return Math.min(options.maxPercent, Math.max(options.minPercent, rounded))
}

/** 从共享宿主读取当前视图适应模式。 */
export function readJWordUiViewFitMode(host: HTMLElement): JWordUiViewFitMode {
  const value = host.getAttribute('data-jword-view-fit-mode')

  if (value === 'width' || value === 'page') {
    return value
  }

  return null
}

/** 写入当前视图适应模式。 */
export function writeJWordUiViewFitMode(host: HTMLElement, mode: JWordUiViewFitMode): void {
  if (mode === null) {
    host.removeAttribute('data-jword-view-fit-mode')
    return
  }

  host.setAttribute('data-jword-view-fit-mode', mode)
}

/** 从共享宿主读取演示模式状态。 */
export function readJWordUiPresentation(host: HTMLElement): boolean {
  return host.getAttribute('data-jword-presentation') === 'true'
}

/** 写入演示模式状态。 */
export function writeJWordUiPresentation(host: HTMLElement, active: boolean): void {
  host.setAttribute('data-jword-presentation', active ? 'true' : 'false')
}

/** 派发视图状态变更事件，供同一 UI 实例内其他控制器刷新。 */
export function dispatchJWordUiViewStateChange(host: HTMLElement): void {
  const EventCtor = host.ownerDocument.defaultView?.Event ?? Event

  host.dispatchEvent(new EventCtor(JWORD_UI_VIEW_STATE_CHANGE_EVENT, {
    bubbles: true
  }))
}

/** 判断全屏能力是否可用。 */
export function readJWordUiFullscreenAvailable(target: HTMLElement): boolean {
  return typeof target.requestFullscreen === 'function'
    && typeof target.ownerDocument.exitFullscreen === 'function'
}

/** 判断目标宿主当前是否处于全屏。 */
export function readJWordUiFullscreenActive(target: HTMLElement): boolean {
  return target.ownerDocument.fullscreenElement === target
}

/** 计算适应宽度或整页所需的 scale。 */
function readFitScale(editor: Editor, host: HTMLElement, mode: Exclude<JWordUiViewFitMode, null>): number | null {
  const container = readCanvasContainer(host)
  const pageConfig = editor.getPageConfig()
  const width = readElementSize(container, 'width')
  const height = readElementSize(container, 'height')
  const pageWidth = twipsToCssPx(pageConfig.widthTwips, 1)
  const pageHeight = twipsToCssPx(pageConfig.heightTwips, 1)

  if (container === null || pageWidth <= 0 || pageHeight <= 0) {
    return null
  }

  const widthScale = (width - 48) / pageWidth
  const rawScale = mode === 'width'
    ? widthScale
    : Math.min(widthScale, (height - 48) / pageHeight)

  if (!Number.isFinite(rawScale) || rawScale <= 0) {
    return null
  }

  return rawScale
}

/** 读取编辑器 canvas 滚动容器，缺失时回退宿主。 */
function readCanvasContainer(host: HTMLElement): HTMLElement | null {
  return host.querySelector<HTMLElement>('[data-jword-canvas-container]') ?? host
}

/** 读取元素可见宽高。 */
function readElementSize(element: HTMLElement | null, axis: 'width' | 'height'): number {
  if (element === null) {
    return 0
  }

  const rect = element.getBoundingClientRect()

  return axis === 'width'
    ? element.clientWidth || rect.width
    : element.clientHeight || rect.height
}

/** 对宿主列表去重并保持传入顺序。 */
function dedupeViewHosts(hosts: readonly HTMLElement[]): readonly HTMLElement[] {
  const result: HTMLElement[] = []

  for (const host of hosts) {
    if (result.includes(host)) {
      continue
    }

    result.push(host)
  }

  return result
}
