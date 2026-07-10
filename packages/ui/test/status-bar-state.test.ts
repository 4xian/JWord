/**
 * @vitest-environment node
 *
 * 职责：锁定底部状态栏阶段 A 的纯状态口径和公开类型契约。
 * 边界：只覆盖文档统计、item 过滤、缩放 clamp、locale 白名单，不创建 DOM 或 controller。
 * 协作：packages/ui/src/status-bar/state.ts 与 packages/ui/src/types.ts。
 * 约束：用明确字面量验证中英文混排统计和 20%-400% 缩放边界。
 */

import type { DocumentProjection } from '@4xian/jword-core'
import { describe, expect, test } from 'vitest'

import {
  DEFAULT_STATUS_BAR_ITEM_IDS,
  clampStatusBarZoomPercent,
  createStatusBarDocumentStats,
  resolveStatusBarItems,
  resolveStatusBarLocaleOptions,
  resolveStatusBarZoomOptions,
  scaleToStatusBarZoomPercent,
  statusBarZoomPercentToScale
} from '../src/status-bar/state'
import type {
  CreateJWordUiOptions,
  JWordStatusBarElements,
  JWordStatusBarItemId,
  JWordStatusBarLocale
} from '../src/types'

describe('status bar phase A state', () => {
  test('统计中英文混排、标点、空白和表格内段落', () => {
    expect(createStatusBarDocumentStats(createMixedProjection())).toEqual({
      words: 8,
      characters: 18,
      paragraphs: 3
    })
  })

  test('visibleItems 保持顺序去重后再应用 hiddenItems', () => {
    expect(resolveStatusBarItems({
      visibleItems: [
        'zoomReset',
        'brand',
        'wordCount',
        'brand'
      ],
      hiddenItems: [
        'brand'
      ]
    })).toEqual([
      'zoomReset',
      'wordCount'
    ])
  })

  test('默认 item 顺序覆盖左侧状态和右侧视图控制', () => {
    expect(resolveStatusBarItems()).toEqual(DEFAULT_STATUS_BAR_ITEM_IDS)
  })

  test('缩放百分比锁定在 20 到 400，并和 scale 互转', () => {
    expect(resolveStatusBarZoomOptions()).toEqual({
      minPercent: 20,
      maxPercent: 400,
      stepPercent: 10
    })
    expect(clampStatusBarZoomPercent(10)).toBe(20)
    expect(clampStatusBarZoomPercent(450)).toBe(400)
    expect(clampStatusBarZoomPercent(133.4)).toBe(133)
    expect(statusBarZoomPercentToScale(150)).toBe(1.5)
    expect(scaleToStatusBarZoomPercent(1.256)).toBe(126)
  })

  test('locale 选项只保留首批中文和英文', () => {
    expect(resolveStatusBarLocaleOptions()).toEqual([
      'zh-CN',
      'en-US'
    ])
    expect(resolveStatusBarLocaleOptions([
      'en-US',
      'fr-FR' as JWordStatusBarLocale,
      'zh-CN',
      'en-US'
    ])).toEqual([
      'en-US',
      'zh-CN'
    ])
  })

  test('公开 createJWordUi 类型接受 statusBar true 和元素句柄', () => {
    const options = {
      statusBar: true
    } satisfies Pick<CreateJWordUiOptions, 'statusBar'>
    const elementKeys: ReadonlyArray<keyof JWordStatusBarElements> = [
      'host',
      'root',
      'left',
      'right',
      'controls'
    ]
    const itemId: JWordStatusBarItemId = 'themeSwitcher'

    expect(options.statusBar).toBe(true)
    expect(elementKeys).toContain('controls')
    expect(itemId).toBe('themeSwitcher')
  })
})

/** 创建覆盖正文和表格单元格的统计 fixture。 */
function createMixedProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'doc-status-bar-state',
      sections: [{
        kind: 'section',
        id: 'section-1',
        blocks: [
          createParagraph('p1', 'r1', '你好 world!'),
          createParagraph('p2', 'r2', 'A 123'),
          {
            kind: 'table',
            id: 'table-1',
            rows: [{
              id: 'row-1',
              cells: [{
                id: 'cell-1',
                blocks: [createParagraph('p3', 'r3', '表格 cell')]
              }]
            }]
          }
        ]
      }]
    }
  }
}

/** 创建测试用段落块。 */
function createParagraph(id: string, runId: string, text: string) {
  return {
    kind: 'paragraph' as const,
    id,
    runs: [{
      kind: 'run' as const,
      id: runId,
      inlines: [{
        kind: 'text' as const,
        text
      }]
    }]
  }
}
