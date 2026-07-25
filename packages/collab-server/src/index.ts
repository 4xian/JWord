/**
 * 职责：导出 Gate 6 self-host 协同服务端的公开启动、版本、授权和 history HTTP 契约。
 * 边界：只提供 Node 的 HTTP 处理器、历史存储适配器和生命周期控制，不承载示例运行时或浏览器协同提供器。
 * 协作模块：packages/license 提供 feature key 与 entitlement 类型；packages/persistence 提供 history update log/snapshot storage。
 * 性能/安全约束：history 读写前必须先过服务端授权 hook；health/version/license status 不读取用户文档内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createServer } from 'node:http'
import type {
  IncomingMessage,
  Server,
  ServerResponse
} from 'node:http'
import {
  GATE6_COLLAB_FEATURES,
  type JWordLicenseEntitlement,
  type JWordLicenseFeatureKey
} from '@4xian/jword-license'
import {
  type JWordHistoryStorage
} from '@4xian/jword-persistence'
import {
  createJWordCollabHistoryService
} from './history-service.js'
import type {
  JWordCollabHistoryService
} from './history-service.js'
import {
  handleJWordAutoInsertRelayRequest
} from './auto-insert-relay.js'
import {
  checkJWordCollabRequestAuth,
  shouldAuthorizeJWordCollabRequest
} from './request-guards.js'
import {
  handleListHistoryVersions,
  handlePreviewHistoryVersion,
  handleRecordHistoryVersion
} from './history-routes.js'
import {
  isHistoryPreviewPath,
  isHistoryVersionsPath,
  isRecord,
  readJsonBody,
  readOptionalEntitlement,
  readOptionalString,
  readString,
  writeJson
} from './http-utils.js'

export {
  GATE6_COLLAB_FEATURES
}
export {
  createJWordCollabHistoryService
} from './history-service.js'
export {
  createJWordCollabHocuspocusServer
} from './hocuspocus-server.js'
export type {
  CreateJWordCollabHistoryServiceOptions,
  JWordCollabHistoryService,
  RecordJWordCollabHistoryVersionInput,
  RecordJWordCollabHistoryVersionResult
} from './history-service.js'
export type {
  CreateJWordCollabHocuspocusServerOptions,
  JWordCollabHocuspocusAuthHook,
  JWordCollabHocuspocusAuthHookInput,
  JWordCollabHocuspocusAuthHookResult,
  JWordCollabHocuspocusRole,
  JWordCollabHocuspocusServer,
  JWordCollabHocuspocusServerState
} from './hocuspocus-server.js'

/** self-host 协同服务端公开协议版本。 */
export const JWORD_COLLAB_SERVER_PROTOCOL_VERSION = 'gate6-collab-v1'
export const JWORD_COLLAB_SERVER_PACKAGE_VERSION = '0.0.0'

export type JWordCollabServerFeatureFlag = typeof GATE6_COLLAB_FEATURES[keyof typeof GATE6_COLLAB_FEATURES]

export interface JWordCollabServerLicenseHookInput {
  readonly documentId: string
  readonly tenantId?: string
  readonly feature: JWordLicenseFeatureKey
  readonly entitlement?: JWordLicenseEntitlement | null
}

export interface JWordCollabServerLicenseHookResult {
  readonly ok: boolean
  readonly diagnosticCode?: string
}

export type JWordCollabServerLicenseHook = (
  input: JWordCollabServerLicenseHookInput
) => Promise<JWordCollabServerLicenseHookResult> | JWordCollabServerLicenseHookResult

/** 创建 self-host 协同 HTTP 服务时的公开配置。 */
export interface CreateJWordCollabServerOptions {
  readonly port?: number
  readonly address?: string
  readonly featureFlags?: readonly JWordCollabServerFeatureFlag[]
  readonly minimumClientVersion?: string
  readonly minimumServerVersion?: string
  readonly authHook?: JWordCollabServerAuthHook
  readonly tenantHook?: JWordCollabServerTenantHook
  readonly licenseHook?: JWordCollabServerLicenseHook
  readonly historyStorage?: JWordHistoryStorage
  readonly maxHistoryDocumentLockQueueDepth?: number
  readonly snapshotStorage?: unknown
  readonly rateLimit?: JWordCollabServerRateLimitOptions
  readonly maxPayloadBytes?: number
  readonly allowedOrigins?: readonly string[]
  readonly logger?: JWordCollabServerLogger
}

