# Phase 2B 恢复与资源 roundtrip 实施基线与证据

> 状态：`Closed`。B1-B3 已完成；历史顺序与 append 屏障修复后的 B2 与 B4 最终 Standards/Spec 双轴复审均为 `PASS`、0 finding，批准范围内 B4 门禁及根 `pnpm test` 全部通过。
>
> 范围：`SEC-04/PERS-01`、`FMT-03`、`PERS-03`。
>
> B0 的调查与决策记录继续保留；后续已批准并按 B1 -> B2 -> B3 -> B4 顺序实施。全程未执行 `git add`、commit、push、PR、publish；本计划现已完成，Phase 2C 作为下一项独立任务推进。

## 1. 调查基线

调查开始前记录：

- HEAD：`a94c6761bfc1b0b57f33074954b7e845edc862e6`。
- 分支：`feature/review_questions`。
- B0 写入前 dirty workspace：152 个 porcelain 条目；这些条目均已存在于工作区，不能归因给本 B0。
- B0 写入 13 号文档后 dirty workspace：153 个 porcelain 条目；新增条目仅为本文件 `?? docs/current-implementation/reviews/current-full-review/13-phase2b-restore-and-resource-roundtrip-plan.md`。
- 状态哈希：对 `git status --porcelain=v1` 的 UTF-8 输出执行 `shasum -a 256`，结果为 `4455efcec8f5e110233ad3b6b5213500b814665e61f3b90c7820ab7bf405e910`。
- 写入本文件后的状态哈希为 `c8c11bdc56f6bd50924b71438fc3115583a79f71e207ddda3235159974f2acef`；该变化只反映新增 13 号文档，不能作为后续实施的全工作区不变门禁。
- B1 开始前必须重新记录“既有 dirty 文件集合”（包含本文件及当时工作区的其他既有修改）。后续只允许批准范围内文件产生 diff；范围外文件集合、内容和 staged/unstaged 状态不得变化。
- 环境补充：Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`；`pnpm-lock.yaml` SHA-256 为 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。

CodeGraph 优先用于 restore、clone 和 Native 结构调用链；`rg` 只用于精确枚举文字、符号和所有调用点。CodeGraph 索引含当前未提交修改，因此源码行和以下结论均用当前磁盘内容校正。没有执行会写入 `.codegraph` 的同步操作。

## 2. 三个 finding 与依赖关系

| Finding | 当前根因 | 直接影响 | 对后续批次的依赖 |
| --- | --- | --- | --- |
| `SEC-04/PERS-01` | 两个正式 persistence adapter 都先改 `targetDoc`，再 append/save；storage 没有 revision、CAS 或 transaction | 持久化失败时 API 返回 `PERSISTENCE_RESTORE_FAILED`，但目标 Y.Doc 已恢复；storage 还可能留下孤立 update 或不完整 restore 元数据 | 必须先批准跨 Y.Doc 与外部 storage 的一致性契约，再实现 B2；B1 的无损 clone 是 B2 的前置 |
| `FMT-03` | 保存侧只在 data URL 或 `metadata.nativeBytesBase64` 可用时写资源；加载侧校验并读取资源 entry，却只返回摘要，不回挂 `document.resources[].source` | 关闭原 blob URL 后重开，正文仍引用已失效 URL；即使 ZIP 中有 bytes，也不能渲染 | 需要先批准资源重建形态、blob URL 无 bytes 的保存策略和 Worker/浏览器所有权，再实现 B3 |
| `PERS-03` | 三套 clone/replace 实现的 Y.Text 分支都使用 `toString()` | 通用 Y.Text `toDelta()` attributes 丢失；当前 JWord `run.properties` Y.Map 不丢失 | B1 先修复两个正式 adapter；示例实现明确留作后续独立任务；不能把该 finding 描述成当前 canonical run properties 丢失 |

技术依赖与推荐实施顺序分开记录：

- 技术依赖：PERS-03 的无损 clone 是 persistence restore helper 的前置；FMT-03 是 Native 资源读写问题，与 persistence restore 没有代码依赖。两者只在最终集成验证时汇合。
- 推荐顺序：B1（PERS-03）和 B3（FMT-03）可以独立实施和复核；B2（PERS-01）依赖 B1 的 clone 基础；B4 在 B1-B3 证据齐全后执行。

推荐实施顺序（不是 B0 的授权）：

```text
PERS-03 无损 clone ──> SEC-04/PERS-01 的隔离 preview 与 target 应用

FMT-03 的 loaded document 资源重建与 roundtrip（可与 B1/B2 并行）
        \
         └──────────────> Phase 2B 集成验证和文档关闭
```

这是实施顺序依赖，不是允许在 B0 直接修改相邻模块的授权。

## 3. Restore 当前调用链

### 3.1 Memory adapter

入口是 `packages/persistence/src/index.ts:499` 的 `MemoryPersistenceAdapter.restoreVersion()`：

```text
createPreview(input)
  -> loadVersion(input)
  -> ensureDocumentState(documentId)
  -> rebuildVersionUpdate(state, version)
  -> new Y.Doc() + Y.applyUpdate(previewDoc, update)
  -> replaceDocumentContent(targetDoc, previewDoc)
  -> appendRestoreVersion(input, targetDoc, preview.version)
       -> Y.encodeStateAsUpdate(targetDoc)
       -> state.updates.push(update)
       -> state.versions.push(version)
```

`createPreview()` 本身只在隔离 Y.Doc 上应用 update，正常情况下不改变 `targetDoc`。问题从 `replaceDocumentContent()` 开始：`targetDoc.transact()` 在 `appendRestoreVersion()` 之前执行。`appendRestoreVersion()` 是同步数组追加，没有事务、CAS 或回滚。

### 3.2 Storage adapter

入口是 `packages/persistence/src/storage-history-adapter.ts:286` 的 `StoragePersistenceAdapter.restoreVersion()`：

```text
createPreview(input)
  -> loadVersion(input)
  -> storage.loadDocument(documentId)
  -> decodeStorageDocument()
  -> rebuildVersionUpdate(state, version)
  -> new Y.Doc() + Y.applyUpdate(previewDoc, update)
  -> replaceDocumentContent(targetDoc, previewDoc)
  -> appendUpdate({ update: Y.encodeStateAsUpdate(targetDoc) })
       -> loadState()
       -> state.updates.push(update)
       -> state.versions.push(version)
       -> saveState(state)                 [第一次 save]
  -> loadState()                           [重新读取已追加 state]
  -> replaceVersion(state, { restoreSourceVersionId })
  -> saveState(state)                      [第二次 save]
