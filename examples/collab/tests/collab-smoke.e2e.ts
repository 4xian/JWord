/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 6 collab demo 的最小 debug API smoke 契约。
 * 边界：只验证内存模拟入口、断连重连和 auto insert 状态，不声明真实双窗口、Hocuspocus 或离线同步完成。
 * 协作：examples/collab/src/main.ts、examples/collab/src/runtime.ts 和 Playwright chromium 项目。
 * 约束：测试启动 collab demo 独立 Vite 服务，避免改动根 Playwright vanilla webServer 配置。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test, type Page } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'
import {
  collabDemoDirectory,
  collabDemoUrl,
  createHocuspocusDemoUrl,
  createThirdPartyHocuspocusDemoUrl,
  findHistoryVersionIdByText,
  readAutoInsertDiagnosticCodes,
  readAutoInsertLastEvent,
  readAutoInsertRunning,
  readAwarenessClientIds,
  readAwarenessRangeAnchorGraphemeIndex,
  readAwarenessRangeAnchorRelativeTname,
  readAwarenessRangeFocusGraphemeIndex,
  readAwarenessViewportPageIndex,
  readClientText,
  readCollabDebugApiNames,
  readFirstClientText,
  readHistoryLabels,
  readHistoryTexts,
  readOfflineConnected,
  readOfflineDiagnosticCodes,
  readOfflineDiagnosticRecoverable,
  readOfflineLastEvent,
  readOfflineQueuedOperations,
  readOfflineUpdateByteLength,
  readProviderMode,
  readRemoteCursorTransforms,
  readSecondClientText,
  setCollabDemoPort,
  updateClientSelection,
  viteExecutablePath,
  waitForCollabDemoServer,
  writeClientText
} from './collab-smoke-helpers'

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null
let hocuspocusService: CollabHocuspocusService | null = null

test.beforeAll(async ({ browserName }) => {
  test.setTimeout(120000)
  const collabDemoPort = readCollabDemoPort(browserName)

  setCollabDemoPort(collabDemoPort)
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

test.afterAll(() => {
  serverProcess?.kill()
  serverProcess = null
  void hocuspocusService?.stop()
  hocuspocusService = null
})

/** 按浏览器项目分配独立 demo 端口，避免并行项目互相复用和关闭 Vite。 */
function readCollabDemoPort(browserName: string): number {
  if (browserName === 'firefox') {
    return 4204
  }
  if (browserName === 'webkit') {
    return 4205
  }

  return 4186
}

test('Gate 6 collab demo exposes memory debug API and state transitions', async ({ page }) => {
  await page.goto(collabDemoUrl)
  await expect(page.locator('[data-jword-collab-demo]')).toBeVisible()
  await expect(page.locator('[data-jword-collab-status]')).toContainText('connected')

  const apiNames = await readCollabDebugApiNames(page)

  expect(apiNames).toEqual([
    'abortAutoInsert',
    'addCommentRange',
    'focusEditor',
    'formatClientRange',
    'importDocxForCollabAcceptance',
    'readAwarenessState',
    'readCollabState',
    'readCommentRanges',
    'readOfflineState',
    'readTextFormatRanges',
    'readVersionHistory',
    'retryAutoInsert',
    'simulateDisconnect',
    'simulateReconnect',
    'startAutoInsert',
    'undoLocalUserEdit',
    'updateClientSelection',
    'updateClientText'
  ])

  await expect.poll(() => readOfflineConnected(page)).toBe(true)
  await page.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineConnected(page)).toBe(false)
  await expect(page.locator('[data-jword-collab-status]')).toContainText('disconnected')

  await page.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())
  await expect.poll(() => readOfflineConnected(page)).toBe(true)
  await expect(page.locator('[data-jword-collab-status]')).toContainText('connected')

  await page.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertRunning(page)).toBe(true)
  await page.evaluate(() => window.__jwordCollabDemo?.abortAutoInsert())
  await expect.poll(() => readAutoInsertRunning(page)).toBe(false)
  await expect.poll(() => readAutoInsertLastEvent(page)).toBe('aborted')
  await expect.poll(() => readAutoInsertDiagnosticCodes(page)).toContain('COLLAB_AUTO_INSERTER_ABORTED')
  await page.evaluate(() => window.__jwordCollabDemo?.retryAutoInsert())
  await expect.poll(() => readAutoInsertLastEvent(page)).toBe('retry-started')
  await expect.poll(() => readAutoInsertDiagnosticCodes(page)).toContain('COLLAB_AUTO_INSERTER_RETRY_STARTED')
})

