/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 协同、离线、自动插入和恢复诊断码具备统一登记表。
 * 边界：只检查诊断登记表 JSON 和 fixture 引用，不导入未完成包实现。
 * 协作模块：协同提供方、在线状态、离线、快照、历史、自动插入和恢复后续复用这些诊断码。
 * 约束：新增 Gate 6 诊断码必须先进入登记表，且带有级别、可恢复标记、回退方式和归属方。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-6---协同离线自动插入。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const expectedDiagnosticCodes = [
  'COLLAB_PROVIDER_UNAVAILABLE',
  'COLLAB_USER_IDENTITY_REQUIRED',
  'COLLAB_PROVIDER_AUTH_FAILED',
  'COLLAB_UPDATE_REJECTED',
  'COLLAB_PERMISSION_DENIED',
  'COLLAB_PROVIDER_NOT_CONNECTED',
  'COLLAB_PROVIDER_SEND_FAILED',
  'COLLAB_UPDATE_METADATA_MISMATCH',
  'COLLAB_PROVIDER_DESTROYED',
  'COLLAB_SERVER_UNAVAILABLE',
  'COLLAB_VERSION_MISMATCH',
  'COLLAB_PROTOCOL_MISMATCH',
  'COLLAB_SERVER_TOO_OLD',
  'COLLAB_CLIENT_TOO_OLD',
  'COLLAB_FEATURE_FLAGS_MISSING',
  'COLLAB_AWARENESS_STALE',
  'COLLAB_AWARENESS_INVALID',
  'COLLAB_AWARENESS_PARSE_FAILED',
  'COLLAB_AWARENESS_ANCHOR_UNRESOLVED',
  'OFFLINE_CACHE_SYNCED',
  'OFFLINE_CACHE_UNAVAILABLE',
  'OFFLINE_LOCAL_UPDATE_QUEUED',
  'OFFLINE_RECONNECT_STARTED',
  'OFFLINE_RECONNECT_SYNCED',
  'OFFLINE_RECONNECT_CONFLICT_MERGED',
  'OFFLINE_RECONNECT_FAILED',
  'COLLAB_SNAPSHOT_STALE',
  'COLLAB_SNAPSHOT_MISSING',
  'COLLAB_HISTORY_ORIGIN_SKIPPED',
  'COLLAB_HISTORY_SERVER_FALLBACK',
  'COLLAB_AUTH_DENIED',
  'JWORD_COLLAB_AUTH_HOOK_REQUIRED',
  'COLLAB_TENANT_DENIED',
  'JWORD_COLLAB_HISTORY_STORAGE_MISSING',
  'JWORD_COLLAB_HISTORY_DOCUMENT_ID_REQUIRED',
  'JWORD_COLLAB_HISTORY_RECORD_PAYLOAD_INVALID',
  'JWORD_COLLAB_HISTORY_PREVIEW_PAYLOAD_INVALID',
  'JWORD_COLLAB_HISTORY_METADATA_MISMATCH',
  'JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED',
  'COLLAB_AUTO_INSERTER_ANCHOR_REBASED',
  'COLLAB_AUTO_INSERTER_ANCHOR_UNRESOLVED',
  'COLLAB_AUTO_INSERTER_RANGE_REQUIRED',
  'COLLAB_AUTO_INSERTER_ANCHOR_REQUIRED',
  'COLLAB_AUTO_INSERTER_FLUSH_FAILED',
  'COLLAB_AUTO_INSERTER_POSITION_REQUIRED',
  'COLLAB_AUTO_INSERTER_ABORTED',
  'COLLAB_AUTO_INSERTER_RETRY_STARTED',
  'JWORD_COLLAB_AUTO_INSERT_RELAY_PAYLOAD_INVALID',
  'JWORD_COLLAB_AUTO_INSERT_RELAY_METADATA_MISMATCH',
  'COLLAB_RESTORE_CONFLICT_RESOLVED',
  'COLLAB_LICENSE_MISSING',
  'COLLAB_LICENSE_EXPIRED',
  'COLLAB_FEATURE_NOT_ENTITLED',
  'COLLAB_LICENSE_SERVER_UNAVAILABLE',
  'JWORD_COLLAB_LICENSE_HOOK_REQUIRED',
  'JWORD_COLLAB_LICENSE_METADATA_REQUIRED',
  'JWORD_COLLAB_LICENSE_STATUS_PAYLOAD_INVALID',
  'JWORD_COLLAB_SERVER_RATE_LIMITED',
  'JWORD_COLLAB_SERVER_PAYLOAD_TOO_LARGE',
  'JWORD_COLLAB_SERVER_INTERNAL_ERROR',
  'JWORD_COLLAB_SERVER_NOT_FOUND',
  'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
  'PERSISTENCE_VERSION_NOT_FOUND',
  'PERSISTENCE_SNAPSHOT_NOT_FOUND',
  'PERSISTENCE_VERSION_COMPACTED',
  'PERSISTENCE_RESTORE_FAILED'
] as const

