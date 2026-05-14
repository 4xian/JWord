/**
 * 职责：基于 Gate 1/2 的 projection 和 selection 构造 Gate 3 基础 formatting commands。
 * 边界：只生成 Command/Operation，不执行 transaction、不写 Projection、不接触 editor runtime。
 * 协作模块：toolbar、快捷键和后续输入系统可复用这些 builder，再交给 Editor facade 执行。
 * 性能/安全约束：命令构造只读取当前选区覆盖到的 run/paragraph，保持最小 operation 集。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-37实现基础-commands加粗斜体下划线删除线字体字号颜色背景色对齐缩进。
 */

import { collectSelectionTargets } from './selection-targets'
import {
  areFormattingPropertyValuesEquivalent
} from './formatting-types'
import type { ParagraphAlignment } from './formatting-types'
import type { ModelProperties } from './model'
import type { DocumentProjection } from './projection'
import type { SelectionState } from './selection'
import type { Command, Operation } from './transaction'

/**
 * 构造加粗命令。
 */
export function buildSetBoldCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setBold', { bold: value })
}

/**
 * 构造斜体命令。
 */
export function buildSetItalicCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setItalic', { italic: value })
}

/**
 * 构造下划线命令。
 */
export function buildSetUnderlineCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setUnderline', { underline: value })
}

/**
 * 构造删除线命令。
 */
export function buildSetStrikeCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setStrike', { strike: value })
}

/**
 * 构造字体命令。
 */
export function buildSetFontFamilyCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: string
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setFontFamily', { fontFamily: value })
}

/**
 * 构造字号命令。
 */
export function buildSetFontSizeCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setFontSize', { fontSizeTwips: value })
}

/**
 * 构造字体颜色命令。
 */
export function buildSetTextColorCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: string
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setTextColor', { color: value })
}

/**
 * 构造背景色命令。
 */
export function buildSetBackgroundColorCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: string
): Command | null {
  return buildRunFormattingCommand(projection, selection, 'setBackgroundColor', { backgroundColor: value })
}

/**
 * 构造段落对齐命令。
 */
export function buildSetParagraphAlignmentCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: ParagraphAlignment
): Command | null {
  return buildParagraphFormattingCommand(projection, selection, 'setParagraphAlignment', { alignment: value })
}

/**
 * 构造段落左缩进命令。
 */
export function buildSetParagraphIndentCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphFormattingCommand(projection, selection, 'setParagraphIndent', { indentLeftTwips: value })
}

function buildRunFormattingCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  name: string,
  properties: ModelProperties
): Command | null {
  const targets = collectSelectionTargets(projection, selection)
  const usedRunIds = collectRunIds(projection)

  if (targets.runs.length === 0) {
    return null
  }

  const operations: Operation[] = targets.runs.flatMap((target) => {
    if (isPropertySetEquivalent(target.run.properties, properties)) {
      return []
    }

    const isWholeRunSelection =
      target.selectedStartGraphemeIndex === 0
      && target.selectedEndGraphemeIndex === target.graphemeLength

    if (isWholeRunSelection) {
      return [{
        kind: 'setRunProperties',
        runId: target.run.id,
        properties
      }]
    }

    return [{
      kind: 'setRunProperties',
      runId: target.run.id,
      properties,
      range: {
        startGraphemeIndex: target.selectedStartGraphemeIndex,
        endGraphemeIndex: target.selectedEndGraphemeIndex,
        ...(target.selectedStartGraphemeIndex > 0
          ? { formattedRunId: allocateGeneratedRunId(usedRunIds, target.run.id, 'format') }
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

function buildParagraphFormattingCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  name: string,
  properties: ModelProperties
): Command | null {
  const targets = collectSelectionTargets(projection, selection)

  if (targets.paragraphs.length === 0) {
    return null
  }

  const operations: Operation[] = targets.paragraphs.flatMap((target) =>
    isPropertySetEquivalent(target.paragraph.properties, properties)
      ? []
      : [{
          kind: 'setParagraphProperties',
          paragraphId: target.paragraph.id,
          properties
        }]
  )

  if (operations.length === 0) {
    return null
  }

  return {
    name,
    operations
  }
}

function isPropertySetEquivalent(
  currentProperties: ModelProperties | undefined,
  nextProperties: ModelProperties
): boolean {
  return Object.entries(nextProperties).every(([key, value]) =>
    areFormattingPropertyValuesEquivalent(key, currentProperties?.[key], value)
  )
}

function collectRunIds(projection: DocumentProjection): Set<string> {
  const runIds = new Set<string>()

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return runIds

  function visitBlocks(blocks: readonly import('./model').Block[]) {
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

function allocateGeneratedRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'format' | 'tail'
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
