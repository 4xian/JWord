/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 5 DOCX/PDF demo 的公开高级包集成主路径。
 * 边界：只通过 examples/docx 暴露的第三方宿主调试入口操作，不读取 packages/docx 或 packages/pdf 内部模块。
 * 协作：examples/docx/src/main.ts、@4xian/jword-docx、@4xian/jword-pdf 和 @4xian/jword-license。
 * 约束：测试自启独立 Vite 服务，验证 valid、missing 和 feature-mismatch 授权路径均可复跑。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5---商业高级格式互通docx-导入导出与-pdf-导出。
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const docxDemoUrl = 'http://127.0.0.1:4187'
const docxDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null

test.beforeAll(async () => {
  test.setTimeout(120000)
  serverProcess = spawn(viteExecutablePath, [
    '--host',
    '127.0.0.1',
    '--port',
    '4187'
  ], {
    cwd: docxDemoDirectory,
    env: {
      ...process.env,
      VITE_CJS_TRACE: 'false'
    },
    stdio: 'ignore'
  })

  await waitForDocxDemoServer()
})

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
})

test('Gate 5 DOCX demo imports exports and keeps editor editable with a valid license', async ({ page }) => {
  const runtimeRequests: string[] = []

  page.on('request', (request) => {
    const url = request.url()

    if (isGate5RuntimeRequest(url)) {
      runtimeRequests.push(url)
    }
  })

  await page.goto(`${docxDemoUrl}/?license=valid`)
  await expect(page.locator('#jword-docx-import')).toBeVisible()
  expect(runtimeRequests).toEqual([])

  await page.evaluate(() => window.__jwordDocxDemo?.importSelectedFixture())
  await expect.poll(() => readDocxDemoStatus(page)).toContain('导入完成')
  await expect.poll(() => readEditorText(page)).toContain('Gate 5 DOCX Demo')

  await page.locator('[data-jword-page="0"]').click({
    position: {
      x: 140,
      y: 140
    }
  })
  await dispatchHiddenTextareaInput(page, 'DOCX_E2E_EDIT')
  await expect.poll(() => readEditorText(page)).toContain('DOCX_E2E_EDIT')

  const docxExport = await page.evaluate(async () => {
    const bytes = await window.__jwordDocxDemo?.exportDocx()

    return {
      byteLength: bytes?.byteLength ?? 0,
      roundtrip: window.__jwordDocxDemo?.readRoundtripText() ?? '',
      status: window.__jwordDocxDemo?.readStatus() ?? ''
    }
  })

  expect(docxExport.byteLength).toBeGreaterThan(0)
  expect(docxExport.status).toContain('DOCX 导出完成')
  expect(docxExport.roundtrip).toContain('"matches": true')

  const pdfExport = await page.evaluate(async () => {
    const bytes = await window.__jwordDocxDemo?.exportPdf()

    return {
      byteLength: bytes?.byteLength ?? 0,
      status: window.__jwordDocxDemo?.readStatus() ?? '',
      pdfOutput: document.querySelector('#jword-pdf-output')?.textContent ?? ''
    }
  })

  expect(pdfExport.byteLength).toBeGreaterThan(0)
  expect(pdfExport.status).toContain('PDF 导出完成')
  expect(pdfExport.pdfOutput).toContain('progress: queued -> mapping -> writing -> done')
  expect(runtimeRequests.some((url) => url.includes('/packages/docx/') || url.includes('@4xian/jword-docx'))).toBe(true)
  expect(runtimeRequests.some((url) => url.includes('/packages/pdf/') || url.includes('@4xian/jword-pdf'))).toBe(true)
})

