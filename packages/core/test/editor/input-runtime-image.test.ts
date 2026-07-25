/**
 * @vitest-environment jsdom
 *
 * 职责：验证 editor input runtime 的 inline image 删除、命中选择和混合范围删除路径。
 * 边界：只覆盖 inline image 与文本混合输入行为，不测试外部 media UI。
 * 协作模块：transaction pipeline、history、layout hit/caret 映射和 formatting builder 共同支撑“小文档可编辑”闭环。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import {
  captureTransactions,
  createResource,
  dispatchKey,
  dispatchMouse,
  findPointerPointForImageRun,
  getHiddenTextarea,
  getPageElement,
  insertInlineImageAtSelection,
  mockPageRect,
  readInlineImageResourceIds,
  readParagraphTailAnchor,
  readParagraphTexts
} from './editor-test-helpers'

describe('Editor input runtime image', () => {
  it('keeps Backspace deleting inline images one by one from the paragraph tail', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-1'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      insertInlineImageAtSelection(editor, createResource('image-inline-2'), readParagraphTailAnchor(editor))
      const tailAnchor = readParagraphTailAnchor(editor)

      editor.setSelection(createSelectionState(
        editor.createTextAnchor(tailAnchor),
        editor.createTextAnchor(tailAnchor)
      ))

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual(['image-inline-1'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(tailAnchor)

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(readParagraphTexts(editor)).toEqual(['ab'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject(tailAnchor)
      expect(transactions.slice(-2)).toEqual([
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        },
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        }
      ])
    } finally {
      editor.destroy()
    }
  })

  it('keeps Delete deleting inline images one by one from the text boundary', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })
    const transactions = captureTransactions(editor)

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-1'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      insertInlineImageAtSelection(editor, createResource('image-inline-2'), readParagraphTailAnchor(editor))

      const endAnchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      editor.setSelection(createSelectionState(endAnchor, endAnchor))

      dispatchKey(textarea, 'Delete')
      expect(readInlineImageResourceIds(editor)).toEqual(['image-inline-2'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      dispatchKey(textarea, 'Delete')
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(readParagraphTexts(editor)).toEqual(['ab'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })
      expect(transactions.slice(-2)).toEqual([
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        },
        {
          commandName: 'deleteImage',
          origin: 'local-user',
          operationKinds: ['deleteImage', 'deleteResource'],
          dirty: true
        }
      ])
    } finally {
      editor.destroy()
    }
  })

  it('selects an inline image when clicking on the image body', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-click'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

      expect(paragraph?.kind).toBe('paragraph')
      if (paragraph?.kind !== 'paragraph') {
        throw new Error('expected paragraph block')
      }

      const imageRunId = paragraph.runs.find((run) => run.inlines.some((inline) => inline.kind === 'image'))?.id

      expect(imageRunId).toBeDefined()

      const page = getPageElement(host, 0)

      mockPageRect(page)

      const hitPoint = findPointerPointForImageRun(editor, 0, imageRunId!)

      dispatchMouse(page, 'mousedown', hitPoint.clientX, hitPoint.clientY)
      dispatchMouse(page, 'mouseup', hitPoint.clientX, hitPoint.clientY)

      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        blockId: 'paragraph-1',
        runId: imageRunId,
        graphemeIndex: 0
      })
      expect(editor.getSelectionRects(editor.getSelection()!.range)).toHaveLength(1)
    } finally {
      editor.destroy()
    }
  })

  it('continues Backspace into previous text after deleting the last trailing inline image', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-tail'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)

      editor.setSelection(createSelectionState(
        editor.createTextAnchor(tailAnchor),
        editor.createTextAnchor(tailAnchor)
      ))

      dispatchKey(textarea, 'Backspace')
      expect(readInlineImageResourceIds(editor)).toEqual([])

      dispatchKey(textarea, 'Backspace')
      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    } finally {
      editor.destroy()
    }
  })

  it('deletes a mixed text and inline-image range with Backspace in one step', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-range-backspace'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor(tailAnchor)

      editor.setSelection(createSelectionState(anchor, focus))
      dispatchKey(textarea, 'Backspace')

      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    } finally {
      editor.destroy()
    }
  })

  it('deletes a mixed text and inline-image range with Delete in one step', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'ab' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)

      insertInlineImageAtSelection(editor, createResource('image-inline-range-delete'), {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 2
      })

      const tailAnchor = readParagraphTailAnchor(editor)
      const anchor = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
      const focus = editor.createTextAnchor(tailAnchor)

      editor.setSelection(createSelectionState(anchor, focus))
      dispatchKey(textarea, 'Delete')

      expect(readParagraphTexts(editor)).toEqual(['a'])
      expect(readInlineImageResourceIds(editor)).toEqual([])
      expect(editor.resolveTextPosition(editor.getSelection()!.focus)).toMatchObject({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      })
    } finally {
      editor.destroy()
    }
  })
})
