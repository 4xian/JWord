/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1.5 Operation adapter 能把第一批操作写入 Y.Doc 状态结构。
 * 边界：只覆盖 adapter 的最小状态变更，不测试 transaction pipeline、projection、布局、渲染或输入。
 * 协作模块：transaction pipeline 后续会在 ydoc.transact(origin) 内复用这些 adapter。
 * 性能/安全约束：测试只使用内存中的 Y.Doc，不触发 DOM、网络或磁盘写入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#34-operation。
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks
} from '../src/document-store'
import type { BlockRecord, DocumentStore, RunRecord, SectionRecord } from '../src/document-store'
import { createOperationAdapter } from '../src/operation-adapter'
import {
  createGraphemeIndex,
  createTextAnchorRef,
  resolveAnchorRef
} from '../src/position'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import { createDocumentProjection } from '../src/projection'
import type { TextPosition } from '../src/transaction'

describe('createOperationAdapter', () => {
  it('applies insertText deleteRange and property operations to Y.Doc records', () => {
    const { store, paragraphId, runId, run } = createTextFixture('你好JWord')
    const adapter = createOperationAdapter(store)

    adapter.apply({
      kind: 'insertText',
      at: createPosition(paragraphId, runId, 2),
      text: '，'
    })
    adapter.apply({
      kind: 'deleteRange',
      range: {
        anchor: createPosition(paragraphId, runId, 2),
        focus: createPosition(paragraphId, runId, 3)
      }
    })
    adapter.apply({
      kind: 'setRunProperties',
      runId,
      properties: { bold: true }
    })
    adapter.apply({
      kind: 'setParagraphProperties',
      paragraphId,
      properties: { alignment: 'center' }
    })

    expect(getRunText(run).toString()).toBe('你好JWord')
    expect(readProperty(run, DOCUMENT_STORE_FIELDS.run.properties, 'bold')).toBe(true)

    const paragraph = getSectionBlocks(store.sections.get(0) as SectionRecord).get(0) as BlockRecord

    expect(readProperty(paragraph, DOCUMENT_STORE_FIELDS.block.properties, 'alignment')).toBe('center')
  })

  it('applies serializable text positions after text shifts', () => {
    const { store, paragraphId, runId, run } = createTextFixture('abc')
    const adapter = createOperationAdapter(store)

    getRunText(run).insert(0, 'x')

    adapter.apply({
      kind: 'insertText',
      at: createPosition(paragraphId, runId, 2),
      text: 'Z'
    })

    expect(getRunText(run).toString()).toBe('xaZbc')
  })

  it('applies text operations at grapheme boundaries without splitting UTF-16 pairs', () => {
    const { store, paragraphId, runId, run } = createTextFixture('a😊e\u0301中')
    const adapter = createOperationAdapter(store)

    adapter.apply({
      kind: 'insertText',
      at: createPosition(paragraphId, runId, 2),
      text: 'X'
    })
    adapter.apply({
      kind: 'deleteRange',
      range: {
        anchor: createPosition(paragraphId, runId, 1),
        focus: createPosition(paragraphId, runId, 2)
      }
    })

    expect(getRunText(run).toString()).toBe('aXe\u0301中')
  })

  it('splits blocks at grapheme boundaries and migrates tail anchors by grapheme index', () => {
    const { store, paragraphId, runId, run } = createTextFixture('a😊e\u0301中')
    const adapter = createOperationAdapter(store)
    const anchor = createTextAnchorRef({
      documentId: 'document-1' as DocumentId,
      sectionId: 'section-1' as SectionId,
      blockId: paragraphId,
      runId,
      graphemeIndex: createGraphemeIndex(3),
      text: getRunText(run)
    })

    adapter.apply({
      kind: 'splitBlock',
      at: createPosition(paragraphId, runId, 2),
      newBlockId: 'paragraph-2' as BlockId,
      newRunId: 'run-2' as RunId
    })

    const sectionBlocks = getSectionBlocks(store.sections.get(0) as SectionRecord)
    const firstRuns = getParagraphRuns(sectionBlocks.get(0) as BlockRecord)
    const secondRuns = getParagraphRuns(sectionBlocks.get(1) as BlockRecord)
    const snapshot = resolveAnchorRef(anchor, store.doc)

    expect(getRunText(firstRuns.get(0)).toString()).toBe('a😊')
    expect(getRunText(secondRuns.get(0)).toString()).toBe('e\u0301中')
    expect(snapshot?.blockId).toBe('paragraph-2')
    expect(snapshot?.runId).toBe('run-2')
    expect(snapshot?.graphemeIndex).toBe(createGraphemeIndex(1))
  })

  it('migrates anchors in following runs only when split is replayed through the operation adapter', () => {
    const { store, paragraphId, firstRunId, secondRunId, secondRun } = createTwoRunTextFixture('你好', '世界')
    const adapter = createOperationAdapter(store)
    const anchor = createTextAnchorRef({
      documentId: 'document-1' as DocumentId,
      sectionId: 'section-1' as SectionId,
      blockId: paragraphId,
      runId: secondRunId,
      graphemeIndex: createGraphemeIndex(1),
      text: getRunText(secondRun)
    })

    adapter.apply({
      kind: 'splitBlock',
      at: createPosition(paragraphId, firstRunId, 1),
      newBlockId: 'paragraph-2' as BlockId,
      newRunId: 'run-split' as RunId
    })

    const snapshot = resolveAnchorRef(anchor, store.doc)

    expect(snapshot?.blockId).toBe('paragraph-2')
    expect(snapshot?.runId).toBe(secondRunId)
    expect(snapshot?.graphemeIndex).toBe(createGraphemeIndex(1))
  })

  it('does not promise anchor migration for raw Yjs structural changes outside the adapter', () => {
    const { store, secondRunId, secondRun } = createTwoRunTextFixture('你好', '世界')
    const sectionBlocks = getSectionBlocks(store.sections.get(0) as SectionRecord)
    const firstParagraphRuns = getParagraphRuns(sectionBlocks.get(0) as BlockRecord)
    const anchor = createTextAnchorRef({
      documentId: 'document-1' as DocumentId,
      sectionId: 'section-1' as SectionId,
      blockId: 'paragraph-1' as BlockId,
      runId: secondRunId,
      graphemeIndex: createGraphemeIndex(1),
      text: getRunText(secondRun)
    })
    const rawParagraph = createParagraphRecord('paragraph-raw' as BlockId)

    sectionBlocks.insert(1, [rawParagraph])
    getParagraphRuns(rawParagraph).push([createRunRecord(secondRunId, getRunText(secondRun).toString())])
    firstParagraphRuns.delete(1, 1)

    const snapshot = resolveAnchorRef(anchor, store.doc)

    expect(snapshot?.blockId).not.toBe('paragraph-raw')
  })

  it('splits and merges adjacent paragraph blocks', () => {
    const { store, paragraphId, runId } = createTextFixture('你好世界')
    const adapter = createOperationAdapter(store)
    const sectionBlocks = getSectionBlocks(store.sections.get(0) as SectionRecord)

    adapter.apply({
      kind: 'splitBlock',
      at: createPosition(paragraphId, runId, 2),
      newBlockId: 'paragraph-2' as BlockId,
      newRunId: 'run-2' as RunId
    })

    const splitBlocks = sectionBlocks.toArray()
    const firstRuns = getParagraphRuns(splitBlocks[0] as BlockRecord)
    const secondRuns = getParagraphRuns(splitBlocks[1] as BlockRecord)

    expect(splitBlocks).toHaveLength(2)
    expect(getRunText(firstRuns.get(0)).toString()).toBe('你好')
    expect(getRunText(secondRuns.get(0)).toString()).toBe('世界')

    adapter.apply({
      kind: 'mergeBlock',
      targetBlockId: paragraphId,
      sourceBlockId: 'paragraph-2' as BlockId
    })

    const mergedRuns = getParagraphRuns(sectionBlocks.get(0) as BlockRecord)

    expect(sectionBlocks.toArray()).toHaveLength(1)
    expect(mergedRuns.map((run) => getRunText(run).toString())).toEqual(['你好', '世界'])
  })

  it('inserts and deletes paragraph blocks from a section', () => {
    const store = createDocumentStore()
    const sectionId = 'section-1' as SectionId
    const section = createSectionRecord(sectionId)
    const adapter = createOperationAdapter(store)

    store.sections.push([section])

    adapter.apply({
      kind: 'insertBlock',
      sectionId,
      placement: { kind: 'append' },
      block: {
        kind: 'paragraph',
        id: 'paragraph-inserted',
        runs: [
          {
            kind: 'run',
            id: 'run-inserted',
            inlines: [
              {
                kind: 'text',
                text: '插入块'
              }
            ]
          }
        ]
      }
    })

    const sectionBlocks = getSectionBlocks(section)
    const inserted = sectionBlocks.get(0) as BlockRecord

    expect(sectionBlocks.toArray()).toHaveLength(1)
    expect(getRunText(getParagraphRuns(inserted).get(0) as RunRecord).toString()).toBe('插入块')

    adapter.apply({
      kind: 'deleteBlock',
      blockId: 'paragraph-inserted' as BlockId
    })

    expect(sectionBlocks.toArray()).toHaveLength(0)
  })

  it('preserves structured run metadata when insertBlock writes model data into the store', () => {
    const store = createDocumentStore()
    const sectionId = 'section-1' as SectionId
    const section = createSectionRecord(sectionId)
    const adapter = createOperationAdapter(store)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
    store.sections.push([section])

    adapter.apply({
      kind: 'insertBlock',
      sectionId,
      placement: { kind: 'append' },
      block: {
        kind: 'paragraph',
        id: 'paragraph-structured',
        runs: [
          {
            kind: 'run',
            id: 'run-structured',
            field: {
              code: 'MERGEFIELD customer_name'
            },
            link: {
              target: 'https://example.com/customer'
            },
            revisionId: 'revision-structured',
            inlines: [
              {
                kind: 'text',
                text: '客户：'
              },
              {
                kind: 'bookmark',
                id: 'bookmark-structured',
                name: 'customer',
                edge: 'start'
              },
              {
                kind: 'text',
                text: '张三'
              },
              {
                kind: 'bookmark',
                id: 'bookmark-structured',
                name: 'customer',
                edge: 'end'
              }
            ]
          }
        ]
      }
    })

    const projection = createDocumentProjection(store)
    const paragraph = projection.document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    expect(paragraph.runs[0]).toMatchObject({
      kind: 'run',
      id: 'run-structured',
      field: {
        code: 'MERGEFIELD customer_name'
      },
      link: {
        target: 'https://example.com/customer'
      },
      revisionId: 'revision-structured',
      inlines: [
        {
          kind: 'text',
          text: '客户：'
        },
        {
          kind: 'bookmark',
          id: 'bookmark-structured',
          name: 'customer',
          edge: 'start'
        },
        {
          kind: 'text',
          text: '张三'
        },
        {
          kind: 'bookmark',
          id: 'bookmark-structured',
          name: 'customer',
          edge: 'end'
        }
      ]
    })
  })
})

