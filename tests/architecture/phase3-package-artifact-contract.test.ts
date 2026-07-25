/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 package artifact contract 的分类、journey、native 与 size 决策。
 * 边界：只读取机器 contract、package manifest 和 native registry。
 * 协作模块：package artifact contract、十二个 runtime package 与 native registry。
 * 性能/安全约束：不构建、打包或安装 package，不读取或输出敏感材料。
 * 实现说明：本文件通过唯一机器 contract 的公开文件 seam 验证发布分类。
 */

import { createHash } from 'node:crypto'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

type ExportEnvironment = 'node' | 'browser' | 'dedicated-worker' | 'types' | 'image-node'
type JourneyRuntime = 'node' | 'vite-browser' | 'dedicated-worker' | 'types' | 'image-node'
type PackageClassification = 'base' | 'formats' | 'license' | 'collaboration' | 'docker-only'
type PackageDelivery = 'npm-public' | 'npm-restricted' | 'docker-image-internal'
type RegistryIntent = 'public' | 'restricted' | 'not-published'

interface ExportTarget {
  readonly types: string
  readonly import: string
}

interface PackageExportContract {
  readonly subpath: string
  readonly target: ExportTarget | string
  readonly environments: readonly ExportEnvironment[]
}

interface DependencyPolicy {
  readonly firstParty: readonly string[]
  readonly firstPartyPeers: readonly string[]
  readonly external: Readonly<Record<string, string>>
  readonly externalPeers: Readonly<Record<string, string>>
}

interface RuntimePackageContract {
  readonly name: string
  readonly workspacePath: string
  readonly classification: PackageClassification
  readonly delivery: PackageDelivery
  readonly registryIntent: RegistryIntent
  readonly version: '0.0.0'
  readonly private: true
  readonly sourceAccess: 'public' | 'restricted'
  readonly files: readonly string[]
  readonly sideEffects: false | readonly string[]
  readonly fixtureAllowlist: readonly string[]
  readonly exports: readonly PackageExportContract[]
  readonly dependencyPolicy: DependencyPolicy
}

interface JourneyTarget {
  readonly package: string
  readonly subpath: string
  readonly environment: ExportEnvironment
  readonly runtime: JourneyRuntime
}

interface ConsumerJourneyContract {
  readonly id: string
  readonly runtimes: readonly JourneyRuntime[]
  readonly requestedPackages: readonly string[]
  readonly firstPartyClosure: readonly string[]
  readonly targets: readonly JourneyTarget[]
}

interface SizeBudgetContract {
  readonly id: string
  readonly source: string
  readonly limitBytes: number
  readonly sourceSha256?: string
}

interface RegistryPolicy {
  readonly mode: 'read-only-loopback'
  readonly host: '127.0.0.1'
  readonly scope: '@4xian'
  readonly allowedMethods: readonly ['GET', 'HEAD']
  readonly npmLockEvidence: readonly ['resolved', 'integrity']
  readonly pnpmV9LockEvidence: readonly ['integrity', 'registry-config', 'registry-transcript']
  readonly runtimePortEvidence: readonly ['registry-config', 'registry-transcript', 'metadata-response']
}

interface PackageArtifactContract {
  readonly schemaVersion: 1
  readonly environmentRuntimeMap: Readonly<Record<ExportEnvironment, JourneyRuntime>>
  readonly professionalEditing: {
    readonly status: 'not-present'
    readonly deferredTo: 'Phase-4A'
  }
  readonly registryPolicy: RegistryPolicy
  readonly nonRuntimeWorkspaces: readonly {
    readonly path: string
    readonly artifactPolicy: 'forbidden'
  }[]
  readonly packages: readonly RuntimePackageContract[]
  readonly journeys: readonly ConsumerJourneyContract[]
  readonly sizeBudgets: readonly SizeBudgetContract[]
}

interface SourcePackageManifest {
  readonly name: string
  readonly version: string
  readonly private: boolean
  readonly type: 'module'
  readonly publishConfig: {
    readonly access: 'public' | 'restricted'
  }
  readonly exports: Readonly<Record<string, ExportTarget | string>>
  readonly files: readonly string[]
  readonly sideEffects: false | readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
}

