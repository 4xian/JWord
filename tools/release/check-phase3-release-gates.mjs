/**
 * 职责：从唯一 run-a 和 consumer handoff 生成 Phase 3 audit/release evidence。
 * 边界：只在两个显式 repo 外 assembly 和 evidence 目录操作，不构建、不打包、不发布。
 * 协作模块：artifact utils、只读 loopback registry、size、SBOM、provenance 与 rollback。
 * 性能/安全约束：customer/server 完全隔离，无凭据、无 first-party 外网 fallback、无真实 registry 写操作。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createPhase3SizeEvidence } from './check-phase3-artifact-size.mjs'
import { generatePhase3Provenance } from './generate-phase3-provenance.mjs'
import { generatePhase3Sbom } from './generate-phase3-sbom.mjs'
import { createCleanConsumerEnvironment } from './phase3-consumer-projects.mjs'
import { rehearsePhase3Rollback } from './rehearse-phase3-rollback.mjs'
import {
  assertPhase3Clean,
  assertPhase3PathOutside,
  canonicalBytes,
  readJsonFile,
  sha256,
  validateArtifactBinding,
  validateArtifactManifest,
  writeCanonicalJson
} from './phase3-artifact-utils.mjs'
import { validateAssemblyAuditPayload, validateConsumerRoot } from './verify-phase3-final-evidence.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
const rollbackFixturePath = join(repoRoot, 'fixtures/release/rollback-state.json')
const releasePolicyFixturePath = join(repoRoot, 'fixtures/release/release-policy.json')

/** 执行两个隔离 assembly 并生成完整 audit evidence root。 */
export async function runPhase3ReleaseGates(options) {
  assertPhase3Clean(repoRoot)
  const artifact = readArtifactInput(options.artifactManifestPath, options.bindingPath)
  const contract = readJsonFile(contractPath, 'package artifact contract').value
  validateConsumerRoot(options.consumerRoot, artifact, contract)
  const evidenceDirectory = prepareEmptyDirectory(options.evidenceDirectory, 'audit evidence directory')
  const customerDirectory = prepareEmptyDirectory(options.customerAssemblyDirectory, 'customer assembly directory')
  const serverDirectory = prepareEmptyDirectory(options.serverAssemblyDirectory, 'server assembly directory')
  const packageMap = readArtifactPackages(artifact)
  const customerPackages = contract.packages.filter(function isCustomer(entry) { return entry.delivery.startsWith('npm-') })
  const serverJourney = contract.journeys.find(function findServer(entry) { return entry.id === 'collab-server-image-node' })
  if (serverJourney === undefined) throw new Error('server assembly journey is missing')
  const serverNames = [...serverJourney.requestedPackages, ...serverJourney.firstPartyClosure]
  const serverPackages = serverNames.map(function readPackage(name) {
    const packageContract = contract.packages.find(function find(entry) { return entry.name === name })
    if (packageContract === undefined) throw new Error(`server package contract missing: ${name}`)
    return packageContract
  })

  const customer = await buildAssembly('customer', 'customer-production', customerDirectory, evidenceDirectory, customerPackages, packageMap, artifact.manifest.artifactSetId)
  assertPhase3Clean(repoRoot)
  const server = await buildAssembly('server', 'server-image', serverDirectory, evidenceDirectory, serverPackages, packageMap, artifact.manifest.artifactSetId)
  assertPhase3Clean(repoRoot)
  const size = createPhase3SizeEvidence({ contract, manifest: artifact.manifest, artifactRoot: artifact.root, consumerRoot: options.consumerRoot })
  if (size.status !== 'passed') throw new Error('Phase 3 size budget failed')
  writeCanonicalJson(join(evidenceDirectory, 'size-evidence.json'), size)
  const sbom = generatePhase3Sbom({
    artifactSetId: artifact.manifest.artifactSetId,
    firstPartyPackages: artifact.manifest.artifactIdentity.packages,
    customerList: customer.dependencyList,
    serverList: server.dependencyList,
    customerLockSha256: customer.evidence.lockfileSha256,
    serverLockSha256: server.evidence.lockfileSha256,
    customerListSha256: customer.evidence.dependencyListSha256,
    serverListSha256: server.evidence.dependencyListSha256
  })
  writeCanonicalJson(join(evidenceDirectory, 'sbom.spdx.json'), sbom)
  const provenance = generatePhase3Provenance(artifact.manifest, sha256(artifact.manifestBytes), sha256(artifact.checksumBytes))
  writeCanonicalJson(join(evidenceDirectory, 'provenance.intoto.json'), provenance)
  const rootManifest = readJsonFile(join(repoRoot, 'package.json'), 'root package manifest').value
  const readiness = createReleaseReadiness(contract, rootManifest)
  writeCanonicalJson(join(evidenceDirectory, 'readiness-evidence.json'), readiness)
  const rollbackDirectory = mkdtempSync(join(tmpdir(), 'jword-phase3-rollback-'))
  try {
    const rollback = rehearsePhase3Rollback(readJsonFile(rollbackFixturePath, 'rollback fixture').value, artifact.manifest.artifactSetId, rollbackDirectory)
    writeCanonicalJson(join(evidenceDirectory, 'rollback-evidence.json'), rollback)
  } finally {
    rmSync(rollbackDirectory, { recursive: true, force: true })
  }
  writeCanonicalJson(join(evidenceDirectory, 'audit-evidence.json'), createAuditSummary(artifact, customer.auditCounts, server.auditCounts))
  writeEvidenceManifest(evidenceDirectory, 'audit')
  assertPhase3Clean(repoRoot)
  return { status: 'passed', artifactSetId: artifact.manifest.artifactSetId, evidenceDirectory }
}

