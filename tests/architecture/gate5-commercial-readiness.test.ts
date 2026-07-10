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
import { existsSync, readFileSync } from 'node:fs'
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
    expect(docxPackage.dependencies).toMatchObject({
      '@4xian/jword-license': 'workspace:*'
    })
    expect(pdfPackage.dependencies).toMatchObject({
      '@4xian/jword-license': 'workspace:*'
    })
  })

  it('provides a release check for private registry, pack contents, export maps and lazy loading', () => {
    expect(existsSync('tools/release/check-gate5-commercial-pack.mjs')).toBe(true)

    const output = execFileSync(process.execPath, [
      'tools/release/check-gate5-commercial-pack.mjs'
    ], {
      encoding: 'utf8'
    })
    const report = JSON.parse(output) as Gate5CommercialPackReport

    expect(report.status).toBe('ok')
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
      expect(packageReport.npmPackDryRun.requiredFilesMissing).toEqual([])
      expect(packageReport.npmPackDryRun.forbiddenFiles).toEqual([])
      expect(packageReport.npmPackDryRun.sourceMapLeaks).toEqual([])
      expect(packageReport.npmPackDryRun.files).toContain('package.json')
      expect(packageReport.npmPackDryRun.files.some((file) => file.startsWith('src/'))).toBe(false)
      expect(packageReport.npmPackDryRun.files.some((file) => file.startsWith('test/'))).toBe(false)
      expect(packageReport.npmPackDryRun.files.some((file) => file.startsWith('tests/'))).toBe(false)
      expect(packageReport.npmPackDryRun.files.some((file) => file.endsWith('.map'))).toBe(false)
    }
    expect(readFileSync('tools/release/check-gate5-commercial-pack.mjs', 'utf8')).toContain('normalize-dist-relative-imports.mjs')
    expect(report.freeBundleForbiddenImports).toEqual([])
    expect(report.exampleDocxLazyRuntimeImports).toEqual([
      '@4xian/jword-docx',
      '@4xian/jword-pdf'
    ])
  })

  it('blocks the legacy FNV helper from the public license signing path', () => {
    const source = readFileSync('packages/license/src/index.ts', 'utf8')
    const issueScript = readFileSync('tools/license/issue-license.mjs', 'utf8')

    expect(existsSync('tools/license/issue-license.mjs')).toBe(true)
    expect(source).toContain("const JWORD_LICENSE_TOKEN_VERSION = 'JWL1'")
    expect(source).toContain('verifyEd25519')
    expect(source).toContain('allowInsecureFixtureLicense')
    expect(source).toContain('createInsecureTestOnlyJWordLicenseSignature')
    expect(source).not.toContain('createJWordLicenseSignature')
    expect(source).not.toContain('readJWordLicenseVerifierMaterial')
    expect(issueScript).toContain('JWORD_LICENSE_PRIVATE_KEY_PEM')
    expect(issueScript).toContain('JWORD_LICENSE_PRIVATE_KEY_PATH')
  })

  it('provides a Gate 5 third-party empty-project smoke script through public packages', () => {
    const scriptPath = 'tools/release/check-gate5-third-party-smoke.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf8')

    for (const token of [
      'gate5-third-party-smoke',
      'empty-project',
      'pnpm',
      'pack',
      'install',
      'workspace:*',
      '@4xian/jword-license',
      '@4xian/jword-docx',
      '@4xian/jword-pdf',
      'importDocx',
      'exportDocx',
      'exportPdfFromLayout',
      'publicApiOnly'
    ]) {
      expect(source, token).toContain(token)
    }
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
  readonly exports?: unknown
  readonly dependencies?: Readonly<Record<string, string>>
}

interface Gate5CommercialPackReport {
  readonly status: string
  readonly privateRegistry: {
    readonly required: boolean
    readonly publishConfigAccess: string
  }
  readonly packages: readonly {
    readonly name: string
    readonly npmPackDryRun: {
      readonly filename: string
      readonly entryCount: number
      readonly files: readonly string[]
      readonly requiredFiles: readonly string[]
      readonly requiredFilesMissing: readonly string[]
      readonly forbiddenFiles: readonly string[]
      readonly sourceMapLeaks: readonly string[]
    }
  }[]
  readonly freeBundleForbiddenImports: readonly string[]
  readonly exampleDocxLazyRuntimeImports: readonly string[]
}

/** 读取 workspace JSON 文件。 */
function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
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
