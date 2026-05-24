/**
 * @vitest-environment jsdom
 *
 * 职责：验证 toolbar controller 在全局只读模式下会禁用编辑入口。
 * 边界：只覆盖 toolbar DOM 状态，不验证 selection-actions 或其它面板。
 * 协作模块：packages/ui/src/toolbar/controller.ts 与 create-ui 传入的只读配置。
 * 约束：使用公开 DOM selector 和 disabled/hidden 状态断言。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createToolbarController } from '../src/toolbar/controller'
import type { LiveRegionController } from '../src/assistive/live-region'

describe('toolbar controller readonly', () => {
  test('readonly 会禁用编辑类 toolbar 入口并保留查找入口', () => {
    const editorHost = document.createElement('div')
    const toolbarHost = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    document.body.append(editorHost, toolbarHost)

    try {
      editor.mount(editorHost)

      const controller = createToolbarController({
        editor,
        editorHost,
        toolbarHost,
        readonly: {
          enabled: true
        },
        assistive: {
          liveRegion: createStubLiveRegion(),
          textMirror: null
        }
      })

      const bold = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="format.bold"]')
      const insertLink = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="insert.link"]')
      const findReplace = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="document.findReplace"]')
      const headingOutline = toolbarHost.querySelector<HTMLButtonElement>('[data-jword-tool-id="document.headingOutline"]')

      expect(bold?.disabled).toBe(true)
      expect(insertLink?.disabled).toBe(true)
      expect(findReplace?.disabled).toBe(false)
      expect(headingOutline?.disabled).toBe(true)

      controller.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
    }
  })
})

function createStubLiveRegion(): LiveRegionController {
  return {
    host: null,
    announce(): void {},
    readMessage(): string {
      return ''
    },
    destroy(): void {}
  }
}
