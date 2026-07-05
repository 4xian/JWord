/**
 * 职责：封装纯文本 runtime 的段落/run 上下文、位置移动和剪贴板/IME helper。
 * 边界：不访问 editor class 私有状态，不执行事务。
 * 协作模块：projection、layout line、selection target 和 transaction text position。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import { countGraphemes, splitGraphemes } from '../shared/grapheme'
import { createAnchorRef, createGraphemeIndex } from '../model/position'
import type { AnchorRef, BlockId, DocumentId, RunId, SectionId } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import type { Operation, TextPosition } from '../operations/transaction'
import { DEFAULT_DOCUMENT_ID } from './constants'

export interface ParagraphRuntimeContext {
  readonly sectionId: string
  readonly blockId: string
  readonly runs: readonly RunRuntimeContext[]
}

export interface RunRuntimeContext {
  readonly id: string
  readonly graphemeLength: number
}

export interface WordBoundarySegment {
  readonly start: number
  readonly end: number
  readonly isWordLike: boolean
}

export function readProjectionPlainText(projection: DocumentProjection): string {
  return collectParagraphRuntimeContexts(projection)
    .map((paragraph) => paragraph.runs.map((run) => readProjectionRunText(projection, paragraph.blockId, run.id)).join(''))
    .join('\n')
}

export function collectParagraphRuntimeContexts(projection: DocumentProjection): readonly ParagraphRuntimeContext[] {
  const paragraphs: ParagraphRuntimeContext[] = []

  for (const section of projection.document.sections) {
    visitBlocks(section.id, section.blocks)
  }

  return Object.freeze(paragraphs)

  function visitBlocks(sectionId: string, blocks: readonly import('../model/types').Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        paragraphs.push({
          sectionId,
          blockId: block.id,
          runs: Object.freeze(block.runs.map((run) => ({
            id: run.id,
            graphemeLength: countGraphemes(
              run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
            )
          })))
        })
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          visitBlocks(sectionId, cell.blocks)
        }
      }
    }
  }
}

export function readProjectionRunText(
  projection: DocumentProjection,
  blockId: string,
  runId: string
): string {
  for (const section of projection.document.sections) {
    const text = readBlocksRunText(section.blocks, blockId, runId)

    if (text !== undefined) {
      return text
    }
  }

  return ''
}

export function readBlocksRunText(
  blocks: readonly import('../model/types').Block[],
  blockId: string,
  runId: string
): string | undefined {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (block.id !== blockId) {
        continue
      }

      const run = block.runs.find((candidate) => candidate.id === runId)

      return run?.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const text = readBlocksRunText(cell.blocks, blockId, runId)

        if (text !== undefined) {
          return text
        }
      }
    }
  }

  return undefined
}

export function moveTextPosition(
  projection: DocumentProjection,
  position: TextPosition,
  delta: -1 | 1
): TextPosition | undefined {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const paragraphIndex = paragraphs.findIndex((candidate) => candidate.blockId === position.blockId)

  if (paragraphIndex < 0) {
    return undefined
  }

  const paragraph = paragraphs[paragraphIndex]

  if (paragraph === undefined) {
    return undefined
  }

  const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === position.runId)

  if (runIndex < 0) {
    return undefined
  }

  const run = paragraph.runs[runIndex]

  if (run === undefined) {
    return undefined
  }

  if (delta < 0) {
    if (position.graphemeIndex > 0) {
      return {
        ...position,
        graphemeIndex: position.graphemeIndex - 1
      }
    }

    const previousRun = runIndex > 0 ? paragraph.runs[runIndex - 1] : undefined

    if (previousRun !== undefined) {
      return {
        sectionId: paragraph.sectionId,
        blockId: paragraph.blockId,
        runId: previousRun.id,
        graphemeIndex: previousRun.graphemeLength
      }
    }

    const previousParagraph = paragraphIndex > 0 ? paragraphs[paragraphIndex - 1] : undefined
    const previousParagraphRun = previousParagraph?.runs[previousParagraph.runs.length - 1]

    if (previousParagraph === undefined || previousParagraphRun === undefined) {
      return undefined
    }

    return {
      sectionId: previousParagraph.sectionId,
      blockId: previousParagraph.blockId,
      runId: previousParagraphRun.id,
      graphemeIndex: previousParagraphRun.graphemeLength
    }
  }

  if (position.graphemeIndex < run.graphemeLength) {
    return {
      ...position,
      graphemeIndex: position.graphemeIndex + 1
    }
  }

  const nextRun = paragraph.runs[runIndex + 1]

  if (nextRun !== undefined) {
    return {
      sectionId: paragraph.sectionId,
      blockId: paragraph.blockId,
      runId: nextRun.id,
      graphemeIndex: 0
    }
  }

  const nextParagraph = paragraphs[paragraphIndex + 1]
  const nextParagraphRun = nextParagraph?.runs[0]

  if (nextParagraph === undefined || nextParagraphRun === undefined) {
    return undefined
  }

  return {
    sectionId: nextParagraph.sectionId,
    blockId: nextParagraph.blockId,
    runId: nextParagraphRun.id,
    graphemeIndex: 0
  }
}


export function moveTextPositionByWord(
  projection: DocumentProjection,
  position: TextPosition,
  direction: -1 | 1
): TextPosition | undefined {
  const text = readProjectionRunText(projection, position.blockId, position.runId)
  const boundaries = collectWordBoundarySegments(text)

  if (direction < 0) {
    const previous = [...boundaries].reverse().find((segment) =>
      segment.isWordLike && segment.start < position.graphemeIndex
    )

    return previous === undefined
      ? moveTextPosition(projection, { ...position, graphemeIndex: 0 }, -1)
      : { ...position, graphemeIndex: previous.start }
  }

  const next = boundaries.find((segment) =>
    segment.isWordLike && segment.end > position.graphemeIndex
  )

  return next === undefined
    ? moveTextPosition(projection, { ...position, graphemeIndex: countGraphemes(text) }, 1)
    : { ...position, graphemeIndex: next.end }
}

/** 按 Intl.Segmenter 的 word 粒度收集 run 内边界。 */
export function collectWordBoundarySegments(text: string): readonly WordBoundarySegment[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' })

  return Object.freeze(Array.from(segmenter.segment(text)).map((segment) => {
    const start = countGraphemes(text.slice(0, segment.index))
    const end = start + countGraphemes(segment.segment)

    return Object.freeze({
      start,
      end,
      isWordLike: segment.isWordLike === true
    })
  }))
}

