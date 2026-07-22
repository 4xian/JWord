/**
 * 职责：验证第三方安装仅解析一个 License runtime，并锁定重复 runtime 的 WeakMap 身份隔离。
 * 边界：只消费正式包根入口，不修改生产 trust、公开 API 或商业调用方授权模型。
 * 协作模块：许可证、格式包、协作包及基础包发布产物。
 * 约束：复用 production golden token 和固定时间，不生成签名、私钥、测试 trust 或新 token。
 * 实现说明：分别覆盖 pnpm/npm 正常安装，并用两个独立 npm 安装验证跨 runtime fail closed。
 */

import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const rootPackageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const licensePackageName = '@4xian/jword-license'
const consumerPackageNames = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-collab',
  '@4xian/jword-collab-server'
]
const browserConsumerPackageNames = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-collab'
]
const workspacePackages = [
  { name: '@4xian/jword-core', directory: 'packages/core' },
  { name: licensePackageName, directory: 'packages/license' },
  { name: '@4xian/jword-persistence', directory: 'packages/persistence' },
  { name: '@4xian/jword-docx', directory: 'packages/docx' },
  { name: '@4xian/jword-pdf', directory: 'packages/pdf' },
  { name: '@4xian/jword-collab', directory: 'packages/collab' },
  { name: '@4xian/jword-collab-server', directory: 'packages/collab-server' }
]
const fixedNow = Date.parse('2026-01-15T00:00:00.000Z')
const smokeMode = readSmokeMode(process.argv.slice(2))
let currentStage = 'initialize'
let probeSequence = 0

/** 读取并校验运行模式；无参数继续执行既有 Node-only 路径。 */
function readSmokeMode(arguments_) {
  if (arguments_.length === 0) {
    return 'node'
  }

  if (arguments_.length === 1 && arguments_[0] === '--browser') {
    return 'browser'
  }

  throw new Error('unsupported runtime identity smoke arguments')
}

/** 断言 smoke 条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

/** 执行子进程并静默返回标准输出，避免泄漏临时路径或授权材料。 */
function readCommand(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options
  }).trim()
}

/** 从现有 License 测试读取 production golden token，不维护第二份签发材料。 */
function readProductionGoldenToken() {
  const sourcePath = join(repoRoot, 'packages/license/test/jwl2.test.ts')
  const source = readFileSync(sourcePath, 'utf8')
  const token = source.match(/const PRODUCTION_GOLDEN_TOKEN = '([^']+)'/u)?.[1]

  assert(token?.startsWith('JWL2.') === true, 'production golden token unavailable')

  return token
}

/** 读取根项目锁定的精确开发依赖版本。 */
function readRootDevDependencyVersion(packageName) {
  const version = rootPackageJson.devDependencies?.[packageName]

  assert(
    typeof version === 'string' && !version.startsWith('^') && !version.startsWith('~'),
    `${packageName} exact development version unavailable`
  )

  return version
}

/** 打包本门禁需要的 workspace 包，并返回包名到 tarball 的映射。 */
function packWorkspacePackages(packDirectory, licenseVersion) {
  mkdirSync(packDirectory, { recursive: true })
  const packs = {}

  for (const workspacePackage of workspacePackages) {
    currentStage = `pack:${workspacePackage.name}`
    const packageDirectory = join(repoRoot, workspacePackage.directory)
    const before = new Set(readPackFiles(packDirectory))

    assert(
      existsSync(join(packageDirectory, 'dist/index.js')),
      `${workspacePackage.name} dist unavailable`
    )
    readCommand('pnpm', ['pack', '--pack-destination', packDirectory], {
      cwd: packageDirectory
    })

    const created = readPackFiles(packDirectory).find((file) => !before.has(file))
    assert(created !== undefined, `${workspacePackage.name} pack unavailable`)

    const packPath = join(packDirectory, created)
    const packedManifest = readPackedManifest(packPath)

    assert(packedManifest.name === workspacePackage.name, `${workspacePackage.name} pack name invalid`)
    assert(!JSON.stringify(packedManifest).includes('workspace:'), `${workspacePackage.name} workspace alias retained`)

    if (consumerPackageNames.includes(workspacePackage.name)) {
      assertConsumerPackedManifest(packedManifest, licenseVersion)
    }

    packs[workspacePackage.name] = packPath
  }

  return packs
}

