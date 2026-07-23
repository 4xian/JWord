/**
 * 职责：从同一干净提交生成 Phase 3 源报告、规范制品集或复现制品集。
 * 边界：读取当前工作目录仓库，只向仓库外空目录和内部临时暂存区写入。
 * 协作模块：包制品契约、统一扫描器、制品工具、B4 工作流与架构测试。
 * 性能/安全约束：不允许脏状态覆盖，不恢复或清理仓库，不执行发布、打标签、推送或 `pnpm test`。
 * 实现说明：每次只构建一次，每包只预检一次并打包一次。
 */
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertPhase3Clean,
  assertPhase3PathOutside,
  canonicalBytes,
  createArtifactBinding,
  createArtifactManifest,
  createPayloadSha256,
  createSha256Sidecar,
  createSha256Sums,
  readCurrentEnvironment,
  readGitIdentity,
  readJsonFile,
  sha256,
  sha256File,
  sourceCommandDefinitions,
  testCommandDefinitions,
  validateArtifactBinding,
  validateArtifactManifest,
  validateSha256Sidecar,
  validateSourceReport,
  validateTarballFile,
  writeCanonicalJson
} from './phase3-artifact-utils.mjs'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const scannerPath = join(scriptDirectory, 'check-package-artifacts.mjs')
const builderIdentityPaths = [
  'rollup.config.mjs',
  'tools/release/build-phase3-artifacts.mjs',
  'tools/release/check-package-artifacts.mjs',
  'tools/release/normalize-dist-relative-imports.mjs',
  'tools/release/phase3-artifact-utils.mjs'
]

/** 解析 CLI、执行唯一 purpose 并输出结构化摘要。 */
function main() {
  try {
    const options = parseArguments(process.argv.slice(2))
    const repoRoot = resolve(process.cwd())
    const outputDirectory = prepareOutputDirectory(repoRoot, options.outputDirectory)
    const result = options.purpose === 'source-report'
      ? buildSourceReport(repoRoot, outputDirectory)
      : buildArtifactSet(repoRoot, outputDirectory, options)

    console.log(JSON.stringify({ status: 'ok', purpose: options.purpose, ...result }))
  } catch (error) {
    console.error(JSON.stringify({
      status: 'failed',
      error: error instanceof Error ? error.message : 'unknown Phase 3 artifact builder failure'
    }))
    process.exitCode = 1
  }
}

