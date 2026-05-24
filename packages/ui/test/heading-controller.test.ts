/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 基础目录 UI 点击后使用稳定 anchor 设置 editor 选区。
 * 边界：只覆盖目录按钮到 editor selection 的跳转闭环，不测试滚动动画或样式。
 * 协作模块：heading controller、core heading outline 与 editor facade。
 * 约束：通过稳定 data selector 交互，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.11。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createHeadingOutlineController } from '../src/heading/controller'

describe('heading outline controller', () => {
  test('点击目录项会把 editor 选区定位到对应 heading anchor', () => {
    const editor = createEditor({
      initialText: '第一章\n\n正文\n\n第二章'
    })
    const host = document.createElement('div')

    setParagraphStyle(editor, 0, 'Heading1')
    setParagraphStyle(editor, 2, 'Heading2')

    const controller = createHeadingOutlineController({
      editor,
      host,
      scrollToRange: () => undefined
    })

    try {
      const secondRow = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-3:heading"]')
      const secondButton = secondRow?.querySelector<HTMLButtonElement>('[data-jword-heading-outline-activate]')

      expect(secondButton?.textContent).toBe('第二章')

      secondButton?.click()

      const selection = editor.getSelection()

      expect(selection).not.toBeNull()
      expect(editor.resolveTextPosition(selection!.anchor).blockId).toBe('paragraph-3')
      expect(editor.resolveTextPosition(selection!.focus).blockId).toBe('paragraph-3')
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('目录面板可以切换显示状态并标记当前标题', () => {
    const editor = createEditor({
      initialText: '第一章\n\n正文\n\n第二章'
    })
    const host = document.createElement('div')

    setParagraphStyle(editor, 0, 'Heading1')
    setParagraphStyle(editor, 2, 'Heading2')

    const controller = createHeadingOutlineController({
      editor,
      host
    })

    try {
      expect(controller.elements.list.hidden).toBe(true)

      controller.toggleVisible()
      expect(controller.elements.list.hidden).toBe(false)

      const secondRow = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-3:heading"]')
      const secondButton = secondRow?.querySelector<HTMLButtonElement>('[data-jword-heading-outline-activate]')

      secondButton?.click()

      expect(host.querySelector('[data-jword-heading-outline-item="paragraph-3:heading"]')?.getAttribute('aria-current')).toBe('true')

      controller.toggleVisible()
      expect(controller.elements.list.hidden).toBe(true)
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('目录项按层级渲染为可折叠树结构', () => {
    const editor = createEditor({
      initialText: '第一章\n\n第一节\n\n小节\n\n第二章'
    })
    const host = document.createElement('div')

    setParagraphStyle(editor, 0, 'Heading1')
    setParagraphStyle(editor, 1, 'Heading2')
    setParagraphStyle(editor, 2, 'Heading3')
    setParagraphStyle(editor, 3, 'Heading1')

    const controller = createHeadingOutlineController({
      editor,
      host
    })

    try {
      controller.toggleVisible()

      const firstRow = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-1:heading"]')
      const firstToggle = firstRow?.querySelector<HTMLButtonElement>('[data-jword-heading-outline-toggle]')
      const firstButton = firstRow?.querySelector<HTMLButtonElement>('[data-jword-heading-outline-activate]')
      const secondLevel = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-2:heading"]')
      const thirdLevel = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-3:heading"]')

      expect(firstRow?.getAttribute('aria-expanded')).toBe('true')
      expect(secondLevel?.hidden).toBe(false)
      expect(thirdLevel?.hidden).toBe(false)
      expect(firstRow?.style.paddingLeft).toBe('0px')
      expect(secondLevel?.style.paddingLeft).toBe('14px')
      expect(thirdLevel?.style.paddingLeft).toBe('28px')

      firstToggle?.click()

      const collapsedFirstRow = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-1:heading"]')
      const collapsedSecondLevel = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-2:heading"]')
      const collapsedThirdLevel = host.querySelector<HTMLElement>('[data-jword-heading-outline-item="paragraph-3:heading"]')

      expect(collapsedFirstRow?.getAttribute('aria-expanded')).toBe('false')
      expect(collapsedSecondLevel?.hidden).toBe(true)
      expect(collapsedThirdLevel?.hidden).toBe(true)
      firstButton?.click()

      expect(host.querySelector('[data-jword-heading-outline-item="paragraph-1:heading"]')?.getAttribute('aria-current')).toBe('true')
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })
})

/** 给测试段落设置标题样式。 */
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
