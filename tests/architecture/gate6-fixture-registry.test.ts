/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 协同与历史 fixture 登记表具备可执行约束。
 * 边界：只检查 JSON 登记表结构和固定 fixture id，不依赖未完成的协同、历史或 DOCX 包实现。
 * 协作模块：后续协同提供方、在线状态、快照、历史恢复和自动插入回放器按这些字段补真实执行。
 * 约束：登记表必须同时约束输入、操作序列、来源、投影、撤销和诊断期望，避免只靠文字计划验收。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const expectedCollabFixtureIds = [
  'remote-local-same-paragraph',
  'ai-local-anchor',
  'ai-local-range-replace',
  'ai-local-anchor-unresolved',
  'ai-remote-same-paragraph',
  'ai-remote-adjacent-delete',
  'ai-remote-provider-reconnect',
  'docx-import-t1-collab',
  'docx-import-t2-warning'
] as const

const expectedHistoryFixtureIds = [
  'update-log-basic',
  'snapshot-checkpoint',
  'version-preview-readonly',
  'restore-local-only'
] as const

describe('Gate 6 fixture registry', () => {
  it('freezes collab fixture ids and required execution fields', () => {
    const registry = readCollabRegistry('fixtures/collab/registry.json')

    expect(registry.fixtures.map((fixture) => fixture.id)).toEqual(expectedCollabFixtureIds)
    expect(registry.fixtures.every(hasRequiredCollabExecutionFields)).toBe(true)
  })

  it('requires collab fixtures to cover local, remote and AI origins', () => {
    const registry = readCollabRegistry('fixtures/collab/registry.json')
    const origins = new Set(registry.fixtures.flatMap((fixture) => fixture.originSequence))
    const actors = new Set(registry.fixtures.flatMap((fixture) => {
      return fixture.operations.map((operation) => operation.actor)
    }))

    expect([...actors].sort()).toEqual(['ai', 'local', 'remote'])
    expect([...origins].some((origin) => origin.startsWith('local:'))).toBe(true)
    expect([...origins].some((origin) => origin.startsWith('remote:'))).toBe(true)
    expect([...origins].some((origin) => origin.startsWith('ai:'))).toBe(true)
  })

  it('keeps collab diagnostics expectations aligned with the diagnostics registry', () => {
    const fixtureRegistry = readCollabRegistry('fixtures/collab/registry.json')
    const diagnosticsRegistry = readDiagnosticsRegistry('fixtures/collab/diagnostics-registry.json')
    const diagnosticCodes = new Set(diagnosticsRegistry.codes.map((diagnostic) => diagnostic.code))

    for (const fixture of fixtureRegistry.fixtures) {
      for (const code of fixture.diagnosticsExpectation.expectedCodes) {
        expect(diagnosticCodes.has(code), `${fixture.id}:${code}`).toBe(true)
      }
    }
  })

  it('requires DOCX imported collab fixtures to declare history, auto insert and offline invariants', () => {
    const registry = readCollabRegistry('fixtures/collab/registry.json')
    const docxFixtures = registry.fixtures.filter((fixture) => fixture.input?.kind === 'docx-import')

    expect(docxFixtures.map((fixture) => fixture.id)).toEqual([
      'docx-import-t1-collab',
      'docx-import-t2-warning'
    ])
    expect(docxFixtures.every(hasRequiredDocxGate6PathInvariants)).toBe(true)
  })

  it('freezes history fixture ids and required recovery fields', () => {
    const registry = readHistoryRegistry('fixtures/history/registry.json')

    expect(registry.fixtures.map((fixture) => fixture.id)).toEqual(expectedHistoryFixtureIds)
    expect(registry.fixtures.every(hasRequiredHistoryExecutionFields)).toBe(true)
    expect(registry.fixtures.map((fixture) => fixture.kind)).toEqual([
      'update-log',
      'snapshot',
      'version-preview',
      'restore'
    ])
  })
})

interface Gate6CollabRegistry {
  readonly fixtures: readonly Gate6CollabFixture[]
}

interface Gate6CollabFixture {
  readonly id: string
  readonly input?: {
    readonly kind?: string
    readonly source?: string
  }
  readonly operations: readonly Gate6CollabOperation[]
  readonly originSequence: readonly string[]
  readonly projectionSummary?: {
    readonly expectedTextIncludes?: readonly string[]
    readonly invariants?: readonly string[]
  }
  readonly undoExpectation?: {
    readonly scope?: string
    readonly revertsOrigins?: readonly string[]
    readonly preservesOrigins?: readonly string[]
  }
  readonly diagnosticsExpectation: {
    readonly expectedCodes: readonly string[]
  }
}

