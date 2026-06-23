/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 商业协作 bundle 门禁脚本的存在和扫描语义。
 * 边界：只检查脚本源码契约，不执行 Vite build 或读取 dist 产物。
 * 协作模块：tools/size/check-gate6-collab-bundle.mjs、examples/vanilla 和 examples/collab。
 * 约束：免费 vanilla 首屏不得包含协作高级代码；collab 示例的高级 runtime 必须保持按需加载。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-653。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

describe('Gate 6 collab bundle gate', () => {
  it('ships a dedicated bundle gate script for free vanilla and paid collab chunks', () => {
    const scriptPath = 'tools/size/check-gate6-collab-bundle.mjs'

    expect(existsSync(scriptPath)).toBe(true)

    const source = readFileSync(scriptPath, 'utf8')

    for (const token of [
      'Gate 6 商业协作 bundle 门禁',
      'freeVanillaFirstScreenForbiddenTokens',
      'collabFirstScreenForbiddenTokens',
      'collabLazyRequiredTokens',
      '@4xian/jword-collab',
      '@4xian/jword-collab-server',
      '@4xian/jword-license',
      '@4xian/jword-persistence',
      '@hocuspocus',
      'hocuspocus',
      'IndexedDB',
      'indexeddb',
      'y-indexeddb',
      'COLLAB_LICENSE_MISSING',
      'loadHocuspocusDemoRuntime',
      'status: \'ok\''
    ]) {
      expect(source).toContain(token)
    }
  })
})
