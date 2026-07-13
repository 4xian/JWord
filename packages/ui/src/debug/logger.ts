/**
 * 职责：提供 JWord UI 实例级、可关闭、可替换接收器的结构化调试日志。
 * 边界：只过滤和转发日志 entry，不读取 editor、DOM 或业务状态。
 * 协作模块：ui-lifecycle、Toast 和 live region 通过本模块统一输出来源与事件。
 * 性能/安全约束：默认关闭；调用方不得把正文、选区文本、token 或完整 URL 放入 details。
 * 实现说明：未提供自定义 logger 时使用带稳定前缀的 console adapter。
 */
import type {
  JWordDebugOptions,
  JWordLogEntry,
  JWordLogger
} from '../types'

export interface JWordUiLogger {
  readonly enabled: boolean
  write(entry: JWordLogEntry): void
}

/** 根据公开 debug 配置创建实例级日志入口。 */
export function createJWordUiLogger(debug: boolean | JWordDebugOptions | undefined): JWordUiLogger {
  const enabled = debug === true || (typeof debug === 'object' && debug.enabled === true)
  const logger = typeof debug === 'object' && debug.logger !== undefined
    ? debug.logger
    : createConsoleLogger()

  return {
    enabled,
    /** 仅在 debug 开启时把结构化日志写入目标 adapter。 */
    write(entry): void {
      if (!enabled) {
        return
      }

      logger.write(entry)
    }
  }
}

/** 创建使用浏览器 console 的默认日志 adapter。 */
function createConsoleLogger(): JWordLogger {
  return {
    write(entry): void {
      const message = `[JWord][${entry.scope}][${entry.event}] ${entry.message}`
      const args = entry.details === undefined ? [message] : [message, entry.details]

      switch (entry.level) {
        case 'debug':
          console.debug(...args)
          return
        case 'info':
          console.info(...args)
          return
        case 'warning':
          console.warn(...args)
          return
        case 'error':
          console.error(...args)
      }
    }
  }
}
