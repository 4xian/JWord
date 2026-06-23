/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 6 服务端 storage-backed history API 接入路径。
 * 边界：只覆盖 Hocuspocus provider 通过 HTTP history backend 记录、预览和恢复，不扩展断网或 DOCX 场景。
 * 协作：examples/collab/src/runtime/hocuspocus-server-history.ts、server/hocuspocus-history-api.ts 和 Playwright chromium。
 * 约束：测试启动独立 collab demo Vite 服务，避免继续膨胀通用 smoke 文件。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.13。
 */
import { expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

const collabDemoUrl = 'http://127.0.0.1:4189'
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
    '4189'
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

test.afterAll(async () => {
  serverProcess?.kill()
  serverProcess = null
  await hocuspocusService?.stop()
  hocuspocusService = null
})

test('Gate 6 collab demo uses server history API for provider versions', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-history-api-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const firstText = 'Gate 6 server history api v1'
  const secondText = 'Gate 6 server history api v2'

  try {
    await clientA.goto(createHocuspocusDemoUrl(
      started.webSocketUrl,
      roomId,
      'client-a',
      started.historyHttpUrl
    ))
    await clientB.goto(createHocuspocusDemoUrl(
      started.webSocketUrl,
      roomId,
      'client-b',
      started.historyHttpUrl
    ))
    await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })
    await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })

    await clientA.locator('#jword-collab-client-a').fill(firstText)
    await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(firstText, {
      timeout: 10000
    })
    await expect.poll(async () =>
      (await hocuspocusService?.readHistoryService().listVersions('jword-collab-browser-doc'))?.map((version) =>
        version.label
      ) ?? []
    ).toContain('Client A edit')
    const firstVersionId = await findHistoryVersionIdByText(clientA, firstText)

    await clientA.locator('#jword-collab-client-a').fill(secondText)
    await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(secondText, {
      timeout: 10000
    })
    await expect.poll(() => readHistoryTexts(clientB)).toContain(secondText)

    await clientA.locator('#jword-collab-history-select').selectOption(firstVersionId)
    await clientA.locator('#jword-collab-history-preview').click()
    await expect(clientA.locator('#jword-collab-history-preview-text')).toContainText(firstText)
    await clientA.locator('#jword-collab-history-restore').click()
    await expect(clientA.locator('#jword-collab-client-a')).toHaveValue(firstText, {
      timeout: 10000
    })
    await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(firstText, {
      timeout: 10000
    })
  } finally {
    await context.close()
  }
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

/** 构造带服务端 history API 的真实 Hocuspocus provider demo URL。 */
function createHocuspocusDemoUrl(
  webSocketUrl: string,
  roomId: string,
  clientId: string,
  historyHttpUrl: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)
  url.searchParams.set('history', historyHttpUrl)

  return url.href
}

/** 按历史文本查找版本 ID。 */
async function findHistoryVersionIdByText(page: Page, text: string): Promise<string> {
  const deadline = Date.now() + 5000

  while (Date.now() < deadline) {
    const versionId = await page.evaluate((targetText) => {
      const debugWindow = window as unknown as CollabDebugWindow
      const entry = debugWindow.__jwordCollabDemo?.readVersionHistory()
        .find((candidate) => candidate.text === targetText)

      return entry?.id ?? null
    }, text)

    if (versionId !== null) {
      return versionId
    }

    await page.waitForTimeout(100)
  }

  throw new Error(`history version not found for text: ${text}`)
}

/** 读取历史版本文本列表。 */
async function readHistoryTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readVersionHistory().map((entry) => entry.text) ?? []
  })
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: {
    readonly readVersionHistory: () => readonly VersionHistoryEntry[]
  }
}

interface VersionHistoryEntry {
  readonly id: string
  readonly text: string
}
