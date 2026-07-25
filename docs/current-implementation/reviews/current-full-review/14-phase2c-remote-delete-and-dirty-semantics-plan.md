# Phase 2C 远端纯删除 update 与 dirty 语义统一计划

> 状态：`B0-B4 Closed`。原关单被多页布局 P1 反例推翻后，`CORE-01` 与 B3/B4 已完成重开修复、全量门禁和最终双轴复审；`CORE-05` 保持关闭，13 号保持不变。
>
> Finding：`CORE-01`、`CORE-05`。
>
> 实施授权：用户已明确选择 D1，并批准 B0 docs-only 契约调整。B0 经 Standards/Spec 双轴复审 `PASS`、0 finding 后自动批准进入 B1；后续每批复审通过后自动进入下一批。

## 1. 权威范围与前置状态

本计划按以下文档解释 Phase 2C：

1. [09-remediation-roadmap.md](09-remediation-roadmap.md)：Phase 2C 先以纯删除和幂等重放建立回归，再统一真实 transaction 变化判定。
2. [08-issues-register.md](08-issues-register.md)：`CORE-01`、`CORE-05` 均分配到 2C。
3. [03-core-editor-and-layout.md](03-core-editor-and-layout.md)：记录 state vector 漏纯删除、`run()` 按 operation 数量误报 dirty 的根因与已知复现。
4. [10-verification-plan.md](10-verification-plan.md)：要求覆盖纯删除 update，并保留完整验证、环境和 dirty workspace 证据。
5. [13-phase2b-restore-and-resource-roundtrip-plan.md](13-phase2b-restore-and-resource-roundtrip-plan.md)：只作为 Phase 2B 已 `Closed` 和 Phase 2C 可独立开始的前置证据；Phase 2C 不修改、重写或续写 13 号计划。

本轮明确排除：

- 不修改 Phase 2B persistence/native 实现，不重新打开 `SEC-04/PERS-01`、`FMT-03`、`PERS-03`。
- 不进入 License/OEM、DOCX/PDF、Collaboration admission。
- 不处理 Phase 5 或 Phase 6 finding。
- 不新增公开 API，不改变 Yjs update 协议、历史格式或持久化格式。
- 不使用“收到 update 就 `dirty:true`”、完整文档编码、完整 projection 深比较作为变化检测。
- 不执行 `git add`、commit、push、PR、publish，不清理或覆盖当前 staged、unstaged、untracked 内容。

## 2. B0 调查基线

调查和本文写入前的当前基线：

- HEAD：`a94c6761bfc1b0b57f33074954b7e845edc862e6`。
- 分支：`feature/review_questions`，相对远端 ahead 4。
- 环境：Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`。
- `pnpm-lock.yaml` SHA-256：`983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。
- 本文创建前 `git status --porcelain=v1` 为 191 个条目，SHA-256 为 `a93b995024d984cb4ee9b152ac96ae111fcbceffdfa1dd2e7e28927be99c3bd1`。
- staged 文件 153 个、unstaged 文件 53 个、untracked 文件 17 个；三组存在重叠，不能相加推导 porcelain 数量。
- Phase 2C 预计涉及的 Core 源码和 focused 测试文件在 B0 开始时没有 staged 或 unstaged diff。
- `.codegraph/` 存在，`codegraph status .` 报告 720 files、11,756 nodes、54,141 edges，索引为最新。结构调用链先用 CodeGraph，精确文本与行号再用当前磁盘源码校正。

B0 focused 基线：

```bash
pnpm exec vitest run \
  packages/core/test/collaboration/editor-update.test.ts \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts
```

结果为 4 个测试文件、18 个测试全部通过。该结果只说明现有测试没有锁定本计划的新契约，不代表 finding 已修复。

## 3. 当前调用链

### 3.1 本地 command 路径

```text
editor.executeCommand()
  -> JWordEditorFacadeRuntime.executeCommand()
  -> history.stopCapturing()/captureNextTransaction()（仅 tracked origin）
  -> createTransactionPipeline().run()
  -> doc.transact()
  -> adapter.applyAll(operations)
  -> createProjectionAfterOperationTransaction()
  -> dirty = operations.length > 0
  -> notifyListeners()
  -> JWordEditorState.handleTransactionEvent()
```

当前关键位置：

- `packages/core/src/editor/facade-runtime.ts:240-275`：在 pipeline 运行前，只根据 origin 和 `command.operations.length > 0` 决定是否预登记 history metadata。
- `packages/core/src/operations/transaction.ts:569-630`：`run()` 执行 operation 后总是计算下一版 projection，并在第 623 行以 `operations.length > 0` 判 dirty。
- `packages/core/src/operations/projection-dirty-scope.ts:32-46`：按 operation 元数据计算增量 projection；它不知道 operation 是否真的改了 Y.Doc。

因此“operation 数组非空”目前同时驱动 dirty、projection 替换和 history 预登记，但它不是 Y.Doc 变化的可靠证据。

### 3.2 远端/恢复 update 路径

```text
editor.applySyncUpdate()
  -> JWordEditorCollaborationRuntime.applySyncUpdate()
  -> createTransactionPipeline().applyUpdate()
  -> Y.applyUpdate()
  -> hasDocumentStateChanged()
  -> dirty ? createDocumentProjection() : previousProjection
  -> notifyListeners()
  -> JWordEditorState.handleTransactionEvent()
```

当前关键位置：

- `packages/core/src/editor/collaboration-runtime.ts:25-30`：公开 Editor seam 直接转发到 pipeline，没有额外修正。
- `packages/core/src/operations/transaction.ts:631-666`：`applyUpdate()` 在事务前编码 state vector，应用 update 后调用 `hasDocumentStateChanged()`。
- `packages/core/src/operations/transaction.ts:721-730`：`hasDocumentStateChanged()` 只比较前后 state vector；纯删除只产生 delete set，不推进 struct clock，因此被判为未变化。

### 3.3 projection、layout、event 与 plugin 路径

pipeline 在 Editor 构造时被订阅：

