/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 商业协作、离线、历史、服务端和自动插入的免费侧包边界。
 * 边界：只扫描免费基础源码入口和商业包公开契约，不启动 provider、服务端或真实浏览器。
 * 协作模块：packages/core、packages/native、examples/vanilla、packages/license、协同包和 SDK 文档。
 * 约束：免费基础能力不得静态或动态引入 collab/server/license 高级包；授权矩阵必须留在商业契约层。
 * 实现说明：本测试以源码、公开包契约、SDK 文档和可运行验收文件为准，不读取旧实施计划。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const freeSourceRoots = [
  'packages/core/src',
  'packages/native/src',
  'examples/vanilla/src'
] as const

const forbiddenCommercialImports: readonly string[] = [
  '@4xian/jword-collab',
  '@4xian/jword-collab-server',
  '@4xian/jword-license'
] as const
const gate6DocumentedBoundaryTokens = [
  '@4xian/jword-collab-server',
  'self-host',
  'client/server',
  'COLLAB_PROTOCOL_MISMATCH',
  'COLLAB_FEATURE_FLAGS_MISSING',
  '未授权',
  'JWORD_LICENSE_MISSING',
  '远端 cursor',
  'startAutoInsertSession()',
  '不读取 live caret',
  'examples/collab',
  'paid collaboration edition',
  '付费能力必须在 worker、server 或 package 执行层调用',
  '浏览器按钮隐藏、文档提示或 wrapper props 不是授权边界'
] as const
const coreStableEntryFiles = [
  'packages/core/src/index.ts',
  'packages/core/src/editor/runtime.ts',
  'packages/core/src/editor/types.ts'
] as const

