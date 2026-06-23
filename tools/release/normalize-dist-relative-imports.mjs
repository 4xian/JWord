/**
 * 职责：归一 packages 下各 dist 目录中发布产物的相对 import/export specifier。
 * 边界：只处理已生成的 .js 与 .d.ts 文本产物，不构建、不打包、不改源码。
 * 协作模块：rollup.config.mjs、Gate 5/Gate 6 commercial pack 检查和第三方 smoke。
 * 约束：Node ESM 包消费者需要显式 .js 后缀；声明文件中的 type-only 引用也要指向 .js specifier。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-538建立商业包发布检查。
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const packagesRoot = join(repoRoot, 'packages')
const checkOnly = process.argv.includes('--check')
const rewrittenFiles = normalizeAllPackageDistImports()

if (checkOnly && rewrittenFiles.length > 0) {
  console.error(`dist relative imports need normalization:\n${rewrittenFiles.join('\n')}`)
  process.exit(1)
}

if (!checkOnly && rewrittenFiles.length > 0) {
  console.log(JSON.stringify({
    status: 'ok',
    normalizedFiles: rewrittenFiles
  }, null, 2))
}

/** 归一所有 workspace package 的 dist 文本产物。 */
function normalizeAllPackageDistImports() {
  if (!existsSync(packagesRoot)) {
    return []
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => normalizeDistImports(join(packagesRoot, entry.name)))
}

/** 归一单个 package dist 目录中的相对 specifier。 */
function normalizeDistImports(packageDir) {
  return listDistTextFiles(join(packageDir, 'dist')).flatMap((filePath) => {
    const source = readFileSync(filePath, 'utf8')
    const rewritten = rewriteRelativeImportSpecifiers(source, filePath)

    if (rewritten === source) {
      return []
    }

    if (!checkOnly) {
      writeFileSync(filePath, rewritten)
    }

    return [relative(repoRoot, filePath)]
  })
}

/** 递归列出 dist 下需要修正 import specifier 的文本产物。 */
function listDistTextFiles(root) {
  if (!existsSync(root)) {
    return []
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      return listDistTextFiles(path)
    }

    return entry.isFile() && /\.(?:js|d\.ts)$/u.test(path) ? [path] : []
  })
}

/** 重写源码中的相对 import/export specifier。 */
function rewriteRelativeImportSpecifiers(source, filePath) {
  return source.replace(
    /((?:from\s*|import\s*\(\s*)['"])(\.{1,2}\/[^'"]+)(['"])/gu,
    (match, prefix, specifier, suffix) => {
      const nextSpecifier = readNodeEsmSpecifier(filePath, specifier)

      return nextSpecifier === specifier ? match : `${prefix}${nextSpecifier}${suffix}`
    }
  )
}

/** 读取当前 specifier 对应的 Node ESM 兼容后缀。 */
function readNodeEsmSpecifier(fromFile, specifier) {
  if (extname(specifier) !== '' || specifier.endsWith('/')) {
    return specifier
  }

  const basePath = join(dirname(fromFile), specifier)

  if (existsSync(`${basePath}.js`) || existsSync(`${basePath}.d.ts`)) {
    return `${specifier}.js`
  }

  if (
    existsSync(basePath) &&
    statSync(basePath).isDirectory() &&
    (existsSync(join(basePath, 'index.js')) || existsSync(join(basePath, 'index.d.ts')))
  ) {
    return `${specifier}/index.js`
  }

  return specifier
}
