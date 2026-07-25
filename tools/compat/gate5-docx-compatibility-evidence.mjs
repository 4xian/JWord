/**
 * 职责：生成 Gate 5 DOCX 兼容 runner 的 artifact 证据、补证请求和模板文件。
 * 边界：不读取 registry、不执行外部工具，只根据 runner 结果生成可复查证据结构。
 * 协作模块：run-gate5-docx-compatibility.mjs 和 DOCX 兼容矩阵报告共同消费这些函数。
 * 约束：缺失、过期或不完整证据必须保持 pending，不得生成兼容百分比或伪造通过结论。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const openXmlRequiredEvidence = [
  'OpenXmlValidator output or converted diagnostics JSON',
  'diagnostic severity/code/part/path/message fields',
  'artifact path and SHA-256 match this run'
]
const appRequiredEvidence = [
  'app version and machine/date',
  'open result and repair prompt state',
  'edit/save/reopen result',
  'main visual difference notes',
  'artifact path and SHA-256 match this run'
]
const missingArtifactRequiredEvidence = [
  'available source fixture input',
  'generated export artifact with byteLength and SHA-256'
]

/** 创建导出 artifact 的可复查大小和哈希证据。 */
export function createExportArtifactEvidence(path, bytes) {
  return {
    path,
    byteLength: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
}

/** 从当前结果派生仍缺的真实兼容证据请求。 */
export function createEvidenceRequests(results) {
  return results.flatMap((result) => [
    ...createOpenXmlEvidenceRequests(result),
    ...createAppEvidenceRequests(result)
  ])
}

/** 创建可复制到外部证据 JSON 的 artifact 绑定模板。 */
export function createEvidenceTemplates(results, paths) {
  return {
    manualCompatibilityResults: {
      path: paths.manualResultsPath,
      schemaVersion: 1,
      scope: 'docx-office-manual-compatibility-results',
      results: results.flatMap(createManualCompatibilityEvidenceTemplates)
    },
    openXmlValidationResults: {
      path: paths.openXmlValidationResultsPath,
      schemaVersion: 1,
      scope: 'docx-openxml-validation-results',
      results: results.flatMap(createOpenXmlValidationEvidenceTemplates)
    }
  }
}

/** 写出可复制填写的外部证据模板文件。 */
export async function writeEvidenceTemplateFiles(evidenceTemplates, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true })
  await Promise.all([
    writeEvidenceTemplateFile(
      join(outputDirectory, 'manual-compatibility-results.template.json'),
      evidenceTemplates.manualCompatibilityResults
    ),
    writeEvidenceTemplateFile(
      join(outputDirectory, 'openxml-validation-results.template.json'),
      evidenceTemplates.openXmlValidationResults
    ),
    writeEvidenceTemplateReadme(evidenceTemplates, outputDirectory)
  ])
}

/** 写出单个证据模板文件，不携带内部目标路径字段。 */
async function writeEvidenceTemplateFile(path, template) {
  await writeFile(path, `${JSON.stringify({
    schemaVersion: template.schemaVersion,
    scope: template.scope,
    results: template.results
  }, null, 2)}\n`)
}

/** 写出人工补证说明，避免把模板文件误当作真实通过证据。 */
async function writeEvidenceTemplateReadme(evidenceTemplates, outputDirectory) {
  await writeFile(join(outputDirectory, 'README.md'), [
    '# Gate 5 DOCX compatibility evidence templates',
    '',
    '这些文件只用于复制填写。模板文件不是通过证据，runner 默认不会把本目录下的 `.template.json` 当作真实证据读取。',
    '',
    '补 Microsoft Word 人工证据时：',
    '',
    '1. 从 `manual-compatibility-results.template.json` 复制对应结果行。',
    `2. 写入 \`${evidenceTemplates.manualCompatibilityResults.path}\` 的 \`results\` 数组。`,
    '3. 保留并核对 `exportArtifact`、`artifactByteLength`、`artifactSha256`。',
    '4. 把 `result`、`editable`、`repairPrompt`、`mainVisualDifference`、`blockingIssue`、`evidence` 改成人工打开、编辑、保存、重开后的真实观察。',
    '',
    '补 Open XML validator 证据时：',
    '',
    '1. 从 `openxml-validation-results.template.json` 复制对应结果行。',
    `2. 写入 \`${evidenceTemplates.openXmlValidationResults.path}\` 的 \`results\` 数组。`,
    '3. 保留并核对 `exportArtifact`、`artifactByteLength`、`artifactSha256`。',
    '4. 把 `evidence` 改成 validator 版本、命令、机器和日期，把 `diagnostics` 改成转换后的真实诊断数组。',
    '',
    '如果 artifact 任一绑定字段缺失或不匹配，runner 会把外部结论降级为 pending，并在 evidenceRequests 中标记缺失或 stale 状态。',
    ''
  ].join('\n'))
}

/** 为仍待闭环的办公套件检查创建人工证据模板。 */
function createManualCompatibilityEvidenceTemplates(result) {
  if (result.exportArtifactEvidence === undefined) {
    return []
  }

  return readResultAppResults(result)
    .filter((appResult) => !isAppResultComplete(appResult))
    .map((appResult) => ({
      fixtureId: result.fixtureId,
      app: appResult.app,
      ...createArtifactEvidenceFields(result.exportArtifactEvidence),
      result: 'pending',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: 'TODO: record missing repair prompt, editability, save/reopen, or visual difference evidence.',
      evidence: 'TODO: record app version, machine/date, artifact path, open/edit/save/reopen steps, and visual notes.'
    }))
}

