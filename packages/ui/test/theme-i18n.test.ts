/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 7 Step 7.9 的主题 token 与 i18n 覆盖会通过公开 createJWordUi 入口生效。
 * 边界：只覆盖 UI 装配入口和 toolbar DOM 文案，不验证截图像素或浏览器渲染引擎。
 * 协作：packages/ui/src/create-ui.ts、theme.ts、i18n.ts 与 toolbar/dom.ts。
 * 约束：通过稳定 data attribute、CSS custom property 和 aria 文案断言，不读取私有 controller 状态。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'
import {
  DEFAULT_JWORD_UI_I18N_DICTIONARY,
  JWORD_UI_BUILTIN_I18N_DICTIONARIES,
  resolveJWordUiI18n
} from '../src/i18n'

describe('Gate 7 theme and i18n', () => {
  test('createJWordUi applies theme name, host class and token overrides without touching editor state', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'theme smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        theme: {
          name: 'dark',
          className: 'tenant-theme',
          tokens: {
            colorAccent: '#123456',
            focusRing: '#abcdef'
          }
        }
      })

      expect(toolbarHost.classList.contains('jw-root')).toBe(true)
      expect(toolbarHost.classList.contains('tenant-theme')).toBe(true)
      expect(toolbarHost.getAttribute('data-theme')).toBe('dark')
      expect(toolbarHost.style.getPropertyValue('--jw-color-accent')).toBe('#123456')
      expect(toolbarHost.style.getPropertyValue('--jw-focus-ring')).toBe('#abcdef')
      expect(editorHost.getAttribute('data-theme')).toBe('dark')
      expect(editor.getProjection().document.sections[0]?.blocks.length).toBeGreaterThan(0)

      ui.destroy()

      expect(toolbarHost.classList.contains('jw-root')).toBe(false)
      expect(toolbarHost.classList.contains('tenant-theme')).toBe(false)
      expect(toolbarHost.getAttribute('data-theme')).toBeNull()
      expect(toolbarHost.style.getPropertyValue('--jw-color-accent')).toBe('')
      expect(editorHost.getAttribute('data-theme')).toBeNull()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('setTheme switches visible tokens between light and dark themes', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'theme switch smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        theme: {
          className: 'tenant-theme'
        }
      })

      ui.setTheme({ name: 'dark' })

      expect(toolbarHost.classList.contains('tenant-theme')).toBe(true)
      expect(toolbarHost.getAttribute('data-theme')).toBe('dark')
      expect(toolbarHost.style.getPropertyValue('--jw-color-surface')).toBe('#09090b')
      expect(toolbarHost.style.getPropertyValue('--jw-color-text')).toBe('#fafafa')

      ui.setTheme({ name: 'light' })

      expect(toolbarHost.getAttribute('data-theme')).toBe('light')
      expect(toolbarHost.style.getPropertyValue('--jw-color-text')).toBe('#454d5a')
      expect(toolbarHost.style.getPropertyValue('--jw-shadow-shell')).toBe('0 2px 8px rgb(31 41 55 / 4%)')

      ui.destroy()

      expect(toolbarHost.getAttribute('data-theme')).toBeNull()
      expect(toolbarHost.style.getPropertyValue('--jw-color-surface')).toBe('')
      expect(editorHost.getAttribute('data-theme')).toBeNull()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('createJWordUi uses English built-ins and keeps host overrides first', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'i18n smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: {
          visibleTools: ['format.bold', 'format.italic']
        },
        i18n: {
          locale: 'en-US',
          dir: 'ltr',
          messages: {
            'toolbar.ariaLabel': 'JWord editing toolbar',
            'toolbar.format.bold.label': 'Bold',
            'toolbar.format.bold.tooltip': 'Toggle bold'
          }
        }
      })
      const bold = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.bold"]')
      const italic = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.italic"]')
      const boldTooltip = bold?.closest('.jw-toolbar__tooltip-anchor')?.querySelector<HTMLElement>('[role="tooltip"]')

      expect(toolbarHost.getAttribute('aria-label')).toBe('JWord editing toolbar')
      expect(toolbarHost.getAttribute('lang')).toBe('en-US')
      expect(toolbarHost.getAttribute('dir')).toBe('ltr')
      expect(bold?.getAttribute('aria-label')).toBe('Bold')
      expect(boldTooltip?.textContent).toBe('Toggle bold')
      expect(italic?.getAttribute('aria-label')).toBe('Italic')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('setLocale refreshes toolbar text without destroying editor', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'locale switch smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: {
          visibleTools: ['format.bold', 'format.fontFamily']
        }
      })
      const bold = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.bold"]')
      const fontFamily = toolbarHost.querySelector<HTMLSelectElement>('[data-jword-format-font-family]')

      expect(bold?.getAttribute('aria-label')).toBe('加粗')
      expect(fontFamily?.getAttribute('aria-label')).toBe('字体')

      ui.setLocale('en-US')

      expect(toolbarHost.getAttribute('lang')).toBe('en-US')
      expect(bold?.getAttribute('aria-label')).toBe('Bold')
      expect(fontFamily?.getAttribute('aria-label')).toBe('Font')
      expect(fontFamily?.querySelector('option[value=""]')?.textContent).toBe('Font')
      expect(editor.getProjection().document.sections[0]?.blocks.length).toBeGreaterThan(0)

      ui.setLocale('zh-CN', {
        'toolbar.format.bold.label': '粗体'
      })

      expect(toolbarHost.getAttribute('lang')).toBe('zh-CN')
      expect(bold?.getAttribute('aria-label')).toBe('粗体')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('setLocale refreshes existing internal toolbar menu text', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'internal menu locale smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: {
          professional: {
            tabTools: {
              page: ['document.headerFooter']
            }
          }
        }
      })
      const pagePresetMenu = toolbarHost.querySelector<HTMLElement>('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')
      const label = pagePresetMenu?.querySelector<HTMLElement>('.jw-toolbar__select-label')
      const fieldLabel = pagePresetMenu?.querySelector<HTMLElement>('.jw-toolbar__select-field-label')
      const trigger = pagePresetMenu?.querySelector<HTMLButtonElement>('.jw-toolbar__select-trigger')
      const b5Description = pagePresetMenu?.querySelector<HTMLElement>(
        '[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:b5"] .jw-toolbar__select-option-description'
      )
      const custom = pagePresetMenu?.querySelector<HTMLButtonElement>(
        '[data-jword-plugin-menu-item-key="plugin:jword.ui:pagePreset:custom"]'
      )

      expect(label?.textContent).toBe('页面')
      expect(fieldLabel?.textContent).toBe('页面')
      expect(b5Description?.textContent).toBe('17.6厘米 × 25厘米')
      expect(custom?.querySelector('.jw-toolbar__select-option-label')?.textContent).toBe('自定义大小')

      ui.setLocale('en-US')

      expect(label?.textContent).toBe('Page')
      expect(fieldLabel?.textContent).toBe('Page')
      expect(pagePresetMenu?.getAttribute('data-jword-field-label')).toBe('Page')
      expect(trigger?.getAttribute('aria-label')).toBe('Page size')
      expect(b5Description?.textContent).toBe('17.6 cm × 25 cm')
      expect(custom?.querySelector('.jw-toolbar__select-option-label')?.textContent).toBe('Custom size')

      custom?.click()

      const dialog = toolbarHost.querySelector<HTMLElement>('[data-jword-page-size-dialog="true"]')

      expect(dialog?.querySelector('[data-jword-page-size-title="true"]')?.textContent).toBe('Custom page size')

      ui.setLocale('zh-CN')

      expect(dialog?.querySelector('[data-jword-page-size-title="true"]')?.textContent).toBe('自定义页面大小')
      expect(dialog?.querySelector('[data-jword-page-size-field="width"] .jw-page-size-dialog__field-label')?.textContent).toBe('宽度')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('setLocale refreshes visible toolbar panels and extension controls', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'extension locale smoke' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        comments: true,
        headerFooter: {},
        link: {},
        headingOutline: {},
        findReplace: {},
        revisions: {}
      })

      ui.elements.controls['document.headerFooter']?.click()
      ui.elements.controls['document.findReplace']?.click()
      ui.elements.controls['insert.link']?.click()

      expect(ui.elements.headerFooterPanel?.addHeaderButton.textContent).toBe('添加页眉')
      expect(ui.elements.findReplacePanel?.queryInput.placeholder).toBe('查找')
      expect(ui.elements.findReplacePanel?.replaceAllButton.textContent).toBe('全部替换')
      expect(ui.elements.headingOutlinePanel?.list.getAttribute('aria-label')).toBe('文档目录')
      expect(ui.elements.revisionsPanel?.root.textContent).toContain('修订记录')
      expect(ui.elements.revisionsPanel?.emptyState.textContent).toBe('暂无修订记录')
      expect(ui.elements.commentsPanel?.title.textContent).toBe('批注')
      expect(ui.elements.linkPanel?.confirmButton.textContent).toBe('插入链接')
      expect(ui.elements.mediaPanel?.triggerButton.getAttribute('aria-label')).toBe('图片')
      expect(ui.elements.mediaPanel?.fileActionButton.textContent).toBe('本地上传')
      expect(ui.elements.tablePanel?.insertTriggerButton.getAttribute('aria-label')).toBe('插入表格')
      expect(ui.elements.tablePanel?.customSizeButton.textContent).toBe('自定义行列')

      ui.setLocale('en-US')

      expect(ui.elements.headerFooterPanel?.addHeaderButton.textContent).toBe('Add header')
      expect(ui.elements.headerFooterPanel?.pageNumberTopLeftButton.textContent).toBe('Top left page number')
      expect(ui.elements.findReplacePanel?.queryInput.placeholder).toBe('Find')
      expect(ui.elements.findReplacePanel?.replaceAllButton.textContent).toBe('Replace all')
      expect(ui.elements.headingOutlinePanel?.list.getAttribute('aria-label')).toBe('Document outline')
      expect(ui.elements.revisionsPanel?.root.textContent).toContain('Revisions')
      expect(ui.elements.revisionsPanel?.emptyState.textContent).toBe('No revisions yet')
      expect(ui.elements.commentsPanel?.title.textContent).toBe('Comments')
      expect(ui.elements.commentsPanel?.composerInput.placeholder).toBe('Enter comment')
      expect(ui.elements.linkPanel?.confirmButton.textContent).toBe('Insert link')
      expect(ui.elements.linkPanel?.visibleTextInput.placeholder).toBe('Display text')
      expect(ui.elements.linkPanel?.cancelButton.textContent).toBe('Cancel')
      expect(ui.elements.mediaPanel?.triggerButton.getAttribute('aria-label')).toBe('Image')
      expect(ui.elements.mediaPanel?.fileActionButton.textContent).toBe('Upload from device')
      expect(ui.elements.mediaPanel?.urlActionButton.textContent).toBe('Image URL')
      expect(ui.elements.tablePanel?.insertTriggerButton.getAttribute('aria-label')).toBe('Insert table')
      expect(ui.elements.tablePanel?.customSizeButton.textContent).toBe('Custom rows and columns')
      expect(ui.elements.tablePanel?.insertRowsInput.getAttribute('aria-label')).toBe('Rows')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('resolveJWordUiI18n keeps default Chinese text when a locale override omits keys', () => {
    const i18n = resolveJWordUiI18n({
      locale: 'tenant',
      messages: {
        'toolbar.format.bold.label': 'Strong'
      }
    })

    expect(i18n.locale).toBe('tenant')
    expect(i18n.t('toolbar.format.bold.label', '加粗')).toBe('Strong')
    expect(i18n.t('toolbar.format.italic.label', '斜体')).toBe('斜体')
    expect(i18n.t('diagnostics.pluginAdapterFailed', '插件适配器执行失败。')).toBe('插件适配器执行失败。')
  })

  test('built-in English dictionary covers every built-in Chinese key', () => {
    const englishKeys = new Set(Object.keys(JWORD_UI_BUILTIN_I18N_DICTIONARIES['en-US']))

    for (const key of Object.keys(DEFAULT_JWORD_UI_I18N_DICTIONARY)) {
      expect(englishKeys.has(key), key).toBe(true)
    }
  })
})