```

公开 `JWordHistoryStorage` 只有 `loadDocument()` 和 `saveDocument()`（`storage-history-adapter.ts:38-51`）。它不返回 revision/etag，也没有 append、CAS、transaction 或 pending operation 能力。当前 `appendUpdate()` 的 version ID 和 sequence 依赖 `updates.length + 1`，不能证明多实例并发语义。

### 3.3 失败后状态矩阵

以下状态来自公开 adapter 入口加故障 storage/历史状态注入；不是生产 test hook。`target` 表示公开调用方传入的 Y.Doc，`history` 表示 memory 服务状态，`storage` 表示 storage backend 已持久化状态。

| Seam/注入点 | API 结果 | targetDoc | history/storage | 结论 |
| --- | --- | --- | --- | --- |
| memory `updates.push` 失败 | `PERSISTENCE_RESTORE_FAILED` | 已从 `v2` 变为 `v1` | 仍为 2 updates / 2 versions | 文档已改变但没有 restore 记录 |
| memory `versions.push` 失败 | `PERSISTENCE_RESTORE_FAILED` | 已变为 `v1` | 3 updates / 2 versions，存在孤立 restore update | history 自身也不一致 |
| storage 第一次 `saveDocument` 失败 | `PERSISTENCE_RESTORE_FAILED` | 已变为 `v1` | 仍为 2 updates / 2 versions | append 的内存副本未落盘，但目标已改变 |
| storage 第二次 `saveDocument` 失败 | `PERSISTENCE_RESTORE_FAILED` | 已变为 `v1` | 已为 3 updates / 3 versions，但最后版本缺 `restoreSourceVersionId` | history 成功一半，公开结果却是失败 |
| storage 所谓 CAS 冲突 | 当前没有 CAS 分支，无法产生真实 CAS diagnostic | 当前顺序仍会先变更 target | backend 只能把冲突表现为某一次 `saveDocument` 抛错；上面两种 save 失败就是当前可注入近似 | 不能声称已验证 CAS 语义；必须扩展 contract 后再设计回归 |

因此当前失败 catch 只有一个 `PERSISTENCE_RESTORE_FAILED`，调用方无法区分“没有改变”“target 已变”“孤立 update”或“restore 元数据不完整”。

## 4. 重复 clone 实现及调用方

### 4.1 正式 persistence package

`packages/persistence/src/index.ts`：

- `replaceDocumentContent()`：仅由该文件的 memory `restoreVersion()` 调用。
- `replaceSharedType()`：仅由 `replaceDocumentContent()` 调用。
- `createAndFillSharedType()`：由 `replaceDocumentContent()` 处理 target 缺失的顶层类型时调用。
- `cloneSharedValue()`：由 `replaceSharedType()` 的 Y.Map 分支和 `cloneArrayValues()` 调用；递归处理嵌套 Y.Text/Y.Array/Y.Map。

`packages/persistence/src/storage-history-adapter.ts`：

- `replaceDocumentContent()`：仅由 storage `restoreVersion()` 调用。
- `replaceSharedType()`：仅由该文件的 `replaceDocumentContent()` 调用。
- `createAndFillSharedType()`：由该文件的 `replaceDocumentContent()` 调用。
- `cloneSharedValue()`：由 Y.Array/Y.Map 分支递归调用。

两份实现逻辑相同但类型判断略有差异：memory 版本还保留 structural duck typing，storage 版本主要使用 `instanceof Y.Text/Y.Array/Y.Map`。这造成修复漂移，也使 `packages/persistence/src/index.ts` 已接近文件预算（当前 987 行）。B1 必须先抽取 package-internal helper 或拆文件，不能把它继续堆到 1000 行以上。

### 4.2 Collab 示例的独立实现

`examples/collab/src/runtime/hocuspocus-history.ts` 还有一套 provider 文档专用实现：

- `encodeCoreDocumentStateAsUpdate()` 调用 `createAndFillSharedType()`，用于只编码 core 容器，避免把 provider history 容器递归写入版本 update。
- `restoreCoreDocumentFromUpdate()` 创建 preview Y.Doc，再调用 `replaceSharedType()`/`createAndFillSharedType()` 恢复 core 容器。
- 同文件的 `cloneArrayValues()` 和 `cloneSharedValue()` 处理嵌套类型。
- 示例的 `restoreVersion()` 也先 `restoreCoreDocumentFromUpdate(targetDoc)`，再 `appendUpdate()`，因此它不是本阶段“两个正式 adapter”之外的第三种安全实现。按照第 9 节已固定范围，示例不纳入 B1/B2，保留为后续独立任务并继续登记该风险。

所有调用均已用 CodeGraph 追踪，不存在仅靠文字搜索漏掉的正式入口。

## 5. Y.Text attributes 边界与已验证复现

当前三个 `replaceSharedType/createAndFillSharedType/cloneSharedValue` 的 Y.Text 分支都执行：

```typescript
targetText.delete(0, targetText.length)
targetText.insert(0, previewText.toString())
```

`toString()` 只保留字符，不保留 `toDelta()` 的 attributes。通过 memory 和 storage 两个公开 adapter 入口的最小复现得到相同结果：

```json
{
  "previewDelta": [{"insert":"v1","attributes":{"bold":true,"color":"#123456"}}],
  "restoredDelta": [{"insert":"v1"}],
  "previewRunBold": true,
  "restoredRunBold": true
}
```

这区分了两个不同概念：

- 通用 Y.Text attributes：直接附着在 Y.Text insert 上，本次恢复会丢失。
- JWord canonical `run.properties`：存储在独立的 Y.Map，本次恢复仍保留 `bold=true`。

因此 PERS-03 是真实的通用 persistence 数据损失，但不能写成“当前 JWord 加粗格式在恢复时已丢失”。B1 的最小绿灯必须同时断言 `toDelta()` 完整一致和 `run.properties` 不回归。

## 6. Native packed resource 全链路

### 6.1 保存侧

`packages/native/src/package-codec.ts:55` 的 `saveJWordDocument()` 顺序为：

1. `createDocumentSnapshot()` 将输入 document 序列化为 `document.json` 并先做严格 schema/预算校验。
2. `collectPackedResources()` 遍历 `document.resources`。
3. `dataUrl` 通过 `decodeDataUrl()` 转成 `Uint8Array`。
4. `blobUrl` 不读取 URL 本身；只有 `resource.metadata.nativeBytesBase64` 是非空字符串时，才通过 `base64ToBytes()` 得到 bytes。
5. `createPackedResourcePath(id)` 生成 `resources/<encoded-id>`，并校验 entry 名称。
6. `createManifest()` 将 resource `id/path/mime/packed` 写入 manifest，同时把 resource path 加入 `packageEntries`。
7. `resources/<path>` 与 `manifest.json`、`document.json`、`metadata.json` 写入 ZIP。
8. `createChecksums()` 对 `document.json`、`metadata.json` 和 packed resource path 计算 SHA-256、byteLength、mime，写入 `checksums.json`。
9. ZIP bytes 生成后再次执行预算、preflight 和最终 progress/cancel 检查。

没有 fallback bytes 的 `blobUrl` 只产生 `JWORD_NATIVE_RESOURCE_UNPACKED` warning，仍报告保存成功，且 `document.json` 原样保留短生命周期 `blob:...` URL。

### 6.2 加载侧

`packages/native/src/package-readers.ts:63` 的 `readPackageParts()`：

1. `openBoundedNativeZip()` 规范化 input，执行 ZIP preflight 和有界 reader。
2. 读取 manifest、checksums、metadata、document。
3. `inspectChecksums()` 逐个 `readEntry()`，检查缺失、SHA-256 和 byteLength；`BoundedNativeZipReader` 会缓存 bytes。
4. `inspectJWordPackageIntegrity()` 验证 manifest entry、resource checksum MIME 和 document 中的 resource ID 是否在 manifest 声明。
5. `summarizeResources()` 只产生 `{ id, path?, mime, byteLength?, packed }`。
6. `readPackageParts()` 在 `finally` 中关闭 ZIP reader，并返回 document、metadata、manifest、checksums、migrationReport、diagnostics 和 resource summaries。

`loadJWordDocument()`（`packages/native/src/index.ts:81`）将 `parts.document` 和 `parts.resources` 原样返回。已经读取并校验的 packed bytes 在 checksum reader 关闭后没有任何返回去向，也没有写回 `document.resources[].source`。

### 6.3 渲染、URL 所有者与跨线程边界

- core layout（`packages/core/src/layout/internal.ts:251`）把 `resource.source.url` 写进 `resourceSourceUrl`；canvas renderer（`packages/core/src/canvas/renderer.ts:506-578`）只在 success 且有 URL 时交给 `CanvasImageResourceResolver`。
- `createMountedCanvasImageResourceResolver()` 只创建和缓存 `<img>`、在 `dispose()` 时清理解码缓存；它不创建也不 revoke object URL。
- `mount-facade-runtime.ts:278` 创建 resolver，`destroy()` 调用 resolver `dispose()`；原始 blob URL 的创建和 revoke 仍由宿主负责。
- Native 当前没有 `JWordNativeLoadedResource`、`createObjectURL` 或 `revokeObjectURL` 资源生命周期实现。`worker-capability.ts` 的 object URL 检查只用于 Worker bootstrap 能力，不是资源 owner。
- Worker `readJWordNativeWorkerEventTransferables()` 只对 `save-result.bytes` 返回 transferable；`load-result`、`validate-result` 都没有 resource bytes transfer。Worker 请求的 `input` 可是 `ArrayBuffer/Uint8Array/Blob/File`，但返回的 load document 仍只有 URL 字符串和摘要。
- 当前 Node `v24.14.0` 有 `Blob`、`URL.createObjectURL` 和 `URL.revokeObjectURL`，但全局 `Worker` 不存在；Node object URL 不能替代 DOM/canvas 渲染能力。Native load 不能假设浏览器 DOM，也不能把 URL 生命周期藏在 Worker 中。

### 6.4 两条公开 Native 红灯

#### packed blob URL 在关闭后重开仍死链

通过构建后的公开 `saveJWordDocument()`/`loadJWordDocument()`：先创建 Node blob URL，使用 `nativeBytesBase64` 保存，撤销原 URL，再 load。输出为：

```json
{"packed":true,"loadedSourceKind":"blobUrl","sourcePreserved":true,"loadedSummaryHasBytes":false,"reopenedReadable":false}
```

以“撤销后必须仍可读取”作为断言时命令 exit 1。该红灯命中了用户可见的 save-close-reopen seam，而不是内部 helper。

#### 无 fallback bytes 的 blob URL 仍报告成功

同一公开 save seam 使用没有 `nativeBytesBase64` 的成功 blob resource，输出为：

```json
{"packed":false,"warningCodes":["JWORD_NATIVE_RESOURCE_UNPACKED"],"savedSuccessfully":true}
```

以“不可恢复的 blob URL 不得成功保存”为断言时命令 exit 1。是否改为稳定阻断、是否允许 Native `fetch(blob:)`，必须由用户批准。

## 7. 原子恢复方案比较

### 7.1 方案 A：先持久化，再修改 targetDoc

流程是 preview -> 生成恢复 update -> storage append/save/CAS -> targetDoc 单事务应用。

- 优点：可以避免“target 已改但第一次持久化失败”。
- 缺点：storage commit 成功后进程崩溃、target 应用抛错或 observer 失败，会出现“history 成功但 target 尚未恢复”。
- 对 memory adapter，数组 commit 可暂时做成单次状态替换，但仍不能把外部 storage 和任意 Y.Doc transaction 合并成一个原子域。
- 结论：比当前顺序安全，但不能证明用户要求的双向严格原子性。

### 7.2 方案 B：隔离准备 + storage CAS/transaction + target 单事务

流程是读取 expected revision -> 在 preview/临时 state 中准备完整恢复 update 和版本元数据 -> storage 原子 CAS -> target 单事务应用相同 prepared state。

- 优点：隔离准备不触碰 target；CAS 能阻止并发 writer 静默覆盖；相同 prepared update 可重试和审计。
- 缺点：CAS/transaction commit 与 targetDoc 仍是两个原子域。没有 pending operation、提交标记和恢复协调器时，仍存在“storage 已提交、target 未应用”的窗口。
- 历史结论：这是原推荐基础方向。原 storage contract 没有可恢复 pending/recovery，不能关闭 target apply 窗口；后续 B2 复审已证明有限 scoped contract 不足，并按 7.4/7.6 的新批准边界增加 restore 专用协议。

### 7.3 方案 C：先修改再失败回滚

流程是保存 target 前状态 -> 修改 target -> append/save/CAS -> 失败时把 target 恢复到旧内容。

- Yjs update 是 CRDT 增量；把旧 update 再 apply 不能删除已经集成的新内容。
- 当前 replace helper 自身会丢 Y.Text attributes，回滚可能再次损失数据。
- target observer/provider 可能已经看到中间 update，补偿写不能撤回外部副作用。
- 结论：不能作为严格安全方案，拒绝作为 B2 主路径。

### 7.4 已批准的 Phase 2B restore 专用恢复语义

原方案 B 最小形态只覆盖单次进程内返回语义。B2 复审通过 Memory/Storage 两个公开 seam 复现：`beforeTransaction` observer 在 target 真正应用前抛错时，普通 history/storage 已先增加 restore version。该强停止条件触发后，用户选择方案 A，批准把 7.6 中**仅针对 `restoreVersion()`** 的 pending/finalize/recovery 前移到 Phase 2B：

1. 在隔离 preview 与临时 history state 中生成完整 restore update、restore source 元数据和内部 canonical logical-content hash，不能先改 target。
2. memory adapter 以 Map 状态替换、storage adapter 以 expected revision CAS 创建 `phase: 'prepared'` 的 pending。pending update/version 不进入普通 arrays，`listVersions()` 不可见。
3. target 只在一次 Y.Doc transaction 中应用同一 prepared 内容，并在该 transaction 回调内写 package-private operation marker；返回前同时校验 marker 与 canonical logical-content hash。
4. target 应用后先持久化 `phase: 'target-applied'`。该步或 finalize 暂时失败时返回稳定的 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`，不得伪装成普通 restore failure；下一次相同 source version restore 必须先恢复 pending。
5. finalize 才把 pending update/version 追加到普通历史并清除 pending；只有 finalize 成功后 result 才包含成功 version。
6. target 应用前失败必须取消 pending，并保持 target、普通 history/storage 无已完成 restore；若 observer 已改变 target，或取消失败，则保留 pending 并返回 recovery-required，等待显式重试。

