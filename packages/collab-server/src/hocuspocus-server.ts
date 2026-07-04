/**
 * 职责：提供正式 @4xian/jword-collab-server 包内的 Hocuspocus WebSocket 服务控制器。
 * 边界：只封装 Node WebSocket 协同服务、room 前缀、token 校验和服务端授权边界，不接浏览器 UI 或 demo runtime。
 * 协作模块：@hocuspocus/server 承载 Yjs 同步；packages/license 提供 Gate 6 server feature key。
 * 性能/安全约束：服务端连接和客户端 update 写入前必须经过授权 hook，未授权时不进入正常同步路径。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-633。
 */

import { Server as HocuspocusServer } from '@hocuspocus/server'
import {
  GATE6_COLLAB_FEATURES
} from '@4xian/jword-license'

import type {
  JWordCollabServerTenantHook,
  JWordCollabServerLicenseHook,
  JWordCollabServerLicenseHookResult
} from './index.js'

export type JWordCollabHocuspocusRole = 'read' | 'write'

export interface JWordCollabHocuspocusAuthHookInput {
  /** Hocuspocus 连接请求 ID。 */
  readonly requestId: string
  /** 原始 Hocuspocus documentName。 */
  readonly roomId: string
  /** 解析后的租户 ID；无租户段时为 default。 */
  readonly tenantId: string
  /** 解析后的文档 ID。 */
  readonly documentId: string
  /** 可选用户 ID，来自连接 query 参数 userId/clientId。 */
  readonly userId?: string
  /** 可选认证 token。 */
  readonly token?: string
}

export interface JWordCollabHocuspocusAuthHookResult {
  /** 是否允许建立连接。 */
  readonly allow: boolean
  /** 连接权限粒度；read 只能同步，write 才能提交 update。 */
  readonly role?: JWordCollabHocuspocusRole
  /** 宿主侧稳定用户 ID。 */
  readonly userId?: string
  /** 拒绝时返回的稳定诊断码。 */
  readonly diagnosticCode?: string
}

export type JWordCollabHocuspocusAuthHook = (
  input: JWordCollabHocuspocusAuthHookInput
) => Promise<JWordCollabHocuspocusAuthHookResult> | JWordCollabHocuspocusAuthHookResult

export interface CreateJWordCollabHocuspocusServerOptions {
  /** WebSocket 服务端口；传 0 时由系统分配随机端口。 */
  readonly port?: number
  /** WebSocket 监听地址。 */
  readonly address?: string
  /** 允许进入本服务的 documentName 前缀。 */
  readonly roomPrefix?: string
  /** 可选认证 token；设置后客户端 token 必须完全一致。 */
  readonly requiredToken?: string
  /** 测试或灰度开关：拒绝客户端提交的 Yjs update。 */
  readonly rejectUpdates?: boolean
  /** WebSocket 连接认证 hook；未提供时默认拒绝正式协同连接。 */
  readonly authHook?: JWordCollabHocuspocusAuthHook
  /** 租户隔离 hook；用于阻断跨 tenant/documentName 访问。 */
  readonly tenantHook?: JWordCollabServerTenantHook
  /** 服务端授权 hook；宿主应在这里校验 collaboration.server 权限。 */
  readonly licenseHook?: JWordCollabServerLicenseHook
}

export interface JWordCollabHocuspocusServerState {
  /** 实际监听端口。 */
  readonly port: number
  /** 实际监听地址。 */
  readonly address: string
  /** 允许进入本服务的 documentName 前缀。 */
  readonly roomPrefix: string
  /** HTTP 健康页面地址，由 Hocuspocus 内置响应提供。 */
  readonly httpUrl: string
  /** Yjs WebSocket 连接地址。 */
  readonly webSocketUrl: string
}

export interface JWordCollabHocuspocusServer {
  /** 启动正式 Hocuspocus WebSocket 服务。 */
  start(): Promise<JWordCollabHocuspocusServerState>

  /** 停止正式 Hocuspocus WebSocket 服务。 */
  stop(): Promise<void>

  /** 读取最近一次启动后的服务状态。 */
  readState(): JWordCollabHocuspocusServerState | null
}

const defaultHocuspocusPort = 4188
const defaultHocuspocusAddress = '127.0.0.1'
const defaultHocuspocusRoomPrefix = 'jword-collab'
const authHookRequiredDiagnosticCode = 'JWORD_COLLAB_AUTH_HOOK_REQUIRED'
const licenseHookRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
const permissionDeniedDiagnosticCode = 'COLLAB_PERMISSION_DENIED'
const yjsUpdateMessageType = 2

