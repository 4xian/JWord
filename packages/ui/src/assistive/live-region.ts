/**
 * 职责：封装 JWord UI 的外部 live region 宿主绑定与播报去重。
 * 边界：只管理宿主元素属性、最近一次播报文案和销毁态，不生成业务文案，也不订阅 editor。
 * 协作模块：后续 createJWordUi 负责在 selection、transaction、destroy 生命周期里调用这里的 announce。
 * 性能/安全约束：不在顶层访问 DOM，只在调用 createLiveRegion 时写入传入宿主，重复文案默认去重避免刷屏。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export interface LiveRegionAnnounceOptions {
  readonly force?: boolean
  readonly priority?: 'polite' | 'assertive'
  readonly source?: string
  readonly event?: string
}

export interface LiveRegionController {
  readonly host: HTMLElement | null
  announce(message: string, options?: LiveRegionAnnounceOptions): void
  readMessage(): string
  destroy(): void
}

export interface CreateLiveRegionOptions {
  readonly host: HTMLElement | null
  readonly onAnnounce?: (
    message: string,
    options: LiveRegionAnnounceOptions,
    priority: 'polite' | 'assertive'
  ) => void
}

/**
 * 绑定外部状态区宿主，提供最小 live region 去重播报能力。
 */
export function createLiveRegion(options: CreateLiveRegionOptions): LiveRegionController {
  let destroyed = false
  let lastMessage = ''

  configureLiveRegionHost(options.host)

  /**
   * 把新文案写入 live region，默认跳过连续重复文案。
   */
  function announce(message: string, announceOptions: LiveRegionAnnounceOptions = {}): void {
    if (destroyed) {
      return
    }

    if (!announceOptions.force && message === lastMessage) {
      return
    }

    lastMessage = message
    const priority = resolveLiveRegionPriority(message, announceOptions)

    if (options.host !== null) {
      options.host.setAttribute('aria-live', priority)
      options.host.textContent = message
    }
    options.onAnnounce?.(message, announceOptions, priority)
  }

  /**
   * 暴露最近一次已接收的播报文案，便于组合层调试或复用。
   */
  function readMessage(): string {
    return lastMessage
  }

  /**
   * 停止后续播报，避免 editor 已销毁后继续写宿主状态区。
   */
  function destroy(): void {
    destroyed = true
    lastMessage = ''

    if (options.host !== null) {
      options.host.textContent = ''
    }
  }

  return {
    host: options.host,
    announce,
    readMessage,
    destroy
  }
}

/**
 * 统一补齐 Gate 3 已验证的 live region 宿主属性。
 */
function configureLiveRegionHost(host: HTMLElement | null): void {
  if (host === null) {
    return
  }

  host.setAttribute('data-jword-live-region', 'true')
  host.setAttribute('aria-live', 'polite')
  host.setAttribute('role', 'status')
}


/** 推断公告优先级，阻断和错误类文案默认走 assertive。 */
function resolveLiveRegionPriority(
  message: string,
  options: LiveRegionAnnounceOptions
): 'polite' | 'assertive' {
  if (options.priority !== undefined) {
    return options.priority
  }

  return message.startsWith('BLOCKED:') || message.includes('失败') || message.includes('错误')
    ? 'assertive'
    : 'polite'
}
