/**
 * 职责：提供 license JWL1 token 所需的零依赖 base64url、UTF-8、SHA-512 与 Ed25519 签名/验签工具。
 * 边界：仅服务 packages/license 内部 token codec，不读取授权业务字段、不暴露为包级公开入口。
 * 协作模块：index.ts 通过这些纯函数完成 token 签发 fixture 与运行时验签。
 * 性能/安全约束：实现保持同步纯函数，浏览器和 Node 均不依赖第三方包或 Node 内置 crypto。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

const BASE64URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const SHA512_BLOCK_BYTES = 128
const SHA512_OUTPUT_BYTES = 64
const UINT64_MASK = (1n << 64n) - 1n
const ED25519_P = (1n << 255n) - 19n
const ED25519_L = (1n << 252n) + 27742317777372353535851937790883648493n
const ED25519_D = mod(-121665n * invertMod(121666n, ED25519_P), ED25519_P)
const ED25519_I = powMod(2n, (ED25519_P - 1n) / 4n, ED25519_P)
const ED25519_BASE_POINT = createEd25519Point(
  15112221349535400772501151409588531511454012693041857206046113283949847762202n,
  46316835694926478169428394003475163141307993866256225615783033603165251855960n
)
const ED25519_IDENTITY_POINT = createEd25519Point(0n, 1n)
const SHA512_INITIAL_STATE = [
  0x6a09e667f3bcc908n,
  0xbb67ae8584caa73bn,
  0x3c6ef372fe94f82bn,
  0xa54ff53a5f1d36f1n,
  0x510e527fade682d1n,
  0x9b05688c2b3e6c1fn,
  0x1f83d9abfb41bd6bn,
  0x5be0cd19137e2179n
] as const
const SHA512_ROUND_CONSTANTS = [
  0x428a2f98d728ae22n, 0x7137449123ef65cdn, 0xb5c0fbcfec4d3b2fn, 0xe9b5dba58189dbbcn,
  0x3956c25bf348b538n, 0x59f111f1b605d019n, 0x923f82a4af194f9bn, 0xab1c5ed5da6d8118n,
  0xd807aa98a3030242n, 0x12835b0145706fben, 0x243185be4ee4b28cn, 0x550c7dc3d5ffb4e2n,
  0x72be5d74f27b896fn, 0x80deb1fe3b1696b1n, 0x9bdc06a725c71235n, 0xc19bf174cf692694n,
  0xe49b69c19ef14ad2n, 0xefbe4786384f25e3n, 0x0fc19dc68b8cd5b5n, 0x240ca1cc77ac9c65n,
  0x2de92c6f592b0275n, 0x4a7484aa6ea6e483n, 0x5cb0a9dcbd41fbd4n, 0x76f988da831153b5n,
  0x983e5152ee66dfabn, 0xa831c66d2db43210n, 0xb00327c898fb213fn, 0xbf597fc7beef0ee4n,
  0xc6e00bf33da88fc2n, 0xd5a79147930aa725n, 0x06ca6351e003826fn, 0x142929670a0e6e70n,
  0x27b70a8546d22ffcn, 0x2e1b21385c26c926n, 0x4d2c6dfc5ac42aedn, 0x53380d139d95b3dfn,
  0x650a73548baf63den, 0x766a0abb3c77b2a8n, 0x81c2c92e47edaee6n, 0x92722c851482353bn,
  0xa2bfe8a14cf10364n, 0xa81a664bbc423001n, 0xc24b8b70d0f89791n, 0xc76c51a30654be30n,
  0xd192e819d6ef5218n, 0xd69906245565a910n, 0xf40e35855771202an, 0x106aa07032bbd1b8n,
  0x19a4c116b8d2d0c8n, 0x1e376c085141ab53n, 0x2748774cdf8eeb99n, 0x34b0bcb5e19b48a8n,
  0x391c0cb3c5c95a63n, 0x4ed8aa4ae3418acbn, 0x5b9cca4f7763e373n, 0x682e6ff3d6b2b8a3n,
  0x748f82ee5defb2fcn, 0x78a5636f43172f60n, 0x84c87814a1f0ab72n, 0x8cc702081a6439ecn,
  0x90befffa23631e28n, 0xa4506cebde82bde9n, 0xbef9a3f7b2c67915n, 0xc67178f2e372532bn,
  0xca273eceea26619cn, 0xd186b8c721c0c207n, 0xeada7dd6cde0eb1en, 0xf57d4f7fee6ed178n,
  0x06f067aa72176fban, 0x0a637dc5a2c898a6n, 0x113f9804bef90daen, 0x1b710b35131c471bn,
  0x28db77f523047d84n, 0x32caab7b40c72493n, 0x3c9ebe0a15c9bebcn, 0x431d67c49c100d4cn,
  0x4cc5d4becb3e42b6n, 0x597f299cfc657e2an, 0x5fcb6fab3ad6faecn, 0x6c44198c4a475817n
] as const

interface Ed25519Point {
  readonly x: bigint
  readonly y: bigint
  readonly z: bigint
  readonly t: bigint
}

/** 执行 Ed25519 签名，供 insecure-test-only fixture 签发使用。 */
export function signEd25519(message: Uint8Array, privateKeySeed: Uint8Array): Uint8Array {
  if (privateKeySeed.length !== 32) {
    throw new Error('Ed25519 private seed must be 32 bytes')
  }

  const hashedSeed = sha512(privateKeySeed)
  const scalarBytes = hashedSeed.slice(0, 32)
  scalarBytes[0] = (scalarBytes[0] ?? 0) & 248
  scalarBytes[31] = ((scalarBytes[31] ?? 0) & 63) | 64

  const scalar = bytesToBigIntLittle(scalarBytes)
  const publicKey = encodeEd25519Point(scalarMultEd25519(scalar, ED25519_BASE_POINT))
  const prefix = hashedSeed.slice(32, 64)
  const nonce = bytesToBigIntLittle(sha512(concatBytes(prefix, message))) % ED25519_L
  const encodedNoncePoint = encodeEd25519Point(scalarMultEd25519(nonce, ED25519_BASE_POINT))
  const challenge = bytesToBigIntLittle(sha512(concatBytes(encodedNoncePoint, publicKey, message))) % ED25519_L
  const signatureScalar = mod(nonce + challenge * scalar, ED25519_L)
  const signature = new Uint8Array(64)

  signature.set(encodedNoncePoint, 0)
  signature.set(bigIntToBytesLittle(signatureScalar, 32), 32)

  return signature
}

