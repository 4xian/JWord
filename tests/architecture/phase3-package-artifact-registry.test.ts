/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 scoped synthetic npm/pnpm loopback registry 闭包。
 * 边界：只在仓库外创建、打包和安装 synthetic package，不操作真实 JWord package。
 * 协作模块：package artifact contract 的 registry policy 与 npm/pnpm lockfile。
 * 性能/安全约束：使用动态 loopback 端口和隔离环境，不继承或输出 registry credential。
 * 实现说明：本文件保存并重算 registry transcript 与 metadata/tarball 原始响应。
 */

import { createHash } from 'node:crypto'
import { execFile, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { once } from 'node:events'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const execFileAsync = promisify(execFile)
const REGISTRY_POLICY = {
  mode: 'read-only-loopback',
  host: '127.0.0.1',
  scope: '@4xian',
  allowedMethods: ['GET', 'HEAD'],
  npmLockEvidence: ['resolved', 'integrity'],
  pnpmV9LockEvidence: ['integrity', 'registry-config', 'registry-transcript'],
  runtimePortEvidence: ['registry-config', 'registry-transcript', 'metadata-response']
} as const

/** 执行 synthetic registry closure 的单一公开 seam 回归。 */
function runRegistrySuite(): void {
  it('installs one scoped synthetic closure through isolated npm and pnpm registries', verifySyntheticTarballClosure, 120_000)
}

describe('Phase 3 package artifact registry contract', runRegistrySuite)

const SYNTHETIC_BASE = '@4xian/jword-phase3-synthetic-base'
const SYNTHETIC_LEAF = '@4xian/jword-phase3-synthetic-leaf'

interface SyntheticPackage {
  readonly name: string
  readonly dependencies: Readonly<Record<string, string>>
  readonly tarballFile: string
  readonly bytes: Buffer
  readonly shasum: string
  readonly integrity: string
  readonly sha256: string
  metadata: Buffer
  metadataPath: string
  metadataRequests: number
  tarballRequests: number
}

interface RegistryRequest {
  readonly order: number
  readonly method: 'GET' | 'HEAD'
  readonly path: string
  readonly status: 200
  readonly responseKind: 'metadata' | 'tarball'
  readonly responsePath: string
  readonly responseSha256: string
  readonly responseBytes: number
}

interface RegistrySession {
  readonly origin: string
  readonly packages: readonly SyntheticPackage[]
  readonly requests: readonly RegistryRequest[]
  readonly unexpectedRequests: number
  readonly writeAttempts: number
  close(): Promise<void>
}

interface RegistryResponse {
  readonly packageEntry: SyntheticPackage
  readonly kind: 'metadata' | 'tarball'
  readonly payload: Buffer
}

interface RegistryTranscriptEvidence {
  readonly schemaVersion: 1
  readonly origin: string
  readonly requests: readonly RegistryRequest[]
}

interface ServedPackageEvidence {
  readonly name: string
  readonly version: '0.0.0'
  readonly tarballFile: string
  readonly tarballSha256: string
  readonly tarballShasum: string
  readonly tarballIntegrity: string
  readonly metadataPath: string
  readonly metadataSha256: string
  readonly metadataBytes: number
  readonly metadataRequests: number
  readonly tarballRequests: number
}

interface RegistryEvidence {
  readonly schemaVersion: 1
  readonly origin: string
  readonly policy: typeof REGISTRY_POLICY
  readonly servedPackages: readonly ServedPackageEvidence[]
  readonly unexpectedRequests: number
  readonly writeAttempts: number
}

interface PersistedGetEvidence {
  readonly bytes: Buffer
  readonly count: number
}

/** 在仓库外经只读 loopback registry 验证 npm 与 pnpm 闭包。 */
async function verifySyntheticTarballClosure(): Promise<void> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'jword-phase3-contract-'))

  try {
    const packages = createSyntheticPackages(temporaryRoot)

    await verifyPackageManagerClosure('npm', temporaryRoot, packages)
    await verifyPackageManagerClosure('pnpm', temporaryRoot, packages)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

/** 创建 scoped base 与依赖 base@0.0.0 的 leaf tarball。 */
function createSyntheticPackages(temporaryRoot: string): readonly SyntheticPackage[] {
  const packRuntimeDirectory = join(temporaryRoot, 'pack-runtime')
  const packHomeDirectory = join(packRuntimeDirectory, 'home')
  const packTemporaryDirectory = join(packRuntimeDirectory, 'tmp')
  const packCacheDirectory = join(packRuntimeDirectory, 'cache')
  const packUserConfig = join(packRuntimeDirectory, '.npmrc')
  const packEnvironment: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: packHomeDirectory,
    TMPDIR: packTemporaryDirectory,
    LANG: 'C',
    CI: '1',
    NPM_CONFIG_USERCONFIG: packUserConfig,
    NPM_CONFIG_CACHE: packCacheDirectory
  }
  const definitions = [
    { directory: 'base', name: SYNTHETIC_BASE, dependencies: {}, source: "module.exports = 'base'\n" },
    { directory: 'leaf', name: SYNTHETIC_LEAF, dependencies: { [SYNTHETIC_BASE]: '0.0.0' }, source: `module.exports = require('${SYNTHETIC_BASE}')\n` }
  ]
  const packages: SyntheticPackage[] = []

  mkdirSync(packHomeDirectory, { recursive: true })
  mkdirSync(packTemporaryDirectory, { recursive: true })
  mkdirSync(packCacheDirectory, { recursive: true })
  writeFileSync(packUserConfig, 'registry=https://registry.npmjs.org/\n')
  expect(Object.keys(packEnvironment).sort()).toEqual([
    'CI',
    'HOME',
    'LANG',
    'NPM_CONFIG_CACHE',
    'NPM_CONFIG_USERCONFIG',
    'PATH',
    'TMPDIR'
  ])
  for (const definition of definitions) {
    const directory = join(temporaryRoot, definition.directory)

    writeSyntheticPackage(directory, {
      name: definition.name,
      version: '0.0.0',
      main: 'index.js',
      dependencies: definition.dependencies
    })
    writeFileSync(join(directory, 'index.js'), definition.source)
    packages.push(readSyntheticPackage(
      definition.name,
      definition.dependencies,
      packSyntheticPackage(directory, packEnvironment)
    ))
  }

  return packages
}

