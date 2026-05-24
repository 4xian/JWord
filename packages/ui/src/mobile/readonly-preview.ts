/**
 * 职责：在移动 Web 上把已挂载 editor 转成只读分页预览。
 * 边界：不改 core 文档模型、不实现移动编辑，只在 UI 装配层拦截编辑事件。
 * 协作模块：create-ui 按配置创建这里，toolbar 控件和 editorHost 提供可访问 DOM。
 * 性能/安全约束：只在移动媒体查询命中时启用，销毁时恢复本模块写入的 DOM 状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-416。
 */
import { createJWordInteractionGuard } from '../readonly/interaction-guard'
import type { JWordInteractionGuard } from '../readonly/interaction-guard'
import type { JWordToolbarControlElement, JWordToolbarToolId, JWordUiLiveRegionController } from '../types'

export interface CreateMobileReadonlyPreviewOptions {
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>
  readonly interactionGuard?: JWordInteractionGuard
  readonly enabled?: boolean
  readonly maxWidthPx?: number
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface MobileReadonlyPreviewHandle {
  readonly active: boolean
  refresh(): void
  destroy(): void
}

const DEFAULT_MOBILE_MAX_WIDTH_PX = 640

/** 创建移动端只读分页预览控制器。 */
export function createMobileReadonlyPreview(options: CreateMobileReadonlyPreviewOptions): MobileReadonlyPreviewHandle {
  const canvasContainer = options.editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')
  const active = options.enabled === true && matchesMobileViewport(options.maxWidthPx ?? DEFAULT_MOBILE_MAX_WIDTH_PX)
  const previousCanvasCursor = canvasContainer?.style.cursor ?? ''
  const previousToolbarHidden = options.toolbarHost.hidden
  const ownsGuard = options.interactionGuard === undefined
  let interactionGuard: JWordInteractionGuard | null = null

  if (active) {
    applyReadonlyPreview(options, canvasContainer)
    interactionGuard = options.interactionGuard ?? createJWordInteractionGuard({
      editorHost: options.editorHost,
      toolbarHost: options.toolbarHost,
      controls: options.controls,
      readonly: {
        enabled: true
      },
      assistive: options.assistive
    })
  }

  return {
    active,
    refresh(): void {
      if (active) {
        disableToolbarControls(options.controls)
      }
    },
    destroy(): void {
      if (ownsGuard) {
        interactionGuard?.destroy()
      }

      if (!active) {
        return
      }

      options.editorHost.removeAttribute('data-jword-mobile-readonly-preview')
      canvasContainer?.removeAttribute('data-jword-mobile-readonly-preview')
      canvasContainer?.setAttribute('aria-readonly', 'false')
      options.toolbarHost.hidden = previousToolbarHidden

      if (canvasContainer !== null && canvasContainer !== undefined) {
        canvasContainer.style.cursor = previousCanvasCursor
      }
    }
  }
}

/** 应用移动只读预览 DOM 状态。 */
function applyReadonlyPreview(
  options: CreateMobileReadonlyPreviewOptions,
  canvasContainer: HTMLElement | null
): void {
  options.editorHost.setAttribute('data-jword-mobile-readonly-preview', 'true')

  if (canvasContainer !== null) {
    canvasContainer.setAttribute('data-jword-mobile-readonly-preview', 'true')
    canvasContainer.setAttribute('aria-readonly', 'true')
    canvasContainer.style.cursor = 'default'
  }
}

/** 禁用 toolbar 控件，避免移动只读模式暴露完整编辑入口。 */
function disableToolbarControls(controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>): void {
  for (const control of Object.values(controls)) {
    if (control !== undefined) {
      control.disabled = true
    }
  }
}

/** 判断当前视口是否命中移动预览范围。 */
function matchesMobileViewport(maxWidthPx: number): boolean {
  if (typeof window.matchMedia === 'function') {
    return window.matchMedia(`(max-width: ${maxWidthPx}px)`).matches
  }

  return window.innerWidth <= maxWidthPx
}
