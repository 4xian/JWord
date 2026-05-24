/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 目录基于 Heading 1-3 稳定语义生成。
 * 边界：只覆盖 core heading outline 与目录 anchor 快照，不测试 UI 滚动或浏览器事件。
 * 协作模块：编辑器门面、段落样式命令、稳定范围快照与标题结构辅助函数。
 * 性能/安全约束：测试只使用内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.11。
 */

import { describe, expect, test } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { buildHeadingOutline, locateHeadingOutlineItem } from '../../src/heading/outline'
import { createSelectionState } from '../../src/model/selection'

describe('heading outline', () => {
  test('会基于 Heading 1-3 生成目录项并保留可定位 anchor 快照', () => {
    const editor = createEditor({
      initialText: '第一章\n\n第一节\n\n正文段落\n\n小节标题'
    })

    setParagraphStyle(editor, 0, 'Heading1')
    setParagraphStyle(editor, 1, 'Heading2')
    setParagraphStyle(editor, 3, 'Heading3')

    const outline = buildHeadingOutline(editor)

    expect(outline.map((item) => ({
      level: item.level,
      title: item.title,
      blockId: item.blockId
    }))).toEqual([
      {
        level: 1,
        title: '第一章',
        blockId: 'paragraph-1'
      },
      {
        level: 2,
        title: '第一节',
        blockId: 'paragraph-2'
      },
      {
        level: 3,
        title: '小节标题',
        blockId: 'paragraph-4'
      }
    ])

    editor.executeCommand({
      name: 'insertText',
      operations: [{
        kind: 'insertText',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        },
        text: '总'
      }]
    })

    expect(locateHeadingOutlineItem(editor, outline[0]!)?.anchor.blockId).toBe('paragraph-1')
    expect(locateHeadingOutlineItem(editor, outline[0]!)?.focus.blockId).toBe('paragraph-1')

    editor.destroy()
  })
})

/** 给指定段落设置标题样式。 */
function setParagraphStyle(editor: ReturnType<typeof createEditor>, paragraphIndex: number, styleId: string): void {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[paragraphIndex]

  if (paragraph?.kind !== 'paragraph') {
    throw new Error('missing paragraph')
  }

  const run = paragraph.runs[0]

  if (run === undefined) {
    throw new Error('missing run')
  }

  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex: 0
  })

  editor.setSelection(createSelectionState(anchor, anchor))
  editor.setParagraphStyle(styleId)
}
