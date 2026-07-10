/**
 * @fileoverview 职责：用真实浏览器锁定 Gate 6 provider 并发编辑最小回归。
 * 边界：只覆盖 Hocuspocus provider 下 AI 自动插入与手动输入同场同步，不扩展断网、历史或生产持久化矩阵。
 * 协作：examples/collab/src/runtime/hocuspocus-runtime.ts、Hocuspocus 本地服务和 Playwright chromium 项目。
 * 约束：测试启动独立 Vite 服务；新增场景拆出 smoke 大文件，保持单文件职责清晰。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { ChildProcess } from 'node:child_process'
import type { Page } from '@playwright/test'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { createCollabHocuspocusServiceForTest, type CollabHocuspocusService } from './collab-hocuspocus-service'

const collabDemoUrl = 'http://127.0.0.1:4192'
const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))
const providerAutoInsertTokens = ['协同', '版本', '离线', '回放']

test.describe.configure({ mode: 'serial' })
test.setTimeout(120000)

let serverProcess: ChildProcess | null = null
let hocuspocusService: CollabHocuspocusService | null = null
const preparedClientTextBaselines = new WeakMap<Page, Map<string, string>>()

test.beforeAll(async () => {
  test.setTimeout(120000)
  serverProcess = spawn(viteExecutablePath, [
    '--host',
    '127.0.0.1',
    '--port',
    '4192'
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

test('Gate 6 provider AI 自动插入与手动输入并发后保持双页一致', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-ai'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const manualText = 'Gate 6 provider manual text'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await clientA.evaluate(() => window.__jwordCollabDemo?.startAutoInsert())
  await expect.poll(() => readAutoInsertLastEvent(clientA)).toBe('started')
  await expect.poll(() => readAutoInsertInsertedCount(clientA)).toBeGreaterThan(0)
  await expect.poll(() => readFirstClientText(clientB)).toContain('协同')

  const clientBTextBeforeManualEdit = await readSecondClientText(clientB)

  await updateClientText(
    clientB,
    'client-b',
    `${clientBTextBeforeManualEdit ?? ''} ${manualText}`,
    clientBTextBeforeManualEdit ?? ''
  )
  await expect.poll(() => readAutoInsertInsertedCount(clientA), {
    timeout: 10000
  }).toBeGreaterThanOrEqual(providerAutoInsertTokens.length)

  const finalText = await readFirstClientText(clientA)

  expect(finalText).not.toBeNull()
  expect(finalText).toContain(manualText)
  for (const token of providerAutoInsertTokens) {
    expect(countTextOccurrences(finalText, token)).toBe(1)
  }
  await expect.poll(() => readFirstClientText(clientA)).toContain(manualText)
  await expect.poll(() => readSecondClientText(clientB)).toContain(manualText)
  await expect.poll(() => readFirstClientText(clientA)).toContain('协同')
  await expect.poll(() => readSecondClientText(clientB)).toContain('协同')

  await context.close()
})

test('Gate 6 provider 双用户同段不同位置输入后不互相覆盖', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-positions'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'provider base'
  const mergedText = 'A-provider base-B'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  await Promise.all([
    beginClientTextEdit(clientA, 'client-a'),
    beginClientTextEdit(clientB, 'client-b')
  ])
  await Promise.all([
    commitPreparedClientText(clientA, 'client-a', `A-${baseText}`),
    commitPreparedClientText(clientB, 'client-b', `${baseText}-B`)
  ])

  await expectClientText(clientA, 'client-a', mergedText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', mergedText, {
    timeout: 10000
  })
  await expect.poll(() => readFirstClientText(clientA)).toBe(mergedText)
  await expect.poll(() => readSecondClientText(clientB)).toBe(mergedText)

  await context.close()
})

test('Gate 6 provider 双用户同段同位置输入后不丢失不重复', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-same-position'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'provider base'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  await Promise.all([
    beginClientTextEdit(clientA, 'client-a'),
    beginClientTextEdit(clientB, 'client-b')
  ])
  await Promise.all([
    commitPreparedClientText(clientA, 'client-a', `A-${baseText}`),
    commitPreparedClientText(clientB, 'client-b', `B-${baseText}`)
  ])

  await expect.poll(() => readFirstClientText(clientA)).toContain(baseText)
  const finalText = await readFirstClientText(clientA)

  if (finalText === null) {
    throw new Error('Gate 6 same-position concurrency did not produce client text.')
  }

  expect(finalText).toMatch(/^([AB]-){2}provider base$/)
  expect(finalText.match(/A-/g)?.length ?? 0).toBe(1)
  expect(finalText.match(/B-/g)?.length ?? 0).toBe(1)
  expect(finalText.match(/provider base/g)?.length ?? 0).toBe(1)
  await expect.poll(() => readSecondClientText(clientB)).toBe(finalText)
  await expectClientText(clientA, 'client-a', finalText)
  await expectClientText(clientB, 'client-b', finalText)

  await context.close()
})

test('Gate 6 provider 旧基线同位置提交不重复远端后缀', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-stale-baseline'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'provider base'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  await beginClientTextEdit(clientA, 'client-a')
  await commitPreparedClientText(clientA, 'client-a', `A-${baseText}`)
  await expectClientText(clientB, 'client-b', `A-${baseText}`, {
    timeout: 10000
  })
  await commitUnpreparedClientText(clientB, 'client-b', `B-${baseText}`, baseText)

  await expect.poll(() => readFirstClientText(clientA)).toContain(baseText)
  const finalText = await readFirstClientText(clientA)

  if (finalText === null) {
    throw new Error('Gate 6 stale-baseline concurrency did not produce client text.')
  }

  expect(finalText).toMatch(/^([AB]-){2}provider base$/)
  expect(finalText.match(/A-/g)?.length ?? 0).toBe(1)
  expect(finalText.match(/B-/g)?.length ?? 0).toBe(1)
  expect(finalText.match(/provider base/g)?.length ?? 0).toBe(1)
  await expect.poll(() => readSecondClientText(clientB)).toBe(finalText)
  await expectClientText(clientA, 'client-a', finalText)
  await expectClientText(clientB, 'client-b', finalText)

  await context.close()
})

test('Gate 6 provider 本地 undo 不撤销远端输入', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-undo'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'provider base'
  const remoteText = `${baseText} remote`
  const localText = `${baseText} remote local`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })
  await writeClientText(clientB, 'client-b', remoteText)
  await expectClientText(clientA, 'client-a', remoteText, {
    timeout: 10000
  })
  await writeClientText(clientA, 'client-a', localText)
  await expectClientText(clientB, 'client-b', localText, {
    timeout: 10000
  })

  const undoText = await undoLocalUserEdit(clientA)

  expect(undoText).toBe(remoteText)
  await expectClientText(clientA, 'client-a', remoteText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', remoteText, {
    timeout: 10000
  })
  await expect.poll(() => readFirstClientText(clientA)).toBe(remoteText)
  await expect.poll(() => readSecondClientText(clientB)).toBe(remoteText)

  await context.close()
})

test('Gate 6 provider 旧基线删除不吞掉远端插入', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-delete-insert'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'AB'
  const remoteInsertedText = 'A-remote-B'
  const mergedText = '-remote-'

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  await Promise.all([
    beginClientTextEdit(clientA, 'client-a'),
    beginClientTextEdit(clientB, 'client-b')
  ])
  await commitPreparedClientText(clientB, 'client-b', remoteInsertedText)
  await expectClientText(clientA, 'client-a', remoteInsertedText, {
    timeout: 10000
  })
  await commitPreparedClientText(clientA, 'client-a', '')

  await expectClientText(clientA, 'client-a', mergedText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', mergedText, {
    timeout: 10000
  })
  await expect.poll(() => readFirstClientText(clientA)).toBe(mergedText)
  await expect.poll(() => readSecondClientText(clientB)).toBe(mergedText)

  await context.close()
})

test('Gate 6 provider 删除远端格式化范围后不残留格式冲突', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-format-delete'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'keep target tail'
  const mergedText = 'keep  tail'
  const targetStart = baseText.indexOf('target')
  const targetEnd = targetStart + 'target'.length

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  await Promise.all([
    beginClientTextEdit(clientA, 'client-a'),
    formatClientRange(clientB, 'client-b', targetStart, targetEnd)
  ])
  await expect.poll(() => readBoldRangeTexts(clientA)).toContain('target')
  await commitPreparedClientText(clientA, 'client-a', mergedText)

  await expectClientText(clientA, 'client-a', mergedText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', mergedText, {
    timeout: 10000
  })
  await expect.poll(() => readFirstClientText(clientA)).toBe(mergedText)
  await expect.poll(() => readSecondClientText(clientB)).toBe(mergedText)
  await expect.poll(() => readBoldRangeTexts(clientA)).toEqual([])
  await expect.poll(() => readBoldRangeTexts(clientB)).toEqual([])

  await context.close()
})

test('Gate 6 provider 批注 anchor 在远端前方编辑后仍定位原文本', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-comment-anchor'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'prefix target tail'
  const insertedText = 'remote '
  const mergedText = `${insertedText}${baseText}`
  const targetStart = baseText.indexOf('target')
  const targetEnd = targetStart + 'target'.length

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })

  const threadId = await addCommentRange(clientA, 'client-a', targetStart, targetEnd, 'Gate 6 anchor')

  expect(threadId).toMatch(/^comment-thread-/)
  await expect.poll(() => readCommentRangeText(clientB, threadId)).toBe('target')

  await writeClientText(clientB, 'client-b', mergedText)

  await expectClientText(clientA, 'client-a', mergedText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', mergedText, {
    timeout: 10000
  })
  await expect.poll(() => readCommentRangeText(clientA, threadId)).toBe('target')
  await expect.poll(() => readCommentRangeText(clientB, threadId)).toBe('target')

  await context.close()
})

test('Gate 6 provider 远端替换同段文本后 selection snapshot 仍可解释', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-selection-replace'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'prefix target tail'
  const insertedText = 'remote '
  const mergedText = `${insertedText}${baseText}`
  const targetStart = baseText.indexOf('target')
  const targetEnd = targetStart + 'target'.length

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await writeClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })
  await setClientSelection(clientA, 'client-a', targetStart, targetEnd)
  await expect.poll(() => readAwarenessSelection(clientB, 'client-a')).toMatchObject({
    selectionStart: targetStart,
    selectionEnd: targetEnd
  })

  await writeClientText(clientB, 'client-b', mergedText)

  await expectClientText(clientA, 'client-a', mergedText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', mergedText, {
    timeout: 10000
  })
  await expect.poll(() => readAwarenessSelection(clientB, 'client-a')).toMatchObject({
    selectionStart: targetStart + insertedText.length,
    selectionEnd: targetEnd + insertedText.length,
    selectionText: 'target'
  })

  await context.close()
})

test('Gate 6 provider 旧基线本地输入不重复远端后缀', async ({ browser }) => {
  hocuspocusService = await createCollabHocuspocusServiceForTest({
    port: 0,
    address: '127.0.0.1',
    roomPrefix: 'jword-collab-concurrency-undo-stale-baseline'
  })
  const started = await hocuspocusService.start()
  const context = await browser.newContext()
  const clientA = await context.newPage()
  const clientB = await context.newPage()
  const roomId = `${started.roomPrefix}-${Date.now()}`
  const baseText = 'provider base'
  const remoteText = `${baseText} remote`
  const localText = `${baseText} remote local`

  await clientA.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-a'))
  await clientB.goto(createHocuspocusDemoUrl(started.webSocketUrl, started.historyHttpUrl, roomId, 'client-b'))
  await expect(clientA.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })
  await expect(clientB.locator('[data-jword-collab-status]')).toContainText('synced', {
    timeout: 10000
  })

  await commitUnpreparedClientText(clientA, 'client-a', baseText)
  await expectClientText(clientB, 'client-b', baseText, {
    timeout: 10000
  })
  await commitUnpreparedClientText(clientB, 'client-b', remoteText)
  await expectClientText(clientA, 'client-a', remoteText, {
    timeout: 10000
  })
  await commitUnpreparedClientText(clientA, 'client-a', localText)

  await expectClientText(clientA, 'client-a', localText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', localText, {
    timeout: 10000
  })

  const undoText = await undoLocalUserEdit(clientA)

  expect(undoText).toBe(remoteText)
  await expectClientText(clientA, 'client-a', remoteText, {
    timeout: 10000
  })
  await expectClientText(clientB, 'client-b', remoteText, {
    timeout: 10000
  })

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

/** 通过 debug API 写入 client 正文，保持进入 demo runtime。 */
async function writeClientText(page: Page, clientId: string, value: string): Promise<void> {
  await beginClientTextEdit(page, clientId)
  await commitPreparedClientText(page, clientId, value)
}

