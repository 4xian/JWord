/**
 * @vitest-environment jsdom
 *
 * 职责：锁定 comments DOM 的最小结构与渲染结果。
 * 边界：只覆盖 sidebar 节点和 anchor hook，不验证 controller 事件或宿主回调。
 * 协作模块：packages/ui/src/comments/dom.ts 与 packages/ui/src/comments/state.ts。
 * 约束：右侧 sidebar 必须展示 thread、作者、详情消息和草稿输入，且不依赖全局样式。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.8-4.10。
 */

import { describe, expect, test } from 'vitest'
import {
  applyCommentAnchorState,
  createCommentsSidebarDom,
  destroyCommentsSidebar,
  readCommentAnchorClassNames,
  renderCommentsSidebar
} from '../src/comments/dom'
import { createCommentsState, openCommentDraft, readCommentsViewState } from '../src/comments/state'
import type { JWordCommentAnchorState, JWordCommentThread } from '../src/comments/types'

describe('comments dom', () => {
  test('会渲染 thread 详情与新建批注草稿', () => {
    const host = document.createElement('div')
    const dom = createCommentsSidebarDom(host)
    const withDraft = openCommentDraft(createCommentsState([buildThread()]), buildAnchor('draft-anchor', '新的锚点摘录'))

    try {
      renderCommentsSidebar(dom, readCommentsViewState(withDraft, {
        currentUser: {
          id: 'alice',
          name: 'Alice',
          color: '#2563eb'
        },
        resolveUser(authorId) {
          return authorId === 'bob'
            ? {
                id: 'bob',
                name: 'Bob',
                color: '#0f766e'
              }
            : undefined
        },
        permissions: {
          allowResolveByNonAuthor: true
        },
        formatCreatedAt() {
          return '刚刚'
        }
      }))

      expect(dom.composer.hidden).toBe(false)
      expect(dom.composerAnchor.textContent).toContain('新的锚点摘录')
      expect(dom.threadList.textContent).toContain('Alice')
      expect(dom.threadList.textContent).toContain('主批注内容')
      expect(dom.threadList.textContent).toContain('定位正文')
      expect(dom.detailHeader.hidden).toBe(true)
      expect(dom.detailMessages.textContent).toBe('')
      expect(dom.detailResolveButton.textContent).toBe('解决批注')
    } finally {
      destroyCommentsSidebar(dom)
    }
  })

  test('会给正文锚点写入稳定 class 与 data hook', () => {
    const target = document.createElement('span')
    const anchor = buildAnchor('thread-2', '高亮正文')
    const activeAnchor = {
      ...anchor,
      selected: true,
      highlighted: true,
      resolved: true
    }

    applyCommentAnchorState(target, activeAnchor)

    expect(readCommentAnchorClassNames(activeAnchor)).toEqual([
      'jw-comment-anchor',
      'jw-comment-anchor--selected',
      'jw-comment-anchor--highlighted',
      'jw-comment-anchor--resolved'
    ])
    expect(target.getAttribute('data-jword-comment-thread-id')).toBe('thread-2')
    expect(target.getAttribute('data-jword-comment-selected')).toBe('true')
    expect(target.classList.contains('jw-comment-anchor--resolved')).toBe(true)
  })
})

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
    }]
  }
}
