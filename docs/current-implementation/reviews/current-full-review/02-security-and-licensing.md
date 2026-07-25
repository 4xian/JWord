# 安全与授权问题清单

> 范围：`packages/license`、`packages/collab-server`、`packages/native`、`packages/persistence`。本文件只记录当前仍开放的安全与数据完整性问题。

## SEC-01（P0）固定信任根和正式 signer 已收口，但 insecure fixture 仍在正式入口

- 位置：`packages/license/src/trust-store.ts`、`packages/license/src/verify-jwl2.ts`、`packages/license/src/index.ts`、`packages/license/src/license.ts`、`packages/license/src/legacy-jwl1.ts`；`fixtures/license/insecure-test-only-keys.ts:10-13`。
- 事实：
  - `LIC-100` 已删除默认测试公钥回退；`LIC-101` 和 `LIC-102` 已完成内部职责拆分、严格 JWL2 envelope/claims parser 和固定签名输入。
  - `LIC-103` 已内置 `issuer=jword`、`keyId=jword-prod-2026-k1` 与批准的 32-byte 生产公钥，调用方不能再通过 `publicKeyBase64Url` 换根；完整 claims 仅在 Ed25519 验签成功后解析。
  - `LIC-104` 已公开 JWL2 激活、模块私有 WeakMap handle、时间关系和集中 module feature 检查；伪造、复制、structured clone、parser 或 claims 均不能获得可信 handle identity。
  - `LIC-105` 已公开 identity-checked worker transfer；只有可信 handle 能读取私有 token 创建单字段 DTO，clone 后必须通过同一激活路径重新验签并创建新 handle。
  - JWL1 Ed25519 token 现在统一 fail closed，不再读取调用方公钥。
  - `LIC-106` 已把测试 signer 和 Ed25519 签名能力移到仓库 fixture support；正式根入口、production src、dist 和 tarball 均不再包含 signer、测试 seed 或签名入口。
  - `LIC-107A` 已用精确 `@noble/curves@2.2.0` 和 strict `{ zip215: false }` 替换自研 Ed25519 verifier；`LIC-107B1` 已通过 tarball/no-alias 的 Node、当前三浏览器和真实 module Dedicated Worker 自动 smoke。
  - `LIC-107B2` 的 Node 20.19.0 已在固定 Docker 镜像中通过 tarball/no-alias/public-entry 验证；Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 仍没有真实最低版本证据。该人工认证已按明确风险接受延期为发布前门禁，不阻断后续内部阶段，也不得描述为已实测通过。
  - `LIC-108A` 已把 `tools/license/issue-license.mjs` 切换为严格 JWL2-only signer：固定生产 issuer/keyId 与 canonical bytes，拒绝重复顶层 key，路径私钥经 realpath 后必须位于仓库外，并由固定 production golden vector 交叉锁定 signer/runtime。
  - `LIC-108B` 已按批准契约实现离线 `tools/license/verify-license.mjs`：固定生产 trust store，支持 stdin/file 与审计用 `--at`，成功只输出带 `checkedAt` 的裁剪 JSON，失败只输出稳定 code。
  - `INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED` 与对应公钥继续只保存在不会进入 package tarball 的仓库 fixture 中。
  - `allowInsecureFixtureLicense` 仍是公开 validation option；显式开启时旧 FNV fixture 可以进入遗留 entitlement 路径。DOCX/PDF/Collaboration 尚未迁移到新 JWL2 handle/transfer 入口。
  - `LIC-111B1/B2` 已把 DOCX、PDF、Collaboration 和 Collab Server 切换为必需 License peer，并通过正常 pnpm/npm、Node 20.19.0、Vite ES2022 与当前 Chromium/Firefox/WebKit 验证单一 runtime；重复 runtime 不共享 WeakMap handle，必须通过 token transfer 在接收 runtime 重新激活。
