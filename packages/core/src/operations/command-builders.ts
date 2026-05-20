/**
 * 职责：基于 Gate 1/2 的 projection 和 selection 构造 Gate 3 基础 formatting commands。
 * 边界：只生成 Command/Operation，不执行 transaction、不写 Projection、不接触 editor runtime。
 * 协作模块：toolbar、快捷键和后续输入系统可复用这些 builder，再交给 Editor facade 执行。
 * 性能/安全约束：命令构造只读取当前选区覆盖到的 run/paragraph，保持最小 operation 集。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-37实现基础-commands加粗斜体下划线删除线字体字号颜色背景色对齐缩进。
 */

import { collectSelectionTargets } from '../model/selection-targets'
import { resolveSelectedImageTarget } from '../model/image-target'
import {
  areFormattingPropertyValuesEquivalent
} from '../model/formatting-types'
import type { ParagraphAlignment } from '../model/formatting-types'
import type { ParagraphList, Table, TableBorder } from '../model/types'
import { readAnchorRefSnapshot } from '../model/position'
import type { ModelProperties, Paragraph, Run } from '../model/types'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Command, Operation, TextPosition } from './transaction'
import { isAllowedResourceUrl } from '../resources/types'
import type { Resource, ResourceUrlPolicy } from '../resources/types'
import { countGraphemes } from '../shared/grapheme'
import { createJWordError } from '../shared/errors'

let tableCommandSequence = 0

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

/**
 * 构造资源写入命令。
 */
export function buildUpsertResourceCommand(resource: Resource): Command {
  return buildUpsertResourceCommandWithPolicy(resource)
}

export function buildUpsertResourceCommandWithPolicy(
  resource: Resource,
  policy?: ResourceUrlPolicy
): Command {
  if (!isAllowedResourceUrl(resource.source.url, policy)) {
    throw createJWordError('OPERATION_RESOURCE_URL_DISALLOWED', '资源 URL 不在 allowlist 内', {
      resourceId: resource.id,
      url: resource.source.url
    })
  }

  return {
    name: 'upsertResource',
    operations: [{
      kind: 'upsertResource',
      resource
    }]
  }
}

/**
 * 构造资源删除命令。
 */
export function buildDeleteResourceCommand(resourceId: string): Command {
  return {
    name: 'deleteResource',
    operations: [{
      kind: 'deleteResource',
      resourceId
    }]
  }
}

/**
 * 构造行内图片插入命令。
 */
export function buildInsertInlineImageCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  resource: Resource,
  input: Readonly<{
    alt?: string
    widthTwips?: number
    heightTwips?: number
  }> = {}
): Command | null {
  const insertion = resolveSelectionInsertionContext(projection, selection)

  if (insertion === null) {
    return null
  }

  const usedRunIds = collectRunIds(projection)
  const needsTrailingRun = shouldCreateInlineImageTrailingRun(projection, insertion)

  return {
    name: 'insertInlineImage',
    operations: [{
      kind: 'upsertResource',
      resource
    }, {
      kind: 'insertImage',
      at: insertion.at,
      imageRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'image'),
      ...(needsTrailingRun
        ? { trailingRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'tail') }
        : {}),
      mode: 'inline',
      image: {
        kind: 'image',
        resourceId: resource.id,
        display: 'inline',
        ...(input.alt === undefined ? {} : { alt: input.alt }),
        ...(input.widthTwips === undefined ? {} : { widthTwips: input.widthTwips }),
        ...(input.heightTwips === undefined ? {} : { heightTwips: input.heightTwips })
      }
    }]
  }
}

/**
 * 构造当前选中图片的资源替换命令。
 */
export function buildReplaceSelectedImageResourceCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  resource: Resource
): Command | null {
  const target = resolveSelectedImageTarget(projection, selection)

  if (target === null) {
    return null
  }

  const operations: Operation[] = [{
    kind: 'upsertResource',
    resource
  }, {
    kind: 'replaceImageResource',
    runId: target.runId,
    resourceId: resource.id
  }]

  if (
    target.resource !== undefined
    && target.resource.id !== resource.id
    && countImageResourceReferences(projection, target.resource.id) <= 1
  ) {
    operations.push({
      kind: 'deleteResource',
      resourceId: target.resource.id
    })
  }

  return {
    name: 'replaceImageResource',
    operations
  }
}

