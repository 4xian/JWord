/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 1 文档模型最小骨架的纯数据形状。
 * 边界：只覆盖类型约束可承载的对象样例，不测试事务、布局、渲染或输入。
 * 协作模块：后续事务、投影、布局和互通包可复用这些对象样例扩展测试。
 * 约束：测试直接导入 src/model，不要求公开入口导出，也不访问浏览器 DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/02-technical-decisions.md#25-文档模型决策。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { DOCUMENT_MODEL_SCHEMA_VERSION } from '../../src/model/types'
import type { Document, Inline, Paragraph, RevisionMetadata, Table } from '../../src/model/types'

describe('Gate 1 document model skeleton', () => {
  it('describes the required object shape for a minimal document', () => {
    const paragraph = {
      kind: 'paragraph',
      id: 'paragraph-1',
      runs: [
        {
          kind: 'run',
          id: 'run-1',
          inlines: [
            {
              kind: 'text',
              text: '你好，JWord'
            }
          ]
        }
      ]
    } satisfies Paragraph

    const document: Document = {
      kind: 'document',
      id: 'document-1',
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [paragraph]
        }
      ]
    } satisfies Document

    expect(document.kind).toBe('document')
    expect(document.id).toBe('document-1')
    expect(document.sections).toHaveLength(1)
    expect(document.sections[0]?.blocks[0]).toEqual(paragraph)
  })

  it('keeps optional collections absent on the minimal document boundary', () => {
    const document: Document = {
      kind: 'document',
      id: 'document-optional-boundary',
      sections: []
    } satisfies Document

    expect(document.comments).toBeUndefined()
    expect(document.revisions).toBeUndefined()
    expect(document.styleIds).toBeUndefined()
    expect(document.resourceIds).toBeUndefined()
  })

  it('describes optional OOXML-aligned fields for inline content, tables, comments, and revisions', () => {
    const inlines = [
      {
        kind: 'image',
        resourceId: 'image-1',
        alt: '公司标识'
      },
      {
        kind: 'break',
        breakType: 'page'
      },
      {
        kind: 'bookmark',
        id: 'bookmark-1',
        name: '签署区',
        edge: 'start'
      },
      {
        kind: 'commentRangeMarker',
        commentId: 'comment-1',
        edge: 'end'
      }
    ] satisfies readonly Inline[]

    const table = {
      kind: 'table',
      id: 'table-1',
      grid: [2400, 2400],
      rows: [
        {
          id: 'row-1',
          cells: [
            {
              id: 'cell-1',
              gridSpan: 2,
              blocks: [
                {
                  kind: 'paragraph',
                  id: 'cell-paragraph-1',
                  runs: []
                }
              ]
            }
          ]
        }
      ]
    } satisfies Table

    const revision = {
      kind: 'revision',
      id: 'revision-1',
      authorId: 'author-1',
      createdAt: '2026-05-12T00:00:00.000Z',
      type: 'insert',
      rangeId: 'range-1',
      rangeSnapshot: {
        id: 'range-1',
        anchor: {
          documentId: 'document-rich',
          sectionId: 'section-rich',
          blockId: 'paragraph-rich',
          runId: 'run-rich',
          graphemeIndex: 0,
          relativePosition: {}
        },
        focus: {
          documentId: 'document-rich',
          sectionId: 'section-rich',
          blockId: 'paragraph-rich',
          runId: 'run-rich',
          graphemeIndex: 2,
          relativePosition: {}
        }
      },
      summary: '插入正文'
    } satisfies RevisionMetadata

    const document: Document = {
      kind: 'document',
      id: 'document-rich-shape',
      metadata: {
        title: '合同草稿'
      },
      styleIds: ['Normal'],
      resourceIds: ['image-1'],
      sections: [
        {
          kind: 'section',
          id: 'section-rich',
          page: {
            widthTwips: 11906,
            heightTwips: 16838,
            marginTwips: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440
            }
          },
          columns: 1,
          headerIds: ['header-1'],
          footerIds: ['footer-1'],
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-rich',
              properties: {
                styleId: 'Normal'
              },
              list: {
                numberingId: 'numbering-1',
                level: 0
              },
              tabs: [720],
              runs: [
                {
                  kind: 'run',
                  id: 'run-rich',
                  properties: {
                    bold: true
                  },
                  field: {
                    code: 'DATE',
                    result: '2026-05-12'
                  },
                  link: {
                    target: 'https://example.com',
                    tooltip: '示例链接'
                  },
                  revisionId: revision.id,
                  inlines
                }
              ]
            },
            table
          ]
        }
      ],
      comments: [
        {
          kind: 'commentThread',
          id: 'thread-1',
          authorId: 'author-1',
          createdAt: '2026-05-12T00:00:00.000Z',
          anchorRangeId: 'range-1',
          resolved: false,
          rangeSnapshot: {
            id: 'range-1',
            anchor: {
              documentId: 'document-rich',
              sectionId: 'section-rich',
              blockId: 'paragraph-rich',
              runId: 'run-rich',
              graphemeIndex: 0,
              relativePosition: {}
            },
            focus: {
              documentId: 'document-rich',
              sectionId: 'section-rich',
              blockId: 'paragraph-rich',
              runId: 'run-rich',
              graphemeIndex: 2,
              relativePosition: {}
            }
          },
          messages: [
            {
              id: 'comment-1',
              authorId: 'author-1',
              createdAt: '2026-05-12T00:00:00.000Z',
              anchorRangeId: 'range-1',
              text: '批注内容'
            }
          ]
        }
      ],
      revisions: [revision]
    } satisfies Document

    expect(document.sections[0]?.blocks).toHaveLength(2)
    expect(document.comments?.[0]?.anchorRangeId).toBe('range-1')
    expect(document.revisions?.[0]?.type).toBe('insert')
    expect(document.sections[0]?.blocks[1]).toEqual(table)
  })

  it('loads with a Chinese file header and no runtime dependency side effects', () => {
    const source = readFileSync(new URL('../../src/model/types.ts', import.meta.url), 'utf8')

    expect(source.startsWith('/**')).toBe(true)
    expect(source).toContain('职责：')
    expect(DOCUMENT_MODEL_SCHEMA_VERSION).toBe(1)
  })
})
