/**
 * 职责：为 Hocuspocus demo runtime 构造本地正文变更 command。
 * 边界：只处理 demo 首段纯文本的最小 diff 与简单 rebase，不接 provider、IndexedDB 或 DOM。
 * 协作：hocuspocus-runtime.ts 提供 projection 和 TextPosition 查找函数。
 * 约束：保持文本操作通过 Editor command 进入 transaction pipeline，不直接写 Y.Text。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { Command, DocumentProjection, Operation, TextPosition } from '@4xian/jword-core'

export interface HocuspocusTextCommandInput {
  readonly projection: DocumentProjection
  readonly currentText: string
  readonly previousText: string
  readonly nextText: string
  readonly readPosition: (projection: DocumentProjection, graphemeIndex: number) => TextPosition | null
}

interface TextDiff {
  readonly start: number
  readonly deletedLength: number
  readonly insertedText: string
}

interface SharedText {
  readonly text: string
  readonly currentStart: number
  readonly nextStart: number
  readonly length: number
}

interface ProjectionTextRun {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly start: number
  readonly end: number
}

const staleBaselineMinimumSharedLength = 4

/** 构造更新首个 paragraph run 文本的最小 command。 */
export function buildHocuspocusTextCommand(input: HocuspocusTextCommandInput): Command {
  if (input.currentText === input.nextText) {
    return {
      name: 'hocuspocusClientText',
      operations: []
    }
  }

  const diff = createTextDiff(input.previousText, input.nextText)
  const overlappingAppendOperations = buildOverlappingAppendOperations(input, diff)

  if (overlappingAppendOperations !== null) {
    return {
      name: 'hocuspocusClientText',
      operations: overlappingAppendOperations
    }
  }

  const staleBaselineOperations = buildStaleBaselineOperations(input, diff)

  if (staleBaselineOperations !== null) {
    return {
      name: 'hocuspocusClientText',
      operations: staleBaselineOperations
    }
  }

  const rebasedDeleteOperations = buildRebasedDeleteOperations(input, diff)

  if (rebasedDeleteOperations !== null) {
    return {
      name: 'hocuspocusClientText',
      operations: rebasedDeleteOperations
    }
  }

  const rebasedStart = rebaseDiffStart(input.currentText, input.previousText, diff.start)
  const start = input.readPosition(input.projection, rebasedStart)
  const operations: Operation[] = []

  if (diff.deletedLength > 0) {
    operations.push(...buildDeleteOperationsForGlobalRange(
      input,
      rebasedStart,
      rebasedStart + diff.deletedLength
    ))
  }

  if (start !== null && diff.insertedText.length > 0) {
    operations.push({
      kind: 'insertText',
      at: start,
      text: diff.insertedText
    })
  }

  return {
    name: 'hocuspocusClientText',
    operations
  }
}

/** 旧 baseline 追加时，裁掉 current 中已经存在的远端追加片段。 */
function buildOverlappingAppendOperations(
  input: HocuspocusTextCommandInput,
  diff: TextDiff
): Operation[] | null {
  if (
    diff.deletedLength !== 0 ||
    diff.insertedText.length === 0 ||
    diff.start !== countGraphemes(input.previousText)
  ) {
    return null
  }

  if (!input.currentText.startsWith(input.previousText) || !input.nextText.startsWith(input.previousText)) {
    return null
  }

  const currentTail = input.currentText.slice(input.previousText.length)

  if (currentTail.length === 0 || !diff.insertedText.startsWith(currentTail)) {
    return null
  }

  const appendedText = diff.insertedText.slice(currentTail.length)

  if (appendedText.length === 0) {
    return []
  }

  const operations: Operation[] = []

  pushInsertTextOperation(input, operations, countGraphemes(input.currentText), appendedText)

  return operations
}

/** 对旧基线纯删除进行非连续 rebase，避免吞掉远端插入文本。 */
function buildRebasedDeleteOperations(
  input: HocuspocusTextCommandInput,
  diff: TextDiff
): Operation[] | null {
  if (diff.deletedLength === 0 || diff.insertedText.length > 0) {
    return null
  }
  if (input.currentText.indexOf(input.previousText) >= 0) {
    return null
  }

  const oldPositions = mapPreviousGraphemesToCurrent(input.previousText, input.currentText)

  if (oldPositions === null) {
    return null
  }

  const deletedPositions = oldPositions.slice(diff.start, diff.start + diff.deletedLength)

  if (deletedPositions.length !== diff.deletedLength) {
    return null
  }

  return buildDeleteOperationsFromPositions(input, deletedPositions)
}

