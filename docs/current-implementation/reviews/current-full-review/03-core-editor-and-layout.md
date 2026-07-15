# core 编辑器、事务与布局问题清单

> 范围：`packages/core/src`（editor、operations、layout、model、plugins、find-replace、resources）。本文件只记录当前仍开放的问题。

## CORE-01（P1）远端/恢复通道的纯删除 update 不刷新投影与布局

- 位置：`packages/core/src/operations/transaction.ts:645-651`，配合 `hasDocumentStateChanged`（722-730）。
- 问题：`applyUpdate` 用 `hasDocumentStateChanged` 比较事务前后的 Yjs state vector 判定 `dirty`。Yjs 的 state vector 只记录各 client 的 struct clock（新增），删除只写入 delete set、不推进 state vector。因此"纯删除"的远端 update 前后 state vector 相同，`dirty` 被判为 `false`。
- 触发场景：协同对端删除文本/块，或走 applyUpdate 语义的恢复通道只产生删除时。
- 后果：`currentProjection` 复用未删除的旧快照，事件 `dirty:false` 使下游不重排不重绘——已删除内容在本地仍可见，本地状态与 Y.Doc 真源脱节。本地 `run()` 路径无条件重算投影，无此问题。
- 建议修复：变化检测不能只比 state vector，应结合 delete set（比较 update 差异或用 afterTransaction 的 deleteSet），删除也算 dirty 并重算投影。补纯删除回归用例。
- 当前结论：**确认并运行复现**。Yjs state vector 只反映 struct clock；当前 dist 最小验证中，远端 Y.Text 已由 `abc` 删除为 `ac`，但 `applySyncUpdate` 返回 `dirty:false`，公开 projection 仍为 `abc`。
- 详细修复步骤：
  1. 在 `applyUpdate` 周围捕获本次 Yjs transaction 的实际 changed/deleteSet 信息，不再单独用前后 state vector 作为 dirty 真值。
  2. 只有 transaction 确认无结构变化且无删除时才复用 projection；纯删除必须重建 projection 并产生 `dirty:true`。
  3. 保留幂等 update 的 `dirty:false`，避免把“收到 update”直接等同于“文档变化”。
  4. 增加两个最小回归：远端文档只删除文本/块后本地 projection 同步删除；同一 update 重放不再次标 dirty。

## CORE-02（P1）插件 setup 抛错后已注册能力不回滚

- 位置：`packages/core/src/plugins/host.ts:372-388`。
- 问题：`registerCommand/interceptCommand/registerKeyBinding/registerDecorationProvider` 被调用时立即写入 host 内部集合，返回的 disposable 只在 setup 正常 return 后才 push 进 `this.disposables`。插件在 setup 中先注册若干能力再抛错时，catch 仅上报诊断，之前的注册已生效且无 disposable 记录。
- 触发场景：任何插件 setup 中途抛异常。
- 后果：半初始化插件把命令/快捷键/中间件永久挂在宿主上，可能覆盖内建命令名、拦截命令链，`dispose()` 也清不掉。
- 建议修复：`setupPlugin` 内收集本插件本次 setup 产生的全部 disposable，抛错时立即逐个回滚再上报诊断。
- 当前结论：**确认**。注册 API 立即修改 host 集合，而全局 disposable 只在 `setup` 正常返回后登记，异常路径没有本地回滚。
- 详细修复步骤：
  1. 为每次 `setupPlugin` 创建局部 disposer 栈，传给插件的注册 API 每成功一次就立即把 disposer 压栈。
  2. `setup` 成功后再把局部 disposer 作为一个插件级 disposable 提交到 host；不要逐项散落到全局栈。
  3. `setup` 抛错时按逆序执行局部 disposer，聚合回滚错误后再上报原始 setup diagnostic，保证已注册命令、middleware、快捷键和 decoration provider 全部消失。
  4. 补一个插件先注册两类能力再抛错的测试，断言能力不可调用、名称可被后续插件重新注册且 host dispose 不重复清理。

## CORE-04（P2）查找静默 trim 掉查询串首尾空格

