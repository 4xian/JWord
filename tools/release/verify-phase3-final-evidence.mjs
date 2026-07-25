/**
 * 职责：交叉校验 Phase 3 五个 handoff，并生成或复核唯一 final record。
 * 边界：只读取显式 source/run-a/consumer/audit/repro root，只写显式 repo 外 final root。
 * 协作模块：artifact utils、consumer evidence、size/SBOM/provenance 与 reproducibility compare。
 * 性能/安全约束：拒绝 symlink、缺失/额外文件、摘要替代原始 bytes 和非 canonical sidecar。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPhase3SizeEvidence } from './check-phase3-artifact-size.mjs'
import { validateConsumerInstallEvidence } from './check-phase3-third-party-consumers.mjs'
import { generatePhase3Provenance } from './generate-phase3-provenance.mjs'
import { generatePhase3Sbom } from './generate-phase3-sbom.mjs'
import {
  collectAssemblyDependencyEvidence,
  collectAssemblyDependencyPairs,
  compareDependencyEvidence,
  lockfileExcludesAssemblyEnvironment,
  lockfileMarksDependencyOptional,
  lockfileParentMarksDependencyOptional,
  normalizeExternalDependencyPath,
  validateAssemblyDependencyGraph
} from './phase3-assembly-dependencies.mjs'
import { validateReleaseReadiness, validateRollbackEvidence } from './phase3-release-policy-utils.mjs'
import {
  createConsumerProjectManifest,
  createConsumerSourceId,
  createConsumerSourceInventory,
  readProductionGoldenToken
} from './phase3-consumer-projects.mjs'
import {
  assertPhase3PathOutside,
  canonicalBytes,
  createPayloadSha256,
  createSha256Sidecar,
  readCurrentEnvironment,
  readGitIdentity,
  readJsonFile,
  sha256,
  sha256File,
  validateArtifactBinding,
  validateArtifactManifest,
  validateArtifactManifestForComparison,
  validateSha256Sidecar,
  validateSourceReport,
  validateTestReport,
  writeCanonicalJson
} from './phase3-artifact-utils.mjs'
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
const rollbackFixturePath = join(repoRoot, 'fixtures/release/rollback-state.json')
const releasePolicyFixturePath = join(repoRoot, 'fixtures/release/release-policy.json')
const builderIdentityPaths = [
  'rollup.config.mjs',
  'tools/release/build-phase3-artifacts.mjs',
  'tools/release/check-package-artifacts.mjs',
  'tools/release/normalize-dist-relative-imports.mjs',
  'tools/release/phase3-artifact-utils.mjs'
]
/** 校验所有 handoff 并返回可写入 final record 的固定字段。 */
export function verifyPhase3FinalEvidence(options) {
  const source = readSourceRoot(options.sourceRoot)
  const runA = readRunARoot(options.runARoot, source)
  const contractRecord = readJsonFile(contractPath, 'package artifact contract')
  const contract = contractRecord.value
  validateRunARepositoryContract(runA.manifest, contractRecord.bytes, contract, readBuilderSha256())
  validateCurrentRepositoryIdentity(runA.manifest)
  const consumerManifestSha256 = validateConsumerRoot(options.consumerRoot, runA, contract)
  const auditManifestSha256 = validateAuditRoot(options.auditRoot, runA, contract, options.consumerRoot)
  const reproducibilityManifestSha256 = validateReproducibilityRoot(options.reproducibilityRoot, runA)
  return {
    schemaVersion: 1,
    gitSha: runA.manifest.artifactIdentity.gitSha,
    lockfileSha256: runA.manifest.artifactIdentity.lockfileSha256,
    artifactSetId: runA.manifest.artifactSetId,
    bindingSha256: sha256(runA.bindingBytes),
    artifactManifestSha256: sha256(runA.manifestBytes),
    sha256SumsSha256: sha256(runA.checksumBytes),
    sourceReportSha256: sha256(source.reportBytes),
    testReportSha256: sha256(runA.testReportBytes),
    consumerEvidenceManifestSha256: consumerManifestSha256,
    auditEvidenceManifestSha256: auditManifestSha256,
    reproducibilityEvidenceManifestSha256: reproducibilityManifestSha256,
    status: 'passed'
  }
}
/** 校验 run-a identity 与 contract raw bytes、builder hash 和 package mapping。 */
export function validateRunARepositoryContract(manifest, contractBytes, contract, builderSha256) {
  const identity = manifest.artifactIdentity
  if (identity.contractSha256 !== sha256(contractBytes) || identity.builderSha256 !== builderSha256) {
    throw new Error('run-a repository hash mismatch')
  }
  const actual = identity.packages.map(function readPackage(entry) {
    return { name: entry.name, version: entry.version, delivery: entry.delivery }
  })
  const expected = contract.packages.map(function readPackage(entry) {
    return { name: entry.name, version: entry.version, delivery: entry.delivery }
  }).sort(function comparePackage(left, right) { return left.name < right.name ? -1 : left.name > right.name ? 1 : 0 })
  if (!canonicalBytes(actual).equals(canonicalBytes(expected))) throw new Error('run-a package contract mismatch')
}
/** 校验 run-a identity 与当前 checkout、lockfile 和实际工具环境。 */
function validateCurrentRepositoryIdentity(manifest) {
  const identity = manifest.artifactIdentity
  const gitIdentity = readGitIdentity(repoRoot)
  if (identity.gitSha !== gitIdentity.gitSha || identity.lockfileSha256 !== sha256File(join(repoRoot, 'pnpm-lock.yaml')) ||
      !canonicalBytes(identity.environment).equals(canonicalBytes(readCurrentEnvironment(repoRoot)))) {
    throw new Error('run-a repository identity mismatch')
  }
}
/** 从五个冻结 source path 重算 builder composite hash。 */
function readBuilderSha256() {
  const entries = builderIdentityPaths.slice().sort().map(function hashBuilderFile(path) {
    return { path, sha256: sha256File(join(repoRoot, path)) }
  })
  return sha256(canonicalBytes(entries))
}
/** 校验当前 job 工具环境与 source report/run-a identity 逐字一致。 */
export function validatePhase3JobEnvironment(sourceReportPath, artifactManifestPath) {
  let expectedEnvironment
  let expectedGitSha
  let expectedLockfileSha256
  if (sourceReportPath !== undefined) {
    const source = readCanonicalJsonFile(resolve(sourceReportPath), 'source report')
    validateSourceReport(source.value)
    expectedEnvironment = source.value.environment
    expectedGitSha = source.value.gitSha
    expectedLockfileSha256 = source.value.lockfileSha256
  }
  if (artifactManifestPath !== undefined) {
    const manifestPath = resolve(artifactManifestPath)
    const record = readCanonicalJsonFile(manifestPath, 'artifact manifest')
    const manifest = validateArtifactManifest(record.value, readFileSync(join(resolve(manifestPath, '..'), 'SHA256SUMS')))
    if (expectedEnvironment !== undefined && (!canonicalBytes(expectedEnvironment).equals(canonicalBytes(manifest.artifactIdentity.environment)) ||
        expectedGitSha !== manifest.artifactIdentity.gitSha || expectedLockfileSha256 !== manifest.artifactIdentity.lockfileSha256)) {
      throw new Error('source report and artifact environment mismatch')
    }
    expectedEnvironment = manifest.artifactIdentity.environment
    expectedGitSha = manifest.artifactIdentity.gitSha
    expectedLockfileSha256 = manifest.artifactIdentity.lockfileSha256
  }
  if (expectedEnvironment === undefined) throw new Error('source report or artifact manifest is required')
  const actualEnvironment = readCurrentEnvironment(repoRoot)
  if (!canonicalBytes(actualEnvironment).equals(canonicalBytes(expectedEnvironment))) throw new Error('job environment mismatch')
  const actualGitSha = readGitIdentity(repoRoot).gitSha
  const actualLockfileSha256 = sha256File(join(repoRoot, 'pnpm-lock.yaml'))
  if (actualGitSha !== expectedGitSha || actualLockfileSha256 !== expectedLockfileSha256) {
    throw new Error('job repository identity mismatch')
  }
  return actualEnvironment
}
/** 读取并语义校验 source-report handoff。 */
function readSourceRoot(root) {
  assertRootFiles(root, ['source-report.json', 'source-report.json.sha256'], 'source report')
  const reportRecord = readCanonicalJsonFile(join(root, 'source-report.json'), 'source report')
  const sidecarBytes = readFileSync(join(root, 'source-report.json.sha256'))
  validateSha256Sidecar(sidecarBytes, reportRecord.bytes, 'source report')
  validateSourceReport(reportRecord.value)
  return { report: reportRecord.value, reportBytes: reportRecord.bytes }
}
/** 读取并从原始 tarball bytes 校验唯一 run-a root。 */
function readRunARoot(root, source) {
  const manifestRecord = readCanonicalJsonFile(join(root, 'artifact-manifest.json'), 'artifact manifest')
  const checksumBytes = readFileSync(join(root, 'SHA256SUMS'))
  const manifest = validateArtifactManifest(manifestRecord.value, checksumBytes)
  const expectedFiles = [
    'SHA256SUMS',
    'artifact-binding.json',
    'artifact-manifest.json',
    'test-report.json',
    ...manifest.artifactIdentity.packages.map(function readTarball(entry) { return entry.tarballFile })
  ].sort()
  assertRootFiles(root, expectedFiles, 'run-a')
  const bindingRecord = readCanonicalJsonFile(join(root, 'artifact-binding.json'), 'artifact binding')
  const binding = validateArtifactBinding(bindingRecord.value, manifestRecord.bytes, manifest, checksumBytes)
  const testReportRecord = readCanonicalJsonFile(join(root, 'test-report.json'), 'test report')
  validateTestReport(testReportRecord.value, { gitSha: manifest.artifactIdentity.gitSha, artifactSetId: manifest.artifactSetId })
  if (binding.sourceReportSha256 !== sha256(source.reportBytes) || binding.testReportSha256 !== sha256(testReportRecord.bytes) ||
      source.report.gitSha !== manifest.artifactIdentity.gitSha ||
      source.report.lockfileSha256 !== manifest.artifactIdentity.lockfileSha256 ||
      canonicalBytes(source.report.environment).compare(canonicalBytes(manifest.artifactIdentity.environment)) !== 0) {
    throw new Error('run-a source/test binding mismatch')
  }
  for (const packageEntry of manifest.artifactIdentity.packages) verifyTarball(root, packageEntry)
  return {
    root,
    manifest,
    manifestBytes: manifestRecord.bytes,
    checksumBytes,
    binding,
    bindingBytes: bindingRecord.bytes,
    testReportBytes: testReportRecord.bytes
  }
}
/** 校验 consumer root、contract 展开集合和实际 source/bundle bytes。 */
export function validateConsumerRoot(root, runA, contract) {
  const evidenceManifestSha256 = validateEvidenceManifest(root, 'consumer')
  const summary = readCanonicalJsonFile(join(root, 'consumer-evidence.json'), 'consumer summary').value
  validateSummary(summary, 'consumer', runA)
  const installEvidence = readCanonicalJsonFile(join(root, 'install-evidence.json'), 'install evidence').value
  const journeyEvidence = readCanonicalJsonFile(join(root, 'journey-evidence.json'), 'journey evidence').value
  const exportEvidence = readCanonicalJsonFile(join(root, 'export-evidence.json'), 'export evidence').value
  const bundleEvidence = readCanonicalJsonFile(join(root, 'bundle-evidence.json'), 'bundle evidence').value
  assertExactKeys(installEvidence, ['artifactSetId', 'installs', 'schemaVersion'], 'install evidence')
  assertExactKeys(journeyEvidence, ['artifactSetId', 'journeys', 'schemaVersion'], 'journey evidence')
  assertExactKeys(exportEvidence, ['artifactSetId', 'exports', 'schemaVersion'], 'export evidence')
  assertExactKeys(bundleEvidence, ['artifactSetId', 'bundles', 'schemaVersion'], 'bundle evidence')
  for (const value of [installEvidence, journeyEvidence, exportEvidence, bundleEvidence]) {
    if (value.schemaVersion !== 1 || value.artifactSetId !== runA.manifest.artifactSetId) throw new Error('consumer payload identity mismatch')
  }
  const expectedFiles = new Set(['bundle-evidence.json', 'consumer-evidence.json', 'export-evidence.json', 'install-evidence.json', 'journey-evidence.json'])
  const expectedInstallIds = contract.journeys.flatMap(function expandJourney(journey) {
    return ['npm', 'pnpm'].map(function createId(manager) { return `${journey.id}--${manager}` })
  }).sort()
  const runAPackages = new Map(runA.manifest.artifactIdentity.packages.map(function indexPackage(entry) { return [entry.name, entry] }))
  const installIds = installEvidence.installs.map(function readId(entry) {
    const journey = contract.journeys.find(function findJourney(candidate) { return candidate.id === entry.journey })
    if (journey === undefined || !canonicalBytes(entry.requestedPackages).equals(canonicalBytes(journey.requestedPackages)) ||
        !canonicalBytes(entry.firstPartyClosure).equals(canonicalBytes(journey.firstPartyClosure))) {
      throw new Error('consumer install contract mismatch')
    }
    validateConsumerInstallEvidence(entry, root)
    const packages = [...journey.requestedPackages, ...journey.firstPartyClosure].map(function readPackage(name) {
      const packageEntry = runAPackages.get(name)
      if (packageEntry === undefined) throw new Error(`consumer package missing: ${name}`)
      return packageEntry
    })
    const expectedManifest = createConsumerProjectManifest(journey, packages, contract)
    const actualManifest = readJsonFile(join(root, entry.manifestPath), 'consumer package manifest').value
    if (!canonicalBytes(actualManifest).equals(canonicalBytes(expectedManifest)) ||
        entry.packageManagerVersion !== runA.manifest.artifactIdentity.environment[entry.packageManager]) {
      throw new Error('consumer install environment mismatch')
    }
    for (const pathKey of ['manifestPath', 'lockfilePath', 'dependencyTreePath', 'registryConfigPath', 'registryEvidencePath', 'registryTranscriptPath']) {
      expectedFiles.add(entry[pathKey])
    }
    readCanonicalJsonFile(join(root, entry.registryEvidencePath), 'consumer registry evidence')
    const transcript = readCanonicalJsonFile(join(root, entry.registryTranscriptPath), 'consumer registry transcript').value
    const prefix = entry.registryTranscriptPath.slice(0, -'registry-transcript.json'.length)
    for (const request of transcript.requests) expectedFiles.add(`${prefix}${request.responsePath}`)
    return entry.id
  })
  assertSameUniqueStrings([...installIds].sort(), expectedInstallIds, 'consumer install set')
  const installVersions = new Map(installEvidence.installs.map(function indexInstall(entry) { return [entry.id, entry.packageManagerVersion] }))
  validateJourneyEntries(journeyEvidence.journeys, contract, installVersions)
  const sources = createConsumerSourceInventory(contract, readProductionGoldenToken(repoRoot))
  for (const path of validateConsumerSourceEvidence(root, sources)) expectedFiles.add(path)
  validateExportEntries(exportEvidence.exports, contract, root, sources)
  validateBundleEntries(bundleEvidence.bundles, contract, root)
  for (const entry of bundleEvidence.bundles) expectedFiles.add(entry.path)
  assertRootFiles(root, [...expectedFiles, 'evidence-manifest.json'], 'consumer')
  return evidenceManifestSha256
}
/** 校验 contract 派生的 journey/runtime/browser 结果。 */
function validateJourneyEntries(entries, contract, installVersions) {
  const expected = []
  for (const journey of contract.journeys) for (const manager of ['npm', 'pnpm']) for (const runtime of journey.runtimes) {
    const browsers = ['vite-browser', 'dedicated-worker'].includes(runtime)
      ? (journey.browserMatrix ?? ['chromium', 'firefox', 'webkit'])
      : ['none']
    for (const browser of browsers) expected.push(`${journey.id}\0${manager}\0${runtime}\0${browser}`)
  }
  const actual = entries.map(function readEntry(entry) {
    assertExactKeys(entry, ['browser', 'command', 'id', 'packageManager', 'packageManagerVersion', 'runtime', 'status'], 'consumer journey')
    const installId = `${entry.id}--${entry.packageManager}`
    const expectedCommand = `phase3-consumer:${entry.id}:${entry.packageManager}:${entry.runtime}:${entry.browser}`
    if (entry.status !== 'passed' || entry.command !== expectedCommand || entry.packageManagerVersion !== installVersions.get(installId)) {
      throw new Error('consumer journey status is invalid')
    }
    return `${entry.id}\0${entry.packageManager}\0${entry.runtime}\0${entry.browser}`
  })
  assertSameUniqueStrings(actual, expected.sort(), 'consumer journey set')
}
/** 校验逐 export tuple 与 sourcePath 实体。 */
function validateExportEntries(entries, contract, root, sources) {
  const expected = []
  for (const journey of contract.journeys) for (const manager of ['npm', 'pnpm']) for (const target of journey.targets) {
    const browsers = ['vite-browser', 'dedicated-worker'].includes(target.runtime)
      ? (journey.browserMatrix ?? ['chromium', 'firefox', 'webkit'])
      : ['none']
    for (const browser of browsers) expected.push(exportKey({ ...target, journey: journey.id, packageManager: manager, browser }))
  }
  const actual = entries.map(function validateEntry(entry) {
    assertExactKeys(entry, ['browser', 'environment', 'journey', 'package', 'packageManager', 'runtime', 'sourcePath', 'status', 'subpath'], 'consumer export')
    const source = sources[createConsumerSourceId(entry.journey, entry.runtime)]
    const expectedPath = source === undefined ? '' : `raw/sources/${createConsumerSourceId(entry.journey, entry.runtime)}/probe.${source.extension}`
    if (entry.status !== 'passed' || entry.sourcePath !== expectedPath || !lstatSync(join(root, entry.sourcePath)).isFile()) {
      throw new Error('consumer export source is invalid')
    }
    return exportKey(entry)
  })
  assertSameUniqueStrings(actual, expected.sort(), 'consumer export set')
}
/** 创建逐 export 唯一键。 */
function exportKey(entry) {
  return `${entry.package}\0${entry.subpath}\0${entry.environment}\0${entry.journey}\0${entry.packageManager}\0${entry.runtime}\0${entry.browser}`
}
/** 校验 browser tuple 至少一个 bundle 且所有 bytes/hash 来自 handoff。 */
function validateBundleEntries(entries, contract, root) {
  const tuples = new Set()
  const seenPaths = new Set()
  const orderedKeys = []
  for (const entry of entries) {
    assertExactKeys(entry, ['browser', 'bytes', 'journey', 'packageManager', 'path', 'runtime', 'sha256'], 'consumer bundle')
    const key = `${entry.journey}\0${entry.packageManager}\0${entry.runtime}\0${entry.browser}`
    const pathKey = `${key}\0${entry.path}`
    const bytes = readFileSync(join(root, entry.path))
    if (!entry.path.startsWith('bundles/') || seenPaths.has(pathKey) || entry.bytes !== bytes.byteLength || entry.sha256 !== sha256(bytes)) {
      throw new Error('consumer bundle bytes are invalid')
    }
    seenPaths.add(pathKey)
    orderedKeys.push(pathKey)
    tuples.add(key)
  }
  const expected = []
  for (const journey of contract.journeys) for (const manager of ['npm', 'pnpm']) for (const runtime of journey.runtimes) {
    if (!['vite-browser', 'dedicated-worker'].includes(runtime)) continue
    for (const browser of journey.browserMatrix ?? ['chromium', 'firefox', 'webkit']) expected.push(`${journey.id}\0${manager}\0${runtime}\0${browser}`)
  }
  assertSameUniqueStrings([...tuples].sort(), expected.sort(), 'consumer bundle tuple set')
  if (JSON.stringify(orderedKeys) !== JSON.stringify([...orderedKeys].sort())) throw new Error('consumer bundle order mismatch')
}
/** 重建并逐字节校验全部 consumer probe source 与辅助文件。 */
export function validateConsumerSourceEvidence(root, sources) {
  const paths = []
  for (const [id, source] of Object.entries(sources)) {
    const sourcePath = `raw/sources/${id}/probe.${source.extension}`
    if (!readFileSync(join(root, sourcePath)).equals(Buffer.from(source.source))) throw new Error('consumer source mismatch')
    paths.push(sourcePath)
    for (const [name, bytes] of Object.entries(source.files)) {
      const path = `raw/sources/${id}/${name}`
      if (!readFileSync(join(root, path)).equals(Buffer.from(bytes))) throw new Error('consumer source mismatch')
      paths.push(path)
    }
  }
  return paths.sort()
}
/** 校验 audit root 的两套 assembly 与派生 evidence。 */
function validateAuditRoot(root, runA, contract, consumerRoot) {
  const evidenceManifestSha256 = validateEvidenceManifest(root, 'audit')
  const summary = readCanonicalJsonFile(join(root, 'audit-evidence.json'), 'audit summary').value
  validateSummary(summary, 'audit', runA)
  const customerContracts = contract.packages.filter(function isCustomer(entry) { return entry.delivery !== 'docker-image-internal' })
  const serverJourney = contract.journeys.find(function findServer(entry) { return entry.id === 'collab-server-image-node' })
  if (serverJourney === undefined) throw new Error('server assembly journey is missing')
  const serverNames = [...serverJourney.requestedPackages, ...serverJourney.firstPartyClosure].sort()
  const serverContracts = serverNames.map(function readContract(name) {
    const packageContract = contract.packages.find(function findPackage(entry) { return entry.name === name })
    if (packageContract === undefined) throw new Error(`server package contract missing: ${name}`)
    return packageContract
  })
  const customer = validateAssembly(root, 'customer', 'customer-production', runA, customerContracts)
  const server = validateAssembly(root, 'server', 'server-image', runA, serverContracts)
  const size = readCanonicalJsonFile(join(root, 'size-evidence.json'), 'size evidence').value
  const expectedSize = createPhase3SizeEvidence({ contract, manifest: runA.manifest, artifactRoot: runA.root, consumerRoot })
  if (canonicalBytes(size).compare(canonicalBytes(expectedSize)) !== 0) throw new Error('size evidence mismatch')
  const provenance = readCanonicalJsonFile(join(root, 'provenance.intoto.json'), 'provenance').value
  validatePhase3Provenance(provenance, runA.manifest, sha256(runA.manifestBytes), sha256(runA.checksumBytes))
  validatePhase3Sbom(readCanonicalJsonFile(join(root, 'sbom.spdx.json'), 'SBOM').value, {
    artifactSetId: runA.manifest.artifactSetId,
    firstPartyPackages: runA.manifest.artifactIdentity.packages,
    customerList: customer.dependencyList,
    serverList: server.dependencyList,
    customerLockSha256: customer.evidence.lockfileSha256,
    serverLockSha256: server.evidence.lockfileSha256,
    customerListSha256: customer.evidence.dependencyListSha256,
    serverListSha256: server.evidence.dependencyListSha256
  })
  validateReleaseReadiness(
    readCanonicalJsonFile(join(root, 'readiness-evidence.json'), 'readiness').value,
    contract,
    readJsonFile(releasePolicyFixturePath, 'release policy fixture').value
  )
  validateRollbackEvidence(
    readCanonicalJsonFile(join(root, 'rollback-evidence.json'), 'rollback').value,
    readJsonFile(rollbackFixturePath, 'rollback fixture').value,
    runA.manifest.artifactSetId
  )
  if (customer.evidence.assemblyKind === server.evidence.assemblyKind) throw new Error('assembly roots were merged')
  assertRootFiles(root, [
    'audit-evidence.json', 'evidence-manifest.json', 'provenance.intoto.json', 'readiness-evidence.json',
    'rollback-evidence.json', 'sbom.spdx.json', 'size-evidence.json', ...customer.files, ...server.files
  ], 'audit')
  return evidenceManifestSha256
}
/** 校验一套 assembly evidence 与全部 raw hash。 */
function validateAssembly(root, key, kind, runA, packageContracts) {
  const evidence = readCanonicalJsonFile(join(root, `${key}-assembly-evidence.json`), `${key} assembly evidence`).value
  validateAssemblyEvidence(evidence, key, kind, runA.manifest.artifactSetId)
  const base = join(root, 'assemblies', key)
  const paths = {
    packageManifestSha256: join(base, 'package.json'),
    lockfileSha256: join(base, 'pnpm-lock.yaml'),
    registryConfigSha256: join(base, '.npmrc'),
    registryEvidenceSha256: join(base, 'registry-evidence.json'),
    registryTranscriptSha256: join(base, 'registry-transcript.json'),
    auditSha256: join(root, 'raw', key, 'pnpm-audit.json'),
    dependencyListSha256: join(root, 'raw', key, 'pnpm-list-prod.json')
  }
  for (const [field, path] of Object.entries(paths)) if (evidence[field] !== sha256(readFileSync(path))) throw new Error(`${key} assembly hash mismatch`)
  const dependencies = createAssemblyDependencyVersions(packageContracts, runA)
  validateAssemblyPackageManifest(readJsonFile(paths.packageManifestSha256, `${key} package manifest`).value, kind, dependencies)
  const dependencyList = JSON.parse(readFileSync(paths.dependencyListSha256, 'utf8'))
  const expectedPairs = collectAssemblyDependencyPairs(dependencyList)
  const actualPairs = [...new Set([...evidence.dependencies, ...evidence.unmaterializedOptionalDependencies].map(function createPair(entry) { return `${entry.name}\0${entry.version}` }))].sort()
  assertSameUniqueStrings(actualPairs, expectedPairs, `${key} assembly dependency set`)
  validateAssemblyDependencyEvidence(
    dependencyList,
    evidence.dependencies,
    evidence.unmaterializedOptionalDependencies,
    dependencies,
    key,
    readFileSync(paths.lockfileSha256, 'utf8'),
    runA.manifest.artifactIdentity.environment,
    readFileSync(join(repoRoot, 'pnpm-lock.yaml'), 'utf8')
  )
  const responseFiles = validateAssemblyRegistry(base, Object.keys(dependencies).filter(function isFirstParty(name) {
    return name.startsWith('@4xian/')
  }), runA)
  const audit = JSON.parse(readFileSync(paths.auditSha256, 'utf8'))
  validateAssemblyAuditPayload(audit, key)
  if (audit.metadata.vulnerabilities.high !== 0 || audit.metadata.vulnerabilities.critical !== 0) {
    throw new Error(`${key} assembly audit count mismatch`)
  }
  return {
    evidence,
    dependencyList,
    files: [
      `${key}-assembly-evidence.json`, `assemblies/${key}/.npmrc`, `assemblies/${key}/package.json`,
      `assemblies/${key}/pnpm-lock.yaml`, `assemblies/${key}/registry-evidence.json`,
      `assemblies/${key}/registry-transcript.json`, `raw/${key}/pnpm-audit.json`,
      `raw/${key}/pnpm-list-prod.json`, ...responseFiles.map(function prefix(path) { return `assemblies/${key}/${path}` })
    ]
  }
}
/** 从 contract 与 run-a 生成 assembly 的精确 dependency/version 对象。 */
function createAssemblyDependencyVersions(packageContracts, runA) {
  const versions = new Map(runA.manifest.artifactIdentity.packages.map(function index(entry) { return [entry.name, entry.version] }))
  const dependencies = {}
  for (const packageContract of packageContracts) {
    const version = versions.get(packageContract.name)
    if (version === undefined || version !== packageContract.version) throw new Error(`assembly package version mismatch: ${packageContract.name}`)
    dependencies[packageContract.name] = version
    for (const group of ['external', 'externalPeers']) for (const [name, dependencyVersion] of Object.entries(packageContract.dependencyPolicy[group] ?? {})) {
      if (dependencies[name] !== undefined && dependencies[name] !== dependencyVersion) throw new Error(`assembly dependency conflict: ${name}`)
      dependencies[name] = dependencyVersion
    }
  }
  return Object.fromEntries(Object.entries(dependencies).sort(function compare(left, right) { return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0 }))
}
/** 校验 assembly package manifest 的精确 schema 与 dependency versions。 */
export function validateAssemblyPackageManifest(manifest, kind, dependencies) {
  const expected = { name: `jword-phase3-${kind}`, version: '0.0.0', private: true, type: 'module', dependencies }
  if (!canonicalBytes(manifest).equals(canonicalBytes(expected))) throw new Error('assembly package manifest mismatch')
}
/** 校验一份 assembly evidence 的固定结构、身份和依赖顺序。 */
export function validateAssemblyEvidence(evidence, key, kind, artifactSetId) {
  assertExactKeys(evidence, ['artifactSetId', 'assemblyKind', 'auditSha256', 'dependencies', 'dependencyListSha256', 'lockfileSha256', 'packageManifestSha256', 'registryConfigSha256', 'registryEvidenceSha256', 'registryTranscriptSha256', 'schemaVersion', 'unmaterializedOptionalDependencies'], `${key} assembly evidence`)
  if (evidence.schemaVersion !== 1 || evidence.artifactSetId !== artifactSetId || evidence.assemblyKind !== kind) {
    throw new Error(`${key} assembly identity mismatch`)
  }
  for (const field of ['auditSha256', 'dependencyListSha256', 'lockfileSha256', 'packageManifestSha256', 'registryConfigSha256', 'registryEvidenceSha256', 'registryTranscriptSha256']) {
    if (typeof evidence[field] !== 'string' || !/^[0-9a-f]{64}$/u.test(evidence[field])) throw new Error(`${key} assembly hash is invalid`)
  }
  if (!Array.isArray(evidence.dependencies) || evidence.dependencies.length === 0 || evidence.dependencies.some(function invalid(entry) {
    assertExactKeys(entry, ['name', 'realpath', 'version'], `${key} assembly dependency`)
    return typeof entry.name !== 'string' || entry.name === '' || typeof entry.version !== 'string' || entry.version === '' ||
      typeof entry.realpath !== 'string' || entry.realpath !== normalizeExternalDependencyPath(entry.realpath, repoRoot, `${key} assembly dependency`)
  })) throw new Error(`${key} assembly dependencies are invalid`)
  const keys = evidence.dependencies.map(function createKey(entry) { return `${entry.name}\0${entry.version}\0${entry.realpath}` })
  if (new Set(keys).size !== keys.length || JSON.stringify(keys) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${key} assembly dependency order is invalid`)
  }
  if (!Array.isArray(evidence.unmaterializedOptionalDependencies) || evidence.unmaterializedOptionalDependencies.some(function invalid(entry) {
    assertExactKeys(entry, ['name', 'path', 'version'], `${key} assembly optional dependency`)
    return typeof entry.name !== 'string' || entry.name === '' || typeof entry.version !== 'string' || entry.version === '' ||
      typeof entry.path !== 'string' || entry.path !== normalizeExternalDependencyPath(entry.path, repoRoot, `${key} assembly optional dependency`)
  })) throw new Error(`${key} assembly optional dependencies are invalid`)
  const optionalKeys = evidence.unmaterializedOptionalDependencies.map(function createKey(entry) { return `${entry.name}\0${entry.version}\0${entry.path}` })
  if (new Set(optionalKeys).size !== optionalKeys.length || JSON.stringify(optionalKeys) !== JSON.stringify([...optionalKeys].sort())) {
    throw new Error(`${key} assembly optional dependency order is invalid`)
  }
}
/** 把 raw pnpm list 的 direct/闭包 path 与 assembly evidence 逐项绑定。 */
export function validateAssemblyDependencyEvidence(dependencyList, evidenceDependencies, unmaterializedOptionalDependencies, requiredDependencies, key, lockfile, environment, repositoryLockfile) {
  if (!Array.isArray(evidenceDependencies) || !Array.isArray(unmaterializedOptionalDependencies) || requiredDependencies === null || typeof requiredDependencies !== 'object' || Array.isArray(requiredDependencies)) throw new Error(`${key} dependency evidence is invalid`)
  const actual = evidenceDependencies.map(function readEntry(entry) {
    assertExactKeys(entry, ['name', 'realpath', 'version'], `${key} assembly dependency`)
    return { name: entry.name, version: entry.version, realpath: normalizeExternalDependencyPath(entry.realpath, repoRoot, `${key} dependency evidence`) }
  }).sort(compareDependencyEvidence)
  const omitted = unmaterializedOptionalDependencies.map(function readEntry(entry) {
    assertExactKeys(entry, ['name', 'path', 'version'], `${key} assembly optional dependency`)
    return { name: entry.name, version: entry.version, path: normalizeExternalDependencyPath(entry.path, repoRoot, `${key} optional dependency evidence`) }
  }).sort(compareDependencyEvidence)
  const actualKeys = new Set(actual.map(function createKey(entry) { return `${entry.name}\0${entry.version}\0${entry.realpath}` }))
  const omittedKeys = new Set(omitted.map(function createKey(entry) { return `${entry.name}\0${entry.version}\0${entry.path}` }))
  if (actualKeys.size !== actual.length || omittedKeys.size !== omitted.length || [...omittedKeys].some(function overlaps(entry) { return actualKeys.has(entry) })) {
    throw new Error(`${key} dependency evidence is invalid`)
  }
  const firstPartyDirectKeys = new Set(Object.entries(requiredDependencies).filter(function isFirstParty([name]) {
    return name.startsWith('@4xian/')
  }).map(function createKey([name, version]) { return `${name}\0${version}` }))
  const raw = collectAssemblyDependencyEvidence(dependencyList, key, repoRoot, omittedKeys, firstPartyDirectKeys)
  for (const entry of omitted) {
    if (!lockfileMarksDependencyOptional(lockfile, entry.name, entry.version, entry.path)) throw new Error(`${key} assembly optional dependency is invalid`)
  }
  if (!canonicalBytes(actual).equals(canonicalBytes(raw.records))) throw new Error(`${key} dependency evidence mismatch`)
  if (!canonicalBytes(omitted).equals(canonicalBytes(raw.omitted))) throw new Error(`${key} optional dependency evidence mismatch`)
  validateAssemblyDependencyGraph(dependencyList, lockfile, key, omittedKeys)
  for (const entry of actual) {
    if (lockfileExcludesAssemblyEnvironment(lockfile, entry.name, entry.version, environment)) {
      throw new Error(`${key} assembly dependency is excluded from the environment`)
    }
  }
  for (const entry of omitted) {
    if (!lockfileExcludesAssemblyEnvironment(lockfile, entry.name, entry.version, environment) ||
        !lockfileExcludesAssemblyEnvironment(repositoryLockfile, entry.name, entry.version, environment)) {
      throw new Error(`${key} assembly optional dependency is invalid`)
    }
  }
  for (const entry of raw.omittedParents) {
    if (!lockfileParentMarksDependencyOptional(lockfile, entry.parentName, entry.parentVersion, entry.name, entry.version) ||
        !lockfileParentMarksDependencyOptional(repositoryLockfile, entry.parentName, entry.parentVersion, entry.name, entry.version)) {
      throw new Error(`${key} assembly optional dependency is invalid`)
    }
  }
  for (const [name, version] of Object.entries(requiredDependencies)) {
    const direct = raw.direct.find(function find(entry) { return entry.name === name })
    const resolved = actual.find(function find(entry) { return entry.name === name && entry.version === version })
    if (direct === undefined || direct.version !== version || resolved === undefined || resolved.realpath !== direct.realpath) {
      throw new Error(`${key} required dependency is missing: ${name}`)
    }
  }
  const direct = raw.direct.map(function read(entry) { return { name: entry.name, version: entry.version } })
  const required = Object.entries(requiredDependencies).map(function read([name, version]) { return { name, version } }).sort(compareDependencyEvidence)
  if (!canonicalBytes(direct).equals(canonicalBytes(required))) throw new Error(`${key} direct dependency list is invalid`)
}
/** 校验 pnpm audit payload 的完整 envelope 和 high/critical 整数计数。 */
export function validateAssemblyAuditPayload(payload, key) {
  const vulnerabilities = payload?.metadata?.vulnerabilities
  if (payload === null || typeof payload !== 'object' || vulnerabilities === null || typeof vulnerabilities !== 'object' ||
      Object.prototype.hasOwnProperty.call(payload, 'error') || Object.prototype.hasOwnProperty.call(payload, 'errors') ||
      !Number.isSafeInteger(vulnerabilities.high) || vulnerabilities.high < 0 ||
      !Number.isSafeInteger(vulnerabilities.critical) || vulnerabilities.critical < 0) {
    throw new Error(`${key} audit payload is invalid`)
  }
  for (const field of ['info', 'low', 'moderate', 'high', 'critical', 'total']) {
    if (vulnerabilities[field] !== undefined && (!Number.isSafeInteger(vulnerabilities[field]) || vulnerabilities[field] < 0)) {
      throw new Error(`${key} audit payload is invalid`)
    }
  }
}
/** 从 registry raw bytes、transcript 与 lockfile 重算一套 assembly 的来源证据。 */
export function validateAssemblyRegistry(base, expectedNames, runA) {
  const config = readFileSync(join(base, '.npmrc'), 'utf8')
  const configMatch = config.match(/^registry=https:\/\/registry\.npmjs\.org\/\n@4xian:registry=(http:\/\/127\.0\.0\.1:\d+\/)\n$/u)
  if (configMatch === null || /auth|token|password|username/iu.test(config)) throw new Error('assembly registry config is invalid')
  const registryOrigin = configMatch[1].slice(0, -1)
  const registry = readCanonicalJsonFile(join(base, 'registry-evidence.json'), 'assembly registry evidence').value
  const transcript = readCanonicalJsonFile(join(base, 'registry-transcript.json'), 'assembly registry transcript').value
  assertExactKeys(registry, ['allowedMethods', 'host', 'mode', 'schemaVersion', 'scope', 'servedPackages', 'unexpectedRequests', 'writeAttempts'], 'assembly registry evidence')
  assertExactKeys(transcript, ['requests', 'schemaVersion'], 'assembly registry transcript')
  if (registry.schemaVersion !== 1 || transcript.schemaVersion !== 1 || !Array.isArray(registry.servedPackages) || !Array.isArray(transcript.requests) ||
      registry.mode !== 'read-only-loopback' || registry.host !== '127.0.0.1' || registry.scope !== '@4xian' ||
      JSON.stringify(registry.allowedMethods) !== JSON.stringify(['GET', 'HEAD']) || registry.unexpectedRequests !== 0 || registry.writeAttempts !== 0) {
    throw new Error('assembly registry policy is invalid')
  }
  const servedNames = registry.servedPackages.map(function readName(entry) { return entry.name })
  assertSameUniqueStrings(servedNames, [...expectedNames].sort(), 'assembly registry package set')
  const runAPackages = new Map(runA.manifest.artifactIdentity.packages.map(function index(entry) { return [entry.name, entry] }))
  for (let index = 0; index < transcript.requests.length; index += 1) {
    const request = transcript.requests[index]
    assertExactKeys(request, ['method', 'order', 'path', 'responseBytes', 'responseKind', 'responsePath', 'responseSha256', 'status'], 'assembly registry request')
    const bytes = readFileSync(join(base, request.responsePath))
    if (request.order !== index || !['GET', 'HEAD'].includes(request.method) || request.status !== 200 ||
        !['metadata', 'tarball'].includes(request.responseKind) || !isAssemblyRegistryRequestAllowed(request, registry.servedPackages) ||
        request.responsePath !== `registry-responses/${request.responseSha256}.bin` ||
        request.responseSha256 !== sha256(bytes) || request.responseBytes !== bytes.byteLength ||
        (request.method === 'HEAD' && bytes.byteLength !== 0)) throw new Error('assembly registry transcript is invalid')
    if (request.method === 'GET') {
      const served = findServedPackageForRequest(request, registry.servedPackages)
      const packageEntry = served === undefined ? undefined : runAPackages.get(served.name)
      if (served === undefined || packageEntry === undefined) throw new Error('assembly registry response package is invalid')
      const tarballBytes = readFileSync(join(runA.root, packageEntry.tarballFile))
      const expectedBytes = request.responseKind === 'metadata'
        ? createRegistryMetadataBytes(served, registryOrigin, tarballBytes)
        : tarballBytes
      if (!bytes.equals(expectedBytes)) throw new Error('assembly registry response bytes are invalid')
    }
  }
  const lockfile = readFileSync(join(base, 'pnpm-lock.yaml'), 'utf8')
  for (const served of registry.servedPackages) {
    assertExactKeys(served, ['metadataBytes', 'metadataPath', 'metadataRequests', 'metadataSha256', 'name', 'tarballFile', 'tarballIntegrity', 'tarballRequests', 'tarballSha256', 'tarballShasum', 'version'], 'assembly served package')
    const packageEntry = runAPackages.get(served.name)
    const metadataRequest = transcript.requests.find(function findMetadata(request) {
      return request.method === 'GET' && request.responseKind === 'metadata' && decodeURIComponent(request.path.slice(1)) === served.name
    })
    const tarballRequest = transcript.requests.find(function findTarball(request) {
      return request.method === 'GET' && request.responseKind === 'tarball' && request.path === `/tarballs/${served.tarballFile}`
    })
    if (packageEntry === undefined || metadataRequest === undefined || tarballRequest === undefined) throw new Error('assembly registry GET evidence is missing')
    const metadataBytes = readFileSync(join(base, metadataRequest.responsePath))
    const tarballBytes = readFileSync(join(base, tarballRequest.responsePath))
    const metadata = JSON.parse(metadataBytes.toString('utf8'))
    const dist = metadata.versions?.[served.version]?.dist
    const shasum = createHash('sha1').update(tarballBytes).digest('hex')
    const integrity = `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
    const expectedMetadata = canonicalBytes({
      name: served.name,
      versions: { [served.version]: { name: served.name, version: served.version, type: 'module', dist: {
        tarball: `${registryOrigin}/tarballs/${served.tarballFile}`, shasum, integrity
      } } },
      'dist-tags': { latest: served.version }
    })
    const metadataGets = transcript.requests.filter(function count(request) {
      return request.method === 'GET' && request.responseKind === 'metadata' && decodeURIComponent(request.path.slice(1)) === served.name
    }).length
    const tarballGets = transcript.requests.filter(function count(request) {
      return request.method === 'GET' && request.responseKind === 'tarball' && request.path === `/tarballs/${served.tarballFile}`
    }).length
    if (served.version !== packageEntry.version || served.tarballFile !== packageEntry.tarballFile ||
        served.tarballSha256 !== packageEntry.tarballSha256 || served.tarballSha256 !== sha256(tarballBytes) ||
        served.tarballShasum !== shasum || served.tarballIntegrity !== integrity ||
        served.metadataPath !== metadataRequest.responsePath || served.metadataSha256 !== sha256(metadataBytes) ||
        served.metadataBytes !== metadataBytes.byteLength || !metadataBytes.equals(expectedMetadata) ||
        served.metadataRequests !== metadataGets || served.tarballRequests !== tarballGets ||
        metadataGets === 0 || tarballGets === 0 || dist?.tarball !== `${registryOrigin}/tarballs/${served.tarballFile}` ||
        dist?.shasum !== shasum || dist?.integrity !== integrity || !lockfileContainsIntegrity(lockfile, served.name, served.version, integrity)) {
      throw new Error('assembly registry package bytes are invalid')
    }
  }
  const manifest = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
  const firstPartyNames = Object.keys(manifest.dependencies ?? {}).filter(function isFirstParty(name) { return name.startsWith('@4xian/') }).sort()
  assertSameUniqueStrings(firstPartyNames, expectedNames, 'assembly manifest first-party set')
  return [...new Set(transcript.requests.map(function readPath(request) { return request.responsePath }))].sort()
}
/** 校验 assembly transcript 的每条请求都属于当前 served allowlist。 */
function isAssemblyRegistryRequestAllowed(request, servedPackages) {
  return servedPackages.some(function matches(entry) {
    return request.responseKind === 'metadata'
      ? decodeURIComponent(request.path.slice(1)) === entry.name
      : request.path === `/tarballs/${entry.tarballFile}`
  })
}
/** 查找 transcript request 对应的 served package。 */
function findServedPackageForRequest(request, servedPackages) {
  return servedPackages.find(function matches(entry) {
    return request.responseKind === 'metadata'
      ? decodeURIComponent(request.path.slice(1)) === entry.name
      : request.path === `/tarballs/${entry.tarballFile}`
  })
}
/** 从 run-a tarball bytes 重建一条 registry metadata raw response。 */
function createRegistryMetadataBytes(entry, registryOrigin, tarballBytes) {
  return canonicalBytes({
    name: entry.name,
    versions: { [entry.version]: { name: entry.name, version: entry.version, type: 'module', dist: {
      tarball: `${registryOrigin}/tarballs/${entry.tarballFile}`,
      shasum: createHash('sha1').update(tarballBytes).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}`
    } } },
    'dist-tags': { latest: entry.version }
  })
}
/** 解析 pnpm package block 并绑定对应 name/version 的 resolution.integrity。 */
function lockfileContainsIntegrity(lockfile, name, version, integrity) {
  const escaped = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const start = new RegExp(String.raw`^[\x20]{2}['"]?${escaped}(?:\([^\n]*\))?['"]?:[\t ]*$`, 'mu').exec(lockfile)
  if (start === null || start.index === undefined) return false
  const blockStart = start.index + start[0].length
  const remainder = lockfile.slice(blockStart)
  const next = remainder.search(/^[\x20]{2}\S/mu)
  const block = next === -1 ? remainder : remainder.slice(0, next)
  const inline = new RegExp(String.raw`^[\t ]+resolution:[\t ]*\{[\t ]*integrity:[\t ]*${integrity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\t ]*\}[\t ]*$`, 'mu')
  const multiline = new RegExp(String.raw`^[\t ]+integrity:[\t ]*${integrity.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}[\t ]*$`, 'mu')
  return inline.test(block) || multiline.test(block)
}
/** 从 run-a identity 精确重算并校验 provenance。 */
export function validatePhase3Provenance(value, manifest, manifestSha256, checksumSha256) {
  const expected = generatePhase3Provenance(manifest, manifestSha256, checksumSha256)
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) throw new Error('provenance mismatch')
}
/** 从两套 assembly 原始输入精确重算并校验 SBOM。 */
export function validatePhase3Sbom(value, input) {
  const expected = generatePhase3Sbom(input)
  if (!canonicalBytes(value).equals(canonicalBytes(expected))) throw new Error('SBOM mismatch')
}
export { validateReleaseReadiness, validateRollbackEvidence }
/** 校验 reproducibility root 并从 run-b 原始 tarball bytes 重算。 */
export function validateReproducibilityRoot(root, runA) {
  const evidenceManifestSha256 = validateEvidenceManifest(root, 'reproducibility')
  const summary = readCanonicalJsonFile(join(root, 'reproducibility-evidence.json'), 'reproducibility summary').value
  validateSummary(summary, 'reproducibility', runA)
  const comparison = readCanonicalJsonFile(join(root, 'comparison-evidence.json'), 'comparison evidence').value
  const rightRecord = readCanonicalJsonFile(join(root, 'run-b-artifact-manifest.json'), 'run-b artifact manifest')
  const rightChecksum = readFileSync(join(root, 'run-b-SHA256SUMS'))
  const rightManifest = validateArtifactManifestForComparison(rightRecord.value, rightChecksum)
  assertRootFiles(root, [
    'comparison-evidence.json',
    'evidence-manifest.json',
    'reproducibility-evidence.json',
    'run-b-SHA256SUMS',
    'run-b-artifact-manifest.json',
    ...rightManifest.artifactIdentity.packages.map(function readTarball(entry) { return `run-b-tarballs/${entry.tarballFile}` })
  ], 'reproducibility')
  const leftNames = runA.manifest.artifactIdentity.packages.map(function readName(entry) { return entry.name }).sort()
  const rightNames = rightManifest.artifactIdentity.packages.map(function readName(entry) { return entry.name }).sort()
  assertSameUniqueStrings(rightNames, leftNames, 'reproducibility package set')
  for (const packageEntry of rightManifest.artifactIdentity.packages) {
    verifyTarball(join(root, 'run-b-tarballs'), packageEntry)
  }
  if (!canonicalBytes(rightManifest.artifactIdentity).equals(canonicalBytes(runA.manifest.artifactIdentity))) {
    throw new Error('reproducibility identity mismatch')
  }
  const expectedComparison = {
    schemaVersion: 1,
    leftArtifactSetId: runA.manifest.artifactSetId,
    rightArtifactSetId: rightManifest.artifactSetId,
    tuple: readComparableTuple(runA.manifest.artifactIdentity),
    packages: runA.manifest.artifactIdentity.packages.map(function createComparison(packageEntry) {
      return {
        name: packageEntry.name,
        leftTarballSha256: packageEntry.tarballSha256,
        rightTarballSha256: packageEntry.tarballSha256,
        match: true
      }
    })
  }
  if (!canonicalBytes(comparison).equals(canonicalBytes(expectedComparison))) throw new Error('reproducibility comparison mismatch')
  return evidenceManifestSha256
}
/** 从 artifact identity 读取固定可比 tuple。 */
function readComparableTuple(identity) {
  return {
    gitSha: identity.gitSha,
    lockfileSha256: identity.lockfileSha256,
    node: identity.environment.node,
    npm: identity.environment.npm,
    pnpm: identity.environment.pnpm,
    os: identity.environment.os,
    arch: identity.environment.arch,
    builderSha256: identity.builderSha256
  }
}
/** 校验 summary 共同 envelope 与 binding identity。 */
function validateSummary(summary, type, runA) {
  assertExactKeys(summary, ['artifactSetId', 'bindingSha256', 'checks', 'evidenceType', 'gitSha', 'lockfileSha256', 'schemaVersion', 'status'], `${type} summary`)
  const checkKeys = {
    consumer: ['allJourneysPassed', 'bundleBytesVerified', 'consumerSourcesVerified', 'exportEvidencePassed', 'fallbacks', 'firstPartyRegistryFallbacks', 'installEvidencePassed', 'overrides', 'packageAliases', 'registryEvidencePassed', 'registryWrites', 'repacks', 'repoRealpaths', 'skipped', 'unexpectedRegistryRequests', 'unexpectedRuntimeInstances', 'workspaceLinks'],
    audit: ['customerAssemblyPassed', 'customerCritical', 'customerHigh', 'policyRehearsalPassed', 'provenanceAttestationStatus', 'provenancePredicatePassed', 'releaseCandidateStatus', 'rollbackPassed', 'sbomPassed', 'serverAssemblyPassed', 'serverCritical', 'serverHigh', 'sizePassed'],
    reproducibility: ['comparable', 'rawTarballsMatch']
  }[type]
  assertExactKeys(summary.checks, checkKeys, `${type} summary checks`)
  const expectedChecks = {
    consumer: {
      allJourneysPassed: true, installEvidencePassed: true, registryEvidencePassed: true,
      exportEvidencePassed: true, consumerSourcesVerified: true, bundleBytesVerified: true,
      skipped: 0, fallbacks: 0, repacks: 0, workspaceLinks: 0, packageAliases: 0,
      overrides: 0, repoRealpaths: 0, registryWrites: 0, unexpectedRegistryRequests: 0,
      firstPartyRegistryFallbacks: 0, unexpectedRuntimeInstances: 0
    },
    audit: {
      customerAssemblyPassed: true, serverAssemblyPassed: true, customerHigh: 0, customerCritical: 0,
      serverHigh: 0, serverCritical: 0, sizePassed: true, sbomPassed: true,
      provenancePredicatePassed: true, provenanceAttestationStatus: 'unsigned', rollbackPassed: true,
      policyRehearsalPassed: true, releaseCandidateStatus: 'blocked-as-expected'
    },
    reproducibility: { comparable: true, rawTarballsMatch: true }
  }[type]
  if (canonicalBytes(summary.checks).compare(canonicalBytes(expectedChecks)) !== 0) throw new Error(`${type} summary checks mismatch`)
  if (summary.schemaVersion !== 1 || summary.evidenceType !== type || summary.status !== 'passed' ||
      summary.gitSha !== runA.manifest.artifactIdentity.gitSha || summary.lockfileSha256 !== runA.manifest.artifactIdentity.lockfileSha256 ||
      summary.artifactSetId !== runA.manifest.artifactSetId || summary.bindingSha256 !== sha256(runA.bindingBytes) ||
      summary.checks === null || typeof summary.checks !== 'object') throw new Error(`${type} summary mismatch`)
}
/** 从 tarball 原始 bytes 重算 hash、文件 bytes 和 payload hash。 */
function verifyTarball(root, packageEntry) {
  const tarballPath = join(root, packageEntry.tarballFile)
  const tarballBytes = readFileSync(tarballPath)
  if (tarballBytes.byteLength !== packageEntry.tarballBytes || sha256(tarballBytes) !== packageEntry.tarballSha256) throw new Error('tarball raw bytes mismatch')
  const archive = readTarballEntries(tarballPath)
  const expectedPaths = packageEntry.files.map(function readPath(file) { return `package/${file.path}` })
  const expectedDirectories = new Set(['package/'])
  for (const path of expectedPaths) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) expectedDirectories.add(`${segments.slice(0, index).join('/')}/`)
  }
  const actualFiles = []
  for (const entry of archive) {
    if (entry.type === 'directory') {
      if (!expectedDirectories.has(entry.path)) throw new Error('tarball file set mismatch')
    } else if (entry.type === 'regular') {
      actualFiles.push(entry.path)
    } else {
      throw new Error('tarball archive entry type is invalid')
    }
  }
  if (new Set(actualFiles).size !== actualFiles.length || JSON.stringify(actualFiles.sort()) !== JSON.stringify(expectedPaths.slice().sort())) {
    throw new Error('tarball file set mismatch')
  }
  const files = packageEntry.files.map(function verifyFile(file) {
    const result = spawnSync('tar', ['-xOzf', tarballPath, `package/${file.path}`], { encoding: null, maxBuffer: 32 * 1024 * 1024 })
    if (result.status !== 0 || result.stdout === null || result.stdout.byteLength !== file.bytes || sha256(result.stdout) !== file.sha256) {
      throw new Error('tarball payload file mismatch')
    }
    return { path: file.path, sha256: file.sha256, bytes: file.bytes }
  })
  const packedManifest = files.find(function findManifest(file) { return file.path === 'package.json' })
  if (packedManifest === undefined || packedManifest.sha256 !== packageEntry.packedManifestSha256) {
    throw new Error('packed manifest hash mismatch')
  }
  if (createPayloadSha256(files) !== packageEntry.payloadSha256) throw new Error('tarball payload hash mismatch')
}
/** 校验显式 tarball directory 中一包的完整 archive payload。 */
export function validateTarballPayload(root, packageEntry) {
  verifyTarball(root, packageEntry)
}
/** 枚举 tar archive entry 类型，拒绝无法逐项解释的 archive。 */
function readTarballEntries(tarballPath) {
  const names = spawnSync('tar', ['-tzf', tarballPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const details = spawnSync('tar', ['-tvzf', tarballPath], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (names.status !== 0 || details.status !== 0 || names.stdout === null || details.stdout === null) throw new Error('tarball archive is invalid')
  const nameLines = names.stdout.split(/\r?\n/u).filter(function nonEmpty(line) { return line !== '' })
  const detailLines = details.stdout.split(/\r?\n/u).filter(function nonEmpty(line) { return line !== '' })
  if (nameLines.length !== detailLines.length) throw new Error('tarball archive is invalid')
  return nameLines.map(function readEntry(name, index) {
    if (name === 'package') name = 'package/'
    if (!name.startsWith('package/') || name.includes('\\') || name.split('/').some(function invalid(segment) { return segment === '' && name !== 'package/' || segment === '.' || segment === '..' })) {
      throw new Error('tarball file set mismatch')
    }
    const type = detailLines[index]?.[0]
    return { path: name, type: type === 'd' ? 'directory' : type === '-' ? 'regular' : 'special' }
  })
}
/** 校验 evidence-manifest 完整覆盖 root 且不自列。 */
export function validateEvidenceManifest(root, evidenceType) {
  const manifestRecord = readCanonicalJsonFile(join(root, 'evidence-manifest.json'), `${evidenceType} evidence manifest`)
  const expectedPaths = listRegularFiles(root).filter(function omitManifest(path) { return path !== 'evidence-manifest.json' })
  const files = manifestRecord.value.files
  assertExactKeys(manifestRecord.value, ['evidenceType', 'files', 'schemaVersion'], `${evidenceType} evidence manifest`)
  if (Array.isArray(files)) for (const entry of files) assertExactKeys(entry, ['bytes', 'path', 'sha256'], `${evidenceType} evidence file`)
  if (manifestRecord.value.schemaVersion !== 1 || manifestRecord.value.evidenceType !== evidenceType || !Array.isArray(files) ||
      JSON.stringify(files.map(function readPath(entry) { return entry.path })) !== JSON.stringify(expectedPaths)) {
    throw new Error(`${evidenceType} evidence manifest file set mismatch`)
  }
  for (const entry of files) {
    const bytes = readFileSync(join(root, entry.path))
    if (entry.bytes !== bytes.byteLength || entry.sha256 !== sha256(bytes)) throw new Error(`${evidenceType} evidence manifest hash mismatch`)
  }
  return sha256(manifestRecord.bytes)
}
/** 递归枚举 regular file 并拒绝 symlink/特殊文件。 */
function listRegularFiles(root, prefix = '') {
  const result = []
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(root, path))
    if (stat.isSymbolicLink()) throw new Error(`evidence symlink is forbidden: ${path}`)
    if (stat.isDirectory()) result.push(...listRegularFiles(root, path))
    else if (stat.isFile()) result.push(path)
    else throw new Error(`evidence entry is not regular: ${path}`)
  }
  return result.sort()
}
/** 校验 root 文件集合恰好匹配。 */
function assertRootFiles(root, expected, label) {
  const actual = listRegularFiles(root)
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) throw new Error(`${label} root contract mismatch`)
}
/** 校验两个排序字符串集合相同且均无重复。 */
function assertSameUniqueStrings(actual, expected, label) {
  if (new Set(actual).size !== actual.length || new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} mismatch`)
  }
}
/** 校验对象字段集合恰好匹配。 */
function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} fields are invalid`)
}
/** 读取并要求 JWord 生成 JSON 使用 canonical bytes。 */
function readCanonicalJsonFile(path, label) {
  const record = readJsonFile(path, label)
  if (!record.bytes.equals(canonicalBytes(record.value))) throw new Error(`${label} bytes are not canonical`)
  return record
}
/** 校验 final record 与 sidecar 的精确 canonical bytes。 */
export function validateFinalVerificationRecord(recordBytes, sidecarBytes, expectedRecord) {
  validateSha256Sidecar(sidecarBytes, recordBytes, 'final verification')
  let record
  try { record = JSON.parse(recordBytes.toString('utf8')) } catch { throw new Error('final verification record is invalid JSON') }
  const canonicalRecordBytes = canonicalBytes(record)
  if (!recordBytes.equals(canonicalRecordBytes)) throw new Error('final verification record bytes are invalid')
  if (!canonicalRecordBytes.equals(canonicalBytes(expectedRecord))) throw new Error('final verification record mismatch')
  return record
}
/** 写 final record 或复核已保存 record/sidecar。 */
function finish(options) {
  const record = verifyPhase3FinalEvidence(options)
  if (options.checkRecord !== undefined) {
    const recordBytes = readFileSync(options.checkRecord)
    const sidecarBytes = readFileSync(options.checkRecordSha256)
    validateFinalVerificationRecord(recordBytes, sidecarBytes, record)
    return record
  }
  const outputDirectory = assertPhase3PathOutside(repoRoot, options.outputDirectory, 'final evidence directory')
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length !== 0) throw new Error('final evidence directory must be empty')
  mkdirSync(outputDirectory, { recursive: true })
  const bytes = writeCanonicalJson(join(outputDirectory, 'final-verification.json'), record)
  writeFileSync(join(outputDirectory, 'final-verification.json.sha256'), createSha256Sidecar(bytes))
  return record
}
/** 解析生成模式或 check-record 模式的精确 CLI。 */
function parseArguments(args) {
  const options = {
    sourceRoot: resolve(readOption(args, '--source-root')),
    runARoot: resolve(readOption(args, '--run-a-root')),
    consumerRoot: resolve(readOption(args, '--consumer-root')),
    auditRoot: resolve(readOption(args, '--audit-root')),
    reproducibilityRoot: resolve(readOption(args, '--reproducibility-root'))
  }
  if (args.includes('--out-dir') && args.length === 12) return { ...options, outputDirectory: resolve(readOption(args, '--out-dir')) }
  if (args.includes('--check-record') && args.length === 14) return {
    ...options,
    checkRecord: resolve(readOption(args, '--check-record')),
    checkRecordSha256: resolve(readOption(args, '--check-record-sha256'))
  }
  throw new Error('usage: verify-phase3-final-evidence.mjs --source-root <path> --run-a-root <path> --consumer-root <path> --audit-root <path> --reproducibility-root <path> (--out-dir <path> | --check-record <path> --check-record-sha256 <path>)')
}
/** 读取恰好出现一次的 CLI option。 */
function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index !== args.lastIndexOf(name) || args[index + 1] === undefined) throw new Error(`${name} is required`)
  return args[index + 1]
}
/** 解析 job environment 只读校验参数。 */
function parseEnvironmentArguments(args) {
  if (args[0] !== '--check-environment' || ![3, 5].includes(args.length)) {
    throw new Error('usage: verify-phase3-final-evidence.mjs --check-environment (--source-report <path> | --artifact-manifest <path>)')
  }
  const options = {}
  for (let index = 1; index < args.length; index += 2) {
    const name = args[index]
    const value = args[index + 1]
    if (!['--source-report', '--artifact-manifest'].includes(name) || value === undefined || options[name] !== undefined) {
      throw new Error('job environment options are invalid')
    }
    options[name] = value
  }
  return { sourceReportPath: options['--source-report'], artifactManifestPath: options['--artifact-manifest'] }
}
/** 执行 final verifier CLI 并收敛诊断。 */
function main() {
  try {
    const args = process.argv.slice(2)
    if (args[0] === '--check-environment') {
      const options = parseEnvironmentArguments(args)
      const environment = validatePhase3JobEnvironment(options.sourceReportPath, options.artifactManifestPath)
      console.log(JSON.stringify({ status: 'passed', environment }))
      return
    }
    const record = finish(parseArguments(args))
    console.log(JSON.stringify({ status: 'passed', artifactSetId: record.artifactSetId }))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Phase 3 final verification failed')
    process.exitCode = 1
  }
}
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
