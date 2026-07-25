/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 商业协作 client/server/license 包的 export map 和公开入口分级。
 * 边界：只读取 package manifest 和公开入口源码，不启动协作服务、不连接 provider、不执行浏览器流程。
 * 协作模块：packages/collab、packages/collab-server、packages/license 和 Gate 6 商业化计划。
 * 约束：stable API 只能从包入口导出；internal 不得出现在 export map；server 必须是正式 workspace 包。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const packageManifests = [
  {
    dir: 'packages/collab',
    name: '@4xian/jword-collab',
    stableTokens: [
      'connectJWordCollaboration',
      'createJWordCollabFeatureGate',
      'createMemoryCollabProviderAdapter',
      'GATE6_COLLAB_FEATURES',
      'JWORD_COLLAB_CLIENT_PROTOCOL_VERSION',
      'JWORD_COLLAB_CLIENT_PACKAGE_VERSION'
    ],
    experimentalTokens: [
      'createHocuspocusCollabProviderAdapter'
    ],
    dependencies: {
      '@4xian/jword-core': 'workspace:*'
    }
  },
  {
    dir: 'packages/collab-server',
    name: '@4xian/jword-collab-server',
    stableTokens: [
      'createJWordCollabServer',
      'startJWordCollabServer',
      'createJWordCollabRequestHandler',
      'createJWordCollabHistoryService',
      'createJWordCollabHocuspocusServer',
      'JWORD_COLLAB_SERVER_PROTOCOL_VERSION',
      'JWORD_COLLAB_SERVER_PACKAGE_VERSION'
    ],
    experimentalTokens: [],
    dependencies: {
      '@4xian/jword-persistence': 'workspace:*'
    }
  },
  {
    dir: 'packages/license',
    name: '@4xian/jword-license',
    stableTokens: [
      'GATE5_FORMAT_FEATURES',
      'GATE6_COLLAB_FEATURES',
      'assertJWordFeatureEntitled'
    ],
    experimentalTokens: [],
    dependencies: {}
  },
  {
    dir: 'packages/persistence',
    name: '@4xian/jword-persistence',
    stableTokens: [
      'createMemoryPersistenceAdapter',
      'createMemoryPersistenceHistoryService',
      'createIndexedDbOfflineAdapter',
      'createStoragePersistenceAdapter',
      'createVolatileHistoryStorage',
      'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
    ],
    experimentalTokens: [],
    dependencies: {
      'y-indexeddb': '9.0.12',
      yjs: '13.6.30'
    }
  }
] as const

