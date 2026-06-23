/**
 * 职责：执行 Gate 4.5 native 包的 release dry-run 内容审计。
 * 边界：只检查 `npm pack --dry-run` 的文件清单，不发布、不改写版本号。
 * 协作模块：packages/native/package.json、packages/native/dist、packages/native/fixtures。
 * 约束：输出必须稳定可读，且明确拒绝测试私有文件、源码路径泄漏和缺失的发布产物。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-6---benchmarkbundle-和文档计划。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const packageDir = join('packages', 'native')
const packageJsonPath = join(packageDir, 'package.json')

if (!existsSync(packageJsonPath)) {
  console.error(`Missing package.json: ${packageJsonPath}`)
  process.exit(1)
}

const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], {
  cwd: packageDir,
  encoding: 'utf8'
})

if (result.status !== 0) {
  process.stderr.write(result.stderr ?? '')
  process.exit(result.status ?? 1)
}

const packList = parsePackList(result.stdout)
if (packList.length === 0) {
  console.error('npm pack did not return any package entries.')
  process.exit(1)
}

const packageEntry = packList[0]
const files = (packageEntry.files ?? []).map((file) => file.path)
const requiredFiles = [
  'package.json',
  'README.md',
  'fixtures/registry.json',
  'dist/index.js',
  'dist/index.d.ts',
  'dist/worker.js',
  'dist/worker.d.ts'
]
const forbiddenPrefixes = ['src/', 'test/', 'tests/']
const missingRequired = requiredFiles.filter((file) => !files.includes(file))
const forbiddenFiles = files.filter((file) => forbiddenPrefixes.some((prefix) => file.startsWith(prefix)))

if (missingRequired.length > 0 || forbiddenFiles.length > 0) {
  console.error(
    JSON.stringify(
      {
        package: packageEntry.id ?? packageJsonPath,
        missingRequired,
        forbiddenFiles,
        files
      },
      null,
      2
    )
  )
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      package: packageEntry.id ?? packageJsonPath,
      files,
      requiredFiles
    },
    null,
    2
  )
)

/** 解析 npm pack JSON 输出。 */
function parsePackList(stdout) {
  try {
    return JSON.parse(stdout)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