/**
 * 构造当前选中图片的删除命令。
 */
export function buildDeleteSelectedImageCommand(
  projection: DocumentProjection,
  selection: SelectionState | null
): Command | null {
  const target = resolveSelectedImageTarget(projection, selection)

  if (target === null) {
    return null
  }

  const operations: Operation[] = [{
    kind: 'deleteImage',
    runId: target.runId
  }]

  if (target.resource !== undefined && countImageResourceReferences(projection, target.resource.id) <= 1) {
    operations.push({
      kind: 'deleteResource',
      resourceId: target.resource.id
    })
  }

  return {
    name: 'deleteImage',
    operations
  }
}

/**
 * 构造当前选中图片的尺寸调整命令。
 */
export function buildResizeSelectedImageCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: Readonly<{
    widthTwips: number
    heightTwips: number
  }>
): Command | null {
  const target = resolveSelectedImageTarget(projection, selection)

  if (target === null) {
    return null
  }

  if (
    target.image.widthTwips === input.widthTwips
    && target.image.heightTwips === input.heightTwips
  ) {
    return null
  }

  return {
    name: 'resizeImage',
    operations: [{
      kind: 'resizeImage',
      runId: target.runId,
      widthTwips: input.widthTwips,
      heightTwips: input.heightTwips
    }]
  }
}

/**
 * 构造当前选中图片的旋转角度更新命令。
 */
export function buildSetSelectedImageRotationCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  rotationDegrees: number
): Command | null {
  const target = resolveSelectedImageTarget(projection, selection)

  if (target === null) {
    return null
  }

  const normalizedRotationDegrees = normalizeImageRotationDegrees(rotationDegrees)
  const currentRotationDegrees = normalizeImageRotationDegrees(target.image.rotationDegrees ?? 0)

  if (currentRotationDegrees === normalizedRotationDegrees) {
    return null
  }

  return {
    name: 'setImageRotation',
    operations: [{
      kind: 'setImageRotation',
      runId: target.runId,
      rotationDegrees: normalizedRotationDegrees
    }]
  }
}

/**
 * 构造当前选中图片的移动命令。
 */
export function buildMoveSelectedImageCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  dropSelection: SelectionState | null
): Command | null {
  const target = resolveSelectedImageTarget(projection, selection)
  const insertion = resolveSelectionInsertionContext(projection, dropSelection)

  if (target === null || insertion === null) {
    return null
  }

  const usedRunIds = collectRunIds(projection)
  const needsTrailingRun = shouldCreateInlineImageTrailingRun(projection, insertion)

  return {
    name: 'moveImage',
    operations: [{
      kind: 'insertImage',
      at: insertion.at,
      imageRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'image'),
      ...(needsTrailingRun
        ? { trailingRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'tail') }
        : {}),
      mode: 'inline',
      image: {
        ...target.image,
        ...(target.image.display === undefined ? { display: 'inline' } : {})
      }
    }, {
      kind: 'deleteImage',
      runId: target.runId
    }]
  }
}

/** 构造插入简单表格命令。 */
export function buildInsertTableCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: Readonly<{
    rows: number
    columns: number
  }>
): Command | null {
  const section = projection.document.sections[0]

  if (section === undefined) {
    return null
  }

  const insertion = resolveSelectionInsertionContext(projection, selection)
  const sectionId = insertion?.at.sectionId ?? section.id
  const usedIds = collectModelIds(projection)
  const tableId = allocateGeneratedModelId(usedIds, 'table')

  return {
    name: 'insertTable',
    operations: [{
      kind: 'insertTable',
      sectionId,
      placement: insertion === null
        ? { kind: 'append' }
        : { kind: 'after', blockId: insertion.blockId },
      table: createSimpleTableModel(tableId, Math.max(1, input.rows), Math.max(1, input.columns), usedIds)
    }]
  }
}