- 触发场景：调用方已不能替换 JWL2 信任根，正式包也不再暴露 signer，但仍可显式开启旧 insecure fixture 路径。
- 后果：LIC-103/104/105/106 已关闭调用方公钥换根、建立可信 handle/transfer 并删除正式签名能力，但遗留 fixture 入口和商业调用方尚未迁移，仍使 DOCX/PDF/协作收费能力不能作为生产商业边界。
- 建议修复：LIC-107B2 人工矩阵保留为发布前认证；DOCX/PDF/Collaboration 的 JWL2 handle 迁移进入 OEM License Phase 2（统一路线阶段 4A），JWL1 类型和兼容路径留到统一路线阶段 4C。LIC-110B1/B2 已建立 test-only trust/key 隔离，LIC-111B1/B2 已完成单一 runtime 与重复 runtime fail-closed 验证。（对应路线图阶段 1）
- 当前结论：**Phase 1 内部实施已完成，SEC-01 仍为 Open**。`LIC-107B2` 最低浏览器人工认证已条件性接受并延期，不阻断内部阶段；主要剩余风险是公开 `allowInsecureFixtureLicense` 遗留入口及尚未迁移的旧调用方。
- 详细修复步骤：
  1. `LIC-100` 已完成：仓库公开 seed 签发的 token 在无可信生产 trust root 的公开入口被稳定拒绝。
  2. `LIC-101` 已完成：License 内部职责已拆分，未改变根入口导出或激活行为。
  3. `LIC-102` 已完成：内部 parser 已严格限定 JWL2 envelope、canonical claims、四种 class 和三个模块 feature；输出保持未验签状态，不得直接登记为可信 handle。
  4. `LIC-103` 已完成：固定生产 `issuer + keyId` 与受信公钥表，删除调用方 `publicKeyBase64Url` 注入路径，并在完整 claims 解析前完成 Ed25519 验签；未知 issuer、keyId 或无效签名一律 fail closed。
  5. `LIC-104` 已完成：仅在 LIC-103 验签成功且时间关系有效后，把 class、module features 和期限写入模块私有 WeakMap 并生成不可伪造 handle；parser 返回值、普通对象、类型断言、对象复制或 structured clone 均不能获得可信身份。
  6. `LIC-105` 已完成：可信 handle 才能创建仅含 token 的 transfer；伪造、复制和 cloned handle 被拒绝，worker clone 后通过既有激活路径重新验签并创建新 handle。
  7. `LIC-106` 已完成：测试 signer 与签名能力只存在于仓库 fixture support；`packages/license/src/index.ts`、包 exports、构建产物和实际 tarball 均不含签发能力、测试 seed 或测试私钥。
  8. `LIC-107A/B1` 已完成：成熟 verifier、RFC 8032/严格拒绝回归、当前 Node/浏览器/Dedicated Worker 和第三方 tarball/no-alias 证据已落地；不宣称 noble 已经独立密码学审计。
  9. `LIC-107B2` 为 `Conditionally Accepted / manual certification deferred`：Node 20.19.0 已通过；Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 真实环境矩阵留作对外最低版本认证和商业 GA 前门禁，不用最新版 Playwright 替代或冒充实测。
  10. `LIC-108A` 已完成：严格 JWL2 signer 拒绝重复顶层 key 和仓库内私钥路径，固定 production golden vector 锁定 canonical payload JSON、payload segment 和 `JWL2.<payloadSegment>` signing input；固定 production token 已由 runtime trust store 独立完成验签。
  11. `LIC-108B` 已完成：离线验签/裁剪 CLI 复用构建后的 License 根入口和固定生产 trust store，不导入 signer、不读取私钥、不输出 token，也不进入 package exports、dist 或 tarball。
  12. `LIC-109` 已完成：JWL2 诊断分类、语言无关 metadata、旧在线状态/offline grace/customerId、DOCX/PDF worker DTO、Collab License alias 和 registry/docs 已收口；旧 JWL1 类型仍保留到 Phase 4。
  13. `LIC-110B1/B2` 已完成：test-only JWL2 trust/key 只存在于 focused test 与仓库 fixture support；Gate 5、dist 和 tarball 隔离扫描通过，不恢复生产默认测试 key 或 `allowInsecureFixtureLicense` 绕过。
  14. `LIC-111B1/B2` 已完成：四个消费包使用必需 License peer 和仓库 devDependency；pnpm/npm、Node 20.19.0 与 Vite 当前三浏览器只解析一个 canonical runtime，重复 runtime、伪造、复制和 structured clone handle 全部 fail closed。当前浏览器结果不是 LIC-107B2 最低版本证据。
  15. 保持最小回归：旧公开 seed 签出的 token 必须被生产入口拒绝；受信 production golden token 可通过；未知 keyId、篡改 payload 和篡改签名返回稳定诊断。

## SEC-02（P0）HTTP 认证 hook 读不到真实凭据，history 作者来自不可信客户端

- 位置：`packages/collab-server/src/request-guards.ts:18-36`；`index.ts:356`；`history-routes.ts:247,252`。
- 事实：
  - `JWordCollabServerAuthHookInput` 只携带 `requestId/method/path`（index.ts:130-134），auth hook 拿不到 header、cookie 或 token，无法做真实身份校验。
  - history append 直接写入 `authorId: body.authorId` 和 `createdAt: body.createdAt`（history-routes.ts:247,252），二者均来自客户端请求 body。