test('Gate 6 collab demo syncs editable clients and restores history through browser UI', async ({ page }) => {
  await page.goto(collabDemoUrl)
  await expect(page.locator('[data-jword-collab-demo]')).toBeVisible()

  const historySelect = page.locator('#jword-collab-history-select')
  const previewButton = page.locator('#jword-collab-history-preview')
  const restoreButton = page.locator('#jword-collab-history-restore')
  const preview = page.locator('#jword-collab-history-preview-text')
  const browserText = 'Gate 6 browser synced text'

  await writeClientText(page, 'client-a', browserText)
  await expect.poll(() => readClientText(page, 'client-b')).toBe(browserText)
  await expect.poll(() => readHistoryLabels(page)).toContain('Client A edit')

  await writeClientText(page, 'client-b', `${browserText} from B`)
  await expect.poll(() => readClientText(page, 'client-a')).toBe(`${browserText} from B`)
  await expect.poll(() => readHistoryLabels(page)).toContain('Client B edit')

  await historySelect.selectOption('v1')
  await previewButton.click()
  await expect(preview).toContainText('Gate 6 memory collab draft')

  await restoreButton.click()
  await expect.poll(() => readClientText(page, 'client-a')).toBe('Gate 6 memory collab draft')
  await expect.poll(() => readClientText(page, 'client-b')).toBe('Gate 6 memory collab draft')
  await expect.poll(() => readHistoryLabels(page)).toContain('restore:v1')
})

test('Gate 6 collab demo renders remote cursor and selection presence', async ({ page }) => {
  await page.goto(collabDemoUrl)
  await expect(page.locator('[data-jword-collab-demo]')).toBeVisible()

  await expect(page.locator('[data-jword-remote-cursor="client-a"]')).toContainText('Alice')
  await expect(page.locator('[data-jword-remote-cursor="client-b"]')).toContainText('Bao')
  await expect(page.locator('[data-jword-remote-cursor="client-a"]')).toHaveAttribute('title', 'Alice cursor 8')

  await updateClientSelection(page, 'client-a', 5, 12)

  await expect(page.locator('[data-jword-remote-selection="client-a"]')).toContainText('Alice')
  await expect(page.locator('[data-jword-remote-selection="client-a"]')).toContainText('5-12')
  await expect(page.locator('[data-jword-remote-selection="client-a"]')).toHaveAttribute('title', 'Alice')
})

