/**
 * 职责：集中保存 editor runtime 使用的稳定常量。
 * 边界：不放置可变状态，不访问 DOM，不依赖文档实例。
 * 协作模块：editor state、DOM runtime、渲染调度和输入 runtime。
 * 性能/安全约束：constructor/top-level 不访问 window/document/HTMLElement 实例，DOM 只在 mount 后创建，编辑命令统一进入 transaction pipeline。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
export const DEFAULT_EDITOR_LABEL = 'JWord editor'
export const DEFAULT_DOCUMENT_ID = 'document-1'
export const DEFAULT_SECTION_ID = 'section-1'
export const DOCUMENT_CREATE_ORIGIN = 'jword-document'
export const FIXTURE_LOAD_ORIGIN = 'jword-fixture'
export const POINTER_MULTI_CLICK_GRACE_MS = 80
export const CARET_BLINK_INTERVAL_MS = 530
export const DEFERRED_DOCUMENT_RENDER_DELAY_MS = 40
export const DEFERRED_TEXT_MIRROR_SYNC_DELAY_MS = 40