/** 读取 pack 目录中已生成的 tarball 文件。 */
function readPackFiles(packDirectory) {
  return readdirSync(packDirectory)
    .filter((file) => file.endsWith('.tgz'))
    .sort()
}

/** 从 tarball 读取发布时的 package manifest。 */
function readPackedManifest(packPath) {
  return JSON.parse(readCommand('tar', ['-xOf', packPath, 'package/package.json']))
}

/** 校验消费包发布后由宿主提供当前版本的唯一 License peer。 */
function assertConsumerPackedManifest(manifest, licenseVersion) {
  assert(manifest.dependencies?.[licensePackageName] === undefined, `${manifest.name} License dependency retained`)
  assert(manifest.peerDependencies?.[licensePackageName] === licenseVersion, `${manifest.name} License peer invalid`)
  assert(manifest.peerDependenciesMeta?.[licensePackageName] === undefined, `${manifest.name} License peer optional`)
}

/** 写入并安装正常第三方空项目。 */
function installConsumerProject(packageManager, projectDirectory, packs, browserMode = false) {
  mkdirSync(projectDirectory, { recursive: true })
  const dependencies = Object.fromEntries(workspacePackages.map(({ name }) => [
    name,
    `file:${packs[name]}`
  ]))
  const packageJson = {
    name: `jword-license-identity-${packageManager}`,
    private: true,
    type: 'module',
    dependencies,
    ...(browserMode
      ? {
          devDependencies: {
            '@playwright/test': readRootDevDependencyVersion('@playwright/test'),
            vite: readRootDevDependencyVersion('vite')
          }
        }
      : {}),
    ...(packageManager === 'pnpm'
      ? {
          pnpm: {
            overrides: {
              '@4xian/jword-core': `file:${packs['@4xian/jword-core']}`,
              '@4xian/jword-persistence': `file:${packs['@4xian/jword-persistence']}`
            }
          }
        }
      : {})
  }

  writeFileSync(join(projectDirectory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
  currentStage = `install:${packageManager}`

  if (packageManager === 'pnpm') {
    readCommand('pnpm', ['install', '--ignore-scripts', '--reporter=silent'], {
      cwd: projectDirectory
    })
    return
  }

  readCommand('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: projectDirectory
  })
}

/** 从指定 ESM 文件位置解析并实际导入 License 根入口。 */
function resolveLicenseFrom(directory) {
  const probePath = join(directory, `.jword-license-identity-probe-${String(probeSequence += 1)}.mjs`)
  const source = [
    `const resolved = import.meta.resolve(${JSON.stringify(licensePackageName)})`,
    'await import(resolved)',
    'process.stdout.write(resolved)'
  ].join('\n')

  writeFileSync(probePath, `${source}\n`)
  try {
    return realpathSync(fileURLToPath(readCommand(process.execPath, [probePath], {
      cwd: directory
    })))
  } finally {
    rmSync(probePath, { force: true })
  }
}

/** 从项目根入口定位已安装消费包的物理目录。 */
function readInstalledPackageDirectory(projectDirectory, packageName) {
  const probePath = join(projectDirectory, `.jword-package-probe-${String(probeSequence += 1)}.mjs`)
  writeFileSync(
    probePath,
    `process.stdout.write(import.meta.resolve(${JSON.stringify(packageName)}))\n`
  )

  try {
    const entryPath = fileURLToPath(readCommand(process.execPath, [probePath], {
      cwd: projectDirectory
    }))

    return findPackageDirectory(entryPath, packageName)
  } finally {
    rmSync(probePath, { force: true })
  }
}

/** 从临时消费项目读取实际安装的 package 版本。 */
function readInstalledPackageVersion(projectDirectory, packageName) {
  const packageDirectory = readInstalledPackageDirectory(projectDirectory, packageName)
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))

  assert(typeof manifest.version === 'string' && manifest.version !== '', `${packageName} version unavailable`)

  return manifest.version
}

