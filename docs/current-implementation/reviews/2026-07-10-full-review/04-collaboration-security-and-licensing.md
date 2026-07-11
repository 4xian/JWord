# 协作、安全与授权审查

> 后续决策：整改语义以[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准。以下原始代码事实仍成立，但 V1 不再建设 tenant、角色或文档 ACL；目标改为单 OEM deployment、统一 admission、可信 `actorId` 与恒定 `open/write`。

## 总判定

当前安全基础不是“完全没有”，但关键边界没有闭环：默认授权信任根可伪造、HTTP 身份无法进入业务链、现有 tenant 表面能力与真实数据键不一致、不可信 `.jword` 缺解压限额、history 恢复和并发写入缺少事务语义。收费能力、生产协作或不可信文件打开进入交付范围时，对应问题仍是发布阻断。

## CRITICAL：默认商业授权可被公开测试私钥伪造

证据等级：静态确认。

- 默认验签公钥：`packages/license/src/index.ts:147`。
- 调用方未传公钥时自动使用该默认值：`packages/license/src/index.ts:287-311`。
- 对应测试私钥 seed 与公钥公开在 `fixtures/license/insecure-test-only-keys.ts:9-13`。
- 测试签发 helper 位于正式 package 根入口：`packages/license/src/index.ts:233-245`。
- 第三方 smoke 还直接内嵌同一私钥：`tools/release/check-gate7-third-party-smoke.mjs:282-297`。

结果是任何拿到仓库或测试 fixture 的人都可以签发默认运行时接受的任意 feature token。当前 DOCX、PDF、协作等商业授权不能被视为有效收费边界。

整改要求：

1. 生产运行时不得包含默认测试信任根；普通调用方不得配置或覆盖公钥，未知 `issuer + keyId` 必须由内置生产 trust store fail closed。
2. 测试签发 helper 与私钥 fixture 移出正式 export surface 和发布 tarball。
3. `issuer + keyId`、有期限 token、公钥轮换和时钟策略形成版本化契约；V1 无 offline grace，也不提供按 `licenseId` 的实时技术撤销。
4. 用成熟、审计过的 Ed25519 实现替换或独立审计 `packages/license/src/crypto.ts` 中约 556 行自研 SHA-512/Ed25519；本报告不声称当前实现已可被密码学攻击，但不建议企业授权依赖未审计自研密码代码。

## 原始发现：tenant 表面能力没有数据层隔离

证据等级：静态确认与直接风险推导。

`tenantHook` 只做 allow/deny：`packages/collab-server/src/request-guards.ts:39-57`。通过后，tenant 信息没有成为 history scope：

- list 调用 `historyService.listVersions(documentId)`：`packages/collab-server/src/history-routes.ts:99-152`。
- record 把 `documentId` 直接传给 service：`packages/collab-server/src/history-routes.ts:240-253`。
- 锁是 `Map<string, ...>`，键仍为 `documentId`：`packages/collab-server/src/history-service.ts:99-102,156-190`。
- storage 只定义 `loadDocument(documentId)` / `saveDocument(documentId)`：`packages/persistence/src/storage-history-adapter.ts:38-51`。

如果 tenant A 与 tenant B 都合法使用同一个 `documentId`，两者会落到同一版本链、snapshot、preview 和锁。该原始结论仍成立，因此当前实现不能宣称多租户隔离。

新版方案不采用旧整改方向，不在 V1 引入 `(tenantId, documentId)` 或公开 tenant interface。应删除或限时 deprecate `tenantId`/`tenantHook` 的表面能力，明确一个 deployment 只绑定一个 OEM license，并要求 `documentId` 在整个 deployment 内唯一。未来只有出现“一个 JWord deployment 承载多个彼此隔离的 OEM/客户空间”的真实需求时，才重新设计复合 scope；在此之前不得宣传 tenant 隔离。

## HIGH：HTTP auth 无法认证真实请求，身份又被丢弃

证据等级：静态确认。

`JWordCollabServerAuthHookInput` 只有 `requestId`、`method`、`path`：`packages/collab-server/src/index.ts:130-144`。调用处同样没有传 headers、Authorization、cookie、token 或 request context：`packages/collab-server/src/index.ts:355-366`、`packages/collab-server/src/request-guards.ts:18-36`。

hook 返回的 `userId` 只检查 `ok` 后就被丢弃；history 路由直接接受客户端 body 中的 `authorId`、`origin` 和 `createdAt`：`packages/collab-server/src/history-routes.ts:243-253`。这意味着：

- 内建 server 无法独立验证 bearer/session。
- 可信 actor 没有进入 license context、document access 和 history。
- history 作者和审计时间可由客户端声明。

反向代理可以先做认证，但不能解决 handler 内没有可信 actor 的问题。新版目标是统一 `JWordCollabAdmission`：由 HTTP/WebSocket adapter 提取 `credential`，admission 产生不可由 body 覆盖的 `actorId`，再进入统一 request context、开放写入裁决和 history author。客户端提交的 author 字段不得覆盖它；服务端时间也不得无条件信任客户端 `createdAt`。

## HIGH：`.jword` 缺少不可信文件资源限额

证据等级：静态确认，未执行恶意 ZIP PoC。

`packages/native/src/package-readers.ts:45-53` 直接调用 `JSZip.loadAsync()`；manifest、metadata、checksums 和 document 随后完整解压为字符串：`packages/native/src/package-readers.ts:126-238`。当前没有：

- 压缩包输入大小上限。
- entry 数量上限。
- 单 entry 解压大小上限。
- 总解压体积上限。
- JSON 字符串或 checksum 条目数量上限。

DOCX reader 已有 2000 entry、256MB 总量、64MB 单 part、16MB 文本 part 限制：`packages/docx/src/package.ts:77-80`，native 应复用同一类预算模型。否则客户打开不可信 `.jword` 时可能遭受内存/CPU DoS。

## HIGH：恢复和 history 写入缺少事务/并发语义

### 恢复失败时文档可能已经改变

`packages/persistence/src/index.ts:498-525` 和 `packages/persistence/src/storage-history-adapter.ts:285-319` 都先替换目标 Y.Doc，再追加 restore 版本或保存状态。后续持久化失败时，API 会报告失败，但用户文档已经改变，内存状态与历史记录发生分叉。

恢复应先在隔离 Y.Doc 中验证，使用存储事务/CAS 原子提交；失败时保证当前文档和版本链都未变化。

### 多实例 load-modify-save 会丢更新

storage contract 是整文档 `loadDocument()` / `saveDocument()`，append 流程按当前数组长度生成 `version-N` 再保存：`packages/persistence/src/storage-history-adapter.ts:108-150`。锁只存在于单进程 Map。多实例共享数据库时可能出现丢更新、重复序号和 snapshot 覆盖。

生产契约应提供数据库事务、乐观版本/CAS、原子 append 或幂等 event ID；跨实例锁不能依赖进程内 Map。

## 协作服务端尚不是生产数据面

证据等级：静态确认。

- Hocuspocus options 只有连接权限相关 hook，没有文档 load/store persistence adapter：`packages/collab-server/src/hocuspocus-server.ts:53-70,121-215`。
- 默认 history storage 是易失 Map：`packages/collab-server/src/history-service.ts:89-96`。
- Dockerfile 只启动 HTTP server、显式使用 volatile history、无条件允许 license，也没有 authHook：`packages/collab-server/Dockerfile:15-23`。
- Docker CMD 不启动 Hocuspocus WebSocket，因此它不是完整协作容器。
- `comment` role 与 `read` 一样不能提交任何 Yjs update：`packages/collab-server/src/hocuspocus-server.ts:185-199`；这是原实现缺口，但 V1 角色模型已由恒定 `write` 取代，comment-only enforcement 后置到未来文档权限阶段。
- rate limiter 是进程内 Map，只按远端地址：`packages/collab-server/src/index.ts:404-445`，不适合多实例或可信代理链。
- CORS allowlist 为空时返回 `*`：`packages/collab-server/src/http-utils.ts:136-164`。在无 cookie 的 token 模式未必直接可利用，但生产默认应显式 allowlist，而不是开放默认。

生产 self-host 至少需要 HTTP+WS 统一 deployment context、数据库 adapter、admission/可信 actor、全 deployment 唯一 documentId 契约、备份恢复、优雅停机、容量限制、metrics/tracing、审计事件和 HA 故障演练。

## 只读、水印与前端权限不是安全边界

`docs/current-implementation/packages/ui.md:169-179` 已正确说明 readonly 只是 UI 交互 guard。宿主仍可直接调用 core 写命令，协作客户端也不能替代服务端权限。企业权限必须由服务端/宿主策略裁决，UI readonly 只负责一致的交互反馈。

同理，状态栏品牌恢复和页面水印是展示能力，不是 DRM。宿主控制 JS、DOM 和 CSS，持续 MutationObserver/interval 不能提供不可绕过的商业 enforcement。

## 生产依赖审计

证据等级：运行复现。

`pnpm audit --prod` 退出码 1，共 9 项：5 moderate、4 low。主要生产链为 `@4xian/jword-ui -> dompurify@3.4.2`：`packages/ui/package.json:30-33`；另有 Vue 2 示例的低危 ReDoS。

粘贴代码使用字符串 `sanitize()` 和 per-call config，没有使用 advisory 中部分高风险模式如 `IN_PLACE`、全局 hook 或 `setConfig`：`packages/ui/src/paste/sanitizer.ts:69-99`。因此不能直接声称全部 advisory 在当前路径可利用。但企业发布前仍应升级到修复版本，复跑粘贴安全测试并记录不能升级时的正式豁免理由。

## 已有安全正向项

- protected HTTP route 在 authHook 缺失时默认拒绝：`packages/collab-server/src/request-guards.ts:18-36`。
- body 有 1MB 默认限制，CORS 和可选 rate limit 已有基础接口。
- UI 粘贴先经 DOMPurify，再转换为结构化 fragment，不把 HTML/CSS 原样写入 core。
- core 的资源 URL 默认收敛到 data/blob，外部 URL 需要宿主 policy。
- diagnostics export 有隐私裁剪，插件错误不会直接破坏 editor 主流程。
- Hocuspocus 已有 tenant/auth/license hook 和 read/comment/write 角色框架，但这些旧 seam 将由 deployment context、admission 和 V1 open/write 迁移替代。

这些机制可以保留，但需要把它们从“有 hook”提升为“身份、资源、数据和审计真正贯穿”的生产边界。
