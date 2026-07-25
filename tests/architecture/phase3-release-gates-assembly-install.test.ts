/**
 * @vitest-environment node
 *
 * 职责：锁定 Phase 3 assembly 安装期间 loopback registry 可服务子进程请求。
 * 边界：只使用单包 synthetic artifact 和 fake pnpm，不运行完整 run-a 或访问外部 registry。
 * 协作模块：第三阶段发布门禁的 assembly 公开边界、本地只读注册表与包管理子进程。
 * 性能/安全约束：反馈环必须在数秒内完成，不读取凭据、不 publish、不写仓库目录。
 * 实现说明：测试只观察公开 assembly seam 的安装结果，不断言内部子进程实现形状。
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  validateAssemblyDependencyEvidence
// @ts-expect-error -- 生产 .mjs verifier 未提供 TypeScript 声明文件。
} from '../../tools/release/verify-phase3-final-evidence.mjs'

const REPO_ROOT = resolve(new URL('../..', import.meta.url).pathname)
const RELEASE_GATES_URL = pathToFileURL(resolve(REPO_ROOT, 'tools/release/check-phase3-release-gates.mjs')).href
const packageName = '@4xian/jword-core'
const packageVersion = '0.0.0'
const fakePnpmSource = `#!/usr/bin/env node
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const command = process.argv[2]
const cwd = process.cwd()
const packageName = '${packageName}'
const packageVersion = '${packageVersion}'
const packagePath = join(cwd, 'node_modules', ...packageName.split('/'))

if (command === 'install') {
  void (async () => {
    const config = readFileSync(process.env.NPM_CONFIG_USERCONFIG, 'utf8')
    const origin = config.match(/^@4xian:registry=(.+)$/mu)?.[1]
    if (origin === undefined) throw new Error('scoped registry is missing')
    const metadataResponse = await fetch(new URL(encodeURIComponent(packageName), origin), {
      signal: AbortSignal.timeout(750)
    })
    if (!metadataResponse.ok) throw new Error('metadata request failed')
    const metadata = await metadataResponse.json()
    const tarballResponse = await fetch(metadata.versions[packageVersion].dist.tarball, {
      signal: AbortSignal.timeout(750)
    })
    if (!tarballResponse.ok) throw new Error('tarball request failed')
    await tarballResponse.arrayBuffer()
    mkdirSync(packagePath, { recursive: true })
    writeFileSync(join(packagePath, 'package.json'), JSON.stringify({
      name: packageName,
      version: packageVersion,
      optionalDependencies: { '@synthetic/missing-optional': '1.0.0' }
    }))
    writeFileSync(join(cwd, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\\n")
  })().catch((error) => {
    const message = error instanceof Error ? error.message : 'fake pnpm install failed'
    writeFileSync(join(cwd, 'fake-pnpm-error.txt'), message)
    console.error(message)
    process.exitCode = 1
  })
} else if (command === 'audit') {
  const report = { metadata: { vulnerabilities: { info: 0, low: 0, moderate: 1, high: 0, critical: 0, total: 1 } } }
  if (process.env.JWORD_PHASE3_TEST_AUDIT_ERROR === '1') {
    report.error = { code: 'ERR_PNPM_AUDIT_ENDPOINT', summary: 'audit endpoint failed' }
    console.error('audit endpoint failed')
  }
  console.log(JSON.stringify(report))
  process.exitCode = 1
} else if (command === 'list') {
  console.log(JSON.stringify([{ name: 'phase3-assembly-fixture', version: '0.0.0', path: cwd, private: true, dependencies: {
    [packageName]: { from: packageName, version: packageVersion, path: packagePath, dependencies: {
      '@synthetic/missing-optional': { from: '@synthetic/missing-optional', version: '1.0.0', path: join(cwd, 'node_modules', '.pnpm', 'missing-optional') }
    } }
  } }]))
} else {
  console.error('unexpected fake pnpm command')
  process.exitCode = 1
}
`

describe('Phase 3 release-gates assembly install', () => {
  it('serves loopback package metadata while the installer child process runs', verifyAssemblyInstall)
  it('rejects advisory output mixed with an audit tool error', verifyAssemblyAuditError)
  it('rejects materialized dependencies reclassified as optional', verifyOptionalDependencyClassification)
})

/** 通过公开 assembly seam 验证安装子进程能够读取同进程 loopback registry。 */
function verifyAssemblyInstall(): void { verifyAssembly(false) }

/** 通过公开 assembly seam 验证 advisory 不会掩盖 audit 工具错误。 */
function verifyAssemblyAuditError(): void { verifyAssembly(true) }

