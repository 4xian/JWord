/**
 * 职责：校验 Phase 3 synthetic release readiness 与 rollback evidence。
 * 边界：只读取 contract/policy/rollback 输入，不执行真实 registry、publish 或 dist-tag 操作。
 * 协作模块：artifact utils 与 release gate runner。
 * 性能/安全约束：拒绝未知、重复、缺失或与 policy/contract 不一致的状态。
 */
import { canonicalBytes, readJsonFile, sha256 } from './phase3-artifact-utils.mjs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
const releasePolicyFixturePath = join(repoRoot, 'fixtures/release/release-policy.json')

/** 校验 synthetic policy 与真实 candidate fail-closed 状态。 */
export function validateReleaseReadiness(
  value,
  contract = readJsonFile(contractPath, 'package artifact contract').value,
  policy = readJsonFile(releasePolicyFixturePath, 'release policy fixture').value
) {
  assertExactKeys(value, ['checks', 'commandPlan', 'ownerStatus', 'registryOperations', 'schemaVersion', 'status'], 'release readiness')
  const policyInput = validateReadinessPolicyInput(contract, policy)
  const expectedChecks = [
    ['lockstep-version', 'passed', `synthetic ${policy.candidateVersion} keeps ${policyInput.npmPackages.length} npm packages in lockstep`],
    ['changeset-draft', 'passed', `synthetic changeset draft covers ${policy.changeset.packages.length} npm delivery packages`],
    ['registry-layering', 'passed', `${policyInput.publicPackages.length} public, ${policyInput.restrictedPackages.length} restricted, and ${policyInput.dockerPackages.length} docker-only package layers stay distinct`],
    ['2fa-required', 'passed', `synthetic policy requires registry 2FA: ${policy.twoFactorRequired}`],
    ['dist-tag-transition', 'passed', `candidate uses ${policy.distTags.candidate} before ${policy.distTags.stable}`],
    ['rollback-command-plan', 'passed', `rollback policy freezes ${policy.rollback.actions.length} actions after ${policy.rollback.healthStatus} health`],
    ['signed-provenance-requirement', 'passed', `formal release requires signed provenance: ${policy.signedProvenanceRequired}`],
    ['private-disabled', 'blocked-as-expected', 'repository remains private true'],
    ['approved-version', 'blocked-as-expected', 'real version remains 0.0.0'],
    ['legal-license', 'blocked-as-expected', 'legal license is not approved'],
    ['approved-changeset', 'blocked-as-expected', 'real changeset is not approved'],
    ['registry-access', 'blocked-as-expected', 'registry access is not verified'],
    ['registry-2fa', 'blocked-as-expected', 'registry 2FA is not verified'],
    ['signed-provenance', 'blocked-as-expected', 'provenance Statement is unsigned'],
    ['dist-tag-approval', 'blocked-as-expected', 'dist-tag promotion is not approved'],
    ['rollback-owner', 'blocked-as-expected', 'rollback owner remains deferred'],
    ['minimum-browser', 'blocked-as-expected', 'minimum browser certification remains deferred']
  ].map(function createCheck([id, status, reason]) { return { id, status, reason } }).sort(compareReadinessCheck)
  if (!Array.isArray(value.checks) || value.checks.some(function invalidCheck(entry) {
    assertExactKeys(entry, ['id', 'reason', 'status'], 'release readiness check')
    return false
  }) || new Set(value.checks.map(function readId(entry) { return entry.id })).size !== value.checks.length ||
      !canonicalBytes(value.checks.slice().sort(compareReadinessCheck)).equals(canonicalBytes(expectedChecks))) {
    throw new Error('release readiness evidence is invalid')
  }
  const expectedPlan = [
    { order: 1, action: 'verify-access', target: 'public-and-restricted-registry', execution: 'not-run' },
    { order: 2, action: 'verify-2fa', target: 'release-identity', execution: 'not-run' },
    { order: 3, action: 'publish-next', target: `${policyInput.npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`, execution: 'not-run' },
    { order: 4, action: 'promote-latest', target: `${policyInput.npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`, execution: 'not-run' },
    { order: 5, action: 'restore-prior', target: 'recorded-previous-versions', execution: 'not-run' },
    { order: 6, action: 'remove-next', target: `${policyInput.npmPackages.length}-npm-delivery-packages@${policy.candidateVersion}`, execution: 'not-run' }
  ]
  if (value.schemaVersion !== 1 || value.status !== 'passed' || value.registryOperations !== 'not-run' || value.ownerStatus !== 'deferred' ||
      !Array.isArray(value.commandPlan) || value.commandPlan.length !== 6 || value.commandPlan.some(function invalidCommand(entry) {
        assertExactKeys(entry, ['action', 'execution', 'order', 'target'], 'release readiness command')
        return entry.execution !== 'not-run'
      }) || !canonicalBytes(value.commandPlan).equals(canonicalBytes(expectedPlan))) {
    throw new Error('release readiness evidence is invalid')
  }
}

