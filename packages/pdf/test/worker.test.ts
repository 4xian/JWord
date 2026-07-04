/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 Iteration 21 的 PDF worker 最小运行时入口。
 * 边界：只验证 worker 消息分发和取消/错误响应，不验证真实 PDF 绘制。
 * 协作模块：packages/pdf/src/worker.ts、handlePdfWorkerRequest 和 core layout。
 * 约束：worker 入口必须可单测，也必须能作为 Rollup 的 worker entry 独立构建。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-21---建立-packagespdf-与-pdf-worker。
 */

import {
  createFontManager,
  createPageConfig,
  type DocumentLayout,
  layoutDocument
} from '@4xian/jword-core'
import { createInsecureTestOnlyJWordLicenseSignature, type JWordLicenseEntitlement, type JWordLicenseSignaturePayload } from '@4xian/jword-license'
import { describe, expect, it } from 'vitest'

import type {
  PdfExportImageInput,
  PdfImageAsset,
  PdfWorkerResponse
} from '../src/index'
import {
  createCancelPdfWorkerRequest,
  createPdfErrorResponse,
  createPdfProgressResponse,
  createPdfTransferables,
  dispatchPdfWorkerRequest,
  handlePdfWorkerRequest,
  readPdfImageAsset
} from '../src/worker'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

