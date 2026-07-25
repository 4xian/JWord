/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 选区浮动工具栏、右键菜单、快捷键和清除格式动作的最小闭环。
 * 边界：只覆盖 packages/ui 与 core facade 的公开协作，不验证截图级样式、图片模块或浏览器原生剪贴板权限。
 * 协作：packages/ui/src/create-ui.ts、selection-actions 子模块与 @4xian/jword-core Editor facade。
 * 约束：断言基于公开 DOM selector、selection formatting state 和 projection，不读取 controller 私有状态。
 */

import {
  buildInsertTableCommand,
  buildSetTableCellTextCommand,
  createEditor,
  createSelectionState
} from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import { createJWordUi } from '../src/create-ui'

describe('selection actions controller', () => {
  test('把选区浮层挂到 editor 内部 shell，外部宿主不再提供定位上下文', () => {
    const harness = createHarness('abcdef')

    try {
      const editorShell = getRequiredElement(harness.editorHost, '[data-jword-editor]')
      const selectionActions = getRequiredElement(harness.editorHost, '[data-jword-selection-actions="true"]')

      expect(selectionActions.parentElement).toBe(editorShell)
    } finally {
      harness.destroy()
    }
  })

  test('shows floating toolbar only for focused non-collapsed selection and hides on blur', async () => {
    const harness = createHarness('abcdef')

    try {
      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 1, 1))

      expect(floatingToolbar.hidden).toBe(true)

      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      expect(floatingToolbar.hidden).toBe(false)

      dispatchBlur(harness.textarea)
      await Promise.resolve()

      expect(floatingToolbar.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('rebinds the context menu to the latest stable selection and hides it on blur', async () => {
    const harness = createHarness('abcdef')

    try {
      const contextMenu = getRequiredElement(harness.editorHost, '[data-jword-context-menu="true"]')

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 0, 2))
      dispatchContextMenu(harness.editorHost, 48, 72)

      expect(contextMenu.hidden).toBe(false)

      const firstSelectionKey = contextMenu.getAttribute('data-jword-selection-key')

      expect(firstSelectionKey).toBeTruthy()

      harness.editor.setSelection(createSelection(harness.editor, 2, 5))
      dispatchContextMenu(harness.editorHost, 80, 96)

      expect(contextMenu.hidden).toBe(false)
      expect(contextMenu.getAttribute('data-jword-selection-key')).not.toBe(firstSelectionKey)

      dispatchBlur(harness.textarea)
      await Promise.resolve()

      expect(contextMenu.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('handles Ctrl or Meta + U and Escape through the editor hidden textarea', async () => {
    const harness = createHarness('abcdef')

    try {
      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')
      const underlineButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.underline"]'
      )

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 1, 4))

      expect(floatingToolbar.hidden).toBe(false)

      harness.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key: 'u'
      }))

      expect(underlineButton.getAttribute('aria-pressed')).toBe('true')
      expect(harness.editor.getSelectionFormattingState().run?.underline.value).toBe(true)

      harness.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key: 'Escape'
      }))

      await Promise.resolve()
      expect(floatingToolbar.hidden).toBe(true)
    } finally {
      harness.destroy()
    }
  })

  test('clears current run formatting from the context menu using the stable selection snapshot', async () => {
    const harness = createHarness('abcdef')

    try {
      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createSelection(harness.editor, 0, 6))
      harness.editor.toggleBold()
      harness.editor.toggleUnderline()

      dispatchContextMenu(harness.editorHost, 64, 88)
      harness.editor.setSelection(createSelection(harness.editor, 1, 1))

      const clearButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-context-action="format.clear"]'
      ) as HTMLButtonElement

      clearButton.click()

      const formattingState = harness.editor.getSelectionFormattingState()

      expect(formattingState.run?.bold.value).toBe(false)
      expect(formattingState.run?.underline.value).toBe(false)
    } finally {
      harness.destroy()
    }
  })

  test('keeps table selection rebound and formatting state in sync for underline strike and colors', async () => {
    const harness = createHarness('before table')

    try {
      const tableTarget = insertSingleCellTable(harness.editor, 'abcdef')
      const floatingToolbar = getRequiredElement(harness.editorHost, '[data-jword-floating-toolbar="true"]')
      const underlineButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.underline"]'
      ) as HTMLButtonElement
      const strikeButton = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.strike"]'
      ) as HTMLButtonElement
      const textColor = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.textColor"]'
      ) as HTMLInputElement
      const backgroundColor = getRequiredElement(
        harness.editorHost,
        '[data-jword-selection-action="format.backgroundColor"]'
      ) as HTMLInputElement

      dispatchFocus(harness.textarea)
      harness.editor.setSelection(createTableSelection(harness.editor, tableTarget, 1, 4))

      expect(floatingToolbar.hidden).toBe(false)

      underlineButton.click()
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.underline.value).toBe(true)

      strikeButton.click()
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.strike.value).toBe(true)

      textColor.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true
      }))
      harness.editor.setSelection(null)
      textColor.dispatchEvent(new MouseEvent('click', {
        bubbles: true
      }))
      textColor.value = '#cc2200'
      textColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.color.value).toBe('#cc2200')
      textColor.value = '#2255cc'
      textColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.color.value).toBe('#2255cc')
      textColor.value = '#cc5500'
      textColor.dispatchEvent(new Event('change', {
        bubbles: true
      }))
      textColor.value = '#0055cc'
      textColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      harness.editorHost.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }))
      textColor.dispatchEvent(new Event('change', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.color.value).toBe('#0055cc')

      backgroundColor.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true
      }))
      harness.editor.setSelection(null)
      backgroundColor.dispatchEvent(new MouseEvent('click', {
        bubbles: true
      }))
      backgroundColor.value = '#00aa66'
      backgroundColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.backgroundColor.value).toBe('#00aa66')
      backgroundColor.value = '#ffcc33'
      backgroundColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.backgroundColor.value).toBe('#ffcc33')
      backgroundColor.value = '#99cc00'
      backgroundColor.dispatchEvent(new Event('change', {
        bubbles: true
      }))
      backgroundColor.value = '#6633ff'
      backgroundColor.dispatchEvent(new Event('input', {
        bubbles: true
      }))
      harness.editorHost.dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true
      }))
      backgroundColor.dispatchEvent(new Event('change', {
        bubbles: true
      }))
      expectSelectionRange(harness.editor, tableTarget, 1, 4)
      expect(harness.editor.getSelectionFormattingState().run?.backgroundColor.value).toBe('#6633ff')
    } finally {
      harness.destroy()
    }
  })
})

