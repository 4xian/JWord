/**
 * @vitest-environment node
 *
 * 职责：用真实 Hocuspocus 双 client 压测 Gate 6 旧基线输入 rebase 路径。
 * 边界：只覆盖 demo Hocuspocus text command、格式 helper 与 Y.Doc 收敛，不接浏览器 DOM 或 IndexedDB。
 * 协作：examples/collab/server/hocuspocus-service.ts、hocuspocus-text-command.ts 和 core shared editor。
 * 约束：随机序列固定 seed，至少 200 轮，失败时保留场景、轮次、文本和格式快照。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  createEditorSharedDocument,
  createEditorWithSharedDocument,
  readEditorSharedDocument,
  refreshEditorSharedDocument
} from '@4xian/jword-core'
import { createHocuspocusCollabProviderAdapter } from '@4xian/jword-collab/experimental'
import type {
  Editor,
  EditorSharedDocument
} from '@4xian/jword-core'
import type { JWordCollabProviderAdapter } from '@4xian/jword-collab'

import { createCollabHocuspocusService } from '../server/hocuspocus-service'
import type { CollabHocuspocusService } from '../server/hocuspocus-service'
import { applyHocuspocusBoldRange, readHocuspocusTextFormatRanges } from '../src/runtime/hocuspocus-format'
import { readProjectionText, readFirstTextPosition } from '../src/runtime/hocuspocus-projection'
import { buildHocuspocusTextCommand } from '../src/runtime/hocuspocus-text-command'
import {
  isEditorManagedTransactionOrigin,
  readExternalTransactionOrigin,
  readExternalTransactionSource
} from '../src/runtime/hocuspocus-transaction-origin'
import type { TextFormatRangeSnapshot } from '../src/runtime'

const stressRoundCount = 210
const stressBatchSize = 10
const stressSeed = 0x6a17_2021
const providerSyncTimeoutMs = 5000
const convergenceTimeoutMs = 5000

type StressScenario =
  | 'same-position-insert'
  | 'delete-over-remote-insert'
  | 'format-overlapping-edit'

interface StressClient {
  readonly id: string
  readonly roomId: string
  readonly sharedDocument: EditorSharedDocument
  readonly document: Y.Doc
  readonly editor: Editor
  readonly adapter: JWordCollabProviderAdapter
  readonly unsubscribeDocument: () => void
}

interface StressClientBase {
  readonly id: string
  readonly sharedDocument: EditorSharedDocument
  readonly document: Y.Doc
  readonly adapter: JWordCollabProviderAdapter
  readonly serverUrl: string
  readonly roomId: string
}

interface StressRoundResult {
  readonly round: number
  readonly scenario: StressScenario
  readonly ok: boolean
  readonly leftText: string
  readonly rightText: string
  readonly leftFormats: readonly FormatSnapshot[]
  readonly rightFormats: readonly FormatSnapshot[]
  readonly issue?: string
}

interface StressSummary {
  readonly seed: number
  readonly rounds: number
  readonly consistentRounds: number
  readonly consistencyRate: number
  readonly scenarioCounts: Record<StressScenario, number>
  readonly failures: readonly StressRoundResult[]
}

interface FormatSnapshot {
  readonly text: string
  readonly start: number
  readonly end: number
  readonly bold: boolean
}

let service: CollabHocuspocusService | null = null

describe('collab input rebase stress', () => {
  afterEach(async () => {
    await service?.stop()
    service = null
  })

  it('通过真实 Hocuspocus 双端压测旧基线 rebase 三类冲突', async () => {
    service = createCollabHocuspocusService({
      port: 0,
      address: '127.0.0.1',
      roomPrefix: 'jword-collab-input-rebase-stress'
    })
    const started = await service.start()
    const scenarios = createStressScenarios(stressRoundCount, stressSeed)
    const results: StressRoundResult[] = []

    for (let batchStart = 0; batchStart < scenarios.length; batchStart += stressBatchSize) {
      const roomId = `${started.roomPrefix}-${Date.now()}-${batchStart}`
      const { left, right } = await createStressClientPair(started.webSocketUrl, started.historyHttpUrl, roomId)

      try {
        for (
          let index = batchStart;
          index < Math.min(batchStart + stressBatchSize, scenarios.length);
          index += 1
        ) {
          results.push(await runStressRound(left, right, index + 1, scenarios[index] ?? 'same-position-insert'))
        }
      } finally {
        await Promise.all([
          destroyStressClient(left),
          destroyStressClient(right)
        ])
      }
    }

    const summary = summarizeResults(results)

    console.info(`JWORD_COLLAB_REBASE_STRESS_SUMMARY ${JSON.stringify(summary)}`)
    expect(summary.failures).toEqual([])
    expect(summary.consistencyRate).toBe(1)
    expect(summary.scenarioCounts['same-position-insert']).toBeGreaterThanOrEqual(1)
    expect(summary.scenarioCounts['delete-over-remote-insert']).toBeGreaterThanOrEqual(1)
    expect(summary.scenarioCounts['format-overlapping-edit']).toBeGreaterThanOrEqual(1)
  }, 300000)
})

/** 为一个压测批次创建隔离 room 的左右 client。 */
async function createStressClientPair(
  webSocketUrl: string,
  serverUrl: string,
  roomId: string
): Promise<{
  readonly left: StressClient
  readonly right: StressClient
}> {
  const leftBase = createStressClientBase('client-a', webSocketUrl, serverUrl, roomId)
  const left = await initializeStressClientEditor(leftBase, 'seed')
  const rightBase = createStressClientBase('client-b', webSocketUrl, serverUrl, roomId)

  Y.applyUpdate(rightBase.document, Y.encodeStateAsUpdate(left.document), 'remote-user')
  const right = await initializeStressClientEditor(rightBase)

  await Promise.all([
    waitForAdapterSynced(left.adapter),
    waitForAdapterSynced(right.adapter)
  ])

  return { left, right }
}

