/**
 * @fileoverview 职责: 锁定 Gate 4 第一版 media panel 的纯函数契约，包括 allowlist、失败恢复 token 和 applied/deferred 文案。
 * 边界: 只覆盖 packages/ui 的纯状态与策略，不验证 editor facade、真实上传或 demo 宿主。
 * 协作: packages/ui/src/media/policy.ts 与 packages/ui/src/media/state.ts。
 * 约束: 断言只依赖公开或同包可复用 helper，不把 DOM/adapter 细节当契约。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 1。
 */
import { describe, expect, test } from 'vitest'
import { isAllowedJWordMediaUrl } from '../src/media/policy'
import {
  applyMediaPanelFailure,
  applyMediaPanelUploadSuccess,
  createPendingMediaPanelItem,
  readDefaultAppliedMessage,
  readDefaultDeferredMessage
} from '../src/media/state'

describe('media policy and state helpers', () => {
  test('默认只允许 data/blob 和显式放行的 http url', () => {
    expect(isAllowedJWordMediaUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe(true)
    expect(isAllowedJWordMediaUrl('blob:https://example.com/demo')).toBe(true)
    expect(isAllowedJWordMediaUrl('https://example.com/image.svg')).toBe(false)
    expect(isAllowedJWordMediaUrl('https://demo.local/image.svg', {
      allowExternalUrl: (url) => url.hostname === 'demo.local'
    })).toBe(true)
  })

  test('成功结果会按 applied/deferred fallback 文案归一化，失败结果保留 retry token', () => {
    const pendingItem = createPendingMediaPanelItem({
      source: {
        kind: 'url',
        url: 'https://demo.local/media-inline.svg'
      },
      mode: 'block'
    })
    const deferredItem = applyMediaPanelUploadSuccess(pendingItem, {
      kind: 'resource',
      id: 'resource-1',
      mime: 'image/svg+xml',
      source: {
        kind: 'externalUrl',
        url: 'https://demo.local/media-inline.svg'
      },
      status: 'success'
    }, {
      kind: 'deferred'
    })
    const appliedItem = applyMediaPanelUploadSuccess(pendingItem, {
      kind: 'resource',
      id: 'resource-2',
      mime: 'image/svg+xml',
      source: {
        kind: 'externalUrl',
        url: 'https://demo.local/media-inline.svg'
      },
      status: 'success'
    }, {
      kind: 'applied'
    })
    const failedItem = applyMediaPanelFailure(deferredItem, {
      code: 'UPLOAD_FAILED',
      message: '上传失败，可重试。'
    }, 'retry-token-1')

    expect(deferredItem.applyMessage).toBe(readDefaultDeferredMessage('block'))
    expect(deferredItem.applyState).toBe('deferred')
    expect(appliedItem.applyMessage).toBe(readDefaultAppliedMessage('block'))
    expect(appliedItem.applyState).toBe('applied')
    expect(failedItem.retryToken).toBe('retry-token-1')
    expect(failedItem.error?.message).toBe('上传失败，可重试。')
  })
})
