/**
 * @vitest-environment node
 *
 * 职责：验证编辑命令 dirty page 推导不会在大文档输入热路径中触发全量布局查询缓存构建。
 * 边界：只覆盖 editor/rendering 的 dirty page helper，不执行事务、不重新排版、不访问 DOM。
 * 协作模块：Editor layout runtime 在 executeCommand 前调用本 helper 缩小增量布局页范围。
 * 性能/安全约束：测试使用带 getter 计数的合成页面，锁定首屏输入不扫描全部页面。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#39-phase-4-性能专项输入热路径-p95--50ms。
 */

import { describe, expect, it } from 'vitest'

import { resolveOperationDirtyPageIndexes } from '../../src/editor/rendering'
import type { DocumentLayout, LayoutInput, PageBox, TextFragment } from '../../src/layout/runtime'
import type { InsertTextOperation, TextPosition } from '../../src/operations/transaction'

const TARGET_POSITION: TextPosition = {
  sectionId: 'section-1',
  blockId: 'paragraph-1',
  runId: 'run-1',
  graphemeIndex: 0
}

describe('resolveOperationDirtyPageIndexes', () => {
  it('首屏输入命中后不会继续扫描大文档剩余页面', () => {
    const probe = createMeasuredLayout(200)
    const operation: InsertTextOperation = {
      kind: 'insertText',
      at: TARGET_POSITION,
      text: '热'
    }

    expect(resolveOperationDirtyPageIndexes(probe.layout, operation)).toEqual([0])
    expect(probe.readLinesCount()).toBeLessThan(20)
  })
})

/** 创建带页面 lines getter 计数的合成布局。 */
function createMeasuredLayout(pageCount: number): {
  readonly layout: DocumentLayout
  readonly readLinesCount: () => number
} {
  let readLinesCount = 0
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const page = createPage(pageIndex)

    return Object.defineProperty(page, 'lines', {
      get() {
        readLinesCount += 1

        return pageIndex === 0
          ? [createLineFragment(TARGET_POSITION)]
          : [createLineFragment({
              sectionId: 'section-1',
              blockId: `paragraph-${pageIndex + 1}`,
              runId: `run-${pageIndex + 1}`,
              graphemeIndex: 0
            })]
      }
    }) as PageBox
  })

  return {
    layout: {
      kind: 'documentLayout',
      input: {} as LayoutInput,
      pages,
      debugOverlay: {
        boxes: []
      }
    },
    readLinesCount: () => readLinesCount
  }
}

/** 创建测试页面的静态字段，lines 由外层 getter 覆盖。 */
function createPage(pageIndex: number): PageBox {
  return {
    kind: 'page',
    pageIndex,
    x: 0,
    y: pageIndex * 1000,
    width: 800,
    height: 1000,
    sectionBoundary: 'single',
    sectionIds: ['section-1'],
    sectionId: 'section-1',
    headerIds: [],
    footerIds: [],
    headerFooterBoxes: [],
    lines: [],
    paragraphs: [],
    blocks: [],
    contentRect: {
      pageIndex,
      x: 0,
      y: pageIndex * 1000,
      width: 800,
      height: 1000
    }
  }
}

/** 创建包含单个文本片段的测试行。 */
function createLineFragment(position: TextPosition) {
  const fragment: TextFragment = {
    kind: 'textFragment',
    pageIndex: 0,
    sectionId: position.sectionId,
    blockId: position.blockId,
    runId: position.runId,
    text: '测试',
    start: position,
    end: {
      ...position,
      graphemeIndex: position.graphemeIndex + 2
    },
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    style: {
      fontFamily: 'Arial',
      fontSizePx: 16,
      status: 'available'
    },
    baseline: 14,
    advanceTwips: [0, 50, 100]
  }

  return {
    kind: 'line' as const,
    pageIndex: 0,
    sectionId: position.sectionId,
    paragraphId: position.blockId,
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    baseline: 14,
    fragments: [fragment],
    inlines: []
  }
}
