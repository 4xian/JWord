/**
 * 职责：输出 Gate 6 协作 update、版本历史和 auto inserter 的确定性 benchmark 指标。
 * 边界：运行内存 provider、内存 persistence、公开 Editor facade 和真实 Chromium IndexedDB restore 探针。
 * 协作模块：packages/core、packages/collab、packages/persistence 和 tools/bench/run-bench.mjs。
 * 约束：Node 离线 adapter 不可用诊断和浏览器 IndexedDB restore 时间分开输出，不能用内存 adapter 冒充离线恢复。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-6--collaborationauto-insert。
 */
import { createServer } from 'node:http'
import { performance } from 'node:perf_hooks'

import { chromium } from '@playwright/test'
import {
  createEditor,
  createTextInserter
} from '../packages/core/dist/index.js'
import {
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  GATE6_COLLAB_FEATURES
} from '../packages/collab/dist/index.js'
import {
  createJWordLicenseSignature
} from '../packages/license/dist/index.js'
import {
  createJWordCollabServer
} from '../packages/collab-server/dist/index.js'
import {
  createMemoryPersistenceAdapter,
  createVolatileHistoryStorage,
  createUnavailableIndexedDbOfflineAdapter
} from '../packages/persistence/dist/index.js'

const fixtures = [
  {
    id: 'gate6-1k',
    group: '1k',
    charCount: 1000
  },
  {
    id: 'gate6-10k',
    group: '10k',
    charCount: 10000
  }
].map((fixture) => ({
  ...fixture,
  text: createBenchmarkText(fixture.charCount)
}))

const userCountMatrix = [
  { userCount: 2 },
  { userCount: 5 },
  { userCount: 20 }
]

await runBenchmark()

/** 运行 Gate 6 benchmark 并输出机器可读 JSON。 */
async function runBenchmark() {
  const results = []
  const indexedDbBenchmark = await createIndexedDbBenchmarkContext()

  try {
    for (const fixture of fixtures) {
      results.push(await runFixtureBenchmark(fixture, indexedDbBenchmark))
    }
  } finally {
    await indexedDbBenchmark.destroy()
  }

  validateBenchmarkResults(results)

  console.log(
    JSON.stringify(
      {
        status: 'ok',
        benchmark: 'gate6-collab',
        fixtures: results,
        totals: sumFixtureMetrics(results),
        note: '确定性 Gate 6 内存协作、版本历史和 auto inserter benchmark；真实 IndexedDB restore 时间来自 Playwright Chromium 的浏览器 IndexedDB 探针，Node 离线 adapter 不可用诊断单独保留。'
      },
      null,
      2
    )
  )
}

/** 运行单个文本规模的协作、persistence、离线诊断和 auto inserter benchmark。 */
async function runFixtureBenchmark(fixture, indexedDbBenchmark) {
  const collab = await runCollabApplyBenchmark(fixture)
  const matrix = await runUserCountMatrixBenchmark(fixture)
  const persistence = await runPersistenceBenchmark(fixture, collab.update)
  const offline = await runOfflineRestoreProbe(fixture, collab.update, indexedDbBenchmark)
  const offlineReconnect = await runOfflineReconnectBenchmark(fixture)
  const serverApi = await runServerApiBenchmark(fixture, collab.update)
  const autoInsert = runAutoInsertBenchmark(fixture)

  return {
    id: fixture.id,
    group: fixture.group,
    charCount: fixture.charCount,
    userCountMatrix: matrix,
    updateApplyDurationMs: collab.updateApplyDurationMs,
    providerDispatchDurationMs: collab.providerDispatchDurationMs,
    updateByteLength: collab.updateByteLength,
    remoteDirty: collab.remoteDirty,
    snapshotCreateDurationMs: persistence.snapshotCreateDurationMs,
    snapshotLoadDurationMs: persistence.snapshotLoadDurationMs,
    versionPreviewDurationMs: persistence.versionPreviewDurationMs,
    versionId: persistence.versionId,
    snapshotId: persistence.snapshotId,
    previewUpdateByteLength: persistence.previewUpdateByteLength,
    autoInsertDurationMs: autoInsert.autoInsertDurationMs,
    autoInsertInputProbeDurationMs: autoInsert.autoInsertInputProbeDurationMs,
    autoInsertUpdateByteLength: autoInsert.autoInsertUpdateByteLength,
    offlineRestoreStatus: offline.offlineRestoreStatus,
    indexedDbRestoreStatus: offline.indexedDbRestoreStatus,
    offlineRestoreProbeDurationMs: offline.offlineRestoreProbeDurationMs,
    indexedDbRestoreDurationMs: offline.indexedDbRestoreDurationMs,
    indexedDbRestoreByteLength: offline.indexedDbRestoreByteLength,
    offlineDiagnosticCodes: offline.offlineDiagnosticCodes,
    offlineReconnectStatus: offlineReconnect.offlineReconnectStatus,
    offlineReconnectDurationMs: offlineReconnect.offlineReconnectDurationMs,
    offlineReconnectQueuedUpdates: offlineReconnect.offlineReconnectQueuedUpdates,
    serverHistoryRecordDurationMs: serverApi.serverHistoryRecordDurationMs,
    serverHistoryListDurationMs: serverApi.serverHistoryListDurationMs,
    serverHistoryPreviewDurationMs: serverApi.serverHistoryPreviewDurationMs,
    serverHistoryStatus: serverApi.serverHistoryStatus,
    licenseHandshakeDurationMs: serverApi.licenseHandshakeDurationMs,
    licenseHandshakeStatus: serverApi.licenseHandshakeStatus,
    versionHandshakeDurationMs: serverApi.versionHandshakeDurationMs,
    versionHandshakeStatus: serverApi.versionHandshakeStatus,
    versionHandshakeProtocolVersion: serverApi.versionHandshakeProtocolVersion
  }
}

