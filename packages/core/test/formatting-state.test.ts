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
} from '../src/index'
import {
  DOCUMENT_STORE_FIELDS,
  type DocumentStoreJson,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getSectionBlocks
} from '../src/document-store'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import { createAnchorRef, createGraphemeIndex } from '../src/position'
import { createDocumentProjection } from '../src/projection'
import { createCollapsedSelection, createSelectionState } from '../src/selection'

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
        fontFamily: { value: 'SimSun', mixed: false },
        fontSizeTwips: { value: 420, mixed: false },
        color: { value: '#111111', mixed: false },
        backgroundColor: { value: '#fff59d', mixed: false }
      },
      paragraph: {
        alignment: { value: 'left', mixed: false },
        indentLeftTwips: { value: 0, mixed: false }
      }
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
        fontFamily: { value: undefined, mixed: true },
        fontSizeTwips: { value: undefined, mixed: true },
        color: { value: undefined, mixed: true },
        backgroundColor: { value: undefined, mixed: true }
      },
      paragraph: {
        alignment: { value: undefined, mixed: true },
        indentLeftTwips: { value: undefined, mixed: true }
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
      indentLeftTwips: { value: 0, mixed: false }
    })
  })

  it('returns null states when selection is absent', () => {
    const fixture = createFormattingStateFixture()

    expect(createSelectionFormattingState(fixture.projection, null)).toEqual({
      run: null,
      paragraph: null
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
    fontFamily: 'SimSun',
    fontSizeTwips: 420,
    color: '#111111',
    backgroundColor: '#fff59d'
  })
  setRecordProperties(runTwo, DOCUMENT_STORE_FIELDS.run.properties, {
    bold: false,
    italic: true,
    underline: true,
    fontFamily: 'KaiTi',
    fontSizeTwips: 360,
    color: '#222222'
  })
  setRecordProperties(runThree, DOCUMENT_STORE_FIELDS.run.properties, {
    strike: true,
    underline: true,
    fontFamily: 'SimHei',
    fontSizeTwips: 300,
    color: '#333333',
    backgroundColor: '#e0f2fe'
  })
  setRecordProperties(paragraphOne, DOCUMENT_STORE_FIELDS.block.properties, {
    alignment: 'left',
    indentLeftTwips: 0
  })
  setRecordProperties(paragraphTwo, DOCUMENT_STORE_FIELDS.block.properties, {
    alignment: 'center',
    indentLeftTwips: 720
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
