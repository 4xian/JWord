/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 对外浏览器支持矩阵、构建 target 和 E2E 浏览器族。
 * 边界：只检查公开文档与配置文本，不启动浏览器、不构建示例。
 * 协作模块：docs/sdk/browser-support.md、Vite 示例配置、Playwright 配置和 package scripts。
 * 约束：最新版回归不是最低版本认证；窄屏只保留分页滚动预览和工具栏样式适配。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
  it('freezes the public minimum browser target, evidence boundary and API rules', () => {
    expect(existsSync(browserSupportPath)).toBe(true)

    const support = readFileSync(browserSupportPath, 'utf8')
    const publicApi = readFileSync(publicApiPath, 'utf8')

    expect(support).toContain('Chrome / Edge ≥ 100')
    expect(support).toContain('Firefox ≥ 128')
    expect(support).toContain('Safari ≥ 16.4')
    expect(support).toContain('LIC-107B2')
    expect(support).toContain('Deferred')
    expect(support).toContain('不阻断内部阶段')
    expect(support).toContain('仍阻断对应最低版本对外声明和商业 GA')
    expect(support).toContain('不得对外描述为已完成最低版本实测')
    expect(support).toContain('Chrome 92')
    expect(support).toContain('feature detection')
    expect(support).toContain('`target` 不提供运行时 API polyfill')
    expect(support).toContain('Node ≥ 20.19.0')
    expect(support).toContain('不是客户浏览器宿主要求')
    expect(support).toContain('窄屏适配边界')
    expect(support).toContain('分页 canvas 在窄屏视口下可滚动、可阅读、页面不空白')
    expect(support).toContain('不在 JWord 中建立单独的窄屏平台概念')
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
