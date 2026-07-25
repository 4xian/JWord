/**
 * 职责：执行 Gate 6 协作 package 的 Phase 3 发布边界检查。
 * 边界：source 模式保留 restricted manifest 检查，artifact 模式只读显式 inventory。
 * 协作模块：Collab、Collab Server、License、Persistence 和统一 artifact scanner。
 * 约束：不构建、不生成包、不执行打包演练或发布。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scannerPath = join(repoRoot, 'tools/release/check-package-artifacts.mjs')
const gate6Names = [
  '@4xian/jword-collab',
  '@4xian/jword-collab-server',
  '@4xian/jword-license',
  '@4xian/jword-persistence'
]
const input = readScannerInput(process.argv.slice(2))
const scannerReport = runScanner(input.arguments)
const packageReports = scannerReport.packages.filter(isGate6Package)

if (packageReports.length !== gate6Names.length && input.mode !== 'synthetic-tarball') {
  throw new Error('Gate 6 scanner report is missing a collaboration package')
}
if (input.mode === 'source') {
  verifySourceGate6()
}

console.log(JSON.stringify({
  status: 'ok',
  kind: 'gate6-commercial-package-check',
  mode: input.mode,
  packCommands: 0,
  privateRegistry: {
    required: true,
    publishConfigAccess: 'restricted'
  },
  packages: packageReports
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
  return JSON.parse(execFileSync(process.execPath, [scannerPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  }))
}

/** 判断 scanner report 是否属于 Gate 6 package。 */
function isGate6Package(report) {
  return gate6Names.includes(report.name)
}

/** 校验 Gate 6 source package 的 private/restricted 与出口边界。 */
function verifySourceGate6() {
  for (const packageName of gate6Names) {
    const manifest = readPackageManifest(packageName)

    if (manifest.private !== true || manifest.publishConfig?.access !== 'restricted') {
      throw new Error(`${packageName}: Gate 6 package must remain private and restricted`)
    }
    if (manifest.exports?.['.'] === undefined) {
      throw new Error(`${packageName}: Gate 6 package requires a root export`)
    }
  }
}

/** 按 package name 读取 source manifest。 */
function readPackageManifest(packageName) {
  const directory = packageName.slice('@4xian/jword-'.length)

  return JSON.parse(readFileSync(join(repoRoot, 'packages', directory, 'package.json'), 'utf8'))
}
