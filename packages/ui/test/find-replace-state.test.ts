/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 4 查找替换 UI 草稿的最小纯状态契约。
 * 边界：只验证查找词、替换词归一化和按钮禁用规则，不创建页面节点或调用编辑器。
 * 协作模块：packages/ui/src/find-replace/state.ts。
 * 约束：UI 状态保持轻量，不保存 projection 副本。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.12。
 */

import { describe, expect, test } from 'vitest'

import {
  createFindReplaceState,
  normalizeFindReplaceDraft,
  readFindDisabled,
  readReplaceDisabled
} from '../src/find-replace/state'

describe('find replace state', () => {
  test('会规范化查找替换草稿并根据结果数量禁用动作', () => {
    const emptyState = createFindReplaceState({
      query: '   ',
      replacement: ' A ',
      matchCount: 0,
      activeIndex: -1
    })
    const readyState = createFindReplaceState({
      query: ' alpha ',
      replacement: ' A ',
      matchCount: 2,
      activeIndex: 1
    })

    expect(normalizeFindReplaceDraft({
      query: ' alpha ',
      replacement: ' A '
    })).toEqual({
      query: 'alpha',
      replacement: 'A'
    })
    expect(readFindDisabled(emptyState)).toBe(true)
    expect(readReplaceDisabled(emptyState)).toBe(true)
    expect(readFindDisabled(readyState)).toBe(false)
    expect(readReplaceDisabled(readyState)).toBe(false)
  })
})
