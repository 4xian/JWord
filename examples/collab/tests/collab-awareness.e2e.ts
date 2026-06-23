/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 6 awareness 降级、权限失败和 undo 隔离路径。
 * 边界：只覆盖 Hocuspocus demo awareness 行为，不验证完整并发矩阵或版本历史。
 * 协作：examples/collab/src/runtime/hocuspocus-runtime.ts、server/hocuspocus-service.ts 和 Playwright chromium 项目。
 * 约束：每个用例使用独立 room 和随机 Hocuspocus 端口，测试结束必须关闭浏览器上下文和服务。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.3。
 */
import { expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

const collabDemoUrl = 'http://127.0.0.1:4187'
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
    '4187'
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

test('Gate 6 Hocuspocus awareness presence does not enter local undo history', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-awareness-undo'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'awareness undo base'
  const localText = `${baseText} local`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await clientA.locator('#jword-collab-client-a').fill(baseText)
  await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(baseText, {
    timeout: 10000
  })
  await clientB.locator('#jword-collab-client-b').evaluate((element: Element) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      return
    }
    element.focus()
    element.setSelectionRange(0, 9)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })
  await expect.poll(() => readAwarenessClientIds(clientA)).toContain('client-b')

  await clientA.locator('#jword-collab-client-a').fill(localText)
  await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(localText, {
    timeout: 10000
  })
  await clientA.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    debugWindow.__jwordCollabDemo?.undoLocalUserEdit()
  })

  await expect(clientA.locator('#jword-collab-client-a')).toHaveValue(baseText, {
    timeout: 10000
  })
  await expect(clientB.locator('#jword-collab-client-b')).toHaveValue(baseText, {
    timeout: 10000
  })
  await expect.poll(() => readAwarenessClientIds(clientA)).toContain('client-b')

  await context.close()
})

test('Gate 6 Hocuspocus auth failure blocks awareness while keeping explicit diagnostics', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-awareness-auth',
    requiredToken: 'valid-token'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'invalid-token'))

  await expect.poll(() => readOfflineLastEvent(clientA), {
    timeout: 10000
  }).toBe('provider-error')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('COLLAB_PROVIDER_AUTH_FAILED')
  await expect.poll(() => readAwarenessClientIds(clientA)).toEqual([])

  await clientA.locator('#jword-collab-client-a').evaluate((element: Element) => {
    if (!(element instanceof HTMLTextAreaElement)) {
      return
    }
    element.focus()
    element.setSelectionRange(0, 0)
    element.dispatchEvent(new Event('select', { bubbles: true }))
  })

  await expect.poll(() => readAwarenessClientIds(clientA)).toEqual([])
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('COLLAB_PROVIDER_AUTH_FAILED')

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
  roomId: string,
  clientId: string,
  token?: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)
  if (token !== undefined) {
    url.searchParams.set('token', token)
  }

  return url.href
}

/** 读取 awareness debug API 中的 client id 列表。 */
async function readAwarenessClientIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readAwarenessState().users.map((user) => user.clientId) ?? []
  })
}

/** 读取离线状态最近事件。 */
async function readOfflineLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().lastEvent ?? null
  })
}

/** 读取离线状态中的诊断 code 列表。 */
async function readOfflineDiagnosticCodes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().diagnostics?.map((diagnostic) =>
      diagnostic.code
    ) ?? []
  })
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: CollabDebugApi
}

interface CollabDebugApi {
  readonly readAwarenessState: () => {
    readonly users: readonly {
      readonly clientId: string
    }[]
  }
  readonly readOfflineState: () => {
    readonly lastEvent: string
    readonly diagnostics?: readonly {
      readonly code: string
    }[]
  }
  readonly undoLocalUserEdit: () => void
}
