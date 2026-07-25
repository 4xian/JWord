/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 检查点 1 的 CI、release evidence 与最终验证契约。
 * 边界：只使用 synthetic fixture，不生成 JWord run-a、不访问真实 registry。
 * 协作模块：第三阶段制品构建器、消费者、复现比较器、发布门禁与持续集成工作流。
 * 性能/安全约束：禁止 publish、dist-tag、git tag/push、仓库内 assembly 和隐式 build/pack fallback。
 * 实现说明：mutation 必须在同步更新外层 hash 后仍由语义校验稳定拒绝。
 */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

import { describe, expect, it } from 'vitest'

import {
  createReleaseReadiness
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/check-phase3-release-gates.mjs'
import {
  generatePhase3Provenance
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/generate-phase3-provenance.mjs'
import {
  generatePhase3Sbom
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/generate-phase3-sbom.mjs'
import {
  rehearsePhase3Rollback
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/rehearse-phase3-rollback.mjs'
import {
  canonicalBytes,
  createArtifactManifest,
  createPayloadSha256,
  createSha256Sums,
  readCurrentEnvironment,
  readGitIdentity,
  readPhase3Environment,
  sha256,
  sha256File,
  sourceCommandDefinitions
// @ts-expect-error -- 生产 .mjs helper 未提供 TypeScript 声明文件。
} from '../../tools/release/phase3-artifact-utils.mjs'
import {
  validateAssemblyEvidence,
  validateAssemblyAuditPayload,
  validateAssemblyDependencyEvidence,
  validateAssemblyPackageManifest,
  validateAssemblyRegistry,
  validateConsumerSourceEvidence,
  validateEvidenceManifest,
  validateFinalVerificationRecord,
  validatePhase3JobEnvironment,
  validatePhase3Provenance,
  validatePhase3Sbom,
  validateReproducibilityRoot,
  validateReleaseReadiness,
  validateRollbackEvidence,
  validateRunARepositoryContract,
  validateTarballPayload
// @ts-expect-error -- 生产 .mjs verifier 未提供 TypeScript 声明文件。
} from '../../tools/release/verify-phase3-final-evidence.mjs'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const B4_FILES = [
  'tools/release/check-phase3-release-gates.mjs',
  'tools/release/verify-phase3-final-evidence.mjs',
  'tools/release/phase3-assembly-dependencies.mjs',
  'tools/release/phase3-release-policy-utils.mjs',
  'tools/release/check-phase3-artifact-size.mjs',
  'tools/release/generate-phase3-sbom.mjs',
  'tools/release/generate-phase3-provenance.mjs',
  'tools/release/rehearse-phase3-rollback.mjs',
  'fixtures/release/rollback-state.json',
  'fixtures/release/release-policy.json'
] as const
type EvidenceMutation = (value: unknown) => void

/** 注册 B4 检查点 1 的最小 architecture feedback loop。 */
function runPhase3ReleaseGateSuite(): void {
  it('declares isolated CI jobs and fail-closed release entrypoints', verifyReleaseGateStructure)
  it('generates exact unsigned provenance, dual-root SBOM, readiness, and rollback evidence', verifyGeneratedPolicyEvidence)
  it('rejects semantic mutation after the evidence manifest hash is synchronized', verifySynchronizedSemanticMutation)
  it('rejects provenance, SBOM, assembly, readiness, and rollback mutations', verifyPolicyEvidenceMutations)
  it('recomputes synchronized run-b tarball mutations from raw bytes', verifyRunBRawBytesMutation)
  it('rejects tarball entries omitted from the artifact inventory', verifyTarballInventoryMutation)
  it('binds run-a identity to contract bytes, builder hash, and package mapping', verifyRunARepositoryContract)
  it('rejects missing, extra, and symlink evidence entries', verifyEvidenceRootMutations)
  it('rejects non-canonical final records and SHA-256 sidecars', verifyFinalRecordBytes)
  it('rebuilds consumer sources and assembly manifests from frozen inputs', verifyFrozenSourceAndAssemblyInputs)
  it('rejects synchronized assembly registry order, allowlist, and metadata mutations', verifyAssemblyRegistryMutations)
  it('checks the current Git and lock identity in job environment mode', verifyJobEnvironmentIdentity)
  it('disables visual and Gate 2 build fallback in artifact mode', verifyArtifactModeBuildBoundary)
}

describe('Phase 3 release gates', runPhase3ReleaseGateSuite)

/** 从 workflow 文本读取一个顶层 job block。 */
function readWorkflowJob(workflow: string, job: string): string {
  const start = workflow.indexOf(`\n  ${job}:`)
  if (start === -1) throw new Error(`workflow job is missing: ${job}`)
  const remainder = workflow.slice(start + 1)
  const next = remainder.slice(1).search(/\n {2}[a-z][a-z-]+:\n/u)
  return next === -1 ? remainder : remainder.slice(0, next + 1)
}

/** 锁定批准文件、CI job/handoff 和无真实发布副作用边界。 */
function verifyReleaseGateStructure(): void {
  for (const path of B4_FILES) expect(existsSync(resolve(REPO_ROOT, path)), path).toBe(true)

  const workflow = readFileSync(resolve(REPO_ROOT, '.github/workflows/ci.yml'), 'utf8')
  const packageJson = readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8')
  const releaseGateSource = readFileSync(resolve(REPO_ROOT, 'tools/release/check-phase3-release-gates.mjs'), 'utf8')
  for (const text of [
    'workflow_dispatch:',
    'source-gates:',
    'artifact-build:',
    'artifact-consumers:',
    'artifact-audit:',
    'artifact-reproducibility:',
    'artifact-final:',
    'github.sha',
    'source-report',
    'run-a',
    'consumer-evidence',
    'audit-evidence',
    'reproducibility-evidence',
    'final-evidence'
  ]) expect(workflow).toContain(text)
  for (const script of ['phase3:consumer', 'phase3:release', 'phase3:verify']) {
    expect(packageJson).toContain(`"${script}"`)
  }

  const releaseSources = B4_FILES
    .filter((path) => path.endsWith('.mjs'))
    .map((path) => readFileSync(resolve(REPO_ROOT, path), 'utf8'))
    .join('\n')
  expect(releaseSources).not.toMatch(/(?:npm|pnpm)\s+(?:publish|dist-tag)|git\s+(?:tag|push)/u)
  expect(workflow.match(/ref: \$\{\{ github\.sha \}\}/gu)).toHaveLength(6)
  expect(workflow.match(/pnpm install --frozen-lockfile/gu)).toHaveLength(6)
  expect(workflow.match(/playwright install --with-deps chromium firefox webkit/gu)).toHaveLength(2)
  expect(workflow.match(/GITHUB_STEP_SUMMARY/gu)).toHaveLength(6)
  expect(workflow.match(/--check-environment/gu)).toHaveLength(5)
  expect(workflow.match(/RUNNER_TEMP.*GITHUB_WORKSPACE/gu)).toHaveLength(6)
  expect(workflow.match(/git status --porcelain=v1 -z --untracked-files=all/gu)).toHaveLength(14)
  for (const job of ['artifact-consumers', 'artifact-audit']) {
    const jobSource = readWorkflowJob(workflow, job)
    expect(jobSource.match(/uses: actions\/upload-artifact@v4/gu)).toHaveLength(1)
    expect(jobSource).toMatch(/name: (?:consumer|audit)-evidence[\s\S]*path:[^\n]+[\s\S]*include-hidden-files: true/u)
    expect(jobSource.indexOf('Download run-a')).toBeLessThan(jobSource.indexOf('Upload '))
  }
  expect(releaseGateSource).toContain('createCleanConsumerEnvironment')
  expect(releaseGateSource).not.toContain('...process.env')
  expect(releaseGateSource).toContain('validateConsumerRoot(options.consumerRoot, artifact, contract)')
  expect(releaseGateSource).not.toContain('validateConsumerInput')
}

/** 锁定 provenance、双 assembly SBOM、readiness 与 rollback 的固定语义。 */
function verifyGeneratedPolicyEvidence(): void {
  const hash = 'a'.repeat(64)
  const manifest = createSyntheticManifest(hash)
  const provenance = generatePhase3Provenance(manifest, hash, 'b'.repeat(64))

  expect(provenance._type).toBe('https://in-toto.io/Statement/v1')
  expect(provenance.predicateType).toBe('https://slsa.dev/provenance/v1')
  expect(provenance.subject).toHaveLength(12)
  expect(provenance).not.toHaveProperty('signed')
  expect(provenance).not.toHaveProperty('signature')
  expect(provenance.predicate.buildDefinition.resolvedDependencies).toHaveLength(4)
  expect(provenance.predicate.runDetails.byproducts).toHaveLength(2)

  const customerList = [{ name: 'customer-root', version: '0.0.0', dependencies: {
    '@4xian/jword-core': { name: '@4xian/jword-core', version: '0.0.0' }
  } }]
  const serverList = [{ name: 'server-root', version: '0.0.0', dependencies: {
    '@4xian/jword-collab-server': { name: '@4xian/jword-collab-server', version: '0.0.0' }
  } }]
  const sbom = generatePhase3Sbom({
    artifactSetId: hash,
    firstPartyPackages: [
      { name: '@4xian/jword-core', tarballSha256: hash },
      { name: '@4xian/jword-collab-server', tarballSha256: 'b'.repeat(64) }
    ],
    customerList,
    serverList,
    customerLockSha256: hash,
    serverLockSha256: hash,
    customerListSha256: hash,
    serverListSha256: hash
  })
  const packageIds = sbom.packages.map((entry: { readonly SPDXID: string }) => entry.SPDXID)
  expect(packageIds).toContain('SPDXRef-Assembly-customer-production')
  expect(packageIds).toContain('SPDXRef-Assembly-server-image')
  expect(sbom.relationships.some((entry: { readonly spdxElementId: string }) => entry.spdxElementId === 'SPDXRef-Assembly-customer-production')).toBe(true)
  expect(sbom.relationships.some((entry: { readonly spdxElementId: string }) => entry.spdxElementId === 'SPDXRef-Assembly-server-image')).toBe(true)
  expect(sbom.packages.filter((entry: { readonly checksums?: readonly unknown[] }) => entry.checksums !== undefined)).toHaveLength(2)

  const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tools/release/package-artifact-contract.json'), 'utf8'))
  const rootManifest = JSON.parse(readFileSync(resolve(REPO_ROOT, 'package.json'), 'utf8'))
  const policy = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/release/release-policy.json'), 'utf8'))
  const readiness = createReleaseReadiness(contract, rootManifest)
  expect(() => validateReleaseReadiness(readiness, contract, policy)).not.toThrow()
  const incompleteContract = { ...contract, packages: contract.packages.slice(1) }
  expect(() => createReleaseReadiness(incompleteContract, rootManifest)).toThrow('release policy input is invalid')
  const prior = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/release/rollback-state.json'), 'utf8'))
  const rollbackRoot = mkdtempSync(join(tmpdir(), 'jword-phase3-rollback-test-'))
  const rollback = rehearsePhase3Rollback(prior, hash, rollbackRoot)
  expect(() => validateRollbackEvidence(rollback)).not.toThrow()
  expect(rollback.realRegistryOperations).toBe('disabled')
  expect(rollback.healthCheck).toEqual({ status: 'failed', reason: 'candidate-channel-is-next' })
  expect(rollback.candidateCleared).toBe(true)
  expect(existsSync(join(rollbackRoot, 'candidate-channel.json'))).toBe(false)
  expect(readFileSync(join(rollbackRoot, 'channel-pointer.json'))).toEqual(canonicalBytes(prior))
  rmSync(rollbackRoot, { recursive: true, force: true })
}

/** 证明同步更新 evidence manifest 后，语义 mutation 仍会失败。 */
function verifySynchronizedSemanticMutation(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-audit-mutation-'))

  try {
    const readiness = createReleaseReadiness()
    writeFileSync(join(root, 'readiness-evidence.json'), canonicalBytes(readiness))
    writeEvidenceManifestFixture(root)
    expect(() => validateEvidenceManifest(root, 'audit')).not.toThrow()
    readiness.checks[0].reason = ''
    writeFileSync(join(root, 'readiness-evidence.json'), canonicalBytes(readiness))
    writeEvidenceManifestFixture(root)
    expect(() => validateEvidenceManifest(root, 'audit')).not.toThrow()
    expect(() => validateReleaseReadiness(readiness)).toThrow('release readiness evidence is invalid')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 证明五类 release evidence 的固定语义不能靠同步外层 hash 绕过。 */
function verifyPolicyEvidenceMutations(): void {
  const hash = 'a'.repeat(64)
  const manifest = createSyntheticManifest(hash)
  const checksumHash = 'b'.repeat(64)
  const provenance = generatePhase3Provenance(manifest, hash, checksumHash)
  const customerList = [{ name: 'customer-root', version: '0.0.0', dependencies: {
    '@4xian/jword-core': { name: '@4xian/jword-core', version: '0.0.0' }
  } }]
  const serverList = [{ name: 'server-root', version: '0.0.0', dependencies: {
    '@4xian/jword-collab-server': { name: '@4xian/jword-collab-server', version: '0.0.0' }
  } }]
  const sbomInput = {
    artifactSetId: hash,
    customerList,
    serverList,
    customerLockSha256: hash,
    serverLockSha256: hash,
    customerListSha256: hash,
    serverListSha256: hash
  }
  const sbom = generatePhase3Sbom(sbomInput)

  expect(() => validatePhase3Provenance(provenance, manifest, hash, checksumHash)).not.toThrow()
  expect(() => validatePhase3Sbom(sbom, sbomInput)).not.toThrow()
  const provenanceMutations: readonly EvidenceMutation[] = [
    (value) => setEvidenceValue(value, ['_type'], 'invalid'),
    (value) => setEvidenceValue(value, ['predicateType'], 'invalid'),
    (value) => setEvidenceValue(value, ['subject'], []),
    (value) => setEvidenceValue(value, ['predicate', 'buildDefinition', 'resolvedDependencies'], []),
    (value) => setEvidenceValue(value, ['predicate', 'runDetails'], {}),
    (value) => setEvidenceValue(value, ['signature'], 'forbidden')
  ]
  for (const mutate of provenanceMutations) {
    const mutation = structuredClone(provenance)
    mutate(mutation)
    expect(() => validatePhase3Provenance(mutation, manifest, hash, checksumHash)).toThrow('provenance mismatch')
  }
  const sbomMutations: readonly EvidenceMutation[] = [
    (value) => setEvidenceValue(value, ['packages'], []),
    (value) => setEvidenceValue(value, ['relationships'], []),
    (value) => setEvidenceValue(value, ['documentNamespace'], 'urn:invalid'),
    (value) => setEvidenceValue(value, ['packages', 0, 'externalRefs'], []),
    (value) => setEvidenceValue(value, ['signature'], 'forbidden')
  ]
  for (const mutate of sbomMutations) {
    const mutation = structuredClone(sbom)
    mutate(mutation)
    expect(() => validatePhase3Sbom(mutation, sbomInput)).toThrow('SBOM mismatch')
  }

  const assembly = createSyntheticAssemblyEvidence(hash)
  expect(() => validateAssemblyEvidence(assembly, 'customer', 'customer-production', hash)).not.toThrow()
  const assemblyMutations: readonly EvidenceMutation[] = [
    (value) => setEvidenceValue(value, ['schemaVersion'], 2),
    (value) => setEvidenceValue(value, ['artifactSetId'], 'b'.repeat(64)),
    (value) => setEvidenceValue(value, ['assemblyKind'], 'server-image'),
    (value) => reverseEvidenceArray(value, ['dependencies']),
    (value) => setEvidenceValue(value, ['dependencies'], []),
    (value) => setEvidenceValue(value, ['dependencies', 0, 'name'], ''),
    (value) => setEvidenceValue(value, ['extra'], true)
  ]
  for (const mutate of assemblyMutations) {
    const mutation = structuredClone(assembly)
    mutate(mutation)
    expect(() => validateAssemblyEvidence(mutation, 'customer', 'customer-production', hash)).toThrow()
  }
  const requiredDependencies = { '@4xian/jword-core': '0.0.0', typescript: '5.9.3' }
  const typescriptPath = join(tmpdir(), 'jword-phase3-synthetic', 'node_modules', '.pnpm', 'typescript@5.9.3', 'node_modules', 'typescript')
  const assemblyLockfile = "snapshots:\n  '@4xian/jword-core@0.0.0': {}\n  'typescript@5.9.3': {}\n"
  const repositoryLockfile = "snapshots:\n  'typescript@5.9.3': {}\n"
  const dependencyList = [{ dependencies: {
    '@4xian/jword-core': { version: '0.0.0', path: realpathSync(tmpdir()) },
    typescript: { version: '5.9.3', path: typescriptPath }
  } }]
  expect(() => validateAssemblyDependencyEvidence(dependencyList, assembly.dependencies, [], requiredDependencies, 'customer', assemblyLockfile, undefined, repositoryLockfile)).not.toThrow()
  expect(() => validateAssemblyDependencyEvidence([], [], [], requiredDependencies, 'customer', assemblyLockfile, undefined, repositoryLockfile)).toThrow('customer required dependency is missing')
  expect(() => validateAssemblyAuditPayload({ metadata: { vulnerabilities: { high: 0, critical: 0 } } }, 'customer')).not.toThrow()
  expect(() => validateAssemblyAuditPayload({}, 'customer')).toThrow('customer audit payload is invalid')

  const linkRoot = mkdtempSync(join(tmpdir(), 'jword-phase3-repo-link-'))
  const repoLink = join(linkRoot, 'repo-link')
  try {
    symlinkSync(REPO_ROOT, repoLink)
    expect(() => validateAssemblyDependencyEvidence([{ dependencies: {
      '@4xian/jword-core': { version: '0.0.0', path: repoLink },
      typescript: { version: '5.9.3', path: typescriptPath }
    } }], assembly.dependencies, [], requiredDependencies, 'customer', assemblyLockfile, undefined, repositoryLockfile)).toThrow('customer dependency list path is invalid')
  } finally {
    rmSync(linkRoot, { recursive: true, force: true })
  }

  const readiness = createReleaseReadiness()
  const contract = JSON.parse(readFileSync(resolve(REPO_ROOT, 'tools/release/package-artifact-contract.json'), 'utf8'))
  const policy = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/release/release-policy.json'), 'utf8'))
  const readinessMutations: readonly EvidenceMutation[] = [
    (value) => setEvidenceValue(value, ['ownerStatus'], 'passed'),
    (value) => setEvidenceValue(value, ['status'], 'blocked'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'action'], 'publish'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'target'], 'registry'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'execution'], 'ran'),
    (value) => setEvidenceValue(value, ['checks', 0, 'status'], 'blocked-as-expected'),
    (value) => setEvidenceValue(value, ['checks', 0, 'reason'], ''),
    (value) => (value as { checks: unknown[] }).checks.pop(),
    (value) => {
      const checks = (value as { checks: unknown[] }).checks
      const first = checks[0]
      if (first === undefined) throw new Error('synthetic readiness check is missing')
      checks.push(structuredClone(first))
    },
    (value) => (value as { checks: unknown[] }).checks.push({ id: 'unknown-check', status: 'passed', reason: 'unexpected' })
  ]
  for (const mutate of readinessMutations) {
    const mutation = structuredClone(readiness)
    mutate(mutation)
    expect(() => validateReleaseReadiness(mutation)).toThrow()
  }
  const swappedContract = structuredClone(contract)
  const publicPackage = swappedContract.packages.find((entry: { registryIntent: string }) => entry.registryIntent === 'public')
  const restrictedPackage = swappedContract.packages.find((entry: { registryIntent: string }) => entry.registryIntent === 'restricted')
  if (publicPackage === undefined || restrictedPackage === undefined) throw new Error('synthetic registry layers are incomplete')
  publicPackage.registryIntent = 'restricted'
  restrictedPackage.registryIntent = 'public'
  expect(() => validateReleaseReadiness(readiness, swappedContract, policy)).toThrow()

  const prior = JSON.parse(readFileSync(resolve(REPO_ROOT, 'fixtures/release/rollback-state.json'), 'utf8'))
  const rollback = rehearsePhase3Rollback(prior, hash)
  const rollbackMutations: readonly EvidenceMutation[] = [
    (value) => setEvidenceValue(value, ['ownerStatus'], 'passed'),
    (value) => setEvidenceValue(value, ['status'], 'blocked'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'action'], 'publish'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'target'], 'registry'),
    (value) => setEvidenceValue(value, ['commandPlan', 0, 'execution'], 'ran'),
    (value) => setEvidenceValue(value, ['realRegistryOperations'], 'enabled'),
    (value) => setEvidenceValue(value, ['healthCheck', 'status'], 'passed'),
    (value) => setEvidenceValue(value, ['candidateCleared'], false),
    (value) => setEvidenceValue(value, ['rolledBackSha256'], readEvidenceValue(value, ['promotedSha256']))
  ]
  for (const mutate of rollbackMutations) {
    const mutation = structuredClone(rollback)
    mutate(mutation)
    expect(() => validateRollbackEvidence(mutation)).toThrow()
  }
}

/** 证明同步更新所有 run-b 摘要后仍会与 run-a 原始 bytes 交叉失败。 */
function verifyRunBRawBytesMutation(): void {
  const fixture = createSyntheticReproducibilityFixture()

  try {
    expect(() => validateReproducibilityRoot(fixture.reproducibilityRoot, fixture.runA)).not.toThrow()
    const comparisonPath = join(fixture.reproducibilityRoot, 'comparison-evidence.json')
    const duplicateComparison = {
      ...fixture.comparison,
      packages: [fixture.comparison.packages[0], fixture.comparison.packages[0]]
    }
    writeFileSync(comparisonPath, canonicalBytes(duplicateComparison))
    writeEvidenceManifestFixture(fixture.reproducibilityRoot, 'reproducibility')
    expect(() => validateReproducibilityRoot(fixture.reproducibilityRoot, fixture.runA)).toThrow()

    const tupleMutation = {
      ...fixture.comparison,
      tuple: { ...fixture.comparison.tuple, builderSha256: 'e'.repeat(64) }
    }
    writeFileSync(comparisonPath, canonicalBytes(tupleMutation))
    writeEvidenceManifestFixture(fixture.reproducibilityRoot, 'reproducibility')
    expect(() => validateReproducibilityRoot(fixture.reproducibilityRoot, fixture.runA)).toThrow()

    writeFileSync(comparisonPath, canonicalBytes(fixture.comparison))
    writeEvidenceManifestFixture(fixture.reproducibilityRoot, 'reproducibility')
    const tarballPath = join(fixture.reproducibilityRoot, 'run-b-tarballs', fixture.packageEntry.tarballFile)
    const mutatedTarball = Buffer.concat([readFileSync(tarballPath), gzipSync(Buffer.alloc(0))])
    writeFileSync(tarballPath, mutatedTarball)
    const mutatedPackage = {
      ...fixture.packageEntry,
      tarballBytes: mutatedTarball.byteLength,
      tarballSha256: sha256(mutatedTarball)
    }
    const checksumBytes = createSha256Sums([mutatedPackage])
    const mutatedIdentity = {
      ...fixture.manifest.artifactIdentity,
      packages: [mutatedPackage],
      sha256SumsSha256: sha256(checksumBytes)
    }
    const mutatedManifest = createArtifactManifest(mutatedIdentity, fixture.manifest.runMetadata)
    const comparison = {
      ...fixture.comparison,
      rightArtifactSetId: mutatedManifest.artifactSetId,
      packages: [{
        name: fixture.packageEntry.name,
        leftTarballSha256: fixture.packageEntry.tarballSha256,
        rightTarballSha256: mutatedPackage.tarballSha256,
        match: true
      }]
    }
    writeFileSync(join(fixture.reproducibilityRoot, 'run-b-artifact-manifest.json'), canonicalBytes(mutatedManifest))
    writeFileSync(join(fixture.reproducibilityRoot, 'run-b-SHA256SUMS'), checksumBytes)
    writeFileSync(comparisonPath, canonicalBytes(comparison))
    writeEvidenceManifestFixture(fixture.reproducibilityRoot, 'reproducibility')

    expect(() => validateReproducibilityRoot(fixture.reproducibilityRoot, fixture.runA)).toThrow()
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 证明同步更新tarball raw hash后，未列出的archive entry仍会失败。 */
function verifyTarballInventoryMutation(): void {
  const fixture = createSyntheticReproducibilityFixture()

  try {
    expect(() => validateTarballPayload(join(fixture.reproducibilityRoot, 'run-b-tarballs'), fixture.packageEntry)).not.toThrow()
    writeFileSync(join(fixture.packageRoot, 'extra.txt'), 'unlisted')
    execFileSync('tar', ['-czf', fixture.tarballPath, '-C', fixture.stagingRoot, 'package'])
    const bytes = readFileSync(fixture.tarballPath)
    const entry = { ...fixture.packageEntry, tarballBytes: bytes.byteLength, tarballSha256: sha256(bytes) }
    expect(() => validateTarballPayload(join(fixture.reproducibilityRoot, 'run-b-tarballs'), entry)).toThrow('tarball file set mismatch')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 锁定 run-a identity 与当前 contract/builder/package mapping 的绑定。 */
function verifyRunARepositoryContract(): void {
  const fixture = createSyntheticReproducibilityFixture()

  try {
    const contract = { packages: [{
      name: fixture.packageEntry.name,
      version: fixture.packageEntry.version,
      delivery: fixture.packageEntry.delivery
    }] }
    const contractBytes = canonicalBytes(contract)
    const builderHash = fixture.manifest.artifactIdentity.builderSha256
    const identity = {
      ...fixture.manifest.artifactIdentity,
      contractSha256: sha256(contractBytes)
    }
    const manifest = createArtifactManifest(identity, fixture.manifest.runMetadata)
    expect(() => validateRunARepositoryContract(manifest, contractBytes, contract, builderHash)).not.toThrow()

    const mutations = [
      { ...identity, contractSha256: 'e'.repeat(64) },
      { ...identity, builderSha256: 'e'.repeat(64) },
      { ...identity, packages: [{ ...fixture.packageEntry, delivery: 'npm-restricted' }] }
    ]
    for (const mutation of mutations) {
      const mutatedManifest = createArtifactManifest(mutation, fixture.manifest.runMetadata)
      expect(() => validateRunARepositoryContract(mutatedManifest, contractBytes, contract, builderHash)).toThrow()
    }
    const renamedContract = { packages: [{ ...contract.packages[0], name: '@4xian/jword-other' }] }
    const renamedBytes = canonicalBytes(renamedContract)
    const renamedManifest = createArtifactManifest({ ...identity, contractSha256: sha256(renamedBytes) }, fixture.manifest.runMetadata)
    expect(() => validateRunARepositoryContract(renamedManifest, renamedBytes, renamedContract, builderHash)).toThrow()
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 证明 handoff root 对缺失、额外文件和 symlink 一律 fail closed。 */
function verifyEvidenceRootMutations(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-root-mutation-'))
  const evidencePath = join(root, 'readiness-evidence.json')

  try {
    writeFileSync(evidencePath, canonicalBytes(createReleaseReadiness()))
    writeEvidenceManifestFixture(root)
    expect(() => validateEvidenceManifest(root, 'audit')).not.toThrow()

    const manifestPath = join(root, 'evidence-manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    expect(() => validateEvidenceManifest(root, 'audit')).toThrow('audit evidence manifest bytes are not canonical')
    writeEvidenceManifestFixture(root)

    writeFileSync(join(root, 'extra.json'), '{}')
    expect(() => validateEvidenceManifest(root, 'audit')).toThrow('audit evidence manifest file set mismatch')
    rmSync(join(root, 'extra.json'))

    rmSync(evidencePath)
    expect(() => validateEvidenceManifest(root, 'audit')).toThrow('audit evidence manifest file set mismatch')
    writeFileSync(evidencePath, canonicalBytes(createReleaseReadiness()))
    writeEvidenceManifestFixture(root)

    symlinkSync(evidencePath, join(root, 'linked-evidence.json'))
    expect(() => validateEvidenceManifest(root, 'audit')).toThrow('evidence symlink is forbidden')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 锁定 final record 与 sidecar 的逐字节 canonical 契约。 */
function verifyFinalRecordBytes(): void {
  const record = { schemaVersion: 1, artifactSetId: 'a'.repeat(64), status: 'passed' }
  const recordBytes = canonicalBytes(record)
  const sidecar = Buffer.from(`${sha256(recordBytes)}\n`)

  expect(() => validateFinalVerificationRecord(recordBytes, sidecar, record)).not.toThrow()
  for (const mutation of [
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), sidecar]),
    Buffer.from(`${sha256(recordBytes)}\r\n`),
    Buffer.from(` ${sha256(recordBytes)}\n`),
    Buffer.from(`${sha256(recordBytes)} \n`),
    Buffer.from(sha256(recordBytes)),
    Buffer.from(`${sha256(recordBytes)}\n\n`),
    Buffer.from(`${sha256(recordBytes)}  final-verification.json\n`)
  ]) {
    expect(() => validateFinalVerificationRecord(recordBytes, mutation, record)).toThrow('final verification sidecar bytes are invalid')
  }

  const formattedRecord = Buffer.from(`${JSON.stringify(record, null, 2)}\n`)
  const formattedSidecar = Buffer.from(`${sha256(formattedRecord)}\n`)
  expect(() => validateFinalVerificationRecord(formattedRecord, formattedSidecar, record)).toThrow('final verification record bytes are invalid')
}

/** 证明 consumer source 与 assembly manifest 不能由同步 hash 掩盖。 */
function verifyFrozenSourceAndAssemblyInputs(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-frozen-input-'))
  const sourcePath = join(root, 'raw/sources/node-probe/probe.js')
  const sources = { 'node-probe': { extension: 'js', files: {}, source: 'export const value = 1\n' } }
  const dependencies = { '@4xian/jword-core': '0.0.0', yjs: '13.6.30' }
  const manifest = {
    name: 'jword-phase3-customer-production',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies
  }

  try {
    mkdirSync(resolve(sourcePath, '..'), { recursive: true })
    writeFileSync(sourcePath, sources['node-probe'].source)
    expect(() => validateConsumerSourceEvidence(root, sources)).not.toThrow()
    writeFileSync(sourcePath, 'export const value = 2\n')
    expect(() => validateConsumerSourceEvidence(root, sources)).toThrow('consumer source mismatch')

    expect(() => validateAssemblyPackageManifest(manifest, 'customer-production', dependencies)).not.toThrow()
    expect(() => validateAssemblyPackageManifest({ ...manifest, dependencies: { ...dependencies, yjs: '13.6.29' } }, 'customer-production', dependencies)).toThrow('assembly package manifest mismatch')
    expect(() => validateAssemblyPackageManifest({ ...manifest, extra: true }, 'customer-production', dependencies)).toThrow('assembly package manifest mismatch')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 证明 assembly registry 的顺序、allowlist 与metadata语义不能靠同步hash绕过。 */
function verifyAssemblyRegistryMutations(): void {
  const fixture = createSyntheticAssemblyRegistryFixture()

  try {
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).not.toThrow()

    const reversedRegistry = structuredClone(fixture.registry)
    reversedRegistry.servedPackages.reverse()
    fixture.writeRegistry(reversedRegistry)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry package set mismatch')
    fixture.writeRegistry(fixture.registry)

    const offlistTranscript = structuredClone(fixture.transcript)
    const offlistRequest = offlistTranscript.requests[0]
    if (offlistRequest === undefined) throw new Error('synthetic metadata request is missing')
    offlistRequest.path = '/@4xian%2Fnot-served'
    fixture.writeTranscript(offlistTranscript)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry transcript is invalid')
    fixture.writeTranscript(fixture.transcript)

    const metadataTranscript = structuredClone(fixture.transcript)
    const metadataRegistry = structuredClone(fixture.registry)
    const metadataRequest = metadataTranscript.requests[0]
    const servedPackage = metadataRegistry.servedPackages[0]
    if (metadataRequest === undefined || servedPackage === undefined || typeof metadataRequest.responsePath !== 'string') {
      throw new Error('synthetic metadata fixture is incomplete')
    }
    const metadata = JSON.parse(readFileSync(join(fixture.root, metadataRequest.responsePath), 'utf8'))
    metadata.versions['0.0.0'].dist.tarball = 'https://registry.npmjs.org/forbidden.tgz'
    const metadataBytes = canonicalBytes(metadata)
    const metadataSha256 = sha256(metadataBytes)
    metadataRequest.responsePath = `registry-responses/${metadataSha256}.bin`
    metadataRequest.responseSha256 = metadataSha256
    metadataRequest.responseBytes = metadataBytes.byteLength
    servedPackage.metadataPath = metadataRequest.responsePath
    servedPackage.metadataSha256 = metadataSha256
    servedPackage.metadataBytes = metadataBytes.byteLength
    writeFileSync(join(fixture.root, metadataRequest.responsePath), metadataBytes)
    fixture.writeTranscript(metadataTranscript)
    fixture.writeRegistry(metadataRegistry)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry response bytes are invalid')
    fixture.writeRegistry(fixture.registry)
    fixture.writeTranscript(fixture.transcript)

    const firstServed = fixture.registry.servedPackages[0]
    const secondServed = fixture.registry.servedPackages[1]
    if (firstServed === undefined || secondServed === undefined) throw new Error('synthetic served packages are incomplete')
    const lockfile = fixture.registry.servedPackages.map((entry: { name: string, version: string, tarballIntegrity: string }) => `  '${entry.name}@${entry.version}':\n    resolution: {integrity: ${entry.tarballIntegrity}}`).join('\n')
    const crossBlockLockfile = `lockfileVersion: '9.0'\n\npackages:\n  '${firstServed.name}@${firstServed.version}':\n    resolution: {integrity: sha512-invalid-integrity}\n  '${secondServed.name}@${secondServed.version}':\n    resolution: {integrity: ${secondServed.tarballIntegrity}}\n  'unrelated@1.0.0':\n    resolution: {integrity: ${firstServed.tarballIntegrity}}\n`
    writeFileSync(join(fixture.root, 'pnpm-lock.yaml'), crossBlockLockfile)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry package bytes are invalid')
    writeFileSync(join(fixture.root, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n${lockfile}\n`)
    const wrongIntegrity = readFileSync(join(fixture.root, 'pnpm-lock.yaml'), 'utf8').replace(firstServed.tarballIntegrity, 'sha512-invalid-integrity')
    writeFileSync(join(fixture.root, 'pnpm-lock.yaml'), wrongIntegrity)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry package bytes are invalid')
    writeFileSync(join(fixture.root, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n${lockfile}\n`)

    const replacedGet = structuredClone(fixture.transcript)
    const firstMetadata = replacedGet.requests[0]
    const secondMetadata = replacedGet.requests[2]
    if (firstMetadata === undefined || secondMetadata === undefined || typeof firstMetadata.responsePath !== 'string' ||
        typeof firstMetadata.responseSha256 !== 'string' || typeof firstMetadata.responseBytes !== 'number') throw new Error('synthetic metadata GETs are incomplete')
    secondMetadata.responsePath = firstMetadata.responsePath
    secondMetadata.responseSha256 = firstMetadata.responseSha256
    secondMetadata.responseBytes = firstMetadata.responseBytes
    fixture.writeTranscript(replacedGet)
    expect(() => validateAssemblyRegistry(fixture.root, fixture.expectedNames, fixture.runA)).toThrow('assembly registry response bytes are invalid')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 证明 job environment 校验同时绑定当前 checkout 与 lockfile。 */
function verifyJobEnvironmentIdentity(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-job-environment-'))
  const reportPath = join(root, 'source-report.json')
  const identity = readGitIdentity(REPO_ROOT)
  const report = {
    schemaVersion: 1,
    clean: true,
    gitSha: identity.gitSha,
    lockfileSha256: sha256File(join(REPO_ROOT, 'pnpm-lock.yaml')),
    environment: readCurrentEnvironment(REPO_ROOT),
    commands: sourceCommandDefinitions().map(function createCommand(definition: { readonly id: string, readonly command: string }) {
      return { ...definition, exitCode: 0, status: 'passed' }
    })
  }

  try {
    writeFileSync(reportPath, canonicalBytes(report))
    expect(() => validatePhase3JobEnvironment(reportPath, undefined)).not.toThrow()
    writeFileSync(reportPath, canonicalBytes({ ...report, gitSha: 'c'.repeat(40) }))
    expect(() => validatePhase3JobEnvironment(reportPath, undefined)).toThrow('job repository identity mismatch')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 锁定 artifact manifest 模式缺少 canonical dist 时直接失败。 */
function verifyArtifactModeBuildBoundary(): void {
  const visualSource = readFileSync(resolve(REPO_ROOT, 'tools/visual/run-visual.mjs'), 'utf8')
  const gate2Source = readFileSync(resolve(REPO_ROOT, 'tests/gate2-fixture.test.ts'), 'utf8')

  for (const source of [visualSource, gate2Source]) {
    expect(source).toContain('JWORD_PHASE3_ARTIFACT_MANIFEST')
    expect(source).toContain('packages/core/dist/index.js')
  }
  expect(visualSource).toMatch(/if \(manifestPath !== undefined\) \{[\s\S]*?requires canonical core dist[\s\S]*?return import/u)
  expect(gate2Source).toMatch(/if \(process\.env\.JWORD_PHASE3_ARTIFACT_MANIFEST !== undefined\) \{[\s\S]*?requires packages\/core\/dist\/index\.js[\s\S]*?\}/u)
  expect(visualSource.indexOf('JWORD_PHASE3_ARTIFACT_MANIFEST')).toBeLessThan(visualSource.indexOf("runPackageManager(['build'])"))
  expect(gate2Source.indexOf('JWORD_PHASE3_ARTIFACT_MANIFEST')).toBeLessThan(gate2Source.indexOf('spawnSync(pnpmBuildCommand.command'))
}

/** 创建 provenance 所需的 12 包 synthetic manifest。 */
function createSyntheticManifest(hash: string) {
  return {
    artifactSetId: hash,
    artifactIdentity: {
      gitSha: 'c'.repeat(40),
      lockfileSha256: hash,
      contractSha256: hash,
      builderSha256: hash,
      environment: { node: 'v20.19.0', npm: '10.8.2', pnpm: '9.14.2', os: 'darwin', arch: 'arm64' },
      // 创建固定数量的 synthetic package identity。
      packages: Array.from({ length: 12 }, function createPackage(_value, index) {
        return {
        name: `@4xian/jword-${index}`,
        tarballFile: `jword-${index}.tgz`,
        tarballSha256: index.toString(16).padStart(64, '0')
        }
      })
    },
    runMetadata: { executionRunId: 'synthetic-run' }
  }
}

/** 创建 assembly 结构校验所需的固定 synthetic record。 */
function createSyntheticAssemblyEvidence(hash: string) {
  return {
    schemaVersion: 1,
    artifactSetId: hash,
    assemblyKind: 'customer-production',
    packageManifestSha256: hash,
    lockfileSha256: hash,
    registryConfigSha256: hash,
    registryEvidenceSha256: hash,
    registryTranscriptSha256: hash,
    auditSha256: hash,
    dependencyListSha256: hash,
    unmaterializedOptionalDependencies: [],
    dependencies: [
      { name: '@4xian/jword-core', version: '0.0.0', realpath: realpathSync(tmpdir()) },
      { name: 'typescript', version: '5.9.3', realpath: join(tmpdir(), 'jword-phase3-synthetic', 'node_modules', '.pnpm', 'typescript@5.9.3', 'node_modules', 'typescript') }
    ]
  }
}

/** 创建含两包原始响应的最小 assembly registry handoff。 */
function createSyntheticAssemblyRegistryFixture() {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-assembly-registry-'))
  const responseRoot = join(root, 'registry-responses')
  const origin = 'http://127.0.0.1:4873'
  const packages = [
    { name: '@4xian/jword-core', version: '0.0.0', tarballFile: 'jword-core.tgz', bytes: Buffer.from('core-tarball') },
    { name: '@4xian/jword-ui', version: '0.0.0', tarballFile: 'jword-ui.tgz', bytes: Buffer.from('ui-tarball') }
  ]
  mkdirSync(responseRoot)
  const requests: Array<Record<string, string | number>> = []
  // 从固定 tarball bytes 生成 registry served package。
  const servedPackages = packages.map(function createServedPackage(entry) {
    const tarballSha256 = sha256(entry.bytes)
    const tarballShasum = createHash('sha1').update(entry.bytes).digest('hex')
    const tarballIntegrity = `sha512-${createHash('sha512').update(entry.bytes).digest('base64')}`
    const metadataBytes = canonicalBytes({
      name: entry.name,
      versions: { [entry.version]: { name: entry.name, version: entry.version, type: 'module', dist: {
        tarball: `${origin}/tarballs/${entry.tarballFile}`,
        shasum: tarballShasum,
        integrity: tarballIntegrity
      } } },
      'dist-tags': { latest: entry.version }
    })
    const metadataSha256 = sha256(metadataBytes)
    const metadataPath = `registry-responses/${metadataSha256}.bin`
    const tarballPath = `registry-responses/${tarballSha256}.bin`
    writeFileSync(join(root, entry.tarballFile), entry.bytes)
    writeFileSync(join(root, metadataPath), metadataBytes)
    writeFileSync(join(root, tarballPath), entry.bytes)
    requests.push({ order: requests.length, method: 'GET', path: `/${encodeURIComponent(entry.name)}`, status: 200, responseKind: 'metadata', responsePath: metadataPath, responseSha256: metadataSha256, responseBytes: metadataBytes.byteLength })
    requests.push({ order: requests.length, method: 'GET', path: `/tarballs/${entry.tarballFile}`, status: 200, responseKind: 'tarball', responsePath: tarballPath, responseSha256: tarballSha256, responseBytes: entry.bytes.byteLength })
    return {
      name: entry.name,
      version: entry.version,
      tarballFile: entry.tarballFile,
      tarballSha256,
      tarballShasum,
      tarballIntegrity,
      metadataPath,
      metadataSha256,
      metadataBytes: metadataBytes.byteLength,
      metadataRequests: 1,
      tarballRequests: 1
    }
  })
  const registry = {
    schemaVersion: 1,
    mode: 'read-only-loopback',
    host: '127.0.0.1',
    scope: '@4xian',
    allowedMethods: ['GET', 'HEAD'],
    servedPackages,
    unexpectedRequests: 0,
    writeAttempts: 0
  }
  const transcript = { schemaVersion: 1, requests }
  writeFileSync(join(root, '.npmrc'), `registry=https://registry.npmjs.org/\n@4xian:registry=${origin}/\n`)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: Object.fromEntries(packages.map(function readDependency(entry) { return [entry.name, entry.version] })) }))
  const lockfilePackages = servedPackages.map(function createLockfileEntry(entry) {
    return `  '${entry.name}@${entry.version}':\n    resolution: {integrity: ${entry.tarballIntegrity}}`
  }).join('\n')
  writeFileSync(join(root, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'\n\npackages:\n${lockfilePackages}\n`)
  const writeRegistry = function writeRegistry(value: typeof registry): void { writeFileSync(join(root, 'registry-evidence.json'), canonicalBytes(value)) }
  const writeTranscript = function writeTranscript(value: typeof transcript): void { writeFileSync(join(root, 'registry-transcript.json'), canonicalBytes(value)) }
  writeRegistry(registry)
  writeTranscript(transcript)

  return {
    root,
    expectedNames: packages.map(function readName(entry) { return entry.name }),
    registry,
    transcript,
    writeRegistry,
    writeTranscript,
    runA: { root, manifest: { artifactIdentity: { packages: packages.map(function createRunAPackage(entry, index) {
      const servedPackage = servedPackages[index]
      if (servedPackage === undefined) throw new Error('synthetic served package is missing')
      return {
        name: entry.name,
        version: entry.version,
        tarballFile: entry.tarballFile,
        tarballSha256: servedPackage.tarballSha256
      }
    }) } } }
  }
}

/** 创建带真实单包 tarball 的最小 reproducibility handoff。 */
function createSyntheticReproducibilityFixture() {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-repro-mutation-'))
  const stagingRoot = join(root, 'staging')
  const packageRoot = join(stagingRoot, 'package')
  const reproducibilityRoot = join(root, 'reproducibility')
  const tarballRoot = join(reproducibilityRoot, 'run-b-tarballs')
  mkdirSync(packageRoot, { recursive: true })
  mkdirSync(tarballRoot, { recursive: true })
  const packageBytes = Buffer.from('{"name":"@4xian/jword-core","version":"0.0.0"}')
  writeFileSync(join(packageRoot, 'package.json'), packageBytes)
  const tarballFile = '4xian-jword-core-0.0.0.tgz'
  const tarballPath = join(tarballRoot, tarballFile)
  execFileSync('tar', ['-czf', tarballPath, '-C', stagingRoot, 'package'])
  const tarballBytes = readFileSync(tarballPath)
  const files = [{ path: 'package.json', bytes: packageBytes.byteLength, sha256: sha256(packageBytes) }]
  const packageEntry = {
    name: '@4xian/jword-core',
    version: '0.0.0',
    delivery: 'npm-public',
    tarballFile,
    tarballSha256: sha256(tarballBytes),
    tarballBytes: tarballBytes.byteLength,
    packedManifestSha256: sha256(packageBytes),
    payloadSha256: createPayloadSha256(files),
    files
  }
  const checksumBytes = createSha256Sums([packageEntry])
  const artifactIdentity = {
    schemaVersion: 1,
    gitSha: 'c'.repeat(40),
    lockfileSha256: 'a'.repeat(64),
    contractSha256: 'b'.repeat(64),
    builderSha256: 'd'.repeat(64),
    environment: readPhase3Environment({ node: process.version, npm: '10.8.2', pnpm: '9.14.2' }),
    sha256SumsSha256: sha256(checksumBytes),
    packages: [packageEntry]
  }
  const manifest = createArtifactManifest(artifactIdentity, {
    createdAt: '2026-07-22T00:00:00.000Z',
    executionRunId: 'synthetic-repro',
    outputDirectory: reproducibilityRoot
  })
  const bindingBytes = canonicalBytes({ fixture: 'binding' })
  const comparison = {
    schemaVersion: 1,
    leftArtifactSetId: manifest.artifactSetId,
    rightArtifactSetId: manifest.artifactSetId,
    tuple: {
      gitSha: artifactIdentity.gitSha,
      lockfileSha256: artifactIdentity.lockfileSha256,
      node: artifactIdentity.environment.node,
      npm: artifactIdentity.environment.npm,
      pnpm: artifactIdentity.environment.pnpm,
      os: artifactIdentity.environment.os,
      arch: artifactIdentity.environment.arch,
      builderSha256: artifactIdentity.builderSha256
    },
    packages: [{
      name: packageEntry.name,
      leftTarballSha256: packageEntry.tarballSha256,
      rightTarballSha256: packageEntry.tarballSha256,
      match: true
    }]
  }
  const summary = {
    schemaVersion: 1,
    evidenceType: 'reproducibility',
    gitSha: artifactIdentity.gitSha,
    lockfileSha256: artifactIdentity.lockfileSha256,
    artifactSetId: manifest.artifactSetId,
    bindingSha256: sha256(bindingBytes),
    status: 'passed',
    checks: { comparable: true, rawTarballsMatch: true }
  }
  writeFileSync(join(reproducibilityRoot, 'run-b-artifact-manifest.json'), canonicalBytes(manifest))
  writeFileSync(join(reproducibilityRoot, 'run-b-SHA256SUMS'), checksumBytes)
  writeFileSync(join(reproducibilityRoot, 'comparison-evidence.json'), canonicalBytes(comparison))
  writeFileSync(join(reproducibilityRoot, 'reproducibility-evidence.json'), canonicalBytes(summary))
  writeEvidenceManifestFixture(reproducibilityRoot, 'reproducibility')

  return {
    root,
    stagingRoot,
    packageRoot,
    reproducibilityRoot,
    tarballPath,
    packageEntry,
    manifest,
    comparison,
    runA: { manifest, bindingBytes }
  }
}

/** 读取 mutation path 指向的值。 */
function readEvidenceValue(value: unknown, path: readonly (string | number)[]): unknown {
  let current = value

  for (const segment of path) {
    if (current === null || typeof current !== 'object') throw new Error('invalid evidence mutation path')
    current = (current as Record<string | number, unknown>)[segment]
  }
  return current
}

/** 写入 mutation path 指向的值。 */
function setEvidenceValue(value: unknown, path: readonly (string | number)[], replacement: unknown): void {
  const parent = readEvidenceValue(value, path.slice(0, -1))
  const key = path.at(-1)

  if (parent === null || typeof parent !== 'object' || key === undefined) throw new Error('invalid evidence mutation target')
  Reflect.set(parent, key, replacement)
}

/** 反转 mutation path 指向的数组。 */
function reverseEvidenceArray(value: unknown, path: readonly (string | number)[]): void {
  const target = readEvidenceValue(value, path)

  if (!Array.isArray(target)) throw new Error('invalid evidence mutation array')
  target.reverse()
}

/** 为 mutation fixture 重写完整外层 evidence manifest。 */
function writeEvidenceManifestFixture(root: string, evidenceType = 'audit'): void {
  const files = listFixtureFiles(root).filter(function omitManifest(path) { return path !== 'evidence-manifest.json' }).map(function readEvidenceFile(path) {
    const bytes = readFileSync(join(root, path))

    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
  })
  const manifest = {
    schemaVersion: 1,
    evidenceType,
    files
  }
  writeFileSync(join(root, 'evidence-manifest.json'), canonicalBytes(manifest))
}

/** 递归枚举 fixture root 的 regular file。 */
function listFixtureFiles(root: string, prefix = ''): readonly string[] {
  const files: string[] = []

  for (const name of readdirSync(join(root, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`
    const stat = lstatSync(join(root, path))
    if (stat.isDirectory()) files.push(...listFixtureFiles(root, path))
    else if (stat.isFile()) files.push(path)
  }
  return files.sort()
}
