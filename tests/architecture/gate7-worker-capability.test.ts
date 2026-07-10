/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 前置的 docx/pdf/native Worker 能力检测公开 API。
 * 边界：只验证同步环境检测、稳定 unavailable 诊断和 CSP 指令清单，不启动真实 Web Worker。
 * 协作模块：packages/docx、packages/pdf、packages/native 的 public entry 与诊断 registry。
 * 约束：Worker 不可用时只能返回稳定诊断，不走同线程 fallback。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  DOCX_WORKER_CSP_DIRECTIVES,
  detectDocxWorkerCapability
} from '../../packages/docx/src/index'
import {
  PDF_WORKER_CSP_DIRECTIVES,
  detectPdfWorkerCapability
} from '../../packages/pdf/src/index'
import {
  JWORD_NATIVE_WORKER_CSP_DIRECTIVES,
  detectJWordNativeWorkerCapability
} from '../../packages/native/src/index'

describe('Gate 7 Worker capability detection', () => {
  it('reports docx/pdf/native Worker unavailable with stable diagnostics and no fallback', () => {
    const docx = detectDocxWorkerCapability({
      requestId: 'docx-worker-capability-1',
      globalScope: {}
    })
    const pdf = detectPdfWorkerCapability({
      requestId: 'pdf-worker-capability-1',
      globalScope: {}
    })
    const native = detectJWordNativeWorkerCapability({
      requestId: 'native-worker-capability-1',
      globalScope: {}
    })

    expect(docx).toMatchObject({
      status: 'unavailable',
      fallback: 'none',
      cspDirectives: DOCX_WORKER_CSP_DIRECTIVES,
      missingRequirements: ['worker-constructor', 'blob-constructor', 'blob-url', 'array-buffer'],
      diagnostic: {
        name: 'DocxUnsupportedError',
        code: 'DOCX_WORKER_UNAVAILABLE',
        requestId: 'docx-worker-capability-1'
      }
    })
    expect(pdf).toMatchObject({
      status: 'unavailable',
      fallback: 'none',
      cspDirectives: PDF_WORKER_CSP_DIRECTIVES,
      missingRequirements: ['worker-constructor', 'blob-constructor', 'blob-url', 'array-buffer'],
      diagnostic: {
        code: 'PDF_WORKER_UNAVAILABLE',
        requestId: 'pdf-worker-capability-1'
      }
    })
    expect(native).toMatchObject({
      status: 'unavailable',
      fallback: 'none',
      cspDirectives: JWORD_NATIVE_WORKER_CSP_DIRECTIVES,
      missingRequirements: ['worker-constructor', 'blob-constructor', 'blob-url', 'array-buffer'],
      diagnostic: {
        code: 'JWORD_NATIVE_WORKER_UNAVAILABLE',
        requestId: 'native-worker-capability-1'
      }
    })
  })

  it('reports Worker available when the host exposes the required primitives', () => {
    const globalScope = createWorkerCapableScope()

    const docx = detectDocxWorkerCapability({ globalScope })
    const pdf = detectPdfWorkerCapability({ globalScope })
    const native = detectJWordNativeWorkerCapability({ globalScope })

    expect(docx).toMatchObject({
      status: 'available',
      missingRequirements: []
    })
    expect(pdf).toMatchObject({
      status: 'available',
      missingRequirements: []
    })
    expect(native).toMatchObject({
      status: 'available',
      missingRequirements: []
    })
    expect(docx.diagnostic).toBeUndefined()
    expect(pdf.diagnostic).toBeUndefined()
    expect(native.diagnostic).toBeUndefined()
  })
})

/** 创建具备 Worker 基础能力的宿主全局对象。 */
function createWorkerCapableScope(): unknown {
  return {
    Worker: createNoopConstructor,
    Blob: createNoopConstructor,
    ArrayBuffer,
    URL: {
      createObjectURL: () => 'blob:https://example.invalid/jword-worker',
      revokeObjectURL: () => undefined
    }
  }
}

/** 作为 feature detection 的构造函数占位。 */
function createNoopConstructor(): void {}
