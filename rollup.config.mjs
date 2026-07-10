import commonjs from '@rollup/plugin-commonjs'
import { nodeResolve } from '@rollup/plugin-node-resolve'
import typescript from '@rollup/plugin-typescript'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'

const packagesRoot = 'packages'
const baseExternalSpecifiers = ['react', 'vue']
const externalPrefixes = ['node:']
const externalSpecifiers = new Set([
  ...baseExternalSpecifiers,
  ...readWorkspaceExternalSpecifiers()
])
const packageBuildOrder = new Map([
  ['@4xian/jword-core', 0],
  ['@4xian/jword-license', 1],
  ['@4xian/jword-native', 2],
  ['@4xian/jword-docx', 3],
  ['@4xian/jword-pdf', 4],
  ['@4xian/jword-persistence', 5],
  ['@4xian/jword-collab', 6],
  ['@4xian/jword-collab-server', 7],
  ['@4xian/jword-ui', 8],
  ['@4xian/jword-devtools', 9],
  ['@4xian/jword-react', 10],
  ['@4xian/jword-vue', 11]
])

function readPackageJson(packageDir) {
  const packageJsonPath = join(packageDir, 'package.json')
  if (!existsSync(packageJsonPath)) {
    return null
  }
  return JSON.parse(readFileSync(packageJsonPath, 'utf8'))
}

function discoverPackages() {
  if (!existsSync(packagesRoot)) {
    return []
  }

  return readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packagesRoot, entry.name))
    .map((packageDir) => {
      const packageJson = readPackageJson(packageDir)
      const input = join(packageDir, 'src', 'index.ts')
      if (!packageJson || !existsSync(input)) {
        return null
      }
      return {
        dir: packageDir,
        input,
        name: packageJson.name ?? relative('.', packageDir)
      }
    })
    .filter(Boolean)
}

function isExternal(id) {
  return externalPrefixes.some((prefix) => id === prefix || id.startsWith(prefix)) ||
    [...externalSpecifiers].some((specifier) => id === specifier || id.startsWith(`${specifier}/`))
}

// 从 workspace package 清单读取所有应外置的生产依赖。
function readWorkspaceExternalSpecifiers() {
  if (!existsSync(packagesRoot)) {
    return []
  }

  const specifiers = new Set()

  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue
    }

    const packageJson = readPackageJson(join(packagesRoot, entry.name))
    if (packageJson === null) {
      continue
    }

    if (typeof packageJson.name === 'string') {
      specifiers.add(packageJson.name)
    }

    for (const dependency of readDependencyNames(packageJson.dependencies)) {
      specifiers.add(dependency)
    }
    for (const dependency of readDependencyNames(packageJson.peerDependencies)) {
      specifiers.add(dependency)
    }
  }

  return [...specifiers]
}

// 读取 dependencies/peerDependencies 字段中的依赖名。
function readDependencyNames(dependencies) {
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    return []
  }

  return Object.keys(dependencies)
}


function trimGeneratedLeadingWhitespace() {
  return {
    name: 'trim-generated-leading-whitespace',
    renderChunk(code) {
      return {
        code: stripLeadingWhitespaceOutsideLiterals(code),
        map: null
      }
    }
  }
}

function stripLeadingWhitespaceOutsideLiterals(code) {
  let output = ''
  let quote = null
  let escaping = false
  let lineStart = true

  for (const character of code) {
    if (lineStart && quote === null && (character === ' ' || character === '\t')) {
      continue
    }

    output += character

    if (escaping) {
      escaping = false
      lineStart = character === '\n'
      continue
    }

    if (quote !== null) {
      if (character === '\\') {
        escaping = true
      } else if (character === quote) {
        quote = null
      }
      lineStart = character === '\n'
      continue
    }

    if (character === "'" || character === '"' || character === '`') {
      quote = character
      lineStart = false
      continue
    }

    lineStart = character === '\n'
  }

  return output
}

