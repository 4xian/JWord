/**
 * 职责：执行 Gate 6 商业协作 bundle 门禁。
 * 边界：只检查已构建的 vanilla/collab dist 产物，不负责启动构建或真实浏览器。
 * 协作模块：examples/vanilla、examples/collab、Vite dynamic import chunk 和 Gate 6 商业包。
 * 约束：免费首屏不得包含协作高级代码；Hocuspocus、IndexedDB、server client 和授权诊断只能进入按需 chunk。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-653。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const vanillaDistRoot = join('examples', 'vanilla', 'dist')
const collabDistRoot = join('examples', 'collab', 'dist')
const freeVanillaFirstScreenForbiddenTokens = [
  '@4xian/jword-collab',
  '@4xian/jword-collab-server',
  '@4xian/jword-license',
  '@4xian/jword-persistence',
  '@hocuspocus',
  'hocuspocus',
  'IndexedDB',
  'indexeddb',
  'y-indexeddb',
  'createHocuspocusDemoRuntime',
  'createHocuspocusCollabProviderAdapter',
  'createIndexedDbOfflineAdapter',
  'connectJWordCollaboration',
  'startAutoInsertSession',
  'createJWordCollabServer',
  'COLLAB_LICENSE_MISSING',
  'JWORD_LICENSE_MISSING',
  'COLLAB_PROVIDER_AUTH_FAILED',
  'COLLAB_UPDATE_REJECTED',
  'OFFLINE_CACHE_SYNCED',
  'OFFLINE_RECONNECT_FAILED'
]
const collabFirstScreenForbiddenTokens = [
  '@4xian/jword-collab',
  '@4xian/jword-collab-server',
  '@4xian/jword-license',
  '@4xian/jword-persistence',
  '@hocuspocus',
  'y-indexeddb',
  'createHocuspocusDemoRuntime',
  'createHocuspocusCollabProviderAdapter',
  'createIndexedDbOfflineAdapter',
  'connectJWordCollaboration',
  'startAutoInsertSession',
  'createJWordCollabServer',
  'COLLAB_LICENSE_MISSING',
  'JWORD_LICENSE_MISSING',
  'COLLAB_PROVIDER_AUTH_FAILED',
  'COLLAB_UPDATE_REJECTED',
  'OFFLINE_CACHE_SYNCED',
  'OFFLINE_RECONNECT_FAILED',
  'IndexedDB offline cache',
  'WebSocketPolyfill'
]
const collabLazyRequiredTokens = [
  'loadHocuspocusDemoRuntime',
  'createHocuspocusDemoRuntime',
  'COLLAB_PROVIDER_AUTH_FAILED',
  'COLLAB_UPDATE_REJECTED',
  'OFFLINE_CACHE_SYNCED',
  'OFFLINE_RECONNECT_FAILED',
  'IndexedDB offline cache',
  'WebSocketPolyfill'
]
const collabFirstScreenForbiddenAssetNamePatterns = [
  /hocuspocus-runtime/u,
  /provider-runtime/u,
  /offline-runtime/u,
  /history-runtime/u
]
const failures = []

const vanillaFirstScreenAssets = readFirstScreenAssets(vanillaDistRoot)
const collabFirstScreenAssets = readFirstScreenAssets(collabDistRoot)
const collabLazyAssets = readLazyAssets(collabDistRoot, collabFirstScreenAssets)

if (vanillaFirstScreenAssets.length === 0) {
  failures.push(`${vanillaDistRoot}: no first-screen JS/CSS assets found.`)
}

if (collabFirstScreenAssets.length === 0) {
  failures.push(`${collabDistRoot}: no first-screen JS/CSS assets found.`)
}

if (collabLazyAssets.length === 0) {
  failures.push(`${collabDistRoot}: no lazy JS assets found.`)
}

for (const violation of collectTokenViolations(
  vanillaFirstScreenAssets.filter((artifact) => artifact.path.endsWith('.js')),
  freeVanillaFirstScreenForbiddenTokens
)) {
  failures.push(`free vanilla first screen contains paid collab token: ${violation}`)
}

for (const violation of collectTokenViolations(
  collabFirstScreenAssets.filter((artifact) => artifact.path.endsWith('.js')),
  collabFirstScreenForbiddenTokens
)) {
  failures.push(`collab first screen contains advanced runtime token: ${violation}`)
}

for (const artifact of collabFirstScreenAssets) {
  for (const pattern of collabFirstScreenForbiddenAssetNamePatterns) {
    if (pattern.test(artifact.path)) {
      failures.push(`collab first screen directly references advanced chunk: ${artifact.path}`)
    }
  }
}

const collabLazyTokenHits = collabLazyRequiredTokens.filter((token) =>
  collabLazyAssets.some((artifact) => artifact.text.includes(token))
)

if (collabLazyTokenHits.length !== collabLazyRequiredTokens.length) {
  failures.push(JSON.stringify({
    missingCollabLazyTokens: collabLazyRequiredTokens.filter((token) => !collabLazyTokenHits.includes(token)),
    collabLazyAssets: collabLazyAssets.map((artifact) => artifact.path)
  }, null, 2))
}

const hocuspocusLazyAssets = collabLazyAssets
  .filter((artifact) => artifact.text.includes('createHocuspocusDemoRuntime'))
  .map((artifact) => artifact.path)

if (hocuspocusLazyAssets.length === 0) {
  failures.push('collab lazy chunks do not contain Hocuspocus runtime implementation.')
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(
  JSON.stringify(
    {
      status: 'ok',
      vanilla: {
        firstScreenAssets: vanillaFirstScreenAssets.map((artifact) => artifact.path),
        freeVanillaFirstScreenForbiddenTokens
      },
      collab: {
        firstScreenAssets: collabFirstScreenAssets.map((artifact) => artifact.path),
        lazyAssets: collabLazyAssets.map((artifact) => artifact.path),
        hocuspocusLazyAssets,
        collabFirstScreenForbiddenTokens,
        collabLazyRequiredTokens
      }
    },
    null,
    2
  )
)

/** 读取 HTML 直接引用的首屏 asset。 */
function readFirstScreenAssets(distRoot) {
  const indexPath = join(distRoot, 'index.html')

  if (!existsSync(indexPath)) {
    failures.push(`Missing built artifact: ${indexPath}`)
    return []
  }

  const html = readFileSync(indexPath, 'utf8')
  const assetRefs = new Set([
    ...readSpecifiers(html, /<script[^>]+type="module"[^>]+src="([^"]+)"/gu),
    ...readSpecifiers(html, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/gu)
  ])

  return [...assetRefs]
    .map((ref) => ref.startsWith('/') ? join(distRoot, ref.slice(1)) : join(distRoot, ref))
    .filter((path) => existsSync(path))
    .map(readArtifact)
}

/** 读取 dist 内非首屏的 JS chunk。 */
function readLazyAssets(distRoot, firstScreenAssets) {
  const assetsDir = join(distRoot, 'assets')
  const firstScreenPaths = new Set(firstScreenAssets.map((artifact) => artifact.path))

  return listFiles(assetsDir)
    .filter((path) => path.endsWith('.js') && !firstScreenPaths.has(path))
    .map(readArtifact)
}

/** 读取一个文本构建产物。 */
function readArtifact(path) {
  return {
    path,
    text: readFileSync(path, 'utf8')
  }
}

/** 递归列出目录下所有文件。 */
function listFiles(directory) {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listFiles(path)
    }

    return entry.isFile() ? [path] : []
  })
}

/** 收集给定 artifact 中命中的禁用 token。 */
function collectTokenViolations(artifacts, tokens) {
  return artifacts.flatMap((artifact) =>
    tokens
      .filter((token) => artifact.text.includes(token))
      .map((token) => `${artifact.path}: ${token}`)
  )
}

/** 提取正则中的捕获值。 */
function readSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter(Boolean)
}