/** 通过内存 provider 将一个 client 的 update 派发到另一个 client 并计量 apply 时间。 */
async function runCollabApplyBenchmark(fixture) {
  const documentId = `${fixture.id}-document`
  const roomId = `${fixture.id}-room`
  const sourceEditor = createEditor({ initialText: fixture.text })
  const targetEditor = createEditor()
  const left = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId: `${fixture.id}-left`
  })
  const right = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId: `${fixture.id}-right`
  })
  let updateApplyDurationMs
  let remoteDirty = false
  const unsubscribe = right.onUpdate((update, metadata) => {
    const applyStart = performance.now()
    const result = targetEditor.applySyncUpdate(update, {
      origin: 'remote-user',
      requestId: `${fixture.id}-remote-apply`,
      roomId: metadata.roomId,
      clientId: metadata.clientId
    })

    updateApplyDurationMs = roundMetric(performance.now() - applyStart)
    remoteDirty = result.dirty
  })

  try {
    await left.connect()
    await right.connect()

    const update = sourceEditor.encodeSyncUpdate()
    const dispatchStart = performance.now()

    await left.sendUpdate(update, {
      documentId,
      roomId,
      clientId: `${fixture.id}-left`,
      updateId: `${fixture.id}-update-1`,
      origin: 'local'
    })

    const providerDispatchDurationMs = roundMetric(performance.now() - dispatchStart)

    if (updateApplyDurationMs === undefined) {
      throw new Error(`Gate 6 benchmark did not apply remote update for ${fixture.id}.`)
    }

    return {
      update,
      updateByteLength: update.byteLength,
      updateApplyDurationMs,
      providerDispatchDurationMs,
      remoteDirty
    }
  } finally {
    unsubscribe()
    await left.destroy()
    await right.destroy()
    sourceEditor.destroy()
    targetEditor.destroy()
  }
}

/** 按 2/5/20 用户矩阵计量同一 update 扇出到多个远端 editor 的耗时。 */
async function runUserCountMatrixBenchmark(fixture) {
  const metrics = []

  for (const item of userCountMatrix) {
    metrics.push(await runUserCountBenchmark(fixture, item.userCount))
  }

  return metrics
}

