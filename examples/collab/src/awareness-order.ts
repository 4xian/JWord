/**
 * 职责：提供 collab demo awareness 用户的稳定排序。
 * 边界：只处理只读快照数组，不读取 DOM、不访问 provider、不修改输入。
 * 协作：examples/collab/src/main.ts、runtime.ts 和 demo 契约测试。
 * 约束：保持 helper 纯函数，避免 main.ts 静态拉入完整 runtime 分片。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.3。
 */
import type { AwarenessUserSnapshot } from './runtime'

export interface PresenceDisplayUser extends AwarenessUserSnapshot {
  readonly cursorLabel: string
  readonly cursorOffsetPx: number
  readonly typing: boolean
}

export interface CreatePresenceDisplayUsersOptions {
  readonly now: number
  readonly typingExpiresMs: number
  readonly overlapOffsetPx: number
}

/** 按 clientId 返回稳定的新 awareness 用户列表。 */
export function sortAwarenessUsers(
  users: readonly AwarenessUserSnapshot[]
): readonly AwarenessUserSnapshot[] {
  return [...users].sort((left, right) => left.clientId.localeCompare(right.clientId))
}

/** 创建远端 presence 展示模型，补齐 typing label 和重叠错位。 */
export function createPresenceDisplayUsers(
  users: readonly AwarenessUserSnapshot[],
  options: CreatePresenceDisplayUsersOptions
): readonly PresenceDisplayUser[] {
  const overlapCounts = new Map<number, number>()

  return sortAwarenessUsers(users).map((user) => {
    const cursorOffset = user.cursorOffset
    const overlapIndex = overlapCounts.get(cursorOffset) ?? 0
    const typing = isTypingUser(user, options)
    const cursorLabel = typing
      ? user.selectionLabel ?? `${user.name} 正在输入`
      : `${user.name} cursor ${user.cursorOffset}`

    overlapCounts.set(cursorOffset, overlapIndex + 1)

    return {
      ...user,
      cursorLabel,
      cursorOffsetPx: overlapIndex * options.overlapOffsetPx,
      typing
    }
  })
}

/** 判断用户 typing 状态是否仍在有效展示窗口内。 */
function isTypingUser(
  user: AwarenessUserSnapshot,
  options: CreatePresenceDisplayUsersOptions
): boolean {
  if (user.selectionLabel?.includes('正在输入') !== true || user.updatedAt === undefined) {
    return false
  }

  return options.now - user.updatedAt <= options.typingExpiresMs
}