interface HocuspocusDocumentScope {
  readonly roomId: string
  readonly tenantId: string
  readonly documentId: string
}

interface HocuspocusConnectionContext {
  jword?: {
    readonly tenantId: string
    readonly documentId: string
    readonly roomId: string
    readonly userId?: string
    readonly role: JWordCollabHocuspocusRole
  }
}

/** 创建正式 Hocuspocus WebSocket 服务控制器。 */
export function createJWordCollabHocuspocusServer(
  options: CreateJWordCollabHocuspocusServerOptions = {}
): JWordCollabHocuspocusServer {
  const address = options.address ?? defaultHocuspocusAddress
  const roomPrefix = options.roomPrefix ?? defaultHocuspocusRoomPrefix
  const server = new HocuspocusServer<HocuspocusConnectionContext>({
    port: options.port ?? defaultHocuspocusPort,
    address,
    name: 'jword-collab-server',
    quiet: true,
    stopOnSignals: false,
    extensions: [{
      extensionName: 'jword-collab-server-guard',
      async onConnect({ context, documentName, requestParameters, socketId }) {
        const scope = readHocuspocusDocumentScope(documentName, roomPrefix)
        const tenant = await checkHocuspocusTenant(options.tenantHook, scope, socketId)

        if (!tenant.ok) {
          throw createHocuspocusAuthError(tenant.diagnosticCode ?? 'COLLAB_TENANT_DENIED')
        }

        if (options.authHook === undefined) {
          throw createHocuspocusAuthError(authHookRequiredDiagnosticCode)
        }

        if (options.requiredToken === undefined) {
          const auth = await authenticateHocuspocusConnection(options.authHook, scope, socketId, requestParameters)

          context.jword = {
            tenantId: scope.tenantId,
            documentId: scope.documentId,
            roomId: scope.roomId,
            role: auth.role,
            ...(auth.userId === undefined ? {} : { userId: auth.userId })
          }
        }
      },
      async onAuthenticate({ context, documentName, requestParameters, socketId, token }) {
        if (options.requiredToken !== undefined && token !== options.requiredToken) {
          throw createHocuspocusAuthError('JWord collab server auth failed')
        }

        const scope = readHocuspocusDocumentScope(documentName, roomPrefix)
        const auth = await authenticateHocuspocusConnection(
          options.authHook,
          scope,
          socketId,
          requestParameters,
          token
        )
        const license = await checkHocuspocusServerLicense(options.licenseHook, scope)

        if (!license.ok) {
          throw createHocuspocusAuthError(license.diagnosticCode ?? 'JWORD_COLLAB_SERVER_NOT_ENTITLED')
        }

        context.jword = {
          tenantId: scope.tenantId,
          documentId: scope.documentId,
          roomId: scope.roomId,
          role: auth.role,
          ...(auth.userId === undefined ? {} : { userId: auth.userId })
        }
      },
      async beforeSync({ context, documentName, type }) {
        if (type !== yjsUpdateMessageType) {
          return
        }

        const scope = readHocuspocusDocumentScope(documentName, roomPrefix)
        const connection = context.jword

        if (connection === undefined || connection.tenantId !== scope.tenantId || connection.documentId !== scope.documentId) {
          throw createHocuspocusUpdateRejectedError(permissionDeniedDiagnosticCode)
        }

        if (connection.role !== 'write') {
          throw createHocuspocusUpdateRejectedError(permissionDeniedDiagnosticCode)
        }

        const license = await checkHocuspocusServerLicense(options.licenseHook, scope)

        if (!license.ok) {
          throw createHocuspocusUpdateRejectedError(license.diagnosticCode ?? 'JWORD_COLLAB_SERVER_NOT_ENTITLED')
        }

        if (options.rejectUpdates === true) {
          throw Object.assign(new Error('JWord collab server update rejected'), {
            code: 4409,
            reason: 'COLLAB_UPDATE_REJECTED'
          })
        }
      }
    }]
  })
  let state: JWordCollabHocuspocusServerState | null = null

  return {
    /** 启动正式 Hocuspocus WebSocket 服务。 */
    async start() {
      if (state !== null) {
        return state
      }

      await server.listen()
      state = createHocuspocusServerState(server.address.port, address, roomPrefix)

      return state
    },

    /** 停止正式 Hocuspocus WebSocket 服务。 */
    async stop() {
      if (state === null) {
        return
      }

      await server.destroy()
      state = null
    },

    /** 读取最近一次启动后的服务状态。 */
    readState() {
      return state
    }
  }
}

