/**
 * 职责：执行 Gate 5 商业高级包的 Phase 3 发布边界检查。
 * 边界：source 模式保留 restricted manifest 与 lazy-loading 检查，artifact 模式只读显式 inventory。
 * 协作模块：DOCX、PDF、License package、统一 artifact scanner 和 examples/docx。
 * 约束：不构建、不生成包、不执行打包演练或发布。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const scannerPath = join(repoRoot, 'tools/release/check-package-artifacts.mjs')
const commercialNames = [
  '@4xian/jword-docx',
  '@4xian/jword-license',
  '@4xian/jword-pdf'
]
const advancedSpecifiers = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-license'
]
const runtimeImportFromPattern = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const runtimeBareImportPattern = /^\s*import\s+["']([^"']+)["'];?/gmu
const runtimeDynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/gmu
const input = readScannerInput(process.argv.slice(2))
const scannerReport = runScanner(input.arguments)
const packageReports = scannerReport.packages.filter(isCommercialPackage)
const sourceEvidence = input.mode === 'source' ? verifySourceGate5() : {
  freeBundleForbiddenImports: [],
  exampleDocxLazyRuntimeImports: []
}

if (packageReports.length !== commercialNames.length && input.mode !== 'synthetic-tarball') {
  throw new Error('Gate 5 scanner report is missing a commercial package')
}

console.log(JSON.stringify({
  status: 'ok',
  kind: 'gate5-commercial-package-check',
  mode: input.mode,
  packCommands: 0,
  privateRegistry: {
    required: true,
    publishConfigAccess: 'restricted'
  },
  packages: packageReports,
  ...sourceEvidence
}, null, 2))

/** 把兼容入口参数映射到统一 scanner 的显式模式。 */
function readScannerInput(args) {
  const environmentManifest = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST

  if (args.length === 0 && environmentManifest !== undefined) {
    if (environmentManifest === '') {
      throw new Error('JWORD_PHASE3_ARTIFACT_MANIFEST must not be empty')
    }
    return { mode: 'artifact', arguments: ['--artifact-manifest', environmentManifest] }
  }

  return {
    mode: args.length === 0 ? 'source' : args.includes('--artifact-manifest') ? 'artifact' : 'synthetic-tarball',
    arguments: args.length === 0 ? ['--check-source-manifests'] : args
  }
}

/** 运行统一 scanner 并解析结构化报告。 */
function runScanner(args) {
  return JSON.parse(execFileSync(process.execPath, [scannerPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  }))
}

/** 判断 scanner report 是否属于 Gate 5 package。 */
function isCommercialPackage(report) {
  return commercialNames.includes(report.name)
}

/** 校验 Gate 5 source manifest、免费入口和按需加载边界。 */
function verifySourceGate5() {
  for (const packageName of commercialNames) {
    const manifest = readPackageManifest(packageName)

    if (manifest.private !== true || manifest.publishConfig?.access !== 'restricted') {
      throw new Error(`${packageName}: Gate 5 package must remain private and restricted`)
    }
  }

  const freeBundleForbiddenImports = readStaticPackageImports(join(repoRoot, 'examples/vanilla/src/main.ts'))
    .filter(isAdvancedSpecifier)
  const exampleDocxLazyRuntimeImports = readDynamicPackageImports(join(repoRoot, 'examples/docx/src/main.ts'))
    .filter(isDocxOrPdfSpecifier)
    .sort()

  if (freeBundleForbiddenImports.length > 0) {
    throw new Error('free entry statically imports a Gate 5 package')
  }
  if (exampleDocxLazyRuntimeImports.join(',') !== '@4xian/jword-docx,@4xian/jword-pdf') {
    throw new Error('examples/docx must lazy load DOCX and PDF packages')
  }

  return { freeBundleForbiddenImports, exampleDocxLazyRuntimeImports }
}

/** 按 package name 读取 source manifest。 */
function readPackageManifest(packageName) {
  const directory = packageName.slice('@4xian/jword-'.length)

  return JSON.parse(readFileSync(join(repoRoot, 'packages', directory, 'package.json'), 'utf8'))
}

/** 判断 import 是否属于 Gate 5 高级 package。 */
function isAdvancedSpecifier(specifier) {
  return advancedSpecifiers.includes(specifier)
}

/** 判断动态 import 是否属于 DOCX/PDF。 */
function isDocxOrPdfSpecifier(specifier) {
  return specifier === '@4xian/jword-docx' || specifier === '@4xian/jword-pdf'
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
      : [...readSpecifiers(source, runtimeImportFromPattern), ...readSpecifiers(source, runtimeBareImportPattern)]

    for (const specifier of specifiers) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) {
        packageImports.add(specifier)
      } else if (!dynamicOnly) {
        const resolved = resolveLocalImport(current, specifier)

        if (resolved !== null) {
          pending.push(resolved)
        }
      }
    }
  }

  return [...packageImports].sort()
}

/** 读取正则匹配的 import specifier。 */
function readSpecifiers(source, pattern) {
  return [...source.matchAll(pattern)].map(readSpecifier).filter(Boolean)
}

/** 读取单个正则 match 的 import specifier。 */
function readSpecifier(match) {
  return match[1]
}

/** 解析本地静态 import 文件路径。 */
function resolveLocalImport(fromFile, specifier) {
  const basePath = join(dirname(fromFile), specifier)

  for (const candidate of [basePath, `${basePath}.ts`, `${basePath}.js`, `${basePath}.mjs`, `${basePath}.css`, join(basePath, 'index.ts')]) {
    if (existsSync(candidate)) {
      return normalize(candidate)
    }
  }

  return null
}
