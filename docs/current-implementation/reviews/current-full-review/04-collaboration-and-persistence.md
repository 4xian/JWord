# 协作与持久化问题清单

> 范围：`packages/collab`、`packages/collab-server`、`packages/persistence`。本文件只记录当前仍开放的问题。
>
> 说明：COLLAB-01、COLLAB-02、PERS-01、PERS-02 与 [02-security-and-licensing.md](02-security-and-licensing.md) 的 SEC-02、SEC-04、SEC-05 重叠，此处保留细化行号与场景。

## COLLAB-01（P0）HTTP auth hook 无法读取任何真实凭证

- 位置：`packages/collab-server/src/index.ts:130-134`（`JWordCollabServerAuthHookInput`）+ `request-guards.ts:19-37`。
- 问题：auth hook 入参只有 `requestId/method/path`，没有 headers、Authorization、cookie、query。宿主 hook 物理上拿不到凭证，无法真正认证。
- 触发场景：任何对 `/history/*`、`/license/status`、`/auto-insert/relay` 的请求。
- 后果：受保护 HTTP 路由实际无法实现认证；宿主为让功能可用而放行等于完全无鉴权。
- 建议修复：把 `IncomingMessage.headers`（至少 authorization/cookie）和原始 query 透传进 hook input，`handleServerRequest`（index.ts:355-366）把 request 传给守卫。
- 当前结论：**确认**。输入类型与守卫调用链都没有凭据来源；具体修复应产出可信 admission context，而不是只把更多原始字段散传给各 route。
- 详细修复步骤：
  1. 扩展 auth hook input，提供只读 headers/cookie/raw query、remote address 和 requestId；明确凭据解析与脱敏边界。
  2. 将 hook 的 `userId/role` 转换为内部 `AdmissionContext`，由 `handleServerRequest` 传入所有受保护 handler。
  3. route 只消费 context 中的可信 actor/scope，不再自行从 body/query 推导身份。
  4. 增加缺失凭据、无效凭据、有效 actor 三条聚焦测试，并断言拒绝发生在读取 body 和访问 storage 之前。

## COLLAB-02（P1）history 作者与时间来自不可信客户端 body

- 位置：`history-routes.ts:424,429,447-453`（读取）、`243-253`（透传 recordVersion）；客户端 `collab/src/client-history.ts:281,285`。
- 问题：`authorId`、`createdAt` 直接从请求体读取落库；auth hook 返回的 `userId`（index.ts:139）从未贯穿到 history 作者（index.ts:355-366 只判 `auth.ok`，结果被丢弃）。
- 触发场景：任意客户端 POST `/history/versions`，body 写任意 authorId/createdAt。
- 后果：版本作者、时间戳可任意伪造，审计链不可信。
- 建议修复：服务端用 auth hook 的 `userId` 覆盖 authorId，createdAt 用服务端时钟，忽略 body 中这两字段。
- 当前结论：**确认**。auth 返回值没有贯穿，body 字段被原样传给 persistence。
- 详细修复步骤：
  1. 让 history handler 必须接收 COLLAB-01 生成的 `AdmissionContext`，并从 context 写入 `authorId`。
  2. `createdAt` 统一由可注入的服务端 clock 生成，生产代码不接受客户端覆盖；请求类型中移除这两个字段或标记 deprecated 后忽略。
  3. 在 response/日志中保留服务端最终采用的作者与时间，便于审计。
  4. 补一条伪造 body 的测试，断言落库值是服务端 actor/time，而不是客户端输入。

## COLLAB-04（P2）tenant hook 默认放行，"租户隔离"默认全开

- 位置：`request-guards.ts:40-57`（`checkJWordCollabTenant` 缺省 `{ok:true}`）；`hocuspocus-server.ts:268-284` 同样缺省放行。
- 问题：未注入 tenantHook 时无任何租户校验，而 tenantId/documentId 全来自客户端（query/header/documentName 分段，hocuspocus-server.ts:324-344）。
- 后果：暴露"租户隔离"表面能力，默认零隔离；配合 COLLAB-01，跨租户读 history 可行。注意：Phase 0 决策已决定直接删除该 tenant 表面能力（LIC-005），此项应随之移除而非加固。
- 建议修复：按决策删除 tenant/role 表面能力，改单 OEM deployment；在删除前文档必须明确缺省不安全。
- 当前结论：**确认**。HTTP 与 Hocuspocus 两条 tenant hook 缺省路径均返回允许；按 LIC-005，正确处置是删除表面能力而非补一个默认 hook。
- 详细修复步骤：
  1. 以 LIC-005 为约束盘点公开类型、options、query/header、room/documentName 编码和文档中的 tenant/role 表述。
  2. 从公开 API 删除 `tenantHook` 与未兑现的多租户语义，内部 scope 改为单 deployment 下的 document/room 标识。
  3. 对需要兼容的旧字段给出明确 deprecated 期，运行时不得再据此宣称隔离。
  4. 更新协作包文档与示例，并用类型测试确认新 API 不再暴露 tenant 能力；真正多租户支持以后按独立 spec 重建。