interface Gate6CollabOperation {
  readonly actor: string
  readonly origin: string
  readonly action: string
}

interface Gate6HistoryRegistry {
  readonly fixtures: readonly Gate6HistoryFixture[]
}

interface Gate6HistoryFixture {
  readonly id: string
  readonly kind: string
  readonly input?: {
    readonly source?: string
  }
  readonly updateLog?: {
    readonly expectedOrigins?: readonly string[]
  }
  readonly snapshot?: {
    readonly expectedState?: string
  }
  readonly versionPreview?: {
    readonly expectedMode?: string
  }
  readonly restoreExpectation?: {
    readonly expectedTextIncludes?: readonly string[]
    readonly preservesOrigins?: readonly string[]
  }
  readonly diagnosticsExpectation?: {
    readonly expectedCodes?: readonly string[]
  }
}

interface Gate6DiagnosticsRegistry {
  readonly codes: readonly {
    readonly code: string
  }[]
}

/** 读取并解析 Gate 6 协同 fixture 登记表。 */
function readCollabRegistry(path: string): Gate6CollabRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6CollabRegistry
}

/** 读取并解析 Gate 6 历史 fixture 登记表。 */
function readHistoryRegistry(path: string): Gate6HistoryRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6HistoryRegistry
}

/** 读取并解析 Gate 6 诊断登记表。 */
function readDiagnosticsRegistry(path: string): Gate6DiagnosticsRegistry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate6DiagnosticsRegistry
}

/** 检查协同 fixture 是否包含后续回放所需的最小执行字段。 */
function hasRequiredCollabExecutionFields(fixture: Gate6CollabFixture): boolean {
  return typeof fixture.input?.kind === 'string' &&
    typeof fixture.input.source === 'string' &&
    fixture.operations.length > 0 &&
    fixture.operations.every(hasRequiredCollabOperationFields) &&
    fixture.originSequence.length === fixture.operations.length &&
    fixture.originSequence.every((origin, index) => origin === fixture.operations[index]?.origin) &&
    Array.isArray(fixture.projectionSummary?.expectedTextIncludes) &&
    fixture.projectionSummary.expectedTextIncludes.length > 0 &&
    Array.isArray(fixture.projectionSummary.invariants) &&
    fixture.projectionSummary.invariants.length > 0 &&
    typeof fixture.undoExpectation?.scope === 'string' &&
    Array.isArray(fixture.undoExpectation.revertsOrigins) &&
    Array.isArray(fixture.undoExpectation.preservesOrigins) &&
    Array.isArray(fixture.diagnosticsExpectation.expectedCodes)
}

/** 检查协同操作是否声明 actor、origin 和动作。 */
function hasRequiredCollabOperationFields(operation: Gate6CollabOperation): boolean {
  return ['local', 'remote', 'ai'].includes(operation.actor) &&
    typeof operation.origin === 'string' &&
    operation.origin.startsWith(`${operation.actor}:`) &&
    typeof operation.action === 'string' &&
    operation.action.length > 0
}

/** 检查历史 fixture 是否包含后续恢复链路所需的最小字段。 */
function hasRequiredHistoryExecutionFields(fixture: Gate6HistoryFixture): boolean {
  return typeof fixture.input?.source === 'string' &&
    hasRequiredHistoryKindExpectation(fixture) &&
    Array.isArray(fixture.diagnosticsExpectation?.expectedCodes)
}

/** 按历史 fixture 类型检查对应的预期字段。 */
function hasRequiredHistoryKindExpectation(fixture: Gate6HistoryFixture): boolean {
  if (fixture.kind === 'update-log') {
    return Array.isArray(fixture.updateLog?.expectedOrigins) &&
      fixture.updateLog.expectedOrigins.length > 0
  }

  if (fixture.kind === 'snapshot') {
    return fixture.snapshot?.expectedState === 'checkpoint-created'
  }

  if (fixture.kind === 'version-preview') {
    return fixture.versionPreview?.expectedMode === 'readonly'
  }

  if (fixture.kind === 'restore') {
    return Array.isArray(fixture.restoreExpectation?.expectedTextIncludes) &&
      Array.isArray(fixture.restoreExpectation.preservesOrigins)
  }

  return false
}

/** 检查 DOCX 导入 fixture 是否显式覆盖 Gate 6 三条后续执行路径。 */
function hasRequiredDocxGate6PathInvariants(fixture: Gate6CollabFixture): boolean {
  const invariants = fixture.projectionSummary?.invariants ?? []

  return [
    'docx-import-enters-history-update-log',
    'docx-import-supports-auto-insert-anchor',
    'docx-import-exercises-offline-restore-diagnostic'
  ].every((invariant) => invariants.includes(invariant))
}