/** 将旧基线正文按顺序映射到当前共享正文中的 grapheme 位置。 */
function mapPreviousGraphemesToCurrent(
  previousText: string,
  currentText: string
): readonly number[] | null {
  const previousGraphemes = Array.from(previousText)
  const currentGraphemes = Array.from(currentText)
  const positions: number[] = []
  let currentIndex = 0

  for (const grapheme of previousGraphemes) {
    const foundIndex = currentGraphemes.findIndex((candidate, index) =>
      index >= currentIndex && candidate === grapheme
    )

    if (foundIndex < 0) {
      return null
    }

    positions.push(foundIndex)
    currentIndex = foundIndex + 1
  }

  return positions
}

/** 按倒序把非连续 grapheme 位置合并为删除 operation。 */
function buildDeleteOperationsFromPositions(
  input: HocuspocusTextCommandInput,
  positions: readonly number[]
): Operation[] {
  const operations: Operation[] = []

  for (const range of [...mergeDeletePositions(positions)].reverse()) {
    operations.push(...buildDeleteOperationsForGlobalRange(input, range.start, range.end))
  }

  return operations
}

/** 按 projection 的实际 run 边界把全局删除范围拆成倒序 deleteRange。 */
function buildDeleteOperationsForGlobalRange(
  input: HocuspocusTextCommandInput,
  start: number,
  end: number
): Operation[] {
  const operations: Operation[] = []
  const runs = collectProjectionTextRuns(input.projection)

  for (const run of [...runs].reverse()) {
    const overlapStart = Math.max(start, run.start)
    const overlapEnd = Math.min(end, run.end)

    if (overlapStart >= overlapEnd) {
      continue
    }

    operations.push({
      kind: 'deleteRange',
      range: {
        anchor: {
          sectionId: run.sectionId,
          blockId: run.blockId,
          runId: run.runId,
          graphemeIndex: overlapStart - run.start
        },
        focus: {
          sectionId: run.sectionId,
          blockId: run.blockId,
          runId: run.runId,
          graphemeIndex: overlapEnd - run.start
        }
      }
    })
  }

  return operations
}

/** 收集 projection 中按可见文本顺序排列的 text run 全局范围。 */
function collectProjectionTextRuns(projection: DocumentProjection): readonly ProjectionTextRun[] {
  const runs: ProjectionTextRun[] = []
  let offset = 0

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const text = run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
        const length = countGraphemes(text)

        runs.push({
          sectionId: section.id,
          blockId: block.id,
          runId: run.id,
          start: offset,
          end: offset + length
        })
        offset += length
      }
    }
  }

  return runs
}

/** 将相邻删除位置合并成左闭右开 range。 */
function mergeDeletePositions(positions: readonly number[]): ReadonlyArray<{
  readonly start: number
  readonly end: number
}> {
  const ranges: Array<{
    start: number
    end: number
  }> = []

  for (const position of positions) {
    const previousRange = ranges[ranges.length - 1]

    if (previousRange !== undefined && previousRange.end === position) {
      previousRange.end = position + 1
      continue
    }

    ranges.push({
      start: position,
      end: position + 1
    })
  }

  return ranges
}

/** 对没有 beforeinput 的旧 baseline 输入，按 current/next 共享正文合并本地新增。 */
function buildStaleBaselineOperations(
  input: HocuspocusTextCommandInput,
  diff: TextDiff
): Operation[] | null {
  if (diff.start !== 0 || diff.deletedLength !== 0 || diff.insertedText !== input.nextText) {
    return null
  }

  if (input.previousText.length > 0 || input.currentText.length === 0) {
    return null
  }

  const sharedText = findLongestSharedText(input.currentText, input.nextText)

  if (countGraphemes(sharedText.text) < staleBaselineMinimumSharedLength) {
    return buildReplaceCurrentTextOperations(input)
  }

  const operations: Operation[] = []
  const nextGraphemes = Array.from(input.nextText)
  const prefixText = nextGraphemes.slice(0, sharedText.nextStart).join('')
  const suffixText = nextGraphemes.slice(sharedText.nextStart + sharedText.length).join('')

  if (suffixText.length > 0) {
    pushInsertTextOperation(input, operations, sharedText.currentStart + sharedText.length, suffixText)
  }

  if (prefixText.length > 0) {
    pushInsertTextOperation(input, operations, sharedText.currentStart, prefixText)
  }

  return operations
}

/** 没有可靠共享正文时，将无 beforeinput 的整段输入视作替换当前正文。 */
function buildReplaceCurrentTextOperations(input: HocuspocusTextCommandInput): Operation[] {
  const operations: Operation[] = []
  const start = input.readPosition(input.projection, 0)
  const end = input.readPosition(input.projection, countGraphemes(input.currentText))

  if (start !== null && end !== null && input.currentText.length > 0) {
    operations.push(...buildDeleteOperationsForGlobalRange(input, 0, countGraphemes(input.currentText)))
  }

  pushInsertTextOperation(input, operations, 0, input.nextText)

  return operations
}

