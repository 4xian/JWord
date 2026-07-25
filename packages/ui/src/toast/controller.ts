/**
 * 职责：提供单实例、可替换、可定时关闭的 JWord 顶部 Toast。
 * 边界：只渲染已解析文案并同步 live region，不维护业务字典或编辑器状态。
 * 协作模块：ui-lifecycle 提供挂载宿主和 live region，公开实例转发 toast 调用。
 * 性能/安全约束：同一时刻最多一个节点，替换和销毁都会清理旧定时器。
 * 实现说明：duration 使用毫秒，小于等于零时保留到下一条消息或销毁。
 */
import type { LiveRegionController } from '../assistive/live-region'
import type { JWordToastOptions } from '../types'
import { acquirePositionedUiHost } from '../ui-positioning'
import type { JWordUiLogger } from '../debug/logger'

export interface ToastControllerHandle {
  readonly host: HTMLElement
  readonly root: HTMLElement
  toast(options: JWordToastOptions, context?: ToastLogContext): void
  destroy(): void
}

export interface CreateToastControllerOptions {
  readonly mount: HTMLElement
  readonly liveRegion: LiveRegionController
  readonly logger: JWordUiLogger
}

export interface ToastLogContext {
  readonly scope: string
  readonly event: string
}

/** 创建顶部 Toast controller。 */
export function createToastController(options: CreateToastControllerOptions): ToastControllerHandle {
  const positionHandle = acquirePositionedUiHost(options.mount)
  const host = options.mount.ownerDocument.createElement('div')
  const root = options.mount.ownerDocument.createElement('div')
  let timer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  host.className = 'jw-toast-host'
  host.setAttribute('data-jword-toast-host', 'true')
  root.className = 'jw-toast'
  root.setAttribute('data-jword-toast', 'true')
  root.hidden = true
  host.append(root)
  options.mount.append(host)

  /** 显示或替换当前 Toast。 */
  function toast(toastOptions: JWordToastOptions, context: ToastLogContext = {
    scope: 'toast',
    event: 'show'
  }): void {
    if (destroyed) {
      return
    }

    const replacing = !root.hidden

    clearTimer()
    root.textContent = toastOptions.message
    root.setAttribute('data-jword-toast-type', toastOptions.type)
    root.hidden = false
    options.liveRegion.announce(toastOptions.message, {
      force: true,
      priority: toastOptions.type === 'warning' || toastOptions.type === 'error' ? 'assertive' : 'polite',
      source: context.scope,
      event: context.event
    })
    options.logger.write({
      level: toastOptions.type === 'error'
        ? 'error'
        : toastOptions.type === 'warning' ? 'warning' : 'info',
      scope: 'toast',
      event: replacing ? 'replace' : 'show',
      message: toastOptions.message,
      details: {
        type: toastOptions.type,
        duration: toastOptions.duration,
        source: context.scope
      }
    })

    if (toastOptions.duration > 0) {
      timer = setTimeout(hide, toastOptions.duration)
    }
  }

  /** 隐藏当前 Toast 并清理定时器。 */
  function hide(): void {
    clearTimer()
    root.hidden = true
    root.textContent = ''
    root.removeAttribute('data-jword-toast-type')
    options.logger.write({
      level: 'debug',
      scope: 'toast',
      event: 'timeout',
      message: 'Toast 自动关闭。'
    })
  }

  /** 清理当前关闭定时器。 */
  function clearTimer(): void {
    if (timer === null) {
      return
    }

    clearTimeout(timer)
    timer = null
  }

  /** 销毁 Toast DOM 和定位接管。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    clearTimer()
    host.remove()
    positionHandle.cleanup()
  }

  return {
    host,
    root,
    toast,
    destroy
  }
}