/** 读取 synthetic tarball bytes 与全部固定 digest。 */
function readSyntheticPackage(
  name: string,
  dependencies: Readonly<Record<string, string>>,
  tarballPath: string
): SyntheticPackage {
  const bytes = readFileSync(tarballPath)

  return {
    name,
    dependencies,
    tarballFile: basename(tarballPath),
    bytes,
    shasum: createHash('sha1').update(bytes).digest('hex'),
    integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
    sha256: sha256(bytes),
    metadata: Buffer.alloc(0),
    metadataPath: '',
    metadataRequests: 0,
    tarballRequests: 0
  }
}

/** 写入不含 script、workspace、override 或 alias 的 synthetic package。 */
function writeSyntheticPackage(directory: string, manifest: object): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
}

/** 使用 npm pack 仅打包仓库外 synthetic package。 */
function packSyntheticPackage(directory: string, environment: Record<string, string>): string {
  const result = spawnSync('npm', ['pack', '--ignore-scripts'], {
    cwd: directory,
    encoding: 'utf8',
    env: environment
  })

  assertCommandPassed(result, `npm pack ${basename(directory)}`)
  return join(directory, result.stdout.trim().split('\n').at(-1)!)
}

/** 启动动态端口、只读且精确 allowlist 的 synthetic registry。 */
async function startRegistry(
  packages: readonly SyntheticPackage[],
  projectDirectory: string
): Promise<RegistrySession> {
  const requests: RegistryRequest[] = []
  const responsesDirectory = join(projectDirectory, 'registry-responses')
  let unexpectedRequests = 0
  let writeAttempts = 0

  mkdirSync(responsesDirectory, { recursive: true })
  for (const packageEntry of packages) {
    packageEntry.metadata = Buffer.alloc(0)
    packageEntry.metadataPath = ''
    packageEntry.metadataRequests = 0
    packageEntry.tarballRequests = 0
  }

  /** 只服务 allowlist metadata/tarball，并记录 canonical transcript。 */
  function handleRequest(request: IncomingMessage, response: ServerResponse): void {
    const method = request.method ?? ''
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname

    if (method !== 'GET' && method !== 'HEAD') {
      writeAttempts += 1
      response.writeHead(405).end()
      return
    }

    const match = resolveRegistryResponse(packages, path)
    if (!match) {
      unexpectedRequests += 1
      response.writeHead(404).end()
      return
    }

    const responseBytes = method === 'GET' ? match.payload : Buffer.alloc(0)
    const responseSha256 = sha256(responseBytes)
    const responsePath = `registry-responses/${responseSha256}.bin`

    writeFileSync(join(projectDirectory, responsePath), responseBytes)
    requests.push({
      order: requests.length,
      method,
      path,
      status: 200,
      responseKind: match.kind,
      responsePath,
      responseSha256,
      responseBytes: responseBytes.byteLength
    })
    if (method === 'GET') {
      match.kind === 'metadata'
        ? match.packageEntry.metadataRequests += 1
        : match.packageEntry.tarballRequests += 1
    }
    response.setHeader('content-length', match.payload.byteLength)
    response.writeHead(200).end(method === 'GET' ? match.payload : undefined)
  }

  const server = createServer(handleRequest)
  server.listen(0, REGISTRY_POLICY.host)
  await once(server, 'listening')
  const origin = `http://${REGISTRY_POLICY.host}:${(server.address() as AddressInfo).port}`
  for (const packageEntry of packages) {
    packageEntry.metadata = createPackageMetadata(packageEntry, origin)
  }

  /** 关闭 registry 并等待现有连接释放。 */
  async function closeRegistry(): Promise<void> {
    server.close()
    await once(server, 'close')
  }

  return {
    origin,
    packages,
    requests,
    /** 返回被 registry 拒绝的未知请求数。 */
    get unexpectedRequests(): number { return unexpectedRequests },
    /** 返回被 registry 拒绝的写请求数。 */
    get writeAttempts(): number { return writeAttempts },
    close: closeRegistry
  }
}