/** 构造插入表格行命令。 */
export function buildInsertTableRowCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  const usedIds = collectModelIds(projection)
  const columnCount = resolveTableColumnCount(table)

  return {
    name: 'insertTableRow',
    operations: [{
      kind: 'insertTableRow',
      tableId,
      rowIndex,
      rowId: allocateGeneratedModelId(usedIds, `${tableId}-row`),
      cellIds: createGeneratedIdList(usedIds, `${tableId}-cell`, columnCount),
      paragraphIds: createGeneratedIdList(usedIds, `${tableId}-paragraph`, columnCount),
      runIds: createGeneratedIdList(usedIds, `${tableId}-run`, columnCount)
    }]
  }
}

/** 构造删除表格行命令。 */
export function buildDeleteTableRowCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null || table.rows.length <= 1) {
    return null
  }

  return {
    name: 'deleteTableRow',
    operations: [{
      kind: 'deleteTableRow',
      tableId,
      rowIndex
    }]
  }
}

/** 构造插入表格列命令。 */
export function buildInsertTableColumnCommand(
  projection: DocumentProjection,
  tableId: string,
  columnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  const usedIds = collectModelIds(projection)

  return {
    name: 'insertTableColumn',
    operations: [{
      kind: 'insertTableColumn',
      tableId,
      columnIndex,
      columnWidthTwips: table.grid?.[Math.max(0, Math.min(columnIndex, (table.grid?.length ?? 1) - 1))] ?? 2400,
      cellIds: createGeneratedIdList(usedIds, `${tableId}-cell`, table.rows.length),
      paragraphIds: createGeneratedIdList(usedIds, `${tableId}-paragraph`, table.rows.length),
      runIds: createGeneratedIdList(usedIds, `${tableId}-run`, table.rows.length)
    }]
  }
}

/** 构造删除表格列命令。 */
export function buildDeleteTableColumnCommand(
  projection: DocumentProjection,
  tableId: string,
  columnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)

  if (table === null || resolveTableColumnCount(table) <= 1) {
    return null
  }

  return {
    name: 'deleteTableColumn',
    operations: [{
      kind: 'deleteTableColumn',
      tableId,
      columnIndex
    }]
  }
}

/** 构造合并同一行连续单元格命令。 */
export function buildMergeTableCellsCommand(
  projection: DocumentProjection,
  tableId: string,
  rowIndex: number,
  startColumnIndex: number,
  endColumnIndex: number
): Command | null {
  const table = findTableById(projection, tableId)
  const row = table?.rows[rowIndex]

  if (table === null || row === undefined || endColumnIndex <= startColumnIndex) {
    return null
  }

  return {
    name: 'mergeTableCells',
    operations: [{
      kind: 'mergeTableCells',
      tableId,
      rowIndex,
      startColumnIndex,
      endColumnIndex
    }]
  }
}

/** 构造表格边框命令。 */
export function buildSetTableBorderCommand(
  projection: DocumentProjection,
  tableId: string,
  border: TableBorder,
  cellId?: string
): Command | null {
  if (findTableById(projection, tableId) === null) {
    return null
  }

  return {
    name: 'setTableBorder',
    operations: [{
      kind: 'setTableBorder',
      tableId,
      ...(cellId === undefined ? {} : { cellId }),
      border
    }]
  }
}

/** 构造单元格文本替换命令。 */
export function buildSetTableCellTextCommand(
  projection: DocumentProjection,
  tableId: string,
  cellId: string,
  text: string
): Command | null {
  if (findTableCellById(projection, tableId, cellId) === null) {
    return null
  }

  return {
    name: 'setTableCellText',
    operations: [{
      kind: 'setTableCellText',
      tableId,
      cellId,
      text
    }]
  }
}

