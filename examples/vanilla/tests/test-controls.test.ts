/**
 * @vitest-environment jsdom
 *
 * 职责：验证 vanilla demo 控件只通过公开 Editor facade 和已挂载 DOM 状态同步按钮。
 * 边界：只覆盖 demo-only 控件状态，不测试官方 UI toolbar 或分页渲染细节。
 * 协作模块：examples/vanilla/tests/fixtures/test-controls.ts 与 @4xian/jword-core Editor facade。
 * 约束：测试文件放在 tests 目录，避免污染 src；断言 input 热路径不强制刷新完整 layout。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, test, vi } from 'vitest'

import { createDemoControls } from './fixtures/test-controls'

describe('vanilla demo controls', () => {
  test('事务状态刷新从已挂载页数属性读取，不强制 getLayout', () => {
    const editorHost = document.createElement('div')
    const controlsHost = createControlsHost()
    const statusHost = document.createElement('div')
    const editor = createEditor({ initialText: 'demo controls hotpath' })

    document.body.append(editorHost, controlsHost, statusHost)

    try {
      editor.mount(editorHost)
      const handle = createDemoControls({
        editor,
        host: controlsHost,
        statusHost
      })
      const getLayout = vi.spyOn(editor, 'getLayout')

      editor.executeCommand({
        name: 'noopHotpathProbe',
        operations: []
      })

      expect(getLayout).not.toHaveBeenCalled()
      handle.destroy()
    } finally {
      editor.destroy()
      editorHost.remove()
      controlsHost.remove()
      statusHost.remove()
    }
  })
})

/** 创建 demo 控件需要的最小按钮宿主。 */
function createControlsHost(): HTMLElement {
  const host = document.createElement('div')

  host.append(
    createButton('data-jword-load-alpha'),
    createButton('data-jword-restore-gate2'),
    createButton('data-jword-select-sample'),
    createButton('data-jword-clear-selection'),
    createButton('data-jword-open-readonly-example')
  )

  return host
}

/** 创建带指定 data 属性的按钮。 */
function createButton(attribute: string): HTMLButtonElement {
  const button = document.createElement('button')

  button.type = 'button'
  button.setAttribute(attribute, 'true')

  return button
}
