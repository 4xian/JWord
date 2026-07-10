/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 事务管线可记录 origin、应用 operation 并产出只读投影。
 * 边界：只测试 Command/Operation 包装、transact 外壳和 adapter 调用，不测试布局、渲染或输入。
 * 协作模块：后续 history、selection 和 Editor Facade 会复用同一事务入口。
 * 性能/安全约束：测试只依赖内存中的 Y.Doc，不触发 DOM 或外部 I/O。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks
} from '../../src/model/document-store'
import type { BlockId, DocumentId, RunId, SectionId } from '../../src/model/position'
import type { Paragraph } from '../../src/model/types'
import { createTransactionPipeline } from '../../src/operations/transaction'
import type { Operation, TextPosition } from '../../src/operations/transaction'

function createTestPosition(graphemeIndex = 0): TextPosition {
  return {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex
  }
}

describe('createTransactionPipeline', () => {
  it('accepts the first Gate 1.4 operation schemas as serializable operations', () => {
    const sectionId = 'section-1' as SectionId
    const blockId = 'paragraph-1' as BlockId
    const nextBlockId = 'paragraph-2' as BlockId
    const runId = 'run-1' as RunId
    const anchor = createTestPosition(0)
    const range = { anchor, focus: anchor }
    const operations: readonly Operation[] = [
      { kind: 'insertText', at: anchor, text: '你好' },
      { kind: 'deleteRange', range },
      { kind: 'setRunProperties', runId, properties: { bold: true } },
      { kind: 'setParagraphProperties', paragraphId: blockId, properties: { alignment: 'center' } },
      { kind: 'splitBlock', at: anchor, newBlockId: nextBlockId, newRunId: 'run-2' },
      { kind: 'mergeBlock', targetBlockId: blockId, sourceBlockId: nextBlockId },
      {
        kind: 'insertBlock',
        sectionId,
        placement: { kind: 'after', blockId },
        block: {
          kind: 'paragraph',
          id: 'paragraph-3',
          runs: [
            {
              kind: 'run',
              id: 'run-2',
              inlines: []
            }
          ]
        }
      },
      { kind: 'deleteBlock', blockId }
    ]

    const serialized = JSON.parse(JSON.stringify(operations)) as Array<{ kind: string }>

    expect(serialized.map((operation) => operation.kind)).toEqual([
      'insertText',
      'deleteRange',
      'setRunProperties',
      'setParagraphProperties',
      'splitBlock',
      'mergeBlock',
      'insertBlock',
      'deleteBlock'
    ])
  })

  it('returns command metadata and uses the provided origin for Y.Doc transaction', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const paragraph = createParagraphRecord('paragraph-1' as BlockId)
    const run = createRunRecord('run-1' as RunId, '你好')
    const pipeline = createTransactionPipeline(store.doc)
    const observedOrigins: string[] = []
    const observedEvents: Array<[string, boolean]> = []
    const position = createTestPosition(2)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    pipeline.doc.on('afterTransaction', (transaction) => {
      observedOrigins.push(String(transaction.origin))
    })
    pipeline.subscribe((event) => {
      observedEvents.push([event.origin, event.dirty])
    })

    const result = pipeline.run(
      {
        name: 'insertText',
        operations: [{ kind: 'insertText', at: position, text: '，JWord' }]
      },
      { origin: 'local-user', label: '输入文字' }
    )

    expect(result.commandName).toBe('insertText')
    expect(result.origin).toBe('local-user')
    expect(result.metadata).toEqual({ origin: 'local-user', label: '输入文字' })
    expect(result.operationKinds).toEqual(['insertText'])
    expect(result.dirty).toBe(true)
    expect(result.operations).toEqual([
      { kind: 'insertText', at: position, text: '，JWord' }
    ])
    expect(getRunText(run).toString()).toBe('你好，JWord')
    expect(result.projection.document.sections[0]?.blocks[0]?.kind).toBe('paragraph')
    expect(observedEvents).toEqual([['local-user', true]])
    expect(observedOrigins).toContain('local-user')
  })

  it('输入事务只重建变更段落的 projection 快照', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const firstParagraph = createParagraphRecord('paragraph-1' as BlockId)
    const secondParagraph = createParagraphRecord('paragraph-2' as BlockId)
    const thirdParagraph = createParagraphRecord('paragraph-3' as BlockId)
    const firstRun = createRunRecord('run-1' as RunId, '第一段')
    const secondRun = createRunRecord('run-2' as RunId, '第二段')
    const thirdRun = createRunRecord('run-3' as RunId, '第三段')
    const pipeline = createTransactionPipeline(store.doc)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-incremental' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([firstParagraph, secondParagraph, thirdParagraph])
    getParagraphRuns(firstParagraph).push([firstRun])
    getParagraphRuns(secondParagraph).push([secondRun])
    getParagraphRuns(thirdParagraph).push([thirdRun])

    const baseline = pipeline.run(
      {
        name: 'seedProjection',
        operations: []
      },
      { origin: 'local-user' }
    ).projection

    const result = pipeline.run(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: {
              sectionId: 'section-1',
              blockId: 'paragraph-2',
              runId: 'run-2',
              graphemeIndex: 3
            },
            text: '更新'
          }
        ]
      },
      { origin: 'local-user' }
    )

    const previousSection = baseline.document.sections[0]
    const nextSection = result.projection.document.sections[0]
    const previousBlocks = previousSection?.blocks ?? []
    const nextBlocks = nextSection?.blocks ?? []
    const nextSecondParagraph = nextBlocks[1] as Paragraph | undefined

    expect(nextSection).not.toBe(previousSection)
    expect(nextBlocks[0]).toBe(previousBlocks[0])
    expect(nextBlocks[1]).not.toBe(previousBlocks[1])
    expect(nextBlocks[2]).toBe(previousBlocks[2])
    expect(nextSecondParagraph?.runs[0]?.inlines).toEqual([
      {
        kind: 'text',
        text: '第二段更新'
      }
    ])
  })

  it('默认本地事务不编码 update byte length 诊断', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const paragraph = createParagraphRecord('paragraph-1' as BlockId)
    const run = createRunRecord('run-1' as RunId, '诊断')
    const pipeline = createTransactionPipeline(store.doc)

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-diagnostic' as DocumentId)
    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    const result = pipeline.run(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: createTestPosition(2),
            text: '跳过'
          }
        ]
      },
      { origin: 'local-user' }
    )

    expect(getRunText(run).toString()).toBe('诊断跳过')
    expect(result.dirty).toBe(true)
    expect(result.diagnostic.updateByteLength).toBe(0)
  })

  it('rejects blank origin before running a transaction', () => {
    const pipeline = createTransactionPipeline()

    expect(() =>
      pipeline.run(
        {
          name: 'insertText',
          operations: []
        },
        { origin: '   ' }
      )
    ).toThrow('事务 origin 不能为空')
  })

  it('isolates listener errors and continues notifying later listeners', () => {
    const store = createDocumentStore()
    const pipeline = createTransactionPipeline(store.doc)
    const observedEvents: string[] = []

    store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)

    pipeline.subscribe((event) => {
      observedEvents.push(`before:${event.commandName}:${event.origin}`)
    })
    pipeline.subscribe(() => {
      throw new Error('监听器失败')
    })
    pipeline.subscribe((event) => {
      observedEvents.push(`after:${event.commandName}:${event.origin}`)
    })

    const result = pipeline.run(
      {
        name: 'noop',
        operations: []
      },
      { origin: 'local-user' }
    )

    expect(result.commandName).toBe('noop')
    expect(result.origin).toBe('local-user')
    expect(result.operationKinds).toEqual([])
    expect(observedEvents).toEqual(['before:noop:local-user', 'after:noop:local-user'])
  })
})