```text
pipeline.notifyListeners(event)
  -> JWordEditorState.handleTransactionEvent(event)
  -> operationSummary 更新
  -> currentProjection = event.projection
  -> layoutNeedsRefresh = true
  -> mountedTextMirrorNeedsRefresh = true
  -> cancel/schedule 或立即执行 mounted render
  -> emit(transaction event)
  -> pluginHost.dispatchAfterTransaction(event)
```

`packages/core/src/editor/state.ts:160-175` 当前不检查 `event.dirty`。因此：

- `dirty:false` 仍替换 Editor projection。
- `dirty:false` 仍使 layout 和 mounted text mirror 失效。
- `dirty:false` 仍取消并重新调度 render。
- transaction listener 与 plugin `afterTransaction` 始终收到一次事件。

layout 在 `packages/core/src/editor/layout-runtime.ts:24-68` 和 `:184` 之后按 `layoutNeedsRefresh` 重算；所以当前幂等重放虽然返回 `dirty:false`，仍会使下一次 `getLayout()` 得到新的 layout 对象。

### 3.4 shared-document 路径

同一个 Y.Doc 上的多个 Editor 通过以下路径传播事务：

```text
source editor pipeline event
  -> sharedTransactionDispatcher
  -> otherEditor.refreshFromSharedTransaction()
  -> createDocumentProjection(shared Y.Doc)
  -> handleTransactionEvent()
  -> refreshSelectionAfterSharedTransaction()
```

`packages/core/src/editor/state.ts:147-157` 当前无条件重建 shared projection 和刷新 selection；因此未来将 no-op/replay 改成 `dirty:false` 后，如果这里只改 pipeline 而不改 state，其他 Editor 仍会做无效 projection/layout 工作。

### 3.5 undo/history 路径

`packages/core/src/operations/history.ts:82-149` 为 user、auto-inserter、version-restore 建立三个 `Y.UndoManager`。本地 user command 在事务前排入 metadata；`Y.UndoManager` 作用域是整个 doc，因此 tracked origin 的空事务也可能形成空 StackItem。

当前真实结果是：本地 no-op command 后 `editor.canUndo()` 可返回 `true`，但随后的 `editor.undo().stackItem` 为 `null`。此外，未被 stack-item-added 消费的 pending metadata 还可能污染下一次真实事务的 metadata。Phase 2C 必须同时阻止空历史项并清理该次预登记 metadata。

远端 `applySyncUpdate()` 默认 origin 不属于 user undo 的 tracked origin；本计划保持远端 update 不进入默认 user undo 栈。

## 4. 真实复现证据

B0 使用当前 TypeScript 源码，通过 `packages/core` 根的 Vite SSR 模块图运行内联探针；没有创建或修改仓库文件。探针以公开 `editor.applySyncUpdate()` 作为行为入口，只在构造 source/target CRDT lineage 和读取 Yjs transaction 证据时使用内部 collaboration document token。

### 4.1 远端纯删除

步骤：

1. source 和 target 先共享同一份 `abc` CRDT 状态。
2. source 删除中间字符 `b`。
3. 以 target 的 state vector 编码 source 差量，得到 10-byte 纯删除 update。
4. target 调用公开 `editor.applySyncUpdate(update, { origin: 'remote-user' })`。

结果：

| 观察项 | 当前结果 | 正确契约 |
| --- | --- | --- |
| target 真实 Y.Doc | `ac` | `ac` |
| `TransactionResult.dirty` | `false` | `true` |
| result projection | `abc` | `ac` |
| `editor.getProjection()` | `abc` | `ac` |
| `editor.getLayout()` 文本 | `abc` | `ac` |
| transaction listener | 1 次，`dirty:false`，projection 为 `abc` | 1 次，`dirty:true`，projection 为 `ac` |
| 默认 user undo | `false` | 继续为 `false` |

首次纯删除的 Yjs transaction 证据：

| 字段 | 值 |
| --- | ---: |
| `transaction.changed.size` | 1 |
| `transaction.changedParentTypes.size` | 7 |
| `transaction.deleteSet.clients.size` | 1 |
| delete range 数 | 1 |
| `afterState` 相对 `beforeState` 推进 | 否 |

这证明 state vector 单独比较必然漏掉纯删除，而真实 Y.Doc 已经改变。

### 4.2 相同 update 幂等重放

对 target 重放同一个 10-byte update：

| 字段 | 值 |
| --- | ---: |
| `transaction.changed.size` | 0 |
| `transaction.changedParentTypes.size` | 0 |
| `transaction.deleteSet.clients.size` | 0 |
| delete range 数 | 0 |
| `afterState` 相对 `beforeState` 推进 | 否 |
| 当前返回 dirty | `false` |

幂等重放的 dirty 值当前正确，但 `handleTransactionEvent()` 仍让 layout 失效；实测 replay 后 projection identity 可复用，layout identity 仍被替换。B3 必须关闭这个下游无效刷新。

### 4.3 非空 operation 的本地 no-op

以下 operation 数组均非空，但当前 adapter 没有改变 Y.Doc：

| 场景 | Yjs changed/parent/delete/clock | 当前 dirty |
| --- | --- | ---: |
| 插入空字符串 | `0 / 0 / 0 / 不推进` | `true` |
| 折叠范围删除 | `0 / 0 / 0 / 不推进` | `true` |
| 空 `setRunProperties` | `0 / 0 / 0 / 不推进` | `true` |
| 空 `setParagraphProperties` | `0 / 0 / 0 / 不推进` | `true` |
| 无 header/footer 的空 `setSectionProperties` | `0 / 0 / 0 / 不推进` | `true` |
| 对没有链接的 run 再清除链接 | `0 / 0 / 0 / 不推进` | `true` |
| 删除不存在的 resource | `0 / 0 / 0 / 不推进` | `true` |

这些 command 当前还会：

- 无谓替换 pipeline projection。
- 使 Editor layout 失效并在 mounted 状态调度 render。
- 向 transaction listener 和 plugin 报告误导性的 `dirty:true`。
- 对 tracked local origin 产生空 undo 项；空插入探针中 `canUndo() === true`，但 `undo().stackItem === null`。

### 4.4 正常真实变化与同值属性冲突

正常插入与删除仍必须保持 `dirty:true`：

| 场景 | changed | changedParentTypes | deleteSet | clock 推进 |
| --- | ---: | ---: | ---: | --- |
| 插入文本 | 1 | 7 | 0 | 是 |
| 删除文本 | 1 | 7 | 1 | 否 |

