# 安全与授权问题清单

> 范围：`packages/license`、`packages/collab-server`、`packages/native`、`packages/persistence`。本文件只记录当前仍开放的安全与数据完整性问题。

## SEC-01（P0）默认授权信任根对应仓库公开测试私钥，商业 token 可伪造

- 位置：`packages/license/src/index.ts:147`、`308`；`fixtures/license/insecure-test-only-keys.ts:10-13`。
- 事实：
  - `JWORD_LICENSE_DEFAULT_PUBLIC_KEY_BASE64URL = '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo'`（index.ts:147）。
  - 该值与 `INSECURE_TEST_ONLY_LICENSE_PUBLIC_KEY`（fixtures 第 13 行）逐字节相同，其对应私钥 seed `INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED`（fixtures 第 10 行）明文提交在仓库中。
  - `readVerifiedEd25519LicensePayload` 在调用方未传 `publicKeyBase64Url` 时回退到该默认公钥（index.ts:308）。
- 触发场景：任何人用仓库里的测试私钥 seed 对自定义 features 调用 `createInsecureTestOnlyJWordLicenseSignature`（该 helper 仍在正式入口导出，index.ts:234），即可签发能通过默认验签的 JWL1 token。
- 后果：商业授权可被任意伪造，DOCX/PDF/协作等收费能力全部可绕过。这是收费模式的根本性漏洞。
- 建议修复：删除生产默认测试信任根；改为内置固定 `issuer + keyId` trust store；不允许调用方注入公钥；测试 signer 与私钥 fixture 不进入正式 exports/tarball；补伪造拒绝回归。（对应路线图第三批 OEM Phase 1）
- 当前结论：**确认**。默认公钥、公开测试私钥 seed、生产验签回退和正式入口 signer 导出四条证据均与当前源码一致。
- 详细修复步骤：
  1. 先按已批准的 OEM License 决策固定生产 `issuer + keyId` 与受信公钥表，明确旧 JWL1 token 的兼容截止策略。
  2. 删除生产验签对 `JWORD_LICENSE_DEFAULT_PUBLIC_KEY_BASE64URL` 和调用方 `publicKeyBase64Url` 的回退/注入路径；未知 issuer、keyId 或算法一律 fail closed。
  3. 将测试 signer 和私钥 fixture 移到测试专用模块，确认 `packages/license/src/index.ts`、包 exports、构建产物和 `pnpm pack --dry-run` 清单均不再包含签发能力或测试私钥。
  4. 增加最小回归：旧公开 seed 签出的 token 必须被生产入口拒绝；受信生产测试向量可通过；未知 keyId、篡改 payload 和篡改签名返回稳定诊断。

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

## SEC-06（P1）自研密码实现无独立审计

- 位置：`packages/license/src/crypto.ts`（约 556 行自研 SHA-512/Ed25519）。
- 事实：授权验签依赖自研密码原语，仓库内没有第三方审计、完整 RFC 8032 签名向量或差分测试证据。
- 后果：密码实现潜在缺陷难以自证；即便修复 SEC-01，验签正确性仍缺乏保证。
- 建议修复：迁移成熟实现或完成独立密码学审计 + RFC 8032 标准向量 + 模糊测试。
- 当前结论：**部分正确，属于保障缺口而非已证实的密码缺陷**。约 556 行 SHA-512/Ed25519 确为自研，仓库内未发现独立审计证据；但现有 fixture 已使用 RFC 8032 的 seed/public key，并有签发、验签和篡改拒绝测试。缺少的是包含预期 signature 的完整 RFC 8032 向量、差分测试和独立审计。
- 详细修复步骤：
  1. 优先评估浏览器与 Node 均可用、维护活跃且经过广泛审阅的 Ed25519 实现；若零依赖仍是硬约束，用 ADR 记录为什么不能迁移。
  2. 在替换前先加入 RFC 8032 完整向量：固定 seed、public key、message 和 expected signature，同时覆盖空消息、长消息、错误长度、非规范 scalar/point 等拒绝路径。
  3. 用成熟实现或 WebCrypto/Node crypto 对随机输入做差分签名/验签测试，再对 token decoder 和签名入口做模糊测试。
  4. 迁移后删除自研原语；若决定保留，则必须安排独立密码学审查并把版本、范围和结论作为 release gate 证据。

## 结论

SEC-01 至 SEC-04 是阻断商业交付的核心问题。在这些问题关闭前，项目只适合内部技术实施与 release rehearsal，不适合对外收费 PoC 或正式交付。
