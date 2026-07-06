/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 7 诊断码 registry 已成为跨 core/docx/pdf/native/license 的单一真源。
 * 边界：只检查 registry、派生文档、派生 core 摘要和稳定 code 定义，不执行包运行时流程。
 * 协作模块：fixtures/collab/diagnostics-registry.json、tools/diagnostics、docs/sdk 与 core observability。
 * 约束：新增公开诊断码必须先登记到统一 registry，再由生成脚本刷新文档和 diagnostics export 摘要。
 * Specs：docs/superpowers/reports/2026-07-02-gate7-review.md#r2-复审补充。
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

import { describe, expect, it } from 'vitest'

const registryPath = 'fixtures/collab/diagnostics-registry.json'
const generatedDocPath = 'docs/sdk/diagnostic-codes.md'
const generatedSummaryPath = 'packages/core/src/editor/diagnostics-registry.ts'

const diagnosticDefinitionFiles = [
  'packages/core/src/shared/errors.ts',
  'packages/core/src/plugins/types.ts',
  'packages/docx/src/diagnostics.ts',
  'packages/pdf/src/diagnostics.ts',
  'packages/native/src/types.ts',
  'packages/license/src/index.ts'
] as const

const nonDiagnosticTokens = new Set([
  'JWORD_NATIVE_FORMAT_VERSION',
  'JWORD_NATIVE_SCHEMA_VERSION',
  'JWORD_NATIVE_CREATED_BY',
  'JWORD_LICENSE_TOKEN_VERSION',
  'JWORD_LICENSE_TOKEN_SCHEMA_VERSION',
  'JWORD_LICENSE_DEFAULT_PUBLIC_KEY_BASE64URL',
  'DOCX_WARNING_CODE_METADATA',
  'DOCX_ERROR_CODE_METADATA',
  'PDF_WARNING_CODE_METADATA',
  'PDF_ERROR_CODE_METADATA',
  'JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA'
])

describe('Gate 7 diagnostics registry single source', () => {
  it('registers every public core/docx/pdf/native/license diagnostic code', () => {
    const registry = readDiagnosticsRegistry()
    const registeredCodes = new Set(registry.codes.map((item) => item.code))

    for (const emittedCode of readDefinedDiagnosticCodes()) {
      expect(registeredCodes.has(emittedCode), emittedCode).toBe(true)
    }
  })

  it('keeps generated diagnostics artifacts in sync with the registry', () => {
    const result = spawnSync(process.execPath, ['tools/diagnostics/generate-diagnostics-artifacts.mjs', '--check'], {
      encoding: 'utf8'
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
  })

  it('freezes required metadata for every registered diagnostic code', () => {
    const registry = readDiagnosticsRegistry()
    const codes = registry.codes.map((item) => item.code)

    expect(new Set(codes).size).toBe(codes.length)
    expect(registry.codes.every(hasRequiredMetadata)).toBe(true)
    const owners = new Set(registry.codes.map((item) => item.owner))
    for (const owner of ['core', 'docx', 'pdf', 'native', 'license']) {
      expect(owners.has(owner), owner).toBe(true)
    }
  })

  it('publishes the registry-derived code list and export summary', () => {
    const registry = readDiagnosticsRegistry()
    const generatedDoc = readFileSync(generatedDocPath, 'utf8')
    const generatedSummary = readFileSync(generatedSummaryPath, 'utf8')

    for (const code of registry.codes.map((item) => item.code)) {
      expect(generatedDoc.includes(`\`${code}\``), code).toBe(true)
    }

    expect(generatedSummary).toContain(`codeCount: ${registry.codes.length}`)
    expect(generatedSummary).toContain(registryPath)
  })
})

interface DiagnosticsRegistry {
  readonly schemaVersion: number
  readonly codes: readonly DiagnosticMetadata[]
}

interface DiagnosticMetadata {
  readonly code: string
  readonly owner: string
  readonly severity: string
  readonly recoverable: boolean
  readonly fallback: string
  readonly description: string
  readonly domains: readonly string[]
}

/** 读取统一诊断 registry。 */
function readDiagnosticsRegistry(): DiagnosticsRegistry {
  return JSON.parse(readFileSync(registryPath, 'utf8')) as DiagnosticsRegistry
}

/** 检查 registry metadata 字段完整性。 */
function hasRequiredMetadata(metadata: DiagnosticMetadata): boolean {
  return /^[A-Z][A-Z0-9_]+$/u.test(metadata.code) &&
    metadata.owner.length > 0 &&
    ['info', 'warning', 'error'].includes(metadata.severity) &&
    typeof metadata.recoverable === 'boolean' &&
    metadata.fallback.length > 0 &&
    metadata.description.length > 0 &&
    metadata.domains.length > 0 &&
    metadata.domains.every((domain) => domain.length > 0)
}

/** 从公开诊断 code 定义文件提取 code。 */
function readDefinedDiagnosticCodes(): readonly string[] {
  const codes = new Set<string>()
  const pattern = /\b(?:TRANSACTION|OPERATION|PROJECTION|DOCUMENT_STORE|EDITOR|PLUGIN|CANVAS|DOCX|PDF|JWORD_NATIVE|JWORD_LICENSE|JWORD_FEATURE)_[A-Z0-9_]*[A-Z0-9]\b/gu

  for (const sourceFile of diagnosticDefinitionFiles) {
    const source = readFileSync(sourceFile, 'utf8')
    const matches = source.matchAll(pattern)

    for (const match of matches) {
      if (!nonDiagnosticTokens.has(match[0])) {
        codes.add(match[0])
      }
    }
  }

  return [...codes].sort()
}
