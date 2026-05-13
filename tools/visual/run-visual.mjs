import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const roots = ['packages', 'examples']
const visualBaselineRoot = join('fixtures', 'visual-baselines')
const packageManager = resolvePackageManager()
const core = await loadBuiltCore()

function hasVisualTests(dir) {
  if (!existsSync(dir)) {
    return false
  }
  return readdirSync(dir, { withFileTypes: true }).some((entry) => {
    const next = join(dir, entry.name)
    if (entry.isDirectory()) {
      return hasVisualTests(next)
    }
    return entry.isFile() && entry.name.endsWith('.visual.ts')
  })
}

validateVisualBaselines()

if (roots.some(hasVisualTests)) {
  const result = runPackageManager(['exec', 'playwright', 'test', '--project=visual-chromium', '--pass-with-no-tests'])

  exitFromChild(result, 'visual Playwright')
  console.log('Visual baselines and Playwright visual tests checked.')
  process.exit(0)
}

console.log('Visual baselines checked against core layout/render; no Playwright visual tests yet.')

async function loadBuiltCore() {
  const build = runPackageManager(['build'])

  exitFromChild(build, 'core build')

  return import(new URL('../../packages/core/dist/index.js', import.meta.url))
}

function resolvePackageManager() {
  if (process.env.npm_execpath) {
    return {
      command: process.execPath,
      shell: false,
      prefixArgs: [process.env.npm_execpath]
    }
  }

  return {
    command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm',
    shell: process.platform === 'win32',
    prefixArgs: []
  }
}

function runPackageManager(args) {
  return spawnSync(packageManager.command, [...packageManager.prefixArgs, ...args], {
    stdio: 'inherit',
    shell: packageManager.shell
  })
}

function exitFromChild(result, label) {
  if (result.error) {
    console.error(`${label} failed to start: ${result.error.message}`)
    process.exit(1)
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function validateVisualBaselines() {
  if (!existsSync(visualBaselineRoot)) {
    return
  }

  const baselineFiles = readdirSync(visualBaselineRoot)
    .filter((entry) => entry.endsWith('.json'))
    .sort()

  for (const baselineFile of baselineFiles) {
    const baselinePath = join(visualBaselineRoot, baselineFile)
    const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'))
    const observed = renderBaseline(baseline.fixture)

    if (
      baseline.gate !== 'Gate 2' ||
      typeof baseline.fixture !== 'string' ||
      baseline.pageCount !== observed.pageCount ||
      baseline.lineCount !== observed.lineCount ||
      baseline.fragmentCount !== observed.fragmentCount ||
      baseline.renderedPageCount !== observed.renderedPageCount ||
      baseline.drawCallCount !== observed.drawCallCount ||
      baseline.drawCallHash !== observed.drawCallHash
    ) {
      console.error(`${baselinePath}: visual baseline mismatch.`)
      console.error(JSON.stringify(observed, null, 2))
      process.exit(1)
    }
  }

  console.log(`Visual baseline files checked: ${baselineFiles.length}.`)
}

function renderBaseline(fixture) {
  const fixtureText = readFileSync(fixture, 'utf8')
  const lines = createBaselineLines(fixture, fixtureText)
  const layout = core.layoutDocument({
    projection: createProjection(fixture, lines),
    pageConfig: createBaselinePageConfig(fixture),
    fontManager: core.createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
  })
  const drawCalls = []

  for (const page of layout.pages) {
    core.renderPageCanvas({
      canvas: createRecordingCanvas(drawCalls),
      page
    })
  }

  return {
    pageCount: layout.pages.length,
    lineCount: layout.pages.reduce((total, page) => total + page.lines.length, 0),
    fragmentCount: layout.pages.reduce(
      (total, page) => total + page.lines.reduce((lineTotal, line) => lineTotal + line.fragments.length, 0),
      0
    ),
    renderedPageCount: layout.pages.length,
    drawCallCount: drawCalls.length,
    drawCallHash: hashDrawCalls(drawCalls)
  }
}

function createBaselinePageConfig(fixture) {
  if (fixture.includes('gate2-50-pages')) {
    return core.createPageConfig()
  }

  return core.createPageConfig({
    orientation: 'landscape',
    widthTwips: core.cssPxToTwips(1800),
    heightTwips: core.cssPxToTwips(2000),
    marginTwips: {
      top: core.cssPxToTwips(72),
      right: core.cssPxToTwips(72),
      bottom: core.cssPxToTwips(72),
      left: core.cssPxToTwips(72)
    }
  })
}

function createBaselineLines(fixture, fixtureText) {
  const lines = fixtureText.trim().split('\n').filter((line) => line.length > 0)

  if (!fixture.includes('gate2-50-pages')) {
    return lines
  }

  return Array.from({ length: 32 }, (_, roundIndex) => roundIndex + 1)
    .flatMap((round) => lines.map((line) => `${line} Repeat ${String(round).padStart(2, '0')}.`))
}

function createProjection(fixture, lines) {
  return {
    document: {
      kind: 'document',
      id: `visual-${fixture}`,
      sections: [
        {
          kind: 'section',
          id: `visual-section-${fixture}`,
          blocks: lines.map((line, index) => ({
            kind: 'paragraph',
            id: `visual-paragraph-${index + 1}`,
            runs: [
              {
                kind: 'run',
                id: `visual-run-${index + 1}`,
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
  }
}

function createRecordingCanvas(drawCalls) {
  const context = {
    set fillStyle(value) {
      drawCalls.push(`fillStyle:${value}`)
    },
    set font(value) {
      drawCalls.push(`font:${value}`)
    },
    set textBaseline(value) {
      drawCalls.push(`textBaseline:${value}`)
    },
    clearRect(x, y, width, height) {
      drawCalls.push(`clearRect:${x},${y},${width},${height}`)
    },
    fillRect(x, y, width, height) {
      drawCalls.push(`fillRect:${x},${y},${width},${height}`)
    },
    fillText(text, x, y) {
      drawCalls.push(`fillText:${text},${x},${y}`)
    }
  }

  return {
    width: 1,
    height: 1,
    getContext: () => context
  }
}

function hashDrawCalls(drawCalls) {
  return createHash('sha256')
    .update(JSON.stringify(drawCalls))
    .digest('hex')
}
