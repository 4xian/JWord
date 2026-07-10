/**
 * 职责：执行 Gate 4.5 vanilla 原生 `.jword` lazy bundle 门禁。
 * 边界：只检查 vanilla 首屏与 native lazy chunk 的内容，不判断 Gate 2 体积阈值。
 * 协作模块：examples/vanilla/dist、tools/size/check-size.mjs 和 Gate 4.5 真实浏览器验收。
 * 约束：首屏 bundle 不得包含 native 实现依赖，native 实现只能出现在按需加载的 lazy chunk。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const demoDistRoot = join('examples', 'vanilla', 'dist')
const demoIndexPath = join(demoDistRoot, 'index.html')
const demoAssetsDir = join(demoDistRoot, 'assets')
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

if (!existsSync(demoIndexPath)) {
  console.error(`Missing built artifact: ${demoIndexPath}`)
  process.exit(1)
}

const html = readFileSync(demoIndexPath, 'utf8')
const firstScreenAssets = readFirstScreenAssets(html)
const lazyAssets = readLazyAssets(firstScreenAssets)

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

console.log(
  JSON.stringify(
    {
      status: 'ok',
      firstScreenAssets: firstScreenAssets.map((artifact) => artifact.path),
      lazyAssets: lazyAssets.map((artifact) => artifact.path),
      requiredLazyTokens
    },
    null,
    2
  )
)

/** 读取首屏 asset。 */
function readFirstScreenAssets(html) {
  const assetRefs = new Set([
    ...readSpecifiers(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/gu),
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
