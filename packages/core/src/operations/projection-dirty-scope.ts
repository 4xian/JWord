/**
 * 职责：把事务 operation 列表折算为 DocumentProjection 增量刷新范围。
 * 边界：只读取上一版只读 projection 和 operation 元数据，不执行事务、不写 Y.Doc、不做布局或渲染。
 * 协作模块：transaction pipeline、model/projection 和 operation 类型定义。
 * 性能/安全约束：只复用未变 section/block 的冻结快照；遇到文档级副作用时回退完整投影，避免复用过期元数据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import * as Y from 'yjs'

import type { Block, Paragraph, Table } from '../model/types'
import { createDocumentProjection, createIncrementalDocumentProjection } from '../model/projection'
import type { DocumentProjection, ProjectionDirtyScope } from '../model/projection'
import type { Operation, TextPosition } from './transaction'

/** 尝试读取事务前投影，未初始化文档会在事务后完整投影。 */
export function readProjectionBeforeTransaction(
  doc: Y.Doc,
  currentProjection: DocumentProjection | undefined
): DocumentProjection | undefined {
  if (currentProjection !== undefined) {
    return currentProjection
  }

  try {
    return createDocumentProjection(doc)
  } catch {
    return undefined
  }
}

/** 根据 operation dirty 范围生成下一版事务 projection。 */
export function createProjectionAfterOperationTransaction(
  doc: Y.Doc,
  previousProjection: DocumentProjection | undefined,
  operations: readonly Operation[]
): DocumentProjection {
  if (previousProjection === undefined) {
    return createDocumentProjection(doc)
  }

  return createIncrementalDocumentProjection(
    doc,
    previousProjection,
    collectProjectionDirtyScope(previousProjection, operations)
  )
}

interface ProjectionBlockLocation {
  readonly sectionId: string
  readonly topLevelBlockId: string
}

interface ProjectionLookup {
  readonly blockLocations: ReadonlyMap<string, ProjectionBlockLocation>
  readonly runLocations: ReadonlyMap<string, ProjectionBlockLocation>
}

/** 从上一版 projection 建立脏范围反查索引。 */
function createProjectionLookup(projection: DocumentProjection): ProjectionLookup {
  const blockLocations = new Map<string, ProjectionBlockLocation>()
  const runLocations = new Map<string, ProjectionBlockLocation>()

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      indexProjectionBlock(block, section.id, block.id, blockLocations, runLocations)
    }
  }

  return {
    blockLocations,
    runLocations
  }
}

/** 递归索引顶层块、表格单元格内块和 run 的所属顶层块。 */
function indexProjectionBlock(
  block: Block,
  sectionId: string,
  topLevelBlockId: string,
  blockLocations: Map<string, ProjectionBlockLocation>,
  runLocations: Map<string, ProjectionBlockLocation>
): void {
  const location = {
    sectionId,
    topLevelBlockId
  }

  blockLocations.set(block.id, location)

  if (block.kind === 'paragraph') {
    indexProjectionParagraphRuns(block, location, runLocations)
    return
  }

  indexProjectionTableBlocks(block, sectionId, topLevelBlockId, blockLocations, runLocations)
}

/** 索引段落 run 到顶层块位置。 */
function indexProjectionParagraphRuns(
  paragraph: Paragraph,
  location: ProjectionBlockLocation,
  runLocations: Map<string, ProjectionBlockLocation>
): void {
  for (const run of paragraph.runs) {
    runLocations.set(run.id, location)
  }
}

/** 索引表格单元格内嵌块到外层表格位置。 */
function indexProjectionTableBlocks(
  table: Table,
  sectionId: string,
  topLevelBlockId: string,
  blockLocations: Map<string, ProjectionBlockLocation>,
  runLocations: Map<string, ProjectionBlockLocation>
): void {
  for (const row of table.rows) {
    for (const cell of row.cells) {
      for (const cellBlock of cell.blocks) {
        indexProjectionBlock(cellBlock, sectionId, topLevelBlockId, blockLocations, runLocations)
      }
    }
  }
}

/** 把当前 operation 列表折算成投影增量刷新范围。 */
function collectProjectionDirtyScope(
  previousProjection: DocumentProjection,
  operations: readonly Operation[]
): ProjectionDirtyScope {
  if (operations.length === 0) {
    return {}
  }

  const lookup = createProjectionLookup(previousProjection)
  const sectionIds = new Set<string>()
  const blockIds = new Set<string>()
  let documentDirty = false
  const addBlock = (blockId: string, fallbackSectionId?: string): void => {
    const location = lookup.blockLocations.get(blockId)

    if (location === undefined) {
      blockIds.add(blockId)
      if (fallbackSectionId !== undefined) {
        sectionIds.add(fallbackSectionId)
      }
      return
    }

    sectionIds.add(location.sectionId)
    blockIds.add(location.topLevelBlockId)
  }
  const addRun = (runId: string): void => {
    const location = lookup.runLocations.get(runId)

    if (location === undefined) {
      documentDirty = true
      return
    }

    sectionIds.add(location.sectionId)
    blockIds.add(location.topLevelBlockId)
  }
  const addPosition = (position: TextPosition): void => {
    addBlock(position.blockId, position.sectionId)
  }

  for (const operation of operations) {
    switch (operation.kind) {
      case 'insertText':
        addPosition(operation.at)
        break
      case 'deleteRange':
        addPosition(operation.range.anchor)
        addPosition(operation.range.focus)
        if (operation.range.anchor.blockId !== operation.range.focus.blockId) {
          sectionIds.add(operation.range.anchor.sectionId)
          sectionIds.add(operation.range.focus.sectionId)
        }
        break
      case 'setRunProperties':
      case 'setRunLink':
      case 'replaceImageResource':
      case 'deleteImage':
      case 'resizeImage':
      case 'setImageRotation':
        addRun(operation.runId)
        break
      case 'setParagraphProperties':
        addBlock(operation.paragraphId)
        break
      case 'setSectionProperties':
        sectionIds.add(operation.sectionId)
        break
      case 'splitBlock':
        addPosition(operation.at)
        sectionIds.add(operation.at.sectionId)
        blockIds.add(operation.newBlockId)
        break
      case 'mergeBlock':
        addBlock(operation.targetBlockId)
        addBlock(operation.sourceBlockId)
        break
      case 'insertBlock':
        sectionIds.add(operation.sectionId)
        blockIds.add(operation.block.id)
        break
      case 'deleteBlock':
        addBlock(operation.blockId)
        break
      case 'insertImage':
        addPosition(operation.at)
        break
      case 'insertTable':
        sectionIds.add(operation.sectionId)
        blockIds.add(operation.table.id)
        break
      case 'insertTableRow':
      case 'deleteTableRow':
      case 'insertTableColumn':
      case 'deleteTableColumn':
      case 'setTableColumnWidth':
      case 'setTableRowHeight':
      case 'mergeTableCells':
      case 'setTableBorder':
      case 'setTableCellText':
        addBlock(operation.tableId)
        break
      case 'upsertResource':
      case 'deleteResource':
      case 'addCommentThread':
      case 'replyCommentThread':
      case 'editCommentEntry':
      case 'resolveCommentThread':
      case 'reopenCommentThread':
      case 'deleteCommentThread':
      case 'addRevisionMetadata':
      case 'acceptRevision':
      case 'rejectRevision':
        documentDirty = true
        break
    }
  }

  return {
    ...(documentDirty ? { document: true } : {}),
    ...(sectionIds.size === 0 ? {} : { sectionIds: [...sectionIds] }),
    ...(blockIds.size === 0 ? {} : { blockIds: [...blockIds] })
  }
}
