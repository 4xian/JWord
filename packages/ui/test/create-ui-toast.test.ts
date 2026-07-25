/**
 * @vitest-environment jsdom
 *
 * 职责：验证 JWord UI 通用 Toast 和无选区批注提示。
 * 边界：只覆盖公开 toast 接口、自动关闭、动态语言和销毁，不测试视觉颜色。
 * 协作模块：EditorShell、toast controller、live region 与 i18n。
 * 约束：通过公开实例和稳定 data attribute 断言，不读取 controller 私有状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createJWord } from '../src/index'

afterEach(() => {
  vi.useRealTimers()
  document.body.replaceChildren()
})

describe('createJWordUi toast', () => {
  test('公开 toast 会替换当前消息并按 duration 自动关闭', () => {
    vi.useFakeTimers()
    const host = document.createElement('div')

    document.body.append(host)
    const jword = createJWord({ host })
    const toast = host.querySelector<HTMLElement>('[data-jword-toast]')

    jword.ui.toast({ message: '第一条', type: 'info', duration: 1000 })

    expect(toast?.hidden).toBe(false)
    expect(toast?.textContent).toBe('第一条')
    expect(toast?.getAttribute('data-jword-toast-type')).toBe('info')

    jword.ui.toast({ message: '第二条', type: 'error', duration: 2000 })
    vi.advanceTimersByTime(1000)

    expect(toast?.hidden).toBe(false)
    expect(toast?.textContent).toBe('第二条')
    expect(toast?.getAttribute('data-jword-toast-type')).toBe('error')

    vi.advanceTimersByTime(1000)

    expect(toast?.hidden).toBe(true)
    jword.destroy()
    expect(host.querySelector('[data-jword-toast-host]')).toBeNull()
  })

  test('无选区点击批注显示当前语言的 warning Toast', () => {
    const host = document.createElement('div')

    document.body.append(host)
    const jword = createJWord({
      host,
      editor: { initialText: '正文' }
    })
    const commentButton = host.querySelector<HTMLButtonElement>('[data-jword-tool-id="insert.comment"]')
    const toast = host.querySelector<HTMLElement>('[data-jword-toast]')

    commentButton?.click()

    expect(toast?.hidden).toBe(false)
    expect(toast?.textContent).toBe('请先选择一段正文，再添加批注。')
    expect(toast?.getAttribute('data-jword-toast-type')).toBe('warning')

    jword.ui.setLocale('en-US')
    commentButton?.click()

    expect(toast?.textContent).toBe('Select document text before adding a comment.')
    expect(toast?.getAttribute('data-jword-toast-type')).toBe('warning')
    jword.destroy()
  })
})