## COLLAB-05（P2）CORS 默认 `*` 且允许 authorization header

- 位置：`http-utils.ts:155-164`（无 allowlist 返回 `'*'`）、`147-149`（允许 authorization header）。
- 后果：跨站页面可携带用户提供的 token 调用 API（当前无 cookie 认证故危害有限，属默认不安全）。
- 建议修复：无 allowlist 时默认不发 ACAO 或要求显式配置。
- 当前结论：**确认**。无 allowlist 时返回 `*`，且预检允许 authorization header；这是默认配置风险，不是已证明的凭据窃取漏洞。
- 详细修复步骤：
  1. 将缺省行为改为不发送 `Access-Control-Allow-Origin`；生产跨域必须显式配置 origin allowlist。
  2. 命中 allowlist 时回显精确 origin 并发送 `Vary: Origin`，不要把 `*` 与 credentials 组合。
  3. 预检只允许实际支持的方法和 headers；拒绝 origin 时不进入 auth、license 或 body 读取。
  4. 补同源、allowlist、非 allowlist 和 OPTIONS 四个最小测试。

## COLLAB-06（P2）限流进程内内存态且按裸 socket 地址计

- 位置：`index.ts:404-435`（`SlidingWindowRateLimiter` 用 Map）、`443-445`（`readRateLimitKey` 用 `socket.remoteAddress`）。
- 问题：不理解可信代理/`X-Forwarded-For`，反代后所有客户端共享 LB IP；多实例各自计数。
- 后果：反代后整体误限或单键失效；横向扩展后限流形同虚设。
- 建议修复：支持可信代理解析真实 IP，限流状态用共享存储。
- 当前结论：**确认**。限流器是进程内 Map，key 只读 `socket.remoteAddress`，没有可信代理配置或共享状态。
- 详细修复步骤：
  1. 定义显式 trusted proxy 配置（可信 hop/CIDR），仅在请求确实来自可信代理时解析 `Forwarded`/`X-Forwarded-For`，否则使用 socket 地址。
  2. admission 完成后优先按 deployment + actorId 限流；匿名请求再退回验证后的 client IP。
  3. 抽象带原子滑动窗口操作的 rate-limit store，生产实现使用 Redis/数据库等共享存储，内存实现仅用于单进程测试/开发。
  4. 补伪造 XFF、单层/多层可信代理、两个 server 实例共享额度三个关键测试。

## COLLAB-07（P2）snapshotStorage 是虚假扩展点

- 位置：`index.ts:111`（`snapshotStorage?: unknown`）。
- 问题：声明为 unknown，全包从未引用。给宿主"可插拔快照存储"的错觉。
- 建议修复：实现并接线，或从公开 options 移除。
- 当前结论：**确认**。除类型声明和文档外没有读取点；当前已有真实 `historyStorage` 路径，最小处置是移除。
- 详细修复步骤：
  1. 先搜索外部示例/类型测试是否使用 `snapshotStorage`；当前仓库无消费者时直接从公开 options 和文档删除。
  2. 运行 collab-server typecheck 与 public API 测试，确认删除没有隐藏接线。
  3. 如果未来确需独立快照存储，重新以强类型接口、明确生命周期和行为测试引入，不保留 `unknown` 占位符。

## PERS-01（P0）版本恢复非原子，中途失败文档已改但 API 报失败

- 位置：`packages/persistence/src/storage-history-adapter.ts:301-329`（storage 版）；`index.ts:514-527`（内存版）。
- 问题：先 `replaceDocumentContent` 就地改写目标文档，再 append→save 持久化；持久化抛错时 catch 返回 `PERSISTENCE_RESTORE_FAILED`，但文档已被替换。
- 后果：调用方收到"恢复失败"，实际 Y.Doc 已改且无对应版本记录，文档处于未记录中间态。
- 建议修复：先完成持久化再切换文档内容，或失败时回滚 targetDoc（隔离准备 + 原子提交/CAS）。
- 当前结论：**确认**。memory/storage 两个 adapter 都有相同顺序错误；详细实施以 SEC-04 的统一 restore transaction 方案为准。
- 详细修复步骤：
  1. 提取共享 restore orchestration：隔离预览、生成 update、storage CAS commit、单事务应用 target。
  2. storage adapter 用原子 append/save，memory adapter 使用同一状态机，避免两份逻辑继续漂移。
  3. 为 append 失败、save 失败和 CAS 冲突注入故障，断言 targetDoc 与历史状态均未变化。