另有一个必须在实施前显式决定的契约冲突：对已经为 `{ bold: true }` 的 run 再写一次 `{ bold: true }`，projection JSON 虽不变，但当前 Y.Map adapter 会创建新 struct 并删除旧 struct。实测 `changed=1`、delete set 非空、clock 推进，并产生 26-byte update。

因此“重复设置同值”在当前实现中不是 Y.Doc no-op。若把它强制定义成 `dirty:false`，必须在 operation adapter 写入前做属性级 write-elision；仅修改共享 transaction detector 无法同时满足该要求。

## 5. dirty 的候选规范语义与当前生效契约

用户已明确选择 D1，本次 B0 已同步修改 03 号，使以下规范成为 Phase 2C 当前生效契约：

> `dirty` 表示本次 transaction pipeline 调用是否产生可由 Yjs update 表达的文档变化，而不是是否收到 command/update、operation 是否非空、state vector 是否变化，或 projection JSON 是否深相等。

- 新增或修改产生新 struct：`dirty:true`。
- 删除产生 delete set，即使 state vector 不推进：`dirty:true`。
- 同一 update 幂等重放，没有新 struct 和 delete set：`dirty:false`。
- 非空 operation 实际没有写入 Y.Doc：`dirty:false`。
- 当前 adapter 重复写同值并实际产生新 struct/delete set：按 D1 为 `dirty:true`。

D2 未被选择，不在 Phase 2C 实施范围；本轮不增加 operation adapter write-elision。

### 5.1 dirty 对下游的规范影响

| 下游 | `dirty:true` | `dirty:false` |
| --- | --- | --- |
| pipeline projection | 按本地 operation dirty scope 增量重建，或对 raw update 完整重建 | 复用已有 projection；仅在 pipeline 从未建立 projection 时允许初始化一次 |
| Editor projection | 接受 event projection | 保留当前 Editor projection identity |
| layout/text mirror | 标记失效并按现有策略刷新 | 不置脏、不取消 render、不调度 document render |
| shared Editor | 重建共享 projection并刷新 selection | 不重建 projection，不刷新 selection/layout |
| transaction listener | 发布一次 `dirty:true` event | 仍发布一次 `dirty:false` event，保留 command diagnostic 和 observability |
| plugin `afterTransaction` | 正常派发 | 仍派发一次，但 projection 使用当前稳定快照 |
| update byte diagnostic | 开启诊断时报告本次可编码 delta；纯删除必须非 0 | 0 |
| user undo/history | 真实 tracked local 变化进入对应 scope | 不创建 StackItem，不遗留 pending metadata |
| 远端 update undo | 默认不进入 user undo | 默认不进入 user undo |

保留 `dirty:false` transaction event 是兼容性最小的选择：调用方仍能观察 command、requestId、origin 和 replay，但可以依据 dirty 跳过昂贵工作。Phase 2C 不把 no-op 改成“无事件”。

## 6. Yjs 变化检测候选对比

当前锁定的 Yjs 版本为 `13.6.30`。`node_modules/.pnpm/yjs@13.6.30/node_modules/yjs/src/utils/Transaction.js:130-137` 的 `writeUpdateMessageFromTransaction()` 只有在以下两项都为空时才返回 false：

1. `transaction.deleteSet.clients.size === 0`。
2. `transaction.afterState` 没有任何 client clock 相对 `beforeState` 改变。

候选比较：

| 方案 | 插入/修改 | 纯删除 | 幂等重放 | 结论 |
| --- | --- | --- | --- | --- |
| 前后 state vector | 是 | **漏报** | 否 | 当前根因，拒绝 |
| `transaction.changed` | 当前样例可识别 | 可识别 | 否 | Yjs 注释明确“新建 type 不包含在此 Map”，不作为唯一真值 |
| `transaction.changedParentTypes` | 当前样例可识别 | 可识别 | 否 | 主要服务 `observeDeep`，表示观察传播范围，不是 update 可编码性的直接契约 |
| `transaction.deleteSet` | 否 | 是 | 否 | 单独使用漏插入/修改 |
| `deleteSet` 或 client clock 推进 | 是 | 是 | 否 | 与 Yjs 自身 update writer 判定一致，推荐 |
| 监听 Y.Doc `update` event | 是 | 是 | 不触发 | 行为可行，但会引入 encoder/event 装配和额外副作用，不需要用 bytes 才能得到同一结论 |
| `Y.encodeStateAsUpdate()` 后看 bytes | 是 | 是 | 可区分 | 可继续用于显式开启的 diagnostic，不得作为默认 dirty detector |
| 完整 projection 深比较 | 可识别语义差异 | 可识别 | 可识别 | 违反本轮约束，成本与语义也错误，拒绝 |

## 7. 推荐最小实现

### 7.1 一个共享内部 helper

新增内部文件 `packages/core/src/operations/yjs-transaction-change.ts`，只暴露一个小 interface：

```typescript
hasYjsTransactionChanged(transaction: Y.Transaction): boolean
```

实现只检查：

```text
transaction.deleteSet.clients.size > 0
OR
任一 transaction.afterState client clock 与 beforeState 不同
```

该 helper 被 transaction pipeline 和 history adapter 复用；不导出到 package public root，不读取 `doc.store`，不编码完整 update，不接触 projection。

### 7.2 捕获同一笔 Yjs transaction

