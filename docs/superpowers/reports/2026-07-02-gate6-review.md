# Gate 6 代码审查报告

> 审查日期：2026-07-02
> 审查范围：packages/collab、packages/collab-server、packages/persistence、packages/core/src/collaboration、examples/collab、tests/architecture/gate6-*、benchmarks/gate6-collab-benchmark.mjs
> 审查人：Enterprise Code Reviewer

---

## 一、总体评价

Gate 6 的实现质量整体较高，架构分层清晰、职责边界明确。Provider Adapter 模式成功隔离了 Hocuspocus 内部类型；授权校验在连接建立前完成；自动插入器不侵入用户光标和 undo 栈；version handshake 设计健壮。以下按审查维度逐一列出发现。

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

**结论：设计正确**

`StorageBackedJWordCollabHistoryService`（`history-service.ts:64-143`）使用 `runWithDocumentLock` 实现同一文档的 promise 链式串行。

**[MEDIUM] Document lock 可能导致无限队列堆积**

`runWithDocumentLock` 通过 `previous.catch(() => undefined).then(() => current)` 将所有操作排队。如果某个文档的 history 操作频率极高（如自动保存每秒一次），队列会无限增长而不释放。虽然通过 `finally` 块释放锁和清理 Map 条目，但如果在锁持有期间有更多请求到达，`documentLocks.get(documentId) === queued` 的检查会失败，导致 Map 条目不被清理。

- 位置：`packages/collab-server/src/history-service.ts:120-142`
- 建议：考虑添加队列深度限制或超时机制。

**[LOW] 每次操作都创建新 adapter 实例**

`runWithDocumentLock` 中 `task(this.createAdapter())`（第 136 行）每次调用都创建新的 `StoragePersistenceAdapter`。虽然 adapter 本身是轻量的（只包装 storage 引用），但在高频调用场景中会产生额外 GC 压力。

#### 2.4.3 Auto-Insert Relay

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

### HIGH（3 项）

1. **Base64 栈溢出风险**：`client-history.ts:478` 使用 `String.fromCodePoint(...update)` 展开运算符，大文档（>100KB）会栈溢出。
2. **IndexedDB update 监听性能**：每次 Yjs update 都编码完整文档状态，连续编辑时 O(N) 操作频繁触发。
3. **Hocuspocus adapter autoConnect 竞态**：构造时 autoConnect 默认 true 且立即 attach，可能在用户调用 connect() 前已开始连接。

### MEDIUM（6 项）

1. 模块级 `memoryCollabRooms` 无全局清理入口。
2. Awareness 校验函数在 index.ts 和 hocuspocus-adapter.ts 中重复（约 200 行）。
3. 版本比较不支持预发布标识。
4. Auth hook 和 license hook 的默认行为不一致（auth 默认放行、license 默认拒绝）。
5. History service document lock 无队列深度限制。
6. IndexedDB load 中 `restoredDoc` 未显式 destroy。

### LOW（3 项）

1. Hocuspocus adapter destroy 后 awareness 回调时序可能异常。
2. sendUpdate 直接修改外部 Y.Doc 无文档说明。
3. History service 每次操作创建新 adapter 实例。

---

## 五、建议优先修复项

1. **[HIGH] 修复 Base64 编码栈溢出** — 改用循环拼接或 Buffer 方案，避免大文档场景崩溃。
2. **[HIGH] 节流 IndexedDB update 监听** — 使用 debounce 或仅在特定事件时更新 byteLength。
3. **[HIGH] 修复 Hocuspocus autoConnect 竞态** — 强制 autoConnect=false 或延迟 attach。
4. **[MEDIUM] 消除 awareness 校验函数重复** — 提取到共享内部模块。
5. **[MEDIUM] 添加 restoredDoc.destroy()** — 防止 Y.Doc 内存泄漏。

---

## 六、结论

Gate 6 的实现在架构设计、安全边界、诊断体系、测试覆盖和 benchmark 验证方面表现优秀。Provider Adapter 模式、origin 隔离、版本握手和授权校验的设计都符合企业级要求。

需要重点关注的是 3 个 HIGH 级问题：Base64 编码栈溢出风险（生产环境中等概率触发）、IndexedDB update 监听性能（高频编辑场景必现）、以及 Hocuspocus autoConnect 竞态（取决于外部使用方式）。建议在合入前修复这三项。

其余 MEDIUM 和 LOW 级问题可在后续迭代中逐步改进。
