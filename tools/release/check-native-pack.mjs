/**
 * 职责：执行 Gate 4.5 native package 的 Phase 3 发布边界检查。
 * 边界：source 模式只读 manifest/registry，artifact 模式只读调用方显式 tarball inventory。
 * 协作模块：package artifact contract、统一 scanner 与 native registry。
 * 约束：不构建、不生成包、不执行打包演练或发布。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scanner = join(repoRoot, 'tools/release/check-package-artifacts.mjs')
const input = readScannerInput(process.argv.slice(2))
const scannerReport = runScanner(input.arguments)
const nativePackage = scannerReport.packages.find(matchesNativePackage)

if (nativePackage === undefined) {
  throw new Error('native package is missing from the scanner report')
}

if (input.mode === 'source') {
  verifySourceNativeContract()
}

console.log(JSON.stringify({
  status: 'ok',
  kind: 'gate45-native-package-check',
  mode: input.mode,
  packCommands: 0,
  package: nativePackage
}, null, 2))

/** 把兼容入口参数映射到统一 scanner 的显式模式。 */
function readScannerInput(args) {
  const environmentManifest = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST

  if (args.length === 0 && environmentManifest !== undefined) {
    if (environmentManifest === '') {
      throw new Error('JWORD_PHASE3_ARTIFACT_MANIFEST must not be empty')
    }
    return { mode: 'artifact', arguments: ['--artifact-manifest', environmentManifest] }
  }

  return {
    mode: args.length === 0 ? 'source' : args.includes('--artifact-manifest') ? 'artifact' : 'synthetic-tarball',
    arguments: args.length === 0 ? ['--check-source-manifests'] : args
  }
}

/** 运行统一 scanner 并解析结构化报告。 */
function runScanner(args) {
  return JSON.parse(execFileSync(process.execPath, [scanner, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  }))
}

/** 判断 scanner report 是否属于 native package。 */
function matchesNativePackage(report) {
  return report.name === '@4xian/jword-native'
}

/** 校验 native source manifest 和唯一 registry fixture。 */
function verifySourceNativeContract() {
  const manifest = JSON.parse(readFileSync(join(repoRoot, 'packages/native/package.json'), 'utf8'))
  const packageRegistry = readFileSync(join(repoRoot, 'packages/native/fixtures/registry.json'))
  const rootRegistry = readFileSync(join(repoRoot, 'fixtures/native/registry.json'))

  if (JSON.stringify(manifest.files) !== JSON.stringify(['dist', 'fixtures', 'README.md'])) {
    throw new Error('native source manifest files do not match the artifact contract')
  }
  if (!packageRegistry.equals(rootRegistry)) {
    throw new Error('native package registry does not match the root registry')
  }
}