- `run()` 和 `runMutation()`：使用 `doc.transact(transaction => ...)` 回调参数保存当前 `Y.Transaction` 引用，事务完成后再调用共享 helper。`afterState` 在 transaction cleanup 后已经填充。
- `applyUpdate()`：在 `Y.applyUpdate()` 周围临时监听并捕获其第一笔 `afterTransaction`。listener 必须在 `try/finally` 的 `finally` 中移除，保证 malformed update、observer throw 或 `Y.applyUpdate()` 其它异常都不会泄漏监听器。
- 捕获器只接受这次同步调用产生的第一笔 transaction。focused 测试先构造 pipeline，再 spy Y.Doc 的公开 `doc.on()`/`doc.off()`，避免把 pipeline 的常驻 cache listener 混入断言；随后记录本次 `applyUpdate()` 新注册的 `afterTransaction` listener，并在成功路径和异常路径都断言 `off()` 使用同一个 listener。失败后再应用有效 update 只能作为行为健全性检查，不能单独作为 listener 已清理的证据。
- 同一个 pipeline 调用旁再挂独立 `afterTransaction` observer，证明实际捕获的是本次 metadata 对应的 transaction，且 raw remote update 的 `transaction.local === false`；该 observer 不替代 `on()`/`off()` 配对断言。
- 不得用外层 `doc.transact()` 包住 `Y.applyUpdate()`：Yjs 的 raw update 路径本应建立 `local:false` transaction；外层普通 `doc.transact()` 会先建立 `local:true` transaction，改变远端事务语义。
- 保留 `internalTransactionDepth` 对 pipeline 自有事务的缓存保护；外部直接写 Y.Doc 仍按现有 listener 使 pipeline projection cache 失效。

### 7.3 pipeline projection 与 diagnostic

- `run()`：只有 helper 返回 true 时调用 `createProjectionAfterOperationTransaction()`；false 时复用 previous projection。
- `applyUpdate()`：helper 返回 true 时完整重建 projection，false 时复用 previous projection。
- `runMutation()`：使用同一 dirty 语义，真实替换继续重建；空 mutation 复用 projection。
- update length diagnostic 继续保持显式 opt-in。dirty false 直接为 0；dirty true 时才按事务前 state vector 编码增量。纯删除虽 state vector 不推进，`encodeStateAsUpdate(doc, stateBefore)` 仍会包含 delete set。
- 删除旧 `hasDocumentStateChanged()` 及只为 dirty 比较存在的 byte-array equality；state vector 只保留给 opt-in update length diagnostic。

### 7.4 Editor state、shared document 与 event

在 `JWordEditorState` 内集中处理 dirty：

- 先把 `dirty:false` event 的 projection 规范化为当前 Editor projection，保证 listener/plugin 看到稳定快照。
- operation summary、transaction event、plugin `afterTransaction` 始终执行一次。
- 只有 dirty true 才替换 `currentProjection`、标记 layout/text mirror、取消或调度 document render。
- `refreshFromSharedTransaction()` 只有 dirty true 才调用 `createDocumentProjection()` 和 `refreshSelectionAfterSharedTransaction()`；dirty false 直接复用当前 projection 进入事件生命周期。

该变更把“是否产生事件”和“是否刷新文档派生状态”分开，不改变现有 observability interface。

### 7.5 selectionAfter 的独立刷新

`packages/core/src/editor/facade-runtime.ts:266-280` 当前会先以 `render:false` 写入 `selectionAfter`，再依赖后续 transaction document render 绘制 caret/selection。B3 让 `dirty:false` 跳过 document render 后，必须补上 selection-only 路径：

- pipeline 返回 `dirty:false` 且 `hasSelectionAfter === true` 时，调用 `refreshMountedSelectionRuntime(selectionBefore)`，使用已经提交的 `currentSelection` 绘制 caret/selection。
- 该调用只走 `renderMountedLayout('selection', true)` 或 assistive DOM 同步，不把 document layout 标记为 dirty，也不重建 projection。
- `emitSelectionChange()` 仍只执行一次；不得通过重新调用 `commitSelection()` 造成重复 selection event。
- mounted 回归必须证明 no-op command 改变 `selectionAfter` 后，新 caret/selection 被绘制，同时 document layout identity 保持不变。

### 7.6 history

- `Y.UndoManager` 的 `captureTransaction` 复用 `hasYjsTransactionChanged()`，阻止 tracked no-op 形成空 StackItem。
- `executeCommand()` 已在事务前预登记 metadata；当 pipeline 返回 `dirty:false` 时，必须丢弃本次 pending metadata，避免下一次真实 transaction 绑定到错误 command。
- 正常本地插入/删除继续形成一个可撤销项；remote-user、auto-inserter、version-restore 的既有 scope 隔离保持不变。

## 8. 公共回归 seam 与最少测试矩阵

### 8.1 seam 选择

第一优先级是公开 Editor interface：

```text
createEditor/createEditorWithCollaborationDocument
  -> editor.applySyncUpdate()
  -> editor.getProjection()/getLayout()/subscribe()/canUndo()
```

测试可使用内部 collaboration document token 构造同一 CRDT lineage，但行为断言必须落在公开 Editor method 和公开 transaction event 上。不得新增生产 test hook 或暴露 Y.Doc internals。

第二层使用 `createTransactionPipeline()`：直接覆盖 Yjs transaction 变化判定、diagnostic 和 operation no-op，不用 Editor 下游掩盖 detector 错误。

### 8.2 最少测试矩阵

| ID | seam | 场景 | 必须断言 |
| --- | --- | --- | --- |
| T1 | public Editor | 单页 `abc -> ac`，以及后页 no-op 后首页远端纯删除 | `dirty:true`；projection 和 layout 立即一致；多页布局不复用旧前缀；listener 收到一次 true event；默认 user undo 仍 false |
| T2 | public Editor | 重放 T1 的同一 update | `dirty:false`；projection/layout identity 保持；listener 仍收到一次 false event；不进入 undo |
| T3 | transaction pipeline | 本地空插入或折叠删除 | operation 非空但 `dirty:false`；projection 复用；diagnostic update bytes 为 0 |
| T4 | transaction pipeline | 正常插入和正常删除 | 两者继续 `dirty:true`；插入覆盖 clock 路径，删除覆盖 delete set 路径 |
| T5 | public Editor/history | tracked local no-op | `canUndo()` 保持 false；随后真实 command 的 history metadata 正确，不出现 phantom undo |
| T6 | public Editor/event | local no-op 或 replay | 仍发布一次 `dirty:false` transaction event；不刷新 layout；plugin 生命周期不丢失 |
| T7 | transaction pipeline/public Editor | `runMutation()` 空 mutation 与真实 document/sync replace | 空 mutation `dirty:false` 并复用 projection；真实 model mutation 和公开 `replaceSyncUpdate()` 继续 `dirty:true` |
| T8a | mounted Editor | 非空 no-op command 携带新的 `selectionAfter` | caret/selection canvas 刷新；selection event 恰好一次 |
| T8b | mounted Editor | T8a 完成后的 document layout | layout identity 不变；该断言在 B1/B2 保持红灯，到 B3 才变绿 |
| T9 | transaction pipeline | raw remote update 与异常清理 | 独立 observer 捕获本次 transaction origin 且 `local:false`；成功和异常路径的 `doc.off()` 均使用本次 `doc.on()` 注册的同一个 listener |
| T10 | shared Editors | source 分别执行 local no-op/replay；target 后页 no-op 后接收 source 首页 dirty 删除 | false event 保持 projection/layout identity 且不刷新 selection；dirty event 从第一页全量失效，projection/layout 与共享真源一致 |