export function allocateParagraphSplitIds(
  projection: DocumentProjection,
  plannedOperations: readonly Operation[] = []
): Readonly<{
  blockId: string
  runId: string
}> {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const blockIds = new Set(paragraphs.map((paragraph) => paragraph.blockId))
  const runIds = new Set(paragraphs.flatMap((paragraph) => paragraph.runs.map((run) => run.id)))

  for (const operation of plannedOperations) {
    if (operation.kind === 'splitBlock') {
      blockIds.add(operation.newBlockId)
      runIds.add(operation.newRunId)
    }
  }

  return {
    blockId: allocateSequentialIdentifier(blockIds, 'paragraph'),
    runId: allocateSequentialIdentifier(runIds, 'run')
  }
}

export function compareRuntimeTextPositions(
  projection: DocumentProjection,
  left: TextPosition,
  right: TextPosition
): number {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const leftParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === left.blockId)
  const rightParagraphIndex = paragraphs.findIndex((paragraph) => paragraph.blockId === right.blockId)

  if (leftParagraphIndex !== rightParagraphIndex) {
    return leftParagraphIndex - rightParagraphIndex
  }

  const paragraph = leftParagraphIndex >= 0 ? paragraphs[leftParagraphIndex] : undefined
  const leftRunIndex = paragraph?.runs.findIndex((run) => run.id === left.runId) ?? -1
  const rightRunIndex = paragraph?.runs.findIndex((run) => run.id === right.runId) ?? -1

  if (leftRunIndex !== rightRunIndex) {
    return leftRunIndex - rightRunIndex
  }

  return left.graphemeIndex - right.graphemeIndex
}

export function normalizePlainText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .split('')
    .filter((character) => isAllowedPlainTextCharacter(character))
    .join('')
}

