/**
 * 职责：执行 Gate 6 第三方空项目集成 smoke。
 * 边界：只从当前 workspace 打包并安装公开包，再运行公开 API 演示；不发布包、不读取源码路径。
 * 协作模块：packages/core、packages/ui、packages/native、packages/collab、packages/collab-server、packages/license 和 packages/persistence。
 * 约束：smoke 项目必须从空目录安装包，并演示协作连接、自动插入、历史版本和未授权失败路径。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-651补第三方集成-readme-草稿和-smoke-script。
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const workspacePackages = [
  {
    name: '@4xian/jword-core',
    dir: 'packages/core'
  },
  {
    name: '@4xian/jword-ui',
    dir: 'packages/ui'
  },
  {
    name: '@4xian/jword-native',
    dir: 'packages/native'
  },
  {
    name: '@4xian/jword-license',
    dir: 'packages/license'
  },
  {
    name: '@4xian/jword-persistence',
    dir: 'packages/persistence'
  },
  {
    name: '@4xian/jword-collab',
    dir: 'packages/collab'
  },
  {
    name: '@4xian/jword-collab-server',
    dir: 'packages/collab-server'
  }
]

const workspaceDir = mkdtempSync(join(tmpdir(), 'jword-gate6-third-party-smoke-'))
const packDir = join(workspaceDir, 'packs')
const projectDir = join(workspaceDir, 'empty-project')

/** 打包 Gate 6 smoke 需要的 workspace 包。 */
function packWorkspacePackages(packDir) {
  execFileSync('mkdir', ['-p', packDir], {
    cwd: repoRoot
  })
  const packs = {}

  for (const workspacePackage of workspacePackages) {
    const before = new Set(readPackFiles(packDir))

    execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: join(repoRoot, workspacePackage.dir),
      stdio: 'pipe'
    })

    const after = readPackFiles(packDir)
    const created = after.find((file) => !before.has(file))

    if (created === undefined) {
      throw new Error(`Missing npm pack artifact for ${workspacePackage.name}.`)
    }

    packs[workspacePackage.name] = join(packDir, created)
    assertPackManifest(workspacePackage.name, packs[workspacePackage.name])
  }

  return packs
}

/** 读取 pack 目录下已有 tgz 文件。 */
function readPackFiles(packDir) {
  try {
    return readdirSync(packDir).filter((file) => file.endsWith('.tgz')).sort()
  } catch {
    return []
  }
}

/** 校验 pnpm pack 已把 workspace 协议改写为可安装版本。 */
function assertPackManifest(packageName, packPath) {
  const manifest = execFileSync('tar', ['-xOf', packPath, 'package/package.json'], {
    encoding: 'utf8'
  })

  if (manifest.includes('workspace:*')) {
    throw new Error(`${packageName} pack still contains workspace:* and cannot be installed from an empty project.`)
  }
}