/** 校验 readiness 的 contract、registry layering、synthetic versions 与 release policy。 */
function validateReadinessPolicyInput(contract, policy) {
  const packages = contract?.packages
  if (!Array.isArray(packages)) throw new Error('release readiness evidence is invalid')
  const npmPackages = packages.filter(function isNpm(entry) { return typeof entry?.delivery === 'string' && entry.delivery.startsWith('npm-') })
  const dockerPackages = packages.filter(function isDocker(entry) { return entry?.delivery === 'docker-image-internal' })
  const publicPackages = npmPackages.filter(function isPublic(entry) { return entry.registryIntent === 'public' })
  const restrictedPackages = npmPackages.filter(function isRestricted(entry) { return entry.registryIntent === 'restricted' })
  if (npmPackages.length !== 11 || dockerPackages.length !== 1 || npmPackages.some(function invalid(entry) { return entry.version !== '0.0.0' || !['public', 'restricted'].includes(entry.registryIntent) }) ||
      dockerPackages[0]?.registryIntent !== 'not-published' || policy === null || typeof policy !== 'object' || Array.isArray(policy) ||
      !hasExactKeys(policy, ['candidateVersion', 'changeset', 'distTags', 'npmPackageVersions', 'registryLayers', 'rollback', 'schemaVersion', 'signedProvenanceRequired', 'twoFactorRequired']) ||
      policy.schemaVersion !== 1 || policy.candidateVersion !== '1.2.3' || policy.twoFactorRequired !== true || policy.signedProvenanceRequired !== true ||
      !hasExactKeys(policy.changeset, ['packages', 'status']) || policy.changeset.status !== 'draft' ||
      !hasExactKeys(policy.distTags, ['candidate', 'stable']) || policy.distTags.candidate !== 'next' || policy.distTags.stable !== 'latest' ||
      !hasExactKeys(policy.registryLayers, ['dockerOnly', 'public', 'restricted']) ||
      !hasExactKeys(policy.rollback, ['actions', 'healthStatus', 'priorChannel']) || policy.rollback.healthStatus !== 'failed' || policy.rollback.priorChannel !== 'latest' ||
      JSON.stringify(policy.rollback.actions) !== JSON.stringify(['verify-prior', 'promote-candidate', 'health-check', 'restore-prior', 'clear-candidate'])) {
    throw new Error('release readiness evidence is invalid')
  }
  const expectedVersions = npmPackages.map(function createVersion(entry) { return { name: entry.name, version: policy.candidateVersion } }).sort(compareReadinessPackage)
  if (!Array.isArray(policy.npmPackageVersions) || !policy.npmPackageVersions.every(function valid(entry) { return entry !== null && typeof entry === 'object' && hasExactKeys(entry, ['name', 'version']) }) ||
      !canonicalBytes(policy.npmPackageVersions).equals(canonicalBytes(expectedVersions)) ||
      !sameReadinessNames(policy.changeset.packages, npmPackages.map(function readName(entry) { return entry.name })) ||
      !sameReadinessNames(policy.registryLayers.public, publicPackages.map(function readName(entry) { return entry.name })) ||
      !sameReadinessNames(policy.registryLayers.restricted, restrictedPackages.map(function readName(entry) { return entry.name })) ||
      !sameReadinessNames(policy.registryLayers.dockerOnly, dockerPackages.map(function readName(entry) { return entry.name }))) {
    throw new Error('release readiness evidence is invalid')
  }
  return { npmPackages, publicPackages, restrictedPackages, dockerPackages }
}

