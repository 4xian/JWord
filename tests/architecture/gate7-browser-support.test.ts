/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 对外浏览器支持矩阵、构建 target 和 E2E 浏览器族。
 * 边界：只检查公开文档与配置文本，不启动浏览器、不构建示例。
 * 协作模块：docs/sdk/browser-support.md、Vite 示例配置、Playwright 配置和 package scripts。
 * 约束：测试矩阵不是最低版本承诺；移动端只承诺只读分页预览。
 * Specs：docs/superpowers/reports/2026-07-02-plan-review.md#313-对外浏览器支持矩阵未定义r2-复审补充。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const browserSupportPath = 'docs/sdk/browser-support.md'
const publicApiPath = 'docs/sdk/public-api.md'
const playwrightConfigPath = 'playwright.config.ts'
const packageJsonPath = 'package.json'
const exampleViteConfigPaths = [
  'examples/vanilla/vite.config.ts',
  'examples/docx/vite.config.ts',
  'examples/collab/vite.config.ts'
]
const exampleTsconfigPaths = [
  'examples/vanilla/tsconfig.json',
  'examples/docx/tsconfig.json',
  'examples/collab/tsconfig.json'
]
const packageTsconfigPaths = [
  'packages/core/tsconfig.json',
  'packages/ui/tsconfig.json',
  'packages/native/tsconfig.json',
  'packages/docx/tsconfig.json',
  'packages/pdf/tsconfig.json',
  'packages/collab/tsconfig.json',
  'packages/collab-server/tsconfig.json',
  'packages/license/tsconfig.json',
  'packages/persistence/tsconfig.json'
]

describe('Gate 7 browser support matrix', () => {
  it('freezes the public minimum browser matrix and mobile boundary', () => {
    expect(existsSync(browserSupportPath)).toBe(true)

    const support = readFileSync(browserSupportPath, 'utf8')
    const publicApi = readFileSync(publicApiPath, 'utf8')

    expect(support).toContain('Chrome / Edge ≥ 114')
    expect(support).toContain('Firefox ≥ 115 ESR')
    expect(support).toContain('Safari ≥ 16.4')
    expect(support).toContain('移动端仅承诺只读分页预览')
    expect(support).toContain('不承诺移动端编辑')
    expect(support).toContain('ES2022')
    expect(support).toContain('Chromium / Firefox / WebKit 最新版')
    expect(publicApi).toContain('./browser-support.md')
  })

  it('aligns package/example build targets and Playwright browser families with the matrix', () => {
    const packageJson = readJsonRecord(packageJsonPath)
    const scripts = readRecordProperty(packageJson, 'scripts')
    const e2eScript = readStringProperty(scripts, 'test:e2e')
    const playwrightConfig = readFileSync(playwrightConfigPath, 'utf8')

    expect(e2eScript).toContain('--project=chromium')
    expect(e2eScript).toContain('--project=firefox')
    expect(e2eScript).toContain('--project=webkit')
    expect(playwrightConfig).toContain("name: 'chromium'")
    expect(playwrightConfig).toContain("name: 'firefox'")
    expect(playwrightConfig).toContain("name: 'webkit'")

    for (const tsconfigPath of packageTsconfigPaths) {
      expect(readTsTarget(tsconfigPath)).toBe('ES2022')
      expect(readTsLibs(tsconfigPath)).toContain('ES2022')
    }

    for (const tsconfigPath of exampleTsconfigPaths) {
      expect(readTsTarget(tsconfigPath)).toBe('ES2022')
      expect(readTsLibs(tsconfigPath)).toContain('ES2022')
    }

    for (const viteConfigPath of exampleViteConfigPaths) {
      expect(readFileSync(viteConfigPath, 'utf8')).toContain("target: 'es2022'")
    }
  })
})

/** 读取 JSON 文件并确认根节点是对象。 */
function readJsonRecord(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown

  if (!isRecord(parsed)) {
    throw new Error(`${path} must contain a JSON object`)
  }

  return parsed
}

/** 读取对象属性并确认属性值仍是对象。 */
function readRecordProperty(source: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = source[key]

  if (!isRecord(value)) {
    throw new Error(`${key} must be a JSON object`)
  }

  return value
}

/** 读取对象属性并确认属性值是字符串。 */
function readStringProperty(source: Record<string, unknown>, key: string): string {
  const value = source[key]

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string`)
  }

  return value
}

/** 读取 tsconfig 的 target 字段。 */
function readTsTarget(path: string): string {
  const compilerOptions = readRecordProperty(readJsonRecord(path), 'compilerOptions')

  return readStringProperty(compilerOptions, 'target')
}

/** 读取 tsconfig 的 lib 字段。 */
function readTsLibs(path: string): readonly string[] {
  const compilerOptions = readRecordProperty(readJsonRecord(path), 'compilerOptions')
  const value = compilerOptions.lib

  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error(`${path} compilerOptions.lib must be a string array`)
  }

  return value
}

/** 判断输入是否为普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