describe('@4xian/jword-pdf worker runtime', () => {
  it('fails export before mapping layout when license is missing', async () => {
    const posted: PdfWorkerResponse[] = []
    const response = await dispatchPdfWorkerRequest(
      {
        kind: 'export-layout',
        requestId: 'pdf-worker-license-missing-1',
        layout: createEmptyLayout(),
        options: {
          requestId: 'pdf-worker-license-missing-1'
        }
      },
      (event) => {
        posted.push(event)
      }
    )

    expect(response).toMatchObject({
      kind: 'error',
      error: {
        code: 'JWORD_LICENSE_MISSING',
        feature: 'pdf.export',
        requestId: 'pdf-worker-license-missing-1'
      }
    })
    expect(posted).toEqual([response])
  })

  it('fails export when license lacks the PDF feature', async () => {
    const posted: PdfWorkerResponse[] = []
    const response = await dispatchPdfWorkerRequest(
      {
        kind: 'export-layout',
        requestId: 'pdf-worker-license-mismatch-1',
        layout: createEmptyLayout(),
        options: {
          requestId: 'pdf-worker-license-mismatch-1',
          license: createWorkerLicense(['docx.import'])
        }
      },
      (event) => {
        posted.push(event)
      }
    )

    expect(response).toMatchObject({
      kind: 'error',
      error: {
        code: 'JWORD_FEATURE_NOT_ENTITLED',
        feature: 'pdf.export',
        requestId: 'pdf-worker-license-mismatch-1'
      }
    })
    expect(posted).toEqual([response])
  })

  it('dispatches cancel requests and posts the stable response', async () => {
    const posted: PdfWorkerResponse[] = []
    const response = await dispatchPdfWorkerRequest(
      createCancelPdfWorkerRequest('pdf-worker-cancel-2'),
      (event) => {
        posted.push(event)
      }
    )

    expect(response).toEqual({
      kind: 'error',
      error: {
        code: 'PDF_EXPORT_CANCELLED',
        message: '导出已取消',
        requestId: 'pdf-worker-cancel-2',
        cancelled: true
      }
    })
    expect(posted).toEqual([response])
  })

  it('aborts an in-flight export with the same request id and does not post its stale result', async () => {
    const posted: PdfWorkerResponse[] = []
    const exportTask = dispatchPdfWorkerRequest(
      {
        kind: 'export-layout',
        requestId: 'pdf-worker-cancel-running-2',
        layout: createEmptyLayout(),
        options: {
          requestId: 'pdf-worker-cancel-running-2',
          license: createWorkerLicense(['pdf.export'])
        }
      },
      (event) => {
        posted.push(event)
      }
    )
    const cancelResponse = await dispatchPdfWorkerRequest(
      createCancelPdfWorkerRequest('pdf-worker-cancel-running-2'),
      (event) => {
        posted.push(event)
      }
    )
    const exportResponse = await exportTask

    expect(cancelResponse).toEqual({
      kind: 'error',
      error: {
        code: 'PDF_EXPORT_CANCELLED',
        message: '导出已取消',
        requestId: 'pdf-worker-cancel-running-2',
        cancelled: true
      }
    })
    expect(exportResponse).toMatchObject({
      kind: 'error',
      error: {
        code: 'PDF_EXPORT_CANCELLED',
        requestId: 'pdf-worker-cancel-running-2',
        cancelled: true
      }
    })
    expect(posted).toEqual([cancelResponse])
  })

  it('dispatches export requests and posts the PDF result response', async () => {
    const posted: PdfWorkerResponse[] = []
    const response = await dispatchPdfWorkerRequest(
      {
        kind: 'export-layout',
        requestId: 'pdf-worker-export-2',
        layout: createEmptyLayout(),
        options: {
          requestId: 'pdf-worker-export-2',
          license: createWorkerLicense(['pdf.export'])
        }
      },
      (event) => {
        posted.push(event)
      }
    )

    expect(response).toMatchObject({
      kind: 'result',
      result: {
        warnings: [],
        progress: [
          { stage: 'queued', requestId: 'pdf-worker-export-2' },
          { stage: 'mapping', requestId: 'pdf-worker-export-2' },
          { stage: 'writing', requestId: 'pdf-worker-export-2' },
          { stage: 'done', requestId: 'pdf-worker-export-2' }
        ]
      }
    })
    expect(posted).toEqual([response])
  })

  it('handles PDF worker export and cancel messages with stable responses', async () => {
    const exportResponse = await handlePdfWorkerRequest({
      kind: 'export-layout',
      requestId: 'pdf-worker-export-1',
      layout: createEmptyLayout(),
      options: {
        requestId: 'pdf-worker-export-1',
        license: createWorkerLicense(['pdf.export'])
      }
    })
    const cancelResponse = await handlePdfWorkerRequest(createCancelPdfWorkerRequest('pdf-worker-cancel-1'))

    expect(exportResponse).toMatchObject({
      kind: 'result',
      result: {
        warnings: [],
        progress: [
          { stage: 'queued', requestId: 'pdf-worker-export-1' },
          { stage: 'mapping', requestId: 'pdf-worker-export-1' },
          { stage: 'writing', requestId: 'pdf-worker-export-1' },
          { stage: 'done', requestId: 'pdf-worker-export-1' }
        ]
      }
    })
    expect(cancelResponse).toEqual({
      kind: 'error',
      error: {
        code: 'PDF_EXPORT_CANCELLED',
        message: '导出已取消',
        requestId: 'pdf-worker-cancel-1',
        cancelled: true
      }
    })
  })

  it('creates stable worker messages and PDF transferables', () => {
    const buffer = new ArrayBuffer(4)

    expect(createPdfProgressResponse('pdf-worker-1', 'font-loading')).toEqual({
      kind: 'progress',
      progress: {
        requestId: 'pdf-worker-1',
        stage: 'font-loading'
      }
    })
    expect(createCancelPdfWorkerRequest('pdf-worker-1')).toEqual({
      kind: 'cancel',
      requestId: 'pdf-worker-1'
    })
    expect(createPdfErrorResponse({
      code: 'PDF_EXPORT_CANCELLED',
      message: '导出已取消',
      requestId: 'pdf-worker-1',
      cancelled: true
    })).toEqual({
      kind: 'error',
      error: {
        code: 'PDF_EXPORT_CANCELLED',
        message: '导出已取消',
        requestId: 'pdf-worker-1',
        cancelled: true
      }
    })
    expect(createPdfTransferables(buffer)).toEqual([buffer])
    expect(createPdfTransferables(new Uint8Array(buffer))).toEqual([buffer])
  })

  it('parses image inputs through worker-only helper API', async () => {
    const dataUrlInput: PdfExportImageInput = {
      kind: 'dataUrl',
      id: 'image-1',
      dataUrl: 'data:image/png;base64,AA==',
      alt: 'Logo'
    }
    const binaryInput: PdfExportImageInput = {
      kind: 'arrayBuffer',
      id: 'image-2',
      data: new ArrayBuffer(1),
      mimeType: 'image/jpeg'
    }
    const blobInput: PdfExportImageInput = {
      kind: 'blob',
      id: 'image-3',
      blob: new Blob([new Uint8Array([0])], { type: 'image/png' })
    }
    const parsed: PdfImageAsset = await readPdfImageAsset(dataUrlInput)

    expect(dataUrlInput.kind).toBe('dataUrl')
    expect(binaryInput.mimeType).toBe('image/jpeg')
    expect(blobInput.blob.type).toBe('image/png')
    expect(await readPdfImageAsset(binaryInput)).toMatchObject({
      id: 'image-2',
      mimeType: 'image/jpeg'
    })
    expect(await readPdfImageAsset(blobInput)).toMatchObject({
      id: 'image-3',
      mimeType: 'image/png'
    })
    expect(parsed).toEqual({
      id: 'image-1',
      mimeType: 'image/png',
      bytes: new Uint8Array([0]),
      alt: 'Logo'
    })
  })
})

/** 创建 PDF worker 测试使用的有效授权。 */
function createWorkerLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-pdf-worker',
    licenseToken: 'token-pdf-worker',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid' as const
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 创建 worker 测试使用的最小空 layout。 */
function createEmptyLayout(): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-empty',
        sections: []
      }
    },
    pageConfig: createPageConfig(),
    fontManager: createFontManager()
  })
}
