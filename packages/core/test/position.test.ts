/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 位置与基础单位类型的最小骨架。
 * 边界：只覆盖 ID、twip、grapheme、AnchorRef、RangeRef 和 Y.RelativePosition 第一版，不测试 selection。
 * 协作模块：后续 selection、comment、revision、layout 和 docx adapter 复用这些稳定引用。
 * 约束：测试直接导入 src/position，不要求公开入口导出，也不访问浏览器 DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  createAnchorRef,
  createGraphemeIndex,
  createRangeRef,
  createTextAnchorRef,
  createTwip,
  readAnchorRefSnapshot,
  resolveAnchorRef
} from '../src/position'
import type {
  AnchorRef,
  BlockId,
  CommentId,
  DocumentId,
  GraphemeIndex,
  RangeRef,
  RevisionId,
  RunId,
  SectionId,
  Twip
} from '../src/position'

describe('Gate 1 position skeleton', () => {
  it('keeps ids opaque at the type boundary', () => {
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId
    const commentId = 'comment-1' as CommentId
    const revisionId = 'revision-1' as RevisionId

    if (Date.now() < 0) {
      // @ts-expect-error ID 品牌不能互换
      const invalidSectionId: SectionId = documentId
      void invalidSectionId
    }

    expect([documentId, sectionId, blockId, runId, commentId, revisionId]).toEqual([
      'document-1',
      'section-1',
      'block-1',
      'run-1',
      'comment-1',
      'revision-1'
    ])
  })

  it('creates branded twip and grapheme values without mixing units', () => {
    const width = createTwip(11906)
    const index = createGraphemeIndex(3)

    if (Date.now() < 0) {
      // @ts-expect-error Twip 不能当作 GraphemeIndex 使用
      const invalidIndex: GraphemeIndex = width
      // @ts-expect-error 普通数字不能直接作为 Twip
      const invalidTwip: Twip = 1440
      void invalidIndex
      void invalidTwip
    }

    expect(width).toBe(11906)
    expect(index).toBe(3)
  })

  it('creates frozen opaque anchors and exposes range anchor/focus only', () => {
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId
    const anchor = createAnchorRef({
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(0)
    })
    const focus = createAnchorRef({
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(5)
    })
    const range = createRangeRef(anchor, focus)

    if (Date.now() < 0) {
      // @ts-expect-error AnchorRef 不暴露内部结构
      anchor.documentId
      // @ts-expect-error RangeRef 的 anchor 只读
      range.anchor = focus
      // @ts-expect-error AnchorRef 必须通过创建函数生成
      const invalidAnchor: AnchorRef = {}
      // @ts-expect-error RangeRef 必须通过创建函数生成
      const invalidRange: RangeRef = { anchor, focus }
      void invalidAnchor
      void invalidRange
    }

    expect(Object.isFrozen(anchor)).toBe(true)
    expect(Object.isFrozen(focus)).toBe(true)
    expect(Object.isFrozen(range)).toBe(true)
    expect(range.anchor).toBe(anchor)
    expect(range.focus).toBe(focus)
    expect(Reflect.set(anchor, 'graphemeIndex', createGraphemeIndex(99))).toBe(false)
    expect(Reflect.set(range, 'anchor', focus)).toBe(false)
  })

  it('allows core internals to read an anchor snapshot without exposing mutable fields', () => {
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId
    const anchor = createAnchorRef({
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(2)
    })

    expect(readAnchorRefSnapshot(anchor)).toEqual({
      kind: 'block',
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(2)
    })
  })

  it('resolves text anchors through Y.RelativePosition after text changes', () => {
    const doc = new Y.Doc()
    const text = doc.getText('run-1')
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId

    text.insert(0, 'abc')

    const anchor = createTextAnchorRef({
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(1),
      text
    })

    text.insert(0, 'x')

    const snapshot = resolveAnchorRef(anchor, doc)

    expect(snapshot?.kind).toBe('text')
    expect(snapshot?.documentId).toBe(documentId)
    expect(snapshot?.runId).toBe(runId)
    expect(snapshot?.graphemeIndex).toBe(createGraphemeIndex(2))
    expect(readAnchorRefSnapshot(anchor).relativePosition).toBeInstanceOf(Y.RelativePosition)
  })

  it('stores text anchors at Yjs UTF-16 indexes while exposing grapheme indexes', () => {
    const doc = new Y.Doc()
    const text = doc.getText('run-1')
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId

    text.insert(0, 'a😊e\u0301中')

    const anchor = createTextAnchorRef({
      documentId,
      sectionId,
      blockId,
      runId,
      graphemeIndex: createGraphemeIndex(2),
      text
    })
    const absolute = Y.createAbsolutePositionFromRelativePosition(
      readAnchorRefSnapshot(anchor).relativePosition as Y.RelativePosition,
      doc
    )

    expect(absolute?.index).toBe(3)

    text.insert(0, '界')

    expect(resolveAnchorRef(anchor, doc)?.graphemeIndex).toBe(createGraphemeIndex(3))
  })

  it('rejects text anchors outside grapheme boundaries', () => {
    const doc = new Y.Doc()
    const text = doc.getText('run-1')
    const documentId = 'document-1' as DocumentId
    const sectionId = 'section-1' as SectionId
    const blockId = 'block-1' as BlockId
    const runId = 'run-1' as RunId

    text.insert(0, 'a😊')

    let error: unknown

    try {
      createTextAnchorRef({
        documentId,
        sectionId,
        blockId,
        runId,
        graphemeIndex: createGraphemeIndex(3),
        text
      })
    } catch (caught) {
      error = caught
    }

    expect(error).toMatchObject({
      code: 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS'
    })
  })
})
