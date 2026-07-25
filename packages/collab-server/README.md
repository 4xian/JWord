# @4xian/jword-collab-server

本 package 是 Gate 6 商业协作服务端的镜像内部实现，提供 Node 入口和 HTTP handler。客户应用不直接安装或导入本 package；正式 self-host 服务只通过 JWord 版本化 Docker 镜像交付。当前生产镜像仍为 `LIC-309` Pending，以下入口只用于仓库开发、架构测试和镜像组装。当前 JSON 响应继续携带 `requestId`，便于内部日志与 smoke 关联。

## 仓库内部 Local Node

```ts
import {
  createJWordCollabServer,
  GATE6_COLLAB_FEATURES
} from '@4xian/jword-collab-server'
import { createVolatileHistoryStorage } from '@4xian/jword-persistence'

const server = createJWordCollabServer({
  address: process.env.JWORD_COLLAB_HOST ?? '127.0.0.1',
  port: Number(process.env.JWORD_COLLAB_PORT ?? 4188),
  allowedOrigins: readAllowedOrigins(process.env.JWORD_COLLAB_ALLOWED_ORIGINS),
  historyStorage: createVolatileHistoryStorage(),
  authHook: ({ path }) => ({
    ok: path === '/license/status' || path.startsWith('/history/') || path === '/auto-insert/relay',
    diagnosticCode: 'COLLAB_AUTH_DENIED'
  }),
  licenseHook: ({ feature }) => ({
    ok: feature === GATE6_COLLAB_FEATURES.server || feature === GATE6_COLLAB_FEATURES.history,
    diagnosticCode: 'JWORD_FEATURE_NOT_ENTITLED'
  })
})

await server.start()
```

## 仓库内部 Embedded Handler

```ts
import { createServer } from 'node:http'
import { createJWordCollabRequestHandler } from '@4xian/jword-collab-server'

const handler = createJWordCollabRequestHandler({
  allowedOrigins: ['https://app.example.test'],
  authHook: ({ path }) => ({
    ok: path === '/license/status' || path.startsWith('/history/') || path === '/auto-insert/relay',
    diagnosticCode: 'COLLAB_AUTH_DENIED'
  })
})

createServer((request, response) => {
  void handler(request, response)
}).listen(4188)
```

## Environment

这些变量描述当前内部实现，不是最终客户镜像契约；正式镜像必须固定 Node runtime，并通过容器 secret、持久化和 readiness 契约收口配置。

- `JWORD_COLLAB_HOST`: listen address, for containers normally `0.0.0.0`.
- `JWORD_COLLAB_PORT`: HTTP listen port.
- `JWORD_COLLAB_ALLOWED_ORIGINS`: comma separated browser origins allowed by CORS.
- `JWORD_COLLAB_MINIMUM_CLIENT_VERSION`: value returned by `/version`.
- `JWORD_COLLAB_MINIMUM_SERVER_VERSION`: value returned by `/version`.

## Reverse Proxy

Expose `/health` for health check and route `/version`, `/history/versions` and `/license/status` to the same service. When WebSocket provider relay is enabled by a host integration, the reverse proxy must preserve `Upgrade` and `Connection` headers and use the same origin policy as `JWORD_COLLAB_ALLOWED_ORIGINS`.

## Hook Defaults

Protected HTTP routes use default-deny semantics. If `authHook` is omitted, `/license/status`, `/history/versions`, `/history/preview` and `/auto-insert/relay` return `401` with `JWORD_COLLAB_AUTH_HOOK_REQUIRED` before reading request bodies. If `licenseHook` is omitted, paid feature checks return `403` with `JWORD_COLLAB_LICENSE_HOOK_REQUIRED`. Local demos and tests that intentionally allow access must pass explicit allow hooks. When `rateLimit` is configured, protected HTTP business routes use a per-client sliding window and overflow returns `429` with `JWORD_COLLAB_SERVER_RATE_LIMITED` and `retryAfterMs`; `/health` and `/version` remain public readiness endpoints.

Formal Hocuspocus WebSocket connections use tenant-scoped document names and per-user `read` / `comment` / `write` roles from `authHook`. Only `write` can submit Yjs updates; `read` and `comment` are rejected in `beforeSync` with `COLLAB_PERMISSION_DENIED`. The `comment` role is reserved for post-1.0 comment-specific enforcement because comments are still Yjs updates at the server boundary. Client-side `readonly` only hides UI editing affordances and is not a security boundary.

## History And License

`historyStorage` is supplied by the host so production deployments can use their own database. The service checks `authHook` and then `licenseHook` before reading or writing history storage; client-side license checks are only UX hints. History operations for the same document are serialized with a bounded lock queue. Hosts can set `maxHistoryDocumentLockQueueDepth` to tune backpressure; overflow returns HTTP 429 with `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED`.

当前示例中的 hook 与 storage 组合不能作为客户生产镜像发布。LIC-309 必须删除 allow-all preset 和 volatile-only storage，改为只读 License secret、持久化、HTTP/WSS 统一 admission、readiness/liveness、备份恢复与不可变 image digest 验收。
