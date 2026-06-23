/**
 * 职责：锁定 Gate 6 examples/collab 最小 demo package、Vite 和样式契约。
 * 边界：只验证示例宿主结构与内存 debug API 骨架，不覆盖真实协同网络实现。
 * 协作：examples/collab package、Vite 配置、src runtime 和 smoke e2e 测试。
 * 约束：collab demo 不把协同逻辑写入 core，样式不得使用 grid 或 gap。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 collaboration/auto-insert。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

import { createPresenceDisplayUsers, sortAwarenessUsers } from '../src/runtime'
import type { AwarenessUserSnapshot } from '../src/runtime'

describe('collab demo host contract', () => {
  it('提供独立 examples/collab package 和 Vite source alias', async () => {
    const packageJson = readWorkspaceJson('examples/collab/package.json') as {
      readonly name?: string
      readonly scripts?: Readonly<Record<string, string>>
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const configModule = await loadViteConfigModule()
    const aliasList = normalizeAliasList(configModule.createCollabDemoViteConfig().resolve?.alias)

    expect(packageJson.name).toBe('@4xian/jword-example-collab')
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      'dev:server': 'node --experimental-strip-types server/dev-server.ts',
      build: expect.any(String),
      typecheck: expect.any(String)
    })
    expect(packageJson.dependencies).toMatchObject({
      '@hocuspocus/server': '4.0.0',
      '@4xian/jword-core': 'workspace:*',
      '@4xian/jword-docx': 'workspace:*',
      '@4xian/jword-ui': 'workspace:*'
    })
    expect(aliasList).toEqual(expect.arrayContaining([
      {
        find: '@4xian/jword-collab',
        replacement: resolve(process.cwd(), 'packages/collab/src/index.ts')
      },
      {
        find: '@4xian/jword-collab/experimental',
        replacement: resolve(process.cwd(), 'packages/collab/src/experimental.ts')
      },
      {
        find: '@4xian/jword-core',
        replacement: resolve(process.cwd(), 'packages/core/src/index.ts')
      },
      {
        find: '@4xian/jword-docx',
        replacement: resolve(process.cwd(), 'packages/docx/src/index.ts')
      },
      {
        find: '@4xian/jword-license',
        replacement: resolve(process.cwd(), 'packages/license/src/index.ts')
      },
      {
        find: '@4xian/jword-persistence',
        replacement: resolve(process.cwd(), 'packages/persistence/src/index.ts')
      },
      {
        find: '@4xian/jword-ui',
        replacement: resolve(process.cwd(), 'packages/ui/src/index.ts')
      }
    ]))
  })

  it('HTML 入口包含 collab demo 关键面板', () => {
    const html = readWorkspaceText('examples/collab/index.html')

    for (const id of [
      'jword-collab-app',
      'jword-collab-editor',
      'jword-collab-status',
      'jword-collab-awareness',
      'jword-collab-offline',
      'jword-collab-history',
      'jword-collab-auto'
    ]) {
      expect(html).toContain(`id="${id}"`)
    }
    expect(html).toContain('data-jword-collab-editor')
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('jw-collab-demo__textarea')
  })

  it('主入口按第三方集成方式先装配基础 editor/UI 再懒加载高级协作参数', () => {
    const source = readWorkspaceText('examples/collab/src/main.ts')

    expect(source).toContain('from \'@4xian/jword-core\'')
    expect(source).toContain('from \'@4xian/jword-ui\'')
    expect(source).toContain('createEditorSharedDocument(')
    expect(source).toContain('createEditorWithSharedDocument(')
    expect(source).toContain('createJWordUi({')
    expect(source).toContain('createDemoLicenseEntitlement(')
    expect(source).toContain("requireElement<HTMLElement>('#jword-collab-editor'")
    expect(source).not.toContain("requireElement<HTMLElement>('#jword-collab-toolbar'")

    for (const optionName of [
      'serverUrl',
      'roomId',
      'documentId',
      'user',
      'license',
      'features'
    ]) {
      expect(source).toContain(optionName)
    }
  })

  it('src 暴露 createCollabDemoRuntime 和完整 debug API 名称', () => {
    const source = readWorkspaceText('examples/collab/src/runtime.ts')

    expect(source).toContain('createCollabDemoRuntime')

    for (const name of [
      'readCollabState',
      'readAwarenessState',
      'readOfflineState',
      'readVersionHistory',
      'startAutoInsert',
      'abortAutoInsert',
      'retryAutoInsert',
      'simulateDisconnect',
      'simulateReconnect'
    ]) {
      expect(source).toContain(name)
    }
  })

  it('provider offline history runtime 只通过动态 import 进入 collab demo', () => {
    const mainSource = readWorkspaceText('examples/collab/src/main.ts')
    const staticRuntimeImportPattern = /^\s*import(?!\s+type\b)[^\n]*from\s+'\.\/runtime'/mu
    const lazySource = readWorkspaceText('examples/collab/src/lazy-runtime.ts')

    expect(mainSource).not.toMatch(staticRuntimeImportPattern)
    expect(mainSource).toContain("import('./lazy-runtime')")

    for (const modulePath of [
      './runtime/provider-runtime',
      './runtime/offline-runtime',
      './runtime/history-runtime'
    ]) {
      expect(lazySource).toContain(`import('${modulePath}')`)
    }
  })

  it('Hocuspocus runtime 本地正文写入不直接修改 Y.Text', () => {
    const source = readWorkspaceText('examples/collab/src/runtime/hocuspocus-runtime.ts')

    expect(source).not.toMatch(/\bdocument\.transact\s*\(/u)
    expect(source).not.toMatch(/\btext\.delete\s*\(/u)
    expect(source).not.toMatch(/\btext\.insert\s*\(/u)
    expect(source).toContain('connectJWordCollaboration')
    expect(source).toContain('createHocuspocusCollabProviderAdapter')
    expect(source).toContain('executeCommand')
  })

  it('自动插入 demo 在调用 provider controller 时配置一秒一段的节奏', () => {
    const source = readWorkspaceText('examples/collab/src/runtime/hocuspocus-runtime.ts')
    const memorySource = readWorkspaceText('examples/collab/src/runtime.ts')

    expect(source).toContain('const demoAutoInsertIntervalMs = 1000')
    expect(source).toContain('userEditIdleDelayMs: demoAutoInsertIntervalMs')
    expect(source).toContain('autoInsertPollTimer = setInterval')
    expect(source).toContain('autoInsertController.flushNext()')
    expect(memorySource).toContain('const demoAutoInsertIntervalMs = 1000')
    expect(memorySource).not.toContain('insertToken(autoInsertTokens[autoInsert.insertedCount % autoInsertTokens.length] ?? \'协同\')\n      autoInsert.timerId')
  })

  it('Hocuspocus runtime 通过 persistence adapter 契约接入 provider history', () => {
    const source = readWorkspaceText('examples/collab/src/runtime/hocuspocus-runtime.ts')
    const bridgeSource = readWorkspaceText('examples/collab/src/runtime/hocuspocus-history-bridge.ts')

    expect(source).toContain('createHocuspocusHistoryRuntimeBridge')
    expect(bridgeSource).toContain('createHocuspocusHistoryPersistenceAdapter')
    expect(source).not.toContain('appendHocuspocusHistoryVersion')
    expect(source).not.toContain('previewHocuspocusHistoryVersion')
    expect(source).not.toContain('restoreHocuspocusHistoryVersion')
  })

  it('server TS 入口的本地导入显式携带 .ts 扩展名', () => {
    for (const filePath of [
      'examples/collab/server/dev-server.ts',
      'examples/collab/server/hocuspocus-service.ts',
      'examples/collab/server/hocuspocus-history-api.ts',
      'examples/collab/server/hocuspocus-history-service.ts'
    ]) {
      const source = readWorkspaceText(filePath)

      expect(source).not.toMatch(/from\s+'\.{1,2}\/(?![^']+\.ts')[^']+'/u)
    }
  })

  it('server TS 入口不使用 Node strip-only 不支持的语法', () => {
    for (const filePath of [
      'examples/collab/server/dev-server.ts',
      'examples/collab/server/hocuspocus-service.ts',
      'examples/collab/server/hocuspocus-history-api.ts',
      'examples/collab/server/hocuspocus-history-service.ts'
    ]) {
      const source = readWorkspaceText(filePath)

      expect(source).not.toMatch(/constructor\([^)]*\b(?:private|public|protected|readonly)\b/u)
    }
  })

  it('样式不使用 grid 或 gap，并保留 flex 布局', () => {
    const css = readWorkspaceText('examples/collab/src/styles.css')

    expect(css).toMatch(/\bdisplay\s*:\s*flex\b/u)
    expect(css).not.toMatch(/\bdisplay\s*:\s*grid\b/u)
    expect(css).not.toMatch(/\bgap\s*:/u)
  })

  it('awareness users render in stable client order', () => {
    const users: readonly AwarenessUserSnapshot[] = [
      createAwarenessUser('client-b'),
      createAwarenessUser('client-a'),
      createAwarenessUser('client-c')
    ]

    expect(sortAwarenessUsers(users).map((user) => user.clientId)).toEqual([
      'client-a',
      'client-b',
      'client-c'
    ])
    expect(users.map((user) => user.clientId)).toEqual([
      'client-b',
      'client-a',
      'client-c'
    ])
  })

  it('presence display users expose typing labels and stable overlap offsets without dropping cursors', () => {
    const users: readonly AwarenessUserSnapshot[] = [
      {
        ...createAwarenessUser('client-b'),
        name: 'Bao',
        color: '#0f8f6a',
        cursorOffset: 8,
        selectionStart: 8,
        selectionEnd: 8,
        selectionLabel: 'Bao 正在输入',
        updatedAt: 100
      },
      {
        ...createAwarenessUser('client-a'),
        name: 'Alice',
        color: '#286fd6',
        cursorOffset: 8,
        selectionStart: 8,
        selectionEnd: 8,
        selectionLabel: 'Alice 正在输入',
        updatedAt: 100
      },
      {
        ...createAwarenessUser('client-c'),
        name: 'Chen',
        color: '#a33b8f',
        cursorOffset: 8,
        selectionStart: 8,
        selectionEnd: 8,
        selectionLabel: 'Chen 正在输入',
        updatedAt: 10
      }
    ]

    const displayUsers = createPresenceDisplayUsers(users, {
      now: 140,
      typingExpiresMs: 80,
      overlapOffsetPx: 6
    })

    expect(displayUsers.map((user) => user.clientId)).toEqual([
      'client-a',
      'client-b',
      'client-c'
    ])
    expect(displayUsers.map((user) => user.cursorOffsetPx)).toEqual([0, 6, 12])
    expect(displayUsers.map((user) => user.cursorLabel)).toEqual([
      'Alice 正在输入',
      'Bao 正在输入',
      'Chen cursor 8'
    ])
    expect(displayUsers.map((user) => user.typing)).toEqual([true, true, false])
  })
})

/** 创建用于排序契约的 awareness user 快照。 */
function createAwarenessUser(clientId: string): AwarenessUserSnapshot {
  return {
    clientId,
    name: clientId,
    color: '#286fd6',
    cursorOffset: 0,
    selectionStart: 0,
    selectionEnd: 0,
    connected: true
  }
}