const runtimeImportFromPattern = /^\s*import(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const runtimeBareImportPattern = /^\s*import\s+["']([^"']+)["'];?/gmu
const runtimeExportFromPattern = /^\s*export(?!\s+type\b)[\s\S]*?\sfrom\s+["']([^"']+)["'];?/gmu
const runtimeDynamicImportPattern = /import\(\s*["']([^"']+)["']\s*\)/gmu
const coreForbiddenStableTokens = [
  /\bCollaboration\b/u,
  /\bcollab\b/u,
  /\bAutoInsert\b/u,
  /\bautoInsert\b/u,
  /\boffline\b/u
] as const

describe('Gate 6 commercial readiness', () => {
  it('keeps free foundation sources from importing paid collaboration packages', () => {
    const violations = freeSourceRoots.flatMap((root) => {
      return readTypeScriptSources(root).flatMap((source) => {
        return readRuntimePackageSpecifiers(source.text)
          .filter((specifier) => forbiddenCommercialImports.includes(specifier))
          .map((specifier) => `${source.path}:${specifier}`)
      })
    })

    expect(violations).toEqual([])
  })

  it('keeps Gate 6 paid feature keys in the license package contract', async () => {
    const license = await import('../../packages/license/src/index')

    expect(license.GATE6_COLLAB_FEATURES).toEqual({
      multiplayer: 'collaboration.multiplayer',
      offline: 'collaboration.offline',
      history: 'collaboration.history',
      server: 'collaboration.server',
      autoInsert: 'automation.autoInsert'
    })
  })

  it('keeps SDK docs aware of Gate 6 API, deployment, licensing and migration scope', () => {
    const sdkDocs = readEvidenceFiles([
      'docs/sdk/collaboration.md',
      'docs/sdk/collab-server.md',
      'docs/sdk/licensing.md',
      'docs/sdk/migration.md',
      'docs/sdk/public-api.md'
    ])

    for (const token of [
      '协作客户端集成',
      'public API',
      'self-host',
      '授权接入',
      'client/server',
      '故障排查',
      '收费能力边界',
      '迁移指南',
      'ConnectJWordCollaborationOptions',
      'CreateJWordCollabServerOptions',
      'JWordCollaborationHandshake',
      'JWordCollaborationOfflineState',
      'JWordCollaborationHistoryVersion',
      'JWordCollaborationAutoInsertSession',
      'GATE6_COLLAB_FEATURES',
      'COLLAB_PROTOCOL_MISMATCH',
      'COLLAB_FEATURE_FLAGS_MISSING'
    ]) {
      expect(sdkDocs).toContain(token)
    }
  })

  it('documents Gate 6 acceptance and forbidden boundaries only after evidence exists', () => {
    const sdkDocs = readEvidenceFiles([
      'docs/sdk/collaboration.md',
      'docs/sdk/collab-server.md',
      'docs/sdk/licensing.md',
      'docs/current-implementation/packages/collab.md',
      'docs/current-implementation/packages/collab-server.md'
    ])
    const evidence = readEvidenceFiles([
      'packages/collab/test/public-client.test.ts',
      'packages/collab/test/contract.test.ts',
      'packages/collab-server/test/server.test.ts',
      'tests/architecture/gate6-import-graph.test.ts',
      'tests/architecture/gate6-bundle-gate.test.ts',
      'tests/architecture/gate6-package-exports.test.ts',
      'examples/collab/tests/vite-config.test.ts',
      'examples/collab/tests/collab-handshake.e2e.ts',
      'examples/collab/tests/collab-smoke.e2e.ts',
      'examples/collab/tests/collab-auto-insert-concurrency.e2e.ts',
      'examples/collab/tests/collab-history-api.e2e.ts',
      'tools/release/check-gate6-third-party-smoke.mjs',
      'tools/size/check-gate6-collab-bundle.mjs'
    ])

    for (const token of gate6DocumentedBoundaryTokens) {
      expect(sdkDocs, token).toContain(token)
    }
    for (const token of [
      'createJWordCollabServer',
      'startJWordCollabServer',
      'COLLAB_PROTOCOL_MISMATCH',
      'COLLAB_SERVER_TOO_OLD',
      'COLLAB_CLIENT_TOO_OLD',
      'COLLAB_FEATURE_FLAGS_MISSING',
      'COLLAB_LICENSE_MISSING',
      'COLLAB_LICENSE_EXPIRED',
      'COLLAB_FEATURE_NOT_ENTITLED',
      'COLLAB_LICENSE_SERVER_UNAVAILABLE',
      'createPresenceDisplayUsers',
      '正在输入',
      'requires explicit auto insert position or range and never reads live caret',
      'focusCallCount',
      'selectionMutationCount',
      'Gate 6 collab example import graph',
      'check-gate6-collab-bundle',
      'licenseHook',
      'beforeSync',
      '/auto-insert/relay',
      'blocks unlicensed history writes before storage is touched',
      'blocks unlicensed auto-insert relay before accepting chunks',
      'provider.status).toBe(\'idle\')'
    ]) {
      expect(evidence, token).toContain(token)
    }
  })

  it('keeps core stable entrypoints free of Gate 6 paid product API names', () => {
    const violations = coreStableEntryFiles.flatMap((path) => {
      const source = stripComments(readFileSync(path, 'utf8'))

      return coreForbiddenStableTokens.flatMap((pattern) =>
        pattern.test(source)
          ? [`${path}:${pattern.source}`]
          : []
      )
    })

    expect(violations).toEqual([])
  })

  it('marks checkpoint E only after Gate 6 origin, licensing, server and public API evidence is present', () => {
    const checkpointEvidence = readEvidenceFiles([
      'docs/sdk/collaboration.md',
      'docs/sdk/collab-server.md',
      'docs/sdk/licensing.md',
      'docs/sdk/public-api.md',
      'tests/architecture/gate6-fixture-registry.test.ts',
      'packages/core/src/operations/history.ts',
      'tests/architecture/gate6-package-exports.test.ts'
    ])

    for (const token of [
      'origin',
      'history',
      'remote:',
      'ai:',
      '默认只跟踪本地用户 origin',
      '授权',
      'server package',
      'client/server',
      'stable API'
    ]) {
      expect(checkpointEvidence, token).toContain(token)
    }
  })
})

interface SourceFile {
  readonly path: string
  readonly text: string
}

/** 读取指定目录下的 TypeScript 源文件。 */
function readTypeScriptSources(root: string): readonly SourceFile[] {
  return listTypeScriptFiles(root).map((path) => ({
    path,
    text: readFileSync(path, 'utf8')
  }))
}

/** 递归列出 TypeScript 源文件。 */
function listTypeScriptFiles(root: string): readonly string[] {
  if (!existsSync(root)) {
    return []
  }

  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)

    if (entry.isDirectory()) {
      return listTypeScriptFiles(path)
    }

    return entry.isFile() && /\.(?:ts|tsx)$/u.test(path) ? [path] : []
  })
}

/** 读取运行时 import、export 和 dynamic import 的 package specifier。 */
function readRuntimePackageSpecifiers(source: string): readonly string[] {
  return [
    ...readSpecifiers(source, runtimeImportFromPattern),
    ...readSpecifiers(source, runtimeBareImportPattern),
    ...readSpecifiers(source, runtimeExportFromPattern),
    ...readSpecifiers(source, runtimeDynamicImportPattern)
  ].filter((specifier) => !specifier.startsWith('.') && !specifier.startsWith('/'))
}

/** 按正则读取 source 中的 specifier。 */
function readSpecifiers(source: string, pattern: RegExp): readonly string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]).filter((specifier): specifier is string =>
    specifier !== undefined && specifier.length > 0
  )
}

/** 汇总当前 Gate 6 验收证据文件内容。 */
function readEvidenceFiles(paths: readonly string[]): string {
  return paths.map((path) => readFileSync(path, 'utf8')).join('\n')
}

/** 移除源码注释，避免文件头说明影响稳定入口命名扫描。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/(^|[^:])\/\/.*$/gmu, '$1')
}
