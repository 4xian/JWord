/**
 * 职责：为浏览器握手验收提供基于公开 @4xian/jword-collab 入口的测试 harness。
 * 边界：只封装 Playwright 页面内 handshake 调用，不导出给第三方宿主作为集成 API。
 * 协作模块：collab-handshake.e2e.ts、@4xian/jword-collab 和 demo Vite package 解析。
 * 约束：不得通过 /@fs 或 workspace src 路径加载协作包。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter,
  type JWordLicenseFeatureKey
} from '@4xian/jword-collab'
import {
  type JWordLicenseEntitlement,
  type JWordLicenseSignaturePayload
} from '@4xian/jword-license'
import { INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN } from '../../../fixtures/license/insecure-test-only-jwl1-fixture.mjs'

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

export interface BrowserHandshakeHarnessApi {
  readonly runPublicCollabBrowserHandshake: typeof runPublicCollabBrowserHandshake
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
    license: createBrowserHandshakeLicense(),
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

/** 创建浏览器握手测试使用的固定 insecure-test-only 授权。 */
function createBrowserHandshakeLicense(): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'browser-customer',
    licenseToken: 'browser-license',
    features: Object.values(GATE6_COLLAB_FEATURES),
    issuer: 'jword-browser-handshake-test',
    issuedAt: '2026-05-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: INSECURE_TEST_ONLY_JWL1_FIXTURE_TOKEN
  }
}

if (typeof window !== 'undefined') {
  window.__jwordCollabHandshakeHarness = {
    runPublicCollabBrowserHandshake
  }
}

declare global {
  interface Window {
    __jwordCollabHandshakeHarness?: BrowserHandshakeHarnessApi
  }
}
