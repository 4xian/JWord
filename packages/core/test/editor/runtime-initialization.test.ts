/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Editor facade 初始化和页面配置行为。
 * 边界：只覆盖未挂载编辑器的创建与页面配置，不进入 DOM 生命周期。
 * 协作模块：editor runtime 通过这些用例保持初始化选项和页面预设语义。
 * 性能/安全约束：编辑器销毁必须释放初始化期间创建的资源。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'

describe('createEditor', () => {
  it('creates an editor without touching host DOM', () => {
    const host = document.createElement('div')

    const editor = createEditor()
    const projection = editor.getProjection()

    expect(host.childElementCount).toBe(0)
    expect(projection.document.id).toBe('document-1')
    expect(projection.document.sections).toHaveLength(1)
    editor.destroy()
  })

  it('passes grouped layout options into the layout runtime during initialization', () => {
    const editor = createEditor({
      initialText: `前缀 ${'h'.repeat(160)}`,
      layout: {
        keepLatinWordWholeOnWrap: true
      }
    })
    const firstLineText = editor.getLayout().pages[0]?.lines[0]?.fragments.map((fragment) => fragment.text).join('')

    expect(firstLineText).toBe('前缀 ')

    editor.destroy()
  })
})

describe('Editor page config', () => {
  it('resets custom margins to preset defaults when choosing a preset', () => {
    const editor = createEditor()

    try {
      editor.setPageConfig({
        widthTwips: 20000,
        heightTwips: 30000,
        marginTwips: {
          top: 100,
          right: 200,
          bottom: 300,
          left: 400
        }
      })

      const nextConfig = editor.setPageConfig({ preset: 'a4' })

      expect(nextConfig.preset).toBe('a4')
      expect(nextConfig.marginTwips).toEqual({
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 1440
      })
    } finally {
      editor.destroy()
    }
  })

  it('merges explicit preset margins from preset defaults', () => {
    const editor = createEditor()

    try {
      editor.setPageConfig({
        widthTwips: 20000,
        heightTwips: 30000,
        marginTwips: {
          top: 100,
          right: 200,
          bottom: 300,
          left: 400
        }
      })

      const nextConfig = editor.setPageConfig({
        preset: 'a4',
        marginTwips: {
          left: 720
        }
      })

      expect(nextConfig.marginTwips).toEqual({
        top: 1440,
        right: 1440,
        bottom: 1440,
        left: 720
      })
    } finally {
      editor.destroy()
    }
  })
})
