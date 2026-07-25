/**
 * @fileoverview 职责：用真实浏览器暴露 Gate 6 DOCX 导入文档进入 Hocuspocus history/auto insert 的验收缺口。
 * 边界：只新增 Playwright 红灯测试，不修改 collab runtime、DOCX runtime 或 provider 实现。
 * 协作：examples/collab/src/main.ts、Hocuspocus 本地服务和后续 DOCX 导入桥接 API。
 * 约束：当前 collab demo 若没有 DOCX 导入 UI/API，本测试必须以明确错误失败，避免伪造普通文本导入。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

const collabDemoUrl = 'http://127.0.0.1:4191'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const requiredDocxBridgeName = 'importDocxForCollabAcceptance'
const docxFixturePath = 'fixtures/docx/inputs/docx-t1-paragraphs.docx'
const importedDocxText = 'First paragraph text.\nSecond paragraph text.'

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
    '4191'
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

test('Gate 6 DOCX 导入文档应能进入真实 Hocuspocus history 与 auto insert 验收路径', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-docx-provider-history'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`

  try {
    await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
    await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
    await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })
    await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })

    const debugApiNames = await readCollabDebugApiNames(clientA)

    expect(
      debugApiNames,
      'collab demo must expose a DOCX import bridge before imported DOCX documents can be verified as ordinary provider documents'
    ).toContain(requiredDocxBridgeName)

    const importResult = await importDocxForCollabAcceptance(clientA, docxFixturePath)

    expect(importResult.warnings).toEqual([])
    expect(importResult.text).toBe(importedDocxText)
    await expectClientText(clientB, 'client-b', importedDocxText, {
      timeout: 10000
    })
    await expect.poll(() => readHistoryTexts(clientB)).toContain(importedDocxText)

    await clientB.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
    await expect.poll(() => readFirstClientText(clientA), {
      timeout: 10000
    }).toContain('协同版本离线回放')
    await expect.poll(() => readSecondClientText(clientB), {
      timeout: 10000
    }).toContain('协同版本离线回放')

    const importedVersionId = await findHistoryVersionIdByText(clientB, importedDocxText)

    await clientB.locator('#jword-collab-history-select').selectOption(importedVersionId)
    await clientB.locator('#jword-collab-history-preview').click()
    await expect(clientB.locator('#jword-collab-history-preview-text')).toContainText(importedDocxText)

    await clientB.locator('#jword-collab-history-restore').click()
    await expectClientText(clientA, 'client-a', importedDocxText, {
      timeout: 10000
    })
    await expectClientText(clientB, 'client-b', importedDocxText, {
      timeout: 10000
    })
  } finally {
    await context.close()
  }
})

test('Gate 6 DOCX 导入文档应能通过 IndexedDB reload 恢复', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-docx-indexeddb-reload'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const writer = await context.newPage()
  const restored = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`

  try {
    await writer.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a', 'indexeddb'))
    await expect(writer.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })

    const importResult = await importDocxForCollabAcceptance(writer, docxFixturePath)

    expect(importResult.text).toBe(importedDocxText)
    await expect.poll(() => readOfflineLastEvent(writer)).toBe('indexeddb-synced')
    await expect.poll(() => readOfflineUpdateByteLength(writer)).toBeGreaterThan(0)
    await writer.close()
    await hocuspocusService.stop()
    hocuspocusService = null

    await restored.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a', 'indexeddb'))
    await expect.poll(() => readFirstClientText(restored), {
      timeout: 10000
    }).toBe(importedDocxText)
    await expect.poll(() => readOfflineLastEvent(restored)).toBe('indexeddb-synced')
  } finally {
    await context.close()
  }
})

test('Gate 6 DOCX 导入文档应能断网 pending 并在重连后同步', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-docx-offline-reconnect'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const offlineDocxText = `${importedDocxText}\nDOCX offline pending text`

  try {
    await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a', 'indexeddb'))
    await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b', 'indexeddb'))
    await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })
    await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
      timeout: 10000
    })

    const importResult = await importDocxForCollabAcceptance(clientA, docxFixturePath)

    expect(importResult.text).toBe(importedDocxText)
    await expectClientText(clientB, 'client-b', importedDocxText, {
      timeout: 10000
    })

    await clientA.evaluate(() => window.__jwordCollabDemo?.simulateDisconnect())
    await expect.poll(() => readOfflineConnected(clientA)).toBe(false)
    await updateClientText(clientA, 'client-a', offlineDocxText, importedDocxText)
    await expect.poll(() => readOfflineQueuedOperations(clientA)).toBeGreaterThan(0)
    await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_LOCAL_UPDATE_QUEUED')
    await expectClientTextNot(clientB, 'client-b', offlineDocxText, {
      timeout: 1000
    })

    await clientA.evaluate(() => window.__jwordCollabDemo?.simulateReconnect())
    await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_STARTED')
    await expectClientText(clientB, 'client-b', offlineDocxText, {
      timeout: 10000
    })
    await expect.poll(() => readOfflineQueuedOperations(clientA)).toBe(0)
    await expect.poll(() => readOfflineLastEvent(clientA)).toBe('offline-reconnect-synced')
    await expect.poll(() => readOfflineDiagnosticCodes(clientA)).toContain('OFFLINE_RECONNECT_SYNCED')
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

/** 构造真实 Hocuspocus provider demo URL。 */
function createHocuspocusDemoUrl(
  webSocketUrl: string,
  historyHttpUrl: string,
  roomId: string,
  clientId: string,
  offlineMode?: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('history', historyHttpUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)
  if (offlineMode !== undefined) {
    url.searchParams.set('offline', offlineMode)
  }

  return url.href
}

