/**
 * @vitest-environment jsdom
 *
 * 职责：提供 editor/input focused 测试共享的 DOM 事件派发、投影读取和命中辅助函数。
 * 边界：只服务 packages/core/test/editor 下的拆分测试，不承载生产逻辑。
 * 协作模块：input-runtime-* 测试通过这里复用 hidden textarea、clipboard 和 pointer 测试工具。
 * 性能/安全约束：仅在 jsdom 测试环境运行，不访问网络或磁盘，不直接写 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { expect } from 'vitest'

import { buildInsertInlineImageCommand, createEditor } from '../../src/index'
import type { LineBox } from '../../src/layout/runtime'
import { twipsToCssPx } from '../../src/layout/page-config'
import { createSelectionState } from '../../src/model/selection'
import type { Resource } from '../../src/resources/types'

interface RecordedTransaction {
  readonly commandName: string
  readonly origin: string
  readonly operationKinds: readonly string[]
  readonly dirty: boolean
}

export function getHiddenTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('hidden textarea 未挂载')
  }

  return textarea
}

export function textareaFrom(host: HTMLElement): HTMLTextAreaElement {
  return getHiddenTextarea(host)
}

export function dispatchTextInput(textarea: HTMLTextAreaElement, text: string) {
  textarea.value = text
  textarea.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }))
}

export function dispatchCompositionEvent(
  textarea: HTMLTextAreaElement,
  type: 'compositionstart' | 'compositionupdate' | 'compositionend',
  data: string
) {
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'data', {
    configurable: true,
    value: data
  })

  textarea.dispatchEvent(event)
}

export function dispatchKey(
  textarea: HTMLTextAreaElement,
  key: string,
  options: Pick<KeyboardEventInit, 'metaKey' | 'ctrlKey' | 'shiftKey'> & {
    isComposing?: boolean
    keyCode?: number
  } = {}
) {
  const init: KeyboardEventInit = {
    key,
    bubbles: true,
    cancelable: true
  }

  if (options.metaKey !== undefined) {
    init.metaKey = options.metaKey
  }

  if (options.ctrlKey !== undefined) {
    init.ctrlKey = options.ctrlKey
  }

  if (options.shiftKey !== undefined) {
    init.shiftKey = options.shiftKey
  }

  const event = new KeyboardEvent('keydown', init)

  if (options.isComposing !== undefined) {
    Object.defineProperty(event, 'isComposing', {
      configurable: true,
      value: options.isComposing
    })
  }

  if (options.keyCode !== undefined) {
    Object.defineProperty(event, 'keyCode', {
      configurable: true,
      value: options.keyCode
    })
  }

  textarea.dispatchEvent(event)
}

export function dispatchMouse(
  target: HTMLElement,
  type: 'mousedown' | 'mousemove' | 'mouseup' | 'dblclick',
  clientX: number,
  clientY: number
) {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: type === 'mouseup' ? 0 : 1,
    clientX,
    clientY
  }))
}

export function dispatchClipboard(
  textarea: HTMLTextAreaElement,
  type: 'copy' | 'cut' | 'paste',
  clipboardData: ReturnType<typeof createClipboardTransfer>
) {
  const event = new Event(type, { bubbles: true, cancelable: true })

  Object.defineProperty(event, 'clipboardData', {
    configurable: true,
    value: clipboardData
  })

  textarea.dispatchEvent(event)
}

export function createClipboardTransfer(initialData: Record<string, string> = {}) {
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

export function getPageElement(host: HTMLElement, pageIndex: number): HTMLElement {
  const page = host.querySelector(`[data-jword-page="${pageIndex}"]`)

  if (!(page instanceof HTMLElement)) {
    throw new Error(`page ${pageIndex} 未挂载`)
  }

  return page
}

export function mockPageRect(page: HTMLElement) {
  Object.defineProperty(page, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: Number.parseFloat(page.style.width || '0'),
      bottom: Number.parseFloat(page.style.height || '0'),
      width: Number.parseFloat(page.style.width || '0'),
      height: Number.parseFloat(page.style.height || '0'),
      toJSON: () => ({})
    })
  })
}

export function findPointerPointForGrapheme(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  graphemeIndex: number
) {
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]
  const localY = (page?.lines[0]?.y ?? 0) - (page?.y ?? 0) + 1

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (let x = 0; x < page.width; x += 1) {
    const anchor = editor.hitTest({
      pageIndex,
      x,
      y: localY
    })

    if (anchor === undefined) {
      continue
    }

    if (editor.resolveTextPosition(anchor).graphemeIndex === graphemeIndex) {
      return {
        clientX: twipsToCssPx(x),
        clientY: twipsToCssPx(localY)
      }
    }
  }

  throw new Error(`找不到 grapheme ${graphemeIndex} 的命中点`)
}

export function findPointerPointForGraphemeBias(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  graphemeIndex: number,
  bias: 'left' | 'center' | 'right'
) {
  const layout = editor.getLayout()
  const page = layout.pages[pageIndex]

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (const line of page.lines) {
    for (const fragment of line.fragments) {
      if (
        graphemeIndex < fragment.start.graphemeIndex
        || graphemeIndex >= fragment.end.graphemeIndex
      ) {
        continue
      }

      const relativeIndex = graphemeIndex - fragment.start.graphemeIndex
      const graphemeStart = fragment.advanceTwips[relativeIndex] ?? 0
      const graphemeEnd = fragment.advanceTwips[relativeIndex + 1] ?? fragment.width
      const relativeX = bias === 'left'
        ? graphemeStart + ((graphemeEnd - graphemeStart) * 0.1)
        : bias === 'right'
          ? graphemeStart + ((graphemeEnd - graphemeStart) * 0.9)
          : graphemeStart + ((graphemeEnd - graphemeStart) * 0.5)

      return {
        clientX: twipsToCssPx(fragment.x - page.x + relativeX),
        clientY: twipsToCssPx(line.y - page.y + Math.max(1, line.height / 2))
      }
    }
  }

  throw new Error(`找不到 grapheme ${graphemeIndex} 的 ${bias} 命中点`)
}

export function findPointerPointForImageRun(
  editor: ReturnType<typeof createEditor>,
  pageIndex: number,
  runId: string
) {
  const page = editor.getLayout().pages[pageIndex]

  if (page === undefined) {
    throw new Error(`page ${pageIndex} 不存在`)
  }

  for (const line of page.lines) {
    const inline = line.inlines.find((candidate) => candidate.runId === runId)

    if (inline !== undefined) {
      return {
        clientX: twipsToCssPx((inline.x - page.x) + (inline.width / 2)),
        clientY: twipsToCssPx((inline.y - page.y) + Math.max(1, inline.height / 2))
      }
    }
  }

  throw new Error(`找不到 image run ${runId} 的命中点`)
}

export function readParagraphTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')).join('')]
      : [])
  )
}

export function readParagraphRunTexts(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))]
      : [])
  )
}

export function readParagraphRunProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.properties ?? {})]
      : [])
  )
}

export function readParagraphRunLinks(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.link)]
      : [])
  )
}

/** 读取段落属性，验证富文本粘贴是否把段落级格式落入 projection。 */
export function readParagraphProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.properties ?? {}]
      : [])
  )
}