/** 创建绑定真实 Hocuspocus provider 的 shared document client 壳。 */
function createStressClientBase(
  webClientId: string,
  webSocketUrl: string,
  serverUrl: string,
  roomId: string
): StressClientBase {
  const sharedDocument = createEditorSharedDocument()
  const document = readEditorSharedDocument(sharedDocument)
  const adapter = createHocuspocusCollabProviderAdapter({
    document,
    documentId: 'doc-input-rebase-stress',
    roomId,
    clientId: webClientId,
    webSocketUrl
  })

  return {
    id: webClientId,
    sharedDocument,
    document,
    adapter,
    serverUrl,
    roomId
  }
}

/** 创建 editor；provider 连接由批次装配统一完成。 */
async function initializeStressClientEditor(client: StressClientBase, initialText?: string): Promise<StressClient> {
  const editor = createEditorWithSharedDocument(client.sharedDocument, {
    ...(initialText === undefined ? {} : { initialText })
  })
  const unsubscribeDocument = subscribeExternalDocumentRefresh(client.sharedDocument, client.document)

  return {
    ...client,
    editor,
    unsubscribeDocument
  }
}

/** 将 provider 远端事务刷新回已存在的 Editor projection。 */
function subscribeExternalDocumentRefresh(sharedDocument: EditorSharedDocument, document: Y.Doc): () => void {
  const listener = (transaction: Y.Transaction) => {
    if (transaction.local && isEditorManagedTransactionOrigin(transaction.origin)) {
      return
    }

    const origin = readExternalTransactionOrigin(transaction)

    refreshEditorSharedDocument(sharedDocument, {
      origin,
      source: readExternalTransactionSource(transaction, origin)
    })
  }

  document.on('afterTransaction', listener)

  return () => {
    document.off('afterTransaction', listener)
  }
}