/** 捕获本地编辑前的 client 正文基线。 */
async function beginClientTextEdit(page: Page, clientId: string): Promise<void> {
  rememberPreparedClientTextBaseline(page, clientId, await readClientText(page, clientId) ?? '')
}

/** 提交已经捕获基线的 client 正文变更。 */
async function commitPreparedClientText(page: Page, clientId: string, value: string): Promise<void> {
  const previousText = takePreparedClientTextBaseline(page, clientId) ?? await readClientText(page, clientId) ?? ''

  await updateClientText(page, clientId, value, previousText)
}

/** 不触发 beforeinput，模拟 Kimi fill 这类只提交 input/change 的真实路径。 */
async function commitUnpreparedClientText(
  page: Page,
  clientId: string,
  value: string,
  previousText?: string
): Promise<void> {
  await updateClientText(page, clientId, value, previousText)
}

/** 设置指定 client 的本地 selection 并触发 demo awareness 更新。 */
async function setClientSelection(
  page: Page,
  clientId: string,
  start: number,
  end: number
): Promise<void> {
  await updateClientSelection(page, clientId, start, end)
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

/** 统计字符串片段出现次数。 */
function countTextOccurrences(text: string | null, needle: string): number {
  if (text === null || needle.length === 0) {
    return 0
  }

  return text.split(needle).length - 1
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

/** 去除 editor 投影为单段文档补出的首尾换行。 */
function normalizeCollabText(text: string | null): string | null {
  return text?.replace(/^\n|\n$/gu, '') ?? null
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

/** 记住一次准备提交前的 client 正文基线。 */
function rememberPreparedClientTextBaseline(page: Page, clientId: string, text: string): void {
  const pageBaselines = preparedClientTextBaselines.get(page) ?? new Map<string, string>()

  pageBaselines.set(clientId, text)
  preparedClientTextBaselines.set(page, pageBaselines)
}

/** 取出一次准备提交前的 client 正文基线。 */
function takePreparedClientTextBaseline(page: Page, clientId: string): string | null {
  const pageBaselines = preparedClientTextBaselines.get(page)

  if (pageBaselines === undefined) {
    return null
  }

  const baseline = pageBaselines.get(clientId) ?? null

  pageBaselines.delete(clientId)
  if (pageBaselines.size === 0) {
    preparedClientTextBaselines.delete(page)
  }

  return baseline
}

/** 读取 auto insert 最近事件。 */
async function readAutoInsertLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.lastEvent ?? null
  })
}

