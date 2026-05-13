/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 2 的 50 页纯文本 fixture 本体在默认 A4 布局下直接得到 50 页。
 * 边界：只检查 fixture 真值和 core layout 输出，不验证 demo、benchmark 或 visual 工具流程。
 * 协作模块：fixtures/plain-text、packages/core layout、Gate 2 验收链路。
 * 约束：不私下扩页，不读取浏览器 DOM，不依赖截图或人工打开页面。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 2.14。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  createFontManager,
  createPageConfig,
  layoutDocument
} from '../packages/core/src/index'

describe('Gate 2 纯文本 fixture', () => {
  it('gate2-50-pages.txt 本体直接得到 50 页', () => {
    const fixturePath = join(process.cwd(), 'fixtures', 'plain-text', 'gate2-50-pages.txt')
    const fixtureText = readFileSync(fixturePath, 'utf8')
    const lines = fixtureText
      .trim()
      .split(/\r?\n/u)
      .filter((line) => line.length > 0)
    const layout = layoutDocument({
      projection: {
        document: {
          kind: 'document',
          id: 'gate2-fixture-document',
          sections: [
            {
              kind: 'section',
              id: 'gate2-fixture-section',
              blocks: lines.map((line, index) => ({
                kind: 'paragraph',
                id: `gate2-fixture-paragraph-${index + 1}`,
                runs: [
                  {
                    kind: 'run',
                    id: `gate2-fixture-run-${index + 1}`,
                    properties: {
                      fontSizePx: 16
                    },
                    inlines: [
                      {
                        kind: 'text',
                        text: line
                      }
                    ]
                  }
                ]
              }))
            }
          ]
        }
      },
      pageConfig: createPageConfig(),
      fontManager: createFontManager({
        fallbackFontFamily: 'Arial',
        availableFontFamilies: ['Arial']
      })
    })

    expect(layout.pages).toHaveLength(50)
  })
})
