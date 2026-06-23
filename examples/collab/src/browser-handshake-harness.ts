/**
 * 职责：为浏览器握手验收提供基于公开 @4xian/jword-collab 入口的测试 harness。
 * 边界：只封装 Playwright 页面内 handshake 调用，不导出给第三方宿主作为集成 API。
 * 协作模块：collab-handshake.e2e.ts、@4xian/jword-collab 和 demo Vite package 解析。
 * 约束：不得通过 /@fs 或 workspace src 路径加载协作包。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.47-6.49。
 */
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type JWordLicenseFeatureKey
} from '@4xian/jword-collab'

export interface BrowserHandshakeHarnessInput {
  readonly serverUrl: string
  readonly features: readonly JWordLicenseFeatureKey[]
}

export interface BrowserHandshakeHarnessResult {
  readonly status: string
  readonly diagnosticCodes: readonly string[]
  readonly providerStatus: string
  readonly handshake: unknown
}

/** 通过公开 collab client SDK 执行一次浏览器握手。 */
export async function runPublicCollabBrowserHandshake(
  input: BrowserHandshakeHarnessInput
): Promise<BrowserHandshakeHarnessResult> {
  const provider = createMemoryCollabProviderAdapter({
    documentId: 'doc-browser-handshake',
    roomId: 'room-browser-handshake',
    clientId: 'browser-user'
  })
  const connection = await connectJWordCollaboration({
    /** 编码测试文档 update。 */
    encodeSyncUpdate() {
      return new Uint8Array([1, 2, 3])
    },
    /** 应用远端 update。 */
    applySyncUpdate() {
      return {
        ok: true
      }
    }
  }, {
    serverUrl: input.serverUrl,
    documentId: 'doc-browser-handshake',
    roomId: 'room-browser-handshake',
    user: {
      id: 'browser-user',
      name: 'Browser User'
    },
    token: 'browser-token',
    license: {
      customerId: 'browser-customer',
      licenseToken: 'browser-license',
      features: Object.values(GATE6_COLLAB_FEATURES),
      status: 'valid'
    },
    features: input.features,
    provider
  })

  return {
    status: connection.status,
    diagnosticCodes: connection.diagnostics.map((diagnostic) => diagnostic.code),
    providerStatus: provider.status,
    handshake: connection.handshake
  }
}