最少新增测试应合并相关断言，避免为每个 no-op operation 单独增加测试。T3 选择一个稳定代表场景即可；其余 no-op 作为 B0 characterization 清单保留。T7 的真实 mutation 与 replace 可分别并入现有 pipeline/public update fixture。T8a/T8b 复用现有 mounted canvas spy 模式，但放入独立的 `runtime-dirty-selection.test.ts`，避免当前 967 行的 `runtime.test.ts` 突破约 1000 行上限；不另建浏览器 fixture。T10 扩展现有 shared-document fixture，以 target 的公开 identity、transaction/selection event 和 `getSelection()` 作为可观察 seam。正常插入/删除现有测试可扩展断言，不重复搭建 fixture。

## 9. 文件级改动清单

### B0 契约门禁

- D1 路径（已选择）：只修改 `03-core-editor-and-layout.md` 与本文件，完成 CORE-05 docs-only 契约调整；不修改源码或测试。双轴复审 `PASS`、0 finding 后自动进入 B1。
- D2 路径：03 号保持不变，只修订本文件以列出获批的 operation adapter write-elision 文件与同值测试；在该范围获批前不修改源码或测试。

### B1 只改测试

- `packages/core/test/collaboration/editor-update.test.ts`
  - 在公开 `editor.applySyncUpdate()` seam 增加纯删除与同 update 重放。
  - 断言 projection、layout、event、identity 和默认 undo。
  - 断言公开 `replaceSyncUpdate()` 的真实 replacement 继续 `dirty:true`。
  - 扩展现有双 Editor shared-document fixture：source local no-op/replay 后，target 每次收到一次 false event，但不替换 projection/layout、不刷新 selection。
- `packages/core/test/collaboration/transaction-update.test.ts`
  - 在 pipeline 层锁定纯删除、replay 和 opt-in update byte diagnostic。
  - 用独立 observer 锁定 raw update transaction 的 origin 与 `local:false`。
  - spy `doc.on()`/`doc.off()`，锁定成功和异常路径都以同一 `afterTransaction` listener 完成清理。
- `packages/core/test/operations/transaction.test.ts`
  - 锁定非空 no-op 为 false；真实插入/删除为 true。
  - 锁定 `runMutation()` 空 mutation 为 false、真实 model mutation 为 true。
- `packages/core/test/editor/facade-history.test.ts`
  - 锁定 local no-op 不产生 phantom undo，且下一次真实事务 metadata 不漂移。
- 新增 `packages/core/test/editor/runtime-dirty-selection.test.ts`
  - 复用现有 mounted canvas spy 模式，锁定 no-op `selectionAfter` 的 caret/selection-only 刷新、单次 selection event 和 layout identity。
  - 保持 focused、只覆盖 T8a/T8b；不继续扩张已达 967 行的 `runtime.test.ts`。

### B2 最小共享变化检测

- 新增 `packages/core/src/operations/yjs-transaction-change.ts`
  - 实现共享 `Y.Transaction` 变化判定。
- 修改 `packages/core/src/operations/transaction.ts`
  - 捕获 `run()`、`applyUpdate()`、`runMutation()` 的真实 transaction。
  - `applyUpdate()` 临时 listener 使用 `try/finally` 清理，并保持 raw update `local:false`。
  - 删除 state-vector-only dirty 判定。
  - dirty false 时复用 projection，保持 diagnostic 语义。
- 修改 `packages/core/src/operations/history.ts`
  - 用同一 helper 过滤空 Yjs transaction。
- 修改 `packages/core/src/editor/facade-runtime.ts`
  - pipeline 返回 false 时丢弃本次预登记 history metadata。

### B3 projection/layout/event 回归

- 修改 `packages/core/src/editor/state.ts`
  - dirty false 保持 Editor projection/layout identity。
  - shared-document no-op 不重建 projection 或刷新 selection。
  - event、diagnostic、plugin 生命周期继续发布。
- 修改 `packages/core/src/editor/facade-runtime.ts`
  - dirty false 且存在 `selectionAfter` 时执行一次 selection-only mounted refresh。
  - 保持 selection event 单次发布，不把 layout 标记为 document dirty。
- 只扩展 B1 已选定的四个既有 focused 测试文件和一个新增 focused 文件 `runtime-dirty-selection.test.ts`；不修改 `runtime.test.ts`，不新增浏览器 fixture，除非现有 jsdom mounted seam 无法证明 caret/selection 绘制。

### B4 文档关单

- 更新 `03-core-editor-and-layout.md`：若 D1 已在 B0 正式调整契约，只追加最终验证证据；若选择 D2，则保持“同值为 false”并记录 write-elision 证据。
- 更新 `08-issues-register.md`：只在全部门禁通过后关闭 `CORE-01`、`CORE-05`。
- 更新 `09-remediation-roadmap.md`：记录 Phase 2C 状态与下一阶段边界。
- 更新 `10-verification-plan.md`：写入环境、命令、测试数量、双轴复审和 dirty workspace 证据。
- 更新本文件：追加 B1-B4 red/green、复审和关单证据。
- 不修改 13 号计划。

## 10. B1 -> B2 -> B3 -> B4 实施顺序

### B0：只读调查和契约冻结（Closed）

内容：

- 完成 CodeGraph 调用链、当前源码、Yjs transaction 与公开 seam 探针。
- 完成 dirty 候选语义、候选比较、测试矩阵、文件范围和排除项调查。
- 调查轮只新增本文件；用户随后选择 D1，并批准 B0 只修改 03 号和本文件完成契约冻结。
- D1 契约冻结完成后执行独立 Standards/Spec 双轴只读复审；双方 `PASS`、0 finding 后自动进入 B1。

