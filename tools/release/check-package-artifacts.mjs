/**
 * 职责：统一校验 Phase 3 source manifest 与显式 package tarball 的发布边界。
 * 边界：只读取机器 contract、source manifest、artifact manifest 和调用方提供的 tarball。
 * 协作模块：Phase 3 artifact builder、Gate 4.5/5/6/7 兼容入口和 architecture tests。
 * 性能/安全约束：不执行 build、pack、publish，不回显命中的秘密内容。
 * 实现说明：所有模式都由调用方显式选择，缺少输入时 fail closed。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
const declarationPattern = /\.d\.(?:cts|mts|ts)$/u
const sourceTypeScriptPattern = /\.(?:cts|mts|ts|tsx)$/u
const testPathPattern = /(?:^|\/)(?:test|tests|__tests__|__snapshots__)(?:\/|$)|(?:^|\/)[^/]+\.(?:spec|test)\.[^/]+$/u

/** 执行 scanner CLI 并只输出结构化结果。 */
function main() {
  try {
    const args = parseArguments(process.argv.slice(2))
    const contract = readJson(contractPath, 'package artifact contract')
    const reports = selectReports(args, contract)

    console.log(JSON.stringify({
      status: 'ok',
      mode: args.mode,
      packages: reports
    }, null, 2))
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed',
      failures: [readErrorMessage(error)]
    }, null, 2))
    process.exitCode = 1
  }
}

/** 把 CLI 参数解析为唯一运行模式。 */
function parseArguments(args) {
  if (args.length === 1 && args[0] === '--check-source-manifests') {
    return { mode: 'source' }
  }

  const artifactManifest = readOption(args, '--artifact-manifest')
  const tarball = readOption(args, '--tarball')
  const packageName = readOption(args, '--package-name')

  if (artifactManifest !== undefined && args.length === 2) {
    return { mode: 'artifact', artifactManifest }
  }
  if (tarball !== undefined && packageName !== undefined && args.length === 4) {
    return { mode: 'tarball', tarball, packageName }
  }

  throw new Error('usage: check-package-artifacts.mjs --check-source-manifests | --artifact-manifest <path> | --tarball <path> --package-name <name>')
}

/** 读取一个不允许重复的 CLI option。 */
function readOption(args, name) {
  const indexes = []

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      indexes.push(index)
    }
  }
  if (indexes.length === 0) {
    return undefined
  }
  if (indexes.length !== 1 || indexes[0] === args.length - 1) {
    throw new Error(`${name} must be provided exactly once with a value`)
  }

  return args[indexes[0] + 1]
}

/** 按运行模式选择 source 或 tarball 校验。 */
function selectReports(args, contract) {
  if (args.mode === 'source') {
    return contract.packages.map(checkSourcePackage)
  }
  if (args.mode === 'tarball') {
    return [checkExplicitTarball(contract, args.packageName, args.tarball)]
  }

  return checkArtifactManifest(contract, args.artifactManifest)
}

/** 校验单个 source manifest 与机器 contract 一致。 */
function checkSourcePackage(packageContract) {
  const manifestPath = join(repoRoot, packageContract.workspacePath, 'package.json')
  const manifest = readJson(manifestPath, 'source package.json')
  const failures = []

  compareValue(failures, 'name', manifest.name, packageContract.name)
  compareValue(failures, 'version', manifest.version, packageContract.version)
  compareValue(failures, 'private', manifest.private, packageContract.private)
  compareValue(failures, 'type', manifest.type, 'module')
  compareValue(failures, 'publishConfig.access', manifest.publishConfig?.access, packageContract.sourceAccess)
  compareJson(failures, 'files', manifest.files, packageContract.files)
  compareJson(failures, 'exports', manifest.exports, contractExports(packageContract))
  compareJson(failures, 'sideEffects', manifest.sideEffects, packageContract.sideEffects)
  compareJson(failures, 'dependencies', manifest.dependencies ?? {}, sourceDependencies(packageContract))
  compareJson(failures, 'peerDependencies', manifest.peerDependencies ?? {}, sourcePeerDependencies(packageContract))
  throwFailures(packageContract.name, failures)

  return {
    name: packageContract.name,
    sourceManifest: relative(repoRoot, manifestPath),
    status: 'ok'
  }
}

/** 从 contract 还原 source manifest 的 dependency 映射。 */
function sourceDependencies(packageContract) {
  return mergeDependencyGroups(
    firstPartyVersions(packageContract.dependencyPolicy.firstParty, 'workspace:*'),
    packageContract.dependencyPolicy.external
  )
}

