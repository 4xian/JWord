/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 third-party consumer runner、项目生成器与兼容入口契约。
 * 边界：只在仓库外 synthetic fixture 运行安装和消费，不接收当前 JWord checkout artifact。
 * 协作模块：package artifact contract、artifact inventory/binding 与 Gate 5/6/7 兼容入口。
 * 性能/安全约束：禁止重新 pack、workspace/alias/override fallback 与 registry 写入。
 * 实现说明：production 路径只接受显式 manifest/binding，synthetic 路径保存可重算原始证据。
 */

import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  canonicalBytes,
  createArtifactBinding,
  createArtifactManifest,
  createPayloadSha256,
  createSha256Sums,
  readCurrentEnvironment,
  sha256
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/phase3-artifact-utils.mjs'
import {
  runNodeProbe,
  validateConsumerInstallEvidence,
  writeConsumerSources
// @ts-expect-error -- 生产 .mjs consumer helper 未提供 TypeScript 声明文件。
} from '../../tools/release/check-phase3-third-party-consumers.mjs'
import {
  createReactProjectSource,
  createFormatWorkerProjectSource,
  createConsumerSourceInventory,
  createVanillaProjectSource,
  createVueProjectSource,
  prepareLicenseRuntimeEntries,
  readResolvedPackages
// @ts-expect-error -- 生产 .mjs source helper 未提供 TypeScript 声明文件。
} from '../../tools/release/phase3-consumer-projects.mjs'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const CONSUMER_PATH = resolve(REPO_ROOT, 'tools/release/check-phase3-third-party-consumers.mjs')
const PROJECTS_PATH = resolve(REPO_ROOT, 'tools/release/phase3-consumer-projects.mjs')
const LEGACY_ENTRY_PATHS = [
  'tools/release/check-gate5-third-party-smoke.mjs',
  'tools/release/check-gate6-third-party-smoke.mjs',
  'tools/release/check-gate7-third-party-smoke.mjs',
  'tools/release/check-license-runtime-smoke.mjs',
  'tools/release/check-license-runtime-identity-smoke.mjs'
] as const

/** 注册 B3 consumer public seam 的最小回归。 */
function runPhase3ConsumerSuite(): void {
  it('defines the inventory-only consumer matrix and fail-closed legacy CLIs', verifyConsumerPublicSeam)
  it('generates real public wrapper, editor shell, and worker probes', verifyGeneratedRuntimeProbes)
  it('does not expose the License token when a Node probe fails', verifyNodeProbeFailureRedaction)
  it('keeps duplicate License runtimes in the installed dependency resolver', verifyLicenseRuntimeCopyResolution)
  it('rejects resolved packages outside the consumer project', verifyResolvedPackageContainment)
  it('installs a synthetic closure through npm and pnpm without packing', verifySyntheticConsumerMatrix, 120_000)
  it('rejects a repository-local temporary consumer root', verifyRepositoryLocalTemporaryRoot, 120_000)
}

describe('Phase 3 third-party consumer matrix', runPhase3ConsumerSuite)

