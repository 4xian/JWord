/**
 * 职责：解析 JWL2 token envelope，生成固定签名输入并校验最小 claims。
 * 边界：本文件不选择生产 key、不执行 Ed25519 验签、不生成 opaque handle。
 * 协作模块：LIC-103 使用 envelope 的 issuer/keyId 查 trust store 后再验签；LIC-104 负责时间关系。
 * 性能/安全约束：拒绝非规范 base64url、未知字段、重复/乱序 feature、未知 class 和非 canonical payload。
 * 实现说明：解析分为 envelope 与 claims 两步，以保留“先 trust hint、后验签、再完整 claims”的调用顺序。
 */

import {
  decodeBase64Url,
  decodeUtf8,
  encodeBase64Url,
  encodeUtf8
} from './crypto.js'
import { JWORD_FEATURES } from './features.js'
import type { JWordFeature } from './features.js'

/** JWL2 原始签名 token。 */
export type JWordLicenseToken = string

export type JWordLicenseClass =
  | 'evaluation'
  | 'nonProduction'
  | 'production'
  | 'disasterRecovery'

export interface JWordLicenseClaimsV2 {
  readonly schemaVersion: 2
  readonly licenseId: string
  readonly issuer: string
  readonly keyId: string
  readonly licenseClass: JWordLicenseClass
  readonly features: readonly JWordFeature[]
  readonly issuedAt: string
  readonly subscriptionEndsAt?: string
  readonly expiresAt: string
}

export interface JWordLicenseTokenEnvelope {
  readonly payloadSegment: string
  readonly payloadBytes: Uint8Array
  readonly payloadJson: string
  readonly issuer: string
  readonly keyId: string
  readonly signature: Uint8Array
  readonly signingInput: Uint8Array
}

export const JWORD_LICENSE_TOKEN_MAX_BYTES = 16 * 1024
export const JWORD_LICENSE_PAYLOAD_MAX_BYTES = 8 * 1024
export const JWORD_LICENSE_SIGNATURE_BYTES = 64

const JWORD_LICENSE_TOKEN_VERSION = 'JWL2'
const JWORD_LICENSE_SCHEMA_VERSION = 2
const JWORD_LICENSE_ISSUER = 'jword'
const JWORD_LICENSE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u
const JWORD_LICENSE_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/u
const JWORD_LICENSE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const JWORD_LICENSE_SURROGATE_PATTERN = /[\uD800-\uDFFF]/u
const JWORD_LICENSE_CLASSES = new Set<JWordLicenseClass>([
  'evaluation',
  'nonProduction',
  'production',
  'disasterRecovery'
])
const JWORD_LICENSE_FEATURE_VALUES = new Set<string>(Object.values(JWORD_FEATURES))
const JWORD_LICENSE_CLAIM_KEYS = new Set([
  'schemaVersion',
  'licenseId',
  'issuer',
  'keyId',
  'licenseClass',
  'features',
  'issuedAt',
  'subscriptionEndsAt',
  'expiresAt'
])
const JWORD_LICENSE_REQUIRED_CLAIM_KEYS = [
  'schemaVersion',
  'licenseId',
  'issuer',
  'keyId',
  'licenseClass',
  'features',
  'issuedAt',
  'expiresAt'
] as const

/** 解析 JWL2 envelope，并保留验签所需的原始 payload bytes。 */
export function parseJWordLicenseToken(token: JWordLicenseToken): JWordLicenseTokenEnvelope {
  try {
    if (token.length === 0 || token.length > JWORD_LICENSE_TOKEN_MAX_BYTES) {
      throw new Error('invalid token length')
    }

    const parts = token.split('.')
    if (parts.length !== 3 || parts[0] !== JWORD_LICENSE_TOKEN_VERSION) {
      throw new Error('invalid token segments')
    }

    const payloadSegment = parts[1]
    const signatureSegment = parts[2]
    if (payloadSegment === undefined || signatureSegment === undefined) {
      throw new Error('missing token segment')
    }

    const payloadBytes = decodeCanonicalBase64Url(payloadSegment)
    if (payloadBytes.length === 0 || payloadBytes.length > JWORD_LICENSE_PAYLOAD_MAX_BYTES) {
      throw new Error('invalid payload length')
    }

    const signature = decodeCanonicalBase64Url(signatureSegment)
    if (signature.length !== JWORD_LICENSE_SIGNATURE_BYTES) {
      throw new Error('invalid signature length')
    }

    const payloadJson = decodeUtf8(payloadBytes)
    if (
      JWORD_LICENSE_SURROGATE_PATTERN.test(payloadJson) ||
      !areBytesEqual(payloadBytes, encodeUtf8(payloadJson))
    ) {
      throw new Error('invalid UTF-8 payload')
    }
    const value: unknown = JSON.parse(payloadJson)
    if (!isRecord(value)) {
      throw new Error('payload must be an object')
    }
    assertNoDuplicateTopLevelKeys(payloadJson)

    readSchemaVersion(value.schemaVersion)
    const issuer = readIdentifier(value.issuer, JWORD_LICENSE_KEY_PATTERN)
    const keyId = readIdentifier(value.keyId, JWORD_LICENSE_KEY_PATTERN)

    return Object.freeze({
      payloadSegment,
      payloadBytes,
      payloadJson,
      issuer,
      keyId,
      signature,
      signingInput: createJWordLicenseSigningInput(payloadSegment)
    })
  } catch {
    throw new Error('Invalid JWL2 token')
  }
}

