/**
 * @fileoverview 职责：用真实浏览器验证 Gate 6 client/server version handshake 和 diagnostics export。
 * 边界：只覆盖公开 collab client SDK 的 /version 握手，不启动真实 Hocuspocus provider 或编辑器 UI。
 * 协作：examples/collab/src/browser-handshake-harness.ts、公开 @4xian/jword-collab 入口和 Playwright chromium 项目。
 * 约束：浏览器必须在连接 provider 前完成握手；失败时只导出 diagnostic，不进入半协作状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, get, type Server } from 'node:http'
import { fileURLToPath } from 'node:url'
import type { BrowserHandshakeHarnessApi } from '../src/browser-handshake-harness'

let collabDemoUrl = 'http://127.0.0.1:4201'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const testProtocolVersion = 'gate6-collab-v1'
const testPackageVersion = '0.0.0'
const testCollabFeatures = {
  multiplayer: 'collaboration.multiplayer',
  server: 'collaboration.server'
} as const
type TestCollabFeature = typeof testCollabFeatures[keyof typeof testCollabFeatures]

/** 按浏览器项目分配独立 demo 端口，避免并行项目互相复用和关闭 Vite。 */
function readCollabDemoPort(browserName: string): number {
  if (browserName === 'firefox') {
    return 4202
  }
  if (browserName === 'webkit') {
    return 4203
  }

  return 4201
}

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null
let serverOutput = ''

test.beforeAll(async ({ browserName }) => {
  test.setTimeout(120000)
  const collabDemoPort = readCollabDemoPort(browserName)

  collabDemoUrl = `http://127.0.0.1:${collabDemoPort}`
  serverProcess = spawn(viteExecutablePath, [
    '--host',
    '127.0.0.1',
    '--port',
    String(collabDemoPort),
    '--strictPort'
  ], {
    cwd: collabDemoDirectory,
    env: {
      ...process.env,
      VITE_CJS_TRACE: 'false'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  serverProcess.stdout?.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })
  serverProcess.stderr?.on('data', (chunk) => {
    serverOutput += chunk.toString()
  })

  await waitForUrl(collabDemoUrl)
})

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
})

test('Gate 6 browser handshake connects only after matching server version', async ({ page }) => {
  const handshakeServer = await startHandshakeServer({
    protocolVersion: testProtocolVersion,
    packageVersion: testPackageVersion,
    featureFlags: Object.values(testCollabFeatures),
    minimumClientVersion: '0.0.0',
    minimumServerVersion: '0.0.0'
  })

  try {
    await openCollabHarnessPage(page)

    const result = await runBrowserHandshake(page, handshakeServer.url, [testCollabFeatures.multiplayer])

    expect(result).toMatchObject({
      status: 'synced',
      diagnosticCodes: [],
      providerStatus: 'synced',
      handshake: {
        protocolVersion: testProtocolVersion,
        serverPackageVersion: testPackageVersion,
        minimumClientVersion: '0.0.0',
        minimumServerVersion: '0.0.0'
      }
    })
  } finally {
    await handshakeServer.close()
  }
})

test('Gate 6 browser handshake exports diagnostics before provider connect when feature flags are missing', async ({ page }) => {
  const handshakeServer = await startHandshakeServer({
    protocolVersion: testProtocolVersion,
    packageVersion: testPackageVersion,
    featureFlags: [testCollabFeatures.server],
    minimumClientVersion: '0.0.0',
    minimumServerVersion: '0.0.0'
  })

  try {
    await openCollabHarnessPage(page)

    const result = await runBrowserHandshake(page, handshakeServer.url, [testCollabFeatures.multiplayer])

    expect(result).toMatchObject({
      status: 'error',
      diagnosticCodes: ['COLLAB_FEATURE_FLAGS_MISSING'],
      providerStatus: 'idle',
      handshake: null
    })
  } finally {
    await handshakeServer.close()
  }
})

