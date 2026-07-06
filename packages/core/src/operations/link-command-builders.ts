/**
 * 职责：构造 Gate 4 超链接的最小核心命令。
 * 边界：只生成命令和操作，不执行事务、不改投影，也不处理宿主打开行为。
 * 协作模块：选区目标、链接策略、事务流水线与投影共同提供链接闭环。
 * 性能/安全约束：builder 只遍历当前选区命中的 run，并复用现有 split-run 事务语义。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-3---批注与超链接step-48-410。
 */

import { isAllowedLinkUrl } from '../link/policy'
import { collectSelectionTargets } from '../model/selection-targets'
import { readAnchorRefSnapshot } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import type { Block, Run, RunLink, Section } from '../model/types'
import type { Command, Operation, TextPosition } from './transaction'
import { countGraphemes } from '../shared/grapheme'

export interface SetLinkInput {
  readonly target: string
  readonly tooltip?: string
}

export interface InsertLinkInput extends SetLinkInput {
  readonly displayText?: string
}

/**
 * 对选中文本设置链接。
 */
export function buildSetLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: SetLinkInput
): Command | null {
  if (selection === null || isSelectionCollapsed(selection)) {
    return null
  }

  return buildRunLinkCommand(projection, selection, 'setLink', createRunLink(input), false)
}

/**
 * 编辑当前链接元数据。
 */
export function buildEditLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: SetLinkInput
): Command | null {
  return buildRunLinkCommand(projection, selection, 'editLink', createRunLink(input), true)
}

/**
 * 删除当前链接元数据。
 */
export function buildDeleteLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null
): Command | null {
  return buildRunLinkCommand(projection, selection, 'deleteLink', null, true)
}

/**
 * 在折叠选区插入 displayText 并设置链接；若是范围选区则退化为对选中文本设链接。
 */
export function buildInsertLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: InsertLinkInput
): Command | null {
  const link = createRunLink(input)

  if (link === null || selection === null) {
    return null
  }

  if (!isSelectionCollapsed(selection)) {
    return buildRunLinkCommand(projection, selection, 'insertLink', link, false)
  }

  if (input.displayText === undefined || input.displayText.length === 0) {
    return null
  }

  const insertion = resolveCollapsedInsertion(projection, selection)

  if (insertion === null) {
    return null
  }

  const usedRunIds = collectRunIds(projection)
  const displayTextLength = countGraphemes(input.displayText)

  return {
    name: 'insertLink',
    operations: [{
      kind: 'insertText',
      at: insertion.at,
      text: input.displayText
    }, {
      kind: 'setRunLink',
      runId: insertion.run.id,
      link,
      range: {
        startGraphemeIndex: insertion.at.graphemeIndex,
        endGraphemeIndex: insertion.at.graphemeIndex + displayTextLength,
        ...(insertion.at.graphemeIndex > 0
          ? { linkedRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'link') }
          : {}),
        ...(insertion.at.graphemeIndex < insertion.graphemeLength
          ? { trailingRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'tail') }
          : {})
      }
    }]
  }
}

/**
 * 基于选区构造 run 级链接命令。
 */
function buildRunLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  name: string,
  link: RunLink | null,
  allowCollapsedSelection: boolean
): Command | null {
  if (selection === null) {
    return null
  }

  if (!allowCollapsedSelection && isSelectionCollapsed(selection)) {
    return null
  }

  const targets = collectSelectionTargets(projection, selection)
  const usedRunIds = collectRunIds(projection)

  if (targets.runs.length === 0) {
    return null
  }

  const operations: Operation[] = targets.runs.flatMap((target) => {
    if (areLinksEquivalent(target.run.link, link)) {
      return []
    }

    const isWholeRunSelection =
      target.selectedStartGraphemeIndex === 0
      && target.selectedEndGraphemeIndex === target.graphemeLength

    if (isWholeRunSelection) {
      return [{
        kind: 'setRunLink',
        runId: target.run.id,
        link
      }]
    }

    return [{
      kind: 'setRunLink',
      runId: target.run.id,
      link,
      range: {
        startGraphemeIndex: target.selectedStartGraphemeIndex,
        endGraphemeIndex: target.selectedEndGraphemeIndex,
        ...(target.selectedStartGraphemeIndex > 0
          ? { linkedRunId: allocateGeneratedRunId(usedRunIds, target.run.id, 'link') }
          : {}),
        ...(target.selectedEndGraphemeIndex < target.graphemeLength
          ? { trailingRunId: allocateGeneratedRunId(usedRunIds, target.run.id, 'tail') }
          : {})
      }
    }]
  })

  if (operations.length === 0) {
    return null
  }

  return {
    name,
    operations
  }
}

