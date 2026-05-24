/**
 * @fileoverview 职责: 锁定 UI 包 toolbar 配置层的默认顺序和显隐过滤语义。
 * 边界: 只覆盖 packages/ui 的纯配置行为，不验证 DOM 或 editor 命令绑定。
 * 协作: packages/ui/src/toolbar/config.ts 与 builtin-tools.ts。
 * 约束: 测试名称直接描述 observable config 结果，避免把实现细节当契约。
 * Specs: docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#62-建议的最小配置形状。
 */
import { describe, expect, test } from 'vitest'
import { BUILTIN_TOOL_IDS, DEFAULT_VISIBLE_TOOL_IDS } from '../src/toolbar/builtin-tools'
import { resolveToolbarConfig } from '../src/toolbar/config'

describe('resolveToolbarConfig', () => {
  test('在未传 visibleTools 时回退到默认工具顺序', () => {
    expect(resolveToolbarConfig()).toEqual({
      toolIds: [...DEFAULT_VISIBLE_TOOL_IDS]
    })
  })

  test('visibleTools 保持声明顺序并去重', () => {
    expect(resolveToolbarConfig({
      visibleTools: [
        'format.bold',
        'history.undo',
        'format.bold',
        'paragraph.alignment'
      ]
    })).toEqual({
      toolIds: [
        'format.bold',
        'history.undo',
        'paragraph.alignment'
      ]
    })
  })

  test('visibleTools 空数组表示不显示任何 toolbar 工具', () => {
    expect(resolveToolbarConfig({
      visibleTools: []
    })).toEqual({
      toolIds: []
    })
  })

  test('hiddenTools 会在 visibleTools 之后继续过滤', () => {
    expect(resolveToolbarConfig({
      visibleTools: [
        'history.undo',
        'history.redo',
        'format.bold'
      ],
      hiddenTools: [
        'history.redo',
        'format.bold'
      ]
    })).toEqual({
      toolIds: [
        'history.undo'
      ]
    })
  })

  test('只传 hiddenTools 时会从全部内建工具中过滤', () => {
    expect(resolveToolbarConfig({
      hiddenTools: [
        'history.undo',
        'document.revisions'
      ]
    })).toEqual({
      toolIds: BUILTIN_TOOL_IDS.filter((toolId) => toolId !== 'history.undo' && toolId !== 'document.revisions')
    })
  })

  test('新加入的按钮工具也可以通过 visibleTools 和 hiddenTools 控制', () => {
    expect(resolveToolbarConfig({
      visibleTools: [
        'format.fontSizeDecrease',
        'format.fontSizeIncrease',
        'format.superscript',
        'format.subscript',
        'paragraph.indentDecrease',
        'paragraph.indentIncrease',
        'paragraph.indentLeft',
        'format.fontSizeIncrease'
      ],
      hiddenTools: [
        'format.subscript',
        'paragraph.indentLeft'
      ]
    })).toEqual({
      toolIds: [
        'format.fontSizeDecrease',
        'format.fontSizeIncrease',
        'format.superscript',
        'paragraph.indentDecrease',
        'paragraph.indentIncrease'
      ]
    })
  })
})
