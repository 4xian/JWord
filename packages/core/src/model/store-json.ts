/**
 * 职责：提供 document-store 可写 JSON 值转换与结构化字段读取 helper。
 * 边界：不创建文档容器，不执行编辑命令，只处理 Y.Doc 字段的序列化形态。
 * 协作模块：记录工厂、批注记录和修订记录模块复用这里的 JSON 与读取规则。
 * 性能/安全约束：过滤 undefined 字段，拒绝非 JSON 兼容值，不访问 DOM 或网络。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import type { TextAnchorRecord, TextRangeRecord } from './position'

export type DocumentStoreJson =
  | string
  | number
  | boolean
  | null
  | readonly DocumentStoreJson[]
  | { readonly [key: string]: DocumentStoreJson }

/** 把未知值转换为可写入 document-store 的 JSON 兼容值。 */
export function toDocumentStoreJson(value: unknown): DocumentStoreJson {
  if (
    value === null
    || typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(toDocumentStoreJson)
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, toDocumentStoreJson(nestedValue)])
    )
  }

  throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', 'run 结构化数据必须是 JSON 兼容数据')
}

/** 判断未知值是否是普通记录对象。 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断未知值是否是 Y.RelativePosition 序列化后的 ID。 */
export function isRelativePositionId(value: unknown): value is {
  readonly client: number
  readonly clock: number
} {
  return isRecord(value)
    && typeof value.client === 'number'
    && typeof value.clock === 'number'
}

/** 把属性记录转换为 Y.Map。 */
export function createJsonMap(properties: Readonly<Record<string, unknown>> | undefined): Y.Map<DocumentStoreJson> {
  const map = new Y.Map<DocumentStoreJson>()

  if (properties === undefined) {
    return map
  }

  for (const [key, value] of Object.entries(properties)) {
    map.set(key, toDocumentStoreJson(value))
  }

  return map
}

/** 把 Y.Map 属性投影为冻结的只读普通对象。 */
export function projectProperties(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (!(value instanceof Y.Map) || value.size === 0) {
    return undefined
  }

  return Object.freeze(Object.fromEntries(value.entries()))
}

/** 安全读取可选 boolean 字段。 */
export function readOptionalBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

/** 安全读取可选 string 字段。 */
export function readOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** 读取必填字符串字段。 */
export function readString(value: unknown, label: string): string {
  if (typeof value === 'string') {
    return value
  }

  throw createJWordError('PROJECTION_INVALID_DOCUMENT', `${label} 缺少字符串值`, {
    label
  })
}

/** 读取持久化文本范围记录。 */
export function readTextRangeRecord(value: unknown, label: string): TextRangeRecord {
  if (
    !isRecord(value)
    || typeof value.id !== 'string'
    || value.anchor === undefined
    || value.focus === undefined
  ) {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', `${label} 结构非法`)
  }

  return {
    id: value.id,
    anchor: readTextAnchorRecord(value.anchor, `${label} anchor`),
    focus: readTextAnchorRecord(value.focus, `${label} focus`)
  }
}

/** 读取持久化文本锚点记录。 */
function readTextAnchorRecord(value: unknown, label: string): TextAnchorRecord {
  if (
    !isRecord(value)
    || typeof value.documentId !== 'string'
    || typeof value.sectionId !== 'string'
    || typeof value.blockId !== 'string'
    || typeof value.runId !== 'string'
    || typeof value.graphemeIndex !== 'number'
    || !isRecord(value.relativePosition)
  ) {
    throw createJWordError('PROJECTION_INVALID_DOCUMENT', `${label} 结构非法`)
  }

  return {
    documentId: value.documentId,
    sectionId: value.sectionId,
    blockId: value.blockId,
    runId: value.runId,
    graphemeIndex: value.graphemeIndex,
    ...(typeof value.assoc === 'number' ? { assoc: value.assoc } : {}),
    relativePosition: {
      ...(isRelativePositionId(value.relativePosition.type) ? { type: value.relativePosition.type } : {}),
      ...(typeof value.relativePosition.tname === 'string' ? { tname: value.relativePosition.tname } : {}),
      ...(isRelativePositionId(value.relativePosition.item) ? { item: value.relativePosition.item } : {}),
      ...(typeof value.relativePosition.assoc === 'number' ? { assoc: value.relativePosition.assoc } : {})
    }
  }
}
