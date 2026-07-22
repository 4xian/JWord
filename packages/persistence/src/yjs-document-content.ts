/**
 * 职责：在隔离 Y.Doc 与目标 Y.Doc 之间无损复制顶层和嵌套 shared type 内容。
 * 边界：仅供 persistence 包内部 restore 使用，不负责 history 提交、公开导出或示例 provider 文档。
 * 协作模块：内存与 storage-backed persistence adapter 共用本模块，避免 clone 语义漂移。
 * 性能/安全约束：Y.Text 必须按 delta 复制 attributes，不能跨 Y.Doc 复用已挂载 shared type。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

type JWordYjsSharedType = Y.Doc['share'] extends Map<string, infer SharedType> ? SharedType : never
const restoreTargetOperationMarker = Symbol('jword-persistence-restore-operation')
type RestoreMarkedDocument = Y.Doc & { [restoreTargetOperationMarker]?: string }

/** 按目标 schema 重放当前历史，再在隔离文档中替换为 preview 内容。 */
export function prepareDocumentContent(
  targetDoc: Y.Doc,
  previewDoc: Y.Doc,
  historyUpdates: readonly Uint8Array[],
  origin: string
): Y.Doc {
  const preparedDoc = createEmptyDocumentWithSharedTypes(targetDoc)

  materializeMissingSharedTypes(preparedDoc, previewDoc)
  for (const update of historyUpdates) {
    Y.applyUpdate(preparedDoc, update)
  }
  replaceDocumentContent(preparedDoc, previewDoc, origin)
  return preparedDoc
}

/** 创建只包含相同顶层 shared type schema 的空 Y.Doc。 */
export function createEmptyDocumentWithSharedTypes(sourceDoc: Y.Doc): Y.Doc {
  const doc = new Y.Doc()

  materializeMissingSharedTypes(doc, sourceDoc)
  return doc
}

/** 在目标文档中按 source schema 创建尚不存在的顶层 shared type。 */
function materializeMissingSharedTypes(targetDoc: Y.Doc, sourceDoc: Y.Doc): void {
  for (const [name, sourceType] of sourceDoc.share) {
    if (targetDoc.share.has(name)) {
      continue
    }

    if (isYArray(sourceType)) {
      targetDoc.getArray(name)
      continue
    }

    if (isYMap(sourceType)) {
      targetDoc.getMap(name)
      continue
    }

    targetDoc.getText(name)
  }
}

/** 用 preview 文档的顶层共享类型替换目标文档的可见内容。 */
export function replaceDocumentContent(
  targetDoc: Y.Doc,
  previewDoc: Y.Doc,
  origin: string,
  operationId?: string
): void {
  /** 在单次 Y.Doc 事务内替换全部顶层 shared type 内容。 */
  targetDoc.transact(() => {
    for (const name of targetDoc.share.keys()) {
      const targetType = targetDoc.share.get(name)

      if (targetType !== undefined) {
        replaceSharedType(name, targetType, previewDoc)
      }
    }

    for (const [name, previewType] of previewDoc.share) {
      if (!targetDoc.share.has(name)) {
        createAndFillSharedType(targetDoc, previewDoc, name, previewType)
      }
    }

    if (operationId !== undefined) {
      markRestoreTargetApplied(targetDoc, operationId)
    }
  }, origin)
}

/** 标记 target 已在当前事务内应用指定 restore operation。 */
export function markRestoreTargetApplied(targetDoc: Y.Doc, operationId: string): void {
  const markedDocument = targetDoc as RestoreMarkedDocument

  markedDocument[restoreTargetOperationMarker] = operationId
}

/** 读取当前 target 的 package-private restore operation marker。 */
export function readRestoreTargetMarker(targetDoc: Y.Doc): string | undefined {
  const marker = (targetDoc as RestoreMarkedDocument)[restoreTargetOperationMarker]
  return typeof marker === 'string' ? marker : undefined
}