interface BrowserHandshakeResult {
  readonly status: string
  readonly diagnosticCodes: readonly string[]
  readonly providerStatus: string
  readonly handshake: unknown
}

interface TestHandshakeVersion {
  readonly protocolVersion: string
  readonly packageVersion: string
  readonly featureFlags: readonly string[]
  readonly minimumClientVersion: string
  readonly minimumServerVersion: string
}

interface TestHandshakeServer {
  readonly url: string
  close(): Promise<void>
}

type CollabHandshakeHarnessWindow = Window & {
  readonly __jwordCollabHandshakeHarness?: BrowserHandshakeHarnessApi
}

/** 打开独立握手测试页，避免复用根路径时被并行导航打断。 */
async function openCollabHarnessPage(page: Page): Promise<void> {
  const url = `${collabDemoUrl}/?handshakeHarness=${Date.now()}`

  try {
    await page.goto(url, {
      waitUntil: 'domcontentloaded'
    })
  } catch (error) {
    if (!isInterruptedBySameUrlNavigation(error)) {
      throw error
    }
  }
  await expect.poll(() => page.evaluate(() => {
    const harnessWindow = window as CollabHandshakeHarnessWindow

    return typeof harnessWindow.__jwordCollabHandshakeHarness?.runPublicCollabBrowserHandshake === 'function'
  })).toBe(true)
}

/** 判断 Firefox 是否出现同 URL 自动跳转打断 domcontentloaded 等待。 */
function isInterruptedBySameUrlNavigation(error: unknown): boolean {
  return error instanceof Error && error.message.includes('is interrupted by another navigation')
}

/** 在浏览器中执行公开 collab client SDK 握手。 */
async function runBrowserHandshake(
  page: {
    evaluate<R, A>(pageFunction: (argument: A) => Promise<R>, argument: A): Promise<R>
  },
  serverUrl: string,
  features: readonly TestCollabFeature[]
): Promise<BrowserHandshakeResult> {
  return page.evaluate(async ({ serverUrl: nextServerUrl, features: nextFeatures }) => {
    const harness = (window as CollabHandshakeHarnessWindow).__jwordCollabHandshakeHarness

    if (harness === undefined) {
      throw new Error('Collab browser handshake harness is not loaded.')
    }

    return harness.runPublicCollabBrowserHandshake({
      serverUrl: nextServerUrl,
      features: nextFeatures
    })
  }, {
    serverUrl,
    features
  })
}

/** 启动只服务 /version 的 CORS 测试服务。 */
async function startHandshakeServer(version: TestHandshakeVersion): Promise<TestHandshakeServer> {
  const server = createServer((request, response) => {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type')

    if (request.url !== '/version') {
      response.statusCode = 404
      response.end()
      return
    }

    response.setHeader('content-type', 'application/json; charset=utf-8')
    response.end(`${JSON.stringify({
      ...version,
      requestId: 'browser-handshake-request'
    })}\n`)
  })

  await listen(server)
  const address = server.address()

  if (typeof address !== 'object' || address === null) {
    throw new Error('Handshake server did not expose an address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    /** 关闭握手测试服务。 */
    close() {
      return closeServer(server)
    }
  }
}

/** 等待本地 HTTP server 监听。 */
function listen(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
}

/** 关闭本地 HTTP server。 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

/** 等待 URL 可访问。 */
async function waitForUrl(url: string): Promise<void> {
  const deadline = Date.now() + 60000

  while (Date.now() < deadline) {
    try {
      if (await canReachUrl(url)) {
        return
      }
    } catch {
      // 等待 Vite 启动完成。
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  throw new Error(`Timed out waiting for ${url}\n${serverOutput}`)
}

/** 用本地 HTTP client 探测 Vite 是否启动。 */
function canReachUrl(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const request = get(url, (response) => {
      response.resume()
      resolve((response.statusCode ?? 500) < 500)
    })

    request.on('error', () => {
      resolve(false)
    })
    request.setTimeout(1000, () => {
      request.destroy()
      resolve(false)
    })
  })
}
