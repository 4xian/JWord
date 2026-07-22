/**
 * 职责：验证 License tarball 在 Node、当前三浏览器和真实 Dedicated Worker 中的公开运行时路径。
 * 边界：只消费 @4xian/jword-license 根入口，不接入 Gate 5/7 或 DOCX、PDF、Collaboration worker。
 * 协作模块：许可证包构建、本地包文件生成、浏览器构建和三引擎自动化。
 * 约束：复用现有 production golden token 和固定时间，不生成 signer、私钥或测试 seed。
 * 实现说明：默认验证 LIC-107B1；--node-only 验证 Node 下限；--prepare-browser 生成最低浏览器人工验收 bundle。
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const licenseDir = join(repoRoot, 'packages/license')
const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const fixedTime = '2026-01-15T00:00:00.000Z'
const fixedNow = Date.parse(fixedTime)
const smokeOptions = readSmokeOptions(process.argv.slice(2))
const nodeOnly = smokeOptions.mode === 'node-only'
const prepareBrowser = smokeOptions.mode === 'prepare-browser'
const workspaceDir = mkdtempSync(join(tmpdir(), 'jword-license-runtime-smoke-'))
const packDir = join(workspaceDir, 'packs')
const projectDir = join(workspaceDir, 'empty-project')

/** 读取并校验 runtime smoke 执行选项。 */
function readSmokeOptions(arguments_) {
  if (arguments_.length === 0) {
    return { mode: 'full' }
  }

  if (arguments_.length === 1 && arguments_[0] === '--node-only') {
    return { mode: 'node-only' }
  }

  if (arguments_.length === 2 && arguments_[0] === '--pack-path' && arguments_[1] !== '') {
    return {
      mode: 'full',
      packPath: arguments_[1]
    }
  }

  if (
    arguments_.length === 3 &&
    arguments_[0] === '--node-only' &&
    arguments_[1] === '--pack-path' &&
    arguments_[2] !== ''
  ) {
    return {
      mode: 'node-only',
      packPath: arguments_[2]
    }
  }

  if (
    arguments_.length === 3 &&
    arguments_[0] === '--prepare-browser' &&
    arguments_[1] === '--pack-path' &&
    arguments_[2] !== ''
  ) {
    return {
      mode: 'prepare-browser',
      packPath: arguments_[2]
    }
  }

  throw new Error(`Unsupported License runtime smoke arguments: ${arguments_.join(' ')}`)
}

/** 断言 smoke 条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/** 读取根项目中锁定的精确开发依赖版本。 */
function readRootDevDependencyVersion(name) {
  const version = rootPackageJson.devDependencies?.[name]

  if (typeof version !== 'string' || version.startsWith('^') || version.startsWith('~')) {
    throw new Error(`Root devDependency ${name} must use an exact version.`)
  }

  return version
}

/** 从现有 License 测试读取 production golden token，避免生成或维护第二份签发材料。 */
function readProductionGoldenToken() {
  const sourcePath = join(repoRoot, 'packages/license/test/jwl2.test.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const token = source.match(/const PRODUCTION_GOLDEN_TOKEN = '([^']+)'/u)?.[1]

  if (token === undefined || !token.startsWith('JWL2.')) {
    throw new Error(`Unable to read PRODUCTION_GOLDEN_TOKEN from ${relative(repoRoot, sourcePath)}.`)
  }

  return token
}

/** 打包 License，并校验 tarball manifest 与文件边界。 */
function packLicense() {
  if (smokeOptions.packPath !== undefined) {
    assert(existsSync(smokeOptions.packPath), `License tarball does not exist: ${smokeOptions.packPath}`)
    mkdirSync(packDir, { recursive: true })
    const copiedPackPath = join(packDir, basename(smokeOptions.packPath))
    copyFileSync(smokeOptions.packPath, copiedPackPath)
    assertPackManifest(copiedPackPath)

    return copiedPackPath
  }

  assert(
    existsSync(join(licenseDir, 'dist/index.js')),
    'License dist is missing; run pnpm --filter @4xian/jword-license build first.'
  )
  mkdirSync(packDir, { recursive: true })

  execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: licenseDir,
    stdio: 'pipe'
  })

  const files = readdirSync(packDir).filter((file) => file.endsWith('.tgz'))
  assert(files.length === 1, `Expected one License tarball, received ${String(files.length)}.`)

  const packPath = join(packDir, files[0])
  assertPackManifest(packPath)

  return packPath
}