const requiredDiagnosticDomains = [
  'authorization',
  'version',
  'server',
  'network',
  'offline',
  'history',
  'auto-insert',
  'presence',
  'storage',
  'rate-limit',
  'payload-limit',
  'tenant-hook',
  'auth-hook'
] as const

const diagnosticSourceFiles = [
  'packages/collab/src/index.ts',
  'packages/collab/src/client-sdk.ts',
  'packages/collab/src/hocuspocus-adapter.ts',
  'packages/collab-server/src/index.ts',
  'packages/collab-server/src/auto-insert-relay.ts',
  'packages/collab-server/src/history-routes.ts',
  'packages/collab-server/src/history-service.ts',
  'packages/collab-server/src/hocuspocus-server.ts',
  'packages/persistence/src/diagnostics.ts',
  'packages/persistence/src/index.ts',
  'packages/persistence/src/indexeddb-adapter.ts',
  'packages/persistence/src/storage-history-adapter.ts',
  'examples/collab/src/runtime.ts',
  'examples/collab/src/runtime/hocuspocus-auto-insert.ts',
  'examples/collab/src/runtime/hocuspocus-history.ts',
  'examples/collab/src/runtime/hocuspocus-history-bridge.ts',
  'examples/collab/src/runtime/hocuspocus-offline-diagnostics.ts',
  'examples/collab/src/runtime/hocuspocus-runtime.ts',
  'examples/collab/src/runtime/hocuspocus-server-history.ts'
] as const

const nonDiagnosticTokens = new Set([
  'COLLAB_FEATURES',
  'JWORD_COLLAB_CLIENT_PACKAGE_VERSION',
  'JWORD_COLLAB_CLIENT_PROTOCOL_VERSION',
  'JWORD_COLLAB_SERVER_NOT_ENTITLED',
  'JWORD_COLLAB_SERVER_PACKAGE_VERSION',
  'JWORD_COLLAB_SERVER_PROTOCOL_VERSION',
  'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
])

describe('Gate 6 diagnostics registry', () => {
  it('freezes required diagnostics codes for every Gate 6 subsystem', () => {
    const registry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')

    expect(registry.codes.map((diagnostic) => diagnostic.code)).toEqual(expectedDiagnosticCodes)
    expect(registry.codes.every(hasRequiredDiagnosticMetadata)).toBe(true)
  })

  it('keeps diagnostics owners aligned with required Gate 6 subsystems', () => {
    const registry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')

    expect(registry.codes.map((diagnostic) => diagnostic.owner)).toEqual([
      'provider',
      'provider',
      'provider',
      'provider',
      'provider',
      'provider',
      'provider',
      'provider',
      'provider',
      'network',
      'version',
      'version',
      'version',
      'version',
      'version',
      'awareness',
      'awareness',
      'awareness',
      'awareness',
      'offline',
      'offline',
      'offline',
      'offline',
      'offline',
      'offline',
      'offline',
      'snapshot',
      'snapshot',
      'history',
      'history',
      'server',
      'server',
      'server',
      'storage',
      'history',
      'history',
      'history',
      'history',
      'history',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'auto-inserter',
      'restore',
      'license',
      'license',
      'license',
      'license',
      'server',
      'server',
      'server',
      'server',
      'server',
      'server',
      'server',
      'storage',
      'storage',
      'storage',
      'storage',
      'storage'
    ])
  })

  it('covers every commercial readiness diagnostics domain', () => {
    const registry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')
    const registeredDomains = new Set(registry.codes.flatMap((diagnostic) => diagnostic.domains))

    expect([...registeredDomains].sort()).toEqual([...requiredDiagnosticDomains].sort())
  })

  it('requires fixture expected diagnostics to reference registered codes', () => {
    const diagnosticsRegistry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')
    const collabRegistry = readCollabRegistry('fixtures/collab/registry.json')
    const historyRegistry = readHistoryRegistry('fixtures/history/registry.json')
    const diagnosticCodes = new Set(diagnosticsRegistry.codes.map((diagnostic) => diagnostic.code))

    for (const expectedCode of [
      ...readCollabExpectedDiagnosticCodes(collabRegistry),
      ...readHistoryExpectedDiagnosticCodes(historyRegistry)
    ]) {
      expect(diagnosticCodes.has(expectedCode), expectedCode).toBe(true)
    }
  })

  it('requires emitted runtime diagnostics to be registered', () => {
    const diagnosticsRegistry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')
    const diagnosticCodes = new Set(diagnosticsRegistry.codes.map((diagnostic) => diagnostic.code))

    for (const emittedCode of readEmittedDiagnosticCodes()) {
      expect(diagnosticCodes.has(emittedCode), emittedCode).toBe(true)
    }
  })
})

