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

import { createFontManager } from '../../src/layout/font-manager'

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

  it('registers loading fonts, measures with fallback, and clears stale cache when font becomes available', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    manager.registerFontFamily('Corp Sans')

    const pending = manager.measureText('abc', {
      fontFamily: 'Corp Sans',
      fontSizePx: 12
    })

    expect(pending.resolvedFont.fontFamily).toBe('Arial')
    expect(pending.resolvedFont.requestedFontFamily).toBe('Corp Sans')
    expect(pending.resolvedFont.status).toBe('loading')
    expect(manager.getLoadingFontFamilies()).toEqual(['Corp Sans'])
    expect(manager.getMissingFontFamilies()).toEqual([])
    expect(manager.getCacheStats()).toEqual({
      size: 1,
      hits: 0,
      misses: 1
    })

    manager.markFontFamilyAvailable('Corp Sans')

    expect(manager.getLoadingFontFamilies()).toEqual([])
    expect(manager.getCacheStats()).toEqual({
      size: 0,
      hits: 0,
      misses: 0
    })

    const resolved = manager.measureText('abc', {
      fontFamily: 'Corp Sans',
      fontSizePx: 12
    })

    expect(resolved.resolvedFont.fontFamily).toBe('Corp Sans')
    expect(resolved.resolvedFont.requestedFontFamily).toBeUndefined()
    expect(resolved.resolvedFont.status).toBe('available')
  })

  it('removes previously missing font from diagnostics after registration', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const missing = manager.resolveFont({
      fontFamily: 'Corp Sans',
      fontSizePx: 12
    })

    expect(missing.status).toBe('missing')
    expect(manager.getMissingFontFamilies()).toEqual(['Corp Sans'])

    manager.registerFontFamily('Corp Sans')

    const loading = manager.resolveFont({
      fontFamily: 'Corp Sans',
      fontSizePx: 12
    })

    expect(loading.status).toBe('loading')
    expect(manager.getLoadingFontFamilies()).toEqual(['Corp Sans'])
    expect(manager.getMissingFontFamilies()).toEqual([])
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

  it('treats fullwidth CJK punctuation and ideographic space as full-cell advances', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const cjkBody = manager.measureText('中', { fontSizePx: 16 })
    const ideographicStop = manager.measureText('。', { fontSizePx: 16 })
    const fullwidthComma = manager.measureText('，', { fontSizePx: 16 })
    const ideographicSpace = manager.measureText('\u3000', { fontSizePx: 16 })
    const asciiStop = manager.measureText('.', { fontSizePx: 16 })
    const asciiComma = manager.measureText(',', { fontSizePx: 16 })

    expect(ideographicStop.widthCssPx).toBeCloseTo(cjkBody.widthCssPx, 2)
    expect(fullwidthComma.widthCssPx).toBeCloseTo(cjkBody.widthCssPx, 2)
    expect(ideographicSpace.widthCssPx).toBeCloseTo(cjkBody.widthCssPx, 2)
    expect(ideographicStop.widthCssPx).toBeGreaterThan(asciiStop.widthCssPx * 2)
    expect(fullwidthComma.widthCssPx).toBeGreaterThan(asciiComma.widthCssPx * 2)
  })

  it('uses differentiated Latin widths to reduce long English hit-test drift', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const wide = manager.measureText('mmmmmmmm', { fontSizePx: 16 })
    const narrow = manager.measureText('iiiiiiii', { fontSizePx: 16 })
    const digits = manager.measureText('12345678', { fontSizePx: 16 })

    expect(wide.widthCssPx).toBeGreaterThan(digits.widthCssPx)
    expect(digits.widthCssPx).toBeGreaterThan(narrow.widthCssPx)
    expect(wide.widthCssPx - narrow.widthCssPx).toBeGreaterThan(70)
  })

  it('keeps repeated lowercase English advances close to browser Arial metrics', () => {
    const manager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    const measured = manager.measureText('h'.repeat(80), { fontSizePx: 16 })

    expect(measured.widthCssPx).toBeCloseTo(711.68, 1)
  })
})
