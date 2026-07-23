/**
 * 职责：提供 Phase 3 artifact identity、字节格式、环境和 clean 状态的共享实现。
 * 边界：只处理调用方提供的结构化数据、文件 bytes 与只读 Git/tool 查询。
 * 协作模块：artifact builder、compare、consumer/audit/final verifier 与 architecture tests。
 * 性能/安全约束：不构建、不打包、不发布，不输出文件内容或秘密值。
 * 实现说明：所有 JSON 都使用同一 canonical serialization，所有校验都 fail closed。
 */
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path'

const HASH_PATTERN = /^[a-f0-9]{64}$/u
const GIT_SHA_PATTERN = /^[a-f0-9]{40}$/u
const TARBALL_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/u
const SOURCE_COMMANDS = [
  { id: 'lint', command: 'pnpm lint' },
  { id: 'typecheck', command: 'pnpm typecheck' },
  { id: 'test-types', command: 'pnpm test:types' }
]
const TEST_COMMANDS = [
  { id: 'direct-vitest', command: 'pnpm exec vitest run --passWithNoTests' },
  { id: 'e2e', command: 'pnpm test:e2e' },
  { id: 'visual', command: 'pnpm test:visual' },
  { id: 'bench', command: 'pnpm bench' }
]

/** 把 JSON value 编码为冻结的 canonical UTF-8 bytes。 */
export function canonicalBytes(value) {
  return Buffer.from(JSON.stringify(canonicalValue(value)))
}

/** 递归复制并按 ASCII key 排序，同时拒绝非法 number/value。 */
function canonicalValue(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    assertNonNegativeSafeInteger(value, 'canonical number')
    return value
  }
  if (Array.isArray(value)) {
    return value.map(canonicalValue)
  }
  if (typeof value !== 'object') {
    throw new Error('canonical JSON contains an unsupported value')
  }

  const result = {}
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) {
      throw new Error('canonical JSON contains undefined')
    }
    result[key] = canonicalValue(value[key])
  }

  return result
}

/** 计算原始 bytes 的小写 SHA-256。 */
export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** 读取文件原始 bytes 的 SHA-256。 */
export function sha256File(path) {
  return sha256(readFileSync(path))
}

/** 生成精确 `<hash><LF>` sidecar bytes。 */
export function createSha256Sidecar(bytes) {
  return Buffer.from(`${sha256(bytes)}\n`)
}

/** 校验 sidecar 原始 bytes 并返回被绑定文件的 hash。 */
export function validateSha256Sidecar(sidecarBytes, targetBytes, label) {
  const expectedHash = sha256(targetBytes)
  const expectedBytes = Buffer.from(`${expectedHash}\n`)

  if (!sidecarBytes.equals(expectedBytes)) {
    throw new Error(`${label} sidecar bytes are invalid`)
  }

  return expectedHash
}

/** 使用调用方读取的工具版本和当前 Node 进程生成冻结环境。 */
export function readPhase3Environment(versions) {
  assertExactKeys(versions, ['node', 'npm', 'pnpm'], 'tool versions')
  for (const key of ['node', 'npm', 'pnpm']) {
    if (typeof versions[key] !== 'string' || versions[key] === '' || /[\r\n]/u.test(versions[key])) {
      throw new Error(`environment ${key} version is invalid`)
    }
  }

  return {
    node: versions.node,
    npm: versions.npm,
    pnpm: versions.pnpm,
    os: process.platform,
    arch: process.arch
  }
}

/** 校验 environment 精确字段和值，不做大小写或平台归一化。 */
export function validatePhase3Environment(environment, requireCurrentPlatform = true) {
  assertExactKeys(environment, ['arch', 'node', 'npm', 'os', 'pnpm'], 'artifact environment')
  for (const key of ['node', 'npm', 'pnpm', 'os', 'arch']) {
    if (typeof environment[key] !== 'string' || environment[key] === '' || /[\r\n]/u.test(environment[key])) {
      throw new Error(`artifact environment ${key} is invalid`)
    }
  }
  if (!requireCurrentPlatform) {
    return environment
  }
  const expected = readPhase3Environment({
    node: environment.node,
    npm: environment.npm,
    pnpm: environment.pnpm
  })

  if (canonicalBytes(environment).compare(canonicalBytes(expected)) !== 0) {
    throw new Error('artifact environment does not match the current process')
  }

  return environment
}

