/**
 * @vitest-environment node
 *
 * 职责：验证 editor 当前用户上下文的最小默认值和自定义覆盖。
 * 边界：只覆盖 core facade 的身份读取，不测试 UI 作者目录或协同显示。
 * 协作模块：editor types/runtime 和后续 comment/revision builder 共享同一 authorId 来源。
 * 性能/安全约束：测试只使用内存 editor，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'

describe('editor current user', () => {
  it('uses a stable local user by default', () => {
    const editor = createEditor()

    expect(editor.getCurrentUser()).toEqual({
      authorId: 'local-user'
    })

    editor.destroy()
  })

  it('reads the current user from EditorOptions', () => {
    const editor = createEditor({
      currentUser: {
        id: 'author-1',
        displayName: 'Alice',
        avatarUrl: 'https://example.com/alice.png',
        color: '#3366ff'
      }
    })

    expect(editor.getCurrentUser()).toEqual({
      authorId: 'author-1',
      name: 'Alice',
      avatarUrl: 'https://example.com/alice.png',
      color: '#3366ff'
    })

    editor.destroy()
  })
})
