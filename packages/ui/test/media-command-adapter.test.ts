/**
 * @fileoverview 职责: 锁定 Gate 4 media command adapter 在插入行内图片后推进 caret 的契约。
 * 边界: 只覆盖 packages/ui 的 command adapter 与 core editor facade 协作，不验证上传流程或 DOM 面板。
 * 协作: packages/ui/src/media/core-command-adapter.ts 与 @4xian/jword-core 的图片命令/锚点迁移共同保证插图后的继续输入体验。
 * 约束: 断言只依赖公开 editor facade 和 adapter 结果，不直接访问内部 store。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 1。
 */

import { describe, expect, test } from 'vitest'
import { createEditor, createSelectionState, type Resource } from '@4xian/jword-core'
import { createCoreMediaCommandAdapter } from '../src/index'

const INLINE_RESOURCE: Resource = {
  kind: 'resource',
  id: 'media-adapter-inline-image',
  mime: 'image/png',
  source: {
    kind: 'dataUrl',
    url: 'data:image/png;base64,AAAA'
  },
  status: 'success'
}

describe('media command adapter', () => {
  test('插入段尾行内图片后把 caret 推进到图片后面的空尾 run', () => {
    const editor = createEditor({ initialText: 'ab' })
    const adapter = createCoreMediaCommandAdapter()
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(anchor, anchor)

    const result = adapter.insertInlineImage!({
      editor,
      projection: editor.getProjection(),
      selection,
      resource: INLINE_RESOURCE
    })

    expect(result).toEqual({
      kind: 'applied',
      message: '已插入行内图片。'
    })

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    const tailRun = paragraph.runs.at(-1)

    expect(tailRun?.inlines).toEqual([{
      kind: 'text',
      text: ''
    }])
    expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: tailRun?.id,
      graphemeIndex: 0
    })

    editor.destroy()
  })

  test('在文本中间插入行内图片后把 caret 推进到图片后的拆分文本 run', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const adapter = createCoreMediaCommandAdapter()
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(anchor, anchor)

    adapter.insertInlineImage!({
      editor,
      projection: editor.getProjection(),
      selection,
      resource: INLINE_RESOURCE
    })

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    const trailingTextRun = paragraph.runs.at(-1)

    expect(trailingTextRun?.inlines).toEqual([{
      kind: 'text',
      text: 'cd'
    }])
    expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: trailingTextRun?.id,
      graphemeIndex: 0
    })

    editor.destroy()
  })

  test('选中图片后允许通过 adapter 同步旋转和重置角度', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const adapter = createCoreMediaCommandAdapter()
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const textSelection = createSelectionState(textAnchor, textAnchor)

    adapter.insertInlineImage!({
      editor,
      projection: editor.getProjection(),
      selection: textSelection,
      resource: {
        ...INLINE_RESOURCE,
        metadata: {
          widthTwips: 1800,
          heightTwips: 1200
        }
      }
    })

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    const imageRunId = paragraph.runs[1]?.id

    expect(imageRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const target = adapter.resolveSelectedImageTarget!(editor.getProjection(), imageSelection)

    expect(target).toEqual({
      resourceId: 'media-adapter-inline-image',
      widthTwips: 1800,
      heightTwips: 1200
    })

    const rotateResult = adapter.setSelectedImageRotation!({
      editor,
      projection: editor.getProjection(),
      selection: imageSelection,
      target: target!,
      rotationDegrees: 90
    })

    expect(rotateResult).toEqual({
      kind: 'applied',
      message: '已更新图片旋转角度。'
    })
    expect((editor.getProjection().document.sections[0]?.blocks[0] as Extract<typeof paragraph, { kind: 'paragraph' }>).runs[1]?.inlines).toEqual([{
      kind: 'image',
      resourceId: 'media-adapter-inline-image',
      display: 'inline',
      widthTwips: 1800,
      heightTwips: 1200,
      rotationDegrees: 90
    }])

    const resetResult = adapter.setSelectedImageRotation!({
      editor,
      projection: editor.getProjection(),
      selection: imageSelection,
      target: {
        ...target!,
        rotationDegrees: 90
      },
      rotationDegrees: 0
    })

    expect(resetResult).toEqual({
      kind: 'applied',
      message: '已重置图片旋转角度。'
    })
    expect((editor.getProjection().document.sections[0]?.blocks[0] as Extract<typeof paragraph, { kind: 'paragraph' }>).runs[1]?.inlines).toEqual([{
      kind: 'image',
      resourceId: 'media-adapter-inline-image',
      display: 'inline',
      widthTwips: 1800,
      heightTwips: 1200
    }])

    editor.destroy()
  })

  test('拖拽图片后通过 adapter 把图片选中态提交到新位置', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const adapter = createCoreMediaCommandAdapter()
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const textSelection = createSelectionState(textAnchor, textAnchor)

    adapter.insertInlineImage!({
      editor,
      projection: editor.getProjection(),
      selection: textSelection,
      resource: {
        ...INLINE_RESOURCE,
        metadata: {
          widthTwips: 1800,
          heightTwips: 1200
        }
      }
    })

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    const imageRunId = paragraph.runs[1]?.id
    const trailingRunId = paragraph.runs[2]?.id

    expect(imageRunId).toBeDefined()
    expect(trailingRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const target = adapter.resolveSelectedImageTarget!(editor.getProjection(), imageSelection)
    const dropAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: trailingRunId!,
      graphemeIndex: 2
    })
    const dropSelection = createSelectionState(dropAnchor, dropAnchor)

    const result = adapter.moveSelectedImage!({
      editor,
      projection: editor.getProjection(),
      selection: imageSelection,
      target: target!,
      dropSelection
    })

    expect(result).toEqual({
      kind: 'applied',
      message: '已更新图片位置。'
    })
    expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      graphemeIndex: 0
    })

    const movedParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(movedParagraph?.kind).toBe('paragraph')
    if (movedParagraph?.kind !== 'paragraph') {
      throw new Error('expected moved paragraph block')
    }

    expect(movedParagraph.runs[2]?.inlines).toEqual([{
      kind: 'image',
      resourceId: 'media-adapter-inline-image',
      display: 'inline',
      widthTwips: 1800,
      heightTwips: 1200
    }])

    editor.destroy()
  })
})