/** 计量指定用户数下的 provider 派发和远端 apply 总耗时。 */
async function runUserCountBenchmark(fixture, userCount) {
  const documentId = `${fixture.id}-matrix-${userCount}-document`
  const roomId = `${fixture.id}-matrix-${userCount}-room`
  const sourceClientId = `${fixture.id}-matrix-${userCount}-client-0`
  const sourceEditor = createEditor({ initialText: fixture.text })
  const sourceProvider = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId: sourceClientId
  })
  const remotes = Array.from({ length: userCount - 1 }, (_item, index) => ({
    editor: createEditor(),
    provider: createMemoryCollabProviderAdapter({
      documentId,
      roomId,
      clientId: `${fixture.id}-matrix-${userCount}-client-${index + 1}`
    })
  }))
  let remoteApplyCount = 0
  let userMatrixApplyDurationMs = 0
  const unsubscribers = remotes.map(({ editor, provider }, index) =>
    provider.onUpdate((update, metadata) => {
      const applyStart = performance.now()

      editor.applySyncUpdate(update, {
        origin: 'remote-user',
        requestId: `${fixture.id}-matrix-${userCount}-remote-${index + 1}`,
        roomId: metadata.roomId ?? roomId,
        clientId: metadata.clientId
      })
      userMatrixApplyDurationMs += performance.now() - applyStart
      remoteApplyCount += 1
    }))

  try {
    await sourceProvider.connect()
    await Promise.all(remotes.map(({ provider }) => provider.connect()))

    const update = sourceEditor.encodeSyncUpdate()
    const dispatchStart = performance.now()

    await sourceProvider.sendUpdate(update, {
      documentId,
      roomId,
      clientId: sourceClientId,
      updateId: `${fixture.id}-matrix-${userCount}-update`,
      origin: 'local'
    })

    if (remoteApplyCount !== userCount - 1) {
      throw new Error(`Gate 6 user matrix did not apply all remote updates for ${fixture.id}/${userCount}.`)
    }

    return {
      userCount,
      remoteApplyCount,
      userMatrixDispatchDurationMs: roundMetric(performance.now() - dispatchStart),
      userMatrixApplyDurationMs: roundMetric(userMatrixApplyDurationMs),
      updateByteLength: update.byteLength
    }
  } finally {
    for (const unsubscribe of unsubscribers) {
      unsubscribe()
    }
    await sourceProvider.destroy()
    await Promise.all(remotes.map(({ provider }) => provider.destroy()))
    sourceEditor.destroy()
    for (const remote of remotes) {
      remote.editor.destroy()
    }
  }
}

/** 用内存 persistence 计量 append 后的 snapshot create、load 和 version preview。 */
async function runPersistenceBenchmark(fixture, update) {
  const documentId = `${fixture.id}-document`
  const adapter = createMemoryPersistenceAdapter()
  const appendResult = await adapter.appendUpdate({
    documentId,
    roomId: `${fixture.id}-room`,
    clientId: `${fixture.id}-left`,
    update,
    label: `${fixture.id}-update`,
    authorId: 'gate6-benchmark',
    origin: 'local'
  })
  const snapshotCreateStart = performance.now()
  const snapshotResult = await adapter.createSnapshot({
    documentId,
    versionId: appendResult.version.versionId,
    snapshotId: `${fixture.id}-snapshot`,
    label: `${fixture.id}-snapshot`
  })
  const snapshotCreateDurationMs = roundMetric(performance.now() - snapshotCreateStart)
  const snapshotLoadStart = performance.now()
  const loaded = await adapter.loadVersion({
    documentId,
    versionId: snapshotResult.version.versionId
  })
  const snapshotLoadDurationMs = roundMetric(performance.now() - snapshotLoadStart)
  const versionPreviewStart = performance.now()
  const preview = await adapter.createPreview({
    documentId,
    versionId: snapshotResult.version.versionId
  })
  const versionPreviewDurationMs = roundMetric(performance.now() - versionPreviewStart)

  preview.doc.destroy()

  if (
    appendResult.diagnostics.length > 0 ||
    snapshotResult.diagnostics.length > 0 ||
    loaded.diagnostics.length > 0 ||
    preview.diagnostics.length > 0
  ) {
    throw new Error(`Gate 6 persistence benchmark produced diagnostics for ${fixture.id}.`)
  }

  return {
    snapshotCreateDurationMs,
    snapshotLoadDurationMs,
    versionPreviewDurationMs,
    versionId: snapshotResult.version.versionId,
    snapshotId: snapshotResult.snapshot.snapshotId,
    previewUpdateByteLength: preview.update.byteLength
  }
}

