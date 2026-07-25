/**
 * 职责：执行 Gate 7 Phase 3 release artifact 只读检查。
 * 边界：source 模式只读 manifest/contract，artifact 模式只读调用方显式 inventory。
 * 协作模块：统一 artifact scanner、十二个 runtime package 和 release readiness 文档。
 * 约束：不构建、不生成包、不执行打包演练、发布或打标签。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scannerPath = join(repoRoot, 'tools/release/check-package-artifacts.mjs')
const input = readScannerInput(process.argv.slice(2))
const scannerReport = runScanner(input.arguments)

console.log(JSON.stringify({
  status: 'ok',
  kind: 'gate7-release-artifact-check',
  mode: input.mode,
  publish: 'not-run',
  packCommands: 0,
  manualApprovalRequired: true,
  changesetDraft: readChangesetDraftStatus(),
  packages: scannerReport.packages
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

/** 读取 changeset 草稿状态但不执行 version/publish。 */
function readChangesetDraftStatus() {
  const changesetDir = join(repoRoot, '.changeset')

  if (!existsSync(changesetDir)) {
    return 'manual-draft-required'
  }

  const drafts = readdirSync(changesetDir).filter(isChangesetDraft)

  return drafts.length === 0 ? 'manual-draft-required' : 'present'
}

/** 判断 changeset 目录项是否为实际草稿。 */
function isChangesetDraft(file) {
  return file.endsWith('.md') && file !== 'README.md'
}