/** 校验 tarballFile 是完整 ASCII basename 且后缀精确为 `.tgz`。 */
export function validateTarballFile(tarballFile) {
  if (typeof tarballFile !== 'string' || !TARBALL_FILE_PATTERN.test(tarballFile)) {
    throw new Error('tarballFile is invalid')
  }

  return tarballFile
}

/** 从排序后的完整 files 数组生成 payload hash。 */
export function createPayloadSha256(files) {
  validateFiles(files)
  return sha256(canonicalBytes(files))
}

/** 生成按 tarballFile ASCII 排序且格式精确的 SHA256SUMS bytes。 */
export function createSha256Sums(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('checksum package set must not be empty')
  }

  const entries = packages.map(function readChecksumEntry(packageEntry) {
    validateTarballFile(packageEntry.tarballFile)
    assertHash(packageEntry.tarballSha256, 'tarballSha256')
    return { tarballFile: packageEntry.tarballFile, tarballSha256: packageEntry.tarballSha256 }
  }).sort(compareTarballFile)

  assertUnique(entries.map(readTarballFile), 'tarballFile')
  return Buffer.from(entries.map(formatChecksumEntry).join(''))
}

/** 校验 SHA256SUMS 原始 bytes 并返回其 SHA-256。 */
export function validateSha256Sums(checksumBytes, packages) {
  const expectedBytes = createSha256Sums(packages)

  if (!Buffer.isBuffer(checksumBytes) || !checksumBytes.equals(expectedBytes)) {
    throw new Error('SHA256SUMS bytes are invalid')
  }

  return sha256(checksumBytes)
}

/** 用唯一 artifactIdentity preimage 创建最终 manifest。 */
export function createArtifactManifest(artifactIdentity, runMetadata) {
  validateArtifactIdentity(artifactIdentity)
  validateRunMetadata(runMetadata)

  return {
    artifactIdentity,
    artifactSetId: sha256(canonicalBytes(artifactIdentity)),
    runMetadata
  }
}

/** 校验最终 manifest、checksum 与 artifactSetId 完整一致。 */
export function validateArtifactManifest(manifest, checksumBytes) {
  return validateArtifactManifestRecord(manifest, checksumBytes, true)
}

/** 校验 compare 输入但不把当前进程平台冒充为 artifact 平台。 */
export function validateArtifactManifestForComparison(manifest, checksumBytes) {
  return validateArtifactManifestRecord(manifest, checksumBytes, false)
}

/** 按调用方环境策略校验 manifest、checksum 与 artifactSetId。 */
function validateArtifactManifestRecord(manifest, checksumBytes, requireCurrentPlatform) {
  assertExactKeys(manifest, ['artifactIdentity', 'artifactSetId', 'runMetadata'], 'artifact manifest')
  validateArtifactIdentity(manifest.artifactIdentity, requireCurrentPlatform)
  validateRunMetadata(manifest.runMetadata)
  assertHash(manifest.artifactSetId, 'artifactSetId')

  const checksumHash = validateSha256Sums(checksumBytes, manifest.artifactIdentity.packages)
  if (manifest.artifactIdentity.sha256SumsSha256 !== checksumHash) {
    throw new Error('artifact manifest checksum hash mismatch')
  }
  if (manifest.artifactSetId !== sha256(canonicalBytes(manifest.artifactIdentity))) {
    throw new Error('artifactSetId mismatch')
  }

  return manifest
}

/** 创建 run-a 根目录的固定 artifact binding。 */
export function createArtifactBinding(fields) {
  assertExactKeys(fields, [
    'artifactManifestSha256',
    'artifactSetId',
    'gitSha',
    'lockfileSha256',
    'sha256SumsSha256',
    'sourceReportSha256',
    'testReportSha256'
  ], 'artifact binding fields')

  return { schemaVersion: 1, ...fields }
}

/** 校验 binding schema、manifest raw hash、ID 与 checksum。 */
export function validateArtifactBinding(binding, manifestBytes, manifest, checksumBytes) {
  return validateArtifactBindingRecord(binding, manifestBytes, manifest, checksumBytes, true)
}

/** 校验 compare 左侧 binding，但不重新探测 artifact 的平台。 */
export function validateArtifactBindingForComparison(binding, manifestBytes, manifest, checksumBytes) {
  return validateArtifactBindingRecord(binding, manifestBytes, manifest, checksumBytes, false)
}

