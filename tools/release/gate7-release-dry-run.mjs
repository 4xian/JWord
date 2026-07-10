/**
 * 职责：执行 Gate 7 发布 dry-run 检查，输出结构化 JSON 报告。
 * 边界：只检查构建产物、manifest、export map、package files 和 npm pack dry-run，不 publish、不打 tag。
 * 协作模块：rollup 构建产物、packages/* package.json、Gate 7 no-alias smoke 和人工 release 审批。
 * 约束：真实 publish、registry token、changeset 合并和版本号提升仍必须由人工审批。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const shouldBuild = process.argv.includes('--build')
const packageDirs = [
  'packages/core',
  'packages/ui',
  'packages/native',
  'packages/docx',
  'packages/pdf',
  'packages/license',
  'packages/persistence',
  'packages/collab',
  'packages/collab-server',
  'packages/devtools',
  'packages/react',
  'packages/vue'
]

if (shouldBuild) {
  execFileSync('pnpm', ['build'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}

const report = {
  status: 'ok',
  kind: 'gate7-release-dry-run',
  publish: 'not-run',
  manualApprovalRequired: true,
  changesetDraft: readChangesetDraftStatus(),
  packages: packageDirs.map(readPackageReport)
}
const failures = report.packages.flatMap((entry) => entry.failures.map((failure) => `${entry.name}: ${failure}`))

if (failures.length > 0) {
  report.status = 'failed'
  report.failures = failures
}

console.log(JSON.stringify(report, null, 2))

if (failures.length > 0) {
  process.exitCode = 1
}

/** 读取 changeset 草稿状态；缺失时保留人工审批提示但不阻断 pack dry-run。 */
function readChangesetDraftStatus() {
  const changesetDir = join(repoRoot, '.changeset')

  if (!existsSync(changesetDir)) {
    return 'manual-draft-required'
  }

  const drafts = readdirSync(changesetDir).filter((file) => file.endsWith('.md') && file !== 'README.md')

  return drafts.length === 0 ? 'manual-draft-required' : 'present'
}

/** 生成单个包的 dry-run 报告。 */
function readPackageReport(packageDir) {
  const absoluteDir = join(repoRoot, packageDir)
  const manifest = JSON.parse(readFileSync(join(absoluteDir, 'package.json'), 'utf8'))
  const failures = [
    ...checkManifest(manifest),
    ...checkDistFiles(absoluteDir, manifest),
    ...checkPackDryRun(absoluteDir)
  ]

  return {
    name: manifest.name,
    directory: packageDir,
    private: manifest.private === true,
    access: manifest.publishConfig?.access ?? 'unspecified',
    files: manifest.files ?? [],
    exports: manifest.exports,
    failures
  }
}

/** 校验 manifest 不发布源码入口且 files 白名单收敛。 */
function checkManifest(manifest) {
  const failures = []

  if (manifest.type !== 'module') {
    failures.push('manifest type must be module')
  }
  for (const field of ['main', 'module', 'types']) {
    if (typeof manifest[field] !== 'string' || !manifest[field].startsWith('./dist/')) {
      failures.push(`${field} must point at ./dist`)
    }
  }
  if (!Array.isArray(manifest.files) || !manifest.files.includes('dist')) {
    failures.push('files must include dist')
  }
  const exportText = JSON.stringify(manifest.exports)
  if (exportText.includes('/src/') || exportText.includes('packages/')) {
    failures.push('exports must not expose source or repo paths')
  }
  return failures
}

/** 校验构建产物存在，worker/experimental 子入口按 manifest 同步存在。 */
function checkDistFiles(packageDir, manifest) {
  const failures = []

  for (const required of ['dist/index.js', 'dist/index.d.ts']) {
    if (!existsSync(join(packageDir, required))) {
      failures.push(`missing ${required}; run node tools/release/gate7-release-dry-run.mjs --build`)
    }
  }

  const exportText = JSON.stringify(manifest.exports)
  for (const optionalEntry of ['worker', 'experimental']) {
    if (exportText.includes(`dist/${optionalEntry}.js`) && !existsSync(join(packageDir, `dist/${optionalEntry}.js`))) {
      failures.push(`missing dist/${optionalEntry}.js`)
    }
    if (exportText.includes(`dist/${optionalEntry}.d.ts`) && !existsSync(join(packageDir, `dist/${optionalEntry}.d.ts`))) {
      failures.push(`missing dist/${optionalEntry}.d.ts`)
    }
  }

  return failures
}

/** 执行 npm pack dry-run 并阻止源码文件进入包清单。 */
function checkPackDryRun(packageDir) {
  const output = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageDir,
    encoding: 'utf8'
  })
  const parsed = JSON.parse(output)
  const files = parsed.flatMap((entry) => entry.files.map((file) => file.path))
  const leakedSource = files.filter((file) => file.startsWith('src/') || file.includes('/src/'))

  return leakedSource.length === 0 ? [] : [`pack dry-run leaks source files: ${leakedSource.join(', ')}`]
}
