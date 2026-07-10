/**
 * @vitest-environment node
 *
 * 职责：验证编辑器门面的文档创建、只读投影、选择、页面配置和定位查询。
 * 边界：只覆盖公开门面方法，不测试 DOM 挂载生命周期、输入事件或渲染器。
 * 协作模块：编辑器运行时、选择模型、事务管线和布局查询。
 * 性能/安全约束：测试只把本地夹具文本传入核心层，核心层不自行读取磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'

describe('Editor facade document APIs', () => {
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
      fileURLToPath(new URL('../../../../fixtures/plain-text/minimal.txt', import.meta.url)),
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
        operations: [{ kind: 'insertText', at: editor.resolveTextPosition(anchor), text: 'J' }]
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


  it('sets and reads the current runtime selection', () => {
    const editor = createEditor({ initialText: 'abc' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const focus = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(anchor, focus)

    expect(editor.getSelection()).toBeNull()

    editor.setSelection(selection)

    expect(editor.getSelection()).toBe(selection)

    editor.setSelection(null)

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })


  it('clears the current runtime selection after createDocument replaces the document', () => {
    const editor = createEditor({ initialText: 'abc' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const selection = createSelectionState(anchor, anchor)

    editor.setSelection(selection)
    editor.createDocument({ text: '新的文档' })

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })


  it('clears the current runtime selection after loadFixture replaces the document', () => {
    const editor = createEditor({ initialText: 'abc' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const selection = createSelectionState(anchor, anchor)

    editor.setSelection(selection)
    editor.loadFixture({ name: 'replacement', text: 'fixture 文档' })

    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })


  it('reports grapheme length when creating an out-of-bounds text anchor', () => {
    const editor = createEditor({ initialText: 'a😊e\u0301中' })

    expect(() =>
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: -1
      })
    ).toThrowError(expect.objectContaining({
      code: 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS',
      details: {
        index: -1,
        length: 4
      }
    }))

    editor.destroy()
  })


  it('applies initial page preset and relayouts after runtime page size switches', () => {
    const editor = createEditor({
      initialText: Array.from(
        { length: 80 },
        (_, index) => `第 ${index + 1} 段用于验证纸张尺寸切换后自动重新换行与换页的示例文本 English wrap token ${index + 1}`
      ).join('\n\n'),
      page: {
        preset: 'a5'
      }
    })

    const narrowConfig = editor.getPageConfig()
    const narrowLayout = editor.getLayout()

    editor.setPageConfig({
      preset: 'a3'
    })

    const wideConfig = editor.getPageConfig()
    const wideLayout = editor.getLayout()

    expect(narrowConfig.preset).toBe('a5')
    expect(wideConfig.preset).toBe('a3')
    expect(wideConfig.widthTwips).toBeGreaterThan(narrowConfig.widthTwips)
    expect(wideConfig.heightTwips).toBeGreaterThan(narrowConfig.heightTwips)
    expect(wideLayout.pages.length).toBeLessThan(narrowLayout.pages.length)
    expect(wideLayout.pages[0]?.contentRect.width).toBeGreaterThan(narrowLayout.pages[0]?.contentRect.width ?? 0)

    editor.destroy()
  })


  it('bridges Gate 2 hit-test and rect mapping through AnchorRef and RangeRef', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const layout = editor.getLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment).toBeDefined()

    const anchor = editor.hitTest({
      pageIndex: 0,
      x: (fragment?.x ?? 0) + (fragment?.advanceTwips[1] ?? 0) + 1,
      y: (fragment?.y ?? 0) + 1
    })

    expect(anchor).toBeDefined()

    const focus = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    })
    const caret = editor.getCaretRect(anchor!)
    const selection = createSelectionState(anchor!, focus)
    const rects = editor.getSelectionRects(selection.range)

    expect(caret?.width).toBe(0)
    expect(rects.length).toBeGreaterThan(0)

    editor.destroy()
  })


  it('keeps hitTest -> AnchorRef -> caret rect stable inside a natural text fragment', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const layout = editor.getLayout()
    const fragment = layout.pages[0]?.lines[0]?.fragments[0]

    expect(fragment).toBeDefined()

    const boundaryOffset = fragment?.advanceTwips[2] ?? 0
    const anchor = editor.hitTest({
      pageIndex: 0,
      x: (fragment?.x ?? 0) + boundaryOffset + 1,
      y: (fragment?.y ?? 0) + 1
    })
    const caret = anchor === undefined ? undefined : editor.getCaretRect(anchor)
    const position = anchor === undefined ? undefined : editor.resolveTextPosition(anchor)

    expect(position).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    expect(caret).toMatchObject({
      pageIndex: fragment?.pageIndex,
      x: (fragment?.x ?? 0) + boundaryOffset,
      y: fragment?.y
    })

    editor.destroy()
  })

})