/** 计量离线期间积压 1 条 update 后重连同步到远端的耗时。 */
async function runOfflineReconnectBenchmark(fixture) {
  const documentId = `${fixture.id}-offline-reconnect-document`
  const roomId = `${fixture.id}-offline-reconnect-room`
  const sourceClientId = `${fixture.id}-offline-reconnect-source`
  const sourceEditor = createEditor({ initialText: fixture.text })
  const targetEditor = createEditor()
  const sourceProvider = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId: sourceClientId
  })
  const targetProvider = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId: `${fixture.id}-offline-reconnect-target`
  })
  let remoteApplyCount = 0
  const unsubscribe = targetProvider.onUpdate((update, metadata) => {
    targetEditor.applySyncUpdate(update, {
      origin: 'remote-user',
      requestId: `${fixture.id}-offline-reconnect-apply`,
      roomId: metadata.roomId ?? roomId,
      clientId: metadata.clientId
    })
    remoteApplyCount += 1
  })

  try {
    await sourceProvider.connect()
    await targetProvider.connect()
    await sourceProvider.disconnect()

    const queuedUpdate = sourceEditor.encodeSyncUpdate()
    const reconnectStart = performance.now()

    await sourceProvider.connect()
    await sourceProvider.sendUpdate(queuedUpdate, {
      documentId,
      roomId,
      clientId: sourceClientId,
      updateId: `${fixture.id}-offline-reconnect-update`,
      origin: 'replay'
    })

    if (remoteApplyCount !== 1) {
      throw new Error(`Gate 6 offline reconnect did not replay queued update for ${fixture.id}.`)
    }

    return {
      offlineReconnectStatus: sourceProvider.status === 'synced' && targetProvider.status === 'synced'
        ? 'synced'
        : 'error',
      offlineReconnectDurationMs: roundMetric(performance.now() - reconnectStart),
      offlineReconnectQueuedUpdates: 1
    }
  } finally {
    unsubscribe()
    await sourceProvider.destroy()
    await targetProvider.destroy()
    sourceEditor.destroy()
    targetEditor.destroy()
  }
}

/** 计量正式 collab server 的 history、license 和 client/server version handshake。 */
async function runServerApiBenchmark(fixture, update) {
  const server = createJWordCollabServer({
    port: 0,
    address: '127.0.0.1',
    featureFlags: Object.values(GATE6_COLLAB_FEATURES),
    historyStorage: createVolatileHistoryStorage(),
    licenseHook: () => ({ ok: true })
  })

  try {
    const state = await server.start()
    const documentId = `${fixture.id}-server-document`
    const roomId = `${fixture.id}-server-room`
    const clientId = `${fixture.id}-server-client`
    const license = createBenchmarkLicense()
    const recordStart = performance.now()
    const historyEntitlement = encodeURIComponent(JSON.stringify(license))
    const recorded = await fetchJson(`${state.httpUrl}/history/versions?documentId=${encodeURIComponent(documentId)}&entitlement=${historyEntitlement}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId,
        roomId,
        clientId,
        authorId: 'gate6-benchmark',
        origin: 'local',
        label: `${fixture.id}-server-history`,
        updateBase64: encodeBase64(update),
        entitlement: license
      })
    })
    const serverHistoryRecordDurationMs = roundMetric(performance.now() - recordStart)
    const versionId = readRequiredString(recorded.version?.versionId, 'server history versionId')
    const listStart = performance.now()
    const listed = await fetchJson(`${state.httpUrl}/history/versions?documentId=${encodeURIComponent(documentId)}`)
    const serverHistoryListDurationMs = roundMetric(performance.now() - listStart)
    const previewStart = performance.now()
    const preview = await fetchJson(`${state.httpUrl}/history/preview?documentId=${encodeURIComponent(documentId)}&versionId=${encodeURIComponent(versionId)}&entitlement=${historyEntitlement}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId,
        versionId,
        entitlement: license
      })
    })
    const serverHistoryPreviewDurationMs = roundMetric(performance.now() - previewStart)
    const licenseStart = performance.now()
    const licenseStatus = await fetchJson(`${state.httpUrl}/license/status`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        documentId,
        feature: GATE6_COLLAB_FEATURES.history,
        entitlement: license
      })
    })
    const licenseHandshakeDurationMs = roundMetric(performance.now() - licenseStart)
    const versionHandshake = await runVersionHandshakeBenchmark(fixture, state.httpUrl, license)

    assertServerHistoryResponses(fixture, listed, preview, versionId)

    return {
      serverHistoryRecordDurationMs,
      serverHistoryListDurationMs,
      serverHistoryPreviewDurationMs,
      serverHistoryStatus: 'ok',
      licenseHandshakeDurationMs,
      licenseHandshakeStatus: licenseStatus.ok === true ? 'ok' : 'error',
      versionHandshakeDurationMs: versionHandshake.versionHandshakeDurationMs,
      versionHandshakeStatus: versionHandshake.versionHandshakeStatus,
      versionHandshakeProtocolVersion: versionHandshake.versionHandshakeProtocolVersion
    }
  } finally {
    await server.stop()
  }
}

