# Gate 6 代码审查报告

> 审查日期：2026-07-02
> 审查范围：packages/collab、packages/collab-server、packages/persistence、packages/core/src/collaboration、examples/collab、tests/architecture/gate6-*、benchmarks/gate6-collab-benchmark.mjs
> 审查人：Enterprise Code Reviewer

---

## 一、总体评价

Gate 6 的实现质量整体较高，架构分层清晰、职责边界明确。Provider Adapter 模式成功隔离了 Hocuspocus 内部类型；客户端授权校验在显式连接前完成；自动插入器不侵入用户光标和 undo 栈；version handshake 设计健壮。但 R3 复审确认正式 Hocuspocus WebSocket 服务端仍缺 tenant/authHook 隔离，不能把“授权前置”外推为服务端房间级权限已完整闭环。以下按审查维度逐一列出发现。

**严重程度分级**：CRITICAL（必须修复）、HIGH（强烈建议修复）、MEDIUM（建议改进）、LOW（可选优化）、INFO（信息备注）

---

## 二、逐模块审查

### 2.1 packages/collab — Client SDK

#### 2.1.1 Provider Adapter 隔离 ✅

**结论：通过**

- `JWordCollabProviderAdapter` 接口（`index.ts:117-131`）完全抽象了底层 provider，不暴露任何 Hocuspocus 内部类型。
- `createHocuspocusCollabProviderAdapter` 仅通过 `experimental` 子路径导出，正式入口 `index.ts` 不引用 `@hocuspocus/provider`。
- 内存 adapter `createMemoryCollabProviderAdapter` 用于测试，实现了完整的 room 隔离和多 adapter 广播。

#### 2.1.2 Awareness 生命周期管理

**[MEDIUM] 模块级 Map 未提供全局清理入口**

`index.ts:240` 的 `memoryCollabRooms`（`Map<string, MemoryCollabRoom>`）是模块级全局变量。在测试场景中多次创建/销毁 adapter 后，如果存在 awarenessStates 但 adapters 已清空的边界情况，room 不会被清理（`unregisterMemoryAdapter` 在 `adapters.size === 0 && awarenessStates.size === 0` 时才删除）。

- 位置：`packages/collab/src/index.ts:566`
- 建议：为内存 adapter 提供 `resetMemoryCollabRooms()` 测试辅助函数，或在 `destroy()` 时也清理对应 awarenessStates。

**[LOW] Awareness 状态校验函数重复**

`index.ts` 和 `hocuspocus-adapter.ts` 各自实现了一套完整的 `isAwarenessState`、`isAwarenessUser`、`isAwarenessCursor` 等校验函数（两文件各约 100 行），逻辑完全一致。

- 位置：`index.ts:743-855` vs `hocuspocus-adapter.ts:506-622`
- 建议：抽取到内部共享模块（如 `awareness-validation.ts`），减少维护负担和不一致风险。

#### 2.1.3 远端光标/选区渲染

**结论：设计正确**

- Awareness state 包含 `cursor`（blockId + offset）和 `rangeSnapshot`（完整 Yjs relative position）两层数据。
- 当 `rangeSnapshot` 无法解析时，`downgradeUnresolvedAnchorToPresence` 将其降级为仅展示在线用户（presence-only），不抛异常。
- Hocuspocus adapter 中的 `readHocuspocusAwarenessState` 也执行相同的降级逻辑，并将诊断记录到 diagnostics 数组且去重。

**[INFO] 远端光标渲染的实际 DOM 操作不在 collab 包内**

`packages/collab` 只负责 awareness 数据的传输和校验，实际的 DOM 渲染逻辑应在 `packages/ui` 或宿主应用中。这符合架构要求。

#### 2.1.4 "正在输入" 提示

**结论：实现正确**

`client-sdk.ts:937-946` 的 `readSelectionLabel` 函数：
- 优先使用用户显式设置的 `selectionLabel`
- 当 `typing === true` 且无显式 label 时，自动生成 `"${localUser.name} 正在输入"` 中文提示
- 数据通过 awareness state 的 `selectionLabel` 字段广播

#### 2.1.5 版本握手

**结论：设计健壮**