/** 校验 tarball 只暴露根入口且不携带 workspace alias 或测试文件。 */
function assertPackManifest(packPath) {
  const manifestSource = execFileSync('tar', ['-xOf', packPath, 'package/package.json'], {
    encoding: 'utf8'
  })
  const manifest = JSON.parse(manifestSource)
  const exportKeys = Object.keys(manifest.exports ?? {})
  const files = execFileSync('tar', ['-tf', packPath], { encoding: 'utf8' })
    .split('\n')
    .map((entry) => entry.replace(/^package\//u, ''))
    .filter(Boolean)

  assert(!manifestSource.includes('workspace:'), 'License tarball manifest must not contain workspace aliases.')
  assert(
    exportKeys.length === 1 && exportKeys[0] === '.',
    `License tarball export map must only contain ".", received ${exportKeys.join(', ')}.`
  )
  assert(
    manifest.dependencies?.['@noble/curves'] === '2.2.0',
    'License tarball must depend on exact @noble/curves 2.2.0.'
  )

  const forbiddenFiles = files.filter((file) => (
    /(^|\/)(src|test|tests|fixtures?)(\/|$)/u.test(file) ||
    /(seed|private|signer)/iu.test(file)
  ))
  assert(forbiddenFiles.length === 0, `License tarball contains forbidden files: ${forbiddenFiles.join(', ')}`)
}

/** 写入只依赖本地 License tarball 的临时空项目。 */
function writeEmptyProject(packPath) {
  mkdirSync(projectDir, { recursive: true })
  const packageJson = {
    name: 'jword-license-runtime-smoke',
    private: true,
    type: 'module',
    packageManager: rootPackageJson.packageManager,
    ...(nodeOnly
      ? {}
      : {
          scripts: {
            build: 'vite build',
            ...(prepareBrowser
              ? {}
              : { browser: 'playwright test --config playwright.config.mjs' })
          }
        }),
    dependencies: {
      '@4xian/jword-license': `file:../packs/${basename(packPath)}`
    },
    ...(nodeOnly
      ? {}
      : {
          devDependencies: {
            ...(prepareBrowser
              ? {}
              : { '@playwright/test': readRootDevDependencyVersion('@playwright/test') }),
            vite: readRootDevDependencyVersion('vite')
          }
        })
  }

  writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  writeFileSync(join(projectDir, 'node-smoke.mjs'), createNodeSmokeSource(productionGoldenToken))

  if (nodeOnly) {
    return
  }

  mkdirSync(join(projectDir, 'src'), { recursive: true })
  writeFileSync(join(projectDir, 'index.html'), indexHtmlSource)
  writeFileSync(join(projectDir, 'vite.config.mjs'), viteConfigSource)
  writeFileSync(join(projectDir, 'src/main.js'), createBrowserMainSource(productionGoldenToken))
  writeFileSync(join(projectDir, 'src/license-worker.js'), createWorkerSource())

  if (prepareBrowser) {
    return
  }

  writeFileSync(join(projectDir, 'playwright.config.mjs'), playwrightConfigSource)
  writeFileSync(join(projectDir, 'browser-smoke.spec.mjs'), browserSmokeSpecSource)
}

/** 安装临时空项目，禁止 lifecycle script。 */
function installEmptyProject() {
  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

/** 校验 License 根入口解析到临时项目 node_modules，而非 monorepo。 */
function assertNoRepoAlias() {
  const resolvedUrl = execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "console.log(import.meta.resolve('@4xian/jword-license'))"
  ], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()
  const resolvedPath = realpathSync(fileURLToPath(resolvedUrl))
  const realProjectDir = realpathSync(projectDir)
  const realRepoRoot = realpathSync(repoRoot)

  assert(
    resolvedPath.startsWith(`${realProjectDir}${sep}`),
    `License resolved outside the temporary project: ${resolvedPath}`
  )
  assert(
    !resolvedPath.startsWith(`${realRepoRoot}${sep}`),
    `License resolved through the monorepo: ${resolvedPath}`
  )

  return resolvedPath
}

/** 校验 pnpm 物理依赖目录中各只有一套 noble 2.2.0。 */
function assertNobleDependencyTree() {
  const virtualStoreDir = join(projectDir, 'node_modules/.pnpm')
  const entries = readdirSync(virtualStoreDir)
  const curves = entries.filter((entry) => entry.startsWith('@noble+curves@'))
  const hashes = entries.filter((entry) => entry.startsWith('@noble+hashes@'))

  assert(
    curves.length === 1 && curves[0] === '@noble+curves@2.2.0',
    `Expected only @noble/curves@2.2.0, received ${curves.join(', ')}.`
  )
  assert(
    hashes.length === 1 && hashes[0] === '@noble+hashes@2.2.0',
    `Expected only @noble/hashes@2.2.0, received ${hashes.join(', ')}.`
  )

  const tree = execFileSync('pnpm', [
    'list',
    '@noble/curves',
    '@noble/hashes',
    '--depth',
    'Infinity'
  ], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()

  process.stdout.write(`${tree}\n`)

  return {
    '@noble/curves': '2.2.0',
    '@noble/hashes': '2.2.0',
    physicalCopies: {
      '@noble/curves': curves.length,
      '@noble/hashes': hashes.length
    }
  }
}

/** 运行只从 License 根入口导入 API 的 Node smoke。 */
function runNodeSmoke() {
  const output = execFileSync(process.execPath, ['node-smoke.mjs'], {
    cwd: projectDir,
    encoding: 'utf8'
  }).trim()
  const result = JSON.parse(output)

  assert(result.status === 'ok', `Node License smoke failed: ${output}`)
  if (nodeOnly) {
    assert(
      result.nodeVersion === 'v20.19.0',
      `LIC-107B2 requires Node v20.19.0, received ${String(result.nodeVersion)}.`
    )
  }

  return result
}

/** 读取当前 smoke 使用的 pnpm 精确版本。 */
function readPnpmVersion() {
  const version = execFileSync('pnpm', ['--version'], { encoding: 'utf8' }).trim()

  if (nodeOnly) {
    assert(version === '9.14.2', `LIC-107B2 requires pnpm 9.14.2, received ${version}.`)
  }

  return version
}

/** 运行 Vite ES2022 production build。 */
function runViteBuild() {
  execFileSync('pnpm', ['run', 'build'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

/** 读取 Vite main 与 worker JavaScript chunk 的原始及 gzip 大小。 */
function readBundleMetrics() {
  const assetsDir = join(projectDir, 'dist/assets')
  const files = readdirSync(assetsDir).filter((file) => file.endsWith('.js')).sort()
  const mainFiles = files.filter((file) => file.startsWith('license-main-'))
  const workerFiles = files.filter((file) => file.startsWith('license-worker-'))

  assert(mainFiles.length === 1, `Expected one Vite main chunk, received ${mainFiles.join(', ')}.`)
  assert(workerFiles.length === 1, `Expected one Vite worker chunk, received ${workerFiles.join(', ')}.`)

  return {
    target: 'es2022',
    main: readChunkMetric(mainFiles[0]),
    worker: readChunkMetric(workerFiles[0])
  }
}

/** 读取单个 bundle chunk 的体积。 */
function readChunkMetric(file) {
  const filePath = join(projectDir, 'dist/assets', file)
  const source = readFileSync(filePath)

  return {
    file: relative(projectDir, filePath),
    rawBytes: statSync(filePath).size,
    gzipBytes: gzipSync(source).byteLength,
    sha256: createHash('sha256').update(source).digest('hex')
  }
}

/** 计算验证产物的 SHA-256。 */
function readFileSha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

/** 获取 Playwright 临时 Vite server 使用的动态端口。 */
async function findAvailablePort() {
  const server = createServer()

  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('Failed to allocate a License runtime smoke port.'))
        return
      }

      server.close((error) => {
        if (error !== undefined) {
          reject(error)
          return
        }

        resolve(address.port)
      })
    })
  })
}