describe('Gate 6 package export grading', () => {
  it('keeps commercial collaboration packages as formal workspace packages with dist-only public export maps', () => {
    for (const manifest of packageManifests) {
      const packageJson = readPackageJson(`${manifest.dir}/package.json`)

      expect(packageJson.name).toBe(manifest.name)
      expect(packageJson.private).toBe(true)
      expect(packageJson.exports).toMatchObject({
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js'
        }
      })
      if (manifest.experimentalTokens.length > 0) {
        expect(packageJson.exports).toMatchObject({
          './experimental': {
            types: './dist/experimental.d.ts',
            import: './dist/experimental.js'
          }
        })
      }
      expect(packageJson.files).toEqual(['dist', 'README.md'])
      expect(packageJson.dependencies ?? {}).toMatchObject(manifest.dependencies)
      if (manifest.name === '@4xian/jword-collab' || manifest.name === '@4xian/jword-collab-server') {
        assertLicensePeerDependency(packageJson)
      }
    }
  })

  it('keeps package entrypoints focused on stable API tokens and leaves internal names out of export maps', () => {
    for (const manifest of packageManifests) {
      const sourcePath = `${manifest.dir}/src/index.ts`

      expect(existsSync(sourcePath)).toBe(true)

      const source = readFileSync(sourcePath, 'utf8')
      const packageJson = readPackageJson(`${manifest.dir}/package.json`)

      for (const token of manifest.stableTokens) {
        expect(source, `${sourcePath}:${token}`).toContain(token)
      }
      for (const token of manifest.experimentalTokens) {
        expect(source, `${sourcePath}:${token}`).not.toContain(token)
        expect(readFileSync(`${manifest.dir}/src/experimental.ts`, 'utf8')).toContain(token)
      }
      expect(JSON.stringify(packageJson.exports)).not.toContain('internal')
      expect(source).not.toContain('from \'./internal')
      expect(source).not.toContain('from "./internal')
    }
  })

  it('keeps stable collab client API independent from provider and demo runtime names', () => {
    const stableSources = [
      'packages/collab/src/index.ts',
      'packages/collab/src/client-sdk.ts'
    ].map((path) => ({
      path,
      text: readFileSync(path, 'utf8')
    }))
    const forbiddenStableTokens = [
      'Hocuspocus',
      'Y.Doc',
      'Yjs update store',
      'demo runtime'
    ] as const

    for (const source of stableSources) {
      for (const token of forbiddenStableTokens) {
      expect(source.text, `${source.path}:${token}`).not.toContain(token)
      }
    }
  })

  it('keeps collab client consumption of core on neutral update and inserter API names', () => {
    const clientSdk = readCollabClientSdkSource()
    const coreEntry = readFileSync('packages/core/src/index.ts', 'utf8')

    for (const token of [
      'EditorSyncUpdateInput',
      'EditorApplyUpdateOptions',
      'createTextInserter',
      'TextInserterRetryInput'
    ]) {
      expect(coreEntry, token).toContain(token)
      expect(clientSdk, token).toContain(token)
    }
    for (const token of [
      'EditorCollaborationUpdateInput',
      'EditorRemoteUpdateOptions',
      'createInserter',
      'InserterRetryInput'
    ]) {
      expect(clientSdk, token).not.toMatch(new RegExp(`\\b${token}\\b`, 'u'))
    }
  })

  it('keeps client and server handshake protocol constants aligned', () => {
    const clientSdk = readCollabClientSdkSource()
    const serverEntry = readFileSync('packages/collab-server/src/index.ts', 'utf8')

    expect(clientSdk).toContain('JWORD_COLLAB_CLIENT_PROTOCOL_VERSION')
    expect(clientSdk).toContain('JWORD_COLLAB_CLIENT_PACKAGE_VERSION')
    expect(clientSdk).toContain('COLLAB_PROTOCOL_MISMATCH')
    expect(clientSdk).toContain('COLLAB_SERVER_TOO_OLD')
    expect(clientSdk).toContain('COLLAB_CLIENT_TOO_OLD')
    expect(clientSdk).toContain('COLLAB_FEATURE_FLAGS_MISSING')
    expect(readConstLiteral(clientSdk, 'JWORD_COLLAB_CLIENT_PROTOCOL_VERSION')).toBe(
      readConstLiteral(serverEntry, 'JWORD_COLLAB_SERVER_PROTOCOL_VERSION')
    )
  })

  it('keeps the collab server package as an internal Docker image assembly path', () => {
    const dockerfilePath = 'packages/collab-server/Dockerfile'
    const readmePath = 'packages/collab-server/README.md'

    expect(existsSync(dockerfilePath)).toBe(true)
    expect(existsSync(readmePath)).toBe(true)

    const dockerfile = readFileSync(dockerfilePath, 'utf8')
    const readme = readFileSync(readmePath, 'utf8')

    expect(dockerfile).toContain('@4xian/jword-collab-server')
    for (const token of [
      'JWORD_COLLAB_HOST',
      'JWORD_COLLAB_PORT',
      'JWORD_COLLAB_ALLOWED_ORIGINS',
      '/health',
      '/version',
      '/history/versions',
      '/license/status',
      'requestId',
      'WebSocket',
      '版本化 Docker 镜像',
      'LIC-309',
      '镜像组装'
    ]) {
      expect(readme, token).toContain(token)
    }
  })

  it('documents the browser SDK customer path while retaining the internal no-alias smoke', () => {
    const clientReadmePath = 'packages/collab/README.md'
    const exampleReadmePath = 'examples/collab/README.md'
    const smokeScriptPath = 'tools/release/check-gate6-third-party-smoke.mjs'

    expect(existsSync(clientReadmePath)).toBe(true)
    expect(existsSync(exampleReadmePath)).toBe(true)
    expect(existsSync(smokeScriptPath)).toBe(true)

    const clientReadme = readFileSync(clientReadmePath, 'utf8')
    const exampleReadme = readFileSync(exampleReadmePath, 'utf8')
    const smokeScript = readFileSync(smokeScriptPath, 'utf8')

    for (const token of [
      'connectJWordCollaboration',
      'startAutoInsertSession',
      'history.recordVersion',
      'JWORD_LICENSE_MISSING',
      '版本化 Docker 镜像',
      'HTTP/WSS endpoint',
      '不导入服务端 npm package'
    ]) {
      expect(`${clientReadme}\n${exampleReadme}`, token).toContain(token)
    }
    expect(clientReadme).not.toContain("from '@4xian/jword-collab-server'")
    for (const token of [
      'check-gate6-third-party-smoke.mjs',
      'runLegacyConsumerCli',
      'check-phase3-third-party-consumers.mjs'
    ]) {
      expect(smokeScript, token).toContain(token)
    }
    const consumerSource = readFileSync('tools/release/check-phase3-third-party-consumers.mjs', 'utf8')
    expect(consumerSource).toContain('--artifact-manifest')
    expect(consumerSource).toContain('--binding')
    expect(consumerSource).toContain('legacy-non-gating')
    expect(smokeScript).not.toMatch(/(?:npm|pnpm)\s+pack/u)
  })

  /** 校验 Gate 6 默认入口只读扫描受限 package。 */
  function verifyGate6ArtifactScanner() {
    const scriptPath = 'tools/release/check-gate6-commercial-pack.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const execution = runWithPackCommandTrap(scriptPath)
    const report = JSON.parse(execution.output) as {
      readonly status: string
      readonly mode: string
      readonly packCommands: number
      readonly packages: readonly { readonly name: string, readonly status: string }[]
    }

    const expectedMode = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined ? 'source' : 'artifact'

    expect(report).toMatchObject({ status: 'ok', mode: expectedMode, packCommands: 0 })
    expect(report.packages.map(readPackageName)).toEqual([
      '@4xian/jword-collab',
      '@4xian/jword-collab-server',
      '@4xian/jword-license',
      '@4xian/jword-persistence'
    ])
    expect(report.packages.every(isSuccessfulPackageReport)).toBe(true)
    expect(execution.commands).toEqual([])
    expect(readFileSync(scriptPath, 'utf8')).toContain('check-package-artifacts.mjs')
  }

  it('provides a Gate 6 commercial pack audit for restricted registry packages', verifyGate6ArtifactScanner)

  it('uses Node ESM compatible .js suffixes for published runtime relative imports', () => {
    expect(existsSync('tools/release/normalize-dist-relative-imports.mjs')).toBe(true)

    const runtimeSourcePaths = [
      'packages/collab/src/index.ts',
      'packages/collab/src/experimental.ts',
      'packages/collab/src/hocuspocus-adapter.ts',
      'packages/collab/src/client-diagnostics.ts',
      'packages/collab/src/client-sdk.ts',
      'packages/collab/src/client-types.ts',
      'packages/persistence/src/index.ts',
      'packages/persistence/src/indexeddb-adapter.ts',
      'packages/persistence/src/storage-history-adapter.ts'
    ]

    for (const sourcePath of runtimeSourcePaths) {
      assertRuntimeRelativeImportsUseJsSuffix(sourcePath)
    }
  })

  it('keeps collab demo server as a thin starter over the formal server package', () => {
    const demoServer = readFileSync('examples/collab/server/hocuspocus-service.ts', 'utf8')
    const formalServer = readFileSync('packages/collab-server/src/index.ts', 'utf8')
    const formalHocuspocusServer = readFileSync('packages/collab-server/src/hocuspocus-server.ts', 'utf8')
    const formalAutoInsertRelay = readFileSync('packages/collab-server/src/auto-insert-relay.ts', 'utf8')
    const formalHistoryService = readFileSync('packages/collab-server/src/history-service.ts', 'utf8')
    const formalHistoryRoutes = readFileSync('packages/collab-server/src/history-routes.ts', 'utf8')
    const formalHttpUtils = readFileSync('packages/collab-server/src/http-utils.ts', 'utf8')

    expect(demoServer).toContain('@4xian/jword-collab-server')
    expect(demoServer).not.toContain('@hocuspocus/server')
    expect(demoServer).not.toContain('./hocuspocus-history-api')
    expect(demoServer).not.toContain('./hocuspocus-history-service')
    expect(formalHistoryService).toContain('documentLocks')
    expect(formalServer).toContain('createJWordCollabHocuspocusServer')
    expect(formalHocuspocusServer).toContain('onAuthenticate')
    expect(formalHocuspocusServer).toContain('beforeSync')
    expect(formalServer).toContain('/auto-insert/relay')
    expect(formalAutoInsertRelay).toContain('GATE6_COLLAB_FEATURES.autoInsert')
    expect(formalHistoryRoutes).toContain('GATE6_COLLAB_FEATURES.history')
    expect(formalHttpUtils).toContain('/jword-history/versions')
    expect(formalHttpUtils).toContain('/jword-history/preview')
  })
})

