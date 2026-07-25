/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 5 商业授权、第三方集成和发布审计入口。
 * 边界：只检查包图、公开 API、发布检查脚本和基础首屏扫描，不执行 DOCX/PDF 互通。
 * 协作模块：packages/license、packages/docx、packages/pdf、examples/docx、tools/release 和 SDK 文档。
 * 约束：商业能力不能只靠文档声明，必须有可运行检查证明授权和包边界存在。
 * 实现说明：本测试只读取真实代码、脚本和 docs/sdk 当前公开文档，不依赖旧实施计划。
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Gate 5 commercial readiness', () => {
  it('declares the commercial license package and advanced package dependencies', () => {
    const licensePackage = readJson('packages/license/package.json') as PackageJson
    const docxPackage = readJson('packages/docx/package.json') as PackageJson
    const pdfPackage = readJson('packages/pdf/package.json') as PackageJson

    expect(licensePackage).toMatchObject({
      name: '@4xian/jword-license',
      private: true,
      exports: {
        '.': {
          types: './dist/index.d.ts',
          import: './dist/index.js'
        }
      }
    })
    expect(Object.keys(licensePackage.exports ?? {})).toEqual(['.'])
    assertLicensePeerDependency(docxPackage)
    assertLicensePeerDependency(pdfPackage)
  })

  /** 校验 Gate 5 默认入口只读扫描商业 package。 */
  function verifyGate5ArtifactScanner() {
    expect(existsSync('tools/release/check-gate5-commercial-pack.mjs')).toBe(true)

    const execution = runWithPackCommandTrap('tools/release/check-gate5-commercial-pack.mjs')
    const report = JSON.parse(execution.output) as Gate5CommercialPackReport

    expect(report.status).toBe('ok')
    expect(report.mode).toBe(process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined ? 'source' : 'artifact')
    expect(report.packCommands).toBe(0)
    expect(execution.commands).toEqual([])
    expect(report.privateRegistry).toMatchObject({
      required: true,
      publishConfigAccess: 'restricted'
    })
    expect(report.packages.map((item) => item.name)).toEqual([
      '@4xian/jword-docx',
      '@4xian/jword-license',
      '@4xian/jword-pdf'
    ])
    for (const packageReport of report.packages) {
      expect(packageReport.status).toBe('ok')
      if (report.mode === 'source') {
        expect(packageReport.sourceManifest).toMatch(/^packages\/(?:docx|license|pdf)\/package\.json$/u)
      }
    }
    expect(readFileSync('tools/release/check-gate5-commercial-pack.mjs', 'utf8')).toContain('check-package-artifacts.mjs')
    expect(report.freeBundleForbiddenImports).toEqual([])
    expect(report.exampleDocxLazyRuntimeImports).toEqual(report.mode === 'source'
      ? ['@4xian/jword-docx', '@4xian/jword-pdf']
      : [])
  }

  it('provides a release check for private registry, pack contents, export maps and lazy loading', verifyGate5ArtifactScanner)

  it('keeps legacy JWL1 fail closed without exposing production signing capability', () => {
    const publicSource = readEvidenceFiles([
      'packages/license/src/index.ts',
      'packages/license/src/license.ts'
    ])
    const legacySource = readFileSync('packages/license/src/legacy-jwl1.ts', 'utf8')
    const productionSource = readTypeScriptFilesUnder('packages/license/src')
    const productionDist = readPublishedTextFilesUnder('packages/license/dist')
    const jwl2VerifierSource = readFileSync('packages/license/src/verify-jwl2.ts', 'utf8')
    const issueScript = readFileSync('tools/license/issue-license.mjs', 'utf8')

    expect(existsSync('tools/license/issue-license.mjs')).toBe(true)
    expect(legacySource).toContain("const JWORD_LICENSE_TOKEN_VERSION = 'JWL1'")
    expect(legacySource).not.toContain('verifyEd25519')
    expect(legacySource).toContain(
      'if (token.startsWith(`${JWORD_LICENSE_TOKEN_VERSION}.`)) {\n    return { ok: false }\n  }'
    )
    expect(jwl2VerifierSource).toContain('verifyEd25519')
    expect(jwl2VerifierSource).toContain('lookupTrustedJWordLicensePublicKey')
    expect(legacySource).not.toContain('publicKeyBase64Url')
    expect(publicSource).not.toContain('publicKeyBase64Url')
    expect(legacySource).toContain('allowInsecureFixtureLicense')
    expect(productionSource).not.toContain('createInsecureTestOnlyJWordLicenseSignature')
    expect(productionSource).not.toContain('signEd25519')
    expect(publicSource).not.toContain('createJWordLicenseSignature')
    expect(publicSource).not.toContain('readJWordLicenseVerifierMaterial')
    for (const marker of readTestOnlyJwl2ForbiddenMarkers()) {
      expect(hasTextMarker(productionSource, marker.value), marker.label).toBe(false)
      expect(hasTextMarker(productionDist, marker.value), marker.label).toBe(false)
      expect(hasTextMarker(JSON.stringify(readJson('packages/license/package.json')), marker.value), marker.label).toBe(false)
    }
    expect(issueScript).toContain('JWORD_LICENSE_PRIVATE_KEY_PEM')
    expect(issueScript).toContain('JWORD_LICENSE_PRIVATE_KEY_PATH')
  })

  it('provides an inventory-only Gate 5 third-party compatibility entry', () => {
    const scriptPath = 'tools/release/check-gate5-third-party-smoke.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf8')
    const consumerSource = readFileSync('tools/release/check-phase3-third-party-consumers.mjs', 'utf8')

    for (const token of [
      'check-gate5-third-party-smoke.mjs',
      'runLegacyConsumerCli',
      'check-phase3-third-party-consumers.mjs'
    ]) {
      expect(source, token).toContain(token)
    }
    for (const token of ['--artifact-manifest', '--binding', 'legacy-non-gating', 'repacks: 0']) {
      expect(consumerSource, token).toContain(token)
    }
    expect(source).not.toMatch(/(?:npm|pnpm)\s+pack/u)
  })

  it('uses Node ESM compatible .js suffixes for published runtime relative imports', () => {
    expect(existsSync('tools/release/normalize-dist-relative-imports.mjs')).toBe(true)

    const runtimeSourcePaths = [
      'packages/docx/src/index.ts',
      'packages/docx/src/package.ts',
      'packages/docx/src/import.ts',
      'packages/docx/src/import-readers.ts',
      'packages/docx/src/import-sections.ts',
      'packages/docx/src/model.ts',
      'packages/docx/src/export.ts',
      'packages/docx/src/compatibility.ts',
      'packages/docx/src/messages.ts',
      'packages/docx/src/roundtrip.ts',
      'packages/docx/src/worker.ts',
      'packages/pdf/src/index.ts',
      'packages/pdf/src/types.ts',
      'packages/pdf/src/worker.ts'
    ]

    for (const sourcePath of runtimeSourcePaths) {
      assertRuntimeRelativeImportsUseJsSuffix(sourcePath)
    }
  })

  it('keeps SDK docs aware of Gate 5 API, feature keys and billing boundary', () => {
    const sdkDocs = readEvidenceFiles([
      'docs/sdk/advanced-formats.md',
      'docs/sdk/licensing.md',
      'docs/sdk/public-api.md'
    ])

    expect(sdkDocs).toContain('Gate 5 高级格式互通')
    expect(sdkDocs).toContain('DOCX import/export')
    expect(sdkDocs).toContain('PDF export')
    expect(sdkDocs).toContain('GATE5_FORMAT_FEATURES')
    expect(sdkDocs).toContain('未授权失败')
    expect(sdkDocs).toContain('收费能力边界')
  })
})

