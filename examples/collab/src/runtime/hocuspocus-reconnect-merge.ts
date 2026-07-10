/**
 * 职责：计算 Hocuspocus 离线重连时本地 pending 文本与远端候选文本的最小合并结果。
 * 边界：只处理纯文本 diff/rebase，不访问 Y.Doc、provider、DOM 或 IndexedDB。
 * 协作：hocuspocus-runtime.ts 在重连冲突后用 system-recovery 写回合并结果。
 * 约束：合并只补回本地 pending 文本，不生成历史版本、不修改当前文档。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

interface ReconnectTextDiff {
  readonly start: number
  readonly insertedText: string
}

/** 构造包含远端候选和本地 pending 文本的断网冲突修复正文。 */
export function buildReconnectConflictText(
  offlineBaseText: string,
  pendingLocalText: string,
  mergedText: string
): string | null {
  if (mergedText.includes(pendingLocalText)) {
    return null
  }

  const localDiff = createReconnectTextDiff(offlineBaseText, pendingLocalText)
  const remoteCandidate = removeLocalInsertedPrefixFromMergedText(mergedText, localDiff)
  const resolvedParts = remoteCandidate === null || remoteCandidate.length === 0
    ? [mergedText, pendingLocalText]
    : [remoteCandidate, pendingLocalText]

  return resolvedParts.filter((part, index, parts) =>
    part.length > 0 && parts.indexOf(part) === index
  ).join('\n')
}

/** 从合并结果中移除本地 replacement 已插入的连续前缀，得到远端候选文本。 */
function removeLocalInsertedPrefixFromMergedText(mergedText: string, localDiff: ReconnectTextDiff): string | null {
  if (localDiff.insertedText.length === 0) {
    return null
  }

  const mergedGraphemes = Array.from(mergedText)
  const insertedGraphemes = Array.from(localDiff.insertedText)
  let matchedLength = 0

  while (
    matchedLength < insertedGraphemes.length &&
    mergedGraphemes[localDiff.start + matchedLength] === insertedGraphemes[matchedLength]
  ) {
    matchedLength += 1
  }

  if (matchedLength === 0) {
    return null
  }

  return [
    ...mergedGraphemes.slice(0, localDiff.start),
    ...mergedGraphemes.slice(localDiff.start + matchedLength)
  ].join('')
}

/** 计算断网前正文到 pending 本地正文的最小 replacement diff。 */
function createReconnectTextDiff(previousText: string, nextText: string): ReconnectTextDiff {
  const previousGraphemes = Array.from(previousText)
  const nextGraphemes = Array.from(nextText)
  let prefixLength = 0
  let suffixLength = 0

  while (
    prefixLength < previousGraphemes.length &&
    prefixLength < nextGraphemes.length &&
    previousGraphemes[prefixLength] === nextGraphemes[prefixLength]
  ) {
    prefixLength += 1
  }

  while (
    suffixLength + prefixLength < previousGraphemes.length &&
    suffixLength + prefixLength < nextGraphemes.length &&
    previousGraphemes[previousGraphemes.length - 1 - suffixLength] ===
      nextGraphemes[nextGraphemes.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }

  return {
    start: prefixLength,
    insertedText: nextGraphemes.slice(prefixLength, nextGraphemes.length - suffixLength).join('')
  }
}
