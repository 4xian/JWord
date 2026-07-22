# @4xian/jword-collab-server 当前实现摘要

## 包职责

`@4xian/jword-collab-server` 是协同 self-host server 的镜像内部实现模块，提供 Node HTTP server、request handler、server-backed history service、auto-insert relay 授权入口，以及 Hocuspocus/Yjs WebSocket 服务控制器。客户应用代码只集成浏览器 SDK，不直接安装该 package；正式服务端统一通过 JWord 版本化 Docker 镜像交付。

当前正式镜像仍属于 `LIC-309` Pending。现有 Node API、hooks 和 Dockerfile 用于仓库开发、架构验证与后续镜像组装，不是已批准的客户生产部署面。

## 入口与导出

- 包名：`@4xian/jword-collab-server`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-license`、`@4xian/jword-persistence`、`@hocuspocus/server`、`y-protocols`、`yjs`。

## 公开 API 摘要

根入口主要导出：

- `createJWordCollabServer()`
- `startJWordCollabServer()`
- `createJWordCollabRequestHandler()`
- `createJWordCollabHistoryService()`
- `createJWordCollabHocuspocusServer()`
- `GATE6_COLLAB_FEATURES`
- `JWORD_COLLAB_SERVER_PROTOCOL_VERSION = 'gate6-collab-v1'`
- `JWORD_COLLAB_SERVER_PACKAGE_VERSION = '0.0.0'`
- server options/state、authHook、tenantHook、licenseHook、rateLimit、Hocuspocus role/auth 类型。

## HTTP 能力

`createJWordCollabServer()` 创建 Node HTTP server；`createJWordCollabRequestHandler()` 可嵌入第三方 HTTP server。

当前 HTTP 路由：

- `GET /health`：公开 readiness，返回 status、protocolVersion、packageVersion、requestId。
- `GET /version`：公开版本握手，返回 protocolVersion、packageVersion、featureFlags、minimumClientVersion、minimumServerVersion、requestId。
- `POST /license/status`：受保护 license status。
- `POST /auto-insert/relay`：受保护 auto-insert relay，只校验并接受 chunk，不执行 AI 生成、不写文档。
- `GET /history/versions` 与 legacy `GET /jword-history/versions`：列出版本。
- `POST /history/versions` 与 legacy `POST /jword-history/versions`：记录版本 update 并创建 snapshot。
- `POST /history/preview` 与 legacy `POST /jword-history/preview`：读取版本预览 update。
- 其它路径返回 `JWORD_COLLAB_SERVER_NOT_FOUND`。

HTTP 基础设施：

- 每个 JSON 响应包含 `requestId`。
- CORS 由 `allowedOrigins` 控制；未配置时返回 `*`。
- 默认 `maxPayloadBytes = 1MB`，超限抛 `JWORD_COLLAB_SERVER_PAYLOAD_TOO_LARGE`。
- 配置 `rateLimit` 后，对受保护业务路由应用内存滑窗限流，超限返回 429；`/health` 与 `/version` 不限流。

## WS / Hocuspocus / Yjs 能力

`createJWordCollabHocuspocusServer()` 单独创建 Hocuspocus WebSocket 服务。它与 HTTP server 是两个入口；完整协同部署通常需要同时启动 WS server 与 HTTP history/version server。

Hocuspocus server 当前能力：

- 默认地址 `127.0.0.1`，默认端口 `4188`，默认 `roomPrefix = 'jword-collab'`。
- 返回状态包含 `httpUrl` 与 `webSocketUrl`。
- `authHook` 缺失时默认拒绝正式协同连接。
- 可选 `requiredToken` 要求 provider token 完全匹配。
- `tenantHook` 用于 documentName/tenant/document 隔离；未配置时只做 roomPrefix 基础检查。
- `licenseHook` 用 server entitlement 校验；缺失时默认拒绝。
- 权限角色为 `read` / `comment` / `write`；`beforeSync` 中只有 `write` 可以提交 Yjs update。
- `rejectUpdates` 可测试性地拒绝客户端提交 update，返回 `COLLAB_UPDATE_REJECTED`。
- `beforeSync` 只拦截 Yjs update message type `2`。

## 历史、权限和 diagnostics

- `createJWordCollabHistoryService()` 默认使用 `createVolatileHistoryStorage()`；生产部署应传入宿主自己的 `JWordHistoryStorage`。
- History service 通过 persistence 的 `createStoragePersistenceAdapter()` 实现 update log、snapshot、preview、restore。
- 同一 document 的 history 操作用 promise lock 串行化；默认最大队列深度 64。
- History list/record/preview 都在读取或访问 storage 前执行 tenant 与 license 检查。
- Record/preview/relay 会校验 body 中的 `tenantId` 与 URL/header metadata 一致。
- 受保护 HTTP 路由缺少 `authHook` 时返回 401；缺少 `licenseHook` 时返回 403。
- Auto-insert relay 使用 autoInsert entitlement 做 license gate；响应只回显 documentId、requestId、actorId、chunkLength，不回显 chunkText。

## 内部实现方案

- HTTP 层由 `createJWordCollabRequestHandler()` 分发路由，统一读取 JSON body、写入 JSON response、处理 CORS、payload 上限、requestId 与 rate limit。
- 受保护路由先走 auth/tenant/license hooks，再访问 history storage 或 auto-insert relay，避免先读用户数据再鉴权。
- History service 组合 persistence 的 storage adapter，并用 document 级 promise lock 串行化 record/preview/restore。
- Hocuspocus server 与 HTTP server 分离部署；WebSocket 权限在连接、tenant、license 和 update 写入阶段分别校验。
- Auto-insert relay 只校验并记录可接受 chunk metadata，不执行 AI 生成，也不直接写入文档。


## 与其它包关系

- 不直接依赖 core 或 DOCX；它处理 Yjs update/history storage 与 HTTP/WS 边界。
- 依赖 license 和 persistence。
- `examples/collab/server/hocuspocus-service.ts` 作为启动胶水组合 HTTP history server 与 Hocuspocus server。
- `examples/collab` 仅通过公开包入口接入 server。

## 主要测试/验收入口

- `packages/collab-server/test/server.test.ts`
- `packages/collab-server/test/history-queue.test.ts`
- `packages/collab-server/test/history-list-auth.test.ts`
- `packages/collab-server/test/metadata-mismatch.test.ts`
- `packages/collab-server/test/rate-limit.test.ts`
- `tests/architecture/gate6-package-exports.test.ts`
- `tests/architecture/gate6-diagnostics-registry.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `examples/collab/tests/hocuspocus-service.test.ts`
- `examples/collab/tests/hocuspocus-provider.test.ts`
- `examples/collab/tests/collab-history-api.e2e.ts`
- `tools/release/check-gate6-third-party-smoke.mjs`
- `packages/collab-server/Dockerfile`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-collab-server typecheck`：校验服务端公开类型、HTTP/WS hooks 与 history service 类型。
- `pnpm --filter @4xian/jword-collab-server test`：运行 collab-server 包内 HTTP、history、tenant/license、rate limit 单测。
- `pnpm --filter @4xian/jword-collab-server build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归包导出、diagnostics registry 与公开 API catalog。

