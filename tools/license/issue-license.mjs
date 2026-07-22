/**
 * 职责：用受控 Ed25519 私钥签发固定 schema、issuer 与 keyId 的 JWord JWL2 token。
 * 边界：只读取审批后的最小 JWL2 输入和外部私钥，不实现客户台账、不进入 package runtime。
 * 协作模块：packages/license 的 JWL2 parser/verifier 使用相同 canonical 字段顺序和签名输入。
 * 性能/安全约束：严格限制 claims 与资源大小，私钥只来自单一环境来源且不写入输出或错误。
 * 实现说明：Evaluation 固定 30 天，订阅类固定在 subscriptionEndsAt 后增加 15 天。
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKEN_VERSION = 'JWL2'
const SCHEMA_VERSION = 2
const ISSUER = 'jword'
const KEY_ID = 'jword-prod-2026-k1'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const DAY_MS = 24 * 60 * 60 * 1000
const EVALUATION_DAYS = 30
const SUBSCRIPTION_GRACE_DAYS = 15
const PAYLOAD_MAX_BYTES = 8 * 1024
const TOKEN_MAX_BYTES = 16 * 1024
const LICENSE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u
const UTC_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const LICENSE_CLASSES = new Set([
  'evaluation',
  'nonProduction',
  'production',
  'disasterRecovery'
])
const FEATURE_VALUES = new Set([
  'professional.editing',
  'formats',
  'collaboration'
])
const INPUT_KEYS = new Set([
  'licenseId',
  'licenseClass',
  'features',
  'issuedAt',
  'subscriptionEndsAt',
  'expiresAt',
  'issuer',
  'keyId'
])

try {
  issueLicense()
} catch (error) {
  process.stderr.write(`${readErrorMessage(error)}\n`)
  process.exitCode = 1
}

/** 读取、规范化并签发一个 JWL2 token。 */
function issueLicense() {
  const payload = readPayload(readPayloadSource())
  const payloadBytes = Buffer.from(createCanonicalPayload(payload), 'utf8')

  if (payloadBytes.byteLength > PAYLOAD_MAX_BYTES) {
    throw new Error(`Canonical payload must not exceed ${PAYLOAD_MAX_BYTES} bytes.`)
  }

  const payloadSegment = encodeBase64Url(payloadBytes)
  const signingInput = Buffer.from(`${TOKEN_VERSION}.${payloadSegment}`, 'utf8')
  const signature = sign(null, signingInput, readPrivateKey())
  const token = `${TOKEN_VERSION}.${payloadSegment}.${encodeBase64Url(signature)}`

  if (Buffer.byteLength(token, 'utf8') > TOKEN_MAX_BYTES) {
    throw new Error(`JWL2 token must not exceed ${TOKEN_MAX_BYTES} bytes.`)
  }

  process.stdout.write(`${token}\n`)
}

/** 读取命令行 payload 来源并拒绝未定义参数。 */
function readPayloadSource() {
  const args = process.argv.slice(2)
  if (args.length === 0) {
    return readFileSync(0, 'utf8')
  }
  if (args.length !== 2 || args[0] !== '--payload' || args[1].length === 0) {
    throw new Error('Usage: node tools/license/issue-license.mjs [--payload JSON_FILE]')
  }

  return readFileSync(args[1], 'utf8')
}

/** 从唯一的环境来源读取并校验 Ed25519 私钥。 */
function readPrivateKey() {
  const inlinePem = process.env.JWORD_LICENSE_PRIVATE_KEY_PEM
  const keyPath = process.env.JWORD_LICENSE_PRIVATE_KEY_PATH

  if (inlinePem !== undefined && keyPath !== undefined) {
    throw new Error('Set exactly one JWord License private key source.')
  }
  if (
    (inlinePem === undefined || inlinePem.length === 0) &&
    (keyPath === undefined || keyPath.length === 0)
  ) {
    throw new Error('Set JWORD_LICENSE_PRIVATE_KEY_PEM or JWORD_LICENSE_PRIVATE_KEY_PATH before signing a license.')
  }

  const privateKeySource = inlinePem ?? readExternalPrivateKey(keyPath)
  const privateKey = createPrivateKey(privateKeySource)
  if (privateKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('JWord License private key must be Ed25519.')
  }

  return privateKey
}

