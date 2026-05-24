/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 分节、页眉页脚和页码基础命令的最小 core 闭环。
 * 边界：只覆盖 section properties 写入、projection 与 layout 可消费结果，不测试 UI 或浏览器交互。
 * 协作模块：Editor facade、transaction pipeline、projection 与 layout 共同承载 4.13 纵线。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.13。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { createFontManager } from '../../src/layout/font-manager'
import { createPageConfig } from '../../src/layout/page-config'
import { layoutDocument } from '../../src/layout/runtime'
import { buildSetSectionPropertiesCommand } from '../../src/operations/section-command-builders'

describe('section command builders', () => {
  it('writes section break, inherited header footer ids and restarted page numbering through transaction pipeline', () => {
    const editor = createEditor({ initialText: '第一节' })
    const command = buildSetSectionPropertiesCommand(editor.getProjection(), 'section-1', {
      breakType: 'next-page',
      headerIds: ['header-main'],
      footerIds: ['footer-main'],
      headerFooterSameAsPrevious: true,
      pageNumbering: {
        mode: 'restart',
        start: 3
      }
    })

    expect(command).not.toBeNull()

    const result = editor.executeCommand(command!)
    const section = result.projection.document.sections[0]

    expect(result.operationKinds).toEqual(['setSectionProperties'])
    expect(section).toMatchObject({
      breakType: 'next-page',
      headerIds: ['header-main'],
      footerIds: ['footer-main'],
      headerFooterSameAsPrevious: true,
      pageNumbering: {
        mode: 'restart',
        start: 3
      }
    })

    const layout = layoutDocument({
      projection: result.projection,
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })

    expect(layout.pages[0]).toMatchObject({
      sectionId: 'section-1',
      headerIds: ['header-main'],
      footerIds: ['footer-main'],
      pageNumber: 3
    })

    editor.destroy()
  })
})