## 当前限制/注意点

- 当前 Dockerfile 不满足生产镜像契约：正式镜像必须去除 allow-all license/admission、volatile-only storage，增加只读 License secret、持久化、readiness/liveness、备份恢复和不可变 image digest 验证。
- 客户宿主不直接安装 Node 或导入服务端 npm package；Node 版本由 JWord 镜像固定，客户运维侧只提供 Docker 兼容环境、存储、secret 和 HTTP/WSS 反向代理。
- `createJWordCollabServer()` 是 HTTP server，不自动启动 Hocuspocus WebSocket；WS 要单独用 `createJWordCollabHocuspocusServer()`。
- 未传 `historyStorage` 时只有 volatile memory storage，不是生产数据库。
- HTTP `authHook` 当前输入只有 requestId、method、path，不直接暴露 Authorization header/token；需要更细认证时应由宿主外层封装或扩展。
- `snapshotStorage?: unknown` 出现在 public options，但真实 history 仍走 `historyStorage`。
- `comment` 角色当前按非 writer 处理，不能提交 document update。
- Dockerfile 默认 CMD 没有传 `authHook`，protected HTTP routes 会 default-deny 返回 401，适合作最小镜像/health/version 验证，不等同完整生产配置。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/collab-server/package.json`
- `packages/collab-server/src/index.ts`
- `packages/collab-server/src/hocuspocus-server.ts`
- `packages/collab-server/src/history-service.ts`
- `packages/collab-server/src/history-routes.ts`
- `packages/collab-server/src/auto-insert-relay.ts`
- `packages/collab-server/src/request-guards.ts`
- `packages/collab-server/src/http-utils.ts`
- `packages/collab-server/README.md`
- `packages/collab-server/Dockerfile`