`client-sdk.ts:720-818` 实现了完整的 client/server 版本握手：
1. 连接前向 `/version` 端点发起 HTTP 请求
2. 校验 `protocolVersion` 严格匹配（`gate6-collab-v1`）
3. 校验 `serverPackageVersion >= minimumServerVersion`
4. 校验 `clientPackageVersion >= minimumClientVersion`（服务端要求的最低客户端版本）
5. 校验服务端 `featureFlags` 包含客户端所需的所有 feature
6. 任何校验失败都返回结构化诊断，不连接 provider

**[MEDIUM] 版本比较不支持预发布标识**

`compareVersions`（`client-sdk.ts:865-880`）仅按 `.` 分隔数字段比较，`1.0.0-beta.1` 中的 `-beta.1` 会被 `parseInt` 解析为 `NaN` 然后回退为 `0`。

- 建议：在注释中明确标注不支持预发布版本排序，或引入轻量 semver 比较。

#### 2.1.6 授权校验

**结论：通过**

- `validateConnectionOptions`（`client-sdk.ts:675-710`）在连接 provider 前检查 serverUrl/documentId/roomId 非空、user.id/name 非空、并对每个 feature 调用 `assertJWordFeatureEntitled`。
- 授权失败时不调用 `provider.connect()`，返回 error 状态的 connection handle。
- 服务端侧 `hocuspocus-server.ts` 在 `onConnect`、`onAuthenticate`、`beforeSync` 三个钩子中均执行 license 检查。

### 2.2 packages/collab — Hocuspocus Adapter


> **R3 子代理复审补充（服务端安全，HIGH）**：`packages/collab-server/src/hocuspocus-server.ts` 的正式 WebSocket 服务选项只有 `requiredToken`、`rejectUpdates`、`licenseHook`；连接路径仅校验 `documentName.startsWith(roomPrefix)` 与 license。HTTP history/relay 有 tenant hook，但 WebSocket 同步路径没有 `tenantHook` / `authHook`，也没有把 documentName 解析为 tenantId/documentId/roomId 后做隔离。共享 token 或宽松 licenseHook 下会退化成“只要 room 前缀合法即可尝试进入房间”。建议 `CreateJWordCollabHocuspocusServerOptions` 增加 auth/tenant hook 或 documentName parser，并在 onConnect/onAuthenticate/beforeSync 中传入 tenantId/documentId/roomId/userId/token 拒绝跨 tenant update。

**[HIGH] Provider 在构造时即调用 `attach()` 和 autoConnect**

`hocuspocus-adapter.ts:112` 在构造完成后立即调用 `provider.attach()`，而 `HocuspocusProviderWebsocket` 的 `autoConnect` 默认为 `true`（第 58 行）。这意味着在 adapter 创建后、用户调用 `connect()` 之前，底层 WebSocket 可能已经开始连接。

- 位置：`packages/collab/src/hocuspocus-adapter.ts:55-112`
- 建议：将 `autoConnect` 强制设为 `false`，或将 `provider.attach()` 延迟到 `connect()` 调用时。目前外部调用者传入 `autoConnect: false` 可以规避此问题。

**[MEDIUM] destroy() 调用顺序可能导致 awareness 事件在 destroyed 后触发**

`destroy()` 中先设 `destroyed = true`，再调 `provider.destroy()` 和 `websocketProvider.destroy()`。但 `provider.destroy()` 可能触发 `onAwarenessChange` 回调，此时 `emitHocuspocusAwarenessChange` 会因 `destroyed` 标志跳过，虽然不会报错，但 listener Set 已经被 `clear()` 清空。

- 建议：确认 Hocuspocus 4.x `destroy()` 的回调时序，或先 clear listeners 再 destroy provider。

**[LOW] sendUpdate 直接写入外部传入的 Y.Doc**

`hocuspocus-adapter.ts:197` 使用 `Y.applyUpdate(options.document, update, ...)` 直接修改用户传入的 Y.Doc。这是 Yjs 协同的标准模式，但如果外部传入错误的 update（如来自不同文档），会污染文档状态。

- 建议：文档化此行为，明确调用者需确保 update 与目标 Y.Doc 匹配。

### 2.3 packages/collab — Client History & Offline

#### 2.3.1 History 降级策略


**[HIGH] R3 子代理复审补充：public client `restoreVersion()` 不能保证真正回退到旧版本**

`packages/collab/src/client-history.ts:122-157` 在拿到旧版本 preview update 后直接调用 `editor.applySyncUpdate(preview.update, { origin: 'version-restore' })`；core 的 `applySyncUpdate()` 最终进入 Yjs `applyUpdate` 合并语义。Yjs update 合并不会自动删除当前文档里该版本之后新增的 struct，因此从 v2 应用 v1 update 通常不能让 v2 新增内容消失，无法保证“恢复到 v1”。