/** 从包入口向上查找对应 package.json 目录。 */
function findPackageDirectory(entryPath, packageName) {
  let directory = dirname(entryPath)

  while (directory !== dirname(directory)) {
    const manifestPath = join(directory, 'package.json')

    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      if (manifest.name === packageName) {
        return directory
      }
    }

    directory = dirname(directory)
  }

  throw new Error(`${packageName} package directory unavailable`)
}

/** 验证宿主和四个消费包上下文只解析一个物理 License runtime。 */
function verifySingleRuntime(packageManager, projectDirectory, licenseVersion) {
  currentStage = `identity:${packageManager}`
  const resolvedEntries = [resolveLicenseFrom(projectDirectory)]

  for (const packageName of consumerPackageNames) {
    const packageDirectory = readInstalledPackageDirectory(projectDirectory, packageName)
    resolvedEntries.push(resolveLicenseFrom(packageDirectory))
  }

  const realProjectDirectory = realpathSync(projectDirectory)
  for (const resolvedEntry of resolvedEntries) {
    assert(
      resolvedEntry.startsWith(`${realProjectDirectory}${sep}`),
      `${packageManager} License resolved outside temporary project`
    )
  }

  const realpathCount = new Set(resolvedEntries).size
  assert(realpathCount === 1, `${packageManager} resolved duplicate License runtimes`)
  assertInstalledTree(packageManager, projectDirectory)

  return {
    packageManager,
    packageManagerVersion: readCommand(packageManager, ['--version']),
    licenseVersion,
    runtimeRealpathCount: realpathCount,
    status: 'ok'
  }
}

/** 要求包管理器依赖树认可宿主提供的 License peer。 */
function assertInstalledTree(packageManager, projectDirectory) {
  const arguments_ = packageManager === 'pnpm'
    ? ['list', licensePackageName, '--depth', 'Infinity', '--json']
    : ['ls', licensePackageName, '--all', '--json']
  const tree = JSON.parse(readCommand(packageManager, arguments_, {
    cwd: projectDirectory
  }))

  assert(tree !== null, `${packageManager} License tree unavailable`)
}

/** 在独立空项目中安装单个 License tarball。 */
function installIndependentLicense(projectDirectory, licensePackPath) {
  mkdirSync(projectDirectory, { recursive: true })
  writeFileSync(join(projectDirectory, 'package.json'), `${JSON.stringify({
    name: `jword-independent-license-${basename(projectDirectory)}`,
    private: true,
    type: 'module',
    dependencies: {
      [licensePackageName]: `file:${licensePackPath}`
    }
  }, null, 2)}\n`)
  readCommand('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: projectDirectory
  })
}