test('Gate 6 collab demo syncs two browser pages through Hocuspocus provider', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-room`
  const clientAUrl = createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, undefined, started.historyHttpUrl)
  const clientBUrl = createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', undefined, undefined, started.historyHttpUrl)
  const syncedText = 'Gate 6 real browser Hocuspocus sync'

  await clientA.goto(clientAUrl)
  await clientB.goto(clientBUrl)
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', syncedText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(syncedText)
  await expect.poll(() => readProviderMode(clientB)).toBe('hocuspocus')
  await expect.poll(() => readFirstClientText(clientA)).toBe(syncedText)
  await expect.poll(() => readSecondClientText(clientB)).toBe(syncedText)

  await context.close()
})

test('Gate 6 collab demo accepts two browser pages as separate users in the same room and document', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-third-party-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const documentId = `${roomId}-document`
  const clientAName = 'Gate 6 User A'
  const clientBName = 'Gate 6 User B'
  const clientAUrl = createThirdPartyHocuspocusDemoUrl(started.webSocketUrl, roomId, {
    clientId: 'client-a',
    documentId,
    serverUrl: started.historyHttpUrl,
    userId: 'gate6-user-a',
    userName: clientAName,
    userColor: '#375bd2'
  }, started.historyHttpUrl)
  const clientBUrl = createThirdPartyHocuspocusDemoUrl(started.webSocketUrl, roomId, {
    clientId: 'client-b',
    documentId,
    serverUrl: started.historyHttpUrl,
    userId: 'gate6-user-b',
    userName: clientBName,
    userColor: '#087c66'
  }, started.historyHttpUrl)
  const syncedText = 'Gate 6 same document two browser users'

  await clientA.goto(clientAUrl)
  await clientB.goto(clientBUrl)
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientA.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-room-id', roomId)
  await expect(clientB.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-room-id', roomId)
  await expect(clientA.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-document-id', documentId)
  await expect(clientB.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-document-id', documentId)
  await expect(clientA.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-user-id', 'gate6-user-a')
  await expect(clientB.locator('[data-jword-collab-demo]')).toHaveAttribute('data-jword-collab-user-id', 'gate6-user-b')
  await expect(clientA.locator('[data-jword-collab-editor]')).toBeVisible()
  await expect(clientB.locator('[data-jword-collab-editor]')).toBeVisible()

  await writeClientText(clientA, 'client-a', syncedText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(syncedText)
  await updateClientSelection(clientA, 'client-a', 0, 6)
  await expect.poll(() => readProviderMode(clientA)).toBe('hocuspocus')
  await expect.poll(() => readProviderMode(clientB)).toBe('hocuspocus')
  await expect(clientB.locator('[data-jword-remote-cursor="gate6-user-a"]')).toContainText(clientAName)
  await expect.poll(() => readAwarenessClientIds(clientB)).toContain('gate6-user-a')

  await context.close()
})

test('Gate 6 collab demo connects to Hocuspocus with a required token', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-auth-success-browser',
    requiredToken: 'valid-token'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const roomId = `${started.roomPrefix}-room`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, 'valid-token', started.historyHttpUrl))

  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).not.toContain('COLLAB_PROVIDER_AUTH_FAILED')

  await context.close()
})

test('Gate 6 collab demo reports Hocuspocus auth failed diagnostics in the browser', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-auth-browser',
    requiredToken: 'valid-token'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const roomId = `${started.roomPrefix}-room`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, 'invalid-token', started.historyHttpUrl))

  await expect.poll(() => readOfflineLastEvent(clientA), {
    timeout: 10000
  }).toBe('provider-error')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('COLLAB_PROVIDER_AUTH_FAILED')
  await expect.poll(() => readOfflineDiagnosticRecoverable(clientA, 'COLLAB_PROVIDER_AUTH_FAILED')).toBe(false)
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('provider-error')

  await context.close()
})

test('Gate 6 collab demo reports Hocuspocus update rejected diagnostics in the browser', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-update-rejected-browser',
    rejectUpdates: true
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const roomId = `${started.roomPrefix}-room`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', 'Gate 6 rejected browser update')

  await expect.poll(() => readOfflineLastEvent(clientA), {
    timeout: 10000
  }).toBe('provider-error')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('COLLAB_UPDATE_REJECTED')
  await expect.poll(() => readOfflineDiagnosticRecoverable(clientA, 'COLLAB_UPDATE_REJECTED')).toBe(true)
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('provider-error')
  await expect.poll(() => readFirstClientText(clientA)).toBe('Gate 6 rejected browser update')

  await context.close()
})

test('Gate 6 collab demo renders Hocuspocus awareness across browser pages', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-awareness-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-room`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', undefined, undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', 'awareness range text')
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe('awareness range text')
  await updateClientSelection(clientA, 'client-a', 2, 8)

  await expect.poll(() => readAwarenessClientIds(clientB)).toContain('client-a')
  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toContainText('Client A 正在输入')
  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toHaveAttribute('title', 'Client A 正在输入')
  await expect(clientB.locator('[data-jword-remote-selection="client-a"]')).toContainText('2-8')
  await expect.poll(() => readAwarenessRangeAnchorGraphemeIndex(clientB, 'client-a')).toBe(2)
  await expect.poll(() => readAwarenessRangeFocusGraphemeIndex(clientB, 'client-a')).toBe(8)
  await expect.poll(() => readAwarenessRangeAnchorRelativeTname(clientB, 'client-a')).toBe('body')
  await expect.poll(() => readAwarenessViewportPageIndex(clientB, 'client-a')).toBe(0)
  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)')

  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toContainText('Client A cursor 8', {
    timeout: 3000
  })

  await context.close()
})

