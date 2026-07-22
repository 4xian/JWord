/**
 * 职责：提供 License token 所需的 base64url、UTF-8 与 Ed25519 验签工具。
 * 边界：仅服务 packages/license 内部 token codec，不读取授权业务字段、不暴露为包级公开入口。
 * 协作模块：JWL2 parser、固定 trust store 和 verifier 通过这些纯函数解码并验签 token。
 * 性能/安全约束：验签保持同步，固定使用 @noble/curves 严格模式并对非法输入 fail closed。
 * 实现说明：Ed25519 验签来自 @noble/curves/ed25519.js，其内部使用 @noble/hashes；JWord 不维护第二套密码实现。
 */

import { ed25519 } from '@noble/curves/ed25519.js'

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** 使用 @noble/curves 严格 RFC 8032 模式执行同步 Ed25519 验签。 */
export function verifyEd25519(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array
): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) {
    return false
  }

  try {
    return ed25519.verify(signature, message, publicKey, { zip215: false })
  } catch {
    return false
  }
}

/** 编码 base64url。 */
export function encodeBase64Url(bytes: Uint8Array): string {
  let output = ''

  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0
    const second = bytes[index + 1] ?? 0
    const third = bytes[index + 2] ?? 0
    const hasSecond = index + 1 < bytes.length
    const hasThird = index + 2 < bytes.length

    output += BASE64URL_ALPHABET.charAt(first >> 2)
    output += BASE64URL_ALPHABET.charAt(((first & 3) << 4) | (second >> 4))
    if (hasSecond) {
      output += BASE64URL_ALPHABET.charAt(((second & 15) << 2) | (third >> 6))
    }
    if (hasThird) {
      output += BASE64URL_ALPHABET.charAt(third & 63)
    }
  }

  return output
}

/** 解码 base64url。 */
export function decodeBase64Url(value: string): Uint8Array {
  const clean = value.replace(/=/gu, '')

  if (clean.length % 4 === 1) {
    throw new Error('Invalid base64url length')
  }

  const bytes: number[] = []
  for (let index = 0; index < clean.length; index += 4) {
    const first = readBase64UrlValue(clean.charAt(index))
    const second = readBase64UrlValue(clean.charAt(index + 1))
    const thirdChar = clean.charAt(index + 2)
    const fourthChar = clean.charAt(index + 3)
    const third = thirdChar.length === 0 ? 0 : readBase64UrlValue(thirdChar)
    const fourth = fourthChar.length === 0 ? 0 : readBase64UrlValue(fourthChar)

    bytes.push((first << 2) | (second >> 4))
    if (thirdChar.length > 0) {
      bytes.push(((second & 15) << 4) | (third >> 2))
    }
    if (fourthChar.length > 0) {
      bytes.push(((third & 3) << 6) | fourth)
    }
  }

  return Uint8Array.from(bytes)
}

/** 读取单个 base64url 字符值。 */
function readBase64UrlValue(char: string): number {
  const value = BASE64URL_ALPHABET.indexOf(char)

  if (value < 0) {
    throw new Error('Invalid base64url character')
  }

  return value
}

/** 编码 UTF-8。 */
export function encodeUtf8(value: string): Uint8Array {
  const bytes: number[] = []

  for (let index = 0; index < value.length; index += 1) {
    let codePoint = value.codePointAt(index) ?? 0
    if (codePoint > 0xffff) {
      index += 1
    }

    if (codePoint <= 0x7f) {
      bytes.push(codePoint)
    } else if (codePoint <= 0x7ff) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f))
    } else if (codePoint <= 0xffff) {
      bytes.push(0xe0 | (codePoint >> 12), 0x80 | ((codePoint >> 6) & 0x3f), 0x80 | (codePoint & 0x3f))
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f)
      )
    }
  }

  return Uint8Array.from(bytes)
}

/** 解码 UTF-8。 */
export function decodeUtf8(bytes: Uint8Array): string {
  let output = ''

  for (let index = 0; index < bytes.length; index += 1) {
    const first = bytes[index] ?? 0

    if (first <= 0x7f) {
      output += String.fromCodePoint(first)
    } else if ((first & 0xe0) === 0xc0) {
      const second = readUtf8Continuation(bytes, index + 1)
      output += String.fromCodePoint(((first & 0x1f) << 6) | second)
      index += 1
    } else if ((first & 0xf0) === 0xe0) {
      const second = readUtf8Continuation(bytes, index + 1)
      const third = readUtf8Continuation(bytes, index + 2)
      output += String.fromCodePoint(((first & 0x0f) << 12) | (second << 6) | third)
      index += 2
    } else if ((first & 0xf8) === 0xf0) {
      const second = readUtf8Continuation(bytes, index + 1)
      const third = readUtf8Continuation(bytes, index + 2)
      const fourth = readUtf8Continuation(bytes, index + 3)
      output += String.fromCodePoint(((first & 0x07) << 18) | (second << 12) | (third << 6) | fourth)
      index += 3
    } else {
      throw new Error('Invalid UTF-8 sequence')
    }
  }

  return output
}

/** 读取 UTF-8 continuation byte。 */
function readUtf8Continuation(bytes: Uint8Array, index: number): number {
  const value = bytes[index]

  if (value === undefined || (value & 0xc0) !== 0x80) {
    throw new Error('Invalid UTF-8 continuation')
  }

  return value & 0x3f
}