/** 读取并校验 run-a manifest/binding/checksum。 */
function readArtifactInput(manifestPath, bindingPath) {
  const absoluteManifest = resolve(manifestPath)
  const root = dirname(absoluteManifest)
  const manifestRecord = readJsonFile(absoluteManifest, 'artifact manifest')
  const checksumBytes = readFileSync(join(root, 'SHA256SUMS'))
  const manifest = validateArtifactManifest(manifestRecord.value, checksumBytes)
  const bindingRecord = readJsonFile(resolve(bindingPath), 'artifact binding')
  const binding = validateArtifactBinding(bindingRecord.value, manifestRecord.bytes, manifest, checksumBytes)
  return { root, manifest, manifestBytes: manifestRecord.bytes, checksumBytes, binding, bindingBytes: bindingRecord.bytes }
}

/** 读取 manifest 所列 tarball bytes 并绑定 contract package。 */
function readArtifactPackages(artifact) {
  return new Map(artifact.manifest.artifactIdentity.packages.map(function readPackage(entry) {
    const bytes = readFileSync(join(artifact.root, entry.tarballFile))
    if (bytes.byteLength !== entry.tarballBytes || sha256(bytes) !== entry.tarballSha256) throw new Error(`artifact tarball mismatch: ${entry.name}`)
    return [entry.name, { ...entry, bytes }]
  }))
}

