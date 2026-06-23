/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 T1 DOCX 真实 fixture 可被当前 DOCX import 入口消费。
 * 边界：只读取 fixtures/docx/registry.json 中已标记 available 的真实 .docx fixture，不生成临时内存包。
 * 协作模块：fixtures/docx、importDocx 和 canonical Gate 5 Step 5.11 的真实验收证据复用这里。
 * 约束：fixture 必须是仓库内可复查文件，不能只依赖测试内联 XML 或口头 registry 占位。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-511实现-t1-docx-import段落run文本run-样式。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { importDocx } from '../src/index'
import { createDocxPublicApiLicense } from './public-api-fixtures'

const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

describe('Gate 5 T1 DOCX fixtures', () => {
  it('imports the real run styles fixture without warnings', async () => {
    const { bytes, result } = await importDocxFixture('docx-t1-run-styles')

    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(result.warnings).toEqual([])
    expect(result.document.metadata.styleIds).toEqual(expect.arrayContaining(['Normal', 'Accent']))
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      styleId: 'Normal',
      runs: [
        {
          properties: {
            bold: true,
            italic: true,
            underline: true,
            strike: true,
            color: '#c00000',
            fontFamily: 'Arial',
            fontSizeTwips: 320,
            backgroundColor: '#fff59d',
            superscript: true
          },
          inlines: [
            {
              kind: 'text',
              text: 'Styled run'
            }
          ]
        },
        {
          properties: {
            subscript: true
          },
          inlines: [
            {
              kind: 'text',
              text: 'Subscript run'
            }
          ]
        },
        {
          properties: {
            styleId: 'Accent'
          },
          inlines: [
            {
              kind: 'text',
              text: 'Character style run'
            }
          ]
        }
      ]
    })
  })

  it('imports the real paragraph formatting fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-paragraph-formatting')

    expect(result.warnings).toEqual([])
    expect(result.document.sections[0]?.blocks).toMatchObject([
      {
        kind: 'paragraph',
        styleId: 'Normal',
        properties: {
          alignment: 'center',
          spacingBeforeTwips: 240,
          spacingAfterTwips: 120,
          indentLeftTwips: 720,
          firstLineIndentTwips: 360
        },
        runs: [
          {
            properties: {
              lineHeight: 1.5
            },
            inlines: [
              {
                kind: 'text',
                text: 'Formatted paragraph'
              }
            ]
          }
        ]
      },
      {
        kind: 'paragraph',
        styleId: 'Normal',
        properties: {
          alignment: 'right',
          indentLeftTwips: 960,
          hangingIndentTwips: 240,
          spacingBeforeTwips: 60,
          spacingAfterTwips: 180
        },
        runs: [
          {
            properties: {
              lineHeight: 2
            },
            inlines: [
              {
                kind: 'text',
                text: 'Hanging paragraph'
              }
            ]
          }
        ]
      }
    ])
  })

  it('imports the real headings fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-headings')

    expect(result.warnings).toEqual([])
    expect(result.document.metadata.styleIds).toEqual(expect.arrayContaining(['Heading1', 'Heading2', 'Heading3']))
    expect(result.document.sections[0]?.blocks).toMatchObject([
      {
        kind: 'paragraph',
        styleId: 'Heading1',
        runs: [{ inlines: [{ kind: 'text', text: 'Heading One' }] }]
      },
      {
        kind: 'paragraph',
        styleId: 'Heading2',
        runs: [{ inlines: [{ kind: 'text', text: 'Heading Two' }] }]
      },
      {
        kind: 'paragraph',
        styleId: 'Heading3',
        runs: [{ inlines: [{ kind: 'text', text: 'Heading Three' }] }]
      }
    ])
  })

  it('imports the real lists fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-lists')

    expect(result.warnings).toEqual([])
    expect(result.document.metadata.numberingIds).toEqual(expect.arrayContaining(['1', '2', '5', '6']))
    expect(result.document.sections[0]?.blocks).toMatchObject([
      {
        kind: 'paragraph',
        properties: {
          listNumberingId: '5',
          listLevel: 0
        },
        runs: [{ inlines: [{ kind: 'text', text: 'Bullet item' }] }]
      },
      {
        kind: 'paragraph',
        properties: {
          listNumberingId: '6',
          listLevel: 0
        },
        runs: [{ inlines: [{ kind: 'text', text: 'Ordered item' }] }]
      },
      {
        kind: 'paragraph',
        properties: {
          listNumberingId: '5',
          listLevel: 1
        },
        runs: [{ inlines: [{ kind: 'text', text: 'Nested bullet item' }] }]
      }
    ])
  })

  it('imports the real basic table fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-table-basic')

    expect(result.warnings).toEqual([])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'table',
      properties: {
        border: {
          color: 'C0C0C0',
          widthTwips: 10
        }
      },
      grid: [1600, 1600],
      rows: [
        {
          cells: [
            {
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ inlines: [{ kind: 'text', text: 'Cell A1' }] }]
                }
              ]
            },
            {
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ inlines: [{ kind: 'text', text: 'Cell B1' }] }]
                }
              ]
            }
          ]
        },
        {
          cells: [
            {
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ inlines: [{ kind: 'text', text: 'Cell A2' }] }]
                }
              ]
            },
            {
              blocks: [
                {
                  kind: 'paragraph',
                  runs: [{ inlines: [{ kind: 'text', text: 'Cell B2' }] }]
                }
              ]
            }
          ]
        }
      ]
    })
  })

  it('imports the real inline image fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-inline-image')

    expect(result.warnings).toEqual([])
    expect(result.document.resources).toEqual([
      {
        kind: 'resource',
        resourceId: 'word/media/image1.png',
        mimeType: 'image/png',
        extension: 'png',
        targetPart: 'word/media/image1.png',
        bytes: expect.any(Array)
      }
    ])
    expect(result.document.resources[0]?.bytes.length).toBeGreaterThan(0)
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      runs: [
        {
          inlines: [
            {
              kind: 'image',
              resourceId: 'word/media/image1.png',
              alt: 'Inline image fixture',
              display: 'inline',
              widthTwips: 3600,
              heightTwips: 1800
            }
          ]
        }
      ]
    })
  })

  it('imports the real page setup fixture without warnings', async () => {
    const { result } = await importDocxFixture('docx-t1-page-setup')

    expect(result.warnings).toEqual([])
    expect(result.document.sections[0]).toMatchObject({
      kind: 'section',
      page: {
        widthTwips: 10080,
        heightTwips: 12960,
        marginTwips: {
          top: 720,
          right: 960,
          bottom: 1080,
          left: 1200
        }
      },
      blocks: [
        {
          kind: 'paragraph',
          runs: [
            {
              inlines: [
                {
                  kind: 'text',
                  text: 'First page'
                },
                {
                  kind: 'break',
                  breakType: 'page'
                },
                {
                  kind: 'text',
                  text: 'Second page'
                }
              ]
            }
          ]
        }
      ]
    })
  })
})

