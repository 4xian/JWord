/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 Step 7.8 Vue wrapper 的包入口、导出边界和示例落点。
 * 边界：只读取 manifest、源码入口和示例入口，不执行 Vue runtime。
 * 协作：packages/vue、examples/vue、公开 API catalog 和 Gate 7 wrapper 设计文档。
 * 约束：Vue wrapper 必须只消费 core/ui package 入口，不发布 src/internal/demo 子路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const vuePackageJsonPath = 'packages/vue/package.json'
const vueEntryPath = 'packages/vue/src/index.ts'
const vueExampleEntryPath = 'examples/vue/src/App.vue'
const publicApiCatalogPath = 'docs/sdk/public-api.md'

interface PackageManifest {
  readonly name?: unknown
  readonly main?: unknown
  readonly types?: unknown
  readonly exports?: unknown
  readonly files?: unknown
  readonly peerDependencies?: unknown
}

/** 读取 JSON manifest，保持 unknown 边界。 */
function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest
}

describe('Gate 7 Vue wrapper package boundary', () => {
  it('publishes only dist entrypoints and declares Vue as peer dependency', () => {
    expect(existsSync(vuePackageJsonPath)).toBe(true)

    const manifest = readManifest(vuePackageJsonPath)
    const files = Array.isArray(manifest.files) ? manifest.files : []
    const peerDependencies = manifest.peerDependencies as Record<string, unknown> | undefined

    expect(manifest.name).toBe('@4xian/jword-vue')
    expect(manifest.main).toBe('./dist/index.js')
    expect(manifest.types).toBe('./dist/index.d.ts')
    expect(manifest.exports).toEqual({
      '.': {
        types: './dist/index.d.ts',
        import: './dist/index.js'
      }
    })
    expect(files).toEqual(['dist'])
    expect(peerDependencies?.vue).toBeDefined()
  })

  it('exports the planned Vue wrapper API from the package root', () => {
    expect(existsSync(vueEntryPath)).toBe(true)

    const source = readFileSync(vueEntryPath, 'utf8')

    for (const token of [
      'JWordVueEditor',
      'JWordVueEditorProps',
      'JWordVueEditorHandle',
      'JWORD_VUE_EDITOR_KEY',
      'useJWordEditor',
      'useJWordEditorHandle'
    ]) {
      expect(source).toContain(token)
    }

    expect(source).toContain("from '@4xian/jword-core'")
    expect(source).toContain("from '@4xian/jword-ui'")
    expect(source).not.toContain('/src/')
  })

  it('documents Vue as implemented and keeps the example on public package imports', () => {
    expect(existsSync(vueExampleEntryPath)).toBe(true)

    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const example = readFileSync(vueExampleEntryPath, 'utf8')

    expect(catalog).toContain('## @4xian/jword-vue')
    expect(catalog).toContain('JWordVueEditor')
    expect(catalog).not.toContain('@4xian/jword-vue`\n\n状态：未实现')
    expect(example).toContain("from '@4xian/jword-vue'")
    expect(example).toContain("from '@4xian/jword-native'")
    expect(example).toContain('saveJWordDocument')
    expect(example).toContain('data-jword-vue-input')
    expect(example).toContain('data-jword-vue-save')
    expect(example).toContain('data-jword-vue-destroy')
    expect(example).not.toContain('packages/')
    expect(example).not.toContain('/src/')
  })
})
