/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 兼容 runner 对外部证据、validator 命令和 WPS 证据的合并策略。
 * 边界：只运行本地 runner，不执行真实 Word、LibreOffice 或 WPS GUI 自动化。
 * 协作模块：tools/compat/run-gate5-docx-compatibility.mjs 与 Gate 5 兼容矩阵 artifact。
 * 约束：外部证据必须绑定当前导出 artifact 的 byteLength 与 SHA-256，不能把过期或不完整证据标记为通过。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-20---建立-docx-兼容验证流程。
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readFreshArtifactEvidence, readFreshRunStylesArtifactEvidence } from './gate5-compatibility-runner-helpers'
import type { Gate5CompatibilityRunnerResultDocument } from './gate5-compatibility-runner-helpers'

describe('Gate 5 DOCX compatibility runner external evidence', () => {
  it('merges external evidence for generated fixture targets', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-pending-'))
    const manualResultsPath = join(tempDir, 'manual-results.json')
    const validationResultsPath = join(tempDir, 'openxml-validation-results.json')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const artifactEvidence = readFreshArtifactEvidence('docx-t1-paragraphs')

    writeFileSync(manualResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-paragraphs',
          app: 'Word',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          result: 'pass',
          editable: 'pass',
          repairPrompt: 'none',
          mainVisualDifference: 'none',
          blockingIssue: '',
          evidence: 'manual Word evidence for pending fixture target'
        }
      ]
    })}\n`)
    writeFileSync(validationResultsPath, `${JSON.stringify({
      schemaVersion: 1,
      results: [
        {
          fixtureId: 'docx-t1-paragraphs',
          exportArtifact: artifactEvidence.path,
          artifactByteLength: artifactEvidence.byteLength,
          artifactSha256: artifactEvidence.sha256,
          evidence: 'external OpenXmlValidator evidence for pending fixture target',
          diagnostics: [
            {
              severity: 'error',
              part: 'word/document.xml',
              path: '/w:document/w:body',
              message: 'Pending target validator evidence'
            }
          ]
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath,
        GATE5_DOCX_OPENXML_VALIDATION_RESULTS: validationResultsPath
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const paragraphsResult = report.results.find((result) => result.fixtureId === 'docx-t1-paragraphs')
    const validatorCheck = paragraphsResult?.report.automatedChecks.find((check) =>
      check.kind === 'open-xml-validator'
    )
    const wordResult = paragraphsResult?.report.appResults.find((result) => result.app === 'Word')

    expect(paragraphsResult).toMatchObject({
      fixtureId: 'docx-t1-paragraphs',
      status: 'reported'
    })
    expect(validatorCheck).toMatchObject({
      kind: 'open-xml-validator',
      result: 'fail',
      evidence: 'external OpenXmlValidator evidence for pending fixture target',
      diagnosticCount: 1,
      blockingIssue: 'word/document.xml /w:document/w:body: Pending target validator evidence',
      diagnostics: [
        {
          severity: 'error',
          part: 'word/document.xml',
          path: '/w:document/w:body',
          message: 'Pending target validator evidence'
        }
      ]
    })
    expect(wordResult).toEqual({
      app: 'Word',
      result: 'pass',
      editable: 'pass',
      repairPrompt: 'none',
      mainVisualDifference: 'none',
      blockingIssue: '',
      evidence: 'manual Word evidence for pending fixture target'
    })
  })

  it('derives Open XML validation evidence from validator command JSON output', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-validator-command-'))
    const validatorPath = join(tempDir, 'fake-openxml-validator.sh')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(validatorPath, [
      '#!/bin/sh',
      'printf \'%s\\n\' \'{"evidence":"OpenXmlValidator stdout JSON","diagnostics":[{"severity":"warning","code":"Sch_UnexpectedElementContentExpectingComplex","part":"word/document.xml","path":"/w:document/w:body/w:p[1]","message":"validator command diagnostic"}]}\''
    ].join('\n'))
    chmodSync(validatorPath, 0o755)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        OPENXML_VALIDATOR_COMMAND: validatorPath
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')

    expect(validatorCheck).toEqual({
      kind: 'open-xml-validator',
      result: 'warn',
      evidence: 'OpenXmlValidator stdout JSON',
      diagnosticCount: 1,
      diagnostics: [
        {
          severity: 'warning',
          code: 'Sch_UnexpectedElementContentExpectingComplex',
          part: 'word/document.xml',
          path: '/w:document/w:body/w:p[1]',
          message: 'validator command diagnostic'
        }
      ]
    })
  })

  it('passes the exported artifact through an Open XML validator command template', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-validator-template-'))
    const validatorPath = join(tempDir, 'fake openxml validator.sh')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(validatorPath, [
      '#!/bin/sh',
      'case "$1" in',
      '  *docx-t1-run-styles.docx)',
      '    printf \'%s\\n\' \'{"evidence":"OpenXmlValidator command template artifact matched","diagnostics":[]}\'',
      '    exit 0',
      '    ;;',
      '  *)',
      '    printf \'unexpected artifact: %s\\n\' "$1" >&2',
      '    exit 9',
      '    ;;',
      'esac'
    ].join('\n'))
    chmodSync(validatorPath, 0o755)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        OPENXML_VALIDATOR_COMMAND: `'${validatorPath}' '{artifact}'`
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')

    expect(validatorCheck).toEqual({
      kind: 'open-xml-validator',
      result: 'pass',
      evidence: 'OpenXmlValidator command template artifact matched',
      diagnosticCount: 0
    })
  })

  it('times out a hanging Open XML validator command without blocking the matrix', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-validator-timeout-'))
    const validatorPath = join(tempDir, 'hanging-openxml-validator.sh')
    const outputPath = join(tempDir, 'compatibility-results.json')

    writeFileSync(validatorPath, [
      '#!/bin/sh',
      'sleep 5',
      'printf \'%s\\n\' \'{"evidence":"late validator result","diagnostics":[]}\''
    ].join('\n'))
    chmodSync(validatorPath, 0o755)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        OPENXML_VALIDATOR_COMMAND: validatorPath,
        OPENXML_VALIDATOR_TIMEOUT_MS: '20'
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const validatorCheck = runStylesResult?.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')

    expect(validatorCheck).toMatchObject({
      kind: 'open-xml-validator',
      result: 'fail',
      diagnosticCount: 1,
      blockingIssue: 'docx-t1-run-styles.docx: Open XML validator command timed out after 20ms.'
    })
    expect(validatorCheck?.evidence).toContain('Open XML validator command timed out after 20ms.')
  })

  it('records WPS process evidence without marking compatibility as passed', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-wps-process-'))
    const fakeWpsAppPath = join(tempDir, 'wpsoffice.app')
    const outputPath = join(tempDir, 'compatibility-results.json')
    const missingManualResultsPath = join(tempDir, 'missing-manual-results.json')
    const exportedArtifactPath = resolve('fixtures/docx/exports/docx-t1-run-styles.docx')

    mkdirSync(fakeWpsAppPath)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: missingManualResultsPath,
        GATE5_WPS_APP_PATH: fakeWpsAppPath,
        GATE5_WPS_PROCESS_LSOF_OUTPUT: [
          'wpsoffice 26079 jian 82w REG 1,17 5613 76128878 ',
          exportedArtifactPath
        ].join('')
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')

    expect(wpsResult).toMatchObject({
      app: 'WPS',
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: 'WPS process opened the exported artifact, but repair prompt, editability, visual difference, and save evidence still require UI verification.'
    })
    expect(wpsResult?.evidence).toContain(`WPS app found: ${fakeWpsAppPath}`)
    expect(wpsResult?.evidence).toContain(`lsof shows WPS opened ${exportedArtifactPath}`)
  })

  it('merges partial WPS UI evidence without marking compatibility as passed', () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'jword-gate5-partial-wps-ui-'))
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
          result: 'pending',
          editable: 'pending',
          repairPrompt: 'none',
          mainVisualDifference: 'pending',
          blockingIssue: 'WPS opened the exported artifact and no repair prompt was visible, but edit/save/reopen evidence is still missing.',
          evidence: 'partial WPS UI evidence'
        }
      ]
    })}\n`)

    execFileSync(process.execPath, [
      'tools/compat/run-gate5-docx-compatibility.mjs'
    ], {
      env: {
        ...process.env,
        GATE5_DOCX_COMPATIBILITY_OUTPUT: outputPath,
        GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS: manualResultsPath
      },
      encoding: 'utf8'
    })

    const report = JSON.parse(readFileSync(outputPath, 'utf8')) as Gate5CompatibilityRunnerResultDocument
    const runStylesResult = report.results.find((result) => result.fixtureId === 'docx-t1-run-styles')
    const wpsResult = runStylesResult?.report.appResults.find((result) => result.app === 'WPS')
    const wpsRequest = report.evidenceRequests.find((request) =>
      request.fixtureId === 'docx-t1-run-styles' &&
      request.target === 'WPS'
    )

    expect(wpsResult).toEqual({
      app: 'WPS',
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'none',
      mainVisualDifference: 'pending',
      blockingIssue: 'WPS opened the exported artifact and no repair prompt was visible, but edit/save/reopen evidence is still missing.',
      evidence: 'partial WPS UI evidence'
    })
    expect(wpsRequest).toMatchObject({
      fixtureId: 'docx-t1-run-styles',
      target: 'WPS',
      status: 'pending',
      artifactSha256: artifactEvidence.sha256
    })
  })
})