/** 通过公开 client SDK 连接正式 server version endpoint 并计量版本握手。 */
async function runVersionHandshakeBenchmark(fixture, serverUrl, license) {
  const documentId = `${fixture.id}-version-handshake-document`
  const roomId = `${fixture.id}-version-handshake-room`
  const clientId = `${fixture.id}-version-handshake-client`
  const editor = createEditor({ initialText: fixture.text })
  const provider = createMemoryCollabProviderAdapter({
    documentId,
    roomId,
    clientId
  })
  let connection

  try {
    const handshakeStart = performance.now()

    connection = await connectJWordCollaboration(editor, {
      serverUrl,
      documentId,
      roomId,
      user: {
        id: clientId,
        name: 'Benchmark User'
      },
      token: 'benchmark-token',
      license,
      features: [
        GATE6_COLLAB_FEATURES.multiplayer,
        GATE6_COLLAB_FEATURES.history
      ],
      provider
    })

    return {
      versionHandshakeDurationMs: roundMetric(performance.now() - handshakeStart),
      versionHandshakeStatus: connection.status,
      versionHandshakeProtocolVersion: connection.handshake?.protocolVersion ?? ''
    }
  } finally {
    if (connection === undefined) {
      await provider.destroy()
    } else {
      await connection.destroy()
    }
    editor.destroy()
  }
}

/** 运行 Node 降级诊断和真实浏览器 IndexedDB restore 探针。 */
async function runOfflineRestoreProbe(fixture, update, indexedDbBenchmark) {
  const documentId = `${fixture.id}-document`
  const offlineAdapter = createUnavailableIndexedDbOfflineAdapter()
  const storeResult = await offlineAdapter.storeUpdate({
    documentId,
    update
  })
  const restoreProbeStart = performance.now()
  const loadResult = await offlineAdapter.load(documentId)
  const offlineRestoreProbeDurationMs = roundMetric(performance.now() - restoreProbeStart)
  const offlineDiagnosticCodes = [
    ...storeResult.diagnostics,
    ...loadResult.diagnostics
  ].map((diagnostic) => diagnostic.code)
  const indexedDbRestore = await indexedDbBenchmark.measure(fixture.id, update)

  return {
    offlineRestoreStatus: 'indexeddb-restored',
    indexedDbRestoreStatus: 'restored',
    offlineRestoreProbeDurationMs,
    indexedDbRestoreDurationMs: indexedDbRestore.durationMs,
    indexedDbRestoreByteLength: indexedDbRestore.byteLength,
    offlineDiagnosticCodes
  }
}