/** 解析 source-report、canonical 或 reproducibility 的精确参数集合。 */
function parseArguments(args) {
  const purpose = readOption(args, '--purpose')
  const outputDirectory = readOption(args, '--out-dir')

  if (purpose === 'source-report' && args.length === 4) {
    return { purpose, outputDirectory }
  }
  if ((purpose === 'canonical' || purpose === 'reproducibility') && args.length === 8) {
    return {
      purpose,
      outputDirectory,
      sourceReport: readOption(args, '--source-report'),
      sourceReportSha256: readOption(args, '--source-report-sha256')
    }
  }

  throw new Error('usage: build-phase3-artifacts.mjs --purpose <source-report|canonical|reproducibility> --out-dir <path> [--source-report <path> --source-report-sha256 <path>]')
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

/** 创建或校验 repo 外空输出目录。 */
function prepareOutputDirectory(repoRoot, requestedPath) {
  const outputDirectory = assertPhase3PathOutside(repoRoot, requestedPath, 'output directory')

  mkdirSync(outputDirectory, { recursive: true })
  if (!lstatSync(outputDirectory).isDirectory() || readdirSync(outputDirectory).length !== 0) {
    throw new Error('output directory must be empty')
  }

  return outputDirectory
}

/** 执行三条 source gate，并仅在全部 clean 时写 report 与 sidecar。 */
function buildSourceReport(repoRoot, outputDirectory) {
  assertPhase3Clean(repoRoot)
  const identity = readRepositoryIdentity(repoRoot)
  const commands = []

  for (const definition of sourceCommandDefinitions()) {
    commands.push(runFixedCommand(repoRoot, definition))
  }
  assertPhase3Clean(repoRoot)

  const report = {
    schemaVersion: 1,
    clean: true,
    gitSha: identity.gitSha,
    lockfileSha256: identity.lockfileSha256,
    environment: identity.environment,
    commands
  }
  const reportBytes = canonicalBytes(report)
  const reportPath = join(outputDirectory, 'source-report.json')
  const sidecarPath = join(outputDirectory, 'source-report.json.sha256')

  writeFileSync(reportPath, reportBytes)
  writeFileSync(sidecarPath, createSha256Sidecar(reportBytes))

  return { gitSha: identity.gitSha, sourceReportSha256: sha256(reportBytes) }
}

/** 从已验证 source report 生成 canonical 或 reproducibility artifact set。 */
function buildArtifactSet(repoRoot, outputDirectory, options) {
  assertPhase3Clean(repoRoot)
  const identity = readRepositoryIdentity(repoRoot)
  const sourceReport = readAndValidateSourceReport(options, identity)
  const contractPath = join(repoRoot, 'tools/release/package-artifact-contract.json')
  const contract = readJsonFile(contractPath, 'package artifact contract').value

  validateRootBuildCommand(repoRoot)
  runRequiredCommand(repoRoot, 'pnpm', ['build'], 'pnpm build')
  assertPhase3Clean(repoRoot)

  const stagingRoot = mkdtempSync(join(dirname(outputDirectory), '.phase3-staging-'))

  try {
    const packages = buildPackages(repoRoot, outputDirectory, stagingRoot, contract)

    assertPhase3Clean(repoRoot)
    const checksumBytes = createSha256Sums(packages)
    const checksumPath = join(outputDirectory, 'SHA256SUMS')

    writeFileSync(checksumPath, checksumBytes)
    const artifactIdentity = {
      schemaVersion: 1,
      gitSha: identity.gitSha,
      lockfileSha256: identity.lockfileSha256,
      contractSha256: sha256File(contractPath),
      builderSha256: readBuilderSha256(repoRoot),
      environment: identity.environment,
      sha256SumsSha256: sha256(checksumBytes),
      packages
    }
    const manifest = createArtifactManifest(artifactIdentity, {
      createdAt: new Date().toISOString(),
      executionRunId: readExecutionRunId(options.purpose),
      outputDirectory
    })
    const manifestPath = join(outputDirectory, 'artifact-manifest.json')
    const manifestBytes = writeCanonicalJson(manifestPath, manifest)

    validateArtifactManifest(readJsonFile(manifestPath, 'artifact manifest').value, readFileSync(checksumPath))
    if (sha256(readFileSync(manifestPath)) !== sha256(manifestBytes)) {
      throw new Error('artifact manifest changed after write')
    }

    if (options.purpose === 'canonical') {
      finishCanonicalRun(repoRoot, outputDirectory, sourceReport, manifest, manifestBytes, checksumBytes)
    }

    return { gitSha: identity.gitSha, artifactSetId: manifest.artifactSetId, packages: packages.length }
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

/** 读取 source report/sidecar 并绑定当前 repository identity。 */
function readAndValidateSourceReport(options, identity) {
  const reportBytes = readFileSync(resolve(options.sourceReport))
  const sidecarBytes = readFileSync(resolve(options.sourceReportSha256))
  const sourceReportSha256 = validateSha256Sidecar(sidecarBytes, reportBytes, 'source report')
  const report = parseJsonBytes(reportBytes, 'source report')

  validateSourceReport(report, identity)
  return { report, sourceReportSha256 }
}

/** 生成全部 staging package、dry-run、tarball、scanner 与 inventory。 */
function buildPackages(repoRoot, outputDirectory, stagingRoot, contract) {
  if (!Array.isArray(contract.packages) || contract.packages.length === 0) {
    throw new Error('package artifact contract has no packages')
  }

  const inventories = []
  for (const packageContract of contract.packages) {
    const stagingDirectory = join(stagingRoot, packageContract.name.replaceAll('/', '__'))

    createStagingPackage(repoRoot, stagingDirectory, packageContract)
    verifyDryRun(stagingDirectory)
    const tarballPath = packStagingPackage(stagingDirectory, outputDirectory)

    runScanner(tarballPath, packageContract.name)
    inventories.push(readTarballInventory(tarballPath, packageContract))
  }

  inventories.sort(comparePackageName)
  return inventories
}

/** 从 source manifest 白名单生成一个隔离 staging package。 */
function createStagingPackage(repoRoot, stagingDirectory, packageContract) {
  const sourceDirectory = join(repoRoot, packageContract.workspacePath)
  const sourceManifest = readJsonFile(join(sourceDirectory, 'package.json'), `${packageContract.name} source manifest`).value

  mkdirSync(stagingDirectory, { recursive: true })
  if (packageContract.files.includes('dist')) {
    copyRegularTree(join(sourceDirectory, 'dist'), join(stagingDirectory, 'dist'))
  }
  if (packageContract.files.includes('README.md')) {
    copyRegularFile(join(sourceDirectory, 'README.md'), join(stagingDirectory, 'README.md'))
  }
  for (const fixturePath of packageContract.fixtureAllowlist) {
    copyRegularFile(join(sourceDirectory, fixturePath), join(stagingDirectory, fixturePath))
  }

  const packedManifest = createPackedManifest(sourceManifest, packageContract)

  writeFileSync(join(stagingDirectory, 'package.json'), JSON.stringify(packedManifest))
}

/** 从 source manifest 选择冻结字段并改写 first-party 版本。 */
function createPackedManifest(sourceManifest, packageContract) {
  const manifest = {
    name: packageContract.name,
    version: packageContract.version,
    private: packageContract.private,
    type: 'module',
    main: sourceManifest.main,
    module: sourceManifest.module,
    types: sourceManifest.types,
    publishConfig: { access: packageContract.sourceAccess },
    files: packageContract.files,
    exports: sourceManifest.exports,
    sideEffects: packageContract.sideEffects,
    dependencies: rewriteDependencies(packageContract.dependencyPolicy.firstParty, packageContract.dependencyPolicy.external, packageContract.version),
    peerDependencies: rewriteDependencies(packageContract.dependencyPolicy.firstPartyPeers, packageContract.dependencyPolicy.externalPeers, packageContract.version)
  }

  for (const key of ['main', 'module', 'types']) {
    if (manifest[key] === undefined) {
      delete manifest[key]
    }
  }

  return manifest
}

/** 合并 first-party 精确版本与冻结 external dependency。 */
function rewriteDependencies(firstParty, external, version) {
  const dependencies = { ...external }

  for (const name of firstParty) {
    dependencies[name] = version
  }

  return Object.fromEntries(Object.entries(dependencies).sort(compareNamedEntry))
}

/** 执行每包唯一 dry-run 并对比 staging regular file allowlist。 */
function verifyDryRun(stagingDirectory) {
  const result = runRequiredCommand(stagingDirectory, 'npm', [
    'pack',
    '--dry-run',
    '--json',
    '--ignore-scripts'
  ], 'npm pack dry-run')
  const report = parseJsonText(result.stdout, 'npm pack dry-run report')
  const actualFiles = report[0]?.files?.map(readNpmPackPath).sort()
  const expectedFiles = listRegularFiles(stagingDirectory)

  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error('npm pack dry-run files do not match staging')
  }
}

/** 执行每包唯一真实 pack 并返回 repo 外 tarball 路径。 */
function packStagingPackage(stagingDirectory, outputDirectory) {
  const before = new Set(readdirSync(outputDirectory))

  runRequiredCommand(stagingDirectory, 'npm', [
    'pack',
    '--ignore-scripts',
    '--pack-destination',
    outputDirectory
  ], 'npm pack')
  const created = readdirSync(outputDirectory).filter(function isNewTarball(file) {
    return !before.has(file) && file.endsWith('.tgz')
  })

  if (created.length !== 1) {
    throw new Error('npm pack did not create exactly one tarball')
  }
  validateTarballFile(created[0])
  return join(outputDirectory, created[0])
}

/** 把真实 tarball 交给 B1 scanner，且不回显 scanner stdout。 */
function runScanner(tarballPath, packageName) {
  const result = spawnSync(process.execPath, [
    scannerPath,
    '--tarball',
    tarballPath,
    '--package-name',
    packageName
  ], { encoding: 'utf8' })

  if (result.status !== 0) {
    const report = parseJsonText(result.stderr, 'package artifact scanner report')
    const failures = Array.isArray(report.failures) ? report.failures.join('; ') : 'unknown scanner failure'

    throw new Error(`${packageName}: ${failures}`)
  }
}

/** 从 tarball regular file 原始 bytes 生成 package inventory。 */
function readTarballInventory(tarballPath, packageContract) {
  const files = readTarballFiles(tarballPath)
  const packedManifest = files.find(matchesPackageManifest)

  if (packedManifest === undefined) {
    throw new Error(`${packageContract.name}: packed manifest is missing`)
  }
  const tarballBytes = readFileSync(tarballPath)

  return {
    name: packageContract.name,
    version: packageContract.version,
    delivery: packageContract.delivery,
    tarballFile: basename(tarballPath),
    tarballSha256: sha256(tarballBytes),
    tarballBytes: tarballBytes.byteLength,
    packedManifestSha256: packedManifest.sha256,
    payloadSha256: createPayloadSha256(files),
    files
  }
}

/** 枚举 tarball 的 regular files 并读取每项 raw bytes。 */
function readTarballFiles(tarballPath) {
  const names = runRequiredCommand(process.cwd(), 'tar', ['-tzf', tarballPath], 'tarball path listing').stdout.split('\n').filter(Boolean)
  const verbose = runRequiredCommand(process.cwd(), 'tar', ['-tvzf', tarballPath], 'tarball type listing').stdout.split('\n').filter(Boolean)

  if (names.length !== verbose.length) {
    throw new Error('tarball listing count mismatch')
  }

  const files = []
  const seen = new Set()
  for (let index = 0; index < names.length; index += 1) {
    const rawPath = names[index]
    const type = verbose[index]?.[0]

    if (type === 'd') {
      continue
    }
    if (type !== '-') {
      throw new Error('tarball contains a non-regular entry')
    }
    const path = normalizeTarballPath(rawPath)
    if (seen.has(path)) {
      throw new Error('tarball contains a duplicate path')
    }
    seen.add(path)
    const bytes = runBinaryCommand('tar', ['-xOzf', tarballPath, rawPath], 'tarball file read')

    files.push({ path, sha256: sha256(bytes), bytes: bytes.byteLength })
  }

  files.sort(compareFilePath)
  return files
}

/** 移除唯一 `package/` 前缀并拒绝非法 tar path。 */
function normalizeTarballPath(rawPath) {
  if (!rawPath.startsWith('package/')) {
    throw new Error('tarball path is outside the package root')
  }
  const path = rawPath.slice('package/'.length)

  if (path === '' || path.includes('\\') || path.split('/').some(isInvalidPathSegment)) {
    throw new Error('tarball path is invalid')
  }

  return path
}

/** 运行 canonical 四条 direct gate，再写 test report 与 binding。 */
function finishCanonicalRun(repoRoot, outputDirectory, sourceReport, manifest, manifestBytes, checksumBytes) {
  const commands = []
  const directEnvironment = {
    ...process.env,
    JWORD_PHASE3_ARTIFACT_MANIFEST: join(outputDirectory, 'artifact-manifest.json'),
    NODE_OPTIONS: [process.env.NODE_OPTIONS, '--experimental-websocket'].filter(Boolean).join(' ')
  }

  for (const definition of testCommandDefinitions()) {
    commands.push(runFixedCommand(repoRoot, definition, directEnvironment))
    verifyTarballChecksums(outputDirectory, manifest)
  }
  assertPhase3Clean(repoRoot)

  const testReport = {
    schemaVersion: 1,
    gitSha: manifest.artifactIdentity.gitSha,
    artifactSetId: manifest.artifactSetId,
    commands
  }
  const testReportBytes = writeCanonicalJson(join(outputDirectory, 'test-report.json'), testReport)

  assertPhase3Clean(repoRoot)
  const binding = createArtifactBinding({
    gitSha: manifest.artifactIdentity.gitSha,
    lockfileSha256: manifest.artifactIdentity.lockfileSha256,
    artifactSetId: manifest.artifactSetId,
    artifactManifestSha256: sha256(manifestBytes),
    sha256SumsSha256: sha256(checksumBytes),
    sourceReportSha256: sourceReport.sourceReportSha256,
    testReportSha256: sha256(testReportBytes)
  })
  const bindingPath = join(outputDirectory, 'artifact-binding.json')

  writeCanonicalJson(bindingPath, binding)
  validateArtifactBinding(
    readJsonFile(bindingPath, 'artifact binding').value,
    readFileSync(join(outputDirectory, 'artifact-manifest.json')),
    manifest,
    readFileSync(join(outputDirectory, 'SHA256SUMS'))
  )
}

/** 每条 direct command 后重算所有 tarball checksum。 */
function verifyTarballChecksums(outputDirectory, manifest) {
  for (const packageEntry of manifest.artifactIdentity.packages) {
    const tarballPath = join(outputDirectory, packageEntry.tarballFile)

    if (sha256File(tarballPath) !== packageEntry.tarballSha256) {
      throw new Error(`${packageEntry.name}: tarball checksum changed`)
    }
  }
}

/** 读取 Git/lock/tool identity，并要求调用点已完成 clean 断言。 */
function readRepositoryIdentity(repoRoot) {
  const gitIdentity = readGitIdentity(repoRoot)
  const lockfilePath = join(repoRoot, 'pnpm-lock.yaml')

  if (!existsSync(lockfilePath)) {
    throw new Error('pnpm-lock.yaml is missing')
  }

  return {
    ...gitIdentity,
    lockfileSha256: sha256File(lockfilePath),
    environment: readCurrentEnvironment(repoRoot)
  }
}

/** 校验根 build script 保留唯一 build+normalize 命令。 */
function validateRootBuildCommand(repoRoot) {
  const rootManifest = readJsonFile(join(repoRoot, 'package.json'), 'root package.json').value

  if (rootManifest.scripts?.build !== 'rollup -c && node tools/release/normalize-dist-relative-imports.mjs') {
    throw new Error('root build command does not match the Phase 3 contract')
  }
}

/** 从五个冻结 source path 生成 builder implementation hash。 */
function readBuilderSha256(repoRoot) {
  const entries = builderIdentityPaths.slice().sort().map(function hashBuilderFile(path) {
    return { path, sha256: sha256File(join(repoRoot, path)) }
  })

  return sha256(canonicalBytes(entries))
}

/** 执行固定 pnpm command 并在返回后立即检查 clean。 */
function runFixedCommand(repoRoot, definition, environment = process.env) {
  const [command, ...args] = definition.command.split(' ')
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    env: environment
  })

  assertPhase3Clean(repoRoot)
  if (result.status !== 0) {
    process.stdout.write(result.stdout ?? '')
    process.stderr.write(result.stderr ?? '')
    throw new Error([
      `${definition.id} command failed`,
      `status: ${result.status ?? 'null'}`,
      `signal: ${result.signal ?? 'none'}`,
      `spawn error code: ${result.error?.code ?? 'none'}`
    ].join(', '))
  }

  return { id: definition.id, command: definition.command, exitCode: 0, status: 'passed' }
}

