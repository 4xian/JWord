/**
 * @vitest-environment node
 *
 * 职责：锁定四个legacy release入口只读同一Phase 3 artifact inventory且不重新pack。
 * 边界：只在仓库外构造synthetic tarball和manifest，不构建或修改当前JWord工作树。
 * 协作模块：package artifact contract、统一scanner与Gate 4.5/5/6/7兼容入口。
 * 性能/安全约束：npm/pnpm包装器一旦被调用立即失败，并在结束时清理临时目录。
 * 实现说明：通过公开CLI接缝验证artifact模式，不读取入口内部状态。
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)

interface ReleaseInventoryFixture {
  readonly root: string
  readonly manifestPath: string
  readonly commandLog: string
  readonly environment: Record<string, string | undefined>
}

/** 注册legacy release inventory公开CLI回归。 */
function runReleaseInventoryEntrypointsSuite(): void {
  it('routes all four release entrypoints through one read-only synthetic inventory', verifyReleaseInventoryEntrypoints, 60_000)
}

describe('Phase 3 release inventory entrypoints', runReleaseInventoryEntrypointsSuite)

/** 校验四个兼容入口只读同一synthetic artifact manifest且不调用pack。 */
function verifyReleaseInventoryEntrypoints(): void {
  const fixture = createReleaseInventoryFixture()
  const scripts = [
    'tools/release/check-native-pack.mjs',
    'tools/release/check-gate5-commercial-pack.mjs',
    'tools/release/check-gate6-commercial-pack.mjs',
    'tools/release/gate7-release-dry-run.mjs'
  ]

  try {
    for (const script of scripts) {
      const result = spawnSync(process.execPath, [
        join(REPO_ROOT, script),
        '--artifact-manifest',
        fixture.manifestPath
      ], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: {
          ...fixture.environment,
          JWORD_PHASE3_ARTIFACT_MANIFEST: fixture.manifestPath
        }
      })

      assertCommandPassed(result, script)
      expect(JSON.parse(result.stdout)).toMatchObject({ status: 'ok', mode: 'artifact', packCommands: 0 })
    }
    expect(existsSync(fixture.commandLog) ? readFileSync(fixture.commandLog, 'utf8') : '').toBe('')
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
}

/** 创建覆盖十二个contract package的只读scanner inventory fixture。 */
function createReleaseInventoryFixture(): ReleaseInventoryFixture {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-release-inventory-'))
  const binDirectory = join(root, 'bin')
  const commandLog = join(root, 'commands.log')
  const contract = JSON.parse(readFileSync(join(REPO_ROOT, 'tools/release/package-artifact-contract.json'), 'utf8'))
  const packages = []

  mkdirSync(binDirectory)
  for (const command of ['npm', 'pnpm']) {
    const commandPath = join(binDirectory, command)

    writeFileSync(commandPath, '#!/bin/sh\nprintf \'%s %s\\n\' "$0" "$*" >> "$JWORD_PHASE3_PACK_COMMAND_LOG"\nexit 97\n')
    chmodSync(commandPath, 0o755)
  }
  writeFileSync(commandLog, '')

  for (const packageContract of contract.packages) {
    const id = packageContract.name.slice('@4xian/jword-'.length)
    const caseRoot = join(root, `package-${id}`)
    const packageRoot = join(caseRoot, 'package')
    const tarballFile = `${id}.tgz`
    const tarballPath = join(root, tarballFile)

    writeFixtureFile(packageRoot, 'package.json', JSON.stringify(createScannerPackedManifest(packageContract)))
    for (const exportEntry of packageContract.exports) {
      const targets = typeof exportEntry.target === 'string'
        ? [exportEntry.target]
        : [exportEntry.target.types, exportEntry.target.import]

      for (const target of targets) {
        writeFixtureFile(packageRoot, target.replace(/^\.\//u, ''), 'export {}\n')
      }
    }
    if (packageContract.files.includes('README.md')) {
      writeFixtureFile(packageRoot, 'README.md', '# Synthetic package\n')
    }
    for (const fixturePath of packageContract.fixtureAllowlist) {
      writeFixtureFile(packageRoot, fixturePath, readFileSync(join(REPO_ROOT, packageContract.workspacePath, fixturePath)))
    }

    const tarResult = spawnSync('tar', ['-czf', tarballPath, '-C', caseRoot, 'package'], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, COPYFILE_DISABLE: '1' }
    })

    assertCommandPassed(tarResult, `create ${id} tarball`)
    packages.push({ name: packageContract.name, tarballFile })
  }

  const manifestPath = join(root, 'artifact-manifest.json')

  writeFileSync(manifestPath, JSON.stringify({ packages }))
  return {
    root,
    manifestPath,
    commandLog,
    environment: {
      ...process.env,
      PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
      JWORD_PHASE3_PACK_COMMAND_LOG: commandLog
    }
  }
}

/** 从机器contract创建scanner期望的synthetic packed manifest。 */
function createScannerPackedManifest(packageContract: {
  readonly name: string
  readonly version: string
  readonly private: boolean
  readonly sourceAccess: string
  readonly files: readonly string[]
  readonly exports: readonly { readonly subpath: string, readonly target: unknown }[]
  readonly sideEffects: false | readonly string[]
  readonly dependencyPolicy: {
    readonly firstParty: readonly string[]
    readonly firstPartyPeers: readonly string[]
    readonly external: Readonly<Record<string, string>>
    readonly externalPeers: Readonly<Record<string, string>>
  }
}): Readonly<Record<string, unknown>> {
  /** 读取 contract 中的单个 export 映射。 */
  const exports = Object.fromEntries(packageContract.exports.map(function readExportEntry(entry) {
    return [entry.subpath, entry.target]
  }))

  return {
    name: packageContract.name,
    version: packageContract.version,
    private: packageContract.private,
    type: 'module',
    publishConfig: { access: packageContract.sourceAccess },
    files: packageContract.files,
    exports,
    sideEffects: packageContract.sideEffects,
    dependencies: createScannerDependencies(
      packageContract.dependencyPolicy.firstParty,
      packageContract.dependencyPolicy.external,
      packageContract.version
    ),
    peerDependencies: createScannerDependencies(
      packageContract.dependencyPolicy.firstPartyPeers,
      packageContract.dependencyPolicy.externalPeers,
      packageContract.version
    )
  }
}

/** 生成scanner期望的ASCII排序dependency map。 */
function createScannerDependencies(
  firstParty: readonly string[],
  external: Readonly<Record<string, string>>,
  version: string
): Readonly<Record<string, string>> {
  const dependencies = { ...external }

  for (const name of firstParty) {
    dependencies[name] = version
  }

  return Object.fromEntries(Object.entries(dependencies).sort())
}

/** 写入fixture相对文件并创建父目录。 */
function writeFixtureFile(root: string, relativePath: string, content: string | Buffer): void {
  const path = join(root, relativePath)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

/** 断言子进程成功，否则附带稳定的stdout/stderr便于定位fixture。 */
function assertCommandPassed(result: SpawnSyncReturns<string>, label: string): void {
  expect(result.status, `${label}\n${result.stdout}\n${result.stderr}`).toBe(0)
}
