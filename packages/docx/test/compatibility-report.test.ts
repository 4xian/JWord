/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 Iteration 20 的 DOCX 兼容验证报告契约。
 * 边界：只验证自动检查与人工兼容记录的结构化入口，不伪造真实 Word/WPS/LibreOffice 结果。
 * 协作模块：packages/docx/src/compatibility.ts、inspectDocxPackage 和 roundtrip diff。
 * 约束：报告不使用兼容百分比；未执行的 Open XML validator 和办公套件检查必须显式标记为 pending。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-20---建立-docx-兼容验证流程。
 */

import type { DocumentProjection } from '@4xian/jword-core'
import { describe, expect, it } from 'vitest'

import {
  createDocxCompatibilityReport,
  exportDocx
} from '../src/index'

describe('@4xian/jword-docx compatibility report', () => {
  it('records automated checks and pending manual app checks without compatibility percent', async () => {
    const exportResult = await exportDocx(createCompatibilityProjection(), {
      requestId: 'docx-compat-export-1'
    })
    const report = await createDocxCompatibilityReport(exportResult.bytes, {
      fixtureId: 'docx-t1-compat-smoke',
      exportArtifact: 'memory://docx-t1-compat-smoke.docx',
      requestId: 'docx-compat-report-1'
    })

    expect(report.fixtureId).toBe('docx-t1-compat-smoke')
    expect(report.exportArtifact).toBe('memory://docx-t1-compat-smoke.docx')
    expect(report.automatedChecks).toEqual([
      {
        kind: 'package-graph',
        result: 'pass',
        evidence: 'inspectDocxPackage',
        mainDocumentPart: 'word/document.xml'
      },
      {
        kind: 'roundtrip-diff',
        result: 'pass',
        evidence: 'diffDocxRoundtrip',
        differenceCount: 0
      },
      {
        kind: 'open-xml-validator',
        result: 'pending',
        evidence: 'not-run',
        blockingIssue: 'Open XML validator result was not provided.'
      }
    ])
    expect(report.appResults).toEqual([
      {
        app: 'Word',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        blockingIssue: 'pending',
        evidence: 'not-run'
      },
      {
        app: 'WPS',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        blockingIssue: 'pending',
        evidence: 'not-run'
      },
      {
        app: 'LibreOffice',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        blockingIssue: 'pending',
        evidence: 'not-run'
      }
    ])
    expect(report.diagnostics).toEqual({
      requestId: 'docx-compat-report-1',
      mainDocumentPart: 'word/document.xml'
    })
    expect('compatibilityPercent' in report).toBe(false)
  })

  it('keeps missing manual app checks pending when one app result is provided', async () => {
    const exportResult = await exportDocx(createCompatibilityProjection(), {
      requestId: 'docx-compat-export-2'
    })
    const report = await createDocxCompatibilityReport(exportResult.bytes, {
      fixtureId: 'docx-t1-compat-partial-app',
      exportArtifact: 'memory://docx-t1-compat-partial-app.docx',
      appResults: [
        {
          app: 'Word',
          result: 'pass',
          editable: 'pass',
          repairPrompt: 'pass',
          mainVisualDifference: 'pass',
          blockingIssue: '',
          evidence: 'manual-word-open-save'
        }
      ]
    })

    expect(report.appResults).toEqual([
      {
        app: 'Word',
        result: 'pass',
        editable: 'pass',
        repairPrompt: 'pass',
        mainVisualDifference: 'pass',
        blockingIssue: '',
        evidence: 'manual-word-open-save'
      },
      {
        app: 'WPS',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        blockingIssue: 'pending',
        evidence: 'not-run'
      },
      {
        app: 'LibreOffice',
        result: 'pending',
        editable: 'pending',
        repairPrompt: 'pending',
        mainVisualDifference: 'pending',
        blockingIssue: 'pending',
        evidence: 'not-run'
      }
    ])
  })

  it('derives Open XML validator status from structured diagnostics', async () => {
    const exportResult = await exportDocx(createCompatibilityProjection(), {
      requestId: 'docx-compat-export-3'
    })
    const report = await createDocxCompatibilityReport(exportResult.bytes, {
      fixtureId: 'docx-t1-compat-validator',
      exportArtifact: 'memory://docx-t1-compat-validator.docx',
      openXmlValidation: {
        evidence: 'openxml-validator-cli',
        diagnostics: [
          {
            severity: 'error',
            code: 'Sch_IncompleteContentExpectingComplex',
            part: 'word/document.xml',
            path: '/w:document/w:body/w:p[1]',
            message: 'The element has invalid child element.'
          }
        ]
      }
    })

    expect(report.automatedChecks[2]).toEqual({
      kind: 'open-xml-validator',
      result: 'fail',
      evidence: 'openxml-validator-cli',
      diagnosticCount: 1,
      blockingIssue: 'word/document.xml /w:document/w:body/w:p[1]: The element has invalid child element.',
      diagnostics: [
        {
          severity: 'error',
          code: 'Sch_IncompleteContentExpectingComplex',
          part: 'word/document.xml',
          path: '/w:document/w:body/w:p[1]',
          message: 'The element has invalid child element.'
        }
      ]
    })
  })
})

/** 创建兼容报告 smoke test 使用的只读投影。 */
function createCompatibilityProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-compat-smoke',
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-1',
              styleId: 'Heading1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  properties: {
                    bold: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Compatibility smoke'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  }
}
