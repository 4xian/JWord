# Gate 6 版本历史与 Yjs GC 技术决策

## 背景

`plan-review` §3.16 指出：如果版本预览或恢复依赖 Yjs 自带的 `Y.Snapshot` 路线，就会要求文档全生命周期关闭 GC。长文档在协同编辑、离线重放和自动插入场景下会持续积累 tombstone，最终把版本历史的空间和重放成本推高。

当前 JWord Gate 6 已经把协同真源固定为 Y.Doc update，并由 `packages/persistence` 管理 update log、JWord snapshot record、版本列表、只读预览、恢复和 compaction。因此本决策只冻结路线，不改变现有公开 API。

## 决策

1. 版本历史禁止依赖 `Y.Snapshot`，也禁止为了版本预览或恢复把文档生命周期改成 `gc = false`。
2. 版本历史固定使用 `update log + 隔离 Y.Doc 重放`：
   - 写入路径保存 Yjs binary update、state vector、sha256 和版本 metadata。
   - 预览路径在隔离 Y.Doc 中应用目标 state update，不复用当前可写 editor。
   - 恢复路径先在隔离 Y.Doc 中重放目标版本，再通过受控 restore transaction 替换当前 canonical document。
3. JWord snapshot record 是压缩后的 state update checkpoint，不等同于 Yjs `Y.Snapshot` API。
4. compact 或 snapshot 缺失时，只能通过 update log 和最近的 JWord snapshot record 重建，不引入 Yjs Snapshot API 作为降级路径。

## update log 增长治理

默认治理参数如下：

1. 每 200 个 update 或 5 分钟生成一个 snapshot，以先到者为准。
2. compaction 保留最近 50 个 snapshot，确保近期版本仍可低成本预览和恢复。
3. 更旧数据通过宿主 storage hook 归档；SDK 只约束 hook 契约和诊断，不在默认内存 adapter 中实现冷存储。
4. 归档后的版本如果无法恢复，必须返回稳定 persistence diagnostic，不静默半写当前文档。

## 当前实现约束

- `packages/persistence/src/index.ts` 和 `packages/persistence/src/storage-history-adapter.ts` 通过 `Y.applyUpdate()`、`Y.encodeStateAsUpdate()`、`Y.mergeUpdates()` 与隔离 `new Y.Doc()` 重建版本。
- `restoreVersion()` 必须先创建 preview，再通过受控 transaction 替换当前 doc；不能把旧 update 直接 apply 到当前 doc。
- `packages/collab-server` 的 history service 只能委托 persistence adapter，不实现第二条版本历史路线。
- architecture guard 负责阻止 `Y.Snapshot`、`Y.snapshot()`、`Y.encodeSnapshot()`、`Y.decodeSnapshot()`、`Y.createDocFromSnapshot()` 和 `gc = false` 进入版本历史相关源码。

## 非目标

- 不实现 Yjs Snapshot 路线。
- 不引入 Automerge、Loro 或第二套 CRDT 真源。
- 不在本批新增生产冷归档实现；宿主 storage hook 归档的具体后端留给集成方。