/** 在已完成 envelope 解析的基础上严格读取最小 claims。 */
export function parseJWordLicenseClaims(
  envelope: JWordLicenseTokenEnvelope
): JWordLicenseClaimsV2 {
  try {
    const value: unknown = JSON.parse(envelope.payloadJson)
    if (!isRecord(value)) {
      throw new Error('payload must be an object')
    }
    assertNoDuplicateTopLevelKeys(envelope.payloadJson)

    for (const key of Object.keys(value)) {
      if (!JWORD_LICENSE_CLAIM_KEYS.has(key)) {
        throw new Error('unknown claim')
      }
    }

    for (const key of JWORD_LICENSE_REQUIRED_CLAIM_KEYS) {
      if (!hasOwn(value, key)) {
        throw new Error('missing claim')
      }
    }

    const schemaVersion = readSchemaVersion(value.schemaVersion)
    const licenseId = readIdentifier(value.licenseId, JWORD_LICENSE_ID_PATTERN)
    const issuer = readIdentifier(value.issuer, JWORD_LICENSE_KEY_PATTERN)
    if (issuer !== JWORD_LICENSE_ISSUER) {
      throw new Error('unsupported issuer')
    }

    const keyId = readIdentifier(value.keyId, JWORD_LICENSE_KEY_PATTERN)
    const licenseClass = readLicenseClass(value.licenseClass)
    const features = readFeatures(value.features)
    const issuedAt = readCanonicalUtcTime(value.issuedAt)
    const expiresAt = readCanonicalUtcTime(value.expiresAt)
    const subscriptionEndsAt = value.subscriptionEndsAt === undefined
      ? undefined
      : readCanonicalUtcTime(value.subscriptionEndsAt)

    const claims: JWordLicenseClaimsV2 = subscriptionEndsAt === undefined
      ? {
          schemaVersion,
          licenseId,
          issuer,
          keyId,
          licenseClass,
          features,
          issuedAt,
          expiresAt
        }
      : {
          schemaVersion,
          licenseId,
          issuer,
          keyId,
          licenseClass,
          features,
          issuedAt,
          subscriptionEndsAt,
          expiresAt
        }

    if (!areBytesEqual(envelope.payloadBytes, encodeUtf8(createCanonicalJWordLicenseClaims(claims)))) {
      throw new Error('non-canonical payload')
    }

    return Object.freeze({
      ...claims,
      features: Object.freeze([...claims.features])
    })
  } catch {
    throw new Error('Invalid JWL2 claims')
  }
}

/** 生成固定字段顺序的 JWL2 canonical JSON。 */
export function createCanonicalJWordLicenseClaims(claims: JWordLicenseClaimsV2): string {
  const value: Record<string, unknown> = {
    schemaVersion: claims.schemaVersion,
    licenseId: claims.licenseId,
    issuer: claims.issuer,
    keyId: claims.keyId,
    licenseClass: claims.licenseClass,
    features: [...claims.features].sort(),
    issuedAt: claims.issuedAt
  }

  if (claims.subscriptionEndsAt !== undefined) {
    value.subscriptionEndsAt = claims.subscriptionEndsAt
  }

  value.expiresAt = claims.expiresAt

  return JSON.stringify(value)
}

/** 生成固定的 JWL2 签名输入，不包含签名段。 */
export function createJWordLicenseSigningInput(payloadSegment: string): Uint8Array {
  return encodeUtf8(`${JWORD_LICENSE_TOKEN_VERSION}.${payloadSegment}`)
}

/** 解码并验证无 padding 的规范 base64url segment。 */
function decodeCanonicalBase64Url(segment: string): Uint8Array {
  if (segment.length === 0 || !/^[A-Za-z0-9_-]+$/u.test(segment)) {
    throw new Error('invalid base64url')
  }

  const decoded = decodeBase64Url(segment)
  if (encodeBase64Url(decoded) !== segment) {
    throw new Error('non-canonical base64url')
  }

  return decoded
}

/** 读取受长度和字符集约束的 identifier。 */
function readIdentifier(value: unknown, pattern: RegExp): string {
  if (typeof value !== 'string' || !pattern.test(value)) {
    throw new Error('invalid identifier')
  }

  return value
}

