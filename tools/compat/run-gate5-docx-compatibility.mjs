/**
 * 职责：运行 Gate 5 DOCX Open XML 与办公套件兼容矩阵的本地入口。
 * 边界：只生成可复查报告和导出 artifact，不安装外部工具，不把缺失工具伪造成通过。
 * 协作模块：fixtures/docx/registry.json、compatibility-matrix.json、packages/docx 和 packages/core。
 * 约束：开放 XML 校验器、Word、WPS、LibreOffice 缺失时必须保留待验或未运行证据。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-20---建立-docx-兼容验证流程。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { createEvidenceRequests, createEvidenceTemplates, createExportArtifactEvidence, createOpenXmlValidationSummary, writeEvidenceTemplateFiles } from './gate5-docx-compatibility-evidence.mjs'
import { commandExists, expandCommandTemplateParts, formatCommandEvidence, isAvailableFixture, isOptionalNumberField, isOptionalStringField, isStringField, parseCommandTemplate, printJson, readCommandFailureMessage, readJson, readPositiveIntegerEnv, runCommand, summarizeFixtures } from './gate5-docx-compatibility-utils.mjs'

const registryPath = 'fixtures/docx/registry.json'
const matrixPath = 'fixtures/docx/compatibility-matrix.json'
const manualResultsPath = process.env.GATE5_DOCX_MANUAL_COMPATIBILITY_RESULTS ??
  'fixtures/docx/manual-compatibility-results.json'
const openXmlValidationResultsPath = process.env.GATE5_DOCX_OPENXML_VALIDATION_RESULTS ??
  'fixtures/docx/openxml-validation-results.json'
const outputPath = process.env.GATE5_DOCX_COMPATIBILITY_OUTPUT ??
  'fixtures/docx/compatibility-results.json'
const evidenceTemplateOutputDirectory = process.env.GATE5_DOCX_EVIDENCE_TEMPLATE_OUTPUT_DIR ??
  'fixtures/docx/evidence-templates'
const openXmlValidatorTimeoutMs = readPositiveIntegerEnv('OPENXML_VALIDATOR_TIMEOUT_MS', 30000)
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const writeEvidenceTemplates = args.includes('--write-evidence-templates')

const evidenceInputDiagnostics = []
const registry = await readJson(registryPath)
const matrix = await readJson(matrixPath)
const manualAppResultByKey = await readManualAppResults(manualResultsPath)
const openXmlValidationByFixtureId = await readOpenXmlValidationResults(openXmlValidationResultsPath)
const toolAvailability = createToolAvailability()
const fixtureSummary = summarizeFixtures(registry.fixtures)
let cachedWpsProcessLsofOutput = null

if (dryRun) {
  printJson({
    status: 'ok',
    mode: 'dry-run',
    fixtures: fixtureSummary,
    toolAvailability,
    outputPath
  })
} else {
  await runCompatibilityMatrix()
}

/** 运行完整 DOCX 兼容矩阵并写入结果 artifact。 */
async function runCompatibilityMatrix() {
  const [{ createEditor }, docxRuntime, licenseRuntime] = await Promise.all([
    import('../../packages/core/dist/index.js'),
    import('../../packages/docx/dist/index.js'),
    import('../../packages/license/dist/index.js')
  ])
  const fixtureById = new Map(registry.fixtures.map((fixture) => [fixture.id, fixture]))
  const results = []

  for (const target of matrix.fixtures) {
    const fixture = fixtureById.get(target.fixtureId)

    if (!isAvailableFixture(fixture)) {
      results.push(createSkippedFixtureResult(target, fixture))
      continue
    }

    results.push(await runAvailableFixtureCompatibility({
      createEditor,
      docxRuntime,
      licenseRuntime,
      fixture,
      target
    }))
  }

  const evidenceTemplates = createEvidenceTemplates(results, {
    manualResultsPath,
    openXmlValidationResultsPath
  })
  const resultDocument = {
    schemaVersion: 1,
    gate: 'gate5',
    scope: 'docx-openxml-and-app-compatibility-results',
    status: 'ok',
    fixtures: fixtureSummary,
    toolAvailability,
    evidenceInputDiagnostics,
    evidenceRequests: createEvidenceRequests(results),
    evidenceTemplates,
    results
  }

  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, `${JSON.stringify(resultDocument, null, 2)}\n`)
  if (writeEvidenceTemplates) {
    await writeEvidenceTemplateFiles(evidenceTemplates, evidenceTemplateOutputDirectory)
  }
  printJson({
    status: 'ok',
    mode: 'run',
    outputPath,
    fixtures: fixtureSummary,
    toolAvailability
  })
}

