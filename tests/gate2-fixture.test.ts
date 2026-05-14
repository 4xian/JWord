/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 2 50 页纯文本 fixture、benchmark 和 visual baseline 的统一语义。
 * 边界：只验证 fixture 行段落解释、benchmark 输出和 visual baseline，不覆盖浏览器交互细节。
 * 协作模块：fixtures/plain-text、fixtures/visual-baselines、benchmarks/gate2-render-benchmark.mjs 和 packages/core layout/render。
 * 约束：不依赖人工截图，不做 32 轮扩展，不读取 demo DOM。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 2.14 与 Step 2.15。
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

import {
  cssPxToTwips,
  createFontManager,
  createPageConfig,
  layoutDocument,
  renderPageCanvas
} from '../packages/core/src/index'

describe('Gate 2 纯文本 fixture', () => {
  it('gate2-50-pages.txt 作为行段落 fixture 能直接布局为 50 页', () => {
    const observed = observeGate2Fixture()

    expect(observed.inputParagraphCount).toBe(1200)
    expect(observed.pageCount).toBe(50)
  })

  it('gate2-render benchmark 直接消费 fixture 后输出 50 页', () => {
    const childEnv = {
      ...process.env,
      NODE_OPTIONS: '',
      VITEST: '',
      VITEST_MODE: ''
    }
    const result = spawnSync(process.execPath, ['benchmarks/gate2-render-benchmark.mjs'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv
    })

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')

    const benchmark = JSON.parse(result.stdout) as {
      readonly fixture: string
      readonly pageCount: number
      readonly frames: number
      readonly browserEvidence: {
        readonly perfTest: string
        readonly visualTest: string
      }
      readonly note: string
    }

    expect(benchmark.fixture).toBe('fixtures/plain-text/gate2-50-pages.txt')
    expect(benchmark.pageCount).toBe(50)
    expect(benchmark.frames).toBe(50)
    expect(benchmark.browserEvidence).toEqual({
      perfTest: 'examples/vanilla/tests/gate2.perf.e2e.ts',
      visualTest: 'examples/vanilla/tests/gate2.visual.ts'
    })
    expect(benchmark.note).toContain('真实浏览器滚动/虚拟化指标')
  })

  it('gate2-50-pages visual baseline 与直接消费 fixture 的观测值一致', () => {
    const baselinePath = join(process.cwd(), 'fixtures', 'visual-baselines', 'gate2-50-pages.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      readonly pageCount: number
      readonly lineCount: number
      readonly fragmentCount: number
      readonly renderedPageCount: number
      readonly drawCallCount: number
      readonly drawCallHash: string
      readonly notes: readonly string[]
    }
    const observed = observeGate2Fixture()

    expect(baseline.pageCount).toBe(observed.pageCount)
    expect(baseline.lineCount).toBe(observed.lineCount)
    expect(baseline.fragmentCount).toBe(observed.fragmentCount)
    expect(baseline.renderedPageCount).toBe(observed.renderedPageCount)
    expect(baseline.drawCallCount).toBe(observed.drawCallCount)
    expect(baseline.drawCallHash).toBe(observed.drawCallHash)
    expect(baseline.notes).not.toContain('fixture seed 按普通 A4 页面扩展为 50 页以上长文')
  })

  it('gate2-emoji visual baseline 与 built core visual 渲染语义一致', async () => {
    const baselinePath = join(process.cwd(), 'fixtures', 'visual-baselines', 'gate2-emoji.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      readonly pageCount: number
      readonly lineCount: number
      readonly fragmentCount: number
      readonly renderedPageCount: number
      readonly drawCallCount: number
      readonly drawCallHash: string
    }
    const observed = await observeLandscapeVisualFixtureFromBuiltCore('gate2-emoji.txt')

    expect(baseline.pageCount).toBe(observed.pageCount)
    expect(baseline.lineCount).toBe(observed.lineCount)
    expect(baseline.fragmentCount).toBe(observed.fragmentCount)
    expect(baseline.renderedPageCount).toBe(observed.renderedPageCount)
    expect(baseline.drawCallCount).toBe(observed.drawCallCount)
    expect(baseline.drawCallHash).toBe(observed.drawCallHash)
  }, 15000)

  it('gate2-mixed-zh-en visual baseline 与 built core visual 渲染语义一致', async () => {
    const baselinePath = join(process.cwd(), 'fixtures', 'visual-baselines', 'gate2-mixed-zh-en.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      readonly pageCount: number
      readonly lineCount: number
      readonly fragmentCount: number
      readonly renderedPageCount: number
      readonly drawCallCount: number
      readonly drawCallHash: string
    }
    const observed = await observeLandscapeVisualFixtureFromBuiltCore('gate2-mixed-zh-en.txt')

    expect(baseline.pageCount).toBe(observed.pageCount)
    expect(baseline.lineCount).toBe(observed.lineCount)
    expect(baseline.fragmentCount).toBe(observed.fragmentCount)
    expect(baseline.renderedPageCount).toBe(observed.renderedPageCount)
    expect(baseline.drawCallCount).toBe(observed.drawCallCount)
    expect(baseline.drawCallHash).toBe(observed.drawCallHash)
  }, 15000)

  it('gate2-long-paragraph visual baseline 与 built core visual 渲染语义一致', async () => {
    const baselinePath = join(process.cwd(), 'fixtures', 'visual-baselines', 'gate2-long-paragraph.json')
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8')) as {
      readonly pageCount: number
      readonly lineCount: number
      readonly fragmentCount: number
      readonly renderedPageCount: number
      readonly drawCallCount: number
      readonly drawCallHash: string
    }
    const observed = await observeLandscapeVisualFixtureFromBuiltCore('gate2-long-paragraph.txt')

    expect(baseline.pageCount).toBe(observed.pageCount)
    expect(baseline.lineCount).toBe(observed.lineCount)
    expect(baseline.fragmentCount).toBe(observed.fragmentCount)
    expect(baseline.renderedPageCount).toBe(observed.renderedPageCount)
    expect(baseline.drawCallCount).toBe(observed.drawCallCount)
    expect(baseline.drawCallHash).toBe(observed.drawCallHash)
  }, 15000)
})

