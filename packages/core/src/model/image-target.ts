/**
 * 职责：解析 projection + selection 当前是否命中第一版 image run，并返回 UI/commands 可消费的稳定只读目标。
 * 边界：只读遍历文档结构，不写入 Y.Doc，不访问 DOM，不执行命令。
 * 协作模块：图片 command builder、UI media panel 和浏览器测试通过这里读取当前选中图片。
 * 性能/安全约束：按当前 projection 做一次轻量 DFS，不缓存外部可写引用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-4---块级结构。
 */

import { readAnchorRefSnapshot } from './position'
import type { ImageInline, Paragraph, Run } from './types'
import type { DocumentProjection } from './projection'
import type { SelectionState } from './selection'
import type { Resource } from '../resources/types'

export interface SelectedImageTarget {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly paragraph: Paragraph
  readonly run: Run
  readonly image: ImageInline
  readonly resource?: Resource
  readonly mode: 'inline' | 'block'
}

/**
 * 职责：把当前选区折叠点解析成第一版 image run target。
 */
export function resolveSelectedImageTarget(
  projection: DocumentProjection,
  selection: SelectionState | null
): SelectedImageTarget | null {
  if (selection === null) {
    return null
  }

  const snapshot = readAnchorRefSnapshot(selection.focus)

  if (snapshot.assoc !== undefined && snapshot.assoc < 0) {
    return null
  }

  const resourceById = new Map(
    (projection.document.resources ?? []).map((resource) => [resource.id, resource] as const)
  )

  for (const section of projection.document.sections) {
    const target = findImageTargetInBlocks(section.blocks, {
      sectionId: section.id,
      blockId: String(snapshot.blockId),
      runId: String(snapshot.runId)
    }, resourceById)

    if (target !== null) {
      return target
    }
  }

  return null
}

function findImageTargetInBlocks(
  blocks: readonly import('./types').Block[],
  targetIds: Readonly<{
    sectionId: string
    blockId: string
    runId: string
  }>,
  resourceById: ReadonlyMap<string, Resource>
): SelectedImageTarget | null {
  for (const block of blocks) {
    if (block.kind === 'paragraph' && block.id === targetIds.blockId) {
      const run = block.runs.find((candidate) => candidate.id === targetIds.runId)
      const image = readSingleImageInline(run)

      if (run !== undefined && image !== null) {
        const resource = resourceById.get(image.resourceId)

        return {
          sectionId: targetIds.sectionId,
          blockId: block.id,
          runId: run.id,
          paragraph: block,
          run,
          image,
          ...(resource === undefined ? {} : { resource }),
          mode: image.display === 'block' ? 'block' : 'inline'
        }
      }
    }

    if (block.kind === 'table') {
      for (const row of block.rows) {
        for (const cell of row.cells) {
          const nested = findImageTargetInBlocks(cell.blocks, targetIds, resourceById)

          if (nested !== null) {
            return nested
          }
        }
      }
    }
  }

  return null
}

function readSingleImageInline(run: Run | undefined): ImageInline | null {
  if (run === undefined || run.inlines.length !== 1) {
    return null
  }

  const inline = run.inlines[0]

  return inline?.kind === 'image' ? inline : null
}
