/**
 * 职责：构造 command-builders 入口保留的链接插入、编辑和删除命令。
 * 边界：只生成 insertText 与 setRunLink 操作，不执行事务、不打开链接。
 * 协作模块：选区目标、链接策略、共享 run 定位辅助函数与事务流水线共同提供链接命令。
 * 性能/安全约束：构造前校验链接 URL allowlist，选区命中 run 后仅生成必要 operation。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { isAllowedLinkUrl } from '../links/policy'
import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import { isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import type { RunLink } from '../model/types'
import { countGraphemes } from '../shared/grapheme'
import { createJWordError } from '../shared/errors'
import {
  allocateGeneratedRunId,
  collectRunIds,
  resolveSelectionInsertionContext
} from './command-builder-utils'
import type { Command, Operation } from './transaction'

/**
 * 构造链接插入命令。
 */
export function buildInsertLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: Readonly<{
    target: string
    tooltip?: string
    displayText?: string
  }>
): Command | null {
  assertAllowedLinkUrl(input.target)

  if (selection !== null && isSelectionCollapsed(selection)) {
    const displayText = input.displayText?.trim() ?? ''

    if (displayText.length === 0) {
      return null
    }

    const insertion = resolveSelectionInsertionContext(projection, selection)

    if (insertion === null) {
      return null
    }

    const usedRunIds = collectRunIds(projection)
    const displayTextLength = countGraphemes(displayText)
    const link = createRunLink(input)

    return {
      name: 'insertLink',
      operations: [{
        kind: 'insertText',
        at: insertion.at,
        text: displayText
      }, {
        kind: 'setRunLink',
        runId: insertion.run.id,
        link,
        range: {
          startGraphemeIndex: insertion.at.graphemeIndex,
          endGraphemeIndex: insertion.at.graphemeIndex + displayTextLength,
          ...(insertion.at.graphemeIndex > 0
            ? { linkedRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'link') }
            : {}),
          ...(insertion.at.graphemeIndex < insertion.graphemeLength
            ? { trailingRunId: allocateGeneratedRunId(usedRunIds, insertion.run.id, 'tail') }
            : {})
        }
      }]
    }
  }

  return buildSetLinkCommand(projection, selection, 'insertLink', createRunLink(input))
}

/**
 * 构造链接编辑命令。
 */
export function buildEditLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  input: Readonly<{
    target: string
    tooltip?: string
  }>
): Command | null {
  assertAllowedLinkUrl(input.target)

  return buildSetLinkCommand(projection, selection, 'editLink', createRunLink(input))
}

/**
 * 构造链接删除命令。
 */
export function buildDeleteLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null
): Command | null {
  return buildSetLinkCommand(projection, selection, 'deleteLink', null)
}

function buildSetLinkCommand(
  projection: DocumentProjection,
  selection: SelectionState | null,
  name: string,
  link: RunLink | null
): Command | null {
  const targets = collectSelectionTargets(projection, selection)
  const usedRunIds = collectRunIds(projection)

  if (targets.runs.length === 0) {
    return null
  }

  const operations: Operation[] = targets.runs.flatMap((target) => {
    if (isRunLinkEquivalent(target.run.link, link)) {
      return []
    }

    const isWholeRunSelection =
      target.selectedStartGraphemeIndex === 0
      && target.selectedEndGraphemeIndex === target.graphemeLength

    if (isWholeRunSelection) {
      return [{
        kind: 'setRunLink',
        runId: target.run.id,
        link
      }]
    }

    return [{
      kind: 'setRunLink',
      runId: target.run.id,
      link,
      range: {
        startGraphemeIndex: target.selectedStartGraphemeIndex,
        endGraphemeIndex: target.selectedEndGraphemeIndex,
        ...(target.selectedStartGraphemeIndex > 0
          ? { linkedRunId: allocateGeneratedRunId(usedRunIds, target.run.id, 'link') }
          : {}),
        ...(target.selectedEndGraphemeIndex < target.graphemeLength
          ? { trailingRunId: allocateGeneratedRunId(usedRunIds, target.run.id, 'tail') }
          : {})
      }
    }]
  })

  if (operations.length === 0) {
    return null
  }

  return {
    name,
    operations
  }
}

function createRunLink(input: Readonly<{ target: string, tooltip?: string }>): RunLink {
  const normalizedTarget = input.target.trim()
  const normalizedTooltip = input.tooltip?.trim()

  return normalizedTooltip === undefined || normalizedTooltip.length === 0
    ? {
        target: normalizedTarget
      }
    : {
        target: normalizedTarget,
        tooltip: normalizedTooltip
      }
}

function assertAllowedLinkUrl(target: string): void {
  if (isAllowedLinkUrl(target)) {
    return
  }

  throw createJWordError('OPERATION_LINK_URL_DISALLOWED', '链接 URL 不在 allowlist 内', {
    target
  })
}

function isRunLinkEquivalent(currentLink: RunLink | undefined, nextLink: RunLink | null): boolean {
  if (nextLink === null) {
    return currentLink === undefined
  }

  return currentLink?.target === nextLink.target
    && currentLink?.tooltip === nextLink.tooltip
}