进入 B1 前的契约门禁：

1. D1 已由用户明确选择。
2. `03-core-editor-and-layout.md` 已把 CORE-05 调整为“Yjs 可编码变化”规范：真实 no-op 为 false，同值 Y.Map 写入产生新 struct/delete set 时为 true。
3. B0 Standards/Spec 双轴复审均为 `PASS`、0 finding。

退出标准：

- 本文件包含用户要求的全部输出。
- 源码、测试、13 号保持不变；D1 的 B0 退出只允许 03 号与本文件产生 docs-only diff。
- Standards/Spec 双轴复审均为 `PASS`、0 finding；不存在未解决的实施前决策 blocker。

验证：

```bash
git status --short
git diff --check
git diff --cached --check
```

并逐一对全部 untracked 文件执行：

```bash
git diff --no-index --check /dev/null <untracked-file>
```

`git diff --no-index` 对非空新文件返回 1 且没有 diagnostic 是预期内容差异；有 whitespace diagnostic 或其它异常才失败。

### B0 复审收口（2026-07-20）

- 当前 B0 只产生 03 号 unstaged 修改和本文件 untracked 文件；Phase 2C 源码、测试与 13 号没有新增 diff。
- B0 开始时工作区为 192 个 porcelain 条目，`git status --porcelain=v1 -z` SHA-256 为 `8e707a7ab608c57cb0198b492c53c1d82ba8766256258b91ddf6ac730084b94e`；范围外 unstaged/staged/status 指纹分别为 `9d06f7e51d58df3234c460ae04e053da46b2e04796849d7e4703ab9bc0bad93a`、`5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8`、`7b9e3dd0967d69a2e62d1ec3ec822f283b3c41dffda3b406e83ad24b1e20c1f0`。
- `git diff --check`、`git diff --cached --check` 通过；当前 18 个 untracked 文件逐一执行 `git diff --no-index --check /dev/null <file>` 均无 whitespace diagnostic。
- Standards 复审：`PASS`、0 finding。Spec 复审：`PASS`、0 finding。唯一初始 Standards finding 已修复并重新复审通过。
- B0 退出门禁满足；按用户授权自动进入 B1，不等待额外确认。

### B1：公开 seam 红灯测试（Closed）

前置：D1 已选择，03 号 docs-only 契约调整已完成；B0 Standards/Spec 双轴复审 `PASS`、0 finding 后自动批准开始 B1，不再单独等待用户确认。

实施：

1. 先在 `editor-update.test.ts` 写 T1/T2，必须通过公开 `applySyncUpdate()` 复现；再扩展现有 shared-document fixture 写 T10。
2. 再在 pipeline 和 history 文件写 T3-T7/T9；T6 合并到现有 listener fixture。
3. 新增 `runtime-dirty-selection.test.ts` 写 T8a/T8b：T8a 冻结 mounted caret/selection 与单次 event，T8b 单独锁定 layout identity。
4. 不改生产源码。

预期红灯：

- T1 在 dirty、projection/layout 文本上失败。
- T3 在 local no-op dirty 上失败。
- T5 在 phantom undo 或 metadata 上失败。
- T2 的 dirty 当前可通过，但 layout identity 应失败。
- T4 是防回归 characterization，应保持通过。
- T7 的空 mutation dirty 当前失败，真实 mutation/replace characterization 保持通过。
- T8a 是 mounted selectionAfter 防回归 characterization，B1 必须通过；T8b 的 layout identity 因当前 `handleTransactionEvent()` 无条件使 layout 失效而保持红灯。
- T9 的独立 observer origin/`local:false` characterization 应通过；`doc.on()`/`doc.off()` 同 listener 清理断言应先红，因为临时捕获器尚未实现。
- T10 中 source local no-op 的 false event 断言应先红；replay 的 false event 可通过，但 target projection/layout identity 与 selection 不刷新断言在当前 shared refresh 路径下都应先红。

退出标准：

- 红灯只由 `CORE-01/CORE-05` 当前行为造成，不依赖私有 test hook。
- 纯删除、replay、local no-op 和正常变化四类证据均可稳定复跑。
- 没有修改 B2 生产文件。

验证命令：

```bash
pnpm exec vitest run \
  packages/core/test/collaboration/editor-update.test.ts \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts \
  packages/core/test/editor/runtime-dirty-selection.test.ts
```

### B2：最小共享变化检测实现（Closed）

实施：

1. 新增共享 Yjs transaction helper。
2. 让 `run()`、`applyUpdate()`、`runMutation()` 使用同一 dirty 判定。
3. dirty false 时 pipeline 复用 projection，diagnostic bytes 为 0。
4. history 过滤空 transaction，并清理该 command 的 pending metadata。
5. 不在 B2 修改 state/layout 调度；B2 先证明 detector 和 history 变绿。
6. `applyUpdate()` listener 使用 `try/finally`；T9 以独立 observer 证明捕获的是本次 `local:false` transaction，并以 `doc.on()`/`doc.off()` spy 证明成功和异常路径都清理同一个 listener。

退出标准：

- 每次先复跑与 B1 完全相同的五文件公开/focused 命令，不允许省略 `editor-update.test.ts` 或 `runtime-dirty-selection.test.ts`。
- T1 的 dirty、projection/layout 内容应变绿；T3-T5、T7、T9 应变绿；T8a 必须继续绿。
- T10 的 source no-op/replay `dirty:false` 与 target 每次一次 false transaction event 应变绿。
- B2 允许且只允许以下下游断言保持红灯：T2/T6 的 document layout/render；T8b 的 layout identity；T10 的 target projection/layout identity 与 selection 不刷新。T2 的 dirty、projection identity、event 和 undo 断言必须已经变绿。
- 将允许红灯的测试 ID、断言和实际失败数写入 B2 证据；出现其它红灯不得进入 B3。B2 不得表述为整组测试全绿。
- 纯删除为 true，replay/no-op 为 false，正常插入/删除继续 true。
- update 事务仍保持 Yjs `local:false`；remote 默认不进入 user undo。
- helper 不进入 public exports，不读取 Yjs private store，不编码完整文档。

