/**
 * 职责：导出 @4xian/jword-ui 的最小公开 API。
 * 边界：只做符号导出，不访问 DOM，不引入运行时副作用。
 * 协作模块：examples、宿主应用和后续 wrapper 通过此入口消费 UI SDK。
 * 性能/安全约束：保持入口稳定，避免把内部实现细节暴露为公开契约。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#5-4xianjword-ui-的目标公开面。
 */
export { createJWordUi } from './create-ui'
export { createCoreMediaCommandAdapter } from './media/core-command-adapter'
export type {
  CreateJWordUiOptions,
  JWordMediaAdapter,
  JWordMediaCommandAdapter,
  JWordMediaCommandResult,
  JWordMediaErrorState,
  JWordMediaOptions,
  JWordMediaPanelElements,
  JWordMediaResource,
  JWordMediaSource,
  JWordMediaStatus,
  JWordMediaUploadFile,
  JWordMediaUploadOptions,
  JWordMediaUploadProgressEvent,
  JWordMediaUploadRequest,
  JWordMediaUploadResult,
  JWordMediaUploadSource,
  JWordMediaUrlPolicy,
  JWordMediaInsertRequest,
  JWordSelectedImageTarget,
  JWordToolbarControlElement,
  JWordToolbarElements,
  JWordToolbarOptions,
  JWordToolbarToolId,
  JWordUiElements,
  JWordUiInstance
} from './types'
export { BUILTIN_TOOL_IDS as BUILTIN_JWORD_TOOL_IDS } from './toolbar/builtin-tools'
export { DEFAULT_JWORD_MEDIA_URL_POLICY, isAllowedJWordMediaUrl } from './media/policy'
