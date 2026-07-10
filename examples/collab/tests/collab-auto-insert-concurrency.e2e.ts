/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 6 provider auto inserter 并发回归。
 * 边界：只覆盖 Hocuspocus provider 下 AI/local 与 AI/remote 并发，不扩展历史、DOCX 或生产持久化矩阵。
 * 协作：examples/collab/src/runtime/hocuspocus-runtime.ts、Hocuspocus 本地服务和 Playwright chromium 项目。
 * 约束：测试启动独立 Vite 服务；每个场景记录初始文档、操作序列、origin 预期和最终 projection 摘要。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

let collabDemoUrl = 'http://127.0.0.1:4193'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const autoInsertTokens = ['协同', '版本', '离线', '回放']

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null
let hocuspocusService: CollabHocuspocusService | null = null

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
    stdio: 'ignore'
  })

  await waitForCollabDemoServer()
})

/** 按浏览器项目分配独立 demo 端口，避免并行项目互相复用和关闭 Vite。 */
function readCollabDemoPort(browserName: string): number {
  if (browserName === 'firefox') {
    return 4197
  }
  if (browserName === 'webkit') {
    return 4198
  }

  return 4193
}

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
  void hocuspocusService?.stop()
  hocuspocusService = null
})

test('Gate 6 provider AI 在 anchor 流式插入时本地前方输入不丢不重复且 undo 保留 AI', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-local-stream'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'anchor'
  const localPrefix = 'local '

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await writeClientText(clientA, 'client-a', `${localPrefix}${await readFirstClientText(clientA)}`)
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(autoInsertTokens.length)

  const expectedBeforeUndo = `${localPrefix}${initialText}${autoInsertTokens.join('')}`

  await expectClientText(clientA, 'client-a', expectedBeforeUndo, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', expectedBeforeUndo, {
    timeout: 10000
  })
  expect(countOccurrences(await readFirstClientText(clientA), 'local')).toBe(1)
  for (const token of autoInsertTokens) {
    expect(countOccurrences(await readFirstClientText(clientA), token)).toBe(1)
  }

  const undoText = await undoLocalUserEdit(clientA)
  const expectedAfterUndo = `${initialText}${autoInsertTokens.join('')}`

  expect(undoText).toBe(expectedAfterUndo)
  await expectClientText(clientA, 'client-a', expectedAfterUndo, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', expectedAfterUndo, {
    timeout: 10000
  })

  await context.close()
})

test('Gate 6 provider AI 替换 range 时本地后方输入不被覆盖', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-local-replace'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'target tail'
  const localSuffix = ' local'
  const targetEnd = 'target'.length

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate((input) => window.__jwordCollabDemo?.startAutoInsert(input), {
    rangeStart: 0,
    rangeEnd: targetEnd
  })
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await writeClientText(clientA, 'client-a', `${await readFirstClientText(clientA)}${localSuffix}`)
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(autoInsertTokens.length)

  const expectedBeforeUndo = `${autoInsertTokens.join('')} tail${localSuffix}`

  await expectClientText(clientA, 'client-a', expectedBeforeUndo, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', expectedBeforeUndo, {
    timeout: 10000
  })

  const undoText = await undoLocalUserEdit(clientA)
  const expectedAfterUndo = `${autoInsertTokens.join('')} tail`

  expect(undoText).toBe(expectedAfterUndo)
  await expectClientText(clientA, 'client-a', expectedAfterUndo, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', expectedAfterUndo, {
    timeout: 10000
  })

  await context.close()
})

test('Gate 6 provider 用户删除 AI anchor 所在正文后返回 anchor unresolved', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-anchor-deleted'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'anchor'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await writeClientText(clientA, 'client-a', '')

  await expect.poll(() => readAutoInsertDiagnosticCodes(clientA)).toContain('COLLAB_AUTO_INSERTER_ANCHOR_UNRESOLVED')
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBe(1)
  await expectClientText(clientA, 'client-a', '', {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', '', {
    timeout: 10000
  })

  await context.close()
})

test('Gate 6 provider AI 写入时远端同段输入最终不丢不重复', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-remote-input'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'remote-base'
  const remoteText = 'remote-user'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await expect.poll(() => readSecondClientText(clientB)).toContain(autoInsertTokens[0])
  await writeClientText(clientB, 'client-b', `${await readSecondClientText(clientB)}${remoteText}`)
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(autoInsertTokens.length)

  const finalText = await waitForClientsToConverge(clientA, clientB)

  expect(countOccurrences(finalText, initialText)).toBe(1)
  expect(countOccurrences(finalText, remoteText)).toBe(1)
  for (const token of autoInsertTokens) {
    expect(countOccurrences(finalText, token)).toBe(1)
  }

  await context.close()
})

test('Gate 6 provider AI 写入时远端删除相邻文本后最终不残留删除文本', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-remote-delete'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'keep tail'
  const deletedText = ' tail'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await expect.poll(() => readSecondClientText(clientB)).toContain(autoInsertTokens[0])
  await writeClientText(
    clientB,
    'client-b',
    `${await readSecondClientText(clientB)}`.replace(deletedText, '')
  )
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(autoInsertTokens.length)

  const finalText = await waitForClientsToConverge(clientA, clientB)

  expect(finalText).toContain('keep')
  expect(finalText).not.toContain('tail')
  for (const token of autoInsertTokens) {
    expect(countOccurrences(finalText, token)).toBe(1)
  }

  await context.close()
})