验证命令：

```bash
pnpm exec vitest run \
  packages/core/test/collaboration/editor-update.test.ts \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts \
  packages/core/test/editor/runtime-dirty-selection.test.ts
pnpm exec vitest run \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts
pnpm --filter @4xian/jword-core typecheck
```

第一条五文件命令必须先执行并记录 T2/T6、T8b、T10 下游断言的精确允许红灯；第二条只验证 B2-owned detector/history 子集全绿，不能用它替代公开 `editor-update.test.ts` seam。

### B3：projection/layout/event 回归（Closed）

实施：

1. 在 `JWordEditorState` 以 dirty 控制 projection、layout、render 和 shared refresh。
2. 在 `facade-runtime.ts` 为 dirty false 的 `selectionAfter` 执行 selection-only refresh。
3. 保留 transaction listener、diagnostic、operation summary 和 plugin event。
4. 复跑与 B1/B2 相同的公开 seam，验证首次纯删除立即可见、replay/no-op 不刷新文档派生状态、shared target 不刷新 projection/layout/selection，同时 mounted selection 继续更新。
5. dirty raw update 和共享 Editor 接收其他实例 dirty 事务时必须从第一页失效到缓存末页，并清除旧 `layoutDirtyRange`；不得让先前后页 no-op 的局部范围污染当前布局。

退出标准：

- T1-T10 全绿，包括 T8a/T8b。
- 纯删除后 `getProjection()`、`getLayout()` 同步为 `ac`。
- replay/local no-op 保持 projection/layout identity，同时仍各发布一次 false event。
- T10 证明 shared Editor 对 source no-op/replay 的每次 false event 都不重建 projection/layout、不发布 `selectionChange`，同时仍发布一次 transaction event。
- no-op `selectionAfter` 更新 mounted caret/selection，但不替换 document layout；selection event 只发布一次。
- 正常本地 command、远端 update 和 mounted render 现有行为不回归。
- 多页文档后页 no-op 后，首页 raw/shared 删除的 projection 与 layout 文本保持一致。

验证命令：

```bash
pnpm exec vitest run \
  packages/core/test/collaboration/editor-update.test.ts \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts \
  packages/core/test/editor/runtime-dirty-selection.test.ts
pnpm --filter @4xian/jword-core test
pnpm --filter @4xian/jword-core typecheck
```

### B4：完整验证、双轴复审和文档关单（Closed）

验证顺序：

```bash
pnpm exec vitest run \
  packages/core/test/collaboration/editor-update.test.ts \
  packages/core/test/collaboration/transaction-update.test.ts \
  packages/core/test/operations/transaction.test.ts \
  packages/core/test/editor/facade-history.test.ts \
  packages/core/test/editor/runtime-dirty-selection.test.ts
pnpm --filter @4xian/jword-core test
pnpm --filter @4xian/jword-core typecheck
pnpm exec vitest run \
  tests/architecture/gate6-import-graph.test.ts \
  tests/architecture/gate6-file-budget.test.ts \
  tests/architecture/phase5-file-split.test.ts
pnpm build
pnpm test:types
pnpm typecheck
pnpm lint
pnpm test
git diff --check
git diff --cached --check
```

另外逐一检查全部 untracked 文件的 whitespace；记录每条命令 exit code、测试文件数、测试数、环境、lockfile hash、fresh build 状态和未执行项。

双轴复审：

- Standards：中文方法注释、文件头、Core 边界、约 1000 行上限、无 public export 漂移、无完整文档编码/deep compare、测试数量最小。
- Spec：T1-T10（含 T8a/T8b）、dirty 规范、projection/layout/event/history/selectionAfter/shared Editor 影响、update `local:false`、listener 成功与异常清理、remote undo 隔离、D1/D2 决策均与本计划一致。

任一复审 finding 必须先修复并重跑受影响 focused gate；不能只靠 lint 或 root test 代替双轴复审。

退出标准：

- 全部批准范围内命令通过，或对范围外既有失败给出可复现、未被本批改变的独立证据；当前 13 号记录的最新根基线为全绿，因此新失败默认阻断关单。
- Standards 与 Spec 均为 `PASS`、0 finding。
- dirty workspace 只增加批准范围文件，既有 staged/unstaged/untracked 边界未被清理或覆盖。
- 03/08/09/10/14 完成证据回写，13 保持不变。
- 只有此时才可把本次重开的 `CORE-01`、B3/B4 和 Phase 2C 恢复为 `Closed`；`CORE-05` 已按 D1 完成，不因本轮布局回归重开。

### B1-B4 历史关单证据（2026-07-20，后续已被推翻）

- B1：五文件 24 个测试中 17 个通过、7 个失败，共 26 条失败断言；全部是计划预期红灯，生产文件保持不变。B0/B1 的 Standards/Spec 复审均为 `PASS`、0 finding。
- B2：同一五文件为 21 个通过、3 个失败，只剩 T2/T6、T8b、T10 的 8 条允许下游断言；detector/history 三文件 18/18、Core typecheck 通过。实现只新增内部 Yjs transaction helper，并统一 `run()`、`applyUpdate()`、`runMutation()`、history 的 D1 判定与清理。
- B3：同一 T1-T10 五文件 24/24；纯删除同步刷新 projection/layout，replay/local no-op 复用 projection/layout，shared Editor 不刷新 selection，`selectionAfter` 只刷新 mounted selection。
- B4：完整 Core 首轮因 composition 回归为 370/371；修复事务捕获边界后为 73 文件/371 测试全绿。最终 focused 5 文件/24 测试、Core typecheck、architecture 3 文件/19 测试、fresh build、types、根 typecheck、根 lint、根测试 236 文件/1244 测试和全部 whitespace 门禁均通过。
- 复审：首轮 Standards 的 canvas mock 中文注释 finding 与 Spec 的 dirty false event projection identity finding 已修复；后续 Spec 的纯删除 opt-in update bytes 覆盖 finding 也已用既有 D1 deletion 用例关闭。最终 Standards/Spec 均为 `PASS`、0 finding。
- 工作区：B1 基线 193 个 porcelain 条目；本批只增加批准的 10 个生产/测试状态项及 5 个文档回写。排除全部 15 个批准文件后，范围外 unstaged/staged/status 指纹保持 `dea4bb57aebfe6c7af30765b9eca833492d9a99a9c07529b55ae5ed22f7a6ecb`、`ae2a01820a23556a49978a82e3f959853938586ddca22abc76a45cdf9e358b9a`、`a9a9868306f95bafc5e4cb456ed989d73b2cf6c7dc1fe9b771e247f35e154585`；13 号仍是既有 `AM`，未被本批修改。
- 当时据此将 `CORE-01`、`CORE-05` 与 Phase 2C 标记为 `Closed`；后续多页布局反例证明 T1/T10 覆盖不足，该关单结论已失效。