/** 运行单个真实 fixture 的导出、validator 和办公套件检查。 */
async function runAvailableFixtureCompatibility(input) {
  const sourceBytes = await readFile(input.fixture.input.path)
  const importResult = await input.docxRuntime.importDocx(sourceBytes, {
    requestId: `${input.fixture.id}-compat-import`,
    license: createGate5CompatibilityLicense(input.licenseRuntime, ['docx.import'])
  })
  const document = input.docxRuntime.convertDocxImportDocumentToCoreDocument(importResult.document)
  const editor = input.createEditor()

  try {
    const projection = editor.loadDocumentModel({
      document
    })
    const exportResult = await input.docxRuntime.exportDocx(projection, {
      requestId: `${input.fixture.id}-compat-export`,
      license: createGate5CompatibilityLicense(input.licenseRuntime, ['docx.export'])
    })

    const artifactBytes = Buffer.from(exportResult.bytes)
    const exportArtifactEvidence = createExportArtifactEvidence(input.target.exportArtifact, artifactBytes)

    await mkdir(dirname(input.target.exportArtifact), { recursive: true })
    await writeFile(input.target.exportArtifact, artifactBytes)

    const externalOpenXmlValidation = readBoundOpenXmlValidationResult(input.fixture.id, exportArtifactEvidence)
    const commandOpenXmlValidation = externalOpenXmlValidation === null
      ? runOpenXmlValidation(input.target.exportArtifact)
      : null
    const appResults = runAppCompatibilityChecks(input.fixture.id, input.target.exportArtifact, exportArtifactEvidence)
    const report = await input.docxRuntime.createDocxCompatibilityReport(exportResult.bytes, {
      fixtureId: input.fixture.id,
      exportArtifact: input.target.exportArtifact,
      requestId: `${input.fixture.id}-compat-report`,
      license: createGate5CompatibilityLicense(input.licenseRuntime, ['docx.import', 'docx.export']),
      ...(externalOpenXmlValidation?.kind === 'validation'
        ? { openXmlValidation: externalOpenXmlValidation.validation }
        : {}),
      ...(externalOpenXmlValidation?.kind === 'check'
        ? { openXmlValidator: externalOpenXmlValidation.check }
        : {}),
      ...(commandOpenXmlValidation === null ? {} : { openXmlValidation: commandOpenXmlValidation }),
      appResults
    })

    return {
      fixtureId: input.fixture.id,
      status: 'reported',
      sourceInput: input.fixture.input.path,
      exportArtifact: input.target.exportArtifact,
      exportArtifactEvidence,
      importWarningCount: importResult.warnings.length,
      exportWarningCount: exportResult.warnings.length,
      report
    }
  } finally {
    editor.destroy()
  }
}

/** 创建兼容 runner 使用的本地商业授权。 */
function createGate5CompatibilityLicense(licenseRuntime, features) {
  const entitlement = {
    customerId: 'customer-gate5-compatibility-runner',
    licenseToken: 'token-gate5-compatibility-runner',
    features,
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2026-06-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: licenseRuntime.createJWordLicenseSignature(entitlement)
  }
}

