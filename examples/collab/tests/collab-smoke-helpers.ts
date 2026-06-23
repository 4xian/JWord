/**
 * @fileoverview 职责：集中提供 Gate 6 collab smoke E2E 的 URL 构造和 debug API 读取 helper。
 * 边界：不声明测试断言、不启动浏览器上下文、不管理 Hocuspocus 服务生命周期。
 * 协作：collab-smoke.e2e.ts、examples/collab/src/runtime.ts 和浏览器 debug window。
 * 约束：helper 只读取公开 debug API，避免测试主体超过文件体量上限。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 collaboration/auto-insert。
 */

import type { Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

export const collabDemoUrl = 'http://127.0.0.1:4186'
export const collabDemoDirectory = fileURLToPath(new URL('..', import.meta.url))
export const viteExecutablePath = fileURLToPath(new URL('../node_modules/.bin/vite', import.meta.url))

/** 等待 collab demo Vite 服务可访问。 */
export async function waitForCollabDemoServer(): Promise<void> {
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

/** 读取浏览器里暴露的 debug API 名称。 */
export async function readCollabDebugApiNames(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return Object.keys(debugWindow.__jwordCollabDemo ?? {}).sort()
  })
}

/** 读取离线状态中的连接标记。 */
export async function readOfflineConnected(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().connected ?? null
  })
}

/** 读取 auto insert 是否运行。 */
export async function readAutoInsertRunning(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.running ?? null
  })
}

/** 读取 auto insert 最近事件。 */
export async function readAutoInsertLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.lastEvent ?? null
  })
}

/** 读取 auto insert 诊断 code 列表。 */
export async function readAutoInsertDiagnosticCodes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().autoInsert.diagnostics.map((diagnostic) =>
      diagnostic.code
    ) ?? []
  })
}

/** 读取版本历史标签列表。 */
export async function readHistoryLabels(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readVersionHistory().map((entry) => entry.label) ?? []
  })
}

/** 按历史文本查找版本 ID。 */
export async function findHistoryVersionIdByText(page: Page, text: string): Promise<string> {
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
export async function readHistoryTexts(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readVersionHistory().map((entry) => entry.text) ?? []
  })
}

/** 构造真实 Hocuspocus provider demo URL。 */
export function createHocuspocusDemoUrl(
  webSocketUrl: string,
  roomId: string,
  clientId: string,
  offlineMode?: string,
  token?: string,
  historyHttpUrl?: string
): string {
  const url = new URL(collabDemoUrl)

  url.searchParams.set('provider', 'hocuspocus')
  url.searchParams.set('ws', webSocketUrl)
  url.searchParams.set('room', roomId)
  url.searchParams.set('client', clientId)
  if (offlineMode !== undefined) {
    url.searchParams.set('offline', offlineMode)
  }
  if (token !== undefined) {
    url.searchParams.set('token', token)
  }
  if (historyHttpUrl !== undefined) {
    url.searchParams.set('history', historyHttpUrl)
  }

  return url.href
}

export interface ThirdPartyHocuspocusDemoInput {
  readonly clientId: string
  readonly documentId: string
  readonly serverUrl: string
  readonly userId: string
  readonly userName: string
  readonly userColor: string
}

/** 构造带第三方集成参数的真实 Hocuspocus provider demo URL。 */
export function createThirdPartyHocuspocusDemoUrl(
  webSocketUrl: string,
  roomId: string,
  input: ThirdPartyHocuspocusDemoInput
): string {
  const url = new URL(createHocuspocusDemoUrl(webSocketUrl, roomId, input.clientId))

  url.searchParams.set('serverUrl', input.serverUrl)
  url.searchParams.set('documentId', input.documentId)
  url.searchParams.set('userId', input.userId)
  url.searchParams.set('userName', input.userName)
  url.searchParams.set('userColor', input.userColor)

  return url.href
}

/** 读取 demo 当前 provider 模式。 */
export async function readProviderMode(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().providerMode ?? null
  })
}

/** 读取第一个 client 文本。 */
export async function readFirstClientText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().clients[0]?.text ?? null
  })
}

/** 读取第二个 client 文本。 */
export async function readSecondClientText(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readCollabState().clients[1]?.text ?? null
  })
}

/** 读取离线状态最近事件。 */
export async function readOfflineLastEvent(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().lastEvent ?? null
  })
}

/** 读取离线恢复的 update 字节数。 */
export async function readOfflineUpdateByteLength(page: Page): Promise<number> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().updateByteLength ?? 0
  })
}

/** 读取离线状态中的待同步操作数。 */
export async function readOfflineQueuedOperations(page: Page): Promise<number> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().queuedOperations ?? 0
  })
}

/** 读取离线状态中的诊断 code 列表。 */
export async function readOfflineDiagnosticCodes(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readOfflineState().diagnostics?.map((diagnostic) => diagnostic.code) ?? []
  })
}

