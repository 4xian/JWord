/**
 * 职责：执行 Gate 5 商业高级包的发布边界 dry-run 审计。
 * 边界：只审计 package manifest、export map、files、基础首屏静态依赖和 examples/docx 按需加载，不发布包。
 * 协作模块：packages/docx、packages/pdf、packages/license、examples/vanilla、examples/docx 和 Gate 7 文档计划。
 * 约束：商业高级包必须面向 restricted registry 形态；免费基础入口不能静态依赖 DOCX/PDF/license。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-538建立商业包发布检查。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const commercialPackages = [
  {
    name: '@4xian/jword-docx',
    dir: join('packages', 'docx'),
    requiredExports: ['.', './worker']
  },
  {
    name: '@4xian/jword-license',
    dir: join('packages', 'license'),
    requiredExports: ['.']
  },
  {
    name: '@4xian/jword-pdf',
    dir: join('packages', 'pdf'),
    requiredExports: ['.', './worker']
  }
]
const freeEntryPath = join('examples', 'vanilla', 'src', 'main.ts')
const docxDemoEntryPath = join('examples', 'docx', 'src', 'main.ts')
const advancedSpecifiers = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-license'
]
const runtimeImportFromPattern = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const runtimeBareImportPattern = /^\s*import\s+["']([^"']+)["'];?/gmu
const runtimeDynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/gmu
const failures = []

assertDistRelativeImportsNormalized()

const packageReports = commercialPackages.map(readCommercialPackageReport)
const freeBundleForbiddenImports = readStaticPackageImports(freeEntryPath)
  .filter((specifier) => advancedSpecifiers.includes(specifier))
const exampleDocxLazyRuntimeImports = readDynamicPackageImports(docxDemoEntryPath)
  .filter((specifier) => specifier === '@4xian/jword-docx' || specifier === '@4xian/jword-pdf')
  .sort()

if (freeBundleForbiddenImports.length > 0) {
  failures.push(`免费基础入口静态引入了商业高级包: ${freeBundleForbiddenImports.join(', ')}`)
}

if (exampleDocxLazyRuntimeImports.join(',') !== '@4xian/jword-docx,@4xian/jword-pdf') {
  failures.push('examples/docx 必须按需加载 @4xian/jword-docx 和 @4xian/jword-pdf。')
}

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
  packages: packageReports,
  freeBundleForbiddenImports,
  exampleDocxLazyRuntimeImports
}, null, 2))

/** 读取单个商业包的 manifest 审计摘要。 */
function readCommercialPackageReport(config) {
  const packageJsonPath = join(config.dir, 'package.json')
  const packageJson = readJson(packageJsonPath)
  const exportKeys = Object.keys(packageJson.exports ?? {})
  const missingExports = config.requiredExports.filter((key) => !exportKeys.includes(key))
  const files = packageJson.files ?? []
  const forbiddenFileEntries = files.filter((entry) => entry === 'src' || entry === 'test' || entry === 'tests')
  const npmPackDryRun = readNpmPackDryRun(config.dir, config.requiredExports)

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
  if (files.length === 0 || !files.includes('dist')) {
    failures.push(`${packageJsonPath}: files 必须只发布 dist 产物`)
  }
  if (forbiddenFileEntries.length > 0) {
    failures.push(`${packageJsonPath}: files 不得发布源码或测试目录 ${forbiddenFileEntries.join(', ')}`)
  }
  if (npmPackDryRun.requiredFilesMissing.length > 0) {
    failures.push(`${packageJsonPath}: npm pack 缺少 ${npmPackDryRun.requiredFilesMissing.join(', ')}`)
  }
  if (npmPackDryRun.forbiddenFiles.length > 0) {
    failures.push(`${packageJsonPath}: npm pack 不得包含 ${npmPackDryRun.forbiddenFiles.join(', ')}`)
  }
  if (npmPackDryRun.sourceMapLeaks.length > 0) {
    failures.push(`${packageJsonPath}: npm pack 不得包含源码映射内容 ${npmPackDryRun.sourceMapLeaks.join(', ')}`)
  }

  return {
    name: config.name,
    packageJson: packageJsonPath,
    files,
    exports: exportKeys.sort(),
    distReady: hasRequiredDistEntries(config.dir, config.requiredExports),
    npmPackDryRun
  }
}

/** 确认发布产物的相对 import/export specifier 已归一为 Node ESM 可解析形式。 */
function assertDistRelativeImportsNormalized() {
  execFileSync(process.execPath, [
    'tools/release/normalize-dist-relative-imports.mjs',
    '--check'
  ], {
    encoding: 'utf8',
    stdio: 'pipe'
  })
}