/** 执行 Ed25519 验签，浏览器与 Node 均使用零依赖路径。 */
export function verifyEd25519(message: Uint8Array, signature: Uint8Array, publicKey: Uint8Array): boolean {
  if (signature.length !== 64 || publicKey.length !== 32) {
    return false
  }

  try {
    const encodedNoncePoint = signature.slice(0, 32)
    const signatureScalar = bytesToBigIntLittle(signature.slice(32, 64))

    if (signatureScalar >= ED25519_L) {
      return false
    }

    const publicPoint = decodeEd25519Point(publicKey)
    const noncePoint = decodeEd25519Point(encodedNoncePoint)
    const challenge = bytesToBigIntLittle(sha512(concatBytes(encodedNoncePoint, publicKey, message))) % ED25519_L
    const left = scalarMultEd25519(signatureScalar, ED25519_BASE_POINT)
    const right = addEd25519Points(noncePoint, scalarMultEd25519(challenge, publicPoint))

    return areBytesEqual(encodeEd25519Point(left), encodeEd25519Point(right))
  } catch {
    return false
  }
}

/** 创建扩展坐标点。 */
function createEd25519Point(x: bigint, y: bigint): Ed25519Point {
  return {
    x: mod(x, ED25519_P),
    y: mod(y, ED25519_P),
    z: 1n,
    t: mod(x * y, ED25519_P)
  }
}

/** 执行 Edwards 点加法。 */
function addEd25519Points(left: Ed25519Point, right: Ed25519Point): Ed25519Point {
  const a = mod((left.y - left.x) * (right.y - right.x), ED25519_P)
  const b = mod((left.y + left.x) * (right.y + right.x), ED25519_P)
  const c = mod(left.t * 2n * ED25519_D * right.t, ED25519_P)
  const d = mod(left.z * 2n * right.z, ED25519_P)
  const e = b - a
  const f = d - c
  const g = d + c
  const h = b + a

  return {
    x: mod(e * f, ED25519_P),
    y: mod(g * h, ED25519_P),
    z: mod(f * g, ED25519_P),
    t: mod(e * h, ED25519_P)
  }
}

