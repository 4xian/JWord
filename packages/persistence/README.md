# @4xian/jword-persistence

Gate 6 persistence 包提供协作历史、snapshot、preview、restore 和离线恢复 adapter 契约。第三方宿主只应从包入口导入公开 API，不依赖 `src` 路径或 demo runtime。

## Public API

```ts
import {
  createMemoryPersistenceAdapter,
  createStoragePersistenceAdapter,
  createVolatileHistoryStorage
} from '@4xian/jword-persistence'

const historyStorage = createVolatileHistoryStorage()
const persistence = createStoragePersistenceAdapter({
  storage: historyStorage
})

await persistence.appendUpdate({
  documentId: 'doc-a',
  update: yjsUpdate,
  label: 'initial'
})
```

## Storage restore migration

`JWordHistoryStorage` 继续兼容只实现 `loadDocument()` 与 `saveDocument()` 的既有 backend；append、list、preview 等现有操作不要求 CAS。安全 restore 还要求 backend：

- 在 `loadDocument()` 返回的既有文档上提供 opaque `revision`。
- 实现 optional `compareAndSwapDocument(documentId, expectedRevision, document)`。
- 原子比较 `expectedRevision` 并一次替换完整历史文档；冲突返回 `{ committed: false }`。
- 成功写入后生成新的 revision，且忽略待保存文档携带的旧 revision。
- 原样保存并加载可选 `pendingRestore` 与 `completedRestore`；前者保存 operation/phase，后者只确认最近一次已 finalize 的 restore，不得把 pending update/version 混入普通历史数组。

缺少 revision 或 CAS 的 legacy backend 调用 restore 时会返回 `PERSISTENCE_RESTORE_FAILED`，不会修改目标 Y.Doc。`createVolatileHistoryStorage()` 已实现该最小 contract。

`restoreVersion()` 先以 CAS 创建不可见的 `prepared` pending，再应用 target，并将 pending 推进为 `target-applied`，最后才把 update/version finalize 到普通历史。target 应用前失败会取消 pending；同一 operation 的 observer divergence 会在重试时从 pending update 修复；target 已应用但 phase 或 finalize 暂时失败时返回可恢复的 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`。`target-applied` pending 保存实际 target 的 state update，保证 finalize 后从该 target 产生的普通 append 可按相同 CRDT lineage 重建。finalize 与 `completedRestore` 在同一次状态写入中提交，因此 backend 在提交后丢失确认时，调用方仍可用相同 source version 与对应 target 返回已完成版本，而不会追加第二个 restore。

同一 backing history/storage 对象上的 append 与 restore 使用 restore 专用进程内屏障：restore 活动或 durable pending 存在时，`appendUpdate()` 拒绝并抛出包含 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED` 的错误；append 已在途时，`restoreVersion()` 在创建 pending 或改写 target 前返回 `PERSISTENCE_RESTORE_FAILED`。append 只能在 pending 收敛后生成下一连续版本。只有已确认 finalize 后 result 才包含成功 version，`listVersions()` 永远不返回 pending version。

当前 Phase 2B B2 与 B4 最终 Standards/Spec 复审均为 `PASS`、0 finding；Persistence 公开 seam 与全包回归分别为 2 文件/18 测试和 4 文件/41 测试。批准范围内 B4 门禁已通过，根 `pnpm test` 仍有 Phase 2B 范围外既有失败，因此阶段状态保持 `Implementation complete / closure blocked`。

## Boundaries

- 包发布内容只包含 `dist`、`README.md` 和 package metadata。
- persistence 只保存 Yjs binary update、snapshot 和版本 metadata，不保存 projection JSON。
- IndexedDB adapter 只用于浏览器离线恢复；服务端历史存储由宿主注入。
- preview 与 restore 必须使用隔离 `Y.Doc`，避免污染 live collaboration doc。
- pending/finalize/recovery、restore/append 进程内屏障与单个最近完成确认只服务公开 `restoreVersion()`；通用 history append CAS、幂等 append、多实例竞争、外部 operation store 和完整 `PERS-02` 仍不属于当前 contract。
