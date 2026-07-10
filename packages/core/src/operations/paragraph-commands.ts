/**
 * 职责：构造 Gate 3 段落属性与段落级 run 样式命令。
 * 边界：只生成 setParagraphProperties 与 setRunProperties 操作，不执行事务。
 * 协作模块：toolbar、快捷键和 editor facade 通过 command-builders 聚合入口复用。
 * 性能/安全约束：只读取当前选区覆盖的段落，避免无变化 operation。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { ParagraphAlignment } from '../model/formatting-types'
import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { ModelProperties, ParagraphList } from '../model/types'
import type { Command, Operation } from './transaction'
import { isPropertySetEquivalent } from './command-builder-utils'

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

/**
 * 构造段落样式命令。
 */
export function buildSetParagraphStyleCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: string
): Command | null {
  return buildParagraphFormattingCommand(projection, selection, 'setParagraphStyle', { styleId: value })
}

/**
 * 构造段落列表命令。
 */
export function buildSetParagraphListCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: ParagraphList | null
): Command | null {
  return buildParagraphFormattingCommand(
    projection,
    selection,
    'setParagraphList',
    value === null
      ? {
          listNumberingId: null,
          listLevel: null
        }
      : {
          listNumberingId: value.numberingId,
          listLevel: value.level
        }
  )
}

/**
 * 构造段落行距命令。
 */
export function buildSetParagraphLineHeightCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphRunFormattingCommand(
    projection,
    selection,
    'setParagraphLineHeight',
    { lineHeight: value }
  )
}

/**
 * 构造段前距命令。
 */
export function buildSetParagraphSpacingBeforeCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphFormattingCommand(
    projection,
    selection,
    'setParagraphSpacingBefore',
    { spacingBeforeTwips: value }
  )
}

/**
 * 构造段后距命令。
 */
export function buildSetParagraphSpacingAfterCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphFormattingCommand(
    projection,
    selection,
    'setParagraphSpacingAfter',
    { spacingAfterTwips: value }
  )
}

/**
 * 构造首行缩进命令。
 */
export function buildSetParagraphFirstLineIndentCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphFormattingCommand(
    projection,
    selection,
    'setParagraphFirstLineIndent',
    { firstLineIndentTwips: value }
  )
}

/**
 * 构造悬挂缩进命令。
 */
export function buildSetParagraphHangingIndentCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  value: number
): Command | null {
  return buildParagraphFormattingCommand(
    projection,
    selection,
    'setParagraphHangingIndent',
    { hangingIndentTwips: value }
  )
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

/**
 * 构造段落级 run 样式命令。
 */
function buildParagraphRunFormattingCommand(
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
    target.paragraph.runs.flatMap((run) =>
      isPropertySetEquivalent(run.properties, properties)
        ? []
        : [{
            kind: 'setRunProperties',
            runId: run.id,
            properties
          }]
    )
  )

  if (operations.length === 0) {
    return null
  }

  return {
    name,
    operations
  }
}