/** 为缺少输入 fixture 的目标创建 pending 结果。 */
function createSkippedFixtureResult(target, fixture) {
  return {
    fixtureId: target.fixtureId,
    status: 'pending',
    sourceInput: fixture?.input?.path ?? 'missing-registry-entry',
    exportArtifact: target.exportArtifact,
    blockingIssue: fixture === undefined
      ? 'Fixture registry entry is missing.'
      : 'Fixture input is not available on disk yet.',
    openXmlValidation: createSkippedOpenXmlValidationResult(target.fixtureId),
    appResults: createSkippedAppResults(target.fixtureId)
  }
}

/** 为缺少输入的目标保留外部 validator 证据或显式 pending。 */
function createSkippedOpenXmlValidationResult(fixtureId) {
  const validation = readOpenXmlValidationResult(fixtureId)

  if (validation === null) {
    return {
      result: 'pending',
      evidence: 'not-run'
    }
  }

  return createOpenXmlValidationSummary(validation)
}

/** 为缺少输入的目标保留人工应用证据，不启动外部应用。 */
function createSkippedAppResults(fixtureId) {
  return [
    readManualAppResult(fixtureId, 'Word') ?? createPendingAppResult('Word'),
    readManualAppResult(fixtureId, 'WPS') ?? createPendingAppResult('WPS'),
    readManualAppResult(fixtureId, 'LibreOffice') ?? createPendingAppResult('LibreOffice')
  ]
}


/** 运行 Open XML validator；缺工具时返回 null，由报告保持 pending。 */
function runOpenXmlValidation(artifactPath) {
  if (toolAvailability.openXmlValidator.status === 'missing') {
    return null
  }

  const command = toolAvailability.openXmlValidator.command
  const result = command === 'openxml'
    ? runCommand(command, ['validate', artifactPath], { timeoutMs: openXmlValidatorTimeoutMs })
    : runConfiguredValidatorCommand(command, artifactPath)
  const commandValidation = readOpenXmlValidationCommandResult(command, result)

  if (commandValidation !== null) {
    return commandValidation
  }

  if (result.status === 0) {
    return {
      evidence: formatCommandEvidence(command, result),
      diagnostics: []
    }
  }

  return {
    evidence: formatCommandEvidence(command, result),
    diagnostics: [
      {
        severity: 'error',
        message: readCommandFailureMessage(result),
        code: 'OPEN_XML_VALIDATOR_EXIT',
        part: basename(artifactPath)
      }
    ]
  }
}

/** 从 validator 命令 JSON 输出读取结构化诊断。 */
function readOpenXmlValidationCommandResult(command, result) {
  const payload = readJsonObjectFromCommandOutput(result.stdout) ??
    readJsonObjectFromCommandOutput(result.stderr)

  if (!isOpenXmlValidationCommandResult(payload)) {
    return null
  }

  return {
    evidence: payload.evidence ?? formatCommandEvidence(command, result),
    diagnostics: payload.diagnostics.map(normalizeOpenXmlValidationDiagnostic)
  }
}

/** 从命令输出中读取 JSON 对象。 */
function readJsonObjectFromCommandOutput(output) {
  const text = output.trim()

  if (text.length === 0) {
    return null
  }

  try {
    const value = JSON.parse(text)

    return typeof value === 'object' && value !== null ? value : null
  } catch {
    return null
  }
}

/** 判断命令输出是否是 validator 结构化结果。 */
function isOpenXmlValidationCommandResult(value) {
  return typeof value === 'object' &&
    value !== null &&
    isOptionalStringField(value, 'evidence') &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isOpenXmlValidationDiagnostic)
}

/** 运行 Word/WPS/LibreOffice 兼容检查，缺工具或只能人工时保留 pending。 */
function runAppCompatibilityChecks(fixtureId, artifactPath, exportArtifactEvidence) {
  return [
    readBoundManualAppResult(fixtureId, 'Word', exportArtifactEvidence) ??
      createManualAppResult('Word', toolAvailability.word),
    readBoundManualAppResult(fixtureId, 'WPS', exportArtifactEvidence) ??
      createManualAppResult('WPS', toolAvailability.wps, artifactPath),
    readBoundManualAppResult(fixtureId, 'LibreOffice', exportArtifactEvidence) ??
      runLibreOfficeCompatibility(artifactPath)
  ]
}

