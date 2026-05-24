/**
 * 职责：驱动 Gate 4.10 link panel，连接宿主 adapter 回调与内部 state/dom。
 * 边界：不直接打开窗口、不修改 editor，不把错误抛给宿主未处理异常；这里只维护 UI 状态并调度回调。
 * 协作模块：link/dom 负责节点结构，link/state 负责纯状态计算，link/policy 负责协议 allowlist。
 * 性能/安全约束：public API 只保留插入弹窗、设置当前链接和销毁；打开链接必须经宿主回调，不调用 window.open。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.10。
 */

import { createLinkPanelDom, destroyLinkPanel, renderLinkPanel } from './dom'
import { createLinkDialogState, normalizeLinkDraft, readLinkValidationError } from './state'
import type {
  CreateLinkControllerOptions,
  JWordLinkAdapter,
  JWordLinkDialogState,
  JWordLinkDraft,
  LinkControllerHandle
} from './types'

/** 创建 Gate 4.10 link controller。 */
export function createLinkController(options: CreateLinkControllerOptions): LinkControllerHandle {
  const dom = createLinkPanelDom(options.host)
  const signalController = new AbortController()
  const adapter = resolveLinkAdapter(options)
  const policy = options.policy ?? {}
  const viewportHost = options.viewportHost ?? options.host
  const readonlyMode = options.readonly === true || (typeof options.readonly === 'object' && options.readonly.enabled === true)
  let activeLink: JWordLinkDraft | null = null
  let quickToolsVisible = false
  let dialog: JWordLinkDialogState | null = null

  /** 用当前状态刷新 link panel。 */
  function refresh(): void {
    placeDialogAtViewportCenter(dom.dialog, viewportHost)
    renderLinkPanel(dom, {
      activeLink,
      quickToolsVisible,
      dialog,
      readonly: readonlyMode
    }, policy)
  }

  /** 关闭当前 dialog。 */
  function closeDialog(): void {
    dialog = null
    refresh()
  }

  /** 读取当前 dialog 草稿。 */
  function readDialogDraft(): JWordLinkDraft | null {
    if (dialog === null) {
      return null
    }

    return normalizeLinkDraft(dialog.draft)
  }

  /** 把未知异常归一化成 UI 可显示的错误文案。 */
  function normalizeLinkError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message
    }

    if (typeof error === 'string' && error.trim().length > 0) {
      return error
    }

    return fallback
  }

  /** 让 dialog 进入忙碌态。 */
  function setDialogBusy(busy: boolean): void {
    if (dialog === null) {
      return
    }

    dialog = {
      ...dialog,
      busy
    }
  }

  /** 把错误写回当前 dialog。 */
  function setDialogError(message: string): void {
    if (dialog === null) {
      return
    }

    dialog = {
      ...dialog,
      error: message,
      busy: false
    }
  }

  /** 打开插入弹窗，并按当前选中文本预填显示文本。 */
  function openInsertDialog(selectionText = ''): void {
    if (readonlyMode) {
      return
    }

    quickToolsVisible = false
    dialog = createLinkDialogState('insert', {
      visibleText: selectionText
    })
    refresh()
  }

  /** 打开编辑弹窗，并复用当前 active link 草稿。 */
  function openEditDialog(): void {
    if (readonlyMode) {
      return
    }

    if (activeLink === null) {
      return
    }

    quickToolsVisible = false
    dialog = createLinkDialogState('edit', activeLink)
    refresh()
  }

  /** 点击正文链接时切换快捷工具显隐。 */
  function toggleQuickTools(link: JWordLinkDraft): void {
    const nextLink = normalizeLinkDraft(link)
    const sameLink = areLinkDraftsEqual(activeLink, nextLink)

    activeLink = nextLink
    quickToolsVisible = sameLink ? !quickToolsVisible : true
    dialog = null
    refresh()
  }

  /** 用当前 active link 走宿主打开回调。 */
  async function handleOpenLink(): Promise<void> {
    if (activeLink === null) {
      return
    }

    try {
      await adapter.openLink(activeLink)
    } catch (error) {
      dialog = createLinkDialogState('edit', activeLink)
      setDialogError(normalizeLinkError(error, '打开链接失败，请重试。'))
      refresh()
    }
  }

  /** 提交当前 dialog 草稿。 */
  async function handleConfirm(): Promise<void> {
    if (readonlyMode) {
      return
    }

    const draft = readDialogDraft()

    if (draft === null) {
      return
    }

    const validationError = readLinkValidationError(draft, policy)

    if (validationError.length > 0) {
      setDialogError(validationError)
      refresh()
      return
    }

    setDialogBusy(true)
    refresh()

    try {
      await adapter.submitLink({
        mode: dialog?.mode ?? 'insert',
        draft
      })
      activeLink = draft
      closeDialog()
    } catch (error) {
      setDialogError(normalizeLinkError(error, '保存链接失败，请重试。'))
      refresh()
    }
  }

  /** 移除当前 active link。 */
  async function handleRemoveLink(): Promise<void> {
    if (readonlyMode) {
      return
    }

    if (activeLink === null) {
      return
    }

    if (dialog !== null) {
      setDialogBusy(true)
      refresh()
    }

    try {
      const removedLink = activeLink
      await adapter.removeLink(removedLink)
      activeLink = null
      quickToolsVisible = false
      closeDialog()
    } catch (error) {
      if (dialog === null) {
        dialog = createLinkDialogState('edit', activeLink ?? undefined)
      }
      setDialogError(normalizeLinkError(error, '移除链接失败，请重试。'))
      refresh()
    }
  }

  /** 把输入框值同步回当前 dialog 草稿。 */
  function syncDialogDraft(): void {
    if (dialog === null) {
      return
    }

    dialog = {
      ...dialog,
      draft: normalizeLinkDraft({
        visibleText: dom.visibleTextInput.value,
        url: dom.urlInput.value,
        tooltip: dialog.draft.tooltip
      }),
      error: ''
    }
    refresh()
  }

  /** 绑定 panel 的输入和动作事件。 */
  function bindEvents(): void {
    dom.visibleTextInput.addEventListener('input', syncDialogDraft, {
      signal: signalController.signal
    })
    dom.urlInput.addEventListener('input', syncDialogDraft, {
      signal: signalController.signal
    })
    dom.cancelButton.addEventListener('click', closeDialog, {
      signal: signalController.signal
    })
    dom.confirmButton.addEventListener('click', () => {
      void handleConfirm()
    }, { signal: signalController.signal })
    dom.openLinkButton.addEventListener('click', () => {
      void handleOpenLink()
    }, { signal: signalController.signal })
    dom.editLinkButton.addEventListener('click', openEditDialog, {
      signal: signalController.signal
    })
    dom.removeLinkButton.addEventListener('click', () => {
      void handleRemoveLink()
    }, { signal: signalController.signal })
  }

  bindEvents()
  refresh()

  return {
    elements: dom,
    openInsertDialog,
    openEditDialog,
    toggleQuickTools,
    /** 设置当前 active link 并刷新 UI。 */
    setActiveLink(link: JWordLinkDraft | null): void {
      const nextLink = link === null ? null : normalizeLinkDraft(link)
      const sameLink = areLinkDraftsEqual(activeLink, nextLink)

      activeLink = nextLink

      if (activeLink === null || !sameLink) {
        quickToolsVisible = false
        dialog = null
      }

      refresh()
    },
    /** 销毁 controller 并移除 DOM。 */
    destroy(): void {
      signalController.abort()
      destroyLinkPanel(dom)
    }
  }
}