function createTextFixture(text: string) {
  const store = createDocumentStore()
  const sectionId = 'section-1' as SectionId
  const paragraphId = 'paragraph-1' as BlockId
  const runId = 'run-1' as RunId
  const section = createSectionRecord(sectionId)
  const paragraph = createParagraphRecord(paragraphId)
  const run = createRunRecord(runId, text)

  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([run])

  return {
    store,
    paragraphId,
    runId,
    run
  } satisfies {
    readonly store: DocumentStore
    readonly paragraphId: BlockId
    readonly runId: RunId
    readonly run: RunRecord
  }
}

function createTwoRunTextFixture(firstText: string, secondText: string) {
  const store = createDocumentStore()
  const sectionId = 'section-1' as SectionId
  const paragraphId = 'paragraph-1' as BlockId
  const firstRunId = 'run-1' as RunId
  const secondRunId = 'run-2' as RunId
  const section = createSectionRecord(sectionId)
  const paragraph = createParagraphRecord(paragraphId)
  const firstRun = createRunRecord(firstRunId, firstText)
  const secondRun = createRunRecord(secondRunId, secondText)

  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([firstRun, secondRun])

  return {
    store,
    paragraphId,
    firstRunId,
    secondRunId,
    secondRun
  } satisfies {
    readonly store: DocumentStore
    readonly paragraphId: BlockId
    readonly firstRunId: RunId
    readonly secondRunId: RunId
    readonly secondRun: RunRecord
  }
}

function createPosition(blockId: BlockId, runId: RunId, graphemeIndex: number): TextPosition {
  return {
    sectionId: 'section-1',
    blockId: String(blockId),
    runId: String(runId),
    graphemeIndex
  }
}

interface SharedMapReader {
  get(fieldName: string): unknown
}

function readProperty(record: SharedMapReader, fieldName: string, propertyName: string): unknown {
  const properties = record.get(fieldName)

  if (properties instanceof Y.Map) {
    return properties.get(propertyName)
  }

  throw new Error('属性容器缺失')
}