function observeGate2Fixture(): Readonly<{
  inputParagraphCount: number
  pageCount: number
  lineCount: number
  fragmentCount: number
  renderedPageCount: number
  drawCallCount: number
  drawCallHash: string
}> {
  const fixturePath = join(process.cwd(), 'fixtures', 'plain-text', 'gate2-50-pages.txt')
  const fixtureText = readFileSync(fixturePath, 'utf8')
  const paragraphs = fixtureText
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
            blocks: paragraphs.map((line, index) => ({
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
  const drawCalls: string[] = []

  for (const page of layout.pages) {
    renderPageCanvas({
      canvas: createRecordingCanvas(drawCalls),
      page
    })
  }

  return {
    inputParagraphCount: paragraphs.length,
    pageCount: layout.pages.length,
    lineCount: layout.pages.reduce((total, page) => total + page.lines.length, 0),
    fragmentCount: layout.pages.reduce(
      (total, page) => total + page.lines.reduce((lineTotal, line) => lineTotal + line.fragments.length, 0),
      0
    ),
    renderedPageCount: layout.pages.length,
    drawCallCount: drawCalls.length,
    drawCallHash: createHash('sha256')
      .update(JSON.stringify(drawCalls))
      .digest('hex')
  }
}

let builtCorePromise: Promise<void> | undefined
const pnpmBuildCommand = process.platform === 'win32'
  ? {
      command: process.env.ComSpec ?? 'cmd.exe',
      args: ['/d', '/s', '/c', 'pnpm build']
    }
  : {
      command: 'pnpm',
      args: ['build']
    }

async function observeLandscapeVisualFixtureFromBuiltCore(filename: string): Promise<Readonly<{
  pageCount: number
  lineCount: number
  fragmentCount: number
  renderedPageCount: number
  drawCallCount: number
  drawCallHash: string
}>> {
  await ensureBuiltCore()
  const childEnv = {
    ...process.env,
    NODE_OPTIONS: '',
    VITEST: '',
    VITEST_MODE: ''
  }
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '-'],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: {
        ...childEnv,
        JWORD_VISUAL_FIXTURE: filename
      },
      input: `
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createFontManager,
  createPageConfig,
  cssPxToTwips,
  layoutDocument,
  renderPageCanvas
} from './packages/core/dist/index.js'

const filename = process.env.JWORD_VISUAL_FIXTURE
const fixturePath = join(process.cwd(), 'fixtures', 'plain-text', filename)
const fixtureText = readFileSync(fixturePath, 'utf8')
const paragraphs = fixtureText.trim().split('\\n').filter((line) => line.length > 0)
const layout = layoutDocument({
  projection: {
    document: {
      kind: 'document',
      id: \`visual-dist-\${filename}\`,
      sections: [
        {
          kind: 'section',
          id: \`visual-dist-section-\${filename}\`,
          blocks: paragraphs.map((line, index) => ({
            kind: 'paragraph',
            id: \`visual-dist-paragraph-\${index + 1}\`,
            runs: [
              {
                kind: 'run',
                id: \`visual-dist-run-\${index + 1}\`,
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
  pageConfig: createPageConfig({
    orientation: 'landscape',
    widthTwips: cssPxToTwips(1800),
    heightTwips: cssPxToTwips(2000),
    marginTwips: {
      top: cssPxToTwips(72),
      right: cssPxToTwips(72),
      bottom: cssPxToTwips(72),
      left: cssPxToTwips(72)
    }
  }),
  fontManager: createFontManager({
    fallbackFontFamily: 'Arial',
    availableFontFamilies: ['Arial']
  })
})
const drawCalls = []
const canvas = () => ({
  width: 1,
  height: 1,
  getContext: () => ({
    set fillStyle(value) {
      drawCalls.push(\`fillStyle:\${value}\`)
    },
    set font(value) {
      drawCalls.push(\`font:\${value}\`)
    },
    set textBaseline(value) {
      drawCalls.push(\`textBaseline:\${value}\`)
    },
    clearRect(x, y, width, height) {
      drawCalls.push(\`clearRect:\${x},\${y},\${width},\${height}\`)
    },
    fillRect(x, y, width, height) {
      drawCalls.push(\`fillRect:\${x},\${y},\${width},\${height}\`)
    },
    fillText(text, x, y) {
      drawCalls.push(\`fillText:\${text},\${x},\${y}\`)
    }
  })
})

for (const page of layout.pages) {
  renderPageCanvas({
    canvas: canvas(),
    page
  })
}

console.log(JSON.stringify({
  pageCount: layout.pages.length,
  lineCount: layout.pages.reduce((total, page) => total + page.lines.length, 0),
  fragmentCount: layout.pages.reduce(
    (total, page) => total + page.lines.reduce((lineTotal, line) => lineTotal + line.fragments.length, 0),
    0
  ),
  renderedPageCount: layout.pages.length,
  drawCallCount: drawCalls.length,
  drawCallHash: createHash('sha256').update(JSON.stringify(drawCalls)).digest('hex')
}))
`
    }
  )

  expect(result.status).toBe(0)

  return JSON.parse(result.stdout) as {
    readonly pageCount: number
    readonly lineCount: number
    readonly fragmentCount: number
    readonly renderedPageCount: number
    readonly drawCallCount: number
    readonly drawCallHash: string
  }
}

