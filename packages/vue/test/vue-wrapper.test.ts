/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Vue wrapper 在浏览器近似环境中的 mount、事件桥接、provide/inject 和销毁行为。
 * 边界：只通过公开 Vue 组件、expose handle 和 core editor facade 断言，不读取 wrapper 私有状态。
 * 协作：Vue Test Utils、@4xian/jword-vue、core 插件错误事件和 UI 装配。
 * 约束：测试不依赖截图，不把 Vue ref 当作文档真源。
 */

import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import {
  JWordVueEditor,
  useJWordEditor,
  useJWordEditorHandle,
  type JWordVueEditorHandle
} from '../src/index'

const ProbeComponent = defineComponent({
  name: 'JWordVueProbe',
  setup() {
    const handle = useJWordEditorHandle()
    const editor = useJWordEditor()

    return () => h('output', {
      'data-jword-vue-probe': handle.value === null ? 'empty' : 'ready',
      'data-jword-vue-probe-editor': editor.value === null ? 'empty' : 'ready'
    })
  }
})

describe('JWordVueEditor', () => {
  it('mount 后暴露 editor handle、provide/inject 并桥接 error/diagnostics 事件', async () => {
    const wrapper = mount(JWordVueEditor, {
      attachTo: document.body,
      props: {
        defaultValue: { text: 'Vue wrapper' },
        editorOptions: {
          plugins: [{
            name: 'vue.throwingPlugin',
            version: '0.0.0-test',
            setup(context) {
              context.registerCommand({
                name: 'vue.throwingPlugin.throw',
                execute() {
                  throw new Error('vue plugin failed')
                }
              })
            }
          }]
        }
      },
      slots: {
        default: () => h(ProbeComponent)
      }
    })
    const handle = wrapper.vm as unknown as JWordVueEditorHandle

    await nextTick()

    expect(handle.editor).not.toBeNull()
    expect(handle.exportDiagnostics()).not.toBeNull()
    expect(wrapper.findAll('[data-jword-vue-host]')).toHaveLength(1)
    expect(wrapper.findAll('[data-jword-shell-region]')).toHaveLength(3)
    expect(wrapper.find('[data-jword-vue-toolbar]').exists()).toBe(false)
    expect(wrapper.find('[data-jword-vue-editor]').exists()).toBe(false)
    expect(wrapper.find('[data-jword-vue-probe]').attributes('data-jword-vue-probe')).toBe('ready')
    expect(wrapper.find('[data-jword-vue-probe]').attributes('data-jword-vue-probe-editor')).toBe('ready')

    handle.editor?.executePluginCommand('vue.throwingPlugin.throw')
    await nextTick()

    expect(wrapper.emitted('error')?.[0]?.[0]).toMatchObject({
      code: 'PLUGIN_CALLBACK_FAILED',
      recoverable: true
    })
    expect(wrapper.emitted('diagnostics-export')?.[0]?.[0]).toMatchObject({
      plugins: expect.any(Array)
    })

    wrapper.unmount()
    expect(handle.editor).toBeNull()
  })
})
