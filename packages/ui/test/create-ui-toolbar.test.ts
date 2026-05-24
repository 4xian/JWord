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
