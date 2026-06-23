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
  JWordCollabServerLicenseHook,
  JWordCollabServerLicenseHookResult
} from './index.js'

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
const licenseHookRequiredDiagnosticCode = 'JWORD_COLLAB_LICENSE_HOOK_REQUIRED'
const yjsUpdateMessageType = 2

/** 创建正式 Hocuspocus WebSocket 服务控制器。 */
export function createJWordCollabHocuspocusServer(
  options: CreateJWordCollabHocuspocusServerOptions = {}
): JWordCollabHocuspocusServer {
  const address = options.address ?? defaultHocuspocusAddress
  const roomPrefix = options.roomPrefix ?? defaultHocuspocusRoomPrefix
  const server = new HocuspocusServer({
    port: options.port ?? defaultHocuspocusPort,
    address,
    name: 'jword-collab-server',
    quiet: true,
    stopOnSignals: false,
    extensions: [{
      extensionName: 'jword-collab-server-guard',
      async onConnect({ documentName }) {
        if (!documentName.startsWith(roomPrefix)) {
          throw new Error(`JWord collab room must start with ${roomPrefix}`)
        }

        const license = await checkHocuspocusServerLicense(options.licenseHook, documentName)

        if (!license.ok) {
          throw createHocuspocusAuthError(license.diagnosticCode ?? 'JWORD_COLLAB_SERVER_NOT_ENTITLED')
        }
      },
      async onAuthenticate({ documentName, token }) {
        if (options.requiredToken !== undefined && token !== options.requiredToken) {
          throw createHocuspocusAuthError('JWord collab server auth failed')
        }

        const license = await checkHocuspocusServerLicense(options.licenseHook, documentName)

        if (!license.ok) {
          throw createHocuspocusAuthError(license.diagnosticCode ?? 'JWORD_COLLAB_SERVER_NOT_ENTITLED')
        }
      },
      async beforeSync({ documentName, type }) {
        if (type !== yjsUpdateMessageType) {
          return
        }

        const license = await checkHocuspocusServerLicense(options.licenseHook, documentName)

        if (!license.ok || options.rejectUpdates === true) {
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
  documentName: string
): Promise<JWordCollabServerLicenseHookResult> {
  if (licenseHook === undefined) {
    return {
      ok: false,
      diagnosticCode: licenseHookRequiredDiagnosticCode
    }
  }

  return licenseHook({
    documentId: documentName,
    feature: GATE6_COLLAB_FEATURES.server
  })
}

/** 创建 Hocuspocus provider 可识别的认证错误。 */
function createHocuspocusAuthError(message: string): Error & {
  readonly reason: string
} {
  return Object.assign(new Error(message), {
    reason: 'COLLAB_PROVIDER_AUTH_FAILED'
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
