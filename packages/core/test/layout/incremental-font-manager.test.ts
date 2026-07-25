/**
 * @vitest-environment node
 *
 * 职责：验证增量 layout 在字体管理器等价时不会重复执行全文字体 probe。
 * 边界：只通过 layoutDocument 公开 seam 观察缓存命中，不测试内部辅助函数。
 * 协作模块：incremental、font-manager、engine 和 DocumentProjection 共同保证大文档输入热路径。
 * 约束：测试不访问 DOM，不依赖真实字体，不把测试放入 src。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig } from '../../src/layout/page-config'
import { layoutDocument } from '../../src/layout/runtime'
import type { DocumentProjection } from '../../src/model/projection'
import type { Block, Run } from '../../src/model/types'

describe('增量 layout 字体管理器兼容性', () => {
  it('相同内置字体管理器签名不为未变全文重复执行 probe', () => {
    const pageConfig = createPageConfig()
    const previousLayout = layoutDocument({
      projection: createStyledPagedProjection('第一页'),
      pageConfig,
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })
    const nextFontManager = createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })

    layoutDocument({
      projection: createStyledPagedProjection('第一页更新'),
      pageConfig,
      fontManager: nextFontManager,
      previousLayout,
      dirtyPageIndex: 0
    })

    expect(nextFontManager.getCacheStats().misses).toBeLessThan(40)
  })
})

function createStyledPagedProjection(firstText: string): DocumentProjection {
  const blocks: Block[] = []

  for (let index = 0; index < 80; index += 1) {
    const text = index === 0 ? firstText : `第${index}页`
    const run: Run = {
      kind: 'run',
      id: `run-incremental-font-${index}`,
      properties: {
        fontSizePx: 10 + index
      },
      inlines: [
        {
          kind: 'text',
          text
        },
        ...(index === 79
          ? []
          : [{
              kind: 'break' as const,
              breakType: 'page' as const
            }])
      ]
    }

    blocks.push({
      kind: 'paragraph',
      id: `paragraph-incremental-font-${index}`,
      runs: [run]
    })
  }

  return {
    document: {
      kind: 'document',
      id: 'document-incremental-font',
      sections: [
        {
          kind: 'section',
          id: 'section-incremental-font',
          blocks
        }
      ]
    }
  }
}