/** 执行必须成功的文本命令并返回结果。 */
function runRequiredCommand(cwd, command, args, label) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: process.env })

  if (result.status !== 0) {
    throw new Error(`${label} failed`)
  }

  return result
}

/** 执行必须成功的 binary 命令并返回 stdout bytes。 */
function runBinaryCommand(command, args, label) {
  const result = spawnSync(command, args, { encoding: null, maxBuffer: 32 * 1024 * 1024 })

  if (result.status !== 0 || result.stdout === null) {
    throw new Error(`${label} failed`)
  }

  return result.stdout
}

/** 复制 regular file 并拒绝 symlink/special file。 */
function copyRegularFile(sourcePath, targetPath) {
  const stat = lstatSync(sourcePath)

  if (!stat.isFile()) {
    throw new Error('staging source must be a regular file')
  }
  mkdirSync(dirname(targetPath), { recursive: true })
  cpSync(sourcePath, targetPath)
}

/** 递归复制 regular directory tree 并拒绝 symlink/special entry。 */
function copyRegularTree(sourceRoot, targetRoot) {
  if (!lstatSync(sourceRoot).isDirectory()) {
    throw new Error('staging source tree must be a directory')
  }
  mkdirSync(targetRoot, { recursive: true })
  for (const entry of readdirSync(sourceRoot).sort()) {
    const sourcePath = join(sourceRoot, entry)
    const targetPath = join(targetRoot, entry)
    const stat = lstatSync(sourcePath)

    if (stat.isDirectory()) {
      copyRegularTree(sourcePath, targetPath)
    } else if (stat.isFile()) {
      copyRegularFile(sourcePath, targetPath)
    } else {
      throw new Error('staging source tree contains a non-regular entry')
    }
  }
}