/** 判断 dist 是否已具备当前 export map 需要的产物。 */
function hasRequiredDistEntries(packageDir, requiredExports) {
  const distDir = join(packageDir, 'dist')

  if (!existsSync(distDir)) {
    return false
  }

  const distFiles = new Set(readdirSync(distDir))

  return requiredExports.every((key) => {
    const baseName = key === '.' ? 'index' : key.slice(2)

    return distFiles.has(`${baseName}.js`) && distFiles.has(`${baseName}.d.ts`)
  })
}

/** 执行 npm pack dry-run 并读取实际将进入 tarball 的文件。 */
function readNpmPackDryRun(packageDir, requiredExports) {
  const output = execFileSync('npm', [
    'pack',
    '--dry-run',
    '--json',
    `./${packageDir}`
  ], {
    encoding: 'utf8'
  })
  const packReport = JSON.parse(output)?.[0]
  const files = (packReport?.files ?? [])
    .map((file) => file.path)
    .filter(Boolean)
    .sort()
  const requiredFiles = readRequiredDistFiles(requiredExports)
  const requiredFilesMissing = requiredFiles.filter((file) => !files.includes(file))
  const forbiddenFiles = files.filter(isForbiddenPackFile)
  const sourceMapLeaks = files
    .filter(isTextPackFile)
    .flatMap((file) => readPackedTextLeaks(packageDir, file))

  return {
    filename: packReport?.filename ?? '',
    entryCount: packReport?.entryCount ?? files.length,
    files,
    requiredFiles,
    requiredFilesMissing,
    forbiddenFiles,
    sourceMapLeaks
  }
}

/** 读取 export map 必须进入 npm 包的 dist 文件。 */
function readRequiredDistFiles(requiredExports) {
  return requiredExports.flatMap((key) => {
    const baseName = key === '.' ? 'index' : key.slice(2)

    return [
      `dist/${baseName}.d.ts`,
      `dist/${baseName}.js`
    ]
  })
}

/** 判断 npm pack 文件是否泄漏源码、测试或内部 fixture。 */
function isForbiddenPackFile(filePath) {
  return filePath.startsWith('src/') ||
    filePath.startsWith('test/') ||
    filePath.startsWith('tests/') ||
    filePath.startsWith('fixtures/') ||
    filePath.endsWith('.map') ||
    filePath.includes('/__snapshots__/')
}

/** 判断 npm pack 文本文件是否需要扫描源码映射泄漏。 */
function isTextPackFile(filePath) {
  return /\.(?:js|mjs|cjs|d\.ts|json|md|txt|css)$/u.test(filePath)
}

/** 读取 dry-run 将打入包的文本文件是否携带源码映射内容。 */
function readPackedTextLeaks(packageDir, filePath) {
  const absolutePath = join(packageDir, filePath)
  if (!existsSync(absolutePath)) {
    return []
  }

  const source = readFileSync(absolutePath, 'utf8')
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

/** 读取入口静态 package import。 */
function readStaticPackageImports(entryPath) {
  return readRuntimeSpecifiers(entryPath, false)
}

/** 读取入口动态 package import。 */
function readDynamicPackageImports(entryPath) {
  return readRuntimeSpecifiers(entryPath, true)
}

/** 按本地静态图读取 package import。 */
function readRuntimeSpecifiers(entryPath, dynamicOnly) {
  const pending = [entryPath]
  const visited = new Set()
  const packageImports = new Set()

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) {
      continue
    }

    visited.add(current)
    const source = readFileSync(current, 'utf8')
    const specifiers = dynamicOnly
      ? readSpecifiers(source, runtimeDynamicImportPattern)
      : [
          ...readSpecifiers(source, runtimeImportFromPattern),
          ...readSpecifiers(source, runtimeBareImportPattern)
        ]

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        packageImports.add(specifier)
        continue
      }

      if (dynamicOnly) {
        continue
      }

      const resolved = resolveLocalImport(current, specifier)
      if (resolved !== null) {
        pending.push(resolved)
      }
    }
  }

  return [...packageImports].sort()
}

/** 读取正则匹配的 import specifier。 */
function readSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter(Boolean)
}

/** 解析本地静态 import 文件路径。 */
function resolveLocalImport(fromFile, specifier) {
  const basePath = join(dirname(fromFile), specifier)

  for (const candidate of [
    basePath,
    `${basePath}.ts`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.css`,
    join(basePath, 'index.ts')
  ]) {
    if (existsSync(candidate)) {
      return normalize(candidate)
    }
  }

  return null
}