/** 解析 metadata 或 tarball allowlist 路径。 */
function resolveRegistryResponse(
  packages: readonly SyntheticPackage[],
  path: string
): RegistryResponse | undefined {
  for (const packageEntry of packages) {
    if (path === `/tarballs/${packageEntry.tarballFile}`) {
      return { packageEntry, kind: 'tarball', payload: packageEntry.bytes }
    }
    if (decodeURIComponent(path.slice(1)) === packageEntry.name) {
      packageEntry.metadataPath = path
      return { packageEntry, kind: 'metadata', payload: packageEntry.metadata }
    }
  }
}

/** 从同一 tarball bytes 构造运行时 metadata raw response。 */
function createPackageMetadata(packageEntry: SyntheticPackage, origin: string): Buffer {
  const version = {
    name: packageEntry.name,
    version: '0.0.0',
    main: 'index.js',
    dependencies: packageEntry.dependencies,
    dist: {
      tarball: `${origin}/tarballs/${packageEntry.tarballFile}`,
      shasum: packageEntry.shasum,
      integrity: packageEntry.integrity
    }
  }

  return Buffer.from(JSON.stringify({
    name: packageEntry.name,
    versions: { '0.0.0': version },
    'dist-tags': { latest: '0.0.0' }
  }))
}

/** 在独立空项目安装精确版本并验证 registry/lock/realpath 证据。 */
async function verifyPackageManagerClosure(
  packageManager: 'npm' | 'pnpm',
  temporaryRoot: string,
  packages: readonly SyntheticPackage[]
): Promise<void> {
  const projectDirectory = join(temporaryRoot, `consumer-${packageManager}`)
  const homeDirectory = join(projectDirectory, 'home')
  const temporaryDirectory = join(projectDirectory, 'tmp')
  const userConfig = join(projectDirectory, '.npmrc')

  mkdirSync(homeDirectory, { recursive: true })
  mkdirSync(temporaryDirectory, { recursive: true })
  writeSyntheticPackage(projectDirectory, {
    name: `jword-phase3-consumer-${packageManager}`,
    version: '0.0.0',
    private: true,
    dependencies: { [SYNTHETIC_BASE]: '0.0.0', [SYNTHETIC_LEAF]: '0.0.0' }
  })
  const registry = await startRegistry(packages, projectDirectory)
  writeFileSync(userConfig, `registry=https://registry.npmjs.org/\n${REGISTRY_POLICY.scope}:registry=${registry.origin}/\n`)
  const installArguments = packageManager === 'npm'
    ? ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(projectDirectory, 'cache')]
    : ['install', '--ignore-scripts', '--no-frozen-lockfile', '--store-dir', join(projectDirectory, 'store')]
  const installEnvironment: Record<string, string> = {
    PATH: process.env.PATH ?? '',
    HOME: homeDirectory,
    TMPDIR: temporaryDirectory,
    LANG: 'C',
    CI: '1',
    NPM_CONFIG_USERCONFIG: userConfig
  }

  expect(Object.keys(installEnvironment).sort()).toEqual([
    'CI',
    'HOME',
    'LANG',
    'NPM_CONFIG_USERCONFIG',
    'PATH',
    'TMPDIR'
  ])
  try {
    await execFileAsync(packageManager, installArguments, {
      cwd: projectDirectory,
      env: installEnvironment
    })
  } finally {
    await registry.close()
  }

  verifyRegistryEvidence(registry, projectDirectory, packageManager)
  verifySingleBaseRealpath(projectDirectory)
  verifyNoForbiddenInstallMechanism(projectDirectory)
}