## PERS-02（P1）history append 是 read-modify-write，多实例下丢更新/版本号重复

- 位置：`collab-server/src/history-service.ts:99-101,161-179`（`documentLocks` 为进程内 Map）；`storage-history-adapter.ts:109-150`（loadState→`sequence=updates.length+1`→push→saveState）。
- 问题：串行锁只在单进程内存生效，无 CAS/事务/幂等；versionId 用 `version-${length+1}` 生成。
- 触发场景：两个 server 实例（或重启后）对同一 documentId 并发 record。
- 后果：两个请求读到相同 length，生成相同 `version-N` 并覆盖写，丢版本、版本号重复、更新链断裂。
- 建议修复：storage 层做乐观并发（版本号/etag CAS）或原子 append；versionId 用不依赖当前长度的唯一值。
- 当前结论：**确认**。service lock 只覆盖当前进程；storage adapter 是无条件 load-modify-save，versionId 也依赖旧数组长度。
- 详细修复步骤：
  1. 扩展 storage 合约，load 返回 revision/etag，save/append 必须携带 expected revision 并以 CAS 或数据库事务提交。
  2. 冲突时重新加载并有限重试；update 需要 idempotency key，防止网络重试重复追加。
  3. `versionId/updateId` 改为全局唯一标识，展示序号由存储原子生成或作为派生字段，不能作为身份主键。
  4. history service 的进程内锁可保留为减少冲突的优化，但正确性不得依赖它。
  5. 用两个 adapter 实例并发写同一 document 的测试断言两个版本都存在、ID 不重复、update 链可重放。

## PERS-03（P2）版本恢复会丢失 Y.Text attributes，但不会清空 JWord 当前 run properties

- 位置：`storage-history-adapter.ts:652-660`（`replaceSharedType` 的 Y.Text 分支）、`688-691`（`createAndFillSharedType`）；内存版 `index.ts:852-860,886-888`。
- 问题：`replaceSharedType/createAndFillSharedType/cloneSharedValue` 的 Y.Text 分支都用 `toString()` 重建，因此 Y.Text 自身的 delta attributes 会丢失。
- 边界：JWord 当前 canonical document 的加粗、斜体等样式存储在 run 的 `properties` Y.Map，而不是 Y.Text attributes。当前运行验证显示：直接写在 Y.Text 上的 `{bold:true}` 会丢失，但 run.properties.bold 和正文可正确恢复。
- 后果：对使用 Y.Text attributes 的 persistence 调用方存在真实数据损失；对当前 JWord canonical document 尚未复现用户可见格式丢失，因此严重度从 P1 降为 P2。
- 建议修复：用 `Y.applyUpdate` 到目标共享类型，或按带 attributes 的 delta 迁移，而非 `toString()`。
- 当前结论：**部分正确，降为 P2**。修复仍有必要，但必须按真实数据模型描述，不能把通用 Yjs attributes 与 JWord run properties 混为一谈。
- 详细修复步骤：
  1. Y.Text 的替换与克隆统一使用 `toDelta()` + `applyDelta()`，保留 insert attributes；不要对已集成 shared type 直接跨 Doc 复用实例。
  2. 同时修改 memory 与 storage adapter 的 `replaceSharedType/createAndFillSharedType/cloneSharedValue`，最好提取一份共享 clone helper，避免实现继续漂移。
  3. 增加一条直接 Y.Text attributes 恢复测试，断言 delta 完整一致；再增加一条 canonical run.properties 测试，证明加粗属性和文本都不回归。
  4. 若 persistence 明确只服务 canonical JWord schema，可在公共契约中写清这一限制；否则按通用 Y.Doc 数据无损要求关闭本项。

## 正向确认（非缺陷）

- 客户端 origin 处理正确：远端 update 按 clientId 过滤自身（client-sdk.ts:194），只发布 local-user/user 事务。
- auto-insert 用 `undoScope:'auto-inserter'`、restore 用 `version-restore`、remote 用 `remote-user`，不进用户 undo 的接线在这三包侧正确。
- auto-insert-relay 的 actorId 也来自 body 未绑定认证，但 relay 只回显元数据、不写文档，危害低。
