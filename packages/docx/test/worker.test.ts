/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 DOCX worker 最小运行时入口。
 * 边界：只验证 worker 消息分发、取消响应和导入导出响应，不验证浏览器 worker 加载策略。
 * 协作模块：packages/docx/src/worker.ts、importDocx、exportDocx 和 inspectDocxPackage。
 * 约束：worker 入口必须可单测，也必须能作为 Rollup worker entry 独立构建。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it } from 'vitest'

import type { DocumentProjection } from '@4xian/jword-core'
import { createInsecureTestOnlyJWordLicenseSignature, type JWordLicenseEntitlement, type JWordLicenseSignaturePayload } from '@4xian/jword-license'

import { createCancelDocxRequest, exportDocx, type DocxWorkerEvent } from '../src/index'
import { dispatchDocxWorkerRequest } from '../src/worker'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

describe('@4xian/jword-docx worker runtime', () => {
  it('fails import before reading invalid bytes when license is missing', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'import',
        requestId: 'docx-worker-license-missing-import-1',
        input: new ArrayBuffer(0),
        options: {
          requestId: 'docx-worker-license-missing-import-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toMatchObject({
      type: 'error',
      requestId: 'docx-worker-license-missing-import-1',
      error: {
        name: 'JWordLicenseError',
        code: 'JWORD_LICENSE_MISSING',
        feature: 'docx.import',
        requestId: 'docx-worker-license-missing-import-1'
      }
    })
    expect(posted).toEqual([event])
  })

  it('fails export before producing bytes when license lacks the export feature', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId: 'docx-worker-license-mismatch-export-1',
        document: createWorkerProjection(),
        options: {
          requestId: 'docx-worker-license-mismatch-export-1',
          license: createWorkerLicense(['docx.import'])
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toMatchObject({
      type: 'error',
      requestId: 'docx-worker-license-mismatch-export-1',
      error: {
        name: 'JWordLicenseError',
        code: 'JWORD_FEATURE_NOT_ENTITLED',
        feature: 'docx.export',
        requestId: 'docx-worker-license-mismatch-export-1'
      }
    })
    expect(posted).toEqual([event])
  })

  it('fails inspect before reading invalid bytes when license is missing', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'inspect',
        requestId: 'docx-worker-license-missing-inspect-1',
        input: new ArrayBuffer(0),
        options: {
          requestId: 'docx-worker-license-missing-inspect-1'
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(event).toMatchObject({
      type: 'error',
      requestId: 'docx-worker-license-missing-inspect-1',
      error: {
        name: 'JWordLicenseError',
        code: 'JWORD_LICENSE_MISSING',
        feature: 'docx.import',
        requestId: 'docx-worker-license-missing-inspect-1'
      }
    })
    expect(posted).toEqual([event])
  })

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

  it('keeps a cancel that arrives before the matching export is registered', async () => {
    const posted: DocxWorkerEvent[] = []
    const requestId = 'docx-worker-cancel-before-export-1'
    const cancelEvent = await dispatchDocxWorkerRequest(
      createCancelDocxRequest(requestId),
      (response) => {
        posted.push(response)
      }
    )
    const exportEvent = await dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId,
        document: createWorkerProjection(),
        options: {
          requestId,
          license: createWorkerLicense(['docx.export'])
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(exportEvent).toMatchObject({
      type: 'error',
      requestId,
      error: {
        code: 'DOCX_WORKER_CANCELLED',
        requestId
      }
    })
    expect(posted).toEqual([cancelEvent])
  })

  it('aborts an in-flight export with the same request id and does not post its stale result', async () => {
    const posted: DocxWorkerEvent[] = []
    const exportTask = dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId: 'docx-worker-cancel-running-1',
        document: createWorkerProjection(),
        options: {
          requestId: 'docx-worker-cancel-running-1',
          license: createWorkerLicense(['docx.export'])
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
    expect(posted).toContainEqual(cancelEvent)
    expect(posted.some((item) => item.type === 'export-result')).toBe(false)
  })

  it('aborts an in-flight inspect request with the same request id', async () => {
    const exportResult = await exportDocx(createWorkerProjection(), {
      requestId: 'docx-worker-inspect-source-1',
      license: createWorkerLicense(['docx.export'])
    })
    const posted: DocxWorkerEvent[] = []
    const inspectTask = dispatchDocxWorkerRequest(
      {
        type: 'inspect',
        requestId: 'docx-worker-cancel-inspect-1',
        input: exportResult.bytes,
        options: {
          requestId: 'docx-worker-cancel-inspect-1',
          license: createWorkerLicense(['docx.import'])
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
    expect(posted).toContainEqual(cancelEvent)
    expect(posted.some((item) => item.type === 'inspect-result')).toBe(false)
  })

  it('dispatches export requests with progress and posts the DOCX result response', async () => {
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'export',
        requestId: 'docx-worker-export-1',
        document: createWorkerProjection(),
        options: {
          requestId: 'docx-worker-export-1',
          license: createWorkerLicense(['docx.export'])
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(readPostedProgressStages(posted)).toEqual(['queued', 'writing', 'done'])
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
    expect(posted.at(-1)).toEqual(event)
  })

  it('dispatches import requests with progress and posts the DOCX import response', async () => {
    const exportResult = await exportDocx(createWorkerProjection(), {
      requestId: 'docx-worker-import-source-1',
      license: createWorkerLicense(['docx.export'])
    })
    const posted: DocxWorkerEvent[] = []
    const event = await dispatchDocxWorkerRequest(
      {
        type: 'import',
        requestId: 'docx-worker-import-1',
        input: exportResult.bytes,
        options: {
          requestId: 'docx-worker-import-1',
          license: createWorkerLicense(['docx.import'])
        }
      },
      (response) => {
        posted.push(response)
      }
    )

    expect(readPostedProgressStages(posted)).toEqual(['queued', 'reading', 'parsing', 'mapping', 'done'])
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
    expect(posted.at(-1)).toEqual(event)
  })
})

/** 读取测试中已经投递的 DOCX worker 进度阶段。 */
function readPostedProgressStages(events: readonly DocxWorkerEvent[]): readonly string[] {
  return events
    .filter((event) => event.type === 'progress')
    .map((event) => event.stage)
}

/** 创建 DOCX worker 测试使用的有效授权。 */
function createWorkerLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-docx-worker',
    licenseToken: 'token-docx-worker',
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
