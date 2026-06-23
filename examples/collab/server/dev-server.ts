/**
 * 职责：启动 Gate 6 collab demo 的本地 Hocuspocus 示例服务。
 * 边界：只作为 Node CLI 包装，不承载 provider adapter、浏览器 UI 或持久化逻辑。
 * 协作：hocuspocus-service.ts 提供服务控制器，开发者可与 examples/collab Vite demo 同时启动。
 * 约束：仅用于本地开发；依赖 Node 22+ 的 TypeScript strip types 能力。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.2。
 */
import { createCollabHocuspocusService } from './hocuspocus-service.ts'

type ShutdownSignal = 'SIGINT' | 'SIGTERM'

const service = createCollabHocuspocusService({
  port: readPort(process.env.JWORD_COLLAB_PORT),
  historyPort: readHistoryPort(process.env.JWORD_COLLAB_HTTP_PORT),
  address: process.env.JWORD_COLLAB_HOST ?? '127.0.0.1',
  roomPrefix: process.env.JWORD_COLLAB_ROOM_PREFIX ?? 'jword-collab'
})

/** 解析本地服务端口。 */
function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 4188
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid JWORD_COLLAB_PORT: ${value}`)
  }

  return port
}

/** 解析本地协作 SDK HTTP 服务端口。 */
function readHistoryPort(value: string | undefined): number {
  if (value === undefined || value.trim() === '') {
    return 4189
  }

  const port = Number(value)

  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid JWORD_COLLAB_HTTP_PORT: ${value}`)
  }

  return port
}

/** 关闭服务并退出进程。 */
async function stop(signal: ShutdownSignal): Promise<void> {
  await service.stop()
  process.kill(process.pid, signal)
}

process.once('SIGINT', () => {
  void stop('SIGINT')
})
process.once('SIGTERM', () => {
  void stop('SIGTERM')
})

const state = await service.start()

console.log(`JWord collab Hocuspocus service listening at ${state.webSocketUrl}`)
console.log(`JWord collab SDK HTTP service listening at ${state.historyHttpUrl}`)
console.log(`JWord collab room prefix: ${state.roomPrefix}`)
