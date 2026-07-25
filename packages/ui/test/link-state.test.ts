/**
 * @vitest-environment node
 *
 * 职责：锁定 link 状态机的最小纯函数契约。
 * 边界：只验证 draft、validation 与 confirm 禁用规则，不碰 DOM 或 adapter。
 * 协作模块：packages/ui/src/link/state.ts 与 packages/ui/src/link/policy.ts。
 * 约束：插入时可预填显示文本，编辑时可复用现有链接草稿。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, test } from 'vitest'
import {
  createLinkDialogState,
  normalizeLinkDraft,
  readLinkConfirmDisabled,
  readLinkValidationError
} from '../src/link/state'

describe('link state', () => {
  test('会保留 selection 文本并规范化草稿', () => {
    const insertState = createLinkDialogState('insert', {
      visibleText: '选中文本'
    })
    const editState = createLinkDialogState('edit', {
      visibleText: '旧标题',
      url: 'https://example.com',
      tooltip: ' 说明 '
    })

    expect(insertState.mode).toBe('insert')
    expect(insertState.draft.visibleText).toBe('选中文本')
    expect(editState.mode).toBe('edit')
    expect(editState.draft.url).toBe('https://example.com')
    expect(normalizeLinkDraft({
      visibleText: '  标题  ',
      url: ' https://example.com/path ',
      tooltip: ' 备注 '
    })).toEqual({
      visibleText: '标题',
      url: 'https://example.com/path',
      tooltip: '备注'
    })
  })

  test('会拒绝空显示文本与危险协议并禁用确认按钮', () => {
    const blankTextState = createLinkDialogState('insert', {
      visibleText: '',
      url: 'https://example.com',
      tooltip: ''
    })
    const invalidUrlState = createLinkDialogState('edit', {
      visibleText: '链接标题',
      url: 'javascript:alert(1)',
      tooltip: ''
    })
    const validState = createLinkDialogState('edit', {
      visibleText: '链接标题',
      url: 'mailto:test@example.com',
      tooltip: ''
    })

    expect(readLinkValidationError(blankTextState.draft)).toBe('请输入显示文本。')
    expect(readLinkValidationError(invalidUrlState.draft)).toBe('链接地址协议不受支持。')
    expect(readLinkConfirmDisabled(blankTextState)).toBe(true)
    expect(readLinkConfirmDisabled(invalidUrlState)).toBe(true)
    expect(readLinkConfirmDisabled(validState)).toBe(false)
  })
})
