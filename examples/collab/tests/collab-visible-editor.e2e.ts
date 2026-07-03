/**
 * @fileoverview 职责：锁定 Gate 6 demo 的第三方集成形态，协作和自动插入必须作用在可见 JWord editor。
 * 边界：只覆盖 Hocuspocus provider 下双页 editor 输入与自动插入，不扩展历史、DOCX 或离线矩阵。
 * 协作：examples/collab/src/main.ts、Hocuspocus 本地服务和 Playwright chromium 项目。
 * 约束：测试只通过真实 editor 输入层和 debug API 观察状态，不使用 textarea harness 作为主编辑入口。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md 第六阶段第三方集成演示。
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

const collabDemoUrl = 'http://127.0.0.1:4194'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null
let hocuspocusService: CollabHocuspocusService | null = null

test.beforeAll(async () => {
  test.setTimeout(120000)
  serverProcess = spawn(viteExecutablePath, [
    '--host',
    '127.0.0.1',
    '--port',
    '4194',
    '--strictPort'
  ], {
    cwd: collabDemoDirectory,
    env: {
      ...process.env,
      VITE_CJS_TRACE: 'false'
    },
    stdio: 'ignore'
  })

  await waitForCollabDemoServer()
})

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
  void hocuspocusService?.stop()
  hocuspocusService = null
})

test('Gate 6 demo 通过可见 JWord editor 同步手动输入和自动插入', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-visible-editor'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const manualText = ' editor-sync-proof'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientA.locator('.jw-collab-demo__clients textarea')).toHaveCount(0)
  await expect(clientB.locator('.jw-collab-demo__clients textarea')).toHaveCount(0)

  await typeIntoVisibleEditor(clientA, manualText)
  await expect.poll(() => readVisibleEditorText(clientB), {
    timeout: 10000
  }).toContain(manualText)
  await expect.poll(() => readFirstClientText(clientB), {
    timeout: 10000
  }).toContain(manualText)

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readVisibleEditorText(clientA), {
    timeout: 10000
  }).toContain('协同')
  await expect.poll(() => readVisibleEditorText(clientB), {
    timeout: 10000
  }).toContain('协同')

  await context.close()
})

/** 等待 collab demo Vite 服务可访问。 */
async function waitForCollabDemoServer(): Promise<void> {
  const deadline = Date.now() + 120000
  let lastError: unknown = null

  while (Date.now() < deadline) {
    const controller = new AbortController()
    const timeout = setTimeout(() => {
      controller.abort()
    }, 1000)

    try {
      const response = await fetch(collabDemoUrl, { signal: controller.signal })

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

  throw new Error(`collab demo server did not start: ${String(lastError)}`)
}

/** 构造真实 Hocuspocus provider demo URL。 */
function createHocuspocusDemoUrl(
  webSocketUrl: string,
  serverUrl: string,
  roomId: string,
  clientId: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('serverUrl', serverUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)

  return url.href
}

/** 通过 JWord editor 的真实隐藏输入层模拟用户在可见编辑器输入。 */
async function typeIntoVisibleEditor(page: Page, text: string): Promise<void> {
  await page.evaluate(() => window.__jwordCollabDemo?.focusEditor?.())
  await page.locator('[data-jword-collab-editor] [data-jword-hidden-textarea]').focus()
  await page.keyboard.type(text)
}

/** 读取可见 JWord editor 的无障碍文本镜像。 */
async function readVisibleEditorText(page: Page): Promise<string> {
  return (await page.locator('[data-jword-collab-editor] [data-jword-text-mirror]').textContent()) ?? ''
}

/** 读取协作 runtime 的第一 client 文本。 */
async function readFirstClientText(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__jwordCollabDemo?.readCollabState().clients[0]?.text ?? null)
}
