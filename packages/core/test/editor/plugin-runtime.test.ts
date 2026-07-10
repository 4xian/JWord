/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 7 Plugin API M2 的 core 插件宿主骨架。
 * 边界：只通过 createEditor、Editor facade、DOM keydown 与事件订阅观察插件行为，不测试插件宿主私有结构。
 * 协作模块：editor runtime、transaction pipeline、插件 API 类型和 facade 测试辅助函数。
 * 性能/安全约束：插件不能直接访问 Y.Doc 或 document-store，命令仍通过统一 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import type { EditorEvent, PluginAdapterRegistry, PluginDefinition, ResourceAdapter } from '../../src/index'
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

  it('adapter registry 按插件声明顺序解析并把重复注册记录为可恢复诊断', () => {
    const primaryResourceAdapter = createTestResourceAdapter('primary')
    const secondaryResourceAdapter = createTestResourceAdapter('secondary')
    let resolvedResourceName: string | undefined
    let resolvedImportName: string | undefined
    let importAdapterCount = 0
    const editor = createEditor({
      plugins: [
        {
          name: 'adapter.primary',
          version: '1.0.0',
          setup(context) {
            context.adapters.resources.register(primaryResourceAdapter, {
              name: 'primary-resource',
              featureKey: 'resource.upload'
            })
            context.adapters.imports.register({
              kind: 'import',
              name: 'docx-import',
              format: 'docx',
              featureKey: 'docx.import',
              diagnosticsSource: 'docx',
              importDocument() {
                return { ok: true }
              }
            })
          }
        },
        {
          name: 'adapter.secondary',
          version: '1.0.0',
          setup(context) {
            context.adapters.resources.register(secondaryResourceAdapter, {
              name: 'secondary-resource',
              featureKey: 'resource.upload'
            })
            context.adapters.imports.register({
              kind: 'import',
              name: 'docx-import-backup',
              format: 'docx',
              featureKey: 'docx.import',
              diagnosticsSource: 'docx',
              importDocument() {
                return { ok: true }
              }
            })

            const resourceResolution = context.adapters.resources.resolve()
            const importResolution = context.adapters.imports.resolveFormat('docx')

            resolvedResourceName = resourceResolution.status === 'available'
              ? resourceResolution.registration.name
              : undefined
            resolvedImportName = importResolution.status === 'available'
              ? importResolution.registration.name
              : undefined
            importAdapterCount = context.adapters.imports.list().length
          }
        }
      ]
    })

    expect(resolvedResourceName).toBe('primary-resource')
    expect(resolvedImportName).toBe('docx-import')
    expect(importAdapterCount).toBe(2)
    expect(editor.getPluginDiagnostics()).toContainEqual(expect.objectContaining({
      pluginName: 'adapter.secondary',
      code: 'PLUGIN_ADAPTER_DUPLICATE',
      lifecycle: 'adapter',
      recoverable: true
    }))

    editor.destroy()
  })

  it('resource adapter 解析优先使用 EditorOptions.resourceAdapter', () => {
    let resolvedPluginName: string | undefined
    let resolvedResourceName: string | undefined
    const editor = createEditor({
      resourceAdapter: createTestResourceAdapter('host'),
      plugins: [{
        name: 'adapter.resource-plugin',
        version: '1.0.0',
        setup(context) {
          context.adapters.resources.register(createTestResourceAdapter('plugin'), {
            name: 'plugin-resource',
            featureKey: 'resource.upload'
          })

          const resolution = context.adapters.resources.resolve()

          if (resolution.status === 'available') {
            resolvedPluginName = resolution.registration.pluginName
            resolvedResourceName = resolution.registration.name
          }
        }
      }]
    })

    expect(resolvedPluginName).toBe('editor.options')
    expect(resolvedResourceName).toBe('editor.resourceAdapter')

    editor.destroy()
  })

  it('adapter 回调异常被隔离为诊断且不污染文档或 history', async () => {
    const events: EditorEvent[] = []
    let adapters: PluginAdapterRegistry | undefined
    const editor = createEditor({
      initialText: 'abc',
      plugins: [{
        name: 'throwing.adapters',
        version: '1.0.0',
        setup(context) {
          adapters = context.adapters
          context.adapters.resources.register({
            async upload() {
              throw new Error('resource boom')
            }
          }, { name: 'broken-resource' })
          context.adapters.persistence.register({
            kind: 'persistence',
            name: 'broken-persistence',
            execute() {
              throw new Error('persistence boom')
            }
          }, { name: 'broken-persistence' })
          context.adapters.imports.register({
            kind: 'import',
            name: 'broken-import',
            format: 'docx',
            importDocument() {
              throw createCodedError('DOCX_LICENSE_DENIED', 'license denied')
            }
          }, { name: 'broken-import' })
          context.adapters.exports.register({
            kind: 'export',
            name: 'broken-export',
            format: 'pdf',
            async exportDocument() {
              throw new Error('export boom')
            }
          }, { name: 'broken-export' })
          context.adapters.collabProviders.register({
            kind: 'collabProvider',
            name: 'broken-collab',
            createProvider() {
              throw createCodedError('COLLAB_PROVIDER_AUTH_FAILED', 'auth denied')
            }
          }, { name: 'broken-collab' })
        }
      }]
    })

    editor.subscribe((event) => {
      events.push(event)
    })

    if (adapters === undefined) {
      throw new Error('adapter registry 未初始化')
    }

    const resource = adapters.resources.resolve({ name: 'broken-resource' })
    const persistence = adapters.persistence.resolve({ name: 'broken-persistence' })
    const imported = adapters.imports.resolveFormat('docx')
    const exported = adapters.exports.resolveFormat('pdf')
    const collab = adapters.collabProviders.resolve({ name: 'broken-collab' })

    if (
      resource.status !== 'available' ||
      persistence.status !== 'available' ||
      imported.status !== 'available' ||
      exported.status !== 'available' ||
      collab.status !== 'available'
    ) {
      throw new Error('adapter fixture 注册失败')
    }

    await expect(resource.registration.adapter.upload({
      resourceId: 'resource-1',
      source: {
        kind: 'file',
        file: {
          name: 'resource.txt',
          type: 'text/plain',
          size: 3,
          async arrayBuffer() {
            return new ArrayBuffer(3)
          }
        }
      }
    })).resolves.toMatchObject({
      resource: {
        id: 'resource-1',
        status: 'failed',
        error: {
          code: 'PLUGIN_ADAPTER_FAILED'
        }
      }
    })
    expect(() => persistence.registration.adapter.execute(undefined)).not.toThrow()
    expect(persistence.registration.adapter.execute(undefined)).toBeUndefined()
    expect(() => imported.registration.adapter.importDocument(new Uint8Array())).not.toThrow()
    expect(imported.registration.adapter.importDocument(new Uint8Array())).toBeUndefined()
    await expect(Promise.resolve(exported.registration.adapter.exportDocument(editor.getProjection()))).resolves.toBeUndefined()
    expect(() => collab.registration.adapter.createProvider(undefined)).not.toThrow()
    expect(collab.registration.adapter.createProvider(undefined)).toBeUndefined()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc']])
    expect(editor.canUndo()).toBe(false)

    editor.executeCommand(createInsertCommand('!', 3))

    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc!']])
    expect(editor.canUndo()).toBe(true)
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_ADAPTER_FAILED',
      commandName: 'broken-resource',
      recoverable: true
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_IMPORT_REJECTED',
      commandName: 'broken-import',
      recoverable: true
    }))
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_COLLAB_PROVIDER_REJECTED',
      commandName: 'broken-collab',
      recoverable: true
    }))

    editor.destroy()
  })

  it('setup、command、middleware、keybinding 与 dispose 异常均转为可恢复诊断', () => {
    const events: EditorEvent[] = []
    const editor = createEditor({
      initialText: 'abc',
      plugins: [
        {
          name: 'throwing.setup',
          version: '1.0.0',
          setup() {
            throw new Error('setup boom')
          }
        },
        {
          name: 'throwing.command',
          version: '1.0.0',
          setup(context) {
            context.registerCommand({
              name: 'throwing.command.run',
              execute() {
                throw new Error('command boom')
              }
            })
          }
        },
        {
          name: 'throwing.middleware',
          version: '1.0.0',
          setup(context) {
            context.interceptCommand(() => {
              throw new Error('middleware boom')
            })
          }
        },
        {
          name: 'throwing.keybinding',
          version: '1.0.0',
          setup(context) {
            context.registerCommand({
              name: 'throwing.keybinding.noop',
              execute() {
                return undefined
              }
            })
            context.registerKeyBinding({
              key: 'Mod-L',
              command: 'throwing.keybinding.noop',
              when() {
                throw new Error('keybinding boom')
              }
            })
          }
        },
        {
          name: 'throwing.dispose',
          version: '1.0.0',
          setup() {
            return {
              dispose() {
                throw new Error('dispose boom')
              }
            }
          }
        }
      ]
    })
    const host = document.createElement('div')

    editor.subscribe((event) => {
      events.push(event)
    })

    expect(() => {
      editor.executePluginCommand('throwing.command.run')
    }).not.toThrow()

    const middlewareResult = editor.executeCommand(createInsertCommand('!', 3))

    editor.mount(host)

    const textarea = host.querySelector('textarea')
    const keyEvent = new KeyboardEvent('keydown', {
      key: 'l',
      metaKey: true,
      bubbles: true,
      cancelable: true
    })

    expect(textarea).toBeInstanceOf(HTMLTextAreaElement)
    textarea?.dispatchEvent(keyEvent)

    expect(middlewareResult.dirty).toBe(false)
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['abc']])
    expect(editor.canUndo()).toBe(false)
    expect(editor.getPluginDiagnostics()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        pluginName: 'throwing.setup',
        code: 'PLUGIN_CALLBACK_FAILED',
        lifecycle: 'setup'
      }),
      expect.objectContaining({
        pluginName: 'throwing.command',
        code: 'PLUGIN_CALLBACK_FAILED',
        commandName: 'throwing.command.run'
      }),
      expect.objectContaining({
        pluginName: 'throwing.middleware',
        code: 'PLUGIN_COMMAND_REJECTED',
        reasonCode: 'PLUGIN_MIDDLEWARE_FAILED'
      }),
      expect.objectContaining({
        pluginName: 'throwing.keybinding',
        code: 'PLUGIN_CALLBACK_FAILED',
        lifecycle: 'keybinding'
      })
    ]))

    editor.destroy()

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'error',
      code: 'PLUGIN_CALLBACK_FAILED',
      commandName: 'dispose',
      recoverable: true
    }))
  })
})

/** 创建测试用资源上传 adapter。 */
function createTestResourceAdapter(label: string): ResourceAdapter {
  return {
    async upload(request) {
      return {
        resource: {
          kind: 'resource',
          id: request.resourceId,
          mime: 'text/plain',
          source: {
            kind: 'externalUrl',
            url: `https://example.test/${label}/${request.resourceId}.txt`
          },
          status: 'success'
        }
      }
    }
  }
}

/** 创建带稳定 code 字段的测试错误。 */
function createCodedError(code: string, message: string): Error & { readonly code: string } {
  const error = new Error(message) as Error & { code: string }

  error.code = code

  return error
}
