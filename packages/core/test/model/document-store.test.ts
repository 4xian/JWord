/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 Y.Doc 文档状态壳能提供共享容器。
 * 边界：只检查容器初始化和事务 origin，不实现具体编辑操作。
 * 协作模块：transaction pipeline、model、history 和 persistence 后续复用同一个状态壳。
 * 性能/安全约束：测试只使用内存中的 Y.Doc，不触发 DOM、网络或磁盘写入。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#32-状态真源。
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_CONTAINERS,
  DOCUMENT_STORE_FIELDS,
  DOCUMENT_STORE_SCHEMA_VERSION,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  createTableCellRecord,
  createTableRecord,
  createTableRowRecord,
  getParagraphRuns,
  getRunField,
  getRunInlines,
  getRunLink,
  getRunRevisionId,
  getRunText,
  getSectionBlocks,
  getTableCellBlocks,
  getTableRowCells,
  getTableRows
} from '../../src/model/document-store'
import type {
  CommentRecord,
  DocumentRootMap,
  ResourceId,
  ResourceRecord,
  RevisionRecord,
  SectionRecord,
  StyleId,
  StyleRecord
} from '../../src/model/document-store'
import type { BlockId, CommentId, DocumentId, RevisionId, RunId, SectionId } from '../../src/model/position'