**建议**：新增受控 “replace from version update” 路径：用隔离 `Y.Doc` 应用 preview update，再通过 core transaction/受控替换逻辑覆盖当前 canonical document，并带 `version-restore` origin；补测试：record v1、record v2、restore v1 后断言 v2 文本消失。

**结论：设计合理**

`withHistoryFallback`（`client-history.ts:221-240`）在服务端 API 失败时自动降级到内存版本，并记录 `COLLAB_HISTORY_SERVER_FALLBACK` 诊断。降级后 fallback 版本存储在 `InternalHistoryVersion[]` 数组中，保留了完整的 update 二进制数据。

**[MEDIUM] Base64 编解码在大文档时可能栈溢出**

`client-history.ts:478` 的 `encodeBase64` 使用 `btoa(String.fromCodePoint(...update))`，展开运算符 `...` 会将整个 `Uint8Array` 展开到调用栈。当 update 超过约 100KB 时，`String.fromCodePoint(...update)` 可能触发 "Maximum call stack size exceeded"。

- 位置：`packages/collab/src/client-history.ts:477-484`
- 严重程度：**HIGH**
- 建议：改用分块编码或 `TextDecoder`/`Buffer` 方式。例如：
  ```typescript
  function encodeBase64(update: Uint8Array): string {
    let binary = ''
    for (let i = 0; i < update.length; i++) {
      binary += String.fromCharCode(update[i])
    }
    return btoa(binary)
  }
  ```

#### 2.3.2 Offline Handle

**结论：实现正确但较为简化**

`createOfflineHandle` 只提供 `readState()` 读取快照，不直接管理 IndexedDB。实际 IndexedDB 交互由 `packages/persistence` 的 `BrowserIndexedDbOfflineAdapter` 负责。

**[INFO] Client SDK 中缺少 IndexedDB 的直接集成点**

`ConnectJWordCollaborationOptions` 中没有 `offlineAdapter` 选项。IndexedDB 离线恢复需要宿主应用自行在 editor 外层配置 `createIndexedDbOfflineAdapter` 并在重连时 apply 恢复的 update。这是有意的设计选择（separation of concerns），但应在 SDK 文档中明确说明。

#### 2.3.3 Pending Operation Tracker

**结论：实现正确**

`createPendingOperationTracker`（`client-history.ts:189-218`）使用 `Map<kind, count>` 计数，释放函数通过 `released` 标志防止重复释放。`readQueuedOperations()` 返回所有类型的总和。

### 2.4 packages/collab-server — Server SDK

#### 2.4.1 HTTP 路由和安全


**[MEDIUM] R3 子代理复审补充：`rateLimit` 公开选项未实现**

`packages/collab-server/src/index.ts` 公开了 `CreateJWordCollabServerOptions.rateLimit`，但 `rg -n "rateLimit" packages/collab-server/src packages/collab-server/test tests/architecture/gate6-*` 仅命中类型声明，请求处理路径没有任何限流逻辑。history record/preview、license status、auto-insert relay 只依赖 payload size，不能限制高频请求或 relay 滥用。

**建议**：实现最小内存滑窗限流，按 IP/auth user/documentId 分桶，超限返回 429 与稳定 diagnostic；若暂不实现，应从公开 API 移除该选项，避免误导集成方。

**结论：设计良好**

- CORS 处理正确：`writeJson` 统一设置 `access-control-allow-origin`、`access-control-allow-headers`、`access-control-allow-methods`。
- Payload 限制：`readJsonBody` 限制最大字节数（默认 1MB），超限时抛出明确错误。
- 请求 ID 全局递增且包含时间戳，便于可观测性。

**[MEDIUM] Auth hook 默认放行策略不一致**

- `request-guards.ts` 的 `checkJWordCollabRequestAuth`：当 `authHook` 未定义时默认 `ok: true`（放行）。
- `hocuspocus-server.ts` 的 `checkHocuspocusServerLicense`：当 `licenseHook` 未定义时默认 `ok: false`（拒绝）。
- `index.ts` 的 `checkLicense`（license status 端点）：当 `licenseHook` 未定义时默认 `ok: false`（拒绝）。