/** 读取 auto insert 已插入 token 数。 */
async function readAutoInsertInsertedCount(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.insertedCount ?? null
  })
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

/** 通过 demo debug API 更新指定 provider client 的选区。 */
async function updateClientSelection(
  page: Page,
  clientId: string,
  selectionStart: number,
  selectionEnd: number
): Promise<void> {
  await page.evaluate((input) => {
    const debugWindow = window as unknown as CollabDebugWindow

    debugWindow.__jwordCollabDemo?.updateClientSelection(input.clientId, input.selectionStart, input.selectionEnd)
  }, {
    clientId,
    selectionStart,
    selectionEnd
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

/** 通过 demo debug API 对指定 client 的正文范围加粗。 */
async function formatClientRange(
  page: Page,
  clientId: string,
  start: number,
  end: number
): Promise<void> {
  await page.evaluate((input) => {
    const debugWindow = window as unknown as CollabDebugWindow

    debugWindow.__jwordCollabDemo?.formatClientRange(input.clientId, input.start, input.end)
  }, {
    clientId,
    start,
    end
  })
}

/** 读取当前 projection 中 bold run 的文本。 */
async function readBoldRangeTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readTextFormatRanges()
      .filter((range) => range.bold)
      .map((range) => range.text) ?? []
  })
}

