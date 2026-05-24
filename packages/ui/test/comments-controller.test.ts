/**
 * @vitest-environment jsdom
 *
 * 职责：锁定 comments controller 与宿主 adapter 的交互闭环。
 * 边界：只验证 draft、thread 操作和 anchor 聚焦是否走 adapter，不验证主进程 wiring。
 * 协作模块：packages/ui/src/comments/controller.ts。
 * 约束：controller 只能调 adapter，不直接触碰 core。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.8-4.10。
 */

import { describe, expect, test, vi } from 'vitest'
import { createCommentsController } from '../src/comments/controller'
import type { JWordCommentAnchorState, JWordCommentThread } from '../src/comments/types'

describe('comments controller', () => {
  test('会从正文锚点打开草稿并提交 createThread', async () => {
    const adapter = createAdapter()
    const host = document.createElement('div')
    document.body.append(host)
    const controller = createCommentsController({
      host,
      currentUser: {
        id: 'alice',
        name: 'Alice',
        color: '#2563eb'
      },
      threads: [buildThread()],
      adapter
    })

    try {
      controller.openCreateDraft(buildAnchor('draft-anchor', '从正文选中的内容'))
      await flushMicrotasks()

      expect(controller.elements.composer.hidden).toBe(false)
      expect(document.activeElement).toBe(controller.elements.composerInput)

      controller.elements.composerInput.value = '新的批注'
      controller.elements.composerInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.composerConfirmButton.click()
      await flushMicrotasks()

      expect(adapter.createThread).toHaveBeenCalledTimes(1)
      expect(adapter.createThread).toHaveBeenCalledWith(expect.objectContaining({
        authorId: 'alice',
        body: '新的批注'
      }))
      expect(controller.elements.threadList.textContent).toContain('新的批注')
    } finally {
      controller.destroy()
    }
  })

  test('会把选中、聚焦、resolve 与删除回复转给 adapter', async () => {
    const adapter = createAdapter()
    const host = document.createElement('div')
    document.body.append(host)
    const controller = createCommentsController({
      host,
      currentUser: {
        id: 'bob',
        name: 'Bob',
        color: '#0f766e'
      },
      permissions: {
        allowResolveByNonAuthor: true
      },
      threads: [buildThread()],
      adapter
    })

    try {
      controller.selectThread('thread-1')
      await flushMicrotasks()
      expect(adapter.selectThread).toHaveBeenCalledWith('thread-1')

      controller.elements.detailQuote.click()
      await flushMicrotasks()
      expect(adapter.focusAnchor).toHaveBeenCalledWith(expect.objectContaining({
        threadId: 'thread-1'
      }))

      controller.elements.detailResolveButton.click()
      await flushMicrotasks()
      expect(adapter.updateThread).toHaveBeenCalledWith({
        kind: 'resolve',
        threadId: 'thread-1'
      })

      const deleteReplyButton = controller.elements.threadList
        .querySelector<HTMLButtonElement>('[data-jword-comment-action="delete-message"]')

      expect(deleteReplyButton).not.toBeNull()
      deleteReplyButton?.click()
      await flushMicrotasks()

      expect(adapter.updateThread).toHaveBeenCalledWith({
        kind: 'deleteMessage',
        request: {
          threadId: 'thread-1',
          messageId: 'reply-1'
        }
      })
    } finally {
      controller.destroy()
    }
  })

  test('回复、编辑和解决保存后会立即更新当前批注卡片', async () => {
    const adapter = createAdapter()
    const host = document.createElement('div')
    document.body.append(host)
    const controller = createCommentsController({
      host,
      currentUser: {
        id: 'bob',
        name: 'Bob',
        color: '#0f766e'
      },
      permissions: {
        allowResolveByNonAuthor: true
      },
      threads: [buildThread()],
      adapter
    })

    try {
      controller.selectThread('thread-1')
      controller.openReplyDraft('thread-1')
      await flushMicrotasks()

      controller.elements.replyInput.value = '新的回复'
      controller.elements.replyInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.replyConfirmButton.click()
      await flushMicrotasks()

      expect(controller.elements.threadList.textContent).toContain('新的回复')

      controller.openEditDraft('thread-1', 'comment-1')
      await flushMicrotasks()
      controller.elements.editInput.value = '主批注已编辑'
      controller.elements.editInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.editConfirmButton.click()
      await flushMicrotasks()

      expect(controller.elements.threadList.textContent).toContain('主批注已编辑')
      expect(controller.elements.threadList.textContent).not.toContain('主批注内容')

      controller.elements.detailResolveButton.click()
      await flushMicrotasks()

      expect(controller.elements.detailResolveButton.textContent).toContain('重新打开')
      expect(controller.elements.threadList.textContent).toContain('已解决')
    } finally {
      controller.destroy()
    }
  })
})

/** 创建测试 adapter。 */
function createAdapter() {
  return {
    createThread: vi.fn(async () => undefined),
    updateThread: vi.fn(async () => undefined),
    deleteThread: vi.fn(async () => undefined),
    selectThread: vi.fn(async () => undefined),
    focusAnchor: vi.fn(async () => undefined)
  }
}

/** 创建测试锚点。 */
function buildAnchor(threadId: string, quote: string): JWordCommentAnchorState {
  return {
    threadId,
    quote,
    selected: false,
    highlighted: false,
    resolved: false
  }
}

/** 创建测试 thread。 */
function buildThread(): JWordCommentThread {
  return {
    id: 'thread-1',
    authorId: 'alice',
    createdAt: '2026-05-23T09:30:00.000Z',
    resolved: false,
    anchor: buildAnchor('thread-1', '第一段的选中文本'),
    messages: [{
      id: 'comment-1',
      authorId: 'alice',
      body: '主批注内容',
      createdAt: '2026-05-23T09:30:00.000Z'
    }, {
      id: 'reply-1',
      authorId: 'bob',
      body: '跟进回复',
      createdAt: '2026-05-23T10:10:00.000Z'
    }]
  }
}

/** 等待 controller 的微任务队列落稳。 */
async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}