/** 比较 readiness check 的稳定 id 顺序。 */
function compareReadinessCheck(left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0 }
/** 比较 readiness package 的稳定 name 顺序。 */
function compareReadinessPackage(left, right) { return left.name < right.name ? -1 : left.name > right.name ? 1 : 0 }
/** 比较 readiness policy 的 package name 集合。 */
function sameReadinessNames(actual, expected) {
  return Array.isArray(actual) && actual.every(function isName(value) { return typeof value === 'string' }) &&
    JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort()) && new Set(actual).size === actual.length
}
/** 判断 readiness policy 对象是否恰好包含字段。 */
function hasExactKeys(value, expected) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort())
}

/** 校验 rollback 状态与固定 simulation-only action。 */
export function validateRollbackEvidence(value, priorState, candidateArtifactSetId) {
  assertExactKeys(value, ['beforeSha256', 'candidateCleared', 'commandPlan', 'healthCheck', 'ownerStatus', 'promotedSha256', 'realRegistryOperations', 'reason', 'rolledBackSha256', 'schemaVersion', 'status'], 'rollback evidence')
  assertExactKeys(value.healthCheck, ['reason', 'status'], 'rollback health check')
  const expectedPlan = [
    { order: 1, action: 'verify-prior', target: 'prior-artifact-set', execution: 'simulation-only' },
    { order: 2, action: 'promote-candidate', target: 'candidate-artifact-set', execution: 'simulation-only' },
    { order: 3, action: 'health-check', target: 'synthetic-health-gate', execution: 'simulation-only' },
    { order: 4, action: 'restore-prior', target: 'prior-artifact-set', execution: 'simulation-only' },
    { order: 5, action: 'clear-candidate', target: 'candidate-channel', execution: 'simulation-only' }
  ]
  if (value.schemaVersion !== 1 || value.status !== 'passed' || value.reason !== 'simulated-health-check-failure' ||
      value.healthCheck.status !== 'failed' || value.healthCheck.reason !== 'candidate-channel-is-next' || value.candidateCleared !== true ||
      value.ownerStatus !== 'deferred' || value.realRegistryOperations !== 'disabled' || !Array.isArray(value.commandPlan) || value.commandPlan.length !== 5 ||
      value.commandPlan.some(function invalidCommand(entry) {
        assertExactKeys(entry, ['action', 'execution', 'order', 'target'], 'rollback command')
        return entry.execution !== 'simulation-only'
      }) || !canonicalBytes(value.commandPlan).equals(canonicalBytes(expectedPlan)) ||
      ![value.beforeSha256, value.promotedSha256, value.rolledBackSha256].every(function isHash(hash) { return typeof hash === 'string' && /^[0-9a-f]{64}$/u.test(hash) }) ||
      value.beforeSha256 !== value.rolledBackSha256 || value.beforeSha256 === value.promotedSha256) {
    throw new Error('rollback evidence is invalid')
  }
  if (priorState !== undefined || candidateArtifactSetId !== undefined) {
    if (priorState === undefined || candidateArtifactSetId === undefined || priorState === null || typeof priorState !== 'object' ||
        Array.isArray(priorState) || JSON.stringify(Object.keys(priorState).sort()) !== JSON.stringify(['artifactSetId', 'channel', 'schemaVersion']) ||
        priorState.schemaVersion !== 1 || priorState.channel !== 'latest' || typeof priorState.artifactSetId !== 'string' || !/^[0-9a-f]{64}$/u.test(priorState.artifactSetId) ||
        !/^[0-9a-f]{64}$/u.test(candidateArtifactSetId)) throw new Error('rollback evidence is invalid')
    const promotedState = { ...priorState, artifactSetId: candidateArtifactSetId }
    if (value.beforeSha256 !== sha256(canonicalBytes(priorState)) || value.promotedSha256 !== sha256(canonicalBytes(promotedState)) ||
        value.rolledBackSha256 !== sha256(canonicalBytes(priorState))) throw new Error('rollback evidence is invalid')
  }
}

/** 校验对象字段集合恰好匹配。 */
function assertExactKeys(value, expected, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) throw new Error(`${label} fields are invalid`)
}
