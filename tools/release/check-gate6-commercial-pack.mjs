/**
 * 职责：执行 Gate 6 商业协作包的私有 registry / npm pack dry-run 审计。
 * 边界：只审计包清单、导出映射、文件白名单、说明文档和打包内容，不发布包。
 * 协作模块：packages/collab、packages/collab-server、packages/license、packages/persistence 和 Gate 6 第三方 smoke。
 * 约束：商业包必须面向 restricted registry，tarball 只包含 dist、types、README 和 package metadata。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-652建立私有-registry--npm-pack-检查。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const commercialPackages = [
  {
    name: '@4xian/jword-collab',
    dir: join('packages', 'collab'),
    requiredExports: ['.', './experimental']
  },
  {
    name: '@4xian/jword-collab-server',
    dir: join('packages', 'collab-server'),
    requiredExports: ['.']
  },
  {
    name: '@4xian/jword-license',
    dir: join('packages', 'license'),
    requiredExports: ['.']
  },
  {
    name: '@4xian/jword-persistence',
    dir: join('packages', 'persistence'),
    requiredExports: ['.']
  }
]
const failures = []
const packDir = mkdtempSync(join(tmpdir(), 'jword-gate6-commercial-pack-'))

assertDistRelativeImportsNormalized()

const reports = commercialPackages.map(readCommercialPackageReport)

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(JSON.stringify({
  status: 'ok',
  privateRegistry: {
    required: true,
    publishConfigAccess: 'restricted'
  },
  packages: reports
}, null, 2))

/** 读取单个 Gate 6 商业包的发布审计摘要。 */
function readCommercialPackageReport(config) {
  const packageJsonPath = join(repoRoot, config.dir, 'package.json')
  const packageJson = readJson(packageJsonPath)
  const exportKeys = Object.keys(packageJson.exports ?? {})
  const missingExports = config.requiredExports.filter((key) => !exportKeys.includes(key))
  const files = packageJson.files ?? []
  const forbiddenFileEntries = files.filter((entry) => entry === 'src' || entry === 'test' || entry === 'tests' || entry === 'fixtures')
  const requiredDistFiles = readRequiredDistFiles(config.requiredExports)
  const npmPack = readPnpmPack(config.dir, config.name, requiredDistFiles)

  if (packageJson.name !== config.name) {
    failures.push(`${packageJsonPath}: name 应为 ${config.name}`)
  }
  if (packageJson.private !== true) {
    failures.push(`${packageJsonPath}: 商业包当前必须保持 private: true`)
  }
  if (packageJson.publishConfig?.access !== 'restricted') {
    failures.push(`${packageJsonPath}: publishConfig.access 必须为 restricted`)
  }
  if (missingExports.length > 0) {
    failures.push(`${packageJsonPath}: 缺少 export map ${missingExports.join(', ')}`)
  }
  if (!files.includes('dist') || !files.includes('README.md')) {
    failures.push(`${packageJsonPath}: files 必须包含 dist 和 README.md`)
  }
  if (forbiddenFileEntries.length > 0) {
    failures.push(`${packageJsonPath}: files 不得发布源码、测试或 fixture 目录 ${forbiddenFileEntries.join(', ')}`)
  }
  if (!existsSync(join(repoRoot, config.dir, 'README.md'))) {
    failures.push(`${config.dir}: 缺少 README.md`)
  }
  if (!hasRequiredDistFiles(config.dir, requiredDistFiles)) {
    failures.push(`${config.dir}: dist 缺少 ${requiredDistFiles.join(', ')}`)
  }
  if (npmPack.requiredFilesMissing.length > 0) {
    failures.push(`${config.dir}: npm pack 缺少 ${npmPack.requiredFilesMissing.join(', ')}`)
  }
  if (!requiredDistFiles.includes('dist/index.d.ts') || !requiredDistFiles.includes('dist/index.js')) {
    failures.push(`${config.dir}: required dist files must include 'dist/index.d.ts' and 'dist/index.js'`)
  }
  if (npmPack.forbiddenFiles.length > 0) {
    failures.push(`${config.dir}: npm pack 不得包含 ${npmPack.forbiddenFiles.join(', ')}`)
  }
  if (npmPack.sourceMapLeaks.length > 0) {
    failures.push(`${config.dir}: npm pack 不得包含源码映射内容 ${npmPack.sourceMapLeaks.join(', ')}`)
  }
  if (npmPack.packageJson.includes('workspace:*')) {
    failures.push(`${config.dir}: npm pack package.json 不得包含 workspace:*`)
  }

  return {
    name: config.name,
    packageJson: join(config.dir, 'package.json'),
    files,
    exports: exportKeys.sort(),
    npmPack
  }
}