/** 从 contract 还原 source manifest 的 peer dependency 映射。 */
function sourcePeerDependencies(packageContract) {
  return mergeDependencyGroups(
    firstPartyVersions(packageContract.dependencyPolicy.firstPartyPeers, 'workspace:*'),
    packageContract.dependencyPolicy.externalPeers
  )
}

/** 生成一组 first-party dependency 的固定版本映射。 */
function firstPartyVersions(names, version) {
  const result = {}

  for (const name of names) {
    result[name] = version
  }

  return result
}

/** 按 ASCII key 合并两组 dependency。 */
function mergeDependencyGroups(left, right) {
  const result = {}

  for (const name of Object.keys({ ...left, ...right }).sort()) {
    result[name] = left[name] ?? right[name]
  }

  return result
}

/** 把 contract export 数组还原为 manifest export map。 */
function contractExports(packageContract) {
  const exports = {}

  for (const entry of packageContract.exports) {
    exports[entry.subpath] = entry.target
  }

  return exports
}

/** 校验 artifact manifest 中声明的全部 tarball。 */
function checkArtifactManifest(contract, manifestPath) {
  const absoluteManifestPath = resolve(manifestPath)
  const artifactManifest = readJson(absoluteManifestPath, 'artifact manifest')
  const packages = artifactManifest.packages ?? artifactManifest.artifactIdentity?.packages

  if (!Array.isArray(packages)) {
    throw new Error('artifact manifest packages must be an array')
  }

  /** 校验 artifact manifest 中的单个 package entry。 */
  function checkArtifactPackage(entry) {
    if (typeof entry?.name !== 'string' || typeof entry?.tarballFile !== 'string') {
      throw new Error('artifact manifest package entries require name and tarballFile')
    }

    const tarballPath = resolve(dirname(absoluteManifestPath), entry.tarballFile)
    assertPathInside(dirname(absoluteManifestPath), tarballPath, 'artifact tarball')
    const report = checkExplicitTarball(contract, entry.name, tarballPath)

    if (typeof entry.tarballSha256 === 'string') {
      if (report.tarballSha256 !== entry.tarballSha256) {
        throw new Error(`${entry.name}: tarballSha256 mismatch`)
      }
    }

    return report
  }

  const reports = packages.map(checkArtifactPackage)
  const actualNames = reports.map(readReportName).sort()
  const expectedNames = contract.packages.map(readContractName).sort()

  compareJsonOrThrow('artifact package set', actualNames, expectedNames)
  return reports
}

/** 读取 scanner report 中的 package name。 */
function readReportName(report) {
  return report.name
}

/** 读取 contract 中的 package name。 */
function readContractName(packageContract) {
  return packageContract.name
}

/** 校验调用方显式提供的单个 tarball。 */
function checkExplicitTarball(contract, packageName, tarballPath) {
  /** 判断 contract entry 是否为调用方指定的 package。 */
  function matchesPackage(entry) {
    return entry.name === packageName
  }

  const packageContract = contract.packages.find(matchesPackage)

  if (packageContract === undefined) {
    throw new Error(`${packageName}: package is not declared by the artifact contract`)
  }

  return scanTarball(resolve(tarballPath), packageContract)
}

/** 扫描 tarball 文件集合、packed manifest、export 实体和文本内容。 */
function scanTarball(tarballPath, packageContract) {
  const archive = listTarball(tarballPath)
  const failures = []

  if (!archive.files.includes('package.json')) {
    failures.push('missing package.json')
  }

  for (const entry of archive.entries) {
    checkArchiveEntry(failures, entry, packageContract)
  }
  checkRequiredPackageFiles(failures, archive.files, packageContract)

  const manifest = archive.files.includes('package.json')
    ? readTarballJson(tarballPath, 'package.json')
    : {}

  checkPackedManifest(failures, manifest, packageContract)
  checkExportTargets(failures, archive.files, packageContract)
  checkTarballText(failures, tarballPath, archive.files)
  checkNativeRegistry(failures, tarballPath, archive.files, packageContract)
  throwFailures(packageContract.name, failures)

  const tarballBytes = readFileSync(tarballPath)
  /** 记录 contract 允许 fixture 的 bytes 与 hash。 */
  function reportFixture(path) {
    const bytes = readTarballFile(tarballPath, path)

    return {
      path,
      bytes: bytes.byteLength,
      sha256: sha256(bytes)
    }
  }

  const fixtureReports = packageContract.fixtureAllowlist.map(reportFixture)

  return {
    name: packageContract.name,
    status: 'ok',
    tarball: tarballPath,
    tarballBytes: tarballBytes.byteLength,
    tarballSha256: sha256(tarballBytes),
    files: archive.files,
    fixtures: fixtureReports
  }
}