/** 追加一个可写文本插入 operation。 */
function pushInsertTextOperation(
  input: HocuspocusTextCommandInput,
  operations: Operation[],
  graphemeIndex: number,
  text: string
): void {
  if (text.length === 0) {
    return
  }

  const at = input.readPosition(input.projection, graphemeIndex)

  if (at === null) {
    return
  }

  operations.push({
    kind: 'insertText',
    at,
    text
  })
}

/** 查找 current 与 next 中最长的连续共享正文片段。 */
function findLongestSharedText(currentText: string, nextText: string): SharedText {
  const currentGraphemes = Array.from(currentText)
  const nextGraphemes = Array.from(nextText)
  let bestCurrentStart = 0
  let bestNextStart = 0
  let bestLength = 0

  for (let currentStart = 0; currentStart < currentGraphemes.length; currentStart += 1) {
    for (let nextStart = 0; nextStart < nextGraphemes.length; nextStart += 1) {
      let length = 0

      while (
        currentStart + length < currentGraphemes.length &&
        nextStart + length < nextGraphemes.length &&
        currentGraphemes[currentStart + length] === nextGraphemes[nextStart + length]
      ) {
        length += 1
      }

      if (length > bestLength) {
        bestCurrentStart = currentStart
        bestNextStart = nextStart
        bestLength = length
      }
    }
  }

  return trimSharedBoundary({
    text: nextGraphemes.slice(bestNextStart, bestNextStart + bestLength).join(''),
    currentStart: bestCurrentStart,
    nextStart: bestNextStart,
    length: bestLength
  }, currentGraphemes, nextGraphemes)
}

/** 避免把本地 token 分隔符误当成稳定共享正文的一部分。 */
function trimSharedBoundary(
  sharedText: SharedText,
  currentGraphemes: readonly string[],
  nextGraphemes: readonly string[]
): SharedText {
  let currentStart = sharedText.currentStart
  let nextStart = sharedText.nextStart
  let length = sharedText.length

  while (
    length > 0 &&
    currentStart > 0 &&
    nextStart > 0 &&
    isMergeBoundaryGrapheme(currentGraphemes[currentStart] ?? '') &&
    currentGraphemes[currentStart - 1] !== nextGraphemes[nextStart - 1]
  ) {
    currentStart += 1
    nextStart += 1
    length -= 1
  }

  return {
    text: nextGraphemes.slice(nextStart, nextStart + length).join(''),
    currentStart,
    nextStart,
    length
  }
}

/** 判断 grapheme 是否更像本地 token 分隔符而不是正文主体。 */
function isMergeBoundaryGrapheme(grapheme: string): boolean {
  return grapheme === '-' || grapheme === ' '
}

/** 计算上一版可见文本到下一版输入文本之间的最小变化。 */
function createTextDiff(previousText: string, nextText: string): TextDiff {
  const previousGraphemes = Array.from(previousText)
  const nextGraphemes = Array.from(nextText)
  let prefixLength = 0
  let suffixLength = 0

  while (
    prefixLength < previousGraphemes.length &&
    prefixLength < nextGraphemes.length &&
    previousGraphemes[prefixLength] === nextGraphemes[prefixLength]
  ) {
    prefixLength += 1
  }

  while (
    suffixLength + prefixLength < previousGraphemes.length &&
    suffixLength + prefixLength < nextGraphemes.length &&
    previousGraphemes[previousGraphemes.length - 1 - suffixLength] ===
      nextGraphemes[nextGraphemes.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return {
    start: prefixLength,
    deletedLength: previousGraphemes.length - prefixLength - suffixLength,
    insertedText: nextGraphemes.slice(prefixLength, nextGraphemes.length - suffixLength).join('')
  }
}

/** 将基于上一版可见文本的变化起点映射到当前共享正文。 */
function rebaseDiffStart(currentText: string, previousText: string, diffStart: number): number {
  const currentGraphemes = Array.from(currentText)
  const previousGraphemes = Array.from(previousText)
  const previousPrefix = previousGraphemes.slice(0, diffStart).join('')
  const previousSuffix = previousGraphemes.slice(diffStart).join('')

  if (previousText.length > 0) {
    const fullMatch = currentText.indexOf(previousText)

    if (fullMatch >= 0) {
      return countGraphemes(currentText.slice(0, fullMatch)) + diffStart
    }
  }

  if (previousPrefix.length > 0) {
    const prefixMatch = currentText.indexOf(previousPrefix)

    if (prefixMatch >= 0) {
      return countGraphemes(currentText.slice(0, prefixMatch)) + diffStart
    }
  }

  if (previousSuffix.length > 0) {
    const suffixMatch = currentText.indexOf(previousSuffix)

    if (suffixMatch >= 0) {
      return countGraphemes(currentText.slice(0, suffixMatch))
    }
  }

  return Math.min(diffStart, currentGraphemes.length)
}

/** 统计 demo 文本的 Unicode code point 数。 */
function countGraphemes(text: string): number {
  return Array.from(text).length
}
