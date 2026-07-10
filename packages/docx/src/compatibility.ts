/**
 * 职责：生成 Gate 5 DOCX 兼容验证流程的结构化报告。
 * 边界：只编排自动 package graph、roundtrip diff 和外部输入的 validator/人工应用结果，不启动办公套件或联网安装工具。
 * 协作模块：inspectDocxPackage、diffDocxRoundtrip、fixtures/docx 兼容矩阵后续消费本报告。
 * 性能/安全约束：报告必须保留未执行项的 pending 状态，不用兼容百分比替代证据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocxBinaryInput,
  ImportDocxOptions
} from './index.js'
import type { DocxRoundtripDiffResult } from './roundtrip.js'

export type DocxCompatibilityResult = 'pass' | 'warn' | 'fail' | 'blocked' | 'pending'

export type DocxCompatibilityAutomatedCheckKind =
  | 'package-graph'
  | 'roundtrip-diff'
  | 'open-xml-validator'

export type DocxCompatibilityAppName = 'Word'

export interface CreateDocxCompatibilityReportOptions extends ImportDocxOptions {
  readonly fixtureId: string
  readonly exportArtifact: string
  readonly openXmlValidation?: DocxOpenXmlValidationResult
  readonly openXmlValidator?: DocxCompatibilityAutomatedCheck
  readonly appResults?: readonly DocxCompatibilityAppResult[]
}

export interface DocxCompatibilityReport {
  readonly fixtureId: string
  readonly exportArtifact: string
  readonly automatedChecks: readonly DocxCompatibilityAutomatedCheck[]
  readonly appResults: readonly DocxCompatibilityAppResult[]
  readonly diagnostics: DocxCompatibilityDiagnostics
}

export interface DocxCompatibilityAutomatedCheck {
  readonly kind: DocxCompatibilityAutomatedCheckKind
  readonly result: DocxCompatibilityResult
  readonly evidence: string
  readonly mainDocumentPart?: string
  readonly differenceCount?: number
  readonly warningCount?: number
  readonly diagnosticCount?: number
  readonly diagnostics?: readonly DocxOpenXmlValidationDiagnostic[]
  readonly blockingIssue?: string
}

export interface DocxCompatibilityAppResult {
  readonly app: DocxCompatibilityAppName
  readonly result: DocxCompatibilityResult
  readonly editable: DocxCompatibilityResult
  readonly repairPrompt: DocxCompatibilityResult
  readonly mainVisualDifference: DocxCompatibilityResult
  readonly blockingIssue: string
  readonly evidence: string
}

export interface DocxCompatibilityDiagnostics {
  readonly requestId?: string
  readonly mainDocumentPart?: string
}

export type DocxOpenXmlValidationSeverity = 'error' | 'warning' | 'info'

export interface DocxOpenXmlValidationDiagnostic {
  readonly severity: DocxOpenXmlValidationSeverity
  readonly message: string
  readonly code?: string
  readonly part?: string
  readonly path?: string
}

export interface DocxOpenXmlValidationResult {
  readonly evidence: string
  readonly diagnostics: readonly DocxOpenXmlValidationDiagnostic[]
}

const DEFAULT_APP_NAMES = ['Word'] satisfies readonly DocxCompatibilityAppName[]

/** 创建 DOCX 兼容验证报告。 */
export async function createDocxCompatibilityReport(
  input: DocxBinaryInput,
  options: CreateDocxCompatibilityReportOptions
): Promise<DocxCompatibilityReport> {
  const [{ inspectDocxPackage }, { diffDocxRoundtrip }] = await Promise.all([
    import('./index.js'),
    import('./roundtrip.js')
  ])
  const packageGraph = await inspectDocxPackage(input, options)
  const roundtrip = await diffDocxRoundtrip(input, options)
  const mainDocumentPart = packageGraph.diagnostics.mainDocumentPart

  return {
    fixtureId: options.fixtureId,
    exportArtifact: options.exportArtifact,
    automatedChecks: [
      createPackageGraphCheck(mainDocumentPart, packageGraph.warnings.length),
      createRoundtripCheck(roundtrip),
      createOpenXmlValidatorCheck(options)
    ],
    appResults: createAppResults(options.appResults),
    diagnostics: {
      ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
      ...(mainDocumentPart === undefined ? {} : { mainDocumentPart })
    }
  }
}

