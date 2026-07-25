/**
 * 职责：执行 Gate 4.5 vanilla 原生 `.jword` lazy bundle 门禁。
 * 边界：只负责 fresh build 和 native lazy chunk 内容，不判断 Gate 2 体积阈值。
 * 协作模块：examples/vanilla/vite.config.ts、examples/vanilla/dist 和 Gate 4.5 真实浏览器验收。
 * 约束：每次先清理并同步构建；两套 ZIP runtime 都必须只命中 native lazy chunk。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { spawnSync } from 'node:child_process'

const demoDistRoot = join('examples', 'vanilla', 'dist')
const demoIndexPath = join(demoDistRoot, 'index.html')
const demoAssetsDir = join(demoDistRoot, 'assets')
const requiredModulePackages = ['jszip', '@zip.js/zip.js']
const forbiddenFirstScreenTokens = [
  'jszip',
  'SHA-256',
  'JWORD_NATIVE_CREATED_BY',
  'JWORD_NATIVE_SCHEMA_VERSION',
  'JWORD_NATIVE_FORMAT_VERSION',
  'JWORD_NATIVE_SCHEMA_FUTURE',
  'manifest.json',
  'checksums.json'
]
const requiredLazyTokens = [
  'jszip',
  'SHA-256',
  'JWORD_NATIVE_SCHEMA_FUTURE',
  'manifest.json',
  'checksums.json'
]

rmSync(demoDistRoot, { recursive: true, force: true })
const build = spawnSync(
  'pnpm',
  ['--filter', '@4xian/jword-example-vanilla', 'build'],
  { stdio: 'inherit' }
)

if (build.error !== undefined || build.status !== 0) {
  console.error('Gate 4.5 native bundle fresh build failed.')
  process.exit(1)
}

const moduleEvidencePaths = listAssets(demoDistRoot)
  .filter((path) => path.endsWith('module-evidence.json'))

if (!existsSync(demoIndexPath) || moduleEvidencePaths.length === 0) {
  console.error(`Missing built artifact: ${demoIndexPath}`)
  process.exit(1)
}

const html = readFileSync(demoIndexPath, 'utf8')
const firstScreenAssets = readFirstScreenAssets(html)
const lazyAssets = readLazyAssets(firstScreenAssets)
const moduleEvidence = readModuleEvidence(moduleEvidencePaths)

if (firstScreenAssets.length === 0) {
  console.error(`${demoIndexPath}: no first-screen JS/CSS assets found.`)
  process.exit(1)
}

if (lazyAssets.length === 0) {
  console.error(`${demoDistRoot}: no lazy assets found.`)
  process.exit(1)
}

const firstScreenViolations = firstScreenAssets
  .filter((artifact) => artifact.path.endsWith('.js'))
  .flatMap((artifact) => forbiddenFirstScreenTokens.filter((token) => artifact.text.includes(token)).map((token) => `${artifact.path}: ${token}`))

if (firstScreenViolations.length > 0) {
  console.error(firstScreenViolations.join('\n'))
  process.exit(1)
}

const lazyTokenHits = requiredLazyTokens.filter((token) => lazyAssets.some((artifact) => artifact.text.includes(token)))

if (lazyTokenHits.length !== requiredLazyTokens.length) {
  console.error(
    JSON.stringify(
      {
        missingTokens: requiredLazyTokens.filter((token) => !lazyTokenHits.includes(token)),
        firstScreenAssets: firstScreenAssets.map((artifact) => artifact.path),
        lazyAssets: lazyAssets.map((artifact) => artifact.path)
      },
      null,
      2
    )
  )
  process.exit(1)
}

const firstScreenChunks = new Set(firstScreenAssets.map((artifact) => readOutputName(artifact.path)))
const lazyChunks = new Set(lazyAssets.map((artifact) => readOutputName(artifact.path)))
const moduleResults = requiredModulePackages.map((label) => {
  const evidence = moduleEvidence.packages[label]
  const chunks = evidence?.chunks ?? []

  return {
    label,
    moduleCount: evidence?.moduleCount ?? 0,
    chunks,
    firstScreenHits: chunks.filter((chunk) => firstScreenChunks.has(chunk)),
    lazyHits: chunks.filter((chunk) => lazyChunks.has(chunk))
  }
})

if (moduleResults.some((result) => (
  result.moduleCount <= 0 ||
  result.chunks.length === 0 ||
  result.firstScreenHits.length > 0 ||
  result.lazyHits.length === 0
))) {
  console.error(JSON.stringify({ moduleResults }, null, 2))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      firstScreenAssets: firstScreenAssets.map((artifact) => artifact.path),
      lazyAssets: lazyAssets.map((artifact) => artifact.path),
      requiredLazyTokens,
      moduleResults
    },
    null,
    2
  )
)

/** 读取并验证 build-only native module evidence 的安全结构。 */
function readModuleEvidence(paths) {
  const combined = Object.fromEntries(requiredModulePackages.map((label) => [label, {
    moduleCount: 0,
    chunks: []
  }]))

  for (const path of paths) {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))

    if (parsed?.schemaVersion !== 1 || typeof parsed.packages !== 'object' || parsed.packages === null) {
      console.error(`${path}: invalid module evidence.`)
      process.exit(1)
    }

    for (const label of requiredModulePackages) {
      const evidence = parsed.packages[label]

      if (
        typeof evidence?.moduleCount !== 'number' ||
        !Number.isInteger(evidence.moduleCount) ||
        !Array.isArray(evidence.chunks) ||
        evidence.chunks.some((chunk) => typeof chunk !== 'string' || chunk.startsWith('/') || chunk.includes('..'))
      ) {
        console.error(`${path}: invalid ${label} evidence.`)
        process.exit(1)
      }

      combined[label].moduleCount += evidence.moduleCount
      combined[label].chunks.push(...evidence.chunks)
    }
  }

  return {
    packages: Object.fromEntries(requiredModulePackages.map((label) => [label, {
      moduleCount: combined[label].moduleCount,
      chunks: [...new Set(combined[label].chunks)].sort()
    }]))
  }
}

/** 将 dist 内路径转换为 evidence 使用的正斜杠相对输出名。 */
function readOutputName(path) {
  return relative(demoDistRoot, path).split(sep).join('/')
}

/** 读取首屏 asset。 */
function readFirstScreenAssets(html) {
  const assetRefs = new Set([
    ...readSpecifiers(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/gu),
    ...readSpecifiers(html, /<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/gu),
    ...readSpecifiers(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)
  ])

  return [...assetRefs]
    .map((ref) => ref.startsWith('/') ? join(demoDistRoot, ref.slice(1)) : join(demoDistRoot, ref))
    .filter((path) => existsSync(path))
    .map((path) => ({
      path,
      text: readFileSync(path, 'utf8')
    }))
}

/** 读取 lazy asset。 */
function readLazyAssets(firstScreenAssets) {
  const firstScreenPaths = new Set(firstScreenAssets.map((artifact) => artifact.path))

  return listAssets(demoAssetsDir)
    .filter((path) => path.endsWith('.js') && !firstScreenPaths.has(path))
    .map((path) => ({
      path,
      text: readFileSync(path, 'utf8')
    }))
}

/** 递归列出 assets 目录下的文件。 */
function listAssets(directory) {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const next = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listAssets(next)
    }

    return entry.isFile() ? [next] : []
  })
}

/** 提取正则中的捕获值。 */
function readSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean)
}
