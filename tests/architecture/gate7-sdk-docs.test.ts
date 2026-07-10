/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 SDK 文档站、格式文档、协作/server/license 文档、迁移指南和支持诊断包规范。
 * 边界：只读取 Markdown 文档和相对链接，不执行 SDK 运行时或发布脚本。
 * 协作模块：docs/sdk 文档、diagnostics registry、Gate 7 release/no-alias 脚本共同提供对外交付证据。
 * 约束：文档必须引用公开 package 入口、稳定 diagnostic code 和可复跑命令，不把未执行的人工发布写成已发布。
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'

import { describe, expect, it } from 'vitest'

const docs = {
  index: 'docs/sdk/index.md',
  jwordFormat: 'docs/sdk/jword-format.md',
  advancedFormats: 'docs/sdk/advanced-formats.md',
  collaboration: 'docs/sdk/collaboration.md',
  collabServer: 'docs/sdk/collab-server.md',
  licensing: 'docs/sdk/licensing.md',
  migration: 'docs/sdk/migration.md',
  supportBundle: 'docs/sdk/support-bundle.md',
  stableMatrix: 'docs/sdk/stable-e2e-matrix.md'
} as const

const requiredDocumentTokens: Readonly<Record<keyof typeof docs, readonly string[]>> = {
  index: [
    './quickstart.md',
    './public-api.md',
    './jword-format.md',
    './advanced-formats.md',
    './collaboration.md',
    './collab-server.md',
    './licensing.md',
    './migration.md',
    './support-bundle.md',
    './stable-e2e-matrix.md'
  ],
  jwordFormat: [
    "from '@4xian/jword-native'",
    'manifest.json',
    'document.json',
    'metadata.json',
    'checksums.json',
    'JWORD_NATIVE_SCHEMA_VERSION',
    'validateJWordPackage',
    'JWORD_NATIVE_HASH_MISMATCH'
  ],
  advancedFormats: [
    "from '@4xian/jword-docx'",
    "from '@4xian/jword-pdf'",
    'GATE5_FORMAT_FEATURES.docxImport',
    'GATE5_FORMAT_FEATURES.pdfExport',
    'DOCX_WORKER_UNAVAILABLE',
    'PDF_WORKER_UNAVAILABLE',
    'JWORD_FEATURE_NOT_ENTITLED'
  ],
  collaboration: [
    "from '@4xian/jword-collab'",
    'connectJWordCollaboration()',
    'JWordCollaborationHandshake',
    'GATE6_COLLAB_FEATURES',
    'COLLAB_PROTOCOL_MISMATCH',
    '@4xian/jword-collab/experimental'
  ],
  collabServer: [
    "from '@4xian/jword-collab-server'",
    'createJWordCollabServer()',
    'startJWordCollabServer()',
    'authHook',
    'tenantHook',
    'licenseHook',
    '客户端 `readonly` 只是交互状态，不是安全边界'
  ],
  licensing: [
    'Edition matrix',
    'GATE5_FORMAT_FEATURES',
    'GATE6_COLLAB_FEATURES',
    'assertJWordFeatureEntitled()',
    'JWORD_LICENSE_MISSING',
    'node tools/release/check-gate7-third-party-smoke.mjs'
  ],
  migration: [
    'semver',
    'JWORD_NATIVE_SCHEMA_FUTURE',
    'COLLAB_SERVER_TOO_OLD',
    'JWORD_LICENSE_SIGNATURE_INVALID',
    'pnpm test:types'
  ],
  supportBundle: [
    'Editor.exportDiagnostics()',
    'packageVersions',
    'featureFlags',
    'privacy.contentIncluded',
    'license token',
    'operation summary'
  ],
  stableMatrix: [
    'vanilla free base',
    'React wrapper',
    'Vue wrapper',
    'DOCX/PDF',
    'collab client/server',
    'release/no-alias',
    'node tools/release/check-gate7-third-party-smoke.mjs'
  ]
}

describe('Gate 7 SDK documentation set', () => {
  it('publishes the required SDK docs with stable public entrypoint tokens', () => {
    for (const [name, path] of Object.entries(docs)) {
      expect(existsSync(path), path).toBe(true)
      const source = readFileSync(path, 'utf8')

      for (const token of requiredDocumentTokens[name as keyof typeof docs]) {
        expect(source, `${path}:${token}`).toContain(token)
      }
    }
  })

  it('keeps docs internal links resolvable', () => {
    const failures: string[] = []

    for (const path of Object.values(docs)) {
      const source = readFileSync(path, 'utf8')
      const links = [...source.matchAll(/\]\((\.\/[^)#]+\.md)(?:#[^)]+)?\)/gu)]

      for (const link of links) {
        const targetPath = link[1]

        if (targetPath === undefined) {
          continue
        }

        const target = normalize(join(dirname(path), targetPath))
        if (!existsSync(target)) {
          failures.push(`${path} -> ${targetPath}`)
        }
      }
    }

    expect(failures).toEqual([])
  })

  it('keeps support bundle and diagnostics docs explicit about privacy redaction', () => {
    const supportBundle = readFileSync(docs.supportBundle, 'utf8')
    const publicApi = readFileSync('docs/sdk/public-api.md', 'utf8')

    for (const forbiddenPayload of [
      '文档正文',
      'token',
      '私钥',
      '完整用户输入',
      '原始 HTML'
    ]) {
      expect(supportBundle, forbiddenPayload).toContain(forbiddenPayload)
      expect(publicApi, 'JWordDiagnosticsSnapshot').toContain('JWordDiagnosticsSnapshot')
    }
  })
})