/** self-host 协同服务启动后的公开运行状态。 */
export interface JWordCollabServerState {
  readonly address: string
  readonly port: number
  readonly httpUrl: string
  readonly protocolVersion: string
  readonly packageVersion: string
  readonly featureFlags: readonly JWordCollabServerFeatureFlag[]
  readonly minimumClientVersion: string
  readonly minimumServerVersion: string
}

export interface JWordCollabServerAuthHookInput {
  readonly requestId: string
  readonly method: string
  readonly path: string
}

export interface JWordCollabServerAuthHookResult {
  readonly ok: boolean
  readonly diagnosticCode?: string
  readonly userId?: string
}

export type JWordCollabServerAuthHook = (
  input: JWordCollabServerAuthHookInput
) => Promise<JWordCollabServerAuthHookResult> | JWordCollabServerAuthHookResult

export interface JWordCollabServerTenantHookInput {
  readonly requestId: string
  readonly documentId: string
  readonly tenantId?: string
}

export interface JWordCollabServerTenantHookResult {
  readonly ok: boolean
  readonly diagnosticCode?: string
}

export type JWordCollabServerTenantHook = (
  input: JWordCollabServerTenantHookInput
) => Promise<JWordCollabServerTenantHookResult> | JWordCollabServerTenantHookResult

export interface JWordCollabServerRateLimitOptions {
  readonly windowMs: number
  readonly maxRequests: number
}

interface JWordCollabRateLimitDecision {
  readonly ok: boolean
  readonly retryAfterMs?: number
}

interface JWordCollabRateLimiter {
  check(key: string, now: number): JWordCollabRateLimitDecision
}

export interface JWordCollabServerLogger {
  /** 记录普通服务事件。 */
  info(message: string, metadata?: Readonly<Record<string, unknown>>): void

  /** 记录可恢复服务警告。 */
  warn(message: string, metadata?: Readonly<Record<string, unknown>>): void

  /** 记录不可恢复服务错误。 */
  error(message: string, metadata?: Readonly<Record<string, unknown>>): void
}

export interface JWordCollabServer {
  /** 启动 self-host 协同服务端。 */
  start(): Promise<JWordCollabServerState>

  /** 停止 self-host 协同服务端。 */
  stop(): Promise<void>

  /** 读取最近一次启动后的服务状态。 */
  readState(): JWordCollabServerState | null
}

export type JWordCollabNodeRequestHandler = (
  request: IncomingMessage,
  response: ServerResponse
) => Promise<void>

const defaultAddress = '127.0.0.1'
const defaultPort = 0
const defaultMinimumClientVersion = '0.0.0'
const defaultMinimumServerVersion = '0.0.0'
const defaultMaxPayloadBytes = 1024 * 1024
const defaultFeatureFlags = [
  GATE6_COLLAB_FEATURES.multiplayer,
  GATE6_COLLAB_FEATURES.server
] as const
const licenseHookRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
let requestSequence = 0

/** 创建不自动监听端口的 self-host 协同服务端。 */
export function createJWordCollabServer(
  options: CreateJWordCollabServerOptions = {}
): JWordCollabServer {
  const address = options.address ?? defaultAddress
  const port = options.port ?? defaultPort
  const featureFlags = options.featureFlags ?? defaultFeatureFlags
  const minimumClientVersion = options.minimumClientVersion ?? defaultMinimumClientVersion
  const minimumServerVersion = options.minimumServerVersion ?? defaultMinimumServerVersion
  const requestHandler = createJWordCollabRequestHandler(options)
  const server = createServer((request, response) => {
    void requestHandler(request, response)
  })
  let state: JWordCollabServerState | null = null

  return {
    /** 启动 self-host 协同服务端。 */
    async start() {
      if (state !== null) {
        return state
      }

      await listen(server, address, port)
      const serverAddress = server.address()

      if (typeof serverAddress !== 'object' || serverAddress === null) {
        throw new Error('JWord collab server did not expose a TCP address.')
      }

      state = createServerState(
        address,
        serverAddress.port,
        featureFlags,
        minimumClientVersion,
        minimumServerVersion
      )

      return state
    },

    /** 停止 self-host 协同服务端。 */
    async stop() {
      if (state === null) {
        return
      }

      await closeServer(server)
      state = null
    },

    /** 读取最近一次启动后的服务状态。 */
    readState() {
      return state
    }
  }
}