### B3-B4 重开修复证据（2026-07-20）

- 重开红灯：公开 shared-document/Editor 以 4 页文档稳定复现后页 no-op 后首页远端删除；`dirty:true` 且 projection 正确，layout 仍保留已删除的首字符。单文件 5 个测试中 4 个通过、1 个失败。
- 根因：命令执行前写入的 `dirtyPageIndex`、`dirtyPageEndIndex` 和 `layoutDirtyRange` 在 no-op 后保留；后续 raw update 或其他共享 Editor 的 dirty 事务没有覆盖这些局部范围，布局错误复用前缀页。
- 最小修复：dirty `applySyncUpdate()` 和共享 Editor 接收其他实例 dirty 事务时，在布局调度前从第一页失效到缓存末页并清除 `layoutDirtyRange`；本地 command 的增量 dirty scope 不变。helper 文件头同步准确说明会读取 delete set 和 transaction state vector。
- Spec 复审发现公开 command name 可与 `applySyncUpdate` 同名；只按名称判别会错误全量失效本地 command。现有公开用例加入后页同名实际写入并锁定首页 page identity，先红后将事件层 raw 判别收紧为名称加空 `operationKinds`，避免与本地 command 冲突。
- 自动门禁：单文件 5/5；focused 5 文件/24 测试；Core 73 文件/371 测试及 typecheck；architecture 3 文件/19 测试；fresh build、types、根 typecheck、lint；根测试 236 文件/1244 测试，全部 exit 0。
- workspace：重开前后均为 203 个 porcelain 项，NUL 分隔状态 SHA-256 保持 `386695e3a307b4a5e4fe226ce6398a406b4d0b622d3862e89a2689d55a4a1d6b`。排除原 15 个 Phase 2C 文件及本轮批准的 README 后，范围外 unstaged/staged/status 指纹保持 `633364584f4e2d1088d92b7767686e062f25b37af42b58b32085f817a332f8ed`、`b7f0aefa111626feea4f24c9162f7c402db17c4713342c22bf57d4c241698240`、`450b438466337397b5eff3255e81e8a35cf6a38d8801953a84d7635d9efc7b3d`；13 号保持既有 `AM`，未修改。tracked、staged 和全部 20 个 untracked whitespace 检查均通过。
- 最终复审：Standards 为 `PASS`、0 finding。Spec 首轮的公开 command name 冲突和 CORE-05 文档矛盾均已通过新增 red/green 与文档修订关闭；最终 Spec 为 `PASS`、0 finding。
- 当前状态：`CORE-01`、B3/B4 与 Phase 2C 重新 `Closed`；`CORE-05` 保持 `Closed`。Phase 2 整体完成，下一边界为 Phase 3。

## 11. dirty workspace 保护规则

B1 开始前重新记录：

- `git status --porcelain=v1` 完整文件集合和哈希。
- 每个批准文件的 staged、unstaged、untracked 初始状态。
- 批准范围外文件的内容哈希和状态边界。

B4 不要求整个 workspace hash 与 B1 前完全相等，因为批准范围内实现必然改变 hash。正确门禁是：

- 范围外文件集合、内容和 staged/unstaged 状态不变。
- 范围内 diff 只包含第 9 节批准文件。
- 不执行暂存、提交或清理命令。
- `git diff --check`、`git diff --cached --check` 和逐 untracked whitespace 检查无 diagnostic。

## 12. 强停止条件

出现以下任一情况，立即停止并请求用户决定，不扩大实现：

1. 需要新增或改变公开 Editor/transaction/history interface。
2. 变化检测必须读取 Yjs private store、编码完整文档或深比较 projection 才能通过。
3. 公开 `applySyncUpdate()` 红灯不能稳定复现，只能依赖生产 test hook。
4. 修复要求改变 update origin、Yjs `transaction.local`、remote undo scope 或协作 admission。
5. 需要修改 persistence/native、License/OEM、DOCX/PDF、Phase 5/6 文件。
6. 范围外 dirty 文件出现并发变化，导致无法区分本批 diff。
7. Standards 或 Spec 复审存在未解决 finding。

## 13. D1 决策记录

用户已明确选择 D1；该决策已通过 B0 docs-only 调整写入 03 号当前生效契约。D2 保留为未选择的对照方案，不构成本阶段 blocker。

### D1：CRDT 可编码变化语义（已选择）

- D1 已是 Phase 2C 当前生效契约；B0 双轴复审通过后自动批准进入 B1。
- dirty 完全按共享 `Y.Transaction` helper 判定。
- 空插入、折叠删除等真实 Y.Doc no-op 为 false。
- 当前 adapter 重复写 `{ bold: true }` 会产生新 struct/delete set，因此仍为 true。
- 优点：实现最小、与 Yjs update writer 一致、覆盖新增/修改/删除/replay，不需要 projection 比较。
- 已完成条件：03 号 CORE-05 已把“重复设置同值为 false”调整为“只要当前 adapter 产生可编码 Yjs 变化即为 true”；该 docs-only 契约调整在 B0 完成。

### D2：projection 语义 no-op

- 除共享 detector 外，还要求所有相关 operation adapter 在写入前比较当前属性并跳过同值写入。
- 重复设置同值才可稳定为 false。
- 这会扩大源码与测试范围，需要重新枚举 run、paragraph、section、link、resource 等 write-elision 规则；不能作为 B2 的隐含附带修改。

D2 未被选择，不纳入源码或测试范围。实现没有新增公开 API、改变协议或进入相邻 Phase；B0-B4 已完成并重新关闭。