/** 验证两个物理 License runtime 不能共享 opaque handle identity。 */
async function verifyDuplicateRuntime(workspaceDirectory, licensePackPath, token) {
  currentStage = 'duplicate-runtime:install'
  const runtimeADirectory = join(workspaceDirectory, 'runtime-a')
  const runtimeBDirectory = join(workspaceDirectory, 'runtime-b')

  installIndependentLicense(runtimeADirectory, licensePackPath)
  installIndependentLicense(runtimeBDirectory, licensePackPath)

  const entryA = resolveLicenseFrom(runtimeADirectory)
  const entryB = resolveLicenseFrom(runtimeBDirectory)
  assert(entryA !== entryB, 'independent License runtimes collapsed')

  currentStage = 'duplicate-runtime:identity'
  const runtimeA = await import(pathToFileURL(entryA).href)
  const runtimeB = await import(pathToFileURL(entryB).href)
  const originalDateNow = Date.now

  Date.now = () => fixedNow
  try {
    const feature = runtimeA.JWORD_FEATURES.formats
    const handleA = runtimeA.activateJWordLicense(token)

    assert(runtimeA.isJWordFeatureLicensed(handleA, feature), 'runtime A rejected local handle')
    assert(!runtimeB.isJWordFeatureLicensed(handleA, feature), 'runtime B accepted runtime A handle')
    assertErrorCode(
      () => runtimeB.assertJWordFeatureLicensed(handleA, feature),
      'JWORD_LICENSE_HANDLE_INVALID'
    )
    assertErrorCode(
      () => runtimeB.createJWordLicenseTransfer(handleA),
      'JWORD_LICENSE_HANDLE_INVALID'
    )

    const invalidHandles = [
      { licenseId: handleA.licenseId, expiresAt: handleA.expiresAt },
      { ...handleA },
      structuredClone(handleA)
    ]
    for (const invalidHandle of invalidHandles) {
      for (const runtime of [runtimeA, runtimeB]) {
        assert(!runtime.isJWordFeatureLicensed(invalidHandle, feature), 'License runtime accepted forged handle')
        assertErrorCode(
          () => runtime.assertJWordFeatureLicensed(invalidHandle, feature),
          'JWORD_LICENSE_HANDLE_INVALID'
        )
        assertErrorCode(
          () => runtime.createJWordLicenseTransfer(invalidHandle),
          'JWORD_LICENSE_HANDLE_INVALID'
        )
      }
    }

    const transfer = runtimeA.createJWordLicenseTransfer(handleA)
    assert(
      Object.keys(transfer).length === 1 && Object.keys(transfer)[0] === 'token',
      'License transfer contains unexpected fields'
    )
    const handleB = runtimeB.activateJWordLicense(transfer.token)

    assert(runtimeB.isJWordFeatureLicensed(handleB, feature), 'runtime B rejected reactivated handle')
    assert(!runtimeA.isJWordFeatureLicensed(handleB, feature), 'runtime A accepted runtime B handle')
    assertErrorCode(
      () => runtimeA.createJWordLicenseTransfer(handleB),
      'JWORD_LICENSE_HANDLE_INVALID'
    )
  } finally {
    Date.now = originalDateNow
  }

  return {
    runtimeRealpathCount: 2,
    localHandleAccepted: true,
    crossRuntimeRejected: true,
    forgedHandlesRejected: true,
    transferTokenOnly: true,
    reactivationCreatesLocalHandle: true,
    status: 'ok'
  }
}

/** 断言公开 API 抛出指定稳定诊断 code。 */
function assertErrorCode(action, expectedCode) {
  let actualCode

  try {
    action()
  } catch (error) {
    actualCode = error?.code
  }

  assert(actualCode === expectedCode, 'unexpected License diagnostic code')
}

/** 写入 Vite ES2022 与三浏览器临时消费项目。 */
function writeBrowserProject(projectDirectory, token) {
  mkdirSync(join(projectDirectory, 'src'), { recursive: true })
  writeFileSync(join(projectDirectory, 'index.html'), browserIndexHtmlSource)
  writeFileSync(
    join(projectDirectory, 'src/main.js'),
    createBrowserMainSource(token)
  )
  writeFileSync(join(projectDirectory, 'vite.config.mjs'), viteConfigSource)
  writeFileSync(join(projectDirectory, 'playwright.config.mjs'), playwrightConfigSource)
  writeFileSync(join(projectDirectory, 'browser-smoke.spec.mjs'), browserSmokeSpecSource)
}

