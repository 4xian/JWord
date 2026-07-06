/**
 * 职责：构造行内图片插入、替换、删除、尺寸、旋转与移动命令。
 * 边界：只生成图片和资源相关 operation，不执行事务、不访问图片二进制或 DOM。
 * 协作模块：image-target、资源命令语义、共享 run 定位辅助函数与事务流水线共同提供图片能力。
 * 性能/安全约束：只遍历投影树统计资源引用和定位插入 run，避免无变化 operation。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-410图片插入与资源管理。
 */

import { resolveSelectedImageTarget } from '../model/image-target'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { Resource } from '../resources/types'
import type { Run } from '../model/types'
import {
  allocateGeneratedRunId,
  collectRunIds,
  findParagraphById,
  resolveSelectionInsertionContext
} from './command-builder-utils'
import type { Command, Operation, TextPosition } from './transaction'

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

/** 统一把图片角度约束到 0-359。 */
function normalizeImageRotationDegrees(rotationDegrees: number): number {
  const normalized = Math.round(rotationDegrees) % 360

  return normalized < 0 ? normalized + 360 : normalized
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

function runContainsTextInline(run: Run | undefined): boolean {
  return run?.inlines.some((inline) => inline.kind === 'text') ?? false
}