describe('createDocumentStore', () => {
  it('creates the minimum shared containers on one Y.Doc', () => {
    const store = createDocumentStore()

    expect(store.doc).toBeInstanceOf(Y.Doc)
    expect(store.document).toBe(store.doc.getMap(DOCUMENT_STORE_CONTAINERS.document))
    expect(store.sections).toBe(store.doc.getArray(DOCUMENT_STORE_CONTAINERS.sections))
    expect(store.resources).toBe(store.doc.getMap(DOCUMENT_STORE_CONTAINERS.resources))
    expect(store.styles).toBe(store.doc.getMap(DOCUMENT_STORE_CONTAINERS.styles))
    expect(store.comments).toBe(store.doc.getMap(DOCUMENT_STORE_CONTAINERS.comments))
    expect(store.revisions).toBe(store.doc.getMap(DOCUMENT_STORE_CONTAINERS.revisions))
  })

  it('publishes the Gate 1.3 container and field layout', () => {
    expect(DOCUMENT_STORE_SCHEMA_VERSION).toBe(1)
    expect(DOCUMENT_STORE_CONTAINERS).toEqual({
      document: 'document',
      sections: 'sections',
      resources: 'resources',
      styles: 'styles',
      commentRanges: 'commentRanges',
      comments: 'comments',
      revisions: 'revisions'
    })
    expect(DOCUMENT_STORE_FIELDS.document).toEqual({
      schemaVersion: 'schemaVersion',
      id: 'id',
      metadata: 'metadata',
      sectionIds: 'sectionIds',
      resourceIds: 'resourceIds',
      styleIds: 'styleIds',
      commentIds: 'commentIds',
      revisionIds: 'revisionIds'
    })
    expect(DOCUMENT_STORE_FIELDS.section.id).toBe('id')
    expect(DOCUMENT_STORE_FIELDS.section.blocks).toBe('blocks')
    expect(DOCUMENT_STORE_FIELDS.section.blockIds).toBe('blockIds')
    expect(DOCUMENT_STORE_FIELDS.block.runs).toBe('runs')
    expect(DOCUMENT_STORE_FIELDS.block.rows).toBe('rows')
    expect(DOCUMENT_STORE_FIELDS.run.text).toBe('text')
    expect(DOCUMENT_STORE_FIELDS.tableRow.cells).toBe('cells')
    expect(DOCUMENT_STORE_FIELDS.tableCell.blocks).toBe('blocks')
    expect(DOCUMENT_STORE_FIELDS.resource.id).toBe('id')
    expect(DOCUMENT_STORE_FIELDS.style.id).toBe('id')
    expect(DOCUMENT_STORE_FIELDS.comment.anchorRangeId).toBe('anchorRangeId')
    expect(DOCUMENT_STORE_FIELDS.revision.rangeId).toBe('rangeId')
  })

  it('reuses an external Y.Doc and preserves transaction origin', () => {
    const doc = new Y.Doc()
    const store = createDocumentStore(doc)
    const observedOrigins: string[] = []
    const section = new Y.Map<unknown>() as SectionRecord

    doc.on('afterTransaction', (transaction) => {
      observedOrigins.push(String(transaction.origin))
    })

    doc.transact(() => {
      store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
      store.sections.push([section])
    }, 'local-user')

    expect(store.doc).toBe(doc)
    expect(store.document.get(DOCUMENT_STORE_FIELDS.document.id)).toBe('document-1')
    expect(store.sections.toArray()).toEqual([section])
    expect(observedOrigins).toContain('local-user')
  })

  it('separates ordered sections from id-indexed resources styles comments and revisions', () => {
    const store = createDocumentStore()
    const sectionId = 'section-1' as SectionId
    const resourceId = 'resource-1' as ResourceId
    const styleId = 'style-1' as StyleId
    const commentId = 'comment-1' as CommentId
    const revisionId = 'revision-1' as RevisionId
    const sectionIds = new Y.Array<SectionId>()
    const resourceIds = new Y.Array<ResourceId>()
    const styleIds = new Y.Array<StyleId>()
    const commentIds = new Y.Array<CommentId>()
    const revisionIds = new Y.Array<RevisionId>()
    const section = new Y.Map<unknown>() as SectionRecord
    const resource = new Y.Map<unknown>() as ResourceRecord
    const style = new Y.Map<unknown>() as StyleRecord
    const comment = new Y.Map<unknown>() as CommentRecord
    const revision = new Y.Map<unknown>() as RevisionRecord
    const documentRoot: DocumentRootMap = store.document

    sectionIds.push([sectionId])
    resourceIds.push([resourceId])
    styleIds.push([styleId])
    commentIds.push([commentId])
    revisionIds.push([revisionId])

    documentRoot.set(DOCUMENT_STORE_FIELDS.document.sectionIds, sectionIds)
    documentRoot.set(DOCUMENT_STORE_FIELDS.document.resourceIds, resourceIds)
    documentRoot.set(DOCUMENT_STORE_FIELDS.document.styleIds, styleIds)
    documentRoot.set(DOCUMENT_STORE_FIELDS.document.commentIds, commentIds)
    documentRoot.set(DOCUMENT_STORE_FIELDS.document.revisionIds, revisionIds)
    store.sections.push([section])
    store.resources.set(resourceId, resource)
    store.styles.set(styleId, style)
    store.comments.set(commentId, comment)
    store.revisions.set(revisionId, revision)

    expect(store.sections.toArray()).toEqual([section])
    expect(store.resources.get(resourceId)).toBe(resource)
    expect(store.styles.get(styleId)).toBe(style)
    expect(store.comments.get(commentId)).toBe(comment)
    expect(store.revisions.get(revisionId)).toBe(revision)
    expect(documentRoot.get(DOCUMENT_STORE_FIELDS.document.sectionIds)).toBe(sectionIds)
    expect(documentRoot.get(DOCUMENT_STORE_FIELDS.document.resourceIds)).toBe(resourceIds)
    expect(documentRoot.get(DOCUMENT_STORE_FIELDS.document.styleIds)).toBe(styleIds)
    expect(documentRoot.get(DOCUMENT_STORE_FIELDS.document.commentIds)).toBe(commentIds)
    expect(documentRoot.get(DOCUMENT_STORE_FIELDS.document.revisionIds)).toBe(revisionIds)
  })

  it('stores sections, paragraphs, runs, and text in ordered Yjs containers', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const paragraph = createParagraphRecord('paragraph-1' as BlockId)
    const run = createRunRecord('run-1' as RunId, '你好')

    store.sections.push([section])

    const blocks = getSectionBlocks(section)

    blocks.push([paragraph])

    const runs = getParagraphRuns(paragraph)

    runs.push([run])

    const text = getRunText(run)

    expect(store.sections.toArray()).toEqual([section])
    expect(blocks.toArray()).toEqual([paragraph])
    expect(runs.toArray()).toEqual([run])
    expect(text.toString()).toBe('你好')
    expect(section.get(DOCUMENT_STORE_FIELDS.section.id)).toBe('section-1')
    expect(paragraph.get(DOCUMENT_STORE_FIELDS.block.kind)).toBe('paragraph')
    expect(run.get(DOCUMENT_STORE_FIELDS.run.kind)).toBe('run')
  })

  it('stores structured run field link revisionId and inline metadata without breaking shared text', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-structured' as SectionId)
    const paragraph = createParagraphRecord('paragraph-structured' as BlockId)
    const run = createRunRecord('run-structured' as RunId, '你好世界', {
      field: {
        code: 'PAGE',
        result: '1'
      },
      link: {
        target: 'https://example.com/spec',
        tooltip: '规格链接'
      },
      revisionId: 'revision-1',
      inlines: [
        {
          kind: 'bookmark',
          id: 'bookmark-1',
          name: 'intro',
          edge: 'start'
        },
        {
          kind: 'text',
          text: '你好'
        },
        {
          kind: 'image',
          resourceId: 'resource-1',
          alt: '示意图'
        },
        {
          kind: 'break',
          breakType: 'line'
        },
        {
          kind: 'commentRangeMarker',
          commentId: 'comment-1',
          edge: 'end'
        }
      ]
    })

    store.sections.push([section])
    getSectionBlocks(section).push([paragraph])
    getParagraphRuns(paragraph).push([run])

    expect(getRunText(run).toString()).toBe('你好世界')
    expect(getRunField(run)).toEqual({
      code: 'PAGE',
      result: '1'
    })
    expect(getRunLink(run)).toEqual({
      target: 'https://example.com/spec',
      tooltip: '规格链接'
    })
    expect(getRunRevisionId(run)).toBe('revision-1')
    expect(getRunInlines(run)).toEqual([
      {
        kind: 'bookmark',
        id: 'bookmark-1',
        name: 'intro',
        edge: 'start'
      },
      {
        kind: 'text',
        text: '你好'
      },
      {
        kind: 'image',
        resourceId: 'resource-1',
        alt: '示意图'
      },
      {
        kind: 'break',
        breakType: 'line'
      },
      {
        kind: 'commentRangeMarker',
        commentId: 'comment-1',
        edge: 'end'
      }
    ])
  })

  it('stores table rows, cells, and nested cell blocks as ordered containers', () => {
    const store = createDocumentStore()
    const section = createSectionRecord('section-1' as SectionId)
    const table = createTableRecord('table-1' as BlockId)
    const row = createTableRowRecord('row-1')
    const cell = createTableCellRecord('cell-1')
    const paragraph = createParagraphRecord('cell-paragraph-1' as BlockId)

    store.sections.push([section])
    getSectionBlocks(section).push([table])

    const rows = getTableRows(table)

    rows.push([row])

    const cells = getTableRowCells(row)

    cells.push([cell])

    const cellBlocks = getTableCellBlocks(cell)

    cellBlocks.push([paragraph])

    expect(table.get(DOCUMENT_STORE_FIELDS.block.kind)).toBe('table')
    expect(rows.toArray()).toEqual([row])
    expect(cells.toArray()).toEqual([cell])
    expect(cellBlocks.toArray()).toEqual([paragraph])
    expect(cell.get(DOCUMENT_STORE_FIELDS.tableCell.gridSpan)).toBe(1)
  })
})
