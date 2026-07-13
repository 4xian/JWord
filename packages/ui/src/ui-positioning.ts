/**
 * 职责：为覆盖式 UI 宿主提供共享的相对定位接管和引用计数清理。
 * 边界：只读写传入宿主的 position 行内样式，不创建任何业务 DOM。
 * 协作模块：左右工作区和 Toast 复用本模块，避免清理顺序互相覆盖。
 * 性能/安全约束：WeakMap 不延长宿主生命周期，最后一个使用方清理时恢复原值。
 * 实现说明：已有非空 position 保持不变，仅在空值时写入 relative。
 */

interface PositionedHostRecord {
  readonly host: HTMLElement
  readonly previousPosition: string
  refs: number
}

export interface PositionedUiHostHandle {
  cleanup(): void
}

const positionedHosts = new WeakMap<HTMLElement, PositionedHostRecord>()

/** 引用计数接管 UI 宿主定位。 */
export function acquirePositionedUiHost(host: HTMLElement): PositionedUiHostHandle {
  const existing = positionedHosts.get(host)

  if (existing !== undefined) {
    existing.refs += 1
    return createPositionCleanup(existing)
  }

  const record: PositionedHostRecord = {
    host,
    previousPosition: host.style.position,
    refs: 1
  }

  if (host.style.position.length === 0) {
    host.style.position = 'relative'
  }
  positionedHosts.set(host, record)

  return createPositionCleanup(record)
}

/** 为一次定位接管创建幂等释放函数。 */
function createPositionCleanup(record: PositionedHostRecord): PositionedUiHostHandle {
  let cleaned = false

  return {
    cleanup(): void {
      if (cleaned) {
        return
      }

      cleaned = true
      record.refs -= 1
      if (record.refs > 0) {
        return
      }

      record.host.style.position = record.previousPosition
      positionedHosts.delete(record.host)
    }
  }
}