/** 写入空项目 package.json，并用 overrides 让传递依赖也解析到本地 tarball。 */
function writeEmptyProject(projectDir, packs) {
  execFileSync('mkdir', ['-p', projectDir], {
    cwd: repoRoot
  })
  const dependencies = Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    `file:../packs/${basename(packPath)}`
  ]))
  const packageJson = {
    private: true,
    type: 'module',
    name: 'gate6-third-party-smoke',
    scripts: {
      smoke: 'node smoke.mjs'
    },
    dependencies,
    pnpm: {
      overrides: dependencies
    }
  }

  writeFileSync(join(projectDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`)
}

/** 在空项目内安装基础包、高级包和 server 包。 */
function installEmptyProject(projectDir) {
  execFileSync('pnpm', ['install', '--ignore-scripts'], {
    cwd: projectDir,
    stdio: 'pipe'
  })
}

/** 写入只通过公开 API 运行的第三方 smoke 程序。 */
function writeSmokeProgram(projectDir) {
  writeFileSync(join(projectDir, 'smoke.mjs'), smokeProgramSource)
}

/** 执行第三方 smoke 程序。 */
function runSmokeProgram(projectDir) {
  execFileSync('node', ['smoke.mjs'], {
    cwd: projectDir,
    stdio: 'inherit'
  })
}

const smokeProgramSource = String.raw`
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
import {
  createJWordCollabServer
} from '@4xian/jword-collab-server'
import {
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'
import {
  createInsecureTestOnlyJWordLicenseSignature
} from '@4xian/jword-license'

const INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED = 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A'

const server = createJWordCollabServer({
  address: '127.0.0.1',
  port: 0,
  featureFlags: Object.values(GATE6_COLLAB_FEATURES),
  historyStorage: createVolatileHistoryStorage(),
  licenseHook: ({ feature }) => ({
    ok: feature === GATE6_COLLAB_FEATURES.server || feature === GATE6_COLLAB_FEATURES.history,
    diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
  })
})
const state = await server.start()
const editor = createExternalEditor()
const provider = createMemoryCollabProviderAdapter({
  documentId: 'doc-third-party-smoke',
  roomId: 'room-third-party-smoke',
  clientId: 'user-a'
})
const sentUpdates = []
const originalSendUpdate = provider.sendUpdate.bind(provider)

provider.sendUpdate = async (update, metadata) => {
  sentUpdates.push({
    byteLength: update.byteLength,
    metadata
  })
  await originalSendUpdate(update, metadata)
}

try {
  const connection = await connectJWordCollaboration(editor, {
    serverUrl: state.httpUrl,
    documentId: 'doc-third-party-smoke',
    roomId: 'room-third-party-smoke',
    user: {
      id: 'user-a',
      name: 'Alice'
    },
    token: 'host-issued-token',
    license: createGate6License(),
    features: [
      GATE6_COLLAB_FEATURES.multiplayer,
      GATE6_COLLAB_FEATURES.history,
      GATE6_COLLAB_FEATURES.autoInsert
    ],
    provider
  })

  assert(connection.status === 'synced', 'connectJWordCollaboration should reach synced status.')

  editor.emitTransaction('local-user')
  assert(sentUpdates.length === 1, 'local editor transaction should publish a provider update.')
  assert(sentUpdates[0].metadata.origin === 'local', 'published provider update should use local origin metadata.')

  const version = await connection.history.recordVersion({
    label: 'third-party initial'
  })
  const versions = await connection.history.listVersions()

  assert(
    versions.some((item) => item.documentId === version.documentId && item.label === version.label),
    'history.recordVersion should be visible in server listVersions.'
  )
  assert(!connection.diagnostics.some((diagnostic) => diagnostic.code === 'COLLAB_HISTORY_SERVER_FALLBACK'), 'history should use server-backed HTTP APIs.')

  const autoInsert = connection.startAutoInsertSession({
    requestId: 'third-party-auto-insert',
    position: {
      anchor: createAnchor('doc-third-party-smoke', 0)
    }
  })

  assert(autoInsert.status === 'running', 'startAutoInsertSession should create a running session.')
  assert(autoInsert.write('协作 smoke')?.ok === true, 'auto insert write should succeed.')
  assert(editor.appliedUpdates.some((update) => update.text === '协作 smoke'), 'auto insert should enter the host editor facade.')

  const missingLicenseDiagnosticSourceCode = 'JWORD_LICENSE_MISSING'
  const denied = await connectJWordCollaboration(createExternalEditor(), {
    serverUrl: state.httpUrl,
    documentId: 'doc-third-party-smoke-denied',
    roomId: 'room-third-party-smoke-denied',
    user: {
      id: 'user-denied',
      name: 'Denied'
    },
    token: 'host-issued-token',
    license: undefined,
    features: [GATE6_COLLAB_FEATURES.multiplayer],
    provider: createMemoryCollabProviderAdapter({
      documentId: 'doc-third-party-smoke-denied',
      roomId: 'room-third-party-smoke-denied',
      clientId: 'user-denied'
    })
  })

  assert(denied.status === 'error', 'missing license should fail before collaboration starts.')
  assert(
    denied.diagnostics.some((diagnostic) => diagnostic.code === missingLicenseDiagnosticSourceCode.replace('JWORD_', 'COLLAB_')),
    'missing license should be reported as COLLAB_LICENSE_MISSING.'
  )

  await denied.destroy()
  await connection.destroy()
} finally {
  await server.stop()
}

console.log(JSON.stringify({
  status: 'ok',
  collaboration: 'synced',
  localUpdate: 'published',
  history: 'server-backed',
  autoInsert: 'written',
  unauthorized: 'COLLAB_LICENSE_MISSING'
}))

/** 创建第三方宿主最小 editor facade。 */
function createExternalEditor() {
  const appliedUpdates = []
  const listeners = new Set()

  return {
    appliedUpdates,
    encodeSyncUpdate() {
      return new Uint8Array([0, 0])
    },
    applySyncUpdate(update, options) {
      if (options.origin === 'auto-inserter') {
        appliedUpdates.push({
          text: new TextDecoder().decode(update),
          requestId: options.requestId ?? '',
          actorId: options.clientId,
          undoScope: options.undoScope ?? null
        })
      }

      return {
        ok: true
      }
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    emitTransaction(origin) {
      for (const listener of listeners) {
        listener({
          kind: 'transaction',
          transaction: {
            origin
          }
        })
      }
    }
  }
}

/** 创建能生成合法协作 update 的第三方宿主 editor。 */
/** 创建覆盖 Gate 6 smoke 路径的授权对象。 */
function createGate6License() {
  const entitlement = {
    customerId: 'customer-third-party-smoke',
    licenseToken: 'license-third-party-smoke',
    features: Object.values(GATE6_COLLAB_FEATURES),
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-01-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 创建自动插入使用的显式锚点。 */
function createAnchor(documentId, graphemeIndex) {
  return {
    documentId,
    sectionId: 'body-section',
    blockId: 'body',
    runId: 'body',
    graphemeIndex,
    relativePosition: {
      type: null,
      tname: 'body',
      item: null,
      assoc: -1
    }
  }
}

/** 断言 smoke 条件成立。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}
`

const packs = packWorkspacePackages(packDir)
writeEmptyProject(projectDir, packs)
installEmptyProject(projectDir)
writeSmokeProgram(projectDir)
runSmokeProgram(projectDir)

console.log(JSON.stringify({
  status: 'ok',
  name: 'gate6-third-party-smoke',
  installStatus: 'installed-from-local-packs',
  projectDir,
  packages: Object.fromEntries(Object.entries(packs).map(([name, packPath]) => [
    name,
    relative(repoRoot, packPath)
  ]))
}, null, 2))
