# @4xian/jword-persistence 当前实现摘要

## 包职责

`@4xian/jword-persistence` 提供协作/历史相关 persistence 契约：Yjs update log、snapshot、版本列表、版本加载、隔离预览、restore、compaction、storage-backed adapter、memory adapter、IndexedDB offline adapter 和 plugin adapter。它保存 Yjs binary update/snapshot，不保存 projection JSON，也不访问 core 内部 store。

## 入口与导出

- 包名：`@4xian/jword-persistence`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`yjs`、`y-indexeddb`。

## 公开 API 摘要

根入口主要导出：

- `createMemoryPersistenceHistoryService()`
- `createMemoryPersistenceAdapter()`
- `createUnavailableIndexedDbOfflineAdapter()`
- `createIndexedDbOfflineAdapter()`
- `createStoragePersistenceAdapter()`
- `createVolatileHistoryStorage()`
- `createJWordPersistencePluginAdapter()`
- `JWordPersistenceSnapshotAdapter`
- `JWordOfflineAdapter`
- update、snapshot、version、diagnostic、storage、IndexedDB 相关类型。

## 主要模块

- `index.ts`：核心 contract、memory adapter、preview/restore/compact。
- `storage-history-adapter.ts`：宿主 storage-backed persistence adapter。
- `indexeddb-adapter.ts`：浏览器 `y-indexeddb` offline adapter 与 unavailable fallback。
- `plugin-adapter.ts`：Plugin persistence adapter descriptor。
- `diagnostics.ts`：persistence diagnostic schema。
- `sha256.ts`：update/snapshot hash helper。

## 已实现能力

- 追加 Yjs binary update 并生成版本记录。
- 创建 snapshot record。
- 列出版本、加载指定版本 state update。
- 用隔离 `Y.Doc` 创建 preview。
- Restore 指定版本到目标 `Y.Doc`，成功后追加 restore version。
- Compaction：保存边界 snapshot，并把更早版本标记为 compacted。
- Memory adapter：用于 contract tests/demo。
- Storage-backed adapter：通过宿主 `loadDocument/saveDocument` 持久化完整历史。
- IndexedDB offline adapter：浏览器环境使用 `y-indexeddb`，非浏览器/不可用环境返回 recoverable diagnostic。
- Plugin adapter descriptor。

## 内部实现方案

- update 与 snapshot 都以 `Uint8Array` 作为运行时真源，并记录 byteLength、sha256、stateVector、version metadata。
- `createPreview()` 总是创建新 `Y.Doc` 并 apply update，避免污染当前文档。
- `restoreVersion()` 先构建隔离 preview，再用受控 transaction 替换目标文档顶层共享类型。
- Storage-backed adapter 把 update/snapshot 以 base64 序列化到宿主 storage。
- Load version 优先从最近 snapshot + tail updates 重建；snapshot 缺失时可从 update log 降级重建并返回诊断。
- IndexedDB adapter 只在存在 `globalThis.indexedDB` 时实例化 provider；否则返回 unavailable adapter。

## 与其它包关系

- 依赖 core 的 plugin adapter 类型。
- 被 collab client/server history 能力消费。
- `collab-server` history service 可组合 storage-backed adapter 与 volatile storage。
- 与 native 分离：`.jword` 不保存 Yjs update log；版本历史由 persistence 管理。

## 主要测试/验收入口

- `packages/persistence/test/memory-adapter.test.ts`
- `packages/persistence/test/storage-history-adapter.test.ts`
- `packages/persistence/test/indexeddb-adapter.test.ts`
- `tests/architecture/gate6-history-yjs-gc-decision.test.ts`
- `tests/architecture/gate6-package-exports.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-persistence typecheck`：校验 history/offline/storage/plugin adapter 类型。
- `pnpm --filter @4xian/jword-persistence test`：运行 memory、storage-backed 与 IndexedDB offline adapter 测试。
- `pnpm --filter @4xian/jword-persistence build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate6-history-yjs-gc-decision.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归 history/GC 决策、包导出和公开 API catalog。

## 当前限制/注意点

- Memory adapter 是 contract/demo 级实现。
- Storage-backed adapter 每次按 documentId 懒加载并保存完整历史，是生产后端 adapter 的最小样板，不是高性能数据库实现。
- IndexedDB 不可用时返回 recoverable diagnostic，不会伪装为可离线。
- 公开 API 不承诺直接使用 Yjs `Y.Snapshot` 或 `gc=false`；版本历史路线是 update log + JWord snapshot record + 隔离 `Y.Doc` 重放。
- Compaction 之前的版本会被标记为不可恢复。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/persistence/package.json`
- `packages/persistence/src/index.ts`
- `packages/persistence/src/storage-history-adapter.ts`
- `packages/persistence/src/indexeddb-adapter.ts`
- `packages/persistence/src/plugin-adapter.ts`
- `packages/persistence/src/diagnostics.ts`
- `packages/persistence/src/sha256.ts`

