/**
 * 职责：集中维护 Gate 6 awareness payload 的运行时 schema 校验。
 * 边界：只处理未知值到协作 awareness 类型的结构校验，不访问 provider、网络、DOM 或 Y.Doc。
 * 协作模块：packages/collab/src/index.ts 与 hocuspocus-adapter.ts 复用这些守卫保持 schema 一致。
 * 性能/安全约束：校验函数必须保持同步纯函数，避免 provider 事件路径引入副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  JWordAwarenessAnchor,
  JWordAwarenessCursor,
  JWordAwarenessRangeSnapshot,
  JWordAwarenessRelativePositionSnapshot,
  JWordAwarenessState,
  JWordAwarenessTextAnchorRecord,
  JWordAwarenessUser,
  JWordAwarenessViewport
} from './index.js'

// 判断未知值是否符合 awareness state 最小 schema。
export function isAwarenessState(value: unknown): value is JWordAwarenessState {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.clientId === 'string'
    && isAwarenessUser(value.user)
    && typeof value.updatedAt === 'number'
    && (value.cursor === undefined || isAwarenessCursor(value.cursor))
    && (value.rangeSnapshot === undefined || isAwarenessRangeSnapshot(value.rangeSnapshot))
    && (value.viewport === undefined || isAwarenessViewport(value.viewport))
    && (value.selectionLabel === undefined || typeof value.selectionLabel === 'string')
}

// 判断未知值是否具备可降级为 presence 的基础字段。
export function isAwarenessPresenceState(
  value: unknown
): value is Pick<JWordAwarenessState, 'clientId' | 'user' | 'updatedAt'> {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.clientId === 'string' &&
    isAwarenessUser(value.user) &&
    typeof value.updatedAt === 'number'
}

// 判断未知值是否符合 awareness user schema。
export function isAwarenessUser(value: unknown): value is JWordAwarenessUser {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && typeof value.name === 'string'
    && (value.color === undefined || typeof value.color === 'string')
    && (value.avatarUrl === undefined || typeof value.avatarUrl === 'string')
}

// 判断未知值是否符合 awareness cursor schema。
export function isAwarenessCursor(value: unknown): value is JWordAwarenessCursor {
  if (!isRecord(value)) {
    return false
  }

  return isAwarenessAnchor(value.anchor) && isAwarenessAnchor(value.focus)
}

// 判断未知值是否符合 awareness anchor schema。
export function isAwarenessAnchor(value: unknown): value is JWordAwarenessAnchor {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.blockId === 'string' && typeof value.offset === 'number'
}

// 判断未知值是否符合 JWord range snapshot schema。
export function isAwarenessRangeSnapshot(value: unknown): value is JWordAwarenessRangeSnapshot {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.id === 'string'
    && isAwarenessTextAnchorRecord(value.anchor)
    && isAwarenessTextAnchorRecord(value.focus)
}

// 判断未知值是否符合 JWord text anchor record schema。
export function isAwarenessTextAnchorRecord(value: unknown): value is JWordAwarenessTextAnchorRecord {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.documentId === 'string'
    && typeof value.sectionId === 'string'
    && typeof value.blockId === 'string'
    && typeof value.runId === 'string'
    && typeof value.graphemeIndex === 'number'
    && (value.assoc === undefined || typeof value.assoc === 'number')
    && isAwarenessRelativePositionSnapshot(value.relativePosition)
}

// 判断未知值是否符合 Yjs relative position JSON schema。
export function isAwarenessRelativePositionSnapshot(value: unknown): value is JWordAwarenessRelativePositionSnapshot {
  if (!isRecord(value)) {
    return false
  }

  return (value.type === undefined || isAwarenessRelativePositionId(value.type))
    && (value.tname === undefined || typeof value.tname === 'string')
    && (value.item === undefined || isAwarenessRelativePositionId(value.item))
    && (value.assoc === undefined || typeof value.assoc === 'number')
}

// 判断未知值是否符合 Yjs relative position id schema。
export function isAwarenessRelativePositionId(
  value: unknown
): value is { readonly client: number, readonly clock: number } {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.client === 'number' && typeof value.clock === 'number'
}

// 判断未知值是否符合 awareness viewport schema。
export function isAwarenessViewport(value: unknown): value is JWordAwarenessViewport {
  if (!isRecord(value)) {
    return false
  }

  return typeof value.pageIndex === 'number'
}

// 判断未知值是否是普通记录对象。
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