interface PackageJson {
  readonly name?: string
  readonly private?: boolean
  readonly exports?: Readonly<Record<string, unknown>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly peerDependencies?: Readonly<Record<string, string>>
  readonly peerDependenciesMeta?: Readonly<Record<string, { readonly optional?: boolean }>>
  readonly devDependencies?: Readonly<Record<string, string>>
}

interface Gate5CommercialPackReport {
  readonly status: string
  readonly mode: string
  readonly packCommands: number
  readonly privateRegistry: {
    readonly required: boolean
    readonly publishConfigAccess: string
  }
  readonly packages: readonly {
    readonly name: string
    readonly status: string
    readonly sourceManifest: string
  }[]
  readonly freeBundleForbiddenImports: readonly string[]
  readonly exampleDocxLazyRuntimeImports: readonly string[]
}

/** 在 npm/pnpm 命令 trap 下运行 release script 并读取可观测调用记录。 */
function runWithPackCommandTrap(scriptPath: string): { readonly output: string, readonly commands: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-pack-trap-'))
  const binDirectory = join(root, 'bin')
  const logPath = join(root, 'commands.log')
  const trap = '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$JWORD_PHASE3_PACK_COMMAND_LOG"\nexit 97\n'

  try {
    execFileSync('mkdir', ['-p', binDirectory])
    for (const command of ['npm', 'pnpm']) {
      const commandPath = join(binDirectory, command)

      writeFileSync(commandPath, trap)
      chmodSync(commandPath, 0o755)
    }

    const scriptArguments = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined
      ? [scriptPath]
      : [scriptPath, '--artifact-manifest', process.env.JWORD_PHASE3_ARTIFACT_MANIFEST]
    const output = execFileSync(process.execPath, scriptArguments, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
        JWORD_PHASE3_PACK_COMMAND_LOG: logPath
      }
    })
    const commands = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean) : []

    return { output, commands }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