/** 生成只通过正式包入口运行的浏览器入口。 */
function createBrowserMainSource(token) {
  return String.raw`const [license, docx, pdf, collab] = await Promise.all([
  import('@4xian/jword-license'),
  import('@4xian/jword-docx'),
  import('@4xian/jword-pdf'),
  import('@4xian/jword-collab')
])

const PRODUCTION_GOLDEN_TOKEN = ${JSON.stringify(token)}
const FIXED_NOW = ${String(fixedNow)}
Date.now = () => FIXED_NOW

const root = document.querySelector('#root')
if (!(root instanceof HTMLDivElement)) {
  throw new Error('Missing runtime identity smoke root.')
}

try {
  const consumers = {
    docx: typeof docx.importDocx === 'function',
    pdf: typeof pdf.exportPdfFromLayout === 'function',
    collab: typeof collab.connectJWordCollaboration === 'function'
  }
  assert(Object.values(consumers).every(Boolean), 'Browser consumer namespace is incomplete.')

  const handle = license.activateJWordLicense(PRODUCTION_GOLDEN_TOKEN)
  const formats = license.isJWordFeatureLicensed(handle, license.JWORD_FEATURES.formats)
  assert(formats, 'Browser formats feature must be licensed.')

  const result = {
    consumers,
    activation: true,
    formats
  }
  root.dataset.status = 'ok'
  root.dataset.result = JSON.stringify(result)
  root.textContent = 'ok'
} catch (error) {
  root.dataset.status = 'error'
  root.textContent = error instanceof Error ? error.message : String(error)
  throw error
}

/** 断言浏览器临时项目条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
`
}

/** 运行 Vite 构建并读取 build-only plugin 生成的 module graph。 */
function runBrowserBuild(projectDirectory) {
  currentStage = 'browser:vite-build'
  readCommand('pnpm', ['exec', 'vite', 'build'], {
    cwd: projectDirectory
  })

  const reportPath = join(projectDirectory, 'vite-module-graph.json')
  assert(existsSync(reportPath), 'Vite module graph report unavailable')

  return JSON.parse(readFileSync(reportPath, 'utf8'))
}

/** 从临时项目上下文解析指定包的 canonical 入口。 */
function resolvePackageEntryFrom(projectDirectory, packageName) {
  const probePath = join(projectDirectory, `.jword-browser-entry-${String(probeSequence += 1)}.mjs`)
  writeFileSync(
    probePath,
    `process.stdout.write(import.meta.resolve(${JSON.stringify(packageName)}))\n`
  )

  try {
    return realpathSync(fileURLToPath(readCommand(process.execPath, [probePath], {
      cwd: projectDirectory
    })))
  } finally {
    rmSync(probePath, { force: true })
  }
}

/** 校验 Vite graph 命中三个浏览器消费包且只包含一个 License runtime。 */
function verifyBrowserModuleGraph(projectDirectory, graphReport) {
  currentStage = 'browser:module-graph'
  const canonicalModuleIds = [...new Set(graphReport.canonicalModuleIds ?? [])]
  const realProjectDirectory = realpathSync(projectDirectory)
  const realRepoRoot = realpathSync(repoRoot)
  const consumerEntries = browserConsumerPackageNames.map((packageName) => ({
    packageName,
    entry: resolvePackageEntryFrom(projectDirectory, packageName)
  }))

  for (const consumer of consumerEntries) {
    assert(
      canonicalModuleIds.includes(consumer.entry),
      `${consumer.packageName} missing from Vite module graph`
    )
  }

  const licenseEntry = resolvePackageEntryFrom(projectDirectory, licensePackageName)
  const licenseDirectory = realpathSync(readInstalledPackageDirectory(
    projectDirectory,
    licensePackageName
  ))
  const licenseModules = canonicalModuleIds.filter((moduleId) => (
    moduleId === licenseEntry || moduleId.startsWith(`${licenseDirectory}${sep}`)
  ))

  assert(licenseModules.length === 1, 'Vite resolved duplicate License runtime modules')
  assert(
    licenseEntry.startsWith(`${realProjectDirectory}${sep}`),
    'Vite License runtime resolved outside temporary project'
  )
  assert(
    !licenseEntry.startsWith(`${realRepoRoot}${sep}`),
    'Vite License runtime resolved through monorepo'
  )

  const collabServerDirectory = realpathSync(readInstalledPackageDirectory(
    projectDirectory,
    '@4xian/jword-collab-server'
  ))
  assert(
    !canonicalModuleIds.some((moduleId) => moduleId.startsWith(`${collabServerDirectory}${sep}`)),
    'Collab Server entered browser module graph'
  )

  return {
    target: 'es2022',
    moduleCount: canonicalModuleIds.length,
    consumerEntryCount: consumerEntries.length,
    consumers: consumerEntries.map(({ packageName }) => ({
      packageName,
      status: 'present'
    })),
    licenseCanonicalModuleCount: licenseModules.length,
    collabServerModuleCount: 0,
    status: 'ok'
  }
}