#### 7.4.1 Canonical logical-content hash 定义

hash 对象是 Y.Doc 的逻辑内容快照，不是 CRDT 历史：

1. 根节点编码为按名称升序排列的顶层 shared type 列表，并保留每个顶层值的 Y 类型标签。
2. Y.Text 编码为 `toDelta()` 数组；保留 insert 顺序、insert 的 string/embed 类型和值，并递归按 key 排序 attributes 对象。
3. Y.Array 保留元素顺序并递归编码；Y.Map 按 key 升序排列后递归编码值。
4. `null`、boolean、string、有限 number、undefined sentinel、普通对象和二进制分别使用不同类型标签；普通对象 key 排序，二进制使用稳定 base64。遇到不支持的值必须失败，不能退回 `toString()`。
5. 对上述快照执行稳定 JSON 序列化，以 UTF-8 bytes 计算 SHA-256。不同 client ID、编辑顺序、clock、state vector 或 update 切分但逻辑内容相同的 Y.Doc 必须得到相同 hash；Y.Text delta attributes 或嵌套值不同必须得到不同 hash。
6. `preparedHash` 来自 preview；`committedHash` 来自用已提交 history/storage state 在隔离 Y.Doc 中重建的快照；`targetHash` 来自 target transaction 后快照。正常返回必须满足三者相等。

最少红灯必须包含“可见文本相同、编辑历史不同、原始 update hash 不同”的两个 Y.Doc，并证明 canonical logical-content hash 相同；另加一条仅 attributes 不同则 hash 不同。该 helper 保持 package-internal，不新增公开 API。

该协议覆盖 `restoreVersion()` 的 pending 创建、target 应用、phase 推进、finalize 与后续恢复；Storage pending 与 phase 通过宿主 storage contract 持久化，Memory pending 只具有该 adapter 明确承诺的内存生命周期。它不扩展为通用 history append 协议，也不提供外部 operation store 或多实例协调器。

**2B 候选关闭范围：** 关闭两个公开 `restoreVersion()` seam 已复现的失败窗口与 restore 专用恢复协议。通用 append 的 transaction/CAS/idempotency、multi-instance 竞争、外部 operation store 和完整 `PERS-02` 仍留在 Phase 6B；不能把本次前移描述为通用 history 强一致。

### 7.5 Phase 2B 状态门禁

| 用户批准与已验证范围 | PERS-01 / SEC-04 状态 | Phase 2B 状态 | 后续归属 |
| --- | --- | --- | --- |
| 未批准最小 CAS，只完成隔离准备和本地失败语义 | PERS-01 为 `Partial`；SEC-04 保持 `Open`，不能宣称并发原子性关闭 | `Partial`；B1 可独立关闭，Phase 2B 不得写 `Closed` | stale writer、crash 和 multi-instance 风险转交 PERS-02/6B |
| 批准最小 CAS，并完成本地调用语义及 canonical logical-content hash 校验（历史未选） | PERS-01 的“失败不改变 target/history”与 SEC-04 的单次 stale-writer 子集可关闭；crash/multi-instance 仍 `Open` | 先保持 `Partial`；只有 08、09、10 明确把剩余风险转交 PERS-02/6B，且 B1、B3 与本子集证据全绿后，才可按 2B 的 scoped contract 写 `Closed`，不得写完整 SEC-04 `Closed` | crash consistency、pending/recovery、multi-instance 转交 PERS-02/6B |
| 将仅限 `restoreVersion()` 的 durable pending/finalize/recovery 前移（已选择） | 同步更新 04、08、09、10、13、索引与 Persistence README，并完成稳定诊断和公开 seam 故障矩阵后，才可关闭 restore 专用子项 | 实现完成后重新执行 B2 双轴复审；0 finding 后才进入 B4 | 通用 append CAS/幂等、multi-instance、外部 operation store 和完整 PERS-02 仍在 6B |

状态值必须逐项写入 B4 证据；“B1-B4 全绿”不等于整项 SEC-04 或 Phase 2B 自动 `Closed`。

**必须由用户批准的决策：**

