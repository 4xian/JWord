/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 字体管理器 的字体状态、fallback 字体、度量缓存和缺字体诊断。
 * 边界：只测试无 DOM 的字体度量服务，不覆盖布局、渲染或真实字体加载。
 * 协作模块：layout 通过 字体管理器获取文本宽度和行高，PDF 后续可复用字体缺失诊断。
 * 约束：测试不访问 window、document 或 画布接口。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/02-technical-decisions.md#27-pdf-决策。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../src/font-manager'

describe('Gate 2 字体管理器', () => {
  it('resolves available fonts and caches repeated measurements', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial', 'Inter']
    })
    const style = {
      fontFamily: 'Inter',
      fontSizePx: 16,
      bold: true
    }

    const first = manager.measureText('abc', style)
    const second = manager.measureText('abc', style)

    expect(first.widthCssPx).toBeGreaterThan(0)
    expect(first.heightCssPx).toBeGreaterThan(16)
    expect(second).toEqual(first)
    expect(manager.getCacheStats()).toEqual({
      size: 1,
      hits: 1,
      misses: 1
    })
  })

  it('falls back and records missing font family without touching DOM', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const resolved = manager.resolveFont({
      fontFamily: 'Missing Corp Font',
      fontSizePx: 12
    })

    expect(resolved.fontFamily).toBe('Arial')
    expect(resolved.requestedFontFamily).toBe('Missing Corp Font')
    expect(resolved.status).toBe('missing')
    expect(manager.getMissingFontFamilies()).toEqual(['Missing Corp Font'])
  })

  it('measures CJK, emoji and combining characters by grapheme cluster', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const latin = manager.measureText('abc', { fontSizePx: 16 })
    const mixed = manager.measureText('中😊e\u0301', { fontSizePx: 16 })

    expect(mixed.graphemeCount).toBe(3)
    expect(mixed.widthCssPx).toBeGreaterThan(latin.widthCssPx)
  })
})
