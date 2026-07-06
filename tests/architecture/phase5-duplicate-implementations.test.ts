/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 5 重复实现收敛项的机器验收条件。
 * 边界：只检查审查计划点名的重复 helper、PDF 换算和媒体 URL allowlist，不做通用重复代码检测。
 * 协作模块：DOCX export-utils/roundtrip、PDF 几何与视觉报告、core 资源 URL 策略和 UI 媒体策略。
 * 约束：UI 媒体入口必须复用 core URL 策略，DOCX/PDF 只保留一个可写实现来源。
 * Specs：docs/superpowers/reports/2026-07-02-jword-remediation-plan.md#phase-5---p3-改进与技术债清理。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Phase 5 duplicate implementation convergence', () => {
  it('reuses DOCX property readers from export-utils in roundtrip diff', () => {
    const roundtripSource = readFileSync('packages/docx/src/roundtrip.ts', 'utf8')

    expect(roundtripSource).toContain('readNumberProperty')
    expect(roundtripSource).toContain('readStringProperty')
    expect(roundtripSource).toContain("from './export-utils.js'")
    expect(roundtripSource).not.toContain('function readStringProperty')
    expect(roundtripSource).not.toContain('function readNumberProperty')
  })

  it('keeps PDF point conversion and color parsing at a single source', () => {
    const visualReportSource = readFileSync('packages/pdf/src/visual-report.ts', 'utf8')
    const pdfSources = [
      readFileSync('packages/pdf/src/index.ts', 'utf8'),
      readFileSync('packages/pdf/src/text-style-renderer.ts', 'utf8'),
      visualReportSource
    ].join('\n')
    const colorParserMatches = pdfSources.match(/function readPdfColor/gu) ?? []

    expect(visualReportSource).toContain("from './pdf-geometry.js'")
    expect(visualReportSource).not.toContain('function twipsToPdfPoints')
    expect(colorParserMatches).toHaveLength(1)
  })

  it('delegates UI media URL allowlist to the core resource URL policy', () => {
    const mediaPolicySource = readFileSync('packages/ui/src/media/policy.ts', 'utf8')
    const uiTypesSource = readFileSync('packages/ui/src/types.ts', 'utf8')

    expect(mediaPolicySource).toContain("from '@4xian/jword-core'")
    expect(mediaPolicySource).toContain('isAllowedResourceUrl')
    expect(mediaPolicySource).not.toContain('new URL')
    expect(mediaPolicySource).not.toContain('parsedUrl.protocol')
    expect(uiTypesSource).toContain('ResourceUrlPolicy')
    expect(uiTypesSource).toContain('export type JWordMediaUrlPolicy = ResourceUrlPolicy')
  })
})