/** 读取 JWL2 schema version。 */
function readSchemaVersion(value: unknown): 2 {
  if (value !== JWORD_LICENSE_SCHEMA_VERSION) {
    throw new Error('invalid schema version')
  }

  return JWORD_LICENSE_SCHEMA_VERSION
}

/** 读取四种已批准的 license class。 */
function readLicenseClass(value: unknown): JWordLicenseClass {
  if (typeof value !== 'string' || !JWORD_LICENSE_CLASSES.has(value as JWordLicenseClass)) {
    throw new Error('invalid license class')
  }

  return value as JWordLicenseClass
}

/** 读取唯一且按字典序排列的模块 feature。 */
function readFeatures(value: unknown): readonly JWordFeature[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error('invalid features')
  }

  const features: JWordFeature[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !JWORD_LICENSE_FEATURE_VALUES.has(item)) {
      throw new Error('invalid feature')
    }

    const feature = item as JWordFeature
    if (features.includes(feature)) {
      throw new Error('duplicate feature')
    }
    if (features.length > 0 && (features[features.length - 1] ?? '') >= feature) {
      throw new Error('unsorted features')
    }
    features.push(feature)
  }

  return features
}

/** 读取规范 UTC 时间字符串；时间先只做格式和实际日期校验。 */
function readCanonicalUtcTime(value: unknown): string {
  if (typeof value !== 'string' || !JWORD_LICENSE_TIME_PATTERN.test(value)) {
    throw new Error('invalid time')
  }

  if (new Date(value).toISOString() !== value) {
    throw new Error('invalid date')
  }

  return value
}

/** 判断值是否是普通对象记录。 */
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 判断对象是否显式拥有指定字段。 */
function hasOwn(value: Readonly<Record<string, unknown>>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

/** 扫描顶层对象 key，避免 JSON.parse 静默覆盖重复 trust hint。 */
function assertNoDuplicateTopLevelKeys(payloadJson: string): void {
  let index = skipJsonWhitespace(payloadJson, 0)
  if (payloadJson.charAt(index) !== '{') {
    throw new Error('payload must be an object')
  }
  index += 1

  const keys = new Set<string>()
  while (true) {
    index = skipJsonWhitespace(payloadJson, index)
    if (payloadJson.charAt(index) === '}') {
      return
    }
    if (payloadJson.charAt(index) !== '"') {
      throw new Error('invalid object key')
    }

    const keyStart = index
    index = readJsonStringEnd(payloadJson, index)
    const key = JSON.parse(payloadJson.slice(keyStart, index)) as unknown
    if (typeof key !== 'string' || keys.has(key)) {
      throw new Error('duplicate object key')
    }
    keys.add(key)

    index = skipJsonWhitespace(payloadJson, index)
    if (payloadJson.charAt(index) !== ':') {
      throw new Error('invalid object separator')
    }
    index = skipJsonWhitespace(payloadJson, index + 1)
    index = skipJsonValue(payloadJson, index)
    index = skipJsonWhitespace(payloadJson, index)

    const separator = payloadJson.charAt(index)
    if (separator === '}') {
      return
    }
    if (separator !== ',') {
      throw new Error('invalid object separator')
    }
    index += 1
  }
}

/** 跳过 JSON 字符串并返回下一个字符位置。 */
function readJsonStringEnd(value: string, start: number): number {
  let index = start + 1
  let escaped = false

  while (index < value.length) {
    const character = value.charAt(index)
    if (escaped) {
      escaped = false
    } else if (character === '\\') {
      escaped = true
    } else if (character === '"') {
      return index + 1
    }
    index += 1
  }

  throw new Error('unterminated JSON string')
}

/** 跳过一个 JSON value，保留嵌套对象和数组中的分隔符。 */
function skipJsonValue(value: string, start: number): number {
  let index = start
  let depth = 0

  while (index < value.length) {
    const character = value.charAt(index)
    if (character === '"') {
      index = readJsonStringEnd(value, index)
      continue
    }
    if (character === '{' || character === '[') {
      depth += 1
    } else if (character === '}' || character === ']') {
      if (depth === 0) {
        return index
      }
      depth -= 1
    } else if (character === ',' && depth === 0) {
      return index
    }
    index += 1
  }

  return index
}

/** 跳过 JSON 空白字符。 */
function skipJsonWhitespace(value: string, start: number): number {
  let index = start
  while (/\s/u.test(value.charAt(index))) {
    index += 1
  }

  return index
}

/** 比对两个字节串是否完全一致。 */
function areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  for (let index = 0; index < left.length; index += 1) {
    if ((left[index] ?? 0) !== (right[index] ?? 0)) {
      return false
    }
  }

  return true
}