test('Gate 6 collab demo renders stable Hocuspocus presence for five browser pages', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-five-presence-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientIds = ['client-a', 'client-b', 'client-c', 'client-d', 'client-e'] as const
  const pages: Page[] = []
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const sharedSelectionOffset = 1

  for (const clientId of clientIds) {
    const page = await context.newPage()

    pages.push(page)
    await page.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, clientId, undefined, undefined, started.historyHttpUrl))
    await expect(page.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })
  }

  for (const [index, page] of pages.entries()) {
    await updateClientSelection(page, clientIds[index] ?? 'client-a', sharedSelectionOffset, sharedSelectionOffset)
  }

  const firstPage = pages[0]
  const thirdPage = pages[2]

  if (firstPage === undefined || thirdPage === undefined) {
    throw new Error('Gate 6 five-page presence test did not create enough pages')
  }

  await expect.poll(() => readAwarenessClientIds(firstPage)).toEqual([
    'client-a',
    'client-b',
    'client-c',
    'client-d',
    'client-e'
  ])
  for (const clientId of clientIds) {
    await expect(firstPage.locator(`[data-jword-remote-cursor="${clientId}"]`)).toBeVisible()
  }
  await expect.poll(() => readRemoteCursorTransforms(firstPage, clientIds)).toEqual([
    'matrix(1, 0, 0, 1, 0, 0)',
    'matrix(1, 0, 0, 1, 6, 0)',
    'matrix(1, 0, 0, 1, 12, 0)',
    'matrix(1, 0, 0, 1, 18, 0)',
    'matrix(1, 0, 0, 1, 24, 0)'
  ])
  await firstPage.evaluate(() => {
    window.scrollTo(0, document.body.scrollHeight)
  })
  await firstPage.evaluate(() => {
    window.scrollTo(0, 0)
  })
  await expect.poll(() => readRemoteCursorTransforms(firstPage, clientIds)).toEqual([
    'matrix(1, 0, 0, 1, 0, 0)',
    'matrix(1, 0, 0, 1, 6, 0)',
    'matrix(1, 0, 0, 1, 12, 0)',
    'matrix(1, 0, 0, 1, 18, 0)',
    'matrix(1, 0, 0, 1, 24, 0)'
  ])

  await thirdPage.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readAwarenessClientIds(firstPage), {
    timeout: 10000
  }).toEqual(['client-a', 'client-b', 'client-d', 'client-e'])

  await context.close()
})

test('Gate 6 collab demo removes Hocuspocus awareness after a browser page disconnects', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-awareness-disconnect'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-room`
  const text = 'awareness disconnect text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', undefined, undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', text)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(text)
  await updateClientSelection(clientA, 'client-a', 0, 9)

  await expect.poll(() => readAwarenessClientIds(clientB)).toContain('client-a')
  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toContainText('Client A')
  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())

  await expect.poll(() => readAwarenessClientIds(clientB), {
    timeout: 10000
  }).not.toContain('client-a')
  await expect(clientB.locator('[data-jword-remote-cursor="client-a"]')).toHaveCount(0)
  await expect.poll(() => readClientText(clientB, 'client-b')).toBe(text)

  await context.close()
})

test('Gate 6 collab demo restores Hocuspocus history versions across browser pages', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-history-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const firstText = 'Gate 6 provider history v1'
  const secondText = 'Gate 6 provider history v2'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', undefined, undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', undefined, undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', firstText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(firstText)
  const firstVersionId = await findHistoryVersionIdByText(clientA, firstText)

  await writeClientText(clientA, 'client-a', secondText, firstText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(secondText)
  await expect.poll(() => readHistoryTexts(clientA)).toContain(secondText)

  await clientA.locator('#jword-collab-history-select').selectOption(firstVersionId)
  await clientA.locator('#jword-collab-history-preview').click()
  await expect(clientA.locator('#jword-collab-history-preview-text')).toContainText(firstText)

  await clientA.locator('#jword-collab-history-restore').click()
  await expect.poll(() => readClientText(clientA, 'client-a'), {
    timeout: 10000
  }).toBe(firstText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(firstText)
  await expect.poll(() => readHistoryLabels(clientA)).toContain('restore:Client A edit')

  await context.close()
})

test('Gate 6 collab demo blocks Hocuspocus history restore with pending offline edits', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-history-conflict-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const firstText = 'Gate 6 provider history conflict v1'
  const syncedText = 'Gate 6 provider history conflict synced'
  const pendingText = 'Gate 6 provider history conflict pending local'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', 'indexeddb', undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', firstText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(firstText)
  const firstVersionId = await findHistoryVersionIdByText(clientA, firstText)

  await writeClientText(clientA, 'client-a', syncedText, firstText)
  await expect.poll(() => readClientText(clientA, 'client-a'), {
    timeout: 10000
  }).toBe(syncedText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(syncedText)
  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
  await expect.poll(() => readClientText(clientA, 'client-a'), {
    timeout: 10000
  }).toBe(syncedText)
  await writeClientText(clientA, 'client-a', pendingText, syncedText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)

  await clientA.locator('#jword-collab-history-select').selectOption(firstVersionId)
  await clientA.locator('#jword-collab-history-restore').click()

  await expect.poll(() => readClientText(clientA, 'client-a')).toBe(pendingText)
  await expect.poll(() => readClientText(clientB, 'client-b')).toBe(syncedText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('restore-conflict-local-pending')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('COLLAB_RESTORE_CONFLICT_RESOLVED')
  expect(await readHistoryLabels(clientA)).not.toContain('restore:Client A edit')

  await context.close()
})

test('Gate 6 collab demo restores Hocuspocus document from IndexedDB after reload', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-indexeddb-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const writer = await context.newPage()
  const restored = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const restoredText = 'Gate 6 IndexedDB reload text'

  await writer.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await expect(writer.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await writeClientText(writer, 'client-a', restoredText)
  await expect.poll(() => readOfflineLastEvent(writer)).toBe('indexeddb-synced')
  await expect.poll(() => readOfflineUpdateByteLength(writer)).toBeGreaterThan(0)
  await writer.close()
  await hocuspocusService.stop()
  hocuspocusService = null

  await restored.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await expect.poll(() => readFirstClientText(restored), {
    timeout: 10000
  }).toBe(restoredText)
  await expect.poll(() => readOfflineLastEvent(restored)).toBe('indexeddb-synced')

  await context.close()
})

test('Gate 6 collab demo keeps Hocuspocus usable when IndexedDB is unavailable', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-indexeddb-unavailable-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  await context.addInitScript(() => {
    Object.defineProperty(window, 'indexedDB', {
      configurable: true,
      value: undefined
    })
  })
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const onlineText = 'Gate 6 IndexedDB unavailable online text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', 'indexeddb', undefined, started.historyHttpUrl))
  await expect.poll(() => readOfflineConnected(clientA)).toBe(true)
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_CACHE_UNAVAILABLE')
  await expect.poll(() => readOfflineDiagnosticRecoverable(clientA, 'OFFLINE_CACHE_UNAVAILABLE')).toBe(true)

  await writeClientText(clientA, 'client-a', onlineText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(onlineText)
  await expect(clientA.locator('[data-jword-collab-status]')).not.toContainText('disconnected')

  await context.close()
})

