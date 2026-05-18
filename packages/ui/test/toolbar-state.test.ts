/**
 * @vitest-environment node
 *
 * 职责：锁定 toolbar 对字体/字号/行距的有效值解析，确保默认值与光标移动同步到当前 run。
 * 边界：只覆盖状态构建，不验证 DOM 渲染或浏览器交互。
 * 协作：packages/ui/src/toolbar/state.ts 与 @4xian/jword-core selection formatting state。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'
import { buildToolbarState } from '../src/toolbar/state'

describe('toolbar state formatting sync', () => {
  test('shows effective font defaults and line-height defaults when the caret moves', () => {
    const editor = createEditor({ initialText: '标题\n\n正文' })

    try {
      const projection = editor.getProjection()
      const firstParagraph = projection.document.sections[0]?.blocks[0]
      const secondParagraph = projection.document.sections[0]?.blocks[1]

      expect(firstParagraph?.kind).toBe('paragraph')
      expect(secondParagraph?.kind).toBe('paragraph')

      const firstRunId = firstParagraph?.kind === 'paragraph' ? firstParagraph.runs[0]?.id : undefined
      const secondRunId = secondParagraph?.kind === 'paragraph' ? secondParagraph.runs[0]?.id : undefined

      expect(firstRunId).toBeDefined()
      expect(secondRunId).toBeDefined()

      editor.setSelection(createCollapsedSelection(
        editor,
        firstParagraph?.id ?? 'paragraph-1',
        firstRunId ?? 'run-1',
        0
      ))
      editor.setParagraphStyle('Heading1')

      expect(buildToolbarState(editor)).toMatchObject({
        fontFamilyValue: 'Arial',
        fontFamilyState: 'value',
        fontSizeValue: '480',
        fontSizeState: 'value',
        paragraphLineHeightValue: '1.25',
        paragraphLineHeightState: 'value'
      })

      editor.setSelection(createCollapsedSelection(
        editor,
        secondParagraph?.id ?? 'paragraph-2',
        secondRunId ?? 'run-2',
        0
      ))

      expect(buildToolbarState(editor)).toMatchObject({
        fontFamilyValue: 'Arial',
        fontFamilyState: 'value',
        fontSizeValue: '240',
        fontSizeState: 'value',
        paragraphLineHeightValue: '1.25',
        paragraphLineHeightState: 'value'
      })
    } finally {
      editor.destroy()
    }
  })

  test('maps superscript and subscript to dedicated toggle button pressed states', () => {
    const editor = createEditor({ initialText: '公式' })

    try {
      const projection = editor.getProjection()
      const firstParagraph = projection.document.sections[0]?.blocks[0]

      expect(firstParagraph?.kind).toBe('paragraph')

      const runId = firstParagraph?.kind === 'paragraph' ? firstParagraph.runs[0]?.id : undefined

      expect(runId).toBeDefined()

      editor.setSelection(createCollapsedSelection(
        editor,
        firstParagraph?.id ?? 'paragraph-1',
        runId ?? 'run-1',
        1
      ))
      editor.toggleSuperscript()

      expect(buildToolbarState(editor)).toMatchObject({
        superscriptPressed: 'true',
        subscriptPressed: 'false'
      })
      expect(firstParagraph?.kind).toBe('paragraph')
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()

      editor.toggleSubscript()

      expect(buildToolbarState(editor)).toMatchObject({
        superscriptPressed: 'false',
        subscriptPressed: 'true'
      })
      expect(readFirstParagraphRunProperties(editor)).toBeUndefined()
    } finally {
      editor.destroy()
    }
  })
})

function createCollapsedSelection(
  editor: ReturnType<typeof createEditor>,
  blockId: string,
  runId: string,
  graphemeIndex: number
) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId,
    runId,
    graphemeIndex
  })

  return createSelectionState(anchor, anchor)
}

function readFirstParagraphRunProperties(editor: ReturnType<typeof createEditor>) {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  return block.runs[0]?.properties
}