test('Gate 5 DOCX demo reports stable license diagnostics without changing editor state', async ({ page }) => {
  await page.goto(`${docxDemoUrl}/?license=missing`)
  await expect(page.locator('#jword-docx-import')).toBeVisible()

  const missingTextBefore = await readEditorText(page)

  await expect(page.evaluate(() => window.__jwordDocxDemo?.importSelectedFixture())).rejects.toThrow('JWORD_LICENSE_MISSING')
  await expect.poll(() => readDocxDemoStatus(page)).toContain('JWORD_LICENSE_MISSING')
  await expect.poll(() => readDocxActiveTask(page)).toBeNull()
  expect(await readEditorText(page)).toBe(missingTextBefore)

  await page.goto(`${docxDemoUrl}/?license=feature-mismatch`)
  await expect(page.locator('#jword-docx-import')).toBeVisible()
  await page.evaluate(() => window.__jwordDocxDemo?.importSelectedFixture())
  await expect.poll(() => readDocxDemoStatus(page)).toContain('导入完成')

  const importedText = await readEditorText(page)

  await expect(page.evaluate(() => window.__jwordDocxDemo?.exportDocx())).rejects.toThrow('JWORD_FEATURE_NOT_ENTITLED')
  await expect.poll(() => readDocxDemoStatus(page)).toContain('JWORD_FEATURE_NOT_ENTITLED')
  await expect.poll(() => readDocxActiveTask(page)).toBeNull()
  expect(await readEditorText(page)).toBe(importedText)

  await expect(page.evaluate(() => window.__jwordDocxDemo?.exportPdf())).rejects.toThrow('JWORD_FEATURE_NOT_ENTITLED')
  await expect.poll(() => readDocxDemoStatus(page)).toContain('JWORD_FEATURE_NOT_ENTITLED')
  await expect.poll(() => readDocxActiveTask(page)).toBeNull()
  expect(await readEditorText(page)).toBe(importedText)
})

/** 判断请求是否属于 Gate 5 高级 runtime 懒加载资源。 */
function isGate5RuntimeRequest(url: string): boolean {
  return url.includes('@4xian/jword-docx') ||
    url.includes('@4xian/jword-pdf') ||
    url.includes('/packages/docx/') ||
    url.includes('/packages/pdf/') ||
    url.includes('/node_modules/.vite/deps/jszip') ||
    url.includes('/node_modules/.vite/deps/pdf-lib')
}

/** 等待 DOCX demo Vite 服务可访问。 */
async function waitForDocxDemoServer(): Promise<void> {
  const deadline = Date.now() + 120000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 1000)

    try {
      const response = await fetch(docxDemoUrl, { signal: controller.signal })

      if (response.ok) {
        return
      }
    } catch (error) {
      lastError = error
    } finally {
      clearTimeout(timeout)
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 250)
    })
  }

  throw new Error(`docx demo server did not start: ${String(lastError)}`)
}

/** 读取 demo 状态栏文本。 */
function readDocxDemoStatus(page: Page): Promise<string> {
  return page.evaluate(() => window.__jwordDocxDemo?.readStatus() ?? '')
}

/** 读取 demo active task。 */
function readDocxActiveTask(page: Page): Promise<unknown> {
  return page.evaluate(() => window.__jwordDocxDemo?.readActiveTask() ?? null)
}

/** 通过 hidden textarea input 事件写入文本，覆盖真实浏览器输入管线。 */
function dispatchHiddenTextareaInput(page: Page, text: string): Promise<void> {
  return page.evaluate((nextText) => {
    window.__jwordDocxDemo?.editor.focus()

    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 DOCX demo hidden textarea。')
    }

    input.value = nextText
    input.dispatchEvent(new Event('input', {
      bubbles: true,
      cancelable: true
    }))
  }, text)
}

/** 读取当前 DOCX demo editor projection 的正文文本。 */
function readEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const documentModel = window.__jwordDocxDemo?.editor.getProjection().document

    if (documentModel === undefined) {
      return ''
    }

    return documentModel.sections.flatMap((section) => {
      return section.blocks.flatMap((block) => {
        if (block.kind !== 'paragraph') {
          return []
        }

        return block.runs.flatMap((run) => {
          return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
        })
      })
    }).join('')
  })
}
