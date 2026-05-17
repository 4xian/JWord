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
import { readAnchorRefSnapshot } from '../model/position'
import type { ModelProperties, Paragraph, Run } from '../model/types'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Command, Operation, TextPosition } from './transaction'
import { isAllowedResourceUrl } from '../resources/types'
import type { Resource, ResourceUrlPolicy } from '../resources/types'
import { countGraphemes } from '../shared/grapheme'
import { createJWordError } from '../shared/errors'

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
 * 构造块级图片插入命令。
 */
export function buildInsertBlockImageCommand(
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
  const usedBlockIds = collectBlockIds(projection)

  return {
    name: 'insertBlockImage',
    operations: [{
      kind: 'upsertResource',
      resource
    }, {
      kind: 'insertImage',
      at: insertion.at,
      imageRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'image'),
      blockId: allocateGeneratedBlockId(usedBlockIds, insertion.blockId, 'image'),
      mode: 'block',
      image: {
        kind: 'image',
        resourceId: resource.id,
        display: 'block',
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

function collectBlockIds(projection: DocumentProjection): Set<string> {
  const blockIds = new Set<string>()

  for (const section of projection.document.sections) {
    visitBlocks(section.blocks)
  }

  return blockIds

  function visitBlocks(blocks: readonly import('../model/types').Block[]) {
    for (const block of blocks) {
      blockIds.add(block.id)

      if (block.kind === 'table') {
        for (const row of block.rows) {
          for (const cell of row.cells) {
            visitBlocks(cell.blocks)
          }
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

function allocateGeneratedBlockId(
  usedBlockIds: Set<string>,
  blockId: string,
  suffix: 'image'
): string {
  let sequence = 1
  let candidate = `${blockId}__${suffix}-${sequence}`

  while (usedBlockIds.has(candidate)) {
    sequence += 1
    candidate = `${blockId}__${suffix}-${sequence}`
  }

  usedBlockIds.add(candidate)

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
