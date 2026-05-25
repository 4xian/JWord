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
import { describe, expect, it } from 'vitest'

import { createCancelPdfWorkerRequest, type PdfWorkerResponse } from '../src/index'
import { dispatchPdfWorkerRequest } from '../src/worker'

describe('@4xian/jword-pdf worker runtime', () => {
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
          requestId: 'pdf-worker-cancel-running-2'
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
          requestId: 'pdf-worker-export-2'
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
})

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
