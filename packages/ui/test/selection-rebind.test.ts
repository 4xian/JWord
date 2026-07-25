/**
 * @vitest-environment jsdom
 *
 * 职责：验证 UI 格式命令后的选区重绑定使用 core grapheme 语义。
 * 边界：只覆盖 selection-rebind 与 core Editor facade 协作，不测试 toolbar DOM。
 * 协作模块：selection-rebind、core command builders 和 run split 事务。
 * 约束：组合 emoji 必须按单个 grapheme 计数，避免格式化后选区偏移。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildSetBoldCommand,
  createEditor,
  createSelectionState,
  type Editor,
  type Paragraph
} from '@4xian/jword-core'
import { describe, expect, it } from 'vitest'

import {
  createSelectionRebindSnapshot,
  restoreSelectionFromRebindSnapshot
} from '../src/selection-rebind'

describe('selection rebind grapheme semantics', () => {
  it('keeps selection after a family emoji when the preceding run is split', () => {
    const editor = createEditor({ initialText: '👨‍👩‍👧‍👦ab' })

    try {
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
          graphemeIndex: 2
        })
      )
      const snapshot = createSelectionRebindSnapshot(editor, selection)
      const splitEmojiCommand = buildSetBoldCommand(editor.getProjection(), createSelectionState(
        editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        }),
        editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 1
        })
      ), true)

      expect(splitEmojiCommand).not.toBeNull()
      editor.executeCommand(splitEmojiCommand!)

      const restored = restoreSelectionFromRebindSnapshot(editor, snapshot)
      const focus = restored === null ? null : editor.resolveTextPosition(restored.focus)
      const focusRun = focus === null ? undefined : readRunText(editor, focus.runId)

      expect(focusRun).toBe('ab')
      expect(focus?.graphemeIndex).toBe(1)
    } finally {
      editor.destroy()
    }
  })
})

/** 读取当前 projection 中指定 run 的文本。 */
function readRunText(editor: Editor, runId: string): string | undefined {
  for (const section of editor.getProjection().document.sections) {
    for (const block of section.blocks) {
      const paragraph = block.kind === 'paragraph' ? block : undefined
      const text = paragraph === undefined ? undefined : readParagraphRunText(paragraph, runId)

      if (text !== undefined) {
        return text
      }
    }
  }

  return undefined
}

/** 读取段落中指定 run 的文本。 */
function readParagraphRunText(paragraph: Paragraph, runId: string): string | undefined {
  const run = paragraph.runs.find((item) => item.id === runId)

  return run?.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
}