/** 执行 Edwards 点标量乘法。 */
function scalarMultEd25519(scalar: bigint, point: Ed25519Point): Ed25519Point {
  let result = ED25519_IDENTITY_POINT
  let addend = point
  let remaining = scalar

  while (remaining > 0n) {
    if ((remaining & 1n) === 1n) {
      result = addEd25519Points(result, addend)
    }
    addend = addEd25519Points(addend, addend)
    remaining >>= 1n
  }

  return result
}

/** 把 Ed25519 点编码为 32 字节压缩形式。 */
function encodeEd25519Point(point: Ed25519Point): Uint8Array {
  const invertedZ = invertMod(point.z, ED25519_P)
  const x = mod(point.x * invertedZ, ED25519_P)
  const y = mod(point.y * invertedZ, ED25519_P)
  const bytes = bigIntToBytesLittle(y, 32)

  bytes[31] = (bytes[31] ?? 0) | (Number(x & 1n) << 7)

  return bytes
}

/** 从 32 字节压缩形式解码 Ed25519 点。 */
function decodeEd25519Point(bytes: Uint8Array): Ed25519Point {
  const encodedY = Uint8Array.from(bytes)
  const sign = ((encodedY[31] ?? 0) >> 7) & 1
  encodedY[31] = (encodedY[31] ?? 0) & 127

  const y = bytesToBigIntLittle(encodedY)
  if (y >= ED25519_P) {
    throw new Error('Invalid Ed25519 point')
  }

  const ySquared = mod(y * y, ED25519_P)
  const numerator = mod(ySquared - 1n, ED25519_P)
  const denominator = mod(ED25519_D * ySquared + 1n, ED25519_P)
  let x = powMod(mod(numerator * invertMod(denominator, ED25519_P), ED25519_P), (ED25519_P + 3n) / 8n, ED25519_P)

  if (mod(x * x - numerator * invertMod(denominator, ED25519_P), ED25519_P) !== 0n) {
    x = mod(x * ED25519_I, ED25519_P)
  }
  if (mod(x * x - numerator * invertMod(denominator, ED25519_P), ED25519_P) !== 0n) {
    throw new Error('Invalid Ed25519 point')
  }
  if (x === 0n && sign === 1) {
    throw new Error('Invalid Ed25519 point')
  }
  if (Number(x & 1n) !== sign) {
    x = ED25519_P - x
  }

  return createEd25519Point(x, y)
}

/** 计算 SHA-512 摘要。 */
function sha512(message: Uint8Array): Uint8Array {
  const padded = padSha512Message(message)
  const state = [...SHA512_INITIAL_STATE]

  for (let offset = 0; offset < padded.length; offset += SHA512_BLOCK_BYTES) {
    compressSha512Block(state, padded.subarray(offset, offset + SHA512_BLOCK_BYTES))
  }

  const output = new Uint8Array(SHA512_OUTPUT_BYTES)
  for (let index = 0; index < state.length; index += 1) {
    writeUint64(output, index * 8, state[index] ?? 0n)
  }

  return output
}

/** 按 SHA-512 规则填充消息。 */
function padSha512Message(message: Uint8Array): Uint8Array {
  const bitLength = BigInt(message.length) * 8n
  let paddedLength = message.length + 1 + 16
  while (paddedLength % SHA512_BLOCK_BYTES !== 0) {
    paddedLength += 1
  }

  const padded = new Uint8Array(paddedLength)
  padded.set(message)
  padded[message.length] = 0x80
  writeUint64(padded, paddedLength - 8, bitLength)

  return padded
}

