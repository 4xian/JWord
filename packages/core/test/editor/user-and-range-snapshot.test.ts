/**
 * @vitest-environment node
 *
 * 职责：验证 editor 用户身份默认值与稳定 range snapshot 的最小公开闭环。
 * 边界：只覆盖 currentUser、snapshot 捕获与定位，不测试 comment/link builder 本体。
 * 协作模块：editor facade、position snapshot 与 transaction pipeline 共同提供后续 comment/revision 依赖的稳定边界。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'

describe('editor currentUser and range snapshot', () => {
  it('provides a stable default local user and returns custom currentUser as-is', () => {
    const defaultEditor = createEditor()
    const customEditor = createEditor({
      currentUser: {
        authorId: 'author-custom',
        name: '测试作者'
      }
    })

    expect(defaultEditor.getCurrentUser()).toEqual({
      authorId: 'local-user'
    })
    expect(customEditor.getCurrentUser()).toEqual({
      authorId: 'author-custom',
      name: '测试作者'
    })

    defaultEditor.destroy()
    customEditor.destroy()
  })

  it('captures and locates range snapshots after front insert and delete', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const selection = createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      })
    )
    const snapshot = editor.captureRangeSnapshot(selection.range)

    editor.executeCommand({
      name: 'insert-front-prefix',
      operations: [{
        kind: 'insertText',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        },
        text: 'X'
      }]
    })

    expect(editor.locateRangeSnapshot(snapshot)).toEqual({
      anchor: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      },
      focus: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      }
    })

    editor.executeCommand({
      name: 'delete-front-prefix',
      operations: [{
        kind: 'deleteRange',
        range: {
          anchor: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 0
          },
          focus: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 1
          }
        }
      }]
    })

    expect(editor.locateRangeSnapshot(snapshot)).toEqual({
      anchor: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      },
      focus: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 3
      }
    })

    editor.destroy()
  })
})