/** 创建 package graph 自动检查结果。 */
function createPackageGraphCheck(
  mainDocumentPart: string | undefined,
  warningCount: number
): DocxCompatibilityAutomatedCheck {
  return {
    kind: 'package-graph',
    result: warningCount === 0 ? 'pass' : 'warn',
    evidence: 'inspectDocxPackage',
    ...(mainDocumentPart === undefined ? {} : { mainDocumentPart }),
    ...(warningCount === 0 ? {} : { warningCount })
  }
}

/** 创建 roundtrip diff 自动检查结果。 */
function createRoundtripCheck(roundtrip: DocxRoundtripDiffResult): DocxCompatibilityAutomatedCheck {
  const warningCount = roundtrip.importWarnings.length
    + roundtrip.exportWarnings.length
    + roundtrip.reimportWarnings.length
  const differenceCount = roundtrip.differences.length

  return {
    kind: 'roundtrip-diff',
    result: readRoundtripResult(roundtrip, warningCount),
    evidence: 'diffDocxRoundtrip',
    differenceCount,
    ...(warningCount === 0 ? {} : { warningCount })
  }
}

/** 读取 roundtrip diff 汇总状态。 */
function readRoundtripResult(
  roundtrip: DocxRoundtripDiffResult,
  warningCount: number
): DocxCompatibilityResult {
  if (!roundtrip.matches) {
    return 'fail'
  }

  return warningCount === 0 ? 'pass' : 'warn'
}

/** 创建未执行的 Open XML validator 检查结果。 */
function createOpenXmlValidatorCheck(
  options: CreateDocxCompatibilityReportOptions
): DocxCompatibilityAutomatedCheck {
  if (options.openXmlValidation !== undefined) {
    return createOpenXmlValidationCheck(options.openXmlValidation)
  }

  return options.openXmlValidator ?? createPendingOpenXmlValidatorCheck()
}

/** 由结构化 Open XML validator 诊断创建检查结果。 */
function createOpenXmlValidationCheck(
  validation: DocxOpenXmlValidationResult
): DocxCompatibilityAutomatedCheck {
  const firstBlockingDiagnostic = validation.diagnostics.find((diagnostic) => diagnostic.severity === 'error')

  return {
    kind: 'open-xml-validator',
    result: readOpenXmlValidationResult(validation.diagnostics),
    evidence: validation.evidence,
    diagnosticCount: validation.diagnostics.length,
    ...(firstBlockingDiagnostic === undefined
      ? {}
      : { blockingIssue: formatOpenXmlValidationDiagnostic(firstBlockingDiagnostic) }),
    ...(validation.diagnostics.length === 0 ? {} : { diagnostics: validation.diagnostics })
  }
}

/** 读取 Open XML validator 诊断汇总状态。 */
function readOpenXmlValidationResult(
  diagnostics: readonly DocxOpenXmlValidationDiagnostic[]
): DocxCompatibilityResult {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'fail'
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === 'warning') ? 'warn' : 'pass'
}

/** 格式化第一条阻断级 Open XML validator 诊断。 */
function formatOpenXmlValidationDiagnostic(diagnostic: DocxOpenXmlValidationDiagnostic): string {
  const location = [diagnostic.part, diagnostic.path].filter((value) => value !== undefined).join(' ')

  return location.length === 0 ? diagnostic.message : `${location}: ${diagnostic.message}`
}

/** 创建未执行的 Open XML validator 检查结果。 */
function createPendingOpenXmlValidatorCheck(): DocxCompatibilityAutomatedCheck {
  return {
    kind: 'open-xml-validator',
    result: 'pending',
    evidence: 'not-run',
    blockingIssue: 'Open XML validator result was not provided.'
  }
}

/** 合并外部办公套件结果，确保矩阵目标完整可审计。 */
function createAppResults(
  appResults: readonly DocxCompatibilityAppResult[] | undefined
): readonly DocxCompatibilityAppResult[] {
  const providedResults = new Map(appResults?.map((result) => [result.app, result]))

  return DEFAULT_APP_NAMES.map((app) => providedResults.get(app) ?? createPendingAppResult(app))
}

/** 创建单个 pending 的办公套件人工检查结果。 */
function createPendingAppResult(app: DocxCompatibilityAppName): DocxCompatibilityAppResult {
  return {
    app,
    result: 'pending',
    editable: 'pending',
    repairPrompt: 'pending',
    mainVisualDifference: 'pending',
    blockingIssue: 'pending',
    evidence: 'not-run'
  }
}
