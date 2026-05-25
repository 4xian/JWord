/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 DOCX worker 最小运行时入口。
 * 边界：只验证 worker 消息分发、取消响应和导入导出响应，不验证浏览器 worker 加载策略。
 * 协作模块：packages/docx/src/worker.ts、importDocx、exportDocx 和 inspectDocxPackage。
 * 约束：worker 入口必须可单测，也必须能作为 Rollup worker entry 独立构建。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-26---建立-benchmarkbundle-和回归门禁。
 */
import { describe, expect, it } from 'vitest'

import type { DocumentProjection } from '@4xian/jword-core'

import { createCancelDocxRequest, exportDocx, type DocxWorkerEvent } from '../src/index'
import { dispatchDocxWorkerRequest } from '../src/worker'

describe('@4xian/jword-docx worker runtime', () => {
  it('dispatches cancel requests and posts the stable response', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      createCancelDocxRequest('docx-worker-cancel-1'),
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toEqual({
      type: 'error',
      requestId: 'docx-worker-cancel-1',
      error: {
        name: 'DocxUnsupportedError',
        code: 'DOCX_WORKER_CANCELLED',
        message: '任务已取消',
        requestId: 'docx-worker-cancel-1'
      }
    })
    expect(posted).toEqual([event])
  })

  it('aborts an in-flight export with the same request id and does not post its stale result', async () => {
    const posted: DocxWorkerEvent[] = []
    const exportTask = dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId: 'docx-worker-cancel-running-1',
        document: createWorkerProjection(),
        options: {
          requestId: 'docx-worker-cancel-running-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )
    const cancelEvent = await dispatchDocxWorkerRequest(
      createCancelDocxRequest('docx-worker-cancel-running-1'),
      (response) => {
        posted.push(response)
      }
    )
    const exportEvent = await exportTask

    expect(cancelEvent).toEqual({
      type: 'error',
      requestId: 'docx-worker-cancel-running-1',
      error: {
        name: 'DocxUnsupportedError',
        code: 'DOCX_WORKER_CANCELLED',
        message: '任务已取消',
        requestId: 'docx-worker-cancel-running-1'
      }
    })
    expect(exportEvent).toMatchObject({
      type: 'error',
      requestId: 'docx-worker-cancel-running-1',
      error: {
        code: 'DOCX_USER_CANCELLED',
        requestId: 'docx-worker-cancel-running-1'
      }
    })
    expect(posted).toEqual([cancelEvent])
  })

  it('aborts an in-flight inspect request with the same request id', async () => {
    const exportResult = await exportDocx(createWorkerProjection(), {
      requestId: 'docx-worker-inspect-source-1'
    })
    const posted: DocxWorkerEvent[] = []
    const inspectTask = dispatchDocxWorkerRequest(
      {
        type: 'inspect',
        requestId: 'docx-worker-cancel-inspect-1',
        input: exportResult.bytes,
        options: {
          requestId: 'docx-worker-cancel-inspect-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )
    const cancelEvent = await dispatchDocxWorkerRequest(
      createCancelDocxRequest('docx-worker-cancel-inspect-1'),
      (response) => {
        posted.push(response)
      }
    )
    const inspectEvent = await inspectTask

    expect(inspectEvent).toMatchObject({
      type: 'error',
      requestId: 'docx-worker-cancel-inspect-1',
      error: {
        code: 'DOCX_USER_CANCELLED',
        requestId: 'docx-worker-cancel-inspect-1'
      }
    })
    expect(posted).toEqual([cancelEvent])
  })

  it('dispatches export requests and posts the DOCX result response', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId: 'docx-worker-export-1',
        document: createWorkerProjection(),
        options: {
          requestId: 'docx-worker-export-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toMatchObject({
      type: 'export-result',
      requestId: 'docx-worker-export-1',
      result: {
        warnings: [],
        diagnostics: {
          requestId: 'docx-worker-export-1',
          mainDocumentPart: 'word/document.xml'
        }
      }
    })
    expect(posted).toEqual([event])
  })

  it('dispatches import requests and posts the DOCX import response', async () => {
    const exportResult = await exportDocx(createWorkerProjection(), {
      requestId: 'docx-worker-import-source-1'
    })
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'import',
        requestId: 'docx-worker-import-1',
        input: exportResult.bytes,
        options: {
          requestId: 'docx-worker-import-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toMatchObject({
      type: 'import-result',
      requestId: 'docx-worker-import-1',
      result: {
        warnings: [],
        diagnostics: {
          requestId: 'docx-worker-import-1',
          mainDocumentPart: 'word/document.xml'
        }
      }
    })
    expect(posted).toEqual([event])
  })
})

/** 创建 DOCX worker 测试使用的最小 projection。 */
function createWorkerProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-docx-worker',
      sections: [
        {
          kind: 'section',
          id: 'section-docx-worker',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-docx-worker',
              runs: [
                {
                  kind: 'run',
                  id: 'run-docx-worker',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'DOCX worker'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
