/**
 * 职责：把 Gate 4 media panel 的宿主命令边界桥接到 core 公开 image command builders。
 * 边界：只负责参数映射、命令执行和最小成功/延期文案，不实现上传适配器或 DOM。
 * 协作模块：media controller 通过该桥接层真正写入 editor，examples/vanilla 和未来宿主都可直接复用。
 * 性能/安全约束：所有图片写入仍走 editor facade 的 transaction pipeline，不旁路修改 projection。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */

import {
  buildDeleteSelectedImageCommand,
  buildInsertBlockImageCommand,
  buildInsertInlineImageCommand,
  buildReplaceSelectedImageResourceCommand,
  buildResizeSelectedImageCommand,
  createSelectionState,
  resolveSelectedImageTarget,
  type Command,
  type Paragraph,
  type Resource,
  type Run,
  type SelectedImageTarget,
  type TextPosition
} from '@4xian/jword-core'

import type {
  JWordMediaCommandAdapter,
  JWordMediaCommandResult,
  JWordMediaInsertMode,
  JWordMediaInsertRequest,
  JWordMediaResource,
  JWordSelectedImageTarget
} from '../types'

type InlineImageInsertOperation = Extract<Command['operations'][number], {
  kind: 'insertImage'
}> & {
  mode: 'inline'
}

/** 创建基于 core command builders 的默认图片命令适配器。 */
export function createCoreMediaCommandAdapter(): JWordMediaCommandAdapter {
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
        '当前选区无法插入行内图片。',
        '已插入行内图片。',
        selectionAfter
      )
    },
    insertBlockImage(request) {
      const command = buildInsertBlockImageCommand(
        request.projection,
        request.selection,
        toCoreResource(request.resource),
        readImageInsertionOptions(request.resource)
      )

      return executeMediaCommand(
        command,
        request,
        '当前选区无法插入块级图片。',
        '已插入块级图片。'
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
        '当前选区未命中可替换的图片。',
        '已替换当前图片资源。'
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
        '当前图片尺寸未变化，或当前选区未命中可调整的图片。',
        '已更新图片尺寸。'
      )
    },
    deleteSelectedImage(input) {
      const command = buildDeleteSelectedImageCommand(input.projection, input.selection)

      return executeMediaCommand(
        command,
        input,
        '当前选区未命中可删除的图片。',
        '已删除当前图片。'
      )
    }
  }
}

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

/** 基于 editor facade 创建折叠 selectionAfter。 */
function createCollapsedSelectionAfter(
  request: JWordMediaInsertRequest,
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

function toUiSelectedImageTarget(target: SelectedImageTarget): JWordSelectedImageTarget {
  return {
    resourceId: target.image.resourceId,
    display: target.mode,
    ...(target.image.widthTwips === undefined ? {} : { widthTwips: target.image.widthTwips }),
    ...(target.image.heightTwips === undefined ? {} : { heightTwips: target.image.heightTwips })
  }
}

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

function readStringMetadata(resource: JWordMediaResource, key: string): string | undefined {
  const value = resource.metadata?.[key]

  return typeof value === 'string' ? value : undefined
}

function readNumberMetadata(resource: JWordMediaResource, key: string): number | undefined {
  const value = resource.metadata?.[key]

  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : undefined
}