/** 读取 tarball 条目并拒绝非 regular file/directory 类型。 */
function listTarball(tarballPath) {
  const namesResult = runTar(['-tzf', tarballPath], 'list tarball paths')
  const verboseResult = runTar(['-tvzf', tarballPath], 'list tarball types')
  const rawNames = namesResult.stdout.split('\n').filter(Boolean)
  const verboseLines = verboseResult.stdout.split('\n').filter(Boolean)

  if (rawNames.length !== verboseLines.length) {
    throw new Error('tarball listing count mismatch')
  }

  /** 规范化一个 tar listing entry 并拒绝链接或特殊文件。 */
  function normalizeEntry(rawPath, index) {
    const type = verboseLines[index]?.[0]
    const normalized = normalizeArchivePath(rawPath)

    if (type !== '-' && type !== 'd') {
      throw new Error(`${normalized}: tarball links and special entries are forbidden`)
    }

    return {
      path: normalized,
      type: type === 'd' ? 'directory' : 'file'
    }
  }

  const entries = rawNames.map(normalizeEntry)
  const files = entries.filter(isFileEntry).map(readEntryPath).sort()

  if (new Set(files).size !== files.length) {
    throw new Error('tarball contains duplicate regular file paths')
  }

  return { entries, files }
}

/** 把 archive path 收敛为 package 根内的 POSIX 相对路径。 */
function normalizeArchivePath(rawPath) {
  const withoutDot = rawPath.startsWith('./') ? rawPath.slice(2) : rawPath
  const withoutRoot = withoutDot.startsWith('package/') ? withoutDot.slice('package/'.length) : withoutDot
  const relativePath = withoutRoot.endsWith('/') ? withoutRoot.slice(0, -1) : withoutRoot
  const normalized = relativePath === '' ? '.' : relativePath

  if (rawPath.startsWith('/') || rawPath.includes('\\') || normalized.split('/').includes('..')) {
    throw new Error('tarball contains an invalid package path')
  }

  return normalized
}

/** 判断 archive entry 是否为 regular file。 */
function isFileEntry(entry) {
  return entry.type === 'file'
}

/** 读取 archive entry path。 */
function readEntryPath(entry) {
  return entry.path
}

/** 校验单个 archive entry 是否属于允许内容。 */
function checkArchiveEntry(failures, entry, packageContract) {
  if (entry.type === 'directory') {
    return
  }
  if (!isAllowedFile(entry.path, packageContract)) {
    failures.push(`${entry.path}: file is outside the package allowlist`)
  }
  if (isForbiddenPackageFile(entry.path, packageContract.fixtureAllowlist)) {
    failures.push(`${entry.path}: source, test, fixture, map, or build file is forbidden`)
  }
}

/** 校验 contract 声明的根级必需文件实际存在。 */
function checkRequiredPackageFiles(failures, files, packageContract) {
  if (packageContract.files.includes('README.md') && !files.includes('README.md')) {
    failures.push('README.md: required package file is missing')
  }
}

/** 判断文件是否属于 contract 允许的 package 内容。 */
function isAllowedFile(path, packageContract) {
  if (path === 'package.json') {
    return true
  }
  if (path.startsWith('dist/') && packageContract.files.includes('dist')) {
    return true
  }
  if (path === 'README.md' && packageContract.files.includes('README.md')) {
    return true
  }

  return packageContract.fixtureAllowlist.includes(path)
}

/** 判断文件名是否违反统一发布边界。 */
function isForbiddenPackageFile(path, fixtureAllowlist) {
  if (path.startsWith('src/') || testPathPattern.test(path)) {
    return true
  }
  if (path.startsWith('fixtures/') && !fixtureAllowlist.includes(path)) {
    return true
  }
  if (path.endsWith('.map') || path.includes('/__snapshots__/')) {
    return true
  }
  if (sourceTypeScriptPattern.test(path) && !declarationPattern.test(path)) {
    return true
  }

  return /(^|\/)(?:rollup|tsup|vite|webpack)\.config\.|(^|\/)(?:scripts|tools)\//u.test(path)
}

