/**
 * 职责：把 Gate 4 media panel 的宿主命令边界桥接到 core 公开 image command builders。
 * 边界：只负责参数映射、命令执行和最小成功/延期文案，不实现上传适配器或 DOM。
 * 协作模块：media controller 通过该桥接层真正写入 editor，examples/vanilla 和未来宿主都可直接复用。
 * 性能/安全约束：所有图片写入仍走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildDeleteSelectedImageCommand,
  buildInsertInlineImageCommand,
  buildMoveSelectedImageCommand,
  buildReplaceSelectedImageResourceCommand,
  buildResizeSelectedImageCommand,
  buildSetSelectedImageRotationCommand,
  createSelectionState,
  resolveSelectedImageTarget,
  type Command,
  type Editor,
  type Paragraph,
  type Resource,
  type Run,
  type SelectedImageTarget,
  type TextPosition
} from '@4xian/jword-core'

import type {
  JWordMediaCommandAdapter,
  JWordMediaCommandResult,
  JWordMediaInsertRequest,
  JWordMediaResource,
  JWordSelectedImageTarget
} from '../types'
import { readJWordUiText, resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'

type InlineImageInsertOperation = Extract<Command['operations'][number], {
  kind: 'insertImage'
}> & {
  mode: 'inline'
}

/** 创建基于 core command builders 的默认图片命令适配器。 */
export function createCoreMediaCommandAdapter(
  i18nOrReader: ResolvedJWordUiI18n | (() => ResolvedJWordUiI18n) | undefined = undefined
): JWordMediaCommandAdapter {
  const readI18n = typeof i18nOrReader === 'function'
    ? i18nOrReader
    : () => i18nOrReader ?? resolveJWordUiI18n()

  /** 读取图片命令结果文案。 */
  function mediaText(key: string): string {
    return readJWordUiText(readI18n(), `a11y.media.${key}`)
  }

  return {
    resolveSelectedImageTarget(projection, selection) {
      const target = resolveSelectedImageTarget(projection, selection)

      return target === null ? null : toUiSelectedImageTarget(target)
    },
    insertInlineImage(request) {
      const command = buildInsertInlineImageCommand(
        request.projection,
        request.selection,
        toCoreResource(request.resource),
        readImageInsertionOptions(request.resource)
      )
      const selectionAfter = command === null
        ? undefined
        : resolveInlineImageSelectionAfter(command, request)

      return executeMediaCommand(
        command,
        request,
        mediaText('insertUnavailable'),
        mediaText('inserted'),
        selectionAfter
      )
    },
    replaceSelectedImageResource(request) {
      const command = buildReplaceSelectedImageResourceCommand(
        request.projection,
        request.selection,
        toCoreResource(request.resource)
      )

      return executeMediaCommand(
        command,
        request,
        mediaText('replaceUnavailable'),
        mediaText('replaced')
      )
    },
    resizeSelectedImage(input) {
      const command = buildResizeSelectedImageCommand(input.projection, input.selection, {
        widthTwips: input.widthTwips ?? input.target.widthTwips ?? 0,
        heightTwips: input.heightTwips ?? input.target.heightTwips ?? 0
      })

      return executeMediaCommand(
        command,
        input,
        mediaText('resizeUnavailable'),
        mediaText('resized')
      )
    },
    setSelectedImageRotation(input) {
      const command = buildSetSelectedImageRotationCommand(
        input.projection,
        input.selection,
        input.rotationDegrees
      )

      return executeMediaCommand(
        command,
        input,
        mediaText('rotateUnavailable'),
        input.rotationDegrees === 0 ? mediaText('rotationReset') : mediaText('rotated')
      )
    },
    moveSelectedImage(input) {
      const command = buildMoveSelectedImageCommand(
        input.projection,
        input.selection,
        input.dropSelection
      )

      if (command === null) {
        return {
          kind: 'deferred',
          message: mediaText('moveUnavailable')
        }
      }

      input.editor.executeCommand(command)
      syncMovedImageSelection(input.editor, command)

      return {
        kind: 'applied',
        message: mediaText('moved')
      }
    },
    deleteSelectedImage(input) {
      const command = buildDeleteSelectedImageCommand(input.projection, input.selection)

      return executeMediaCommand(
        command,
        input,
        mediaText('deleteUnavailable'),
        mediaText('deleted')
      )
    }
  }
}

/** 执行图片命令并返回 UI 层可展示的结果。 */
function executeMediaCommand(
  command: Command | null,
  input: Pick<JWordMediaInsertRequest, 'editor'>,
  deferredMessage: string,
  appliedMessage: string,
  selectionAfter?: ReturnType<typeof createSelectionState>
): JWordMediaCommandResult {
  if (command === null) {
    return {
      kind: 'deferred',
      message: deferredMessage
    }
  }

  if (selectionAfter === undefined) {
    input.editor.executeCommand(command)
  } else {
    input.editor.executeCommand(command, { selectionAfter })
  }

  return {
    kind: 'applied',
    message: appliedMessage
  }
}

