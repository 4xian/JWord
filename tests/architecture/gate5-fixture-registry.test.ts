/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 DOCX/PDF fixture registry 模板具备可执行约束。
 * 边界：只检查 registry 结构、固定 fixture id 和输入文件存在性，不解析真实 DOCX/PDF 二进制或截图基线。
 * 协作模块：packages/docx、packages/pdf、examples/docx 和兼容矩阵后续按这些 id 追加真实证据。
 * 约束：registry 必须先约束新增 fixture，不允许只靠 README 口头验收。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-1---建立-fixture-registry-和兼容矩阵模板。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const expectedDocxFixtureIds = [
  'docx-t1-paragraphs',
  'docx-t1-run-styles',
  'docx-t1-paragraph-formatting',
  'docx-t1-headings',
  'docx-t1-lists',
  'docx-t1-table-basic',
  'docx-t1-inline-image',
  'docx-t1-page-setup',
  'docx-t2-header-footer',
  'docx-t2-page-number',
  'docx-t2-comments',
  'docx-t2-links',
  'docx-t2-section-breaks',
  'docx-t2-floating-object-warning'
] as const

const expectedPdfFixtureIds = [
  'pdf-basic-text',
  'pdf-chinese-font',
  'pdf-missing-font',
  'pdf-table-image',
  'pdf-header-footer-page-number'
] as const

describe('Gate 5 fixture registry', () => {
  it('freezes the DOCX T1/T2 fixture ids and required evidence fields', () => {
    const registry = readRegistry('fixtures/docx/registry.json')

    expect(registry.fixtures.map((fixture) => fixture.id)).toEqual(expectedDocxFixtureIds)
    expect(registry.fixtures.every(hasRequiredEvidenceFields)).toBe(true)
  })

  it('requires every DOCX fixture input to exist for compatibility artifact generation', () => {
    const registry = readRegistry('fixtures/docx/registry.json')

    expect(registry.fixtures.map((fixture) => ({
      id: fixture.id,
      state: fixture.input?.state,
      exists: existsSync(fixture.input?.path ?? '')
    }))).toEqual(expectedDocxFixtureIds.map((id) => ({
      id,
      state: 'available',
      exists: true
    })))
  })

  it('freezes the PDF fixture ids and required evidence fields', () => {
    const registry = readRegistry('fixtures/pdf/registry.json')

    expect(registry.fixtures.map((fixture) => fixture.id)).toEqual(expectedPdfFixtureIds)
    expect(registry.fixtures.every(hasRequiredEvidenceFields)).toBe(true)
  })

  it('requires the Chinese PDF font fixture input and font file to exist', () => {
    const registry = readRegistry('fixtures/pdf/registry.json')
    const fixture = registry.fixtures.find((item) => item.id === 'pdf-chinese-font')
    const input = readChinesePdfFontFixture(fixture?.input?.path ?? '')

    expect(fixture?.input?.state).toBe('available')
    expect(fixture?.pdfVisualExpectation?.state).toBe('pdfjs-text-verified')
    expect(typeof input.font.path).toBe('string')
    expect(readFileSync(input.font.path).byteLength).toBeGreaterThan(0)
  })

  it('freezes DOCX compatibility matrix targets for every fixture', () => {
    const matrix = readDocxCompatibilityMatrix('fixtures/docx/compatibility-matrix.json')

    expect(matrix.fixtures.map((fixture) => fixture.fixtureId)).toEqual(expectedDocxFixtureIds)
    expect(matrix.fixtures.every(hasRequiredDocxCompatibilityTargets)).toBe(true)
    expect('compatibilityPercent' in matrix).toBe(false)
  })
})

interface Gate5Registry {
  readonly fixtures: readonly Gate5Fixture[]
}

interface Gate5Fixture {
  readonly id: string
  readonly input?: {
    readonly path?: string
    readonly state?: string
  }
  readonly projectionSummary?: {
    readonly requiredCapabilities?: readonly string[]
  }
  readonly expectedWarnings?: readonly unknown[]
  readonly importScreenshotBaseline?: {
    readonly path?: string
  }
  readonly docxRoundtrip?: {
    readonly expected?: string
  }
  readonly pdfVisualExpectation?: {
    readonly expected?: string
    readonly state?: string
  }
}

interface Gate5PdfChineseFontFixture {
  readonly font: {
    readonly path: string
  }
}

interface Gate5DocxCompatibilityMatrix {
  readonly fixtures: readonly Gate5DocxCompatibilityFixture[]
}

interface Gate5DocxCompatibilityFixture {
  readonly fixtureId: string
  readonly exportArtifact?: string
  readonly openXmlValidation?: {
    readonly result?: string
    readonly evidence?: string
  }
  readonly appResults?: readonly {
    readonly app?: string
    readonly result?: string
    readonly editable?: string
    readonly repairPrompt?: string
    readonly mainVisualDifference?: string
    readonly blockingIssue?: string
    readonly evidence?: string
  }[]
}

type Gate5DocxCompatibilityAppResult = NonNullable<Gate5DocxCompatibilityFixture['appResults']>[number]

/** 读取并解析 Gate 5 registry JSON。 */
function readRegistry(path: string): Gate5Registry {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate5Registry
}

/** 读取并解析 DOCX 兼容矩阵 JSON。 */
function readDocxCompatibilityMatrix(path: string): Gate5DocxCompatibilityMatrix {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate5DocxCompatibilityMatrix
}

/** 读取并解析 PDF 中文字体输入 fixture。 */
function readChinesePdfFontFixture(path: string): Gate5PdfChineseFontFixture {
  return JSON.parse(readFileSync(path, 'utf8')) as Gate5PdfChineseFontFixture
}

/** 检查 fixture 是否包含 Gate 5 验收要求的最小证据字段。 */
function hasRequiredEvidenceFields(fixture: Gate5Fixture): boolean {
  return typeof fixture.input?.path === 'string' &&
    Array.isArray(fixture.projectionSummary?.requiredCapabilities) &&
    Array.isArray(fixture.expectedWarnings) &&
    typeof fixture.importScreenshotBaseline?.path === 'string' &&
    typeof fixture.docxRoundtrip?.expected === 'string' &&
    typeof fixture.pdfVisualExpectation?.expected === 'string'
}

/** 检查 DOCX 兼容矩阵是否包含 validator 与三套办公软件目标。 */
function hasRequiredDocxCompatibilityTargets(fixture: Gate5DocxCompatibilityFixture): boolean {
  const appResults = fixture.appResults

  return typeof fixture.exportArtifact === 'string' &&
    fixture.openXmlValidation?.result === 'pending' &&
    fixture.openXmlValidation.evidence === 'not-run' &&
    Array.isArray(appResults) &&
    JSON.stringify(appResults.map((result) => result.app)) === JSON.stringify(['Word', 'WPS', 'LibreOffice']) &&
    appResults.every(hasPendingAppCompatibilityResult)
}

/** 检查未执行办公软件目标是否显式保持 pending。 */
function hasPendingAppCompatibilityResult(result: Gate5DocxCompatibilityAppResult): boolean {
  return result.result === 'pending' &&
    result.editable === 'pending' &&
    result.repairPrompt === 'pending' &&
    result.mainVisualDifference === 'pending' &&
    result.blockingIssue === 'pending' &&
    result.evidence === 'not-run'
}
