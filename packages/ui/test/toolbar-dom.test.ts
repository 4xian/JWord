/**
 * @vitest-environment jsdom
 *
 * 职责：验证 toolbar select DOM 会按工具元数据切换菜单布局与尺寸，不给纯文本下拉保留左侧空槽。
 * 边界：只覆盖 packages/ui 的 DOM 构造，不验证 controller 事件分发或截图级视觉细节。
 * 协作：packages/ui/src/toolbar/dom.ts 与 builtin-tools.ts。
 * 约束：断言基于稳定 data attribute / inline CSS variable，不把浏览器布局像素写死成快照。
 */

import { describe, expect, test } from 'vitest'

import { resolveToolbarConfig } from '../src/toolbar/config'
import { createToolbarDom, destroyToolbarDom, renderToolbarState } from '../src/toolbar/dom'
import type { ToolbarState } from '../src/toolbar/state'

describe('toolbar select dom', () => {
  test('renders superscript and subscript buttons as regular toggle tools', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.superscript', 'format.subscript']
    }))

    try {
      renderToolbarState(dom, createToolbarState({
        superscriptPressed: 'true',
        subscriptPressed: 'false'
      }))

      const superscript = host.querySelector<HTMLElement>('[data-jword-tool-id="format.superscript"]')
      const subscript = host.querySelector<HTMLElement>('[data-jword-tool-id="format.subscript"]')

      expect(superscript?.getAttribute('aria-label')).toBe('上标')
      expect(subscript?.getAttribute('aria-label')).toBe('下标')
      expect(superscript?.getAttribute('aria-pressed')).toBe('true')
      expect(subscript?.getAttribute('aria-pressed')).toBe('false')
      expect(superscript?.querySelector('svg')).toBeInstanceOf(SVGElement)
      expect(subscript?.querySelector('svg')).toBeInstanceOf(SVGElement)
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('renders text menus without a leading icon slot and keeps icon menus explicit', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['document.pagePreset', 'format.fontFamily', 'format.fontSize', 'paragraph.alignment', 'paragraph.list']
    }))

    try {
      const pagePreset = host.querySelector<HTMLElement>('[data-jword-tool-id="document.pagePreset"]')
      const fontFamily = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"]')
      const fontSize = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontSize"]')
      const alignment = host.querySelector<HTMLElement>('[data-jword-tool-id="paragraph.alignment"]')
      const list = host.querySelector<HTMLElement>('[data-jword-tool-id="paragraph.list"]')

      expect(pagePreset?.getAttribute('data-jword-menu-text-align')).toBe('start')
      expect(fontFamily?.getAttribute('data-jword-menu-layout')).toBe('text')
      expect(fontFamily?.getAttribute('data-jword-menu-text-align')).toBe('start')
      expect(fontFamily?.style.getPropertyValue('--jw-toolbar-trigger-min-width')).toBe('92px')
      expect(fontFamily?.style.getPropertyValue('--jw-toolbar-select-menu-min-width')).toBe('116px')
      expect(fontFamily?.querySelector('.jw-toolbar__select-option-icon')).toBeNull()
      expect(fontSize?.getAttribute('data-jword-menu-text-align')).toBe('start')

      const fontOption = fontFamily?.querySelector<HTMLElement>('.jw-toolbar__select-option')

      expect(fontOption?.firstElementChild?.className).toContain('jw-toolbar__select-option-label')
      expect(fontOption?.lastElementChild?.className).toContain('jw-toolbar__select-option-check')

      expect(alignment?.getAttribute('data-jword-menu-layout')).toBe('icon')
      expect(alignment?.querySelector('.jw-toolbar__select-option-icon')).toBeInstanceOf(HTMLElement)
      expect(list?.style.getPropertyValue('--jw-toolbar-select-menu-min-width')).toBe('160px')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('prevents mouse down on toolbar buttons and custom select parts from stealing editor focus', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.bold', 'format.fontFamily']
    }))

    try {
      const boldButton = host.querySelector<HTMLElement>('[data-jword-tool-id="format.bold"]')
      const fontFamilyTrigger = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')

      fontFamilyTrigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      const fontFamilyOption = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-option')
      const boldMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      const triggerMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
      const optionMouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

      expect(boldButton?.dispatchEvent(boldMouseDown)).toBe(false)
      expect(boldMouseDown.defaultPrevented).toBe(true)
      expect(fontFamilyTrigger?.dispatchEvent(triggerMouseDown)).toBe(false)
      expect(triggerMouseDown.defaultPrevented).toBe(true)
      expect(fontFamilyOption?.dispatchEvent(optionMouseDown)).toBe(false)
      expect(optionMouseDown.defaultPrevented).toBe(true)
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('hides tooltip immediately after clicking a toolbar button until the pointer leaves', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.bold']
    }))

    try {
      const button = host.querySelector<HTMLElement>('[data-jword-tool-id="format.bold"]')
      const tooltipAnchor = button?.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')

      expect(button).toBeInstanceOf(HTMLElement)
      expect(tooltipAnchor).toBeInstanceOf(HTMLElement)

      button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('true')

      button?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('false')

      button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('false')

      tooltipAnchor?.dispatchEvent(new MouseEvent('mouseout', {
        bubbles: true,
        relatedTarget: null
      }))
      button?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('true')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('does not show tooltip when hovering dropdown options', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.fontFamily']
    }))

    try {
      const trigger = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')
      const option = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-option[data-jword-option-value="Arial"]')
      const tooltipAnchor = trigger?.closest<HTMLElement>('.jw-toolbar__tooltip-anchor')

      expect(trigger).toBeInstanceOf(HTMLElement)
      expect(option).toBeInstanceOf(HTMLElement)
      expect(tooltipAnchor).toBeInstanceOf(HTMLElement)

      trigger?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('true')

      trigger?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('false')

      option?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      expect(tooltipAnchor?.getAttribute('data-jword-tooltip-visible')).toBe('false')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('shows current runtime font values even when they are outside the static select options', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.fontFamily', 'format.fontSize']
    }))

    try {
      renderToolbarState(dom, createToolbarState({
        fontFamilyValue: 'Corp Sans',
        fontFamilyState: 'value',
        fontSizeValue: '510',
        fontSizeState: 'value'
      }))

      const fontFamilyTriggerLabel = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-label')
      const fontFamilyRuntimeOption = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] [data-jword-runtime-option="true"]')
      const fontSizeTriggerLabel = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontSize"] .jw-toolbar__select-label')
      const fontSizeRuntimeOption = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontSize"] [data-jword-runtime-option="true"]')

      expect(fontFamilyTriggerLabel?.textContent).toBe('Corp Sans')
      expect(fontFamilyRuntimeOption?.getAttribute('data-jword-option-value')).toBe('Corp Sans')
      expect(fontFamilyRuntimeOption?.getAttribute('data-jword-selected')).toBe('true')
      expect(fontSizeTriggerLabel?.textContent).toBe('25.5 pt')
      expect(fontSizeRuntimeOption?.getAttribute('data-jword-option-value')).toBe('510')
      expect(fontSizeRuntimeOption?.textContent).toContain('25.5 pt')
      expect(fontSizeRuntimeOption?.getAttribute('data-jword-selected')).toBe('true')
    } finally {
      destroyToolbarDom(dom)
    }
  })
})

