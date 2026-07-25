/**
 * 职责：生成 Phase 3 空项目的 Node、browser、wrapper 与 Worker 消费源码。
 * 边界：只返回源码、manifest 和隔离环境数据；除批准的 golden token fixture 外不读取仓库源码。
 * 协作模块：check-phase3-third-party-consumers 与 package artifact contract。
 * 性能/安全约束：源码只引用调用方给出的 package export，不读取仓库源码。
 */

import { cpSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** 把 package/subpath 组合为公开 export specifier。 */
export function createExportSpecifier(packageName, subpath) {
  return subpath === '.' ? packageName : `${packageName}/${subpath.replace(/^\.\//u, '')}`
}

/** 生成逐 export 执行的 Node ESM probe。 */
export function createNodeProbeSource(targets) {
  const imports = targets.map(function createRuntimeImport(target) {
    return `await import(${JSON.stringify(createExportSpecifier(target.package, target.subpath))})`
  })

  return `${imports.join('\n')}\n`
}

/** 生成逐 export 执行的 TypeScript 类型解析 probe。 */
export function createTypeProbeSource(targets) {
  const imports = targets.map(function createTypeImport(target, index) {
    const specifier = createExportSpecifier(target.package, target.subpath)
    return `import type * as TypeTarget${index} from ${JSON.stringify(specifier)}`
  })

  return `${imports.join('\n')}\n`
}

/** 生成 Vanilla EditorShell、CSS 与全部 browser root export 的真实 mount probe。 */
export function createVanillaProjectSource(targets = []) {
  const browserImports = targets
    .filter(function selectBrowserTarget(target) { return target.environment === 'browser' })
    .filter(function selectDynamicTarget(target) {
      return target.package !== '@4xian/jword-ui' && target.package !== '@4xian/jword-devtools'
    })
    .map(function createBrowserImport(target) {
      return `await import(${JSON.stringify(createExportSpecifier(target.package, target.subpath))})`
    })
    .join('\n')

  return `
import { createJWord } from '@4xian/jword-ui'
import '@4xian/jword-ui/styles.css'
import '@4xian/jword-devtools'
${browserImports}

const host = document.querySelector('#app')
const editor = createJWord({ host })
if (!host.hasAttribute('data-jword-editor-shell')) throw new Error('JWord EditorShell did not mount')
const toolbar = host.querySelector('.jw-toolbar')
if (toolbar === null || getComputedStyle(toolbar).display !== 'flex') throw new Error('JWord CSS was not applied')
document.documentElement.dataset.jwordReady = 'true'
editor.destroy()
`
}

/** 生成 synthetic browser package 的最小真实 mount probe。 */
export function createSyntheticBrowserProjectSource(packageName) {
  return `
import { mount } from ${JSON.stringify(packageName)}

const host = document.querySelector('#app')
mount(host)
document.documentElement.dataset.jwordReady = host.textContent
`
}

/** 生成 React wrapper 的真实 mount/unmount probe。 */
export function createReactProjectSource() {
  return `
import React from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { JWordReactEditor } from '@4xian/jword-react'

const root = createRoot(document.querySelector('#app'))
/** 同步提交真实 React wrapper。 */
flushSync(() => root.render(React.createElement(JWordReactEditor)))
if (document.querySelector('[data-jword-react-host]') === null) throw new Error('React wrapper did not mount')
document.documentElement.dataset.jwordReady = 'react'
root.unmount()
`
}

/** 生成 Vue wrapper 的真实 mount/unmount probe。 */
export function createVueProjectSource() {
  return `
import { createApp, h } from 'vue'
import { JWordVueEditor } from '@4xian/jword-vue'

/** 渲染真实 Vue wrapper。 */
const app = createApp({ render: () => h(JWordVueEditor) })
app.mount('#app')
await Promise.resolve()
if (document.querySelector('[data-jword-vue-host]') === null) throw new Error('Vue wrapper did not mount')
document.documentElement.dataset.jwordReady = 'vue'
app.unmount()
`
}

/** 生成 native/docx/pdf module Worker 入口 probe。 */
export function createWorkerProjectSource() {
  return `
const workers = [
  new Worker(new URL('@4xian/jword-native/worker', import.meta.url), { type: 'module' }),
  new Worker(new URL('@4xian/jword-docx/worker', import.meta.url), { type: 'module' }),
  new Worker(new URL('@4xian/jword-pdf/worker', import.meta.url), { type: 'module' })
]
for (const worker of workers) worker.terminate()
`
}

/** 生成在浏览器中实际装载并终止 module Worker 的 probe。 */
export function createDedicatedWorkerProjectSource(targets) {
  const workers = targets.map(function createWorker(target) {
    const specifier = createExportSpecifier(target.package, target.subpath)
    return `new Worker(new URL(${JSON.stringify(specifier)}, import.meta.url), { type: 'module' })`
  })

  return `
const workers = [${workers.join(', ')}]
/** 等待所有 module Worker 完成首次装载。 */
await new Promise((resolve, reject) => {
  const timeout = setTimeout(resolve, 250)
  for (const worker of workers) worker.addEventListener('error', reject, { once: true })
})
for (const worker of workers) worker.terminate()
document.documentElement.dataset.jwordReady = 'worker'
`
}

/** 生成显式绑定公开 native worker runtime 的辅助入口。 */
export function createNativeWorkerProjectSource() {
  return `
import { bindJWordNativeWorkerRuntime } from '@4xian/jword-native/worker'
bindJWordNativeWorkerRuntime(globalThis)
`
}

/** 生成 native/DOCX/PDF 根入口与 module Worker 的安全取消 probe。 */
export function createFormatWorkerProjectSource(targets = []) {
  const rootImports = targets
    .filter(function selectRootTarget(target) { return target.environment === 'browser' && target.subpath === '.' })
    .map(function createRootImport(target) {
      return `await import(${JSON.stringify(createExportSpecifier(target.package, target.subpath))})`
    })
    .join('\n')

  return `
${rootImports}
  const workerCases = [
  {
    worker: new Worker(new URL('./native-worker.js', import.meta.url), { type: 'module' }),
    request: { type: 'cancel', requestId: 'phase3-native-cancel' }
  },
  {
    worker: new Worker(new URL('@4xian/jword-docx/worker', import.meta.url), { type: 'module' }),
    request: { type: 'cancel', requestId: 'phase3-docx-cancel' }
  },
  {
    worker: new Worker(new URL('@4xian/jword-pdf/worker', import.meta.url), { type: 'module' }),
    request: { kind: 'cancel', requestId: 'phase3-pdf-cancel', options: {} }
  }
]
for (const workerCase of workerCases) {
  /** 等待 worker 返回同一 requestId 的安全取消响应。 */
  const response = await new Promise((resolve, reject) => {
    /** 拒绝未响应的 worker。 */
    const timeout = setTimeout(function rejectTimeout() { reject(new Error('format worker timed out')) }, 10000)
    /** 接收结构化 worker 响应。 */
    workerCase.worker.addEventListener('message', function readResponse(event) { clearTimeout(timeout); resolve(event.data) }, { once: true })
    workerCase.worker.addEventListener('error', reject, { once: true })
    workerCase.worker.postMessage(workerCase.request)
  })
  workerCase.worker.terminate()
  const responseRequestId = response.requestId ?? response.error?.requestId
  if (responseRequestId !== workerCase.request.requestId) throw new Error('format worker response mismatch')
}
document.documentElement.dataset.jwordReady = 'worker'
`
}

/** 生成 License runtime/identity 的 browser 与 Worker probe。 */
export function createLicenseProjectSource(token = '') {
  return `
import {
  JWORD_FEATURES,
  activateJWordLicense,
  createJWordLicenseTransfer,
  isJWordFeatureLicensed
} from '@4xian/jword-license'
import '@4xian/jword-persistence'
import '@4xian/jword-collab'
import '@4xian/jword-collab/experimental'

Date.now = () => Date.parse('2026-01-15T00:00:00.000Z')
${token === '' ? '' : `const license = activateJWordLicense(${JSON.stringify(token)})
if (!isJWordFeatureLicensed(license, JWORD_FEATURES.formats)) throw new Error('License formats feature is not licensed')
const transfer = createJWordLicenseTransfer(license)
const worker = new Worker(new URL('./license-worker.js', import.meta.url), { type: 'module' })
/** 等待 Dedicated Worker 重新激活 transfer。 */
const workerResult = await new Promise((resolve, reject) => {
  /** 接收 Worker 的结构化结果。 */
  worker.addEventListener('message', (event) => resolve(event.data), { once: true })
  worker.addEventListener('error', reject, { once: true })
  worker.postMessage(transfer)
})
worker.terminate()
if (workerResult.status !== 'ok' || !workerResult.formats) throw new Error('License worker activation failed')`}
globalThis.__JWORD_LICENSE_PROBE__ = true
document.documentElement.dataset.jwordReady = 'license'
`
}

/** 生成 License Dedicated Worker 的 transfer 重新激活 probe。 */
export function createLicenseWorkerProjectSource() {
  return `
import { JWORD_FEATURES, activateJWordLicense, isJWordFeatureLicensed } from '@4xian/jword-license'
Date.now = () => Date.parse('2026-01-15T00:00:00.000Z')
/** 接收主线程传入的最小 transfer。 */
self.addEventListener('message', (event) => {
  const license = activateJWordLicense(event.data.token)
  self.postMessage({ status: 'ok', formats: isJWordFeatureLicensed(license, JWORD_FEATURES.formats) })
}, { once: true })
`
}

/** 生成 License Node golden token 与双 runtime identity probe。 */
export function createLicenseNodeProjectSource(targets) {
  return `${createNodeProbeSource(targets)}
const [runtimeA, runtimeB] = await Promise.all([import(process.argv[2]), import(process.argv[3])])
/** 固定 production golden token 的验收时间。 */
Date.now = () => Date.parse('2026-01-15T00:00:00.000Z')
const token = process.env.JWORD_PHASE3_LICENSE_TOKEN
if (!token?.startsWith('JWL2.')) throw new Error('production golden token is unavailable')
const handleA = runtimeA.activateJWordLicense(token)
const feature = runtimeA.JWORD_FEATURES.formats
if (!runtimeA.isJWordFeatureLicensed(handleA, feature)) throw new Error('License runtime A rejected its handle')
if (runtimeB.isJWordFeatureLicensed(handleA, feature)) throw new Error('License runtime B accepted runtime A handle')
let rejected = false
try { runtimeB.assertJWordFeatureLicensed(handleA, feature) } catch (error) { rejected = error?.code === 'JWORD_LICENSE_HANDLE_INVALID' }
if (!rejected) throw new Error('duplicate License runtime did not fail closed')
const transfer = runtimeA.createJWordLicenseTransfer(handleA)
const handleB = runtimeB.activateJWordLicense(transfer.token)
if (!runtimeB.isJWordFeatureLicensed(handleB, feature)) throw new Error('License transfer reactivation failed')
`
}

/** 生成每个 journey/runtime 实际执行的 source inventory。 */
export function createConsumerSourceInventory(contract, productionToken = '') {
  const sources = {}

  for (const journey of contract.journeys) {
    for (const runtime of journey.runtimes) {
      const targets = journey.targets.filter(function selectRuntimeTarget(target) {
        return target.runtime === runtime
      })
      const source = runtime === 'types'
        ? createTypeProbeSource(targets)
        : runtime === 'vite-browser'
          ? createBrowserSourceForJourney(journey, runtime, productionToken)
          : runtime === 'node' && journey.id === 'license-runtime-identity'
            ? createLicenseNodeProjectSource(targets)
            : runtime === 'dedicated-worker'
            ? journey.id === 'license-runtime-identity'
              ? createLicenseProjectSource(productionToken)
              : journey.runtimes.includes('vite-browser')
                ? createBrowserSourceForJourney(journey, runtime, productionToken)
                : createDedicatedWorkerProjectSource(targets)
              : createNodeProbeSource(targets)
      sources[createConsumerSourceId(journey.id, runtime)] = {
        extension: runtime === 'types' ? 'ts' : 'js',
        files: journey.id === 'license-runtime-identity' && ['vite-browser', 'dedicated-worker'].includes(runtime)
          ? { 'license-worker.js': createLicenseWorkerProjectSource() }
          : journey.id === 'module-workers' && runtime === 'vite-browser'
            ? { 'native-worker.js': createNativeWorkerProjectSource() }
            : {},
        source
      }
    }
  }

  return sources
}

/** 创建只列出请求包与精确外部 peer 的空项目 manifest。 */
export function createConsumerProjectManifest(journey, packages, contract) {
  const requestedPackages = new Set(journey.requestedPackages)
  const dependencies = {}
  for (const packageEntry of packages) {
    if (requestedPackages.has(packageEntry.name)) dependencies[packageEntry.name] = packageEntry.version
  }
  const packageContracts = new Map()
  for (const packageEntry of contract.packages) packageContracts.set(packageEntry.name, packageEntry)

  for (const packageName of [...journey.requestedPackages, ...journey.firstPartyClosure]) {
    const externalPeers = packageContracts.get(packageName)?.dependencyPolicy?.externalPeers ?? {}
    for (const [name, version] of Object.entries(externalPeers)) {
      if (dependencies[name] !== undefined && dependencies[name] !== version) {
        throw new Error(`external peer version conflict: ${name}`)
      }
      dependencies[name] = version
    }
  }

  return {
    name: `jword-phase3-${journey.id}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies
  }
}

/** 从请求包开始沿实际依赖解析层读取完整 first-party 闭包。 */
export function readResolvedPackages(projectDirectory, packages, requestedPackageNames, repoRoot) {
  const physicalProjectDirectory = realpathSync(projectDirectory)
  const physicalRepoRoot = realpathSync(repoRoot)
  const packagesByName = new Map()
  for (const packageEntry of packages) packagesByName.set(packageEntry.name, packageEntry)
  const pending = []
  for (const name of requestedPackageNames) {
    pending.push({ name, resolutionRoot: join(projectDirectory, 'node_modules') })
  }
  const resolvedPaths = new Map()

  while (pending.length > 0) {
    const current = pending.shift()
    if (resolvedPaths.has(current.name)) continue
    const packageEntry = packagesByName.get(current.name)
    if (packageEntry === undefined) throw new Error(`consumer package is not served: ${current.name}`)
    const packagePath = realpathSync(join(current.resolutionRoot, ...current.name.split('/')))
    if (!isPathInside(physicalProjectDirectory, packagePath)) {
      throw new Error(`consumer package resolved outside project: ${current.name}`)
    }
    if (isPathInside(physicalRepoRoot, packagePath)) {
      throw new Error(`consumer resolved into repository: ${current.name}`)
    }
    resolvedPaths.set(current.name, packagePath)
    const dependencyRoot = current.name.startsWith('@') ? dirname(dirname(packagePath)) : dirname(packagePath)
    const firstPartyDependencies = {
      ...packageEntry.packedManifest.dependencies,
      ...packageEntry.packedManifest.peerDependencies
    }
    for (const name of Object.keys(firstPartyDependencies)) {
      if (packagesByName.has(name)) pending.push({ name, resolutionRoot: dependencyRoot })
    }
  }

  const resolvedPackages = []
  for (const packageEntry of [...packages].sort(comparePackageEntries)) {
    const packagePath = resolvedPaths.get(packageEntry.name)
    if (packagePath === undefined) throw new Error(`consumer dependency is unresolved: ${packageEntry.name}`)
    resolvedPackages.push({ name: packageEntry.name, version: packageEntry.version, realpath: packagePath })
  }
  return resolvedPackages
}

/** 按 name/version/tarballFile 冻结 package 顺序。 */
function comparePackageEntries(left, right) {
  const leftKey = `${left.name}\0${left.version}\0${left.tarballFile}`
  const rightKey = `${right.name}\0${right.version}\0${right.tarballFile}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}

/** 判断目标是否严格位于给定根目录内。 */
export function isPathInside(root, path) {
  const relativePath = relative(root, path)
  return relativePath !== '' && relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath)
}

/** 从 realpath 读取其统一 consumer install 项目根。 */
export function readInstallProjectRoot(packagePath, installId) {
  const marker = `${sep}${installId}${sep}node_modules${sep}`
  const markerIndex = packagePath.lastIndexOf(marker)
  return markerIndex <= 0 ? undefined : packagePath.slice(0, markerIndex + sep.length + installId.length)
}

/** 选择 browser journey 的真实 wrapper/worker mount source。 */
function createBrowserSourceForJourney(journey, runtime, productionToken) {
  const packageName = journey.requestedPackages[0]
  const runtimeTargets = journey.targets.filter(function selectRuntimeTarget(target) {
    return target.runtime === runtime
  })
  if (runtime === 'dedicated-worker') return createDedicatedWorkerProjectSource(runtimeTargets)
  if (journey.id === 'module-workers') return createFormatWorkerProjectSource(runtimeTargets)
  const source = journey.id === 'synthetic-browser'
    ? createSyntheticBrowserProjectSource(packageName)
    : journey.id === 'react-wrapper'
      ? createReactProjectSource()
      : journey.id === 'vue-wrapper'
        ? createVueProjectSource()
        : journey.id === 'license-runtime-identity'
          ? createLicenseProjectSource(productionToken)
          : createVanillaProjectSource(runtimeTargets)

  return source
}

/** 生成固定 source ID。 */
export function createConsumerSourceId(journeyId, runtime) {
  return `${journeyId}--${runtime}`
}

/** 移除继承环境中的凭据和 package-manager 配置。 */
export function createCleanConsumerEnvironment(environment) {
  return Object.fromEntries(Object.entries(environment).filter(function keepSafeEnvironment([name]) {
    return !/(?:TOKEN|PASSWORD|SECRET|AUTH|CREDENTIAL|PASSFILE)/iu.test(name) &&
      !/^(?:NPM_CONFIG_|npm_config_|PNPM_)/u.test(name)
  }))
}

/** 从既有 production fixture 读取 golden token，不生成签名材料。 */
export function readProductionGoldenToken(repoRoot) {
  const source = readFileSync(join(repoRoot, 'packages/license/test/jwl2.test.ts'), 'utf8')
  const token = source.match(/const PRODUCTION_GOLDEN_TOKEN = '([^']+)'/u)?.[1]
  if (token === undefined || !token.startsWith('JWL2.')) throw new Error('production golden token is unavailable')
  return token
}