/** 在当前 Playwright Chromium、Firefox 与 WebKit 中运行浏览器/Worker smoke。 */
async function runBrowserSmoke() {
  const port = await findAvailablePort()

  execFileSync('pnpm', ['run', 'browser'], {
    cwd: projectDir,
    env: {
      ...process.env,
      JWORD_LICENSE_RUNTIME_SMOKE_PORT: String(port)
    },
    stdio: 'inherit'
  })

  return ['chromium', 'firefox', 'webkit'].map((project) => {
    const resultPath = join(projectDir, `browser-result-${project}.json`)
    assert(existsSync(resultPath), `Missing Playwright result for ${project}.`)

    return JSON.parse(readFileSync(resultPath, 'utf8'))
  })
}

/** 生成 Node public-entry smoke 源码。 */
function createNodeSmokeSource(token) {
  return String.raw`import {
  JWORD_FEATURES,
  activateJWordLicense,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed
} from '@4xian/jword-license'

const PRODUCTION_GOLDEN_TOKEN = ${JSON.stringify(token)}
const FIXED_NOW = ${String(fixedNow)}
Date.now = () => FIXED_NOW

const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
assert(isJWordFeatureLicensed(license, JWORD_FEATURES.formats), 'Node formats feature must be licensed.')

const transfer = createJWordLicenseTransfer(license)
assert(Object.keys(transfer).length === 1, 'Node transfer must only contain token.')
assert(transfer.token === PRODUCTION_GOLDEN_TOKEN, 'Node transfer must preserve the signed token.')

let tamperedRejected = false
try {
  activateJWordLicense(tamperToken(PRODUCTION_GOLDEN_TOKEN))
} catch {
  tamperedRejected = true
}
assert(tamperedRejected, 'Node must reject a tampered production token.')

console.log(JSON.stringify({
  status: 'ok',
  nodeVersion: process.version,
  fixedNow: new Date(FIXED_NOW).toISOString(),
  activation: true,
  formats: true,
  transfer: true,
  tamperedRejected
}))

/** 篡改签名段，生成必须被拒绝的许可证令牌。 */
function tamperToken(token) {
  const parts = token.split('.')
  const signature = Buffer.from(parts[2] ?? '', 'base64url')
  signature[0] = (signature[0] ?? 0) ^ 1

  return parts[0] + '.' + parts[1] + '.' + signature.toString('base64url')
}

/** 断言临时项目条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
`
}

