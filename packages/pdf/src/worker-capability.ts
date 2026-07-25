/**
 * 职责：提供 PDF worker 宿主环境能力检测 API。
 * 边界：只做同步 feature detection，不创建真实 Worker、不导入 PDF 绘制实现。
 * 协作模块：index.ts 公开导出、diagnostics.ts 稳定错误码和 SDK CSP 文档。
 * 性能/安全约束：Worker 不可用时只返回稳定诊断，不做同线程 fallback。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { PdfError } from './types.js'

/** PDF worker host 推荐的最小 CSP 指令。 */
export const PDF_WORKER_CSP_DIRECTIVES = [
  "worker-src 'self' blob:",
  "script-src 'self' blob:"
] as const

export type PdfWorkerCapabilityStatus = 'available' | 'unavailable'

export type PdfWorkerCapabilityRequirement =
  | 'worker-constructor'
  | 'blob-constructor'
  | 'blob-url'
  | 'array-buffer'

export interface DetectPdfWorkerCapabilityOptions {
  readonly requestId?: string
  readonly globalScope?: unknown
}

export interface PdfWorkerCapability {
  readonly status: PdfWorkerCapabilityStatus
  readonly missingRequirements: readonly PdfWorkerCapabilityRequirement[]
  readonly cspDirectives: typeof PDF_WORKER_CSP_DIRECTIVES
  readonly fallback: 'none'
  readonly diagnostic?: PdfError
}

/** 检测当前宿主是否具备 PDF worker 运行所需基础能力。 */
export function detectPdfWorkerCapability(
  options: DetectPdfWorkerCapabilityOptions = {}
): PdfWorkerCapability {
  const scope = options.globalScope ?? globalThis
  const missingRequirements = readMissingPdfWorkerRequirements(scope)

  if (missingRequirements.length === 0) {
    return {
      status: 'available',
      missingRequirements,
      cspDirectives: PDF_WORKER_CSP_DIRECTIVES,
      fallback: 'none'
    }
  }

  return {
    status: 'unavailable',
    missingRequirements,
    cspDirectives: PDF_WORKER_CSP_DIRECTIVES,
    fallback: 'none',
    diagnostic: createPdfWorkerUnavailableDiagnostic(options.requestId, missingRequirements)
  }
}

/** 读取 PDF worker 缺失的宿主能力。 */
function readMissingPdfWorkerRequirements(scope: unknown): PdfWorkerCapabilityRequirement[] {
  const missingRequirements: PdfWorkerCapabilityRequirement[] = []

  if (!hasFunctionProperty(scope, 'Worker')) {
    missingRequirements.push('worker-constructor')
  }
  if (!hasFunctionProperty(scope, 'Blob')) {
    missingRequirements.push('blob-constructor')
  }
  if (!hasBlobObjectUrl(scope)) {
    missingRequirements.push('blob-url')
  }
  if (!hasFunctionProperty(scope, 'ArrayBuffer')) {
    missingRequirements.push('array-buffer')
  }

  return missingRequirements
}

/** 创建 PDF worker 不可用的稳定诊断。 */
function createPdfWorkerUnavailableDiagnostic(
  requestId: string | undefined,
  missingRequirements: readonly PdfWorkerCapabilityRequirement[]
): PdfError {
  return {
    code: 'PDF_WORKER_UNAVAILABLE',
    message: `当前环境缺少 PDF worker 基础能力：${missingRequirements.join(', ')}；不支持同线程 fallback。`,
    ...(requestId === undefined ? {} : { requestId })
  }
}

/** 判断对象属性是否为函数。 */
function hasFunctionProperty(value: unknown, property: string): boolean {
  const propertyValue = readObjectProperty(value, property)

  return typeof propertyValue === 'function'
}

/** 判断宿主是否支持 Blob object URL。 */
function hasBlobObjectUrl(scope: unknown): boolean {
  const url = readObjectProperty(scope, 'URL')

  return hasFunctionProperty(url, 'createObjectURL') && hasFunctionProperty(url, 'revokeObjectURL')
}

/** 安全读取未知对象的属性。 */
function readObjectProperty(value: unknown, property: string): unknown {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    return undefined
  }

  return Reflect.get(value, property)
}