/** 在 finalize 或取消后清理匹配的 target operation marker。 */
export function clearRestoreTargetMarker(targetDoc: Y.Doc, operationId: string): void {
  if (readRestoreTargetMarker(targetDoc) === operationId) {
    delete (targetDoc as RestoreMarkedDocument)[restoreTargetOperationMarker]
  }
}

/** 按 preview 顶层 shared type 替换目标 shared type。 */
function replaceSharedType(name: string, targetType: JWordYjsSharedType, previewDoc: Y.Doc): void {
  if (isYText(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getText(name) : undefined

    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      applyTextDelta(targetType, previewType)
    }
    return
  }

  if (isYArray(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getArray(name) : undefined

    targetType.delete(0, targetType.length)
    if (previewType !== undefined) {
      targetType.insert(0, cloneArrayValues(previewType))
    }
    return
  }

  if (isYMap(targetType)) {
    const previewType = previewDoc.share.has(name) ? previewDoc.getMap(name) : undefined

    for (const key of Array.from(targetType.keys())) {
      targetType.delete(key)
    }
    if (previewType !== undefined) {
      for (const [key, value] of previewType) {
        targetType.set(key, cloneSharedValue(value))
      }
    }
  }
}

/** 创建目标文档缺失的顶层 shared type 并填充 preview 内容。 */
function createAndFillSharedType(
  targetDoc: Y.Doc,
  previewDoc: Y.Doc,
  name: string,
  previewType: JWordYjsSharedType
): void {
  if (isYText(previewType)) {
    applyTextDelta(targetDoc.getText(name), previewType)
    return
  }

  if (isYArray(previewType)) {
    targetDoc.getArray(name).insert(0, cloneArrayValues(previewType))
    return
  }

  if (isYMap(previewType)) {
    const target = targetDoc.getMap(name)

    for (const [key, value] of previewType) {
      target.set(key, cloneSharedValue(value))
    }
    return
  }

  applyTextDelta(targetDoc.getText(name), previewDoc.getText(name))
}

/** 把 source 的完整 delta 应用到空目标 Y.Text。 */
function applyTextDelta(target: Y.Text, source: Y.Text): void {
  const delta = source.toDelta()

  if (delta.length > 0) {
    target.applyDelta(delta)
  }
}

/** 递归克隆 Y.Array 内容，避免把已挂载的 preview 类型插入目标文档。 */
function cloneArrayValues(array: Y.Array<unknown>): unknown[] {
  return array.toArray().map(cloneSharedValue)
}

/** 递归克隆可嵌套的 Yjs shared type 或普通 JSON 值。 */
function cloneSharedValue(value: unknown): unknown {
  if (isYText(value)) {
    const cloned = new Y.Text()
    applyTextDelta(cloned, value)
    return cloned
  }

  if (isYArray(value)) {
    const cloned = new Y.Array<unknown>()
    const values = cloneArrayValues(value)

    if (values.length > 0) {
      cloned.insert(0, values)
    }

    return cloned
  }

  if (isYMap(value)) {
    const cloned = new Y.Map<unknown>()

    for (const [key, child] of value) {
      cloned.set(key, cloneSharedValue(child))
    }

    return cloned
  }

  return value
}

/** 判断共享类型是否按完整 Y.Text delta API 工作。 */
function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text || (
    typeof value === 'object'
    && value !== null
    && 'applyDelta' in value
    && 'delete' in value
    && 'length' in value
    && 'toDelta' in value
    && !('toArray' in value)
    && !('keys' in value)
  )
}

/** 判断共享类型是否按 Y.Array API 工作。 */
function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array || (
    typeof value === 'object'
    && value !== null
    && 'insert' in value
    && 'delete' in value
    && 'length' in value
    && 'toArray' in value
  )
}

/** 判断共享类型是否按 Y.Map API 工作。 */
function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map || (
    typeof value === 'object'
    && value !== null
    && 'set' in value
    && 'delete' in value
    && 'keys' in value
    && Symbol.iterator in value
  )
}