/** 建立一套独立 assembly、运行 audit/list 并保存全部原始证据。 */
async function buildAssembly(key, kind, directory, evidenceDirectory, packageContracts, packageMap, artifactSetId) {
  const packages = packageContracts.map(function attachArtifact(entry) {
    const artifact = packageMap.get(entry.name)
    if (artifact === undefined) throw new Error(`${kind} artifact missing: ${entry.name}`)
    return artifact
  })
  const dependencies = createAssemblyDependencies(packageContracts, packageMap)
  const packageManifest = { name: `jword-phase3-${kind}`, version: '0.0.0', private: true, type: 'module', dependencies }
  const homeDirectory = join(directory, 'home')
  const tempDirectory = join(directory, 'tmp')
  const userConfig = join(directory, '.npmrc')
  mkdirSync(homeDirectory)
  mkdirSync(tempDirectory)
  writeJson(join(directory, 'package.json'), packageManifest)
  const registry = await startRegistry(packages, directory)
  writeFileSync(userConfig, `registry=https://registry.npmjs.org/\n@4xian:registry=${registry.origin}/\n`)
  const environment = {
    ...createCleanConsumerEnvironment(process.env),
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_CACHE: join(directory, 'cache'),
    CI: '1'
  }
  try {
    runCommand('pnpm', ['install', '--ignore-scripts', '--no-frozen-lockfile', '--store-dir', join(directory, 'store')], directory, environment, 'assembly install')
  } finally {
    await registry.close()
  }
  const registryEvidence = registry.evidence
  writeCanonicalJson(join(directory, 'registry-evidence.json'), registryEvidence)
  writeFileSync(join(directory, 'registry-transcript.json'), registry.transcriptBytes)
  const auditResult = runCaptured('pnpm', ['audit', '--prod', '--audit-level', 'high', '--json'], directory, environment)
  const listResult = runCaptured('pnpm', ['list', '--prod', '--depth', 'Infinity', '--json'], directory, environment)
  if (listResult.status !== 0) throw new Error(`${kind} dependency list failed`)
  const auditCounts = readAuditCounts(auditResult, kind)
  if (auditCounts.high !== 0 || auditCounts.critical !== 0) throw new Error(`${kind} high/critical audit failed`)
  const dependencyList = parseJsonBytes(listResult.stdout, `${kind} dependency list`)
  const dependenciesEvidence = readResolvedDependencies(directory, dependencyList)
  const rawDirectory = join(evidenceDirectory, 'raw', key)
  const assemblyEvidenceDirectory = join(evidenceDirectory, 'assemblies', key)
  mkdirSync(rawDirectory, { recursive: true })
  mkdirSync(assemblyEvidenceDirectory, { recursive: true })
  writeFileSync(join(rawDirectory, 'pnpm-audit.json'), auditResult.stdout)
  writeFileSync(join(rawDirectory, 'pnpm-list-prod.json'), listResult.stdout)
  for (const name of ['package.json', 'pnpm-lock.yaml', '.npmrc', 'registry-evidence.json', 'registry-transcript.json']) {
    cpSync(join(directory, name), join(assemblyEvidenceDirectory, name))
  }
  cpSync(join(directory, 'registry-responses'), join(assemblyEvidenceDirectory, 'registry-responses'), { recursive: true })
  const evidence = {
    schemaVersion: 1,
    artifactSetId,
    assemblyKind: kind,
    packageManifestSha256: sha256(readFileSync(join(assemblyEvidenceDirectory, 'package.json'))),
    lockfileSha256: sha256(readFileSync(join(assemblyEvidenceDirectory, 'pnpm-lock.yaml'))),
    registryConfigSha256: sha256(readFileSync(join(assemblyEvidenceDirectory, '.npmrc'))),
    registryEvidenceSha256: sha256(readFileSync(join(assemblyEvidenceDirectory, 'registry-evidence.json'))),
    registryTranscriptSha256: sha256(readFileSync(join(assemblyEvidenceDirectory, 'registry-transcript.json'))),
    auditSha256: sha256(auditResult.stdout),
    dependencyListSha256: sha256(listResult.stdout),
    dependencies: dependenciesEvidence
  }
  writeCanonicalJson(join(evidenceDirectory, `${key}-assembly-evidence.json`), evidence)
  return { evidence, dependencyList, auditCounts }
}

/** 合并 first-party 精确版本和 contract 声明的 external production dependencies。 */
function createAssemblyDependencies(packageContracts, packageMap) {
  const result = {}
  for (const contract of packageContracts) {
    result[contract.name] = packageMap.get(contract.name).version
    for (const group of ['external', 'externalPeers']) for (const [name, version] of Object.entries(contract.dependencyPolicy[group] ?? {})) {
      if (result[name] !== undefined && result[name] !== version) throw new Error(`assembly dependency conflict: ${name}`)
      result[name] = version
    }
  }
  return Object.fromEntries(Object.entries(result).sort(compareNamedEntry))
}