test('Gate 6 collab demo keeps IndexedDB offline edits pending until Hocuspocus reconnects', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-offline-reconnect-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'Gate 6 reconnect initial text'
  const offlineText = 'Gate 6 reconnect offline pending text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', 'indexeddb', undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(initialText)

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
  await writeClientText(clientA, 'client-a', offlineText, initialText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_LOCAL_UPDATE_QUEUED')
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 1000
  }).not.toBe(offlineText)

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_STARTED')
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(offlineText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(0)
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-reconnect-synced')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_SYNCED')

  await context.close()
})

test('Gate 6 collab demo merges remote server updates with offline local edits on reconnect', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-offline-merge-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const initialText = 'Gate 6 merge initial text'
  const offlineText = 'Gate 6 merge offline local text'
  const remoteText = 'Gate 6 merge remote server text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-b', 'indexeddb', undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', initialText)
  await expect.poll(() => readClientText(clientB, 'client-b'), {
    timeout: 10000
  }).toBe(initialText)

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
  await writeClientText(clientA, 'client-a', offlineText, initialText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)
  await writeClientText(clientB, 'client-b', remoteText, initialText)
  await expect.poll(() => readClientText(clientA, 'client-a')).toBe(offlineText)
  await expect.poll(() => readClientText(clientB, 'client-b')).toBe(remoteText)

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())
  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_STARTED')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA), {
    timeout: 10000
  }).toContain('OFFLINE_RECONNECT_CONFLICT_MERGED')
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(0)
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-reconnect-synced')
  await expect.poll(async () => readFirstClientText(clientA), {
    timeout: 10000
  }).toBe(await readSecondClientText(clientB))
  await expect.poll(async () => readFirstClientText(clientA)).toContain(offlineText)
  await expect.poll(async () => readSecondClientText(clientB)).toContain(remoteText)

  await context.close()
})

test('Gate 6 collab demo preserves pending offline edits when Hocuspocus reconnect fails', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-reconnect-failed-browser'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const syncedText = 'Gate 6 reconnect failure synced text'
  const pendingText = 'Gate 6 reconnect failure pending local text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, roomId, 'client-a', 'indexeddb', undefined, started.historyHttpUrl))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await writeClientText(clientA, 'client-a', syncedText)
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('indexeddb-synced')

  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
  await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
  await writeClientText(clientA, 'client-a', pendingText, syncedText)
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)

  await hocuspocusService.stop()
  hocuspocusService = null
  await clientA.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())

  await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_STARTED')
  await expect.poll(() => readOfflineDiagnosticCodes(clientA), {
    timeout: 10000
  }).toContain('OFFLINE_RECONNECT_FAILED')
  await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(1)
  await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-reconnect-failed')
  await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
  await expect(clientA.locator('[data-jword-collab-status]')).not.toContainText('synced')
  await expect.poll(() => readClientText(clientA, 'client-a')).toBe(pendingText)

  await context.close()
})