/** 创建需要人工打开的办公套件 pending 结果。 */
function createManualAppResult(app, availability, artifactPath) {
  const processEvidence = app === 'WPS' && artifactPath !== undefined
    ? readWpsOpenArtifactEvidence(artifactPath)
    : null

  return {
    app,
    result: 'pending',
    editable: 'pending',
    repairPrompt: 'pending',
    mainVisualDifference: 'pending',
    blockingIssue: availability.status === 'missing'
      ? `${app} is not installed on this machine.`
      : processEvidence?.blockingIssue ?? `${app} requires manual open/edit/save verification.`,
    evidence: availability.status === 'missing'
      ? 'not-run'
      : [availability.evidence, processEvidence?.evidence].filter((part) => part !== undefined).join('; ')
  }
}

/** 读取 WPS 是否已经打开导出 artifact 的只读进程证据。 */
function readWpsOpenArtifactEvidence(artifactPath) {
  const absoluteArtifactPath = resolve(artifactPath)
  const output = readWpsProcessLsofOutput()

  if (!output.includes(artifactPath) && !output.includes(absoluteArtifactPath)) {
    return null
  }

  return {
    blockingIssue: 'WPS process opened the exported artifact, but repair prompt, editability, visual difference, and save evidence still require UI verification.',
    evidence: `lsof shows WPS opened ${absoluteArtifactPath}`
  }
}

/** 读取 WPS 进程 lsof 输出；测试可用环境变量注入稳定样本。 */
function readWpsProcessLsofOutput() {
  if (process.env.GATE5_WPS_PROCESS_LSOF_OUTPUT !== undefined) {
    return process.env.GATE5_WPS_PROCESS_LSOF_OUTPUT
  }

  if (cachedWpsProcessLsofOutput !== null) {
    return cachedWpsProcessLsofOutput
  }

  const pgrepResult = runCommand('pgrep', ['-x', 'wpsoffice'])

  if (pgrepResult.status !== 0) {
    cachedWpsProcessLsofOutput = ''

    return ''
  }

  cachedWpsProcessLsofOutput = pgrepResult.stdout
    .split(/\s+/)
    .filter((pid) => /^\d+$/.test(pid))
    .map((pid) => runCommand('lsof', ['-n', '-p', pid]).stdout)
    .join('\n')

  return cachedWpsProcessLsofOutput
}

/** 用 LibreOffice headless 转换作为可选离线打开烟测。 */
function runLibreOfficeCompatibility(artifactPath) {
  const availability = toolAvailability.libreOffice

  if (availability.status === 'missing') {
    return createManualAppResult('LibreOffice', availability)
  }

  const outputDir = 'fixtures/docx/compatibility-libreoffice'
  const result = runCommand(availability.command, [
    '--headless',
    '--convert-to',
    'pdf',
    '--outdir',
    outputDir,
    artifactPath
  ])
  const expectedPdfPath = join(outputDir, `${basename(artifactPath, '.docx')}.pdf`)

  if (result.status === 0 && existsSync(expectedPdfPath)) {
    return {
      app: 'LibreOffice',
      result: 'pass',
      editable: 'pending',
      repairPrompt: 'pending',
      mainVisualDifference: 'pending',
      blockingIssue: '',
      evidence: formatCommandEvidence(availability.command, result)
    }
  }

  return {
    app: 'LibreOffice',
    result: 'fail',
    editable: 'pending',
    repairPrompt: 'pending',
    mainVisualDifference: 'pending',
    blockingIssue: readCommandFailureMessage(result),
    evidence: formatCommandEvidence(availability.command, result)
  }
}