/** 按调用方环境策略校验 binding 与 manifest。 */
function validateArtifactBindingRecord(binding, manifestBytes, manifest, checksumBytes, requireCurrentPlatform) {
  assertExactKeys(binding, [
    'artifactManifestSha256',
    'artifactSetId',
    'gitSha',
    'lockfileSha256',
    'schemaVersion',
    'sha256SumsSha256',
    'sourceReportSha256',
    'testReportSha256'
  ], 'artifact binding')
  if (binding.schemaVersion !== 1) {
    throw new Error('artifact binding schemaVersion is invalid')
  }
  for (const key of [
    'artifactManifestSha256',
    'artifactSetId',
    'lockfileSha256',
    'sha256SumsSha256',
    'sourceReportSha256',
    'testReportSha256'
  ]) {
    assertHash(binding[key], `binding ${key}`)
  }
  assertGitSha(binding.gitSha, 'binding gitSha')
  validateArtifactManifestRecord(manifest, checksumBytes, requireCurrentPlatform)

  if (binding.gitSha !== manifest.artifactIdentity.gitSha ||
      binding.lockfileSha256 !== manifest.artifactIdentity.lockfileSha256 ||
      binding.artifactSetId !== manifest.artifactSetId ||
      binding.artifactManifestSha256 !== sha256(manifestBytes) ||
      binding.sha256SumsSha256 !== sha256(checksumBytes)) {
    throw new Error('artifact binding does not match the manifest')
  }

  return binding
}

/** 校验 source report 的精确 schema、环境和三条命令。 */
export function validateSourceReport(report, expected) {
  assertExactKeys(report, [
    'clean',
    'commands',
    'environment',
    'gitSha',
    'lockfileSha256',
    'schemaVersion'
  ], 'source report')
  if (report.schemaVersion !== 1 || report.clean !== true) {
    throw new Error('source report status is invalid')
  }
  assertGitSha(report.gitSha, 'source report gitSha')
  assertHash(report.lockfileSha256, 'source report lockfileSha256')
  validatePhase3Environment(report.environment)
  validateCommands(report.commands, SOURCE_COMMANDS, 'source report')

  if (expected !== undefined && (report.gitSha !== expected.gitSha ||
      report.lockfileSha256 !== expected.lockfileSha256 ||
      canonicalBytes(report.environment).compare(canonicalBytes(expected.environment)) !== 0)) {
    throw new Error('source report identity mismatch')
  }

  return report
}

/** 校验 test report 的精确 schema、identity 和四条命令。 */
export function validateTestReport(report, expected) {
  assertExactKeys(report, ['artifactSetId', 'commands', 'gitSha', 'schemaVersion'], 'test report')
  if (report.schemaVersion !== 1) {
    throw new Error('test report schemaVersion is invalid')
  }
  assertGitSha(report.gitSha, 'test report gitSha')
  assertHash(report.artifactSetId, 'test report artifactSetId')
  validateCommands(report.commands, TEST_COMMANDS, 'test report')

  if (report.gitSha !== expected.gitSha || report.artifactSetId !== expected.artifactSetId) {
    throw new Error('test report identity mismatch')
  }

  return report
}

/** 返回 source report 的固定命令定义。 */
export function sourceCommandDefinitions() {
  return SOURCE_COMMANDS.map(copyCommandDefinition)
}

/** 返回 canonical test report 的固定命令定义。 */
export function testCommandDefinitions() {
  return TEST_COMMANDS.map(copyCommandDefinition)
}

/** 写入不带尾随换行的 canonical JSON 文件并返回 bytes。 */
export function writeCanonicalJson(path, value) {
  const bytes = canonicalBytes(value)

  writeFileSync(path, bytes)
  return bytes
}

/** 读取 JSON 文件并用稳定标签收敛解析错误。 */
export function readJsonFile(path, label) {
  const bytes = readFileSync(path)

  try {
    return { bytes, value: JSON.parse(bytes.toString('utf8')) }
  } catch {
    throw new Error(`${label}: invalid JSON`)
  }
}

/** 执行冻结 Git status 命令并要求 stdout 为零 bytes。 */
export function assertPhase3Clean(repoRoot) {
  const result = spawnSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], {
    cwd: repoRoot,
    encoding: null
  })

  if (result.status !== 0) {
    throw new Error('cannot read Phase 3 Git status')
  }
  if (result.stdout.byteLength !== 0) {
    throw new Error('Phase 3 repository is not clean')
  }
}

