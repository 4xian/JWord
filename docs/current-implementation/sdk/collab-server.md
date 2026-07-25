# 协作服务端当前实现摘要

## 对应文档

- `docs/sdk/collab-server.md`
- `docs/current-implementation/packages/collab-server.md`
- `packages/collab-server/README.md`

## 当前能力

`@4xian/jword-collab-server` 提供镜像内部的 self-host 服务端模块；客户应用只集成浏览器 SDK，正式服务端通过版本化 Docker 镜像交付：

- `createJWordCollabServer()` / `startJWordCollabServer()`：Node HTTP server。
- `createJWordCollabRequestHandler()`：可嵌入第三方 HTTP server。
- `createJWordCollabHistoryService()`：server-backed history service。
- `createJWordCollabHocuspocusServer()`：Hocuspocus/Yjs WebSocket 服务控制器。
- protected routes：license status、auto-insert relay、history record/preview/list。
- public routes：`/health`、`/version`。

## 实现方案

- `authHook` 缺失时拒绝受保护 HTTP 路由。
- `licenseHook` 缺失时拒绝付费 feature 检查。
- `tenantHook` 用于 tenant/document 隔离。
- `historyStorage` 由宿主注入；未传时使用 volatile memory storage。
- 同一 document 的 history 操作通过 promise lock 串行化，并用 `maxHistoryDocumentLockQueueDepth` 控制背压。
- `rateLimit` 对受保护业务路由应用滑窗限流。
- Hocuspocus 权限角色为 read/comment/write，只有 write 可提交 Yjs update。

## 当前限制

- 正式生产镜像仍为 `LIC-309` Pending；当前 package API、Dockerfile 和本地启动入口只用于仓库开发、架构验证和镜像组装。
- 客户宿主不直接安装 Node 或 server npm package；客户运维侧部署镜像并提供持久化、只读 License secret 与 HTTP/WSS 代理。
- 包不提供生产数据库实现、用户系统、账单系统或 license portal。
- Auto-insert relay 只校验和接受 chunk metadata，不执行 AI 生成、不直接写文档。
- HTTP server 与 Hocuspocus WebSocket server 是两个入口，真实部署需要宿主组合。

## 验证入口

- `packages/collab-server/test/server.test.ts`
- `packages/collab-server/test/history-queue.test.ts`
- `packages/collab-server/test/history-list-auth.test.ts`
- `packages/collab-server/test/metadata-mismatch.test.ts`
- `packages/collab-server/test/rate-limit.test.ts`
- `examples/collab/tests/hocuspocus-service.test.ts`
- B4 canonical run-a 验收：`: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"` 后运行 `node tools/release/check-gate6-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"`；server 仍只属于 image-internal Node journey。
