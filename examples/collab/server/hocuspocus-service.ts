/**
 * 职责：提供 Gate 6 collab demo 的本地 Hocuspocus 示例服务入口。
 * 边界：只封装 Node 服务启动、关闭和 demo room 元数据，不接入浏览器 UI、IndexedDB 或 core 内部 store。
 * 协作：@4xian/jword-collab-server 负责正式 WebSocket 和 history HTTP 服务，examples/collab 只保留启动胶水。
 * 约束：仅用于本地 demo；不改变 core 或浏览器包运行要求。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.2。
 */
import {
  GATE6_COLLAB_FEATURES,
  createJWordCollabHocuspocusServer,
  createJWordCollabHistoryService,
  createJWordCollabServer
} from '@4xian/jword-collab-server'
import {
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'
import type {
  JWordCollabHistoryService,
  JWordCollabHocuspocusServer,
  JWordCollabServer
} from '@4xian/jword-collab-server'
import type {
  JWordHistoryStorage
} from '@4xian/jword-persistence'

export interface CollabHocuspocusServiceOptions {
  /** 本地服务端口；传 0 时由系统分配随机端口。 */
  readonly port?: number
  /** 本地监听地址。 */
  readonly address?: string
  /** demo room 前缀，便于测试和双窗口 demo 隔离。 */
  readonly roomPrefix?: string
  /** demo auth token；设置后客户端必须传入相同 token。 */
  readonly requiredToken?: string
  /** 测试开关：拒绝客户端提交的本地 Yjs update。 */
  readonly rejectUpdates?: boolean
  /** 服务端 history storage backend；生产宿主应注入持久化实现。 */
  readonly historyStorage?: JWordHistoryStorage
  /** 服务端 history HTTP API 端口；默认使用随机端口。 */
  readonly historyPort?: number
}

export interface CollabHocuspocusServiceState {
  /** 实际监听端口。 */
  readonly port: number
  /** 实际监听地址。 */
  readonly address: string
  /** demo room 前缀。 */
  readonly roomPrefix: string
  /** HTTP 健康检查地址。 */
  readonly httpUrl: string
  /** Yjs WebSocket 连接地址。 */
  readonly webSocketUrl: string
  /** 服务端 history HTTP API 地址。 */
  readonly historyHttpUrl: string
}

export interface CollabHocuspocusService {
  /** 启动本地 Hocuspocus 服务。 */
  start(): Promise<CollabHocuspocusServiceState>
  /** 停止本地 Hocuspocus 服务。 */
  stop(): Promise<void>
  /** 读取最近一次启动后的服务状态。 */
  readState(): CollabHocuspocusServiceState | null
  /** 读取绑定服务生命周期的共享 history service。 */
  readHistoryService(): JWordCollabHistoryService
}

const defaultPort = 4188
const defaultAddress = '127.0.0.1'
const defaultRoomPrefix = 'jword-collab'

/** 创建 collab demo 的本地 Hocuspocus 服务控制器。 */
export function createCollabHocuspocusService(
  options: CollabHocuspocusServiceOptions = {}
): CollabHocuspocusService {
  const address = options.address ?? defaultAddress
  const roomPrefix = options.roomPrefix ?? defaultRoomPrefix
  const historyStorage = options.historyStorage ?? createVolatileHistoryStorage()
  const historyService = createJWordCollabHistoryService({
    storage: historyStorage
  })
  const historyApiServer = createJWordCollabServer({
    address,
    historyStorage,
    featureFlags: Object.values(GATE6_COLLAB_FEATURES),
    authHook: () => ({ ok: true }),
    licenseHook: () => ({ ok: true }),
    ...(options.historyPort === undefined ? {} : { port: options.historyPort })
  })
  const server = createJWordCollabHocuspocusServer({
    port: options.port ?? defaultPort,
    address,
    roomPrefix,
    authHook: (input) => ({
      allow: true,
      role: 'write',
      ...(input.userId === undefined ? {} : { userId: input.userId })
    }),
    licenseHook: () => ({ ok: true }),
    ...(options.requiredToken === undefined ? {} : { requiredToken: options.requiredToken }),
    ...(options.rejectUpdates === undefined ? {} : { rejectUpdates: options.rejectUpdates })
  })
  let state: CollabHocuspocusServiceState | null = null

  return {
    /** 启动本地 Hocuspocus 服务。 */
    async start() {
      if (state !== null) {
        return state
      }

      const webSocketState = await server.start()
      const historyApiState = await historyApiServer.start()

      state = createServiceState(webSocketState, historyApiState.httpUrl)

      return state
    },

    /** 停止本地 Hocuspocus 服务。 */
    async stop() {
      if (state === null) {
        return
      }

      await Promise.all([
        server.stop(),
        historyApiServer.stop()
      ])
      state = null
    },

    /** 读取最近一次启动后的服务状态。 */
    readState() {
      return state
    },

    /** 读取绑定服务生命周期的共享 history service。 */
    readHistoryService() {
      return historyService
    }
  }
}

/** 根据实际监听端口生成 demo 服务状态。 */
function createServiceState(
  webSocketState: Awaited<ReturnType<JWordCollabHocuspocusServer['start']>>,
  historyHttpUrl: string
): CollabHocuspocusServiceState {
  return {
    port: webSocketState.port,
    address: webSocketState.address,
    roomPrefix: webSocketState.roomPrefix,
    httpUrl: webSocketState.httpUrl,
    webSocketUrl: webSocketState.webSocketUrl,
    historyHttpUrl
  }
}
