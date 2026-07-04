/**
 * 职责：解析 PDF 导出前的图片输入为 renderer 可消费的二进制资源。
 * 边界：只处理 data URL、Blob 与 ArrayBuffer 输入，不执行 PDF 绘制、不访问 worker 生命周期。
 * 协作模块：index.ts 的 PDF renderer 与 worker 入口共同复用图片资产解析。
 * 性能/安全约束：只接受 PNG/JPEG，返回独立字节视图，避免把不支持格式静默写入 PDF。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#313-发布no-alias-消费闭环phase-6m按-d2-执行。
 */

import type { PdfErrorCode } from './diagnostics.js'
import type {
  PdfDataUrlImageInput,
  PdfExportImageInput,
  PdfImageAsset
} from './types.js'

/** 读取 PDF 导出前需要的图片资源字节和 MIME 元数据。 */
export async function readPdfImageAsset(input: PdfExportImageInput): Promise<PdfImageAsset> {
  if (input.kind === 'dataUrl') {
    const asset = readDataUrlImageAsset(input)

    return {
      id: input.id,
      mimeType: asset.mimeType,
      bytes: asset.bytes,
      ...(input.alt === undefined ? {} : { alt: input.alt })
    }
  }

  if (input.kind === 'blob') {
    return {
      id: input.id,
      mimeType: readSupportedImageMimeType(input.blob.type),
      bytes: new Uint8Array(await input.blob.arrayBuffer()),
      ...(input.alt === undefined ? {} : { alt: input.alt })
    }
  }

  return {
    id: input.id,
    mimeType: readSupportedImageMimeType(input.mimeType),
    bytes: readArrayBufferViewBytes(input.data),
    ...(input.alt === undefined ? {} : { alt: input.alt })
  }
}

/** 读取 data URL 图片资源。 */
function readDataUrlImageAsset(input: PdfDataUrlImageInput): Pick<PdfImageAsset, 'mimeType' | 'bytes'> {
  const match = /^data:([^;,]+);base64,(.*)$/u.exec(input.dataUrl)

  if (match === null) {
    throw createUnsupportedPdfImageError('PDF_IMAGE_INVALID')
  }

  return {
    mimeType: readSupportedImageMimeType(match[1] ?? ''),
    bytes: readBase64Bytes(match[2] ?? '')
  }
}

/** 限制当前 PDF 图片 API 只接收 renderer 已支持的格式。 */
function readSupportedImageMimeType(mimeType: string): string {
  if (mimeType === 'image/png' || mimeType === 'image/jpeg') {
    return mimeType
  }

  throw createUnsupportedPdfImageError('PDF_IMAGE_UNSUPPORTED')
}

/** 把 ArrayBuffer 或 view 转成独立 Uint8Array。 */
function readArrayBufferViewBytes(data: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data)
  }

  return new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength))
}

/** 读取 base64 图片字节。 */
function readBase64Bytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

/** 创建稳定 PDF 图片错误。 */
function createUnsupportedPdfImageError(code: PdfErrorCode): Error & { readonly code: PdfErrorCode } {
  const error = new Error(code) as Error & { code: PdfErrorCode }

  error.name = 'PdfExportUnsupportedError'
  error.code = code

  return error
}