/** 读取指定离线诊断的可恢复标记。 */
export async function readOfflineDiagnosticRecoverable(page: Page, code: string): Promise<boolean | null> {
  return page.evaluate((diagnosticCode) => {
    const debugWindow = window as unknown as CollabDebugWindow
    const diagnostic = debugWindow.__jwordCollabDemo?.readOfflineState().diagnostics
      ?.find((candidate) => candidate.code === diagnosticCode)

    return diagnostic?.recoverable ?? null
  }, code)
}

/** 读取 awareness debug API 中的 client id 列表。 */
export async function readAwarenessClientIds(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readAwarenessState().users.map((user) => user.clientId) ?? []
  })
}

/** 读取 awareness range snapshot 的 anchor grapheme index。 */
export async function readAwarenessRangeAnchorGraphemeIndex(page: Page, clientId: string): Promise<number | null> {
  const user = await readAwarenessUser(page, clientId)

  return user?.rangeSnapshot?.anchor.graphemeIndex ?? null
}

/** 读取 awareness range snapshot 的 focus grapheme index。 */
export async function readAwarenessRangeFocusGraphemeIndex(page: Page, clientId: string): Promise<number | null> {
  const user = await readAwarenessUser(page, clientId)

  return user?.rangeSnapshot?.focus.graphemeIndex ?? null
}

/** 读取 awareness range snapshot 的 anchor relative position 文本名。 */
export async function readAwarenessRangeAnchorRelativeTname(page: Page, clientId: string): Promise<string | null> {
  const user = await readAwarenessUser(page, clientId)

  return user?.rangeSnapshot?.anchor.relativePosition.tname ?? null
}

/** 读取 awareness viewport 页码。 */
export async function readAwarenessViewportPageIndex(page: Page, clientId: string): Promise<number | null> {
  const user = await readAwarenessUser(page, clientId)

  return user?.viewport?.pageIndex ?? null
}

/** 读取远端 cursor 的实际 CSS transform，用于锁定重叠错位和滚动后稳定性。 */
export async function readRemoteCursorTransforms(
  page: Page,
  clientIds: readonly string[]
): Promise<readonly string[]> {
  return page.evaluate((ids) => ids.map((id) => {
    const element = document.querySelector<HTMLElement>(`[data-jword-remote-cursor="${id}"]`)

    return element === null ? '' : window.getComputedStyle(element).transform
  }), clientIds)
}

/** 读取指定 client 的 awareness debug snapshot。 */
async function readAwarenessUser(page: Page, clientId: string): Promise<AwarenessUserSnapshot | undefined> {
  return page.evaluate((id) => {
    const debugWindow = window as unknown as CollabDebugWindow

    return debugWindow.__jwordCollabDemo?.readAwarenessState().users.find((user) => user.clientId === id)
  }, clientId)
}

interface CollabDebugWindow {
  readonly __jwordCollabDemo?: CollabDebugApi
}

interface CollabDebugApi {
  readonly readCollabState: () => CollabStateSnapshot
  readonly readAwarenessState: () => AwarenessStateSnapshot
  readonly readOfflineState: () => OfflineStateSnapshot
  readonly readVersionHistory: () => readonly VersionHistoryEntry[]
  readonly startAutoInsert: () => void
  readonly abortAutoInsert: () => void
  readonly retryAutoInsert: () => void
  readonly simulateDisconnect: () => void
  readonly simulateReconnect: () => void
}

interface AwarenessStateSnapshot {
  readonly users: readonly AwarenessUserSnapshot[]
}

interface AwarenessUserSnapshot {
  readonly clientId: string
  readonly rangeSnapshot?: AwarenessRangeSnapshot
  readonly viewport?: AwarenessViewportSnapshot
}

interface AwarenessRangeSnapshot {
  readonly anchor: AwarenessTextAnchorSnapshot
  readonly focus: AwarenessTextAnchorSnapshot
}

interface AwarenessTextAnchorSnapshot {
  readonly graphemeIndex: number
  readonly relativePosition: { readonly tname?: string }
}

interface AwarenessViewportSnapshot { readonly pageIndex: number }

interface CollabStateSnapshot {
  readonly providerMode?: string
  readonly clients: readonly {
    readonly text: string
  }[]
  readonly autoInsert: {
    readonly running: boolean
    readonly lastEvent: string
    readonly diagnostics: readonly {
      readonly code: string
    }[]
  }
}

interface OfflineStateSnapshot {
  readonly connected: boolean
  readonly queuedOperations: number
  readonly lastEvent: string
  readonly updateByteLength?: number
  readonly diagnostics?: readonly {
    readonly code: string
    readonly recoverable: boolean
  }[]
}

interface VersionHistoryEntry {
  readonly id: string
  readonly label: string
  readonly text: string
}