/** 调用宿主授权 hook，缺少 hook 时默认拒绝付费同步。 */
async function checkHocuspocusServerLicense(
  licenseHook: JWordCollabServerLicenseHook | undefined,
  scope: HocuspocusDocumentScope
): Promise<JWordCollabServerLicenseHookResult> {
  if (licenseHook === undefined) {
    return {
      ok: false,
      diagnosticCode: licenseHookRequiredDiagnosticCode
    }
  }

  return licenseHook({
    documentId: scope.documentId,
    tenantId: scope.tenantId,
    feature: GATE6_COLLAB_FEATURES.server
  })
}

/** 调用宿主 tenant hook，未配置时只应用 documentName 前缀隔离。 */
async function checkHocuspocusTenant(
  tenantHook: JWordCollabServerTenantHook | undefined,
  scope: HocuspocusDocumentScope,
  requestId: string
) {
  if (tenantHook === undefined) {
    return {
      ok: true
    }
  }

  return tenantHook({
    requestId,
    documentId: scope.documentId,
    tenantId: scope.tenantId
  })
}

/** 调用宿主 WebSocket auth hook 并归一化 read/write 角色。 */
async function authenticateHocuspocusConnection(
  authHook: JWordCollabHocuspocusAuthHook | undefined,
  scope: HocuspocusDocumentScope,
  requestId: string,
  requestParameters: URLSearchParams,
  token?: string
): Promise<{
  readonly role: JWordCollabHocuspocusRole
  readonly userId?: string
}> {
  if (authHook === undefined) {
    throw createHocuspocusAuthError(authHookRequiredDiagnosticCode)
  }

  const userId = readHocuspocusUserId(requestParameters)
  const auth = await authHook({
    requestId,
    roomId: scope.roomId,
    tenantId: scope.tenantId,
    documentId: scope.documentId,
    ...(userId === undefined ? {} : { userId }),
    ...(token === undefined ? {} : { token })
  })

  if (!auth.allow) {
    throw createHocuspocusAuthError(auth.diagnosticCode ?? 'COLLAB_AUTH_DENIED')
  }

  const resolvedUserId = auth.userId ?? userId

  return {
    role: auth.role ?? 'read',
    ...(resolvedUserId === undefined ? {} : { userId: resolvedUserId })
  }
}

/** 从 documentName 解析 tenantId/documentId，同时保留 legacy roomPrefix 兼容。 */
function readHocuspocusDocumentScope(documentName: string, roomPrefix: string): HocuspocusDocumentScope {
  if (!documentName.startsWith(roomPrefix)) {
    throw new Error(`JWord collab room must start with ${roomPrefix}`)
  }

  const parts = documentName.split('/').filter((part) => part.length > 0)

  if (parts.length >= 2) {
    return {
      roomId: documentName,
      tenantId: parts[0] ?? 'default',
      documentId: parts.slice(1).join('/')
    }
  }

  return {
    roomId: documentName,
    tenantId: 'default',
    documentId: documentName
  }
}

/** 从连接 query 参数读取用户 ID。 */
function readHocuspocusUserId(requestParameters: URLSearchParams): string | undefined {
  return requestParameters.get('userId') ?? requestParameters.get('clientId') ?? undefined
}

/** 创建 Hocuspocus provider 可识别的认证错误。 */
function createHocuspocusAuthError(message: string): Error & {
  readonly reason: string
} {
  return Object.assign(new Error(message), {
    reason: 'COLLAB_PROVIDER_AUTH_FAILED'
  })
}

/** 创建可被 provider 识别的 update 拒绝错误。 */
function createHocuspocusUpdateRejectedError(reason: string): Error & {
  readonly code: number
  readonly reason: string
} {
  return Object.assign(new Error('JWord collab server update rejected'), {
    code: 4409,
    reason
  })
}

/** 根据实际监听端口生成正式 WebSocket 服务状态。 */
function createHocuspocusServerState(
  port: number,
  address: string,
  roomPrefix: string
): JWordCollabHocuspocusServerState {
  return {
    port,
    address,
    roomPrefix,
    httpUrl: `http://${address}:${port}`,
    webSocketUrl: `ws://${address}:${port}`
  }
}