/** 在首次创建前按物理父目录证明目标严格位于仓库外。 */
export function assertPhase3PathOutside(repoRoot, targetPath, label) {
  const requestedPath = resolve(targetPath)
  const remainingSegments = []
  let existingAncestor = requestedPath

  while (!existsSync(existingAncestor)) {
    remainingSegments.unshift(basename(existingAncestor))
    existingAncestor = dirname(existingAncestor)
  }

  const physicalRepoRoot = realpathSync(repoRoot)
  const physicalTarget = resolve(realpathSync(existingAncestor), ...remainingSegments)
  const relativePath = relative(physicalRepoRoot, physicalTarget)

  if (relativePath === '' || (!relativePath.startsWith(`..${sep}`) && relativePath !== '..') || !isAbsolute(physicalTarget)) {
    throw new Error(`${label} must be outside the repository`)
  }

  return requestedPath
}

/** 读取 clean repository 的 branch 与完整 HEAD SHA。 */
export function readGitIdentity(repoRoot) {
  const gitSha = readSingleLineCommand('git', ['rev-parse', 'HEAD'], repoRoot, 'Git HEAD')
  const branch = readSingleLineCommand('git', ['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot, 'Git branch')

  assertGitSha(gitSha, 'Git HEAD')
  if (branch === '') {
    throw new Error('Git branch is invalid')
  }

  return { gitSha, branch }
}

/** 读取 Node/npm/pnpm 精确版本并复用统一 environment helper。 */
export function readCurrentEnvironment(repoRoot) {
  return readPhase3Environment({
    node: readSingleLineCommand(process.execPath, ['--version'], repoRoot, 'Node version'),
    npm: readSingleLineCommand('npm', ['--version'], repoRoot, 'npm version'),
    pnpm: readSingleLineCommand('pnpm', ['--version'], repoRoot, 'pnpm version')
  })
}

/** 校验 package inventory 的精确字段和排序。 */
function validatePackages(packages) {
  if (!Array.isArray(packages) || packages.length === 0) {
    throw new Error('artifact packages must not be empty')
  }

  const names = []
  for (const packageEntry of packages) {
    assertExactKeys(packageEntry, [
      'delivery',
      'files',
      'name',
      'packedManifestSha256',
      'payloadSha256',
      'tarballBytes',
      'tarballFile',
      'tarballSha256',
      'version'
    ], 'artifact package')
    if (typeof packageEntry.name !== 'string' || packageEntry.name === '' || packageEntry.version !== '0.0.0') {
      throw new Error('artifact package identity is invalid')
    }
    if (!['npm-public', 'npm-restricted', 'docker-image-internal'].includes(packageEntry.delivery)) {
      throw new Error('artifact package delivery is invalid')
    }
    validateTarballFile(packageEntry.tarballFile)
    assertHash(packageEntry.tarballSha256, 'tarballSha256')
    assertHash(packageEntry.packedManifestSha256, 'packedManifestSha256')
    assertHash(packageEntry.payloadSha256, 'payloadSha256')
    assertNonNegativeSafeInteger(packageEntry.tarballBytes, 'tarballBytes')
    validateFiles(packageEntry.files)
    if (packageEntry.payloadSha256 !== sha256(canonicalBytes(packageEntry.files))) {
      throw new Error('package payloadSha256 mismatch')
    }
    names.push(packageEntry.name)
  }

  assertUnique(names, 'package name')
  assertAsciiSorted(names, 'artifact packages')
}

/** 校验 files 精确字段、POSIX path、排序、hash 与 bytes。 */
function validateFiles(files) {
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('package files must not be empty')
  }

  const paths = []
  for (const file of files) {
    assertExactKeys(file, ['bytes', 'path', 'sha256'], 'artifact file')
    if (typeof file.path !== 'string' || file.path === '' || isAbsolute(file.path) ||
        file.path.includes('\\') || file.path.split('/').some(isInvalidPathSegment)) {
      throw new Error('artifact file path is invalid')
    }
    assertHash(file.sha256, 'file sha256')
    assertNonNegativeSafeInteger(file.bytes, 'file bytes')
    paths.push(file.path)
  }

  assertUnique(paths, 'file path')
  assertAsciiSorted(paths, 'artifact files')
}

/** 校验 artifactIdentity 的唯一 preimage schema。 */
function validateArtifactIdentity(identity, requireCurrentPlatform = true) {
  assertExactKeys(identity, [
    'builderSha256',
    'contractSha256',
    'environment',
    'gitSha',
    'lockfileSha256',
    'packages',
    'schemaVersion',
    'sha256SumsSha256'
  ], 'artifact identity')
  if (identity.schemaVersion !== 1) {
    throw new Error('artifact identity schemaVersion is invalid')
  }
  assertGitSha(identity.gitSha, 'artifact gitSha')
  for (const key of ['lockfileSha256', 'contractSha256', 'builderSha256', 'sha256SumsSha256']) {
    assertHash(identity[key], `artifact ${key}`)
  }
  validatePhase3Environment(identity.environment, requireCurrentPlatform)
  validatePackages(identity.packages)
}

/** 校验 runMetadata 精确字段且不参与 artifactSetId。 */
function validateRunMetadata(metadata) {
  assertExactKeys(metadata, ['createdAt', 'executionRunId', 'outputDirectory'], 'run metadata')
  for (const key of ['createdAt', 'executionRunId', 'outputDirectory']) {
    if (typeof metadata[key] !== 'string' || metadata[key] === '') {
      throw new Error(`run metadata ${key} is invalid`)
    }
  }
}

/** 校验命令集合、顺序、exitCode 与 status。 */
function validateCommands(commands, definitions, label) {
  if (!Array.isArray(commands) || commands.length !== definitions.length) {
    throw new Error(`${label} command set is invalid`)
  }

  for (let index = 0; index < definitions.length; index += 1) {
    const command = commands[index]
    const definition = definitions[index]

    assertExactKeys(command, ['command', 'exitCode', 'id', 'status'], `${label} command`)
    if (command.id !== definition.id || command.command !== definition.command ||
        command.exitCode !== 0 || command.status !== 'passed') {
      throw new Error(`${label} command result is invalid`)
    }
  }
}

/** 读取单行命令输出并拒绝空值或多行。 */
function readSingleLineCommand(command, args, cwd, label) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' })

  if (result.status !== 0) {
    throw new Error(`${label} command failed`)
  }
  const output = result.stdout.endsWith('\n') ? result.stdout.slice(0, -1) : result.stdout
  if (output === '' || /[\r\n]/u.test(output)) {
    throw new Error(`${label} output is invalid`)
  }

  return output
}

