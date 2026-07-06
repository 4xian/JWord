/**
 * 职责：执行基础 core 与 vanilla 首屏 bundle 体积门禁。
 * 边界：只读取 fresh build 产物、首屏资源和源码静态 import 图，不构建、不改写 dist。
 * 协作模块：root `pnpm size`、examples/vanilla build、Gate 7 bundle size 校准计划。
 * 约束：阻止高级包进入免费首屏，并用当前实测预算加收紧路线图约束体积回归。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-bundle-size-calibration.md。
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

const coreEntryPath = join('packages', 'core', 'dist', 'index.js')
const coreSourceEntryPath = join('packages', 'core', 'src', 'index.ts')
const uiSourceEntryPath = join('packages', 'ui', 'src', 'index.ts')
const uiToolbarStylesPath = join('packages', 'ui', 'src', 'styles', 'toolbar.css')
const demoEntrySourcePath = join('examples', 'vanilla', 'src', 'main.ts')
const demoDistRoot = join('examples', 'vanilla', 'dist')
const demoIndexPath = join(demoDistRoot, 'index.html')
const demoAssetsDir = join(demoDistRoot, 'assets')
const graphAliases = new Map([
  ['@4xian/jword-core', coreSourceEntryPath],
  ['@4xian/jword-ui', uiSourceEntryPath],
  ['@4xian/jword-ui/styles.css', uiToolbarStylesPath]
])
const forbiddenFirstScreenImports = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-license',
  '@4xian/jword-native',
  '@4xian/jword-collab',
  '@4xian/jword-react',
  '@4xian/jword-vue',
  '@hocuspocus',
  'hocuspocus',
  'react',
  'react-dom',
  'vue',
  'jszip',
  'pdf-lib',
  'fontkit'
]
const sizeBudgetMeasuredAt = '2026-07-06'
const coreEntryMeasuredBytes = 638269
const demoFirstScreenMeasuredBytes = 687669
const coreEntryByteLimit = 650000
const demoFirstScreenByteLimit = 700000
const sizeBudgetRoadmap = [
  {
    metric: 'coreEntry',
    artifact: coreEntryPath,
    measuredBytes: coreEntryMeasuredBytes,
    maxBytes: coreEntryByteLimit,
    nextTargetBytes: 520000,
    targetStage: 'Gate 7 API freeze 后复核 core plugin / diagnostics 导出面并拆分可选能力'
  },
  {
    metric: 'demoFirstScreen',
    artifact: demoIndexPath,
    measuredBytes: demoFirstScreenMeasuredBytes,
    maxBytes: demoFirstScreenByteLimit,
    nextTargetBytes: 560000,
    targetStage: 'Gate 7 wrapper/theme/devtools 前保持免费首屏只加载基础 editor/UI，后续高级能力继续 lazy-load'
  }
]
const runtimeImportFromPattern = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const runtimeBareImportPattern = /^\s*import\s+["']([^"']+)["'];?/gmu
const runtimeExportFromPattern = /^\s*export(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const failures = []

const coreGraph = collectRuntimeGraph(coreSourceEntryPath)
const demoGraph = collectRuntimeGraph(demoEntrySourcePath)
const coreEntry = readArtifact(coreEntryPath)
const demoIndex = readArtifact(demoIndexPath)
const demoAssets = readDemoAssets()
const firstScreenAssets = readFirstScreenAssets()
const coreFreshness = buildFreshnessEvidence(
  coreEntry,
  [...coreGraph.files, join('packages', 'core', 'package.json'), 'rollup.config.mjs']
)
const demoFreshness = buildFreshnessEvidence(
  demoIndex,
  [
    ...demoGraph.files,
    join('examples', 'vanilla', 'package.json'),
    join('examples', 'vanilla', 'vite.config.ts'),
    join('examples', 'vanilla', 'index.html'),
    coreEntryPath
  ]
)
const forbiddenSourceImports = demoGraph.packageImports.filter((specifier) => isForbiddenImport(specifier))
const forbiddenBundleTokens = collectForbiddenBundleTokens(firstScreenAssets)

if (forbiddenSourceImports.length > 0) {
  failures.push(
    `首屏入口静态导入了 canonical spec 禁止的重依赖: ${forbiddenSourceImports.join(', ')}`
  )
}

for (const [path, matchedTokens] of forbiddenBundleTokens) {
  if (matchedTokens.length > 0) {
    failures.push(`${path}: 首屏 bundle 命中了重依赖标记 ${matchedTokens.join(', ')}`)
  }
}

if (coreFreshness.isFresh === false) {
  failures.push(
    `${coreEntryPath} 早于最新 core 输入时间: ${coreFreshness.artifact.mtimeIso} < ${coreFreshness.newestInput.mtimeIso}`
  )
}

if (demoFreshness.isFresh === false) {
  failures.push(
    `${demoIndexPath} 早于最新 demo 输入时间: ${demoFreshness.artifact.mtimeIso} < ${demoFreshness.newestInput.mtimeIso}`
  )
}

for (const asset of demoAssets) {
  if (coreEntry !== null && asset.mtimeMs < coreEntry.mtimeMs) {
    failures.push(`${asset.path} 早于 ${coreEntryPath}，不符合 fresh demo build 证据。`)
  }
}

if (coreEntry !== null && coreEntry.bytes > coreEntryByteLimit) {
  failures.push(
    `${coreEntryPath} 超出 Gate 7 校准体积预算: ${coreEntry.bytes} > ${coreEntryByteLimit}`
  )
}

const firstScreenBytes = sumBytes(firstScreenAssets)

if (firstScreenBytes > demoFirstScreenByteLimit) {
  failures.push(
    `${demoIndexPath} 首屏 JS/CSS 总体积超出 Gate 7 校准体积预算: ${firstScreenBytes} > ${demoFirstScreenByteLimit}`
  )
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      freshness: {
        core: coreFreshness,
        demo: demoFreshness
      },
      coreEntry: summarizeArtifact(coreEntry),
      demoFirstScreen: {
        files: firstScreenAssets.map(summarizeArtifact),
        totalBytes: sumBytes(firstScreenAssets)
      },
      demoAssets: {
        directory: demoAssetsDir,
        files: demoAssets.map(summarizeArtifact),
        totalBytes: sumBytes(demoAssets)
      },
      sourceGraph: {
        entry: demoEntrySourcePath,
        fileCount: demoGraph.files.length,
        packageImports: demoGraph.packageImports
      },
      thresholds: {
        measuredAt: sizeBudgetMeasuredAt,
        roadmap: sizeBudgetRoadmap,
        coreEntryMaxBytes: coreEntryByteLimit,
        demoFirstScreenMaxBytes: demoFirstScreenByteLimit
      },
      note: 'Gate 7 calibrated size evidence requires fresh builds, blocks spec-forbidden heavy dependencies, and enforces current measured ceilings with a tightening roadmap.'
    },
    null,
    2
  )
)

function collectRuntimeGraph(entryPath) {
  const pending = [entryPath]
  const visited = new Set()
  const packageImports = new Set()

  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || visited.has(current)) {
      continue
    }

    if (!existsSync(current)) {
      failures.push(`Missing source dependency: ${current}`)
      continue
    }

    visited.add(current)
    if (/\.(?:css|txt)$/u.test(current)) {
      continue
    }

    const source = readFileSync(current, 'utf8')
    for (const specifier of readRuntimeSpecifiers(source)) {
      const resolved = resolveImport(current, specifier)
      if (resolved.kind === 'package') {
        packageImports.add(resolved.specifier)
        continue
      }
      if (resolved.kind === 'missing') {
        failures.push(`${current}: unresolved static import '${specifier}'`)
        continue
      }
      pending.push(resolved.path)
    }
  }

  return {
    files: [...visited].sort(),
    packageImports: [...packageImports].sort()
  }
}

function readRuntimeSpecifiers(source) {
  return [
    ...readSpecifiers(source, runtimeImportFromPattern),
    ...readSpecifiers(source, runtimeBareImportPattern),
    ...readSpecifiers(source, runtimeExportFromPattern)
  ]
}

function readSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean)
}

function resolveImport(fromFile, specifier) {
  const cleanSpecifier = stripImportQuery(specifier)

  if (cleanSpecifier.startsWith('node:')) {
    return { kind: 'builtin' }
  }

  const aliased = graphAliases.get(cleanSpecifier)
  if (aliased !== undefined) {
    return { kind: 'file', path: aliased }
  }

  if (!cleanSpecifier.startsWith('.') && !cleanSpecifier.startsWith('/')) {
    return { kind: 'package', specifier: cleanSpecifier }
  }

  const resolvedPath = resolveLocalFile(join(dirname(fromFile), cleanSpecifier))
  if (resolvedPath === null) {
    return { kind: 'missing' }
  }

  return {
    kind: 'file',
    path: resolvedPath
  }
}

function resolveLocalFile(basePath) {
  const direct = readExistingFile(basePath)
  if (direct !== null) {
    return direct
  }

  for (const extension of ['.ts', '.tsx', '.js', '.mjs', '.css', '.txt']) {
    const withExtension = readExistingFile(`${basePath}${extension}`)
    if (withExtension !== null) {
      return withExtension
    }
  }

  for (const extension of ['.ts', '.tsx', '.js', '.mjs']) {
    const indexFile = readExistingFile(join(basePath, `index${extension}`))
    if (indexFile !== null) {
      return indexFile
    }
  }

  return null
}

function readExistingFile(path) {
  if (!existsSync(path)) {
    return null
  }

  const stat = statSync(path)
  return stat.isFile() ? normalize(path) : null
}

function stripImportQuery(specifier) {
  return specifier.replace(/[?#].*$/u, '')
}

function readArtifact(path) {
  if (!existsSync(path)) {
    failures.push(`Missing built artifact: ${path}`)
    return null
  }

  const stat = statSync(path)
  return {
    path,
    bytes: stat.size,
    mtimeMs: stat.mtimeMs,
    mtimeIso: new Date(stat.mtimeMs).toISOString()
  }
}

function readDemoAssets() {
  if (!existsSync(demoAssetsDir)) {
    failures.push(`Missing built artifact directory: ${demoAssetsDir}`)
    return []
  }

  const assetPaths = readdirSync(demoAssetsDir)
    .filter((name) => /\.(?:js|css)$/u.test(name))
    .map((name) => join(demoAssetsDir, name))
    .sort()

  if (assetPaths.length === 0) {
    failures.push(`No built JS/CSS assets found in ${demoAssetsDir}`)
  }

  return assetPaths
    .map((path) => readArtifact(path))
    .filter((artifact) => artifact !== null)
}

function readFirstScreenAssets() {
  if (!existsSync(demoIndexPath)) {
    failures.push(`Missing built artifact: ${demoIndexPath}`)
    return []
  }

  const html = readFileSync(demoIndexPath, 'utf8')
  const assetRefs = new Set([
    ...readSpecifiers(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/gu),
    ...readSpecifiers(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)
  ])
  const assets = [...assetRefs]
    .map((ref) => ref.startsWith('/') ? join(demoDistRoot, ref.slice(1)) : join(demoDistRoot, ref))
    .map((path) => readArtifact(path))
    .filter((artifact) => artifact !== null)

  if (assets.length === 0) {
    failures.push(`${demoIndexPath}: no first-screen JS/CSS assets found.`)
  }

  return assets
}

function buildFreshnessEvidence(artifact, inputPaths) {
  if (artifact === null) {
    return {
      artifact: null,
      newestInput: null,
      isFresh: false
    }
  }

  const inputs = inputPaths
    .map((path) => readArtifact(path))
    .filter((input) => input !== null)

  const newestInput = inputs.reduce((latest, current) => {
    if (latest === null) {
      return current
    }
    return current.mtimeMs > latest.mtimeMs ? current : latest
  }, null)

  if (newestInput === null) {
    failures.push(`No freshness inputs found for ${artifact.path}`)
    return {
      artifact: summarizeArtifact(artifact),
      newestInput: null,
      isFresh: false
    }
  }

  return {
    artifact: summarizeArtifact(artifact),
    newestInput: summarizeArtifact(newestInput),
    isFresh: artifact.mtimeMs >= newestInput.mtimeMs
  }
}

function summarizeArtifact(artifact) {
  return artifact === null
    ? null
    : {
        path: artifact.path,
        bytes: artifact.bytes,
        mtimeIso: artifact.mtimeIso
      }
}

function sumBytes(artifacts) {
  return artifacts.reduce((total, artifact) => total + artifact.bytes, 0)
}

function isForbiddenImport(specifier) {
  return forbiddenFirstScreenImports.some(
    (blocked) => specifier === blocked || specifier.startsWith(`${blocked}/`)
  )
}

function collectForbiddenBundleTokens(artifacts) {
  return artifacts
    .filter((artifact) => artifact.path.endsWith('.js'))
    .map((artifact) => {
      const bundleSource = readFileSync(artifact.path, 'utf8')
      const matchedTokens = forbiddenFirstScreenImports.filter((token) => bundleSource.includes(token))
      return [artifact.path, matchedTokens]
    })
}