/** 解析并严格校验 JWL2 签发输入。 */
function readPayload(source) {
  assertNoDuplicateTopLevelKeys(source)
  const value = JSON.parse(source)
  if (!isRecord(value)) {
    throw new Error('License payload must be an object.')
  }

  for (const key of Object.keys(value)) {
    if (!INPUT_KEYS.has(key)) {
      throw new Error(`Unknown License payload field: ${key}.`)
    }
  }

  readFixedOptionalValue(value.issuer, 'issuer', ISSUER)
  readFixedOptionalValue(value.keyId, 'keyId', KEY_ID)

  const licenseId = readLicenseId(value.licenseId)
  const licenseClass = readLicenseClass(value.licenseClass)
  const features = readFeatures(value.features)
  const issuedAt = readCanonicalUtcTime(value.issuedAt, 'issuedAt')
  const suppliedExpiresAt = readOptionalCanonicalUtcTime(value.expiresAt, 'expiresAt')

  if (licenseClass === 'evaluation') {
    if (value.subscriptionEndsAt !== undefined) {
      throw new Error('subscriptionEndsAt is not allowed for evaluation licenses.')
    }

    const expiresAt = addDays(issuedAt, EVALUATION_DAYS)
    assertSuppliedExpiry(suppliedExpiresAt, expiresAt)

    return {
      licenseId,
      licenseClass,
      features,
      issuedAt,
      expiresAt
    }
  }

  const subscriptionEndsAt = readCanonicalUtcTime(
    value.subscriptionEndsAt,
    'subscriptionEndsAt'
  )
  if (Date.parse(subscriptionEndsAt) <= Date.parse(issuedAt)) {
    throw new Error('subscriptionEndsAt must be later than issuedAt.')
  }

  const expiresAt = addDays(subscriptionEndsAt, SUBSCRIPTION_GRACE_DAYS)
  assertSuppliedExpiry(suppliedExpiresAt, expiresAt)

  return {
    licenseId,
    licenseClass,
    features,
    issuedAt,
    subscriptionEndsAt,
    expiresAt
  }
}

/** 从解析后仍位于仓库外的文件读取私钥。 */
function readExternalPrivateKey(keyPath) {
  const realRepositoryRoot = realpathSync(REPOSITORY_ROOT)
  const realPrivateKeyPath = realpathSync(keyPath)
  const repositoryRelativePath = relative(realRepositoryRoot, realPrivateKeyPath)
  const isInsideRepository =
    repositoryRelativePath === '' ||
    (repositoryRelativePath !== '..' &&
      !repositoryRelativePath.startsWith(`..${sep}`) &&
      !isAbsolute(repositoryRelativePath))

  if (isInsideRepository) {
    throw new Error('Private key path must be outside the repository.')
  }

  return readFileSync(realPrivateKeyPath, 'utf8')
}

/** 在 JSON.parse 静默覆盖前拒绝重复顶层字段。 */
function assertNoDuplicateTopLevelKeys(source) {
  let index = skipJsonWhitespace(source, 0)
  if (source.charAt(index) !== '{') {
    return
  }
  index += 1

  const keys = new Set()
  while (true) {
    index = skipJsonWhitespace(source, index)
    if (source.charAt(index) === '}') {
      return
    }
    if (source.charAt(index) !== '"') {
      return
    }

    const keyStart = index
    index = readJsonStringEnd(source, index)
    const key = JSON.parse(source.slice(keyStart, index))
    if (keys.has(key)) {
      throw new Error(`License payload contains a duplicate top-level field: ${key}.`)
    }
    keys.add(key)

    index = skipJsonWhitespace(source, index)
    if (source.charAt(index) !== ':') {
      return
    }
    index = skipJsonWhitespace(source, index + 1)
    index = skipJsonValue(source, index)
    index = skipJsonWhitespace(source, index)

    const separator = source.charAt(index)
    if (separator === '}') {
      return
    }
    if (separator !== ',') {
      return
    }
    index += 1
  }
}

