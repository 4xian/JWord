/**
 * @vitest-environment jsdom
 *
 * 职责：验证 React wrapper 在浏览器近似环境中的 mount、事件桥接和销毁行为。
 * 边界：只通过公开 React 组件、ref 和 core editor facade 断言，不读取 wrapper 私有状态。
 * 协作：React createRoot、@4xian/jword-react、core 插件错误事件和 UI 装配。
 * 约束：测试不依赖截图，不把 React state 当作文档真源。
 */

import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { act } from 'react'
import { describe, expect, it } from 'vitest'

import { JWordReactEditor, type JWordReactEditorHandle } from '../src/index'

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }

actEnvironment.IS_REACT_ACT_ENVIRONMENT = true

describe('JWordReactEditor', () => {
  it('mount 后暴露 editor ref 并桥接 error/diagnostics 事件', async () => {
    const container = document.createElement('div')
    const root = createRoot(container)
    const handle = React.createRef<JWordReactEditorHandle>()
    const readyEditors: unknown[] = []
    const errors: string[] = []
    const diagnostics: number[] = []

    document.body.append(container)

    await act(async () => {
      root.render(React.createElement(JWordReactEditor, {
        ref: handle,
        defaultValue: { text: 'React wrapper' },
        editorOptions: {
          plugins: [{
            name: 'react.throwingPlugin',
            version: '0.0.0-test',
            setup(context) {
              context.registerCommand({
                name: 'react.throwingPlugin.throw',
                execute() {
                  throw new Error('react plugin failed')
                }
              })
            }
          }]
        },
        onReady(editor) {
          readyEditors.push(editor)
        },
        onError(event) {
          errors.push(event.code)
        },
        onDiagnostics(snapshot) {
          diagnostics.push(snapshot.plugins.length)
        }
      }))
    })

    expect(readyEditors).toHaveLength(1)
    expect(handle.current?.editor).not.toBeNull()
    expect(handle.current?.exportDiagnostics()).not.toBeNull()

    handle.current?.editor?.executePluginCommand('react.throwingPlugin.throw')

    expect(errors).toContain('PLUGIN_CALLBACK_FAILED')
    expect(diagnostics.at(-1)).toBeGreaterThan(0)

    await act(async () => {
      root.unmount()
    })
    container.remove()
  })
})