function ensureBuiltCore(): Promise<void> {
  builtCorePromise ??= Promise.resolve().then(() => {
    const childEnv = {
      ...process.env,
      NODE_OPTIONS: '',
      VITEST: '',
      VITEST_MODE: ''
    }
    const result = spawnSync(pnpmBuildCommand.command, pnpmBuildCommand.args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      env: childEnv
    })

    expect(result.status).toBe(0)
  })

  return builtCorePromise
}

function createRecordingCanvas(drawCalls: string[]) {
  const context = {
    set fillStyle(value: string) {
      drawCalls.push(`fillStyle:${value}`)
    },
    set font(value: string) {
      drawCalls.push(`font:${value}`)
    },
    set textBaseline(value: string) {
      drawCalls.push(`textBaseline:${value}`)
    },
    clearRect(x: number, y: number, width: number, height: number) {
      drawCalls.push(`clearRect:${x},${y},${width},${height}`)
    },
    fillRect(x: number, y: number, width: number, height: number) {
      drawCalls.push(`fillRect:${x},${y},${width},${height}`)
    },
    fillText(text: string, x: number, y: number) {
      drawCalls.push(`fillText:${text},${x},${y}`)
    }
  }

  return {
    width: 1,
    height: 1,
    getContext: () => context
  }
}
