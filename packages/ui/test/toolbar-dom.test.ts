/**
 * @vitest-environment jsdom
 *
 * 职责：验证 toolbar select DOM 会按工具元数据切换菜单布局与尺寸，不给纯文本下拉保留左侧空槽。
 * 边界：只覆盖 packages/ui 的 DOM 构造，不验证 controller 事件分发或截图级视觉细节。
 * 协作：packages/ui/src/toolbar/dom.ts 与 builtin-tools.ts。
 * 约束：断言基于稳定 data attribute / inline CSS variable，不把浏览器布局像素写死成快照。
 */

import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

import { resolveJWordUiI18n } from '../src/i18n'
import { resolveToolbarConfig } from '../src/toolbar/config'
import { createToolbarDom, destroyToolbarDom, localizeToolbarDom, renderToolbarState } from '../src/toolbar/dom'
import type { ToolbarState } from '../src/toolbar/state'

const toolbarStylesheetPath = existsSync('packages/ui/src/styles/toolbar.css')
  ? 'packages/ui/src/styles/toolbar.css'
  : 'src/styles/toolbar.css'

describe('toolbar select dom', () => {
  test('renders professional tabs by default and switches active tab without rebuilding controls', () => {
    const host = document.createElement('div')
    const config = resolveToolbarConfig()
    const dom = createToolbarDom(host, config)

    try {
      const homeTab = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-tab="home"]')
      const pageTab = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-tab="page"]')
      const homePanel = host.querySelector<HTMLElement>('[data-jword-toolbar-tab-panel="home"]')
      const pagePanel = host.querySelector<HTMLElement>('[data-jword-toolbar-tab-panel="page"]')

      expect(host.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(homeTab?.textContent).toBe('开始')
      expect(homeTab?.getAttribute('aria-selected')).toBe('true')
      expect(homePanel?.hidden).toBe(false)
      expect(pagePanel?.hidden).toBe(true)
      expect(homePanel?.querySelector('[data-jword-tool-id="format.bold"]')).not.toBeNull()

      pageTab?.click()

      expect(host.getAttribute('data-jword-toolbar-active-tab')).toBe('page')
      expect(homeTab?.getAttribute('aria-selected')).toBe('false')
      expect(pageTab?.getAttribute('aria-selected')).toBe('true')
      expect(homePanel?.hidden).toBe(true)
      expect(pagePanel?.hidden).toBe(false)
      expect(pagePanel?.querySelector('[data-jword-tool-id="document.pagePreset"]')).not.toBeNull()
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('mode picker is fixed under toolbar host and switches through a selected dropdown option', () => {
    const host = document.createElement('div')
    const config = resolveToolbarConfig()
    const dom = createToolbarDom(host, config)

    try {
      const topRow = host.querySelector<HTMLElement>('.jw-toolbar__top-row')
      const picker = host.querySelector<HTMLElement>('[data-jword-toolbar-mode-picker="true"]')
      const switcher = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-switcher="true"]')
      const menu = host.querySelector<HTMLElement>('[data-jword-toolbar-mode-menu="true"]')
      const professionalOption = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="professional"]')
      const commonOption = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="common"]')
      const tabs = host.querySelector<HTMLElement>('.jw-toolbar__tabs')
      const homePanel = host.querySelector<HTMLElement>('[data-jword-toolbar-tab-panel="home"]')
      const commonPanel = host.querySelector<HTMLElement>('[data-jword-toolbar-common-panel="true"]')

      expect(picker).toBeInstanceOf(HTMLElement)
      expect(picker?.parentElement).toBe(host)
      expect(topRow?.contains(picker!)).toBe(false)
      expect(switcher?.textContent).toContain('切换工具栏')
      expect(menu?.hidden).toBe(true)
      expect(commonPanel?.hidden).toBe(true)
      expect(professionalOption?.getAttribute('data-jword-selected')).toBe('true')
      expect(commonOption?.getAttribute('data-jword-selected')).toBe('false')

      switcher?.click()

      expect(host.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(menu?.hidden).toBe(false)

      commonOption?.click()

      expect(host.getAttribute('data-jword-toolbar-mode')).toBe('common')
      expect(menu?.hidden).toBe(true)
      expect(topRow?.hidden).toBe(true)
      expect(tabs?.hidden).toBe(true)
      expect(homePanel?.hidden).toBe(true)
      expect(commonPanel?.hidden).toBe(false)
      expect(commonPanel?.querySelector('[data-jword-tool-id="format.bold"]')).not.toBeNull()
      expect(commonPanel?.querySelector('[data-jword-tool-id="document.pagePreset"]')).toBeNull()
      expect(professionalOption?.getAttribute('data-jword-selected')).toBe('false')
      expect(commonOption?.getAttribute('data-jword-selected')).toBe('true')

      switcher?.click()
      professionalOption?.click()

      expect(host.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(topRow?.hidden).toBe(false)
      expect(tabs?.hidden).toBe(false)
      expect(homePanel?.hidden).toBe(false)
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('localizes professional tabs and mode switcher without recreating toolbar', () => {
    const host = document.createElement('div')
    const config = resolveToolbarConfig()
    const dom = createToolbarDom(host, config)

    try {
      const homeTab = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-tab="home"]')
      const switcher = host.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-switcher="true"]')

      localizeToolbarDom(dom, config, resolveJWordUiI18n({ locale: 'en-US' }))

      expect(host.getAttribute('lang')).toBe('en-US')
      expect(homeTab?.textContent).toBe('Home')
      expect(switcher?.textContent).toContain('Switch toolbar')
      expect(switcher?.getAttribute('aria-label')).toBe('Switch toolbar')
      expect(host.querySelector('[data-jword-toolbar-mode-option="professional"]')?.textContent).toContain('Professional toolbar')
      expect(host.querySelector('[data-jword-toolbar-mode-option="common"]')?.textContent).toContain('Common toolbar')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('does not render legacy toolbar summary nodes', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.bold']
    }))

    try {
      expect(host.querySelector('[data-jword-selection-summary]')).toBeNull()
      expect(host.querySelector('[data-jword-run-summary]')).toBeNull()
      expect(host.querySelector('[data-jword-blocked-summary]')).toBeNull()
      expect(host.querySelector('.jw-toolbar__summary')).toBeNull()
    } finally {
      destroyToolbarDom(dom)
    }
  })

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

  test('renders heading outline as a toggle button without a dropdown arrow', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['document.findReplace', 'document.headingOutline']
    }))

    try {
      renderToolbarState(dom, createToolbarState(), null, {
        headingOutline: true,
        headingOutlineAvailable: true
      })

      const findReplace = host.querySelector<HTMLElement>('[data-jword-tool-id="document.findReplace"]')
      const headingOutline = host.querySelector<HTMLElement>('[data-jword-tool-id="document.headingOutline"]')

      expect(findReplace?.querySelector('.jw-toolbar__select-arrow')).toBeInstanceOf(HTMLElement)
      expect(headingOutline?.querySelector('.jw-toolbar__select-arrow')).toBeNull()
      expect(headingOutline?.getAttribute('aria-pressed')).toBe('true')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('groups professional dropdown icons and carets without absolute positioning', () => {
    const host = document.createElement('div')
    const style = document.createElement('style')

    style.textContent = readFileSync(toolbarStylesheetPath, 'utf8')
    document.head.append(style)
    document.body.append(host)

    const dom = createToolbarDom(host, resolveToolbarConfig({
      professional: {
        tabTools: {
          page: ['document.pagePreset', 'document.headerFooter']
        }
      }
    }))

    try {
      const selectTrigger = host.querySelector<HTMLElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-trigger'
      )
      const selectIcon = selectTrigger?.querySelector<HTMLElement>('.jw-toolbar__select-trigger-icon')
      const selectArrow = selectTrigger?.querySelector<HTMLElement>('.jw-toolbar__select-arrow')
      const selectRow = selectTrigger?.querySelector<HTMLElement>(':scope > .jw-toolbar__select-trigger-row')
      const selectFieldLabel = selectTrigger?.querySelector<HTMLElement>(':scope > .jw-toolbar__select-field-label')
      const button = host.querySelector<HTMLElement>('[data-jword-tool-id="document.headerFooter"]')
      const buttonIcon = button?.querySelector<HTMLElement>('.jw-toolbar__button-icon')
      const buttonArrow = button?.querySelector<HTMLElement>('.jw-toolbar__select-arrow')
      const buttonRow = button?.querySelector<HTMLElement>(':scope > .jw-toolbar__button-icon-row')
      const buttonLabel = button?.querySelector<HTMLElement>(':scope > .jw-toolbar__button-label')

      expect(selectRow).toBeInstanceOf(HTMLElement)
      expect(selectIcon?.parentElement).toBe(selectRow)
      expect(selectArrow?.parentElement).toBe(selectRow)
      expect(selectFieldLabel?.parentElement).toBe(selectTrigger)
      expect(selectRow?.contains(selectFieldLabel ?? null)).toBe(false)
      expect(buttonRow).toBeInstanceOf(HTMLElement)
      expect(buttonIcon?.parentElement).toBe(buttonRow)
      expect(buttonArrow?.parentElement).toBe(buttonRow)
      expect(buttonLabel?.parentElement).toBe(button)
      expect(buttonRow?.contains(buttonLabel ?? null)).toBe(false)
      expect(getComputedStyle(selectArrow!).position).not.toBe('absolute')
      expect(getComputedStyle(selectFieldLabel!).position).not.toBe('absolute')
      expect(getComputedStyle(selectFieldLabel!).display).toBe('block')
      expect(getComputedStyle(buttonArrow!).position).not.toBe('absolute')
      expect(getComputedStyle(buttonLabel!).position).not.toBe('absolute')
    } finally {
      destroyToolbarDom(dom)
      style.remove()
      host.remove()
    }
  })


  test('exposes toolbar role and roving tabindex keyboard navigation', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.bold', 'format.italic', 'format.fontFamily', 'format.textColor']
    }))

    document.body.append(host)

    try {
      renderToolbarState(dom, createToolbarState())

      const bold = host.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.bold"]')
      const italic = host.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.italic"]')
      const fontTrigger = host.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')
      const colorInput = host.querySelector<HTMLInputElement>('[data-jword-tool-id="format.textColor"] .jw-toolbar__color')
      const nativeSelect = host.querySelector<HTMLSelectElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select')

      expect(host.getAttribute('role')).toBe('toolbar')
      expect(bold?.tabIndex).toBe(0)
      expect(italic?.tabIndex).toBe(-1)
      expect(fontTrigger?.tabIndex).toBe(-1)
      expect(nativeSelect?.tabIndex).toBe(-1)
      expect(colorInput?.tabIndex).toBe(-1)

      bold?.focus()
      bold?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        bubbles: true
      }))

      expect(document.activeElement).toBe(italic)
      expect(bold?.tabIndex).toBe(-1)
      expect(italic?.tabIndex).toBe(0)

      italic?.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'End',
        bubbles: true
      }))

      expect(document.activeElement).toBe(colorInput)
      expect(colorInput?.tabIndex).toBe(0)
    } finally {
      destroyToolbarDom(dom)
      host.remove()
    }
  })

  test('adds listbox option semantics to custom select menus', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.fontFamily']
    }))

    try {
      renderToolbarState(dom, createToolbarState({
        fontFamilyValue: 'Arial'
      }))

      const menu = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-menu')
      const trigger = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')
      const arialOption = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-option[data-jword-option-value="Arial"]')
      const simsunOption = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-option[data-jword-option-value="SimSun"]')

      expect(menu?.getAttribute('role')).toBe('listbox')
      expect(menu?.id).not.toBe('')
      expect(trigger?.getAttribute('aria-controls')).toBe(menu?.id)
      expect(arialOption?.getAttribute('role')).toBe('option')
      expect(arialOption?.getAttribute('aria-selected')).toBe('true')
      expect(simsunOption?.getAttribute('aria-selected')).toBe('false')
    } finally {
      destroyToolbarDom(dom)
    }
  })

  test('links tooltip ids to focusable toolbar controls', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.bold', 'format.fontFamily', 'format.textColor']
    }))

    try {
      const bold = host.querySelector<HTMLElement>('[data-jword-tool-id="format.bold"]')
      const fontTrigger = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')
      const colorInput = host.querySelector<HTMLElement>('[data-jword-tool-id="format.textColor"] .jw-toolbar__color')
      const boldTooltip = bold?.closest('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')
      const fontTooltip = fontTrigger?.closest('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')
      const colorTooltip = colorInput?.closest('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')

      expect(boldTooltip?.id).not.toBe('')
      expect(fontTooltip?.id).not.toBe('')
      expect(colorTooltip?.id).not.toBe('')
      expect(bold?.getAttribute('aria-describedby')).toBe(boldTooltip?.id)
      expect(fontTrigger?.getAttribute('aria-describedby')).toBe(fontTooltip?.id)
      expect(colorInput?.getAttribute('aria-describedby')).toBe(colorTooltip?.id)
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

  test('styles professional select tiles with wrapper hover and open background', () => {
    const stylesheet = readFileSync(toolbarStylesheetPath, 'utf8')
    const professionalSelectScope = ".jw-toolbar[data-jword-toolbar-mode='professional'] .jw-toolbar__tabpanel:not([data-jword-toolbar-tab-panel='home']) .jw-toolbar__select-wrap"

    expect(stylesheet).toContain(`${professionalSelectScope}:hover`)
    expect(stylesheet).toContain(`${professionalSelectScope}[data-jword-open='true']`)
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

  test('closes custom select when clicking outside the toolbar dropdown', () => {
    const host = document.createElement('div')
    const outsideTarget = document.createElement('button')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.fontFamily']
    }))

    document.body.append(host, outsideTarget)

    try {
      const wrapper = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"]')
      const trigger = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-trigger')
      const menu = host.querySelector<HTMLElement>('[data-jword-tool-id="format.fontFamily"] .jw-toolbar__select-menu')

      expect(wrapper).toBeInstanceOf(HTMLElement)
      expect(trigger).toBeInstanceOf(HTMLElement)
      expect(menu).toBeInstanceOf(HTMLElement)

      trigger?.dispatchEvent(new MouseEvent('click', { bubbles: true }))

      expect(wrapper?.getAttribute('data-jword-open')).toBe('true')
      expect(menu?.hidden).toBe(false)

      outsideTarget.click()

      expect(wrapper?.getAttribute('data-jword-open')).toBe('false')
      expect(menu?.hidden).toBe(true)
    } finally {
      destroyToolbarDom(dom)
      host.remove()
      outsideTarget.remove()
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

  test('preserves active color input value while picker is open', () => {
    const host = document.createElement('div')
    const dom = createToolbarDom(host, resolveToolbarConfig({
      visibleTools: ['format.textColor', 'format.backgroundColor']
    }))

    try {
      const textColor = host.querySelector<HTMLInputElement>('[data-jword-format-text-color]')
      const backgroundColor = host.querySelector<HTMLInputElement>('[data-jword-format-background-color]')

      expect(textColor).toBeInstanceOf(HTMLInputElement)
      expect(backgroundColor).toBeInstanceOf(HTMLInputElement)

      if (textColor === null || backgroundColor === null) {
        throw new Error('缺少颜色控件')
      }

      textColor.value = '#3366ff'
      backgroundColor.value = '#99cc00'
      renderToolbarState(dom, createToolbarState({
        textColorValue: '#111111',
        backgroundColorValue: '#fff59d'
      }), 'textColor')

      expect(textColor.value).toBe('#3366ff')
      expect(textColor.parentElement?.style.getPropertyValue('--jw-toolbar-color')).toBe('#3366ff')
      expect(backgroundColor.value).toBe('#fff59d')
      expect(backgroundColor.parentElement?.style.getPropertyValue('--jw-toolbar-color')).toBe('#fff59d')

      renderToolbarState(dom, createToolbarState({
        textColorValue: '#111111',
        backgroundColorValue: '#fff59d'
      }), 'backgroundColor')

      expect(textColor.value).toBe('#111111')
      expect(backgroundColor.value).toBe('#fff59d')
      expect(backgroundColor.parentElement?.style.getPropertyValue('--jw-toolbar-color')).toBe('#fff59d')
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
    pageOrientationValue: 'portrait',
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
    ...overrides
  }
}