function stripPreservedDocComments() {
  return {
    name: 'strip-preserved-doc-comments',
    renderChunk(code) {
      return {
        code: code.replace(/\/\*\*[\s\S]*?\*\//gu, ''),
        map: null
      }
    }
  }
}

// 创建后处理插件，把 dist 中相对 import 归一为 Node ESM 可解析形式。
function normalizeDistRelativeImports(packageDir) {
  return {
    name: 'normalize-dist-relative-imports',
    /** 产物写入后补齐 Node ESM 需要的相对 .js 后缀。 */
    closeBundle() {
      for (const filePath of listDistTextFiles(join(packageDir, 'dist'))) {
        const source = readFileSync(filePath, 'utf8')
        const rewritten = rewriteRelativeImportSpecifiers(source, filePath)

        if (rewritten !== source) {
          writeFileSync(filePath, rewritten)
        }
      }
    }
  }
}

// 创建清理插件，确保旧 dist 产物不会进入新包。
function cleanPackageDistBeforeBuild(packageDir) {
  let cleaned = false

  return {
    name: 'clean-package-dist-before-build',
    /** 在当前包第一次构建前清空旧 dist，避免旧 sourcemap 残留进入 pack。 */
    buildStart() {
      if (cleaned) {
        return
      }

      cleaned = true
      rmSync(join(packageDir, 'dist'), {
        force: true,
        recursive: true
      })
    }
  }
}

// 创建样式资产复制插件，确保 CSS export 指向 dist 产物而不是源码目录。
function copyPackageStyleAssets(packageDir) {
  return {
    name: 'copy-package-style-assets',
    /** 在产物完成后复制 src/styles 下的 CSS 文件到 dist/styles。 */
    closeBundle() {
      const sourceDir = join(packageDir, 'src', 'styles')
      if (!existsSync(sourceDir)) {
        return
      }

      const targetDir = join(packageDir, 'dist', 'styles')
      mkdirSync(targetDir, { recursive: true })

      for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
        if (entry.isFile() && entry.name.endsWith('.css')) {
          copyFileSync(join(sourceDir, entry.name), join(targetDir, entry.name))
        }
      }
    }
  }
}

function createPackageConfig(pkg, options = {}) {
  return {
    input: pkg.input,
    external: isExternal,
    plugins: [
      ...(options.cleanDist === true ? [cleanPackageDistBeforeBuild(pkg.dir)] : []),
      typescript({
        tsconfig: join(pkg.dir, 'tsconfig.json'),
        outDir: join(pkg.dir, 'dist'),
        declaration: true,
        declarationMap: false,
        declarationDir: join(pkg.dir, 'dist')
      }),
      nodeResolve({ browser: true, preferBuiltins: false }),
      commonjs(),
      stripPreservedDocComments(),
      trimGeneratedLeadingWhitespace(),
      copyPackageStyleAssets(pkg.dir),
      normalizeDistRelativeImports(pkg.dir)
    ],
    output: {
      file: join(pkg.dir, 'dist', 'index.js'),
      format: 'es',
      compact: true,
      sourcemap: false
    },
    treeshake: {
      moduleSideEffects: false
    }
  }
}

function createWorkerConfigs(pkg) {
  const workerEntry = join(pkg.dir, 'src', 'worker.ts')
  if (!existsSync(workerEntry)) {
    return []
  }
  return [
    {
      ...createPackageConfig({ ...pkg, input: workerEntry }),
      output: {
        file: join(pkg.dir, 'dist', 'worker.js'),
        format: 'es',
        compact: true,
        sourcemap: false
      }
    }
  ]
}

function createExperimentalConfigs(pkg) {
  const experimentalEntry = join(pkg.dir, 'src', 'experimental.ts')
  if (!existsSync(experimentalEntry)) {
    return []
  }
  return [
    {
      ...createPackageConfig({ ...pkg, input: experimentalEntry }),
      output: {
        file: join(pkg.dir, 'dist', 'experimental.js'),
        format: 'es',
        compact: true,
        sourcemap: false
      }
    }
  ]
}

const packages = discoverPackages()
  .toSorted((left, right) => readPackageOrder(left.name) - readPackageOrder(right.name))
const configs = packages.flatMap((pkg) => [
  createPackageConfig(pkg, { cleanDist: true }),
  ...createWorkerConfigs(pkg),
  ...createExperimentalConfigs(pkg)
])

export default configs

function readPackageOrder(name) {
  return packageBuildOrder.get(name) ?? 100
}

// 递归列出 dist 下需要修正 import specifier 的文本产物。
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

// 重写源码中的相对 import/export specifier。
function rewriteRelativeImportSpecifiers(source, filePath) {
  return source.replace(
    /((?:from\s*|import\s*\(\s*)['"])(\.{1,2}\/[^'"]+)(['"])/gu,
    (match, prefix, specifier, suffix) => {
      const nextSpecifier = readNodeEsmSpecifier(filePath, specifier)

      return nextSpecifier === specifier ? match : `${prefix}${nextSpecifier}${suffix}`
    }
  )
}

// 读取当前 specifier 对应的 Node ESM 兼容后缀。
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
