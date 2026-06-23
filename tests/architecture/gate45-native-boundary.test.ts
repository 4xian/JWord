/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4.5 native 包的架构边界和 fixture registry。
 * 边界：只做源码和登记表扫描，不执行保存/打开。
 * 协作模块：packages/native、fixtures/native、Gate 4.5 canonical plan。
 * 约束：native 不能依赖 DOCX/PDF/collab/license，也不能把禁止缓存作为主格式保存。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-45---jword-原生保存与打开。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const forbiddenImports = [
  '@4xian/jword-docx',
  '@4xian/jword-pdf',
  '@4xian/jword-collab',
  '@4xian/jword-license',
  'pdf-lib',
  'yjs'
]

const forbiddenPrimaryFormats = [
  'ydoc',
  'y.doc',
  'layout cache',
  'layoutCache',
  'canvas bitmap',
  'canvasBitmap',
  'dom selection',
  'domSelection',
  'projection cache',
  'projectionCache'
]

const expectedFixtureIds = [
  'empty',
  'plain-text',
  'formatting',
  'table',
  'image',
  'comments',
  'header-footer',
  'corrupt-resource',
  'old-schema'
]

describe('Gate 4.5 native boundary', () => {
  it('keeps native package free from advanced package imports', () => {
    const sources = readNativeSources()

    for (const source of sources) {
      for (const forbiddenImport of forbiddenImports) {
        expect(source.text.includes(`'${forbiddenImport}'`) || source.text.includes(`"${forbiddenImport}"`), source.path).toBe(false)
      }
    }
  })

  it('does not save forbidden caches or Y.Doc binary as primary package entries', () => {
    const sourceText = readNativeSources().map((source) => source.text).join('\n')

    for (const forbiddenPrimaryFormat of forbiddenPrimaryFormats) {
      expect(sourceText.toLowerCase()).not.toContain(forbiddenPrimaryFormat.toLowerCase())
    }
  })

  it('registers the required native fixture ids', () => {
    const registry = JSON.parse(readFileSync('fixtures/native/registry.json', 'utf8')) as {
      readonly fixtures: readonly { readonly id: string }[]
    }

    expect(registry.fixtures.map((fixture) => fixture.id)).toEqual(expectedFixtureIds)
  })

  it('keeps native out of the free vanilla first-screen bundle gate', () => {
    const source = readFileSync('tools/size/check-size.mjs', 'utf8')

    expect(source).toContain("'@4xian/jword-native'")
  })
})

interface NativeSource {
  readonly path: string
  readonly text: string
}

/** 读取 native 包源码。 */
function readNativeSources(): readonly NativeSource[] {
  return listTypeScriptFiles('packages/native/src').map((path) => ({
    path,
    text: readFileSync(path, 'utf8')
  }))
}

/** 递归列出 TypeScript 源文件。 */
function listTypeScriptFiles(dir: string): readonly string[] {
  if (!existsSync(dir)) {
    return []
  }

  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return entry.isFile() && path.endsWith('.ts') ? [path] : []
  })
}