/** 读取 Gate 6 package report 的名称。 */
function readPackageName(report: { readonly name: string }): string {
  return report.name
}

/** 判断 Gate 6 package report 是否成功。 */
function isSuccessfulPackageReport(report: { readonly status: string }): boolean {
  return report.status === 'ok'
}

/** 在 npm/pnpm 命令 trap 下运行 release script 并读取可观测调用记录。 */
function runWithPackCommandTrap(scriptPath: string): { readonly output: string, readonly commands: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-pack-trap-'))
  const binDirectory = join(root, 'bin')
  const logPath = join(root, 'commands.log')
  const trap = '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$JWORD_PHASE3_PACK_COMMAND_LOG"\nexit 97\n'

  try {
    execFileSync('mkdir', ['-p', binDirectory])
    for (const command of ['npm', 'pnpm']) {
      const commandPath = join(binDirectory, command)

      writeFileSync(commandPath, trap)
      chmodSync(commandPath, 0o755)
    }

    const scriptArguments = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined
      ? [scriptPath]
      : [scriptPath, '--artifact-manifest', process.env.JWORD_PHASE3_ARTIFACT_MANIFEST]
    const output = execFileSync(process.execPath, scriptArguments, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
        JWORD_PHASE3_PACK_COMMAND_LOG: logPath
      }
    })
    const commands = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean) : []

    return { output, commands }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 读取协作 client SDK 稳定入口及其公开类型模块。 */
