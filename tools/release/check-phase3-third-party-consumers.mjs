/**
 * 职责：从 Phase 3 artifact inventory 编排 npm/pnpm、Node、browser、Worker 与 License 消费矩阵。
 * 边界：只消费显式 manifest/binding 与仓库外 evidence 目录，不构建或打包 JWord package。
 * 协作模块：产物公共工具、消费项目源码生成器与发布契约。
 * 性能/安全约束：first-party 只经 127.0.0.1 的 GET/HEAD registry 读取，禁止写入与 fallback。
 */
import { createHash } from 'node:crypto'
import { execFile, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:http'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { tmpdir } from 'node:os'
import { promisify } from 'node:util'
import {
  assertPhase3PathOutside,
  assertPhase3Clean,
  canonicalBytes,
  readPackedManifest,
  readJsonFile,
  readToolVersion,
  sha256,
  validateArtifactBinding,
  validateArtifactManifest,
  writeCanonicalJson
} from './phase3-artifact-utils.mjs'
import {
  createCleanConsumerEnvironment,
  createConsumerBundleEvidence,
  createConsumerProjectManifest,
  createConsumerSourceInventory,
  isPathInside,
  prepareLicenseRuntimeEntries,
  readInstallProjectRoot,
  readProductionGoldenToken,
  readConsumerSource,
  readResolvedPackages,
  stripJourneyArtifactSetId
} from './phase3-consumer-projects.mjs'
const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
const usage = 'usage: check-phase3-third-party-consumers.mjs --artifact-manifest <path> --binding <path> --evidence-dir <path>'
const execFileAsync = promisify(execFile)
/** 执行 production consumer CLI 并输出结构化结果。 */
async function main() {
  try {
    const options = readConsumerOptions(process.argv.slice(2))
    const report = await runPhase3Consumers(options)
    console.log(JSON.stringify(report, null, 2))
  } catch (error) {
    console.error(readErrorMessage(error))
    process.exitCode = 1
  }
}
/** 读取恰好三个必需的 production CLI 参数。 */
function readConsumerOptions(args) {
  const artifactManifestPath = readOption(args, '--artifact-manifest')
  const bindingPath = readOption(args, '--binding')
  const evidenceDirectory = readOption(args, '--evidence-dir')
  if (args.length !== 6 || artifactManifestPath === undefined || bindingPath === undefined || evidenceDirectory === undefined) {
    throw new Error(usage)
  }
  return { artifactManifestPath, bindingPath, evidenceDirectory }
}
/** 读取一个不允许重复的命令行 option。 */
function readOption(args, name) {
  const indexes = []
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) indexes.push(index)
  }
  if (indexes.length !== 1) return undefined
  return args[indexes[0] + 1]
}
/** 校验 manifest/binding 并返回后续 matrix 使用的冻结输入。 */
export function readConsumerArtifact(artifactManifestPath, bindingPath) {
  const manifestRecord = readJsonFile(resolve(artifactManifestPath), 'artifact manifest')
  const manifestBytes = manifestRecord.bytes
  const manifest = manifestRecord.value
  const checksumBytes = readFileSync(join(dirname(resolve(artifactManifestPath)), 'SHA256SUMS'))
  const bindingRecord = readJsonFile(resolve(bindingPath), 'artifact binding')
  const bindingBytes = bindingRecord.bytes
  const binding = bindingRecord.value
  validateArtifactManifest(manifest, checksumBytes)
  validateArtifactBinding(binding, manifestBytes, manifest, checksumBytes)
  return { manifest, binding, bindingSha256: sha256(bindingBytes) }
}
/** 从机器 contract 生成并执行完整 consumer matrix。 */
export async function runPhase3Consumers(options) {
  const { manifest, binding, bindingSha256 } = readConsumerArtifact(options.artifactManifestPath, options.bindingPath)
  const contractRecord = readConsumerContract(
    dirname(resolve(options.artifactManifestPath)),
    manifest.artifactIdentity.contractSha256
  )
  const contract = contractRecord.contract
  /** 仅正式 JWord contract 要求当前 checkout 在全部 checkpoint 保持 clean。 */
  const assertConsumerClean = function assertConsumerCleanCheckpoint() {
    if (contractRecord.production) assertPhase3Clean(repoRoot)
  }
  const evidenceDirectory = resolve(options.evidenceDirectory)
  const temporaryRootPath = join(tmpdir(), 'jword-phase3-consumer-')
  assertPhase3PathOutside(repoRoot, temporaryRootPath, 'consumer temporary directory')
  const temporaryRoot = mkdtempSync(temporaryRootPath)
  try {
    assertConsumerClean()
    assertPhase3PathOutside(repoRoot, evidenceDirectory, 'consumer evidence directory')
    assertEmptyOutputDirectory(evidenceDirectory)
    mkdirSync(evidenceDirectory, { recursive: true })
    assertConsumerContract(contract)
    const packageMap = readArtifactPackages(manifest, dirname(resolve(options.artifactManifestPath)))
    const sourceResults = writeConsumerSources(contract, evidenceDirectory, manifest.artifactSetId)
    const installResults = []
    for (const journey of contract.journeys) {
      for (const packageManager of ['npm', 'pnpm']) {
        installResults.push(await runInstallJourney(
          journey,
          packageManager,
          packageMap,
          contract,
          temporaryRoot,
          evidenceDirectory,
          manifest.artifactSetId,
          sourceResults
        ))
        assertConsumerClean()
      }
    }
    const journeyResults = createJourneyResults(contract, installResults, manifest.artifactSetId)
    const installEvidence = createInstallEvidence(installResults, evidenceDirectory)
    const exportEvidence = createExportEvidence(contract, sourceResults, installResults, manifest.artifactSetId)
    const bundleEvidence = createConsumerBundleEvidence(installResults, manifest.artifactSetId)
    assertConsumerClean()
    writeConsumerEvidence(evidenceDirectory, {
      artifactSetId: manifest.artifactSetId,
      binding,
      bindingSha256,
      gitSha: manifest.artifactIdentity.gitSha,
      lockfileSha256: manifest.artifactIdentity.lockfileSha256,
      journeyResults,
      installEvidence,
      exportEvidence,
      bundleEvidence
    })
    assertConsumerClean()
    return {
      status: 'ok',
      mode: 'artifact',
      artifactSetId: manifest.artifactSetId,
      bindingSha256,
      evidenceDirectory,
      packageManagers: ['npm', 'pnpm'],
      registry: { host: '127.0.0.1', allowedMethods: ['GET', 'HEAD'] },
      journeys: journeyResults
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}
/** 运行 Gate 5/6/7 inventory-only 兼容入口。 */
export async function runLegacyConsumerCli(name, args) {
  try {
    const artifactManifestPath = readOption(args, '--artifact-manifest')
    const bindingPath = readOption(args, '--binding')
    if (args.length !== 4 || artifactManifestPath === undefined || bindingPath === undefined) {
      throw new Error(`usage: ${name} --artifact-manifest <path> --binding <path>`)
    }
    const { manifest } = readConsumerArtifact(artifactManifestPath, bindingPath)
    console.log(JSON.stringify({
      status: 'ok',
      name,
      mode: 'legacy-non-gating',
      artifactSetId: manifest.artifactSetId,
      repacks: 0
    }, null, 2))
  } catch (error) {
    console.error(readErrorMessage(error))
    process.exitCode = 1
  }
}
/** 校验 contract 至少包含全部生产 journey 且 server 不进入 browser。 */
function assertConsumerContract(contract) {
  if (!Array.isArray(contract.packages) || !Array.isArray(contract.journeys) || contract.journeys.length === 0) {
    throw new Error('Phase 3 consumer contract is empty')
  }
  const serverJourney = contract.journeys.find(function findServerJourney(journey) {
    return journey.id === 'collab-server-image-node'
  })
  if (serverJourney === undefined || serverJourney.runtimes.some(function isBrowserRuntime(runtime) {
    return runtime === 'vite-browser' || runtime === 'dedicated-worker'
  })) {
    throw new Error('collab-server consumer boundary is invalid')
  }
}
/** 读取 synthetic fixture 邻近的 contract，否则使用仓库固定 contract。 */
function readConsumerContract(artifactDirectory, expectedSha256) {
  const adjacentPath = join(artifactDirectory, 'package-artifact-contract.json')
  const productionRecord = readJsonFile(contractPath, 'package artifact contract')
  const record = readJsonFile(
    existsSync(adjacentPath) ? adjacentPath : contractPath,
    'package artifact contract'
  )
  if (sha256(record.bytes) !== expectedSha256) throw new Error('package artifact contract hash mismatch')
  return { contract: record.value, production: expectedSha256 === sha256(productionRecord.bytes) }
}
/** 读取并校验 manifest 所列 tarball 的原始 bytes。 */
function readArtifactPackages(manifest, artifactDirectory) {
  const packageMap = new Map()
  for (const packageEntry of manifest.artifactIdentity.packages) {
    const tarballPath = join(artifactDirectory, packageEntry.tarballFile)
    if (!existsSync(tarballPath)) throw new Error(`artifact tarball missing: ${packageEntry.name}`)
    const bytes = readFileSync(tarballPath)
    if (sha256(bytes) !== packageEntry.tarballSha256 || bytes.byteLength !== packageEntry.tarballBytes) {
      throw new Error(`artifact tarball hash mismatch: ${packageEntry.name}`)
    }
    const packedManifest = readPackedManifest(tarballPath, packageEntry)
    packageMap.set(packageEntry.name, { ...packageEntry, bytes, packedManifest })
  }
  return packageMap
}
/** 为一个 journey 启动独立 loopback registry 并运行 npm 或 pnpm install。 */
async function runInstallJourney(
  journey,
  packageManager,
  packageMap,
  contract,
  temporaryRoot,
  evidenceDirectory,
  artifactSetId,
  sources
) {
  const installId = `${journey.id}--${packageManager}`
  const projectDirectory = join(temporaryRoot, installId)
  const handoffDirectory = join(evidenceDirectory, 'raw', 'installs', installId)
  mkdirSync(projectDirectory, { recursive: true })
  mkdirSync(handoffDirectory, { recursive: true })
  const requestedPackages = [...journey.requestedPackages].sort()
  const firstPartyClosure = [...journey.firstPartyClosure].sort()
  const firstPartyNames = [...requestedPackages, ...firstPartyClosure]
  const servedPackages = firstPartyNames.map(function selectPackage(name) {
    const packageEntry = packageMap.get(name)
    if (packageEntry === undefined) throw new Error(`journey package missing: ${name}`)
    return packageEntry
  })
  const registry = await startConsumerRegistry(servedPackages, handoffDirectory)
  writeJson(join(projectDirectory, 'package.json'), createConsumerProjectManifest(journey, servedPackages, contract))
  const homeDirectory = join(projectDirectory, 'home')
  const tempDirectory = join(projectDirectory, 'tmp')
  const userConfig = join(projectDirectory, '.npmrc')
  mkdirSync(homeDirectory)
  mkdirSync(tempDirectory)
  writeFileSync(userConfig, `registry=https://registry.npmjs.org/\n@4xian:registry=${registry.origin}/\n`)
  const environment = {
    ...createCleanConsumerEnvironment(process.env),
    HOME: homeDirectory,
    TMPDIR: tempDirectory,
    NPM_CONFIG_USERCONFIG: userConfig,
    NPM_CONFIG_CACHE: join(projectDirectory, 'cache'),
    CI: '1'
  }
  try {
    const arguments_ = packageManager === 'npm'
      ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(projectDirectory, 'cache')]
      : ['install', '--ignore-scripts', '--no-frozen-lockfile', '--store-dir', join(projectDirectory, 'store')]
    await execFileAsync(packageManager, arguments_, { cwd: projectDirectory, env: environment })
  } finally {
    await registry.close()
  }
  const runtimeEvidence = await runRuntimeProbes(journey, projectDirectory, installId, evidenceDirectory, sources)
  const lockfileName = packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'
  const treeCommand = packageManager === 'npm'
    ? ['ls', '--all', '--json']
    : ['list', '--depth', 'Infinity', '--json']
  const treeBytes = Buffer.from(execFileSync(packageManager, treeCommand, {
    cwd: projectDirectory,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe']
  }))
  const rawFiles = {
    manifestPath: `raw/installs/${installId}/package.json`,
    lockfilePath: `raw/installs/${installId}/${lockfileName}`,
    dependencyTreePath: `raw/installs/${installId}/dependency-tree.json`,
    registryConfigPath: `raw/installs/${installId}/.npmrc`,
    registryEvidencePath: `raw/installs/${installId}/registry-evidence.json`,
    registryTranscriptPath: `raw/installs/${installId}/registry-transcript.json`
  }
  const persisted = [
    ['package.json', readFileSync(join(projectDirectory, 'package.json'))],
    [lockfileName, readFileSync(join(projectDirectory, lockfileName))],
    ['dependency-tree.json', treeBytes],
    ['.npmrc', readFileSync(userConfig)],
    ['registry-evidence.json', registry.evidenceBytes],
    ['registry-transcript.json', registry.transcriptBytes]
  ]
  for (const [name, bytes] of persisted) writeFileSync(join(handoffDirectory, name), bytes)
  return {
    id: installId,
    journey: journey.id,
    packageManager,
    packageManagerVersion: readToolVersion(packageManager),
    artifactSetId,
    requestedPackages,
    firstPartyClosure,
    resolvedPackages: readResolvedPackages(projectDirectory, servedPackages, requestedPackages, repoRoot),
    rawFiles,
    registry: registry.evidence,
    runtimeEvidence,
    bundles: runtimeEvidence.bundles
  }
}
/** 对当前 journey 执行 contract 声明的 Node、types 与 browser runtime。 */
async function runRuntimeProbes(journey, projectDirectory, installId, evidenceDirectory, sources) {
  const results = []
  const bundles = []
  const nodeTargets = journey.targets.filter(function isNodeTarget(target) {
    return target.environment === 'node' || target.environment === 'image-node'
  })
  const typeTargets = journey.targets.filter(function isTypeTarget(target) {
    return target.environment === 'types'
  })
  if (nodeTargets.length > 0) {
    const nodeSource = readConsumerSource(sources, journey.id, journey.runtimes.includes('image-node') ? 'image-node' : 'node')
    const runtimeEntries = journey.id === 'license-runtime-identity' ? prepareLicenseRuntimeEntries(projectDirectory) : []
    const licenseToken = journey.id === 'license-runtime-identity' ? readProductionGoldenToken(repoRoot) : undefined
    await runNodeProbe(projectDirectory, nodeSource.source, runtimeEntries, licenseToken)
    results.push({ runtime: journey.runtimes.includes('image-node') ? 'image-node' : 'node', browser: 'none', status: 'passed' })
  }
  if (typeTargets.length > 0) {
    const typeSource = readConsumerSource(sources, journey.id, 'types')
    const typeProbePath = join(projectDirectory, 'phase3-types.ts')
    writeFileSync(typeProbePath, typeSource.source)
    await execFileAsync(join(repoRoot, 'node_modules/.bin/tsc'), [
      '--noEmit',
      '--target', 'ES2022',
      '--module', 'NodeNext',
      '--moduleResolution', 'NodeNext',
      '--skipLibCheck',
      typeProbePath
    ], { cwd: projectDirectory })
    results.push({ runtime: 'types', browser: 'none', status: 'passed' })
  }
  if (journey.runtimes.includes('vite-browser')) {
    const browserResult = await runBrowserMatrix(journey, projectDirectory, installId, evidenceDirectory, sources)
    results.push(...browserResult.results)
    bundles.push(...browserResult.bundles)
  }
  return { results, bundles }
}
/** 从临时源码文件执行 Node probe，避免源码或 License token 进入命令参数。 */
export function runNodeProbe(projectDirectory, source, runtimeEntries = [], licenseToken) {
  writeFileSync(join(projectDirectory, 'phase3-node.mjs'), source)
  return execFileAsync(process.execPath, [join(projectDirectory, 'phase3-node.mjs'), ...runtimeEntries], { cwd: projectDirectory, env: licenseToken === undefined ? process.env : { ...process.env, JWORD_PHASE3_LICENSE_TOKEN: licenseToken } })
}
/** 通过 Vite 和 contract 指定的当前浏览器矩阵执行真实 mount。 */
async function runBrowserMatrix(journey, projectDirectory, installId, evidenceDirectory, sources) {
  const browserModule = await import('@playwright/test')
  const browsers = journey.browserMatrix ?? (journey.id === 'synthetic-browser'
    ? ['chromium']
    : ['chromium', 'firefox', 'webkit'])
  const results = []
  const packageManager = installId.endsWith('--npm') ? 'npm' : 'pnpm'
  const bundles = []
  const browserRuntimes = journey.runtimes.filter(function selectBrowserRuntime(runtime) {
    return runtime === 'vite-browser' || runtime === 'dedicated-worker'
  })

  for (const runtime of browserRuntimes) {
    const runtimeProjectDirectory = join(projectDirectory, `phase3-${runtime}`)
    const sourceRecord = readConsumerSource(sources, journey.id, runtime)
    mkdirSync(runtimeProjectDirectory, { recursive: true })
    writeFileSync(join(runtimeProjectDirectory, 'index.html'), '<div id="app"></div><script type="module" src="/consumer.js"></script>\n')
    writeFileSync(join(runtimeProjectDirectory, 'consumer.js'), sourceRecord.source)
    for (const [path, bytes] of Object.entries(sourceRecord.files)) {
      mkdirSync(dirname(join(runtimeProjectDirectory, path)), { recursive: true })
      writeFileSync(join(runtimeProjectDirectory, path), bytes)
    }
    await execFileAsync(join(repoRoot, 'node_modules/.bin/vite'), ['build'], { cwd: runtimeProjectDirectory })

    const server = createStaticServer(join(runtimeProjectDirectory, 'dist'))
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    try {
      for (const browserName of browsers) {
        const browser = await browserModule[browserName].launch({ headless: true })
        try {
          const page = await browser.newPage()
          await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: 'networkidle' })
          await page.waitForFunction(function readReadyState() {
            return globalThis.document.documentElement.dataset.jwordReady !== undefined
          })
        } finally {
          await browser.close()
        }
        results.push({ runtime, browser: browserName, status: 'passed' })
        const bundleId = `${journey.id}--${packageManager}--${runtime}--${browserName}`
        for (const path of listRegularFiles(join(runtimeProjectDirectory, 'dist'))) {
          const bytes = readFileSync(join(runtimeProjectDirectory, 'dist', path))
          const evidencePath = `bundles/${bundleId}/${path}`
          mkdirSync(dirname(join(evidenceDirectory, evidencePath)), { recursive: true })
          writeFileSync(join(evidenceDirectory, evidencePath), bytes)
          bundles.push({
            journey: journey.id, packageManager, runtime, browser: browserName, path: evidencePath,
            bytes: bytes.byteLength, sha256: sha256(bytes)
          })
        }
      }
    } finally {
      server.close()
      await once(server, 'close')
    }
  }

  return { results, bundles }
}
/** 提供仅用于当前 synthetic bundle 的静态文件服务器。 */
function createStaticServer(directory) {
  return createServer(function serveStatic(request, response) {
    const requestPath = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    const relativePath = requestPath === '/' ? 'index.html' : requestPath.slice(1)
    if (relativePath.includes('..')) {
      response.writeHead(400).end()
      return
    }
    const path = join(directory, relativePath)
    if (!existsSync(path)) {
      response.writeHead(404).end()
      return
    }
    const contentType = relativePath.endsWith('.js')
      ? 'text/javascript'
      : relativePath.endsWith('.css')
        ? 'text/css'
        : 'text/html'
    response.setHeader('content-type', contentType)
    response.writeHead(200).end(readFileSync(path))
  })
}
/** 递归枚举 dist 中的 regular file。 */
function listRegularFiles(directory, prefix = '') {
  const paths = []
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(directory, path))
    if (stat.isDirectory()) paths.push(...listRegularFiles(directory, path))
    else if (stat.isFile()) paths.push(path)
  }
  return paths
}
/** 启动只读 loopback registry，并把 GET raw response 写入 handoff。 */
async function startConsumerRegistry(packages, handoffDirectory) {
  const responsesDirectory = join(handoffDirectory, 'registry-responses')
  const requests = []
  let unexpectedRequests = 0
  let writeAttempts = 0
  let servedPackages = packages
  mkdirSync(responsesDirectory, { recursive: true })
  const server = createServer(function handleRequest(request, response) {
    const method = request.method ?? ''
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (method !== 'GET' && method !== 'HEAD') {
      writeAttempts += 1
      response.writeHead(405).end()
      return
    }
    const match = findRegistryResponse(servedPackages, path)
    if (match === undefined) {
      unexpectedRequests += 1
      response.writeHead(404).end()
      return
    }
    const payload = method === 'GET' ? match.payload : Buffer.alloc(0)
    const responseSha256 = sha256(payload)
    const responsePath = `registry-responses/${responseSha256}.bin`
    writeFileSync(join(handoffDirectory, responsePath), payload)
    requests.push({
      order: requests.length,
      method,
      path,
      status: 200,
      responseKind: match.kind,
      responsePath,
      responseSha256,
      responseBytes: payload.byteLength
    })
    response.setHeader('content-length', match.payload.byteLength)
    response.writeHead(200).end(method === 'GET' ? payload : undefined)
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  const origin = `http://127.0.0.1:${address.port}`
  const metadata = new Map(packages.map(function createMetadata(packageEntry) {
    return [packageEntry.name, createPackageMetadata(packageEntry, origin)]
  }))
  servedPackages = packages.map(function attachMetadata(packageEntry) {
    return { ...packageEntry, metadata: metadata.get(packageEntry.name) }
  })
  return {
    origin,
    get evidence() {
      return createRegistryEvidence(servedPackages, requests, unexpectedRequests, writeAttempts)
    },
    get evidenceBytes() { return canonicalBytes(this.evidence) },
    get transcriptBytes() { return canonicalBytes({ schemaVersion: 1, requests }) },
    close: async function closeRegistry() {
      server.close()
      await once(server, 'close')
    }
  }
}
/** 解析 allowlist metadata/tarball 响应。 */
function findRegistryResponse(packages, path) {
  for (const packageEntry of packages) {
    if (path === `/tarballs/${packageEntry.tarballFile}`) {
      return { packageEntry, kind: 'tarball', payload: packageEntry.bytes }
    }
    if (decodeURIComponent(path.slice(1)) === packageEntry.name) {
      return { packageEntry, kind: 'metadata', payload: packageEntry.metadata }
    }
  }
}
/** 从同一 tarball bytes 创建 npm registry metadata raw response。 */
function createPackageMetadata(packageEntry, origin) {
  return canonicalBytes({
    name: packageEntry.name,
    versions: {
      [packageEntry.version]: {
        name: packageEntry.name,
        version: packageEntry.version,
        type: 'module',
        dependencies: packageEntry.packedManifest.dependencies ?? {},
        peerDependencies: packageEntry.packedManifest.peerDependencies ?? {},
        dist: {
          tarball: `${origin}/tarballs/${packageEntry.tarballFile}`,
          shasum: createHash('sha1').update(packageEntry.bytes).digest('hex'),
          integrity: `sha512-${createHash('sha512').update(packageEntry.bytes).digest('base64')}`
        }
      }
    },
    'dist-tags': { latest: packageEntry.version }
  })
}
/** 从已完成 transcript 重算固定 registry evidence。 */
function createRegistryEvidence(packages, requests, unexpectedRequests, writeAttempts) {
  const servedPackages = packages.map(function createServedPackage(packageEntry) {
    const metadataRequests = countRegistryGets(requests, 'metadata', packageEntry.name, packageEntry.tarballFile)
    const tarballRequests = countRegistryGets(requests, 'tarball', packageEntry.name, packageEntry.tarballFile)
    const metadataPath = requests.find(function findMetadataRequest(request) {
      return request.method === 'GET' && request.responseKind === 'metadata' &&
        decodeURIComponent(request.path.slice(1)) === packageEntry.name
    })?.responsePath ?? ''
    return {
      name: packageEntry.name,
      version: packageEntry.version,
      tarballFile: packageEntry.tarballFile,
      tarballSha256: sha256(packageEntry.bytes),
      tarballShasum: createHash('sha1').update(packageEntry.bytes).digest('hex'),
      tarballIntegrity: `sha512-${createHash('sha512').update(packageEntry.bytes).digest('base64')}`,
      metadataPath,
      metadataSha256: sha256(packageEntry.metadata),
      metadataBytes: packageEntry.metadata.byteLength,
      metadataRequests,
      tarballRequests
    }
  }).sort(compareServedPackages)
  for (const packageEntry of servedPackages) {
    if (packageEntry.metadataRequests === 0 || packageEntry.tarballRequests === 0) {
      throw new Error(`registry GET evidence missing: ${packageEntry.name}`)
    }
  }
  if (unexpectedRequests !== 0 || writeAttempts !== 0) {
    throw new Error('registry rejected request count is nonzero')
  }
  return {
    schemaVersion: 1,
    mode: 'read-only-loopback',
    host: '127.0.0.1',
    scope: '@4xian',
    allowedMethods: ['GET', 'HEAD'],
    servedPackages,
    unexpectedRequests,
    writeAttempts
  }
}
/** 统计一个 allowlist package 的必需 GET 响应。 */
function countRegistryGets(requests, kind, packageName, tarballFile) {
  return requests.filter(function isMatchingGet(request) {
    if (request.method !== 'GET' || request.responseKind !== kind) return false
    return kind === 'metadata'
      ? decodeURIComponent(request.path.slice(1)) === packageName
      : request.path === `/tarballs/${tarballFile}`
  }).length
}
/** 按 name/version/tarballFile 冻结 served package 顺序。 */
function compareServedPackages(left, right) {
  return compareAscii(
    `${left.name}\0${left.version}\0${left.tarballFile}`,
    `${right.name}\0${right.version}\0${right.tarballFile}`
  )
}
/** 写入 contract 派生的 consumer source 并返回 runtime/path 映射。 */
export function writeConsumerSources(contract, evidenceDirectory, artifactSetId) {
  const productionToken = contract.journeys.some(function isLicenseJourney(journey) {
    return journey.id === 'license-runtime-identity'
  }) ? readProductionGoldenToken(repoRoot) : ''
  const sources = createConsumerSourceInventory(contract, productionToken)
  const results = {}
  for (const [id, sourceRecord] of Object.entries(sources)) {
    const sourcePath = `raw/sources/${id}/probe.${sourceRecord.extension}`
    const targetPath = join(evidenceDirectory, sourcePath)
    mkdirSync(dirname(targetPath), { recursive: true })
    writeFileSync(targetPath, sourceRecord.source)
    for (const [name, source] of Object.entries(sourceRecord.files)) writeFileSync(join(dirname(targetPath), name), source)
    results[id] = { artifactSetId, sourcePath, source: sourceRecord.source, files: sourceRecord.files }
  }
  return results
}
/** 展开每个 journey、package manager、runtime 与 browser 结果。 */
function createJourneyResults(contract, installs, artifactSetId) {
  const results = []
  for (const journey of contract.journeys) {
    for (const packageManager of ['npm', 'pnpm']) {
      const packageManagerVersion = installs.find(function findInstall(install) {
        return install.journey === journey.id && install.packageManager === packageManager
      }).packageManagerVersion
      for (const runtime of journey.runtimes) {
        const install = installs.find(function findInstall(installEntry) {
          return installEntry.journey === journey.id && installEntry.packageManager === packageManager
        })
        const browsers = install.runtimeEvidence.results
          .filter(function selectRuntimeResult(result) { return result.runtime === runtime })
          .map(function readBrowser(result) { return result.browser })
        if (browsers.length === 0) throw new Error(`consumer runtime was not executed: ${journey.id}/${runtime}`)
        for (const browser of browsers) {
          results.push({
            id: journey.id,
            packageManager,
            packageManagerVersion,
            runtime,
            browser,
            command: `phase3-consumer:${journey.id}:${packageManager}:${runtime}:${browser}`,
            status: 'passed',
            artifactSetId
          })
        }
      }
    }
  }
  return results.sort(compareJourneyResults)
}
/** 冻结 journey evidence 的唯一顺序。 */
function compareJourneyResults(left, right) {
  return compareAscii(
    `${left.id}\0${left.packageManager}\0${left.runtime}\0${left.browser}`,
    `${right.id}\0${right.packageManager}\0${right.runtime}\0${right.browser}`
  )
}
/** 从 install handoff 文件重算固定 install evidence。 */
function createInstallEvidence(installs, evidenceDirectory) {
  return installs.map(function createInstallEntry(install) {
    const paths = install.rawFiles
    return {
      id: install.id,
      journey: install.journey,
      packageManager: install.packageManager,
      packageManagerVersion: install.packageManagerVersion,
      manifestPath: paths.manifestPath,
      manifestSha256: sha256EvidenceFile(evidenceDirectory, paths.manifestPath),
      lockfilePath: paths.lockfilePath,
      lockfileSha256: sha256EvidenceFile(evidenceDirectory, paths.lockfilePath),
      dependencyTreePath: paths.dependencyTreePath,
      dependencyTreeSha256: sha256EvidenceFile(evidenceDirectory, paths.dependencyTreePath),
      registryConfigPath: paths.registryConfigPath,
      registryConfigSha256: sha256EvidenceFile(evidenceDirectory, paths.registryConfigPath),
      registryEvidencePath: paths.registryEvidencePath,
      registryEvidenceSha256: sha256EvidenceFile(evidenceDirectory, paths.registryEvidencePath),
      registryTranscriptPath: paths.registryTranscriptPath,
      registryTranscriptSha256: sha256EvidenceFile(evidenceDirectory, paths.registryTranscriptPath),
      requestedPackages: install.requestedPackages,
      firstPartyClosure: install.firstPartyClosure,
      resolvedPackages: install.resolvedPackages
    }
  })
}
/** 从当前 consumer evidence root 读取文件 hash。 */
function sha256EvidenceFile(evidenceDirectory, path) { return sha256(readFileSync(join(evidenceDirectory, path))) }
/** 从 contract target 展开逐 export evidence。 */
function createExportEvidence(contract, sources, installs, artifactSetId) {
  const entries = []
  for (const journey of contract.journeys) {
    for (const packageManager of ['npm', 'pnpm']) {
      for (const target of journey.targets) {
        const install = installs.find(function findInstall(installEntry) {
          return installEntry.journey === journey.id && installEntry.packageManager === packageManager
        })
        const browsers = install.runtimeEvidence.results
          .filter(function selectRuntimeResult(result) { return result.runtime === target.runtime })
          .map(function readBrowser(result) { return result.browser })
        if (browsers.length === 0) {
          throw new Error(`consumer export was not executed: ${journey.id}/${target.runtime}`)
        }
        for (const browser of browsers) {
          entries.push({
            package: target.package,
            subpath: target.subpath,
            environment: target.environment,
            journey: journey.id,
            packageManager,
            runtime: target.runtime,
            browser,
            sourcePath: readConsumerSource(sources, journey.id, target.runtime).sourcePath,
            status: 'passed'
          })
        }
      }
    }
  }
  return { schemaVersion: 1, artifactSetId, exports: entries.sort(compareExportEntries) }
}
/** 冻结逐 export evidence 的唯一键顺序。 */
function compareExportEntries(left, right) {
  const leftKey = `${left.package}\0${left.subpath}\0${left.environment}\0${left.journey}\0${left.packageManager}\0${left.runtime}\0${left.browser}`
  const rightKey = `${right.package}\0${right.subpath}\0${right.environment}\0${right.journey}\0${right.packageManager}\0${right.runtime}\0${right.browser}`
  return compareAscii(leftKey, rightKey)
}
/** 写入五份 consumer payload 与完整 evidence manifest。 */
function writeConsumerEvidence(evidenceDirectory, input) {
  const journeyEvidence = {
    schemaVersion: 1,
    artifactSetId: input.artifactSetId,
    journeys: input.journeyResults.map(stripJourneyArtifactSetId)
  }
  const installEvidence = { schemaVersion: 1, artifactSetId: input.artifactSetId, installs: input.installEvidence }
  for (const install of input.installEvidence) validateConsumerInstallEvidence(install, evidenceDirectory)
  writeCanonicalJson(join(evidenceDirectory, 'journey-evidence.json'), journeyEvidence)
  writeCanonicalJson(join(evidenceDirectory, 'install-evidence.json'), installEvidence)
  writeCanonicalJson(join(evidenceDirectory, 'export-evidence.json'), input.exportEvidence)
  writeCanonicalJson(join(evidenceDirectory, 'bundle-evidence.json'), input.bundleEvidence)
  writeCanonicalJson(join(evidenceDirectory, 'consumer-evidence.json'), {
    schemaVersion: 1,
    evidenceType: 'consumer',
    gitSha: input.gitSha,
    lockfileSha256: input.lockfileSha256,
    artifactSetId: input.artifactSetId,
    bindingSha256: input.bindingSha256,
    status: 'passed',
    checks: {
      allJourneysPassed: true,
      installEvidencePassed: true,
      registryEvidencePassed: true,
      exportEvidencePassed: true,
      consumerSourcesVerified: true,
      bundleBytesVerified: true,
      skipped: 0,
      fallbacks: 0,
      repacks: 0,
      workspaceLinks: 0,
      packageAliases: 0,
      overrides: 0,
      repoRealpaths: 0,
      registryWrites: 0,
      unexpectedRegistryRequests: 0,
      firstPartyRegistryFallbacks: 0,
      unexpectedRuntimeInstances: 0
    }
  })
  const files = listEvidenceFiles(evidenceDirectory).map(function createFileEntry(path) {
    const bytes = readFileSync(join(evidenceDirectory, path))
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
  })
  writeCanonicalJson(join(evidenceDirectory, 'evidence-manifest.json'), {
    schemaVersion: 1,
    evidenceType: 'consumer',
    files
  })
}
/** 从 handoff 副本重读并校验一个 install 的闭包、registry、lock 与 realpath。 */
export function validateConsumerInstallEvidence(install, evidenceDirectory) {
  assertExactKeys(install, [
    'dependencyTreePath', 'dependencyTreeSha256', 'firstPartyClosure', 'id', 'journey', 'lockfilePath',
    'lockfileSha256', 'manifestPath', 'manifestSha256', 'packageManager', 'packageManagerVersion',
    'registryConfigPath', 'registryConfigSha256', 'registryEvidencePath', 'registryEvidenceSha256',
    'registryTranscriptPath', 'registryTranscriptSha256', 'requestedPackages', 'resolvedPackages'
  ], 'install evidence')
  if (!['npm', 'pnpm'].includes(install.packageManager) || install.id !== `${install.journey}--${install.packageManager}`) {
    throw new Error('install identity is invalid')
  }
  const installRoot = `raw/installs/${install.id}`
  const evidenceFiles = [
    ['manifestPath', 'manifestSha256', 'package.json'],
    ['lockfilePath', 'lockfileSha256', install.packageManager === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml'],
    ['dependencyTreePath', 'dependencyTreeSha256', 'dependency-tree.json'],
    ['registryConfigPath', 'registryConfigSha256', '.npmrc'],
    ['registryEvidencePath', 'registryEvidenceSha256', 'registry-evidence.json'],
    ['registryTranscriptPath', 'registryTranscriptSha256', 'registry-transcript.json']
  ]
  for (const [pathKey, hashKey, name] of evidenceFiles) {
    if (install[pathKey] !== `${installRoot}/${name}`) throw new Error('install evidence path mismatch')
    if (sha256EvidenceFile(evidenceDirectory, install[pathKey]) !== install[hashKey]) throw new Error('install evidence hash mismatch')
  }
  const requestedPackages = assertSortedPackageNames(install.requestedPackages, 'requestedPackages')
  const firstPartyClosure = assertSortedPackageNames(install.firstPartyClosure, 'firstPartyClosure')
  const packageNames = [...requestedPackages, ...firstPartyClosure].sort()
  if (new Set(packageNames).size !== packageNames.length) throw new Error('install package sets overlap')
  const manifest = JSON.parse(readFileSync(join(evidenceDirectory, install.manifestPath), 'utf8'))
  const manifestPackages = Object.keys(manifest.dependencies ?? {}).filter(function isFirstParty(name) {
    return name.startsWith('@4xian/')
  }).sort()
  if (JSON.stringify(manifestPackages) !== JSON.stringify(requestedPackages)) throw new Error('install package set mismatch')
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (typeof version !== 'string' || /^(?:file|link|npm|workspace):/u.test(version) || name === '') {
      throw new Error('install dependency is invalid')
    }
  }
  if (manifest.overrides !== undefined || manifest.resolutions !== undefined || manifest.pnpm !== undefined) {
    throw new Error('install manifest override is forbidden')
  }
  const dependencyTree = JSON.parse(readFileSync(join(evidenceDirectory, install.dependencyTreePath), 'utf8'))
  validateDependencyTree(dependencyTree, install.resolvedPackages)
  const config = readFileSync(join(evidenceDirectory, install.registryConfigPath), 'utf8')
  const configMatch = config.match(/^registry=https:\/\/registry\.npmjs\.org\/\n@4xian:registry=(http:\/\/127\.0\.0\.1:\d+\/)\n$/u)
  if (configMatch === null ||
      /auth|token|password|username/iu.test(config)) throw new Error('registry config is invalid')
  const registryOrigin = configMatch[1].slice(0, -1)
  const registry = JSON.parse(readFileSync(join(evidenceDirectory, install.registryEvidencePath), 'utf8'))
  const transcript = JSON.parse(readFileSync(join(evidenceDirectory, install.registryTranscriptPath), 'utf8'))
  assertExactKeys(registry, ['allowedMethods', 'host', 'mode', 'schemaVersion', 'scope', 'servedPackages', 'unexpectedRequests', 'writeAttempts'], 'registry evidence')
  assertExactKeys(transcript, ['requests', 'schemaVersion'], 'registry transcript')
  if (registry.host !== '127.0.0.1' || registry.scope !== '@4xian' || registry.mode !== 'read-only-loopback' ||
      JSON.stringify(registry.allowedMethods) !== JSON.stringify(['GET', 'HEAD']) ||
      registry.unexpectedRequests !== 0 || registry.writeAttempts !== 0) throw new Error('registry evidence is invalid')
  if (JSON.stringify(registry.servedPackages) !== JSON.stringify([...registry.servedPackages].sort(compareServedPackages))) {
    throw new Error('registry served package order is invalid')
  }
  const servedNames = registry.servedPackages.map(function readServedName(packageEntry) { return packageEntry.name }).sort()
  if (JSON.stringify(servedNames) !== JSON.stringify(packageNames)) throw new Error('registry served package set mismatch')
  const installDirectory = dirname(join(evidenceDirectory, install.registryTranscriptPath))
  for (let index = 0; index < transcript.requests.length; index += 1) {
    const request = transcript.requests[index]
    assertExactKeys(request, ['method', 'order', 'path', 'responseBytes', 'responseKind', 'responsePath', 'responseSha256', 'status'], 'registry request')
    if (request.order !== index || !['GET', 'HEAD'].includes(request.method) || request.status !== 200 ||
        !['metadata', 'tarball'].includes(request.responseKind) ||
        request.responsePath !== `registry-responses/${request.responseSha256}.bin` ||
        !isAllowlistedRegistryRequest(request, registry.servedPackages)) {
      throw new Error('registry transcript request is invalid')
    }
    const responseBytes = readFileSync(join(installDirectory, request.responsePath))
    if (request.responseSha256 !== sha256(responseBytes) || request.responseBytes !== responseBytes.byteLength ||
        (request.method === 'HEAD' && responseBytes.byteLength !== 0)) {
      throw new Error('registry response bytes are invalid')
    }
  }
  const lockfile = readFileSync(join(evidenceDirectory, install.lockfilePath), 'utf8')
  const npmLock = install.packageManager === 'npm' ? JSON.parse(lockfile) : undefined
  for (const packageEntry of registry.servedPackages) {
    assertExactKeys(packageEntry, ['metadataBytes', 'metadataPath', 'metadataRequests', 'metadataSha256', 'name', 'tarballFile', 'tarballIntegrity', 'tarballRequests', 'tarballSha256', 'tarballShasum', 'version'], 'served package')
    if (!Number.isInteger(packageEntry.metadataRequests) || packageEntry.metadataRequests <= 0 ||
        !Number.isInteger(packageEntry.tarballRequests) || packageEntry.tarballRequests <= 0 ||
        packageEntry.metadataRequests !== countRegistryGets(transcript.requests, 'metadata', packageEntry.name, packageEntry.tarballFile) ||
        packageEntry.tarballRequests !== countRegistryGets(transcript.requests, 'tarball', packageEntry.name, packageEntry.tarballFile)) {
      throw new Error('registry GET count is invalid')
    }
    const dist = verifyServedPackageBytes(packageEntry, transcript.requests, installDirectory, registryOrigin)
    if (install.packageManager === 'npm') {
      const lockEntry = npmLock.packages?.[`node_modules/${packageEntry.name}`]
      if (lockEntry?.resolved !== dist.tarball || lockEntry?.integrity !== packageEntry.tarballIntegrity) {
        throw new Error('npm lockfile package resolution is invalid')
      }
    } else if (!lockfile.includes(packageEntry.tarballIntegrity)) {
      throw new Error('pnpm lockfile integrity is invalid')
    }
  }
  const resolvedProjectRoots = new Set()
  const resolvedNames = []
  for (const packageEntry of install.resolvedPackages) {
    assertExactKeys(packageEntry, ['name', 'realpath', 'version'], 'resolved package')
    const projectRoot = typeof packageEntry.realpath === 'string'
      ? readInstallProjectRoot(packageEntry.realpath, install.id)
      : undefined
    if (typeof packageEntry.name !== 'string' || typeof packageEntry.version !== 'string' ||
        typeof packageEntry.realpath !== 'string' || !isAbsolute(packageEntry.realpath) || projectRoot === undefined ||
        isPathInside(repoRoot, packageEntry.realpath)) {
      throw new Error('resolved package realpath is invalid')
    }
    resolvedProjectRoots.add(projectRoot)
    resolvedNames.push(packageEntry.name)
  }
  if (resolvedProjectRoots.size !== 1) throw new Error('resolved package project roots mismatch')
  if (JSON.stringify(resolvedNames) !== JSON.stringify(packageNames)) throw new Error('resolved package set mismatch')
  return install
}
/** 校验 package-name 数组为 ASCII 排序、纯字符串且无重复。 */
function assertSortedPackageNames(values, label) {
  if (!Array.isArray(values) || values.some(function isInvalidName(value) {
    return typeof value !== 'string' || value === ''
  })) throw new Error(`${label} is invalid`)
  const sorted = [...values].sort()
  if (new Set(values).size !== values.length || JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} is not sorted and unique`)
  }
  return values
}
/** 从 npm/pnpm 结构化依赖树复核 first-party 集合、版本与 License 单 runtime。 */
function validateDependencyTree(tree, resolvedPackages) {
  const found = new Map()
  /** 递归收集依赖对象中的 first-party 节点。 */
  function visit(value) {
    if (Array.isArray(value)) { for (const child of value) visit(child); return }
    if (value === null || typeof value !== 'object') return
    for (const [name, node] of Object.entries(value.dependencies ?? {})) {
      if (name.startsWith('@4xian/')) {
        const entry = found.get(name) ?? { versions: new Set(), paths: new Set() }
        if (typeof node.version === 'string') entry.versions.add(node.version)
        if (typeof node.path === 'string') entry.paths.add(node.path)
        found.set(name, entry)
      }
      visit(node)
    }
    for (const [name, child] of Object.entries(value)) if (name !== 'dependencies') visit(child)
  }
  visit(tree)
  const expectedNames = resolvedPackages.map(function readName(entry) { return entry.name }).sort()
  if (JSON.stringify([...found.keys()].sort()) !== JSON.stringify(expectedNames)) throw new Error('dependency tree package set mismatch')
  for (const entry of resolvedPackages) if (!found.get(entry.name).versions.has(entry.version)) throw new Error('dependency tree version mismatch')
  if ((found.get('@4xian/jword-license')?.paths.size ?? 0) > 1) throw new Error('duplicate License runtime detected')
}
/** 从 transcript raw response 重算 metadata/tarball 的四类 digest。 */
function verifyServedPackageBytes(packageEntry, requests, installDirectory, registryOrigin) {
  const metadataRequest = requests.find(function findMetadataGet(request) {
    return request.method === 'GET' && request.responseKind === 'metadata' &&
      decodeURIComponent(request.path.slice(1)) === packageEntry.name
  })
  const tarballRequest = requests.find(function findTarballGet(request) {
    return request.method === 'GET' && request.responseKind === 'tarball' &&
      request.path === `/tarballs/${packageEntry.tarballFile}`
  })
  if (metadataRequest === undefined || tarballRequest === undefined) throw new Error('registry GET raw response is missing')
  const metadataBytes = readFileSync(join(installDirectory, metadataRequest.responsePath))
  const tarballBytes = readFileSync(join(installDirectory, tarballRequest.responsePath))
  const metadata = JSON.parse(metadataBytes.toString('utf8'))
  const dist = metadata.versions?.[packageEntry.version]?.dist
  if (packageEntry.metadataPath !== metadataRequest.responsePath ||
      packageEntry.metadataSha256 !== sha256(metadataBytes) || packageEntry.metadataBytes !== metadataBytes.byteLength ||
      packageEntry.tarballSha256 !== sha256(tarballBytes) ||
      packageEntry.tarballShasum !== createHash('sha1').update(tarballBytes).digest('hex') ||
      packageEntry.tarballIntegrity !== `sha512-${createHash('sha512').update(tarballBytes).digest('base64')}` ||
      dist?.shasum !== packageEntry.tarballShasum || dist?.integrity !== packageEntry.tarballIntegrity ||
      dist?.tarball !== `${registryOrigin}/tarballs/${packageEntry.tarballFile}`) throw new Error('registry package bytes are invalid')
  return dist
}
/** 判断 transcript 请求是否精确命中当前 install allowlist。 */
function isAllowlistedRegistryRequest(request, packages) {
  return packages.some(function matchesPackage(packageEntry) {
    return request.responseKind === 'metadata'
      ? decodeURIComponent(request.path.slice(1)) === packageEntry.name
      : request.path === `/tarballs/${packageEntry.tarballFile}`
  })
}
/** 按 ASCII code unit 比较冻结键。 */
function compareAscii(left, right) { return left < right ? -1 : left > right ? 1 : 0 }
/** 校验 JSON 对象恰好包含冻结字段集合。 */
function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} fields are invalid`)
  }
}
/** 递归枚举 evidence root 的 regular file POSIX 相对路径。 */
function listEvidenceFiles(directory, prefix = '') {
  const paths = []
  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    if (path === 'evidence-manifest.json') continue
    const stat = lstatSync(join(directory, path))
    if (stat.isSymbolicLink()) throw new Error(`consumer evidence symlink is forbidden: ${path}`)
    if (stat.isDirectory()) paths.push(...listEvidenceFiles(directory, path))
    else if (stat.isFile()) paths.push(path)
    else throw new Error(`consumer evidence entry is not regular: ${path}`)
  }
  return paths.sort()
}
/** 要求 evidence 目标不存在或是空目录。 */
function assertEmptyOutputDirectory(directory) {
  if (existsSync(directory) && (!lstatSync(directory).isDirectory() || readdirSync(directory).length !== 0)) throw new Error('consumer evidence directory must be empty')
}
/** 写入便于 package manager 读取的格式化 JSON。 */
function writeJson(path, value) { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`) }
/** 把未知异常收敛为单行稳定诊断。 */
function readErrorMessage(error) { return error instanceof Error ? error.message : String(error) }
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