interface ExpectedPackagePolicy {
  readonly classification: PackageClassification
  readonly delivery: PackageDelivery
  readonly registryIntent: RegistryIntent
  readonly environments: Readonly<Record<string, readonly ExportEnvironment[]>>
  readonly fixtureAllowlist?: readonly string[]
}

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const CONTRACT_PATH = join(REPO_ROOT, 'tools/release/package-artifact-contract.json')
const HUMAN_CONTRACT_PATH = join(REPO_ROOT, 'docs/current-implementation/release-artifact-contract.md')
const RUNTIME_PACKAGE_NAMES = [
  '@4xian/jword-collab',
  '@4xian/jword-collab-server',
  '@4xian/jword-core',
  '@4xian/jword-devtools',
  '@4xian/jword-docx',
  '@4xian/jword-license',
  '@4xian/jword-native',
  '@4xian/jword-pdf',
  '@4xian/jword-persistence',
  '@4xian/jword-react',
  '@4xian/jword-ui',
  '@4xian/jword-vue'
] as const
const NPM_DELIVERY_PACKAGE_NAMES = RUNTIME_PACKAGE_NAMES.filter(filterNpmDeliveryPackage)
const ENVIRONMENT_RUNTIME_MAP = {
  node: 'node',
  browser: 'vite-browser',
  'dedicated-worker': 'dedicated-worker',
  types: 'types',
  'image-node': 'image-node'
} as const
const REGISTRY_POLICY = {
  mode: 'read-only-loopback',
  host: '127.0.0.1',
  scope: '@4xian',
  allowedMethods: ['GET', 'HEAD'],
  npmLockEvidence: ['resolved', 'integrity'],
  pnpmV9LockEvidence: ['integrity', 'registry-config', 'registry-transcript'],
  runtimePortEvidence: ['registry-config', 'registry-transcript', 'metadata-response']
} as const
const EXPECTED_PACKAGE_POLICIES: Readonly<Record<string, ExpectedPackagePolicy>> = {
  '@4xian/jword-core': npmPackagePolicy('base', 'public', {
    '.': ['node', 'browser', 'types']
  }),
  '@4xian/jword-ui': npmPackagePolicy('base', 'public', {
    '.': ['node', 'browser', 'types'],
    './styles.css': ['browser']
  }),
  '@4xian/jword-native': {
    ...npmPackagePolicy('base', 'public', {
      '.': ['node', 'browser', 'types'],
      './worker': ['browser', 'dedicated-worker', 'types']
    }),
    fixtureAllowlist: ['fixtures/registry.json']
  },
  '@4xian/jword-devtools': npmPackagePolicy('base', 'public', {
    '.': ['node', 'browser', 'types']
  }),
  '@4xian/jword-react': npmPackagePolicy('base', 'public', {
    '.': ['node', 'browser', 'types']
  }),
  '@4xian/jword-vue': npmPackagePolicy('base', 'public', {
    '.': ['node', 'browser', 'types']
  }),
  '@4xian/jword-docx': npmPackagePolicy('formats', 'restricted', {
    '.': ['node', 'browser', 'types'],
    './worker': ['browser', 'dedicated-worker', 'types']
  }),
  '@4xian/jword-pdf': npmPackagePolicy('formats', 'restricted', {
    '.': ['node', 'browser', 'types'],
    './worker': ['browser', 'dedicated-worker', 'types']
  }),
  '@4xian/jword-license': npmPackagePolicy('license', 'restricted', {
    '.': ['node', 'browser', 'dedicated-worker', 'types']
  }),
  '@4xian/jword-persistence': npmPackagePolicy('collaboration', 'restricted', {
    '.': ['node', 'browser', 'types']
  }),
  '@4xian/jword-collab': npmPackagePolicy('collaboration', 'restricted', {
    '.': ['node', 'browser', 'types'],
    './experimental': ['node', 'browser', 'types']
  }),
  '@4xian/jword-collab-server': {
    classification: 'docker-only',
    delivery: 'docker-image-internal',
    registryIntent: 'not-published',
    environments: {
      '.': ['image-node', 'types']
    }
  }
}

/** 执行 Phase 3 contract 的单一公开 seam 回归。 */
function runContractSuite(): void {
  it('freezes package classifications, journeys, native assets, and size budgets', verifyPackageArtifactContract)
  it('checks source package manifests through the unified artifact scanner', verifySourceManifestScanner)
  it('rejects forbidden artifact content while preserving the native registry exception', verifyArtifactScannerMatrix, 15_000)
}

describe('Phase 3 package artifact contract', runContractSuite)

/** 校验机器 contract、source manifest、native registry 与 size budget。 */
function verifyPackageArtifactContract(): void {
  const contract = readJsonFile<PackageArtifactContract>(CONTRACT_PATH)
  const humanContract = readFileSync(HUMAN_CONTRACT_PATH, 'utf8')

  expect(Object.keys(contract).sort()).toEqual([
    'environmentRuntimeMap',
    'journeys',
    'nonRuntimeWorkspaces',
    'packages',
    'professionalEditing',
    'registryPolicy',
    'schemaVersion',
    'sizeBudgets'
  ])
  expect(contract.schemaVersion).toBe(1)
  expect(contract.environmentRuntimeMap).toEqual(ENVIRONMENT_RUNTIME_MAP)
  expect(contract.professionalEditing).toEqual({
    status: 'not-present',
    deferredTo: 'Phase-4A'
  })
  expect(contract.registryPolicy).toEqual(REGISTRY_POLICY)
  expect(contract.nonRuntimeWorkspaces).toEqual([
    { path: '/', artifactPolicy: 'forbidden' },
    { path: 'examples/*', artifactPolicy: 'forbidden' },
    { path: 'fixtures/', artifactPolicy: 'forbidden' },
    { path: 'benchmarks/', artifactPolicy: 'forbidden' },
    { path: 'tools/*', artifactPolicy: 'forbidden' }
  ])

  verifyRuntimePackages(contract.packages)
  verifyJourneys(contract)
  verifySizeBudgets(contract.sizeBudgets)
  verifyNativeRegistry(contract.packages)
  expect(humanContract).toContain('六项 Vanilla limit 固定为 `900000` bytes')
  expect(humanContract).toContain('入口 JS、CSS 和 Vite `modulepreload`')
  expect(humanContract).toContain('不得按后续观测值自动抬高')
}