- 触发场景：客户端 POST history 版本时任意指定 `authorId` 和 `createdAt`。
- 后果：认证用户身份无法贯穿到 history；作者与时间可被伪造，审计与版本归属不可信。当前实现不能宣称任何身份隔离。
- 建议修复：HTTP/WS 共用统一 admission port，产生服务端可信 `actorId` request context；history 作者只能取自 admission，不接受 body 覆盖；服务端不无条件信任客户端时间。（对应 Collaboration Phase 3）
- 当前结论：**确认**。auth hook 的输入类型确实不含任何凭据，hook 返回的 `userId` 也在进入 history route 前被丢弃；`authorId/createdAt` 均直接来自 body。
- 详细修复步骤：
  1. 定义 HTTP/WS 共用的内部 `AdmissionContext`，至少包含服务端确认的 `actorId`、role、deployment/document scope；只向 hook 暴露完成认证所需的 headers/cookie/query/连接信息。
  2. 让 `handleServerRequest` 保存完整 auth 结果并把 `AdmissionContext` 传给 history、license status 和 relay handler，而不是只读取 `ok`。
  3. 从 history 写入请求的可信字段中移除 `authorId/createdAt`：作者取 `AdmissionContext.actorId`，时间由服务端生成；旧客户端字段暂时接受时也必须忽略。
  4. 补最小测试：缺失/错误凭据被拒绝；body 伪造作者和时间不会落库；HTTP 与 Hocuspocus 对同一身份映射得到同一 actor。

## SEC-03（P0）`.jword` ZIP/JSON 解压无任何资源预算（zip bomb）

- 位置：`packages/native/src/package-readers.ts:52`（`JSZip.loadAsync(await normalizeBinaryInput(input))`）及后续 `readManifest/readMetadata/readChecksums/readDocument`。
- 事实：`readPackageParts` 直接 `JSZip.loadAsync` 整个输入并逐个读取 entry，全程没有输入总大小、entry 数量、单 entry 大小、总解压体积、压缩比或文本 JSON 大小上限。
- 触发场景：打开一个精心构造的高压缩比 `.jword`（zip bomb）或超大 JSON part。
- 后果：内存/CPU 资源耗尽，主线程或 worker 崩溃，可造成拒绝服务。
- 建议修复：在解压前后加入全部资源预算与稳定 diagnostic；拒绝路径穿越、重复关键 entry、异常压缩比；补 zip bomb / 大 JSON / 重复 entry 测试。
- 当前结论：**确认**。当前 native 读取链没有压缩输入、entry 数、单项/总解压量、压缩比或 JSON 文本预算；checksum 阶段还会再次完整解压声明的 entry。
- 详细修复步骤：
  1. 建立 native 专用资源预算常量与稳定错误码，至少覆盖压缩输入、entry 数、单 entry、总解压量、压缩比和各 JSON part 文本大小。
  2. 在 `JSZip.loadAsync` 前检查输入字节数，并在 JSZip 丢失重复名称信息之前扫描中央目录，拒绝路径穿越、重复关键 entry、加密 entry 和异常元数据。
  3. `loadAsync` 后先汇总中央目录的未压缩大小；每次 `file.async()` 前检查单项与累计预算，读取后再核对实际字节数、manifest/checksum 声明和 JSON 文本大小。
  4. 让 `readManifest/readMetadata/readChecksums/readDocument/inspectChecksums` 共用同一预算上下文，避免校验阶段绕过前面的累计限制。
  5. 只补关键回归：高压缩比包、超多 entry、超大 JSON、重复 `document.json`、路径穿越和 checksum 声明不一致均稳定失败。

### Phase 2A B1-B5 当前实施状态

Native 读取预算、严格 manifest/checksum 解析、版本化 document schema、AbortSignal 语义和诊断契约已完成。后续复核发现的有限数字、非法 data URL、保存最终进度取消竞态及证据/规范问题均已修复，Standards/Spec 双轴复审无剩余 finding；SEC-03 与 Phase 2A 已重新 `Closed`。最低浏览器人工认证仍按 LIC-107B2 单独 deferred。

## SEC-04（P0）版本恢复非原子，中途失败导致文档已变但 API 报失败

