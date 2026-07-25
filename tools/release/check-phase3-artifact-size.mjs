/**
 * 职责：只读 run-a tarball 与 consumer bundle bytes，生成 Phase 3 size evidence。
 * 边界：不读取 workspace dist、不运行 build/pack、不修改 contract budget。
 * 协作模块：package artifact contract、consumer evidence 与 release gate runner。
 * 性能/安全约束：每项 source hash 和 bytes 必须从实际文件重新计算。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { canonicalBytes, sha256 } from './phase3-artifact-utils.mjs'

/** 从固定 budget 集合生成按 id 排序的 size evidence。 */
export function createPhase3SizeEvidence(input) {
  const budgets = input.contract.sizeBudgets.map(function measureBudget(budget) {
    const measurement = budget.source.startsWith('tarball:')
      ? measureTarballSource(budget.source, input.manifest, input.artifactRoot)
      : measureConsumerSource(budget.source, input.consumerRoot)
    return {
      id: budget.id,
      source: budget.source,
      sourceSha256: measurement.sourceSha256,
      bytes: measurement.bytes,
      limitBytes: budget.limitBytes,
      status: measurement.bytes <= budget.limitBytes &&
        (budget.sourceSha256 === undefined || budget.sourceSha256 === measurement.sourceSha256) ? 'passed' : 'failed'
    }
  }).sort(compareId)
  return {
    schemaVersion: 1,
    artifactSetId: input.manifest.artifactSetId,
    status: budgets.every(function passed(entry) { return entry.status === 'passed' }) ? 'passed' : 'failed',
    budgets
  }
}

/** 从 manifest 指定 tarball 中读取单个 regular file。 */
function measureTarballSource(source, manifest, artifactRoot) {
  const match = source.match(/^tarball:(@[^/]+\/[^/]+)\/(.+)$/u)
  if (match === null) throw new Error('size tarball source is invalid')
  const packageEntry = manifest.artifactIdentity.packages.find(function findPackage(entry) { return entry.name === match[1] })
  const fileEntry = packageEntry?.files.find(function findFile(entry) { return entry.path === match[2] })
  if (packageEntry === undefined || fileEntry === undefined) throw new Error('size tarball source is missing')
  const result = spawnSync('tar', ['-xOzf', join(artifactRoot, packageEntry.tarballFile), `package/${match[2]}`], { encoding: null })
  if (result.status !== 0 || result.stdout === null) throw new Error('size tarball source cannot be read')
  if (result.stdout.byteLength !== fileEntry.bytes || sha256(result.stdout) !== fileEntry.sha256) throw new Error('size tarball source does not match inventory')
  return { bytes: result.stdout.byteLength, sourceSha256: sha256(result.stdout) }
}

/** 从 consumer bundle 的 index.html 解析首屏 JS/CSS 并聚合实际 bytes。 */
function measureConsumerSource(source, consumerRoot) {
  const match = source.match(/^consumer:bundles\/([^/]+)\/first-screen$/u)
  if (match === null) throw new Error('size consumer source is invalid')
  const bundleRoot = join(consumerRoot, 'bundles', match[1])
  const html = readFileSync(join(bundleRoot, 'index.html'), 'utf8')
  const paths = [...html.matchAll(/(?:src|href)=["']\/?([^"']+)["']/gu)]
    .map(function readPath(entry) { return entry[1] })
    .filter(function isFirstScreenAsset(path) { return /\.(?:css|js)$/u.test(path) })
    .sort()
  if (paths.length === 0 || new Set(paths).size !== paths.length) throw new Error('size first-screen assets are invalid')
  const files = paths.map(function readAsset(path) {
    const bytes = readFileSync(join(bundleRoot, path))
    return { path, sha256: sha256(bytes), bytes: bytes.byteLength }
  })
  return { bytes: files.reduce(function sum(total, file) { return total + file.bytes }, 0), sourceSha256: sha256(canonicalBytes(files)) }
}

/** 按 budget ID 排序。 */
function compareId(left, right) { return left.id < right.id ? -1 : left.id > right.id ? 1 : 0 }

/** 禁止无参数执行时回退到 workspace size/build。 */
function main() {
  console.error('check-phase3-artifact-size.mjs is an internal library; use check-phase3-release-gates.mjs')
  process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
