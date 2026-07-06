/**
 * 职责：把 projection + selection 解析成 Gate 3 基础格式命令和状态需要的段落、run 目标集合。
 * 边界：只做只读遍历和顺序判定，不构造 command、不写入 Y.Doc、不访问 DOM。
 * 协作模块：command builder 和 formatting state 共享这里的选区解析结果，避免各自重写遍历逻辑。
 * 性能/安全约束：按当前 projection 做一次轻量 DFS，适合 Gate 3 toolbar 基础能力，不缓存可写引用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import { countGraphemes } from '../shared/grapheme'
import { readAnchorRefSnapshot } from './position'
import type { Paragraph, Run } from './types'
import type { DocumentProjection } from './projection'
import { isSelectionCollapsed } from './selection'
import type { SelectionState } from './selection'

export interface SelectedParagraphTarget {
  readonly paragraph: Paragraph
  readonly order: number
  readonly firstRunOrder: number
  readonly lastRunOrder: number
  readonly lastRunGraphemeLength: number
}

export interface SelectedRunTarget {
  readonly run: Run
  readonly paragraphId: string
  readonly order: number
  readonly paragraphOrder: number
  readonly graphemeLength: number
  readonly selectedStartGraphemeIndex: number
  readonly selectedEndGraphemeIndex: number
}

export interface SelectionTargets {
  readonly paragraphs: readonly SelectedParagraphTarget[]
  readonly runs: readonly SelectedRunTarget[]
}

interface ProjectionIndex {
  readonly paragraphs: readonly SelectedParagraphTarget[]
  readonly runs: readonly SelectedRunTarget[]
  readonly paragraphById: ReadonlyMap<string, SelectedParagraphTarget>
  readonly runById: ReadonlyMap<string, SelectedRunTarget>
}

interface ComparablePosition {
  readonly paragraphOrder: number
  readonly runOrder: number
  readonly graphemeIndex: number
}

interface ResolvedSelectionEndpoint {
  readonly paragraph: SelectedParagraphTarget
  readonly run: SelectedRunTarget
  readonly graphemeIndex: number
}

const EMPTY_TARGETS: SelectionTargets = Object.freeze({
  paragraphs: Object.freeze([]),
  runs: Object.freeze([])
})

/**
 * 收集当前 selection 覆盖到的段落和 run。
 *
 * @param projection 当前只读文档投影。
 * @param selection 当前选区。
 * @returns 文档顺序稳定的段落和 run 目标集合。
 */
export function collectSelectionTargets(
  projection: DocumentProjection,
  selection: SelectionState | null
): SelectionTargets {
  if (selection === null) {
    return EMPTY_TARGETS
  }

  if (isSelectionCollapsed(selection)) {
    return collectCollapsedTargetsFromProjection(projection, selection)
  }

  const index = createProjectionIndex(projection)
  const rangeTargets = collectRangeTargets(index, selection)

  return rangeTargets ?? EMPTY_TARGETS
}

/** 折叠选区只定位命中的段落和 run，避免为工具栏状态全量索引大文档。 */
function collectCollapsedTargetsFromProjection(
  projection: DocumentProjection,
  selection: SelectionState
): SelectionTargets {
  const snapshot = readAnchorRefSnapshot(selection.anchor)
  let paragraphOrder = 0
  let runOrder = 0

  for (const section of projection.document.sections) {
    const targets = visitBlocks(section.blocks)

    if (targets !== undefined) {
      return targets
    }
  }

  return EMPTY_TARGETS

  function visitBlocks(blocks: readonly import('./types').Block[]): SelectionTargets | undefined {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        const firstRunOrder = runOrder

        if (block.id === String(snapshot.blockId)) {
          const paragraphTarget = createSelectedParagraphTarget(block, paragraphOrder, firstRunOrder)
          let runTarget: SelectedRunTarget | undefined

          for (const run of block.runs) {
            if (run.id === String(snapshot.runId)) {
              const graphemeLength = countGraphemes(readRunText(run))

              runTarget = {
                run,
                paragraphId: block.id,
                order: runOrder,
                paragraphOrder,
                graphemeLength,
                selectedStartGraphemeIndex: 0,
                selectedEndGraphemeIndex: graphemeLength
              }
            }

            runOrder += 1
          }

          return Object.freeze({
            paragraphs: Object.freeze([paragraphTarget]),
            runs: Object.freeze(runTarget === undefined ? [] : [runTarget])
          })
        }

        paragraphOrder += 1
        runOrder += block.runs.length
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          const targets = visitBlocks(cell.blocks)

          if (targets !== undefined) {
            return targets
          }
        }
      }
    }

    return undefined
  }
}

function collectRangeTargets(
  index: ProjectionIndex,
  selection: SelectionState
): SelectionTargets | undefined {
  const anchor = resolveSelectionEndpoint(index, selection.anchor)
  const focus = resolveSelectionEndpoint(index, selection.focus)

  if (anchor === undefined || focus === undefined) {
    return undefined
  }

  const [start, end] = compareEndpoints(anchor, focus) <= 0
    ? [anchor, focus]
    : [focus, anchor]

  const paragraphs = index.paragraphs.filter((paragraph) =>
    overlapsParagraphSelection(paragraph, start, end)
  )
  const runs = index.runs
    .filter((run) => overlapsSelection(run, start, end))
    .map((run) => ({
      ...run,
      selectedStartGraphemeIndex: run.order === start.run.order ? start.graphemeIndex : 0,
      selectedEndGraphemeIndex: run.order === end.run.order ? end.graphemeIndex : run.graphemeLength
    }))

  return Object.freeze({
    paragraphs: Object.freeze([...paragraphs]),
    runs: Object.freeze([...runs])
  })
}

