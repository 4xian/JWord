/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 DOCX 兼容矩阵本地运行入口。
 * 边界：只验证 runner 的 dry-run 发现能力，不执行 Open XML validator 或办公套件。
 * 协作模块：tools/compat/run-gate5-docx-compatibility.mjs、fixtures/docx/registry.json 和 compatibility-matrix.json。
 * 约束：缺少外部工具时必须显式保留 pending，不允许伪造 Word/WPS/LibreOffice 或 validator 通过。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-20---建立-docx-兼容验证流程。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createRunnerTestEnv, readFreshRunStylesArtifactEvidence } from './gate5-compatibility-runner-helpers'
import type { Gate5CompatibilityManualTemplateFile, Gate5CompatibilityOpenXmlTemplateFile, Gate5CompatibilityRunnerDryRunReport, Gate5CompatibilityRunnerResultDocument } from './gate5-compatibility-runner-helpers'

describe('Gate 5 DOCX compatibility runner', () => {
  it('reports fixture coverage and external tool availability in dry-run mode', () => {
    const output = execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs',
      '--dry-run'
    ], {
      encoding: 'utf8'
    })
    const report = JSON.parse(output) as Gate5CompatibilityRunnerDryRunReport

    expect(report).toMatchObject({
      status: 'ok',
      mode: 'dry-run',
      fixtures: {
        total: 14,
        available: 14,
        missing: 0
      }
    })
    expect(report.toolAvailability.openXmlValidator.status).toMatch(/^(available|missing)$/)
    expect(report.toolAvailability.libreOffice.status).toMatch(/^(available|missing)$/)
    expect(report.toolAvailability.word.status).toMatch(/^(available|missing)$/)
    expect(report.toolAvailability.wps.status).toMatch(/^(available|missing)$/)
    expect('compatibilityPercent' in report).toBe(false)
  })

  it('records verifiable artifact evidence for generated DOCX exports', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-artifact-evidence-'))
    const outputPath = join(tempDir, 'compatibility-results.json')

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(
      readFileSync(outputPath, 'utf8')
    ) as Gate5CompatibilityRunnerResultDocument
    const reportedResults = report.results.filter((result) => result.status === 'reported')

    expect(reportedResults).toHaveLength(14)
    expect('compatibilityPercent' in report).toBe(false)

    for (const result of reportedResults) {
      expect(result.exportArtifactEvidence.path).toBe(result.exportArtifact)
      expect(existsSync(result.exportArtifactEvidence.path)).toBe(true)

      const artifactBytes = readFileSync(result.exportArtifactEvidence.path)
      const expectedHash = createHash('sha256').update(artifactBytes).digest('hex')

      expect(result.exportArtifactEvidence.byteLength).toBe(artifactBytes.byteLength)
      expect(result.exportArtifactEvidence.sha256).toBe(expectedHash)
      expect(result.report.automatedChecks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'open-xml-validator',
            result: 'pending',
            evidence: 'not-run'
          })
        ])
      )
    }
  })

  it('records pending evidence requests tied to exported artifact hashes', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-evidence-requests-'))
    const outputPath = join(tempDir, 'compatibility-results.json')
    const missingManualResultsPath = join(tempDir, 'missing-manual-results.json')
    const missingOpenXmlResultsPath = join(tempDir, 'missing-openxml-validation-results.json')

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: missingManualResultsPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: missingOpenXmlResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const runStylesRequests = report.evidenceRequests.filter((request) => request.fixtureId === 'docx-t1-run-styles')

    expect(runStylesResult?.exportArtifactEvidence.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(runStylesRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          target: 'Open XML validator',
          status: 'pending',
          exportArtifact: runStylesResult?.exportArtifact,
          artifactSha256: runStylesResult?.exportArtifactEvidence.sha256,
          requiredEvidence: [
            'OpenXmlValidator output or converted diagnostics JSON',
            'diagnostic severity/code/part/path/message fields',
            'artifact path and SHA-256 match this run'
          ]
        }),
        expect.objectContaining({
          target: 'Word',
          status: 'pending',
          exportArtifact: runStylesResult?.exportArtifact,
          artifactSha256: runStylesResult?.exportArtifactEvidence.sha256,
          requiredEvidence: [
            'app version and machine/date',
            'open result and repair prompt state',
            'edit/save/reopen result',
            'main visual difference notes',
            'artifact path and SHA-256 match this run'
          ]
        }),
        expect.objectContaining({
          target: 'WPS',
          status: 'pending',
          exportArtifact: runStylesResult?.exportArtifact,
          artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
        }),
        expect.objectContaining({
          target: 'LibreOffice',
          status: 'pending',
          exportArtifact: runStylesResult?.exportArtifact,
          artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
        })
      ])
    )
    expect('compatibilityPercent' in report).toBe(false)
  })

  it('keeps Microsoft Word desktop compatibility pending until artifact-bound manual evidence exists', () => {
    const report = JSON.parse(
      readFileSync('fixtures/docx/compatibility-results.json', 'utf8')
    ) as Gate5CompatibilityRunnerResultDocument
    const publicApiDocument = readFileSync('docs/sdk/public-api.md', 'utf8')

    for (const result of report.results) {
      const wordResult = result.report.appResults.find((appResult) => appResult.app === 'Word')

      expect(wordResult, result.fixtureId).toMatchObject({
        app: 'Word',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        evidence: 'not-run'
      })
    }

    expect(publicApiDocument).toContain('Microsoft Word 桌面版与 LibreOffice 仍为 `pending/not-run`')
    expect(publicApiDocument).toContain('不得声明已完成 Word 桌面版兼容验证')
  })

  it('emits artifact-bound templates for manual compatibility and validator evidence', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-evidence-templates-'))
    const outputPath = join(tempDir, 'compatibility-results.json')
    const missingManualResultsPath = join(tempDir, 'missing-manual-results.json')
    const missingOpenXmlResultsPath = join(tempDir, 'missing-openxml-validation-results.json')

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: missingManualResultsPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: missingOpenXmlResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsTemplate = report.evidenceTemplates.manualCompatibilityResults.results.find((result) =>
      result.fixtureId === 'docx-t1-run-styles' &&
      result.app === 'WPS'
    )
    const validatorTemplate = report.evidenceTemplates.openXmlValidationResults.results.find((result) =>
      result.fixtureId === 'docx-t1-run-styles'
    )

    expect(report.evidenceTemplates.manualCompatibilityResults).toMatchObject({
      path: missingManualResultsPath,
      schemaVersion: 1,
      scope: 'docx-office-manual-compatibility-results'
    })
    expect(wpsTemplate).toEqual({
      fixtureId: 'docx-t1-run-styles',
      app: 'WPS',
      exportArtifact: runStylesResult?.exportArtifactEvidence.path,
      artifactByteLength: runStylesResult?.exportArtifactEvidence.byteLength,
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256,
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: 'TODO: record missing repair prompt, editability, save/reopen, or visual difference evidence.',
      evidence: 'TODO: record app version, machine/date, artifact path, open/edit/save/reopen steps, and visual notes.'
    })
    expect(report.evidenceTemplates.openXmlValidationResults).toMatchObject({
      path: missingOpenXmlResultsPath,
      schemaVersion: 1,
      scope: 'docx-openxml-validation-results'
    })
    expect(validatorTemplate).toEqual({
      fixtureId: 'docx-t1-run-styles',
      exportArtifact: runStylesResult?.exportArtifactEvidence.path,
      artifactByteLength: runStylesResult?.exportArtifactEvidence.byteLength,
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256,
      evidence: 'TODO: record OpenXmlValidator version, command, machine/date, and converted diagnostics JSON.',
      diagnostics: []
    })
  })

  it('writes copyable evidence template files only when requested', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-template-files-'))
    const outputPath = join(tempDir, 'compatibility-results.json')
    const templateDir = join(tempDir, 'templates')
    const manualTemplatePath = join(templateDir, 'manual-compatibility-results.template.json')
    const openXmlTemplatePath = join(templateDir, 'openxml-validation-results.template.json')
    const readmePath = join(templateDir, 'README.md')

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs',
      '--write-evidence-templates'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_EVIDENCE_TEMPLATE_OUTPUT_DIR: templateDir,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: 'fixtures/docx/manual-compatibility-results.json',
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: 'fixtures/docx/openxml-validation-results.json'
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const manualTemplate = JSON.parse(readFileSync(manualTemplatePath, 'utf8')) as Gate5CompatibilityManualTemplateFile
    const openXmlTemplate = JSON.parse(readFileSync(openXmlTemplatePath, 'utf8')) as Gate5CompatibilityOpenXmlTemplateFile

    expect(manualTemplate).toEqual({
      schemaVersion: 1,
      scope: 'docx-office-manual-compatibility-results',
      results: report.evidenceTemplates.manualCompatibilityResults.results
    })
    expect(openXmlTemplate).toEqual({
      schemaVersion: 1,
      scope: 'docx-openxml-validation-results',
      results: report.evidenceTemplates.openXmlValidationResults.results
    })

    const readme = readFileSync(readmePath, 'utf8')

    expect(readme).toContain('manual-compatibility-results.template.json')
    expect(readme).toContain('openxml-validation-results.template.json')
    expect(readme).toContain('fixtures/docx/manual-compatibility-results.json')
    expect(readme).toContain('fixtures/docx/openxml-validation-results.json')
    expect(readme).toContain('artifactSha256')
    expect(readme).toContain('模板文件不是通过证据')
  })

  it('keeps every evidence request pending after all fixture artifacts are generated', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-missing-artifact-'))
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
    const paragraphsRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-paragraphs' &&
      request.target === 'Open XML validator'
    )
    const statuses = new Set(report.evidenceRequests.map((request) => request.status))

    expect(statuses).toEqual(new Set(['pending']))
    expect(paragraphsRequest).toMatchObject({
      fixtureId: 'docx-t1-paragraphs',
      target: 'Open XML validator',
      status: 'pending',
      exportArtifact: 'fixtures/docx/exports/docx-t1-paragraphs.docx',
      artifactSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      requiredEvidence: [
        'OpenXmlValidator output or converted diagnostics JSON',
        'diagnostic severity/code/part/path/message fields',
        'artifact path and SHA-256 match this run'
      ]
    })
  })

  it('merges manual app evidence into the generated compatibility report', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-compat-'))
    const manualResultsPath = join(tempDir, 'manual-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const artifactEvidence = readFreshRunStylesArtifactEvidence()

    writeFileSync(manualResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          app: 'WPS',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          result: 'pass',
          editable: 'pass',
          repairPrompt: 'none',
          mainVisualDifference: 'none',
          blockingIssue: '',
          evidence: 'manual WPS open/edit/save evidence'
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')

    expect(wpsResult).toEqual({
      app: 'WPS',
      result: 'pass',
      editable: 'pass',
      repairPrompt: 'none',
      mainVisualDifference: 'none',
      blockingIssue: '',
      evidence: 'manual WPS open/edit/save evidence'
    })
  })

  it('does not merge unbound manual app evidence without artifact hash fields', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-unbound-manual-'))
    const manualResultsPath = join(tempDir, 'manual-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(manualResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          app: 'WPS',
          result: 'pass',
          editable: 'pass',
          repairPrompt: 'none',
          mainVisualDifference: 'none',
          blockingIssue: '',
          evidence: 'unbound WPS evidence without artifact hash'
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')
    const wpsRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'WPS'
    )

    expect(wpsResult).toMatchObject({
      app: 'WPS',
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: 'External WPS evidence does not declare current export artifact binding.'
    })
    expect(wpsResult?.evidence).toContain('ignored unbound WPS evidence')
    expect(wpsRequest).toMatchObject({
      status: 'missing-artifact-binding',
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
    })
  })

  it('does not merge manual app evidence with unsupported result values', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-invalid-manual-'))
    const manualResultsPath = join(tempDir, 'manual-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const artifactEvidence = readFreshRunStylesArtifactEvidence()

    writeFileSync(manualResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          app: 'WPS',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          result: 'ok',
          editable: 'pass',
          repairPrompt: 'none',
          mainVisualDifference: 'none',
          blockingIssue: '',
          evidence: 'invalid WPS evidence with unsupported result value'
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')
    const wpsRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'WPS'
    )

    expect(wpsResult?.result).toBe('pending')
    expect(wpsResult?.evidence).not.toContain('invalid WPS evidence')
    expect(wpsRequest?.status).toBe('pending')
    expect(report.evidenceInputDiagnostics).toEqual([
      {
        source: 'manual-compatibility-results',
        path: manualResultsPath,
        resultIndex: 0,
        issue: 'Invalid manual compatibility evidence result.'
      }
    ])
  })

  it('does not merge stale manual app evidence for a different artifact hash', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-stale-manual-'))
    const manualResultsPath = join(tempDir, 'manual-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(manualResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          app: 'WPS',
          artifactSha256: '0'.repeat(64),
          result: 'pass',
          editable: 'pass',
          repairPrompt: 'none',
          mainVisualDifference: 'none',
          blockingIssue: '',
          evidence: 'stale WPS evidence from another export'
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')
    const wpsRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'WPS'
    )

    expect(wpsResult).toMatchObject({
      app: 'WPS',
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: 'External WPS evidence artifact does not match current export artifact.'
    })
    expect(wpsResult?.evidence).toContain('ignored stale WPS evidence')
    expect(wpsRequest).toMatchObject({
      status: 'stale-artifact-evidence',
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
    })
  })

  it('merges Open XML validation evidence into the generated compatibility report', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-openxml-'))
    const validationResultsPath = join(tempDir, 'openxml-validation-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const artifactEvidence = readFreshRunStylesArtifactEvidence()

    writeFileSync(validationResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          evidence: 'OpenXmlValidator JSON evidence',
          diagnostics: [
            {
              severity: 'warning',
              code: 'Sch_UnexpectedElementContentExpectingComplex',
              part: 'word/document.xml',
              path: '/w:document/w:body/w:p[1]',
              message: 'Validator warning evidence'
            }
          ]
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: validationResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')

    expect(validatorCheck).toEqual({
      kind: 'open-xml-validator',
      result: 'warn',
      evidence: 'OpenXmlValidator JSON evidence',
      diagnosticCount: 1,
      diagnostics: [
        {
          severity: 'warning',
          code: 'Sch_UnexpectedElementContentExpectingComplex',
          part: 'word/document.xml',
          path: '/w:document/w:body/w:p[1]',
          message: 'Validator warning evidence'
        }
      ]
    })
  })

  it('does not merge unbound Open XML evidence without artifact hash fields', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-unbound-openxml-'))
    const validationResultsPath = join(tempDir, 'openxml-validation-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(validationResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          evidence: 'unbound OpenXmlValidator pass evidence',
          diagnostics: []
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: validationResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')
    const validatorRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'Open XML validator'
    )

    expect(validatorCheck).toMatchObject({
      kind: 'open-xml-validator',
      result: 'pending',
      evidence: 'ignored unbound Open XML validator evidence',
      blockingIssue: 'External Open XML validator evidence does not declare current export artifact binding.'
    })
    expect(validatorRequest).toMatchObject({
      status: 'missing-artifact-binding',
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
    })
  })

  it('records diagnostics for invalid Open XML validation evidence', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-invalid-openxml-'))
    const validationResultsPath = join(tempDir, 'openxml-validation-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const artifactEvidence = readFreshRunStylesArtifactEvidence()

    writeFileSync(validationResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          evidence: 'invalid OpenXmlValidator evidence with unsupported severity',
          diagnostics: [
            {
              severity: 'notice',
              message: 'Unsupported severity must not be merged.'
            }
          ]
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: validationResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')

    expect(validatorCheck?.evidence).toBe('not-run')
    expect(report.evidenceInputDiagnostics).toEqual([
      {
        source: 'openxml-validation-results',
        path: validationResultsPath,
        resultIndex: 0,
        issue: 'Invalid Open XML validation evidence result.'
      }
    ])
  })

  it('does not merge stale Open XML evidence for a different artifact hash', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-stale-openxml-'))
    const validationResultsPath = join(tempDir, 'openxml-validation-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(validationResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-run-styles',
          artifactSha256: '0'.repeat(64),
          evidence: 'stale OpenXmlValidator pass evidence',
          diagnostics: []
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: createRunnerTestEnv({
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: validationResultsPath
      }),
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')
    const validatorRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'Open XML validator'
    )

    expect(validatorCheck).toMatchObject({
      kind: 'open-xml-validator',
      result: 'pending',
      evidence: 'ignored stale Open XML validator evidence',
      blockingIssue: 'External Open XML validator evidence artifact does not match current export artifact.'
    })
    expect(validatorRequest).toMatchObject({
      status: 'stale-artifact-evidence',
      artifactSha256: runStylesResult?.exportArtifactEvidence.sha256
    })
  })

})
