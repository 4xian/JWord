/**
 * 职责：定义 Gate 4 第一版媒体 panel 的内部状态与纯函数 helper。
 * 边界：只处理状态快照、标签与默认文案，不访问 DOM，也不直接调用 editor 或上传适配器。
 * 协作模块：media controller 维护状态，media dom 只消费这里归一化后的数据。
 * 性能/安全约束：状态保持最小可序列化，避免在 UI 层持有多份冗余资源数据。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---图片纵线step-41-43。
 */
import type {
  JWordMediaCommandResult,
  JWordMediaErrorState,
  JWordMediaInsertMode,
  JWordMediaResource,
  JWordMediaStatus,
  JWordMediaUploadSource
} from '../types'

/** 单个资源项的进度快照。 */
export interface MediaPanelProgressState {
  readonly loaded: number
  readonly total?: number
}

/** 单个资源项的内部状态。 */
export interface MediaPanelItemState {
  readonly id: string
  readonly resourceId: string
  readonly source: JWordMediaUploadSource
  readonly mode: JWordMediaInsertMode
  readonly status: JWordMediaStatus
  readonly resource: JWordMediaResource | null
  readonly progress: MediaPanelProgressState | null
  readonly error: JWordMediaErrorState | null
  readonly retryToken?: string
  readonly applyState: 'applied' | 'deferred'
  readonly applyMessage: string
}

/** media panel 的渲染快照。 */
export interface MediaPanelViewState {
  readonly mode: JWordMediaInsertMode
  readonly fileName: string
  readonly note: string
  readonly targetSummary: string
  readonly items: readonly MediaPanelItemState[]
}

let mediaPanelItemSequence = 0
let mediaResourceSequence = 0

/** 生成稳定的 media item id。 */
export function createMediaPanelItemId(): string {
  mediaPanelItemSequence += 1

  return `jw-media-item-${mediaPanelItemSequence}`
}

/** 生成稳定的 resource id。 */
export function createMediaResourceId(): string {
  mediaResourceSequence += 1

  return `jw-media-resource-${mediaResourceSequence}`
}

/** 为一次新的上传/插入动作创建 pending 项。 */
export function createPendingMediaPanelItem(input: {
  readonly source: JWordMediaUploadSource
  readonly mode: JWordMediaInsertMode
}): MediaPanelItemState {
  return {
    id: createMediaPanelItemId(),
    resourceId: createMediaResourceId(),
    source: input.source,
    mode: input.mode,
    status: 'pending',
    resource: null,
    progress: {
      loaded: 0,
      total: 100
    },
    error: null,
    applyState: 'deferred',
    applyMessage: '等待上传结果。'
  }
}

/** 为 UI 侧校验失败创建 failed 项。 */
export function createFailedMediaPanelItem(input: {
  readonly source: JWordMediaUploadSource
  readonly mode: JWordMediaInsertMode
  readonly error: JWordMediaErrorState
}): MediaPanelItemState {
  return {
    id: createMediaPanelItemId(),
    resourceId: createMediaResourceId(),
    source: input.source,
    mode: input.mode,
    status: 'failed',
    resource: null,
    progress: null,
    error: input.error,
    applyState: 'deferred',
    applyMessage: input.error.message
  }
}

/** 把进度事件合并进当前项。 */
export function applyMediaPanelProgress(
  item: MediaPanelItemState,
  progress: MediaPanelProgressState
): MediaPanelItemState {
  return {
    ...item,
    status: 'pending',
    progress,
    error: null,
    applyMessage: readMediaProgressLabel(progress)
  }
}

/** 把上传成功结果合并进当前项。 */
export function applyMediaPanelUploadSuccess(
  item: MediaPanelItemState,
  resource: JWordMediaResource,
  commandResult: JWordMediaCommandResult
): MediaPanelItemState {
  const retryTokenPatch = resource.retryToken === undefined
    ? {}
    : { retryToken: resource.retryToken }

  return {
    ...item,
    status: 'success',
    resource,
    progress: null,
    error: null,
    ...retryTokenPatch,
    applyState: commandResult.kind,
    applyMessage: commandResult.message ?? (
      commandResult.kind === 'applied'
        ? readDefaultAppliedMessage(item.mode)
        : readDefaultDeferredMessage(item.mode)
    )
  }
}

/** 把失败结果合并进当前项。 */
export function applyMediaPanelFailure(
  item: MediaPanelItemState,
  error: JWordMediaErrorState,
  retryToken?: string
): MediaPanelItemState {
  const retryTokenPatch = retryToken === undefined
    ? {}
    : { retryToken }

  return {
    ...item,
    status: 'failed',
    progress: null,
    error,
    ...retryTokenPatch,
    applyState: 'deferred',
    applyMessage: error.message
  }
}

/** 读取上传来源标签。 */
export function readMediaSourceLabel(source: JWordMediaUploadSource): string {
  return source.kind === 'file'
    ? source.file.name
    : source.url
}

/** 读取单个资源项的标题。 */
export function readMediaItemTitle(item: MediaPanelItemState): string {
  return `${item.mode === 'inline' ? '行内' : '块级'} · ${readMediaSourceLabel(item.source)}`
}

/** 读取单个资源项的状态标签。 */
export function readMediaItemStatusLabel(item: MediaPanelItemState): string {
  if (item.status === 'pending') {
    return readMediaProgressLabel(item.progress)
  }

  if (item.status === 'failed') {
    return item.error?.message ?? '上传失败。'
  }

  return item.applyMessage
}

/** 读取默认的 panel 说明。 */
export function readDefaultMediaPanelNote(mode: JWordMediaInsertMode): string {
  return mode === 'inline'
    ? '当前为行内图片模式：资源上传完成后会按 inline image command 方向继续对接。'
    : '当前为块级图片模式：资源上传完成后会按 block image command 方向继续对接。'
}

/** 读取默认的 deferred 文案。 */
export function readDefaultDeferredMessage(mode: JWordMediaInsertMode): string {
  return mode === 'inline'
    ? '资源已就绪，等待主进程对接 core 的 inline image command。'
    : '资源已就绪，等待主进程对接 core 的 block image command。'
}

/** 读取默认的 applied 文案。 */
export function readDefaultAppliedMessage(mode: JWordMediaInsertMode): string {
  return mode === 'inline'
    ? '资源已就绪，并已插入当前文档。'
    : '资源已就绪，并已作为块级图片插入当前文档。'
}

/** 读取进度标签。 */
export function readMediaProgressLabel(progress: MediaPanelProgressState | null): string {
  if (progress === null) {
    return '上传中。'
  }

  if (progress.total === undefined || progress.total <= 0) {
    return `上传中 ${progress.loaded}`
  }

  const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)))

  return `上传中 ${percent}%`
}