function createProjectionIndex(projection: DocumentProjection): ProjectionIndex {
  const paragraphs: SelectedParagraphTarget[] = []
  const runs: SelectedRunTarget[] = []
  const paragraphById = new Map<string, SelectedParagraphTarget>()
  const runById = new Map<string, SelectedRunTarget>()
  let paragraphOrder = 0
  let runOrder = 0

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return {
    paragraphs: Object.freeze(paragraphs),
    runs: Object.freeze(runs),
    paragraphById,
    runById
  }

  function visitBlocks(blocks: readonly import('./types').Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        const firstRunOrder = runOrder
        const currentParagraphOrder = paragraphOrder++
        const paragraphRunTargets: SelectedRunTarget[] = []

        for (const run of block.runs) {
          const runTarget: SelectedRunTarget = {
            run,
            paragraphId: block.id,
            order: runOrder++,
            paragraphOrder: currentParagraphOrder,
            graphemeLength: countGraphemes(readRunText(run)),
            selectedStartGraphemeIndex: 0,
            selectedEndGraphemeIndex: 0
          }

          paragraphRunTargets.push(runTarget)
        }

        const paragraphTarget = createSelectedParagraphTarget(block, currentParagraphOrder, firstRunOrder)

        paragraphs.push(paragraphTarget)
        paragraphById.set(block.id, paragraphTarget)
        for (const runTarget of paragraphRunTargets) {
          runs.push(runTarget)
          runById.set(runTarget.run.id, runTarget)
        }

        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          visitBlocks(cell.blocks)
        }
      }
    }
  }
}

function resolveSelectionEndpoint(
  index: ProjectionIndex,
  anchor: import('./position').AnchorRef
): ResolvedSelectionEndpoint | undefined {
  const snapshot = readAnchorRefSnapshot(anchor)
  const paragraph = index.paragraphById.get(String(snapshot.blockId))
  const run = index.runById.get(String(snapshot.runId))

  if (paragraph === undefined || run === undefined || run.paragraphId !== paragraph.paragraph.id) {
    return undefined
  }

  return {
    paragraph,
    run,
    graphemeIndex: Number(snapshot.graphemeIndex)
  }
}

function compareEndpoints(
  left: ResolvedSelectionEndpoint,
  right: ResolvedSelectionEndpoint
): number {
  return comparePositions(
    {
      paragraphOrder: left.paragraph.order,
      runOrder: left.run.order,
      graphemeIndex: left.graphemeIndex
    },
    {
      paragraphOrder: right.paragraph.order,
      runOrder: right.run.order,
      graphemeIndex: right.graphemeIndex
    }
  )
}

function overlapsSelection(
  run: SelectedRunTarget,
  start: ResolvedSelectionEndpoint,
  end: ResolvedSelectionEndpoint
): boolean {
  const runStart: ComparablePosition = {
    paragraphOrder: run.paragraphOrder,
    runOrder: run.order,
    graphemeIndex: 0
  }
  const runEnd: ComparablePosition = {
    paragraphOrder: run.paragraphOrder,
    runOrder: run.order,
    graphemeIndex: run.graphemeLength
  }
  const selectionStart: ComparablePosition = {
    paragraphOrder: start.paragraph.order,
    runOrder: start.run.order,
    graphemeIndex: start.graphemeIndex
  }
  const selectionEnd: ComparablePosition = {
    paragraphOrder: end.paragraph.order,
    runOrder: end.run.order,
    graphemeIndex: end.graphemeIndex
  }

  return comparePositions(runEnd, selectionStart) > 0 && comparePositions(runStart, selectionEnd) < 0
}

function overlapsParagraphSelection(
  paragraph: SelectedParagraphTarget,
  start: ResolvedSelectionEndpoint,
  end: ResolvedSelectionEndpoint
): boolean {
  const paragraphStart: ComparablePosition = {
    paragraphOrder: paragraph.order,
    runOrder: paragraph.firstRunOrder,
    graphemeIndex: 0
  }
  const paragraphEnd: ComparablePosition = {
    paragraphOrder: paragraph.order,
    runOrder: paragraph.lastRunOrder,
    graphemeIndex: paragraph.lastRunGraphemeLength
  }
  const selectionStart: ComparablePosition = {
    paragraphOrder: start.paragraph.order,
    runOrder: start.run.order,
    graphemeIndex: start.graphemeIndex
  }
  const selectionEnd: ComparablePosition = {
    paragraphOrder: end.paragraph.order,
    runOrder: end.run.order,
    graphemeIndex: end.graphemeIndex
  }

  return comparePositions(paragraphEnd, selectionStart) > 0
    && comparePositions(paragraphStart, selectionEnd) < 0
}

function comparePositions(left: ComparablePosition, right: ComparablePosition): number {
  if (left.paragraphOrder !== right.paragraphOrder) {
    return left.paragraphOrder - right.paragraphOrder
  }

  if (left.runOrder !== right.runOrder) {
    return left.runOrder - right.runOrder
  }

  return left.graphemeIndex - right.graphemeIndex
}

/** 创建不可变段落目标，避免发布后再修改 readonly 字段。 */
function createSelectedParagraphTarget(
  paragraph: Paragraph,
  order: number,
  firstRunOrder: number
): SelectedParagraphTarget {
  const lastRun = paragraph.runs[paragraph.runs.length - 1]

  return {
    paragraph,
    order,
    firstRunOrder,
    lastRunOrder: lastRun === undefined ? firstRunOrder : firstRunOrder + paragraph.runs.length - 1,
    lastRunGraphemeLength: lastRun === undefined ? 0 : countGraphemes(readRunText(lastRun))
  }
}

function readRunText(run: Run): string {
  return run.inlines
    .flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
    .join('')
}
