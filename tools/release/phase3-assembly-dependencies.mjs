/**
 * 职责：收集并规范 Phase 3 assembly 的物化依赖和未物化 optional 依赖。
 * 边界：只读取调用方提供的 pnpm list、已安装 package manifest 和依赖路径。
 * 协作模块：Phase 3 release-gates 生成器与 final evidence verifier。
 * 性能/安全约束：拒绝仓库内路径，不修改 assembly、lockfile 或依赖目录。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

/** 从当前 assembly 读取物化闭包，并显式记录经父包清单证明的未物化 optional 节点。 */
export function readResolvedAssemblyDependencies(directory, dependencyList, repositoryRoot) {
  const dependencies = new Map()
  const unmaterializedOptionalDependencies = new Map()
  /** 递归读取 pnpm list，并用当前物化父包的 manifest 判定缺失 optional。 */
  function visit(node, parentDirectory) {
    if (Array.isArray(node)) { for (const child of node) visit(child, directory); return }
    if (node === null || typeof node !== 'object') return
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child === null || typeof child !== 'object' || typeof child.version !== 'string') throw new Error('assembly dependency list is invalid')
      const listedPath = typeof child.path === 'string' ? child.path : join(directory, 'node_modules', ...name.split('/'))
      if (!existsSync(listedPath)) {
        assertOptionalDependency(parentDirectory, name)
        const path = normalizeExternalDependencyPath(listedPath, repositoryRoot, 'assembly optional dependency path')
        unmaterializedOptionalDependencies.set(`${name}\0${child.version}\0${path}`, { name, version: child.version, path })
        continue
      }
      const path = readPhysicalExternalPath(listedPath, repositoryRoot, 'assembly dependency path')
      dependencies.set(`${name}\0${child.version}\0${path}`, { name, version: child.version, realpath: path })
      visit(child, path)
    }
  }
  visit(dependencyList, directory)
  return {
    dependencies: [...dependencies.values()].sort(compareDependencyEvidence),
    unmaterializedOptionalDependencies: [...unmaterializedOptionalDependencies.values()].sort(compareDependencyEvidence)
  }
}

/** 从 raw pnpm list 收集直接依赖、物化记录和显式 omitted optional 记录。 */
export function collectAssemblyDependencyEvidence(value, key, repositoryRoot, omittedKeys, firstPartyDirectKeys) {
  const records = new Map()
  const omitted = new Map()
  const omittedParents = []
  const direct = []
  const roots = Array.isArray(value) ? value : [value]
  for (const root of roots) {
    for (const [name, child] of Object.entries(root?.dependencies ?? {})) {
      direct.push(readDependencyEvidence(name, child, key, repositoryRoot))
    }
  }
  /** 递归读取每个依赖节点并按显式 omitted key 分类。 */
  function visit(node, parent) {
    if (Array.isArray(node)) { for (const child of node) visit(child, undefined); return }
    if (node === null || typeof node !== 'object') return
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      const entry = readDependencyEvidence(name, child, key, repositoryRoot)
      const entryKey = `${entry.name}\0${entry.version}\0${entry.realpath}`
      const isFirstPartyDirect = parent === undefined && firstPartyDirectKeys.has(`${entry.name}\0${entry.version}`)
      if (!isFirstPartyDirect && !isPnpmDependencyPathFor(entry.realpath, entry.name, entry.version)) {
        throw new Error(`${key} dependency list path is invalid`)
      }
      if (omittedKeys.has(entryKey)) {
        if (existsSync(entry.realpath)) throw new Error(`${key} optional dependency path is materialized`)
        if (parent === undefined) throw new Error(`${key} assembly optional dependency is invalid`)
        omitted.set(entryKey, { name: entry.name, version: entry.version, path: entry.realpath })
        omittedParents.push({ name: entry.name, version: entry.version, path: entry.realpath, parentName: parent.name, parentVersion: parent.version })
      } else records.set(entryKey, entry)
      visit(child, entry)
    }
  }
  visit(value, undefined)
  const sortedDirect = direct.sort(compareDependencyEvidence)
  if (new Set(sortedDirect.map(function keyOf(entry) { return `${entry.name}\0${entry.version}` })).size !== sortedDirect.length) {
    throw new Error(`${key} direct dependency list is invalid`)
  }
  return {
    direct: sortedDirect,
    omitted: [...omitted.values()].sort(compareDependencyEvidence),
    omittedParents: omittedParents.sort(compareOptionalDependencyParent),
    records: [...records.values()].sort(compareDependencyEvidence)
  }
}

