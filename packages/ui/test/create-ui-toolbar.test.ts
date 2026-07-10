/**
 * @vitest-environment jsdom
 *
 * 职责：验证 createJWordUi 的 toolbar 顶层显示开关。
 * 边界：只覆盖 UI 装配入口是否隐藏整条 toolbar，不验证各业务面板行为。
 * 协作：packages/ui/src/create-ui.ts、toolbar/controller.ts 与公开 CreateJWordUiOptions。
 * 约束：通过公开 DOM 和 elements 断言，避免读取 controller 私有状态。
 */

import { createEditor } from '@4xian/jword-core'
import type { PluginDefinition } from '@4xian/jword-core'
import { describe, expect, test, vi } from 'vitest'

import { createJWordUi } from '../src/create-ui'
import type { JWordMediaOptions, JWordTableOptions } from '../src/types'

describe('createJWordUi toolbar config', () => {
  test('未传 toolbarHost 时会在已挂载 editorHost 内自动创建默认 toolbar 宿主', () => {
    const editorHost = document.createElement('div')
    const editor = createEditor({ initialText: 'toolbar auto host' })

    document.body.append(editorHost)

    try {
      editor.mount(editorHost)
      const editorShell = editorHost.querySelector<HTMLElement>('[data-jword-editor]')

      expect(editorShell).not.toBeNull()

      const ui = createJWordUi({
        editor,
        editorHost
      })

      const toolbarHost = editorHost.querySelector<HTMLElement>('[data-jword-toolbar-host="true"]')
      const insertPanel = toolbarHost?.querySelector<HTMLElement>('[data-jword-toolbar-tab-panel="insert"]') ?? null
      const tablePanel = toolbarHost?.querySelector<HTMLElement>('[data-jword-toolbar-tab-panel="table"]') ?? null
      const mediaTrigger = toolbarHost?.querySelector<HTMLButtonElement>('[data-jword-media-trigger="true"]') ?? null
      const tableTrigger = toolbarHost?.querySelector<HTMLButtonElement>('[data-jword-table-insert-trigger="true"]') ?? null

      expect(toolbarHost).not.toBeNull()
      expect(toolbarHost?.nextElementSibling).toBe(editorShell)
      expect(toolbarHost?.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(toolbarHost?.querySelector('[data-jword-toolbar-tab="home"]')).not.toBeNull()
      expect(toolbarHost?.querySelector('[data-jword-tool-id="document.pagePreset"]')).not.toBeNull()
      expect(toolbarHost?.querySelector('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')).toBeNull()
      expect(toolbarHost?.querySelector('[data-jword-tool-id="document.findReplace"]')).not.toBeNull()
      expect(mediaTrigger).not.toBeNull()
      expect(mediaTrigger?.disabled).toBe(false)
      expect(insertPanel?.querySelector('[data-jword-media-trigger="true"]')).toBe(mediaTrigger)
      expect(tableTrigger).not.toBeNull()
      expect(tableTrigger?.disabled).toBe(false)
      expect(tableTrigger?.getAttribute('aria-label')).toBe('插入表格')
      expect(tablePanel?.querySelector('[data-jword-table-insert-trigger="true"]')).toBe(tableTrigger)
      expect(tablePanel?.querySelector('[data-jword-table-action="insert-row-before"]')).not.toBeNull()
      expect(ui.elements.mediaPanel).not.toBeNull()
      expect(ui.elements.tablePanel).not.toBeNull()
      expect(editorHost.style.display).toBe('flex')
      expect(editorShell?.style.flex).toBe('1 1 auto')
      expect(editorShell?.style.height).toBe('auto')

      ui.destroy()

      expect(editorHost.querySelector('[data-jword-toolbar-host="true"]')).toBeNull()
      expect(editorHost.style.display).toBe('')
      expect(editorShell?.style.height).toBe('100%')
    } finally {
      editor.destroy()
      editorHost.remove()
    }
  })

  test('toolbar false 会隐藏整条 toolbar 且不暴露可用工具', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'toolbar hidden' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: false
      })

      expect(toolbarHost.hidden).toBe(true)
      expect(toolbarHost.querySelector('[data-jword-tool-id]')).toBeNull()
      expect(Object.keys(ui.elements.controls)).toHaveLength(0)

      ui.refresh()
      ui.destroy()
      expect(toolbarHost.hidden).toBe(false)
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('toolbar false 不会把图片和表格扩展入口回退挂到 toolbar 宿主', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'toolbar hidden extensions' })
    const media: JWordMediaOptions = {
      adapter: {
        async upload() {
          throw new Error('测试不应触发图片上传。')
        }
      }
    }
    const table: JWordTableOptions = {
      commands: {}
    }

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: false,
        media,
        table
      })

      expect(toolbarHost.hidden).toBe(true)
      expect(toolbarHost.querySelector('[data-jword-media-trigger="true"]')).toBeNull()
      expect(toolbarHost.querySelector('[data-jword-table-toolbar="true"]')).toBeNull()
      expect(toolbarHost.querySelector('[data-jword-table-insert-trigger="true"]')).toBeNull()

      ui.destroy()
      expect(toolbarHost.hidden).toBe(false)
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('toolbar false 不创建依赖 toolbar 入口的隐藏面板', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const panelHost = document.createElement('div')
    const editor = createEditor({ initialText: 'toolbar hidden panels' })

    document.body.append(editorHost, toolbarHost, panelHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: false,
        headerFooter: {
          host: panelHost
        },
        headingOutline: {
          host: panelHost
        },
        findReplace: {
          host: panelHost
        },
        revisions: {
          host: panelHost
        }
      })

      expect(ui.elements.headerFooterPanel).toBeNull()
      expect(ui.elements.headingOutlinePanel).toBeNull()
      expect(ui.elements.findReplacePanel).toBeNull()
      expect(ui.elements.revisionsPanel).toBeNull()
      expect(panelHost.querySelector('[data-jword-header-footer]')).toBeNull()
      expect(panelHost.querySelector('[data-jword-heading-outline]')).toBeNull()
      expect(panelHost.querySelector('[data-jword-find-replace]')).toBeNull()
      expect(panelHost.querySelector('[data-jword-revisions-panel]')).toBeNull()

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      panelHost.remove()
    }
  })

  test('默认专业工具栏可切换常用模式并播报当前语言', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const liveRegionHost = document.createElement('div')
    const editor = createEditor({ initialText: 'toolbar mode switch' })

    document.body.append(editorHost, toolbarHost, liveRegionHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost
      })
      const switcher = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-switcher="true"]')
      const commonOption = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="common"]')
      const professionalOption = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-toolbar-mode-option="professional"]')
      const modeMenu = toolbarHost.querySelector<HTMLElement>('[data-jword-toolbar-mode-menu="true"]')
      const commonPanel = toolbarHost.querySelector<HTMLElement>('[data-jword-toolbar-common-panel="true"]')
      const mediaTrigger = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-media-trigger="true"]')
      const tableTrigger = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-table-insert-trigger="true"]')
      const tableActionRow = toolbarHost.querySelector<HTMLElement>('.jw-table-toolbar__action-row')
      const tableActionButtons = () => [
        ...toolbarHost.querySelectorAll<HTMLButtonElement>('[data-jword-table-action]')
      ]

      expect(toolbarHost.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(tableActionRow?.hidden).toBe(false)
      expect(tableActionRow?.style.display).toBe('')
      expect(tableActionButtons().every((button) => button.hidden === false)).toBe(true)
      expect(switcher?.textContent).toContain('切换工具栏')
      switcher?.click()
      commonOption?.click()

      expect(toolbarHost.getAttribute('data-jword-toolbar-mode')).toBe('common')
      expect(modeMenu?.hidden).toBe(true)
      expect(commonOption?.getAttribute('data-jword-selected')).toBe('true')
      expect(professionalOption?.getAttribute('data-jword-selected')).toBe('false')
      expect(commonPanel?.hidden).toBe(false)
      expect(commonPanel?.querySelector('[data-jword-media-trigger="true"]')).toBe(mediaTrigger)
      expect(commonPanel?.querySelector('[data-jword-table-insert-trigger="true"]')).toBe(tableTrigger)
      expect(tableActionRow?.hidden).toBe(true)
      expect(tableActionRow?.style.display).toBe('none')
      expect(tableActionButtons().every((button) => button.hidden === true)).toBe(true)
      ui.refresh()
      expect(tableActionRow?.hidden).toBe(true)
      expect(tableActionButtons().every((button) => button.hidden === true)).toBe(true)
      expect(liveRegionHost.textContent).toContain('已切换为 常用 工具栏')

      ui.setLocale('en-US')
      expect(switcher?.textContent).toContain('Switch toolbar')
      expect(commonOption?.textContent).toContain('Common toolbar')
      expect(professionalOption?.textContent).toContain('Professional toolbar')
      switcher?.click()
      professionalOption?.click()

      expect(toolbarHost.getAttribute('data-jword-toolbar-mode')).toBe('professional')
      expect(tableActionRow?.hidden).toBe(false)
      expect(tableActionRow?.style.display).toBe('')
      expect(tableActionButtons().every((button) => button.hidden === false)).toBe(true)
      expect(professionalOption?.getAttribute('data-jword-selected')).toBe('true')
      expect(commonOption?.getAttribute('data-jword-selected')).toBe('false')
      expect(tableTrigger?.getAttribute('aria-label')).toBe('Insert table')
      expect(liveRegionHost.textContent).toContain('Switched to Professional toolbar')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
    }
  })

  test('页面水印 API 与工具栏菜单共享实例级水印状态', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const liveRegionHost = document.createElement('div')
    const editor = createEditor({ initialText: 'watermark toolbar' })

    document.body.append(editorHost, toolbarHost, liveRegionHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost
      })
      const canvas = editorHost.querySelector<HTMLElement>('[data-jword-canvas-container]')

      ui.setWatermark({
        text: '内部资料\n禁止外传',
        fontSizePx: 32,
        color: '#ff0000'
      })

      expect(ui.getWatermark()).toMatchObject({
        text: '内部资料\n禁止外传',
        fontSizePx: 32,
        color: '#ff0000'
      })
      expect(canvas?.querySelector('[data-jword-watermark-layer="user"]')).not.toBeNull()

      ui.clearWatermark()
      expect(ui.getWatermark()).toBeNull()
      expect(canvas?.querySelector('[data-jword-watermark-layer="user"]')).toBeNull()

      const button = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="document.watermark"]')

      expect(button).toBeInstanceOf(HTMLButtonElement)
      button?.click()

      const menu = toolbarHost.querySelector<HTMLElement>('[data-jword-watermark-menu="true"]')
      const content = menu?.querySelector<HTMLTextAreaElement>('[data-jword-watermark-content="true"]')
      const fontSize = menu?.querySelector<HTMLInputElement>('[data-jword-watermark-font-size="true"]')
      const color = menu?.querySelector<HTMLInputElement>('[data-jword-watermark-color="true"]')
      const apply = menu?.querySelector<HTMLButtonElement>('[data-jword-watermark-apply="true"]')

      expect(menu?.hidden).toBe(false)
      expect(menu?.querySelector('[data-jword-watermark-label="content"]')?.textContent).toBe('水印内容')
      if (content === null || content === undefined || fontSize === null || fontSize === undefined || color === null || color === undefined) {
        throw new Error('水印菜单输入未创建')
      }

      content.value = 'Draft\nSecret'
      fontSize.value = '30'
      color.value = '#00ff00'
      apply?.click()
      await Promise.resolve()

      expect(ui.getWatermark()).toMatchObject({
        text: 'Draft\nSecret',
        fontSizePx: 30,
        color: '#00ff00'
      })
      expect(menu?.hidden).toBe(true)
      expect(liveRegionHost.textContent).toContain('页面水印已应用')

      button?.click()
      ui.setLocale('en-US')
      expect(menu?.querySelector('[data-jword-watermark-label="content"]')?.textContent).toBe('Watermark content')
      expect(menu?.querySelector<HTMLButtonElement>('[data-jword-watermark-clear="true"]')?.textContent).toBe('Clear watermark')
      menu?.querySelector<HTMLButtonElement>('[data-jword-watermark-clear="true"]')?.click()
      await Promise.resolve()

      expect(ui.getWatermark()).toBeNull()
      expect(canvas?.querySelector('[data-jword-watermark-layer="user"]')).toBeNull()
      expect(liveRegionHost.textContent).toContain('Page watermark cleared')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
    }
  })

  test('旧 visibleTools 常用模式仍只显示宿主声明的内建工具', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'legacy visible tools' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        toolbar: {
          visibleTools: ['format.bold']
        }
      })
      const commonPanel = toolbarHost.querySelector<HTMLElement>('[data-jword-toolbar-common-panel="true"]')

      expect(toolbarHost.getAttribute('data-jword-toolbar-mode')).toBe('common')
      expect(commonPanel?.querySelector('[data-jword-tool-id="format.bold"]')).not.toBeNull()
      expect(commonPanel?.querySelector('[data-jword-media-trigger="true"]')).toBeNull()
      expect(commonPanel?.querySelector('[data-jword-table-insert-trigger="true"]')).toBeNull()

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('空 overlay、assistive mirror 与非表格选区事务不强制读取完整 layout', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const liveRegionHost = document.createElement('div')
    const assistiveMirrorHost = document.createElement('div')
    const linkHost = document.createElement('div')
    const findReplaceHost = document.createElement('div')
    const editor = createEditor({ initialText: 'plain hotpath' })

    document.body.append(editorHost, toolbarHost, liveRegionHost, assistiveMirrorHost, linkHost, findReplaceHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost,
        assistiveMirrorHost,
        comments: true,
        link: {
          host: linkHost
        },
        findReplace: {
          host: findReplaceHost
        },
        table: {
          commands: {
            resolveActiveTableTarget: () => null
          }
        }
      })
      const getLayout = vi.spyOn(editor, 'getLayout')

      editor.executeCommand({
        name: 'noopHotpathProbe',
        operations: []
      })

      expect(getLayout).not.toHaveBeenCalled()

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
      assistiveMirrorHost.remove()
      linkHost.remove()
      findReplaceHost.remove()
    }
  })

  test('默认专业工具栏使用内建页面尺寸控件', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const liveRegionHost = document.createElement('div')
    const editor = createEditor({ initialText: 'plugin page preset' })

    document.body.append(editorHost, toolbarHost, liveRegionHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost
      })
      const trigger = toolbarHost.querySelector<HTMLButtonElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-trigger'
      )
      const a3 = toolbarHost.querySelector<HTMLButtonElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-option[data-jword-option-value="a3"]'
      )
      const a4 = toolbarHost.querySelector<HTMLButtonElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-option[data-jword-option-value="a4"]'
      )
      const custom = toolbarHost.querySelector<HTMLButtonElement>(
        '[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-option[data-jword-option-value="custom"]'
      )

      expect(toolbarHost.querySelector('[data-jword-plugin-menu-key="plugin:jword.ui:pagePreset"]')).toBeNull()
      expect(trigger).toBeInstanceOf(HTMLButtonElement)
      expect(a3).toBeInstanceOf(HTMLButtonElement)
      expect(a4?.getAttribute('data-jword-selected')).toBe('true')
      expect(custom?.querySelector('.jw-toolbar__select-option-label')?.textContent).toBe('自定义大小')

      trigger?.click()
      a3?.click()
      await Promise.resolve()

      expect(editor.getPageConfig().preset).toBe('a3')
      expect(a3?.getAttribute('data-jword-selected')).toBe('true')

      trigger?.click()
      custom?.click()

      const dialog = toolbarHost.querySelector<HTMLElement>('[data-jword-page-size-dialog="true"]')
      const width = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="width"] input')
      const height = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="height"] input')
      const marginTop = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="marginTop"] input')
      const marginRight = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="marginRight"] input')
      const marginBottom = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="marginBottom"] input')
      const marginLeft = dialog?.querySelector<HTMLInputElement>('[data-jword-page-size-field="marginLeft"] input')
      const apply = dialog?.querySelector<HTMLButtonElement>('[data-jword-page-size-apply="true"]')

      expect(dialog?.querySelector('[data-jword-page-size-title="true"]')?.textContent).toBe('自定义页面大小')
      if (
        width === null
        || width === undefined
        || height === null
        || height === undefined
        || marginTop === null
        || marginTop === undefined
        || marginRight === null
        || marginRight === undefined
        || marginBottom === null
        || marginBottom === undefined
        || marginLeft === null
        || marginLeft === undefined
      ) {
        throw new Error('自定义页面大小输入未创建')
      }
      width.value = '20'
      height.value = '30'
      marginTop.value = '1'
      marginRight.value = '2'
      marginBottom.value = '1'
      marginLeft.value = '2'
      apply?.click()
      await Promise.resolve()

      expect(editor.getPageConfig().preset).toBe('custom')
      expect(editor.getPageConfig().widthTwips).toBe(11339)
      expect(editor.getPageConfig().heightTwips).toBe(17008)
      expect(editor.getPageConfig().marginTwips.left).toBe(1134)
      expect(toolbarHost.querySelector('[data-jword-page-size-dialog="true"]')).toBeNull()
      expect(liveRegionHost.textContent).toContain('已应用自定义页面大小')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
    }
  })

  test('插件 toolbar 按钮会渲染并触发 core 插件命令', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({
      initialText: 'abc',
      plugins: [createInsertPlugin('demo.toolbar', {
        bang: '!',
        disabled: '?'
      })]
    })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        pluginExtensions: [{
          pluginName: 'demo.toolbar',
          toolbarItems: [
            {
              name: 'bang',
              kind: 'button',
              label: 'Bang',
              ariaLabel: '插入感叹号',
              commandName: 'demo.toolbar.bang',
              active: (context) => readFirstParagraphText(context.editor).endsWith('!')
            },
            {
              name: 'disabled',
              kind: 'button',
              label: 'Disabled',
              commandName: 'demo.toolbar.disabled',
              enabled: () => false
            }
          ]
        }]
      })
      const button = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-plugin-tool-key="plugin:demo.toolbar:bang"]')
      const disabled = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-plugin-tool-key="plugin:demo.toolbar:disabled"]')

      expect(button).toBeInstanceOf(HTMLButtonElement)
      expect(disabled).toBeInstanceOf(HTMLButtonElement)
      expect(button?.textContent).toBe('Bang')
      expect(button?.getAttribute('aria-label')).toBe('插入感叹号')
      expect(button?.getAttribute('aria-pressed')).toBe('false')
      expect(disabled?.disabled).toBe(true)
      expect(ui.elements.pluginControls['plugin:demo.toolbar:bang']).toBe(button)

      disabled?.click()
      expect(readFirstParagraphText(editor)).toBe('abc')

      button?.click()
      await Promise.resolve()

      expect(readFirstParagraphText(editor)).toBe('abc!')
      expect(button?.getAttribute('aria-pressed')).toBe('true')

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

  test('插件菜单会渲染动作并触发 core 插件命令', async () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({
      initialText: 'abc',
      plugins: [createInsertPlugin('demo.menu', {
        question: '?'
      })]
    })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)
      const ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        pluginExtensions: [{
          pluginName: 'demo.menu',
          menus: [{
            name: 'insert',
            label: '插件菜单',
            items: [{
              name: 'question',
              label: '插入问号',
              commandName: 'demo.menu.question'
            }]
          }]
        }]
      })
      const trigger = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-plugin-menu-key="plugin:demo.menu:insert"] .jw-toolbar__select-trigger')
      const wrapper = trigger?.closest<HTMLElement>('.jw-toolbar__select-wrap')
      const triggerRow = trigger?.querySelector<HTMLElement>(':scope > .jw-toolbar__select-trigger-row')
      const fieldLabel = trigger?.querySelector<HTMLElement>(':scope > .jw-toolbar__select-field-label')
      const action = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-plugin-menu-item-key="plugin:demo.menu:insert:question"]')
      const menu = action?.closest<HTMLElement>('.jw-toolbar__select-menu')

      expect(trigger).toBeInstanceOf(HTMLButtonElement)
      expect(wrapper?.getAttribute('data-jword-field-label')).toBe('插件菜单')
      expect(triggerRow?.querySelector('.jw-toolbar__select-arrow')).toBeInstanceOf(HTMLElement)
      expect(fieldLabel?.textContent).toBe('插件菜单')
      expect(fieldLabel?.parentElement).toBe(trigger)
      expect(action).toBeInstanceOf(HTMLButtonElement)
      expect(menu?.hidden).toBe(true)

      trigger?.click()
      expect(trigger?.getAttribute('aria-expanded')).toBe('true')
      expect(menu?.hidden).toBe(false)

      action?.click()
      await Promise.resolve()

      expect(readFirstParagraphText(editor)).toBe('abc?')
      expect(trigger?.getAttribute('aria-expanded')).toBe('false')
      expect(menu?.hidden).toBe(true)

      ui.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })

})

