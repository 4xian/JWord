/**
 * @vitest-environment jsdom
 *
 * 职责：验证 UI live region 的公告优先级与销毁清理语义。
 * 边界：只覆盖 assistive live region，不验证 toolbar 或 editor 事件来源。
 * 协作：packages/ui/src/assistive/live-region.ts。
 * 约束：使用外部宿主元素，不创建编辑器实例。
 */

import { describe, expect, test } from 'vitest'

import { createLiveRegion } from '../src/assistive/live-region'

describe('createLiveRegion', () => {
  test('clears stale text when destroyed and ignores later announcements', () => {
    const host = document.createElement('div')
    const liveRegion = createLiveRegion({ host })

    liveRegion.announce('已应用加粗。')
    expect(host.textContent).toBe('已应用加粗。')

    liveRegion.destroy()
    expect(host.textContent).toBe('')

    liveRegion.announce('销毁后不应出现。', { force: true })
    expect(host.textContent).toBe('')
  })

  test('uses assertive priority for blocked or error announcements', () => {
    const host = document.createElement('div')
    const liveRegion = createLiveRegion({ host })

    liveRegion.announce('BLOCKED: 当前为只读模式。', { force: true })
    expect(host.getAttribute('aria-live')).toBe('assertive')

    liveRegion.announce('已应用加粗。', { force: true })
    expect(host.getAttribute('aria-live')).toBe('polite')
  })
})