/** 保留普通字符、换行和制表符，过滤其余 C0 控制字符。 */
function isAllowedPlainTextCharacter(character: string): boolean {
  const code = character.charCodeAt(0)

  return code >= 32 || character === '\n' || character === '\t'
}

export function allocateSequentialIdentifier(ids: Set<string>, prefix: string): string {
  let nextIndex = 1

  for (const id of ids) {
    const match = new RegExp(`^${prefix}-(\\d+)$`, 'u').exec(id)

    if (match === null) {
      continue
    }

    nextIndex = Math.max(nextIndex, Number(match[1]) + 1)
  }

  let candidate = `${prefix}-${nextIndex}`

  while (ids.has(candidate)) {
    nextIndex += 1
    candidate = `${prefix}-${nextIndex}`
  }

  return candidate
}

export function createRuntimeAnchor(input: Readonly<{
  documentId?: string
  sectionId: string
  blockId: string
  runId: string
  graphemeIndex: number
  assoc?: number
}>): AnchorRef {
  return createAnchorRef({
    documentId: (input.documentId ?? DEFAULT_DOCUMENT_ID) as DocumentId,
    sectionId: input.sectionId as SectionId,
    blockId: input.blockId as BlockId,
    runId: input.runId as RunId,
    graphemeIndex: createGraphemeIndex(input.graphemeIndex),
    ...(input.assoc === undefined ? {} : { assoc: input.assoc })
  })
}

export function readEventData(event: Event): string {
  const data = (event as Event & { data?: unknown }).data

  return typeof data === 'string' ? data : ''
}

/**
 * 读取 beforeinput 事件的输入类型。
 */
export function readInputType(event: Event): string {
  const inputType = (event as Event & { inputType?: unknown }).inputType

  return typeof inputType === 'string' ? inputType : ''
}

export function isCompositionKeyboardEvent(event: KeyboardEvent): boolean {
  const composing = (event as KeyboardEvent & { isComposing?: unknown }).isComposing
  const keyCode = (event as KeyboardEvent & { keyCode?: unknown }).keyCode

  return composing === true || keyCode === 229
}

export function readClipboardData(event: Event): {
  getData(type: string): string
  setData(type: string, value: string): void
} | undefined {
  const clipboardData = (event as Event & {
    clipboardData?: {
      getData(type: string): string
      setData(type: string, value: string): void
    }
  }).clipboardData

  return clipboardData == null ? undefined : clipboardData
}

export function isWordLikeGrapheme(grapheme: string): boolean {
  return readDoubleClickExpansionKind(grapheme) === 'word'
}

/**
 * 区分双击扩选时应按单词还是按单字处理。
 */
export function readDoubleClickExpansionKind(grapheme: string): 'word' | 'grapheme' | 'none' {
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(grapheme)) {
    return 'grapheme'
  }

  if (/[\p{Letter}\p{Number}_]/u.test(grapheme)) {
    return 'word'
  }

  return 'none'
}

export function resolveWordSelectionIndex(
  graphemes: readonly string[],
  graphemeIndex: number,
  assoc?: number
): number {
  const lastIndex = Math.max(0, graphemes.length - 1)
  const currentIndex = Math.min(Math.max(graphemeIndex, 0), lastIndex)
  const previousIndex = Math.max(0, currentIndex - 1)
  const nextIndex = Math.min(lastIndex, currentIndex + 1)
  const currentIsWord = isWordLikeGrapheme(graphemes[currentIndex] ?? '')
  const previousIsWord = isWordLikeGrapheme(graphemes[previousIndex] ?? '')
  const nextIsWord = isWordLikeGrapheme(graphemes[nextIndex] ?? '')

  if (graphemeIndex >= graphemes.length) {
    return lastIndex
  }

  if (assoc === -1 && graphemeIndex > 0 && previousIsWord) {
    return previousIndex
  }

  if (!currentIsWord && graphemeIndex > 0 && previousIsWord && !nextIsWord) {
    return previousIndex
  }

  if (!currentIsWord && graphemeIndex < lastIndex && nextIsWord && !previousIsWord) {
    return nextIndex
  }

  return currentIndex
}