/** 创建单个 pending 办公套件结果。 */
function createPendingAppResult(app) {
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

/** 读取并校验当前导出 artifact 绑定的人工办公套件结果。 */
function readBoundManualAppResult(fixtureId, app, exportArtifactEvidence) {
  const result = readManualAppResult(fixtureId, app)

  if (result === null) {
    return null
  }

  if (hasArtifactEvidenceMismatch(result, exportArtifactEvidence)) {
    return createStaleManualAppResult(app, result, exportArtifactEvidence)
  }

  if (hasManualCompatibilityConclusion(result) && !hasCompleteArtifactEvidence(result, exportArtifactEvidence)) {
    return createUnboundManualAppResult(app, result, exportArtifactEvidence)
  }

  return createBoundManualAppResult(result)
}

/** 读取并校验当前导出 artifact 绑定的 Open XML validator 结果。 */
function readBoundOpenXmlValidationResult(fixtureId, exportArtifactEvidence) {
  const validation = readOpenXmlValidationResult(fixtureId)

  if (validation === null) {
    return null
  }

  if (hasArtifactEvidenceMismatch(validation, exportArtifactEvidence)) {
    return {
      kind: 'check',
      check: createStaleOpenXmlValidatorCheck(validation, exportArtifactEvidence)
    }
  }

  if (!hasCompleteArtifactEvidence(validation, exportArtifactEvidence)) {
    return {
      kind: 'check',
      check: createUnboundOpenXmlValidatorCheck(validation, exportArtifactEvidence)
    }
  }

  return {
    kind: 'validation',
    validation
  }
}

/** 判断外部证据中声明的 artifact 是否与当前导出不一致。 */
function hasArtifactEvidenceMismatch(result, exportArtifactEvidence) {
  return (result.exportArtifact !== undefined && result.exportArtifact !== exportArtifactEvidence.path) ||
    (result.artifactSha256 !== undefined && result.artifactSha256 !== exportArtifactEvidence.sha256) ||
    (result.artifactByteLength !== undefined && result.artifactByteLength !== exportArtifactEvidence.byteLength)
}

/** 判断外部证据是否完整声明并匹配当前导出 artifact。 */
function hasCompleteArtifactEvidence(result, exportArtifactEvidence) {
  return result.exportArtifact === exportArtifactEvidence.path &&
    result.artifactSha256 === exportArtifactEvidence.sha256 &&
    result.artifactByteLength === exportArtifactEvidence.byteLength
}

/** 判断人工证据是否已经给出兼容结论。 */
function hasManualCompatibilityConclusion(result) {
  return result.result !== 'pending' ||
    result.editable !== 'pending' ||
    result.repairPrompt !== 'pending' ||
    result.mainVisualDifference !== 'pending'
}

/** 创建不泄漏 artifact 绑定字段的人工结果。 */
function createBoundManualAppResult(result) {
  return {
    app: result.app,
    result: result.result,
    editable: result.editable,
    repairPrompt: result.repairPrompt,
    mainVisualDifference: result.mainVisualDifference,
    blockingIssue: result.blockingIssue,
    evidence: result.evidence
  }
}

/** 创建未绑定 artifact 的人工证据降级结果。 */
function createUnboundManualAppResult(app, result, exportArtifactEvidence) {
  return {
    app,
    result: 'pending',
    editable: 'pending',
    repairPrompt: 'pending',
    mainVisualDifference: 'pending',
    blockingIssue: `External ${app} evidence does not declare current export artifact binding.`,
    evidence: [
      `ignored unbound ${app} evidence`,
      `current artifact SHA-256: ${exportArtifactEvidence.sha256}`,
      readMissingArtifactEvidenceSummary(result)
    ].filter((part) => part.length > 0).join('; ')
  }
}

/** 创建 stale 人工证据降级结果，防止旧 artifact 证据误算通过。 */
function createStaleManualAppResult(app, result, exportArtifactEvidence) {
  return {
    app,
    result: 'pending',
    editable: 'pending',
    repairPrompt: 'pending',
    mainVisualDifference: 'pending',
    blockingIssue: `External ${app} evidence artifact does not match current export artifact.`,
    evidence: [
      `ignored stale ${app} evidence`,
      `current artifact SHA-256: ${exportArtifactEvidence.sha256}`,
      readExternalArtifactEvidenceSummary(result)
    ].filter((part) => part.length > 0).join('; ')
  }
}

/** 创建 stale Open XML validator 降级检查，防止旧 artifact 证据误算通过。 */
function createStaleOpenXmlValidatorCheck(validation, exportArtifactEvidence) {
  return {
    kind: 'open-xml-validator',
    result: 'pending',
    evidence: 'ignored stale Open XML validator evidence',
    blockingIssue: 'External Open XML validator evidence artifact does not match current export artifact.',
    diagnosticCount: validation.diagnostics.length,
    currentArtifactSha256: exportArtifactEvidence.sha256
  }
}

/** 创建未绑定 artifact 的 Open XML validator 降级检查。 */
function createUnboundOpenXmlValidatorCheck(validation, exportArtifactEvidence) {
  return {
    kind: 'open-xml-validator',
    result: 'pending',
    evidence: 'ignored unbound Open XML validator evidence',
    blockingIssue: 'External Open XML validator evidence does not declare current export artifact binding.',
    diagnosticCount: validation.diagnostics.length,
    currentArtifactSha256: exportArtifactEvidence.sha256
  }
}

/** 汇总外部证据声明的 artifact 字段。 */
function readExternalArtifactEvidenceSummary(result) {
  return [
    result.exportArtifact === undefined ? '' : `external artifact path: ${result.exportArtifact}`,
    result.artifactByteLength === undefined ? '' : `external byteLength: ${result.artifactByteLength}`,
    result.artifactSha256 === undefined ? '' : `external SHA-256: ${result.artifactSha256}`
  ].filter((part) => part.length > 0).join('; ')
}

/** 汇总外部证据缺失的 artifact 绑定字段。 */
function readMissingArtifactEvidenceSummary(result) {
  const missingFields = [
    result.exportArtifact === undefined ? 'exportArtifact' : '',
    result.artifactByteLength === undefined ? 'artifactByteLength' : '',
    result.artifactSha256 === undefined ? 'artifactSha256' : ''
  ].filter((field) => field.length > 0)

  return missingFields.length === 0 ? '' : `missing artifact fields: ${missingFields.join(', ')}`
}

/** 读取人工办公套件验证结果，缺文件时保持 runner 零配置可运行。 */
async function readManualAppResults(path) {
  if (!existsSync(path)) {
    return new Map()
  }

  const document = await readJson(path)
  const results = Array.isArray(document.results) ? document.results : []
  const resultByKey = new Map()

  for (const [resultIndex, result] of results.entries()) {
    if (!isManualAppResult(result)) {
      evidenceInputDiagnostics.push(createEvidenceInputDiagnostic(
        'manual-compatibility-results',
        path,
        resultIndex,
        'Invalid manual compatibility evidence result.'
      ))
      continue
    }

    resultByKey.set(createManualAppResultKey(result.fixtureId, result.app), {
      app: result.app,
      result: result.result,
      editable: result.editable,
      repairPrompt: result.repairPrompt,
      mainVisualDifference: result.mainVisualDifference,
      blockingIssue: result.blockingIssue,
      evidence: result.evidence,
      ...readExternalArtifactEvidence(result)
    })
  }

  return resultByKey
}

/** 读取外部 Open XML validator 结果，缺文件时保持 validator pending。 */
async function readOpenXmlValidationResults(path) {
  if (!existsSync(path)) {
    return new Map()
  }

  const document = await readJson(path)
  const results = Array.isArray(document.results) ? document.results : []
  const resultByFixtureId = new Map()

  for (const [resultIndex, result] of results.entries()) {
    if (!isOpenXmlValidationResult(result)) {
      evidenceInputDiagnostics.push(createEvidenceInputDiagnostic(
        'openxml-validation-results',
        path,
        resultIndex,
        'Invalid Open XML validation evidence result.'
      ))
      continue
    }

    resultByFixtureId.set(result.fixtureId, {
      evidence: result.evidence,
      diagnostics: result.diagnostics.map(normalizeOpenXmlValidationDiagnostic),
      ...readExternalArtifactEvidence(result)
    })
  }

  return resultByFixtureId
}

/** 创建外部证据输入诊断，避免无效证据被静默忽略。 */
function createEvidenceInputDiagnostic(source, path, resultIndex, issue) {
  return {
    source,
    path,
    resultIndex,
    issue
  }
}

/** 查询单个 fixture 的人工办公套件结果。 */
function readManualAppResult(fixtureId, app) {
  return manualAppResultByKey.get(createManualAppResultKey(fixtureId, app)) ?? null
}

/** 查询单个 fixture 的外部 Open XML validator 结果。 */
function readOpenXmlValidationResult(fixtureId) {
  return openXmlValidationByFixtureId.get(fixtureId) ?? null
}

/** 创建人工办公套件结果索引键。 */
function createManualAppResultKey(fixtureId, app) {
  return `${fixtureId}:${app}`
}

/** 读取外部证据可选 artifact 绑定字段。 */
function readExternalArtifactEvidence(result) {
  return {
    ...(result.exportArtifact === undefined ? {} : { exportArtifact: result.exportArtifact }),
    ...(result.artifactSha256 === undefined ? {} : { artifactSha256: result.artifactSha256 }),
    ...(result.artifactByteLength === undefined ? {} : { artifactByteLength: result.artifactByteLength })
  }
}

/** 判断人工结果是否具备报告必需字段。 */
function isManualAppResult(value) {
  return isStringField(value, 'fixtureId') &&
    isManualAppName(value?.app) &&
    isCompatibilityResult(value?.result) &&
    isCompatibilityResult(value?.editable) &&
    isManualObservationResult(value?.repairPrompt) &&
    isManualObservationResult(value?.mainVisualDifference) &&
    isStringField(value, 'blockingIssue') &&
    isStringField(value, 'evidence') &&
    isOptionalArtifactEvidence(value)
}

/** 判断人工证据 app 是否属于 Gate 5 矩阵目标。 */
function isManualAppName(value) {
  return value === 'Word' || value === 'WPS' || value === 'LibreOffice'
}

/** 判断人工证据状态是否属于兼容报告支持的枚举。 */
function isCompatibilityResult(value) {
  return value === 'pass' ||
    value === 'warn' ||
    value === 'fail' ||
    value === 'blocked' ||
    value === 'pending'
}

/** 判断人工证据观察值是否属于兼容状态或无差异/无修复提示。 */
function isManualObservationResult(value) {
  return value === 'none' || isCompatibilityResult(value)
}

/** 判断外部 validator 结果是否具备报告必需字段。 */
function isOpenXmlValidationResult(value) {
  return isStringField(value, 'fixtureId') &&
    isStringField(value, 'evidence') &&
    typeof value === 'object' &&
    value !== null &&
    Array.isArray(value.diagnostics) &&
    value.diagnostics.every(isOpenXmlValidationDiagnostic) &&
    isOptionalArtifactEvidence(value)
}

/** 判断外部证据的可选 artifact 绑定字段是否有效。 */
function isOptionalArtifactEvidence(value) {
  return isOptionalStringField(value, 'exportArtifact') &&
    isOptionalStringField(value, 'artifactSha256') &&
    isOptionalNumberField(value, 'artifactByteLength')
}

/** 判断单条 validator 诊断是否具备必需字段。 */
function isOpenXmlValidationDiagnostic(value) {
  return isStringField(value, 'severity') &&
    isOpenXmlValidationSeverity(value.severity) &&
    isStringField(value, 'message') &&
    isOptionalStringField(value, 'code') &&
    isOptionalStringField(value, 'part') &&
    isOptionalStringField(value, 'path')
}

/** 判断 validator 诊断级别是否是报告层支持的值。 */
function isOpenXmlValidationSeverity(value) {
  return value === 'error' || value === 'warning' || value === 'info'
}

/** 归一化 validator 诊断，避免把未定义字段写入报告。 */
function normalizeOpenXmlValidationDiagnostic(diagnostic) {
  return {
    severity: diagnostic.severity,
    message: diagnostic.message,
    ...(diagnostic.code === undefined ? {} : { code: diagnostic.code }),
    ...(diagnostic.part === undefined ? {} : { part: diagnostic.part }),
    ...(diagnostic.path === undefined ? {} : { path: diagnostic.path })
  }
}

/** 判断未知值是否包含指定字符串字段。 */

/** 读取当前本机可选外部工具状态。 */
function createToolAvailability() {
  return {
    openXmlValidator: findOpenXmlValidator(),
    libreOffice: findCommandTool('LibreOffice', ['soffice', 'libreoffice']),
    word: findMacApplicationTool('Word', [
      '/Applications/Microsoft Word.app'
    ]),
    wps: findMacApplicationTool('WPS', readMacApplicationCandidates('GATE5_WPS_APP_PATH', [
      '/Applications/WPS Office.app',
      '/Applications/wpsoffice.app',
      '/Applications/WPS.app'
    ]))
  }
}

/** 读取 macOS 应用候选路径，允许测试注入临时 app 路径。 */
function readMacApplicationCandidates(envName, defaultPaths) {
  const configuredPath = process.env[envName]

  return configuredPath === undefined || configuredPath.trim().length === 0
    ? defaultPaths
    : [configuredPath, ...defaultPaths]
}

/** 查找 Open XML validator 命令或显式配置。 */
function findOpenXmlValidator() {
  const configuredCommand = process.env.OPENXML_VALIDATOR_COMMAND

  if (configuredCommand !== undefined && configuredCommand.trim().length > 0) {
    return {
      status: 'available',
      command: configuredCommand,
      evidence: 'OPENXML_VALIDATOR_COMMAND'
    }
  }

  return findCommandTool('Open XML validator', ['openxml'])
}

/** 从候选命令中找到第一个可执行工具。 */
function findCommandTool(name, commands) {
  for (const command of commands) {
    if (commandExists(command)) {
      return {
        status: 'available',
        command,
        evidence: `${name} command found: ${command}`
      }
    }
  }

  return {
    status: 'missing',
    evidence: `${name} command was not found.`
  }
}

/** 从 macOS 应用路径中找到已安装应用。 */
function findMacApplicationTool(name, paths) {
  for (const path of paths) {
    if (existsSync(path)) {
      return {
        status: 'available',
        appPath: path,
        evidence: `${name} app found: ${path}`
      }
    }
  }

  return {
    status: 'missing',
    evidence: `${name} app was not found in /Applications.`
  }
}

/** 运行显式配置的 Open XML validator 命令。 */
function runConfiguredValidatorCommand(command, artifactPath) {
  let parts

  try {
    parts = parseCommandTemplate(command)
  } catch (error) {
    return {
      status: 1,
      stdout: '',
      stderr: error instanceof Error ? error.message : 'OPENXML_VALIDATOR_COMMAND could not be parsed.'
    }
  }

  const commandParts = expandCommandTemplateParts(parts, artifactPath)
  const executable = commandParts[0]

  if (executable === undefined) {
    return {
      status: 1,
      stdout: '',
      stderr: 'OPENXML_VALIDATOR_COMMAND is empty.'
    }
  }

  return runCommand(executable, commandParts.slice(1), { timeoutMs: openXmlValidatorTimeoutMs })
}
