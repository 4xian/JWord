/**
 * 职责：承载 command builder 拆分后仍需共享的只读定位与 ID 辅助函数。
 * 边界：只读取 DocumentProjection 与 selection 快照，不构造公开命令、不执行事务。
 * 协作模块：文本、链接、图片与表格命令构建器共享 run 定位和 ID 分配逻辑。
 * 性能/安全约束：仅遍历投影树收集现有 ID，禁止写入 Projection 或访问 DOM。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  areFormattingPropertyValuesEquivalent
} from '../model/formatting-types'
import { readAnchorRefSnapshot } from '../model/position'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import type { ModelProperties, Paragraph, Run } from '../model/types'
import { countGraphemes } from '../shared/grapheme'
import type { TextPosition } from './transaction'

export function isPropertySetEquivalent(
  currentProperties: ModelProperties | undefined,
  nextProperties: ModelProperties
): boolean {
  return Object.entries(nextProperties).every(([key, value]) =>
    areFormattingPropertyValuesEquivalent(key, currentProperties?.[key], value)
  )
}

export function collectRunIds(projection: DocumentProjection): Set<string> {
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

export function allocateGeneratedRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'format' | 'tail' | 'image' | 'link'
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

export function resolveSelectionInsertionContext(
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

export function findParagraphById(
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

function readRunText(run: Run): string {
  return run.inlines
    .filter((inline): inline is Extract<Run['inlines'][number], { kind: 'text' }> => inline.kind === 'text')
    .map((inline) => inline.text)
    .join('')
}