/** 证明 final verifier 只接受父包声明且真实未物化的 optional 节点。 */
function verifyOptionalDependencyClassification(): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-optional-evidence-'))

  try {
    const parentPath = join(root, 'missing-parent')
    const optionalPath = join(root, 'node_modules', '.pnpm', '@synthetic+missing-optional@1.0.0', 'node_modules', '@synthetic', 'missing-optional')
    const substitutePath = join(root, 'node_modules', '.pnpm', '@synthetic+android-substitute@1.0.0', 'node_modules', '@synthetic', 'android-substitute')
    const materializedDirectory = join(root, 'node_modules', '.pnpm', '@synthetic+materialized@1.0.0', 'node_modules', '@synthetic', 'materialized')
    mkdirSync(materializedDirectory, { recursive: true })
    const materializedPath = realpathSync(materializedDirectory)
    const environment = { os: 'linux', arch: 'x64' }
    const substituteName = '@synthetic/android-substitute'
    const dependencyList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [substituteName]: { version: '1.0.0', path: substitutePath },
        '@synthetic/materialized': { version: '1.0.0', path: materializedPath },
        '@synthetic/missing-optional': { version: '1.0.0', path: optionalPath }
      } }
    } }]
    const parent = { name: packageName, version: packageVersion, realpath: parentPath }
    const materialized = { name: '@synthetic/materialized', version: '1.0.0', realpath: materializedPath }
    const missingOptional = { name: '@synthetic/missing-optional', version: '1.0.0', path: optionalPath }
    const substituteOptional = { name: substituteName, version: '1.0.0', path: substitutePath }
    const omitted = [substituteOptional, missingOptional]
    const required = { [packageName]: packageVersion }
    const childOnlyLockfile = "snapshots:\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"
    const packagesOnlyLockfile = "packages:\n  '@4xian/jword-core@0.0.0':\n    optionalDependencies:\n      '@synthetic/missing-optional': 1.0.0\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n\nsnapshots:\n"
    const lockfile = "packages:\n  '@synthetic/android-substitute@1.0.0':\n    cpu: [arm64]\n    os: [android]\n  '@synthetic/materialized@1.0.0':\n    cpu: [x64]\n    os: [linux]\n  '@synthetic/missing-optional@1.0.0':\n    cpu: [arm64]\n    os: [android]\n\nsnapshots:\n  '@4xian/jword-core@0.0.0':\n    optionalDependencies:\n      '@synthetic/android-substitute': 1.0.0\n      '@synthetic/materialized': 1.0.0\n      '@synthetic/missing-optional': 1.0.0\n  '@synthetic/android-substitute@1.0.0':\n    optional: true\n  '@synthetic/materialized@1.0.0':\n    optional: true\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"

    expect(() => validateAssemblyDependencyEvidence(dependencyList, [parent, materialized], omitted, required, 'customer', childOnlyLockfile, environment, lockfile)).toThrow('customer assembly optional dependency is invalid')
    expect(() => validateAssemblyDependencyEvidence(dependencyList, [parent, materialized], omitted, required, 'customer', packagesOnlyLockfile, environment, lockfile)).toThrow('customer assembly optional dependency is invalid')
    expect(() => validateAssemblyDependencyEvidence(dependencyList, [parent, materialized], omitted, required, 'customer', lockfile, environment, lockfile)).not.toThrow()
    const parentA = { name: '@synthetic/parent-a', version: '1.0.0', realpath: join(root, 'node_modules', '.pnpm', '@synthetic+parent-a@1.0.0', 'node_modules', '@synthetic', 'parent-a') }
    const parentB = { name: '@synthetic/parent-b', version: '1.0.0', realpath: join(root, 'node_modules', '.pnpm', '@synthetic+parent-b@1.0.0', 'node_modules', '@synthetic', 'parent-b') }
    const multiParentList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [parentA.name]: { version: parentA.version, path: parentA.realpath, dependencies: {
          [missingOptional.name]: { version: missingOptional.version, path: optionalPath }
        } },
        [parentB.name]: { version: parentB.version, path: parentB.realpath, dependencies: {
          [missingOptional.name]: { version: missingOptional.version, path: optionalPath }
        } }
      } }
    } }]
    const multiParentLockfile = "snapshots:\n  '@synthetic/parent-a@1.0.0': {}\n  '@synthetic/parent-b@1.0.0':\n    optionalDependencies:\n      '@synthetic/missing-optional': 1.0.0\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"
    expect(() => validateAssemblyDependencyEvidence(multiParentList, [parent, parentA, parentB], [missingOptional], required, 'customer', multiParentLockfile, environment, lockfile)).toThrow('customer assembly optional dependency is invalid')
    expect(() => validateAssemblyDependencyEvidence(
      dependencyList,
      [parent],
      [...omitted, { name: materialized.name, version: materialized.version, path: materialized.realpath }],
      required,
      'customer',
      lockfile,
      environment,
      lockfile
    )).toThrow('customer optional dependency path is materialized')
    rmSync(materializedDirectory, { recursive: true })
    expect(() => validateAssemblyDependencyEvidence(
      dependencyList,
      [parent],
      [...omitted, { name: materialized.name, version: materialized.version, path: materialized.realpath }],
      required,
      'customer',
      lockfile,
      environment,
      lockfile
    )).toThrow('customer assembly optional dependency is invalid')
    const spoofedLockfile = lockfile.replace('cpu: [x64]\n    os: [linux]', 'cpu: [arm64]\n    os: [android]')
    expect(() => validateAssemblyDependencyEvidence(
      dependencyList,
      [parent, materialized],
      omitted,
      required,
      'customer',
      spoofedLockfile,
      environment,
      lockfile
    )).toThrow('customer assembly dependency is excluded from the environment')
    expect(() => validateAssemblyDependencyEvidence(
      dependencyList,
      [parent],
      [...omitted, { name: materialized.name, version: materialized.version, path: materialized.realpath }],
      required,
      'customer',
      spoofedLockfile,
      environment,
      lockfile
    )).toThrow('customer assembly optional dependency is invalid')
    const substitutedList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [substituteName]: { version: '1.0.0', path: materializedPath },
        [missingOptional.name]: { version: missingOptional.version, path: optionalPath }
      } }
    } }]
    expect(() => validateAssemblyDependencyEvidence(
      substitutedList,
      [parent],
      [missingOptional, { name: substituteName, version: '1.0.0', path: materializedPath }],
      required,
      'customer',
      lockfile,
      environment,
      lockfile
    )).toThrow('customer dependency list path is invalid')
    const nestedParentName = '@synthetic/nested-parent'
    const substitutedParentName = '@synthetic/substituted-parent'
    const nestedParentDirectory = join(root, 'node_modules', '.pnpm', '@synthetic+nested-parent@1.0.0', 'node_modules', '@synthetic', 'nested-parent')
    mkdirSync(nestedParentDirectory, { recursive: true })
    const nestedParentPath = realpathSync(nestedParentDirectory)
    const parentSubstitutionList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [substitutedParentName]: { version: '1.0.0', path: nestedParentPath, dependencies: {
          [missingOptional.name]: { version: missingOptional.version, path: optionalPath }
        } }
      } }
    } }]
    const parentSubstitutionLockfile = "packages:\n  '@synthetic/missing-optional@1.0.0':\n    cpu: [arm64]\n    os: [android]\n\nsnapshots:\n  '@synthetic/substituted-parent@1.0.0':\n    optionalDependencies:\n      '@synthetic/missing-optional': 1.0.0\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"
    const trustedParentLockfile = "packages:\n  '@synthetic/missing-optional@1.0.0':\n    cpu: [arm64]\n    os: [android]\n\nsnapshots:\n  '@synthetic/nested-parent@1.0.0':\n    optionalDependencies:\n      '@synthetic/missing-optional': 1.0.0\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"
    const trustedParentWithoutOptionalEdgeLockfile = "packages:\n  '@synthetic/missing-optional@1.0.0':\n    cpu: [arm64]\n    os: [android]\n\nsnapshots:\n  '@synthetic/substituted-parent@1.0.0':\n  '@synthetic/missing-optional@1.0.0':\n    optional: true\n"
    const promotedParentLockfile = `snapshots:\n  '${packageName}@${packageVersion}': {}\n  '${substitutedParentName}@1.0.0': {}\n`
    expect(() => validateAssemblyDependencyEvidence(
      parentSubstitutionList,
      [parent, { name: substitutedParentName, version: '1.0.0', realpath: nestedParentPath }],
      [missingOptional],
      required,
      'customer',
      parentSubstitutionLockfile,
      environment,
      trustedParentLockfile
    )).toThrow('customer dependency list path is invalid')
    const substitutedParentPath = join(root, 'node_modules', '.pnpm', '@synthetic+substituted-parent@1.0.0', 'node_modules', '@synthetic', 'substituted-parent')
    const parentIdentityAndPathSubstitutionList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [substitutedParentName]: { version: '1.0.0', path: substitutedParentPath, dependencies: {
          [missingOptional.name]: { version: missingOptional.version, path: optionalPath }
        } }
      } }
    } }]
    expect(() => validateAssemblyDependencyEvidence(
      parentIdentityAndPathSubstitutionList,
      [parent, { name: substitutedParentName, version: '1.0.0', realpath: substitutedParentPath }],
      [missingOptional],
      required,
      'customer',
      parentSubstitutionLockfile,
      environment,
      trustedParentLockfile
    )).toThrow('customer assembly optional dependency is invalid')
    expect(() => validateAssemblyDependencyEvidence(
      parentIdentityAndPathSubstitutionList,
      [parent, { name: substitutedParentName, version: '1.0.0', realpath: substitutedParentPath }],
      [missingOptional],
      required,
      'customer',
      parentSubstitutionLockfile,
      environment,
      trustedParentWithoutOptionalEdgeLockfile
    )).toThrow('customer assembly optional dependency is invalid')
    const promotedParentList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath },
      [substitutedParentName]: { version: '1.0.0', path: substitutedParentPath }
    } }]
    expect(() => validateAssemblyDependencyEvidence(
      promotedParentList,
      [parent, { name: substitutedParentName, version: '1.0.0', realpath: substitutedParentPath }],
      [],
      required,
      'customer',
      promotedParentLockfile,
      environment,
      trustedParentWithoutOptionalEdgeLockfile
    )).toThrow('customer direct dependency list is invalid')
    const externalName = 'external-package'
    const externalVersion = '1.0.0'
    const externalPath = join(root, 'node_modules', '.pnpm', 'wrong-package@1.0.0', 'node_modules', 'wrong-package')
    const externalList = [{ dependencies: { [externalName]: { version: externalVersion, path: externalPath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      externalList,
      [{ name: externalName, version: externalVersion, realpath: externalPath }],
      [],
      { [externalName]: externalVersion },
      'customer',
      'snapshots:\n',
      environment,
      'snapshots:\n'
    )).toThrow('customer dependency list path is invalid')
    const externalForgedPath = join(root, 'node_modules', '.pnpm', `${externalName}@${externalVersion}`, 'forged', 'node_modules', externalName)
    const externalForgedList = [{ dependencies: { [externalName]: { version: externalVersion, path: externalForgedPath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      externalForgedList,
      [{ name: externalName, version: externalVersion, realpath: externalForgedPath }],
      [],
      { [externalName]: externalVersion },
      'customer',
      `snapshots:\n  '${externalName}@${externalVersion}': {}\n`,
      environment,
      'snapshots:\n'
    )).toThrow('customer dependency list path is invalid')
    const externalNestedForgedPath = join(root, 'node_modules', '.pnpm', `${externalName}@${externalVersion}`, 'node_modules', 'forged', 'node_modules', externalName)
    const externalNestedForgedList = [{ dependencies: { [externalName]: { version: externalVersion, path: externalNestedForgedPath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      externalNestedForgedList,
      [{ name: externalName, version: externalVersion, realpath: externalNestedForgedPath }],
      [],
      { [externalName]: externalVersion },
      'customer',
      `snapshots:\n  '${externalName}@${externalVersion}': {}\n`,
      environment,
      'snapshots:\n'
    )).toThrow('customer dependency list path is invalid')
    const externalValidPath = join(root, 'node_modules', '.pnpm', `${externalName}@${externalVersion}`, 'node_modules', externalName)
    const externalValidList = [{ dependencies: { [externalName]: { version: externalVersion, path: externalValidPath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      externalValidList,
      [{ name: externalName, version: externalVersion, realpath: externalValidPath }],
      [],
      { [externalName]: externalVersion },
      'customer',
      `snapshots:\n  '${externalName}@${externalVersion}': {}\n`,
      environment,
      `snapshots:\n  '${externalName}@${externalVersion}(peer-only@1.0.0)':\n    optionalDependencies:\n      peer-only: 1.0.0\n`
    )).not.toThrow()
    const assemblyOnlyName = '@synthetic/assembly-only'
    const assemblyOnlyVersion = '1.0.0'
    const assemblyOnlyPath = join(root, 'node_modules', '.pnpm', '@synthetic+assembly-only@1.0.0', 'node_modules', '@synthetic', 'assembly-only')
    const resolutionDriftList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [assemblyOnlyName]: { version: assemblyOnlyVersion, path: assemblyOnlyPath }
      } }
    } }]
    const resolutionDriftEvidence = [parent, { name: assemblyOnlyName, version: assemblyOnlyVersion, realpath: assemblyOnlyPath }]
    expect(() => validateAssemblyDependencyEvidence(
      resolutionDriftList,
      resolutionDriftEvidence,
      [],
      required,
      'customer',
      `snapshots:\n  '${packageName}@${packageVersion}': {}\n  '${assemblyOnlyName}@${assemblyOnlyVersion}': {}\n`,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    expect(() => validateAssemblyDependencyEvidence(
      resolutionDriftList,
      resolutionDriftEvidence,
      [],
      required,
      'customer',
      `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${assemblyOnlyName}': ${assemblyOnlyVersion}\n  '${assemblyOnlyName}@${assemblyOnlyVersion}': {}\n`,
      environment,
      'snapshots:\n'
    )).not.toThrow()
    expect(() => validateAssemblyDependencyEvidence(
      resolutionDriftList,
      resolutionDriftEvidence,
      [],
      required,
      'customer',
      `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${assemblyOnlyName}': ${assemblyOnlyVersion}\n    optionalDependencies:\n      '${assemblyOnlyName}': ${assemblyOnlyVersion}\n  '${assemblyOnlyName}@${assemblyOnlyVersion}':\n    optional: true\n`,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly optional dependency is invalid')
    expect(() => validateAssemblyDependencyEvidence(
      resolutionDriftList,
      resolutionDriftEvidence,
      [],
      required,
      'customer',
      `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${assemblyOnlyName}': ${assemblyOnlyVersion}\n      '@synthetic/missing-from-raw': 1.0.0\n  '${assemblyOnlyName}@${assemblyOnlyVersion}': {}\n  '@synthetic/missing-from-raw@1.0.0': {}\n`,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    const peerBoundName = '@synthetic/peer-bound'
    const peerBoundVersion = '1.0.0'
    const peerBoundPath = join(root, 'node_modules', '.pnpm', '@synthetic+peer-bound@1.0.0_peer-a@1.0.0', 'node_modules', '@synthetic', 'peer-bound')
    const peerBoundPeerBPath = join(root, 'node_modules', '.pnpm', '@synthetic+peer-bound@1.0.0_peer-b@1.0.0', 'node_modules', '@synthetic', 'peer-bound')
    const peerEdgeContextMismatchList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [peerBoundName]: { version: peerBoundVersion, path: peerBoundPeerBPath }
      } }
    } }]
    const peerEdgeContextLockfile = `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${peerBoundName}': ${peerBoundVersion}(peer-a@1.0.0)\n  '${peerBoundName}@${peerBoundVersion}(peer-a@1.0.0)': {}\n  '${peerBoundName}@${peerBoundVersion}(peer-b@1.0.0)': {}\n`
    expect(() => validateAssemblyDependencyEvidence(
      peerEdgeContextMismatchList,
      [parent, { name: peerBoundName, version: peerBoundVersion, realpath: peerBoundPeerBPath }],
      [],
      required,
      'customer',
      peerEdgeContextLockfile,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    const repeatedRootAName = '@4xian/repeated-root-a'
    const repeatedRootBName = '@4xian/repeated-root-b'
    const repeatedRootAPath = join(root, 'repeated-root-a')
    const repeatedRootBPath = join(root, 'repeated-root-b')
    const repeatedParentName = '@synthetic/repeated-parent'
    const repeatedParentPath = join(root, 'node_modules', '.pnpm', '@synthetic+repeated-parent@1.0.0', 'node_modules', '@synthetic', 'repeated-parent')
    const repeatedParentList = [{ dependencies: {
      [repeatedRootAName]: { version: packageVersion, path: repeatedRootAPath, dependencies: {
        [repeatedParentName]: { version: '1.0.0', path: repeatedParentPath, dependencies: {
          [peerBoundName]: { version: peerBoundVersion, path: peerBoundPath }
        } }
      } },
      [repeatedRootBName]: { version: packageVersion, path: repeatedRootBPath, dependencies: {
        [repeatedParentName]: { version: '1.0.0', path: repeatedParentPath, dependencies: {
          [peerBoundName]: { version: peerBoundVersion, path: peerBoundPeerBPath }
        } }
      } }
    } }]
    const repeatedParentLockfile = `snapshots:\n  '${repeatedRootAName}@${packageVersion}':\n    dependencies:\n      '${repeatedParentName}': 1.0.0\n  '${repeatedRootBName}@${packageVersion}':\n    dependencies:\n      '${repeatedParentName}': 1.0.0\n  '${repeatedParentName}@1.0.0':\n    dependencies:\n      '${peerBoundName}': ${peerBoundVersion}(peer-b@1.0.0)\n  '${peerBoundName}@${peerBoundVersion}(peer-a@1.0.0)': {}\n  '${peerBoundName}@${peerBoundVersion}(peer-b@1.0.0)': {}\n`
    expect(() => validateAssemblyDependencyEvidence(
      repeatedParentList,
      [
        { name: repeatedRootAName, version: packageVersion, realpath: repeatedRootAPath },
        { name: repeatedRootBName, version: packageVersion, realpath: repeatedRootBPath },
        { name: repeatedParentName, version: '1.0.0', realpath: repeatedParentPath },
        { name: peerBoundName, version: peerBoundVersion, realpath: peerBoundPath },
        { name: peerBoundName, version: peerBoundVersion, realpath: peerBoundPeerBPath }
      ],
      [],
      { [repeatedRootAName]: packageVersion, [repeatedRootBName]: packageVersion },
      'customer',
      repeatedParentLockfile,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    const repeatedChildAName = '@synthetic/repeated-child-a'
    const repeatedChildBName = '@synthetic/repeated-child-b'
    const repeatedChildAPath = join(root, 'node_modules', '.pnpm', '@synthetic+repeated-child-a@1.0.0', 'node_modules', '@synthetic', 'repeated-child-a')
    const repeatedChildBPath = join(root, 'node_modules', '.pnpm', '@synthetic+repeated-child-b@1.0.0', 'node_modules', '@synthetic', 'repeated-child-b')
    const repeatedSubsetList = [{ dependencies: {
      [repeatedRootAName]: { version: packageVersion, path: repeatedRootAPath, dependencies: {
        [repeatedParentName]: { version: '1.0.0', path: repeatedParentPath, dependencies: {
          [repeatedChildAName]: { version: '1.0.0', path: repeatedChildAPath }
        } }
      } },
      [repeatedRootBName]: { version: packageVersion, path: repeatedRootBPath, dependencies: {
        [repeatedParentName]: { version: '1.0.0', path: repeatedParentPath, dependencies: {
          [repeatedChildBName]: { version: '1.0.0', path: repeatedChildBPath }
        } }
      } }
    } }]
    const repeatedSubsetLockfile = `snapshots:\n  '${repeatedRootAName}@${packageVersion}':\n    dependencies:\n      '${repeatedParentName}': 1.0.0\n  '${repeatedRootBName}@${packageVersion}':\n    dependencies:\n      '${repeatedParentName}': 1.0.0\n  '${repeatedParentName}@1.0.0':\n    dependencies:\n      '${repeatedChildAName}': 1.0.0\n      '${repeatedChildBName}': 1.0.0\n  '${repeatedChildAName}@1.0.0': {}\n  '${repeatedChildBName}@1.0.0': {}\n`
    expect(() => validateAssemblyDependencyEvidence(
      repeatedSubsetList,
      [
        { name: repeatedRootAName, version: packageVersion, realpath: repeatedRootAPath },
        { name: repeatedRootBName, version: packageVersion, realpath: repeatedRootBPath },
        { name: repeatedParentName, version: '1.0.0', realpath: repeatedParentPath },
        { name: repeatedChildAName, version: '1.0.0', realpath: repeatedChildAPath },
        { name: repeatedChildBName, version: '1.0.0', realpath: repeatedChildBPath }
      ],
      [],
      { [repeatedRootAName]: packageVersion, [repeatedRootBName]: packageVersion },
      'customer',
      repeatedSubsetLockfile,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    const cycleParentName = '@synthetic/cycle-parent'
    const cycleChildName = '@synthetic/cycle-child'
    const cycleParentPath = join(root, 'node_modules', '.pnpm', '@synthetic+cycle-parent@1.0.0', 'node_modules', '@synthetic', 'cycle-parent')
    const cycleChildPath = join(root, 'node_modules', '.pnpm', '@synthetic+cycle-child@1.0.0', 'node_modules', '@synthetic', 'cycle-child')
    const cycleList = [{ dependencies: {
      [cycleParentName]: { version: '1.0.0', path: cycleParentPath, dependencies: {
        [cycleChildName]: { version: '1.0.0', path: cycleChildPath, dependencies: {
          [cycleParentName]: { version: '1.0.0', path: cycleParentPath }
        } }
      } }
    } }]
    expect(() => validateAssemblyDependencyEvidence(
      cycleList,
      [
        { name: cycleParentName, version: '1.0.0', realpath: cycleParentPath },
        { name: cycleChildName, version: '1.0.0', realpath: cycleChildPath }
      ],
      [],
      { [cycleParentName]: '1.0.0' },
      'customer',
      `snapshots:\n  '${cycleParentName}@1.0.0':\n    dependencies:\n      '${cycleChildName}': 1.0.0\n  '${cycleChildName}@1.0.0':\n    dependencies:\n      '${cycleParentName}': 1.0.0\n`,
      environment,
      'snapshots:\n'
    )).not.toThrow()
    const peerBChildName = '@synthetic/peer-b-child'
    const peerBChildPath = join(root, 'node_modules', '.pnpm', '@synthetic+peer-b-child@1.0.0', 'node_modules', '@synthetic', 'peer-b-child')
    const peerContextMismatchList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [peerBoundName]: { version: peerBoundVersion, path: peerBoundPath, dependencies: {
          [peerBChildName]: { version: '1.0.0', path: peerBChildPath }
        } }
      } }
    } }]
    const peerContextMismatchEvidence = [
      parent,
      { name: peerBoundName, version: peerBoundVersion, realpath: peerBoundPath },
      { name: peerBChildName, version: '1.0.0', realpath: peerBChildPath }
    ]
    const peerContextLockfile = `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${peerBoundName}': ${peerBoundVersion}(peer-a@1.0.0)\n  '${peerBoundName}@${peerBoundVersion}(peer-a@1.0.0)':\n    dependencies:\n      '@synthetic/peer-a-child': 1.0.0\n  '${peerBoundName}@${peerBoundVersion}(peer-b@1.0.0)':\n    dependencies:\n      '${peerBChildName}': 1.0.0\n  '${peerBChildName}@1.0.0': {}\n`
    expect(() => validateAssemblyDependencyEvidence(
      peerContextMismatchList,
      peerContextMismatchEvidence,
      [],
      required,
      'customer',
      peerContextLockfile,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly dependency graph is invalid')
    const duplicatePeerContextLockfile = `${peerContextLockfile}  '${peerBoundName}@${peerBoundVersion}(peer-a@1.0.0)':\n    dependencies:\n      '${peerBChildName}': 1.0.0\n`
    expect(() => validateAssemblyDependencyEvidence(
      peerContextMismatchList,
      peerContextMismatchEvidence,
      [],
      required,
      'customer',
      duplicatePeerContextLockfile,
      environment,
      'snapshots:\n'
    )).toThrow('customer assembly optional dependency is invalid')
    const peerOptionalName = '@synthetic/peer-optional'
    const peerOptionalPath = join(root, 'node_modules', '.pnpm', '@synthetic+peer-optional@1.0.0_peer-a@1.0.0', 'node_modules', '@synthetic', 'peer-optional')
    const peerOptionalList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [peerOptionalName]: { version: '1.0.0', path: peerOptionalPath }
      } }
    } }]
    const wrongPeerOptionalLockfile = `packages:\n  '${peerOptionalName}@1.0.0':\n    cpu: [arm64]\n    os: [android]\n\nsnapshots:\n  '${packageName}@${packageVersion}':\n    optionalDependencies:\n      '${peerOptionalName}': 1.0.0(peer-a@1.0.0)\n  '${peerOptionalName}@1.0.0(peer-a@1.0.0)': {}\n  '${peerOptionalName}@1.0.0(peer-b@1.0.0)':\n    optional: true\n`
    expect(() => validateAssemblyDependencyEvidence(
      peerOptionalList,
      [parent],
      [{ name: peerOptionalName, version: '1.0.0', path: peerOptionalPath }],
      required,
      'customer',
      wrongPeerOptionalLockfile,
      environment,
      wrongPeerOptionalLockfile
    )).toThrow('customer assembly optional dependency is invalid')
    const longBaseName = `@synthetic/${'a'.repeat(130)}`
    const longBaseVersion = '1.0.0'
    const longBaseFilename = `@synthetic+${'a'.repeat(82)}_a7cpmbnl5yqqvlrhaxj5dwclna`
    const longBasePath = join(root, 'node_modules', '.pnpm', longBaseFilename, 'node_modules', '@synthetic', 'a'.repeat(130))
    const longBaseList = [{ dependencies: { [longBaseName]: { version: longBaseVersion, path: longBasePath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      longBaseList,
      [{ name: longBaseName, version: longBaseVersion, realpath: longBasePath }],
      [],
      { [longBaseName]: longBaseVersion },
      'customer',
      `snapshots:\n  '${longBaseName}@${longBaseVersion}': {}\n`,
      environment,
      'snapshots:\n'
    )).not.toThrow()
    const longBasePeerSuffix = '(peer-a@1.0.0)'
    const longBasePeerFilename = `@synthetic+${'a'.repeat(82)}_ybg5hbyy43znql4gasadfn7acm`
    const longBasePeerPath = join(root, 'node_modules', '.pnpm', longBasePeerFilename, 'node_modules', '@synthetic', 'a'.repeat(130))
    const longBasePeerList = [{ dependencies: { [longBaseName]: { version: longBaseVersion, path: longBasePeerPath } } }]
    expect(() => validateAssemblyDependencyEvidence(
      longBasePeerList,
      [{ name: longBaseName, version: longBaseVersion, realpath: longBasePeerPath }],
      [],
      { [longBaseName]: longBaseVersion },
      'customer',
      `snapshots:\n  '${longBaseName}@${longBaseVersion}${longBasePeerSuffix}': {}\n`,
      environment,
      'snapshots:\n'
    )).not.toThrow()
    const longPeerSuffix = '(peer-alpha-with-a-long-name@1.0.0)(peer-beta-with-a-long-name@2.0.0)(peer-gamma-with-a-long-name@3.0.0)'
    const longPeerPath = join(root, 'node_modules', '.pnpm', '@synthetic+peer-bound@1.0.0_peer-alpha-with-a-long-name@1.0.0_peer-beta-with-a-long-name@2.0._hxbajsklm4ud3ieoxqia72duhq', 'node_modules', '@synthetic', 'peer-bound')
    const longPeerList = [{ dependencies: {
      [packageName]: { version: packageVersion, path: parentPath, dependencies: {
        [peerBoundName]: { version: peerBoundVersion, path: longPeerPath }
      } }
    } }]
    expect(() => validateAssemblyDependencyEvidence(
      longPeerList,
      [parent, { name: peerBoundName, version: peerBoundVersion, realpath: longPeerPath }],
      [],
      required,
      'customer',
      `snapshots:\n  '${packageName}@${packageVersion}':\n    dependencies:\n      '${peerBoundName}': ${peerBoundVersion}${longPeerSuffix}\n  '${peerBoundName}@${peerBoundVersion}${longPeerSuffix}': {}\n`,
      environment,
      'snapshots:\n'
    )).not.toThrow()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 用隔离 fake pnpm 执行一轮 assembly 公开反馈环。 */
function verifyAssembly(auditError: boolean): void {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-assembly-install-'))
  const binDirectory = join(root, 'bin')
  const assemblyDirectory = join(root, 'assembly')
  const evidenceDirectory = join(root, 'evidence')
  const harnessPath = join(root, 'run-assembly.mjs')
  const pnpmPath = join(binDirectory, 'pnpm')

  try {
    mkdirSync(binDirectory)
    mkdirSync(assemblyDirectory)
    mkdirSync(evidenceDirectory)
    writeFileSync(pnpmPath, fakePnpmSource)
    chmodSync(pnpmPath, 0o755)
    writeFileSync(harnessPath, `
import { buildAssembly } from ${JSON.stringify(RELEASE_GATES_URL)}

const packageName = ${JSON.stringify(packageName)}
const packageVersion = ${JSON.stringify(packageVersion)}
const directory = ${JSON.stringify(assemblyDirectory)}
const evidenceDirectory = ${JSON.stringify(evidenceDirectory)}
const packageContracts = [{ name: packageName, dependencyPolicy: { external: {}, externalPeers: {} } }]
const packageMap = new Map([[packageName, {
  name: packageName,
  version: packageVersion,
  tarballFile: '4xian-jword-core-0.0.0.tgz',
  bytes: Buffer.from('synthetic-tarball')
}]])

try {
  const result = await buildAssembly('customer', 'customer-production', directory, evidenceDirectory, packageContracts, packageMap, 'a'.repeat(64))
  console.log(JSON.stringify({ status: 'passed', dependencies: result.evidence.dependencies.map((entry) => entry.name) }))
} catch (error) {
  console.error(error instanceof Error ? error.message : 'assembly install failed')
  process.exitCode = 1
}
`)

    const result = spawnSync(process.execPath, [harnessPath], {
      encoding: 'utf8',
      env: {
        ...process.env,
        JWORD_PHASE3_TEST_AUDIT_ERROR: auditError ? '1' : '0',
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`
      },
      timeout: 5000
    })
    const errorPath = join(assemblyDirectory, 'fake-pnpm-error.txt')
    const diagnostic = existsSync(errorPath) ? readFileSync(errorPath, 'utf8') : result.stderr

    if (auditError) {
      expect(result.status, result.stderr).toBe(1)
      expect(result.stderr).toContain('customer-production audit payload is invalid')
    } else {
      expect(result.status, diagnostic).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual({ status: 'passed', dependencies: [packageName] })
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