function readCollabClientSdkSource(): string {
  return [
    'packages/collab/src/client-sdk.ts',
    'packages/collab/src/client-types.ts'
  ].map((path) => readFileSync(path, 'utf8')).join('\n')
}

/** 约束协作消费包由宿主提供唯一 License runtime，并仅在仓库开发时直接链接。 */
function assertLicensePeerDependency(packageJson: PackageJson): void {
  expect(packageJson.dependencies).not.toHaveProperty('@4xian/jword-license')
  expect(packageJson.peerDependencies?.['@4xian/jword-license']).toBe('workspace:*')
  expect(packageJson.devDependencies?.['@4xian/jword-license']).toBe('workspace:*')
  expect(packageJson.peerDependenciesMeta?.['@4xian/jword-license']).toBeUndefined()
}

interface PackageJson {
  readonly name?: string
  readonly private?: boolean
  readonly exports?: unknown
  readonly files?: readonly string[]
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

/** 读取 workspace package manifest。 */
function readPackageJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageJson
}

/** 从源码中读取简单字符串常量。 */
function readConstLiteral(source: string, name: string): string {
  const match = new RegExp(`export const ${name} = '([^']+)'`, 'u').exec(source)

  if (match === null) {
    throw new Error(`Missing const literal: ${name}`)
  }

  const value = match[1]

  if (value === undefined) {
    throw new Error(`Missing const literal value: ${name}`)
  }

  return value
}

/** 约束发布到 npm pack 的 ESM 运行时代码使用 Node 可解析的相对路径。 */
function assertRuntimeRelativeImportsUseJsSuffix(sourcePath: string): void {
  const source = readFileSync(sourcePath, 'utf8')
  const runtimeRelativeImportPattern = /^\s*(?!import\s+type\b)(?:import|export)\s+(?!type\b)[^'"\n]*from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gmu
  let match: RegExpExecArray | null

  while ((match = runtimeRelativeImportPattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2]

    if (
      specifier !== undefined &&
      specifier.startsWith('./') &&
      !specifier.endsWith('.js')
    ) {
      throw new Error(`${sourcePath}: runtime import ${specifier} must include .js for Node ESM package consumers.`)
    }
  }
}