- 2B 采用上述有限本地语义并保留 SEC-04 的 6B 并发子项，还是批准最小 revision/CAS contract；
- 若只批准最小 CAS，`JWordHistoryStorage` 的 revision 表达、冲突返回和 single-writer 兼容规则；
- 是否把跨 Y.Doc 与 storage 的 durable pending/finalize 强一致协议整体前移；本轮已批准的答案仅限 `restoreVersion()`，不是通用 history 协议；
- 是否需要新的 pending/finalize 诊断和超时语义；本轮已批准稳定 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`，不能复用 `PERSISTENCE_RESTORE_FAILED` 掩盖“target 已应用、storage 未 finalize”。

### 7.6 强一致方案（Phase 6B 或经批准前移）

若用户要求 SEC-04 达到“方法成功返回时，target/history/storage 必须同一恢复状态；失败返回时三者不能有一个已被宣称成功”，则需要 **方案 B 加 durable pending/finalize 协议**。该协议原归属 6B；本轮已批准把下列流程仅针对 `restoreVersion()` 前移到 2B：

1. storage 以 expected revision CAS 写入不可见的 `pending restore`，其中包含 operation ID、`prepared` phase、源版本、target-before/prepared canonical logical-content hash、restore update/checksum 和版本元数据；两类 hash 不得混用。
2. 在单次、可验证不抛错的 target Y.Doc transaction 中应用 prepared state，并写入 operation marker。
3. 以 operation ID 和 revision CAS 持久化 `target-applied` phase，再将 pending finalize 为普通 history，并在同次状态写入中保存最近完成确认；只有已确认 finalize 才返回成功版本。
4. target 应用前失败时取消 pending；应用后 finalize 暂时失败时不得把已应用状态报告为普通 restore failure，而应由同一 operation ID 的有限重试/恢复协调器完成 finalize。
5. 重启或下一次 restore 先处理 pending：marker 与 prepared hash 一致则 finalize，不一致则 abort/repair；未 finalized 的 pending 不进入普通版本列表。

这能把可见的 history success 限定在 finalize 后，也避免当前“失败但 target 已改”的返回语义；但它不是现有接口的零改动修复。

**边界调整：** package-internal operation marker、pending phase 和 recovery coordinator 已仅针对 `restoreVersion()` 前移。外部 operation store、通用 append 的跨实例 revision/CAS 与幂等、双实例竞争和完整生产恢复协议仍属于多实例/分布式持久化范围（见 08 的 PERS-02、09 的 6B 条目），不得由本次 2B 实现顺带关闭。

## 8. 资源 roundtrip 的决策点

### 8.1 已确认的格式与预算冲突

- `ResourceSource` 当前只有 `dataUrl`、`blobUrl`、`externalUrl`，无法表达 05 号文档要求的逻辑 packed-resource 引用。
- 单个 packed resource 上限为 32 MiB，而 `document.json` 上限为 16 MiB。把 packed bytes 重建为 base64 data URL 会额外放大约三分之一并增加 JSON 开销，因此不能证明“load 后再次 save”在预算内闭包。
- FMT-03 必须同时决定“package 内如何表示资源”和“load result 如何承载可消费资源”；格式表示与运行时承载不是同一层的互斥三选一。

### 8.2 格式表示层（必须选一项）

**F1：降低预算并内联 `dataUrl`。** 继续使用现有 `dataUrl` source，先根据文档其余字段、MIME/header、base64 和所有资源合计开销计算新的单资源/总资源上限，并用接近边界的 save-load-save seam 证明 `document.json` 永不超限。选择 F1 必须同时批准修订 05 号文档中“保存侧使用逻辑 packed-resource 引用”的契约；不能静默偏离权威格式说明。

**F2：使用逻辑 packed-resource 引用。** 在 `document.json` 中以稳定逻辑引用关联 manifest resource ID/path，保存侧不内联 bytes，load 时再解析为运行时 source。该方案需要批准新的 source 表达、格式版本/兼容迁移和旧 reader 行为；B0 不预设具体 source kind，也不修改格式版本。

### 8.3 运行时承载层（必须选一项）

**C1：重建可消费的 `dataUrl`。** checksum 验证后的 packed bytes 在 load 内部重建为 `dataUrl` source。浏览器、Worker structured clone 和纯 Node 都消费字符串，Native 不创建 object URL，也没有隐藏 revoke owner。若格式层选择 F2，保存时仍必须把该运行时 source 转回逻辑 packed-resource 引用，不能把 base64 重新写入 `document.json`。

**C2：返回 bytes，由浏览器宿主创建/复用/revoke object URL。** 扩展 `LoadJWordDocumentResult`/Worker `load-result` 的资源 DTO，宿主按 resource ID 管理 URL，并在 document/editor dispose 时 revoke。该方案避免 base64 放大，但需要新增公开类型、Worker transfer、浏览器/Node 双环境适配和生命周期 API；未批准前不能只改 load 内部。

Native/Worker 内部创建 object URL 不作为运行时承载方案：URL owner、跨 Worker 可见性和 revoke 时机没有公开契约，纯 Node 也不能提供 canvas 渲染。

### 8.4 两层组合与强停止

必须在 B3 前同时批准一个格式表示（F1/F2）和一个运行时承载（C1/C2），并验证组合闭包：

| 组合 | 必须证明 |
| --- | --- |
| F1 + C1 | 预算降低后 save-load-save 闭包，加载 dataUrl 可渲染 |
| F1 + C2 | 明确为何现有内联 source 仍需要 bytes DTO，并证明 package 与 runtime source 不重复或不冲突 |
| F2 + C1 | package 始终保存逻辑引用，load 可渲染 dataUrl，重保存不会把 base64 写回 `document.json` |
| F2 + C2 | package 保存逻辑引用，bytes transfer 和宿主 URL owner/revoke 在浏览器、Worker、Node 边界均闭合 |

F2 单独不能解决运行时 bytes 所有权，C2 单独不能解决 package 格式引用；二者都不能单独关闭 FMT-03。

### 8.5 blobUrl 保存策略决策

- 已有 `nativeBytesBase64`：可以继续作为内部 fallback，但 load 必须把 packed bytes 重新挂回 document。
- 没有 fallback bytes：必须二选一：保存时用受 AbortSignal/预算约束的宿主能力读取 `blob:` bytes，或稳定拒绝保存；不能继续 warning 后报告成功。
- 不新增 `packedResource` source kind、不新增格式版本、不把 platform-specific object URL 写入 package，除非用户单独批准。

B3 开始前必须批准 F1/F2 与 C1/C2 的组合，并同时批准 blob URL 无 fallback bytes 的保存策略。任一格式、预算、公开类型、Worker transfer 或 URL owner 尚未闭合时强停止。

## 9. B1-B4 实施顺序（待批准）

### B1：Yjs 无损 clone 基础（PERS-03）

**前置**：只需批准 B1 范围，不需要先批准新的 storage 能力。

**范围决定（本计划固定）：** B1 只关闭两个正式 persistence adapter 的 clone/restore 实现；`examples/collab/src/runtime/hocuspocus-history.ts` 及其 history test 不纳入本批次，作为后续独立任务。若要把示例纳入 B1，必须在 B1 开始前单独批准扩展范围，不得在实施中途再决定。

**文件级范围：**

- 新增 package-internal `packages/persistence/src/yjs-document-content.ts`，集中 `replaceSharedType`、`createAndFillSharedType`、`cloneSharedValue`、Y.Text delta 复制和类型判定；不得作为新的 package export。
- `packages/persistence/src/index.ts`、`storage-history-adapter.ts`：改为调用内部 helper，并保持文件预算。
- `packages/persistence/test/memory-adapter.test.ts`、`storage-history-adapter.test.ts`：通过各自公开 adapter seam 加一条 Y.Text attributes + canonical `run.properties` 回归。

**红灯/绿灯：** 两个正式 adapter 的 `preview.toDelta()` 保持 `{bold,color}`，restore 后相同；`run.properties.bold` 仍为 `true`；原有 nested core restore 继续通过。

### B2：恢复原子性（SEC-04/PERS-01）

**前置**：原最小 CAS 语义已在复审中被否决；用户已选择方案 A，批准把第 7.6 节中仅限 `restoreVersion()` 的强一致能力前移，并同步必要 Storage contract、内部状态、稳定诊断和 04、08、09、10、13、索引、Persistence README。方案 C 继续禁止。

**文件级范围：**

- `packages/persistence/src/index.ts`、`storage-history-adapter.ts`：两个 adapter 只负责各自 pending state 写入/CAS，统一 target apply、phase、取消、finalize 和 recovery 编排下沉到 package-internal `restore-coordinator.ts`。
- `restore-operation.ts` 统一 update/version metadata 与 `prepared | target-applied` pending；`storage-history-document.ts` 负责编解码，`yjs-document-content.ts`/`yjs-logical-content.ts` 在同一 target transaction 内写 marker 并校验 canonical hash。所有 helper 保持 package-internal。
- `packages/persistence/src/diagnostics.ts`、registry/generated artifacts 和对应文档增加稳定 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`；公开 result 不增加 operation ID 或内部 hash。
- `packages/persistence/test/memory-adapter.test.ts`、`storage-history-adapter.test.ts`：只通过两个公开 adapter、共享 Memory history service 或公开 Storage fake 注入 pending 创建/取消/finalize、CAS 冲突、恢复重试及 observer 前后抛错，不新增生产 test hook。

**红灯/绿灯：** 两个 seam 的 `beforeTransaction` 红灯必须先证明旧实现会留下第三个 restore version，再由 pending 取消转绿。pending 不进入普通版本列表；target 已应用但 phase/finalize 失败返回 recovery-required，重建 adapter/target 后相同 source version 重试只产生一个 committed restore。operation ID 与 canonical hash 只作为内部证据，不扩展当前公开 result。

### B3：Native packed resource roundtrip（FMT-03）

**前置**：用户批准一个格式表示 F1/F2 与一个运行时承载 C1/C2 的组合、无 fallback blobUrl 保存策略、内存预算和 Worker contract。F1 必须先证明 save-load-save 预算闭包并同步修订 05；F2 必须批准格式版本/迁移；C2 必须同时批准公开类型/transfer/disposer。不能只改单层内部。

**共同文件级范围：**

- `packages/native/src/package-codec.ts`：必要时异步读取可解析 blob bytes，或对不可解析 blob 稳定阻断；保持现有 manifest/checksum 关联。
- `packages/native/src/package-readers.ts`、`package-validation.ts`：在 checksum 验证后按 resource path 保留 bytes，并按批准方案重建 source、逻辑引用或 bytes DTO。
- `packages/native/test/public-api.test.ts`、必要的 `worker.test.ts`：公开 save/load 和 Worker load-result roundtrip。