test('Gate 6 provider AI 写入期间断开再恢复后远端收敛', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-ai-provider-reconnect'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'reconnect'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expectClientText(clientB, 'client-b', initialText, {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThanOrEqual(1)
  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-disconnected')
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(autoInsertTokens.length)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBeGreaterThan(0)

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-reconnect-synced')

  const finalText = await waitForClientsToConverge(clientA, clientB)

  expect(countOccurrences(finalText, initialText)).toBe(1)
  for (const token of autoInsertTokens) {
    expect(countOccurrences(finalText, token)).toBe(1)
  }

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
  historyHttpUrl: string,
  roomId: string,
  clientId: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('history', historyHttpUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)

  return url.href
}

/** 通过 debug API 写入 client 正文，确保进入 demo runtime。 */
async function writeClientText(page: Page, clientId: string, value: string): Promise<void> {
  const previousText = await readClientText(page, clientId) ?? ''

  await updateClientText(page, clientId, value, previousText)
}

/** 读取第一个 client 文本。 */
async function readFirstClientText(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().clients[0]?.text ?? null
  })

  return normalizeCollabText(text)
}

/** 读取第二个 client 文本。 */
async function readSecondClientText(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().clients[1]?.text ?? null
  })

  return normalizeCollabText(text)
}

/** 按 client id 读取对应页面的正文快照。 */
async function readClientText(page: Page, clientId: string): Promise<string | null> {
  return clientId === 'client-a'
    ? readFirstClientText(page)
    : readSecondClientText(page)
}

/** 断言指定 client 正文最终等于预期文本。 */
async function expectClientText(
  page: Page,
  clientId: string,
  expectedText: string,
  options: ClientTextExpectationOptions = {}
): Promise<void> {
  await expect.poll(() => readClientText(page, clientId), options).toBe(expectedText)
}

/** 通过 demo debug API 写入指定 provider client 的正文。 */
async function updateClientText(
  page: Page,
  clientId: string,
  text: string,
  previousText?: string
): Promise<void> {
  await page.evaluate((input) => {
    const debugWindow = window as unknown as CollabDebugWindow

    debugWindow.__jwordCollabDemo?.updateClientText(input.clientId, input.text, input.previousText)
  }, {
    clientId,
    text,
    previousText
  })
}

/** 去除 editor 投影为单段文档补出的首尾换行。 */
function normalizeCollabText(text: string | null): string | null {
  return text?.replace(/^\n|\n$/gu, '') ?? null
}

/** 等待两个浏览器页面收敛到同一正文。 */
async function waitForClientsToConverge(clientA: Page, clientB: Page): Promise<string> {
  await expect.poll(async () => {
    const firstText = await readFirstClientText(clientA)
    const secondText = await readSecondClientText(clientB)

    return firstText !== null && firstText === secondText ? firstText : null
  }).not.toBeNull()

  const finalText = await readFirstClientText(clientA)

  if (finalText === null) {
    throw new Error('Gate 6 auto insert concurrency did not produce final text.')
  }

  return finalText
}

/** 读取 auto insert 已插入 token 数。 */
async function readAutoInsertInsertedCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.insertedCount ?? null
  })
}

/** 读取 auto insert 诊断 code 列表。 */
async function readAutoInsertDiagnosticCodes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.diagnostics.map((diagnostic) =>
      diagnostic.code
    ) ?? []
  })
}

/** 读取 provider offline 最近事件。 */
async function readOfflineLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().lastEvent ?? null
  })
}

/** 读取 provider offline 待同步操作数量。 */
async function readOfflineQueuedOperations(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().queuedOperations ?? null
  })
}

/** 通过 demo debug API 撤销当前页面的本地用户输入。 */
async function undoLocalUserEdit(page: Page): Promise<string | null> {
  const text = await page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.undoLocalUserEdit().clients[0]?.text ?? null
  })

  return normalizeCollabText(text)
}

/** 统计字符串里目标片段出现次数。 */
function countOccurrences(text: string | null, needle: string): number {
  if (text === null || needle.length === 0) {
    return 0
  }

  return text.split(needle).length - 1
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: CollabDebugApi
}

interface CollabDebugApi {
  readonly readCollabState: () => CollabStateSnapshot
  readonly readOfflineState: () => OfflineStateSnapshot
  readonly startAutoInsert: (input?: AutoInsertStartInput) => void
  readonly simulateDisconnect: () => void
  readonly simulateReconnect: () => void
  readonly undoLocalUserEdit: () => CollabStateSnapshot
  readonly updateClientText: (clientId: string, text: string, previousText?: string) => CollabStateSnapshot
}

interface AutoInsertStartInput {
  readonly rangeStart?: number
  readonly rangeEnd?: number
}

interface CollabStateSnapshot {
  readonly clients: readonly {
    readonly text: string
  }[]
  readonly autoInsert: {
    readonly insertedCount: number
    readonly diagnostics: readonly {
      readonly code: string
    }[]
  }
}

interface OfflineStateSnapshot {
  readonly queuedOperations: number
  readonly lastEvent: string
}

interface ClientTextExpectationOptions {
  readonly timeout?: number
}
