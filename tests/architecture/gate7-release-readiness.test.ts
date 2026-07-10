/**
 * @vitest-environment node
 *
 * 职责：锁定发布演练、无别名外部空项目验收和体积预算单一真源。
 * 边界：只读取脚本和 package manifest，不执行构建、pack、浏览器或发布命令。
 * 协作模块：tools/release、tools/size、package export map、SDK 矩阵和 current-implementation 文档共同提供发布前护栏。
 * 约束：脚本只能 dry-run / smoke，不允许自动 publish、tag、push 或修改 registry。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const releaseDryRunPath = 'tools/release/gate7-release-dry-run.mjs'
const noAliasSmokePath = 'tools/release/check-gate7-third-party-smoke.mjs'
const stableMatrixPath = 'docs/sdk/stable-e2e-matrix.md'
const publicApiPath = 'docs/sdk/public-api.md'
const packageManifests = [
  'packages/core/package.json',
  'packages/ui/package.json',
  'packages/native/package.json',
  'packages/docx/package.json',
  'packages/pdf/package.json',
  'packages/license/package.json',
  'packages/persistence/package.json',
  'packages/collab/package.json',
  'packages/collab-server/package.json',
  'packages/devtools/package.json',
  'packages/react/package.json',
  'packages/vue/package.json'
] as const

describe('Gate 7 release readiness', () => {
  it('provides a release dry-run script that cannot publish automatically', () => {
    expect(existsSync(releaseDryRunPath)).toBe(true)
    const source = readFileSync(releaseDryRunPath, 'utf8')

    for (const token of [
      'kind: \'gate7-release-dry-run\'',
      'publish: \'not-run\'',
      'manualApprovalRequired: true',
      'npm',
      'pack',
      '--dry-run',
      '--json'
    ]) {
      expect(source, token).toContain(token)
    }

    for (const forbidden of ['npm publish', 'pnpm publish', 'git tag', 'git push']) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  })

  it('keeps the no-alias smoke on local tarballs and all Gate 7 packages', () => {
    const source = readFileSync(noAliasSmokePath, 'utf8')

    for (const token of [
      '@4xian/jword-core',
      '@4xian/jword-ui',
      '@4xian/jword-native',
      '@4xian/jword-docx',
      '@4xian/jword-pdf',
      '@4xian/jword-license',
      '@4xian/jword-persistence',
      '@4xian/jword-collab',
      '@4xian/jword-collab-server',
      '@4xian/jword-react',
      '@4xian/jword-vue',
      '@4xian/jword-devtools',
      'assertNoRepoAlias',
      'file:../packs/',
      'GATE5_FORMAT_FEATURES',
      'GATE6_COLLAB_FEATURES',
      'createJWordLicenseError'
    ]) {
      expect(source, token).toContain(token)
    }
  })

  it('keeps package manifests on dist files and public export maps', () => {
    for (const manifestPath of packageManifests) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const exportMap = JSON.stringify(manifest.exports)

      expect(manifest.main, manifestPath).toBe('./dist/index.js')
      expect(manifest.module, manifestPath).toBe('./dist/index.js')
      expect(manifest.types, manifestPath).toBe('./dist/index.d.ts')
      expect(manifest.files, manifestPath).toContain('dist')
      expect(exportMap, manifestPath).not.toContain('/src/')
      expect(exportMap, manifestPath).not.toContain('packages/')
    }
  })

  it('records the size source of truth and stable E2E matrix in public docs', () => {
    const sdkDocs = [
      readFileSync(stableMatrixPath, 'utf8'),
      readFileSync('docs/sdk/index.md', 'utf8'),
      readFileSync(publicApiPath, 'utf8')
    ].join('\n')

    const sizeCheck = readFileSync('tools/size/check-size.mjs', 'utf8')

    expect(sizeCheck).toContain('sizeBudgetRoadmap')
    expect(sizeCheck).toContain('coreEntryByteLimit')
    expect(sizeCheck).toContain('demoFirstScreenByteLimit')
    expect(sdkDocs).toContain('node tools/release/gate7-release-dry-run.mjs')
    expect(sdkDocs).toContain('node tools/release/check-gate7-third-party-smoke.mjs')
    expect(sdkDocs).toContain('Gate 7 收口前必须同时满足')
  })
})
