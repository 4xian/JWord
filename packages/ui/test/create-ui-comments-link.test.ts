/**
 * @vitest-environment jsdom
 *
 * 职责：验证 createJWordUi 对批注侧栏与链接弹窗的入口级装配。
 * 边界：只覆盖 toolbar 到 core projection 的公开链路，不测试 comments/link 子模块的内部状态细节。
 * 协作模块：packages/ui/src/create-ui.ts、comments/link controller 与 @4xian/jword-core Editor facade。
 * 约束：通过稳定 data selector 交互，避免读取 controller 私有状态。
 */

import { createEditor, createSelectionState, type Editor, type Run } from '@4xian/jword-core'
import { describe, expect, test, vi } from 'vitest'

import { createJWordUi } from '../src/create-ui'
import type { JWordCommentsOptions } from '../src/types'

describe('createJWordUi comments and link integration', () => {
  test('会从 toolbar 选区创建带当前用户的批注 thread', async () => {
    const harness = createHarness('abcdef')

    try {
      expect(harness.commentsHost?.querySelector('[data-jword-comments-sidebar="true"]')).not.toBeNull()
      const commentsHost = requireCommentsHost(harness)

      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      getRequiredButton(harness.toolbarHost, '[data-jword-insert-comment]').click()
      await flushMicrotasks()
      const input = getRequiredTextarea(commentsHost, '[data-jword-comment-input="draft"]')

      expect(document.activeElement).toBe(input)

      input.value = '  这是一条批注  '
      input.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(commentsHost, '[data-jword-comment-action="confirm-draft"]').click()

      const thread = harness.editor.getProjection().document.comments?.[0]

      expect(thread?.authorId).toBe('user-a')
      expect(thread?.messages[0]?.text).toBe('这是一条批注')
      expect(thread?.rangeSnapshot.anchor.runId).toBe('run-1')
      expect(commentsHost.textContent).toContain('这是一条批注')
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('会从 toolbar 链接弹窗把选中文本转成 core link run', async () => {
    const harness = createHarness('abcdef')

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]').click()
      const visibleTextInput = getRequiredInput(harness.linkHost, '[data-jword-link-visible-text-input]')
      const urlInput = getRequiredInput(harness.linkHost, '[data-jword-link-url-input]')

      expect(visibleTextInput.value).toBe('bcd')

      urlInput.value = 'https://example.com/doc'
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(harness.linkHost, '[data-jword-link-confirm]').click()

      const linkRun = findFirstLinkedRun(harness.editor)

      expect(linkRun?.link?.target).toBe('https://example.com/doc')
      expect(readRunText(linkRun)).toBe('bcd')
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('点击已有链接区域会循环显示和隐藏链接快捷工具', async () => {
    const harness = createHarness('abcdef')

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]').click()
      const urlInput = getRequiredInput(harness.linkHost, '[data-jword-link-url-input]')

      urlInput.value = 'https://example.com/doc'
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(harness.linkHost, '[data-jword-link-confirm]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      const linkTarget = getRequiredButton(harness.editorHost, '[data-jword-link-target-index]')

      linkTarget.click()
      await flushMicrotasks()

      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')
      const linkQuickTools = getRequiredElement(harness.linkHost, '[data-jword-link-quick-tools="true"]')
      const toolbarInsertLink = getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]')
      const panelOpenLink = getRequiredButton(harness.linkHost, '[data-jword-link-open]')
      const floatingInsertLink = getRequiredButton(floatingToolbar, '[data-jword-selection-action="insert.link"]')
      const floatingOpenLink = getRequiredButton(floatingToolbar, '[data-jword-selection-action="link.open"]')
      const floatingEditLink = getRequiredButton(floatingToolbar, '[data-jword-selection-action="link.edit"]')
      const floatingRemoveLink = getRequiredButton(floatingToolbar, '[data-jword-selection-action="link.remove"]')

      expect(floatingToolbar.hidden).toBe(false)
      expect(linkQuickTools.hidden).toBe(false)
      expect(toolbarInsertLink.disabled || toolbarInsertLink.hidden).toBe(true)
      expect(floatingInsertLink.title).toBe('插入链接')
      expect(floatingInsertLink.getAttribute('aria-label')).toBe('插入链接')
      expect(floatingInsertLink.hidden).toBe(true)
      expect(floatingInsertLink.disabled).toBe(true)
      expect(floatingOpenLink.title).toBe('打开链接')
      expect(floatingOpenLink.getAttribute('aria-label')).toBe('打开链接')
      expect(floatingOpenLink.hidden).toBe(false)
      expect(floatingOpenLink.disabled).toBe(false)
      expect(floatingEditLink.hidden).toBe(false)
      expect(floatingEditLink.disabled).toBe(false)
      expect(floatingRemoveLink.hidden).toBe(false)
      expect(floatingRemoveLink.disabled).toBe(false)
      expect(panelOpenLink.title).toBe('打开链接')
      expect(panelOpenLink.getAttribute('aria-label')).toBe('打开链接')
      expect(panelOpenLink.querySelector('[data-jword-icon="openLink"]')).not.toBeNull()
      expect(panelOpenLink.querySelector('[data-jword-icon="link"]')).toBeNull()

      linkTarget.click()
      await flushMicrotasks()
      expect(linkQuickTools.hidden).toBe(true)

      linkTarget.click()
      await flushMicrotasks()
      expect(linkQuickTools.hidden).toBe(false)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('已有链接选区右键菜单会显示链接操作并隐藏新增链接', async () => {
    const harness = createHarness('abcdef')

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]').click()
      const urlInput = getRequiredInput(harness.linkHost, '[data-jword-link-url-input]')

      urlInput.value = 'https://example.com/doc'
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(harness.linkHost, '[data-jword-link-confirm]').click()
      await flushMicrotasks()

      const linkedRun = findFirstLinkedRun(harness.editor)

      harness.editor.setSelection(createSelectionFromRun(harness.editor, linkedRun, 0, readRunText(linkedRun).length))
      harness.editorHost.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 96
      }))

      const contextMenu = getRequiredElement(harness.editorHost, '[data-jword-context-menu="true"]')

      expect(contextMenu.hidden).toBe(false)
      const insertLink = getRequiredButton(contextMenu, '[data-jword-context-action="insert.link"]')
      const openLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.open"]')
      const editLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.edit"]')
      const removeLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.remove"]')

      expect(insertLink.hidden).toBe(true)
      expect(insertLink.disabled).toBe(true)
      expect(openLink.hidden).toBe(false)
      expect(openLink.disabled).toBe(false)
      expect(editLink.hidden).toBe(false)
      expect(editLink.disabled).toBe(false)
      expect(removeLink.hidden).toBe(false)
      expect(removeLink.disabled).toBe(false)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('右键命中链接 overlay 时会按命中链接状态刷新右键菜单', async () => {
    const harness = createHarness('abcdef')

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]').click()
      const urlInput = getRequiredInput(harness.linkHost, '[data-jword-link-url-input]')

      urlInput.value = 'https://example.com/doc'
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(harness.linkHost, '[data-jword-link-confirm]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      harness.editor.setSelection(createSelection(harness.editor, 0, 1))
      const linkTarget = getRequiredButton(harness.editorHost, '[data-jword-link-target-index]')

      linkTarget.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 96
      }))

      const contextMenu = getRequiredElement(harness.editorHost, '[data-jword-context-menu="true"]')
      const insertLink = getRequiredButton(contextMenu, '[data-jword-context-action="insert.link"]')
      const openLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.open"]')
      const editLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.edit"]')
      const removeLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.remove"]')

      expect(contextMenu.hidden).toBe(false)
      expect(insertLink.hidden).toBe(true)
      expect(insertLink.disabled).toBe(true)
      expect(openLink.hidden).toBe(false)
      expect(openLink.disabled).toBe(false)
      expect(editLink.hidden).toBe(false)
      expect(editLink.disabled).toBe(false)
      expect(removeLink.hidden).toBe(false)
      expect(removeLink.disabled).toBe(false)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('非链接位置右键菜单会隐藏已有链接操作并保留插入链接', async () => {
    const harness = createHarness('abcdef')

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-link]').click()
      const urlInput = getRequiredInput(harness.linkHost, '[data-jword-link-url-input]')

      urlInput.value = 'https://example.com/doc'
      urlInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(harness.linkHost, '[data-jword-link-confirm]').click()
      await flushMicrotasks()

      harness.editor.setSelection(createSelection(harness.editor, 0, 1))
      harness.editorHost.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 80,
        clientY: 96
      }))

      const contextMenu = getRequiredElement(harness.editorHost, '[data-jword-context-menu="true"]')

      expect(contextMenu.hidden).toBe(false)
      const insertLink = getRequiredButton(contextMenu, '[data-jword-context-action="insert.link"]')
      const openLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.open"]')
      const editLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.edit"]')
      const removeLink = getRequiredButton(contextMenu, '[data-jword-context-action="link.remove"]')

      expect(insertLink.hidden).toBe(false)
      expect(insertLink.disabled).toBe(false)
      expect(openLink.hidden).toBe(true)
      expect(openLink.disabled).toBe(true)
      expect(editLink.hidden).toBe(true)
      expect(editLink.disabled).toBe(true)
      expect(removeLink.hidden).toBe(true)
      expect(removeLink.disabled).toBe(true)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('comments 为 true 时会在每页内创建默认批注 rail', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      const defaultHost = harness.editorHost.querySelector<HTMLElement>('[data-jword-comments-default-host="true"]')

      expect(defaultHost).not.toBeNull()
      expect(defaultHost?.querySelector('[data-jword-comments-sidebar="true"]')).not.toBeNull()

      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-comment]').click()

      const input = getRequiredTextarea(defaultHost ?? harness.editorHost, '[data-jword-comment-input="draft"]')

      input.value = '默认 rail 批注'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(defaultHost ?? harness.editorHost, '[data-jword-comment-action="confirm-draft"]').click()

      expect(harness.editor.getProjection().document.comments?.[0]?.messages[0]?.text).toBe('默认 rail 批注')
      const pageRail = harness.editorHost.querySelector<HTMLElement>('.jw-comments-page-rail')

      expect(pageRail).not.toBeNull()
      expect(pageRail?.textContent).toContain('默认 rail 批注')
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('默认页内批注 rail 的鼠标按下不会冒泡到编辑器宿主', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-comment]').click()
      const commentsHost = harness.editorHost.querySelector<HTMLElement>('[data-jword-comments-default-host="true"]')
      const input = getRequiredTextarea(commentsHost ?? harness.editorHost, '[data-jword-comment-input="draft"]')

      input.value = 'rail 事件回归'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(commentsHost ?? harness.editorHost, '[data-jword-comment-action="confirm-draft"]').click()

      const thread = harness.editorHost.querySelector<HTMLElement>('.jw-comments-page-rail .jw-comments-thread')

      expect(thread).not.toBeNull()

      const bubbleSpy = vi.fn()
      harness.editorHost.addEventListener('mousedown', bubbleSpy)

      thread?.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true
      }))

      expect(bubbleSpy).not.toHaveBeenCalled()

      const doubleClickSpy = vi.fn()
      harness.editorHost.addEventListener('dblclick', doubleClickSpy)

      thread?.dispatchEvent(new MouseEvent('dblclick', {
        bubbles: true,
        cancelable: true
      }))

      expect(doubleClickSpy).not.toHaveBeenCalled()
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('默认页内批注输入框保留浏览器默认聚焦行为', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))
      getRequiredButton(harness.toolbarHost, '[data-jword-insert-comment]').click()
      const commentsHost = harness.editorHost.querySelector<HTMLElement>('[data-jword-comments-default-host="true"]')
      const input = getRequiredTextarea(commentsHost ?? harness.editorHost, '[data-jword-comment-input="draft"]')
      const bubbleSpy = vi.fn()
      harness.editorHost.addEventListener('mousedown', bubbleSpy)

      const event = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true
      })

      input.dispatchEvent(event)

      expect(event.defaultPrevented).toBe(false)
      expect(bubbleSpy).not.toHaveBeenCalled()
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('默认页内批注点击回复会在当前卡片内打开回复输入', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      const thread = await createDefaultRailComment(harness, 'rail 回复回归')
      const replyButton = getRequiredButton(thread, '[data-jword-comment-action="open-reply"]')

      replyButton.click()
      await flushMicrotasks()
      await flushAnimationFrame()

      const replyInput = getRequiredTextarea(thread, '[data-jword-comment-input="reply"]')

      expect(replyInput.closest('.jw-comments-thread')).toBe(thread)
      expect(document.activeElement).toBe(replyInput)

      replyInput.value = '可以回复'
      replyInput.dispatchEvent(new Event('input', { bubbles: true }))
      await flushAnimationFrame()

      expect(getRequiredButton(thread, '[data-jword-comment-action="confirm-reply"]').disabled).toBe(false)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('默认页内批注点击编辑会在当前卡片内打开编辑输入', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      const thread = await createDefaultRailComment(harness, 'rail 编辑回归')
      const editButton = getRequiredButton(thread, '[data-jword-comment-action="edit-message"]')

      editButton.click()
      await flushMicrotasks()
      await flushAnimationFrame()

      const editInput = getRequiredTextarea(thread, '[data-jword-comment-input="edit"]')

      expect(editInput.closest('.jw-comments-thread')).toBe(thread)
      expect(document.activeElement).toBe(editInput)

      editInput.value = '已经编辑'
      editInput.dispatchEvent(new Event('input', { bubbles: true }))
      await flushAnimationFrame()

      expect(getRequiredButton(thread, '[data-jword-comment-action="confirm-edit"]').disabled).toBe(false)
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })

  test('默认页内批注回复、编辑和解决会同步当前卡片与 core projection', async () => {
    const harness = createHarness('abcdef', {
      comments: true
    })

    try {
      const thread = await createDefaultRailComment(harness, 'rail 保存回归')
      const replyButton = getRequiredButton(thread, '[data-jword-comment-action="open-reply"]')

      replyButton.click()
      await flushMicrotasks()
      await flushAnimationFrame()

      const replyInput = getRequiredTextarea(thread, '[data-jword-comment-input="reply"]')

      replyInput.value = '发送后的回复'
      replyInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(thread, '[data-jword-comment-action="confirm-reply"]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      expect(harness.editor.getProjection().document.comments?.[0]?.messages.at(-1)?.text).toBe('发送后的回复')
      expect(readDefaultRailThread(harness).textContent).toContain('发送后的回复')

      getRequiredButton(readDefaultRailThread(harness), '[data-jword-comment-action="edit-message"]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      const editThread = readDefaultRailThread(harness)
      const editInput = getRequiredTextarea(editThread, '[data-jword-comment-input="edit"]')

      editInput.value = '保存后的正文'
      editInput.dispatchEvent(new Event('input', { bubbles: true }))
      getRequiredButton(editThread, '[data-jword-comment-action="confirm-edit"]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      expect(harness.editor.getProjection().document.comments?.[0]?.messages[0]?.text).toBe('保存后的正文')
      expect(readDefaultRailThread(harness).textContent).toContain('保存后的正文')

      getRequiredButton(readDefaultRailThread(harness), '[data-jword-comment-action="toggle-resolved"]').click()
      await flushMicrotasks()
      await flushAnimationFrame()

      expect(harness.editor.getProjection().document.comments?.[0]?.resolved).toBe(true)
      expect(readDefaultRailThread(harness).textContent).toContain('已解决')
    } finally {
      await Promise.resolve()
      harness.destroy()
    }
  })
})

interface Harness {
  readonly editor: Editor
  readonly toolbarHost: HTMLDivElement
  readonly editorHost: HTMLDivElement
  readonly commentsHost: HTMLDivElement | null
  readonly linkHost: HTMLDivElement
  destroy(): void
}

interface HarnessOptions {
  readonly comments?: true | JWordCommentsOptions
}

/** 创建挂载 editor、toolbar、comments 与 link 的最小测试环境。 */
function createHarness(initialText: string, options: HarnessOptions = {}): Harness {
  const toolbarHost = document.createElement('div')
  const editorHost = document.createElement('div')
  const linkHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const commentsHost = options.comments === true
    ? null
    : options.comments?.host instanceof HTMLDivElement
      ? options.comments.host
      : document.createElement('div')
  const editor = createEditor({
    initialText,
    currentUser: {
      id: 'user-a',
      name: 'User A',
      color: '#2563eb'
    }
  })

  document.body.append(toolbarHost, editorHost, linkHost, liveRegionHost)

  if (commentsHost !== null) {
    document.body.append(commentsHost)
  }

  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    user: {
      currentUser: {
        id: 'user-a',
        name: 'User A',
        color: '#2563eb'
      }
    },
    comments: options.comments ?? (commentsHost === null ? true : { host: commentsHost }),
    link: {
      host: linkHost
    }
  })

  return {
    editor,
    toolbarHost,
    editorHost,
    commentsHost,
    linkHost,
    destroy(): void {
      ui.destroy()
      editor.destroy()
      toolbarHost.remove()
      editorHost.remove()
      commentsHost?.remove()
      linkHost.remove()
      liveRegionHost.remove()
    }
  }
}