/** 从 pnpm list 递归收集唯一 name/version。 */
export function collectAssemblyDependencyPairs(value) {
  const pairs = new Set()
  /** 遍历 dependency 节点。 */
  function visit(node) {
    if (Array.isArray(node)) { for (const child of node) visit(child); return }
    if (node === null || typeof node !== 'object') return
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child === null || typeof child !== 'object' || typeof child.version !== 'string') throw new Error('assembly dependency list is invalid')
      pairs.add(`${name}\0${child.version}`)
      visit(child)
    }
  }
  visit(value)
  return [...pairs].sort()
}

/** 证明 lockfile package 约束与冻结 assembly OS/arch 不兼容。 */
export function lockfileExcludesAssemblyEnvironment(lockfile, name, version, environment) {
  if (typeof environment?.os !== 'string' || environment.os === '' || typeof environment.arch !== 'string' || environment.arch === '') return false
  const blocks = readLockfilePackageBlocks(lockfile, name, version)
  if (blocks.length !== 1) return false
  const os = readLockfileConstraint(blocks[0], 'os')
  const cpu = readLockfileConstraint(blocks[0], 'cpu')
  if (os === null || cpu === null) return false
  return (os !== undefined && !allowsEnvironmentValue(os, environment.os)) ||
    (cpu !== undefined && !allowsEnvironmentValue(cpu, environment.arch))
}

/** 从冻结 lockfile 证明物理路径绑定的唯一 snapshot 被 pnpm 标记为 optional。 */
export function lockfileMarksDependencyOptional(lockfile, name, version, path) {
  const virtualStoreEntry = readPnpmVirtualStoreEntry(path, name)
  if (virtualStoreEntry === undefined) return false
  const snapshots = readLockfileSnapshots(lockfile, name, version).filter(function matchesPath(snapshot) {
    return pnpmSnapshotFilename(snapshot.identity) === virtualStoreEntry
  })
  return snapshots.length === 1 && /^[\t ]+optional:[\t ]*true[\t ]*$/mu.test(snapshots[0].block)
}

/** 从父 package snapshot 证明其 optionalDependencies 指向目标 package/version。 */
export function lockfileParentMarksDependencyOptional(lockfile, parentName, parentVersion, name, version) {
  return readLockfileSnapshotBlocks(lockfile, parentName, parentVersion).some(function declaresOptional(block) {
    return readLockfileDependencyEntries(block, 'optionalDependencies')?.some(function matches(entry) {
      return entry.name === name && entry.version === version
    }) === true
  })
}

/** 证明 assembly lockfile 与 raw 父子图双向一致并保留完整 optional 子集合。 */
export function validateAssemblyDependencyGraph(value, lockfile, key, omittedKeys) {
  const parents = new Map()
  /** 合并循环或重复出现的同一物理父节点依赖边。 */
  function visit(node, ancestors = new Set()) {
    if (Array.isArray(node)) { for (const child of node) visit(child, ancestors); return }
    if (node === null || typeof node !== 'object') return
    for (const [name, child] of Object.entries(node.dependencies ?? {})) {
      if (child === null || typeof child !== 'object' || typeof child.version !== 'string' || typeof child.path !== 'string') {
        throw new Error(`${key} assembly dependency graph is invalid`)
      }
      const parentKey = `${name}\0${child.version}\0${child.path}`
      const dependencies = new Map()
      for (const [dependencyName, dependency] of Object.entries(child.dependencies ?? {})) {
        if (dependency === null || typeof dependency !== 'object' || typeof dependency.version !== 'string' || typeof dependency.path !== 'string') {
          throw new Error(`${key} assembly dependency graph is invalid`)
        }
        const dependencyKey = `${dependencyName}\0${dependency.version}`
        const dependencyValue = {
          isOmitted: omittedKeys.has(`${dependencyName}\0${dependency.version}\0${dependency.path}`),
          name: dependencyName,
          path: dependency.path,
          version: dependency.version
        }
        dependencies.set(dependencyKey, dependencyValue)
      }
      if (ancestors.has(parentKey)) {
        if (dependencies.size !== 0) throw new Error(`${key} assembly dependency graph is invalid`)
        continue
      }
      const existingParent = parents.get(parentKey)
      if (existingParent !== undefined && (existingParent.dependencies.size !== dependencies.size || [...dependencies].some(function differs([dependencyKey, dependency]) {
        const existing = existingParent.dependencies.get(dependencyKey)
        return existing === undefined || existing.isOmitted !== dependency.isOmitted || existing.path !== dependency.path
      }))) {
        throw new Error(`${key} assembly dependency graph is invalid`)
      }
      parents.set(parentKey, existingParent ?? { dependencies, name, path: child.path, version: child.version })
      ancestors.add(parentKey)
      visit(child, ancestors)
      ancestors.delete(parentKey)
    }
  }
  visit(value)
  for (const parent of parents.values()) {
    const virtualStoreEntry = readPnpmVirtualStoreEntry(parent.path, parent.name)
    const snapshots = readLockfileSnapshots(lockfile, parent.name, parent.version)
    const matchingSnapshots = virtualStoreEntry === undefined
      ? (snapshots.length === 1 ? snapshots : [])
      : snapshots.filter(function matchesPath(snapshot) { return pnpmSnapshotFilename(snapshot.identity) === virtualStoreEntry })
    if (matchingSnapshots.length !== 1) throw new Error(`${key} assembly optional dependency is invalid`)
    const candidates = matchingSnapshots.map(function read(snapshot) { return readLockfileDependencySet(snapshot.block) })
    if (candidates.some(function invalid(candidate) { return candidate === null })) {
      throw new Error(`${key} assembly optional dependency is invalid`)
    }
    const actual = [...parent.dependencies.keys()].sort()
    const optionalCandidates = candidates.filter(function matchesOptional(candidate) {
      return candidate.optional.every(function present(entry) { return parent.dependencies.has(entry) }) &&
        [...parent.dependencies.entries()].every(function classifies([entry, value]) { return !value.isOmitted || candidate.optional.includes(entry) })
    })
    if (optionalCandidates.length === 0) throw new Error(`${key} assembly optional dependency is invalid`)
    const graphCandidates = optionalCandidates.filter(function matches(candidate) { return JSON.stringify(candidate.all) === JSON.stringify(actual) })
    if (graphCandidates.length === 0 || !graphCandidates.some(function matchesPaths(candidate) {
      return [...parent.dependencies.entries()].every(function matchesPath([entry, dependency]) {
        return candidate.virtualStoreEntries.get(entry) === readPnpmVirtualStoreEntry(dependency.path, dependency.name)
      })
    })) {
      throw new Error(`${key} assembly dependency graph is invalid`)
    }
  }
}