/** 保存并重算 transcript、metadata、tarball 与 lockfile 证据。 */
function verifyRegistryEvidence(
  registry: RegistrySession,
  projectDirectory: string,
  packageManager: 'npm' | 'pnpm'
): void {
  const servedPackages: ServedPackageEvidence[] = []

  for (const packageEntry of registry.packages) {
    servedPackages.push({
      name: packageEntry.name,
      version: '0.0.0',
      tarballFile: packageEntry.tarballFile,
      tarballSha256: packageEntry.sha256,
      tarballShasum: packageEntry.shasum,
      tarballIntegrity: packageEntry.integrity,
      metadataPath: packageEntry.metadataPath,
      metadataSha256: sha256(packageEntry.metadata),
      metadataBytes: packageEntry.metadata.byteLength,
      metadataRequests: packageEntry.metadataRequests,
      tarballRequests: packageEntry.tarballRequests
    })
  }
  writeFileSync(
    join(projectDirectory, 'registry-transcript.json'),
    `${JSON.stringify({ schemaVersion: 1, origin: registry.origin, requests: registry.requests }, null, 2)}\n`
  )
  writeFileSync(
    join(projectDirectory, 'registry-evidence.json'),
    `${JSON.stringify({
      schemaVersion: 1,
      origin: registry.origin,
      policy: REGISTRY_POLICY,
      servedPackages,
      unexpectedRequests: registry.unexpectedRequests,
      writeAttempts: registry.writeAttempts
    }, null, 2)}\n`
  )
  verifyPersistedRegistryEvidence(registry, projectDirectory)
  expect(registry.unexpectedRequests).toBe(0)
  expect(registry.writeAttempts).toBe(0)
  for (let order = 0; order < registry.requests.length; order += 1) {
    const request = registry.requests[order]!
    const responseBytes = readFileSync(join(projectDirectory, request.responsePath))

    expect(request.order).toBe(order)
    expect(request.responseSha256).toBe(sha256(responseBytes))
    expect(request.responseBytes).toBe(responseBytes.byteLength)
    if (request.method === 'HEAD') expect(responseBytes.byteLength).toBe(0)
  }

  for (const packageEntry of registry.packages) {
    expect(packageEntry.metadataRequests).toBeGreaterThan(0)
    expect(packageEntry.tarballRequests).toBeGreaterThan(0)
    expect(countGetResponses(registry.requests, 'metadata', sha256(packageEntry.metadata))).toBeGreaterThan(0)
    expect(countGetResponses(registry.requests, 'tarball', packageEntry.sha256)).toBeGreaterThan(0)
    const metadata = JSON.parse(packageEntry.metadata.toString('utf8')) as {
      versions: Record<string, { dist: { tarball: string, shasum: string, integrity: string } }>
    }
    const dist = metadata.versions['0.0.0']!.dist

    expect(dist.tarball).toBe(`${registry.origin}/tarballs/${packageEntry.tarballFile}`)
    expect(dist.shasum).toBe(packageEntry.shasum)
    expect(dist.integrity).toBe(packageEntry.integrity)
  }
  verifyLockfileEvidence(packageManager, projectDirectory, registry)
}

