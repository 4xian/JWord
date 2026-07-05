/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 3 剪贴板健壮性补齐项，覆盖空 clipboardData 和纯文本控制字符过滤。
 * 边界：只通过挂载后的隐藏输入框剪贴板事件验证用户可见编辑行为，不访问运行时私有状态。
 * 协作模块：输入运行时、文本编辑运行时、纯文本规范化和事务流水线共同支撑剪贴板语义。
 * 性能/安全约束：测试只运行在 jsdom，不访问网络或磁盘，不直接写文档投影。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-3。
 */
import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import type { Block, Run } from '../../src/model/types'
import { createSelectionState } from '../../src/model/selection'

describe('Editor clipboard runtime remediation', () => {
  it('ignores copy cut and paste events when clipboardData is null', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'abcdef' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
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
        graphemeIndex: 3
      })

      editor.setSelection(createSelectionState(anchor, focus))

      expect(() => dispatchClipboard(textarea, 'copy', null)).not.toThrow()
      expect(() => dispatchClipboard(textarea, 'cut', null)).not.toThrow()
      expect(() => dispatchClipboard(textarea, 'paste', null)).not.toThrow()
      expect(readDocumentPlainText(editor)).toBe('abcdef')
    } finally {
      editor.destroy()
    }
  })

  it('filters pasted control characters while preserving newlines and tabs', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'start' })

    try {
      editor.mount(host)

      const textarea = getHiddenTextarea(host)
      const caret = editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 5
      })

      editor.setSelection(createSelectionState(caret, caret))
      dispatchClipboard(textarea, 'paste', createClipboardTransfer({
        'text/plain': '\u0000A\tB\r\nC\u000bD\u001fE'
      }))

      expect(readDocumentPlainText(editor)).toBe('startA\tB\nCDE')
    } finally {
      editor.destroy()
    }
  })
})

function createClipboardTransfer(initialData: Record<string, string> = {}) {
  const store = new Map(Object.entries(initialData))

  return {
    getData(type: string) {
      return store.get(type) ?? ''
    },
    setData(type: string, value: string) {
      store.set(type, value)
    }
  }
}

function dispatchClipboard(
  textarea: HTMLTextAreaElement,
  type: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardTransfer> | null
): void {
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  textarea.dispatchEvent(event)
}

function getHiddenTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('hidden textarea 未挂载')
  }

  return textarea
}

function readDocumentPlainText(editor: ReturnType<typeof createEditor>): string {
  return editor.getProjection().document.sections
    .flatMap((section) => readBlocksPlainText(section.blocks))
    .join('\n')
}

function readBlocksPlainText(blocks: readonly Block[]): readonly string[] {
  return blocks.flatMap((block) => {
    if (block.kind === 'paragraph') {
      return [block.runs.map(readRunText).join('')]
    }

    return block.rows.flatMap((row) =>
      row.cells.flatMap((cell) => readBlocksPlainText(cell.blocks))
    )
  })
}

/** 读取 run 中全部文本 inline，忽略图片等非文本 inline。 */
function readRunText(run: Run): string {
  return run.inlines
    .flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
    .join('')
}
