/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 制品构建、清单、校验和、绑定与比较契约。
 * 边界：只在仓库外的合成 Git 包夹具运行，不构建或打包当前 JWord 工作树。
 * 协作模块：制品工具、构建器、扫描器、比较器与四个发布兼容入口。
 * 性能/安全约束：夹具必须位于系统临时目录，任何失败都不得修改或清理当前仓库。
 * 实现说明：生产契约通过合成夹具的公开命令行接缝验证。
 */

import { createHash } from 'node:crypto'
import { execFileSync, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  createSha256Sidecar,
  createSha256Sums,
  readPhase3Environment,
  sourceCommandDefinitions,
  testCommandDefinitions,
  validateArtifactBinding,
  validateArtifactManifest,
  validateSha256Sidecar,
  validateSha256Sums,
  validateSourceReport,
  validateTestReport,
  validateTarballFile
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/phase3-artifact-utils.mjs'

const HASH_A = 'a'.repeat(64)
const HASH_B = 'b'.repeat(64)
const HASH_C = 'c'.repeat(64)
const HASH_D = 'd'.repeat(64)
const HASH_E = 'e'.repeat(64)
const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const BUILDER_PATH = join(REPO_ROOT, 'tools/release/build-phase3-artifacts.mjs')
const COMPARE_PATH = join(REPO_ROOT, 'tools/release/compare-phase3-artifacts.mjs')

interface BuilderFixture {
  readonly workspaceRoot: string
  readonly root: string
  readonly environment: Record<string, string>
  readonly sourceDirectory: string
  readonly runDirectory: string
  readonly commandLog: string
  readonly trackedFile: string
}

interface ReleaseInventoryFixture {
  readonly root: string
  readonly manifestPath: string
  readonly commandLog: string
  readonly environment: Record<string, string | undefined>
}

interface ArtifactIdentityFixture {
  readonly schemaVersion: number
  readonly gitSha: string
  readonly lockfileSha256: string
  readonly contractSha256: string
  readonly builderSha256: string
  readonly environment: {
    readonly node: string
    readonly npm: string
    readonly pnpm: string
    readonly os: string
    readonly arch: string
  }
  readonly sha256SumsSha256: string
  readonly packages: readonly Readonly<Record<string, unknown>>[]
}

/** 注册 Phase 3 artifact builder 的公开 seam。 */
function runArtifactBuildSuite(): void {
  it('provides the frozen builder, utility, and compare entrypoints', verifyArtifactEntrypoints)
  it('freezes canonical inventory, checksums, identity, and binding bytes', verifyArtifactIdentityContract)
  it('rejects checksum, sidecar, filename, environment, and identity mutations', verifyArtifactMutations)
  it('fails closed for staged, unstaged, and non-ignored untracked input', verifyDirtyRepositoryInputs, 60_000)
  it('fails closed when source, build, pack, or direct commands dirty the repository', verifyDirtyCommandCheckpoints, 120_000)
  it('builds and compares a bound synthetic artifact set outside the repository', verifySyntheticArtifactLifecycle, 120_000)
  it('routes all four release entrypoints through one read-only synthetic inventory', verifyReleaseInventoryEntrypoints, 60_000)
}

describe('Phase 3 artifact build contract', runArtifactBuildSuite)

/** 校验 B2 三个新入口已经实现。 */
function verifyArtifactEntrypoints(): void {
  expect(existsSync('tools/release/phase3-artifact-utils.mjs')).toBe(true)
  expect(existsSync('tools/release/build-phase3-artifacts.mjs')).toBe(true)
  expect(existsSync('tools/release/compare-phase3-artifacts.mjs')).toBe(true)
  const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { readonly scripts: Readonly<Record<string, string>> }).scripts
  const playwrightConfig = readFileSync('playwright.config.ts', 'utf8')
  const perfProject = playwrightConfig.match(/\{\s*name: 'perf-chromium',[\s\S]*?\n\s*\},\s*(?=\{\s*name: 'ime-chromium')/)?.[0]

  expect(testCommandDefinitions()).toEqual([
    { id: 'direct-vitest', command: 'pnpm exec vitest run --passWithNoTests' },
    { id: 'e2e', command: 'pnpm test:e2e:phase3' },
    { id: 'visual', command: 'pnpm test:visual' },
    { id: 'bench', command: 'pnpm bench:phase3' }
  ])
  expect(scripts).toMatchObject({
    'test:e2e': 'playwright test --project=chromium --project=firefox --project=webkit --pass-with-no-tests && playwright test --project=perf-chromium --pass-with-no-tests',
    'test:e2e:phase3': 'playwright test examples/vanilla/tests --project=chromium --project=firefox --pass-with-no-tests && playwright test examples/vanilla/tests --project=webkit --workers=1 --timeout=60000 --pass-with-no-tests && playwright test examples/vanilla/tests --project=perf-chromium --workers=1 --pass-with-no-tests',
    bench: 'node tools/bench/run-bench.mjs',
    'bench:phase3': 'node benchmarks/gate45-native-benchmark.mjs && node benchmarks/gate2-render-benchmark.mjs && node benchmarks/phase4-input-hotpath-benchmark.mjs'
  })
  expect(perfProject).toBeDefined()
  expect(perfProject).not.toMatch(/\[?\s*['"]?workers['"]?\s*\]?\s*:/)
  for (const definition of [...sourceCommandDefinitions(), ...testCommandDefinitions()]) {
    expect(definition.command).not.toBe('pnpm test')
  }
}

/** 校验 canonical bytes、payload、checksum、artifactSetId 与 binding schema。 */
function verifyArtifactIdentityContract(): void {
  const files = [
    { path: 'dist/index.d.ts', sha256: HASH_A, bytes: 3 },
    { path: 'dist/index.js', sha256: HASH_B, bytes: 5 },
    { path: 'package.json', sha256: HASH_C, bytes: 7 }
  ]
  const packages = [
    createPackageInventory('@4xian/jword-core', '4xian-jword-core-0.0.0.tgz', HASH_D, files),
    createPackageInventory('@4xian/jword-native', '4xian-jword-native-0.0.0.tgz', HASH_E, files)
  ]
  const checksumBytes = createSha256Sums(packages)
  const artifactIdentity = createArtifactIdentity(packages, checksumBytes)
  const runMetadata = {
    createdAt: '2026-07-22T00:00:00.000Z',
    executionRunId: 'synthetic-a',
    outputDirectory: '/tmp/phase3-run-a'
  }
  const manifest = createArtifactManifest(artifactIdentity, runMetadata)
  const manifestBytes = canonicalBytes(manifest)
  const binding = createArtifactBinding({
    gitSha: artifactIdentity.gitSha,
    lockfileSha256: artifactIdentity.lockfileSha256,
    artifactSetId: manifest.artifactSetId,
    artifactManifestSha256: sha256ForTest(manifestBytes),
    sha256SumsSha256: artifactIdentity.sha256SumsSha256,
    sourceReportSha256: HASH_D,
    testReportSha256: HASH_E
  })

  expect(canonicalBytes({ z: 1, a: { y: 2, b: 3 } }).toString('utf8')).toBe('{"a":{"b":3,"y":2},"z":1}')
  expect(createPayloadSha256(files)).toBe(sha256ForTest(canonicalBytes(files)))
  expect(checksumBytes.toString('utf8')).toBe(`${HASH_D}  4xian-jword-core-0.0.0.tgz\n${HASH_E}  4xian-jword-native-0.0.0.tgz\n`)
  expect(validateSha256Sums(checksumBytes, packages)).toBe(artifactIdentity.sha256SumsSha256)
  expect(validateArtifactManifest(manifest, checksumBytes)).toEqual(manifest)
  expect(validateArtifactBinding(binding, manifestBytes, manifest, checksumBytes)).toEqual(binding)

  const metadataMutation = createArtifactManifest(artifactIdentity, { ...runMetadata, executionRunId: 'synthetic-b' })
  const identityMutation = createArtifactManifest({ ...artifactIdentity, builderSha256: HASH_E }, runMetadata)
  const identityMutations = {
    schemaVersion: { ...artifactIdentity, schemaVersion: 2 },
    gitSha: { ...artifactIdentity, gitSha: '2'.repeat(40) },
    lockfileSha256: { ...artifactIdentity, lockfileSha256: HASH_B },
    contractSha256: { ...artifactIdentity, contractSha256: HASH_C },
    builderSha256: { ...artifactIdentity, builderSha256: HASH_D },
    environment: {
      ...artifactIdentity,
      environment: { ...artifactIdentity.environment, node: 'v21.0.0' }
    },
    sha256SumsSha256: { ...artifactIdentity, sha256SumsSha256: HASH_E },
    packages: {
      ...artifactIdentity,
      packages: [{ ...packages[0], tarballBytes: 12 }, packages[1]]
    }
  }

  expect(metadataMutation.artifactSetId).toBe(manifest.artifactSetId)
  expect(identityMutation.artifactSetId).not.toBe(manifest.artifactSetId)
  for (const [field, mutation] of Object.entries(identityMutations)) {
    expect(sha256ForTest(canonicalBytes(mutation)), field).not.toBe(manifest.artifactSetId)
  }
}

/** 校验所有字节格式和 identity mutation 都稳定 fail closed。 */
function verifyArtifactMutations(): void {
  const files = [
    { path: 'dist/index.js', sha256: HASH_A, bytes: 1 },
    { path: 'package.json', sha256: HASH_B, bytes: 2 }
  ]
  const packages = [createPackageInventory('@4xian/jword-core', 'core.tgz', HASH_B, files)]
  const checksumBytes = createSha256Sums(packages)
  const identity = createArtifactIdentity(packages, checksumBytes)
  const manifest = createArtifactManifest(identity, {
    createdAt: '2026-07-22T00:00:00.000Z',
    executionRunId: 'synthetic',
    outputDirectory: '/tmp/phase3-synthetic'
  })
  const validSidecar = createSha256Sidecar(Buffer.from('source-report'))
  const checksumPackages = [
    createPackageInventory('@4xian/jword-core', 'core.tgz', HASH_B, files),
    createPackageInventory('@4xian/jword-native', 'native.tgz', HASH_C, files)
  ]
  const reversedChecksumBytes = Buffer.from(createSha256Sums(checksumPackages).toString('utf8').trimEnd().split('\n').reverse().join('\n') + '\n')
  const fileBytesMutation = [
    { ...files[0]!, bytes: files[0]!.bytes + 1 },
    files[1]
  ]

  expect(readPhase3Environment({ node: 'v20.19.0', npm: '11.9.0', pnpm: '9.14.2' })).toEqual({
    node: 'v20.19.0',
    npm: '11.9.0',
    pnpm: '9.14.2',
    os: process.platform,
    arch: process.arch
  })
  expect(validateSha256Sidecar(validSidecar, Buffer.from('source-report'), 'source report')).toBe(sha256ForTest(Buffer.from('source-report')))

  for (const invalidName of ['.', '..', '/core.tgz', 'dir/core.tgz', 'dir\\core.tgz', 'core', 'core.tgz.bak', 'xcore.tgz!']) {
    expect(() => validateTarballFile(invalidName), invalidName).toThrow()
  }
  for (const mutation of [
    Buffer.from(`${HASH_B} core.tgz\n`),
    Buffer.from(`${HASH_B}  core.tgz\r\n`),
    Buffer.from(`${HASH_B}  core.tgz`),
    Buffer.from(`${HASH_B}  core.tgz\n\n`),
    Buffer.from(` ${HASH_B}  core.tgz\n`)
  ]) {
    expect(() => validateSha256Sums(mutation, packages)).toThrow()
  }
  for (const mutation of [
    Buffer.from(`\ufeff${validSidecar.toString('utf8')}`),
    Buffer.from(validSidecar.toString('utf8').replace('\n', '\r\n')),
    Buffer.from(validSidecar.toString('utf8').trim()),
    Buffer.from(` ${validSidecar.toString('utf8')}`),
    Buffer.from(`${validSidecar.toString('utf8')}\n`),
    Buffer.from(`${validSidecar.toString('utf8').trim()} source-report.json\n`)
  ]) {
    expect(() => validateSha256Sidecar(mutation, Buffer.from('source-report'), 'source report')).toThrow()
  }

  expect(() => createPayloadSha256(files.slice().reverse())).toThrow()
  expect(() => validateSha256Sums(reversedChecksumBytes, checksumPackages)).toThrow()
  expect(() => createArtifactManifest(createArtifactIdentity([
    { ...packages[0], files: fileBytesMutation }
  ], checksumBytes), manifest.runMetadata)).toThrow()
  expect(() => validateArtifactManifest({ ...manifest, artifactSetId: HASH_A }, checksumBytes)).toThrow()
  expect(() => validateArtifactManifest({
    ...manifest,
    artifactIdentity: {
      ...identity,
      environment: { ...identity.environment, os: identity.environment.os.toUpperCase() }
    }
  }, checksumBytes)).toThrow()
  expect(() => validateArtifactManifest({
    ...manifest,
    artifactIdentity: {
      ...identity,
      environment: { ...identity.environment, release: 'forbidden' }
    }
  }, checksumBytes)).toThrow()
  expect(() => validateArtifactManifest({
    ...manifest,
    artifactIdentity: {
      ...identity,
      environment: { ...identity.environment, runner: 'forbidden' }
    }
  }, checksumBytes)).toThrow()
}

/** 校验 production mode 对 staged、unstaged 与 untracked 输入均在打包前失败。 */
function verifyDirtyRepositoryInputs(): void {
  for (const dirtyKind of ['staged', 'unstaged', 'untracked'] as const) {
    const fixture = createBuilderFixture(`dirty-${dirtyKind}`)

    try {
      if (dirtyKind === 'untracked') {
        writeFileSync(join(fixture.root, 'unexpected.txt'), 'dirty\n')
      } else {
        writeFileSync(fixture.trackedFile, `${dirtyKind}\n`)
        if (dirtyKind === 'staged') {
          runGit(fixture.root, ['add', 'tracked.txt'])
        }
      }
      const result = runBuilder(fixture, canonicalBuilderArguments(fixture))

      expect(result.status, dirtyKind).not.toBe(0)
      expect(listTarballs(fixture.runDirectory), dirtyKind).toEqual([])
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true })
    }
  }

  const symlinkFixture = createBuilderFixture('symlink-output')
  const ignoredDirectory = join(symlinkFixture.root, 'ignored-output')
  const outsideAlias = join(symlinkFixture.workspaceRoot, 'outside-alias')

  try {
    mkdirSync(ignoredDirectory)
    symlinkSync(ignoredDirectory, outsideAlias, 'dir')
    const result = runBuilder(symlinkFixture, [
      '--purpose',
      'source-report',
      '--out-dir',
      join(outsideAlias, 'source-report')
    ])

    expect(result.status).not.toBe(0)
    expect(existsSync(join(ignoredDirectory, 'source-report'))).toBe(false)
  } finally {
    rmSync(symlinkFixture.workspaceRoot, { recursive: true, force: true })
  }
}

/** 校验每条 source/build/pack/direct 命令后的 clean checkpoint。 */
function verifyDirtyCommandCheckpoints(): void {
  for (const checkpoint of ['lint', 'build', 'pack', 'e2e', 'direct-vitest'] as const) {
    const fixture = createBuilderFixture(`checkpoint-${checkpoint}`)

    try {
      if (checkpoint === 'lint') {
        const sourceResult = runBuilder(fixture, ['--purpose', 'source-report', '--out-dir', fixture.sourceDirectory], checkpoint)

        expect(sourceResult.status).not.toBe(0)
        expect(sourceResult.stderr).toContain('lint: Phase 3 repository is not clean: \\" M tracked.txt\\"')
        expect(existsSync(join(fixture.sourceDirectory, 'source-report.json'))).toBe(false)
        expect(existsSync(join(fixture.sourceDirectory, 'source-report.json.sha256'))).toBe(false)
        continue
      }

      assertCommandPassed(runBuilder(fixture, [
        '--purpose',
        'source-report',
        '--out-dir',
        fixture.sourceDirectory
      ]), 'source report')
      const artifactResult = runBuilder(fixture, canonicalBuilderArguments(fixture), checkpoint)

      expect(artifactResult.status, checkpoint).not.toBe(0)
      expect(artifactResult.stderr, checkpoint).toContain(`${checkpoint}: Phase 3 repository is not clean: \\" M tracked.txt\\"`)
      expect(existsSync(join(fixture.runDirectory, 'test-report.json')), checkpoint).toBe(false)
      expect(existsSync(join(fixture.runDirectory, 'artifact-binding.json')), checkpoint).toBe(false)
      if (checkpoint === 'build') {
        expect(listTarballs(fixture.runDirectory)).toEqual([])
      }
      if (checkpoint === 'direct-vitest') {
        expect(artifactResult.stderr).toContain('repository is not clean')
        expect(artifactResult.stdout).not.toContain('direct-stdout-sentinel')
        expect(artifactResult.stderr).not.toContain('direct-stderr-sentinel')
      }
    } finally {
      rmSync(fixture.workspaceRoot, { recursive: true, force: true })
    }
  }
}

/** 校验正常 synthetic canonical run、binding 与 raw compare 流程。 */
function verifySyntheticArtifactLifecycle(): void {
  const fixture = createBuilderFixture('lifecycle')
  const runBDirectory = join(fixture.workspaceRoot, 'run-b')
  const evidenceDirectory = join(fixture.workspaceRoot, 'evidence')

  try {
    assertCommandPassed(runBuilder(fixture, [
      '--purpose',
      'source-report',
      '--out-dir',
      fixture.sourceDirectory
    ]), 'source report')
    assertCommandPassed(runBuilder(fixture, canonicalBuilderArguments(fixture)), 'canonical artifact build')

    const manifestPath = join(fixture.runDirectory, 'artifact-manifest.json')
    const manifestBytes = readFileSync(manifestPath)
    const manifest = JSON.parse(manifestBytes.toString('utf8'))
    const checksumBytes = readFileSync(join(fixture.runDirectory, 'SHA256SUMS'))
    const binding = JSON.parse(readFileSync(join(fixture.runDirectory, 'artifact-binding.json'), 'utf8'))
    const sourceReportBytes = readFileSync(join(fixture.sourceDirectory, 'source-report.json'))
    const sourceReport = JSON.parse(sourceReportBytes.toString('utf8'))
    const testReportBytes = readFileSync(join(fixture.runDirectory, 'test-report.json'))
    const testReport = JSON.parse(testReportBytes.toString('utf8'))

    expect(validateArtifactManifest(manifest, checksumBytes)).toEqual(manifest)
    expect(validateArtifactBinding(binding, manifestBytes, manifest, checksumBytes)).toEqual(binding)
    expect(validateSourceReport(sourceReport)).toEqual(sourceReport)
    expect(validateSha256Sidecar(
      readFileSync(join(fixture.sourceDirectory, 'source-report.json.sha256')),
      sourceReportBytes,
      'source report'
    )).toBe(binding.sourceReportSha256)
    expect(validateTestReport(testReport, {
      gitSha: manifest.artifactIdentity.gitSha,
      artifactSetId: manifest.artifactSetId
    })).toEqual(testReport)
    expect(binding.testReportSha256).toBe(sha256ForTest(testReportBytes))
    expect(manifest.artifactIdentity.packages).toHaveLength(2)
    expect(Object.keys(manifest.runMetadata).sort()).toEqual(['createdAt', 'executionRunId', 'outputDirectory'])
    expect(Object.keys(binding).sort()).toEqual([
      'artifactManifestSha256',
      'artifactSetId',
      'gitSha',
      'lockfileSha256',
      'schemaVersion',
      'sha256SumsSha256',
      'sourceReportSha256',
      'testReportSha256'
    ])
    expect(testReport.artifactSetId).toBe(manifest.artifactSetId)

    const commands = readFileSync(fixture.commandLog, 'utf8').trim().split('\n')

    expect(commands.filter(matchesExactCommand('pnpm build'))).toHaveLength(1)
    expect(commands.filter(matchesCommandFragment('npm pack --dry-run --json --ignore-scripts'))).toHaveLength(2)
    expect(commands.filter(matchesRealPackCommand)).toHaveLength(2)
    expect(commands.some(matchesExactCommand('pnpm test'))).toBe(false)
    expect(commands.filter(matchesExactCommand('direct-node-options --no-warnings --experimental-websocket'))).toHaveLength(1)

    assertCommandPassed(runBuilder(fixture, [
      '--purpose',
      'reproducibility',
      '--source-report',
      join(fixture.sourceDirectory, 'source-report.json'),
      '--source-report-sha256',
      join(fixture.sourceDirectory, 'source-report.json.sha256'),
      '--out-dir',
      runBDirectory
    ]), 'reproducibility artifact build')
    const compareResult = spawnSync(process.execPath, [
      COMPARE_PATH,
      '--left',
      manifestPath,
      '--left-binding',
      join(fixture.runDirectory, 'artifact-binding.json'),
      '--right',
      join(runBDirectory, 'artifact-manifest.json'),
      '--evidence-dir',
      evidenceDirectory
    ], { cwd: fixture.root, encoding: 'utf8', env: fixture.environment })

    assertCommandPassed(compareResult, 'artifact compare')
    expect(readdirSync(join(evidenceDirectory, 'run-b-tarballs')).sort()).toEqual(listTarballs(runBDirectory))
    const reproducibilitySummary = JSON.parse(readFileSync(join(evidenceDirectory, 'reproducibility-evidence.json'), 'utf8'))

    expect(reproducibilitySummary.bindingSha256).toBe(sha256ForTest(
      readFileSync(join(fixture.runDirectory, 'artifact-binding.json'))
    ))
    const evidenceManifest = JSON.parse(readFileSync(join(evidenceDirectory, 'evidence-manifest.json'), 'utf8'))
    const expectedEvidencePaths = [
      'comparison-evidence.json',
      'reproducibility-evidence.json',
      'run-b-SHA256SUMS',
      'run-b-artifact-manifest.json',
      ...listTarballs(runBDirectory).map((tarball) => `run-b-tarballs/${tarball}`)
    ].sort()

    expect(evidenceManifest).toMatchObject({ schemaVersion: 1, evidenceType: 'reproducibility' })
    expect(evidenceManifest.files.map((file: { readonly path: string }) => file.path)).toEqual(expectedEvidencePaths)
    expect(evidenceManifest.files).toEqual(expectedEvidencePaths.map((path) => {
      const bytes = readFileSync(join(evidenceDirectory, path))
      return { path, bytes: bytes.byteLength, sha256: sha256ForTest(bytes) }
    }))

    const insideEvidenceResult = runArtifactCompare(
      fixture,
      runBDirectory,
      join(fixture.root, 'comparison-evidence')
    )

    expect(insideEvidenceResult.status).not.toBe(0)
    expect(existsSync(join(fixture.root, 'comparison-evidence'))).toBe(false)

    const runBManifestPath = join(runBDirectory, 'artifact-manifest.json')
    const runBChecksumPath = join(runBDirectory, 'SHA256SUMS')
    const originalRunBManifestBytes = readFileSync(runBManifestPath)
    const originalRunBChecksumBytes = readFileSync(runBChecksumPath)
    const originalRunBManifest = JSON.parse(originalRunBManifestBytes.toString('utf8'))
    const notComparableIdentity = {
      ...originalRunBManifest.artifactIdentity,
      environment: {
        ...originalRunBManifest.artifactIdentity.environment,
        os: 'foreign-platform'
      }
    }
    const notComparableManifest = {
      artifactIdentity: notComparableIdentity,
      artifactSetId: sha256ForTest(canonicalBytes(notComparableIdentity)),
      runMetadata: originalRunBManifest.runMetadata
    }

    writeFileSync(runBManifestPath, canonicalBytes(notComparableManifest))
    const notComparableResult = runArtifactCompare(
      fixture,
      runBDirectory,
      join(fixture.workspaceRoot, 'not-comparable-evidence')
    )

    expect(notComparableResult.status).not.toBe(0)
    expect(JSON.parse(notComparableResult.stdout)).toMatchObject({ status: 'not-comparable', packages: 2 })

    const rawMismatchTarball = originalRunBManifest.artifactIdentity.packages[0].tarballFile
    const rawMismatchTarballPath = join(runBDirectory, rawMismatchTarball)
    const rawMismatchBytes = Buffer.concat([readFileSync(rawMismatchTarballPath), Buffer.from('raw-mismatch')])
    /** 只改变第一个 run-b 原始包及其 checksum/manifest 记录。 */
    const rawMismatchPackages = originalRunBManifest.artifactIdentity.packages.map((
      packageEntry: Record<string, unknown> & { readonly tarballFile: string },
      index: number
    ) => {
      return index === 0
        ? { ...packageEntry, tarballSha256: sha256ForTest(rawMismatchBytes), tarballBytes: rawMismatchBytes.length }
        : packageEntry
    })
    const rawMismatchChecksums = createSha256Sums(rawMismatchPackages)
    const rawMismatchManifest = createArtifactManifest({
      ...originalRunBManifest.artifactIdentity,
      packages: rawMismatchPackages,
      sha256SumsSha256: sha256ForTest(rawMismatchChecksums)
    }, originalRunBManifest.runMetadata)

    writeFileSync(rawMismatchTarballPath, rawMismatchBytes)
    writeFileSync(runBChecksumPath, rawMismatchChecksums)
    writeFileSync(runBManifestPath, canonicalBytes(rawMismatchManifest))
    const rawMismatchResult = runArtifactCompare(
      fixture,
      runBDirectory,
      join(fixture.workspaceRoot, 'raw-mismatch-evidence')
    )

    expect(rawMismatchResult.status).not.toBe(0)
    expect(JSON.parse(rawMismatchResult.stdout)).toMatchObject({ status: 'failed', packages: 2 })

    writeFileSync(runBManifestPath, originalRunBManifestBytes)
    writeFileSync(runBChecksumPath, originalRunBChecksumBytes)
    const failedRunDirectory = join(fixture.workspaceRoot, 'failed-run')

    fixture.environment.JWORD_PHASE3_DIRECT_FAILURE = '1'
    const directFailure = runBuilder(fixture, canonicalBuilderArguments(fixture, failedRunDirectory))

    expect(directFailure.status).toBe(1)
    expect(directFailure.stdout).toBe('direct-stdout-sentinel\n')
    expect(directFailure.stderr).toBe('direct-stderr-sentinel\n{"status":"failed","error":"direct-vitest command failed, status: 23, signal: none, spawn error code: none"}\n')
    expect(existsSync(join(failedRunDirectory, 'test-report.json'))).toBe(false)
    expect(existsSync(join(failedRunDirectory, 'artifact-binding.json'))).toBe(false)
  } finally {
    rmSync(fixture.workspaceRoot, { recursive: true, force: true })
  }
}

/** 校验四个兼容入口只读同一 synthetic artifact manifest 且不调用 pack。 */
function verifyReleaseInventoryEntrypoints(): void {
  const fixture = createReleaseInventoryFixture()
  const scripts = [
    'tools/release/check-native-pack.mjs',
    'tools/release/check-gate5-commercial-pack.mjs',
    'tools/release/check-gate6-commercial-pack.mjs',
    'tools/release/gate7-release-dry-run.mjs'
  ]

  try {
    for (const script of scripts) {
      const result = spawnSync(process.execPath, [
        join(REPO_ROOT, script),
        '--artifact-manifest',
        fixture.manifestPath
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...fixture.environment,
          JWORD_PHASE3_ARTIFACT_MANIFEST: fixture.manifestPath
        }
      })

      assertCommandPassed(result, script)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'ok', mode: 'artifact', packCommands: 0 })
    }
    expect(existsSync(fixture.commandLog) ? readFileSync(fixture.commandLog, 'utf8') : '').toBe('')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 构造测试使用的固定 package inventory。 */
function createPackageInventory(
  name: string,
  tarballFile: string,
  tarballSha256: string,
  files: readonly { readonly path: string, readonly sha256: string, readonly bytes: number }[]
): Readonly<Record<string, unknown>> {
  return {
    name,
    version: '0.0.0',
    delivery: name.endsWith('native') ? 'npm-restricted' : 'npm-public',
    tarballFile,
    tarballSha256,
    tarballBytes: 11,
    packedManifestSha256: files.at(-1)?.sha256,
    payloadSha256: createPayloadSha256(files),
    files
  }
}

/** 构造测试使用的固定 artifact identity。 */
function createArtifactIdentity(
  packages: readonly Readonly<Record<string, unknown>>[],
  checksumBytes: Buffer
): ArtifactIdentityFixture {
  return {
    schemaVersion: 1,
    gitSha: '1'.repeat(40),
    lockfileSha256: HASH_A,
    contractSha256: HASH_B,
    builderSha256: HASH_C,
    environment: readPhase3Environment({ node: 'v20.19.0', npm: '11.9.0', pnpm: '9.14.2' }),
    sha256SumsSha256: sha256ForTest(checksumBytes),
    packages
  }
}

/** 计算测试期望使用的 SHA-256。 */
function sha256ForTest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 创建包含两个 JWord-like package 的 repo 外 clean Git fixture。 */
function createBuilderFixture(id: string): BuilderFixture {
  const workspaceRoot = mkdtempSync(join(tmpdir(), `jword-phase3-build-${id}-`))
  const root = join(workspaceRoot, 'repo')
  const sourceDirectory = join(workspaceRoot, 'source-report')
  const runDirectory = join(workspaceRoot, 'run-a')
  const commandLog = join(workspaceRoot, 'commands.log')
  const trackedFile = join(root, 'tracked.txt')
  const binDirectory = join(root, 'fixture-bin')
  const actualContract = JSON.parse(readFileSync(join(REPO_ROOT, 'tools/release/package-artifact-contract.json'), 'utf8'))
  const packages = actualContract.packages.filter(function selectFixturePackage(packageEntry: { readonly name: string }) {
    return packageEntry.name === '@4xian/jword-core' || packageEntry.name === '@4xian/jword-native'
  })

  mkdirSync(root, { recursive: true })
  mkdirSync(binDirectory, { recursive: true })
  writeFileSync(join(root, '.gitignore'), 'ignored-output/\npackages/*/dist/\n')
  writeFileSync(trackedFile, 'clean\n')
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: \'9.0\'\n')
  writeFileSync(join(root, 'package.json'), JSON.stringify({
    name: 'phase3-synthetic-builder-fixture',
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: { build: 'rollup -c && node tools/release/normalize-dist-relative-imports.mjs' }
  }))
  writeFixtureFile(root, 'tools/release/package-artifact-contract.json', JSON.stringify({
    ...actualContract,
    packages
  }))
  for (const path of [
    'rollup.config.mjs',
    'tools/release/build-phase3-artifacts.mjs',
    'tools/release/check-package-artifacts.mjs',
    'tools/release/normalize-dist-relative-imports.mjs',
    'tools/release/phase3-artifact-utils.mjs'
  ]) {
    writeFixtureFile(root, path, readFileSync(join(REPO_ROOT, path)))
  }
  for (const packageContract of packages) {
    const sourceDirectoryPath = join(REPO_ROOT, packageContract.workspacePath)
    const fixtureDirectoryPath = join(root, packageContract.workspacePath)

    writeFixtureFile(root, `${packageContract.workspacePath}/package.json`, readFileSync(join(sourceDirectoryPath, 'package.json')))
    if (packageContract.files.includes('README.md')) {
      writeFixtureFile(root, `${packageContract.workspacePath}/README.md`, readFileSync(join(sourceDirectoryPath, 'README.md')))
    }
    for (const fixturePath of packageContract.fixtureAllowlist) {
      writeFixtureFile(root, `${packageContract.workspacePath}/${fixturePath}`, readFileSync(join(sourceDirectoryPath, fixturePath)))
    }
    for (const exportEntry of packageContract.exports) {
      const targets = typeof exportEntry.target === 'string'
        ? [exportEntry.target]
        : [exportEntry.target.types, exportEntry.target.import]

      for (const target of targets) {
        const relativeTarget = target.replace(/^\.\//u, '')

        writeFixtureFile(fixtureDirectoryPath, relativeTarget, target.endsWith('.d.ts') ? 'export {}\n' : 'export {}\n')
      }
    }
  }

  writeFixtureCommands(binDirectory)
  writeFileSync(commandLog, '')
  runGit(root, ['init', '-q'])
  runGit(root, ['config', 'user.email', 'phase3-fixture@example.invalid'])
  runGit(root, ['config', 'user.name', 'Phase 3 Fixture'])
  runGit(root, ['add', '.'])
  runGit(root, ['commit', '-qm', 'fixture'])

  const homeDirectory = join(workspaceRoot, 'home')
  const temporaryDirectory = join(workspaceRoot, 'tmp')
  const npmCacheDirectory = join(workspaceRoot, 'npm-cache')
  const userConfig = join(workspaceRoot, '.npmrc')

  mkdirSync(homeDirectory)
  mkdirSync(temporaryDirectory)
  mkdirSync(npmCacheDirectory)
  writeFileSync(userConfig, 'registry=https://registry.npmjs.org/\n')

  return {
    workspaceRoot,
    root,
    sourceDirectory,
    runDirectory,
    commandLog,
    trackedFile,
    environment: {
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
      HOME: homeDirectory,
      TMPDIR: temporaryDirectory,
      LANG: 'C',
      CI: '1',
      NODE_OPTIONS: '--no-warnings',
      NPM_CONFIG_USERCONFIG: userConfig,
      NPM_CONFIG_CACHE: npmCacheDirectory,
      JWORD_PHASE3_COMMAND_LOG: commandLog,
      JWORD_PHASE3_TRACKED_FILE: trackedFile,
      JWORD_PHASE3_REAL_NPM: execFileSync('which', ['npm'], { encoding: 'utf8' }).trim()
    }
  }
}

/** 创建覆盖十二个 contract package 的只读 scanner inventory fixture。 */
function createReleaseInventoryFixture(): ReleaseInventoryFixture {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-release-inventory-'))
  const binDirectory = join(root, 'bin')
  const commandLog = join(root, 'commands.log')
  const contract = JSON.parse(readFileSync(join(REPO_ROOT, 'tools/release/package-artifact-contract.json'), 'utf8'))
  const packages = []

  mkdirSync(binDirectory)
  for (const command of ['npm', 'pnpm']) {
    const commandPath = join(binDirectory, command)

    writeFileSync(commandPath, '#!/bin/sh\nprintf \'%s %s\\n\' "$0" "$*" >> "$JWORD_PHASE3_PACK_COMMAND_LOG"\nexit 97\n')
    chmodSync(commandPath, 0o755)
  }
  writeFileSync(commandLog, '')

  for (const packageContract of contract.packages) {
    const id = packageContract.name.slice('@4xian/jword-'.length)
    const caseRoot = join(root, `package-${id}`)
    const packageRoot = join(caseRoot, 'package')
    const tarballFile = `${id}.tgz`
    const tarballPath = join(root, tarballFile)

    writeFixtureFile(packageRoot, 'package.json', JSON.stringify(createScannerPackedManifest(packageContract)))
    for (const exportEntry of packageContract.exports) {
      const targets = typeof exportEntry.target === 'string'
        ? [exportEntry.target]
        : [exportEntry.target.types, exportEntry.target.import]

      for (const target of targets) {
        writeFixtureFile(packageRoot, target.replace(/^\.\//u, ''), 'export {}\n')
      }
    }
    if (packageContract.files.includes('README.md')) {
      writeFixtureFile(packageRoot, 'README.md', '# Synthetic package\n')
    }
    for (const fixturePath of packageContract.fixtureAllowlist) {
      writeFixtureFile(packageRoot, fixturePath, readFileSync(join(REPO_ROOT, packageContract.workspacePath, fixturePath)))
    }

    const tarResult = spawnSync('tar', ['-czf', tarballPath, '-C', caseRoot, 'package'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, COPYFILE_DISABLE: '1' }
    })

    assertCommandPassed(tarResult, `create ${id} tarball`)
    packages.push({ name: packageContract.name, tarballFile })
  }

  const manifestPath = join(root, 'artifact-manifest.json')

  writeFileSync(manifestPath, JSON.stringify({ packages }))
  return {
    root,
    manifestPath,
    commandLog,
    environment: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
      JWORD_PHASE3_PACK_COMMAND_LOG: commandLog
    }
  }
}

/** 从机器 contract 创建 scanner 期望的 synthetic packed manifest。 */
function createScannerPackedManifest(packageContract: {
  readonly name: string
  readonly version: string
  readonly private: boolean
  readonly sourceAccess: string
  readonly files: readonly string[]
  readonly exports: readonly { readonly subpath: string, readonly target: unknown }[]
  readonly sideEffects: false | readonly string[]
  readonly dependencyPolicy: {
    readonly firstParty: readonly string[]
    readonly firstPartyPeers: readonly string[]
    readonly external: Readonly<Record<string, string>>
    readonly externalPeers: Readonly<Record<string, string>>
  }
}): Readonly<Record<string, unknown>> {
  const exports = Object.fromEntries(packageContract.exports.map(function readExportEntry(entry) {
    return [entry.subpath, entry.target]
  }))

  return {
    name: packageContract.name,
    version: packageContract.version,
    private: packageContract.private,
    type: 'module',
    publishConfig: { access: packageContract.sourceAccess },
    files: packageContract.files,
    exports,
    sideEffects: packageContract.sideEffects,
    dependencies: createScannerDependencies(
      packageContract.dependencyPolicy.firstParty,
      packageContract.dependencyPolicy.external,
      packageContract.version
    ),
    peerDependencies: createScannerDependencies(
      packageContract.dependencyPolicy.firstPartyPeers,
      packageContract.dependencyPolicy.externalPeers,
      packageContract.version
    )
  }
}

/** 生成 scanner 期望的 ASCII 排序 dependency map。 */
function createScannerDependencies(
  firstParty: readonly string[],
  external: Readonly<Record<string, string>>,
  version: string
): Readonly<Record<string, string>> {
  const dependencies = { ...external }

  for (const name of firstParty) {
    dependencies[name] = version
  }

  return Object.fromEntries(Object.entries(dependencies).sort())
}

/** 写入 fixture command wrappers，用实际 npm pack 和可注入污染的 fake pnpm。 */
function writeFixtureCommands(binDirectory: string): void {
  const pnpmScript = [
    '#!/bin/sh',
    'printf \'pnpm %s\\n\' "$*" >> "$JWORD_PHASE3_COMMAND_LOG"',
    'if [ "$*" = "exec vitest run --passWithNoTests" ]; then printf \'direct-node-options %s\\n\' "$NODE_OPTIONS" >> "$JWORD_PHASE3_COMMAND_LOG"; fi',
    'if [ "$1" = "--version" ]; then printf \'9.14.2\\n\'; exit 0; fi',
    'checkpoint=""',
    'case "$*" in',
    '  lint) checkpoint="lint" ;;',
    '  build) checkpoint="build" ;;',
    '  test:e2e:phase3) checkpoint="e2e" ;;',
    '  "exec vitest run --passWithNoTests") checkpoint="direct-vitest" ;;',
    'esac',
    'if [ "${JWORD_PHASE3_DIRTY_AFTER:-}" = "$checkpoint" ] && [ -n "$checkpoint" ]; then',
    '  printf \'dirty-%s\\n\' "$checkpoint" > "$JWORD_PHASE3_TRACKED_FILE"',
    'fi',
    'if [ "$*" = "exec vitest run --passWithNoTests" ] && [ "${JWORD_PHASE3_DIRECT_FAILURE:-}" = "1" ]; then',
    '  printf \'direct-stdout-sentinel\\n\'',
    '  printf \'direct-stderr-sentinel\\n\' >&2',
    '  exit 23',
    'fi',
    'exit 0',
    ''
  ].join('\n')
  const npmScript = [
    '#!/bin/sh',
    'printf \'npm %s\\n\' "$*" >> "$JWORD_PHASE3_COMMAND_LOG"',
    '"$JWORD_PHASE3_REAL_NPM" "$@"',
    'status=$?',
    'if [ "$status" -eq 0 ] && [ "${JWORD_PHASE3_DIRTY_AFTER:-}" = "pack" ]; then',
    '  case " $* " in',
    '    *" --dry-run "*) ;;',
    '    *" pack "*) printf \'dirty-pack\\n\' > "$JWORD_PHASE3_TRACKED_FILE" ;;',
    '  esac',
    'fi',
    'exit "$status"',
    ''
  ].join('\n')

  writeFileSync(join(binDirectory, 'pnpm'), pnpmScript)
  writeFileSync(join(binDirectory, 'npm'), npmScript)
  chmodSync(join(binDirectory, 'pnpm'), 0o755)
  chmodSync(join(binDirectory, 'npm'), 0o755)
}

/** 生成 synthetic canonical builder 的固定 CLI 参数。 */
function canonicalBuilderArguments(fixture: BuilderFixture, outputDirectory = fixture.runDirectory): readonly string[] {
  return [
    '--purpose', 'canonical',
    '--source-report', join(fixture.sourceDirectory, 'source-report.json'),
    '--source-report-sha256', join(fixture.sourceDirectory, 'source-report.json.sha256'),
    '--out-dir', outputDirectory
  ]
}

/** 在 fixture repo 内运行 builder，可选在固定 checkpoint 注入 tracked pollution。 */
function runBuilder(
  fixture: BuilderFixture,
  args: readonly string[],
  dirtyCheckpoint?: 'lint' | 'build' | 'pack' | 'e2e' | 'direct-vitest'
): SpawnSyncReturns<string> {
  const environment = { ...fixture.environment }

  if (dirtyCheckpoint !== undefined) {
    environment.JWORD_PHASE3_DIRTY_AFTER = dirtyCheckpoint
    environment.JWORD_PHASE3_DIRECT_FAILURE = dirtyCheckpoint === 'direct-vitest' ? '1' : '0'
  }

  return spawnSync(process.execPath, [BUILDER_PATH, ...args], {
    cwd: fixture.root,
    encoding: 'utf8',
    env: environment
  })
}

/** 通过公开命令行比较 run-a 与指定 run-b。 */
function runArtifactCompare(
  fixture: BuilderFixture,
  rightDirectory: string,
  evidenceDirectory: string
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [
    COMPARE_PATH,
    '--left',
    join(fixture.runDirectory, 'artifact-manifest.json'),
    '--left-binding',
    join(fixture.runDirectory, 'artifact-binding.json'),
    '--right',
    join(rightDirectory, 'artifact-manifest.json'),
    '--evidence-dir',
    evidenceDirectory
  ], { cwd: fixture.root, encoding: 'utf8', env: fixture.environment })
}