/** 断言当前 harness 使用的是外部 comments host。 */
function requireCommentsHost(harness: Harness): HTMLDivElement {
  if (harness.commentsHost === null) {
    throw new Error('当前测试环境未启用外部 comments host。')
  }

  return harness.commentsHost
}

/** 读取必需节点。 */
function getRequiredElement(host: HTMLElement, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector)

  if (element === null) {
    throw new Error(`缺少测试节点：${selector}`)
  }

  return element
}

/** 创建一条默认页内 rail 批注并返回其卡片。 */
async function createDefaultRailComment(harness: Harness, body: string): Promise<HTMLElement> {
  harness.editor.setSelection(createSelection(harness.editor, 1, 4))
  getRequiredButton(harness.toolbarHost, '[data-jword-insert-comment]').click()
  await flushMicrotasks()

  const commentsHost = harness.editorHost.querySelector<HTMLElement>('[data-jword-comments-default-host="true"]')
  const input = getRequiredTextarea(commentsHost ?? harness.editorHost, '[data-jword-comment-input="draft"]')

  input.value = body
  input.dispatchEvent(new Event('input', { bubbles: true }))
  getRequiredButton(commentsHost ?? harness.editorHost, '[data-jword-comment-action="confirm-draft"]').click()
  await flushMicrotasks()
  await flushAnimationFrame()

  const thread = harness.editorHost.querySelector<HTMLElement>('.jw-comments-page-rail .jw-comments-thread')

  if (thread === null) {
    throw new Error('缺少默认页内批注卡片。')
  }

  return thread
}