interface TableTextTarget {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly cellId: string
  readonly tableId: string
}

interface Harness {
  readonly editor: ReturnType<typeof createEditor>
  readonly editorHost: HTMLDivElement
  readonly toolbarHost: HTMLDivElement
  readonly textarea: HTMLTextAreaElement
  destroy(): void
}

/** 创建挂载了 editor 与 UI 的最小测试环境。 */
function createHarness(initialText: string): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const statusHost = document.createElement('div')
  const editor = createEditor({ initialText })

  editorHost.style.position = 'relative'
  editorHost.style.width = '900px'
  editorHost.style.height = '640px'
  toolbarHost.style.width = '900px'

  document.body.append(toolbarHost, editorHost, statusHost)
  editor.mount(editorHost)
  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost: statusHost
  })
  const textarea = getHiddenTextarea(editorHost)

  return {
    editor,
    editorHost,
    toolbarHost,
    textarea,
    destroy(): void {
      ui.destroy()
      editor.destroy()
      toolbarHost.remove()
      editorHost.remove()
      statusHost.remove()
    }
  }
}

/** 读取 editor 当前隐藏输入框。 */
function getHiddenTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('hidden textarea 未挂载')
  }

  return textarea
}

/** 通过公开 anchor API 构造同一 run 上的测试选区。 */
function createSelection(editor: ReturnType<typeof createEditor>, anchorIndex: number, focusIndex: number) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

/** 在测试 editor 中插入一个 1x1 表格并写入单元格文本。 */
function insertSingleCellTable(editor: ReturnType<typeof createEditor>, text: string): TableTextTarget {
  const insertCommand = buildInsertTableCommand(editor.getProjection(), null, {
    rows: 1,
    columns: 1
  })

  if (insertCommand === null) {
    throw new Error('无法插入测试表格')
  }

  editor.executeCommand(insertCommand)

  const insertedTable = editor.getProjection().document.sections[0]?.blocks.find((block) => block.kind === 'table')
  const insertedCell = insertedTable?.rows[0]?.cells[0]

  if (insertedTable === undefined || insertedCell === undefined) {
    throw new Error('缺少测试表格单元格')
  }

  const setTextCommand = buildSetTableCellTextCommand(editor.getProjection(), insertedTable.id, insertedCell.id, text)

  if (setTextCommand === null) {
    throw new Error('无法写入测试表格文本')
  }

  editor.executeCommand(setTextCommand)

  const refreshedTable = editor.getProjection().document.sections[0]?.blocks.find((block) => block.kind === 'table')
  const refreshedCell = refreshedTable?.rows[0]?.cells[0]
  const paragraph = refreshedCell?.blocks[0]
  const run = paragraph?.kind === 'paragraph' ? paragraph.runs[0] : undefined

  if (refreshedTable === undefined || refreshedCell === undefined || paragraph?.kind !== 'paragraph' || run === undefined) {
    throw new Error('缺少测试表格文本目标')
  }

  return {
    sectionId: 'section-1',
    tableId: refreshedTable.id,
    cellId: refreshedCell.id,
    blockId: paragraph.id,
    runId: run.id
  }
}