/** 读取指定远端 client 的 selection 快照。 */
async function readAwarenessSelection(
  page: Page,
  clientId: string
): Promise<AwarenessSelectionSnapshot | null> {
  return page.evaluate((targetClientId) => {
    const debugWindow = window as unknown as CollabDebugWindow
    const user = debugWindow.__jwordCollabDemo?.readAwarenessState().users
      .find((candidate) => candidate.clientId === targetClientId)

    if (user === undefined) {
      return null
    }

    return {
      selectionStart: user.selectionStart,
      selectionEnd: user.selectionEnd,
      selectionText: user.selectionText ?? null
    }
  }, clientId)
}

/** 通过 demo debug API 创建批注范围。 */
async function addCommentRange(
  page: Page,
  clientId: string,
  start: number,
  end: number,
  text: string
): Promise<string | null> {
  return page.evaluate((input) => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.addCommentRange(
      input.clientId,
      input.start,
      input.end,
      input.text
    ).threadId ?? null
  }, {
    clientId,
    start,
    end,
    text
  })
}

/** 读取指定批注当前锚定的正文文本。 */
async function readCommentRangeText(page: Page, threadId: string | null): Promise<string | null> {
  return page.evaluate((targetThreadId) => {
    if (targetThreadId === null) {
      return null
    }

    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCommentRanges()
      .find((range) => range.threadId === targetThreadId)?.text ?? null
  }, threadId)
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: CollabDebugApi
}