/** 读取一个已冻结的 journey/runtime source。 */
export function readConsumerSource(sources, journeyId, runtime) {
  const source = sources[createConsumerSourceId(journeyId, runtime)]
  if (source === undefined) throw new Error(`consumer source missing: ${journeyId}/${runtime}`)
  return source
}

/** 复制第二个物理 License package 并返回两个公开入口 URL。 */
export function prepareLicenseRuntimeEntries(projectDirectory) {
  const packageDirectory = realpathSync(join(projectDirectory, 'node_modules/@4xian/jword-license'))
  const duplicateDirectory = join(dirname(packageDirectory), '.jword-license-runtime-copy')
  cpSync(packageDirectory, duplicateDirectory, { recursive: true })
  const manifest = JSON.parse(readFileSync(join(packageDirectory, 'package.json'), 'utf8'))
  const entry = manifest.exports?.['.']?.import
  if (typeof entry !== 'string') throw new Error('License public import target is unavailable')
  return [pathToFileURL(join(packageDirectory, entry)).href, pathToFileURL(join(duplicateDirectory, entry)).href]
}

/** 移除 CLI 内部附加的 artifactSetId，保持 journey entry 精确 schema。 */
export function stripJourneyArtifactSetId(journey) {
  const { artifactSetId: ignoredArtifactSetId, ...entry } = journey
  void ignoredArtifactSetId
  return entry
}

/** 从实际 browser bundle 文件生成固定顺序的 bundle evidence。 */
export function createConsumerBundleEvidence(installs, artifactSetId) {
  const bundles = installs.flatMap(function readInstallBundles(install) { return install.bundles })
  return { schemaVersion: 1, artifactSetId, bundles: bundles.sort(compareBundleEntries) }
}

/** 冻结 bundle evidence 的 tuple/path 顺序。 */
function compareBundleEntries(left, right) {
  const leftKey = `${left.journey}\0${left.packageManager}\0${left.runtime}\0${left.browser}\0${left.path}`
  const rightKey = `${right.journey}\0${right.packageManager}\0${right.runtime}\0${right.browser}\0${right.path}`
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
}