**方案额外范围：** F1 需更新预算常量及 05 号格式说明；F2 需更新 `packages/core/src/resources/types.ts`、Native schema/migration 和格式文档；C2 需更新 `packages/native/src/types.ts`、`messages.ts`、`worker.ts`、浏览器宿主/资源 resolver 的 owner/dispose 接线及公开类型测试。C1 不新增公开资源 DTO。只有组合获批后才能触碰对应文件，不得先行添加 testing export。

**红灯/绿灯：** 按批准的 F/C 组合验证 packed data URL 与带 fallback 的 blob URL 保存后撤销原 URL、关闭并重开，资源 bytes/source 与原内容相同并可渲染；F1 的接近预算边界 save-load-save 必须稳定成功或稳定拒绝，F2 必须证明逻辑引用不会被 base64 回写；无 bytes blob URL 不得报告成功；manifest/checksum mismatch 仍稳定拒绝；C2 的 Worker 不发送 stale load-result 或部分 document；纯 Node load 不依赖 DOM。

### B4：集成关单与证据

**前置**：B1-B3 focused 与故障注入矩阵全绿，Standards/Spec 双轴复核无 finding，并按 7.5 状态表确定每个 finding 和 Phase 2B 的实际状态。未批准最小 CAS 时 Phase 2B 只能为 `Partial`；批准最小 CAS 后也必须先完成 08、09、10 的剩余风险转交，才能按 scoped contract 写 `Closed`；不能因为 B1-B4 命令全绿而写完整 SEC-04 `Closed`。

**文件级范围：**

- 只在实施完成后按实际 diff 更新 `04-collaboration-and-persistence.md`、`05-formats-docx-pdf-native.md`、`08-issues-register.md`、`09-remediation-roadmap.md`、`10-verification-plan.md` 和 current-full-review `README.md`。
- Phase 2B 的 B1-B4 结果默认追加到 13 号文档；若内容过长，只能在用户批准后新增独立 Phase 2B verification evidence 文档。
- `12-phase2a-verification-evidence.md` 只保留 Phase 2A 证据，Phase 2B 不修改或覆盖它。
- 不进入 Phase 2C，不修改 License/OEM，不处理 DOCX/PDF 其它问题。

## 10. 最少公开 seam 与故障注入矩阵

| 批次 | 最少红灯 | 最少绿灯 | 故障注入/边界 |
| --- | --- | --- | --- |
| B1 | memory + storage `restoreVersion()` 的 Y.Text attributes 丢失 | 两 seam 的 `toDelta()` 和 `run.properties` 均保持 | nested Y.Text/Y.Array/Y.Map，缺失顶层 shared type |
| B2 | memory/storage `beforeTransaction` 抛错留下已提交 restore version；finalize 暂时失败 | pending 不进入普通列表；应用前失败取消 pending；应用后失败返回 recovery-required；重建 adapter/target 后恢复且只有一个 committed restore | pending 创建、取消、phase、finalize、CAS 抛错/冲突、恢复重试、observer 前后抛错与 observer 修改 target 后抛错；不含多实例竞争 |
| B3 | save/load blob URL 关闭重开返回 dead URL；无 bytes blob warning-success | 按 F1/F2 + C1/C2 组合证明格式引用和运行时 source 同时闭合，checksum 错误仍阻断 | data URL、逻辑引用、bytes DTO、blob fallback、blob 无 bytes、缺失 entry、hash mismatch、AbortSignal、Worker cancel/stale result、Node 无 DOM |
| B4 | 任一批准范围内 package/architecture/type/lint 或双轴复核失败 | 除明确接受的未跟踪文件检查 exit 1 与既有 Core 空入口基线外，批准范围内命令 exit 0；证据含数量、版本、状态和未执行项 | 不运行最低浏览器认证，不把当前浏览器结果冒充最低版本 |

故障注入只能通过现有公开 adapter/storage/Worker contract 或测试中已有的 fake storage 完成；不新增生产 test hook、内部状态导出或公开测试入口。

## 11. Standards / Spec 双轴子代理复核点

B1-B4 每批完成后分别由 Standards 与 Spec 两个独立子代理只读复核；主进程验收 finding 和命令证据。任一轴有 finding 时停止，不进入下一批或 `Closed`。

### Standards

- 每个新增或修改的方法定义上方有规范中文注释，包括接口函数属性、`onProgress`/`onWarning` 箭头函数、snapshot/计数函数、`addEventListener` 包装函数和测试回调。
- 任何新 helper 都保持 package-internal；不把 persistence clone helper、resource bytes 或 test seam 加入公开 exports。
- `packages/persistence/src/index.ts` 维持约 1000 行以内；新增测试不继续堆入接近 1000 行的 `public-api-security.test.ts`。
- 不引入与本批次无关的重构、UI 样式、grid/gap、License/OEM 或 DOCX/PDF 改动。
- failure diagnostics 只输出稳定 code 和必要结构化字段，不传播 resource URL、resource ID 作为公开 entry/path 或平台异常文本。

### Spec

- SEC-04：明确 target、history、storage 的提交顺序；失败后的每个状态可由公开 seam 和故障矩阵复现；不把 CAS 说成现有能力。
- PERS-01：失败返回不代表 target 已变；若选择 pending 语义，pending 不算 committed history，recovery 规则必须写清。
- PERS-03：`Y.Text.toDelta()` attributes 与 JWord `run.properties` 分开断言。
- State hash：只能比较 7.4.1 定义的 canonical logical-content snapshot hash；不得直接比较不同 Y.Doc 的 `Y.encodeStateAsUpdate()`、state vector 或其它历史相关 bytes。
- FMT-03：manifest resource ID/path/mime、packageEntries、checksums 和 document reference 一一关联；load 后 packed bytes 必须回到可渲染 source 或经批准的 bytes/object URL owner。
- Worker：只通过现有 Worker contract 验证，不发送 stale load-result、部分 document 或未声明 transferable。
- 浏览器与 Node：B3 若使用 `Blob.arrayBuffer()`、`fetch(blob:)`、`URL.createObjectURL()`、`URL.revokeObjectURL()` 或 transferables，必须逐项记录兼容性依据，并为 Worker、浏览器宿主和纯 Node 分别记录 bytes 所有权与 revoke 责任。在当前可用的 Chrome/Edge、Firefox、Safari 版本上执行 focused smoke 并记录精确版本和缺失项；Chrome/Edge 100、Firefox 128、Safari 16.4 的最低版本人工认证仍为 `Deferred/not-run`，不能由当前版本 smoke 或文档兼容性依据替代。
- 任何新增公开 API、格式版本、resource source 类型、storage 能力或 diagnostic code 先列为决策并停止，不能在实施中自行扩大范围。

## 12. 完整验证命令（B1-B4 完成后才执行）

### 12.1 Dirty 范围门禁

B1 开始时保存既有 dirty 文件集合、每个文件的 staged/unstaged 状态和状态哈希。B4 不再比较整个 workspace hash：

- 对批准范围外的 tracked 文件，比较实施前后的 `git diff --binary -- <outside-scope>`、`git diff --cached --binary -- <outside-scope>` 哈希和 `git status --porcelain=v1 -- <outside-scope>`；对既有 untracked 文件保存路径及内容哈希，并分别保存其 staged/unstaged 状态。
- 对批准范围内文件，单独记录 `git diff --binary -- <approved-scope>`、`git diff --cached --binary -- <approved-scope>`，以及新增 untracked 文件内容哈希。
- 所有范围均执行 `git diff --check`、`git diff --cached --check`。每批结束及 B4 必须用 `git ls-files --others --exclude-standard -z` 枚举实施期间所有新增或既有未跟踪文件，并逐一执行 `git diff --no-index --check /dev/null <file>`；普通 `git diff --check` 不覆盖这些文件。该命令因 `/dev/null` 与文件存在预期差异时返回 exit 1，只有出现 whitespace diagnostic 输出或其它异常退出码才判定失败，不能把无诊断输出的预期 exit 1 当作门禁失败。
- 只有范围外状态完全不变、范围内 diff 与批准清单一致时，才满足 dirty 门禁；不得因批准范围内源码、测试或文档变化而拒绝 B4。

全部未跟踪文件的可复现判定方式（逐文件允许预期 exit 1，但不允许诊断输出或其它退出码）：

```bash
untracked_check_failed=0
while IFS= read -r -d '' untracked_file; do
  if untracked_check_output="$(git diff --no-index --check /dev/null "$untracked_file" 2>&1)"; then
    untracked_check_status=0
  else
    untracked_check_status=$?
  fi
  if test "$untracked_check_status" -ne 0 -a "$untracked_check_status" -ne 1 || test -n "$untracked_check_output"; then
    untracked_check_failed=1
  fi
done < <(git ls-files --others --exclude-standard -z)
test "$untracked_check_failed" -eq 0
```

