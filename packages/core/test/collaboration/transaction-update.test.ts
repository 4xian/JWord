/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 raw Yjs update 仍通过 transaction pipeline 形成受控 projection 与诊断。
 * 边界：只覆盖内存 Y.Doc update，不接 provider、IndexedDB、WebSocket 或浏览器 DOM。
 * 协作模块：collab provider、persistence update log 和 Editor facade 后续复用同一 apply update 入口。
 * 性能/安全约束：测试只使用小型内存文档，禁止保存 projection JSON 作为协同真源。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as Y from 'yjs'
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
import { createTransactionPipeline } from '../../src/operations/transaction'

describe('Gate 6 transaction update hook', () => {
  it('applies a remote Yjs update and emits bounded diagnostics without exposing store internals', () => {
    const source = createInitializedStore('源文档')
    const target = createDocumentStore()
    const sourcePipeline = createTransactionPipeline(source.doc)
    const targetPipeline = createTransactionPipeline(target.doc, {
      updateByteLengthDiagnostics: true
    })
    const events: string[] = []
    const update = Y.encodeStateAsUpdate(source.doc)

    targetPipeline.subscribe((event) => {
      events.push(`${event.diagnostic.source}:${event.diagnostic.updateByteLength}:${event.origin}`)
    })

    const result = targetPipeline.applyUpdate(update, {
      origin: 'remote-user',
      requestId: 'remote-update-1',
      roomId: 'room-gate6',
      clientId: 'client-a',
      authorId: 'author-a'
    })

    expect(readFirstRunText(target)).toBe('源文档')
    expect(result.commandName).toBe('applySyncUpdate')
    expect(result.operationKinds).toEqual([])
    expect(result.diagnostic).toMatchObject({
      origin: 'remote-user',
      source: 'remote',
      local: false,
      remote: true,
      requestId: 'remote-update-1',
      roomId: 'room-gate6',
      clientId: 'client-a',
      authorId: 'author-a',
      updateByteLength: update.byteLength
    })
    expect('doc' in result.diagnostic).toBe(false)
    expect('store' in result.diagnostic).toBe(false)
    expect(events).toEqual([`remote:${update.byteLength}:remote-user`])

    const replay = targetPipeline.applyUpdate(update, {
      origin: 'remote-user',
      requestId: 'remote-update-replay'
    })

    expect(readFirstRunText(target)).toBe('源文档')
    expect(replay.diagnostic.updateByteLength).toBe(0)
  })

  it('records update byte length for local command transactions', () => {
    const store = createInitializedStore('本地')
    const pipeline = createTransactionPipeline(store.doc, {
      updateByteLengthDiagnostics: true
    })
    const result = pipeline.run(
      {
        name: 'insertText',
        operations: [
          {
            kind: 'insertText',
            at: {
              sectionId: 'section-gate6',
              blockId: 'paragraph-gate6',
              runId: 'run-gate6',
              graphemeIndex: 2
            },
            text: '协同'
          }
        ]
      },
      {
        origin: 'local-user',
        requestId: 'local-command-1'
      }
    )

    expect(readFirstRunText(store)).toBe('本地协同')
    expect(result.diagnostic).toMatchObject({
      commandName: 'insertText',
      origin: 'local-user',
      source: 'local',
      local: true,
      remote: false,
      requestId: 'local-command-1'
    })
    expect(result.diagnostic.updateByteLength).toBeGreaterThan(0)
  })
})

/** 创建带单段文本的内存 store。 */
function createInitializedStore(text: string) {
  const store = createDocumentStore()
  const section = createSectionRecord('section-gate6' as SectionId)
  const paragraph = createParagraphRecord('paragraph-gate6' as BlockId)
  const run = createRunRecord('run-gate6' as RunId, text)

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-gate6' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([run])

  return store
}

/** 读取第一段第一 run 文本。 */
function readFirstRunText(store: ReturnType<typeof createInitializedStore>): string {
  const section = store.sections.get(0)
  const paragraph = section === undefined ? undefined : getSectionBlocks(section).get(0)
  const run = paragraph === undefined ? undefined : getParagraphRuns(paragraph).get(0)

  return run === undefined ? '' : getRunText(run).toString()
}
