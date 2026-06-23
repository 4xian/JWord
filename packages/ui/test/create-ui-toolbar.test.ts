/**
 * @vitest-environment jsdom
 *
 * 职责：验证 createJWordUi 的 toolbar 顶层显示开关。
 * 边界：只覆盖 UI 装配入口是否隐藏整条 toolbar，不验证各业务面板行为。
 * 协作：packages/ui/src/create-ui.ts、toolbar/controller.ts 与公开 CreateJWordUiOptions。
 * 约束：通过公开 DOM 和 elements 断言，避免读取 controller 私有状态。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

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
      const mediaTrigger = toolbarHost?.querySelector<HTMLButtonElement>('[data-jword-media-trigger="true"]') ?? null
      const tableTrigger = toolbarHost?.querySelector<HTMLButtonElement>('[data-jword-table-insert-trigger="true"]') ?? null

      expect(toolbarHost).not.toBeNull()
      expect(toolbarHost?.nextElementSibling).toBe(editorShell)
      expect(toolbarHost?.querySelector('[data-jword-tool-id="document.findReplace"]')).not.toBeNull()
      expect(mediaTrigger).not.toBeNull()
      expect(mediaTrigger?.disabled).toBe(true)
      expect(tableTrigger).not.toBeNull()
      expect(tableTrigger?.disabled).toBe(false)
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
})
