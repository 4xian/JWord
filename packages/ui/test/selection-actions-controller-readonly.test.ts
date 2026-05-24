/**
 * @vitest-environment jsdom
 *
 * 职责：验证 selection-actions 在全局只读模式下会隐藏编辑入口。
 * 边界：只覆盖浮动工具栏与右键菜单的展示状态，不验证具体编辑命令。
 * 协作模块：packages/ui/src/selection-actions/controller.ts 与 create-ui 传入的只读配置。
 * 约束：使用稳定 data attribute 断言，不依赖截图。
 */

import { createEditor, createSelectionState } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createSelectionActionsController } from '../src/selection-actions/controller'

describe('selection actions controller readonly', () => {
  test('readonly 会隐藏浮动工具栏与右键菜单编辑入口', () => {
    const editorHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(editorHost)

    try {
      editor.mount(editorHost)
      editor.setSelection(createSelection(editor, 1, 4))

      const controller = createSelectionActionsController({
        editor,
        editorHost,
        readonly: {
          enabled: true
        },
        colorFormat: {
          applyColorFromSelection(): void {}
        },
        insertActions: {
          openComment(): void {},
          openLink(): void {}
        },
        assistive: {
          liveRegion: createStubLiveRegion()
        }
      })

      const floatingToolbar = editorHost.querySelector<HTMLElement>('[data-jword-floating-toolbar="true"]')
      const contextMenu = editorHost.querySelector<HTMLElement>('[data-jword-context-menu="true"]')

      expect(floatingToolbar?.hidden).toBe(true)
      expect(contextMenu?.hidden).toBe(true)
      expect(controller.elements.floatingToolbar.hidden).toBe(true)
      expect(controller.elements.contextMenu.hidden).toBe(true)

      controller.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
    }
  })
})

function createSelection(editor: ReturnType<typeof createEditor>, anchorIndex: number, focusIndex: number) {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[0]
  const runId = paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.id : undefined
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph?.id ?? 'paragraph-1',
    runId: runId ?? 'run-1',
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: paragraph?.id ?? 'paragraph-1',
    runId: runId ?? 'run-1',
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

function createStubLiveRegion() {
  return {
    announce(): void {},
    destroy(): void {}
  }
}