/** 基于表格单元格中的首个段落构造测试选区。 */
function createTableSelection(
  editor: ReturnType<typeof createEditor>,
  target: TableTextTarget,
  anchorIndex: number,
  focusIndex: number
) {
  const anchor = editor.createTextAnchor({
    sectionId: target.sectionId,
    blockId: target.blockId,
    runId: target.runId,
    graphemeIndex: anchorIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: target.sectionId,
    blockId: target.blockId,
    runId: target.runId,
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}

/** 断言表格格式命令后选区仍绑定在同一段落和 grapheme 范围。 */
function expectSelectionRange(
  editor: ReturnType<typeof createEditor>,
  target: TableTextTarget,
  anchorIndex: number,
  focusIndex: number
): void {
  const selection = editor.getSelection()

  expect(selection).not.toBeNull()

  if (selection === null) {
    return
  }

  const anchor = editor.resolveTextPosition(selection.anchor)
  const focus = editor.resolveTextPosition(selection.focus)
  const projection = editor.getProjection()
  const paragraph = findParagraphById(projection.document.sections[0]?.blocks ?? [], target.blockId)

  if (paragraph === null) {
    throw new Error('缺少目标段落')
  }

  const resolvedAnchorIndex = resolveParagraphGraphemeIndex(paragraph, anchor.runId, anchor.graphemeIndex)
  const resolvedFocusIndex = resolveParagraphGraphemeIndex(paragraph, focus.runId, focus.graphemeIndex)

  expect({
    blockId: anchor.blockId,
    graphemeIndex: resolvedAnchorIndex
  }).toEqual({
    blockId: target.blockId,
    graphemeIndex: anchorIndex
  })
  expect({
    blockId: focus.blockId,
    graphemeIndex: resolvedFocusIndex
  }).toEqual({
    blockId: target.blockId,
    graphemeIndex: focusIndex
  })
}

/** 在 block 树中递归查找目标段落。 */
function findParagraphById(
  blocks: readonly import('@4xian/jword-core').Block[],
  blockId: string
): import('@4xian/jword-core').Paragraph | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.id === blockId) {
      return block
    }

    if (block.kind !== 'table') {
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const paragraph = findParagraphById(cell.blocks, blockId)

        if (paragraph !== null) {
          return paragraph
        }
      }
    }
  }

  return null
}

/** 把 run 内 grapheme 偏移还原成段落绝对偏移。 */
function resolveParagraphGraphemeIndex(
  paragraph: import('@4xian/jword-core').Paragraph,
  runId: string,
  graphemeIndex: number
): number {
  let paragraphGraphemeIndex = graphemeIndex

  for (const run of paragraph.runs) {
    if (run.id === runId) {
      return paragraphGraphemeIndex
    }

    paragraphGraphemeIndex += run.inlines.reduce((length, inline) => {
      if (inline.kind !== 'text') {
        return length
      }

      return length + Array.from(inline.text).length
    }, 0)
  }

  throw new Error(`缺少目标 run: ${runId}`)
}

/** 触发 editor hidden textarea 的聚焦态。 */
function dispatchFocus(textarea: HTMLTextAreaElement): void {
  textarea.focus()
}

/** 触发 editor hidden textarea 的失焦态。 */
function dispatchBlur(textarea: HTMLTextAreaElement): void {
  textarea.blur()
}

/** 触发 editor 区域内的右键菜单事件。 */
function dispatchContextMenu(host: HTMLElement, clientX: number, clientY: number): void {
  host.dispatchEvent(new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY
  }))
}

/** 保证 selector 对应节点真实存在。 */
function getRequiredElement(host: HTMLElement, selector: string): HTMLElement {
  const element = host.querySelector<HTMLElement>(selector)

  if (element === null) {
    throw new Error(`缺少节点: ${selector}`)
  }

  return element
}
