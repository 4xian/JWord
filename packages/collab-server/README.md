# @4xian/jword-collab-server

正式 self-host 服务包提供 Gate 6 商业协作服务端的 Node 入口和可嵌入 HTTP handler。当前公开 HTTP API 包含 `/health`、`/version`、`/history/versions` 和 `/license/status`；每个 JSON 响应都包含 `requestId`，便于日志关联。

## Local Node

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
    diagnosticCode: 'COLLAB_FEATURE_NOT_ENTITLED'
  })
})

await server.start()
```

## Embedded Handler

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