/** 读取 workspace JSON 文件。 */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/** 约束商业消费包由宿主提供唯一 License runtime，并仅在仓库开发时直接链接。 */
function assertLicensePeerDependency(packageJson: PackageJson): void {
  expect(packageJson.dependencies).not.toHaveProperty('@4xian/jword-license')
  expect(packageJson.peerDependencies?.['@4xian/jword-license']).toBe('workspace:*')
  expect(packageJson.devDependencies?.['@4xian/jword-license']).toBe('workspace:*')
  expect(packageJson.peerDependenciesMeta?.['@4xian/jword-license']).toBeUndefined()
}

/** 约束发布到 npm pack 的 ESM 运行时代码使用 Node 可解析的相对路径。 */
function assertRuntimeRelativeImportsUseJsSuffix(sourcePath: string): void {
  const source = readFileSync(sourcePath, 'utf8')
  const runtimeRelativeImportPattern = /^\s*(?!import\s+type\b)(?:import|export)\s+(?!type\b)[^'"\n]*from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]\s*\)/gmu
  let match: RegExpExecArray | null

  while ((match = runtimeRelativeImportPattern.exec(source)) !== null) {
    const specifier = match[1] ?? match[2]

    if (
      specifier !== undefined &&
      specifier.startsWith('./') &&
      !specifier.endsWith('.js')
    ) {
      throw new Error(`${sourcePath}: runtime import ${specifier} must include .js for Node ESM package consumers.`)
    }
  }
}

/** 汇总当前 SDK 文档内容。 */
function readEvidenceFiles(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(path, 'utf8')).join('\n')
}

/** 递归读取目录中的 TypeScript 源码，供生产表面禁用项扫描使用。 */
function readTypeScriptFilesUnder(directory: string): string {
  return readdirSync(directory, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'))
    .join('\n')
}

/** 读取正式 License dist 中会进入发布包的文本产物。 */
function readPublishedTextFilesUnder(directory: string): string {
  return readdirSync(directory, {
    recursive: true,
    withFileTypes: true
  })
    .filter((entry) => entry.isFile() && /\.(?:js|d\.ts|json)$/u.test(entry.name))
    .map((entry) => readFileSync(`${entry.parentPath}/${entry.name}`, 'utf8'))
    .join('\n')
}

/** 读取 LIC-110 JWL2 fixture 的安全扫描标记，不在断言消息中回显实际值。 */
function readTestOnlyJwl2ForbiddenMarkers(): readonly { label: string, value: string }[] {
  const source = readFileSync('fixtures/license/test-only-jwl2-fixture.ts', 'utf8')
  const markerNames = [
    ['TEST_ONLY_JWL2_PRIVATE_KEY_SEED', 'test-only JWL2 private seed'],
    ['TEST_ONLY_JWL2_PUBLIC_KEY', 'test-only JWL2 public key'],
    ['TEST_ONLY_JWL2_TOKEN', 'test-only JWL2 token'],
    ['TEST_ONLY_JWL2_KEY_ID', 'test-only JWL2 key id']
  ] as const

  return [
    { label: 'test-only JWL2 private seed identifier', value: 'TEST_ONLY_JWL2_PRIVATE_KEY_SEED' },
    { label: 'test-only JWL2 public key identifier', value: 'TEST_ONLY_JWL2_PUBLIC_KEY' },
    { label: 'test-only JWL2 token signer', value: 'createInsecureTestOnlyJwl2Token' },
    { label: 'test-only JWL2 key id literal', value: 'jword-test-lic110-k1' },
    ...markerNames.map(([name, label]) => ({
      label,
      value: readFixtureConstant(source, name, label)
    }))
  ]
}

/** 从 fixture 源码读取常量，读取失败时只报告安全标签。 */
function readFixtureConstant(source: string, name: string, label: string): string {
  const value = source.match(new RegExp(`${name} = '([^']+)'`, 'u'))?.[1]

  if (value === undefined) {
    throw new Error(`无法读取 ${label}。`)
  }

  return value
}

/** 检查文本是否包含指定标记。 */
function hasTextMarker(source: string, marker: string): boolean {
  return source.includes(marker)
}