/** 复制固定 command definition，避免调用方修改模块常量。 */
function copyCommandDefinition(definition) {
  return { id: definition.id, command: definition.command }
}

/** 比较 checksum entry 的 tarballFile。 */
function compareTarballFile(left, right) {
  return compareAscii(left.tarballFile, right.tarballFile)
}

/** 读取 checksum entry 的 tarballFile。 */
function readTarballFile(entry) {
  return entry.tarballFile
}

/** 格式化单行 checksum。 */
function formatChecksumEntry(entry) {
  return `${entry.tarballSha256}  ${entry.tarballFile}\n`
}

/** 判断路径段是否为禁止的空段、`.` 或 `..`。 */
function isInvalidPathSegment(segment) {
  return segment === '' || segment === '.' || segment === '..'
}

/** 断言 object 恰好包含给定 key 集合。 */
function assertExactKeys(value, expectedKeys, label) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys.slice().sort())) {
    throw new Error(`${label} fields are invalid`)
  }
}

/** 断言值是非负安全整数。 */
function assertNonNegativeSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
}

/** 断言值是小写 SHA-256。 */
function assertHash(value, label) {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

/** 断言值是小写完整 Git SHA。 */
function assertGitSha(value, label) {
  if (typeof value !== 'string' || !GIT_SHA_PATTERN.test(value)) {
    throw new Error(`${label} is invalid`)
  }
}

/** 断言字符串数组没有重复项。 */
function assertUnique(values, label) {
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} contains duplicates`)
  }
}

/** 断言字符串数组已按 ASCII 升序排列。 */
function assertAsciiSorted(values, label) {
  const sorted = values.slice().sort()

  if (JSON.stringify(values) !== JSON.stringify(sorted)) {
    throw new Error(`${label} are not ASCII sorted`)
  }
}

/** 使用冻结 ASCII/code-point 顺序比较两个字符串。 */
function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}