/** 创建可嵌入到第三方 Node HTTP server 的请求处理器。 */
export function createJWordCollabRequestHandler(
  options: CreateJWordCollabServerOptions = {}
): JWordCollabNodeRequestHandler {
  const handlerOptions = createRequestHandlerOptions(options)

  return async (request, response) => {
    try {
      await handleServerRequest(request, response, handlerOptions)
    } catch (error: unknown) {
      const requestId = createRequestId()

      options.logger?.error('JWord collab server request failed.', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      })
      writeJson(response, 500, {
        ok: false,
        diagnosticCode: 'JWORD_COLLAB_SERVER_INTERNAL_ERROR',
        requestId
      }, options.allowedOrigins, request.headers.origin)
    }
  }
}

/** 创建并启动 self-host 协同服务端。 */
export async function startJWordCollabServer(
  options: CreateJWordCollabServerOptions = {}
): Promise<JWordCollabServer> {
  const server = createJWordCollabServer(options)

  await server.start()

  return server
}

/** 处理 self-host 服务端公开 HTTP 请求。 */
async function handleServerRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: RequestHandlerOptions
): Promise<void> {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const requestId = createRequestId()

  if (request.method === 'OPTIONS') {
    writeJson(response, 204, { requestId }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/health') {
    writeJson(response, 200, {
      status: 'ok',
      protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
      packageVersion: JWORD_COLLAB_SERVER_PACKAGE_VERSION,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/version') {
    writeJson(response, 200, {
      protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
      packageVersion: JWORD_COLLAB_SERVER_PACKAGE_VERSION,
      featureFlags: options.featureFlags,
      minimumClientVersion: options.minimumClientVersion,
      minimumServerVersion: options.minimumServerVersion,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const rateLimit = options.rateLimiter?.check(readRateLimitKey(request), Date.now())

  if (rateLimit !== undefined && !rateLimit.ok) {
    writeJson(response, 429, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_SERVER_RATE_LIMITED',
      retryAfterMs: rateLimit.retryAfterMs ?? 0,
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  if (shouldAuthorizeJWordCollabRequest(request.method ?? 'GET', url.pathname)) {
    const auth = await checkJWordCollabRequestAuth(options.authHook, requestId, request.method ?? 'GET', url.pathname)

    if (!auth.ok) {
      writeJson(response, 401, {
        ok: false,
        diagnosticCode: auth.diagnosticCode,
        requestId
      }, options.allowedOrigins, request.headers.origin)
      return
    }
  }

  if (request.method === 'POST' && url.pathname === '/license/status') {
    await handleLicenseStatus(request, response, requestId, options)
    return
  }

  if (request.method === 'POST' && url.pathname === '/auto-insert/relay') {
    await handleJWordAutoInsertRelayRequest(request, response, requestId, options)
    return
  }

  if (request.method === 'GET' && url.pathname === '/history/versions') {
    await handleListHistoryVersions(request, url, response, requestId, options, request.headers.origin)
    return
  }

  if (request.method === 'GET' && url.pathname === '/jword-history/versions') {
    await handleListHistoryVersions(request, url, response, requestId, options, request.headers.origin)
    return
  }

  if (request.method === 'POST' && isHistoryVersionsPath(url.pathname)) {
    await handleRecordHistoryVersion(request, response, requestId, options)
    return
  }

  if (request.method === 'POST' && isHistoryPreviewPath(url.pathname)) {
    await handlePreviewHistoryVersion(request, response, requestId, options)
    return
  }

  writeJson(response, 404, {
    error: 'JWORD_COLLAB_SERVER_NOT_FOUND',
    requestId
  }, options.allowedOrigins, request.headers.origin)
}

class SlidingWindowRateLimiter implements JWordCollabRateLimiter {
  private readonly windowMs: number
  private readonly maxRequests: number
  private readonly requestTimesByKey = new Map<string, number[]>()

  /** 绑定滑窗限流参数。 */
  constructor(options: JWordCollabServerRateLimitOptions) {
    this.windowMs = Math.max(1, Math.floor(options.windowMs))
    this.maxRequests = Math.max(1, Math.floor(options.maxRequests))
  }

  /** 判断当前 key 在滑窗内是否仍可接受请求。 */
  check(key: string, now: number): JWordCollabRateLimitDecision {
    const windowStart = now - this.windowMs
    const requestTimes = (this.requestTimesByKey.get(key) ?? []).filter((time) => time > windowStart)

    if (requestTimes.length >= this.maxRequests) {
      this.requestTimesByKey.set(key, requestTimes)
      const firstRequestTime = requestTimes[0] ?? now

      return {
        ok: false,
        retryAfterMs: Math.max(1, this.windowMs - (now - firstRequestTime))
      }
    }

    requestTimes.push(now)
    this.requestTimesByKey.set(key, requestTimes)

    return { ok: true }
  }
}

/** 创建请求处理器共享的滑窗限流器。 */
function createRateLimiter(options: JWordCollabServerRateLimitOptions): JWordCollabRateLimiter {
  return new SlidingWindowRateLimiter(options)
}

/** 读取最小限流维度，默认按远端地址隔离。 */
function readRateLimitKey(request: IncomingMessage): string {
  return request.socket.remoteAddress ?? 'unknown-client'
}

/** 监听 Node HTTP server。 */
function listen(server: Server, address: string, port: number): Promise<void> {
  return new Promise((resolve) => {
    server.listen(port, address, resolve)
  })
}

/** 关闭 Node HTTP server。 */
function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve()
        return
      }

      reject(error)
    })
  })
}

/** 创建公开服务状态。 */
function createServerState(
  address: string,
  port: number,
  featureFlags: readonly JWordCollabServerFeatureFlag[],
  minimumClientVersion: string,
  minimumServerVersion: string
): JWordCollabServerState {
  return {
    address,
    port,
    httpUrl: `http://${address}:${port}`,
    protocolVersion: JWORD_COLLAB_SERVER_PROTOCOL_VERSION,
    packageVersion: JWORD_COLLAB_SERVER_PACKAGE_VERSION,
    featureFlags,
    minimumClientVersion,
    minimumServerVersion
  }
}

interface RequestHandlerOptions extends Required<Pick<
  CreateJWordCollabServerOptions,
  'address' | 'port' | 'featureFlags' | 'minimumClientVersion' | 'minimumServerVersion' | 'maxPayloadBytes'
>> {
  readonly licenseHook?: JWordCollabServerLicenseHook
  readonly historyStorage?: JWordHistoryStorage
  readonly maxHistoryDocumentLockQueueDepth?: number
  readonly historyService?: JWordCollabHistoryService
  readonly rateLimiter?: JWordCollabRateLimiter
  readonly authHook?: JWordCollabServerAuthHook
  readonly tenantHook?: JWordCollabServerTenantHook
  readonly allowedOrigins?: readonly string[]
  readonly logger?: JWordCollabServerLogger
}

/** 归一化公开 server options，供启动器和嵌入 handler 共用。 */
function createRequestHandlerOptions(options: CreateJWordCollabServerOptions): RequestHandlerOptions {
  return {
    address: options.address ?? defaultAddress,
    port: options.port ?? defaultPort,
    featureFlags: options.featureFlags ?? defaultFeatureFlags,
    minimumClientVersion: options.minimumClientVersion ?? defaultMinimumClientVersion,
    minimumServerVersion: options.minimumServerVersion ?? defaultMinimumServerVersion,
    maxPayloadBytes: options.maxPayloadBytes ?? defaultMaxPayloadBytes,
    ...(options.rateLimit === undefined ? {} : { rateLimiter: createRateLimiter(options.rateLimit) }),
    ...(options.authHook === undefined ? {} : { authHook: options.authHook }),
    ...(options.tenantHook === undefined ? {} : { tenantHook: options.tenantHook }),
    ...(options.licenseHook === undefined ? {} : { licenseHook: options.licenseHook }),
    ...(options.historyStorage === undefined ? {} : { historyStorage: options.historyStorage }),
    ...(options.maxHistoryDocumentLockQueueDepth === undefined ? {} : {
      maxHistoryDocumentLockQueueDepth: options.maxHistoryDocumentLockQueueDepth
    }),
    ...(options.historyStorage === undefined ? {} : {
      historyService: createJWordCollabHistoryService({
        storage: options.historyStorage,
        ...(options.maxHistoryDocumentLockQueueDepth === undefined ? {} : {
          maxDocumentLockQueueDepth: options.maxHistoryDocumentLockQueueDepth
        })
      })
    }),
    ...(options.allowedOrigins === undefined ? {} : { allowedOrigins: options.allowedOrigins }),
    ...(options.logger === undefined ? {} : { logger: options.logger })
  }
}

interface RecordHistoryVersionRequest {
  readonly documentId: string
  readonly roomId: string
  readonly clientId: string
  readonly authorId: string
  readonly origin: string
  readonly label: string
  readonly updateBase64: string
  readonly snapshotId?: string
  readonly createdAt?: string
  readonly tenantId?: string
  readonly entitlement?: JWordLicenseEntitlement | null
}

interface LicenseStatusRequest {
  readonly documentId: string
  readonly tenantId?: string
  readonly feature: JWordLicenseFeatureKey
  readonly entitlement?: JWordLicenseEntitlement | null
}

/** 处理公开授权状态请求。 */
async function handleLicenseStatus(
  request: IncomingMessage,
  response: ServerResponse,
  requestId: string,
  options: RequestHandlerOptions
): Promise<void> {
  const body = readLicenseStatusRequest(await readJsonBody(request, options.maxPayloadBytes))

  if (body === null) {
    writeJson(response, 400, {
      ok: false,
      diagnosticCode: 'JWORD_COLLAB_LICENSE_STATUS_PAYLOAD_INVALID',
      requestId
    }, options.allowedOrigins, request.headers.origin)
    return
  }

  const license = await checkLicense(options.licenseHook, body)

  writeJson(response, license.ok ? 200 : 403, {
    ok: license.ok,
    feature: body.feature,
    ...(license.diagnosticCode === undefined ? {} : { diagnosticCode: license.diagnosticCode }),
    requestId
  }, options.allowedOrigins, request.headers.origin)
}

/** 调用宿主授权 hook，默认仅用于本地开发放行。 */
async function checkLicense(
  licenseHook: JWordCollabServerLicenseHook | undefined,
  input: JWordCollabServerLicenseHookInput
): Promise<JWordCollabServerLicenseHookResult> {
  if (licenseHook === undefined) {
    return {
      ok: false,
      diagnosticCode: licenseHookRequiredDiagnosticCode
    }
  }

  return licenseHook(input)
}

/** 校验授权状态请求体。 */
function readLicenseStatusRequest(value: unknown): LicenseStatusRequest | null {
  if (!isRecord(value)) {
    return null
  }

  const documentId = readString(value.documentId)
  const tenantId = readOptionalString(value.tenantId)
  const feature = readFeatureKey(value.feature)
  const entitlement = readOptionalEntitlement(value.entitlement)

  return documentId === null || feature === null
    ? null
    : {
        documentId,
        feature,
        ...(tenantId === undefined ? {} : { tenantId }),
        ...(entitlement === undefined ? {} : { entitlement })
  }
}

/** 创建可观测请求 id。 */
function createRequestId(): string {
  requestSequence += 1

  return `jword-collab-server-${Date.now().toString(36)}-${requestSequence.toString(36)}`
}

/** 读取公开 feature key。 */
function readFeatureKey(value: unknown): JWordLicenseFeatureKey | null {
  if (typeof value !== 'string') {
    return null
  }

  return Object.values(GATE6_COLLAB_FEATURES).includes(value as JWordCollabServerFeatureFlag)
    ? value as JWordLicenseFeatureKey
    : null
}
