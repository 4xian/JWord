/**
 * 职责：为 persistence metadata 提供同步、浏览器可用的 SHA-256 摘要计算。
 * 边界：只处理 Uint8Array 字节，不访问 Node crypto、WebCrypto、IndexedDB 或 Y.Doc。
 * 协作模块：persistence memory adapter 用它生成 update、snapshot 和版本记录的 sha256 字段。
 * 性能/安全约束：实现用于元数据完整性校验，不作为密码学密钥派生或认证方案。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

const SHA256_INITIAL_STATE = new Uint32Array([
  0x6a09e667,
  0xbb67ae85,
  0x3c6ef372,
  0xa54ff53a,
  0x510e527f,
  0x9b05688c,
  0x1f83d9ab,
  0x5be0cd19
])

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3,
  0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
])

/** 计算字节内容的标准 SHA-256 十六进制摘要。 */
export function hashSha256Bytes(bytes: Uint8Array): string {
  const padded = padSha256Input(bytes)
  const state = new Uint32Array(SHA256_INITIAL_STATE)
  const words = new Uint32Array(64)

  for (let offset = 0; offset < padded.length; offset += 64) {
    fillMessageSchedule(words, padded, offset)
    compressChunk(state, words)
  }

  return Array.from(state)
    .map((value) => value.toString(16).padStart(8, '0'))
    .join('')
}

/** 生成符合 SHA-256 规则的 512-bit 对齐输入。 */
function padSha256Input(bytes: Uint8Array): Uint8Array {
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64
  const padded = new Uint8Array(paddedLength)
  const lengthOffset = paddedLength - 8
  const bitLengthHigh = Math.floor(bytes.length / 0x20000000) >>> 0
  const bitLengthLow = (bytes.length << 3) >>> 0

  padded.set(bytes)
  padded[bytes.length] = 0x80
  padded[lengthOffset] = (bitLengthHigh >>> 24) & 0xff
  padded[lengthOffset + 1] = (bitLengthHigh >>> 16) & 0xff
  padded[lengthOffset + 2] = (bitLengthHigh >>> 8) & 0xff
  padded[lengthOffset + 3] = bitLengthHigh & 0xff
  padded[lengthOffset + 4] = (bitLengthLow >>> 24) & 0xff
  padded[lengthOffset + 5] = (bitLengthLow >>> 16) & 0xff
  padded[lengthOffset + 6] = (bitLengthLow >>> 8) & 0xff
  padded[lengthOffset + 7] = bitLengthLow & 0xff

  return padded
}

/** 将一个 512-bit chunk 扩展为 64 个 round word。 */
function fillMessageSchedule(words: Uint32Array, bytes: Uint8Array, offset: number): void {
  for (let index = 0; index < 16; index += 1) {
    const byteOffset = offset + index * 4
    words[index] = (
      ((bytes[byteOffset] ?? 0) << 24) |
      ((bytes[byteOffset + 1] ?? 0) << 16) |
      ((bytes[byteOffset + 2] ?? 0) << 8) |
      (bytes[byteOffset + 3] ?? 0)
    ) >>> 0
  }

  for (let index = 16; index < 64; index += 1) {
    const left = words[index - 15] ?? 0
    const right = words[index - 2] ?? 0
    const sigma0 = rightRotate(left, 7) ^ rightRotate(left, 18) ^ (left >>> 3)
    const sigma1 = rightRotate(right, 17) ^ rightRotate(right, 19) ^ (right >>> 10)
    words[index] = ((words[index - 16] ?? 0) + sigma0 + (words[index - 7] ?? 0) + sigma1) >>> 0
  }
}

/** 将一个 message schedule 压缩进 8 个 hash state word。 */
function compressChunk(state: Uint32Array, words: Uint32Array): void {
  let a = state[0] ?? 0
  let b = state[1] ?? 0
  let c = state[2] ?? 0
  let d = state[3] ?? 0
  let e = state[4] ?? 0
  let f = state[5] ?? 0
  let g = state[6] ?? 0
  let h = state[7] ?? 0

  for (let index = 0; index < 64; index += 1) {
    const sigma1 = rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)
    const choose = (e & f) ^ (~e & g)
    const temp1 = (h + sigma1 + choose + (SHA256_ROUND_CONSTANTS[index] ?? 0) + (words[index] ?? 0)) >>> 0
    const sigma0 = rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)
    const majority = (a & b) ^ (a & c) ^ (b & c)
    const temp2 = (sigma0 + majority) >>> 0

    h = g
    g = f
    f = e
    e = (d + temp1) >>> 0
    d = c
    c = b
    b = a
    a = (temp1 + temp2) >>> 0
  }

  state[0] = ((state[0] ?? 0) + a) >>> 0
  state[1] = ((state[1] ?? 0) + b) >>> 0
  state[2] = ((state[2] ?? 0) + c) >>> 0
  state[3] = ((state[3] ?? 0) + d) >>> 0
  state[4] = ((state[4] ?? 0) + e) >>> 0
  state[5] = ((state[5] ?? 0) + f) >>> 0
  state[6] = ((state[6] ?? 0) + g) >>> 0
  state[7] = ((state[7] ?? 0) + h) >>> 0
}

/** 执行 SHA-256 使用的 32-bit 循环右移。 */
function rightRotate(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0
}
