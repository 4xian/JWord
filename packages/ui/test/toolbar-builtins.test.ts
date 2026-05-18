/**
 * @fileoverview 职责: 锁定 toolbar 内建段落下拉的中文命名、前缀标签与扩展选项密度。
 * 边界: 只覆盖 packages/ui 的静态 builtin tool 定义，不验证 DOM 渲染和 editor 命令绑定。
 * 协作: packages/ui/src/toolbar/builtin-tools.ts。
 * 约束: 断言仅依赖公开定义，避免把 controller/state 的实现细节写成契约。
 */
import { describe, expect, test } from 'vitest'
import { DEFAULT_VISIBLE_TOOL_IDS, getBuiltinToolDefinition } from '../src/toolbar/builtin-tools'

describe('toolbar builtin paragraph selects', () => {
  test('默认内建工具包含字号步进与缩进按钮，并把字体字号做成框式下拉', () => {
    const fontFamily = getBuiltinToolDefinition('format.fontFamily')
    const fontSize = getBuiltinToolDefinition('format.fontSize')
    const pagePreset = getBuiltinToolDefinition('document.pagePreset')
    const style = getBuiltinToolDefinition('paragraph.style')
    const fontSizeDecrease = getBuiltinToolDefinition('format.fontSizeDecrease')
    const fontSizeIncrease = getBuiltinToolDefinition('format.fontSizeIncrease')
    const indentDecrease = getBuiltinToolDefinition('paragraph.indentDecrease')
    const indentIncrease = getBuiltinToolDefinition('paragraph.indentIncrease')
    const alignment = getBuiltinToolDefinition('paragraph.alignment')
    const list = getBuiltinToolDefinition('paragraph.list')
    const lineHeight = getBuiltinToolDefinition('paragraph.lineHeight')
    const superscript = getBuiltinToolDefinition('format.superscript')
    const subscript = getBuiltinToolDefinition('format.subscript')

    expect(pagePreset.menuLayout).toBe('text')
    expect(fontFamily.triggerVariant).toBe('boxed')
    expect(fontFamily.menuLayout).toBe('text')
    expect(fontSize.triggerVariant).toBe('boxed')
    expect(fontSize.menuLayout).toBe('text')
    expect(style.group).toBe('format')
    expect(DEFAULT_VISIBLE_TOOL_IDS.indexOf('paragraph.style')).toBe(DEFAULT_VISIBLE_TOOL_IDS.indexOf('format.fontSize') + 1)
    expect(fontSize.options?.map((option) => option.value)).toEqual(expect.arrayContaining([
      '300',
      '480'
    ]))
    expect(fontSizeDecrease.icon).toBeDefined()
    expect(fontSizeIncrease.icon).toBeDefined()
    expect(indentDecrease.icon).toBeDefined()
    expect(indentIncrease.icon).toBeDefined()
    expect(alignment.triggerVariant).toBe('icon')
    expect(alignment.menuLayout).toBe('icon')
    expect(list.triggerVariant).toBe('icon')
    expect(list.menuLayout).toBe('icon')
    expect(lineHeight.triggerVariant).toBe('icon')
    expect(lineHeight.menuLayout).toBe('text')
    expect(superscript.icon).toBeDefined()
    expect(subscript.icon).toBeDefined()
    expect(DEFAULT_VISIBLE_TOOL_IDS).toEqual(expect.arrayContaining([
      'format.fontSizeDecrease',
      'format.fontSizeIncrease',
      'format.superscript',
      'format.subscript',
      'paragraph.indentDecrease',
      'paragraph.indentIncrease'
    ]))
    expect(DEFAULT_VISIBLE_TOOL_IDS).not.toContain('paragraph.indentLeft')
  })

  test('使用中文字段前缀与更完整的段落选项', () => {
    const alignment = getBuiltinToolDefinition('paragraph.alignment')
    const indentLeft = getBuiltinToolDefinition('paragraph.indentLeft')
    const lineHeight = getBuiltinToolDefinition('paragraph.lineHeight')
    const style = getBuiltinToolDefinition('paragraph.style')
    const list = getBuiltinToolDefinition('paragraph.list')

    expect(alignment.fieldLabel).toBe('对齐')
    expect(indentLeft.fieldLabel).toBe('左缩进')
    expect(lineHeight.fieldLabel).toBe('行距')
    expect(style.fieldLabel).toBe('样式')
    expect(list.fieldLabel).toBe('列表')
    expect(indentLeft.menuMinWidthPx).toBeGreaterThan(80)
    expect(style.triggerMinWidthPx).toBeLessThan(80)
    expect(list.menuMinWidthPx).toBeGreaterThan(style.menuMinWidthPx ?? 0)

    expect(indentLeft.options?.map((option) => option.value)).toEqual(expect.arrayContaining([
      '360',
      '1080',
      '1800',
      '2880'
    ]))
    expect(lineHeight.options?.map((option) => option.value)).toEqual(expect.arrayContaining([
      '1.25',
      '1.75',
      '2.5',
      '3'
    ]))
    expect(style.options?.map((option) => option.label)).toEqual(expect.arrayContaining([
      '正文',
      '标题 1',
      '标题 2',
      '标题 3'
    ]))
    expect(list.options?.map((option) => option.label)).toEqual(expect.arrayContaining([
      '无列表',
      '项目符号列表 3 级',
      '编号列表 3 级'
    ]))
  })
})
