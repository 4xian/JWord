/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 collaboration/offline/auto-insert benchmark 的脚本入口和可审计输出字段。
 * 边界：只验证 benchmark 脚本结构、runner 接入和输出字段，不执行耗时 benchmark。
 * 协作模块：benchmarks/gate6-collab-benchmark.mjs、tools/bench/run-bench.mjs、packages/collab、packages/persistence 和 packages/core。
 * 约束：Gate 6 benchmark 必须用真实浏览器 IndexedDB 探针计量 restore 时间，不能用内存 adapter 冒充离线缓存。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-6--collaborationauto-insert。
 */
import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 6 benchmark entry', () => {
  it('provides a dedicated collaboration benchmark script with required metrics and browser IndexedDB status', () => {
    const benchmarkPath = 'benchmarks/gate6-collab-benchmark.mjs'

    expect(existsSync(benchmarkPath)).toBe(true)

    const source = readFileSync(benchmarkPath, 'utf8')

    for (const token of [
      'gate6-collab',
      'updateApplyDurationMs',
      'updateByteLength',
      'snapshotCreateDurationMs',
      'snapshotLoadDurationMs',
      'versionPreviewDurationMs',
      'autoInsertDurationMs',
      'autoInsertInputProbeDurationMs',
      'offlineRestoreStatus',
      'indexedDbRestoreStatus',
      'indexedDbRestoreDurationMs',
      'indexedDbRestoreByteLength',
      'indexeddb-restored',
      'restored',
      'chromium.launch',
      'createMemoryCollabProviderAdapter',
      'createMemoryPersistenceAdapter',
      'createUnavailableIndexedDbOfflineAdapter',
      'createTextInserter',
      'userCountMatrix',
      'userCount',
      'remoteApplyCount',
      'offlineReconnectStatus',
      'offlineReconnectDurationMs',
      'offlineReconnectQueuedUpdates',
      'serverHistoryRecordDurationMs',
      'serverHistoryListDurationMs',
      'serverHistoryPreviewDurationMs',
      'serverHistoryStatus',
      'licenseHandshakeDurationMs',
      'licenseHandshakeStatus',
      'versionHandshakeDurationMs',
      'versionHandshakeStatus',
      'versionHandshakeProtocolVersion',
      'connectJWordCollaboration',
      'createJWordCollabServer',
      'createVolatileHistoryStorage',
      'GATE6_COLLAB_FEATURES'
    ]) {
      expect(source).toContain(token)
    }

    for (const userCount of [2, 5, 20]) {
      expect(source).toContain(`userCount: ${userCount}`)
    }
  })

  it('runs the Gate 6 collaboration benchmark from the shared bench runner', () => {
    const runnerSource = readFileSync('tools/bench/run-bench.mjs', 'utf8')

    expect(runnerSource).toContain('gate6-collab-benchmark.mjs')
  })
})