/** 跳过 JSON 字符串并返回后一个字符的位置。 */
function readJsonStringEnd(value, start) {
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

  return value.length
}

/** 跳过一个 JSON value，保留顶层字段分隔符。 */
function skipJsonValue(value, start) {
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
function skipJsonWhitespace(value, start) {
  let index = start
  while (/\s/u.test(value.charAt(index))) {
    index += 1
  }

  return index
}

/** 创建与 runtime 完全一致的固定字段顺序 canonical JSON。 */
function createCanonicalPayload(payload) {
  const value = {
    schemaVersion: SCHEMA_VERSION,
    licenseId: payload.licenseId,
    issuer: ISSUER,
    keyId: KEY_ID,
    licenseClass: payload.licenseClass,
    features: [...payload.features],
    issuedAt: payload.issuedAt
  }

  if (payload.subscriptionEndsAt !== undefined) {
    value.subscriptionEndsAt = payload.subscriptionEndsAt
  }

  value.expiresAt = payload.expiresAt

  return JSON.stringify(value)
}

/** 编码无 padding 的规范 base64url。 */
function encodeBase64Url(bytes) {
  return Buffer.from(bytes).toString('base64url')
}

/** 读取受 JWL2 字符集和长度约束的 licenseId。 */
function readLicenseId(value) {
  if (typeof value !== 'string' || !LICENSE_ID_PATTERN.test(value)) {
    throw new Error('licenseId must contain 1-128 approved identifier characters.')
  }

  return value
}

/** 读取四种已批准的 License class。 */
function readLicenseClass(value) {
  if (typeof value !== 'string' || !LICENSE_CLASSES.has(value)) {
    throw new Error('licenseClass is not approved.')
  }

  return value
}

/** 读取唯一、已登记且按字典序排列的模块 feature。 */
function readFeatures(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) {
    throw new Error('features must contain 1-3 approved values.')
  }

  const features = []
  for (const item of value) {
    if (typeof item !== 'string' || !FEATURE_VALUES.has(item)) {
      throw new Error('features contains an unknown value.')
    }
    if (features.includes(item)) {
      throw new Error('features must not contain duplicates.')
    }
    if (features.length > 0 && features[features.length - 1] >= item) {
      throw new Error('features must be sorted lexicographically.')
    }
    features.push(item)
  }

  return features
}

/** 读取格式严格且代表真实 UTC 日期的时间。 */
function readCanonicalUtcTime(value, fieldName) {
  if (
    typeof value !== 'string' ||
    !UTC_TIME_PATTERN.test(value) ||
    new Date(value).toISOString() !== value
  ) {
    throw new Error(`${fieldName} must be a valid YYYY-MM-DDTHH:mm:ss.sssZ UTC time.`)
  }

  return value
}

/** 读取可选的规范 UTC 时间。 */
function readOptionalCanonicalUtcTime(value, fieldName) {
  return value === undefined ? undefined : readCanonicalUtcTime(value, fieldName)
}

/** 校验调用方提供的固定值，防止改变生产信任根。 */
function readFixedOptionalValue(value, fieldName, expected) {
  if (value !== undefined && value !== expected) {
    throw new Error(`${fieldName} must be ${expected} when provided.`)
  }
}

/** 给规范 UTC 时间增加固定自然日数并保持毫秒精度。 */
function addDays(value, days) {
  const result = new Date(Date.parse(value) + days * DAY_MS).toISOString()
  return readCanonicalUtcTime(result, 'calculated expiresAt')
}

/** 校验可选 expiresAt 与签发器计算结果完全一致且晚于 issuedAt。 */
function assertSuppliedExpiry(supplied, calculated) {
  if (supplied !== undefined && supplied !== calculated) {
    throw new Error('expiresAt must exactly match the calculated License expiry.')
  }
}

/** 判断 JSON 值是否为对象记录。 */
function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 把未知异常转换为不包含输入或私钥的 CLI 错误消息。 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to issue JWord License.'
}