/** 生成浏览器主线程 public-entry smoke 源码。 */
function createBrowserMainSource(token) {
  return String.raw`import {
  JWORD_FEATURES,
  activateJWordLicense,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed
} from '@4xian/jword-license'

const PRODUCTION_GOLDEN_TOKEN = ${JSON.stringify(token)}
const FIXED_NOW = ${String(fixedNow)}
Date.now = () => FIXED_NOW

const root = document.querySelector('#root')
if (!(root instanceof HTMLDivElement)) {
  throw new Error('Missing License runtime smoke root.')
}

try {
  const license = activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
  const formats = isJWordFeatureLicensed(license, JWORD_FEATURES.formats)
  assert(formats, 'Browser main thread formats feature must be licensed.')

  const transfer = createJWordLicenseTransfer(license)
  assert(Object.keys(transfer).length === 1, 'Browser transfer must only contain token.')

  const tamperedToken = tamperToken(PRODUCTION_GOLDEN_TOKEN)
  let mainTamperedRejected = false
  try {
    activateJWordLicense(tamperedToken)
  } catch {
    mainTamperedRejected = true
  }
  assert(mainTamperedRejected, 'Browser main thread must reject a tampered token.')

  const worker = await runWorker(transfer, tamperedToken)
  const result = {
    fixedNow: new Date(FIXED_NOW).toISOString(),
    mainActivation: true,
    mainFormats: formats,
    mainTamperedRejected,
    dedicatedWorker: worker.status === 'ok',
    workerFormats: worker.formats,
    workerTamperedRejected: worker.tamperedRejected
  }

  assert(result.dedicatedWorker, 'Dedicated Worker must return ok.')
  assert(result.workerFormats, 'Dedicated Worker formats feature must be licensed.')
  assert(result.workerTamperedRejected, 'Dedicated Worker must reject a tampered token.')

  root.dataset.status = 'ok'
  root.dataset.result = JSON.stringify(result)
  root.textContent = JSON.stringify(result)
} catch (error) {
  root.dataset.status = 'error'
  root.textContent = error instanceof Error ? error.message : String(error)
  throw error
}

/** 通过模块型专用线程验证许可证转移对象。 */
function runWorker(transfer, tamperedToken) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./license-worker.js', import.meta.url), { type: 'module' })
    const timeout = setTimeout(() => {
      worker.terminate()
      reject(new Error('Dedicated Worker timed out.'))
    }, 10000)

    worker.addEventListener('message', (event) => {
      clearTimeout(timeout)
      worker.terminate()

      if (event.data?.status !== 'ok') {
        reject(new Error(event.data?.message ?? 'Dedicated Worker failed.'))
        return
      }

      resolve(event.data)
    }, { once: true })
    worker.addEventListener('error', (event) => {
      clearTimeout(timeout)
      worker.terminate()
      reject(new Error(event.message || 'Dedicated Worker failed.'))
    }, { once: true })
    worker.postMessage({ transfer, tamperedToken })
  })
}

/** 篡改签名段，生成必须被拒绝的许可证令牌。 */
function tamperToken(token) {
  const parts = token.split('.')
  const normalized = (parts[2] ?? '').replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const signature = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0))
  signature[0] = (signature[0] ?? 0) ^ 1
  const encoded = btoa(String.fromCharCode(...signature))
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '')

  return parts[0] + '.' + parts[1] + '.' + encoded
}

/** 断言临时项目条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
`
}