/** 创建测试用插入型插件。 */
function createInsertPlugin(pluginName: string, commands: Readonly<Record<string, string>>): PluginDefinition {
  return {
    name: pluginName,
    version: '1.0.0',
    setup(context) {
      for (const [commandName, text] of Object.entries(commands)) {
        context.registerCommand({
          name: `${pluginName}.${commandName}`,
          execute() {
            return createInsertAtEndCommand(context.editor, text)
          }
        })
      }
    }
  }
}

/** 创建把文本插入首段末尾的测试命令。 */
function createInsertAtEndCommand(editor: ReturnType<typeof createEditor>, text: string) {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    throw new Error('测试文档缺少首段')
  }

  const run = block.runs.at(-1)

  if (run === undefined) {
    throw new Error('测试文档缺少首个 run')
  }

  return {
    name: 'pluginInsertAtEnd',
    operations: [{
      kind: 'insertText' as const,
      at: {
        sectionId: 'section-1',
        blockId: block.id,
        runId: run.id,
        graphemeIndex: readRunPlainText(run).length
      },
      text
    }]
  }
}

/** 读取首段纯文本。 */
function readFirstParagraphText(editor: ReturnType<typeof createEditor>): string {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return ''
  }

  return block.runs.map(readRunPlainText).join('')
}

/** 读取 run 内所有文本 inline。 */
function readRunPlainText(run: { readonly inlines: readonly Readonly<{ readonly kind: string, readonly text?: string }>[] }): string {
  return run.inlines
    .filter((inline) => inline.kind === 'text')
    .map((inline) => inline.text ?? '')
    .join('')
}
