/**
 * 职责：比较同一 Phase 3 元组的两次原始包，并保存受限的复现证据。
 * 边界：只读取显式清单、绑定、校验和与包文件，写入显式空证据目录。
 * 协作模块：制品构建器、制品工具、B4 复现任务与最终验证器。
 * 性能/安全约束：不构建、不打包、不发布，不把第二次运行变成消费或发布输入。
 * 实现说明：元组不同只报告不可比较；元组相同而原始包不同则稳定失败。
 */
import { copyFileSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

import {
  assertPhase3PathOutside,
  canonicalBytes,
  createSha256Sums,
  readJsonFile,
  sha256,
  validateArtifactBindingForComparison,
  validateArtifactManifestForComparison,
  writeCanonicalJson
} from './phase3-artifact-utils.mjs'

/** 执行 compare CLI 并输出结构化状态。 */
function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const repoRoot = resolve(process.cwd())
    const evidenceDirectory = prepareEvidenceDirectory(repoRoot, options.evidenceDirectory)
    const left = readArtifactSet(options.left, 'left artifact')
    const right = readArtifactSet(options.right, 'right artifact')
    const bindingRecord = readJsonFile(resolve(options.leftBinding), 'left artifact binding')
    const bindingSha256 = sha256(bindingRecord.bytes)

    validateArtifactBindingForComparison(bindingRecord.value, left.manifestBytes, left.manifest, left.checksumBytes)
    const result = compareArtifactSets(left, right, evidenceDirectory, bindingSha256)

    console.log(JSON.stringify({ status: result.status, packages: result.packages }))
    if (result.status !== 'passed') {
      process.exitCode = 1
    }
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : 'unknown Phase 3 compare failure'
    }))
    process.exitCode = 1
  }
}

/** 解析 compare 的四个必需 CLI option。 */
function parseArguments(args) {
  if (args.length !== 8) {
    throw new Error('usage: compare-phase3-artifacts.mjs --left <manifest> --left-binding <binding> --right <manifest> --evidence-dir <path>')
  }

  return {
    left: readOption(args, '--left'),
    leftBinding: readOption(args, '--left-binding'),
    right: readOption(args, '--right'),
    evidenceDirectory: readOption(args, '--evidence-dir')
  }
}

/** 读取一个恰好出现一次且带值的 CLI option。 */
function readOption(args, name) {
  const positions = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      positions.push(index)
    }
  }
  if (positions.length !== 1 || positions[0] === args.length - 1) {
    throw new Error(`${name} must be provided exactly once with a value`)
  }

  return args[positions[0] + 1]
}

/** 创建或校验空 evidence directory。 */
function prepareEvidenceDirectory(repoRoot, requestedPath) {
  const directory = assertPhase3PathOutside(repoRoot, requestedPath, 'reproducibility evidence directory')

  mkdirSync(directory, { recursive: true })
  if (readdirSync(directory).length !== 0) {
    throw new Error('reproducibility evidence directory must be empty')
  }

  return directory
}

/** 读取并验证 manifest、sibling checksum 和全部 raw tarball bytes。 */
function readArtifactSet(manifestPath, label) {
  const absoluteManifestPath = resolve(manifestPath)
  const root = dirname(absoluteManifestPath)
  const manifestRecord = readJsonFile(absoluteManifestPath, `${label} manifest`)
  const checksumBytes = readFileSync(join(root, 'SHA256SUMS'))

  validateArtifactManifestForComparison(manifestRecord.value, checksumBytes)
  const tarballs = new Map()
  for (const packageEntry of manifestRecord.value.artifactIdentity.packages) {
    const tarballPath = join(root, packageEntry.tarballFile)
    const bytes = readFileSync(tarballPath)

    if (sha256(bytes) !== packageEntry.tarballSha256) {
      throw new Error(`${label} ${packageEntry.name} raw tarball hash mismatch`)
    }
    tarballs.set(packageEntry.name, { path: tarballPath, bytes, packageEntry })
  }

  return {
    root,
    manifest: manifestRecord.value,
    manifestBytes: manifestRecord.bytes,
    checksumBytes,
    tarballs
  }
}