/** 压缩单个 SHA-512 消息块。 */
function compressSha512Block(state: bigint[], block: Uint8Array): void {
  const words = new Array<bigint>(80).fill(0n)

  for (let index = 0; index < 16; index += 1) {
    words[index] = readUint64(block, index * 8)
  }
  for (let index = 16; index < 80; index += 1) {
    const s0 = smallSigma0(words[index - 15] ?? 0n)
    const s1 = smallSigma1(words[index - 2] ?? 0n)
    words[index] = mask64((words[index - 16] ?? 0n) + s0 + (words[index - 7] ?? 0n) + s1)
  }

  let a = state[0] ?? 0n
  let b = state[1] ?? 0n
  let c = state[2] ?? 0n
  let d = state[3] ?? 0n
  let e = state[4] ?? 0n
  let f = state[5] ?? 0n
  let g = state[6] ?? 0n
  let h = state[7] ?? 0n

  for (let index = 0; index < 80; index += 1) {
    const temp1 = mask64(h + bigSigma1(e) + choose(e, f, g) + (SHA512_ROUND_CONSTANTS[index] ?? 0n) + (words[index] ?? 0n))
    const temp2 = mask64(bigSigma0(a) + majority(a, b, c))

    h = g
    g = f
    f = e
    e = mask64(d + temp1)
    d = c
    c = b
    b = a
    a = mask64(temp1 + temp2)
  }

  state[0] = mask64((state[0] ?? 0n) + a)
  state[1] = mask64((state[1] ?? 0n) + b)
  state[2] = mask64((state[2] ?? 0n) + c)
  state[3] = mask64((state[3] ?? 0n) + d)
  state[4] = mask64((state[4] ?? 0n) + e)
  state[5] = mask64((state[5] ?? 0n) + f)
  state[6] = mask64((state[6] ?? 0n) + g)
  state[7] = mask64((state[7] ?? 0n) + h)
}

/** 读取 big-endian 64 位整数。 */
function readUint64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n

  for (let index = 0; index < 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0)
  }

  return value
}

/** 写入 big-endian 64 位整数。 */
function writeUint64(bytes: Uint8Array, offset: number, value: bigint): void {
  for (let index = 7; index >= 0; index -= 1) {
    bytes[offset + index] = Number(value & 0xffn)
    value >>= 8n
  }
}

/** SHA-512 选择函数。 */
function choose(x: bigint, y: bigint, z: bigint): bigint {
  return (x & y) ^ (~x & z)
}

/** SHA-512 多数函数。 */
function majority(x: bigint, y: bigint, z: bigint): bigint {
  return (x & y) ^ (x & z) ^ (y & z)
}

/** SHA-512 大写 Sigma0。 */
function bigSigma0(value: bigint): bigint {
  return rotateRight64(value, 28n) ^ rotateRight64(value, 34n) ^ rotateRight64(value, 39n)
}

/** SHA-512 大写 Sigma1。 */
function bigSigma1(value: bigint): bigint {
  return rotateRight64(value, 14n) ^ rotateRight64(value, 18n) ^ rotateRight64(value, 41n)
}

/** SHA-512 小写 sigma0。 */
function smallSigma0(value: bigint): bigint {
  return rotateRight64(value, 1n) ^ rotateRight64(value, 8n) ^ (value >> 7n)
}

/** SHA-512 小写 sigma1。 */
function smallSigma1(value: bigint): bigint {
  return rotateRight64(value, 19n) ^ rotateRight64(value, 61n) ^ (value >> 6n)
}

/** 执行 64 位循环右移。 */
function rotateRight64(value: bigint, bits: bigint): bigint {
  return mask64((value >> bits) | (value << (64n - bits)))
}

/** 截断为无符号 64 位。 */
function mask64(value: bigint): bigint {
  return value & UINT64_MASK
}

/** 将字节串解释为 little-endian bigint。 */
function bytesToBigIntLittle(bytes: Uint8Array): bigint {
  let value = 0n

  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    value = (value << 8n) | BigInt(bytes[index] ?? 0)
  }

  return value
}

/** 将 bigint 输出为定长 little-endian 字节。 */
function bigIntToBytesLittle(value: bigint, length: number): Uint8Array {
  const bytes = new Uint8Array(length)

  for (let index = 0; index < length; index += 1) {
    bytes[index] = Number(value & 0xffn)
    value >>= 8n
  }

  return bytes
}

/** 拼接多个字节串。 */
function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const output = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.length
  }

  return output
}

/** 比较两个字节串是否完全一致。 */
function areBytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false
  }

  let diff = 0
  for (let index = 0; index < left.length; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0)
  }

  return diff === 0
}

/** 计算正模。 */
function mod(value: bigint, modulus: bigint): bigint {
  const result = value % modulus

  return result >= 0n ? result : result + modulus
}

/** 模幂。 */
function powMod(base: bigint, exponent: bigint, modulus: bigint): bigint {
  let result = 1n
  let value = mod(base, modulus)
  let power = exponent

  while (power > 0n) {
    if ((power & 1n) === 1n) {
      result = mod(result * value, modulus)
    }
    value = mod(value * value, modulus)
    power >>= 1n
  }

  return result
}

/** 模逆。 */
function invertMod(value: bigint, modulus: bigint): bigint {
  return powMod(value, modulus - 2n, modulus)
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