这种设计虽有其道理（HTTP auth 在开发时放行，license 需要宿主显式配置），但不一致可能导致使用者困惑。

- 建议：在文档中明确说明各 hook 的默认行为和安全含义。

#### 2.4.2 History Service — 并发安全


**[MEDIUM] R3 子代理复审补充：history list 授权 metadata 与 record/preview 不一致**

`packages/collab/src/client-history.ts` 对 history list 会发送 `x-jword-entitlement`，但 `packages/collab-server/src/history-routes.ts` 的 `handleListHistoryVersions()` 只读 query 中的 `documentId/tenantId`，调用 license hook 时未传 entitlement。record/preview 路径则会从 URL/header 读取 metadata。严格 licenseHook 下 list 会不可用；宽松 hook 下又容易退化为 documentId-only 授权，造成版本元数据枚举风险。

**建议**：GET list 也统一走 `readLicenseMetadata()`，读取 header/query entitlement 并传入 licenseHook；补无 entitlement 被拒、有 entitlement 可 list 的测试。

**结论：设计正确**

`StorageBackedJWordCollabHistoryService`（`history-service.ts:64-143`）使用 `runWithDocumentLock` 实现同一文档的 promise 链式串行。

**[MEDIUM] Document lock 可能导致无限队列堆积**

`runWithDocumentLock` 通过 `previous.catch(() => undefined).then(() => current)` 将所有操作排队。如果某个文档的 history 操作频率极高（如自动保存每秒一次），队列会无限增长而不释放。虽然通过 `finally` 块释放锁和清理 Map 条目，但如果在锁持有期间有更多请求到达，`documentLocks.get(documentId) === queued` 的检查会失败，导致 Map 条目不被清理。

- 位置：`packages/collab-server/src/history-service.ts:120-142`
- 建议：考虑添加队列深度限制或超时机制。

**[LOW] 每次操作都创建新 adapter 实例**

`runWithDocumentLock` 中 `task(this.createAdapter())`（第 136 行）每次调用都创建新的 `StoragePersistenceAdapter`。虽然 adapter 本身是轻量的（只包装 storage 引用），但在高频调用场景中会产生额外 GC 压力。

#### 2.4.3 Auto-Insert Relay


**[MEDIUM] R3 子代理复审补充：record/preview/relay 只校验 body.documentId，不校验 body.tenantId 与授权 metadata 一致**

history record/preview 与 auto-insert relay 先用 URL/header metadata 做 tenant/license 校验，但请求体 schema 也允许 `tenantId`，当前只交叉校验 `documentId`。虽然 body tenantId 目前未直接参与写入，仍会造成审计语义不一致，并给后续扩展留下跨 tenant 混淆风险。

**建议**：若 body 带 `tenantId`，必须与 metadata tenantId 完全一致；否则返回稳定 `JWORD_COLLAB_*_METADATA_MISMATCH` diagnostic。

**结论：设计安全**

- `auto-insert-relay.ts` 先从 URL/header 读取 metadata 完成 tenant + license 校验，再读取请求体。
- 响应只返回 `documentId`、`requestId`、`actorId`、`chunkLength`，不回显 `chunkText` 内容。
- 使用 `[...body.chunkText].length` 正确计算 Unicode 字符数（而非 UTF-16 code unit 数）。

#### 2.4.4 History Routes — 安全边界

**结论：通过**

`history-routes.ts` 在读取请求体 (`readJsonBody`) 之前先从 URL/header 获取 metadata 并执行 tenant + license 检查。Body 中的 `documentId` 还会与 metadata 中的做交叉校验（`body.documentId !== metadata.documentId`），防止越权访问其他文档的 history。

### 2.5 packages/persistence

#### 2.5.1 IndexedDB Offline Adapter

**结论：实现可靠**

- 优雅降级：非浏览器环境返回 `UnavailableIndexedDbOfflineAdapter`，带 `PERSISTENCE_INDEXEDDB_UNAVAILABLE` 诊断。
- 状态追踪：`restoring → synced → destroyed / error` 生命周期清晰。
- 销毁清理：`destroy()` 移除 `document.on('update')` 监听器、销毁 provider、清空诊断 listeners。

**[HIGH] update 监听器中每次都编码完整状态**

