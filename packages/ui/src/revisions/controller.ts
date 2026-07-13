/**
 * 职责：连接 Gate 4 修订 metadata 面板与 core range snapshot 定位、接受和拒绝能力。
 * 边界：只显示现有 revision metadata、点击恢复选区并调用 core 修订命令，不创建修订。
 * 协作模块：revisions DOM、core editor facade 和 create-ui 装配入口。
 * 性能/安全约束：点击时只读取当前 projection，不旁路修改文档模型。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildAcceptRevisionCommand,
  buildRejectRevisionCommand,
  createSelectionState,
  type Editor,
  type TextPosition
} from '@4xian/jword-core'
import {
  createRevisionPanelDom,
  destroyRevisionPanelDom,
  localizeRevisionPanelDom,
  renderRevisionPanel
} from './dom'
import {
  readJWordUiText,
  resolveJWordUiI18n,
  type ResolvedJWordUiI18n
} from '../i18n'
import type { JWordRevisionPanelElements } from '../types'

export interface CreateRevisionControllerOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly i18n?: ResolvedJWordUiI18n
  readonly announce?: (message: string) => void
  readonly onClose?: () => void
}

export interface RevisionControllerHandle {
  readonly elements: JWordRevisionPanelElements
  setI18n(i18n: ResolvedJWordUiI18n): void
  refresh(): void
  destroy(): void
}

/**
 * 创建修订 metadata 面板 controller。
 */
export function createRevisionController(
  options: CreateRevisionControllerOptions
): RevisionControllerHandle {
  let i18n = options.i18n ?? resolveJWordUiI18n()
  const elements = createRevisionPanelDom(options.host, i18n)
  const signalController = new AbortController()
  let selectedId: string | null = null
  let destroyed = false

  /** 点击定位或处理修订 range。 */
  function handleRevisionClick(event: Event): void {
    const target = event.target

    if (!(target instanceof HTMLElement)) {
      return
    }

    const actionButton = target.closest<HTMLButtonElement>('[data-jword-revision-accept], [data-jword-revision-reject]')
    const actionRevisionId = actionButton?.getAttribute('data-jword-revision-id')

    if (actionButton !== null && actionRevisionId !== undefined && actionRevisionId !== null) {
      if (actionButton.hasAttribute('data-jword-revision-accept')) {
        resolveRevision(actionRevisionId, 'accept')
        return
      }

      resolveRevision(actionRevisionId, 'reject')
      return
    }

    const button = target.closest<HTMLButtonElement>('[data-jword-revision-item]')
    const revisionId = button?.getAttribute('data-jword-revision-id')

    if (revisionId === undefined || revisionId === null) {
      return
    }

    focusRevision(revisionId)
  }

  /** 把指定 revision 的 range 恢复为当前 selection。 */
  function focusRevision(revisionId: string): void {
    const revision = options.editor.getProjection().document.revisions?.find((candidate) => candidate.id === revisionId)

    if (revision === undefined) {
      options.announce?.(readJWordUiText(i18n, 'a11y.revisions.missing'))
      return
    }

    const range = options.editor.locateRangeSnapshot(revision.rangeSnapshot)

    if (range === null) {
      options.announce?.(readJWordUiText(i18n, 'a11y.revisions.rangeUnavailable'))
      return
    }

    options.editor.setSelection(createSelectionState(
      createAnchorFromPosition(options.editor, range.anchor),
      createAnchorFromPosition(options.editor, range.focus)
    ))
    selectedId = revision.id
    options.announce?.(readJWordUiText(i18n, 'a11y.revisions.focused'))
    refresh()
  }

  /** 执行单条修订接受或拒绝。 */
  function resolveRevision(revisionId: string, action: 'accept' | 'reject'): void {
    const command = action === 'accept'
      ? buildAcceptRevisionCommand(options.editor.getProjection(), revisionId)
      : buildRejectRevisionCommand(options.editor.getProjection(), revisionId)

    if (command === null) {
      options.announce?.(readJWordUiText(i18n, 'a11y.revisions.missing'))
      return
    }

    options.editor.executeCommand(command)
    selectedId = null
    options.announce?.(readJWordUiText(
      i18n,
      action === 'accept' ? 'a11y.revisions.accepted' : 'a11y.revisions.rejected'
    ))
    refresh()
  }

  /** 从当前 projection 刷新列表。 */
  function refresh(): void {
    if (destroyed) {
      return
    }

    renderRevisionPanel(elements, {
      revisions: options.editor.getProjection().document.revisions ?? [],
      selectedId
    }, i18n)
  }

  /** 销毁 controller。 */
  function destroy(): void {
    if (destroyed) {
      return
    }

    destroyed = true
    signalController.abort()
    destroyRevisionPanelDom(elements)
  }

  elements.list.addEventListener('click', handleRevisionClick, {
    signal: signalController.signal
  })
  elements.closeButton.addEventListener('click', () => {
    options.onClose?.()
  }, {
    signal: signalController.signal
  })
  refresh()

  return {
    elements,
    setI18n(nextI18n): void {
      i18n = nextI18n
      localizeRevisionPanelDom(elements, i18n)
      refresh()
    },
    refresh,
    destroy
  }
}

/** 基于可序列化文本位置创建 editor anchor。 */
function createAnchorFromPosition(editor: Editor, position: TextPosition) {
  return editor.createTextAnchor({
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    graphemeIndex: position.graphemeIndex,
    ...(position.assoc === undefined ? {} : { assoc: position.assoc })
  })
}