/** 计算行内图片插入后的折叠 caret 位置。 */
function resolveInlineImageSelectionAfter(
  command: Command,
  request: JWordMediaInsertRequest
): ReturnType<typeof createSelectionState> | undefined {
  if (request.selection === null) {
    return undefined
  }

  const insertion = readInlineImageInsertionContext(command, request)

  if (insertion === undefined) {
    return undefined
  }

  if (insertion.operation.trailingRunId !== undefined) {
    return createCollapsedSelectionAfter(request, {
      sectionId: insertion.position.sectionId,
      blockId: insertion.position.blockId,
      runId: insertion.position.runId,
      graphemeIndex: insertion.position.graphemeIndex,
      assoc: 1
    })
  }

  if (insertion.position.graphemeIndex === 0) {
    return createCollapsedSelectionAfter(request, insertion.position)
  }

  const nextRun = insertion.paragraph.runs[insertion.runIndex + 1]

  if (nextRun !== undefined && runContainsText(nextRun)) {
    return createCollapsedSelectionAfter(request, {
      sectionId: insertion.position.sectionId,
      blockId: insertion.position.blockId,
      runId: nextRun.id,
      graphemeIndex: 0
    })
  }

  return createCollapsedSelectionAfter(request, insertion.position)
}

/** 读取当前 command 对应的插图上下文，供 selectionAfter 复用。 */
function readInlineImageInsertionContext(
  command: Command,
  request: JWordMediaInsertRequest
): Readonly<{
  operation: InlineImageInsertOperation
  position: TextPosition
  paragraph: Paragraph
  runIndex: number
}> | undefined {
  const operation = command.operations.find(isInlineImageInsertOperation)

  if (operation === undefined) {
    return undefined
  }

  const position = request.editor.resolveTextPosition(request.selection!.focus)
  const paragraph = findParagraphById(request, position.blockId)

  if (paragraph === undefined) {
    return undefined
  }

  const runIndex = paragraph.runs.findIndex((candidate) => candidate.id === position.runId)

  if (runIndex < 0) {
    return undefined
  }

  return {
    operation,
    position,
    paragraph,
    runIndex
  }
}

/** 把移动后的新图片 run 重新设为当前选中项。 */
function syncMovedImageSelection(editor: Editor, command: Command): void {
  const operation = command.operations.find(isInlineImageInsertOperation)

  if (operation === undefined) {
    return
  }

  const anchor = editor.createTextAnchor({
    sectionId: operation.at.sectionId,
    blockId: operation.at.blockId,
    runId: operation.imageRunId,
    graphemeIndex: 0
  })

  editor.setSelection(createSelectionState(anchor, anchor))
}

/** 基于 editor facade 创建折叠 selectionAfter。 */
function createCollapsedSelectionAfter(
  request: Pick<JWordMediaInsertRequest, 'editor'>,
  input: Readonly<{
    sectionId: string
    blockId: string
    runId: string
    graphemeIndex: number
    assoc?: number
  }>
): ReturnType<typeof createSelectionState> {
  const anchor = request.editor.createTextAnchor(input)

  return createSelectionState(anchor, anchor)
}

/** 在当前 projection 中查找段落块。 */
function findParagraphById(
  request: JWordMediaInsertRequest,
  blockId: string
): Paragraph | undefined {
  for (const section of request.projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind === 'paragraph' && block.id === blockId) {
        return block
      }
    }
  }

  return undefined
}

/** 只提取当前 command 中的行内图片插入 operation。 */
function isInlineImageInsertOperation(
  operation: Command['operations'][number]
): operation is InlineImageInsertOperation {
  return operation.kind === 'insertImage' && operation.mode === 'inline'
}

/** 判断 run 是否仍能承接图片后的文本 caret。 */
function runContainsText(
  run: Run
): boolean {
  return run.inlines.some((inline) => inline.kind === 'text')
}

/** 把 core 图片选中目标转换成 UI 层快照。 */
function toUiSelectedImageTarget(target: SelectedImageTarget): JWordSelectedImageTarget {
  return {
    resourceId: target.image.resourceId,
    ...(target.image.widthTwips === undefined ? {} : { widthTwips: target.image.widthTwips }),
    ...(target.image.heightTwips === undefined ? {} : { heightTwips: target.image.heightTwips }),
    ...(target.image.rotationDegrees === undefined ? {} : { rotationDegrees: target.image.rotationDegrees })
  }
}

/** 把 UI 层资源快照转换成 core 资源模型。 */
function toCoreResource(resource: JWordMediaResource): Resource {
  return {
    kind: 'resource',
    id: resource.id,
    mime: resource.mime,
    source: resource.source,
    status: resource.status,
    ...(resource.error === undefined ? {} : { error: resource.error }),
    ...(resource.retryToken === undefined ? {} : { retryToken: resource.retryToken }),
    ...(resource.metadata === undefined ? {} : { metadata: resource.metadata })
  }
}

/** 从资源 metadata 读取行内图片插入参数。 */
function readImageInsertionOptions(resource: JWordMediaResource): Readonly<{
  alt?: string
  widthTwips?: number
  heightTwips?: number
}> {
  const alt = readStringMetadata(resource, 'alt')
  const widthTwips = readNumberMetadata(resource, 'widthTwips')
  const heightTwips = readNumberMetadata(resource, 'heightTwips')

  return {
    ...(alt === undefined ? {} : { alt }),
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips })
  }
}

/** 从资源 metadata 中读取字符串值。 */
function readStringMetadata(resource: JWordMediaResource, key: string): string | undefined {
  const value = resource.metadata?.[key]

  return typeof value === 'string' ? value : undefined
}

/** 从资源 metadata 中读取正数值。 */
function readNumberMetadata(resource: JWordMediaResource, key: string): number | undefined {
  const value = resource.metadata?.[key]

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}