- 位置：`packages/persistence/src/index.ts:514-526`。
- 事实：`restoreVersion` 先调用 `replaceDocumentContent(input.targetDoc, preview.doc, ...)` 改写目标 Y.Doc（515 行），再 `await this.appendRestoreVersion(...)`（516 行）；若 append 抛错，catch 分支返回 `PERSISTENCE_RESTORE_FAILED` 诊断（521-525 行），但此时文档内容已经被替换。
- 触发场景：恢复某个历史版本时，写入 Y.Doc 成功但持久化 append 失败（磁盘/DB/序列化错误）。
- 后果：API 返回失败，但用户文档已被静默改成历史版本内容，历史记录却未落地——数据完整性破坏，用户会认为恢复没生效而继续编辑，造成不可逆混乱。
- 建议修复：在隔离 Y.Doc 中准备 restore，使用事务/CAS 一次提交；失败时目标文档与历史均不变。
- 当前结论：**确认**。内存与 storage adapter 都是先就地替换 `targetDoc`，再追加/保存历史；持久化异常没有回滚目标文档。
- 详细修复步骤：
  1. 在隔离 Y.Doc 中加载目标版本并生成待提交的完整 restore update，同时保存恢复前的 target update/state vector，准备失败回滚。
  2. 将 storage 合约扩展为带预期 revision/etag 的原子 `commitRestore`（或等价 CAS），在一次存储事务中追加 update、version 和 restoreSourceVersionId。
  3. 存储提交成功后，才在单次 Y.Doc transaction 中把 restore update 应用到 `targetDoc`；若目标应用异常，恢复原状态并执行可识别的补偿/重试流程。
  4. 内存 adapter 也沿用相同阶段边界，不保留“先改目标、再写历史”的特殊实现。
  5. 用可注入失败的最小测试覆盖 prepare、append、save/CAS 冲突；每个失败点都断言 target 内容、版本列表和 update 链保持原状。

## SEC-05（汇总，不单独计数）默认 CORS 与内存态限流不理解可信代理/准入 actor

- 位置：`packages/collab-server/src/http-utils.ts:147-164`、`index.ts:404-445`；`packages/persistence/src/storage-history-adapter.ts:109-150`。
- 事实：默认 CORS 返回 `*`；限流器使用进程内 Map，key 只读取 `socket.remoteAddress`；history append 是无 CAS/事务保护的 read-modify-write。具体实现边界见 [04-collaboration-and-persistence.md](04-collaboration-and-persistence.md)。
- 后果：生产多实例部署下限流可被绕过；默认 CORS 过宽。
- 建议修复：生产默认 allowlist；可信代理解析；按 deployment/actor 的分布式限流。
- 当前结论：**确认（合并型风险）**。CORS、IP 识别、限流存储和进程内锁分别由 COLLAB-05、COLLAB-06、PERS-02 的当前源码直接确认，本条不应再作为一份独立实现重复修复。
- 详细修复步骤：
  1. 以 COLLAB-05 关闭默认 CORS，以 COLLAB-06 关闭可信代理与共享限流，以 PERS-02 关闭多实例写入竞态。
  2. 三项完成后做一次双实例部署验证：同一 actor 的请求跨实例累计限流，非 allowlist origin 无 CORS 授权，history 并发写不丢失。

## SEC-06（P1）成熟 verifier 已迁移，最低运行时证据待完成

- 位置：`packages/license/src/crypto.ts`、`packages/license/package.json`、`packages/license/test/jwl2.test.ts`、`tools/release/check-license-runtime-smoke.mjs`、`tools/release/check-license-minimum-node.mjs`。
- 事实：`LIC-107A` 已删除自研 SHA-512/Edwards verifier，改用精确 `@noble/curves@2.2.0` 的 `@noble/curves/ed25519.js`，保持同步 interface、长度预检、catch/fail-closed 和 `{ zip215: false }`。RFC 8032 官方向量、篡改、非法输入与 strict 拒绝向量已覆盖。
- 当前证据：`LIC-107B1` 已证明本地 tarball 在当前 Node、Chromium、Firefox、WebKit 和真实 module Dedicated Worker 可用；`LIC-107B2` 的 Node 20.19.0 也已通过 tarball/no-alias/public-entry 验证。两条路径均确认只有一套 `@noble/curves@2.2.0` / `@noble/hashes@2.2.0`。
- 剩余风险：当前证据不能证明 Chrome 100、Edge 100、Firefox 128 和 Safari 16.4。`@noble/curves` 是外部供应链依赖；本项目没有对该版本执行独立密码学审计，也不得作此宣称。
- 当前结论：**实现风险已缓解，内部推进已接受；最低浏览器认证 Deferred**。`LIC-107A/B1` 已完成，`LIC-107B2` 按明确风险接受条件性收口，整体 `LIC-107` 对内部实施视为完成。
- 剩余步骤：按 [最低浏览器人工验证手册](../../license-minimum-browser-manual-verification.md) 在 Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 的真实环境复跑同一候选 tarball/public-entry/main-thread/Dedicated-Worker 矩阵，记录完整版本、OS、tarball hash 和日志；最终对外认证前对同一 tarball 复跑 Node 20.19.0。没有对应环境时保持 `Deferred/not-run`，不阻断内部阶段，但不得宣称已完成最低版本认证。

## 结论

SEC-01 至 SEC-04 是阻断商业交付的核心问题。在这些问题关闭前，项目只适合内部技术实施与 release rehearsal，不适合对外收费 PoC 或正式交付。