/** 证明 resolver 拒绝 consumer project 外部的已安装包路径。 */
function verifyResolvedPackageContainment(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-resolved-path-'))
  const projectDirectory = join(root, 'project')
  const packageName = '@4xian/jword-phase3-leaf'
  const linkDirectory = join(projectDirectory, 'node_modules/@4xian')
  const outsidePackage = join(root, 'outside/@4xian/jword-phase3-leaf')
  try {
    mkdirSync(linkDirectory, { recursive: true })
    mkdirSync(outsidePackage, { recursive: true })
    symlinkSync(outsidePackage, join(linkDirectory, 'jword-phase3-leaf'), 'dir')
    const packages = [{
      name: packageName,
      version: '0.0.0',
      tarballFile: 'jword-phase3-leaf.tgz',
      packedManifest: { dependencies: {}, peerDependencies: {} }
    }]

    /** 调用 resolver 形成可观测异常 seam。 */
    function resolveOutsidePackage(): void {
      readResolvedPackages(projectDirectory, packages, [packageName], REPO_ROOT)
    }
    expect(resolveOutsidePackage).toThrow('consumer package resolved outside project')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 证明 pnpm 隔离布局中的第二个 License runtime 仍可解析传递依赖。 */
async function verifyLicenseRuntimeCopyResolution(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-license-runtime-'))
  const packageRoot = join(root, 'node_modules/.pnpm/license/node_modules')
  const licenseDirectory = join(packageRoot, '@4xian/jword-license')
  const dependencyDirectory = join(packageRoot, 'jword-phase3-external-runtime')
  try {
    mkdirSync(licenseDirectory, { recursive: true })
    mkdirSync(dependencyDirectory)
    writeFileSync(join(licenseDirectory, 'package.json'), JSON.stringify({
      name: '@4xian/jword-license',
      version: '0.0.0',
      type: 'module',
      exports: { '.': { import: './index.js' } }
    }))
    writeFileSync(
      join(licenseDirectory, 'index.js'),
      "export { externalRuntimeReady } from 'jword-phase3-external-runtime'\n"
    )
    writeFileSync(join(dependencyDirectory, 'package.json'), JSON.stringify({
      name: 'jword-phase3-external-runtime',
      version: '1.0.0',
      type: 'module',
      exports: './index.js'
    }))
    writeFileSync(join(dependencyDirectory, 'index.js'), 'export const externalRuntimeReady = true\n')
    const scopeDirectory = join(root, 'node_modules/@4xian')
    mkdirSync(scopeDirectory, { recursive: true })
    symlinkSync(licenseDirectory, join(scopeDirectory, 'jword-license'), 'dir')

    const [runtimeA, runtimeB] = prepareLicenseRuntimeEntries(root)
    expect(runtimeA).not.toBe(runtimeB)
    expect((await import(runtimeA)).externalRuntimeReady).toBe(true)
    expect((await import(runtimeB)).externalRuntimeReady).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 证明 Node probe 失败诊断不包含只经环境注入的 License token。 */
async function verifyNodeProbeFailureRedaction(): Promise<void> {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'jword-phase3-node-probe-'))
  const token = 'JWL2.phase3-secret-sentinel'

  try {
    await expect(runNodeProbe(
      projectDirectory,
      "if (!process.env.JWORD_PHASE3_LICENSE_TOKEN) throw new Error('missing token')\nthrow new Error('probe failed')\n",
      [],
      token
    )).rejects.not.toThrow(token)
  } finally {
    rmSync(projectDirectory, { recursive: true, force: true })
  }
}

/** 锁定 production 参数、真实 journey 入口和兼容 CLI 的无参数失败。 */
function verifyConsumerPublicSeam(): void {
  const consumerSource = readFileSync(CONSUMER_PATH, 'utf8')
  const projectsSource = readFileSync(PROJECTS_PATH, 'utf8')
  const publicApiDoc = readFileSync(resolve(REPO_ROOT, 'docs/sdk/public-api.md'), 'utf8')
  const combinedSource = `${consumerSource}\n${projectsSource}`

  for (const requiredText of [
    '--artifact-manifest',
    '--binding',
    '--evidence-dir',
    '127.0.0.1',
    "'GET'",
    "'HEAD'",
    "'npm'",
    "'pnpm'",
    'createJWord',
    'createRoot',
    'createApp',
    'styles.css',
    'new Worker',
    'firefox',
    'webkit',
    'createTypeProbeSource',
    'externalPeers',
    'createJWordLicenseTransfer',
    'worker.postMessage',
    'prepareLicenseRuntimeEntries',
    'assertPhase3Clean'
  ]) {
    expect(combinedSource).toContain(requiredText)
  }
  expect(combinedSource).not.toMatch(/(?:npm|pnpm)\s+pack/u)
  expect(consumerSource).not.toContain("'--eval'")
  expect(projectsSource).not.toContain('workspace:')
  expect(projectsSource).not.toContain('overrides')
  expect(projectsSource).not.toContain('resolutions')
  expect(publicApiDoc).toContain('legacy-non-gating')
  expect(publicApiDoc).toContain('check-phase3-third-party-consumers.mjs')
  for (const relativePath of LEGACY_ENTRY_PATHS.slice(-2)) {
    expect(readFileSync(relativePath, 'utf8')).toContain('delegated-to-phase3-consumer')
  }

  for (const relativePath of LEGACY_ENTRY_PATHS) {
    const result = spawnSync(process.execPath, [resolve(REPO_ROOT, relativePath)], {
      cwd: REPO_ROOT,
      encoding: 'utf8'
    })

    expect(result.status, relativePath).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`, relativePath).toContain('usage:')
  }
}

/** 锁定生成源码必须消费真实公开 wrapper、EditorShell 与 Worker export。 */
function verifyGeneratedRuntimeProbes(): void {
  const reactSource = createReactProjectSource()
  const vueSource = createVueProjectSource()
  const vanillaSource = createVanillaProjectSource([
    { package: '@4xian/jword-core', subpath: '.', environment: 'browser' },
    { package: '@4xian/jword-ui', subpath: '.', environment: 'browser' },
    { package: '@4xian/jword-devtools', subpath: '.', environment: 'browser' }
  ])
  const workerSource = createFormatWorkerProjectSource([
    { package: '@4xian/jword-native', subpath: '.', environment: 'browser' },
    { package: '@4xian/jword-docx', subpath: '.', environment: 'browser' },
    { package: '@4xian/jword-pdf', subpath: '.', environment: 'browser' }
  ])

  expect(reactSource).toContain("import { JWordReactEditor } from '@4xian/jword-react'")
  expect(reactSource).not.toContain('JWordEditor }')
  expect(vueSource).toContain("import { JWordVueEditor } from '@4xian/jword-vue'")
  expect(vueSource).not.toContain('JWordEditor }')
  expect(vanillaSource).toContain("import { createJWord } from '@4xian/jword-ui'")
  expect(vanillaSource).toMatch(/await import\(["']@4xian\/jword-core["']\)/u)
  expect(vanillaSource).toContain("import '@4xian/jword-devtools'")
  expect(vanillaSource).toContain('data-jword-editor-shell')
  expect(vanillaSource).toContain('getComputedStyle')
  expect(vanillaSource).not.toContain('.ready')
  expect(workerSource).toMatch(/await import\(["']@4xian\/jword-native["']\)/u)
  expect(workerSource).toMatch(/await import\(["']@4xian\/jword-docx["']\)/u)
  expect(workerSource).toMatch(/await import\(["']@4xian\/jword-pdf["']\)/u)
  expect(workerSource).toContain('@4xian/jword-docx/worker')
  expect(workerSource).toContain('@4xian/jword-pdf/worker')
  expect(workerSource).toContain('./native-worker.js')
  const moduleWorkerInventory = createConsumerSourceInventory({
    journeys: [{
      id: 'module-workers',
      runtimes: ['vite-browser'],
      requestedPackages: [],
      targets: []
    }]
  })
  const nativeWorkerSource = moduleWorkerInventory['module-workers--vite-browser'].files['native-worker.js']
  expect(nativeWorkerSource).toContain('@4xian/jword-native/worker')
  expect(nativeWorkerSource).toContain('bindJWordNativeWorkerRuntime')
  const licenseInventory = createConsumerSourceInventory({
    journeys: [{
      id: 'license-runtime-identity',
      runtimes: ['dedicated-worker'],
      requestedPackages: [],
      targets: []
    }]
  }, 'token')
  expect(licenseInventory['license-runtime-identity--dedicated-worker'].source).toContain('document.documentElement.dataset.jwordReady')
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'jword-phase3-consumer-sources-'))

  try {
    writeConsumerSources({
      journeys: [{
        id: 'license-runtime-identity',
        runtimes: ['vite-browser'],
        requestedPackages: [],
        targets: []
      }]
    }, evidenceDirectory, 'a'.repeat(64))
    const sourceDirectory = join(evidenceDirectory, 'raw/sources/license-runtime-identity--vite-browser')

    expect(readFileSync(join(sourceDirectory, 'probe.js'), 'utf8')).toContain('./license-worker.js')
    expect(readFileSync(join(sourceDirectory, 'license-worker.js'), 'utf8')).toContain("self.addEventListener('message'")
  } finally {
    rmSync(evidenceDirectory, { recursive: true, force: true })
  }
}

/** 证明 production consumer 不会把临时项目写入仓库目录。 */
function verifyRepositoryLocalTemporaryRoot(): void {
  const fixture = createSyntheticConsumerFixture()

  try {
    const result = spawnSync(process.execPath, [
      CONSUMER_PATH,
      '--artifact-manifest',
      fixture.manifestPath,
      '--binding',
      fixture.bindingPath,
      '--evidence-dir',
      fixture.evidenceDirectory
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: { ...fixture.environment, TMPDIR: REPO_ROOT },
      timeout: 110_000
    })

    expect(result.status, `${result.stdout}\n${result.stderr}`).not.toBe(0)
    expect(`${result.stdout}\n${result.stderr}`).toContain('outside the repository')
    expect(readFileSync(fixture.commandLog, 'utf8')).toBe('')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

interface SyntheticConsumerFixture {
  readonly root: string
  readonly manifestPath: string
  readonly bindingPath: string
  readonly contractPath: string
  readonly evidenceDirectory: string
  readonly commandLog: string
  readonly environment: Record<string, string | undefined>
}

interface SyntheticPackageDefinition {
  readonly name: string
  readonly id: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly source: string
}

interface ArtifactPackageEntry {
  readonly name: string
  readonly version: '0.0.0'
  readonly delivery: 'npm-public'
  readonly tarballFile: string
  readonly tarballSha256: string
  readonly tarballBytes: number
  readonly packedManifestSha256: string
  readonly payloadSha256: string
  readonly files: readonly { readonly path: string, readonly bytes: number, readonly sha256: string }[]
}

/** 通过公开 CLI 执行 synthetic npm/pnpm consumer matrix 并重读 evidence。 */
function verifySyntheticConsumerMatrix(): void {
  const fixture = createSyntheticConsumerFixture()

  try {
    const result = spawnSync(process.execPath, [
      CONSUMER_PATH,
      '--artifact-manifest',
      fixture.manifestPath,
      '--binding',
      fixture.bindingPath,
      '--evidence-dir',
      fixture.evidenceDirectory
    ], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      env: fixture.environment,
      timeout: 110_000
    })

    assertCommandPassed(result, 'synthetic consumer matrix')
    const report = JSON.parse(result.stdout) as {
      readonly status: string
      readonly packageManagers: readonly string[]
    }
    const installEvidence = readJson<{ readonly installs: readonly SyntheticInstallEvidence[] }>(
      join(fixture.evidenceDirectory, 'install-evidence.json')
    )
    const journeyEvidence = readJson<{
      readonly journeys: readonly { readonly id: string, readonly runtime: string, readonly browser: string }[]
    }>(join(fixture.evidenceDirectory, 'journey-evidence.json'))
    const bundleEvidence = readJson<{ readonly bundles: readonly { readonly path: string }[] }>(
      join(fixture.evidenceDirectory, 'bundle-evidence.json')
    )
    const evidenceManifest = readJson<{ readonly files: readonly { readonly path: string, readonly sha256: string }[] }>(
      join(fixture.evidenceDirectory, 'evidence-manifest.json')
    )

    expect(report.status).toBe('ok')
    expect(report.packageManagers).toEqual(['npm', 'pnpm'])
    expect(installEvidence.installs).toHaveLength(8)
    expect(installEvidence.installs.map(readInstallPackageManager)).toEqual([
      'npm',
      'pnpm',
      'npm',
      'pnpm',
      'npm',
      'pnpm',
      'npm',
      'pnpm'
    ])
    expect(journeyEvidence.journeys).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'node-exports-types', runtime: 'types', browser: 'none' }),
      expect.objectContaining({ id: 'synthetic-browser', runtime: 'dedicated-worker', browser: 'chromium' }),
      expect.objectContaining({ id: 'license-runtime-identity', runtime: 'node', browser: 'none' })
    ]))
    expect(bundleEvidence.bundles.map(readBundlePath)).toEqual(expect.arrayContaining([
      expect.stringContaining('bundles/synthetic-browser--npm--vite-browser--chromium/index.html'),
      expect.stringContaining('bundles/synthetic-browser--npm--dedicated-worker--chromium/index.html'),
      expect.stringContaining('bundles/synthetic-browser--pnpm--vite-browser--chromium/index.html'),
      expect.stringContaining('bundles/synthetic-browser--pnpm--dedicated-worker--chromium/index.html')
    ]))
    for (const install of installEvidence.installs) {
      expect(install.id).toBe(`${install.journey}--${install.packageManager}`)
      verifySyntheticInstallEvidence(fixture, install)
      expect(validateConsumerInstallEvidence(install, fixture.evidenceDirectory)).toBe(install)
    }
    verifyInstallEvidenceMutations(fixture, installEvidence.installs[0]!, installEvidence.installs[1]!)
    for (const file of evidenceManifest.files) {
      expect(file.sha256, file.path).toBe(sha256(readFileSync(join(fixture.evidenceDirectory, file.path))))
    }
    const commands = readFileSync(fixture.commandLog, 'utf8')
    expect(commands).toContain('npm install')
    expect(commands).toContain('pnpm install')
    expect(commands).not.toMatch(/(?:npm|pnpm) pack/u)
    writeFileSync(fixture.contractPath, '{}')
    const contractMutation = spawnSync(process.execPath, [
      CONSUMER_PATH,
      '--artifact-manifest', fixture.manifestPath,
      '--binding', fixture.bindingPath,
      '--evidence-dir', `${fixture.evidenceDirectory}-contract-mutation`
    ], { cwd: REPO_ROOT, encoding: 'utf8', env: fixture.environment })
    expect(contractMutation.status).not.toBe(0)
    expect(contractMutation.stderr).toContain('package artifact contract hash mismatch')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 证明闭包数组和 registry/transcript 语义篡改在重读时失败。 */
function verifyInstallEvidenceMutations(
  fixture: SyntheticConsumerFixture,
  install: SyntheticInstallEvidence,
  pnpmInstall: SyntheticInstallEvidence
): void {
  expectInvalidInstall(fixture, { ...install, requestedPackages: [1] })
  expectInvalidInstall(fixture, { ...install, requestedPackages: ['@4xian/z', '@4xian/a'] })
  expectInvalidInstall(fixture, { ...install, requestedPackages: [...install.requestedPackages, install.requestedPackages[0]!] })
  expectInvalidInstall(fixture, { ...install, firstPartyClosure: [install.requestedPackages[0]!] })
  expectInvalidInstall(fixture, { ...install, requestedPackages: install.requestedPackages.slice(1) })
  expectInvalidInstall(fixture, { ...install, requestedPackages: [...install.requestedPackages, '@4xian/unexpected'] })
  expectInvalidInstall(fixture, { ...install, manifestPath: `raw/installs/${install.id}/unexpected.json` })

  expectInvalidEvidenceBytes(fixture, install, install.dependencyTreePath, 'dependencyTreeSha256', Buffer.from('{}'))
  verifyRegistryEvidenceMutations(fixture, install)
  verifyRegistryTranscriptMutations(fixture, install)
  verifyLockfileMutations(fixture, install, pnpmInstall)
}

/** 表驱动证明 registry schema、hash、计数和只读状态篡改失败。 */
function verifyRegistryEvidenceMutations(fixture: SyntheticConsumerFixture, install: SyntheticInstallEvidence): void {
  const registry = readJson<MutableRegistryEvidence>(join(fixture.evidenceDirectory, install.registryEvidencePath))
  const mutations: readonly ((value: MutableRegistryEvidence) => void)[] = [
    (value) => { value.host = '0.0.0.0' },
    (value) => { value.allowedMethods = ['GET', 'HEAD', 'POST'] },
    (value) => { value.writeAttempts = 1 },
    (value) => { value.unexpectedRequests = 1 },
    (value) => { value.servedPackages[0]!.metadataRequests = 0 },
    (value) => { value.servedPackages[0]!.tarballSha256 = '0'.repeat(64) },
    (value) => { value.servedPackages[0]!.tarballShasum = '0'.repeat(40) },
    (value) => { value.servedPackages[0]!.tarballIntegrity = 'sha512-invalid' },
    (value) => { value.servedPackages[0]!.metadataSha256 = '0'.repeat(64) },
    (value) => { value.servedPackages.reverse() },
    (value) => { value.extra = true }
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(registry)
    mutate(candidate)
    expectInvalidJsonEvidence(fixture, install, install.registryEvidencePath, 'registryEvidenceSha256', candidate)
  }
}

/** 表驱动证明 transcript 集合、顺序、allowlist 和 raw hash 篡改失败。 */
function verifyRegistryTranscriptMutations(fixture: SyntheticConsumerFixture, install: SyntheticInstallEvidence): void {
  const transcript = readJson<MutableRegistryTranscript>(join(fixture.evidenceDirectory, install.registryTranscriptPath))
  const mutations: readonly ((value: MutableRegistryTranscript) => void)[] = [
    (value) => { value.requests[0]!.order = 9 },
    (value) => { value.requests[0]!.method = 'POST' },
    (value) => { value.requests[0]!.path = '/unexpected' },
    (value) => { value.requests[0]!.status = 500 },
    (value) => { value.requests[0]!.responseSha256 = '0'.repeat(64) },
    (value) => { value.requests.pop() },
    (value) => { value.requests.reverse() },
    (value) => { value.requests.push({ ...value.requests[0]!, order: value.requests.length }) },
    (value) => { value.requests[0]!.extra = true }
  ]
  for (const mutate of mutations) {
    const candidate = structuredClone(transcript)
    mutate(candidate)
    expectInvalidJsonEvidence(fixture, install, install.registryTranscriptPath, 'registryTranscriptSha256', candidate)
  }
  const metadataRequest = transcript.requests.find((request) => request.responseKind === 'metadata' && request.method === 'GET')!
  const responsePath = join(dirname(join(fixture.evidenceDirectory, install.registryTranscriptPath)), metadataRequest.responsePath)
  const responseBytes = readFileSync(responsePath)
  try {
    writeFileSync(responsePath, '{}')
    expectInvalidInstall(fixture, install)
  } finally {
    writeFileSync(responsePath, responseBytes)
  }
}

/** 证明 npm 精确 resolved/integrity 和 pnpm integrity 分支分别 fail closed。 */
function verifyLockfileMutations(
  fixture: SyntheticConsumerFixture,
  npmInstall: SyntheticInstallEvidence,
  pnpmInstall: SyntheticInstallEvidence
): void {
  const npmLock = readJson<{ packages: Record<string, { resolved?: string }> }>(
    join(fixture.evidenceDirectory, npmInstall.lockfilePath)
  )
  const firstPartyPath = Object.keys(npmLock.packages).find((path) => path.startsWith('node_modules/@4xian/'))!
  npmLock.packages[firstPartyPath]!.resolved = 'https://registry.npmjs.org/unexpected.tgz'
  expectInvalidJsonEvidence(fixture, npmInstall, npmInstall.lockfilePath, 'lockfileSha256', npmLock)
  const pnpmLockPath = join(fixture.evidenceDirectory, pnpmInstall.lockfilePath)
  const pnpmLockBytes = readFileSync(pnpmLockPath)
  const mutatedPnpmLock = Buffer.from(pnpmLockBytes.toString('utf8').replace(/sha512-[A-Za-z0-9+/=]+/u, 'sha512-invalid'))
  expectInvalidEvidenceBytes(fixture, pnpmInstall, pnpmInstall.lockfilePath, 'lockfileSha256', mutatedPnpmLock)
}

/** 断言一个 install evidence mutation 被 public validator 拒绝。 */
function expectInvalidInstall(fixture: SyntheticConsumerFixture, install: unknown): void {
  /** 调用 production validator 形成可观测异常 seam。 */
  function validateInvalidInstall(): void {
    validateConsumerInstallEvidence(install, fixture.evidenceDirectory)
  }

  expect(validateInvalidInstall).toThrow()
}

/** 写入 JSON 语义篡改并同步顶层 hash，避免只命中摘要不一致。 */
function expectInvalidJsonEvidence(
  fixture: SyntheticConsumerFixture,
  install: SyntheticInstallEvidence,
  relativePath: string,
  hashKey: string,
  value: unknown
): void {
  expectInvalidEvidenceBytes(fixture, install, relativePath, hashKey, Buffer.from(JSON.stringify(value)))
}

/** 写入 raw bytes 篡改并同步顶层 hash，随后恢复原 evidence。 */
function expectInvalidEvidenceBytes(
  fixture: SyntheticConsumerFixture,
  install: SyntheticInstallEvidence,
  relativePath: string,
  hashKey: string,
  bytes: Buffer
): void {
  const path = join(fixture.evidenceDirectory, relativePath)
  const originalBytes = readFileSync(path)
  try {
    writeFileSync(path, bytes)
    expectInvalidInstall(fixture, { ...install, [hashKey]: sha256(bytes) })
  } finally {
    writeFileSync(path, originalBytes)
  }
}

interface MutableRegistryEvidence {
  schemaVersion: number
  mode: string
  host: string
  scope: string
  allowedMethods: string[]
  servedPackages: MutableServedPackage[]
  unexpectedRequests: number
  writeAttempts: number
  extra?: unknown
}

interface MutableServedPackage {
  name: string
  version: string
  tarballFile: string
  tarballSha256: string
  tarballShasum: string
  tarballIntegrity: string
  metadataPath: string
  metadataSha256: string
  metadataBytes: number
  metadataRequests: number
  tarballRequests: number
}

interface MutableRegistryTranscript {
  schemaVersion: number
  requests: MutableRegistryRequest[]
}

interface MutableRegistryRequest {
  order: number
  method: string
  path: string
  status: number
  responseKind: string
  responsePath: string
  responseSha256: string
  responseBytes: number
  extra?: unknown
}

interface SyntheticInstallEvidence {
  readonly id: string
  readonly journey: string
  readonly packageManager: 'npm' | 'pnpm'
  readonly requestedPackages: readonly string[]
  readonly firstPartyClosure: readonly string[]
  readonly manifestPath: string
  readonly dependencyTreePath: string
  readonly dependencyTreeSha256: string
  readonly lockfilePath: string
  readonly lockfileSha256: string
  readonly registryEvidencePath: string
  readonly registryEvidenceSha256: string
  readonly registryTranscriptPath: string
  readonly registryTranscriptSha256: string
}

/** 读取 bundle evidence 的 handoff 相对路径。 */
function readBundlePath(bundle: { readonly path: string }): string {
  return bundle.path
}

/** 读取 install evidence 的 package manager，便于锁定固定展开顺序。 */
function readInstallPackageManager(install: SyntheticInstallEvidence): string {
  return install.packageManager
}

/** 重读 registry、transcript 和 lockfile 的可执行证据。 */
function verifySyntheticInstallEvidence(
  fixture: SyntheticConsumerFixture,
  install: SyntheticInstallEvidence
): void {
  const manifest = readJson<{ readonly dependencies?: Readonly<Record<string, string>> }>(
    join(fixture.evidenceDirectory, install.manifestPath)
  )
  const registry = readJson<{
    readonly host: string
    readonly allowedMethods: readonly string[]
    readonly servedPackages: readonly { readonly metadataRequests: number, readonly tarballRequests: number }[]
    readonly unexpectedRequests: number
    readonly writeAttempts: number
  }>(join(fixture.evidenceDirectory, install.registryEvidencePath))
  const transcript = readJson<{ readonly requests: readonly { readonly order: number, readonly method: string }[] }>(
    join(fixture.evidenceDirectory, install.registryTranscriptPath)
  )
  const lockfile = readFileSync(join(fixture.evidenceDirectory, install.lockfilePath), 'utf8')

  expect(install.requestedPackages).toEqual([...install.requestedPackages].sort())
  expect(install.firstPartyClosure).toEqual([...install.firstPartyClosure].sort())
  expect(new Set([...install.requestedPackages, ...install.firstPartyClosure]).size)
    .toBe(install.requestedPackages.length + install.firstPartyClosure.length)
  expect(Object.keys(manifest.dependencies ?? {}).filter(isFirstPartyPackage).sort())
    .toEqual(install.requestedPackages)
  expect(registry.host).toBe('127.0.0.1')
  expect(registry.allowedMethods).toEqual(['GET', 'HEAD'])
  expect(registry.unexpectedRequests).toBe(0)
  expect(registry.writeAttempts).toBe(0)
  for (const servedPackage of registry.servedPackages) {
    expect(servedPackage.metadataRequests).toBeGreaterThan(0)
    expect(servedPackage.tarballRequests).toBeGreaterThan(0)
  }
  expect(transcript.requests.map(readTranscriptOrder)).toEqual(transcript.requests.map(readTranscriptIndex))
  expect(transcript.requests.every(isReadOnlyRequest)).toBe(true)
  expect(lockfile).toContain('sha512-')
  if (install.packageManager === 'npm') expect(lockfile).toContain('http://127.0.0.1:')
}

/** 判断依赖名是否属于 JWord first-party scope。 */
function isFirstPartyPackage(name: string): boolean {
  return name.startsWith('@4xian/')
}

/** 读取 transcript 的真实 order。 */
function readTranscriptOrder(request: { readonly order: number }): number {
  return request.order
}

/** 返回 transcript 当前数组 index。 */
function readTranscriptIndex(_request: unknown, index: number): number {
  return index
}

/** 判断 registry request 只使用 GET/HEAD。 */
function isReadOnlyRequest(request: { readonly method: string }): boolean {
  return request.method === 'GET' || request.method === 'HEAD'
}

/** 创建两个 scoped tarball、完整 inventory/binding 和相邻 synthetic contract。 */
function createSyntheticConsumerFixture(): SyntheticConsumerFixture {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-consumer-test-'))
  const artifactDirectory = join(root, 'artifact')
  const evidenceDirectory = join(root, 'evidence')
  const definitions: readonly SyntheticPackageDefinition[] = [
    {
      name: '@4xian/jword-phase3-base',
      id: 'base',
      dependencies: {},
      source: "export const value = 'base'\n/** 挂载最小浏览器消费入口。 */\nexport function mount(host) { host.textContent = 'ready' }\n"
    },
    {
      name: '@4xian/jword-phase3-leaf',
      id: 'leaf',
      dependencies: { '@4xian/jword-phase3-base': '0.0.0' },
      source: "export { value } from '@4xian/jword-phase3-base'\n"
    },
    {
      name: '@4xian/jword-license',
      id: 'license',
      dependencies: {},
      source: createSyntheticLicenseSource()
    }
  ]
  mkdirSync(artifactDirectory, { recursive: true })
  const packages = definitions.map(function createPackage(definition) {
    return createSyntheticTarball(artifactDirectory, definition)
  }).sort(compareArtifactPackages)
  const checksumBytes = createSha256Sums(packages)
  const contractPath = join(artifactDirectory, 'package-artifact-contract.json')
  const contractBytes = Buffer.from(JSON.stringify(createSyntheticContract()))
  const artifactIdentity = {
    schemaVersion: 1,
    gitSha: '1'.repeat(40),
    lockfileSha256: '2'.repeat(64),
    contractSha256: sha256(contractBytes),
    builderSha256: '4'.repeat(64),
    environment: readCurrentEnvironment(REPO_ROOT),
    sha256SumsSha256: sha256(checksumBytes),
    packages
  }
  const manifest = createArtifactManifest(artifactIdentity, {
    createdAt: '2026-07-22T00:00:00.000Z',
    executionRunId: 'phase3-consumer-synthetic',
    outputDirectory: artifactDirectory
  })
  const manifestBytes = canonicalBytes(manifest)
  const binding = createArtifactBinding({
    artifactManifestSha256: sha256(manifestBytes),
    artifactSetId: manifest.artifactSetId,
    gitSha: artifactIdentity.gitSha,
    lockfileSha256: artifactIdentity.lockfileSha256,
    sha256SumsSha256: artifactIdentity.sha256SumsSha256,
    sourceReportSha256: '5'.repeat(64),
    testReportSha256: '6'.repeat(64)
  })
  const manifestPath = join(artifactDirectory, 'artifact-manifest.json')
  const bindingPath = join(artifactDirectory, 'artifact-binding.json')

  writeFileSync(join(artifactDirectory, 'SHA256SUMS'), checksumBytes)
  writeFileSync(manifestPath, manifestBytes)
  writeFileSync(bindingPath, canonicalBytes(binding))
  writeFileSync(contractPath, contractBytes)
  const commandEnvironment = createCommandTrap(root)

  return {
    root,
    manifestPath,
    bindingPath,
    contractPath,
    evidenceDirectory,
    commandLog: commandEnvironment.commandLog,
    environment: commandEnvironment.environment
  }
}

/** 创建一个不依赖 npm pack 的 deterministic-enough synthetic tarball。 */
function createSyntheticTarball(
  artifactDirectory: string,
  definition: SyntheticPackageDefinition
): ArtifactPackageEntry {
  const caseRoot = join(artifactDirectory, `case-${definition.id}`)
  const packageRoot = join(caseRoot, 'package')
  const manifestBytes = Buffer.from(JSON.stringify({
    name: definition.name,
    version: '0.0.0',
    type: 'module',
    main: './index.js',
    types: './index.d.ts',
    exports: { '.': { types: './index.d.ts', import: './index.js' } },
    dependencies: definition.dependencies
  }))
  const sourceBytes = Buffer.from(definition.source)
  const typeBytes = Buffer.from('export declare const value: string\n/** 声明最小浏览器消费入口。 */\nexport declare function mount(host: Element): void\n')
  mkdirSync(packageRoot, { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), manifestBytes)
  writeFileSync(join(packageRoot, 'index.js'), sourceBytes)
  writeFileSync(join(packageRoot, 'index.d.ts'), typeBytes)
  const tarballFile = `${definition.id}-0.0.0.tgz`
  const tarballPath = join(artifactDirectory, tarballFile)
  const result = spawnSync('tar', ['-czf', tarballPath, '-C', caseRoot, 'package'], {
    encoding: 'utf8',
    env: { ...process.env, COPYFILE_DISABLE: '1' }
  })
  assertCommandPassed(result, `create ${definition.id} tarball`)
  const tarballBytes = readFileSync(tarballPath)
  const files = [
    { path: 'index.d.ts', bytes: typeBytes.byteLength, sha256: sha256(typeBytes) },
    { path: 'index.js', bytes: sourceBytes.byteLength, sha256: sha256(sourceBytes) },
    { path: 'package.json', bytes: manifestBytes.byteLength, sha256: sha256(manifestBytes) }
  ]

  return {
    name: definition.name,
    version: '0.0.0',
    delivery: 'npm-public',
    tarballFile,
    tarballSha256: sha256(tarballBytes),
    tarballBytes: tarballBytes.byteLength,
    packedManifestSha256: sha256(manifestBytes),
    payloadSha256: createPayloadSha256(files),
    files
  }
}

/** 按 package name 冻结 synthetic inventory 顺序。 */
function compareArtifactPackages(left: ArtifactPackageEntry, right: ArtifactPackageEntry): number {
  return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
}

/** 创建覆盖 Node 和 Docker-only 边界的最小 synthetic contract。 */
function createSyntheticContract(): object {
  return {
    schemaVersion: 1,
    packages: [
      { name: '@4xian/jword-phase3-base' },
      { name: '@4xian/jword-phase3-leaf' },
      { name: '@4xian/jword-license' }
    ],
    journeys: [
      {
        id: 'node-exports-types',
        runtimes: ['node', 'types'],
        requestedPackages: ['@4xian/jword-phase3-leaf'],
        firstPartyClosure: ['@4xian/jword-phase3-base'],
        targets: [
          { package: '@4xian/jword-phase3-leaf', subpath: '.', environment: 'node', runtime: 'node' },
          { package: '@4xian/jword-phase3-leaf', subpath: '.', environment: 'types', runtime: 'types' }
        ]
      },
      {
        id: 'synthetic-browser',
        runtimes: ['vite-browser', 'dedicated-worker'],
        requestedPackages: ['@4xian/jword-phase3-base'],
        firstPartyClosure: [],
        targets: [
          { package: '@4xian/jword-phase3-base', subpath: '.', environment: 'browser', runtime: 'vite-browser' },
          {
            package: '@4xian/jword-phase3-base',
            subpath: '.',
            environment: 'dedicated-worker',
            runtime: 'dedicated-worker'
          }
        ]
      },
      {
        id: 'collab-server-image-node',
        runtimes: ['image-node'],
        requestedPackages: ['@4xian/jword-phase3-base'],
        firstPartyClosure: [],
        targets: [
          { package: '@4xian/jword-phase3-base', subpath: '.', environment: 'image-node', runtime: 'image-node' }
        ]
      },
      {
        id: 'license-runtime-identity',
        runtimes: ['node'],
        requestedPackages: ['@4xian/jword-license'],
        firstPartyClosure: [],
        targets: [
          { package: '@4xian/jword-license', subpath: '.', environment: 'node', runtime: 'node' }
        ]
      }
    ]
  }
}

/** 生成用 WeakSet 锁定跨 runtime handle 拒绝的 synthetic License package。 */
function createSyntheticLicenseSource(): string {
  return `
const handles = new WeakSet()
export const JWORD_FEATURES = { formats: 'formats' }
/** 激活并登记 synthetic License handle。 */
export function activateJWordLicense(token) { const handle = { token }; handles.add(handle); return handle }
/** 检查 handle 是否属于当前 runtime。 */
export function isJWordFeatureLicensed(handle) { return handles.has(handle) }
/** 拒绝不属于当前 runtime 的 handle。 */
export function assertJWordFeatureLicensed(handle) {
  if (!handles.has(handle)) { const error = new Error('invalid'); error.code = 'JWORD_LICENSE_HANDLE_INVALID'; throw error }
}
/** 从当前 runtime handle 创建转移对象。 */
export function createJWordLicenseTransfer(handle) { assertJWordFeatureLicensed(handle); return { token: handle.token } }
`
}

/** 创建记录 npm/pnpm 全部子进程且委托真实 executable 的 PATH wrapper。 */
function createCommandTrap(root: string): {
  readonly commandLog: string
  readonly environment: Record<string, string | undefined>
} {
  const binDirectory = join(root, 'bin')
  const commandLog = join(root, 'commands.log')
  const realNpm = execFileSync('which', ['npm'], { encoding: 'utf8' }).trim()
  const realPnpm = execFileSync('which', ['pnpm'], { encoding: 'utf8' }).trim()
  mkdirSync(binDirectory)
  writeFileSync(commandLog, '')
  for (const command of ['npm', 'pnpm']) {
    const executableVariable = command === 'npm' ? 'JWORD_PHASE3_REAL_NPM' : 'JWORD_PHASE3_REAL_PNPM'
    const script = `#!/bin/sh\nprintf '${command} %s\\n' "$*" >> "$JWORD_PHASE3_COMMAND_LOG"\nexec "$${executableVariable}" "$@"\n`
    writeFileSync(join(binDirectory, command), script)
    chmodSync(join(binDirectory, command), 0o755)
  }

  return {
    commandLog,
    environment: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
      JWORD_PHASE3_COMMAND_LOG: commandLog,
      JWORD_PHASE3_REAL_NPM: realNpm,
      JWORD_PHASE3_REAL_PNPM: realPnpm
    }
  }
}

/** 读取 JSON 文件并收窄到调用方声明的 schema。 */
function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

/** 断言子进程成功并保留 stdout/stderr 诊断。 */
function assertCommandPassed(result: SpawnSyncReturns<string>, label: string): void {
  expect(result.status, `${label}\n${result.stdout}\n${result.stderr}`).toBe(0)
}