Focused seam：

```bash
pnpm exec vitest run packages/persistence/test/memory-adapter.test.ts packages/persistence/test/storage-history-adapter.test.ts
pnpm exec vitest run packages/native/test/public-api.test.ts packages/native/test/worker.test.ts
```

Package、类型和构建：

```bash
pnpm --filter @4xian/jword-persistence test
pnpm --filter @4xian/jword-persistence typecheck
pnpm --filter @4xian/jword-native test
pnpm --filter @4xian/jword-native typecheck
# 当前基线：该完整命令有 3 个历史空入口失败，不能归因给 Phase 2B
pnpm --filter @4xian/jword-core test
# B4 package gate：排除上述 3 个空入口，或先单独获批删除/重命名它们后再恢复完整命令
pnpm exec vitest run packages/core/test --exclude packages/core/test/editor/facade-runtime.test.ts --exclude packages/core/test/editor/input-runtime.test.ts --exclude packages/core/test/layout/runtime.test.ts
pnpm --filter @4xian/jword-core typecheck
pnpm build
```

架构、公开类型和质量门禁：

```bash
pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate45-native-bundle.test.ts
pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts tests/architecture/gate6-import-graph.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts
pnpm test:types
pnpm typecheck
pnpm lint
pnpm test
git diff --check
git diff --cached --check
```

当前 Core 基线已实测为 72 个测试文件通过、365 个测试通过，以下 3 个历史空入口失败（`No test suite found`）：`packages/core/test/editor/facade-runtime.test.ts`、`packages/core/test/editor/input-runtime.test.ts`、`packages/core/test/layout/runtime.test.ts`。它们是拆分后的 `export {}` 入口，不归因给 Phase 2B。B4 必须在以下两条路径中选择并记录：

1. 单独批准并先删除/重命名三个空入口，然后将完整 `pnpm --filter @4xian/jword-core test` 和 `pnpm test` 纳入全绿门禁。
2. 保留既有入口，使用上面的排除命令作为 Core package gate；完整 Core 命令仍记录为既有基线失败。`pnpm test` 若只复现相同三个空入口失败，可归入同一基线；若有其他失败则必须单独处理，且不能把这些命令写成“全部命令 exit 0”。

每条命令须记录 exit code、测试文件和通过数量、Node/pnpm/OS、lockfile hash、fresh build/dist 状态以及未执行项。除已明确接受的 `git diff --no-index --check` 预期 exit 1 和上述 Core 空入口基线外，任一批准范围内命令失败、预期旧 fixture 失败未重新校准、范围外 dirty 状态改变，或 B4 的 Core 基线选择未记录，都不能按 7.5 写对应关闭状态。

## 13. 强停止条件与范围排除

立即停止并等待用户批准的条件：

1. 已批准的 restore 专用协议需要扩大到通用 append、多实例、外部 operation store 或完整 PERS-02，或新增公开 contract/诊断超出本轮明确批准。
2. 用户未决定 F1/F2 与 C1/C2 的组合、blob URL 无 bytes 的保存策略或 object URL owner/revoke 规则。
3. 需要新增公开 API、格式版本、resource source 类型、storage 能力或 diagnostic code，而没有明确批准。
4. 公开 seam 红灯无法稳定复现，或只能依赖生产 test hook/私有状态。
5. target apply、pending recovery、Worker cancel 或 checksum roundtrip 任一 2B 故障矩阵无法证明。
6. 任何文件需要超过约 1000 行才可完成，且尚未先拆分。
7. 复核出现 Standards 或 Spec finding；不能用 lint 通过替代逐方法中文注释和行为证据。

明确排除：

- 不进入 Phase 2C 的远端纯删除 update/dirty 语义。
- 不进入 License/OEM、commercial readiness 或 trust root 工作。
- 不处理 DOCX/PDF 其它已登记问题；FMT-03 只处理 Native packed resource roundtrip。
- 不宣称 Chrome 100、Edge 100、Firefox 128、Safari 16.4 或其它最低浏览器版本已经验证。

## 14. 11 号 Phase 2A 文档的处理

Phase 2B 不合并、删除或覆盖 `11-phase2a-native-untrusted-input-budget-investigation-draft.md`。11 号是已批准的 Phase 2A 实施基线，12 号是 Phase 2A 关闭证据；Phase 2B 只引用它们，不改变其历史定位。

只有在以下条件全部满足后，才可以另行提出文档归档决策：Phase 2A 的批准基线、最终命令证据、最低浏览器版本 deferred/not-run 边界已经完整吸收到 12 号及其索引；所有链接和审计引用都已更新；用户明确批准合并或删除。该决定不属于 B1-B4，不能借 Phase 2B B4 自动执行。

**B0 历史结论：三个 finding 均已确认，当时没有满足 scoped restore 或 resource roundtrip 的生产实现。该决策门随后已获批准，实际执行证据见下节。**

## 15. B1-B4 实际执行证据（2026-07-19）

### 15.1 最终批准决策与关闭边界

- B2 最初采用第 7.4 节 scoped 语义并批准最小 revision/CAS；后续复审通过两个公开 adapter 的 `beforeTransaction` observer 红灯证明 target apply 失败窗口未闭合，原 B2 Standards/Spec 结论撤销。
- 用户随后选择方案 A，批准把第 7.6 节中仅针对 `restoreVersion()` 的 pending/finalize/recovery 前移：`JWordHistoryStorageDocument.pendingRestore` 持久化 operation ID、`prepared | target-applied` phase、hash、update 和 version，`completedRestore` 只保存最近一次 finalize 确认；旧 storage 类型继续兼容，但 restore 没有 revision/CAS 时 fail closed。
- prepared、pending 与 target 只比较 package-internal canonical logical-content hash，不比较 CRDT 历史 bytes。target transaction 内同时应用内容与 marker；普通历史只在 finalize 后可见，target 已应用但 phase/finalize 失败统一返回可恢复的 `PERSISTENCE_RESTORE_RECOVERY_REQUIRED`。
- 2B 不关闭通用 history append 的 transaction/CAS/idempotency、multi-instance 竞争、外部 operation store 或完整 `PERS-02`；这些继续归入 Phase 6B。
- B3 采用 F2 + C1：格式/schema 版本为 2，writer minimum reader 为 2；reader 继续支持格式 1、schema 0/1。package document 使用 packed-resource 逻辑引用，load 在校验完成后返回运行时 data URL，不新增 bytes DTO、object URL owner 或 Worker transfer API。

### 15.2 B1 结果：PERS-03

- 新增 package-internal `yjs-document-content.ts`，memory/storage 两个正式 adapter 共用同一 clone/replace 实现；Y.Text 通过 `toDelta()`/`applyDelta()` 保留 attributes。
- 两个公开 `restoreVersion()` seam 同时验证顶层与嵌套 Y.Text attributes，且 canonical `run.properties.bold` 仍为 `true`。
- `examples/collab/src/runtime/hocuspocus-history.ts` 未纳入本批次，继续作为独立后续任务。
- B1 Standards：`PASS`，0 finding；B1 Spec：`PASS`，0 finding。

### 15.3 B2 结果：SEC-04/PERS-01 restore 专用协议

- 旧 scoped contract 复审结果：Standards `FAIL`（README 边界漂移、两 adapter 编排重复、测试回调注释）；Spec `FAIL`（target apply 窗口依赖进程内 marker、批准文档链未同步）。测试注释、共享 coordinator、durable phase 和文档链均已按 finding 修复。
- Memory/Storage 在 target 应用前 observer 抛错时取消 `prepared` pending，target 与普通 history/storage 无已完成 restore；取消失败保留 `prepared` pending 并返回 recovery-required。
- target 应用与 marker 同处一次 Y.Doc transaction；之后持久化 `target-applied` phase。phase/finalize 暂时失败不返回普通 failure；重建 adapter 与 target 后相同 source version 可完成 finalize，且 pending 期间 `listVersions()` 始终只有原两版。
- 后续 Spec 复审先后发现四类 P1：observer divergence 后 `prepared` 永久不收敛；finalize 已提交但确认抛错后 pending 消失，重试会追加第二个 restore；pending append 会复用版本 ID；跳号虽然唯一，但 finalize 尾插较早 pending 会把历史排成 1/2/4/3 并改变已提交 version-4 的重建内容。前三类历史修复不再作为当前 PASS 证据。
- 当前修复让 durable pending 或 restore 活动期间的同 document append 稳定拒绝，append 已在途时 restore 在 target/pending 前 fail closed；`target-applied` pending 保存实际 target state update，确保后续 target append 与 finalized history 使用同一 CRDT lineage。append 仅在 pending 收敛后按已提交 updates 分配连续 sequence。
- Memory/Storage 公开 seam 已验证 pending 期间普通列表不变、finalize 后顺序严格为 1/2/3/4 且 version-4 内容稳定；Storage 另覆盖预加载旧 state 的 append/restore 竞争。当前实现与文档已收口，B2 Standards/Spec 双轴复审均为 `PASS`、0 finding；批准范围内 B4 门禁及根测试全部通过，Phase 2B 已关单。