interface Gate5DocxRegistry {
  readonly fixtures: readonly Gate5DocxFixture[]
}

interface Gate5DocxFixture {
  readonly id: string
  readonly status?: string
  readonly input: {
    readonly path: string
    readonly state?: string
  }
}

/** 读取指定 DOCX fixture 的 registry 记录。 */
function readDocxFixture(fixtureId: string): Gate5DocxFixture {
  const registryPath = join(repoRoot, 'fixtures/docx/registry.json')
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')) as Gate5DocxRegistry
  const fixture = registry.fixtures.find((item) => item.id === fixtureId)

  if (fixture === undefined) {
    throw new Error(`Missing DOCX fixture registry entry: ${fixtureId}`)
  }

  return fixture
}

/** 从 registry 读取真实 DOCX fixture 并执行导入。 */
async function importDocxFixture(fixtureId: string): Promise<{
  readonly bytes: Uint8Array
  readonly result: Awaited<ReturnType<typeof importDocx>>
}> {
  const fixture = readDocxFixture(fixtureId)

  expect(fixture.status).toBe('fixture-input-ready')
  expect(fixture.input?.state).toBe('available')

  const bytes = readFileSync(join(repoRoot, fixture.input.path))
  const result = await importDocx(bytes, {
    requestId: `${fixtureId}-fixture`,
    license: createDocxPublicApiLicense(['docx.import'])
  })

  return {
    bytes,
    result
  }
}