export function readInlineImageResourceIds(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'image' ? [inline.resourceId] : []))
      : [])
  )
}

export function createResource(id: string): Resource {
  return {
    kind: 'resource',
    id,
    mime: 'image/png',
    source: {
      kind: 'dataUrl',
      url: 'data:image/png;base64,AAAA'
    },
    status: 'success'
  }
}

export function insertInlineImageAtSelection(
  editor: ReturnType<typeof createEditor>,
  resource: Resource,
  anchor: Readonly<{
    sectionId: string
    blockId: string
    runId: string
    graphemeIndex: number
  }>
) {
  const runtimeAnchor = editor.createTextAnchor(anchor)
  const selection = createSelectionState(runtimeAnchor, runtimeAnchor)
  const command = buildInsertInlineImageCommand(editor.getProjection(), selection, resource, {
    widthTwips: 1440,
    heightTwips: 960
  })

  expect(command).not.toBeNull()
  editor.executeCommand(command!)
}

export function readParagraphTailAnchor(editor: ReturnType<typeof createEditor>) {
  const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

  if (paragraph?.kind !== 'paragraph') {
    throw new Error('expected paragraph block')
  }

  const tailRun = paragraph.runs[paragraph.runs.length - 1]

  if (tailRun === undefined) {
    throw new Error('expected tail run')
  }

  return {
    sectionId: 'section-1',
    blockId: paragraph.id,
    runId: tailRun.id,
    graphemeIndex: 0
  }
}

export function captureTransactions(editor: ReturnType<typeof createEditor>) {
  const transactions: RecordedTransaction[] = []

  editor.subscribe((event) => {
    if (event.kind !== 'transaction') {
      return
    }

    transactions.push({
      commandName: event.transaction.commandName,
      origin: event.transaction.origin,
      operationKinds: [...event.transaction.operationKinds],
      dirty: event.transaction.dirty
    })
  })

  return transactions
}

export function expectSelectionIndexes(
  editor: ReturnType<typeof createEditor>,
  selection: ReturnType<typeof createSelectionState> | null | undefined,
  expected: readonly [number, number]
) {
  expect(selection).not.toBeNull()
  expect(selection).toBeDefined()

  if (selection === null || selection === undefined) {
    return
  }

  expect([
    editor.resolveTextPosition(selection.anchor).graphemeIndex,
    editor.resolveTextPosition(selection.focus).graphemeIndex
  ]).toEqual(expected)
}

export async function waitForDeferredSelectionTick() {
  await new Promise((resolve) => {
    setTimeout(resolve, 120)
  })
}

export function findClosestLineGraphemeIndex(
  line: LineBox,
  absoluteX: number
) {
  const firstFragment = line.fragments[0]

  if (firstFragment === undefined) {
    throw new Error('line 没有文本 fragment')
  }

  if (absoluteX <= firstFragment.x) {
    return firstFragment.start.graphemeIndex
  }

  for (const fragment of line.fragments) {
    const midpoint = fragment.x + fragment.width / 2

    if (absoluteX < midpoint) {
      return fragment.start.graphemeIndex
    }

    if (absoluteX <= fragment.x + fragment.width) {
      return fragment.end.graphemeIndex
    }
  }

  return line.fragments[line.fragments.length - 1]!.end.graphemeIndex
}
