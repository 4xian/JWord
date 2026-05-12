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
import type { BlockId, RunId, SectionId } from '../src/position'
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