/** 获取三浏览器临时 Vite preview 使用的可用端口。 */
async function findAvailablePort() {
  const server = createServer()

  return await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()

      if (address === null || typeof address === 'string') {
        server.close()
        reject(new Error('browser preview port unavailable'))
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

/** 在当前 Playwright Chromium、Firefox 与 WebKit 中运行页面验证。 */
async function runCurrentBrowserSmoke(projectDirectory) {
  currentStage = 'browser:playwright'
  const port = await findAvailablePort()

  readCommand('pnpm', ['exec', 'playwright', 'test', '--config', 'playwright.config.mjs'], {
    cwd: projectDirectory,
    env: {
      ...process.env,
      JWORD_LICENSE_IDENTITY_PORT: String(port)
    }
  })

  return ['chromium', 'firefox', 'webkit'].map((project) => {
    const resultPath = join(projectDirectory, `browser-result-${project}.json`)
    assert(existsSync(resultPath), `${project} browser result unavailable`)

    const result = JSON.parse(readFileSync(resultPath, 'utf8'))
    assert(result.status === 'ok', `${project} browser identity failed`)

    return result
  })
}

/** 读取浏览器消费图中各 JWord package 的实际发布版本。 */
function readBrowserPackageVersions(packs) {
  return [licensePackageName, ...browserConsumerPackageNames].map((packageName) => ({
    packageName,
    version: readPackedManifest(packs[packageName]).version
  }))
}

const browserIndexHtmlSource = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>JWord License runtime identity smoke</title>
  </head>
  <body>
    <div id="root" data-status="booting">booting</div>
    <script type="module" src="/src/main.js"></script>
  </body>
</html>
`

const viteConfigSource = String.raw`import { existsSync, realpathSync, writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'

/** 收集最终 chunk 中的 canonical 文件模块，供外层 smoke 校验单一 runtime。 */
function collectModuleGraph() {
  return {
    name: 'jword-license-identity-module-graph',
    apply: 'build',
    /** 生成最终 bundle 时收集实际进入 chunk 的 canonical 文件模块。 */
    generateBundle(_options, bundle) {
      const canonicalModuleIds = new Set()

      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') {
          continue
        }

        for (const moduleId of Object.keys(output.modules)) {
          const filePath = moduleId.replace(/^\\0/u, '').split('?')[0]
          if (existsSync(filePath)) {
            canonicalModuleIds.add(realpathSync(filePath))
          }
        }
      }

      writeFileSync(
        'vite-module-graph.json',
        JSON.stringify({ canonicalModuleIds: [...canonicalModuleIds].sort() })
      )
    }
  }
}

export default defineConfig({
  plugins: [collectModuleGraph()],
  build: {
    target: 'es2022'
  }
})
`

const playwrightConfigSource = String.raw`import { defineConfig, devices } from '@playwright/test'

const port = Number.parseInt(process.env.JWORD_LICENSE_IDENTITY_PORT ?? '', 10)
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error('JWORD_LICENSE_IDENTITY_PORT must be a valid TCP port.')
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
    { name: 'chromium', use: { ...devices['Desktop Chrome'], baseURL } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], baseURL } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], baseURL } }
  ]
})
`

const browserSmokeSpecSource = String.raw`import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'