### 15.4 B3 结果：FMT-03

- 格式 2 的 `document.json` 保存 `{ kind: 'packedResource', url: 'resources/<id>' }`；manifest resource、packageEntries、checksum 和 document reference 做 ID/path/MIME/entry 双向关联。
- load 只使用已通过 checksum/integrity 的 bytes，并在分配 data URL 前把 decoded bytes、UTF-16 字符串和可整除 3 的分块临时区计入现有 128 MiB 总预算。save-load-save 不把 base64 写回 `document.json`。
- data URL 可打包；blob URL 有 `metadata.nativeBytesBase64` 时可打包且 package document 删除该 fallback；无 fallback blob URL 与 unresolved packed-resource 保存稳定拒绝，不调用 `fetch`。
- 格式 1 保留旧 data URL + packed entry 行为，缺失 entry 仍 recoverable。Worker 只通过现有 request/event contract 返回 materialized data URL；公开 diagnostics 将任意资源路径、URL 或 ID 统一脱敏为 `document.json`。
- B3 focused public API + Worker：2 文件/24 测试；public/security/Worker：3 文件/79 测试；Native package：7 文件/141 测试；Native architecture/browser support/UI adapter：5 文件/17 测试，均通过。
- B3 Standards：`PASS`，0 finding；B3 Spec：`PASS`，0 finding。

### 15.5 原 scoped 方案的 B4 命令证据（已被 B2 复审推翻）

以下证据只记录第一次 B4 的历史执行结果。B2 后续 finding 已使当时的 B2/B4 通过结论失效；新的 B2 双轴复审为 0 finding 前不得把本节作为当前关单证据。

环境：Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64`；`pnpm-lock.yaml` SHA-256 为 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b`。

| 门禁 | 结果 | 状态 |
| --- | --- | --- |
| persistence focused | 2 文件/21 测试 | exit 0 |
| Native focused public API + Worker | 2 文件/24 测试 | exit 0 |
| persistence package / typecheck | 3 文件/25 测试；typecheck 无错误 | exit 0 |
| Native package / typecheck | 7 文件/141 测试；typecheck 无错误 | exit 0 |
| Core 排除三个历史空入口 | 72 文件/365 测试；Core typecheck 无错误 | exit 0 |
| 完整 Core package | 72 文件/365 测试通过；三个 `export {}` 空入口 `No test suite found` | exit 1，接受的既有 Core 基线 |
| fresh `pnpm build` | 所有 workspace public output 重建成功 | exit 0 |
| Native boundary/release/bundle | 3 文件/11 测试 | exit 0 |
| history/import graph/file budget/package exports | 4 文件/16 测试 | exit 0 |
| `pnpm test:types` / `pnpm typecheck` / `pnpm lint` | 均通过；lint 含 package version、Core boundary、中文注释 | exit 0 |
| 当前 Chromium/Firefox/WebKit focused smoke | 首轮普通 roundtrip 3/3 通过，图片用例 3/3 因未切换“插入”页签超时；修正 test-only 用户路径后 6/6 通过 | 最终 exit 0 |
| B4 最终双轴复核 | Standards `PASS`、0 finding；Spec `PASS`、0 finding | PASS |
| 根 `pnpm test` | pretest build 通过；209 文件通过、28 文件失败，1096 测试通过、125 测试失败 | exit 1，B4 阻断 |

根测试失败不在 Phase 2B 改动面，但超出第 12 节只接受三个 Core 空入口的基线：

- DOCX focused 为 4/11 通过、7/11 失败，PDF focused 为 3/24 通过、21/24 失败，均稳定收到预先 staged License 变更触发的 `JWORD_LICENSE_SIGNATURE_INVALID`。
- 未修改的 `.husky/pre-commit` 缺少 `pnpm typecheck`，对应 gate0 断言稳定失败 1 项；未修改的 toolbar 样式使 `marginLeft` 为 `0` 而不是 `4px`，稳定失败 1 项。
- gate5 diagnostics focused 的 2 个失败仍分别来自 DOCX import 的 License 签名拒绝和 PDF 返回的 License code 未登记在 PDF metadata；预先 staged 的 Gate 7 示例断言要求未修改 vanilla 示例包含 devtools 动态 import，focused 稳定失败 1 项。
- Collab focused 为 3/12 通过、9/12 失败，九项均在 `createJWordCollabFeatureGate` 的预连接授权检查处收到 `JWORD_LICENSE_SIGNATURE_INVALID`；paste security 的 DOCX 外部图片用例同样在 import 授权检查处失败。commercial readiness focused 6/6 通过，根测试中的该项只在全仓并发运行时 timeout。完整 Core 只复现三个已登记空入口；其余失败为 License/DOCX/PDF/Collab 级联以及未修改的 hook/UI/Gate 7 断言。它们不得归因给 Phase 2B，也不得在本批跨范围修复或伪装成全绿。
- B4 最终双轴复核先发现 8 个新增测试回调缺少规范中文注释和 1 个重复 fixture 判断性 smell。8 个硬性缺口已补齐；随后新增 test-only `yjs-document-test-fixtures.ts` 集中两个测试共用的 fixture 构造/读取 helper，生产源码、package exports 与公开 API 均未改变。persistence focused 21/21、package 25/25、typecheck、scoped ESLint、中文注释检查与 whitespace 门禁复跑通过；Standards 复核为 `PASS`、0 finding。
- 当前浏览器 smoke 首轮证明普通 save/reopen 3/3 通过，但图片 roundtrip 在三个浏览器都停在隐藏的图片入口；失败截图确认测试仍位于“开始”页签。`gate4_5-native.e2e.ts` 仅补充点击“插入”页签的真实用户步骤，单 Chromium 回归 1/1、随后 Chromium/Firefox/WebKit 联合回归 6/6 均通过；生产 UI 与 Native 实现未改变。

### 15.6 Dirty、浏览器与最终状态

- HEAD 保持 `a94c6761bfc1b0b57f33074954b7e845edc862e6`，分支保持 `feature/review_questions`。
- 153 个 staged 条目保持不变；staged diff SHA-256 在 B4 文档回写前后均为 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8`。
- Phase 2B 新增 untracked 文件为 `packages/persistence/src/yjs-document-content.ts`、`packages/persistence/src/yjs-logical-content.ts`、`packages/persistence/test/yjs-document-test-fixtures.ts` 和 `packages/native/src/packed-resource-document.ts`；未执行清理、暂存或提交。
- `git diff --check`、`git diff --cached --check` 均 exit 0；逐一对全部 untracked 文件执行 `git diff --no-index --check /dev/null <file>` 后，只有允许的差异 exit 1 且无 whitespace diagnostic，汇总门禁 exit 0。Phase 2B 文档回写只修改批准的 04、05、08、09、10、README 和 13；B4 另对 `gate4_5-native.e2e.ts` 做 1 行 test-only 用户路径修正；12 号 Phase 2A 证据未修改。
- 当前 Playwright Chromium/Firefox/WebKit focused smoke 为 6/6、exit 0。Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证均未执行，状态保持 `Deferred/not-run`；当前浏览器结果不构成最低版本产品认证。
- 本节记录的原 scoped 状态已失效；15.7 和 15.8 也已被后续 sequence P1 推翻，TEST-BASELINE-01 最终结果见 15.10。Phase 2B 已在 15.10 的全绿证据后 `Closed`；Phase 2C、License/OEM 或 DOCX/PDF 相邻修复仍属于后续独立任务。

### 15.7 上一次 pending/finalize 修复后的 B4 重跑（已失效）

- 以下结果发生在第三个 sequence P1 被发现之前，只保留为历史证据，不能用于当前关单。
- 当时 B2 最终双轴复审为 Standards `PASS`、0 finding，Spec `PASS`、0 finding；当时允许进入 B4。
- 当时 Persistence focused 为 3 文件/32 测试，package 为 4 文件/36 测试；Memory 与 Storage 公开 `restoreVersion()` seam 的 pending 创建、取消、phase、finalize、CAS 抛错/冲突、observer 前后抛错、divergence repair、提交后确认丢失和恢复重试矩阵全绿。Persistence typecheck exit 0。
- Native focused 为 2 文件/24 测试，package 为 7 文件/141 测试；Native typecheck exit 0。B1/B3 的实现和证据未被 B2 修复改变。
- 完整 Core 命令有 72 文件/365 测试通过，但三个历史 `export {}` 空入口使 exit 1；批准的排除路径为 72 文件/365 测试、exit 0，Core typecheck exit 0。
- fresh `pnpm build` exit 0；Native architecture 3 文件/11 测试、Gate 6 history/import graph/file budget/package exports 4 文件/16 测试均 exit 0；`pnpm test:types`、全仓 `pnpm typecheck`、`pnpm lint` 与 scoped ESLint 均 exit 0。
- 根 `pnpm test` 的 pretest build exit 0，Vitest 为 210 个文件通过、28 个失败，1107 个测试通过、125 个失败，命令 exit 1。失败仍来自 Phase 2B 范围外的 License/DOCX/PDF/Collab 级联、hook/UI/Gate 7 断言、commercial readiness 并发 timeout 和三个 Core 空入口；不在本批修复，但超出第 12 节只接受三个 Core 空入口的基线，因此阻断关单。
- `git diff --check`、`git diff --cached --check` 和全部 9 个 untracked 文件的逐文件 whitespace 汇总门禁均 exit 0；153 个既有 staged 条目及 SHA-256 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8` 保持不变。未暂存、提交、推送、创建 PR 或发布。当前 Chromium/Firefox/WebKit focused smoke 保持 6/6，Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证保持 `Deferred/not-run`。
- 当时结论为批准范围内 B4 门禁通过；该结论已被后续 sequence P1 推翻。通用 history append CAS、幂等 append、多实例竞争、外部 operation store 和完整 `PERS-02` 仍归 Phase 6B。