/** 规范 evidence 中允许已被上一 CI job 销毁的仓库外绝对路径。 */
export function normalizeExternalDependencyPath(value, repositoryRoot, label) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error(`${label} is invalid`)
  const normalized = resolve(value)
  if (normalized !== value || isRepositoryPath(normalized, repositoryRoot)) throw new Error(`${label} is invalid`)
  if (!existsSync(value)) return normalized
  let physical
  try { physical = realpathSync(value) } catch { throw new Error(`${label} is invalid`) }
  if (physical !== normalized || isRepositoryPath(physical, repositoryRoot)) throw new Error(`${label} is invalid`)
  return physical
}

/** 按 name/version/path 稳定排序 dependency evidence。 */
export function compareDependencyEvidence(left, right) {
  const leftKey = `${left.name}\0${left.version}\0${left.realpath ?? left.path}`
  const rightKey = `${right.name}\0${right.version}\0${right.realpath ?? right.path}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 按子依赖和父 package identity 稳定排序 optional dependency 边。 */
function compareOptionalDependencyParent(left, right) {
  const leftKey = `${left.name}\0${left.version}\0${left.path}\0${left.parentName}\0${left.parentVersion}`
  const rightKey = `${right.name}\0${right.version}\0${right.path}\0${right.parentName}\0${right.parentVersion}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 读取父包 manifest，证明缺失子节点由 optionalDependencies 声明。 */
function assertOptionalDependency(parentDirectory, name) {
  let manifest
  try { manifest = JSON.parse(readFileSync(join(parentDirectory, 'package.json'), 'utf8')) } catch { throw new Error('assembly dependency parent manifest is invalid') }
  if (typeof manifest.optionalDependencies?.[name] !== 'string') throw new Error(`assembly dependency path is missing: ${name}`)
}

/** 读取当前存在依赖的物理路径并拒绝仓库内解析结果。 */
function readPhysicalExternalPath(value, repositoryRoot, label) {
  let physical
  try { physical = realpathSync(value) } catch { throw new Error(`${label} is invalid`) }
  if (isRepositoryPath(physical, repositoryRoot)) throw new Error(`${label} is invalid`)
  return physical
}

/** 读取并规范一个 raw dependency 节点。 */
function readDependencyEvidence(name, child, key, repositoryRoot) {
  if (child === null || typeof child !== 'object' || typeof child.version !== 'string' ||
      (child.name !== undefined && child.name !== name) || typeof child.path !== 'string') {
    throw new Error(`${key} dependency list path is invalid`)
  }
  return { name, version: child.version, realpath: normalizeExternalDependencyPath(child.path, repositoryRoot, `${key} dependency list path`) }
}

/** 读取 packages 区段中目标 name/version 的唯一 package block。 */
function readLockfilePackageBlocks(lockfile, name, version) {
  if (typeof lockfile !== 'string') return []
  const packages = /^packages:[\t ]*$(?<body>(?:\n(?:[\t ]+[^\n]*|[\t ]*))*)/mu.exec(lockfile)?.groups?.body
  if (packages === undefined) return []
  const escaped = `${name}@${version}`.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const packageLine = new RegExp(String.raw`^[\x20]{2}['"]?${escaped}(?:\([^\n]*\))?['"]?:[\t ]*$`, 'u')
  const lines = packages.split('\n')
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!packageLine.test(lines[index])) continue
    let end = index + 1
    while (end < lines.length && !/^[\x20]{2}\S/u.test(lines[end])) end += 1
    blocks.push(lines.slice(index + 1, end).join('\n'))
  }
  return blocks
}