/** 比较 tuple/package set/raw bytes 并写受限 run-b payload。 */
function compareArtifactSets(left, right, evidenceDirectory, bindingSha256) {
  const tuple = readComparableTuple(left.manifest.artifactIdentity)
  const rightTuple = readComparableTuple(right.manifest.artifactIdentity)
  const comparable = canonicalBytes(tuple).equals(canonicalBytes(rightTuple))
  const leftNames = [...left.tarballs.keys()].sort()
  const rightNames = [...right.tarballs.keys()].sort()

  if (JSON.stringify(leftNames) !== JSON.stringify(rightNames)) {
    throw new Error('reproducibility package set mismatch')
  }

  const tarballDirectory = join(evidenceDirectory, 'run-b-tarballs')
  const packages = []
  const copiedPackages = []

  mkdirSync(tarballDirectory)
  for (const name of leftNames) {
    const leftTarball = left.tarballs.get(name)
    const rightTarball = right.tarballs.get(name)
    const copiedPath = join(tarballDirectory, basename(rightTarball.path))

    copyFileSync(rightTarball.path, copiedPath)
    const copiedBytes = readFileSync(copiedPath)

    copiedPackages.push({
      ...rightTarball.packageEntry,
      tarballSha256: sha256(copiedBytes),
      tarballBytes: copiedBytes.byteLength
    })
    packages.push({
      name,
      leftTarballSha256: sha256(leftTarball.bytes),
      rightTarballSha256: sha256(copiedBytes),
      match: leftTarball.bytes.equals(copiedBytes)
    })
  }

  const copiedChecksumBytes = createSha256Sums(copiedPackages)
  const copiedIdentity = {
    ...right.manifest.artifactIdentity,
    packages: copiedPackages,
    sha256SumsSha256: sha256(copiedChecksumBytes)
  }
  const copiedManifest = {
    artifactIdentity: copiedIdentity,
    artifactSetId: sha256(canonicalBytes(copiedIdentity)),
    runMetadata: right.manifest.runMetadata
  }

  validateArtifactManifestForComparison(copiedManifest, copiedChecksumBytes)
  const rawTarballsMatch = packages.every(matchesTarball)
  const status = !comparable ? 'not-comparable' : rawTarballsMatch ? 'passed' : 'failed'

  const comparison = {
    schemaVersion: 1,
    leftArtifactSetId: left.manifest.artifactSetId,
    rightArtifactSetId: copiedManifest.artifactSetId,
    tuple,
    packages
  }
  const summary = {
    schemaVersion: 1,
    evidenceType: 'reproducibility',
    gitSha: left.manifest.artifactIdentity.gitSha,
    lockfileSha256: left.manifest.artifactIdentity.lockfileSha256,
    artifactSetId: left.manifest.artifactSetId,
    bindingSha256,
    status: status === 'passed' ? 'passed' : 'failed',
    checks: { comparable, rawTarballsMatch }
  }

  writeCanonicalJson(join(evidenceDirectory, 'reproducibility-evidence.json'), summary)
  writeCanonicalJson(join(evidenceDirectory, 'comparison-evidence.json'), comparison)
  writeCanonicalJson(join(evidenceDirectory, 'run-b-artifact-manifest.json'), copiedManifest)
  writeFileSync(join(evidenceDirectory, 'run-b-SHA256SUMS'), copiedChecksumBytes)
  writeEvidenceManifest(evidenceDirectory)

  return {
    status,
    packages: packages.length
  }
}

/** 枚举受限复现root并写入不自列的完整evidence manifest。 */
function writeEvidenceManifest(evidenceDirectory) {
  const files = listEvidenceFiles(evidenceDirectory).map(function createEvidenceFile(path) {
    const bytes = readFileSync(join(evidenceDirectory, path))

    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) }
  })

  writeCanonicalJson(join(evidenceDirectory, 'evidence-manifest.json'), {
    schemaVersion: 1,
    evidenceType: 'reproducibility',
    files
  })
}

/** 递归读取受限复现root内排序后的regular file路径。 */
function listEvidenceFiles(directory, prefix = '') {
  const files = []

  for (const name of readdirSync(join(directory, prefix)).sort()) {
    const path = prefix === '' ? name : `${prefix}/${name}`

    if (path === 'evidence-manifest.json') continue
    const stat = lstatSync(join(directory, path))
    if (stat.isSymbolicLink()) throw new Error(`reproducibility evidence symlink is forbidden: ${path}`)
    if (stat.isDirectory()) files.push(...listEvidenceFiles(directory, path))
    else if (stat.isFile()) files.push(path)
    else throw new Error(`reproducibility evidence entry is not regular: ${path}`)
  }

  return files.sort()
}

/** 从 identity 读取冻结的可比 tuple。 */
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

/** 判断 package raw tarball 是否 bit-for-bit 一致。 */
function matchesTarball(packageComparison) {
  return packageComparison.match === true
}

main()
