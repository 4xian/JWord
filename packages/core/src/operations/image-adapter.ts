/**
 * 职责：应用图片 run 类 operation 到 Y.Doc 段落 run 结构。
 * 边界：只处理图片 run 的插入、替换资源、删除、尺寸和旋转，不处理资源记录创建。
 * 协作模块：operation-adapter 负责分发，adapter-location 负责定位与 run 拆分。
 * 性能/安全约束：不访问 DOM 和网络；图片资源必须已存在于 DocumentStore。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  DOCUMENT_STORE_FIELDS,
  getRunField,
  getRunInlines,
  getRunLink,
  getRunRevisionId,
  getRunText,
  setRunStructure
} from '../model/document-store'
import { createJWordError } from '../shared/errors'
import { countGraphemes } from '../shared/grapheme'
import type { DocumentStore, ResourceId, RunRecord } from '../model/document-store'
import type { Run } from '../model/types'
import type { RunId } from '../model/position'
import { migrateTextAnchorsAfterSplit } from '../model/position'
import type { Operation } from './transaction'
import {
  assertRunIdUnused,
  findBlockLocation,
  findRunLocation,
  resolveOperationPosition,
  splitRunAtGraphemeIndex
} from './adapter-location'
import {
  createImageRunRecord,
  createTrailingTextRunRecord,
  shouldInsertTrailingTextRun,
  syncRunResourceIds
} from './block-record-factory'
import { assertBlockKind } from './operation-record-utils'

/** 插入图片 run。 */
export function insertImage(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'insertImage' }>
): void {
  assertRunIdUnused(store, operation.imageRunId as RunId)
  assertResourceExists(store, operation.image.resourceId)

  insertInlineImage(store, operation)
}

/** 替换图片 run 绑定的资源 ID。 */
export function replaceImageResource(store: DocumentStore, runId: string, resourceId: string): void {
  assertResourceExists(store, resourceId)

  updateImageRun(store, runId as RunId, (image) => ({
    ...image,
    resourceId
  }))
}

/** 调整图片 run 的尺寸。 */
export function resizeImage(store: DocumentStore, runId: string, widthTwips: number, heightTwips: number): void {
  if (!Number.isFinite(widthTwips) || !Number.isFinite(heightTwips) || widthTwips <= 0 || heightTwips <= 0) {
    throw createJWordError('OPERATION_IMAGE_DIMENSIONS_INVALID', '图片尺寸必须是正数', {
      runId,
      widthTwips,
      heightTwips
    })
  }

  updateImageRun(store, runId as RunId, (image) => ({
    ...image,
    widthTwips,
    heightTwips
  }))
}

/** 设置图片 run 旋转角度。 */
export function setImageRotation(store: DocumentStore, runId: string, rotationDegrees: number): void {
  if (!Number.isFinite(rotationDegrees)) {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '图片旋转角度必须是有限数字', {
      runId,
      rotationDegrees
    })
  }

  const normalizedRotationDegrees = normalizeImageRotationDegrees(rotationDegrees)

  updateImageRun(store, runId as RunId, (image) => ({
    ...omitImageRotation(image),
    ...(normalizedRotationDegrees === 0 ? {} : { rotationDegrees: normalizedRotationDegrees })
  }))
}

/** 删除图片 run；若段落只剩该图片 run，则删除整个段落。 */
export function deleteImage(store: DocumentStore, runId: string): void {
  const runLocation = findRunLocation(store, runId as RunId)
  const blockLocation = findBlockLocation(store, runLocation.blockId)

  assertBlockKind(blockLocation.block, 'paragraph')

  if (!runContainsSingleImage(runLocation.run)) {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', 'deleteImage 目标 run 不是第一版 image run', {
      runId
    })
  }

  if (runLocation.container.length === 1) {
    blockLocation.container.delete(blockLocation.index, 1)
    return
  }

  runLocation.container.delete(runLocation.index, 1)
}

