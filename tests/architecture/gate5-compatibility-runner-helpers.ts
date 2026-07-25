/**
 * @vitest-environment node
 *
 * 职责：提供 Gate 5 兼容 runner 架构测试共享类型和辅助函数。
 * 边界：只被 architecture tests 消费，不执行办公套件或 Open XML validator。
 * 协作模块：Gate 5 兼容 runner 测试和 tools/compat/run-gate5-docx-compatibility.mjs。
 * 约束：辅助函数只运行本地 runner 并读取生成 artifact 证据，不伪造兼容结果。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const testOnlyLicenseRegister = new URL('../../fixtures/license/test-only-license-register.mjs', import.meta.url).href

export interface Gate5CompatibilityRunnerDryRunReport {
  readonly status: 'ok'
  readonly mode: 'dry-run'
  readonly fixtures: {
    readonly total: number
    readonly available: number
    readonly missing: number
  }
  readonly toolAvailability: {
    readonly openXmlValidator: Gate5CompatibilityRunnerToolStatus
    readonly word: Gate5CompatibilityRunnerToolStatus
  }
}

export interface Gate5CompatibilityRunnerToolStatus {
  readonly status: 'available' | 'missing'
}

export interface Gate5CompatibilityRunnerResultDocument {
  readonly results: readonly Gate5CompatibilityRunnerResult[]
  readonly evidenceRequests: readonly Gate5CompatibilityEvidenceRequest[]
  readonly evidenceTemplates: Gate5CompatibilityEvidenceTemplates
  readonly evidenceInputDiagnostics: readonly Gate5CompatibilityEvidenceInputDiagnostic[]
}

export interface Gate5CompatibilityRunnerResult {
  readonly fixtureId: string
  readonly status: 'reported' | 'pending'
  readonly exportArtifact: string
  readonly exportArtifactEvidence: {
    readonly path: string
    readonly byteLength: number
    readonly sha256: string
  }
  readonly openXmlValidation?: {
    readonly result: string
    readonly evidence: string
    readonly diagnosticCount?: number
    readonly diagnostics?: readonly {
      readonly severity: string
      readonly message: string
      readonly code?: string
      readonly part?: string
      readonly path?: string
    }[]
    readonly blockingIssue?: string
  }
  readonly appResults?: readonly Gate5CompatibilityRunnerAppResult[]
  readonly report: {
    readonly automatedChecks: readonly {
      readonly kind: string
      readonly result: string
      readonly evidence: string
    }[]
    readonly appResults: readonly Gate5CompatibilityRunnerAppResult[]
  }
}

export interface Gate5CompatibilityRunnerAppResult {
  readonly app: string
  readonly result: string
  readonly editable: string
  readonly repairPrompt: string
  readonly mainVisualDifference: string
  readonly blockingIssue: string
  readonly evidence: string
}

export interface Gate5CompatibilityEvidenceRequest {
  readonly fixtureId: string
  readonly target: string
  readonly status: string
  readonly exportArtifact: string
  readonly artifactSha256?: string
  readonly requiredEvidence: readonly string[]
}

export interface Gate5CompatibilityEvidenceInputDiagnostic {
  readonly source: string
  readonly path: string
  readonly resultIndex: number
  readonly issue: string
}

export interface Gate5CompatibilityEvidenceTemplates {
  readonly manualCompatibilityResults: {
    readonly path: string
    readonly schemaVersion: 1
    readonly scope: string
    readonly results: readonly Gate5CompatibilityManualEvidenceTemplate[]
  }
  readonly openXmlValidationResults: {
    readonly path: string
    readonly schemaVersion: 1
    readonly scope: string
    readonly results: readonly Gate5CompatibilityOpenXmlEvidenceTemplate[]
  }
}

export interface Gate5CompatibilityManualEvidenceTemplate {
  readonly fixtureId: string
  readonly app: string
  readonly exportArtifact: string
  readonly artifactByteLength: number
  readonly artifactSha256: string
  readonly result: string
  readonly editable: string
  readonly repairPrompt: string
  readonly mainVisualDifference: string
  readonly blockingIssue: string
  readonly evidence: string
}

export interface Gate5CompatibilityOpenXmlEvidenceTemplate {
  readonly fixtureId: string
  readonly exportArtifact: string
  readonly artifactByteLength: number
  readonly artifactSha256: string
  readonly evidence: string
  readonly diagnostics: readonly {
    readonly severity: string
    readonly message: string
    readonly code?: string
    readonly part?: string
    readonly path?: string
  }[]
}

export interface Gate5CompatibilityManualTemplateFile {
  readonly schemaVersion: 1
  readonly scope: string
  readonly results: readonly Gate5CompatibilityManualEvidenceTemplate[]
}

export interface Gate5CompatibilityOpenXmlTemplateFile {
  readonly schemaVersion: 1
  readonly scope: string
  readonly results: readonly Gate5CompatibilityOpenXmlEvidenceTemplate[]
}

export interface Gate5ExportArtifactEvidence {
  readonly path: string
  readonly byteLength: number
  readonly sha256: string
}

/** 创建隔离外部工具与默认证据文件的 runner 测试环境。 */
export function createRunnerTestEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-test-env-'))

  return {
    ...process.env,
    NODE_OPTIONS: [
      process.env.NODE_OPTIONS,
      `--import=${testOnlyLicenseRegister}`
    ].filter((value) => value !== undefined && value.length > 0).join(' '),
    GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: join(tempDir, 'missing-manual-results.json'),
    GATE5_DOCX_OPENXML_VALIDATION_RESULTS: join(tempDir, 'missing-openxml-validation-results.json'),
    GATE5_DISABLE_DEFAULT_OPENXML_VALIDATOR: '1',
    ...overrides
  }
}

/** 读取 run styles fixture 当前导出 artifact 证据。 */
export function readFreshRunStylesArtifactEvidence(): Gate5ExportArtifactEvidence {
  return readFreshArtifactEvidence('docx-t1-run-styles')
}

/** 运行一次兼容 runner 并读取指定 fixture 的当前导出 artifact 证据。 */
export function readFreshArtifactEvidence(fixtureId: string): Gate5ExportArtifactEvidence {
  const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-current-artifact-'))
  const outputPath = join(tempDir, 'compatibility-results.json')

  execFileSync(process.execPath, [
    'tools/compat/run-gate5-docx-compatibility.mjs'
  ], {
    env: createRunnerTestEnv({
      GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath
    }),
    encoding: 'utf8'
  })

  const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
  const runStylesResult = report.results.find((result) => result.fixtureId === fixtureId)

  if (runStylesResult === undefined) {
    throw new Error(`${fixtureId} compatibility result is missing.`)
  }

  return runStylesResult.exportArtifactEvidence
}