interface Gate6DiagnosticsRegistry {
  readonly codes: readonly Gate6DiagnosticMetadata[]
}

interface Gate6DiagnosticMetadata {
  readonly code: string
  readonly owner: string
  readonly severity: string
  readonly recoverable: boolean
  readonly fallback: string
  readonly description: string
  readonly domains: readonly string[]
}

interface Gate6CollabRegistry {
  readonly fixtures: readonly {
    readonly diagnosticsExpectation?: {
      readonly expectedCodes?: readonly string[]
    }
  }[]
}

interface Gate6HistoryRegistry {
  readonly fixtures: readonly {
    readonly diagnosticsExpectation?: {
      readonly expectedCodes?: readonly string[]
    }
  }[]
}

/** 读取并解析 Gate 6 诊断登记表。 */
function readDiagnosticsRegistry(path: string): Gate6DiagnosticsRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6DiagnosticsRegistry
}

/** 读取并解析 Gate 6 协同 fixture 登记表。 */
function readCollabRegistry(path: string): Gate6CollabRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6CollabRegistry
}

/** 读取并解析 Gate 6 历史 fixture 登记表。 */
function readHistoryRegistry(path: string): Gate6HistoryRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6HistoryRegistry
}

/** 检查诊断 metadata 是否包含运行时和 fixture 复用所需字段。 */
function hasRequiredDiagnosticMetadata(metadata: Gate6DiagnosticMetadata): boolean {
  return ['COLLAB_', 'OFFLINE_', 'PERSISTENCE_', 'JWORD_COLLAB_'].some((prefix) => metadata.code.startsWith(prefix)) &&
    ['provider', 'network', 'version', 'awareness', 'offline', 'snapshot', 'history', 'auto-inserter', 'restore', 'license', 'server', 'storage'].includes(metadata.owner) &&
    ['info', 'warning', 'error'].includes(metadata.severity) &&
    typeof metadata.recoverable === 'boolean' &&
    typeof metadata.fallback === 'string' &&
    metadata.fallback.length > 0 &&
    typeof metadata.description === 'string' &&
    metadata.description.length > 0 &&
    Array.isArray(metadata.domains) &&
    metadata.domains.length > 0 &&
    metadata.domains.every((domain) => requiredDiagnosticDomains.includes(domain as typeof requiredDiagnosticDomains[number]))
}

/** 读取协同 fixture 中声明的期望诊断 code。 */
function readCollabExpectedDiagnosticCodes(registry: Gate6CollabRegistry): readonly string[] {
  return registry.fixtures.flatMap((fixture) => fixture.diagnosticsExpectation?.expectedCodes ?? [])
}

/** 读取 history fixture 中声明的期望诊断 code。 */
function readHistoryExpectedDiagnosticCodes(registry: Gate6HistoryRegistry): readonly string[] {
  return registry.fixtures.flatMap((fixture) => fixture.diagnosticsExpectation?.expectedCodes ?? [])
}

/** 从会创建或返回诊断的源码中提取稳定诊断 code。 */
function readEmittedDiagnosticCodes(): readonly string[] {
  const codes = new Set<string>()

  for (const sourceFile of diagnosticSourceFiles) {
    const source = readFileSync(sourceFile, 'utf8')
    const matches = source.matchAll(/\b(?:COLLAB|OFFLINE|PERSISTENCE|JWORD_COLLAB)_[A-Z0-9_]*[A-Z0-9]\b/gu)

    for (const match of matches) {
      if (!nonDiagnosticTokens.has(match[0])) {
        codes.add(match[0])
      }
    }
  }

  return [...codes].sort()
}