/** 在段落 run 容器中插入行内图片 run。 */
function insertInlineImage(
  store: DocumentStore,
  operation: Extract<Operation, { kind: 'insertImage' }>
): void {
  const snapshot = resolveOperationPosition(store, operation.at)
  const runText = getRunText(snapshot.runLocation.run).toString()
  const graphemeLength = countGraphemes(runText)
  let insertIndex = snapshot.runLocation.index

  if (snapshot.graphemeIndex > 0 && snapshot.graphemeIndex < graphemeLength) {
    if (operation.trailingRunId === undefined) {
      throw createJWordError('OPERATION_RUN_FORMAT_RANGE_INVALID', '行内图片插入缺少 trailingRunId', {
        runId: operation.at.runId
      })
    }

    assertRunIdUnused(store, operation.trailingRunId as RunId)
    const tailLocation = splitRunAtGraphemeIndex(
      store,
      snapshot.runLocation,
      Number(snapshot.graphemeIndex),
      operation.trailingRunId as RunId
    )

    insertIndex = tailLocation.index
  } else if (snapshot.graphemeIndex === graphemeLength) {
    insertIndex = snapshot.runLocation.index + 1
  }

  const trailingRun = operation.trailingRunId !== undefined
    && snapshot.graphemeIndex === graphemeLength
    && shouldInsertTrailingTextRun(snapshot.runLocation.container, insertIndex)
    ? createTrailingTextRunRecord(operation.trailingRunId as RunId, snapshot.runLocation.run)
    : undefined

  if (trailingRun !== undefined) {
    assertRunIdUnused(store, operation.trailingRunId as RunId)
  }

  snapshot.runLocation.container.insert(insertIndex, [
    createImageRunRecord(operation.imageRunId as RunId, {
      ...operation.image,
      ...(operation.image.display === undefined ? { display: 'inline' } : {})
    }),
    ...(trailingRun === undefined ? [] : [trailingRun])
  ])

  if (trailingRun !== undefined && snapshot.graphemeIndex === graphemeLength) {
    migrateTextAnchorsAfterSplit(getRunText(snapshot.runLocation.run), store.doc, snapshot.utf16Index, {
      sectionId: snapshot.sectionId,
      blockId: snapshot.blockId,
      runId: operation.trailingRunId as RunId,
      text: getRunText(trailingRun)
    })
  }
}

/** 统一把图片角度约束到 0-359。 */
function normalizeImageRotationDegrees(rotationDegrees: number): number {
  const normalized = Math.round(rotationDegrees) % 360

  return normalized < 0 ? normalized + 360 : normalized
}

/** 返回不包含旋转字段的图片快照，供 reset 复用。 */
function omitImageRotation(image: Extract<Run['inlines'][number], { kind: 'image' }>): Extract<Run['inlines'][number], { kind: 'image' }> {
  const { rotationDegrees: _rotationDegrees, ...rest } = image

  return rest
}

/** 更新图片 run 的结构字段并同步 resourceIds。 */
function updateImageRun(
  store: DocumentStore,
  runId: RunId,
  updater: (image: Extract<Run['inlines'][number], { kind: 'image' }>) => Extract<Run['inlines'][number], { kind: 'image' }>
): void {
  const runLocation = findRunLocation(store, runId)
  const inlines = getRunInlines(runLocation.run)

  if (inlines === undefined || inlines.length !== 1 || inlines[0]?.kind !== 'image') {
    throw createJWordError('OPERATION_PROPERTY_VALUE_INVALID', '目标 run 不是第一版 image run', {
      runId: String(runId)
    })
  }

  const field = getRunField(runLocation.run)
  const link = getRunLink(runLocation.run)
  const revisionId = getRunRevisionId(runLocation.run)
  const nextImage = updater(inlines[0])

  setRunStructure(runLocation.run, {
    ...(field === undefined ? {} : { field }),
    ...(link === undefined ? {} : { link }),
    ...(revisionId === undefined ? {} : { revisionId }),
    inlines: [nextImage]
  })
  syncRunResourceIds(runLocation.run, [nextImage])
}

/** 断言图片引用资源存在。 */
function assertResourceExists(store: DocumentStore, resourceId: string): void {
  if (!store.resources.has(resourceId as ResourceId)) {
    throw createJWordError('OPERATION_RESOURCE_NOT_FOUND', '图片引用的资源不存在', {
      resourceId
    })
  }
}

/** 判断 run 是否只包含一个 image inline。 */
function runContainsSingleImage(run: RunRecord): boolean {
  const inlines = getRunInlines(run)

  return inlines !== undefined
    && inlines.length === 1
    && inlines[0]?.kind === 'image'
}
