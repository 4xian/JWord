/**
 * 职责：用正式 License runtime 离线验证一个 JWL2 token，并输出固定裁剪后的 claims。
 * 边界：只从 stdin 或外部文件读取 token，不接受信任根覆盖、不签发 token、不创建业务授权凭据。
 * 协作模块：@4xian/jword-license 公开根入口负责 production trust lookup、Ed25519 验签和时间检查。
 * 性能/安全约束：输入有严格大小预算，任何失败只输出稳定 code，不输出 token、payload、签名或密钥。
 * 实现说明：--at 仅用于历史审计和测试；它不能把调用方提供的时间变成可信时间源。
 */
import { closeSync, fstatSync, openSync, readSync } from 'node:fs'

import {
  JWordLicenseError,
  activateJWordLicense
} from '../../packages/license/dist/index.js'

const TOKEN_MAX_BYTES = 16 * 1024
const INPUT_MAX_BYTES = TOKEN_MAX_BYTES + 2
const UTC_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u
const CLI_USAGE_INVALID = 'JWORD_LICENSE_CLI_USAGE_INVALID'
const CLI_INPUT_INVALID = 'JWORD_LICENSE_CLI_INPUT_INVALID'

try {
  verifyLicense()
} catch (error) {
  const failure = readFailure(error)
  process.stderr.write(`${failure.code}\n`)
  process.exitCode = failure.exitCode
}

/** 读取参数和 token，通过正式公开入口激活后输出裁剪 claims。 */
function verifyLicense() {
  const options = readOptions(process.argv.slice(2))
  const stdinBytes = readStdinBytes()

  if (options.tokenFile !== undefined && stdinBytes.length > 0) {
    throw createCliFailure(CLI_USAGE_INVALID)
  }

  const inputBytes = options.tokenFile === undefined
    ? stdinBytes
    : readTokenFile(options.tokenFile)
  const token = readToken(inputBytes)
  const checkedAt = options.checkedAt ?? new Date().toISOString()
  const checkedAtMilliseconds = Date.parse(checkedAt)
  const originalDateNow = Date.now

  let claims
  try {
    Date.now = () => checkedAtMilliseconds
    activateJWordLicense(token)
    claims = readVerifiedClaims(token)
  } finally {
    Date.now = originalDateNow
  }

  process.stdout.write(`${JSON.stringify(createTrimmedOutput(claims, checkedAt))}\n`)
}

/** 读取唯一允许的 CLI 参数。 */
function readOptions(args) {
  let tokenFile
  let checkedAt

  for (let index = 0; index < args.length; index += 1) {
    const option = args[index]
    const value = args[index + 1]

    if (option === '--token-file') {
      if (tokenFile !== undefined || value === undefined || value.startsWith('--')) {
        throw createCliFailure(CLI_USAGE_INVALID)
      }
      tokenFile = value
      index += 1
      continue
    }

    if (option === '--at') {
      if (checkedAt !== undefined || value === undefined || !isCanonicalUtcTime(value)) {
        throw createCliFailure(CLI_USAGE_INVALID)
      }
      checkedAt = value
      index += 1
      continue
    }

    throw createCliFailure(CLI_USAGE_INVALID)
  }

  return { tokenFile, checkedAt }
}

/** 在固定预算内读取 stdin；TTY 表示没有 stdin 输入。 */
function readStdinBytes() {
  if (process.stdin.isTTY === true) {
    return Buffer.alloc(0)
  }

  return readBoundedDescriptor(0)
}

/** 只读取预算内的普通 token 文件。 */
function readTokenFile(path) {
  try {
    const descriptor = openSync(path, 'r')
    try {
      const metadata = fstatSync(descriptor)
      if (!metadata.isFile() || metadata.size > INPUT_MAX_BYTES) {
        throw createCliFailure(CLI_INPUT_INVALID)
      }
      return readBoundedDescriptor(descriptor)
    } finally {
      closeSync(descriptor)
    }
  } catch (error) {
    if (isCliFailure(error)) {
      throw error
    }
    throw createCliFailure(CLI_INPUT_INVALID)
  }
}

/** 分块读取 descriptor，超过输入预算立即拒绝。 */
function readBoundedDescriptor(descriptor) {
  const chunks = []
  let totalBytes = 0

  while (true) {
    const chunk = Buffer.alloc(Math.min(4096, INPUT_MAX_BYTES + 1 - totalBytes))
    const bytesRead = readSync(descriptor, chunk, 0, chunk.length, null)
    if (bytesRead === 0) {
      return Buffer.concat(chunks, totalBytes)
    }

    totalBytes += bytesRead
    if (totalBytes > INPUT_MAX_BYTES) {
      throw createCliFailure(CLI_INPUT_INVALID)
    }
    chunks.push(chunk.subarray(0, bytesRead))
  }
}

/** 把单 token 文本从可选行尾中规范化出来。 */
function readToken(inputBytes) {
  if (inputBytes.length === 0 || inputBytes.length > INPUT_MAX_BYTES) {
    throw createCliFailure(CLI_INPUT_INVALID)
  }

  let tokenBytes = inputBytes
  if (tokenBytes.at(-1) === 0x0a) {
    tokenBytes = tokenBytes.at(-2) === 0x0d
      ? tokenBytes.subarray(0, -2)
      : tokenBytes.subarray(0, -1)
  }

  if (
    tokenBytes.length === 0 ||
    tokenBytes.length > TOKEN_MAX_BYTES ||
    tokenBytes.some((byte) => byte <= 0x20 || byte > 0x7e)
  ) {
    throw createCliFailure(CLI_INPUT_INVALID)
  }

  return tokenBytes.toString('ascii')
}

/** 激活成功后只读取固定 JWL2 claims，用于裁剪显示。 */
function readVerifiedClaims(token) {
  const payloadSegment = token.split('.')[1]
  if (payloadSegment === undefined) {
    throw new Error('verified token payload is missing')
  }
  return JSON.parse(Buffer.from(payloadSegment, 'base64url').toString('utf8'))
}

/** 创建固定字段顺序的无敏感信息成功输出。 */
function createTrimmedOutput(claims, checkedAt) {
  return {
    status: 'valid',
    checkedAt,
    schemaVersion: claims.schemaVersion,
    licenseId: claims.licenseId,
    issuer: claims.issuer,
    keyId: claims.keyId,
    licenseClass: claims.licenseClass,
    features: claims.features,
    issuedAt: claims.issuedAt,
    ...(claims.subscriptionEndsAt === undefined
      ? {}
      : { subscriptionEndsAt: claims.subscriptionEndsAt }),
    expiresAt: claims.expiresAt
  }
}

/** 判断时间是否是有效且规范的 UTC 毫秒时间。 */
function isCanonicalUtcTime(value) {
  return UTC_TIME_PATTERN.test(value) && new Date(value).toISOString() === value
}

/** 创建不携带原始异常的工具内部失败。 */
function createCliFailure(code) {
  return { cliFailure: true, code, exitCode: 2 }
}

/** 判断未知值是否为工具内部失败。 */
function isCliFailure(value) {
  return typeof value === 'object' && value !== null && value.cliFailure === true
}

/** 把 runtime 或工具失败映射为唯一稳定 code。 */
function readFailure(error) {
  if (isCliFailure(error)) {
    return error
  }
  if (error instanceof JWordLicenseError && (
    error.code === 'JWORD_LICENSE_NOT_YET_VALID' ||
    error.code === 'JWORD_LICENSE_EXPIRED'
  )) {
    return { code: error.code, exitCode: 1 }
  }
  return { code: 'JWORD_LICENSE_SIGNATURE_INVALID', exitCode: 1 }
}
