/**
 * 职责：把 Y.Doc 逻辑内容编码为稳定快照，并提供 restore 提交后的内容一致性校验。
 * 边界：只处理 Yjs 公开逻辑值，不读取 client ID、clock、state vector 或 update 切分历史，也不导出到包根。
 * 协作模块：memory 与 storage-backed restore 用相同 hash 校验 prepared、committed 和 target 内容。
 * 性能/安全约束：不支持的值必须失败；二进制使用稳定 base64，普通对象与 attributes 按 key 排序。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'

import { hashSha256Bytes } from './sha256.js'
import {
  readRestoreTargetMarker,
  replaceDocumentContent
} from './yjs-document-content.js'

type CanonicalValue = readonly unknown[]

interface NormalizedTextInsert {
  insert: unknown
  attributes: readonly (readonly [string, CanonicalValue])[]
}

/** 计算不依赖 CRDT 历史的 Y.Doc 逻辑内容 SHA-256。 */
export function hashYjsLogicalContent(doc: Y.Doc): string {
  const sharedTypes = Array.from(doc.share)
    .sort(([left], [right]) => compareStrings(left, right))
    .map(([name, value]) => [name, encodeYjsValue(value, new WeakSet<object>())])
  const serialized = JSON.stringify(['document', sharedTypes])

  return hashSha256Bytes(new TextEncoder().encode(serialized))
}

/** 应用 prepared 内容；observer 抛错后仅在 target hash 已匹配时视为成功。 */
export function applyPreparedDocumentContent(
  targetDoc: Y.Doc,
  preparedDoc: Y.Doc,
  expectedHash: string,
  origin: string,
  operationId: string
): void {
  let applyError: unknown

  try {
    replaceDocumentContent(targetDoc, preparedDoc, origin, operationId)
  } catch (error) {
    applyError = error
  }

  if (
    hashYjsLogicalContent(targetDoc) === expectedHash
    && readRestoreTargetMarker(targetDoc) === operationId
  ) {
    return
  }

  if (applyError !== undefined) {
    throw applyError
  }

  throw new Error('恢复后的 target 逻辑内容与已提交状态不一致')
}

/** 递归编码 Yjs shared type 与受支持的普通值。 */
function encodeYjsValue(value: unknown, ancestors: WeakSet<object>): CanonicalValue {
  if (value instanceof Y.Text) {
    return ['text', encodeTextDelta(value, ancestors)]
  }

  if (value instanceof Y.Array) {
    return ['array', value.toArray().map((child) => encodeYjsValue(child, ancestors))]
  }

  if (value instanceof Y.Map) {
    return ['map', Array.from(value)
      .sort(([left], [right]) => compareStrings(left, right))
      .map(([key, child]) => [key, encodeYjsValue(child, ancestors)])]
  }

  if (value === null) {
    return ['null']
  }

  if (value === undefined) {
    return ['undefined']
  }

  if (typeof value === 'boolean') {
    return ['boolean', value]
  }

  if (typeof value === 'string') {
    return ['string', value]
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return ['number', value]
  }

  if (value instanceof Uint8Array) {
    return ['binary', encodeBase64(value)]
  }

  if (isPlainObject(value)) {
    return ['object', encodePlainObject(value, ancestors)]
  }

  throw new TypeError('Y.Doc 包含 canonical hash 不支持的值')
}

/** 归一化相邻且 attributes 相同的字符串 insert，消除编辑切分历史差异。 */
function encodeTextDelta(text: Y.Text, ancestors: WeakSet<object>): readonly CanonicalValue[] {
  const operations = text.toDelta() as readonly {
    readonly insert: unknown
    readonly attributes?: Record<string, unknown>
  }[]
  const normalized: NormalizedTextInsert[] = []

  for (const operation of operations) {
    const attributes = encodePlainObject(operation.attributes ?? {}, ancestors)
    const previous = normalized.at(-1)

    if (
      typeof operation.insert === 'string'
      && typeof previous?.insert === 'string'
      && JSON.stringify(previous.attributes) === JSON.stringify(attributes)
    ) {
      previous.insert += operation.insert
      continue
    }

    normalized.push({
      insert: operation.insert,
      attributes
    })
  }

  return normalized.map((operation) => [
    'insert',
    encodeYjsValue(operation.insert, ancestors),
    ['attributes', operation.attributes]
  ])
}

/** 按 key 排序并递归编码普通对象，同时拒绝循环引用。 */
function encodePlainObject(value: object, ancestors: WeakSet<object>): readonly (readonly [string, CanonicalValue])[] {
  if (ancestors.has(value)) {
    throw new TypeError('Y.Doc canonical hash 不支持循环对象')
  }

  ancestors.add(value)
  const encoded = Object.keys(value)
    .sort(compareStrings)
    .map((key) => [key, encodeYjsValue((value as Record<string, unknown>)[key], ancestors)] as const)
  ancestors.delete(value)
  return encoded
}

/** 判断值是否为可稳定枚举的普通对象。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

/** 按 UTF-16 code unit 提供不依赖 locale 的稳定字符串顺序。 */
function compareStrings(left: string, right: string): number {
  if (left < right) {
    return -1
  }
  if (left > right) {
    return 1
  }
  return 0
}

/** 将二进制编码为不依赖 Node API 的稳定 base64。 */
function encodeBase64(bytes: Uint8Array): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let encoded = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const block = (first << 16) | (second << 8) | third

    encoded += alphabet[(block >>> 18) & 63]
    encoded += alphabet[(block >>> 12) & 63]
    encoded += index + 1 < bytes.length ? alphabet[(block >>> 6) & 63] : '='
    encoded += index + 2 < bytes.length ? alphabet[block & 63] : '='
  }

  return encoded
}
