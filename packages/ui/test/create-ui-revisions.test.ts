/**
 * @vitest-environment jsdom
 *
 * 职责：验证 createJWordUi 对修订 metadata 面板的入口级装配。
 * 边界：覆盖 revision 列表显示、点击定位 range、接受/拒绝按钮和销毁。
 * 协作模块：packages/ui/src/create-ui.ts、revisions controller 与 @4xian/jword-core。
 * 约束：通过公开 elements 和稳定 data selector 断言，不读取 controller 私有状态。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */

import {
  buildAddRevisionMetadataCommand,
  createEditor,
  createSelectionState,
  type DocumentProjection,
  type Editor
} from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('createJWordUi revisions integration', () => {
  test('启用 revisions option 后会显示 revision metadata 并点击定位 range', () => {
    const harness = createHarness()

    try {
      expect(harness.ui.elements.revisionsPanel).not.toBeNull()
      expect(harness.toolbarHost.querySelector('[data-jword-revisions-panel]')).not.toBeNull()
      expect(harness.ui.elements.revisionsPanel!.root.textContent).toContain('修订记录')

      const revisionSelection = createSelection(harness.editor, 1, 4)
      const command = buildAddRevisionMetadataCommand(
        harness.editor.getProjection(),
        revisionSelection,
        {
          authorId: 'author-r',
          createdAt: '2026-05-24T04:40:00.000Z',
          type: 'format',
          summary: '设置加粗'
        }
      )

      expect(command).not.toBeNull()
      harness.editor.executeCommand(command!)
      harness.editor.setSelection(createSelection(harness.editor, 0, 0))
      harness.ui.refresh()

      const item = harness.toolbarHost.querySelector<HTMLButtonElement>('[data-jword-revision-item]')

      expect(item).not.toBeNull()
      expect(item?.textContent).toContain('格式')
      expect(item?.textContent).toContain('设置加粗')
      expect(item?.textContent).toContain('author-r')

      item?.click()

      expect(readSelectionParagraphOffsets(harness.editor)).toEqual([1, 4])

      harness.ui.destroy()

      expect(harness.toolbarHost.querySelector('[data-jword-revisions-panel]')).toBeNull()
    } finally {
      harness.destroy()
    }
  })

  test('修订面板接受和拒绝按钮会通过 core command 单事务处理当前修订', () => {
    for (const action of ['accept', 'reject'] as const) {
      const harness = createHarness()

      try {
        const revisionSelection = createSelection(harness.editor, 1, 4)
        const command = buildAddRevisionMetadataCommand(
          harness.editor.getProjection(),
          revisionSelection,
          {
            authorId: 'author-r',
            createdAt: '2026-05-24T04:41:00.000Z',
            type: 'insert',
            summary: '插入文本'
          }
        )

        expect(command).not.toBeNull()
        harness.editor.executeCommand(command!, { selectionAfter: revisionSelection })
        harness.ui.refresh()

        const button = harness.toolbarHost.querySelector<HTMLButtonElement>(`[data-jword-revision-${action}]`)

        expect(button).not.toBeNull()

        button?.click()

        expect(harness.editor.getProjection().document.revisions).toBeUndefined()
        expect(readParagraphText(harness.editor)).toBe(action === 'accept' ? 'abcdef' : 'aef')
      } finally {
        harness.destroy()
      }
    }
  })

})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly revisionsHost: HTMLElement
  readonly ui: ReturnType<typeof createJWordUi>
  destroy(): void
}

/** 创建入口级 UI 测试环境。 */
function createHarness(): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const revisionsHost = document.createElement('div')
  const editor = createEditor({ initialText: 'abcdef' })

  document.body.append(editorHost, toolbarHost, liveRegionHost, revisionsHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost,
    revisions: {
      host: revisionsHost
    }
  })

  return {
    editor,
    editorHost,
    toolbarHost,
    revisionsHost,
    ui,
    destroy(): void {
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
      revisionsHost.remove()
    }
  }
}

/** 创建测试用文本选区。 */
function createSelection(editor: Editor, start: number, end: number) {
  return createSelectionState(
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: start
    }),
    editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: end
    })
  )
}

/** 读取当前选择区在段落内的全局起止下标。 */
function readSelectionParagraphOffsets(editor: Editor): readonly [number, number] | null {
  const selection = editor.getSelection()

  if (selection === null) {
    return null
  }

  const projection = editor.getProjection()
  const anchor = editor.resolveTextPosition(selection.anchor)
  const focus = editor.resolveTextPosition(selection.focus)

  return [
    readParagraphOffset(projection, anchor.blockId, anchor.runId, anchor.graphemeIndex),
    readParagraphOffset(projection, focus.blockId, focus.runId, focus.graphemeIndex)
  ]
}

/** 把 run 内下标换算成段落内全局下标。 */
function readParagraphOffset(
  projection: DocumentProjection,
  blockId: string,
  runId: string,
  graphemeIndex: number
): number {
  for (const section of projection.document.sections) {
    const block = section.blocks.find((candidate) => candidate.id === blockId)

    if (block?.kind !== 'paragraph') {
      continue
    }

    let offset = 0

    for (const run of block.runs) {
      if (run.id === runId) {
        return offset + graphemeIndex
      }

      offset += run.inlines.reduce((count, inline) => {
        return inline.kind === 'text' ? count + Array.from(inline.text).length : count
      }, 0)
    }
  }

  throw new Error(`缺少测试选区 run：${runId}`)
}


/** 读取第一段纯文本。 */
function readParagraphText(editor: Editor): string {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  return block?.kind === 'paragraph'
    ? block.runs.flatMap((run) => run.inlines).flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
    : ''
}
