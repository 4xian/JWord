/**
 * 职责：用本地私钥签发 JWord JWL1 商业授权 token。
 * 边界：只读取调用方提供的 payload JSON 和 Ed25519 私钥，不联网、不写入仓库、不发布包。
 * 协作模块：packages/license 的 JWL1 token codec 与商业发布 dry-run 复用相同签名输入格式。
 * 约束：私钥只能来自 JWORD_LICENSE_PRIVATE_KEY_PEM 或 JWORD_LICENSE_PRIVATE_KEY_PATH，禁止把真实私钥提交进仓库。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#34-lic-1-license-密码学签名phase-1f-m-l按-d1-执行。
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

const tokenVersion = 'JWL1'
const schemaVersion = 1

const payload = readPayload(readPayloadSource())
const payloadSegment = encodeBase64Url(Buffer.from(createCanonicalPayload(payload), 'utf8'))
const signature = sign(null, Buffer.from(`${tokenVersion}.${payloadSegment}`, 'utf8'), readPrivateKey())

process.stdout.write(`${tokenVersion}.${payloadSegment}.${encodeBase64Url(signature)}\n`)

/** 读取命令行 payload 来源。 */
function readPayloadSource() {
  const payloadFlagIndex = process.argv.indexOf('--payload')

  if (payloadFlagIndex >= 0) {
    const payloadPath = process.argv[payloadFlagIndex + 1]

    if (payloadPath === undefined) {
      throw new Error('--payload requires a JSON file path.')
    }

    return readFileSync(payloadPath, 'utf8')
  }

  return readFileSync(0, 'utf8')
}

/** 从环境变量或文件读取 Ed25519 私钥。 */
function readPrivateKey() {
  const inlinePem = process.env.JWORD_LICENSE_PRIVATE_KEY_PEM
  const keyPath = process.env.JWORD_LICENSE_PRIVATE_KEY_PATH

  if (inlinePem !== undefined && inlinePem.length > 0) {
    return createPrivateKey(inlinePem)
  }
  if (keyPath !== undefined && keyPath.length > 0) {
    return createPrivateKey(readFileSync(keyPath, 'utf8'))
  }

  throw new Error('Set JWORD_LICENSE_PRIVATE_KEY_PEM or JWORD_LICENSE_PRIVATE_KEY_PATH before signing a license.')
}

/** 解析并校验签发 payload。 */
function readPayload(source) {
  const value = JSON.parse(source)

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('License payload must be an object.')
  }

  return {
    licenseId: readRequiredString(value.licenseId, 'licenseId'),
    customerId: readRequiredString(value.customerId, 'customerId'),
    issuer: readRequiredString(value.issuer, 'issuer'),
    features: readFeatures(value.features),
    issuedAt: readRequiredString(value.issuedAt, 'issuedAt'),
    expiresAt: readOptionalString(value.expiresAt, 'expiresAt'),
    offlineGraceDays: readNonNegativeInteger(value.offlineGraceDays, 'offlineGraceDays'),
    schemaVersion: readSchemaVersion(value.schemaVersion)
  }
}

/** 创建与运行时验签一致的稳定 JSON。 */
function createCanonicalPayload(payload) {
  return JSON.stringify({
    licenseId: payload.licenseId,
    customerId: payload.customerId,
    issuer: payload.issuer,
    features: [...payload.features].sort(),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt ?? null,
    offlineGraceDays: payload.offlineGraceDays,
    schemaVersion: payload.schemaVersion
  })
}

/** 编码 base64url。 */
function encodeBase64Url(bytes) {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/=/gu, '')
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
}

/** 读取必填字符串字段。 */
function readRequiredString(value, fieldName) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`)
  }

  return value
}

/** 读取可选字符串字段。 */
function readOptionalString(value, fieldName) {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${fieldName} must be a string when provided.`)
  }

  return value
}

/** 读取 feature key 数组。 */
function readFeatures(value) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error('features must be a non-empty string array.')
  }

  return [...value].sort()
}

/** 读取非负整数。 */
function readNonNegativeInteger(value, fieldName) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldName} must be a non-negative integer.`)
  }

  return value
}

/** 读取 schema version。 */
function readSchemaVersion(value) {
  if (value !== schemaVersion) {
    throw new Error(`schemaVersion must be ${schemaVersion}.`)
  }

  return schemaVersion
}
