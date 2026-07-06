/**
 * 职责：构造 Gate 3 run 级文本格式命令。
 * 边界：只生成 setRunProperties 操作，不执行事务、不写 Projection。
 * 协作模块：toolbar、快捷键和 editor facade 通过 command-builders 聚合入口复用。
 * 性能/安全约束：只读取当前选区命中的 run，并按局部选区复用 split-run 事务语义。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-37实现基础-commands加粗斜体下划线删除线字体字号颜色背景色对齐缩进。
 */

import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { ModelProperties } from '../model/types'
import type { Command, Operation } from './transaction'
import {
  allocateGeneratedRunId,
  collectRunIds,
  isPropertySetEquivalent
} from './command-builder-utils'

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
 * 构造上标命令。
 */
export function buildSetSuperscriptCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(
    projection,
    selection,
    'setSuperscript',
    value
      ? { superscript: true, subscript: false }
      : { superscript: false }
  )
}

/**
 * 构造下标命令。
 */
export function buildSetSubscriptCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: boolean
): Command | null {
  return buildRunFormattingCommand(
    projection,
    selection,
    'setSubscript',
    value
      ? { superscript: false, subscript: true }
      : { subscript: false }
  )
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