/** 校验 packed manifest 的名称、版本、出口和依赖策略。 */
function checkPackedManifest(failures, manifest, packageContract) {
  compareValue(failures, 'manifest name', manifest.name, packageContract.name)
  compareValue(failures, 'manifest version', manifest.version, packageContract.version)
  compareValue(failures, 'manifest private', manifest.private, packageContract.private)
  compareValue(failures, 'manifest type', manifest.type, 'module')
  compareValue(failures, 'manifest access', manifest.publishConfig?.access, packageContract.sourceAccess)
  compareJson(failures, 'manifest files', manifest.files, packageContract.files)
  compareJson(failures, 'manifest exports', manifest.exports, contractExports(packageContract))
  compareJson(failures, 'manifest sideEffects', manifest.sideEffects, packageContract.sideEffects)
  compareJson(failures, 'manifest dependencies', manifest.dependencies ?? {}, packedDependencies(packageContract))
  compareJson(failures, 'manifest peerDependencies', manifest.peerDependencies ?? {}, packedPeerDependencies(packageContract))

  if (manifest.scripts !== undefined || manifest.devDependencies !== undefined) {
    failures.push('manifest lifecycle/build scripts and devDependencies are forbidden')
  }

  const manifestText = JSON.stringify(manifest)
  for (const marker of ['workspace:', 'link:', 'file:', '../', 'packages/']) {
    if (manifestText.includes(marker)) {
      failures.push(`manifest contains forbidden repository dependency marker: ${marker}`)
    }
  }
}

/** 生成 packed manifest 的 dependency 映射。 */
function packedDependencies(packageContract) {
  return mergeDependencyGroups(
    firstPartyVersions(packageContract.dependencyPolicy.firstParty, packageContract.version),
    packageContract.dependencyPolicy.external
  )
}

/** 生成 packed manifest 的 peer dependency 映射。 */
function packedPeerDependencies(packageContract) {
  return mergeDependencyGroups(
    firstPartyVersions(packageContract.dependencyPolicy.firstPartyPeers, packageContract.version),
    packageContract.dependencyPolicy.externalPeers
  )
}

/** 校验 contract 声明的所有 export target 都有实体文件。 */
function checkExportTargets(failures, files, packageContract) {
  const fileSet = new Set(files)

  for (const exportEntry of packageContract.exports) {
    for (const target of exportTargetPaths(exportEntry.target)) {
      const path = target.startsWith('./') ? target.slice(2) : target

      if (!fileSet.has(path)) {
        failures.push(`${path}: exported target is missing`)
      }
    }
  }
}

/** 展开 string 或 types/import export target。 */
function exportTargetPaths(target) {
  if (typeof target === 'string') {
    return [target]
  }

  return [target.types, target.import]
}

/** 扫描 tarball 文本中的 sourcemap 与秘密标签。 */
function checkTarballText(failures, tarballPath, files) {
  const secretMarkers = readSecretMarkers()

  for (const file of files) {
    const bytes = readTarballFile(tarballPath, file)

    if (bytes.includes('sourcesContent')) {
      failures.push(`${file}: sourcesContent marker is forbidden`)
    }
    if (bytes.includes('sourceMappingURL')) {
      failures.push(`${file}: sourceMappingURL marker is forbidden`)
    }
    for (const marker of secretMarkers) {
      if (marker.value !== '' && bytes.includes(marker.value)) {
        failures.push(`${file}: ${marker.label}`)
      }
    }
  }
}

/** 读取已知私钥和 test signer 标签，不把值写入报告。 */
function readSecretMarkers() {
  const markers = [
    { label: 'private key material', value: '-----BEGIN PRIVATE KEY-----' },
    { label: 'RSA private key material', value: '-----BEGIN RSA PRIVATE KEY-----' },
    { label: 'EC private key material', value: '-----BEGIN EC PRIVATE KEY-----' },
    { label: 'OpenSSH private key material', value: '-----BEGIN OPENSSH PRIVATE KEY-----' },
    { label: 'test signer identifier', value: 'createInsecureTestOnlyJWordLicenseSignature' },
    { label: 'test JWL2 signer identifier', value: 'createInsecureTestOnlyJwl2Token' },
    { label: 'test private seed identifier', value: 'INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED' },
    { label: 'test JWL2 private seed identifier', value: 'TEST_ONLY_JWL2_PRIVATE_KEY_SEED' },
    { label: 'production Ed25519 signer identifier', value: 'signEd25519' },
    { label: 'production license signer identifier', value: 'createJWordLicenseSignature' }
  ]
  const fixtureSources = [
    readFileSync(join(repoRoot, 'fixtures/license/insecure-test-only-keys.ts'), 'utf8'),
    readFileSync(join(repoRoot, 'fixtures/license/test-only-jwl2-fixture.ts'), 'utf8')
  ]

  markers.push(...readQuotedConstants(fixtureSources[0], [
    ['INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED', 'test private seed value'],
    ['INSECURE_TEST_ONLY_LICENSE_PUBLIC_KEY', 'test public key value']
  ]))
  markers.push(...readQuotedConstants(fixtureSources[1], [
    ['TEST_ONLY_JWL2_PRIVATE_KEY_SEED', 'test JWL2 private seed value'],
    ['TEST_ONLY_JWL2_PUBLIC_KEY', 'test JWL2 public key value'],
    ['TEST_ONLY_JWL2_TOKEN', 'test JWL2 token value'],
    ['TEST_ONLY_JWL2_KEY_ID', 'test JWL2 key id value']
  ]))

  return markers
}

