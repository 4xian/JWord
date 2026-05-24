/**
 * 职责：提供 editor 当前用户上下文的最小默认值和归一化逻辑。
 * 边界：只处理纯数据身份快照，不访问 DOM、不写入 Y.Doc、不依赖 UI 作者目录。
 * 协作模块：editor state/types 与 comment/revision builder 复用同一 authorId 来源。
 * 性能/安全约束：默认值稳定且可序列化；空白字段会回退到单用户本地身份。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---用户身份底座与作者目录step-48-前置。
 */

import type { EditorUser, EditorUserInput } from './types'

export const DEFAULT_EDITOR_USER: EditorUser = createEditorUser({
  authorId: 'local-user'
})

/**
 * 创建对外公开的稳定用户快照。
 */
function createEditorUser(
  input: Readonly<{
    authorId: string
    name?: string
    avatarUrl?: string
    color?: string
  }>
): EditorUser {
  return Object.freeze({
    authorId: input.authorId,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.avatarUrl === undefined ? {} : { avatarUrl: input.avatarUrl }),
    ...(input.color === undefined ? {} : { color: input.color })
  })
}

/**
 * 归一化当前用户输入，保证 authorId 链路总能拿到稳定本地用户。
 */
export function normalizeEditorUser(user: EditorUserInput | undefined): EditorUser {
  const normalizedAuthorId = user?.authorId?.trim() ?? user?.id?.trim()

  if (normalizedAuthorId === undefined || normalizedAuthorId.length === 0) {
    return DEFAULT_EDITOR_USER
  }

  const normalizedDisplayName = user?.displayName?.trim() ?? user?.name?.trim()
  const normalizedAvatarUrl = user?.avatarUrl?.trim()
  const normalizedColor = user?.color?.trim()

  return createEditorUser({
    authorId: normalizedAuthorId,
    ...(normalizedDisplayName === undefined || normalizedDisplayName.length === 0 ? {} : { name: normalizedDisplayName }),
    ...(normalizedAvatarUrl === undefined || normalizedAvatarUrl.length === 0
      ? {}
      : { avatarUrl: normalizedAvatarUrl }),
    ...(normalizedColor === undefined || normalizedColor.length === 0
      ? {}
      : { color: normalizedColor })
  })
}