test('loads browser consumers through one License runtime', async ({ browser, page }, testInfo) => {
  await page.goto('/')
  const root = page.locator('#root')

  await expect(root).toHaveAttribute('data-status', 'ok')
  const serializedResult = await root.getAttribute('data-result')
  expect(serializedResult).not.toBeNull()

  const result = JSON.parse(serializedResult)
  expect(result).toEqual({
    consumers: {
      docx: true,
      pdf: true,
      collab: true
    },
    activation: true,
    formats: true
  })

  writeFileSync(
    join(process.cwd(), 'browser-result-' + testInfo.project.name + '.json'),
    JSON.stringify({
      browserName: testInfo.project.name,
      browserVersion: browser.version(),
      consumerCount: 3,
      status: 'ok'
    })
  )
})
`

/** 执行本批 Node 运行时身份验证。 */
async function main() {
  const workspaceDirectory = mkdtempSync(join(tmpdir(), 'jword-license-identity-'))

  try {
    const licenseManifest = JSON.parse(readFileSync(
      join(repoRoot, 'packages/license/package.json'),
      'utf8'
    ))
    const licenseVersion = licenseManifest.version

    assert(typeof licenseVersion === 'string' && licenseVersion !== '', 'License version unavailable')

    const token = readProductionGoldenToken()
    const packs = packWorkspacePackages(
      join(workspaceDirectory, 'packs'),
      licenseVersion
    )
    const installResults = []
    let pnpmProjectDirectory

    for (const packageManager of ['pnpm', 'npm']) {
      const projectDirectory = join(workspaceDirectory, `${packageManager}-project`)
      installConsumerProject(
        packageManager,
        projectDirectory,
        packs,
        smokeMode === 'browser' && packageManager === 'pnpm'
      )
      installResults.push(verifySingleRuntime(packageManager, projectDirectory, licenseVersion))
      if (packageManager === 'pnpm') {
        pnpmProjectDirectory = projectDirectory
      }
    }

    const duplicateRuntime = await verifyDuplicateRuntime(
      workspaceDirectory,
      packs[licensePackageName],
      token
    )

    if (smokeMode === 'browser') {
      assert(pnpmProjectDirectory !== undefined, 'pnpm browser project unavailable')
      writeBrowserProject(pnpmProjectDirectory, token)
      const graphReport = runBrowserBuild(pnpmProjectDirectory)
      const moduleGraph = verifyBrowserModuleGraph(pnpmProjectDirectory, graphReport)
      const browserResults = await runCurrentBrowserSmoke(pnpmProjectDirectory)

      return {
        status: 'ok',
        name: 'license-runtime-identity-smoke',
        mode: 'browser',
        packages: readBrowserPackageVersions(packs),
        bundler: {
          packageName: 'vite',
          version: readInstalledPackageVersion(pnpmProjectDirectory, 'vite'),
          status: 'ok'
        },
        moduleGraph,
        browsers: {
          packageName: '@playwright/test',
          version: readRootDevDependencyVersion('@playwright/test'),
          currentVersionsOnly: true,
          minimumVersionsVerified: false,
          results: browserResults,
          status: 'ok'
        }
      }
    }

    return {
      status: 'ok',
      name: 'license-runtime-identity-smoke',
      licenseVersion,
      installs: installResults,
      duplicateRuntime
    }
  } finally {
    rmSync(workspaceDirectory, { force: true, recursive: true })
  }
}

try {
  const report = await main()
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
} catch {
  process.stderr.write(`${JSON.stringify({
    status: 'error',
    name: 'license-runtime-identity-smoke',
    stage: currentStage
  })}\n`)
  process.exitCode = 1
}
