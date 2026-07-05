/**
 * 职责：保存 JWordEditor 的共享状态、构造流程和销毁态断言。
 * 边界：不承载输入、渲染、布局查询和文档编辑细节。
 * 协作模块：文档存储、事务流水线、历史记录、布局配置和编辑器分层运行时。
 * 性能/安全约束：构造函数和顶层代码不访问浏览器对象，DOM 只在挂载后创建，编辑命令统一进入事务流水线。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 04-engineering-standards.md#45-模块边界。
 */
import { createDocumentStore } from '../model/document-store'
import type { DocumentStore } from '../model/document-store'
import { DOCUMENT_STORE_FIELDS } from '../model/document-store'
import { createDocumentProjection } from '../model/projection'
import { createJWordError } from '../shared/errors'
import { createFontManager, type FontManager } from '../layout/font-manager'
import { createHistoryManager } from '../operations/history'
import type { PageConfig, PageConfigInput, PageMargins, PagePreset } from '../layout/page-config'
import type { DocumentLayout, LayoutDirtyRange, LayoutOptions } from '../layout/runtime'
import { createPageConfig } from '../layout/page-config'
import type { ModelProperties } from '../model/types'
import type { DocumentProjection } from '../model/projection'
import type { SelectionState } from '../model/selection'
import { createTransactionPipeline } from '../operations/transaction'
import type { TextPosition, TransactionEvent } from '../operations/transaction'
import type { ResourceAdapter, ResourceUrlPolicy } from '../resources/types'
import { DEFAULT_EDITOR_LABEL, DOCUMENT_CREATE_ORIGIN } from './constants'
import { normalizeEditorUser } from './current-user'
import type { EditorDocumentInput, EditorEvent, EditorEventListener, EditorOptions, MountedEditorDom, RenderReason } from './types'
import type { EditorUser } from './types'
import type { InitialFocusPosition } from './types'
import type * as Y from 'yjs'

export interface EditorInternalRuntimeOptions {
  readonly document?: Y.Doc
}

export type EditorSharedTransactionDispatcher = (event: TransactionEvent) => void

export abstract class JWordEditorState {
  protected readonly label: string
  protected readonly store: DocumentStore
  protected readonly pipeline: ReturnType<typeof createTransactionPipeline>
  protected readonly history: ReturnType<typeof createHistoryManager>
  protected readonly resourceAdapter: ResourceAdapter | undefined
  protected readonly resourceUrlPolicy: ResourceUrlPolicy | undefined
  protected readonly currentUser: EditorUser
  protected readonly initialFocusPosition: InitialFocusPosition
  protected pageConfig: PageConfig
  protected fontManager: FontManager = createFontManager()
  protected readonly layoutOptions: LayoutOptions
  protected readonly listeners = new Set<EditorEventListener>()
  protected readonly unsubscribePipeline: () => void
  protected currentProjection!: DocumentProjection
  protected cachedLayout: DocumentLayout | undefined
  protected layoutDirtyRange: LayoutDirtyRange | undefined
  protected layoutNeedsRefresh = false
  protected pageStartKeys: readonly string[] = []
  protected dirtyPageIndex = 0
  protected dirtyPageEndIndex = 0
  protected pendingLayoutContinuation: Readonly<{
    dirtyPageIndex: number
    dirtyPageEndIndex: number
    startPosition: TextPosition
  }> | undefined
  protected deferredTextMirrorSyncId: ReturnType<typeof setTimeout> | undefined
  protected deferredDocumentRenderId: ReturnType<typeof setTimeout> | undefined
  protected mountedDom: MountedEditorDom | undefined
  protected deferredSelectionChangeId: ReturnType<typeof setTimeout> | undefined
  protected deferredPointerSelectionRenderId: ReturnType<typeof setTimeout> | undefined
  protected deferredPointerAutoScrollId: ReturnType<typeof setInterval> | undefined
  protected caretBlinkIntervalId: ReturnType<typeof setInterval> | undefined
  protected caretBlinkVisible = true
  protected isInputFocused = false
  protected currentSelection: SelectionState | null = null
  protected pendingCollapsedRunProperties: ModelProperties | undefined
  protected selectionPageIndexes: readonly number[] = []
  protected mountedTextMirrorNeedsRefresh = true
  protected rangeSnapshotSequence = 0
  protected isDestroyed = false
  private sharedTransactionDispatcher: EditorSharedTransactionDispatcher | undefined

