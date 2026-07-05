/**
 * 职责：提供 document-store 使用的 JSON 兼容值转换与记录类型判断。
 * 边界：不创建文档容器，不投影模型，只处理 Y.Doc 字段可写入的数据形态。
 * 协作模块：document-store 创建记录和读取结构化字段时复用这里的转换规则。
 * 性能/安全约束：过滤 undefined 字段，拒绝非 JSON 兼容值，不访问 DOM 或网络。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import * as Y from 'yjs'

import { createJWordError } from '../shared/errors'
import type { DocumentStoreJson } from './document-store'

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

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRelativePositionId(value: unknown): value is {
  readonly client: number
  readonly clock: number
} {
  return isRecord(value)
    && typeof value.client === 'number'
    && typeof value.clock === 'number'
}

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
