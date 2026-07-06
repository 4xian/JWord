/**
 * 职责：封装 mounted runtime 的延迟视觉任务调度与取消。
 * 边界：只处理 requestAnimationFrame/timeout 选择，不执行 layout、render 或 DOM 同步。
 * 协作模块：pointer runtime、layout runtime 和 mounted editor DOM。
 * 性能/安全约束：顶层不读取浏览器全局对象，仅在已挂载 DOM 的 ownerDocument 上读取 rAF。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */

import type { DeferredVisualTaskHandle, MountedEditorDom } from './types'

/** 用浏览器绘制帧调度延迟视觉任务，非浏览器测试环境回退到 timeout。 */
export function scheduleDeferredVisualTask(
  mountedDom: MountedEditorDom,
  callback: () => void
): DeferredVisualTaskHandle {
  const view = mountedDom.canvasContainer.ownerDocument.defaultView

  if (view !== null && typeof view.requestAnimationFrame === 'function') {
    return {
      kind: 'animationFrame',
      view,
      frameId: view.requestAnimationFrame(() => {
        callback()
      })
    }
  }

  return {
    kind: 'timeout',
    timeoutId: setTimeout(callback, 0)
  }
}

/** 取消由 scheduleDeferredVisualTask 建立的延迟视觉任务。 */
export function cancelDeferredVisualTask(handle: DeferredVisualTaskHandle): void {
  if (handle.kind === 'animationFrame') {
    handle.view.cancelAnimationFrame(handle.frameId)
    return
  }

  clearTimeout(handle.timeoutId)
}
