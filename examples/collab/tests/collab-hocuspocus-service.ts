/**
 * 职责：为 collab 浏览器验收测试提供基于正式包入口的本地服务控制器。
 * 边界：只服务 Playwright 测试，不导出给 demo runtime 或第三方集成方。
 * 协作：@4xian/jword-collab-server dist、@4xian/jword-persistence dist 和 examples/collab/*.e2e.ts。
 * 约束：正式包延迟导入，避免 Playwright 列举测试时预加载 workspace 构建产物。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.47-6.49。
 */

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

/** 延迟创建基于正式包入口的 Hocuspocus 测试服务。 */
export async function createCollabHocuspocusServiceForTest(
  options: CollabHocuspocusServiceOptions = {}
): Promise<CollabHocuspocusService> {
  const {
    GATE6_COLLAB_FEATURES,
    createJWordCollabHocuspocusServer,
    createJWordCollabHistoryService,
    createJWordCollabServer
  } = await import('@4xian/jword-collab-server')
  const {
    createVolatileHistoryStorage
  } = await import('@4xian/jword-persistence')
  const address = options.address ?? '127.0.0.1'
  const roomPrefix = options.roomPrefix ?? 'jword-collab'
  const historyStorage = options.historyStorage ?? createVolatileHistoryStorage()
  const historyService = createJWordCollabHistoryService({
    storage: historyStorage
  })
  const historyApiServer = createJWordCollabServer({
    address,
    historyStorage,
    featureFlags: Object.values(GATE6_COLLAB_FEATURES),
    licenseHook: () => ({ ok: true }),
    ...(options.historyPort === undefined ? {} : { port: options.historyPort })
  })
  const server = createJWordCollabHocuspocusServer({
    port: options.port ?? 4188,
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

  return createServiceController(server, historyApiServer, historyService)
}

/** 创建测试服务生命周期控制器。 */
function createServiceController(
  server: JWordCollabHocuspocusServer,
  historyApiServer: JWordCollabServer,
  historyService: JWordCollabHistoryService
): CollabHocuspocusService {
  let state: CollabHocuspocusServiceState | null = null

  return {
    /** 启动测试用正式 Hocuspocus 服务。 */
    async start() {
      if (state !== null) {
        return state
      }

      const webSocketState = await server.start()
      const historyApiState = await historyApiServer.start()

      state = {
        port: webSocketState.port,
        address: webSocketState.address,
        roomPrefix: webSocketState.roomPrefix,
        httpUrl: webSocketState.httpUrl,
        webSocketUrl: webSocketState.webSocketUrl,
        historyHttpUrl: historyApiState.httpUrl
      }

      return state
    },

    /** 停止测试用正式 Hocuspocus 服务。 */
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
