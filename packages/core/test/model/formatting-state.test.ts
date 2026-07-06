/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 3 selection formatting state 会聚合 run 和 paragraph 的只读状态。
 * 边界：只覆盖 projection + selection 计算，不测试 toolbar DOM 或 editor runtime 事件同步。
 * 协作模块：toolbar 状态同步、快捷键高亮和后续只读诊断面板可复用这里的状态结果。
 * 性能/安全约束：测试只使用内存 projection，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { describe, expect, it } from 'vitest'

import {
  createSelectionFormattingState
} from '../../src/index'
import type { DocumentProjection } from '../../src/model/projection'
import type { TextInline } from '../../src/model/types'
import {
  DOCUMENT_STORE_FIELDS,
  type DocumentStoreJson,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getSectionBlocks
} from '../../src/model/document-store'
import type { BlockId, DocumentId, RunId, SectionId } from '../../src/model/position'
import { createAnchorRef, createGraphemeIndex } from '../../src/model/position'
import { createDocumentProjection } from '../../src/model/projection'
import { createCollapsedSelection, createSelectionState } from '../../src/model/selection'

describe('selection formatting state', () => {
  it('reads collapsed selection run and paragraph formatting values', () => {
    const fixture = createFormattingStateFixture()
    const selection = createCollapsedSelection(fixture.createAnchor('paragraph-1', 'run-1', 1))

    expect(createSelectionFormattingState(fixture.projection, selection)).toEqual({
      run: {
        bold: { value: true, mixed: false },
        italic: { value: false, mixed: false },
        underline: { value: true, mixed: false },
        strike: { value: false, mixed: false },
        superscript: { value: true, mixed: false },
        subscript: { value: false, mixed: false },
        fontFamily: { value: 'SimSun', mixed: false },
        fontSizeTwips: { value: 420, mixed: false },
        color: { value: '#111111', mixed: false },
        backgroundColor: { value: '#fff59d', mixed: false }
      },
      paragraph: {
        alignment: { value: 'left', mixed: false },
        lineHeight: { value: 1.5, mixed: false },
        indentLeftTwips: { value: 0, mixed: false },
        spacingBeforeTwips: { value: 120, mixed: false },
        spacingAfterTwips: { value: 240, mixed: false },
        firstLineIndentTwips: { value: 360, mixed: false },
        hangingIndentTwips: { value: 0, mixed: false },
        styleId: { value: 'Heading1', mixed: false },
        list: { value: null, mixed: false }
      }
    })
  })

  it('折叠选区格式状态不读取未命中段落文本', () => {
    const projection = createPoisonedTrailingTextProjection()
    const selection = createCollapsedSelection(createAnchorRef({
      documentId: 'document-1' as DocumentId,
      sectionId: 'section-1' as SectionId,
      blockId: 'paragraph-1' as BlockId,
      runId: 'run-1' as RunId,
      graphemeIndex: createGraphemeIndex(0)
    }))

    expect(createSelectionFormattingState(projection, selection).run?.bold).toEqual({
      value: true,
      mixed: false
    })
  })

  it('normalizes false and undefined boolean values as the same rendered state', () => {
    const fixture = createFormattingStateFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-2', 0),
      fixture.createAnchor('paragraph-2', 'run-3', 1)
    )

    expect(createSelectionFormattingState(fixture.projection, selection).run?.bold).toEqual({
      value: false,
      mixed: false
    })
  })

  it('marks mixed values when selection spans runs and paragraphs with different properties', () => {
    const fixture = createFormattingStateFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 2)
    )

    expect(createSelectionFormattingState(fixture.projection, selection)).toEqual({
      run: {
        bold: { value: undefined, mixed: true },
        italic: { value: undefined, mixed: true },
        underline: { value: true, mixed: false },
        strike: { value: undefined, mixed: true },
        superscript: { value: undefined, mixed: true },
        subscript: { value: undefined, mixed: true },
        fontFamily: { value: undefined, mixed: true },
        fontSizeTwips: { value: undefined, mixed: true },
        color: { value: undefined, mixed: true },
        backgroundColor: { value: undefined, mixed: true }
      },
      paragraph: {
        alignment: { value: undefined, mixed: true },
        lineHeight: { value: undefined, mixed: true },
        indentLeftTwips: { value: undefined, mixed: true },
        spacingBeforeTwips: { value: undefined, mixed: true },
        spacingAfterTwips: { value: undefined, mixed: true },
        firstLineIndentTwips: { value: undefined, mixed: true },
        hangingIndentTwips: { value: undefined, mixed: true },
        styleId: { value: undefined, mixed: true },
        list: { value: undefined, mixed: true }
      }
    })
  })

  it('keeps paragraph and run selection semantics consistent at the half-open end boundary', () => {
    const fixture = createFormattingStateFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-2', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 0)
    )

    expect(createSelectionFormattingState(fixture.projection, selection).paragraph).toEqual({
      alignment: { value: 'left', mixed: false },
      lineHeight: { value: 1.5, mixed: false },
      indentLeftTwips: { value: 0, mixed: false },
      spacingBeforeTwips: { value: 120, mixed: false },
      spacingAfterTwips: { value: 240, mixed: false },
      firstLineIndentTwips: { value: 360, mixed: false },
      hangingIndentTwips: { value: 0, mixed: false },
      styleId: { value: 'Heading1', mixed: false },
      list: { value: null, mixed: false }
    })
  })

  it('returns null states when selection is absent', () => {
    const fixture = createFormattingStateFixture()

    expect(createSelectionFormattingState(fixture.projection, null)).toEqual({
      run: null,
      paragraph: null
    })
  })

  it('treats structurally equal list semantics as the same paragraph state', () => {
    const fixture = createUniformListFormattingStateFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 0),
      fixture.createAnchor('paragraph-2', 'run-2', 2)
    )

    expect(createSelectionFormattingState(fixture.projection, selection).paragraph?.list).toEqual({
      value: {
        numberingId: 'jword-list-bullet',
        level: 0
      },
      mixed: false
    })
  })

  it('resolves fallback font family and default body font size when run properties are absent', () => {
    const fixture = createDefaultRunFormattingStateFixture()
    const selection = createCollapsedSelection(fixture.createAnchor('paragraph-1', 'run-1', 1))

    expect(createSelectionFormattingState(fixture.projection, selection)).toMatchObject({
      run: {
        fontFamily: { value: 'Arial', mixed: false },
        fontSizeTwips: { value: 240, mixed: false }
      },
      paragraph: {
        lineHeight: { value: 1.25, mixed: false }
      }
    })
  })

  it('resolves paragraph style default font sizes and avoids false mixed states for equal effective values', () => {
    const fixture = createEffectiveFontFormattingStateFixture()
    const collapsedSelection = createCollapsedSelection(fixture.createAnchor('paragraph-1', 'run-1', 1))
    const rangeSelection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 0),
      fixture.createAnchor('paragraph-1', 'run-2', 1)
    )

    expect(createSelectionFormattingState(fixture.projection, collapsedSelection).run).toMatchObject({
      fontFamily: { value: 'Arial', mixed: false },
      fontSizeTwips: { value: 480, mixed: false }
    })
    expect(createSelectionFormattingState(fixture.projection, rangeSelection).run).toMatchObject({
      fontFamily: { value: 'Arial', mixed: false },
      fontSizeTwips: { value: 480, mixed: false }
    })
  })

  it('treats implicit and explicit default line heights as the same effective paragraph value', () => {
    const fixture = createEffectiveLineHeightFormattingStateFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 0),
      fixture.createAnchor('paragraph-1', 'run-2', 1)
    )

    expect(createSelectionFormattingState(fixture.projection, selection).paragraph?.lineHeight).toEqual({
      value: 1.25,
      mixed: false
    })
  })
})

function createFormattingStateFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraphOne = createParagraphRecord('paragraph-1' as BlockId)
  const paragraphTwo = createParagraphRecord('paragraph-2' as BlockId)
  const runOne = createRunRecord('run-1' as RunId, '你好')
  const runTwo = createRunRecord('run-2' as RunId, '世界')
  const runThree = createRunRecord('run-3' as RunId, '工具栏')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraphOne, paragraphTwo])
  getParagraphRuns(paragraphOne).push([runOne, runTwo])
  getParagraphRuns(paragraphTwo).push([runThree])

  setRecordProperties(runOne, DOCUMENT_STORE_FIELDS.run.properties, {
    bold: true,
    underline: true,
    superscript: true,
    fontFamily: 'SimSun',
    fontSizeTwips: 420,
    color: '#111111',
    backgroundColor: '#fff59d',
    lineHeight: 1.5
  })
  setRecordProperties(runTwo, DOCUMENT_STORE_FIELDS.run.properties, {
    bold: false,
    italic: true,
    underline: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360,
    color: '#222222',
    lineHeight: 1.5
  })
  setRecordProperties(runThree, DOCUMENT_STORE_FIELDS.run.properties, {
    strike: true,
    subscript: true,
    underline: true,
    fontFamily: 'SimHei',
    fontSizeTwips: 300,
    color: '#333333',
    backgroundColor: '#e0f2fe',
    lineHeight: 2
  })
  setRecordProperties(paragraphOne, DOCUMENT_STORE_FIELDS.block.properties, {
    alignment: 'left',
    indentLeftTwips: 0,
    spacingBeforeTwips: 120,
    spacingAfterTwips: 240,
    firstLineIndentTwips: 360,
    hangingIndentTwips: 0,
    styleId: 'Heading1'
  })
  setRecordProperties(paragraphTwo, DOCUMENT_STORE_FIELDS.block.properties, {
    alignment: 'center',
    indentLeftTwips: 720,
    spacingBeforeTwips: 60,
    spacingAfterTwips: 120,
    firstLineIndentTwips: 0,
    hangingIndentTwips: 240,
    styleId: 'ListBullet',
    listNumberingId: 'jword-list-bullet',
    listLevel: 1
  })

  const projection = createDocumentProjection(store)

  return {
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function createPoisonedTrailingTextProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-1',
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-1',
              properties: {
                lineHeight: 1.25
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  properties: {
                    bold: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: '命中'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-2',
              runs: [
                {
                  kind: 'run',
                  id: 'run-2',
                  inlines: [
                    createPoisonedTextInline()
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}

function createPoisonedTextInline(): TextInline {
  return Object.freeze(Object.defineProperty(
    {
      kind: 'text' as const
    },
    'text',
    {
      enumerable: true,
      get() {
        throw new Error('折叠选区不应读取未命中段落文本')
      }
    }
  )) as TextInline
}

function createUniformListFormattingStateFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraphOne = createParagraphRecord('paragraph-1' as BlockId)
  const paragraphTwo = createParagraphRecord('paragraph-2' as BlockId)
  const runOne = createRunRecord('run-1' as RunId, '条目一')
  const runTwo = createRunRecord('run-2' as RunId, '条目二')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraphOne, paragraphTwo])
  getParagraphRuns(paragraphOne).push([runOne])
  getParagraphRuns(paragraphTwo).push([runTwo])

  setRecordProperties(paragraphOne, DOCUMENT_STORE_FIELDS.block.properties, {
    listNumberingId: 'jword-list-bullet',
    listLevel: 0
  })
  setRecordProperties(paragraphTwo, DOCUMENT_STORE_FIELDS.block.properties, {
    listNumberingId: 'jword-list-bullet',
    listLevel: 0
  })

  const projection = createDocumentProjection(store)

  return {
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function createDefaultRunFormattingStateFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraph = createParagraphRecord('paragraph-1' as BlockId)
  const run = createRunRecord('run-1' as RunId, '正文')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([run])

  const projection = createDocumentProjection(store)

  return {
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function createEffectiveFontFormattingStateFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraph = createParagraphRecord('paragraph-1' as BlockId)
  const runOne = createRunRecord('run-1' as RunId, '标题')
  const runTwo = createRunRecord('run-2' as RunId, '一')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([runOne, runTwo])

  setRecordProperties(paragraph, DOCUMENT_STORE_FIELDS.block.properties, {
    styleId: 'Heading1'
  })
  setRecordProperties(runTwo, DOCUMENT_STORE_FIELDS.run.properties, {
    fontSizeTwips: 480,
    fontFamily: 'Arial'
  })

  const projection = createDocumentProjection(store)

  return {
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function createEffectiveLineHeightFormattingStateFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraph = createParagraphRecord('paragraph-1' as BlockId)
  const runOne = createRunRecord('run-1' as RunId, '甲')
  const runTwo = createRunRecord('run-2' as RunId, '乙')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([runOne, runTwo])

  setRecordProperties(runTwo, DOCUMENT_STORE_FIELDS.run.properties, {
    lineHeight: 1.25
  })

  const projection = createDocumentProjection(store)

  return {
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function setRecordProperties(
  record: { get(key: string): unknown },
  key: string,
  properties: Readonly<Record<string, DocumentStoreJson>>
) {
  const propertyMap = record.get(key)

  if (propertyMap === null || propertyMap === undefined || typeof propertyMap !== 'object' || typeof (propertyMap as { set?: unknown }).set !== 'function') {
    throw new Error('属性容器缺失')
  }

  for (const [propertyKey, value] of Object.entries(properties)) {
    ;(propertyMap as { set(name: string, value: DocumentStoreJson): void }).set(propertyKey, value)
  }
}
