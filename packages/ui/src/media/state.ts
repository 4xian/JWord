/**
 * 职责：定义 Gate 4 第一版媒体 panel 的内部状态与纯函数 helper。
 * 边界：只处理状态快照、标签与默认文案，不访问 DOM，也不直接调用 editor 或上传适配器。
 * 协作模块：media controller 维护状态，media dom 只消费这里归一化后的数据。
 * 性能/安全约束：状态保持最小可序列化，避免在 UI 层持有多份冗余资源数据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type {
  JWordMediaCommandResult,
  JWordMediaErrorState,
  JWordMediaResource,
  JWordMediaStatus,
  JWordMediaUploadSource
} from '../types'
import { readJWordUiText, resolveJWordUiI18n, type ResolvedJWordUiI18n } from '../i18n'

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
  readonly status: JWordMediaStatus
  readonly resource: JWordMediaResource | null
  readonly progress: MediaPanelProgressState | null
  readonly error: JWordMediaErrorState | null
  readonly retryToken?: string
  readonly applyState: 'applied' | 'deferred'
  readonly applyMessage: string
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
  readonly i18n?: ResolvedJWordUiI18n
}): MediaPanelItemState {
  return {
    id: createMediaPanelItemId(),
    resourceId: createMediaResourceId(),
    source: input.source,
    status: 'pending',
    resource: null,
    progress: {
      loaded: 0,
      total: 100
    },
    error: null,
    applyState: 'deferred',
    applyMessage: readJWordUiText(input.i18n ?? resolveJWordUiI18n(), 'a11y.media.uploading')
  }
}

/** 为 UI 侧校验失败创建 failed 项。 */
export function createFailedMediaPanelItem(input: {
  readonly source: JWordMediaUploadSource
  readonly error: JWordMediaErrorState
}): MediaPanelItemState {
  return {
    id: createMediaPanelItemId(),
    resourceId: createMediaResourceId(),
    source: input.source,
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
  progress: MediaPanelProgressState,
  i18n?: ResolvedJWordUiI18n
): MediaPanelItemState {
  return {
    ...item,
    status: 'pending',
    progress,
    error: null,
    applyMessage: readMediaProgressLabel(progress, i18n)
  }
}

/** 把上传成功结果合并进当前项。 */
export function applyMediaPanelUploadSuccess(
  item: MediaPanelItemState,
  resource: JWordMediaResource,
  commandResult: JWordMediaCommandResult,
  i18n?: ResolvedJWordUiI18n
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
        ? readDefaultAppliedMessage(i18n)
        : readDefaultDeferredMessage(i18n)
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

/** 读取默认的 deferred 文案。 */
export function readDefaultDeferredMessage(i18n?: ResolvedJWordUiI18n): string {
  return readJWordUiText(i18n ?? resolveJWordUiI18n(), 'a11y.media.deferred')
}

/** 读取默认的 applied 文案。 */
export function readDefaultAppliedMessage(i18n?: ResolvedJWordUiI18n): string {
  return readJWordUiText(i18n ?? resolveJWordUiI18n(), 'a11y.media.applied')
}

/** 读取进度标签。 */
export function readMediaProgressLabel(progress: MediaPanelProgressState | null, i18n?: ResolvedJWordUiI18n): string {
  const resolvedI18n = i18n ?? resolveJWordUiI18n()

  if (progress === null) {
    return readJWordUiText(resolvedI18n, 'a11y.media.uploading')
  }

  if (progress.total === undefined || progress.total <= 0) {
    return `上传中 ${progress.loaded}`
  }

  const percent = Math.max(0, Math.min(100, Math.round((progress.loaded / progress.total) * 100)))

  return readJWordUiText(resolvedI18n, 'a11y.media.uploadingPercent').replace('{percent}', String(percent))
}
