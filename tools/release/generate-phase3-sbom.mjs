/**
 * 职责：从 customer/server 两套结构化 dependency list 生成单一 SPDX 2.3 SBOM。
 * 边界：不读取仓库 lockfile，不合并两个 assembly root 的依赖关系。
 * 协作模块：Phase 3 release gate runner 与最终 verifier。
 * 性能/安全约束：输出确定性排序，未批准法律字段固定为 NOASSERTION。
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 生成带两个独立 assembly root 的 SPDX 2.3 document。 */
export function generatePhase3Sbom(input) {
  const roots = [
    createAssembly('customer-production', input.customerList, input.customerLockSha256, input.customerListSha256),
    createAssembly('server-image', input.serverList, input.serverLockSha256, input.serverListSha256)
  ]
  const firstParty = (input.firstPartyPackages ?? []).map(createFirstPartyPackage)
  const packages = roots.flatMap(function readPackages(root) { return root.packages })
  const relationships = roots.flatMap(function readRelationships(root) { return root.relationships }).concat(
    firstParty.map(function describePackage(entry) {
      return { spdxElementId: 'SPDXRef-DOCUMENT', relationshipType: 'DESCRIBES', relatedSpdxElement: entry.SPDXID }
    })
  )

  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `jword-phase3-${input.artifactSetId}`,
    documentNamespace: `urn:jword:spdx:phase3:${input.artifactSetId}`,
    creationInfo: { creators: ['Tool: jword-phase3-sbom'], created: '1970-01-01T00:00:00Z' },
    packages: [...packages, ...firstParty].sort(compareSpdxId),
    relationships: relationships.sort(compareRelationship)
  }
}

/** 创建带 first-party tarball SHA-256 的 SPDX package。 */
function createFirstPartyPackage(entry) {
  if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string' || entry.name === '') {
    throw new Error('first-party SBOM package is invalid')
  }
  assertHash(entry.tarballSha256, `${entry.name} tarball hash`)
  const packageEntry = {
    SPDXID: `SPDXRef-FirstParty-${entry.name}`.replace(/[^A-Za-z0-9.-]/gu, '-'),
    name: entry.name,
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    checksums: [{ algorithm: 'SHA256', checksumValue: entry.tarballSha256 }]
  }
  if (typeof entry.version === 'string') packageEntry.versionInfo = entry.version
  return packageEntry
}

/** 从一份 pnpm list JSON 创建独立 assembly root 与关系。 */
function createAssembly(kind, dependencyList, lockfileSha256, listSha256) {
  assertHash(lockfileSha256, `${kind} lockfile hash`)
  assertHash(listSha256, `${kind} dependency list hash`)
  const rootId = `SPDXRef-Assembly-${kind}`
  const dependencies = collectDependencies(dependencyList)
  const rootPackage = {
    SPDXID: rootId,
    name: kind,
    versionInfo: '0.0.0',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    externalRefs: [
      { referenceCategory: 'OTHER', referenceType: 'jword-lockfile-sha256', referenceLocator: lockfileSha256 },
      { referenceCategory: 'OTHER', referenceType: 'jword-dependency-list-sha256', referenceLocator: listSha256 }
    ]
  }
  const dependencyPackages = dependencies.map(function createPackage(entry) {
    return {
      SPDXID: packageId(kind, entry.name, entry.version),
      name: entry.name,
      versionInfo: entry.version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: false,
      licenseConcluded: 'NOASSERTION',
      licenseDeclared: 'NOASSERTION'
    }
  })

  return {
    packages: [rootPackage, ...dependencyPackages],
    relationships: dependencyPackages.map(function createRelationship(packageEntry) {
      return { spdxElementId: rootId, relationshipType: 'DEPENDS_ON', relatedSpdxElement: packageEntry.SPDXID }
    })
  }
}

/** 递归收集 pnpm list 中唯一的 name/version 依赖。 */
function collectDependencies(input) {
  const found = new Map()
  /** 遍历 pnpm list 节点。 */
  function visit(value) {
    if (Array.isArray(value)) { for (const child of value) visit(child); return }
    if (value === null || typeof value !== 'object') return
    for (const [name, child] of Object.entries(value.dependencies ?? {})) {
      if (child !== null && typeof child === 'object' && typeof child.version === 'string') found.set(`${name}\0${child.version}`, { name, version: child.version })
      visit(child)
    }
  }
  visit(input)
  return [...found.values()].sort(function compareDependency(left, right) {
    const leftKey = `${left.name}\0${left.version}`
    const rightKey = `${right.name}\0${right.version}`
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
  })
}

/** 创建稳定 SPDX package ID。 */
function packageId(kind, name, version) { return `SPDXRef-${kind}-${name}-${version}`.replace(/[^A-Za-z0-9.-]/gu, '-') }

/** 按 SPDXID 排序。 */
function compareSpdxId(left, right) { return left.SPDXID < right.SPDXID ? -1 : left.SPDXID > right.SPDXID ? 1 : 0 }

/** 按 relationship tuple 排序。 */
function compareRelationship(left, right) {
  const leftKey = `${left.spdxElementId}\0${left.relatedSpdxElement}`
  const rightKey = `${right.spdxElementId}\0${right.relatedSpdxElement}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 校验 SHA-256 hex。 */
function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) throw new Error(`${label} is invalid`)
}

/** 禁止把生成器误当作独立发布入口。 */
function main() {
  console.error('generate-phase3-sbom.mjs is an internal library; use check-phase3-release-gates.mjs')
  process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