/** 通过统一 scanner 的公开 CLI 校验 source package manifests。 */
function verifySourceManifestScanner(): void {
  const result = spawnSync(process.execPath, [
    join(REPO_ROOT, 'tools/release/check-package-artifacts.mjs'),
    '--check-source-manifests'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })

  assertCommandPassed(result, 'source package artifact scanner')
}

/** 通过仓库外 synthetic tarball 锁定统一 scanner 的允许与拒绝矩阵。 */
function verifyArtifactScannerMatrix(): void {
  const contract = readJsonFile<PackageArtifactContract>(CONTRACT_PATH)
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-scanner-'))
  const core = requirePackageContract(contract, '@4xian/jword-core')
  const native = requirePackageContract(contract, '@4xian/jword-native')

  try {
    assertSyntheticScanPassed(root, 'core-valid', core)
    assertSyntheticScanFailed(root, 'source-directory', core, { 'src/index.js': 'export {}' })
    assertSyntheticScanFailed(root, 'test-directory', core, { 'test/index.js': 'export {}' })
    assertSyntheticScanFailed(root, 'nested-test-directory', core, { 'dist/__tests__/index.js': 'export {}' })
    assertSyntheticScanFailed(root, 'unapproved-fixture', core, { 'fixtures/registry.json': '{}' })
    assertSyntheticScanFailed(root, 'source-typescript', core, { 'dist/private.tsx': 'export {}' })
    assertSyntheticScanFailed(root, 'source-map', core, { 'dist/index.js.map': '{}' })
    assertSyntheticScanFailed(root, 'sources-content', core, { 'dist/leak.js': 'const leak = "sourcesContent"' })
    assertSyntheticScanFailed(root, 'source-map-url', core, { 'dist/leak.js': '//# sourceMappingURL=index.js.map' })
    assertSyntheticScanFailed(root, 'malformed-manifest', core, {
      'package.json': 'createInsecureTestOnlyJWordLicenseSignature{'
    })
    assertSyntheticScanFailed(root, 'manifest-type', core, {}, { type: undefined })
    assertSyntheticScanFailed(root, 'build-script', core, {}, { scripts: { prepack: 'node build.mjs' } })
    assertSyntheticScanFailed(root, 'workspace-path', core, {}, {
      dependencies: { ...packedDependencies(core), '@4xian/jword-ui': 'workspace:*' }
    })
    assertSyntheticScanFailed(root, 'private-key', core, { 'dist/leak.js': '-----BEGIN PRIVATE KEY-----' })
    assertSyntheticScanFailed(root, 'private-key-pem', core, { 'dist/private.pem': '-----BEGIN PRIVATE KEY-----' })
    assertSyntheticScanFailed(root, 'private-key-html', core, {
      'dist/private.html': '-----BEGIN RSA PRIVATE KEY-----'
    })
    assertSyntheticScanFailed(root, 'source-map-html', core, {
      'dist/index.html': '<script>//# sourceMappingURL=index.js.map</script>'
    })
    assertSyntheticScanFailed(root, 'test-signer', core, {
      'dist/leak.js': 'createInsecureTestOnlyJWordLicenseSignature'
    })
    assertSyntheticScanFailed(root, 'production-signer', core, { 'dist/leak.js': 'createJWordLicenseSignature' })
    assertSyntheticScanPassed(root, 'native-registry-valid', native, {
      'fixtures/registry.json': readFileSync(join(REPO_ROOT, 'fixtures/native/registry.json'))
    })
    assertSyntheticScanFailed(root, 'native-missing-readme', native, {
      'fixtures/registry.json': readFileSync(join(REPO_ROOT, 'fixtures/native/registry.json'))
    }, {}, true)
    assertSyntheticScanFailed(root, 'native-second-fixture', native, {
      'fixtures/registry.json': readFileSync(join(REPO_ROOT, 'fixtures/native/registry.json')),
      'fixtures/extra.json': '{}'
    })
    assertSyntheticScanFailed(root, 'native-renamed-fixture', native, {
      'fixtures/renamed.json': readFileSync(join(REPO_ROOT, 'fixtures/native/registry.json'))
    })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 从 contract 读取一个必需 package。 */
function requirePackageContract(contract: PackageArtifactContract, name: string): RuntimePackageContract {
  const packageContract = contract.packages.find(matchesPackageName(name))

  expect(packageContract, `${name} contract missing`).toBeDefined()
  return packageContract!
}

/** 构造 synthetic tarball 并断言 scanner 通过。 */
function assertSyntheticScanPassed(
  root: string,
  id: string,
  packageContract: RuntimePackageContract,
  extraFiles: Readonly<Record<string, string | Buffer>> = {},
  manifestPatch: Readonly<Record<string, unknown>> = {}
): void {
  const result = runSyntheticScan(root, id, packageContract, extraFiles, manifestPatch)

  assertCommandPassed(result, id)
}

/** 构造 synthetic tarball 并断言 scanner fail closed 且不回显秘密内容。 */
function assertSyntheticScanFailed(
  root: string,
  id: string,
  packageContract: RuntimePackageContract,
  extraFiles: Readonly<Record<string, string | Buffer>> = {},
  manifestPatch: Readonly<Record<string, unknown>> = {},
  omitReadme = false
): void {
  const result = runSyntheticScan(root, id, packageContract, extraFiles, manifestPatch, omitReadme)
  const output = `${result.stdout}\n${result.stderr}`

  expect(result.status, `${id} unexpectedly passed`).not.toBe(0)
  expect(output).not.toContain('nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A')
  expect(output).not.toContain('1khcNK8g3qT9XGo1IyY3QENcs3Nxn_pYoS2jov2W4jQ')
  expect(output).not.toContain('createInse')
}

/** 构造并扫描一个 repo 外 synthetic package tarball。 */
function runSyntheticScan(
  root: string,
  id: string,
  packageContract: RuntimePackageContract,
  extraFiles: Readonly<Record<string, string | Buffer>>,
  manifestPatch: Readonly<Record<string, unknown>>,
  omitReadme = false
): SpawnSyncReturns<string> {
  const caseRoot = join(root, id)
  const packageRoot = join(caseRoot, 'package')
  const tarballPath = join(root, `${id}.tgz`)
  const manifest = { ...createPackedManifest(packageContract), ...manifestPatch }

  writePackageFile(packageRoot, 'package.json', `${JSON.stringify(manifest, null, 2)}\n`)
  for (const target of packageContract.exports.flatMap(readExportTargets)) {
    writePackageFile(packageRoot, target.replace(/^\.\//u, ''), 'export {}\n')
  }
  if (packageContract.files.includes('README.md') && !omitReadme) {
    writePackageFile(packageRoot, 'README.md', '# Synthetic package\n')
  }
  for (const [path, content] of Object.entries(extraFiles)) {
    writePackageFile(packageRoot, path, content)
  }

  const tarResult = spawnSync('tar', ['-czf', tarballPath, '-C', caseRoot, 'package'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, COPYFILE_DISABLE: '1' }
  })

  assertCommandPassed(tarResult, `create ${id} tarball`)
  return spawnSync(process.execPath, [
    join(REPO_ROOT, 'tools/release/check-package-artifacts.mjs'),
    '--tarball',
    tarballPath,
    '--package-name',
    packageContract.name
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })
}

/** 构造 scanner 期望的最小 packed manifest。 */
function createPackedManifest(packageContract: RuntimePackageContract): Readonly<Record<string, unknown>> {
  const exports: Record<string, ExportTarget | string> = {}

  for (const entry of packageContract.exports) {
    exports[entry.subpath] = entry.target
  }

  return {
    name: packageContract.name,
    version: packageContract.version,
    private: packageContract.private,
    type: 'module',
    publishConfig: { access: packageContract.sourceAccess },
    files: packageContract.files,
    exports,
    sideEffects: packageContract.sideEffects,
    dependencies: packedDependencies(packageContract),
    peerDependencies: packedPeerDependencies(packageContract)
  }
}

/** 构造 packed dependency 映射。 */
function packedDependencies(packageContract: RuntimePackageContract): Readonly<Record<string, string>> {
  return mergePackedDependencies(
    packageContract.dependencyPolicy.firstParty,
    packageContract.dependencyPolicy.external,
    packageContract.version
  )
}

/** 构造 packed peer dependency 映射。 */
function packedPeerDependencies(packageContract: RuntimePackageContract): Readonly<Record<string, string>> {
  return mergePackedDependencies(
    packageContract.dependencyPolicy.firstPartyPeers,
    packageContract.dependencyPolicy.externalPeers,
    packageContract.version
  )
}

/** 按 ASCII key 合并 first-party 固定版本与外部依赖。 */
function mergePackedDependencies(
  firstParty: readonly string[],
  external: Readonly<Record<string, string>>,
  version: string
): Readonly<Record<string, string>> {
  const result: Record<string, string> = { ...external }

  for (const name of firstParty) {
    result[name] = version
  }

  return Object.fromEntries(Object.entries(result).sort(compareStringEntries))
}

/** 按 dependency name 排序键值项。 */
function compareStringEntries(left: readonly [string, string], right: readonly [string, string]): number {
  return left[0].localeCompare(right[0], 'en')
}

/** 展开一个 contract export 的实体路径。 */
function readExportTargets(entry: PackageExportContract): readonly string[] {
  return typeof entry.target === 'string' ? [entry.target] : [entry.target.types, entry.target.import]
}

/** 在 synthetic package 内写入一个文件并预创建父目录。 */
function writePackageFile(packageRoot: string, path: string, content: string | Buffer): void {
  const absolutePath = join(packageRoot, path)

  mkdirSync(resolve(absolutePath, '..'), { recursive: true })
  writeFileSync(absolutePath, content)
}

/** 生成 npm-delivery package 的冻结分类策略。 */
function npmPackagePolicy(
  classification: Exclude<PackageClassification, 'docker-only'>,
  access: 'public' | 'restricted',
  environments: Readonly<Record<string, readonly ExportEnvironment[]>>
): ExpectedPackagePolicy {
  return {
    classification,
    delivery: access === 'public' ? 'npm-public' : 'npm-restricted',
    registryIntent: access,
    environments
  }
}

/** 排除 Docker-only package，得到十一项 npm 交付集合。 */
function filterNpmDeliveryPackage(name: string): boolean {
  return name !== '@4xian/jword-collab-server'
}

/** 校验十二个 runtime package 的分类、exports、allowlist 和依赖策略。 */
function verifyRuntimePackages(packages: readonly RuntimePackageContract[]): void {
  expect(packages).toHaveLength(12)
  expect(sortedUniquePackageNames(packages)).toEqual(RUNTIME_PACKAGE_NAMES)

  for (const packageContract of packages) {
    const expectedPolicy = EXPECTED_PACKAGE_POLICIES[packageContract.name]

    expect(expectedPolicy, `${packageContract.name} 缺少冻结策略`).toBeDefined()
    expect(Object.keys(packageContract).sort()).toEqual([
      'classification',
      'delivery',
      'dependencyPolicy',
      'exports',
      'files',
      'fixtureAllowlist',
      'name',
      'private',
      'registryIntent',
      'sideEffects',
      'sourceAccess',
      'version',
      'workspacePath'
    ])
    expect(packageContract.classification).toBe(expectedPolicy!.classification)
    expect(packageContract.delivery).toBe(expectedPolicy!.delivery)
    expect(packageContract.registryIntent).toBe(expectedPolicy!.registryIntent)
    expect(packageContract.fixtureAllowlist).toEqual(expectedPolicy!.fixtureAllowlist ?? [])

    verifySourceManifestContract(packageContract, expectedPolicy!)
  }
}

/** 返回排序且保持重复可见的 package name，供精确集合断言。 */
function sortedUniquePackageNames(packages: readonly RuntimePackageContract[]): readonly string[] {
  const names = packages.map(readContractPackageName).sort()

  expect(new Set(names).size).toBe(names.length)
  return names
}

/** 读取 contract package name 供数组投影。 */
function readContractPackageName(packageContract: RuntimePackageContract): string {
  return packageContract.name
}

/** 对照 source manifest 校验单个 package contract。 */
function verifySourceManifestContract(
  packageContract: RuntimePackageContract,
  expectedPolicy: ExpectedPackagePolicy
): void {
  const manifestPath = join(REPO_ROOT, packageContract.workspacePath, 'package.json')
  const manifest = readJsonFile<SourcePackageManifest>(manifestPath)

  expect(packageContract.workspacePath).toBe(packagePathFromName(packageContract.name))
  expect(manifest.name).toBe(packageContract.name)
  expect(packageContract.version).toBe('0.0.0')
  expect(packageContract.version).toBe(manifest.version)
  expect(packageContract.private).toBe(true)
  expect(packageContract.private).toBe(manifest.private)
  expect(manifest.type).toBe('module')
  expect(packageContract.sourceAccess).toBe(manifest.publishConfig.access)
  expect(packageContract.files).toEqual(manifest.files)
  expect(packageContract.sideEffects).toEqual(manifest.sideEffects)
  expect(packageContract.exports).toHaveLength(Object.keys(manifest.exports).length)

  const seenSubpaths = new Set<string>()
  for (const exportContract of packageContract.exports) {
    expect(Object.keys(exportContract).sort()).toEqual(['environments', 'subpath', 'target'])
    expect(seenSubpaths.has(exportContract.subpath)).toBe(false)
    seenSubpaths.add(exportContract.subpath)
    expect(exportContract.target).toEqual(manifest.exports[exportContract.subpath])
    expect(exportContract.environments).toEqual(expectedPolicy.environments[exportContract.subpath])
    expect(exportContract.environments.length).toBeGreaterThan(0)
    expect(new Set(exportContract.environments).size).toBe(exportContract.environments.length)
    for (const environment of exportContract.environments) {
      expect(Object.hasOwn(ENVIRONMENT_RUNTIME_MAP, environment)).toBe(true)
    }
  }

  expect([...seenSubpaths].sort()).toEqual(Object.keys(expectedPolicy.environments).sort())
  verifyDependencyPolicy(packageContract.dependencyPolicy, manifest)
}

/** 把 package name 映射到当前 workspace 路径。 */
function packagePathFromName(name: string): string {
  return `packages/${name.slice('@4xian/jword-'.length)}`
}

/** 对照 manifest 锁定 first-party 与外部 dependency/peer 分组。 */
function verifyDependencyPolicy(policy: DependencyPolicy, manifest: SourcePackageManifest): void {
  expect(Object.keys(policy).sort()).toEqual([
    'external',
    'externalPeers',
    'firstParty',
    'firstPartyPeers'
  ])

  const dependencies = manifest.dependencies ?? {}
  const peers = manifest.peerDependencies ?? {}

  expect(policy.firstParty).toEqual(sortedMatchingNames(dependencies, isFirstPartyPackage))
  expect(policy.firstPartyPeers).toEqual(sortedMatchingNames(peers, isFirstPartyPackage))
  expect(policy.external).toEqual(filterDependencyVersions(dependencies, isExternalPackage))
  expect(policy.externalPeers).toEqual(filterDependencyVersions(peers, isExternalPackage))
}

/** 判断 dependency name 是否属于 JWord first-party package。 */
function isFirstPartyPackage(name: string): boolean {
  return name.startsWith('@4xian/jword-')
}

/** 判断 dependency name 是否属于外部 package。 */
function isExternalPackage(name: string): boolean {
  return !isFirstPartyPackage(name)
}

/** 按谓词筛选并排序 dependency name。 */
function sortedMatchingNames(
  dependencies: Readonly<Record<string, string>>,
  predicate: (name: string) => boolean
): readonly string[] {
  return Object.keys(dependencies).filter(predicate).sort()
}

/** 按谓词筛选 dependency version 并保持 ASCII key 顺序。 */
function filterDependencyVersions(
  dependencies: Readonly<Record<string, string>>,
  predicate: (name: string) => boolean
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {}

  for (const name of Object.keys(dependencies).filter(predicate).sort()) {
    result[name] = dependencies[name]!
  }

  return result
}

/** 校验七条 consumer journey、精确 target 与 first-party closure。 */
function verifyJourneys(contract: PackageArtifactContract): void {
  expect(contract.journeys).toEqual(expectedJourneys())

  const declaredTargets = new Set<string>()
  const coveredExports = new Set<string>()
  for (const journey of contract.journeys) {
    expect(journey.targets.length).toBeGreaterThan(0)
    expect(new Set(journey.targets.map(journeyTargetKey)).size).toBe(journey.targets.length)
    expect(journey.requestedPackages).toEqual([...journey.requestedPackages].sort())
    expect(journey.firstPartyClosure).toEqual([...journey.firstPartyClosure].sort())
    expect(intersection(journey.requestedPackages, journey.firstPartyClosure)).toEqual([])

    for (const target of journey.targets) {
      const packageContract = contract.packages.find(matchesPackageName(target.package))
      const exportContract = packageContract?.exports.find(matchesExportSubpath(target.subpath))

      expect(packageContract, `${journey.id} 引用未知 package ${target.package}`).toBeDefined()
      expect(exportContract, `${journey.id} 引用未知 export ${target.package}${target.subpath}`).toBeDefined()
      expect(exportContract!.environments).toContain(target.environment)
      expect(target.runtime).toBe(ENVIRONMENT_RUNTIME_MAP[target.environment])
      expect(journey.runtimes).toContain(target.runtime)
      declaredTargets.add(`${journey.id}:${journeyTargetKey(target)}`)
      coveredExports.add(exportEnvironmentKey(target.package, target.subpath, target.environment))
    }
  }

  expect(declaredTargets.size).toBe(sumJourneyTargetCount(contract.journeys))
  expect([...coveredExports].sort()).toEqual(allExportEnvironmentKeys(contract.packages))
}

/** 创建 package name 匹配函数供 contract 查找。 */
function matchesPackageName(name: string): (candidate: RuntimePackageContract) => boolean {
  /** 判断候选 package 是否命中目标名称。 */
  return function matchPackageName(candidate: RuntimePackageContract): boolean {
    return candidate.name === name
  }
}

/** 创建 export subpath 匹配函数供 contract 查找。 */
function matchesExportSubpath(subpath: string): (candidate: PackageExportContract) => boolean {
  /** 判断候选 export 是否命中目标 subpath。 */
  return function matchExportSubpath(candidate: PackageExportContract): boolean {
    return candidate.subpath === subpath
  }
}

/** 生成全部 export/environment 精确键。 */
function allExportEnvironmentKeys(packages: readonly RuntimePackageContract[]): readonly string[] {
  const keys: string[] = []

  for (const packageContract of packages) {
    for (const exportContract of packageContract.exports) {
      for (const environment of exportContract.environments) {
        keys.push(exportEnvironmentKey(packageContract.name, exportContract.subpath, environment))
      }
    }
  }

  return keys.sort()
}

/** 生成单个 export/environment 精确键。 */
function exportEnvironmentKey(
  packageName: string,
  subpath: string,
  environment: ExportEnvironment
): string {
  return `${packageName}:${subpath}:${environment}`
}

/** 计算全部 journey target 数量。 */
function sumJourneyTargetCount(journeys: readonly ConsumerJourneyContract[]): number {
  let count = 0

  for (const journey of journeys) {
    count += journey.targets.length
  }

  return count
}

/** 返回两个字符串集合按 ASCII 排序的交集。 */
function intersection(left: readonly string[], right: readonly string[]): readonly string[] {
  const rightSet = new Set(right)

  return left.filter(rightSet.has.bind(rightSet)).sort()
}

/** 把 journey target 转为唯一执行键。 */
function journeyTargetKey(target: JourneyTarget): string {
  return `${target.package}:${target.subpath}:${target.environment}:${target.runtime}`
}

/** 构造七条冻结 journey 及其精确 targets。 */
function expectedJourneys(): readonly ConsumerJourneyContract[] {
  return [
    {
      id: 'node-exports-types',
      runtimes: ['node', 'types'],
      requestedPackages: [...NPM_DELIVERY_PACKAGE_NAMES].sort(),
      firstPartyClosure: [],
      targets: nodeAndTypeTargets()
    },
    {
      id: 'vanilla-editorshell-css',
      runtimes: ['vite-browser'],
      requestedPackages: [
        '@4xian/jword-core',
        '@4xian/jword-devtools',
        '@4xian/jword-ui'
      ],
      firstPartyClosure: [],
      targets: [
        target('@4xian/jword-core', '.', 'browser'),
        target('@4xian/jword-ui', '.', 'browser'),
        target('@4xian/jword-ui', './styles.css', 'browser'),
        target('@4xian/jword-devtools', '.', 'browser')
      ]
    },
    {
      id: 'react-wrapper',
      runtimes: ['vite-browser'],
      requestedPackages: ['@4xian/jword-react'],
      firstPartyClosure: ['@4xian/jword-core', '@4xian/jword-ui'],
      targets: [target('@4xian/jword-react', '.', 'browser')]
    },
    {
      id: 'vue-wrapper',
      runtimes: ['vite-browser'],
      requestedPackages: ['@4xian/jword-vue'],
      firstPartyClosure: ['@4xian/jword-core', '@4xian/jword-ui'],
      targets: [target('@4xian/jword-vue', '.', 'browser')]
    },
    {
      id: 'module-workers',
      runtimes: ['vite-browser', 'dedicated-worker'],
      requestedPackages: [
        '@4xian/jword-docx',
        '@4xian/jword-native',
        '@4xian/jword-pdf'
      ],
      firstPartyClosure: ['@4xian/jword-core', '@4xian/jword-license'],
      targets: moduleWorkerTargets()
    },
    {
      id: 'license-runtime-identity',
      runtimes: ['node', 'vite-browser', 'dedicated-worker', 'types'],
      requestedPackages: [
        '@4xian/jword-collab',
        '@4xian/jword-license',
        '@4xian/jword-persistence'
      ],
      firstPartyClosure: ['@4xian/jword-core'],
      targets: licenseRuntimeTargets()
    },
    {
      id: 'collab-server-image-node',
      runtimes: ['image-node', 'types'],
      requestedPackages: ['@4xian/jword-collab-server'],
      firstPartyClosure: [
        '@4xian/jword-core',
        '@4xian/jword-license',
        '@4xian/jword-persistence'
      ],
      targets: [
        target('@4xian/jword-collab-server', '.', 'image-node'),
        target('@4xian/jword-collab-server', '.', 'types')
      ]
    }
  ]
}

/** 构造十一包全部 Node-compatible 与 types export targets。 */
function nodeAndTypeTargets(): readonly JourneyTarget[] {
  const targets: JourneyTarget[] = []

  for (const packageName of NPM_DELIVERY_PACKAGE_NAMES) {
    const policy = EXPECTED_PACKAGE_POLICIES[packageName]!
    for (const subpath of Object.keys(policy.environments)) {
      const environments = policy.environments[subpath]!
      if (environments.includes('node')) {
        targets.push(target(packageName, subpath, 'node'))
      }
      if (environments.includes('types')) {
        targets.push(target(packageName, subpath, 'types'))
      }
    }
  }

  return targets
}

/** 构造 native、DOCX、PDF 的 browser 与 Dedicated Worker targets。 */
function moduleWorkerTargets(): readonly JourneyTarget[] {
  const targets: JourneyTarget[] = []

  for (const packageName of [
    '@4xian/jword-native',
    '@4xian/jword-docx',
    '@4xian/jword-pdf'
  ]) {
    targets.push(target(packageName, '.', 'browser'))
    targets.push(target(packageName, './worker', 'browser'))
    targets.push(target(packageName, './worker', 'dedicated-worker'))
  }

  return targets
}

/** 构造 License、Persistence 与 Collab runtime identity targets。 */
function licenseRuntimeTargets(): readonly JourneyTarget[] {
  return [
    target('@4xian/jword-license', '.', 'node'),
    target('@4xian/jword-license', '.', 'browser'),
    target('@4xian/jword-license', '.', 'dedicated-worker'),
    target('@4xian/jword-license', '.', 'types'),
    target('@4xian/jword-persistence', '.', 'node'),
    target('@4xian/jword-persistence', '.', 'browser'),
    target('@4xian/jword-persistence', '.', 'types'),
    target('@4xian/jword-collab', '.', 'node'),
    target('@4xian/jword-collab', '.', 'browser'),
    target('@4xian/jword-collab', '.', 'types'),
    target('@4xian/jword-collab', './experimental', 'node'),
    target('@4xian/jword-collab', './experimental', 'browser'),
    target('@4xian/jword-collab', './experimental', 'types')
  ]
}

/** 构造环境与 runtime 固定映射的 journey target。 */
function target(
  packageName: string,
  subpath: string,
  environment: ExportEnvironment
): JourneyTarget {
  return {
    package: packageName,
    subpath,
    environment,
    runtime: ENVIRONMENT_RUNTIME_MAP[environment]
  }
}

/** 校验八项固定 size budget 及 native 原始 bytes/hash。 */
function verifySizeBudgets(sizeBudgets: readonly SizeBudgetContract[]): void {
  const nativeBytes = readFileSync(join(REPO_ROOT, 'packages/native/fixtures/registry.json'))
  const expected = [
    {
      id: 'core-entry-js',
      source: 'tarball:@4xian/jword-core/dist/index.js',
      limitBytes: 650_000
    },
    {
      id: 'native-registry',
      source: 'tarball:@4xian/jword-native/fixtures/registry.json',
      sourceSha256: sha256(nativeBytes),
      limitBytes: nativeBytes.byteLength
    },
    vanillaBudget('npm', 'chromium'),
    vanillaBudget('npm', 'firefox'),
    vanillaBudget('npm', 'webkit'),
    vanillaBudget('pnpm', 'chromium'),
    vanillaBudget('pnpm', 'firefox'),
    vanillaBudget('pnpm', 'webkit')
  ].sort(compareBudgetId)

  expect(sizeBudgets).toHaveLength(8)
  expect(new Set(sizeBudgets.map(readBudgetId)).size).toBe(8)
  expect([...sizeBudgets].sort(compareBudgetId)).toEqual(expected)
}

/** 构造一项 Vanilla 首屏 bundle budget。 */
function vanillaBudget(
  packageManager: 'npm' | 'pnpm',
  browser: 'chromium' | 'firefox' | 'webkit'
): SizeBudgetContract {
  return {
    id: `vanilla-first-screen/${packageManager}/${browser}`,
    source: `consumer:bundles/vanilla-editorshell-css--${packageManager}--vite-browser--${browser}/first-screen`,
    limitBytes: 900_000
  }
}

/** 按 budget ID 排序。 */
function compareBudgetId(left: SizeBudgetContract, right: SizeBudgetContract): number {
  return left.id.localeCompare(right.id, 'en')
}

/** 读取 budget ID 供唯一性检查。 */
function readBudgetId(budget: SizeBudgetContract): string {
  return budget.id
}

/** 校验 native 唯一 package-local fixture 与根 registry 字节一致。 */
function verifyNativeRegistry(packages: readonly RuntimePackageContract[]): void {
  const nativePackage = packages.find(matchesPackageName('@4xian/jword-native'))
  const packageRegistryPath = join(REPO_ROOT, 'packages/native/fixtures/registry.json')
  const rootRegistryPath = join(REPO_ROOT, 'fixtures/native/registry.json')

  expect(nativePackage?.files).toEqual(['dist', 'fixtures', 'README.md'])
  expect(nativePackage?.fixtureAllowlist).toEqual(['fixtures/registry.json'])
  expect(readFileSync(packageRegistryPath)).toEqual(readFileSync(rootRegistryPath))
  expect(listActualPackageFixtures()).toEqual(['packages/native/fixtures/registry.json'])
}

/** 枚举当前 packages 下实际存在的 fixture regular files。 */
function listActualPackageFixtures(): readonly string[] {
  const result = spawnSync('find', [
    'packages',
    '-path',
    '*/fixtures/*',
    '-type',
    'f',
    '-print'
  ], {
    cwd: REPO_ROOT,
    encoding: 'utf8'
  })

  assertCommandPassed(result, 'find package fixtures')
  return result.stdout.trim().split('\n').filter(Boolean).sort()
}

/** 断言外部命令成功，并在失败时保留不含输入材料的诊断。 */
function assertCommandPassed(result: SpawnSyncReturns<string>, label: string): void {
  expect(result.status, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
}

/** 读取并解析 JSON 文件。 */
function readJsonFile<TValue>(path: string): TValue {
  return JSON.parse(readFileSync(path, 'utf8')) as TValue
}

/** 计算原始 bytes 的小写 SHA-256。 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
