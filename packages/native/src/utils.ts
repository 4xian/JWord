/**
 * 职责：提供 native package 内部共享的 JSON、字节和对象判断 helper。
 * 边界：不理解 .jword 业务结构，不读取 zip，也不产生诊断。
 * 协作模块：index.ts 保存打开流程和 messages.ts worker 消息 helper。
 * 性能/安全约束：字节 helper 总是返回独立 ArrayBuffer，避免共享外部可变视图。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
export type JsonRecord = Record<string, unknown>

/** 拷贝 Uint8Array 为标准 ArrayBuffer。 */
export function copyBytesToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  const view = new Uint8Array(buffer)

  view.set(bytes)

  return buffer
}

/** 计算 SHA-256 十六进制摘要。 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', copyBytesToArrayBuffer(bytes))

  return bytesToHex(new Uint8Array(digest))
}

/** 序列化稳定 JSON。 */
export function stringifyJson(input: unknown): string {
  return `${JSON.stringify(input, rejectNonFiniteJsonNumber, 2)}\n`
}

/** 在 JSON.stringify 静默转换前拒绝非有限数字。 */
function rejectNonFiniteJsonNumber(_key: string, value: unknown): unknown {
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new TypeError('non-finite JSON number')
  }

  return value
}

/** 判断未知值是否为对象记录。 */
export function isRecord(input: unknown): input is JsonRecord {
  return typeof input === 'object' && input !== null && !Array.isArray(input)
}

/** 把字节转换为十六进制。 */
function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}