/** 生成 Dedicated Worker public-entry smoke 源码。 */
function createWorkerSource() {
  return String.raw`import {
  JWORD_FEATURES,
  activateJWordLicense,
  isJWordFeatureLicensed
} from '@4xian/jword-license'

const FIXED_NOW = ${String(fixedNow)}
Date.now = () => FIXED_NOW

self.addEventListener('message', (event) => {
  try {
    const license = activateJWordLicense(event.data.transfer.token)
    const formats = isJWordFeatureLicensed(license, JWORD_FEATURES.formats)
    let tamperedRejected = false

    try {
      activateJWordLicense(event.data.tamperedToken)
    } catch {
      tamperedRejected = true
    }

    self.postMessage({
      status: 'ok',
      formats,
      tamperedRejected
    })
  } catch (error) {
    self.postMessage({
      status: 'error',
      message: error instanceof Error ? error.message : String(error)
    })
  }
})
`
}

const indexHtmlSource = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>JWord License runtime smoke</title>
  </head>
  <body>
    <div id="root" data-status="booting">License runtime smoke booting</div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`

const viteConfigSource = String.raw`import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/license-main-[hash].js'
      }
    }
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/license-worker-[hash].js'
      }
    }
  }
})
`

const playwrightConfigSource = String.raw`import { defineConfig, devices } from '@playwright/test'

const port = Number.parseInt(process.env.JWORD_LICENSE_RUNTIME_SMOKE_PORT ?? '', 10)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('JWORD_LICENSE_RUNTIME_SMOKE_PORT must be a valid TCP port.')
}

const baseURL = 'http://127.0.0.1:' + String(port)