/** 枚举 staging 内全部 regular file POSIX 相对路径。 */
function listRegularFiles(root) {
  const files = []

  /** 递归枚举当前 staging directory。 */
  function visit(directory) {
    for (const entry of readdirSync(directory).sort()) {
      const path = join(directory, entry)
      const stat = lstatSync(path)

      if (stat.isDirectory()) {
        visit(path)
      } else if (stat.isFile()) {
        files.push(relative(root, path).split(sep).join('/'))
      } else {
        throw new Error('staging contains a non-regular entry')
      }
    }
  }

  visit(root)
  return files.sort()
}

/** 解析不受信任 JSON bytes 且不透传 parser message。 */
function parseJsonBytes(bytes, label) {
  return parseJsonText(bytes.toString('utf8'), label)
}

/** 解析不受信任 JSON text 且不透传 parser message。 */
function parseJsonText(text, label) {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label}: invalid JSON`)
  }
}

/** 生成不进入 artifact identity 的 execution run ID。 */
function readExecutionRunId(purpose) {
  return process.env.GITHUB_RUN_ID === undefined
    ? `${purpose}-${process.pid}`
    : `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${purpose}`
}

/** 比较 package inventory name。 */
function comparePackageName(left, right) {
  return compareAscii(left.name, right.name)
}

/** 比较 dependency entry name。 */
function compareNamedEntry(left, right) {
  return compareAscii(left[0], right[0])
}

/** 读取 npm dry-run file path。 */
function readNpmPackPath(file) {
  return file.path
}

/** 读取 package checksum 的 manifest entry。 */
function matchesPackageManifest(file) {
  return file.path === 'package.json'
}

/** 比较 artifact file path。 */
function compareFilePath(left, right) {
  return compareAscii(left.path, right.path)
}

/** 判断 tar path segment 是否非法。 */
function isInvalidPathSegment(segment) {
  return segment === '' || segment === '.' || segment === '..'
}

/** 使用冻结 ASCII/code-point 顺序比较两个字符串。 */
function compareAscii(left, right) {
  return left < right ? -1 : left > right ? 1 : 0
}

main()
