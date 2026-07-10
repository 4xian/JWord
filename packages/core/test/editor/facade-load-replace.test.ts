/**
 * @vitest-environment node
 *
 * 职责：验证编辑器门面加载结构化文档模型、批注定位和失败回滚行为。
 * 边界：只覆盖受控模型加载边界，不测试 docx/pdf/native 转换器。
 * 协作模块：编辑器运行时、文档模型类型、选择模型和共享门面测试辅助函数。
 * 性能/安全约束：测试只使用内联模型夹具，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createSelectionState } from '../../src/model/selection'
import { readParagraphRunTexts } from './facade-test-helpers'
import type { EditorDocumentModelInput } from '../../src/editor/runtime'

describe('Editor facade load and replace APIs', () => {
  it('loads a structured document model through the controlled facade boundary', () => {
    const editor = createEditor({ initialText: '旧内容' })

    editor.setSelection(createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 0
      })
    ))

    const projection = editor.loadDocumentModel({
      document: {
        kind: 'document',
        id: 'document-imported',
        resourceIds: ['image-1'],
        resources: [
          {
            kind: 'resource',
            id: 'image-1',
            mime: 'image/png',
            source: {
              kind: 'dataUrl',
              url: 'data:image/png;base64,AAAA'
            },
            status: 'success'
          }
        ],
        sections: [
          {
            kind: 'section',
            id: 'section-imported',
            page: {
              widthTwips: 12240,
              heightTwips: 15840
            },
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-imported',
                properties: {
                  styleId: 'Heading1'
                },
                runs: [
                  {
                    kind: 'run',
                    id: 'run-imported',
                    properties: {
                      bold: true
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: '导入文本'
                      },
                      {
                        kind: 'image',
                        resourceId: 'image-1',
                        alt: '导入图片'
                      }
                    ]
                  }
                ]
              },
              {
                kind: 'table',
                id: 'table-imported',
                grid: [2400],
                rows: [
                  {
                    id: 'row-imported',
                    cells: [
                      {
                        id: 'cell-imported',
                        blocks: [
                          {
                            kind: 'paragraph',
                            id: 'cell-paragraph-imported',
                            runs: [
                              {
                                kind: 'run',
                                id: 'cell-run-imported',
                                inlines: [
                                  {
                                    kind: 'text',
                                    text: '单元格'
                                  }
                                ]
                              }
                            ]
                          }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    const paragraph = projection.document.sections[0]?.blocks[0]
    const table = projection.document.sections[0]?.blocks[1]

    expect(projection.document.id).toBe('document-imported')
    expect(projection.document.resourceIds).toEqual(['image-1'])
    expect(projection.document.resources?.[0]?.id).toBe('image-1')
    expect(projection.document.sections[0]?.page?.widthTwips).toBe(12240)
    expect(paragraph?.kind).toBe('paragraph')
    expect(paragraph?.kind === 'paragraph' ? paragraph.styleId : undefined).toBe('Heading1')
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.properties : undefined).toEqual({
      bold: true
    })
    expect(paragraph?.kind === 'paragraph' ? paragraph.runs[0]?.inlines : undefined).toEqual([
      {
        kind: 'text',
        text: '导入文本'
      },
      {
        kind: 'image',
        resourceId: 'image-1',
        alt: '导入图片'
      }
    ])
    expect(table?.kind).toBe('table')
    expect(table?.kind === 'table' ? table.rows[0]?.cells[0]?.blocks[0]?.id : undefined).toBe('cell-paragraph-imported')
    expect(editor.getSelection()).toBeNull()

    editor.destroy()
  })


  it('locates imported comment ranges by model text positions when relative positions are absent', () => {
    const editor = createEditor({ initialText: '旧内容' })

    const projection = editor.loadDocumentModel({
      document: {
        kind: 'document',
        id: 'document-imported-comments',
        comments: [
          {
            kind: 'commentThread',
            id: 'comment-thread-imported-0',
            authorId: 'JWord',
            createdAt: '2026-05-25T00:00:00Z',
            anchorRangeId: 'comment-range-imported-0',
            resolved: false,
            rangeSnapshot: {
              id: 'comment-range-imported-0',
              anchor: {
                documentId: 'document-imported-comments',
                sectionId: 'section-imported',
                blockId: 'paragraph-imported',
                runId: 'run-imported',
                graphemeIndex: 0,
                relativePosition: {}
              },
              focus: {
                documentId: 'document-imported-comments',
                sectionId: 'section-imported',
                blockId: 'paragraph-imported',
                runId: 'run-imported',
                graphemeIndex: 2,
                relativePosition: {}
              }
            },
            messages: [
              {
                id: 'comment-message-imported-0',
                authorId: 'JWord',
                createdAt: '2026-05-25T00:00:00Z',
                anchorRangeId: 'comment-range-imported-0',
                text: '导入批注'
              }
            ]
          }
        ],
        sections: [
          {
            kind: 'section',
            id: 'section-imported',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-imported',
                runs: [
                  {
                    kind: 'run',
                    id: 'run-imported',
                    inlines: [
                      {
                        kind: 'commentRangeMarker',
                        commentId: 'comment-thread-imported-0',
                        edge: 'start'
                      },
                      {
                        kind: 'text',
                        text: '批注文本'
                      },
                      {
                        kind: 'commentRangeMarker',
                        commentId: 'comment-thread-imported-0',
                        edge: 'end'
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    })

    expect(projection.document.comments?.[0]).toMatchObject({
      id: 'comment-thread-imported-0',
      messages: [
        {
          text: '导入批注'
        }
      ]
    })
    expect(editor.locateRangeSnapshot(projection.document.comments![0]!.rangeSnapshot)).toEqual({
      anchor: {
        sectionId: 'section-imported',
        blockId: 'paragraph-imported',
        runId: 'run-imported',
        graphemeIndex: 0
      },
      focus: {
        sectionId: 'section-imported',
        blockId: 'paragraph-imported',
        runId: 'run-imported',
        graphemeIndex: 2
      }
    })

    editor.destroy()
  })


  it('keeps the previous document when structured document model loading fails', () => {
    const editor = createEditor({ initialText: '原文档' })

    const before = editor.getProjection()
    const anchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    })

    editor.setSelection(createSelectionState(anchor, anchor))

    expect(() => {
      const invalidInput = {
        document: {
          kind: 'document',
          id: 'document-invalid',
          sections: [
            {
              kind: 'section',
              id: 'section-invalid',
              blocks: [
                {
                  kind: 'unsupported',
                  id: 'block-invalid'
                }
              ]
            }
          ]
        }
      } as unknown as EditorDocumentModelInput

      editor.loadDocumentModel(invalidInput)
    }).toThrow()

    expect(readParagraphRunTexts(editor.getProjection())).toEqual(readParagraphRunTexts(before))
    expect(editor.getProjection().document.id).toBe(before.document.id)
    expect(editor.getSelection()).toBeNull()
    editor.executeCommand(
      {
        name: 'insertText',
        operations: [{ kind: 'insertText', at: editor.resolveTextPosition(anchor), text: '!' }]
      },
      { origin: 'test' }
    )
    expect(readParagraphRunTexts(editor.getProjection())).toEqual([['!原文档']])

    editor.destroy()
  })
})