- 位置：`packages/core/src/find-replace/find-replace.ts:302`（`query.trim()`）。
- 触发场景：查找/替换带边界空格的目标，如 `" the "`、`"foo "`。
- 后果：无法查找/替换带首尾空格的文本，匹配结果与输入不一致。
- 建议修复：不对查找串做 trim；仅在查询全为空白时返回空。
- 当前结论：**确认**。输入语义应完全保留，只有真正的空字符串需要短路；纯空格查询应按字面匹配。
- 详细修复步骤：
  1. 将 `query.trim()` 改为原始 `query`，空查询只判断 `query.length === 0`。
  2. 让大小写、全词等后续选项继续作用于原始查询，不在规范化阶段删除空白。
  3. 增加三组最小用例：`"foo "`、`" foo"` 和纯空格查询均按字面匹配；空字符串返回空结果。

## CORE-05（P2）事务 dirty 判定两条路径语义不一致

- 位置：`packages/core/src/operations/transaction.ts:623`（`dirty: operations.length > 0`）。
- 问题：`run()` 只要有 operation 就报 dirty，不看是否真的改变了 Y.Doc；applyUpdate 路径却按真实状态变化判 dirty。
- 触发场景：插入空字符串、把属性设为与当前相同值等 no-op operation。
- 后果：无实质变更也报 dirty，触发多余的投影增量、布局调度和重绘；监听者拿到误导性 dirty。
- 建议修复：与 applyUpdate 对齐，用真实状态变化决定 dirty。
- 当前结论：**确认**。`run()` 当前以 operation 数量代替状态变化，和 `applyUpdate` 的语义不一致。
- 详细修复步骤：
  1. 复用 CORE-01 建立的 Yjs transaction 变化检测，让 `run()` 和 `applyUpdate` 共享同一个 dirty 判定 helper。
  2. 仅在真实 Y.Doc 变化时重建 projection、推进 dirty scope 并向事件报告 `dirty:true`；保留命令 diagnostic 和返回值语义。
  3. 用插入空字符串、重复设置同值和一个真实变更三个测试锁定 `false/false/true`，不扩展更多边界用例。

## CORE-06（P2）生产环境事务监听器异常被完全吞掉

- 位置：`packages/core/src/operations/transaction.ts:844-858`。
- 问题：生产环境下监听器抛出的异常被静默吞掉（仅 dev 输出）。这是刻意设计（避免已提交事务被监听器副作用回滚），但布局/渲染/插件派发的失败在生产完全不可见。
- 建议修复：保留隔离语义，但把异常接入 diagnostics/telemetry 通道，而非纯静默。
- 当前结论：**确认**。异常隔离是合理设计，但生产分支确实没有任何可观测出口。
- 详细修复步骤：
  1. 在 transaction pipeline options 增加可选、框架无关的 `onListenerError`/diagnostic sink，payload 包含 commandName、origin、listener 阶段和原始 error。
  2. listener 异常仍不得回滚已提交事务，也不得阻断其他 listener；sink 自身抛错同样隔离。
  3. development console 输出可保留为默认行为，production 无 sink 时保持安静，避免 core 强绑定具体 telemetry SDK。
  4. 增加一个 production 模式测试：首个 listener 抛错、后续 listener 仍执行且 sink 恰好收到一次错误。

## CORE-07（低）死代码

- 位置：`packages/core/src/plugins/host.ts:853`，`readErrorCode` 定义后从未被调用。
- 说明：按仓库规范只提示不删；确认无用后可移除。
- 当前结论：**确认（低）**。精确引用搜索只找到定义，没有调用点。
- 详细修复步骤：确认没有动态字符串引用后删除该函数及仅由它使用的 import/type，运行 core typecheck 与 plugin host 聚焦测试即可；不要顺带清理其他预存死代码。

## 正向确认（非缺陷）

- 跨页 `comparePositions` 按 fragment 顺序遍历、符合文档顺序，未发现越界。
- `deleteRange`/`mergeBlock` 的 dirty scope 虽跳过被删中间块，但增量投影按当前 Y.Doc 块迭代，结果正确。