/** 销毁压测 client 的 provider、editor 和 Y.Doc。 */
async function destroyStressClient(client: StressClient): Promise<void> {
  client.unsubscribeDocument()
  client.editor.destroy()
  await client.adapter.destroy()
  client.document.destroy()
}

/** 跑单轮压测并返回可写入报告的结果。 */
async function runStressRound(
  left: StressClient,
  right: StressClient,
  round: number,
  scenario: StressScenario
): Promise<StressRoundResult> {
  const baseText = scenario === 'delete-over-remote-insert' ? 'AB' : createBaseText(round)

  await resetClients(left, right, baseText)

  if (scenario === 'same-position-insert') {
    return runSamePositionInsertRound(left, right, round, baseText)
  }
  if (scenario === 'delete-over-remote-insert') {
    return runDeleteOverRemoteInsertRound(left, right, round, baseText)
  }

  return runFormatOverlappingEditRound(left, right, round)
}

/** 同位置同时输入：两端用同一旧 baseline 在首位插入不同 token。 */
async function runSamePositionInsertRound(
  left: StressClient,
  right: StressClient,
  round: number,
  baseText: string
): Promise<StressRoundResult> {
  const leftToken = `L${round}-`
  const rightToken = `R${round}-`

  await Promise.all([
    executeTextCommand(left, `${leftToken}${baseText}`, baseText),
    executeTextCommand(right, `${rightToken}${baseText}`, baseText)
  ])
  exchangeClientUpdates(left, right)

  await waitForConvergence(left, right)

  return evaluateRound(left, right, round, 'same-position-insert', (text, formats) => {
    if (!text.endsWith(baseText)) {
      return `final text does not keep base suffix: ${text}`
    }
    if (countOccurrences(text, leftToken) !== 1 || countOccurrences(text, rightToken) !== 1) {
      return `insert token count mismatch: ${text}`
    }
    if (readBoldFormats(formats).length > 0) {
      return `unexpected bold format after same-position insert: ${JSON.stringify(formats)}`
    }

    return null
  })
}

/** 删除/插入冲突：一端删除旧 baseline，另一端先在被删区域中间插入远端正文。 */
async function runDeleteOverRemoteInsertRound(
  left: StressClient,
  right: StressClient,
  round: number,
  baseText: string
): Promise<StressRoundResult> {
  const remoteText = `A-remote-${round}-B`
  const expectedText = `-remote-${round}-`

  await executeTextCommand(right, remoteText, baseText)
  applyClientUpdate(right, left)
  await waitForText(left, remoteText)
  await executeTextCommand(left, '', baseText)
  applyClientUpdate(left, right)
  await waitForConvergence(left, right)

  return evaluateRound(left, right, round, 'delete-over-remote-insert', (text, formats) => {
    if (text !== expectedText) {
      return `remote insert was not preserved after stale delete: ${text}`
    }
    if (readBoldFormats(formats).length > 0) {
      return `unexpected bold format after stale delete: ${JSON.stringify(formats)}`
    }

    return null
  })
}

/** 格式/文本重叠冲突：一端加粗 target，另一端用旧 baseline 删除 target。 */
async function runFormatOverlappingEditRound(
  left: StressClient,
  right: StressClient,
  round: number
): Promise<StressRoundResult> {
  const baseText = `keep target-${round} tail`
  const targetText = `target-${round}`
  const targetStart = baseText.indexOf(targetText)
  const targetEnd = targetStart + targetText.length
  const expectedText = 'keep  tail'

  await resetClients(left, right, baseText)
  expect(applyHocuspocusBoldRange(right.editor, targetStart, targetEnd)).toBe(true)
  applyClientUpdate(right, left)
  await waitForBoldText(left, targetText)
  await executeTextCommand(left, expectedText, baseText)
  applyClientUpdate(left, right)
  await waitForConvergence(left, right)

  return evaluateRound(left, right, round, 'format-overlapping-edit', (text, formats) => {
    if (text !== expectedText) {
      return `formatted target text was not deleted: ${text}`
    }
    if (readBoldFormats(formats).length > 0) {
      return `bold range remained after overlapping delete: ${JSON.stringify(formats)}`
    }

    return null
  })
}

