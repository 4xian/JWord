/**
 * @vitest-environment node
 *
 * 职责：验证布局运行时的结构复用和调试覆盖层边界输出。
 * 边界：只覆盖调试与冻结对象断言，不覆盖分页、换行或表格主体行为。
 * 协作模块：布局运行时、页面配置、字体管理器与共享测试辅助函数。
 * 性能/安全约束：测试不访问 DOM，不改变 layout 输出，只承接原 runtime.test 断言。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import { layoutDocument } from '../../src/layout/runtime'
import { createPageConfig } from '../../src/layout/page-config'
import { createProjection } from './runtime-test-helpers'

describe('Gate 2 布局调试输出', () => {
  it('freezes paragraph blocks once and reuses the same frozen object in paragraphs and blocks', () => {
    const layout = layoutDocument({
      projection: createProjection('paragraph freeze'),
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const paragraph = layout.pages[0]?.paragraphs[0]
    const block = layout.pages[0]?.blocks[0]

    expect(block).toBe(paragraph)
    expect(Object.isFrozen(block)).toBe(true)
  })


  it('returns debug overlay boxes for page, line and fragment boundaries', () => {
    const layout = layoutDocument({
      projection: createProjection('debug'),
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })

    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('page')
    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('line')
    expect(layout.debugOverlay.boxes.map((box) => box.kind)).toContain('fragment')
  })

})
