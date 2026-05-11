/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 第一版 Editor facade 能创建文档、加载 fixture、执行 command 并发出事件。
 * 边界：只覆盖 facade 公开方法，不测试 DOM mount 生命周期、布局、渲染或输入。
 * 协作模块：文档状态、事务管线、只读投影、历史和位置提供底层能力。
 * 性能/安全约束：测试只读取本地 fixture 文件后把文本传入 core，不允许 core 自己读磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createEditor } from '../src/editor'

describe('Editor facade', () => {
  it('creates documents, loads fixture text, executes commands, and emits transaction events', async () => {
    const editor = createEditor()
    const events: string[] = []

    const unsubscribe = editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        events.push(event.transaction.commandName)
      }
    })

    const projection = editor.createDocument({ text: '标题\n\n正文' })

    expect(projection.document.sections).toHaveLength(1)
    expect(projection.document.sections[0]?.blocks).toHaveLength(2)

    const fixtureText = await readFile(
      fileURLToPath(new URL('../../../fixtures/plain-text/minimal.txt', import.meta.url)),
      'utf8'
    )
    const loadedProjection = editor.loadFixture({
      name: 'minimal',
      text: fixtureText
    })

    expect(loadedProjection.document.sections).toHaveLength(1)
    expect(loadedProjection.document.sections[0]?.blocks).toHaveLength(2)

    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    })

    const result = editor.executeCommand(
      {
        name: 'insertText',
        operations: [{ kind: 'insertText', at: anchor, text: 'J' }]
      },
      { origin: 'local-user', label: '输入首字母' }
    )

    expect(result.origin).toBe('local-user')
    expect(result.operationKinds).toEqual(['insertText'])
    expect(result.projection.document.sections[0]?.blocks[0]?.kind).toBe('paragraph')
    expect(events).toEqual(['createDocument', 'loadFixture', 'insertText'])

    unsubscribe()
    editor.destroy()

    expect(() => editor.getProjection()).toThrow(/destroyed/i)
  })

  it('returns a read-only projection snapshot', () => {
    const editor = createEditor({ initialText: '只读' })
    const projection = editor.getProjection()

    expect(() => {
      ;(projection.document.sections as unknown as string[]).push('x')
    }).toThrow()

    editor.destroy()
  })

  it('rejects blank origin before executing a command', () => {
    const editor = createEditor()

    expect(() =>
      editor.executeCommand(
        {
          name: 'insertText',
          operations: []
        },
        { origin: '   ' }
      )
    ).toThrow('事务 origin 不能为空')

    editor.destroy()
  })
})