`BrowserIndexedDbOfflineAdapter` 构造函数（`indexeddb-adapter.ts:103-105`）注册了 `document.on('update', ...)` 监听器，在每次 Yjs update 时调用 `Y.encodeStateAsUpdate(this.document)` 重新编码完整文档状态。这是一个 O(文档大小) 操作，在频繁编辑时（如连续打字）会导致严重性能问题。

- 位置：`packages/persistence/src/indexeddb-adapter.ts:103-105`
- 建议：使用节流（throttle/debounce）或仅在特定时机（如 provider sync、手动保存）更新 `updateByteLength`。

**[MEDIUM] load() 方法创建临时 Y.Doc 和 IndexeddbPersistence**

`loadPersistedUpdate`（`indexeddb-adapter.ts:214-244`）每次调用都创建一个新的 `Y.Doc` 和 `IndexeddbPersistence` 实例来读取数据。虽然 `finally` 块中销毁了 `restoredProvider`，但 `restoredDoc` 未显式 `destroy()`，可能导致微量内存泄漏。

- 位置：`packages/persistence/src/indexeddb-adapter.ts:218-219`
- 建议：在 `finally` 块中添加 `restoredDoc.destroy()`。

#### 2.5.2 Storage History Adapter

**结论：实现正确**

基于 `JWordHistoryStorage` 接口的 lazy load + save 模式设计合理。`createVolatileHistoryStorage` 提供了测试用的内存实现。

#### 2.5.3 SHA-256 纯同步实现

**结论：实现正确**

`sha256.ts` 提供了浏览器兼容的纯同步 SHA-256 实现，避免了 Web Crypto API 的异步依赖。对于版本 hash 这种非安全场景（不用于密码学），性能可接受。

### 2.6 packages/core — Auto Inserter

#### 2.6.1 Origin 隔离

**结论：通过**

`inserter.ts:92` 定义 `AUTO_INSERTER_ORIGIN = 'auto-inserter'`。`createCommandOptions`（第 299-305 行）：
- `undoScope === 'user'` 时使用 `local-user` origin（进入用户 undo）
- 其他情况使用 `auto-inserter` origin（不进入用户 undo）

**[INFO] Origin Matrix 完整性**

根据代码和类型定义，当前实现的 origin 矩阵：
| Origin | 来源 | 进入用户 Undo |
|---|---|---|
| `local-user` | 用户本地编辑 / undoScope=user 的 auto-insert | 是 |
| `remote-user` | 远端协作 update | 否 |
| `auto-inserter` | AI/程序化自动插入（默认） | 否 |
| `version-restore` | 历史版本恢复 | 否 |
| `jword-indexeddb-offline-store` | IndexedDB 离线恢复 | 否 |

`system-recovery` origin 未在代码中出现，但可通过 `applySyncUpdate` 的 `origin` 参数由宿主传入。

#### 2.6.2 稳定位置（AnchorRef/RangeRef）

**结论：通过**

- `createSdkInserter`（`client-sdk.ts:492-541`）使用 `resolveAutoInsertAnchor` 将用户传入的 `JWordAwarenessTextAnchorRecord`（可序列化 snapshot）或 `AnchorRef`（opaque 引用）统一解析为 `AnchorRef`。
- `createRangeRef` 组合 anchor 和 focus 为 `RangeRef`。
- flush 时通过 `editor.resolveTextPosition(anchor)` 延迟解析实际位置，确保在并发编辑下锚点保持稳定。

#### 2.6.3 不抢用户光标

**结论：通过**

Auto inserter 通过 `executeCommand` 执行 `autoInsert` / `autoInsertReplace` / `autoInsertAppend` 命令，使用 `auto-inserter` origin。这些命令不修改用户 selection，selection 的保存/恢复由 editor 的 transaction pipeline 根据 origin 判断。

#### 2.6.4 AbortSignal 支持

**结论：通过**

`inserter.ts:128-132`：构造时检查 `signal.aborted`，并注册 `abort` 事件的 `once` 监听器。abort 后设置 `aborted = true`，后续 `queue`/`write`/`flush` 均提前返回。

### 2.7 examples/collab

**结论：完整的第三方集成示例**

包含完整的 client（`src/main.ts`）、server（`server/dev-server.ts`）、runtime 模块（`src/runtime/*`）和丰富的 e2e 测试（awareness、handshake、history、concurrency、auto-insert concurrency、docx+provider+history 集成等）。

### 2.8 tests/architecture/gate6-*

**结论：门禁全面**