/**
 * 归一化链接输入；不在 allowlist 内时返回 null。
 */
function createRunLink(input: SetLinkInput): RunLink | null {
  if (!isAllowedLinkUrl(input.target)) {
    return null
  }

  const tooltip = input.tooltip?.trim()

  return tooltip === undefined || tooltip.length === 0
    ? { target: input.target }
    : { target: input.target, tooltip }
}

/**
 * 解析折叠选区的插入上下文。
 */
function resolveCollapsedInsertion(
  projection: DocumentProjection,
  selection: SelectionState
): Readonly<{
  at: TextPosition
  run: Run
  graphemeLength: number
}> | null {
  const snapshot = readAnchorRefSnapshot(selection.focus)
  const matched = findRunByIds(
    projection.document.sections,
    String(snapshot.blockId),
    String(snapshot.runId)
  )

  if (matched === null) {
    return null
  }

  return {
    at: {
      sectionId: matched.sectionId,
      blockId: matched.blockId,
      runId: matched.run.id,
      graphemeIndex: Number(snapshot.graphemeIndex),
      ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc })
    },
    run: matched.run,
    graphemeLength: countGraphemes(readRunText(matched.run))
  }
}

/**
 * 收集 projection 内所有 run ID。
 */
function collectRunIds(projection: DocumentProjection): Set<string> {
  const runIds = new Set<string>()

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return runIds

  function visitBlocks(blocks: readonly Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const run of block.runs) {
          runIds.add(run.id)
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

/**
 * 在 projection 中按 block/run ID 查找 run。
 */
function findRunByIds(
  sections: readonly Section[],
  blockId: string,
  runId: string
): Readonly<{
  sectionId: string
  blockId: string
  run: Run
}> | null {
  for (const section of sections) {
    const matched = findRunInBlocks(section.id, section.blocks, blockId, runId)

    if (matched !== null) {
      return matched
    }
  }

  return null
}

/**
 * 在块树里递归查找目标 run。
 */
function findRunInBlocks(
  sectionId: string,
  blocks: readonly Block[],
  blockId: string,
  runId: string
): Readonly<{
  sectionId: string
  blockId: string
  run: Run
}> | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      if (block.id !== blockId) {
        continue
      }

      const run = block.runs.find((candidate) => candidate.id === runId)

      return run === undefined
        ? null
        : {
            sectionId,
            blockId,
            run
          }
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        const nested = findRunInBlocks(sectionId, cell.blocks, blockId, runId)

        if (nested !== null) {
          return nested
        }
      }
    }
  }

  return null
}

/**
 * 读取 run 中的纯文本内容。
 */
function readRunText(run: Run): string {
  return run.inlines
    .flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
    .join('')
}

/**
 * 判断两个链接快照是否等价。
 */
function areLinksEquivalent(current: RunLink | undefined, next: RunLink | null): boolean {
  if (next === null) {
    return current === undefined
  }

  return current?.target === next.target && current?.tooltip === next.tooltip
}

/**
 * 分配当前 projection 内唯一的 run ID。
 */
function allocateGeneratedRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'link' | 'tail'
): string {
  let sequence = 1
  let candidate = `${runId}__${suffix}-${sequence}`

  while (usedRunIds.has(candidate)) {
    sequence += 1
    candidate = `${runId}__${suffix}-${sequence}`
  }

  usedRunIds.add(candidate)

  return candidate
}