/** 读取默认页内 rail 中当前可见的第一张批注卡片。 */
function readDefaultRailThread(harness: Harness): HTMLElement {
  const thread = harness.editorHost.querySelector<HTMLElement>('.jw-comments-page-rail .jw-comments-thread')

  if (thread === null) {
    throw new Error('缺少默认页内批注卡片。')
  }

  return thread
}

/** 通过公开 anchor API 构造同一 run 上的测试选区。 */
function createSelection(editor: Editor, anchorIndex: number, focusIndex: number) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

/** 通过指定 run 构造测试选区。 */
function createSelectionFromRun(editor: Editor, run: Run | null, anchorIndex: number, focusIndex: number) {
  if (run === null) {
    throw new Error('缺少带链接 run。')
  }

  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: run.id,
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: run.id,
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

/** 读取必需按钮。 */
function getRequiredButton(host: HTMLElement, selector: string): HTMLButtonElement {
  const element = host.querySelector(selector)

  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`缺少测试按钮：${selector}`)
  }

  return element
}

/** 读取必需输入框。 */
function getRequiredInput(host: HTMLElement, selector: string): HTMLInputElement {
  const element = host.querySelector(selector)

  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`缺少测试输入框：${selector}`)
  }

  return element
}

/** 读取必需文本域。 */
function getRequiredTextarea(host: HTMLElement, selector: string): HTMLTextAreaElement {
  const element = host.querySelector(selector)

  if (!(element instanceof HTMLTextAreaElement)) {
    throw new Error(`缺少测试文本域：${selector}`)
  }

  return element
}

/** 查找 projection 中第一段带链接的 run。 */
function findFirstLinkedRun(editor: Editor): Run | null {
  for (const section of editor.getProjection().document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      const run = block.runs.find((candidate) => candidate.link !== undefined)

      if (run !== undefined) {
        return run
      }
    }
  }

  return null
}

/** 读取 run 的纯文本。 */
function readRunText(run: Run | null): string {
  return run?.inlines
    .map((inline) => inline.kind === 'text' ? inline.text : '')
    .join('') ?? ''
}

/** 等待 UI controller 的微任务聚焦落稳。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** 等待 requestAnimationFrame 驱动的页内批注同步完成。 */
async function flushAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve()
    })
  })
}
