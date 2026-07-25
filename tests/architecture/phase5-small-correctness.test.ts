/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 小型正确性与风格项的机器验收条件。
 * 边界：只覆盖审查计划点名的小型修复源代码护栏，不替代各包 focused 行为测试。
 * 协作模块：core layout/editor/model、ui paste/toolbar、collab hocuspocus、pdf/docx 导出链路。
 * 约束：通过源码断言防止审查已修问题回流，不放宽 architecture 门禁。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

/** 读取源码文本。 */
function readSource(path: string): string {
  return readFileSync(path, 'utf8')
}

describe('Phase 5 small correctness and style follow-ups', () => {
  it('does not mutate readonly selection paragraph targets after publishing them', () => {
    const source = readSource('packages/core/src/model/selection-targets.ts')

    expect(source).not.toContain('paragraphTarget.lastRunOrder =')
    expect(source).not.toContain('paragraphTarget.lastRunGraphemeLength =')
  })

  it('creates resource lookup once per paragraph layout pass instead of once per run', () => {
    const inlineLayoutSource = readSource('packages/core/src/layout/inline-layout.ts')
    const paginationFlowSource = readSource('packages/core/src/layout/pagination-flow.ts')

    expect(inlineLayoutSource).not.toContain('new Map((resources ?? [])')
    expect(paginationFlowSource).toContain('resourceById')
    expect(paginationFlowSource).toContain('new Map((input.projection.document.resources ?? [])')
  })

  it('keeps list semantics explicit and does not reset counters on non-list paragraphs', () => {
    const semanticsSource = readSource('packages/core/src/layout/paragraph-semantics.ts')
    const flowSource = readSource('packages/core/src/layout/paragraph-flow.ts')

    expect(semanticsSource).not.toContain("toLowerCase().includes('bullet')")
    expect(flowSource).not.toContain('delete cursor.listCounters')
  })

  it('uses a shared tolerance helper for caret line matching', () => {
    const runtimeSelectionSource = readSource('packages/core/src/editor/runtime-selection.ts')
    const keyboardSource = readSource('packages/core/src/editor/keyboard-text-runtime.ts')

    expect(runtimeSelectionSource).toContain('isLayoutLineMatchingCaret')
    expect(keyboardSource).toContain('isLayoutLineMatchingCaret')
    expect(`${runtimeSelectionSource}\n${keyboardSource}`).not.toContain('line.y === caretRect.y')
    expect(`${runtimeSelectionSource}\n${keyboardSource}`).not.toContain('candidate.y === caretRect.y')
  })

  it('validates restored history selections against the current projection', () => {
    const source = readSource('packages/core/src/editor/facade-runtime.ts')

    expect(source).toContain('restoreHistorySelection')
    expect(source).toContain('isSelectionValidInCurrentProjection')
    expect(source).toContain('resolveInitialStartFocusAnchor')
    expect(source).not.toContain('commitSelection(restoreSelection(result.metadata.selectionBefore)')
    expect(source).not.toContain('commitSelection(restoreSelection(result.metadata.selectionAfter)')
  })

  it('uses core grapheme helpers in UI selection rebinding', () => {
    const source = readSource('packages/ui/src/selection-rebind.ts')

    expect(source).toContain('countGraphemes')
    expect(source).not.toContain('Array.from(inline.text).length')
  })

  it('keeps paste sanitizer style-free and preserves br as an explicit line break', () => {
    const source = readSource('packages/ui/src/paste/sanitizer.ts')

    expect(source).toContain("ALLOWED_ATTR: ['class', 'href']")
    expect(source).not.toContain("ALLOWED_ATTR: ['class', 'href', 'style']")
    expect(source).not.toContain("text: ' '")
    expect(source).toContain("text: '\\n'")
  })

  it('derives readonly toolbar disabled state from the builtin tool registry', () => {
    const source = readSource('packages/ui/src/toolbar/toolbar-state-sync.ts')

    expect(source).toContain('BUILTIN_TOOL_IDS')
    expect(source).not.toContain('const editableToolIds = [')
  })

  it('uses clip-path instead of deprecated clip style for hidden text mirrors', () => {
    const source = [
      readSource('packages/ui/src/assistive/text-mirror.ts'),
      readSource('packages/core/src/editor/dom.ts')
    ].join('\n')

    expect(source).not.toContain('style.clip =')
    expect(source).toContain('style.clipPath')
  })

  it('normalizes Hocuspocus update origins into the frozen core origin matrix', () => {
    const source = readSource('packages/collab/src/hocuspocus-adapter.ts')

    expect(source).toContain('local-user')
    expect(source).toContain('remote-user')
    expect(source).toContain('version-restore')
    expect(source).not.toContain("metadata.origin ?? 'local'")
  })

  it('keeps Gate 6 low-level lifecycle and history adapter cleanup explicit', () => {
    const hocuspocusSource = readSource('packages/collab/src/hocuspocus-adapter.ts')
    const collabIndexSource = readSource('packages/collab/src/index.ts')
    const historyServiceSource = readSource('packages/collab-server/src/history-service.ts')

    expect(hocuspocusSource.indexOf('awarenessListeners.clear()')).toBeLessThan(
      hocuspocusSource.indexOf('provider.destroy()')
    )
    expect(`${collabIndexSource}\n${hocuspocusSource}`).toContain('调用方必须保证 update 与目标文档匹配')
    expect(historyServiceSource).toContain('private readonly adapter: JWordPersistenceSnapshotAdapter')
    expect(historyServiceSource).toContain('return this.adapter')
    expect(historyServiceSource).not.toContain('return createStoragePersistenceAdapter')
  })

  it('stores header footer baseline in layout and lets renderers consume it', () => {
    const layoutTypesSource = readSource('packages/core/src/layout/types.ts')
    const canvasSource = readSource('packages/core/src/canvas/renderer.ts')
    const pdfSource = readSource('packages/pdf/src/index.ts')

    expect(layoutTypesSource).toContain('readonly baseline: number')
    expect(`${canvasSource}\n${pdfSource}`).not.toContain('box.height * 0.6')
    expect(canvasSource).toContain('box.baseline')
    expect(pdfSource).toContain('box.baseline')
  })

  it('guards PDF page size, richer colors and TTC font coverage', () => {
    const pdfSource = readSource('packages/pdf/src/index.ts')
    const textStyleSource = readSource('packages/pdf/src/text-style-renderer.ts')
    const fontRegistrySource = readSource('packages/pdf/src/font-registry.ts')

    expect(pdfSource).toContain('MAX_PDF_PAGE_SIZE_POINTS')
    expect(textStyleSource).toContain('PDF_NAMED_COLORS')
    expect(textStyleSource).toContain('parsePdfColorChannel')
    expect(fontRegistrySource).not.toContain('font.fonts[0]')
    expect(fontRegistrySource).toContain('createPdfFontCollectionCoverage')
  })

  it('tracks hyperlink, tabs and bookmarks in DOCX roundtrip snapshots', () => {
    const source = readSource('packages/docx/src/roundtrip.ts')

    expect(source).toContain('tabs')
    expect(source).toContain('runLinks')
    expect(source).toContain('bookmarks')
    expect(source).toContain('readBookmarkSnapshot')
  })
})