interface CollabDebugApi {
  readonly readCollabState: () => CollabStateSnapshot
  readonly readAwarenessState: () => AwarenessStateSnapshot
  readonly startAutoInsert: () => void
  readonly undoLocalUserEdit: () => CollabStateSnapshot
  readonly updateClientText: (clientId: string, text: string, previousText?: string) => CollabStateSnapshot
  readonly updateClientSelection: (clientId: string, selectionStart: number, selectionEnd: number) => AwarenessStateSnapshot
  readonly formatClientRange: (clientId: string, start: number, end: number) => CollabStateSnapshot
  readonly readTextFormatRanges: () => readonly TextFormatRangeSnapshot[]
  readonly addCommentRange: (
    clientId: string,
    start: number,
    end: number,
    text: string
  ) => CommentRangeCreateSnapshot
  readonly readCommentRanges: () => readonly CommentRangeSnapshot[]
}

interface CollabStateSnapshot {
  readonly clients: readonly {
    readonly text: string
  }[]
  readonly autoInsert: {
    readonly insertedCount: number
    readonly lastEvent: string
  }
}

interface ClientTextExpectationOptions {
  readonly timeout?: number
}

interface TextFormatRangeSnapshot {
  readonly text: string
  readonly bold: boolean
}

interface AwarenessStateSnapshot {
  readonly users: readonly AwarenessSelectionSnapshot[]
}

interface AwarenessSelectionSnapshot {
  readonly clientId?: string
  readonly selectionStart: number
  readonly selectionEnd: number
  readonly selectionText?: string | null
}

interface CommentRangeCreateSnapshot {
  readonly threadId: string | null
}

interface CommentRangeSnapshot {
  readonly threadId: string
  readonly text: string
}