/** 读取 collab demo 暴露给真实验收的 debug API 名称。 */
async function readCollabDebugApiNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return Object.keys(debugWindow.__jwordCollabDemo ?? {}).sort()
  })
}

/** 通过 debug API 把 DOCX fixture 导入真实 provider 文档。 */
async function importDocxForCollabAcceptance(
  page: Page,
  fixturePath: string
): Promise<DocxImportAcceptanceSnapshot> {
  const bytes = [...readFileSync(fixturePath)]

  return page.evaluate(async (input) => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo!.importDocxForCollabAcceptance(input.bytes, input.fileName)
  }, {
    bytes,
    fileName: fixturePath.split('/').at(-1) ?? 'fixture.docx'
  })
}

/** 按历史文本查找版本 ID。 */
async function findHistoryVersionIdByText(page: Page, text: string): Promise<string> {
  const deadline = Date.now() + 5000

  while (Date.now() < deadline) {
    const versionId = await page.evaluate((targetText) => {
      const debugWindow = window as unknown as CollabDebugWindow
      const entry = debugWindow.__jwordCollabDemo?.readVersionHistory()
        .find((candidate) => candidate.text.replace(/^\n|\n$/gu, '') === targetText)

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
  const texts = await page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readVersionHistory().map((entry) => entry.text) ?? []
  })

  return texts.map((text) => normalizeCollabText(text) ?? '')
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

/** 断言指定 client 正文最终不等于给定文本。 */
async function expectClientTextNot(
  page: Page,
  clientId: string,
  expectedText: string,
  options: ClientTextExpectationOptions = {}
): Promise<void> {
  await expect.poll(() => readClientText(page, clientId), options).not.toBe(expectedText)
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

/** 读取离线状态是否已连接。 */
async function readOfflineConnected(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().connected ?? null
  })
}

/** 读取离线状态最近事件。 */
async function readOfflineLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().lastEvent ?? null
  })
}

/** 读取离线恢复的 update 字节数。 */
async function readOfflineUpdateByteLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().updateByteLength ?? 0
  })
}

/** 读取离线状态中的待同步操作数。 */
async function readOfflineQueuedOperations(page: Page): Promise<number> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().queuedOperations ?? 0
  })
}

/** 读取离线状态中的诊断 code 列表。 */
async function readOfflineDiagnosticCodes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().diagnostics?.map((diagnostic) => diagnostic.code) ?? []
  })
}

interface DocxImportAcceptanceSnapshot {
  readonly text: string
  readonly warnings: readonly string[]
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: CollabDebugApi
}

interface CollabDebugApi {
  readonly readCollabState: () => {
    readonly clients: readonly {
      readonly text: string
    }[]
  }
  readonly readOfflineState: () => OfflineStateSnapshot
  readonly readVersionHistory: () => readonly {
    readonly id: string
    readonly text: string
  }[]
  readonly startAutoInsert: () => unknown
  readonly simulateDisconnect: () => void
  readonly simulateReconnect: () => void
  readonly updateClientText: (clientId: string, text: string, previousText?: string) => void
  readonly importDocxForCollabAcceptance: (
    bytes: readonly number[],
    fileName: string
  ) => Promise<DocxImportAcceptanceSnapshot>
}

interface ClientTextExpectationOptions {
  readonly timeout?: number
}

interface OfflineStateSnapshot {
  readonly connected: boolean
  readonly queuedOperations: number
  readonly lastEvent: string | null
  readonly updateByteLength?: number
  readonly diagnostics?: readonly {
    readonly code: string
  }[]
}