export default defineConfig({
  testDir: '.',
  testMatch: ['browser-smoke.spec.mjs'],
  fullyParallel: true,
  reporter: 'line',
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port ' + String(port) + ' --strictPort',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120000
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], baseURL }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'], baseURL }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'], baseURL }
    }
  ]
})
`

const browserSmokeSpecSource = String.raw`import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('activates License tarball in browser main thread and module Dedicated Worker', async ({ browser, page }, testInfo) => {
  await page.goto('/')
  const root = page.locator('#root')

  await expect(root).toHaveAttribute('data-status', 'ok')
  const serializedResult = await root.getAttribute('data-result')
  expect(serializedResult).not.toBeNull()

  const result = JSON.parse(serializedResult)
  expect(result).toEqual({
    fixedNow: '${fixedTime}',
    mainActivation: true,
    mainFormats: true,
    mainTamperedRejected: true,
    dedicatedWorker: true,
    workerFormats: true,
    workerTamperedRejected: true
  })

  writeFileSync(
    join(process.cwd(), 'browser-result-' + testInfo.project.name + '.json'),
    JSON.stringify({
      project: testInfo.project.name,
      browserVersion: browser.version(),
      result
    }, null, 2) + '\n'
  )
})
`

const productionGoldenToken = readProductionGoldenToken()
const packPath = packLicense()
const packSha256 = readFileSha256(packPath)
writeEmptyProject(packPath)
installEmptyProject()
const resolvedLicenseEntry = assertNoRepoAlias()
const dependencyTree = assertNobleDependencyTree()
const nodeResult = runNodeSmoke()
const pnpmVersion = readPnpmVersion()

if (nodeOnly) {
  console.log(JSON.stringify({
    status: 'ok',
    name: 'license-runtime-smoke',
    scope: 'LIC-107B2-node-20.19.0',
    fixedTime,
    minimumVersionsVerified: {
      node: true,
      browsers: false
    },
    install: {
      source: 'local-tarball',
      workspaceAlias: false,
      resolvedLicenseEntry,
      projectDir,
      packPath,
      packSha256
    },
    node: nodeResult,
    packageManager: {
      name: 'pnpm',
      version: pnpmVersion
    },
    dependencyTree
  }, null, 2))
} else {
  runViteBuild()
  const bundles = readBundleMetrics()

  if (prepareBrowser) {
    console.log(JSON.stringify({
      status: 'ok',
      name: 'license-runtime-smoke',
      scope: 'LIC-107B2-browser-manual-preparation',
      fixedTime,
      minimumVersionsVerified: {
        node: false,
        browsers: false
      },
      install: {
        source: 'local-tarball',
        workspaceAlias: false,
        resolvedLicenseEntry,
        projectDir,
        packPath,
        packSha256
      },
      node: nodeResult,
      packageManager: {
        name: 'pnpm',
        version: pnpmVersion
      },
      browserPreparation: {
        distDir: join(projectDir, 'dist'),
        previewCommand: `pnpm --dir ${projectDir} exec vite preview --host 0.0.0.0 --port 4173 --strictPort`,
        manualVerificationRequired: true
      },
      dependencyTree,
      bundles
    }, null, 2))
  } else {
    const browsers = await runBrowserSmoke()

    console.log(JSON.stringify({
      status: 'ok',
      name: 'license-runtime-smoke',
      scope: 'LIC-107B1',
      fixedTime,
      install: {
        source: 'local-tarball',
        workspaceAlias: false,
        resolvedLicenseEntry,
        projectDir,
        packPath,
        packSha256
      },
      node: nodeResult,
      packageManager: {
        name: 'pnpm',
        version: pnpmVersion
      },
      browsers: {
        playwrightVersion: readRootDevDependencyVersion('@playwright/test'),
        currentVersionsOnly: true,
        minimumVersionsVerified: false,
        results: browsers
      },
      dedicatedWorker: {
        type: 'module',
        transfer: 'postMessage',
        reactivation: true,
        tamperedTokenRejected: true
      },
      dependencyTree,
      bundles
    }, null, 2))
  }
}