/** 确认发布产物的相对 import/export specifier 已归一为 Node ESM 可解析形式。 */
function assertDistRelativeImportsNormalized() {
  execFileSync(process.execPath, [
    join(repoRoot, 'tools/release/normalize-dist-relative-imports.mjs'),
    '--check'
  ], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
}

/** 执行 pnpm pack 并读取实际 tarball 内容。 */
function readPnpmPack(packageDir, packageName, requiredDistFiles) {
  const before = new Set(readPackFiles())

  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: join(repoRoot, packageDir),
    stdio: 'pipe'
  })

  const created = readPackFiles().find((file) => !before.has(file))

  if (created === undefined) {
    failures.push(`${packageDir}: pnpm pack 未生成 tarball`)
    return {
      filename: '',
      files: [],
      requiredFiles: requiredDistFiles,
      requiredFilesMissing: requiredDistFiles,
      forbiddenFiles: [],
      sourceMapLeaks: [],
      packageJson: ''
    }
  }

  const packPath = join(packDir, created)
  const files = execFileSync('tar', ['-tf', packPath], {
    encoding: 'utf8'
  })
    .split('\n')
    .map((entry) => entry.replace(/^package\//u, ''))
    .filter(Boolean)
    .sort()
  const packageJson = execFileSync('tar', ['-xOf', packPath, 'package/package.json'], {
    encoding: 'utf8'
  })
  const requiredFiles = [
    ...requiredDistFiles,
    'README.md',
    'package.json'
  ]
  const requiredFilesMissing = requiredFiles.filter((file) => !files.includes(file))
  const forbiddenFiles = files.filter(isForbiddenPackFile)
  const sourceMapLeaks = files
    .filter(isTextPackFile)
    .flatMap((file) => readTarballTextLeaks(packPath, file))

  if (!packageJson.includes(`"name": "${packageName}"`)) {
    failures.push(`${packageDir}: npm pack package.json name 不匹配 ${packageName}`)
  }

  return {
    filename: created,
    files,
    requiredFiles,
    requiredFilesMissing,
    forbiddenFiles,
    sourceMapLeaks,
    packageJson
  }
}

/** 读取 pack 目录下已有 tarball 文件。 */
function readPackFiles() {
  return readdirSync(packDir).filter((file) => file.endsWith('.tgz')).sort()
}

/** 读取 export map 所需的 dist 文件。 */
function readRequiredDistFiles(requiredExports) {
  return requiredExports.flatMap((key) => {
    const baseName = key === '.' ? 'index' : key.slice(2)

    return [
      `dist/${baseName}.d.ts`,
      `dist/${baseName}.js`
    ]
  })
}

/** 判断 dist 目录是否具备 export map 需要的产物。 */
function hasRequiredDistFiles(packageDir, requiredFiles) {
  const distDir = join(repoRoot, packageDir, 'dist')

  if (!existsSync(distDir)) {
    return false
  }

  const distFiles = new Set(readdirSync(distDir))

  return requiredFiles.every((file) => distFiles.has(file.replace(/^dist\//u, '')))
}

/** 判断 npm pack 文件是否泄漏源码、测试、fixture 或源码映射。 */
function isForbiddenPackFile(filePath) {
  return filePath.startsWith('src/') ||
    filePath.startsWith('test/') ||
    filePath.startsWith('tests/') ||
    filePath.startsWith('fixtures/') ||
    filePath.endsWith('.map') ||
    filePath.includes('/__snapshots__/')
}

/** 判断 tarball 文本文件是否需要扫描源码映射泄漏。 */
function isTextPackFile(filePath) {
  return /\.(?:js|mjs|cjs|d\.ts|json|md|txt|css)$/u.test(filePath)
}

/** 从 tarball 读取文本文件并检测源码映射内容。 */
function readTarballTextLeaks(packPath, filePath) {
  const source = execFileSync('tar', ['-xOf', packPath, `package/${filePath}`], {
    encoding: 'utf8'
  })
  const leaks = []

  if (source.includes('sourcesContent')) {
    leaks.push(`${filePath}:sourcesContent`)
  }
  if (source.includes('sourceMappingURL=')) {
    leaks.push(`${filePath}:sourceMappingURL`)
  }

  return leaks
}

/** 读取 JSON 文件。 */
function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}