/** 判断两个链接草稿是否指向同一个可编辑目标。 */
function areLinkDraftsEqual(left: JWordLinkDraft | null, right: JWordLinkDraft | null): boolean {
  return left?.visibleText === right?.visibleText
    && left?.url === right?.url
    && left?.tooltip === right?.tooltip
}

/** 把链接弹框定位到编辑器可视区域中心。 */
function placeDialogAtViewportCenter(dialog: HTMLElement, viewportHost: HTMLElement): void {
  const rect = viewportHost.getBoundingClientRect()
  const viewportWidth = viewportHost.clientWidth || rect.width
  const viewportHeight = viewportHost.clientHeight || rect.height
  const left = rect.left + viewportWidth / 2
  const top = rect.top + viewportHeight / 2

  dialog.style.left = `${left}px`
  dialog.style.top = `${top}px`
  dialog.style.transform = 'translate(-50%, -50%)'
}

/** 把 options 归一化成 controller 需要的最小 adapter。 */
function resolveLinkAdapter(options: CreateLinkControllerOptions): JWordLinkAdapter {
  if (options.adapter !== undefined) {
    return options.adapter
  }

  const submitLink = options.actions?.submit

  if (submitLink === undefined) {
    return {
      /** 缺省情况下不执行打开动作。 */
      openLink(): void {},
      /** 缺省情况下拒绝提交，因为宿主没有注入保存能力。 */
      submitLink(): void {
        throw new Error('宿主未提供保存链接能力。')
      },
      /** 缺省情况下拒绝移除，因为宿主没有注入移除能力。 */
      removeLink(): void {
        throw new Error('宿主未提供移除链接能力。')
      }
    }
  }

  return {
    /** 交给宿主处理链接打开。 */
    openLink: options.actions?.openLink ?? (() => {}),
    /** 交给宿主处理链接保存。 */
    submitLink,
    /** 交给宿主处理链接移除。 */
    removeLink: options.actions?.removeLink ?? (() => {})
  }
}