- `gate6-import-graph.test.ts`：约束示例和验收测试只能通过公开包入口接入。
- `gate6-package-exports.test.ts`：验证 collab/collab-server/persistence 三个包的导出面。
- `gate6-commercial-readiness.test.ts`：验证 diagnostic code 完整性、origin 矩阵、feature key 覆盖。
- `gate6-bundle-gate.test.ts`：包体积预算门禁。
- `gate6-file-budget.test.ts`：文件行数预算门禁。
- `gate6-benchmark.test.ts`：benchmark 指标门禁。
- `gate6-diagnostics-registry.test.ts`：诊断码注册表完整性。
- `gate6-fixture-registry.test.ts`：fixture 注册表完整性。
- `gate6-docx-fixture-integration.test.ts`：DOCX 导入后文档可协同验证。

### 2.9 benchmarks/gate6-collab-benchmark.mjs

**结论：覆盖全面**

- 内存 provider 协作 update 派发和 apply
- 2/5/20 用户矩阵扇出计量
- Persistence snapshot 创建/加载/预览
- 离线重连同步
- 真实浏览器 IndexedDB restore（通过 Playwright Chromium）
- 正式 server history record/list/preview API
- License 和 version handshake
- Auto inserter 写入和本地输入探针

---

## 三、按审查维度汇总

### 3.1 内存泄漏风险

| 风险点 | 严重程度 | 位置 |
|---|---|---|
| 模块级 `memoryCollabRooms` 无全局清理 | MEDIUM | collab/src/index.ts:240 |
| IndexedDB load 中 `restoredDoc` 未 destroy | MEDIUM | persistence/src/indexeddb-adapter.ts:218 |
| Hocuspocus adapter destroy 后 awareness 回调时序 | LOW | collab/src/hocuspocus-adapter.ts:161-170 |

### 3.2 并发安全

| 风险点 | 严重程度 | 位置 |
|---|---|---|
| History service document lock 无队列深度限制 | MEDIUM | collab-server/src/history-service.ts:120-142 |
| 内存 adapter broadcastMemoryAdapterUpdate 同步迭代 Set | LOW | collab/src/index.ts:582-593（安全，JS 单线程） |

### 3.3 性能风险

| 风险点 | 严重程度 | 位置 |
|---|---|---|
| IndexedDB adapter update 监听中每次编码完整状态 | HIGH | persistence/src/indexeddb-adapter.ts:103-105 |
| Base64 编码展开运算符栈溢出风险 | HIGH | collab/src/client-history.ts:477-478 |

### 3.4 DOCX 导入后文档可协同

**结论：通过**

`gate6-docx-fixture-integration.test.ts` 验证了 DOCX fixture 导入后的文档可通过 `applySyncUpdate` / `encodeSyncUpdate` 在多端同步。这保证了 DOCX → Y.Doc → provider → remote 的完整链路。

---

## 四、发现汇总

### CRITICAL（0 项）

无。

### HIGH（首轮 3 项 + R2 新增 1 项 + R3 新增 2 项）

1. **Base64 栈溢出风险**：`client-history.ts:478` 使用 `String.fromCodePoint(...update)` 展开运算符，大文档（>100KB）会栈溢出。
2. **IndexedDB update 监听性能**：每次 Yjs update 都编码完整文档状态，连续编辑时 O(N) 操作频繁触发。
3. **Hocuspocus adapter autoConnect 竞态**：构造时 autoConnect 默认 true 且立即 attach，可能在用户调用 connect() 前已开始连接。
4. **（R2 复审补充）用户 id/name 缺失被降级为非阻断 warning**：`client-sdk.ts:690-698` 用 `COLLAB_AWARENESS_STALE`（warning）代替阻断性初始化错误，缺失身份仍继续连接。详见 5b.2。
5. **（R3 子代理复审补充）`restoreVersion()` 不能保证真正回退旧版本**：public client 直接 apply 旧版本 Yjs update，合并语义不会自动删除目标版本之后新增的 struct。
6. **（R3 子代理复审补充）Hocuspocus WebSocket 正式服务缺 tenant/authHook 隔离**：服务端只校验 roomPrefix/license，未解析 tenantId/documentId/userId 后做房间级授权。

### MEDIUM（首轮 6 项 + R3 新增 3 项，其中版本比较项经 R2 提升安全含义）