/** 创建真实浏览器 IndexedDB benchmark 上下文。 */
async function createIndexedDbBenchmarkContext() {
  const server = await startIndexedDbBenchmarkServer()
  const browser = await chromium.launch()
  const context = await browser.newContext()
  const page = await context.newPage()

  await page.goto(server.url)

  return {
    async measure(fixtureId, update) {
      return page.evaluate(async (input) => {
        const databaseName = `jword-gate6-benchmark-${input.fixtureId}-${Date.now()}`
        const storeName = 'updates'
        const key = 'state-update'
        const update = Uint8Array.from(input.update)
        const database = await openBenchmarkDatabase(databaseName, storeName)

        try {
          await writeBenchmarkUpdate(database, storeName, key, update)

          const restoreStart = performance.now()
          const restored = await readBenchmarkUpdate(database, storeName, key)
          const durationMs = Math.round((performance.now() - restoreStart) * 100) / 100

          return {
            durationMs,
            byteLength: restored.byteLength
          }
        } finally {
          database.close()
          globalThis.indexedDB.deleteDatabase(databaseName)
        }

        /** 打开本次 benchmark 专用 IndexedDB 数据库。 */
        function openBenchmarkDatabase(name, objectStoreName) {
          return new Promise((resolve, reject) => {
            const request = globalThis.indexedDB.open(name, 1)

            request.onupgradeneeded = () => {
              request.result.createObjectStore(objectStoreName)
            }
            request.onsuccess = () => resolve(request.result)
            request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed.'))
          })
        }

        /** 写入待恢复的 Yjs update bytes。 */
        function writeBenchmarkUpdate(database, objectStoreName, updateKey, updateBytes) {
          return new Promise((resolve, reject) => {
            const transaction = database.transaction(objectStoreName, 'readwrite')
            const request = transaction.objectStore(objectStoreName).put(updateBytes, updateKey)

            request.onerror = () => reject(request.error ?? new Error('IndexedDB put failed.'))
            transaction.oncomplete = () => resolve()
            transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'))
          })
        }

        /** 读取 IndexedDB 中的 Yjs update bytes 并计入 restore 时间。 */
        function readBenchmarkUpdate(database, objectStoreName, updateKey) {
          return new Promise((resolve, reject) => {
            const transaction = database.transaction(objectStoreName, 'readonly')
            const request = transaction.objectStore(objectStoreName).get(updateKey)

            request.onsuccess = () => {
              const value = request.result

              if (!(value instanceof Uint8Array)) {
                reject(new Error('IndexedDB restore returned a non-Uint8Array value.'))
                return
              }

              resolve(value)
            }
            request.onerror = () => reject(request.error ?? new Error('IndexedDB get failed.'))
          })
        }
      }, {
        fixtureId,
        update: Array.from(update)
      })
    },
    async destroy() {
      await context.close()
      await browser.close()
      await server.close()
    }
  }
}

/** 启动给浏览器 IndexedDB 提供稳定 origin 的本地空白页服务。 */
async function startIndexedDbBenchmarkServer() {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><title>JWord Gate 6 IndexedDB benchmark</title>')
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('Gate 6 IndexedDB benchmark server did not expose a TCP address.')
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close() {
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
  }
}

/** 计量 auto inserter 写入正文和随后本地输入探针的执行时间。 */
function runAutoInsertBenchmark(fixture) {
  const editor = createEditor({ initialText: '' })

  try {
    const inserter = createTextInserter(editor, {
      requestId: `${fixture.id}-auto-insert`,
      anchor: createAnchor(editor, 0)
    })
    const autoInsertStart = performance.now()
    const insertResult = inserter.write(fixture.text)
    const autoInsertDurationMs = roundMetric(performance.now() - autoInsertStart)
    const inputProbeStart = performance.now()
    const inputProbeResult = editor.executeCommand(
      {
        name: 'autoInsertInputProbe',
        operations: [{
          kind: 'insertText',
          at: editor.resolveTextPosition(createAnchor(editor, 0)),
          text: 'P'
        }]
      },
      {
        origin: 'local-user',
        requestId: `${fixture.id}-input-probe`
      }
    )
    const autoInsertInputProbeDurationMs = roundMetric(performance.now() - inputProbeStart)

    if (insertResult === null) {
      throw new Error(`Gate 6 auto inserter benchmark did not insert text for ${fixture.id}.`)
    }

    return {
      autoInsertDurationMs,
      autoInsertInputProbeDurationMs,
      autoInsertUpdateByteLength: insertResult.diagnostic.updateByteLength + inputProbeResult.diagnostic.updateByteLength
    }
  } finally {
    editor.destroy()
  }
}

/** 创建公开 facade 可解析的默认段落锚点。 */
function createAnchor(editor, graphemeIndex) {
  return editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex
  })
}

/** 创建固定长度的 benchmark 文本，避免随机数据影响趋势比较。 */
function createBenchmarkText(charCount) {
  const unit = 'Gate6协同自动插入文本'

  return unit.repeat(Math.ceil(charCount / unit.length)).slice(0, charCount)
}