/** 从磁盘重读无凭据配置、transcript 与 registry evidence。 */
function verifyPersistedRegistryEvidence(
  registry: RegistrySession,
  projectDirectory: string
): void {
  const expectedConfig = `registry=https://registry.npmjs.org/\n${REGISTRY_POLICY.scope}:registry=${registry.origin}/\n`
  const registryConfig = readFileSync(join(projectDirectory, '.npmrc'), 'utf8')
  const transcript = readJsonFile<RegistryTranscriptEvidence>(join(projectDirectory, 'registry-transcript.json'))
  const evidence = readJsonFile<RegistryEvidence>(join(projectDirectory, 'registry-evidence.json'))
  const servedPackages: ServedPackageEvidence[] = []

  expect(registryConfig).toBe(expectedConfig)
  expect(registryConfig).not.toMatch(/auth|token|password|username/i)
  expect(Object.keys(transcript).sort()).toEqual(['origin', 'requests', 'schemaVersion'])
  expect(transcript).toEqual({ schemaVersion: 1, origin: registry.origin, requests: registry.requests })
  for (const packageEntry of registry.packages) {
    const metadataEvidence = readPersistedGetEvidence(
      transcript.requests,
      projectDirectory,
      'metadata',
      packageEntry.metadataPath
    )
    const tarballEvidence = readPersistedGetEvidence(
      transcript.requests,
      projectDirectory,
      'tarball',
      `/tarballs/${packageEntry.tarballFile}`
    )

    expect(tarballEvidence.bytes).toEqual(packageEntry.bytes)
    servedPackages.push({
      name: packageEntry.name,
      version: '0.0.0',
      tarballFile: packageEntry.tarballFile,
      tarballSha256: sha256(tarballEvidence.bytes),
      tarballShasum: createHash('sha1').update(tarballEvidence.bytes).digest('hex'),
      tarballIntegrity: `sha512-${createHash('sha512').update(tarballEvidence.bytes).digest('base64')}`,
      metadataPath: packageEntry.metadataPath,
      metadataSha256: sha256(metadataEvidence.bytes),
      metadataBytes: metadataEvidence.bytes.byteLength,
      metadataRequests: metadataEvidence.count,
      tarballRequests: tarballEvidence.count
    })
  }
  expect(evidence).toEqual({
    schemaVersion: 1,
    origin: registry.origin,
    policy: REGISTRY_POLICY,
    servedPackages,
    unexpectedRequests: 0,
    writeAttempts: 0
  })
}