/** 启动只读 loopback registry 并保存每个响应的原始 bytes。 */
async function startRegistry(packages, directory) {
  const responsesDirectory = join(directory, 'registry-responses')
  const requests = []
  let unexpectedRequests = 0
  let writeAttempts = 0
  let servedPackages = packages
  mkdirSync(responsesDirectory)
  const server = createServer(function handleRequest(request, response) {
    const method = request.method ?? ''
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (!['GET', 'HEAD'].includes(method)) { writeAttempts += 1; response.writeHead(405).end(); return }
    const match = findRegistryResponse(servedPackages, path)
    if (match === undefined) { unexpectedRequests += 1; response.writeHead(404).end(); return }
    const payload = method === 'GET' ? match.payload : Buffer.alloc(0)
    const responseSha256 = sha256(payload)
    const responsePath = `registry-responses/${responseSha256}.bin`
    writeFileSync(join(directory, responsePath), payload)
    requests.push({ order: requests.length, method, path, status: 200, responseKind: match.kind, responsePath, responseSha256, responseBytes: payload.byteLength })
    response.setHeader('content-length', match.payload.byteLength)
    response.writeHead(200).end(method === 'GET' ? payload : undefined)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  servedPackages = packages.map(function attachMetadata(entry) { return { ...entry, metadata: createMetadata(entry, origin) } })
  return {
    origin,
    get evidence() { return createRegistryEvidence(servedPackages, requests, unexpectedRequests, writeAttempts) },
    get transcriptBytes() { return canonicalBytes({ schemaVersion: 1, requests }) },
    close: async function close() { server.close(); await once(server, 'close') }
  }
}

/** 从 tarball bytes 创建精确 npm metadata。 */
function createMetadata(entry, origin) {
  return canonicalBytes({
    name: entry.name,
    versions: { [entry.version]: { name: entry.name, version: entry.version, type: 'module', dist: {
      tarball: `${origin}/tarballs/${entry.tarballFile}`,
      shasum: createHash('sha1').update(entry.bytes).digest('hex'),
      integrity: `sha512-${createHash('sha512').update(entry.bytes).digest('base64')}`
    } } },
    'dist-tags': { latest: entry.version }
  })
}

/** 查找 metadata 或 tarball allowlist 响应。 */
function findRegistryResponse(packages, path) {
  for (const entry of packages) {
    if (path === `/tarballs/${entry.tarballFile}`) return { kind: 'tarball', payload: entry.bytes }
    if (decodeURIComponent(path.slice(1)) === entry.name) return { kind: 'metadata', payload: entry.metadata }
  }
}

/** 从 transcript 重算 registry evidence 并拒绝漏取/fallback/write。 */
function createRegistryEvidence(packages, requests, unexpectedRequests, writeAttempts) {
  const servedPackages = packages.map(function createEntry(entry) {
    const metadataRequests = countGets(requests, 'metadata', entry)
    const tarballRequests = countGets(requests, 'tarball', entry)
    const metadataPath = requests.find(function find(request) {
      return request.method === 'GET' && request.responseKind === 'metadata' && decodeURIComponent(request.path.slice(1)) === entry.name
    })?.responsePath ?? ''
    if (metadataRequests === 0 || tarballRequests === 0) throw new Error(`registry GET evidence missing: ${entry.name}`)
    return {
      name: entry.name,
      version: entry.version,
      tarballFile: entry.tarballFile,
      tarballSha256: sha256(entry.bytes),
      tarballShasum: createHash('sha1').update(entry.bytes).digest('hex'),
      tarballIntegrity: `sha512-${createHash('sha512').update(entry.bytes).digest('base64')}`,
      metadataPath,
      metadataSha256: sha256(entry.metadata),
      metadataBytes: entry.metadata.byteLength,
      metadataRequests,
      tarballRequests
    }
  }).sort(compareServedPackages)
  if (unexpectedRequests !== 0 || writeAttempts !== 0) throw new Error('registry rejected request count is nonzero')
  return { schemaVersion: 1, mode: 'read-only-loopback', host: '127.0.0.1', scope: '@4xian', allowedMethods: ['GET', 'HEAD'], servedPackages, unexpectedRequests, writeAttempts }
}

/** 统计一个包的 metadata/tarball GET。 */
function countGets(requests, kind, entry) {
  return requests.filter(function matches(request) {
    return request.method === 'GET' && request.responseKind === kind && (kind === 'metadata'
      ? decodeURIComponent(request.path.slice(1)) === entry.name
      : request.path === `/tarballs/${entry.tarballFile}`)
  }).length
}

/** 读取 assembly 中安装后的 first-party realpath。 */
function readResolvedDependencies(directory, dependencyList) {
  const dependencies = new Map()
  /** 递归读取 pnpm list 的 dependency 节点。 */
  function visit(node) {
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (node === null || typeof node !== 'object') return
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child === null || typeof child !== 'object' || typeof child.version !== 'string') throw new Error('assembly dependency list is invalid')
      const path = typeof child.path === 'string'
        ? realpathSync(child.path)
        : realpathSync(join(directory, 'node_modules', ...name.split('/')))
      const relativePath = relative(repoRoot, path)
      if (relativePath === '' || (!relativePath.startsWith('..') && !relativePath.startsWith('/'))) throw new Error('assembly dependency resolved into repository')
      dependencies.set(`${name}\0${child.version}\0${path}`, { name, version: child.version, realpath: path })
      visit(child)
    }
  }
  visit(dependencyList)
  return [...dependencies.values()].sort(function compareDependency(left, right) {
    const leftKey = `${left.name}\0${left.version}\0${left.realpath}`
    const rightKey = `${right.name}\0${right.version}\0${right.realpath}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

/** 解析 audit JSON 并区分 advisory 与外部服务失败。 */
function readAuditCounts(result, kind) {
  const report = parseJsonBytes(result.stdout, `${kind} audit`)
  validateAssemblyAuditPayload(report, kind)
  const counts = { high: report.metadata.vulnerabilities.high, critical: report.metadata.vulnerabilities.critical }
  if (result.status !== 0 && counts.high === 0 && counts.critical === 0) throw new Error(`${kind} audit is blocked`)
  return counts
}

/** 创建 synthetic policy 与真实 candidate fail-closed readiness。 */
export function createReleaseReadiness(
  contract = readJsonFile(contractPath, 'package artifact contract').value,
  rootManifest = readJsonFile(join(repoRoot, 'package.json'), 'root package manifest').value,
  policy = readJsonFile(releasePolicyFixturePath, 'release policy fixture').value
) {
  const { npmPackages, publicPackages, restrictedPackages, dockerPackages } = validateReleasePolicyInput(contract, rootManifest, policy)
  const passed = [
    ['lockstep-version', `synthetic ${policy.candidateVersion} keeps ${npmPackages.length} npm packages in lockstep`],
    ['changeset-draft', `synthetic changeset draft covers ${policy.changeset.packages.length} npm delivery packages`],
    ['registry-layering', `${publicPackages.length} public, ${restrictedPackages.length} restricted, and ${dockerPackages.length} docker-only package layers stay distinct`],
    ['2fa-required', `synthetic policy requires registry 2FA: ${policy.twoFactorRequired}`],
    ['dist-tag-transition', `candidate uses ${policy.distTags.candidate} before ${policy.distTags.stable}`],
    ['rollback-command-plan', `rollback policy freezes ${policy.rollback.actions.length} actions after ${policy.rollback.healthStatus} health`],
    ['signed-provenance-requirement', `formal release requires signed provenance: ${policy.signedProvenanceRequired}`]
  ].map(function createCheck([id, reason]) { return { id, status: 'passed', reason } })
  const blocked = [
    ['private-disabled', `repository remains private ${rootManifest.private === true}`],
    ['approved-version', `real version remains ${rootManifest.version}`],
    ['legal-license', 'legal license is not approved'],
    ['approved-changeset', 'real changeset is not approved'],
    ['registry-access', 'registry access is not verified'],
    ['registry-2fa', 'registry 2FA is not verified'],
    ['signed-provenance', 'provenance Statement is unsigned'],
    ['dist-tag-approval', 'dist-tag promotion is not approved'],
    ['rollback-owner', 'rollback owner remains deferred'],
    ['minimum-browser', 'minimum browser certification remains deferred']
  ].map(function createCheck([id, reason]) { return { id, status: 'blocked-as-expected', reason } })
  return {
    schemaVersion: 1,
    status: 'passed',
    registryOperations: 'not-run',
    ownerStatus: 'deferred',
    checks: [...passed, ...blocked].sort(compareId),
    commandPlan: [
      command(1, 'verify-access', 'public-and-restricted-registry'),
      command(2, 'verify-2fa', 'release-identity'),
      command(3, 'publish-next', `${npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`),
      command(4, 'promote-latest', `${npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`),
      command(5, 'restore-prior', 'recorded-previous-versions'),
      command(6, 'remove-next', `${npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`)
    ]
  }
}

/** 校验 readiness 的 contract/root manifest 输入，避免硬编码 synthetic 状态。 */
/** 校验 contract、root manifest 与 synthetic release policy 的逐项绑定。 */
function validateReleasePolicyInput(contract, rootManifest, policy) {
  const packages = contract?.packages
  if (contract === null || typeof contract !== 'object' || !Array.isArray(packages) || packages.length !== 12 ||
      rootManifest === null || typeof rootManifest !== 'object' || rootManifest.version !== '0.0.0' || rootManifest.private !== true) {
    throw new Error('release policy input is invalid')
  }
  const names = packages.map(function readName(entry) { return entry?.name })
  const npmPackages = packages.filter(function isNpm(entry) { return typeof entry?.delivery === 'string' && entry.delivery.startsWith('npm-') })
  const dockerPackages = packages.filter(function isDocker(entry) { return entry?.delivery === 'docker-image-internal' })
  const publicPackages = npmPackages.filter(function isPublic(entry) { return entry.registryIntent === 'public' })
  const restrictedPackages = npmPackages.filter(function isRestricted(entry) { return entry.registryIntent === 'restricted' })
  if (new Set(names).size !== names.length || npmPackages.length !== 11 || dockerPackages.length !== 1 ||
      npmPackages.some(function invalidNpm(entry) { return entry.version !== '0.0.0' || !['public', 'restricted'].includes(entry.registryIntent) }) ||
      dockerPackages[0].registryIntent !== 'not-published') {
    throw new Error('release policy input is invalid')
  }
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy) || policy.schemaVersion !== 1 ||
      policy.candidateVersion !== '1.2.3' || !hasExactKeys(policy, ['candidateVersion', 'changeset', 'distTags', 'npmPackageVersions', 'registryLayers', 'rollback', 'schemaVersion', 'signedProvenanceRequired', 'twoFactorRequired']) ||
      !hasExactKeys(policy.changeset, ['packages', 'status']) || policy.changeset.status !== 'draft' ||
      !hasExactKeys(policy.distTags, ['candidate', 'stable']) || policy.distTags.candidate !== 'next' || policy.distTags.stable !== 'latest' ||
      policy.twoFactorRequired !== true || policy.signedProvenanceRequired !== true ||
      !hasExactKeys(policy.registryLayers, ['dockerOnly', 'public', 'restricted']) ||
      !hasExactKeys(policy.rollback, ['actions', 'healthStatus', 'priorChannel']) || policy.rollback.healthStatus !== 'failed' || policy.rollback.priorChannel !== 'latest' ||
      JSON.stringify(policy.rollback.actions) !== JSON.stringify(['verify-prior', 'promote-candidate', 'health-check', 'restore-prior', 'clear-candidate'])) {
    throw new Error('release policy input is invalid')
  }
  const expectedNpm = npmPackages.map(function createVersion(entry) { return { name: entry.name, version: policy.candidateVersion } }).sort(comparePolicyEntry)
  const actualNpm = Array.isArray(policy.npmPackageVersions) ? policy.npmPackageVersions : []
  if (!actualNpm.every(function validEntry(entry) { return entry !== null && typeof entry === 'object' && hasExactKeys(entry, ['name', 'version']) }) ||
      JSON.stringify(actualNpm) !== JSON.stringify(expectedNpm) ||
      !sameSortedNames(policy.changeset.packages, npmPackages.map(function readName(entry) { return entry.name })) ||
      !sameSortedNames(policy.registryLayers.public, publicPackages.map(function readName(entry) { return entry.name })) ||
      !sameSortedNames(policy.registryLayers.restricted, restrictedPackages.map(function readName(entry) { return entry.name })) ||
      !sameSortedNames(policy.registryLayers.dockerOnly, dockerPackages.map(function readName(entry) { return entry.name }))) {
    throw new Error('release policy input is invalid')
  }
  return { npmPackages, publicPackages, restrictedPackages, dockerPackages }
}

/** 比较 policy entry 的稳定名称顺序。 */
function comparePolicyEntry(left, right) { return left.name < right.name ? -1 : left.name > right.name ? 1 : 0 }

/** 比较 policy 中的 package name 集合。 */
function sameSortedNames(actual, expected) {
  return Array.isArray(actual) && actual.every(function isName(value) { return typeof value === 'string' }) &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()) && new Set(actual).size === actual.length
}

/** 判断对象是否恰好包含一组字段。 */
function hasExactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

/** 创建固定为 not-run 的 release action。 */
function command(order, action, target) { return { order, action, target, execution: 'not-run' } }

/** 创建 audit summary 共同 envelope。 */
function createAuditSummary(artifact, customer, server) {
  return {
    schemaVersion: 1,
    evidenceType: 'audit',
    gitSha: artifact.manifest.artifactIdentity.gitSha,
    lockfileSha256: artifact.manifest.artifactIdentity.lockfileSha256,
    artifactSetId: artifact.manifest.artifactSetId,
    bindingSha256: sha256(artifact.bindingBytes),
    status: 'passed',
    checks: {
      customerAssemblyPassed: true,
      serverAssemblyPassed: true,
      customerHigh: customer.high,
      customerCritical: customer.critical,
      serverHigh: server.high,
      serverCritical: server.critical,
      sizePassed: true,
      sbomPassed: true,
      provenancePredicatePassed: true,
      provenanceAttestationStatus: 'unsigned',
      rollbackPassed: true,
      policyRehearsalPassed: true,
      releaseCandidateStatus: 'blocked-as-expected'
    }
  }
}

/** 枚举 evidence 文件并写不自列的完整 manifest。 */
function writeEvidenceManifest(directory, evidenceType) {
  const files = listRegularFiles(directory).filter(function omit(path) { return path !== 'evidence-manifest.json' }).map(function readEntry(path) {
    const bytes = readFileSync(join(directory, path))
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
  })
  writeCanonicalJson(join(directory, 'evidence-manifest.json'), { schemaVersion: 1, evidenceType, files })
}

/** 递归枚举 regular file。 */
function listRegularFiles(directory, prefix = '') {
  const result = []
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(directory, path))
    if (stat.isSymbolicLink()) throw new Error(`audit evidence symlink is forbidden: ${path}`)
    if (stat.isDirectory()) result.push(...listRegularFiles(directory, path))
    else if (stat.isFile()) result.push(path)
    else throw new Error(`audit evidence entry is not regular: ${path}`)
  }
  return result.sort()
}

/** 准备显式 repo 外空目录。 */
function prepareEmptyDirectory(path, label) {
  const directory = assertPhase3PathOutside(repoRoot, resolve(path), label)
  mkdirSync(directory, { recursive: true })
  if (readdirSync(directory).length !== 0) throw new Error(`${label} must be empty`)
  return directory
}

/** 执行必须成功的子进程。 */
function runCommand(command, args, cwd, env, label) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error(`${label} failed`)
  return result
}

/** 执行需要保留原始 stdout 的子进程。 */
function runCaptured(command, args, cwd, env) {
  const result = spawnSync(command, args, { cwd, env, encoding: null, maxBuffer: 32 * 1024 * 1024 })
  return { status: result.status, stdout: result.stdout ?? Buffer.alloc(0) }
}

/** 解析原始 JSON bytes 并收敛错误。 */
function parseJsonBytes(bytes, label) {
  try { return JSON.parse(bytes.toString('utf8')) } catch { throw new Error(`${label} is invalid JSON`) }
}

/** 写格式化 assembly manifest。 */
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }

/** 按依赖名排序。 */
function compareNamedEntry(left, right) { return left[0] < right[0] ? -1 : left[0] > right[0] ? 1 : 0 }

/** 按 served package tuple 排序。 */
function compareServedPackages(left, right) {
  const leftKey = `${left.name}\0${left.version}\0${left.tarballFile}`
  const rightKey = `${right.name}\0${right.version}\0${right.tarballFile}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 按 evidence ID 排序。 */
function compareId(left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0 }

/** 解析 production CLI。 */
function parseArguments(args) {
  if (args.length !== 12) throw new Error('usage: check-phase3-release-gates.mjs --artifact-manifest <path> --binding <path> --consumer-root <path> --customer-assembly-dir <path> --server-assembly-dir <path> --evidence-dir <path>')
  return {
    artifactManifestPath: readOption(args, '--artifact-manifest'),
    bindingPath: readOption(args, '--binding'),
    consumerRoot: resolve(readOption(args, '--consumer-root')),
    customerAssemblyDirectory: readOption(args, '--customer-assembly-dir'),
    serverAssemblyDirectory: readOption(args, '--server-assembly-dir'),
    evidenceDirectory: readOption(args, '--evidence-dir')
  }
}

/** 读取恰好出现一次的 CLI option。 */
function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index !== args.lastIndexOf(name) || args[index + 1] === undefined) throw new Error(`${name} is required`)
  return args[index + 1]
}

/** 执行 release gate CLI。 */
async function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const result = await runPhase3ReleaseGates(options)
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Phase 3 release gates failed')
    process.exitCode = 1
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
