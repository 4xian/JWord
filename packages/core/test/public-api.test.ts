/**
 * @vitest-environment node
 *
 * 职责：验证 core 根入口只暴露当前 Gate 已实现的最小公共契约。
 * 边界：只检查导出符号、错误码类型和 history 返回类型，不测试内部 fixture helper 或未实现 Future API。
 * 协作模块：Editor facade、错误码体系、history facade 和外部 TypeScript 消费方复用根入口。
 * 性能/安全约束：测试只导入包内入口，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#44-api-治理。
 */

import { describe, expect, it } from 'vitest'

import {
  JWordError,
  createEditor,
  createFontManager,
  createPageConfig,
  layoutDocument
} from '../src/index'
import type { DocumentLayout, Editor, HistoryOperationResult, JWordErrorCode } from '../src/index'

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
    const result: HistoryOperationResult = editor.undo()

    expect(result.stackItem).toBeNull()

    editor.destroy()
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
})