/** 从受控 fixture source 读取指定字符串常量。 */
function readQuotedConstants(source, definitions) {
  /** 从单个常量定义读取秘密标签但不返回常量名。 */
  function readDefinition(definition) {
    const [name, label] = definition
    const expression = new RegExp(`(?:const|let)\\s+${name}\\s*=\\s*['"]([^'"]+)['"]`, 'u')
    const match = source.match(expression)

    if (match?.[1] === undefined) {
      throw new Error(`cannot read secret marker label: ${label}`)
    }

    return { label, value: match[1] }
  }

  return definitions.map(readDefinition)
}

/** 校验 native registry 唯一例外的 bytes 与根 fixture 一致。 */
function checkNativeRegistry(failures, tarballPath, files, packageContract) {
  if (packageContract.name !== '@4xian/jword-native') {
    return
  }

  const registryPath = 'fixtures/registry.json'
  if (!files.includes(registryPath)) {
    failures.push(`${registryPath}: native registry is missing`)
    return
  }

  const packedBytes = readTarballFile(tarballPath, registryPath)
  const rootBytes = readFileSync(join(repoRoot, 'fixtures/native/registry.json'))

  if (!packedBytes.equals(rootBytes)) {
    failures.push(`${registryPath}: native registry bytes do not match the root registry`)
  }
}

/** 读取 tarball 内一个 JSON regular file。 */
function readTarballJson(tarballPath, path) {
  const source = readTarballFile(tarballPath, path).toString('utf8')

  try {
    return JSON.parse(source)
  } catch {
    throw new Error(`${path}: invalid JSON`)
  }
}

/** 读取 tarball 内一个已校验相对路径的原始 bytes。 */
function readTarballFile(tarballPath, path) {
  const result = spawnSync('tar', ['-xOzf', tarballPath, `package/${path}`], {
    cwd: repoRoot,
    encoding: null,
    maxBuffer: 16 * 1024 * 1024
  })

  if (result.status !== 0 || result.stdout === null) {
    throw new Error(`${path}: cannot read tarball file`)
  }

  return result.stdout
}

/** 执行只读 tar 命令并收敛诊断。 */
function runTar(args, label) {
  const result = spawnSync('tar', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024
  })

  if (result.status !== 0) {
    throw new Error(`${label} failed`)
  }

  return result
}

/** 断言目标路径保持在指定根目录内。 */
function assertPathInside(root, target, label) {
  const relativePath = relative(resolve(root), resolve(target))

  if (relativePath === '' || relativePath === '..' || relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(relativePath)) {
    throw new Error(`${label} must be a file inside the artifact root`)
  }
}

/** 收集单值不一致错误。 */
function compareValue(failures, label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label} does not match the artifact contract`)
  }
}

/** 收集 JSON 结构不一致错误。 */
function compareJson(failures, label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label} does not match the artifact contract`)
  }
}

/** 对 JSON 结构不一致直接 fail closed。 */
function compareJsonOrThrow(label, actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} does not match the artifact contract`)
  }
}

/** 在单个 package 扫描结束时聚合失败标签。 */
function throwFailures(packageName, failures) {
  if (failures.length > 0) {
    throw new Error(`${packageName}: ${failures.join('; ')}`)
  }
}

/** 读取外部 JSON 文件并收敛解析诊断。 */
function readJson(path, label) {
  const source = readFileSync(path, 'utf8')

  try {
    return JSON.parse(source)
  } catch {
    throw new Error(`${label}: invalid JSON`)
  }
}

/** 计算原始 bytes 的小写 SHA-256。 */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 把 unknown error 收敛为无秘密的稳定消息。 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'unknown artifact scanner failure'
}

main()
