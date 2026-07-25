/**
 * 职责：在内存中演练 Phase 3 candidate channel 的提升、健康失败和回滚。
 * 边界：只读取显式 fixture 并写 evidence，不访问 registry、不运行发布命令。
 * 协作模块：Phase 3 release gate runner 与最终 evidence verifier。
 * 性能/安全约束：所有 action 固定为 simulation-only，真实 registry 操作永久禁用。
 */
import { mkdtempSync, readFileSync, readdirSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { assertPhase3PathOutside, canonicalBytes, readJsonFile, sha256, writeCanonicalJson } from './phase3-artifact-utils.mjs'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))

/** 从 prior fixture 和 candidate hash 生成可重算的 rollback evidence。 */
export function rehearsePhase3Rollback(priorState, candidateArtifactSetId, rollbackRoot) {
  assertState(priorState)
  assertHash(candidateArtifactSetId, 'candidate artifactSetId')
  const ownsRoot = rollbackRoot === undefined
  const root = assertPhase3PathOutside(repoRoot, rollbackRoot ?? mkdtempSync(join(tmpdir(), 'jword-phase3-rollback-')), 'rollback directory')
  if (readdirSync(root).length !== 0) throw new Error('rollback directory must be empty')
  const pointerPath = join(root, 'channel-pointer.json')
  const candidatePath = join(root, 'candidate-channel.json')
  const promotedState = { ...priorState, artifactSetId: candidateArtifactSetId }
  const rolledBackState = { ...promotedState, artifactSetId: priorState.artifactSetId }

  try {
    writePointer(pointerPath, priorState)
    writePointer(candidatePath, { ...promotedState, channel: 'next' })
    writePointer(pointerPath, promotedState)
    const healthCheck = runSyntheticHealthCheck(readFileSync(candidatePath))
    if (healthCheck.status !== 'failed') throw new Error('synthetic health gate unexpectedly passed')
    writePointer(pointerPath, rolledBackState)
    rmSync(candidatePath, { force: true })
    if (readdirSync(root).includes('candidate-channel.json')) throw new Error('candidate channel was not cleared')
    if (!readFileSync(pointerPath).equals(canonicalBytes(priorState))) throw new Error('rollback pointer was not restored')
    return {
      schemaVersion: 1,
      status: 'passed',
      beforeSha256: sha256(canonicalBytes(priorState)),
      promotedSha256: sha256(canonicalBytes(promotedState)),
      rolledBackSha256: sha256(canonicalBytes(rolledBackState)),
      reason: 'simulated-health-check-failure',
      healthCheck,
      candidateCleared: true,
      ownerStatus: 'deferred',
      realRegistryOperations: 'disabled',
      commandPlan: [
        command(1, 'verify-prior', 'prior-artifact-set'),
        command(2, 'promote-candidate', 'candidate-artifact-set'),
        command(3, 'health-check', 'synthetic-health-gate'),
        command(4, 'restore-prior', 'prior-artifact-set'),
        command(5, 'clear-candidate', 'candidate-channel')
      ]
    }
  } finally {
    if (ownsRoot) rmSync(root, { recursive: true, force: true })
  }
}

/** 运行固定失败的 synthetic health gate 并返回可验证状态。 */
function runSyntheticHealthCheck(candidateBytes) {
  const candidate = JSON.parse(candidateBytes.toString('utf8'))
  return candidate.channel === 'latest'
    ? { status: 'passed', reason: 'candidate-channel-is-stable' }
    : { status: 'failed', reason: 'candidate-channel-is-next' }
}

/** 以临时 JSON 文件原子替换当前 channel pointer。 */
function writePointer(pointerPath, state) {
  const temporaryPath = `${pointerPath}.tmp`
  writeCanonicalJson(temporaryPath, state)
  renameSync(temporaryPath, pointerPath)
}

/** 创建一个固定为 simulation-only 的 rollback action。 */
function command(order, action, target) {
  return { order, action, target, execution: 'simulation-only' }
}

/** 校验 prior channel fixture 的精确最小 schema。 */
function assertState(state) {
  if (state === null || typeof state !== 'object' || Array.isArray(state) ||
      JSON.stringify(Object.keys(state).sort()) !== JSON.stringify(['artifactSetId', 'channel', 'schemaVersion']) ||
      state.schemaVersion !== 1 || state.channel !== 'latest') {
    throw new Error('rollback prior state is invalid')
  }
  assertHash(state.artifactSetId, 'prior artifactSetId')
}

/** 校验 SHA-256 hex。 */
function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid`)
}

/** 执行独立 rollback rehearsal CLI。 */
function main() {
  try {
    const args = process.argv.slice(2)
    if (args.length !== 6) throw new Error('usage: rehearse-phase3-rollback.mjs --fixture <path> --candidate <sha256> --out <path>')
    const fixture = readJsonFile(resolve(readOption(args, '--fixture')), 'rollback fixture').value
    writeCanonicalJson(resolve(readOption(args, '--out')), rehearsePhase3Rollback(fixture, readOption(args, '--candidate')))
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'rollback rehearsal failed')
    process.exitCode = 1
  }
}

/** 读取恰好出现一次的 CLI option。 */
function readOption(args, name) {
  const index = args.indexOf(name)
  if (index === -1 || index !== args.lastIndexOf(name) || args[index + 1] === undefined) throw new Error(`${name} is required`)
  return args[index + 1]
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