async function loadViteConfigModule(): Promise<{
  createCollabDemoViteConfig: () => {
    readonly resolve?: {
      readonly alias?: AliasEntry | readonly AliasEntry[]
    }
  }
}> {
  const configPath = resolve(process.cwd(), 'examples/collab/vite.config.ts')

  expect(existsSync(configPath)).toBe(true)

  return import(pathToFileURL(configPath).href) as Promise<{
    createCollabDemoViteConfig: () => {
      readonly resolve?: {
        readonly alias?: AliasEntry | readonly AliasEntry[]
      }
    }
  }>
}

function readWorkspaceText(path: string): string {
  const resolved = resolve(process.cwd(), path)

  expect(existsSync(resolved)).toBe(true)

  return readFileSync(resolved, 'utf8')
}

function readWorkspaceJson(path: string): unknown {
  return JSON.parse(readWorkspaceText(path))
}

function normalizeAliasList(alias: AliasEntry | readonly AliasEntry[] | undefined): readonly AliasEntry[] {
  if (alias === undefined) {
    return []
  }

  if (isAliasEntryList(alias)) {
    return alias
  }

  return [alias]
}

/** 判断 Vite alias 配置是否是数组形式。 */
function isAliasEntryList(alias: AliasEntry | readonly AliasEntry[]): alias is readonly AliasEntry[] {
  return Array.isArray(alias)
}

interface AliasEntry {
  readonly find: string | RegExp
  readonly replacement: string
}