/** 重置双端正文，确保下一轮从无格式 baseline 开始。 */
async function resetClients(left: StressClient, right: StressClient, baseText: string): Promise<void> {
  await executeTextCommand(left, baseText, readClientText(left))
  await waitForText(left, baseText)
  applyClientUpdate(left, right)
  await waitForText(right, baseText)
  await executeTextCommand(right, baseText, readClientText(right))
  applyClientUpdate(right, left)
  await waitForConvergence(left, right)
}

/** 在指定 client 上执行旧 baseline text command。 */
async function executeTextCommand(client: StressClient, nextText: string, previousText: string): Promise<void> {
  const projection = client.editor.getProjection()
  const currentText = readProjectionText(projection)
  const command = buildHocuspocusTextCommand({
    projection,
    currentText,
    previousText,
    nextText,
    readPosition: readFirstTextPosition
  })

  client.editor.executeCommand(command, {
    origin: 'local-user',
    roomId: client.roomId,
    clientId: client.id,
    authorId: client.id
  })
}

/** 将一个 client 的当前 Y.Doc update 应用到另一个 client，模拟 D7 远端更新路径。 */
function applyClientUpdate(source: StressClient, target: StressClient): void {
  Y.applyUpdate(target.document, Y.encodeStateAsUpdate(source.document), 'remote-user')
}

/** 双向交换两个 client 的当前 Y.Doc update。 */
function exchangeClientUpdates(left: StressClient, right: StressClient): void {
  const leftUpdate = Y.encodeStateAsUpdate(left.document)
  const rightUpdate = Y.encodeStateAsUpdate(right.document)

  Y.applyUpdate(right.document, leftUpdate, 'remote-user')
  Y.applyUpdate(left.document, rightUpdate, 'remote-user')
}

/** 读取 client 当前 projection 文本。 */
function readClientText(client: StressClient): string {
  return readProjectionText(client.editor.getProjection())
}

/** 读取 client 当前格式快照并裁剪为稳定 JSON。 */
function readClientFormats(client: StressClient): readonly FormatSnapshot[] {
  return readHocuspocusTextFormatRanges(client.editor.getProjection()).map(normalizeFormatSnapshot)
}

/** 归一化格式范围，避免测试结果暴露多余字段。 */
function normalizeFormatSnapshot(snapshot: TextFormatRangeSnapshot): FormatSnapshot {
  return {
    text: snapshot.text,
    start: snapshot.start,
    end: snapshot.end,
    bold: snapshot.bold
  }
}

/** 评估单轮压测的双端文本、格式和场景语义是否一致。 */
function evaluateRound(
  left: StressClient,
  right: StressClient,
  round: number,
  scenario: StressScenario,
  validate: (text: string, formats: readonly FormatSnapshot[]) => string | null
): StressRoundResult {
  const leftText = readClientText(left)
  const rightText = readClientText(right)
  const leftFormats = readClientFormats(left)
  const rightFormats = readClientFormats(right)
  const issue = leftText !== rightText
    ? `text mismatch: left=${leftText}; right=${rightText}`
    : JSON.stringify(leftFormats) !== JSON.stringify(rightFormats)
      ? `format mismatch: left=${JSON.stringify(leftFormats)}; right=${JSON.stringify(rightFormats)}`
      : validate(leftText, leftFormats)

  return {
    round,
    scenario,
    ok: issue === null,
    leftText,
    rightText,
    leftFormats,
    rightFormats,
    ...(issue === null ? {} : { issue })
  }
}

