/**
 * 职责：封装 operation adapter 使用的 Y.Map/Y.Array 读写辅助函数。
 * 边界：不解释具体 operation 语义，只处理共享容器、属性 Map 和 JSON 兼容值。
 * 协作模块：operation-adapter 和后续 focused operation 模块复用这里的容器读写规则。
 * 性能/安全约束：不访问 DOM，不触发 transaction，只在调用方传入的 Yjs 容器上做同步变更。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import type { BlockRecord, DocumentStoreJson } from '../model/document-store'
import { DOCUMENT_STORE_FIELDS } from '../model/document-store'
import { createJWordError } from '../shared/errors'

export interface SharedMapReader {
  get(fieldName: string): unknown
}

export function setProperties(record: SharedMapReader, fieldName: string, properties: Readonly<Record<string, unknown>>): void {
  const target = readPropertyMap(record, fieldName)

  for (const [key, value] of Object.entries(properties)) {
    target.set(key, toDocumentStoreJson(value))
  }
}

export function replaceProperties(record: SharedMapReader, fieldName: string, properties: Readonly<Record<string, unknown>>): void {
  const target = readPropertyMap(record, fieldName)

  target.clear()

  for (const [key, value] of Object.entries(properties)) {
    target.set(key, toDocumentStoreJson(value))
  }
}

export function copyProperties(source: SharedMapReader, target: SharedMapReader, fieldName: string): void {
  const sourceProperties = readPropertyMap(source, fieldName)
  const targetProperties = readPropertyMap(target, fieldName)

  for (const [key, value] of sourceProperties.entries()) {
    targetProperties.set(key, value)
  }
}

export function createPropertyMap(properties: Readonly<Record<string, unknown>>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of Object.entries(properties)) {
    map.set(key, toDocumentStoreJson(value))
  }

  return map
}

export function readRequiredArray<Item>(record: SharedMapReader, fieldName: string, label: string): Y.Array<Item> {
  const value = record.get(fieldName)

  if (value instanceof Y.Array) {
    return value as Y.Array<Item>
  }

  throw createJWordError('DOCUMENT_STORE_ARRAY_CONTAINER_MISSING', `${label} 缺失`, {
    label
  })
}

export function appendIdIfMissing<Id extends string>(array: Y.Array<Id>, id: Id): void {
  if (!array.toArray().includes(id)) {
    array.push([id])
  }
}

export function removeId<Id extends string>(array: Y.Array<Id>, id: Id): void {
  const index = array.toArray().indexOf(id)

  if (index >= 0) {
    array.delete(index, 1)
  }
}

export function replaceStringArray(array: Y.Array<string>, values: readonly string[]): void {
  if (array.length > 0) {
    array.delete(0, array.length)
  }

  if (values.length > 0) {
    array.push([...values])
  }
}

export function clonePropertyMap(properties: Y.Map<DocumentStoreJson>): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  for (const [key, value] of properties.entries()) {
    map.set(key, value)
  }

  return map
}

export function readPropertyMap(record: SharedMapReader, fieldName: string): Y.Map<DocumentStoreJson> {
  const value = record.get(fieldName)

  if (value instanceof Y.Map) {
    return value as Y.Map<DocumentStoreJson>
  }

  throw createJWordError('OPERATION_PROPERTY_CONTAINER_MISSING', '属性容器缺失')
}

export function readRequiredString(record: SharedMapReader, fieldName: string): string {
  const value = record.get(fieldName)

  if (typeof value === 'string') {
    return value
  }

  throw createJWordError('OPERATION_STRING_FIELD_MISSING', '字符串字段缺失', {
    fieldName
  })
}

export function assertBlockKind(block: BlockRecord, kind: 'paragraph' | 'table'): void {
  if (block.get(DOCUMENT_STORE_FIELDS.block.kind) !== kind) {
    throw createJWordError('OPERATION_BLOCK_KIND_MISMATCH', `块类型不是 ${kind}`, {
      expectedKind: kind
    })
  }
}

function toDocumentStoreJson(value: unknown): DocumentStoreJson {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toDocumentStoreJson)
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => [
        key,
        toDocumentStoreJson(nestedValue)
      ])
    )
  }

  throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '属性值必须是 JSON 兼容数据')
}