/** 读取 snapshots 区段中目标 name/version 的全部 package block。 */
function readLockfileSnapshotBlocks(lockfile, name, version) {
  return readLockfileSnapshots(lockfile, name, version).map(function read(snapshot) { return snapshot.block })
}

/** 读取 snapshots 区段中目标 name/version 的完整身份与 block。 */
function readLockfileSnapshots(lockfile, name, version) {
  if (typeof lockfile !== 'string') return []
  const snapshots = /^snapshots:[\t ]*$(?<body>(?:\n(?:[\t ]+[^\n]*|[\t ]*))*)/mu.exec(lockfile)?.groups?.body
  if (snapshots === undefined) return []
  const baseIdentity = `${name}@${version}`
  const packageLine = /^[\x20]{2}(?<identity>'[^']+'|"[^"]+"|[^:]+):[\t ]*(?:\{\})?[\t ]*$/u
  const lines = snapshots.split('\n')
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    const rawIdentity = packageLine.exec(lines[index])?.groups?.identity
    if (rawIdentity === undefined) continue
    const identity = rawIdentity.trim().replace(/^(['"])(.*)\1$/u, '$2')
    if (identity !== baseIdentity && !identity.startsWith(`${baseIdentity}(`)) continue
    let end = index + 1
    while (end < lines.length && !/^[\x20]{2}\S/u.test(lines[end])) end += 1
    blocks.push({ block: lines.slice(index + 1, end).join('\n'), identity })
  }
  return blocks
}

/** 从 raw package-root 路径读取 pnpm virtual-store 目录名。 */
function readPnpmVirtualStoreEntry(path, name) {
  const parts = path.split(sep)
  const pnpmIndex = parts.lastIndexOf('.pnpm')
  const tail = ['node_modules', ...name.split('/')]
  if (pnpmIndex === -1 || parts[pnpmIndex + 1] === undefined || parts.length !== pnpmIndex + 2 + tail.length ||
      tail.some(function differs(part, index) { return parts[pnpmIndex + 2 + index] !== part })) return undefined
  return parts[pnpmIndex + 1]
}

/** 按 pnpm v9 规则把 lock snapshot identity 转为 virtual-store 目录名。 */
function pnpmSnapshotFilename(identity) {
  let filename = identity.replace(/[\\/:*?"<>|]/gu, '+')
  if (filename.includes('(')) filename = filename.replace(/\)$/u, '').replace(/(\)\()|\(|\)/gu, '_')
  if (filename.length <= 120 && filename === filename.toLowerCase()) return filename
  return `${filename.substring(0, 93)}_${createPnpmPathHash(filename)}`
}

/** 生成 pnpm virtual-store 长路径使用的 lowercase MD5 base32。 */
function createPnpmPathHash(value) {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz234567'
  const bytes = createHash('md5').update(value).digest()
  let bits = 0
  let buffer = 0
  let result = ''
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte
    bits += 8
    while (bits >= 5) {
      bits -= 5
      result += alphabet[(buffer >>> bits) & 31]
    }
  }
  if (bits > 0) result += alphabet[(buffer << (5 - bits)) & 31]
  return result
}

/** 读取一个 snapshot block 的依赖字段。 */
function readLockfileDependencyEntries(block, field) {
  const lines = new RegExp(String.raw`^[\t ]{4}${field}:[\t ]*$(?<entries>(?:\n[\t ]{6}[^\n]+)*)`, 'mu').exec(block)?.groups?.entries
  if (lines === undefined) return []
  const entries = lines.split('\n').filter(Boolean).map(function parse(line) {
    const match = /^[\t ]{6}(?<name>'[^']+'|"[^"]+"|[^:]+):[\t ]*(?<version>'[^']+'|"[^"]+"|\S+)[\t ]*$/u.exec(line)?.groups
    if (match === undefined) return undefined
    const entryName = match.name.trim().replace(/^(['"])(.*)\1$/u, '$2')
    const resolution = match.version.replace(/^(['"])(.*)\1$/u, '$2')
    const entryVersion = resolution.replace(/\([^\n]*$/u, '')
    return entryName === '' || entryVersion === '' ? undefined : { identity: `${entryName}@${resolution}`, name: entryName, version: entryVersion }
  }).sort(compareOptionalDependencyEntry)
  return entries.some(function missing(entry) { return entry === undefined }) ? null : entries
}

/** 读取一个 snapshot block 的完整依赖集合与 optional 子集合。 */
function readLockfileDependencySet(block) {
  const dependencies = readLockfileDependencyEntries(block, 'dependencies')
  const optionalDependencies = readLockfileDependencyEntries(block, 'optionalDependencies')
  if (dependencies === null || optionalDependencies === null) return null
  const dependencyKeys = new Set(dependencies.map(function createKey(entry) { return `${entry.name}\0${entry.version}` }))
  if (optionalDependencies.some(function overlaps(entry) { return dependencyKeys.has(`${entry.name}\0${entry.version}`) })) return null
  const all = new Map()
  const virtualStoreEntries = new Map()
  for (const entry of [...dependencies, ...optionalDependencies]) {
    const existing = all.get(entry.name)
    if (existing !== undefined && existing !== entry.version) return null
    all.set(entry.name, entry.version)
    virtualStoreEntries.set(`${entry.name}\0${entry.version}`, pnpmSnapshotFilename(entry.identity))
  }
  return {
    all: [...all].map(function createKey([name, version]) { return `${name}\0${version}` }).sort(),
    optional: optionalDependencies.map(function createKey(entry) { return `${entry.name}\0${entry.version}` }).sort(),
    virtualStoreEntries
  }
}

/** 读取 lockfile package block 中一个内联字符串数组约束。 */
function readLockfileConstraint(block, field) {
  const line = new RegExp(String.raw`^[\t ]+${field}:[^\n]*$`, 'mu').exec(block)?.[0]
  if (line === undefined) return undefined
  const items = new RegExp(String.raw`^[\t ]+${field}:[\t ]*\[(?<value>[^\]\n]*)\][\t ]*$`, 'u').exec(line)?.groups?.value
  if (items === undefined) return null
  if (items.trim() === '') return []
  const values = items.split(',').map(function normalize(value) {
    return value.trim().replace(/^(['"])(.*)\1$/u, '$2')
  })
  return values.some(function invalid(value) { return !/^!?[a-z0-9._-]+$/iu.test(value) }) ? null : values
}

/** 按 npm os/cpu 正向与排除项判断当前环境值是否允许。 */
function allowsEnvironmentValue(values, current) {
  const denied = values.filter(function isDenied(value) { return value.startsWith('!') }).map(function strip(value) { return value.slice(1) })
  const allowed = values.filter(function isAllowed(value) { return !value.startsWith('!') })
  return !denied.includes(current) && (allowed.length === 0 || allowed.includes(current))
}

/** 绑定 pnpm virtual-store 路径中的 package name/version 身份。 */
function isPnpmDependencyPathFor(path, name, version) {
  const virtualStoreEntry = readPnpmVirtualStoreEntry(path, name)
  const identity = `${name}@${version}`
  const plainFilename = identity.replaceAll('/', '+')
  const hashPrefix = `${plainFilename.substring(0, 93)}_`
  const hasLongHashShape = plainFilename.length > 93 && virtualStoreEntry?.length === 120 &&
    virtualStoreEntry.startsWith(hashPrefix) && /^[a-z2-7]{26}$/u.test(virtualStoreEntry.slice(hashPrefix.length))
  return virtualStoreEntry === pnpmSnapshotFilename(identity) || virtualStoreEntry?.startsWith(`${plainFilename}_`) === true || hasLongHashShape
}

/** 按 optional 子节点 name/version 排序。 */
function compareOptionalDependencyEntry(left, right) {
  if (left === undefined || right === undefined) return 0
  const leftKey = `${left.name}\0${left.version}`
  const rightKey = `${right.name}\0${right.version}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 判断绝对路径是否落在当前仓库内。 */
function isRepositoryPath(path, repositoryRoot) {
  const relativePath = relative(repositoryRoot, path)
  return relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))
}