/** 创建覆盖 Gate 6 高级能力的本地 benchmark 授权。 */
function createBenchmarkLicense() {
  const entitlement = {
    customerId: 'gate6-benchmark',
    licenseToken: 'benchmark-token',
    issuer: 'jword-benchmark',
    issuedAt: '2026-05-27T00:00:00.000Z',
    features: Object.values(GATE6_COLLAB_FEATURES),
    expiresAt: '2999-01-01T00:00:00.000Z'
  }

  return {
    ...entitlement,
    signature: createJWordLicenseSignature(entitlement)
  }
}

/** 请求 JSON endpoint，并在失败时带上响应内容。 */
async function fetchJson(url, init) {
  const response = await fetch(url, init)
  const body = await response.json()

  if (!response.ok) {
    throw new Error(`Gate 6 benchmark request failed: ${url} ${JSON.stringify(body)}`)
  }

  return body
}

/** 把 update bytes 编成 history API 使用的 base64 字符串。 */
function encodeBase64(update) {
  return Buffer.from(update).toString('base64')
}

/** 读取必需字符串，避免 benchmark 静默吞掉异常 payload。 */
function readRequiredString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Gate 6 benchmark missing ${label}.`)
  }

  return value
}

/** 校验服务端 history record/list/preview 已走通同一个 version。 */
function assertServerHistoryResponses(fixture, listed, preview, versionId) {
  if (!Array.isArray(listed.versions) || !listed.versions.some((version) => version.versionId === versionId)) {
    throw new Error(`Gate 6 server history list did not include recorded version for ${fixture.id}.`)
  }

  if (typeof preview.updateBase64 !== 'string' || preview.updateBase64.length === 0) {
    throw new Error(`Gate 6 server history preview did not return update payload for ${fixture.id}.`)
  }
}

/** 校验所有输出指标都可用于后续趋势比较。 */
function validateBenchmarkResults(results) {
  for (const result of results) {
    validateFiniteMetrics(result, [
      'updateApplyDurationMs',
      'providerDispatchDurationMs',
      'snapshotCreateDurationMs',
      'snapshotLoadDurationMs',
      'versionPreviewDurationMs',
      'autoInsertDurationMs',
      'autoInsertInputProbeDurationMs',
      'offlineRestoreProbeDurationMs',
      'indexedDbRestoreDurationMs',
      'offlineReconnectDurationMs',
      'serverHistoryRecordDurationMs',
      'serverHistoryListDurationMs',
      'serverHistoryPreviewDurationMs',
      'licenseHandshakeDurationMs',
      'versionHandshakeDurationMs'
    ])
    validateUserCountMatrix(result)

    if (
      result.updateByteLength <= 0 ||
      result.previewUpdateByteLength <= 0 ||
      result.autoInsertUpdateByteLength <= 0 ||
      result.indexedDbRestoreByteLength <= 0
    ) {
      throw new Error(`Gate 6 benchmark produced empty update metrics for ${result.id}.`)
    }

    if (result.offlineRestoreStatus !== 'indexeddb-restored' || result.indexedDbRestoreStatus !== 'restored') {
      throw new Error(`Gate 6 benchmark did not run real browser IndexedDB restore for ${result.id}.`)
    }

    if (!result.offlineDiagnosticCodes.includes('PERSISTENCE_INDEXEDDB_UNAVAILABLE')) {
      throw new Error(`Gate 6 benchmark did not report IndexedDB unavailable diagnostic for ${result.id}.`)
    }

    if (
      result.offlineReconnectStatus !== 'synced' ||
      result.offlineReconnectQueuedUpdates !== 1 ||
      result.serverHistoryStatus !== 'ok' ||
      result.licenseHandshakeStatus !== 'ok' ||
      result.versionHandshakeStatus !== 'synced' ||
      result.versionHandshakeProtocolVersion.length === 0
    ) {
      throw new Error(`Gate 6 benchmark produced invalid server/offline handshake status for ${result.id}.`)
    }
  }
}

/** 校验 2/5/20 用户矩阵存在且每项远端 apply 数正确。 */
function validateUserCountMatrix(result) {
  if (!Array.isArray(result.userCountMatrix) || result.userCountMatrix.length !== userCountMatrix.length) {
    throw new Error(`Gate 6 benchmark missing user count matrix for ${result.id}.`)
  }

  for (const expected of userCountMatrix) {
    const found = result.userCountMatrix.find((item) => item.userCount === expected.userCount)

    if (found === undefined) {
      throw new Error(`Gate 6 benchmark missing ${expected.userCount} user metric for ${result.id}.`)
    }
    validateFiniteMetrics(found, [
      'userMatrixDispatchDurationMs',
      'userMatrixApplyDurationMs'
    ])
    if (found.remoteApplyCount !== expected.userCount - 1 || found.updateByteLength <= 0) {
      throw new Error(`Gate 6 benchmark invalid remote apply count for ${result.id}/${expected.userCount}.`)
    }
  }
}

/** 校验指定字段是有限数字。 */
function validateFiniteMetrics(result, keys) {
  for (const key of keys) {
    if (!Number.isFinite(result[key])) {
      throw new Error(`Gate 6 benchmark produced non-finite ${key} for ${result.id}.`)
    }
  }
}

/** 汇总所有 fixture 的关键指标，方便趋势记录。 */
function sumFixtureMetrics(results) {
  return results.reduce(
    (metrics, result) => ({
      fixtureCount: metrics.fixtureCount + 1,
      updateApplyDurationMs: roundMetric(metrics.updateApplyDurationMs + result.updateApplyDurationMs),
      updateByteLength: metrics.updateByteLength + result.updateByteLength,
      snapshotCreateDurationMs: roundMetric(metrics.snapshotCreateDurationMs + result.snapshotCreateDurationMs),
      snapshotLoadDurationMs: roundMetric(metrics.snapshotLoadDurationMs + result.snapshotLoadDurationMs),
      versionPreviewDurationMs: roundMetric(metrics.versionPreviewDurationMs + result.versionPreviewDurationMs),
      autoInsertDurationMs: roundMetric(metrics.autoInsertDurationMs + result.autoInsertDurationMs),
      autoInsertInputProbeDurationMs: roundMetric(
        metrics.autoInsertInputProbeDurationMs + result.autoInsertInputProbeDurationMs
      ),
      remoteApplyCount: metrics.remoteApplyCount + sumUserMatrixField(result, 'remoteApplyCount'),
      userMatrixDispatchDurationMs: roundMetric(
        metrics.userMatrixDispatchDurationMs + sumUserMatrixField(result, 'userMatrixDispatchDurationMs')
      ),
      userMatrixApplyDurationMs: roundMetric(
        metrics.userMatrixApplyDurationMs + sumUserMatrixField(result, 'userMatrixApplyDurationMs')
      ),
      offlineReconnectDurationMs: roundMetric(
        metrics.offlineReconnectDurationMs + result.offlineReconnectDurationMs
      ),
      serverHistoryRecordDurationMs: roundMetric(
        metrics.serverHistoryRecordDurationMs + result.serverHistoryRecordDurationMs
      ),
      serverHistoryListDurationMs: roundMetric(
        metrics.serverHistoryListDurationMs + result.serverHistoryListDurationMs
      ),
      serverHistoryPreviewDurationMs: roundMetric(
        metrics.serverHistoryPreviewDurationMs + result.serverHistoryPreviewDurationMs
      ),
      licenseHandshakeDurationMs: roundMetric(metrics.licenseHandshakeDurationMs + result.licenseHandshakeDurationMs),
      versionHandshakeDurationMs: roundMetric(metrics.versionHandshakeDurationMs + result.versionHandshakeDurationMs)
    }),
    {
      fixtureCount: 0,
      updateApplyDurationMs: 0,
      updateByteLength: 0,
      snapshotCreateDurationMs: 0,
      snapshotLoadDurationMs: 0,
      versionPreviewDurationMs: 0,
      autoInsertDurationMs: 0,
      autoInsertInputProbeDurationMs: 0,
      remoteApplyCount: 0,
      userMatrixDispatchDurationMs: 0,
      userMatrixApplyDurationMs: 0,
      offlineReconnectDurationMs: 0,
      serverHistoryRecordDurationMs: 0,
      serverHistoryListDurationMs: 0,
      serverHistoryPreviewDurationMs: 0,
      licenseHandshakeDurationMs: 0,
      versionHandshakeDurationMs: 0
    }
  )
}

/** 汇总 user matrix 中的数字字段。 */
function sumUserMatrixField(result, key) {
  return result.userCountMatrix.reduce((total, item) => total + item[key], 0)
}

/** 将浮点耗时压到两位小数，降低不同机器输出噪声。 */
function roundMetric(value) {
  return Math.round(value * 100) / 100
}
