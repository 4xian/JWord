/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 6 商业协作、离线、历史、服务端和自动插入的免费侧包边界。
 * 边界：只扫描免费基础源码入口和商业包公开契约，不启动 provider、服务端或真实浏览器。
 * 协作模块：packages/core、packages/native、examples/vanilla、packages/license 和 Gate 6 商业计划。
 * 约束：免费基础能力不得静态或动态引入 collab/server/license 高级包；授权矩阵必须留在商业契约层。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-621建立商业边界架构测试和授权-diagnostics。
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
const gate6AcceptanceItems = [
  '`@4xian/jword-collab-server` 可作为正式 self-host 服务包被第三方部署，不要求第三方复制 demo server 代码。',
  'client/server 版本不匹配、featureFlags 缺失或 protocol 不兼容时 fail-fast，并给出稳定 diagnostic。',
  '未授权、授权过期、feature 不匹配和 license server 不可用时，高级协作、离线、历史和自动插入均被阻止，且不读取或泄漏文档内容。',
  '远端 cursor 在光标附近显示用户名、颜色和 `正在输入` 状态，多用户重叠时稳定排序且不遮挡本地输入。',
  '`startAutoInsertSession()` 只消费显式 position/range，不读取 live caret、不调用 focus、不改变用户 selection；自动插入作为虚拟远端 actor 参与协作。',
  '`examples/collab` 只使用公开包 API 和真实编辑器集成，不再以 textarea harness 或 demo runtime 作为主验收入口。',
  '免费基础 bundle、`packages/core` 和 `packages/native` 不包含 collab/server/license 高级功能代码。',
  '付费边界至少有服务端或 worker/license 层强制 enforcement，不能只靠浏览器 client-side 判断。'
] as const
const gate6ForbiddenItems = [
  '不让 demo/test 通过 `packages/*/src`、Y.Doc store、内部 runtime 或 server service 绕过公开 API。',
  '不把生产 server 只藏在 demo 目录；第三方必须能安装正式 server 包并以公开 options 启动。',
  '不把付费边界只放在浏览器 JS；用户拿到 client 包也不能绕过服务端或 worker/license enforcement。',
  '不在 core 稳定 API 中暴露 `collab`、`offline`、`autoInsert` 等高级产品 API 名称；core 只提供中立位置、anchor/range、transaction hook。',
  '不让自动插入读取 live caret、抢 focus 或修改用户手动 selection。',
  '不允许 client/server 版本不匹配时静默继续协作。'
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

  it('keeps Gate 7 documentation plan aware of Gate 6 API, deployment, licensing and migration scope', () => {
    const plan = readFileSync('docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md', 'utf8')

    for (const token of [
      'Gate 6 collab client 集成文档',
      'Gate 6 公开 API 清单',
      'self-host server 部署',
      '授权接入',
      'client/server 版本策略',
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
      expect(plan).toContain(token)
    }
  })

  it('marks Gate 6 acceptance and forbidden checklist items only after evidence exists', () => {
    const plan = readFileSync('docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md', 'utf8')
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

    for (const item of [...gate6AcceptanceItems, ...gate6ForbiddenItems]) {
      expect(plan, item).toContain(`- [x] ${item}`)
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
    const plan = readFileSync('docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md', 'utf8')

    expect(plan).toContain('- [x] 复核点 E：Gate 6 完成后')
    for (const token of [
      'origin',
      'undo scope',
      'remote/AI/local 并发语义',
      '授权',
      'server package',
      'client/server version handshake',
      '第三方公开 API 集成'
    ]) {
      expect(plan, token).toContain(token)
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
