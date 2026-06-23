/**
 * @vitest-environment node
 *
 * 职责：验证 core 根入口只暴露当前 Gate 已实现的最小公共契约。
 * 边界：只检查导出符号、错误码类型和 history 返回类型，不测试内部 fixture helper 或未实现 Future API。
 * 协作模块：Editor facade、错误码体系、history facade 和外部 TypeScript 消费方复用根入口。
 * 性能/安全约束：测试只导入包内入口，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#44-api-治理。
 */

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  buildDeleteSelectedImageCommand,
  buildInsertInlineImageCommand,
  buildUpsertResourceCommand,
  JWordError,
  createEditor,
  createFontManager,
  createPageConfig,
  isAllowedResourceUrl,
  layoutDocument,
  resolveSelectedImageTarget
} from '../src/index'
import type { DocumentLayout, Editor, EditorLocationQuery, EditorLocationTarget, EditorRangeSnapshot, EditorResolvedLocation, EditorScrollToLocationOptions, EditorTextLocation, EditorTextQueryResult, HistoryOperationResult, HistoryScope, JWordErrorCode, TextInserterError, TextInserterErrorCode } from '../src/index'

describe('core public API', () => {
  it('exports the Gate 1 editor facade and diagnostic error contract from the root entry', () => {
    const editor: Editor = createEditor()
    const code: JWordErrorCode = 'OPERATION_TEXT_INDEX_OUT_OF_BOUNDS'
    const error = new JWordError(code, '文本位置越界', { index: 1 })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('JWordError')
    expect(error.code).toBe(code)
    expect(error.details).toEqual({ index: 1 })

    editor.destroy()
  })

  it('exposes history operation results through the editor facade only', () => {
    const editor = createEditor({ initialText: 'abc' })
    const aiScope: HistoryScope = 'auto-inserter'
    const result: HistoryOperationResult = editor.undo()

    expect(result.stackItem).toBeNull()
    expect(editor.canUndo(aiScope)).toBe(false)

    editor.destroy()
  })

  it('exports Gate 6 neutral text inserter structured error types from the root entry', () => {
    expectTypeOf<TextInserterErrorCode>().toEqualTypeOf<
      'AUTO_INSERTER_ANCHOR_UNRESOLVED' |
      'AUTO_INSERTER_RANGE_REQUIRED' |
      'AUTO_INSERTER_ANCHOR_REQUIRED' |
      'AUTO_INSERTER_FLUSH_FAILED'
    >()
    expectTypeOf<TextInserterError>().toMatchTypeOf<{
      readonly code: TextInserterErrorCode
      readonly message: string
      readonly recoverable: boolean
      readonly requestId: string
      readonly cause?: unknown
    }>()
  })

  it('exports Gate 6 neutral location API types from the root entry', () => {
    expectTypeOf<EditorTextLocation>().toMatchTypeOf<{
      readonly sectionId: string
      readonly blockId: string
      readonly runId: string
      readonly graphemeIndex: number
    }>()
    expectTypeOf<Extract<EditorLocationQuery, { readonly kind: 'text' }>>().toMatchTypeOf<{
      readonly text: string
      readonly caseSensitive?: boolean
    }>()
    expectTypeOf<Extract<EditorLocationQuery, { readonly kind: 'block' }>>().toMatchTypeOf<{
      readonly blockId: string
    }>()
    expectTypeOf<Extract<EditorLocationQuery, { readonly kind: 'heading' }>>().toMatchTypeOf<{
      readonly blockId?: string
      readonly level?: 1 | 2 | 3
    }>()
    expectTypeOf<Extract<EditorLocationQuery, { readonly kind: 'comment' }>>().toMatchTypeOf<{
      readonly commentId: string
    }>()
    expectTypeOf<Extract<EditorLocationQuery, { readonly kind: 'rangeSnapshot' }>>().toMatchTypeOf<{
      readonly range: EditorRangeSnapshot
    }>()
    expectTypeOf<EditorResolvedLocation>().toHaveProperty('range')
    expectTypeOf<EditorScrollToLocationOptions>().toHaveProperty('behavior')
    expectTypeOf<EditorTextQueryResult>().toHaveProperty('location')

    const textTarget: EditorLocationTarget = {
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 0
    }
    const queryTarget: EditorLocationTarget = {
      kind: 'queryResult',
      source: 'text',
      location: textTarget,
      range: {
        kind: 'range',
        anchor: textTarget,
        focus: textTarget
      }
    }

    expect(queryTarget.location).toEqual(textTarget)
  })

  it('exports Gate 2 布局, page config and font manager entry points', () => {
    const editor = createEditor({ initialText: '分页' })
    const layout: DocumentLayout = layoutDocument({
      projection: editor.getProjection(),
      pageConfig: createPageConfig(),
      fontManager: createFontManager()
    })

    expect(layout.pages[0]?.kind).toBe('page')

    editor.destroy()
  })

  it('exposes Gate 3 facade formatting methods from the root entry editor contract', () => {
    const editor: Editor = createEditor({ initialText: 'abc' })

    expect(typeof editor.toggleBold).toBe('function')
    expect(typeof editor.toggleItalic).toBe('function')
    expect(typeof editor.toggleUnderline).toBe('function')
    expect(typeof editor.toggleStrike).toBe('function')
    expect(typeof editor.setFontFamily).toBe('function')
    expect(typeof editor.setFontSize).toBe('function')
    expect(typeof editor.setTextColor).toBe('function')
    expect(typeof editor.setBackgroundColor).toBe('function')
    expect(typeof editor.setParagraphAlignment).toBe('function')
    expect(typeof editor.adjustParagraphIndent).toBe('function')

    editor.destroy()
  })

  it('exports Gate 4 resource helpers and lets the editor project seeded resources', () => {
    const editor = createEditor({
      initialText: 'abc',
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
      ]
    })

    expect(typeof buildUpsertResourceCommand).toBe('function')
    expect(typeof buildInsertInlineImageCommand).toBe('function')
    expect(typeof buildDeleteSelectedImageCommand).toBe('function')
    expect(typeof resolveSelectedImageTarget).toBe('function')
    expect(isAllowedResourceUrl('data:image/png;base64,AAAA')).toBe(true)
    expect(editor.getProjection().document.resources).toEqual([
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
    ])

    editor.destroy()
  })
})