  constructor(options?: EditorOptions, internalOptions: EditorInternalRuntimeOptions = {}) {
    this.label = options?.label ?? DEFAULT_EDITOR_LABEL
    this.currentUser = normalizeEditorUser(options?.currentUser)
    this.initialFocusPosition = options?.initialFocusPosition ?? 'end'
    this.pageConfig = createPageConfig(options?.page)
    this.resourceAdapter = options?.resourceAdapter
    this.resourceUrlPolicy = options?.resourceUrlPolicy
    this.layoutOptions = Object.freeze({
      keepLatinWordWholeOnWrap: options?.layout?.keepLatinWordWholeOnWrap ?? false
    })
    this.store = createDocumentStore(internalOptions.document)
    this.pipeline = createTransactionPipeline(this.store.doc, {
      ...(this.resourceUrlPolicy === undefined ? {} : { resourceUrlPolicy: this.resourceUrlPolicy })
    })
    this.history = createHistoryManager(this.store)
    this.unsubscribePipeline = this.pipeline.subscribe((event) => {
      this.handleTransactionEvent(event)
      this.sharedTransactionDispatcher?.(event)
    })
    if (shouldInitializeEditorDocument(this.store, options)) {
      this.replaceDocument(
        {
          ...(options?.initialText === undefined ? {} : { text: options.initialText }),
          ...(options?.resources === undefined ? {} : { resources: options.resources })
        },
        'createDocument',
        DOCUMENT_CREATE_ORIGIN
      )
    } else {
      this.currentProjection = createDocumentProjection(this.store)
    }
  }

  protected abstract cancelDeferredDocumentRender(): void
  protected abstract renderMountedLayout(reason: RenderReason): void
  protected abstract emit(event: EditorEvent): void
  protected abstract replaceDocument(input: EditorDocumentInput, commandName: string, origin: string): DocumentProjection
  protected abstract refreshSelectionAfterSharedTransaction(previousSelection: SelectionState | null): void

  /** 设置共享协同文档的内部事务广播器。 */
  setSharedTransactionDispatcher(dispatcher: EditorSharedTransactionDispatcher | undefined): void {
    this.sharedTransactionDispatcher = dispatcher
  }

  /** 从同一个共享 Y.Doc 的其他 Editor 事务刷新本实例投影。 */
  refreshFromSharedTransaction(event: TransactionEvent): void {
    this.assertActive()
    const previousSelection = this.currentSelection

    this.handleTransactionEvent({
      ...event,
      projection: createDocumentProjection(this.store)
    })
    this.refreshSelectionAfterSharedTransaction(previousSelection)
  }

  /** 应用 transaction pipeline 事件到本实例状态和订阅者。 */
  protected handleTransactionEvent(event: TransactionEvent): void {
    this.currentProjection = event.projection
    this.layoutNeedsRefresh = true
    this.mountedTextMirrorNeedsRefresh = true
    this.cancelDeferredDocumentRender()
    this.renderMountedLayout('document')

    this.emit({ kind: 'transaction', transaction: event })
  }

  /**
   * 职责：读取当前共享页面配置。
   */
  protected readPageConfig(): PageConfig {
    return this.pageConfig
  }

  /**
   * 职责：更新页面配置，并把当前缓存布局标记为需要从第一页重新分页。
   */
  protected applyPageConfig(input: PageConfigInput): PageConfig {
    const nextPageConfig = createNextPageConfig(this.pageConfig, input)

    this.pageConfig = nextPageConfig
    this.layoutNeedsRefresh = true
    this.dirtyPageIndex = 0
    this.dirtyPageEndIndex = Math.max(0, (this.cachedLayout?.pages.length ?? 1) - 1)
    this.layoutDirtyRange = undefined
    this.pendingLayoutContinuation = undefined
    this.pageStartKeys = []
    this.selectionPageIndexes = []
    this.cancelDeferredDocumentRender()

    return nextPageConfig
  }

  protected assertActive(): void {
    if (this.isDestroyed) {
      throw createJWordError('EDITOR_DESTROYED', 'JWord editor has been destroyed.')
    }
  }
}

function shouldInitializeEditorDocument(store: DocumentStore, options: EditorOptions | undefined): boolean {
  if (options?.initialText !== undefined || options?.resources !== undefined) {
    return true
  }

  return store.document.get(DOCUMENT_STORE_FIELDS.document.schemaVersion) === undefined
}

function createNextPageConfig(current: PageConfig, input: PageConfigInput): PageConfig {
  const shouldUseCustomSize = input.widthTwips !== undefined
    || input.heightTwips !== undefined
    || (current.preset === 'custom' && input.preset === undefined)
  const marginTwips = mergePageMargins(current.marginTwips, input.marginTwips)

  if (shouldUseCustomSize) {
    return createPageConfig({
      widthTwips: input.widthTwips ?? current.widthTwips,
      heightTwips: input.heightTwips ?? current.heightTwips,
      orientation: input.orientation ?? current.orientation,
      marginTwips,
      scale: input.scale ?? current.scale
    })
  }

  return createPageConfig({
    preset: resolveNextPreset(current, input),
    orientation: input.orientation ?? current.orientation,
    marginTwips,
    scale: input.scale ?? current.scale
  })
}

function resolveNextPreset(current: PageConfig, input: PageConfigInput): PagePreset {
  if (input.preset !== undefined) {
    return input.preset
  }

  return current.preset === 'custom' ? 'a4' : current.preset
}

function mergePageMargins(current: PageMargins, input: Partial<PageMargins> | undefined): PageMargins {
  if (input === undefined) {
    return current
  }

  return Object.freeze({
    top: input.top ?? current.top,
    right: input.right ?? current.right,
    bottom: input.bottom ?? current.bottom,
    left: input.left ?? current.left
  })
}
