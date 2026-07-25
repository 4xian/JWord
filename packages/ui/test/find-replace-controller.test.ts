/**
 * @vitest-environment jsdom
 *
 * 职责：验证查找替换 controller 的命中定位副作用。
 * 边界：只覆盖 controller 到 editor selection 与宿主滚动回调，不测试 canvas 渲染。
 * 协作模块：find-replace controller 与 core find helper。
 * 约束：滚动由宿主注入回调承接，controller 不直接读取页面布局。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test, vi } from 'vitest'

import { createFindReplaceController } from '../src/find-replace/controller'

describe('find replace controller', () => {
  test('查找结果会渲染独立 overlay 并随当前索引和清空状态同步', () => {
    const editor = createEditor({ initialText: 'alpha\n\nbeta alpha\n\nalpha' })
    const editorHost = document.createElement('div')
    const host = document.createElement('div')
    const controller = createFindReplaceController({
      editor,
      host,
      editorHost
    })

    document.body.append(editorHost, host)
    editor.mount(editorHost)

    try {
      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      controller.elements.findButton.click()

      expect(readFindOverlayRects(editorHost)).toHaveLength(3)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['0'])

      controller.elements.nextButton.click()

      expect(readFindOverlayRects(editorHost)).toHaveLength(3)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['1'])

      controller.elements.queryInput.value = ''
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      expect(readFindOverlayRects(editorHost)).toHaveLength(0)

      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.findButton.click()
      controller.close()

      expect(readFindOverlayRects(editorHost)).toHaveLength(0)
    } finally {
      controller.destroy()
      editor.destroy()
      host.remove()
      editorHost.remove()
    }
  })

  test('替换当前和全部替换后会同步查找 overlay', () => {
    const editor = createEditor({ initialText: 'alpha beta alpha' })
    const editorHost = document.createElement('div')
    const host = document.createElement('div')
    const controller = createFindReplaceController({
      editor,
      host,
      editorHost
    })

    document.body.append(editorHost, host)
    editor.mount(editorHost)

    try {
      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.replacementInput.value = 'A'
      controller.elements.findButton.click()

      expect(readFindOverlayRects(editorHost)).toHaveLength(2)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['0'])

      controller.elements.replaceButton.click()

      expect(readFindOverlayRects(editorHost)).toHaveLength(1)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['0'])

      controller.elements.replaceAllButton.click()

      expect(readFindOverlayRects(editorHost)).toHaveLength(0)
    } finally {
      controller.destroy()
      editor.destroy()
      host.remove()
      editorHost.remove()
    }
  })

  test('大命中量只渲染当前命中附近的有限 overlay', () => {
    const editor = createEditor({
      initialText: Array.from({ length: 60 }, (_, index) => `alpha ${index}`).join('\n\n')
    })
    const editorHost = document.createElement('div')
    const host = document.createElement('div')
    const controller = createFindReplaceController({
      editor,
      host,
      editorHost
    })

    document.body.append(editorHost, host)
    editor.mount(editorHost)

    try {
      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      controller.elements.findButton.click()

      expect(controller.elements.status.textContent).toBe('1 / 60')
      expect(readFindOverlayRects(editorHost)).toHaveLength(24)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['0'])

      controller.elements.previousButton.click()

      expect(controller.elements.status.textContent).toBe('60 / 60')
      expect(readFindOverlayRects(editorHost)).toHaveLength(24)
      expect(readActiveOverlayIndexes(editorHost)).toEqual(['59'])
    } finally {
      controller.destroy()
      editor.destroy()
      host.remove()
      editorHost.remove()
    }
  })

  test('查找上一个和下一个会把当前命中范围交给宿主滚动定位', () => {
    const editor = createEditor({ initialText: 'alpha\n\nbeta\n\nalpha' })
    const host = document.createElement('div')
    const scrollToRange = vi.fn()
    const controller = createFindReplaceController({
      editor,
      host,
      scrollToRange
    })

    try {
      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      controller.elements.findButton.click()
      controller.elements.nextButton.click()
      controller.elements.previousButton.click()

      expect(scrollToRange).toHaveBeenCalledTimes(3)
      expect(scrollToRange.mock.calls[1]?.[0].anchor.blockId).toBe('paragraph-3')
      expect(scrollToRange.mock.calls[2]?.[0].anchor.blockId).toBe('paragraph-1')
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('查找后会展示当前索引和总结果数', () => {
    const editor = createEditor({ initialText: 'alpha\n\nbeta\n\nalpha' })
    const host = document.createElement('div')
    const controller = createFindReplaceController({
      editor,
      host
    })

    try {
      controller.open()

      expect(controller.elements.status.hidden).toBe(true)
      expect(controller.elements.status.textContent).toBe('')

      controller.elements.queryInput.value = 'gamma'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      controller.elements.findButton.click()
      expect(controller.elements.status.hidden).toBe(true)
      expect(controller.elements.status.textContent).toBe('')

      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))

      controller.elements.findButton.click()
      expect(controller.elements.status.hidden).toBe(false)
      expect(controller.elements.status.textContent).toBe('1 / 2')

      controller.elements.nextButton.click()
      expect(controller.elements.status.textContent).toBe('2 / 2')

      controller.elements.previousButton.click()
      expect(controller.elements.status.textContent).toBe('1 / 2')
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })

  test('关闭面板会清空表单草稿和当前查找记录', () => {
    const editor = createEditor({ initialText: 'alpha beta alpha' })
    const host = document.createElement('div')
    const controller = createFindReplaceController({
      editor,
      host
    })

    try {
      controller.toggleVisible()
      controller.elements.queryInput.value = 'alpha'
      controller.elements.queryInput.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      controller.elements.replacementInput.value = 'A'
      controller.elements.findButton.click()

      expect(controller.elements.status.textContent).toBe('1 / 2')

      controller.close()

      expect(controller.elements.root.hidden).toBe(true)
      expect(controller.elements.queryInput.value).toBe('')
      expect(controller.elements.replacementInput.value).toBe('')
      expect(controller.elements.status.hidden).toBe(true)
      expect(controller.elements.status.textContent).toBe('')
      expect(controller.elements.findButton.disabled).toBe(true)
      expect(controller.elements.previousButton.disabled).toBe(true)
      expect(controller.elements.nextButton.disabled).toBe(true)
      expect(controller.elements.replaceButton.disabled).toBe(true)
      expect(controller.elements.replaceAllButton.disabled).toBe(true)
    } finally {
      controller.destroy()
      editor.destroy()
    }
  })
})

/** 读取查找 overlay 的所有矩形。 */
function readFindOverlayRects(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('[data-jword-find-match-index]'))
}

/** 读取当前 active 查找 overlay 的索引。 */
function readActiveOverlayIndexes(root: HTMLElement): string[] {
  return readFindOverlayRects(root)
    .filter((rect) => rect.getAttribute('data-jword-find-active') === 'true')
    .map((rect) => rect.getAttribute('data-jword-find-match-index') ?? '')
}