function createToolbarState(overrides: Partial<ToolbarState> = {}): ToolbarState {
  return {
    canUndo: false,
    canRedo: false,
    runFormatEnabled: true,
    paragraphFormatEnabled: true,
    pagePresetValue: 'a4',
    boldPressed: 'false',
    italicPressed: 'false',
    underlinePressed: 'false',
    strikePressed: 'false',
    superscriptPressed: 'false',
    subscriptPressed: 'false',
    fontFamilyValue: 'Arial',
    fontFamilyState: 'value',
    fontSizeValue: '240',
    fontSizeState: 'value',
    textColorValue: '#111111',
    textColorState: 'value',
    textColorLabel: '#111111',
    backgroundColorValue: '#fff59d',
    backgroundColorState: 'value',
    backgroundColorLabel: '#fff59d',
    paragraphAlignmentValue: 'left',
    paragraphAlignmentState: 'value',
    paragraphIndentLeftValue: '0',
    paragraphIndentLeftState: 'value',
    paragraphLineHeightValue: '1',
    paragraphLineHeightState: 'value',
    paragraphSpacingBeforeValue: '0',
    paragraphSpacingBeforeState: 'value',
    paragraphSpacingAfterValue: '0',
    paragraphSpacingAfterState: 'value',
    paragraphFirstLineIndentValue: '0',
    paragraphFirstLineIndentState: 'value',
    paragraphHangingIndentValue: '0',
    paragraphHangingIndentState: 'value',
    paragraphStyleValue: 'Normal',
    paragraphStyleState: 'value',
    paragraphListValue: 'none',
    paragraphListState: 'value',
    selectionSummary: '',
    runSummary: '',
    blockedSummary: '',
    ...overrides
  }
}
