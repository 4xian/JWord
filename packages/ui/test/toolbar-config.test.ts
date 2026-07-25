/**
 * @fileoverview 职责: 锁定 UI 包 toolbar 配置层的默认顺序和显隐过滤语义。
 * 边界: 只覆盖 packages/ui 的纯配置行为，不验证 DOM 或 editor 命令绑定。
 * 协作: packages/ui/src/toolbar/config.ts 与 builtin-tools.ts。
 * 约束: 测试名称直接描述 observable config 结果，避免把实现细节当契约。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, test } from 'vitest'
import { resolveToolbarConfig } from '../src/toolbar/config'

describe('resolveToolbarConfig', () => {
  test('未传配置时默认解析为专业模式 Tab 工具栏', () => {
    const config = resolveToolbarConfig()

    expect(config.mode).toBe('professional')
    expect(config.modeSwitcher).toBe(true)
    expect(config.commonExtensions).toBe(true)
    expect(config.activeTab).toBe('home')
    expect(config.tabs.map((tab) => tab.id)).toEqual([
      'home',
      'insert',
      'table',
      'page',
      'tools',
      'view',
      'export'
    ])
    expect(config.tabs.find((tab) => tab.id === 'home')?.toolIds).toContain('format.bold')
    expect(config.tabs.find((tab) => tab.id === 'page')?.toolIds).toContain('document.pagePreset')
    expect(config.tabs.find((tab) => tab.id === 'tools')?.toolIds).toContain('document.findReplace')
    expect(config.commonToolIds).toEqual([
      'history.undo',
      'history.redo',
      'paragraph.style',
      'format.fontFamily',
      'format.fontSize',
      'format.bold',
      'format.italic',
      'format.underline',
      'format.textColor',
      'format.backgroundColor',
      'paragraph.alignment',
      'paragraph.list',
      'insert.link',
      'insert.comment',
      'document.findReplace'
    ])
    expect(config.toolIds).toContain('document.pagePreset')
  })

  test('旧 visibleTools 用法兼容为常用模式并保持声明顺序去重', () => {
    const config = resolveToolbarConfig({
      visibleTools: [
        'format.bold',
        'history.undo',
        'format.bold',
        'paragraph.alignment'
      ]
    })

    expect(config.mode).toBe('common')
    expect(config.modeSwitcher).toBe(false)
    expect(config.commonExtensions).toBe(false)
    expect(config.commonToolIds).toEqual([
      'format.bold',
      'history.undo',
      'paragraph.alignment'
    ])
    expect(config.toolIds).toEqual([
      'format.bold',
      'history.undo',
      'paragraph.alignment'
    ])
  })

  test('visibleTools 空数组表示不显示任何 toolbar 工具', () => {
    const config = resolveToolbarConfig({
      visibleTools: []
    })

    expect(config.mode).toBe('common')
    expect(config.commonToolIds).toEqual([])
    expect(config.commonExtensions).toBe(false)
    expect(config.toolIds).toEqual([])
  })

  test('hiddenTools 会在 visibleTools 之后继续过滤', () => {
    const config = resolveToolbarConfig({
      visibleTools: [
        'history.undo',
        'history.redo',
        'format.bold'
      ],
      hiddenTools: [
        'history.redo',
        'format.bold'
      ]
    })

    expect(config.toolIds).toEqual([
      'history.undo'
    ])
  })

  test('只传 hiddenTools 时会从专业和常用配置中过滤', () => {
    const config = resolveToolbarConfig({
      hiddenTools: [
        'history.undo',
        'document.revisions'
      ]
    })

    expect(config.mode).toBe('professional')
    expect(config.tabs.find((tab) => tab.id === 'home')?.toolIds).not.toContain('history.undo')
    expect(config.tabs.find((tab) => tab.id === 'tools')?.toolIds).not.toContain('document.revisions')
    expect(config.commonToolIds).not.toContain('history.undo')
    expect(config.toolIds).not.toContain('history.undo')
    expect(config.toolIds).not.toContain('document.revisions')
  })

  test('常用模式未声明 visibleTools 时使用默认常用工具', () => {
    const config = resolveToolbarConfig({
      mode: 'common'
    })

    expect(config.mode).toBe('common')
    expect(config.modeSwitcher).toBe(false)
    expect(config.commonExtensions).toBe(true)
    expect(config.toolIds).toEqual(config.commonToolIds)
    expect(config.commonToolIds).toContain('document.findReplace')
  })

  test('common.visibleTools 优先于旧 visibleTools 并继续支持 hiddenTools', () => {
    const config = resolveToolbarConfig({
      mode: 'common',
      visibleTools: ['history.undo'],
      common: {
        visibleTools: ['format.bold', 'format.italic'],
        hiddenTools: ['format.italic']
      }
    })

    expect(config.commonToolIds).toEqual([
      'format.bold'
    ])
    expect(config.commonExtensions).toBe(false)
    expect(config.toolIds).toEqual([
      'format.bold'
    ])
  })

  test('专业模式支持隐藏 Tab 和覆盖指定 Tab 工具', () => {
    const config = resolveToolbarConfig({
      professional: {
        defaultTab: 'tools',
        hiddenTabs: ['page'],
        tabTools: {
          insert: ['insert.link']
        }
      }
    })

    expect(config.activeTab).toBe('tools')
    expect(config.tabs.map((tab) => tab.id)).not.toContain('page')
    expect(config.tabs.find((tab) => tab.id === 'insert')?.toolIds).toEqual([
      'insert.link'
    ])
  })

  test('新加入的按钮工具也可以通过 visibleTools 和 hiddenTools 控制', () => {
    const config = resolveToolbarConfig({
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
    })

    expect(config.toolIds).toEqual([
      'format.fontSizeDecrease',
      'format.fontSizeIncrease',
      'format.superscript',
      'paragraph.indentDecrease',
      'paragraph.indentIncrease'
    ])
  })
})