/** 构造单元格边框命令。 */
export function buildSetTableCellBorderCommand(
  projection: DocumentProjection,
  tableId: string,
  cellId: string,
  border: TableBorder
): Command | null {
  const command = buildSetTableBorderCommand(projection, tableId, border, cellId)

  return command === null
    ? null
    : {
        name: 'setTableCellBorder',
        operations: command.operations
      }
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

/** 统一把图片角度约束到 0-359。 */
function normalizeImageRotationDegrees(rotationDegrees: number): number {
  const normalized = Math.round(rotationDegrees) % 360

  return normalized < 0 ? normalized + 360 : normalized
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

  function visitBlocks(blocks: readonly import('../model/types').Block[]) {
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

function countImageResourceReferences(projection: DocumentProjection, resourceId: string): number {
  let count = 0

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return count

  function visitBlocks(blocks: readonly import('../model/types').Block[]) {
    for (const block of blocks) {
      if (block.kind === 'paragraph') {
        for (const run of block.runs) {
          for (const inline of run.inlines) {
            if (inline.kind === 'image' && inline.resourceId === resourceId) {
              count += 1
            }
          }
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
  suffix: 'format' | 'tail' | 'image'
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

function resolveSelectionInsertionContext(
  projection: DocumentProjection,
  selection: SelectionState | null
): Readonly<{
  at: TextPosition
  run: Run
  blockId: string
  graphemeLength: number
}> | null {
  if (selection === null) {
    return null
  }

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
    blockId: matched.blockId,
    graphemeLength: countGraphemes(readRunText(matched.run))
  }
}

/**
 * 图片后面如果没有现成文本 run，需要补一个空尾 run，保证尾侧可以落 caret 并继续输入。
 */
function shouldCreateInlineImageTrailingRun(
  projection: DocumentProjection,
  insertion: Readonly<{
    at: TextPosition
    run: Run
    blockId: string
    graphemeLength: number
  }>
): boolean {
  if (insertion.at.graphemeIndex > 0 && insertion.at.graphemeIndex < insertion.graphemeLength) {
    return true
  }

  if (insertion.at.graphemeIndex !== insertion.graphemeLength) {
    return false
  }

  const paragraph = findParagraphById(projection.document.sections, insertion.blockId)

  if (paragraph === null) {
    return true
  }

  const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === insertion.run.id)

  if (runIndex < 0) {
    return true
  }

  return !runContainsTextInline(paragraph.runs[runIndex + 1])
}

function findRunByIds(
  sections: readonly import('../model/types').Section[],
  blockId: string,
  runId: string
): Readonly<{
  sectionId: string
  blockId: string
  run: Run
}> | null {
  for (const section of sections) {
    const run = visitBlocks(section.blocks)

    if (run !== null) {
      return {
        sectionId: section.id,
        blockId,
        run
      }
    }
  }

  return null

  function visitBlocks(blocks: readonly import('../model/types').Block[]): Run | null {
    for (const block of blocks) {
      if (block.kind === 'paragraph' && block.id === blockId) {
        return block.runs.find((candidate) => candidate.id === runId) ?? null
      }

      if (block.kind === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            const nested = visitBlocks(cell.blocks)

            if (nested !== null) {
              return nested
            }
          }
        }
      }
    }

    return null
  }
}

function findParagraphById(
  sections: readonly import('../model/types').Section[],
  blockId: string
): Paragraph | null {
  for (const section of sections) {
    const paragraph = visitBlocks(section.blocks)

    if (paragraph !== null) {
      return paragraph
    }
  }

  return null

  function visitBlocks(blocks: readonly import('../model/types').Block[]): Paragraph | null {
    for (const block of blocks) {
      if (block.kind === 'paragraph' && block.id === blockId) {
        return block
      }

      if (block.kind === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            const nested = visitBlocks(cell.blocks)

            if (nested !== null) {
              return nested
            }
          }
        }
      }
    }

    return null
  }
}

function runContainsTextInline(run: Run | undefined): boolean {
  return run?.inlines.some((inline) => inline.kind === 'text') ?? false
}

function readRunText(run: Run): string {
  return run.inlines
    .filter((inline): inline is Extract<Run['inlines'][number], { kind: 'text' }> => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
}

/** 创建最小简单表格模型。 */
function createSimpleTableModel(
  tableId: string,
  rows: number,
  columns: number,
  usedIds: Set<string>
): Table {
  return {
    kind: 'table',
    id: tableId,
    grid: Array.from({ length: columns }, () => 2400),
    border: {
      color: '#6b7280',
      widthTwips: 15
    },
    rows: Array.from({ length: rows }, () => {
      const rowId = allocateGeneratedModelId(usedIds, `${tableId}-row`)

      return {
        id: rowId,
        cells: Array.from({ length: columns }, () => {
          const cellId = allocateGeneratedModelId(usedIds, `${tableId}-cell`)
          const paragraphId = allocateGeneratedModelId(usedIds, `${tableId}-paragraph`)
          const runId = allocateGeneratedModelId(usedIds, `${tableId}-run`)

          return {
            id: cellId,
            blocks: [{
              kind: 'paragraph',
              id: paragraphId,
              runs: [{
                kind: 'run',
                id: runId,
                inlines: [{
                  kind: 'text',
                  text: ''
                }]
              }]
            }]
          }
        })
      }
    })
  }
}

/** 收集模型内所有常用 ID，避免 command builder 生成重复 ID。 */
function collectModelIds(projection: DocumentProjection): Set<string> {
  const ids = collectRunIds(projection)

  for (const section of projection.document.sections) {
    ids.add(section.id)
    visitBlocks(section.blocks)
  }

  return ids

  /** 递归收集块、表格行、单元格 ID。 */
  function visitBlocks(blocks: readonly import('../model/types').Block[]): void {
    for (const block of blocks) {
      ids.add(block.id)

      if (block.kind === 'paragraph') {
        continue
      }

      for (const row of block.rows) {
        ids.add(row.id)
        for (const cell of row.cells) {
          ids.add(cell.id)
          visitBlocks(cell.blocks)
        }
      }
    }
  }
}

/** 分配模型节点 ID。 */
function allocateGeneratedModelId(usedIds: Set<string>, prefix: string): string {
  tableCommandSequence += 1

  let candidate = `${prefix}-${tableCommandSequence}`

  while (usedIds.has(candidate)) {
    tableCommandSequence += 1
    candidate = `${prefix}-${tableCommandSequence}`
  }

  usedIds.add(candidate)

  return candidate
}

/** 批量生成模型 ID。 */
function createGeneratedIdList(usedIds: Set<string>, prefix: string, count: number): readonly string[] {
  return Array.from({ length: count }, () => allocateGeneratedModelId(usedIds, prefix))
}

/** 根据 ID 查找表格。 */
function findTableById(projection: DocumentProjection, tableId: string): Table | null {
  for (const section of projection.document.sections) {
    const table = visitBlocks(section.blocks)

    if (table !== null) {
      return table
    }
  }

  return null

  /** 递归查找表格。 */
  function visitBlocks(blocks: readonly import('../model/types').Block[]): Table | null {
    for (const block of blocks) {
      if (block.kind === 'table' && block.id === tableId) {
        return block
      }

      if (block.kind !== 'table') {
        continue
      }

      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = visitBlocks(cell.blocks)

          if (nested !== null) {
            return nested
          }
        }
      }
    }

    return null
  }
}

/** 根据 ID 查找表格单元格。 */
function findTableCellById(
  projection: DocumentProjection,
  tableId: string,
  cellId: string
): Table['rows'][number]['cells'][number] | null {
  const table = findTableById(projection, tableId)

  if (table === null) {
    return null
  }

  for (const row of table.rows) {
    for (const cell of row.cells) {
      if (cell.id === cellId) {
        return cell
      }
    }
  }

  return null
}

/** 读取表格当前列数。 */
function resolveTableColumnCount(table: Table): number {
  const firstRow = table.rows[0]

  return Math.max(1, firstRow?.cells.reduce((count, cell) => count + (cell.gridSpan ?? 1), 0) ?? table.grid?.length ?? 1)
}