### 15.8 上一次 B2 复审与 B4 重跑（已失效）

- Memory/Storage 的 pending-cancel + append + retry 对称回归当时只证明旧 prepare 逻辑会返回重复 `version-4`，共享 sequence helper 修复后返回唯一 `version-5`；未验证 finalize 后顺序和 version-4 内容，因此当时的 B2 Standards/Spec `PASS` 已失效。
- Persistence focused 为 3 文件/36 测试，package 为 4 文件/40 测试；Persistence typecheck、scoped ESLint 均 exit 0。Native focused 为 2 文件/24 测试，package 为 7 文件/141 测试；Native typecheck exit 0。
- 完整 Core 有 72 文件/365 测试通过，但三个历史空入口使 exit 1；批准的排除路径为 72 文件/365 测试、exit 0，Core typecheck exit 0。fresh build、Native architecture 3 文件/11 测试、Gate 6 architecture 4 文件/16 测试、`pnpm test:types`、全仓 typecheck 与 lint 均 exit 0。
- 根 `pnpm test` 的 pretest build exit 0；首轮为 210 个文件通过、28 个失败，1111 个测试通过、125 个失败，包含 commercial readiness 并发 timeout。紧接的纯 Vitest 汇总为 211 个文件通过、27 个失败，1112 个测试通过、124 个失败；其余失败集合仍为 Phase 2B 范围外的 License/DOCX/PDF/Collab、hook/UI/Gate 7 与三个 Core 空入口，超出第 12 节只接受三个 Core 空入口的基线，因此阻断关单。
- `git diff --check`、`git diff --cached --check` 和全部 9 个 untracked 文件的逐文件 whitespace 汇总均 exit 0；153 个既有 staged 条目及 SHA-256 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8` 保持不变。Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64` 与 lockfile SHA-256 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b` 保持不变。
- 当前 Chromium/Firefox/WebKit focused smoke 仍为既有 6/6，本次 persistence-only B2 重跑未重新执行浏览器；Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证保持 `Deferred/not-run`。
- 当时结论为批准范围内 B4 门禁通过；该结论已被历史顺序 P1 推翻，不能用于当前关单。

### 15.9 历史顺序与 append 屏障修复 B2/B4 证据（TEST-BASELINE-01 前）

- Memory/Storage 公开 seam 均先证明 pending 期间普通 append 会成功，再由 restore 专用屏障转为稳定拒绝；pending 收敛后 append 生成连续 `version-4`，普通历史严格为 1/2/3/4，`loadVersion(version-4)` 内容稳定为 `v1-later`。
- `target-applied` pending 改为保存实际 target state update 及对应 checksum/state vector；这只让 finalized restore 与后续 target append 共享 CRDT lineage，canonical logical-content hash 的比较契约不变。
- 同 backing history/storage owner 的 append 与 restore 不再交错：restore 活动时 append 被拒绝，append 已在途时 restore 在 target/pending 前 fail closed。Storage 公开 fake 已复现并关闭旧 state append 覆盖已 finalize restore 的窗口。
- B2 公开 seam 为 2 文件/18 测试，Persistence package 为 4 文件/41 测试；B2 与 B4 最终 Standards/Spec 双轴复审均为 `PASS`、0 finding。
- B4 Persistence focused 为 2 文件/33 测试，Native focused 为 2 文件/24 测试；Persistence/Native package 分别为 4 文件/41 测试和 7 文件/141 测试。完整 Core 只复现三个历史空入口，72 文件/365 测试通过但命令 exit 1；批准的排除路径为 72 文件/365 测试、exit 0。三个 package typecheck、fresh build、Native architecture 3 文件/11 测试、Gate 6 architecture 4 文件/16 测试、`pnpm test:types`、全仓 typecheck 与 lint 均 exit 0。
- 根 `pnpm test` 的旧 B4 基线为 210 文件通过、28 失败，1112 测试通过、125 失败；该结果已由下方 `TEST-BASELINE-01` 最新证据取代。
- Node `v24.14.0`、pnpm `9.14.2`、Darwin `25.5.0 arm64` 与 lockfile SHA-256 `983536781ff31a615d87c22395015240001db4cf556429a312fd501942ab869b` 保持不变。153 个 staged 条目及 SHA-256 `5feb09742b7d8bb8b0e55e4993b74f37c62590d873aa0145d8a5a0b67f556ea8` 保持不变；tracked/staged/全部 10 个 untracked 文件 whitespace 汇总门禁均 exit 0。
- 当前 Chromium/Firefox/WebKit focused smoke 沿用既有 6/6，本次 persistence-only 修复未重新执行浏览器；Chrome 100、Edge 100、Firefox 128、Safari 16.4 最低版本认证保持 `Deferred/not-run`。通用 append CAS、幂等 append、多实例竞争、外部 operation store 和完整 `PERS-02` 仍归 Phase 6B。

### 15.10 TEST-BASELINE-01 当前 test-only 收口（2026-07-20）

- T1 通过 Vitest module replacement 和 compatibility runner loader 注入显式 test-only entitlement；真实 License 入口、生产 trust root、signer、handle/transfer、JWL1 fail-closed 路径均未改变。DOCX 13 文件/73 测试、PDF 8 文件/45 测试、Collab 5 文件/27 测试、License focused 19/19 和 compatibility runner 15/15 均通过。
- 后续评审补齐真实 License public root marker 拒绝回归，明确解除 Vitest package/trust-store mock 后以 `JWORD_LICENSE_SIGNATURE_INVALID` fail closed；同时把 Vanilla E2E fixture 纳入 Gate 7 的 `collectInternalImportFailures()`。两个 focused 文件为 10/10，License package 为 3 文件/43 测试，均 exit 0。
- T2 删除 `packages/core/test/editor/facade-runtime.test.ts`、`packages/core/test/editor/input-runtime.test.ts`、`packages/core/test/layout/runtime.test.ts` 三个仅含说明与 `export {}` 的入口；完整 Core 为 72 文件/365 测试 exit 0，Phase 5 split 为 16/16。Gate 7 vanilla public-import matrix 为 3/3。
- Gate 5 commercial readiness 单文件为 6/6；根并发下曾因同步 pack 检查超过默认 5 秒，加入 test-only `maxWorkers: 4` 后普通 `pnpm test` 不再 timeout，未扩大单测 timeout。
- 最新 `pnpm test`：pretest build 通过；235 文件、1238 测试全部通过，命令 exit 0。Toolbar DOM 测试移除没有独立设计规范的精确像素间距断言并保留结构分组和非绝对定位契约后为 18/18；Gate 0 Husky 测试按当前 pre-commit 只执行 `pnpm lint` 的真实契约验证脚本头、lint 命令和可执行位，focused 为 1/1。
- 最终静态门禁：`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 均 exit 0。lint 首轮发现 Vitest test-only setup 未被 TypeScript project service 收录；只在根 `tsconfig.json` 显式纳入该测试文件后，typecheck 与完整 lint 复跑通过。
- 最终 dirty/whitespace 门禁：`git diff --check`、`git diff --cached --check` 均 exit 0；逐一检查当前全部 17 个 untracked 文件后，仅有 `git diff --no-index --check` 的预期差异 exit 1，没有 whitespace diagnostic，汇总 exit 0。既有 staged/unstaged/untracked 内容均未被清理、暂存或覆盖。
- 最新双轴复审：Standards 硬性规则 `PASS`、0 finding，并保留 test-only mock 装配重复这一不阻断 P3 判断项；Spec `PASS`、0 finding。用户指出的两个 P2 覆盖缺口均已关闭，原跨环境 assertion helper 去重建议仍 defer。
- `TEST-BASELINE-01` 已 `Closed`，本次未修改生产功能或 `.husky/pre-commit`。Phase 2B 已正式关单，下一步按路线进入 Phase 2C。