/** 在临时 fixture repo 内执行 Git 命令。 */
function runGit(root: string, args: readonly string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

/** 写入 fixture 相对文件并创建父目录。 */
function writeFixtureFile(root: string, relativePath: string, content: string | Buffer): void {
  const path = join(root, relativePath)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 断言子进程成功，否则附带稳定的 stdout/stderr 便于定位 fixture。 */
function assertCommandPassed(result: SpawnSyncReturns<string>, label: string): void {
  expect(result.status, `${label}\n${result.stdout}\n${result.stderr}`).toBe(0)
}

/** 枚举输出目录中的 tarball basename。 */
function listTarballs(directory: string): readonly string[] {
  return existsSync(directory)
    ? readdirSync(directory).filter(function isTarball(file) { return file.endsWith('.tgz') }).sort()
    : []
}

/** 构造精确 command matcher。 */
function matchesExactCommand(expected: string): (command: string) => boolean {
  /** 判断 command 是否逐字等于期望。 */
  return function matchesCommand(command: string): boolean {
    return command === expected
  }
}

/** 构造 command substring matcher。 */
function matchesCommandFragment(expected: string): (command: string) => boolean {
  /** 判断 command 是否包含固定片段。 */
  return function includesCommandFragment(command: string): boolean {
    return command.includes(expected)
  }
}

/** 判断 command 是否为非 dry-run 的真实 npm pack。 */
function matchesRealPackCommand(command: string): boolean {
  return command.startsWith('npm pack ') && !command.includes('--dry-run')
}
