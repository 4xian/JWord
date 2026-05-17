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
})