/** 汇总压测结果，输出给文档回写使用。 */
function summarizeResults(results: readonly StressRoundResult[]): StressSummary {
  const scenarioCounts: Record<StressScenario, number> = {
    'same-position-insert': 0,
    'delete-over-remote-insert': 0,
    'format-overlapping-edit': 0
  }
  const failures = results.filter((result) => !result.ok)

  for (const result of results) {
    scenarioCounts[result.scenario] += 1
  }

  return {
    seed: stressSeed,
    rounds: results.length,
    consistentRounds: results.length - failures.length,
    consistencyRate: (results.length - failures.length) / results.length,
    scenarioCounts,
    failures
  }
}

/** 创建固定 seed 的压测场景序列。 */
function createStressScenarios(count: number, seed: number): readonly StressScenario[] {
  const scenarios: StressScenario[] = []
  const random = createDeterministicRandom(seed)
  const scenarioKinds: readonly StressScenario[] = [
    'same-position-insert',
    'delete-over-remote-insert',
    'format-overlapping-edit'
  ]

  for (let index = 0; index < count; index += 1) {
    scenarios.push(scenarioKinds[Math.floor(random() * scenarioKinds.length)] ?? 'same-position-insert')
  }

  return scenarios
}

/** 创建可复现的线性同余随机数生成器。 */
function createDeterministicRandom(seed: number): () => number {
  let value = seed >>> 0

  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0

    return value / 0x1_0000_0000
  }
}

/** 构造删除/插入场景可复用的短 baseline。 */
function createBaseText(round: number): string {
  return round % 2 === 0 ? 'AB' : `base-${round}`
}

/** 等待 Hocuspocus adapter 完成 provider 同步。 */
async function waitForAdapterSynced(adapter: JWordCollabProviderAdapter): Promise<void> {
  if (adapter.status === 'synced') {
    return
  }

  let connectError: unknown
  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      unsubscribe()
      reject(new Error(`provider did not sync, current status: ${adapter.status}`))
    }, providerSyncTimeoutMs)
    const unsubscribe = adapter.onSynced(() => {
      clearTimeout(timeoutId)
      unsubscribe()
      resolve()
    })
    if (adapter.status === 'idle') {
      void adapter.connect().catch((error: unknown) => {
        connectError = error
      })
    }
  })

  if (connectError !== undefined) {
    throw connectError
  }
}

/** 等待指定 client 文本收敛到目标值。 */
async function waitForText(client: StressClient, expected: string): Promise<void> {
  await waitUntil(() => readClientText(client) === expected, () =>
    `client ${client.id} text did not converge to ${expected}; actual=${readClientText(client)}`
  )
}

/** 等待两端文本与格式完全一致。 */
async function waitForConvergence(left: StressClient, right: StressClient): Promise<void> {
  await waitUntil(() =>
    readClientText(left) === readClientText(right) &&
    JSON.stringify(readClientFormats(left)) === JSON.stringify(readClientFormats(right)),
  () => `clients did not converge: left=${readClientText(left)} right=${readClientText(right)}`)
}

/** 等待指定 client 出现目标加粗文本。 */
async function waitForBoldText(client: StressClient, text: string): Promise<void> {
  await waitUntil(() => readBoldFormats(readClientFormats(client)).some((format) => format.text === text), () =>
    `client ${client.id} did not receive bold text ${text}: ${JSON.stringify(readClientFormats(client))}`
  )
}

/** 轮询直到断言条件满足。 */
async function waitUntil(predicate: () => boolean, createMessage: () => string): Promise<void> {
  const deadline = Date.now() + convergenceTimeoutMs

  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
  }

  throw new Error(createMessage())
}

/** 读取 bold=true 的格式片段。 */
function readBoldFormats(formats: readonly FormatSnapshot[]): readonly FormatSnapshot[] {
  return formats.filter((format) => format.bold)
}

/** 统计字符串片段出现次数。 */
function countOccurrences(text: string, needle: string): number {
  if (needle.length === 0) {
    return 0
  }

  return text.split(needle).length - 1
}