/** 从 transcript 指向的落盘 raw response 重算一类 GET 证据。 */
function readPersistedGetEvidence(
  requests: readonly RegistryRequest[],
  projectDirectory: string,
  kind: RegistryRequest['responseKind'],
  path: string
): PersistedGetEvidence {
  let bytes: Buffer | undefined
  let count = 0

  for (const request of requests) {
    if (request.method !== 'GET' || request.responseKind !== kind || request.path !== path) continue
    const responseBytes = readFileSync(join(projectDirectory, request.responsePath))

    expect(request.status).toBe(200)
    expect(request.responseSha256).toBe(sha256(responseBytes))
    expect(request.responseBytes).toBe(responseBytes.byteLength)
    if (bytes === undefined) {
      bytes = responseBytes
    } else {
      expect(responseBytes).toEqual(bytes)
    }
    count += 1
  }

  expect(count).toBeGreaterThan(0)
  if (bytes === undefined) throw new Error(`Missing persisted ${kind} GET response for ${path}`)
  return { bytes, count }
}

/** 统计指定 response kind/hash 的必需 GET 请求。 */
function countGetResponses(
  requests: readonly RegistryRequest[],
  kind: RegistryRequest['responseKind'],
  responseSha256: string
): number {
  let count = 0
  for (const request of requests) {
    if (request.method === 'GET' && request.responseKind === kind && request.responseSha256 === responseSha256) count += 1
  }
  return count
}

/** 按 npm 与 pnpm v9 的不同持久化字段校验 lockfile。 */
function verifyLockfileEvidence(
  packageManager: 'npm' | 'pnpm',
  projectDirectory: string,
  registry: RegistrySession
): void {
  if (packageManager === 'npm') {
    const lockfile = readJsonFile<{ packages: Record<string, { resolved: string, integrity: string }> }>(join(projectDirectory, 'package-lock.json'))
    for (const packageEntry of registry.packages) {
      const entry = lockfile.packages[`node_modules/${packageEntry.name}`]!
      expect(entry.resolved).toBe(`${registry.origin}/tarballs/${packageEntry.tarballFile}`)
      expect(entry.integrity).toBe(packageEntry.integrity)
    }
    return
  }

  const lockfile = readFileSync(join(projectDirectory, 'pnpm-lock.yaml'), 'utf8')
  for (const packageEntry of registry.packages) expect(lockfile).toContain(`integrity: ${packageEntry.integrity}`)
}

/** 验证根项目与 leaf 解析到同一个仓库外 base 实体。 */
function verifySingleBaseRealpath(projectDirectory: string): void {
  const projectRequire = createRequire(join(projectDirectory, 'package.json'))
  const leafRequire = createRequire(projectRequire.resolve(`${SYNTHETIC_LEAF}/package.json`))
  const rootBase = realpathSync(dirname(projectRequire.resolve(`${SYNTHETIC_BASE}/package.json`)))
  const leafBase = realpathSync(dirname(leafRequire.resolve(`${SYNTHETIC_BASE}/package.json`)))

  expect(rootBase).toBe(leafBase)
  expect(isPathInside(REPO_ROOT, rootBase)).toBe(false)
  expect(isPathInside(projectDirectory, rootBase)).toBe(true)
}

/** 验证生成项目不使用 file、override、resolution、alias 或 workspace link。 */
function verifyNoForbiddenInstallMechanism(projectDirectory: string): void {
  const packageJson = readJsonFile<Record<string, unknown>>(join(projectDirectory, 'package.json'))
  const serialized = JSON.stringify(packageJson)

  expect(packageJson).not.toHaveProperty('overrides')
  expect(packageJson).not.toHaveProperty('resolutions')
  for (const forbidden of ['file:', 'workspace:', 'link:', 'npm:']) expect(serialized).not.toContain(forbidden)
}

/** 判断 candidate 是否位于 parent 目录内。 */
function isPathInside(parent: string, candidate: string): boolean {
  const relativePath = relative(realpathSync(parent), realpathSync(candidate))

  return relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath)
}

/** 断言外部命令成功，并在失败时保留不含输入材料的诊断。 */
function assertCommandPassed(result: SpawnSyncReturns<string>, label: string): void {
  expect(result.status, `${label} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`).toBe(0)
}

/** 读取并解析 JSON 文件。 */
function readJsonFile<TValue>(path: string): TValue {
  return JSON.parse(readFileSync(path, 'utf8')) as TValue
}

/** 计算原始 bytes 的小写 SHA-256。 */
function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
