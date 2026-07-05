/**
 * @vitest-environment jsdom
 *
 * 职责：验证全局只读交互 guard 的最小 DOM 阻断和恢复行为。
 * 边界：只覆盖 guard 自身，不验证 createJWordUi 装配或各业务 controller。
 * 协作模块：packages/ui/src/readonly/interaction-guard.ts 与 UI types。
 * 约束：使用原生事件和稳定 data attribute 断言，不依赖浏览器布局。
 */

import { describe, expect, test, vi } from 'vitest'

import { createJWordInteractionGuard } from '../src/readonly/interaction-guard'
import type { JWordToolbarControlElement, JWordToolbarToolId, JWordUiLiveRegionController } from '../src/types'

describe('readonly interaction guard', () => {
  test('全局只读开启后会阻断编辑事件并禁用编辑入口且保留导航入口', () => {
    const harness = createHarness()
    const liveRegion: JWordUiLiveRegionController = {
      announce: vi.fn(),
      destroy(): void {}
    }

    const guard = createJWordInteractionGuard({
      editorHost: harness.editorHost,
      toolbarHost: harness.toolbarHost,
      controls: harness.controls,
      readonly: {
        enabled: true
      },
      assistive: {
        liveRegion
      }
    })

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'x'
    })

    harness.textarea.dispatchEvent(event)

    expect(guard.readonly).toBe(true)
    expect(guard.canEdit()).toBe(false)
    expect(event.defaultPrevented).toBe(true)
    expect(harness.textarea.readOnly).toBe(true)
    expect(harness.toolbarHost.hidden).toBe(true)
    expect(harness.bold.disabled).toBe(true)
    expect(harness.fontFamily.disabled).toBe(true)
    expect(harness.textColor.disabled).toBe(true)
    expect(harness.findReplace.disabled).toBe(false)
    expect(harness.headingOutline.disabled).toBe(false)
    expect(liveRegion.announce).toHaveBeenCalledWith('当前为只读模式。', { force: true })

    guard.destroy()

    expect(harness.textarea.readOnly).toBe(false)
    expect(harness.textarea.hasAttribute('aria-readonly')).toBe(false)
    expect(harness.toolbarHost.hidden).toBe(false)
    expect(harness.bold.disabled).toBe(false)
    expect(harness.fontFamily.disabled).toBe(false)
    expect(harness.textColor.disabled).toBe(false)
    expect(harness.findReplace.disabled).toBe(false)
    expect(harness.headingOutline.disabled).toBe(false)
  })

  test('禁止只读导航时会连同查找和目录入口一起禁用', () => {
    const harness = createHarness()

    const guard = createJWordInteractionGuard({
      editorHost: harness.editorHost,
      toolbarHost: harness.toolbarHost,
      controls: harness.controls,
      readonly: {
        enabled: true,
        allowNavigation: false
      },
      assistive: {
        liveRegion: null
      }
    })

    expect(harness.findReplace.disabled).toBe(true)
    expect(harness.headingOutline.disabled).toBe(true)

    guard.destroy()

    expect(harness.findReplace.disabled).toBe(false)
    expect(harness.headingOutline.disabled).toBe(false)
  })

  test('只读模式允许选择和复制类事件继续到达编辑器输入层', () => {
    const harness = createHarness()
    const liveRegion: JWordUiLiveRegionController = {
      announce: vi.fn(),
      destroy(): void {}
    }
    const pointerSpy = vi.fn()
    const copyKeySpy = vi.fn()
    const backspaceSpy = vi.fn()

    harness.canvasContainer.addEventListener('mousedown', pointerSpy)
    harness.textarea.addEventListener('keydown', (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        copyKeySpy()
      }

      if (event.key === 'Backspace') {
        backspaceSpy()
      }
    })

    const guard = createJWordInteractionGuard({
      editorHost: harness.editorHost,
      toolbarHost: harness.toolbarHost,
      controls: harness.controls,
      readonly: {
        enabled: true
      },
      assistive: {
        liveRegion
      }
    })
    const mouseDown = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true
    })
    const copyKey = new KeyboardEvent('keydown', {
      key: 'c',
      ctrlKey: true,
      bubbles: true,
      cancelable: true
    })
    const arrowRight = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      shiftKey: true,
      bubbles: true,
      cancelable: true
    })
    const backspace = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true
    })

    harness.canvasContainer.dispatchEvent(mouseDown)
    harness.textarea.dispatchEvent(copyKey)
    harness.textarea.dispatchEvent(arrowRight)
    harness.textarea.dispatchEvent(backspace)

    expect(pointerSpy).toHaveBeenCalledTimes(1)
    expect(copyKeySpy).toHaveBeenCalledTimes(1)
    expect(mouseDown.defaultPrevented).toBe(false)
    expect(copyKey.defaultPrevented).toBe(false)
    expect(arrowRight.defaultPrevented).toBe(false)
    expect(backspaceSpy).not.toHaveBeenCalled()
    expect(backspace.defaultPrevented).toBe(true)
    expect(liveRegion.announce).toHaveBeenCalledTimes(1)

    guard.destroy()
  })
})

interface Harness {
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly canvasContainer: HTMLElement
  readonly textarea: HTMLTextAreaElement
  readonly bold: HTMLButtonElement
  readonly findReplace: HTMLButtonElement
  readonly headingOutline: HTMLButtonElement
  readonly fontFamily: HTMLSelectElement
  readonly textColor: HTMLInputElement
  readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>
}

/** 创建只读 guard 的最小 DOM 测试环境。 */
function createHarness(): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const canvasContainer = document.createElement('div')
  const textarea = document.createElement('textarea')
  const bold = document.createElement('button')
  const findReplace = document.createElement('button')
  const headingOutline = document.createElement('button')
  const fontFamily = document.createElement('select')
  const textColor = document.createElement('input')

  textarea.setAttribute('data-jword-hidden-textarea', 'true')
  canvasContainer.setAttribute('data-jword-canvas-container', 'true')
  textColor.type = 'color'
  editorHost.append(canvasContainer, textarea)
  toolbarHost.append(bold, findReplace, headingOutline, fontFamily, textColor)
  document.body.append(editorHost, toolbarHost)

  return {
    editorHost,
    toolbarHost,
    canvasContainer,
    textarea,
    bold,
    findReplace,
    headingOutline,
    fontFamily,
    textColor,
    controls: {
      'format.bold': bold,
      'document.findReplace': findReplace,
      'document.headingOutline': headingOutline,
      'format.fontFamily': fontFamily,
      'format.textColor': textColor
    }
  }
}
