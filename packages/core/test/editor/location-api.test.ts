/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 中立位置 API 的公开序列化契约。
 * 边界：只覆盖 facade 的 selection/anchor/range/text location 查询，不测试 DOM、canvas 或 provider。
 * 协作模块：editor facade、selection、projection 和稳定 range snapshot 共同提供宿主可复用的位置结果。
 * 性能/安全约束：测试只使用内存文档，不访问 DOM、网络或磁盘，不泄漏 Yjs、document-store 或布局坐标。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 6.22-6.24。
 */

import { describe, expect, expectTypeOf, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import type { EditorAnchorSnapshot, EditorLocationQuery, EditorRangeSnapshot, EditorResolvedLocation, EditorSelectionSnapshot, EditorTextLocation } from '../../src/editor/runtime'

describe('editor neutral location API', () => {
  it('reads the current selection as serializable neutral snapshots', () => {
    const editor = createEditor({ initialText: 'alpha beta' })
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const focus = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 6
    })

    editor.setSelection(createSelectionState(anchor, focus))

    const selectionSnapshot = editor.readSelectionSnapshot()
    const anchorSnapshot = editor.createAnchorSnapshot({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const rangeSnapshot = editor.createRangeSnapshot({
      anchor: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      },
      focus: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 6
      }
    })

    expect(selectionSnapshot).toEqual({
      kind: 'selection',
      collapsed: false,
      direction: 'forward',
      affinity: 'none',
      anchor: {
        kind: 'anchor',
        location: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 1
        }
      },
      focus: {
        kind: 'anchor',
        location: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 6
        }
      },
      range: {
        kind: 'range',
        anchor: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 1
        },
        focus: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 6
        }
      }
    })
    expect(anchorSnapshot).toEqual(selectionSnapshot?.anchor)
    expect(rangeSnapshot).toEqual(selectionSnapshot?.range)
    expect(JSON.parse(JSON.stringify(selectionSnapshot))).toEqual(selectionSnapshot)
    expect(JSON.stringify(selectionSnapshot)).not.toMatch(
      /RelativePosition|Yjs|Y\\.Text|document-store|DocumentStore|DOM Range|LayoutRect|canvas|provider/iu
    )

    editor.destroy()
  })

  it('queries text, block, heading, comment and range snapshot locations without exposing runtime refs', () => {
    const editor = createEditor()
    editor.loadDocumentModel({
      document: {
        kind: 'document',
        id: 'document-location',
        comments: [{
          kind: 'commentThread',
          id: 'comment-1',
          authorId: 'author-1',
          createdAt: '2026-05-27T00:00:00Z',
          anchorRangeId: 'comment-range-1',
          resolved: false,
          rangeSnapshot: {
            id: 'comment-range-1',
            anchor: {
              documentId: 'document-location',
              sectionId: 'section-location',
              blockId: 'heading-1',
              runId: 'run-heading',
              graphemeIndex: 0,
              relativePosition: {}
            },
            focus: {
              documentId: 'document-location',
              sectionId: 'section-location',
              blockId: 'heading-1',
              runId: 'run-heading',
              graphemeIndex: 5,
              relativePosition: {}
            }
          },
          messages: [{
            id: 'message-1',
            authorId: 'author-1',
            createdAt: '2026-05-27T00:00:00Z',
            anchorRangeId: 'comment-range-1',
            text: '批注'
          }]
        }],
        sections: [{
          kind: 'section',
          id: 'section-location',
          blocks: [
            {
              kind: 'paragraph',
              id: 'heading-1',
              styleId: 'Heading1',
              runs: [{
                kind: 'run',
                id: 'run-heading',
                inlines: [{ kind: 'text', text: 'Alpha title' }]
              }]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-2',
              runs: [{
                kind: 'run',
                id: 'run-body',
                inlines: [{ kind: 'text', text: 'body alpha body alpha' }]
              }]
            }
          ]
        }]
      }
    })

    const rangeSnapshot = editor.findTextLocations({ kind: 'text', text: 'alpha' })[0]!.range

    expect(editor.findTextLocations({ kind: 'text', text: 'alpha' }).map((result) => result.location)).toEqual([
      {
        sectionId: 'section-location',
        blockId: 'paragraph-2',
        runId: 'run-body',
        graphemeIndex: 5
      },
      {
        sectionId: 'section-location',
        blockId: 'paragraph-2',
        runId: 'run-body',
        graphemeIndex: 16
      }
    ])
    expect(editor.findTextLocations({ kind: 'block', blockId: 'heading-1' })).toMatchObject([{
      kind: 'queryResult',
      source: 'block',
      text: 'Alpha title',
      location: {
        sectionId: 'section-location',
        blockId: 'heading-1',
        runId: 'run-heading',
        graphemeIndex: 0
      }
    }])
    expect(editor.findTextLocations({ kind: 'heading', blockId: 'heading-1' })).toHaveLength(1)
    expect(editor.findTextLocations({ kind: 'comment', commentId: 'comment-1' })).toMatchObject([{
      source: 'comment',
      range: {
        anchor: {
          blockId: 'heading-1',
          runId: 'run-heading',
          graphemeIndex: 0
        },
        focus: {
          blockId: 'heading-1',
          runId: 'run-heading',
          graphemeIndex: 5
        }
      }
    }])
    expect(editor.findTextLocations({ kind: 'rangeSnapshot', range: rangeSnapshot })).toMatchObject([{
      source: 'rangeSnapshot',
      location: {
        blockId: 'paragraph-2',
        runId: 'run-body',
        graphemeIndex: 5
      }
    }])
    expect(JSON.stringify(editor.findTextLocations({ kind: 'text', text: 'alpha' }))).not.toMatch(
      /RelativePosition|Yjs|Y\\.Text|document-store|DocumentStore|DOM Range|LayoutRect|canvas|provider/iu
    )

    editor.destroy()
  })

  it('resolves public location inputs for ordinary jumps and advanced package handoff', () => {
    const editor = createEditor({ initialText: 'alpha beta' })
    const queryResult = editor.findTextLocations({ kind: 'text', text: 'beta' })[0]!
    const selection = editor.createRangeSnapshot(queryResult.range)

    const resolvedFromQuery = editor.resolveLocation(queryResult)
    const resolvedFromRange = editor.resolveLocation(selection)
    const resolvedFromAnchor = editor.resolveLocation({
      kind: 'anchor',
      location: queryResult.location
    })

    expect(resolvedFromQuery).toEqual({
      kind: 'resolvedLocation',
      location: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 6
      },
      range: {
        kind: 'range',
        anchor: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 6
        },
        focus: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 10
        }
      }
    })
    expect(resolvedFromRange).toEqual(resolvedFromQuery)
    expect(resolvedFromAnchor?.range).toEqual({
      kind: 'range',
      anchor: queryResult.location,
      focus: queryResult.location
    })
    expect(JSON.stringify(resolvedFromQuery)).not.toMatch(
      /RelativePosition|Yjs|Y\\.Text|document-store|DocumentStore|DOM Range|LayoutRect|canvas|provider|scrollTop/iu
    )

    editor.destroy()
  })

  it('exports neutral location types without product-specific naming', () => {
    const query: EditorLocationQuery = { kind: 'text', text: 'alpha' }
    const resolved: EditorResolvedLocation = {
      kind: 'resolvedLocation',
      location: {
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      },
      range: {
        kind: 'range',
        anchor: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        },
        focus: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: 0
        }
      }
    }

    expect(query.kind).toBe('text')
    expect(resolved.kind).toBe('resolvedLocation')
    expectTypeOf<EditorTextLocation>().toMatchTypeOf<{
      readonly sectionId: string
      readonly blockId: string
      readonly runId: string
      readonly graphemeIndex: number
    }>()
    expectTypeOf<EditorAnchorSnapshot>().toHaveProperty('location')
    expectTypeOf<EditorRangeSnapshot>().toHaveProperty('anchor')
    expectTypeOf<EditorSelectionSnapshot>().toHaveProperty('range')
  })
})