/** 为仍待闭环的 Open XML validator 检查创建外部诊断模板。 */
function createOpenXmlValidationEvidenceTemplates(result) {
  const openXmlValidation = readResultOpenXmlValidation(result)

  if (result.exportArtifactEvidence === undefined || openXmlValidation?.result === 'pass') {
    return []
  }

  return [
    {
      fixtureId: result.fixtureId,
      ...createArtifactEvidenceFields(result.exportArtifactEvidence),
      evidence: 'TODO: record OpenXmlValidator version, command, machine/date, and converted diagnostics JSON.',
      diagnostics: []
    }
  ]
}

/** 把内部 artifact 证据字段映射成外部证据 schema 字段。 */
function createArtifactEvidenceFields(exportArtifactEvidence) {
  return {
    exportArtifact: exportArtifactEvidence.path,
    artifactByteLength: exportArtifactEvidence.byteLength,
    artifactSha256: exportArtifactEvidence.sha256
  }
}

/** 为未通过的 Open XML validator 目标创建证据请求。 */
function createOpenXmlEvidenceRequests(result) {
  const openXmlValidation = readResultOpenXmlValidation(result)

  if (openXmlValidation?.result === 'pass') {
    return []
  }

  return [
    createEvidenceRequest(
      result,
      'Open XML validator',
      openXmlValidation?.result ?? 'pending',
      openXmlRequiredEvidence,
      openXmlValidation?.blockingIssue
    )
  ]
}

/** 为未闭环的办公套件目标创建证据请求。 */
function createAppEvidenceRequests(result) {
  return readResultAppResults(result)
    .filter((appResult) => !isAppResultComplete(appResult))
    .map((appResult) => createEvidenceRequest(
      result,
      appResult.app,
      appResult.result,
      appRequiredEvidence,
      appResult.blockingIssue
    ))
}

/** 读取结果中的 Open XML validator 检查。 */
function readResultOpenXmlValidation(result) {
  return result.status === 'reported'
    ? result.report.automatedChecks.find((check) => check.kind === 'open-xml-validator')
    : result.openXmlValidation
}

/** 读取结果中的办公套件检查。 */
function readResultAppResults(result) {
  return result.status === 'reported'
    ? result.report.appResults
    : result.appResults ?? []
}

/** 判断办公套件人工证据是否已经闭环。 */
function isAppResultComplete(appResult) {
  return appResult.result === 'pass' &&
    appResult.editable === 'pass' &&
    appResult.repairPrompt === 'none' &&
    appResult.mainVisualDifference === 'none' &&
    appResult.blockingIssue.length === 0
}

/** 创建单个证据请求并绑定导出 artifact 证据。 */
function createEvidenceRequest(result, target, status, requiredEvidence, blockingIssue) {
  if (result.exportArtifactEvidence === undefined) {
    return {
      fixtureId: result.fixtureId,
      target,
      status: 'blocked-by-missing-artifact',
      exportArtifact: result.exportArtifact,
      requiredEvidence: [
        ...missingArtifactRequiredEvidence,
        ...requiredEvidence.filter((item) => item !== 'artifact path and SHA-256 match this run')
      ]
    }
  }

  return {
    fixtureId: result.fixtureId,
    target,
    status: readEvidenceRequestStatus(status, blockingIssue),
    exportArtifact: result.exportArtifact,
    artifactByteLength: result.exportArtifactEvidence.byteLength,
    artifactSha256: result.exportArtifactEvidence.sha256,
    requiredEvidence
  }
}

/** 把 stale 外部证据显式暴露为证据请求状态。 */
function readEvidenceRequestStatus(status, blockingIssue) {
  if (blockingIssue?.includes('evidence artifact does not match current export artifact.') === true) {
    return 'stale-artifact-evidence'
  }

  return blockingIssue?.includes('does not declare current export artifact binding.') === true
    ? 'missing-artifact-binding'
    : status
}

/** 把外部 validator 诊断压缩为矩阵目标结果。 */
export function createOpenXmlValidationSummary(validation) {
  const firstBlockingDiagnostic = validation.diagnostics.find((diagnostic) => diagnostic.severity === 'error')

  return {
    result: readOpenXmlValidationSummaryResult(validation.diagnostics),
    evidence: validation.evidence,
    diagnosticCount: validation.diagnostics.length,
    ...(firstBlockingDiagnostic === undefined
      ? {}
      : { blockingIssue: formatOpenXmlValidationDiagnostic(firstBlockingDiagnostic) }),
    ...(validation.diagnostics.length === 0 ? {} : { diagnostics: validation.diagnostics })
  }
}

/** 读取 Open XML validator 诊断汇总状态。 */
function readOpenXmlValidationSummaryResult(diagnostics) {
  if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
    return 'fail'
  }

  return diagnostics.some((diagnostic) => diagnostic.severity === 'warning') ? 'warn' : 'pass'
}

/** 格式化第一条阻断级 validator 诊断。 */
function formatOpenXmlValidationDiagnostic(diagnostic) {
  const location = [diagnostic.part, diagnostic.path].filter((value) => value !== undefined).join(' ')

  return location.length === 0 ? diagnostic.message : `${location}: ${diagnostic.message}`
}