1. 模块级 `memoryCollabRooms` 无全局清理入口。
2. Awareness 校验函数在 index.ts 和 hocuspocus-adapter.ts 中重复（约 200 行）。
3. 版本比较不支持预发布标识。
4. Auth hook 和 license hook 的默认行为不一致（auth 默认放行、license 默认拒绝）。
5. History service document lock 无队列深度限制。
6. IndexedDB load 中 `restoredDoc` 未显式 destroy。
7. **（R3 子代理复审补充）`rateLimit` 公开选项未实现**。
8. **（R3 子代理复审补充）history list 授权 metadata 与 record/preview 不一致**。
9. **（R3 子代理复审补充）record/preview/relay 未校验 body.tenantId 与授权 metadata 一致**。

### LOW（3 项）

1. Hocuspocus adapter destroy 后 awareness 回调时序可能异常。
2. sendUpdate 直接修改外部 Y.Doc 无文档说明。
3. History service 每次操作创建新 adapter 实例。

---

## 五、建议优先修复项

1. **[HIGH] 修复 Base64 编码栈溢出** — 改用循环拼接或 Buffer 方案，避免大文档场景崩溃。
2. **[HIGH] 节流 IndexedDB update 监听** — 使用 debounce 或仅在特定事件时更新 byteLength。
3. **[HIGH] 修复 Hocuspocus autoConnect 竞态** — 强制 autoConnect=false 或延迟 attach。
4. **[HIGH] 修复 `restoreVersion()` 回退语义** — 通过隔离 Y.Doc + core 受控替换当前 canonical document。
5. **[HIGH] Hocuspocus WebSocket 服务端补 tenant/authHook 隔离** — 连接和同步前完成房间级授权。
6. **[MEDIUM] 消除 awareness 校验函数重复** — 提取到共享内部模块。
7. **[MEDIUM] 添加 restoredDoc.destroy()** — 防止 Y.Doc 内存泄漏。

---

## 五之二、R2 独立复审补充（2026-07-02）

第二轮独立复审对本报告全部 HIGH 发现逐条到源码核实，并新增若干被首轮遗漏的问题。以下所有条目均带 file:line 证据，且与已有条目严格去重。

### 5b.1 已有 HIGH/严重发现核实结论

| 首轮发现 | 证据 | 复审结论 |
|---|---|---|
| Base64 栈溢出 `client-history.ts:478` | `btoa(String.fromCodePoint(...update))` 确在 `packages/collab/src/client-history.ts:478` | **属实**。补充：同仓 `packages/persistence/src/storage-history-adapter.ts:744-749` 已用正确的循环 `String.fromCharCode(byte)` 分块实现，`packages/collab-server/src/http-utils.ts:117-118` 用 `Buffer.from(bytes).toString('base64')`，说明这是 client-history 一处孤立疏漏，可直接复用同仓正确实现。首轮给出的修复代码（循环 + `fromCharCode`）方向正确。 |
| IndexedDB update 全量编码 `indexeddb-adapter.ts:103-105` | `packages/persistence/src/indexeddb-adapter.ts:103-106` 每次 `update` 事件 `Y.encodeStateAsUpdate(this.document)` | **属实**。补充：`whenSynced`（:110）、`storeUpdate`（:126）也各有一次全量编码，节流方案需一并覆盖。 |
| Hocuspocus autoConnect 竞态 `hocuspocus-adapter.ts` | `packages/collab/src/hocuspocus-adapter.ts:57` `autoConnect: options.autoConnect ?? true`，`:112` 构造末尾 `provider.attach()` | **属实**。 |

### 5b.2 新增问题（Gate 6 代码）

**[HIGH]（R2 复审补充）连接初始化用户 id/name 缺失被降级为非阻断 warning，且复用了语义错配的诊断码**
`packages/collab/src/client-sdk.ts:690-698`：当 `options.user.id` 或 `options.user.name` 为空时，`validateConnectionOptions` 只推入 `COLLAB_AWARENESS_STALE`（severity `warning`，`recoverable: true`），而非阻断连接的 error。对比同函数 :681-687 对 serverUrl/documentId/roomId 缺失用的是 `COLLAB_PROVIDER_UNAVAILABLE`。后果：user.id/name 是 presence、awareness、auto-inserter actor id（:668 `${localUser.id}:auto-inserter`）、license 诊断 authorId 的基础，缺失时不应静默继续连接。且把「初始化参数缺失」标成「awareness 过期」诊断码，会误导第三方排障。建议：user.id/name 缺失应返回独立的、阻断性的初始化错误码（如 `COLLAB_USER_IDENTITY_REQUIRED`，error 级），并纳入 diagnostics registry。预估工作量：0.5 天。

