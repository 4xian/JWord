/**
 * 职责：导出 @4xian/jword-ui 的最小公开 API。
 * 边界：只做符号导出，不访问 DOM，不引入运行时副作用。
 * 协作模块：examples、宿主应用和后续 wrapper 通过此入口消费 UI SDK。
 * 性能/安全约束：保持入口稳定，避免把内部实现细节暴露为公开契约。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
export { createJWordUi } from './create-ui'
export { createJWord } from './editor-shell'
export type {
  CreateJWordOptions,
  JWordEditorShell,
  JWordEditorShellSlots,
  JWordEditorShellUiOptions
} from './editor-shell'
export {
  DEFAULT_JWORD_UI_I18N_DICTIONARY,
  resolveJWordUiI18n
} from './i18n'
export {
  DEFAULT_JWORD_UI_THEME_TOKENS
} from './theme'
export { createCoreMediaCommandAdapter } from './media/core-command-adapter'
export { createCoreTableCommandAdapter } from './table/core-command-adapter'
export type {
  CreateJWordUiOptions,
  JWordUiThemeName,
  JWordUiThemeToken,
  JWordUiThemeOptions,
  JWordUiTextDirection,
  JWordUiI18nKey,
  JWordUiI18nDictionary,
  JWordUiI18nOptions,
  JWordUiStatusBarTextKey,
  JWordStatusBarBrandOptions,
  JWordStatusBarBrandProtectionMode,
  JWordStatusBarDocumentStats,
  JWordStatusBarElements,
  JWordStatusBarItemId,
  JWordStatusBarLocale,
  JWordStatusBarLocaleSwitcherOptions,
  JWordStatusBarOptions,
  JWordStatusBarThemeSwitcherOptions,
  JWordStatusBarZoomOptions,
  JWordMediaAdapter,
  JWordMediaCommandAdapter,
  JWordMediaCommandResult,
  JWordMediaErrorState,
  JWordMediaOptions,
  JWordMediaPanelElements,
  JWordMediaResource,
  JWordMediaSource,
  JWordMediaStatus,
  JWordCommentsOptions,
  JWordFindReplaceOptions,
  JWordFindReplacePanelElements,
  JWordHeaderFooterOptions,
  JWordHeaderFooterPanelElements,
  JWordHeadingOutlineOptions,
  JWordHeadingOutlinePanelElements,
  JWordLinkOptions,
  JWordReadonlyOptions,
  JWordRevisionPanelElements,
  JWordRevisionsOptions,
  JWordSelectionActionElements,
  JWordTableBorderCommandRequest,
  JWordTableBorderPreset,
  JWordTableColumnCommandRequest,
  JWordTableCommandAdapter,
  JWordTableCommandContext,
  JWordTableCommandResult,
  JWordTableInsertRequest,
  JWordTableOptions,
  JWordTablePanelElements,
  JWordTableRowCommandRequest,
  JWordTableSelectionScope,
  JWordTableSelectionTarget,
  JWordTableTargetCommandRequest,
  JWordUserOptions,
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
  JWordToolbarPluginItem,
  JWordToolbarOptions,
  JWordToolbarToolId,
  JWordUiElements,
  JWordUiInstance,
  JWordWatermarkOptions,
  JWordUiPluginExtension,
  JWordUiPluginRenderContext,
  JWordMenuPluginAction,
  JWordMenuPluginItem
} from './types'
export { createFindReplaceController } from './find-replace/controller'
export type {
  CreateFindReplaceControllerOptions,
  FindReplaceControllerHandle
} from './find-replace/controller'
export { createHeaderFooterController } from './header-footer/controller'
export type {
  CreateHeaderFooterControllerOptions,
  HeaderFooterControllerHandle
} from './header-footer/controller'
export type {
  CommentsControllerHandle,
  CreateCommentsControllerOptions,
  JWordCommentAnchorState,
  JWordCommentReply,
  JWordCommentThread,
  JWordCommentUser,
  JWordCommentsAdapter
} from './comments/types'
export type {
  CreateLinkControllerOptions,
  JWordLinkAdapter,
  JWordLinkDraft,
  JWordLinkUrlPolicy,
  LinkControllerHandle
} from './link/types'
export {
  createFindReplaceState,
  normalizeFindReplaceDraft,
  readFindDisabled,
  readReplaceDisabled
} from './find-replace/state'
export { createHeadingOutlineController } from './heading/controller'
export type {
  FindReplaceDraft,
  FindReplaceState
} from './find-replace/state'
export type {
  CreateHeadingOutlineControllerOptions,
  HeadingOutlineControllerHandle
} from './heading/controller'
export { BUILTIN_TOOL_IDS as BUILTIN_JWORD_TOOL_IDS } from './toolbar/builtin-tools'
export { DEFAULT_JWORD_MEDIA_URL_POLICY, isAllowedJWordMediaUrl } from './media/policy'
export { DEFAULT_JWORD_LINK_PROTOCOL_ALLOWLIST, isAllowedJWordLinkUrl } from './link/policy'
