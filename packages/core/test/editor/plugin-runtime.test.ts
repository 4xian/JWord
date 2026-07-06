/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 7 Plugin API M2 的 core 插件宿主骨架。
 * 边界：只通过 createEditor、Editor facade、DOM keydown 与事件订阅观察插件行为，不测试插件宿主私有结构。
 * 协作模块：editor runtime、transaction pipeline、插件 API 类型和 facade 测试辅助函数。
 * 性能/安全约束：插件不能直接访问 Y.Doc 或 document-store，命令仍通过统一 transaction pipeline。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-plugin-api-m1-design.md#8-m2-m6-交付切分。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import type { EditorEvent, PluginDefinition } from '../../src/index'
import type { TransactionResult } from '../../src/operations/transaction'
import { readParagraphRunTexts } from './facade-test-helpers'

function createInsertCommand(text: string, graphemeIndex: number) {
  return {
    name: 'insertText',
    operations: [{
      kind: 'insertText' as const,
      at: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex
      },
      text
    }]
  }
}

describe('Plugin API M2 core host', () => {
  it('按插件顺序 setup 并在 destroy 时先发生命周期再反序 dispose', () => {
    const events: string[] = []
    const plugins: readonly PluginDefinition[] = [
      {
        name: 'first.lifecycle',
        version: '1.0.0',
        setup(context) {
          events.push(`setup:${context.name}`)
          context.on('destroy', () => {
            events.push('destroy:first')
          })

          return {
            dispose() {
              events.push('dispose:first')
            }
          }
        }
      },
      {
        name: 'second.lifecycle',
        version: '1.0.0',
        setup(context) {
          events.push(`setup:${context.name}`)
          context.on('destroy', () => {
            events.push('destroy:second')
          })

          return {
            dispose() {
              events.push('dispose:second')
            }
          }
        }
      }
    ]
    const editor = createEditor({ plugins })

    expect(events).toEqual(['setup:first.lifecycle', 'setup:second.lifecycle'])

    editor.destroy()

    expect(events).toEqual([
      'setup:first.lifecycle',
      'setup:second.lifecycle',
      'destroy:first',
      'destroy:second',
      'dispose:second',
      'dispose:first'
    ])
  })

  it('命令中间件可拒绝事务且不写 history 或文档', () => {
    const events: EditorEvent[] = []
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'guard.commands',
        version: '1.0.0',
        setup(context) {
          context.interceptCommand((input, next) => {
            if (input.command.name === 'insertText') {
              return input.reject('READONLY_GUARD', '插件拒绝写入')
            }

            return next(input)
          })
        }
      }]
    })
    editor.subscribe((event) => {
      events.push(event)
    })

    const result = editor.executeCommand(createInsertCommand('!', 3))

    expect(result.dirty).toBe(false)
    expect(result.diagnostic.commandName).toBe('insertText')
    expect(result.diagnostic.operationKinds).toEqual([])
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc']])
    expect(events.some((event) => event.kind === 'transaction')).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_COMMAND_REJECTED',
      commandName: 'insertText',
      recoverable: true
    }))

    editor.destroy()
  })

  it('afterTransaction 插件异常被隔离为 error 事件且不回滚已完成事务', () => {
    const events: EditorEvent[] = []
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'throwing.after-transaction',
        version: '1.0.0',
        setup(context) {
          context.on('afterTransaction', () => {
            throw new Error('after transaction boom')
          })
        }
      }]
    })
    editor.subscribe((event) => {
      events.push(event)
    })

    expect(() => {
      editor.executeCommand(createInsertCommand('!', 3))
    }).not.toThrow()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc!']])
    expect(events.some((event) => event.kind === 'transaction')).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_CALLBACK_FAILED',
      commandName: 'afterTransaction',
      recoverable: true
    }))

    editor.destroy()
  })

  it('插件快捷键在内建快捷键未处理时触发插件命令', () => {
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'shortcut.commands',
        version: '1.0.0',
        setup(context) {
          context.registerCommand({
            name: 'shortcut.insertBang',
            execute() {
              return createInsertCommand('!', 3)
            }
          })
          context.registerKeyBinding({
            key: 'Mod-K',
            command: 'shortcut.insertBang'
          })
        }
      }]
    })
    const host = document.createElement('div')

    editor.mount(host)

    const textarea = host.querySelector('textarea')
    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })

    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    textarea?.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc!']])

    editor.destroy()
  })

  it('公开 facade 可直接执行已注册插件命令', () => {
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'public.commands',
        version: '1.0.0',
        setup(context) {
          context.registerCommand({
            name: 'public.insertBang',
            execute() {
              return createInsertCommand('!', 3)
            }
          })
        }
      }]
    })

    const result = editor.executePluginCommand('public.insertBang')

    expect((result as TransactionResult | undefined)?.dirty).toBe(true)
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc!']])

    editor.destroy()
  })

  it('内置 UI 插件命令可通过插件宿主切换页面尺寸', () => {
    const editor = createEditor()

    const result = editor.executePluginCommand('jword.ui.setPagePreset', {
      preset: 'a3'
    })

    expect(result).toBeUndefined()
    expect(editor.getPageConfig().preset).toBe('a3')
    expect(editor.getPluginDiagnostics()).toEqual([])

    editor.destroy()
  })

  it('experimental decoration provider 只能读取只读快照并参与挂载渲染', () => {
    let readCount = 0
    let receivedFrozenPages = false
    let receivedReason: string | undefined
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'review.decorations',
        version: '1.0.0',
        setup(context) {
          context.registerDecorationProvider({
            name: 'highlights',
            read(input) {
              readCount += 1
              receivedFrozenPages = Object.isFrozen(input.layout.pages)
              receivedReason = input.reason
              expect('editor' in input).toBe(false)

              return [{
                kind: 'textHighlight',
                id: 'abc-range',
                range: {
                  anchor: {
                    sectionId: 'section-1',
                    blockId: 'paragraph-1',
                    runId: 'run-1',
                    graphemeIndex: 0
                  },
                  focus: {
                    sectionId: 'section-1',
                    blockId: 'paragraph-1',
                    runId: 'run-1',
                    graphemeIndex: 2
                  }
                },
                color: '#fde68a'
              }]
            }
          })
        }
      }]
    })
    const host = document.createElement('div')

    editor.mount(host)

    expect(readCount).toBeGreaterThan(0)
    expect(receivedFrozenPages).toBe(true)
    expect(receivedReason).toBe('mount')
    expect(editor.getPluginDiagnostics()).toEqual([])

    editor.destroy()
  })

  it('experimental decoration provider 异常被隔离且不阻断挂载渲染', () => {
    const events: EditorEvent[] = []
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'throwing.decorations',
        version: '1.0.0',
        setup(context) {
          context.registerDecorationProvider({
            name: 'broken-highlights',
            read() {
              throw new Error('decoration boom')
            }
          })
        }
      }]
    })
    const host = document.createElement('div')

    editor.subscribe((event) => {
      events.push(event)
    })

    expect(() => {
      editor.mount(host)
    }).not.toThrow()

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_CALLBACK_FAILED',
      commandName: 'broken-highlights',
      recoverable: true
    }))
    expect(editor.getPluginDiagnostics()).toContainEqual(expect.objectContaining({
      pluginName: 'throwing.decorations',
      lifecycle: 'decoration',
      commandName: 'broken-highlights'
    }))

    editor.destroy()
  })
})