**[MEDIUM→安全含义]（R2 复审补充）版本握手 `compareVersions` 预发布标识失效可导致最低版本门禁被绕过**
首轮 2.1.5 已记为 MEDIUM「不支持预发布排序，建议加注释」，但**未点明其发生在安全边界上**：`packages/collab/src/client-sdk.ts:799` 用 `compareVersions(handshake.clientPackageVersion, handshake.minimumClientVersion)` 做客户端最低版本强制；`readVersionParts`（:883-889）对 `1.0.0-beta` 的 `0-beta` 段 `Number.parseInt` 得 `0`，使 `1.0.0-beta` 与 `1.0.0` 判定相等（返回 0），本应被 `< 0` 拒绝的过旧/预发布 client 会通过握手。同理影响 :791 的 `COLLAB_SERVER_TOO_OLD` 判定。建议：握手比较引入最小 semver（含 prerelease 语义）而非仅数字段拆分；修复优先级应从「注释说明」提升为「实现修正」。预估工作量：0.5 天。

**[LOW]（R2 复审补充）Hocuspocus adapter `sendUpdate` 写入 Y.Doc 使用的 fallback origin 不在 core origin matrix 内**
`packages/collab/src/hocuspocus-adapter.ts:197` `Y.applyUpdate(options.document, update, metadata.origin ?? 'local')`。core 冻结的 origin matrix 是 `local-user` / `remote-user` / `auto-inserter` / `version-restore` / `system-recovery`（`packages/core/src/operations/transaction.ts:509`、`history.ts:17`），此处 fallback 的 `'local'` 是不在矩阵内的裸字符串。虽然目前 metadata.origin 一般有值、且此 origin 不进 user undo（未在 trackedOrigins 中），但一旦 metadata.origin 缺省，写入将带一个 diagnostics 无法归类的 origin，破坏 origin 可诊断性约束。建议 fallback 用 `'local-user'` 并断言 origin 属于已冻结矩阵。预估工作量：0.25 天。

### 5b.3 对首轮结论的订正

**（R2 订正）2.1.2「模块级 `memoryCollabRooms` 无全局清理入口」的泄漏描述过重**
`packages/collab/src/index.ts:562-568`：`unregisterMemoryAdapter` 每次都会 `room.awarenessStates.delete(state.clientId)` 再判断 `adapters.size === 0 && awarenessStates.size === 0`。正常 destroy 路径下本 adapter 的 awareness 会被清除，因此单 adapter 场景 room 能正常回收；仅当**同 room 其他 adapter 遗留了未清理的 awarenessStates**时 room 才不删。该问题真实但影响面仅限内存 demo/测试，且不是「room 永不清理」。定级 MEDIUM 偏高，建议下调为 LOW，或按测试辅助 `resetMemoryCollabRooms()` 处理即可（与首轮建议一致）。

**（R2 订正）3.2「History service document lock 无队列深度限制」的「无限队列」措辞需精确化**
`packages/collab-server/src/history-service.ts:120-142`：`finally` 中 `releaseCurrentLock()` 总会执行，`documentLocks.get(documentId) === queued` 仅在**没有新请求接管**时删除 Map 条目；有新请求时条目被新 `queued` 覆盖并由新请求接管，不会产生「永不释放的 Map 泄漏」。真实风险是**同一文档高频写入时 promise 链无背压**（内存中挂起的 task 链持续增长），而非条目泄漏。首轮「队列会无限增长而不释放」应订正为「promise 链缺少背压/深度限制」，Map 条目本身会随最后一个请求结束而清理。定级 MEDIUM 合理，建议保留。

---

## 六、结论

Gate 6 的实现在架构设计、安全边界、诊断体系、测试覆盖和 benchmark 验证方面表现优秀。Provider Adapter 模式、origin 隔离、版本握手和授权校验的设计都符合企业级要求。

需要重点关注的是 3 个 HIGH 级问题：Base64 编码栈溢出风险（生产环境中等概率触发）、IndexedDB update 监听性能（高频编辑场景必现）、以及 Hocuspocus autoConnect 竞态（取决于外部使用方式）。建议在合入前修复这三项。

其余 MEDIUM 和 LOW 级问题可在后续迭代中逐步改进。
