# 一级 OEM 功能授权与开放文档访问实施方案

> 文档状态：待实施
>
> 编写日期：2026-07-10
>
> 适用范围：`@4xian/jword-license`、DOCX/PDF 高级格式、协作客户端与协作服务端
>
> 基线：当前仓库仍为 `0.0.0`、所有 package 均为 `private: true`；本文描述目标方案，不代表这些能力已经完成或可以直接售卖。

## 1. 结论

本方案已经具备技术实施拆分条件；商业发布仍以 Phase 0 的许可、分发和合同决策，以及 Phase 5 的发布闭环为前提。目标不是建设通用 SaaS 授权平台，而是建立一个小而明确的一级 OEM 商业授权模块：

1. JWord 只向一级 OEM 客户签发许可证。
2. 一级客户把 JWord SDK 嵌入自己的完整产品，再把该产品交付给二级客户。
3. JWord 不识别二级客户或终端用户，不按用户数、文档数、席位数计费。
4. 基础编辑能力免费；DOCX、PDF、协作、历史等高级能力按 feature 收费。
5. V1 文档访问策略固定为 `open/write`：通过部署准入的用户进入文档后均可编辑。
6. 商业授权只回答“当前一级 OEM 是否购买了某项高级能力”，不回答“某个用户是否可以访问某份文档”。

当前实现不能直接承载该售卖模式。`packages/license/src/index.ts:147` 内置的默认公钥对应仓库公开测试私钥，且 DOCX/PDF 默认调用路径无法配置正式信任根，任何持有仓库测试私钥的人都可以生成当前运行时接受的 token。修复该问题是所有收费 PoC 之前的 P0 阻断。

## 2. 已确定决策

### 2.1 V1 范围

| 事项 | V1 决策 |
| --- | --- |
| 许可证主体 | 仅一级 OEM 客户 |
| 许可证粒度 | 一个 OEM license 包含一组高级 feature |
| 基础版 | 不要求运行时 license |
| 高级格式 | DOCX import/export、PDF export 按 feature 检查 |
| 协作 | 协作服务部署持有 license；浏览器不提交 entitlement |
| 二级客户 | 不进入 token、代码模型或签发流程 |
| 终端用户 | 只作为协作 actor/presence 信息，不作为收费主体 |
| 文档权限 | 所有通过部署准入的用户固定获得 write |
| 部署模型 | 一个协作服务实例只绑定一个 OEM license |
| 文档命名 | `documentId` 在该部署内由一级客户保证唯一 |
| 计量 | 不采集 seat、MAU、文档数或正文 telemetry |
| 有效期 | V1 收费 license 必须包含 `expiresAt`；暂不签发永久离线 token |
| 撤销 | V1 离线许可证不承诺实时撤销 |

### 2.2 明确不做

V1 不建设以下内容：

- 二级客户、下游客户树或 sublicense 证书链。
- tenant、组织、RBAC、ACL、角色管理、SSO 或 SCIM。
- 按用户、席位、文档、并发数或用量计费。
- hostname、设备指纹或浏览器硬件绑定。
- 在线激活、心跳、实时吊销或 license portal。
- 永久离线 token；若未来销售永久运行权，应另行设计版本边界和长期 verify-only key 保留策略。
- 由一级客户持有 JWord 根私钥、通用签发私钥或委托签发证书。
- 把浏览器本地验签宣传为不可绕过的 DRM。
- 把水印、品牌 DOM 恢复或 UI readonly 当作商业授权边界。

如果未来需要限制 Named Product、部署数量或下游转售层级，应先形成新的商业需求，再升级 token schema；本期不提前放入假想字段。

## 3. 当前实现基线

以下事实决定了改造顺序：

| 现状 | 代码证据 | 影响 |
| --- | --- | --- |
| JWL1 公开 entitlement 重复暴露签名 claims | `packages/license/src/index.ts:62-107` | 调用方需要拼装大量字段，interface 与实现几乎同样复杂 |
| 默认信任仓库测试公钥 | `packages/license/src/index.ts:145-148,287-311` | 当前付费 token 可被公开测试私钥伪造 |
| 测试签发 helper 从正式根入口导出 | `packages/license/src/index.ts:233-245` | 正式 interface 混入测试能力 |
| 调用方可逐次传公钥 | `packages/license/src/index.ts:103-107` | 信任根由调用方决定，商业信任模型不成立 |
| DOCX/PDF 只接收 raw entitlement | `packages/docx/src/types.ts:272-290`、`packages/pdf/src/types.ts:80-89` | 业务调用方必须搬运授权 claims |
| worker 直接传递 entitlement | `packages/docx/src/worker.ts:189-193`、`packages/pdf/src/worker-api.ts:68-88` | 消息面过宽，且继续依赖默认测试信任根 |
| worker request 复用普通 runtime options | `packages/docx/src/types.ts:422-443`、`packages/pdf/src/types.ts:80-88,127-132` | `AbortSignal`、callback 与授权对象混入 structured-clone DTO |
| collab client 要求 license、features、validation | `packages/collab/src/client-types.ts:76-87` | 客户端可以声明要检查的 feature 和信任配置 |
| history 每次发送完整 entitlement | `packages/collab/src/client-history.ts:427-433` | token/claims 进入网络、代理和日志面 |
| server licenseHook 混入 document/tenant/entitlement | `packages/collab-server/src/index.ts:81-97` | 商业授权、资源权限和请求 metadata 混在同一 seam |
| HTTP entitlement parser 丢字段 | `packages/collab-server/src/http-utils.ts:51-113` | 服务端无法复用完整 JWL1 验签语义 |
| 当前 Hocuspocus 默认角色不是开放写入 | `packages/collab-server/src/hocuspocus-server.ts:286-320` | 与本期 `open/write` 产品口径不一致 |
| offline handle/IndexedDB 完全在浏览器本地 | `packages/collab/src/client-history.ts:175-195`、`packages/persistence/src/indexeddb-adapter.ts:66` | 服务端无法把 offline 当作可权威执行的独立 feature |
| 本地 auto-insert 最终只是普通本地 Yjs update | `packages/collab/src/client-sdk.ts:269-282,363-540` | 服务端不能从 update 判断它是否来自 auto-insert；只能保护 relay API |

当前全项目风险背景参见 [全项目审查](reviews/2026-07-10-full-review/README.md) 和 [协作、安全与授权审查](reviews/2026-07-10-full-review/04-collaboration-security-and-licensing.md)。

## 4. 目标模块与信任模型

### 4.1 三条独立链路

```text
JWord 受控签发环境
  └─ 使用 JWord 私钥签发 JWL2
       └─ 一级 OEM 客户取得签名 token
            ├─ 浏览器/桌面宿主激活 token → 本地高级格式
            └─ 协作服务端激活 token → 服务端高级能力

终端用户
  └─ 一级客户的部署准入凭证
       └─ 协作服务端 admission
            └─ V1 内部文档裁决恒定 write
                 └─ 进入文档与协作数据面
```

这三条链路不能互相推导：

- OEM license 有效，不代表任意互联网用户都可以使用协作服务。
- 用户通过部署准入，不代表 OEM 已购买 history 或 auto-insert。
- 用户可以写文档，不代表他是 licensee 或收费主体。

### 4.2 深模块设计

#### License module

外部 interface 只暴露 token 激活、只读 handle、feature 判断和稳定诊断。JWL2 解析、规范化、验签、可信 key 选择、时间校验、JWL1 迁移和错误归一全部留在实现内部。删除该 module 后，这些复杂度会重新散落到 DOCX、PDF、worker 和协作调用点，因此它具备足够 depth。

#### Collaboration deployment module

协作服务端启动时绑定一个已激活的 OEM license。HTTP、WebSocket、history 和 auto-insert relay 复用同一个内部 license context，不再从浏览器接收 entitlement。服务端 module 自己知道每个操作所需 feature。

#### Document access module

在服务端内部保留唯一 `authorizeDocumentAccess(...)` policy seam，V1 恒定返回 `write`。当前没有第二种真实策略，因此不发布 `DocumentAccessPolicy` 公共 interface，也不称其为 adapter；等未来出现 ACL 实现后，再以版本化公共 adapter 扩展 collab-server interface。商业 license schema 可保持不变，但不能承诺未来 collab-server 公共 API 完全无变化。

## 5. 收费能力矩阵

### 5.1 稳定 feature catalog

保留现有字符串值，避免许可证和日志无谓迁移；把带 Gate 阶段词的常量改为客户语义名称：

```ts
export const JWORD_FEATURES = {
  docxImport: 'docx.import',
  docxExport: 'docx.export',
  pdfExport: 'pdf.export',
  collaborationMultiplayer: 'collaboration.multiplayer',
  collaborationHistory: 'collaboration.history',
  collaborationServer: 'collaboration.server',
  automationAutoInsertRelay: 'automation.autoInsert'
} as const

export type JWordFeature =
  typeof JWORD_FEATURES[keyof typeof JWORD_FEATURES]
```

`collaboration.offline` 不进入 JWL2 catalog，也不作为 V1 独立收费项：浏览器本地队列和 IndexedDB 无法由协作服务端权威禁用。它作为 Collaboration Add-on 的配套能力，商业限制依赖 paid package 分发与合同，而不是运行时 DRM。`automation.autoInsert` 的 V1 语义收窄为“服务端 auto-insert relay API”；本地 `startAutoInsertSession()` 不在 WebSocket 服务端单独授权，因为普通 Yjs update 无法可靠证明写入来源。

`GATE5_FORMAT_FEATURES` 与 `GATE6_COLLAB_FEATURES` 仅在兼容窗口保留 deprecated alias，1.0 前删除；旧 `collaboration.offline` 不得被 JWL2 signer 接受。若 Phase 0 发现真实 JWL1 客户，迁移时把该权益映射为 Collaboration Add-on 的合同/分发权，不生成同名 JWL2 claim。

### 5.2 产品分层

| 产品层 | package/能力 | license 行为 |
| --- | --- | --- |
| Base SDK | core、ui、native、React/Vue wrapper、基础 diagnostics | 免费，不要求 token |
| Format Add-on | DOCX import/export、PDF export、对应 worker | 每个操作由 module 检查固定 feature |
| Collaboration Add-on | multiplayer、history、server、offline 配套能力、auto-insert 本地 helper | server/multiplayer/history 由服务端权威检查；offline 与本地 helper 依赖 paid package 分发和合同 |
| Automation Relay Add-on | 受控 auto-insert relay API | 服务端固定检查 `automation.autoInsert`；不把普通 Yjs update 宣称为可识别的 auto-insert write |
| Enterprise Governance | ACL、SSO/SCIM、可信审计、保留删除等 | 不在 V1，不进入当前 license claims |

Format、Collaboration 与 Automation Relay 可按合同组合。`collaboration.server` 是协作部署的基础 feature；multiplayer、history 和 relay 在 token 中分别启用。offline 与本地 auto-insert helper 不作为独立的服务端 feature。

## 6. JWL2 token 设计

### 6.1 Token 形态

继续使用简单的三段式离线签名格式：

```text
JWL2.<base64url(canonical-json-claims)>.<base64url(ed25519-signature)>
```

JWL2 不是 JWT，不接受 `alg` 动态选择，不允许调用方指定 verifier。算法在协议版本中固定为 Ed25519。

### 6.2 最小签名 claims

```ts
interface JWordLicenseClaimsV2 {
  readonly schemaVersion: 2
  readonly licenseId: string
  readonly oemCustomerId: string
  readonly issuer: string
  readonly keyId: string
  readonly features: readonly JWordFeature[]
  readonly issuedAt: string
  readonly expiresAt: string
}
```

字段语义：

| 字段 | 规则 |
| --- | --- |
| `licenseId` | 全局唯一，不复用；用于续期、支持与运营台账 |
| `oemCustomerId` | JWord 一级客户 ID，不是二级客户或用户 ID |
| `issuer` | 固定为 JWord 受控签发者标识 |
| `keyId` | 从内置可信 key set 选择公钥，支持轮换 |
| `features` | 只能包含已登记 feature；签发时去重并按字典序排序 |
| `issuedAt` | RFC 3339 UTC 时间；V1 同时作为最早生效时间 |
| `expiresAt` | 必填；必须晚于 `issuedAt`，且许可期限不得超过 Phase 0 冻结的最大签发期限 |

V1 不把以下字段放入 claims：

- 二级客户、终端用户、tenant、文档 ID 或角色。
- productId、hostname、deploymentId、environment。
- seatLimit、documentLimit、usage、MAU。
- `status`、`offlineGraceUntil` 或其它由调用方提供的运行状态。

### 6.3 Canonical JSON

签发器与 verifier 使用同一固定字段顺序；`features` 排序且去重。Verifier 直接验证 token 中原始 payload bytes；验签后重新生成 canonical bytes 并逐字节比较，不规范 JSON、未知字段、重复 key、错误字段顺序、重复或未排序 feature 均拒绝。签发工具与 runtime 即使分开实现，也必须共享固定 golden vector，避免 canonical codec 漂移。

协议资源上限在 JWL2 首次发布前冻结为常量并由 signer/verifier 同时执行：

| 项目 | V1 上限/规则 |
| --- | --- |
| 完整 token | 最多 16 KiB；必须是恰好三段、无空段 |
| payload | 解码后最多 8 KiB，必须是 UTF-8 JSON object |
| signature/public key | 分别严格为 64/32 bytes |
| base64url | 只接受无 padding 的规范 URL-safe 编码；拒绝空白和多余字符 |
| `licenseId`、`oemCustomerId` | 1-128 个 `[A-Za-z0-9._:-]` 字符 |
| `issuer`、`keyId` | 1-64 个 `[A-Za-z0-9._:-]` 字符 |
| `features` | 1-32 项；必须来自 catalog、唯一并按字典序排列 |
| 时间 | 只接受规范 UTC `YYYY-MM-DDTHH:mm:ss.sssZ` |

### 6.4 验证顺序

`activateJWordLicense()` 必须按以下顺序执行：

1. 校验 token 长度和三段结构。
2. 严格 base64url 解码 payload 与 64-byte signature，并执行 payload 上限。
3. 以拒绝重复 key 的方式读取 `schemaVersion`、`issuer`、`keyId`；这些未验签值只能作为固定 trust store 的查找 hint。
4. 按 `issuer + keyId` 选择 32-byte 公钥，未知值直接拒绝。
5. 使用固定 Ed25519 verifier 验证原始签名输入。
6. 严格解析完整 claims，拒绝未知字段、错误类型、空标识和 catalog 外 feature。
7. 重新生成 canonical payload 并与原始 payload bytes 比较。
8. 拒绝 `issuedAt > now + 5 分钟`、`expiresAt <= issuedAt` 或 `expiresAt <= now`。
9. 校验许可证期限未超过 Phase 0 冻结值，并生成只读 opaque handle。

运行时 feature 检查仍要重新判断 `expiresAt <= now`，避免服务进程在 license 到期后继续使用已经激活的 handle。V1 使用系统 wall clock，不承诺抵抗 OEM 宿主主动回拨时钟；这也是离线授权不能被宣传为 DRM 的原因。

### 6.5 生产 trust store

生产 trust store 是 license 实现内部常量，不从普通调用方 options 接收：

```ts
interface TrustedJWordLicenseKey {
  readonly issuer: string
  readonly keyId: string
  readonly publicKeyBase64Url: string
}
```

约束：

- runtime 同时保留当前 signing key 和尚有未过期 token 的 verify-only key；签发状态只存在于受控签发台账，不泄漏进 verifier interface。
- 未知 `issuer`、未知 `keyId` 或缺少 trust store 一律 fail closed。
- 仓库测试 key 不得进入生产 trust store、正式 export 或 npm tarball。
- 私钥只存在于 JWord 控制的 KMS/HSM 或隔离离线签发环境。
- 一级 OEM 只拿到签名 token，不拿到任何签发私钥。
- verify-only key 只有在它签发的最后一个 token 到期后才可从 runtime 移除；禁用仍有有效 token 的 key 属于整 key 紧急撤销，不是普通轮换。

测试不通过公开 `publicKey` option 注入信任根。Vitest 使用 test-only module replacement 把 `trust-store.ts` 替换为临时测试公钥，随后通过正式 public activation 路径验收；该 replacement、私钥与 signer 只位于 `packages/license/test/`，不进入 `src`、exports 或 tarball。受控发布环境另用当前 signing production key 签发短期 canary token，对正式 artifact 做一次激活 smoke；canary token 不提交仓库。

`packages/license/src/crypto.ts` 应迁移到成熟、经过独立审计的 Ed25519 实现；选定依赖前需核对当前最低浏览器、Node 和 worker 支持矩阵。若暂时保留自研实现，则不能进入收费 GA，除非取得独立密码学审计和标准向量/模糊测试证据。

## 7. 目标公开 interface

### 7.1 License interface

```ts
export type JWordLicenseToken = string

export interface JWordLicense {
  readonly licenseId: string
  readonly expiresAt: string
}

export function activateJWordLicense(
  token: JWordLicenseToken
): JWordLicense

export function assertJWordFeatureLicensed(
  license: JWordLicense | null | undefined,
  feature: JWordFeature
): void

export function isJWordFeatureLicensed(
  license: JWordLicense | null | undefined,
  feature: JWordFeature
): boolean
```

实现要求：

- `JWordLicense` 只暴露宿主确需显示的 `licenseId` 与 `expiresAt`；`oemCustomerId`、feature set、原始 token 和完整 claims 不公开。
- license module 使用模块私有 `WeakMap<object, InternalLicenseState>` 登记每个 handle；`Object.freeze()` 只保证表面不可变，不作为身份或安全边界。
- `assertJWordFeatureLicensed()` 与 `isJWordFeatureLicensed()` 必须先从私有 WeakMap 验证 identity，再读取私有 feature 与到期时间，不能信任调用方对象上的属性或方法。
- paid module 必须调用集中 assert，手工构造、类型断言、复制或 structured clone 得到的同形对象均以 `JWORD_LICENSE_HANDLE_INVALID` 拒绝。
- DOCX、PDF、collab-server 必须解析到同一份 `@4xian/jword-license` runtime；package/peer dependency 与第三方 tarball smoke 需要验证不存在重复 runtime identity。
- 错误只包含 code、feature、licenseId 和必要的恢复提示，不包含 token。

### 7.2 本地高级格式

```ts
const license = activateJWordLicense(oemLicenseToken)

await importDocx(file, { license })
await exportDocx(document, { license })
await exportPdfFromLayout(layout, { license })
```

每个 module 固定声明 feature：

| 入口 | 固定检查 |
| --- | --- |
| `importDocx()`、`inspectDocxPackage()`、`createDocxIndexes()` | `docx.import` |
| `exportDocx()` | `docx.export` |
| `exportPdfFromLayout()` | `pdf.export` |

主线程入口的检查必须发生在解析或消费输入 bytes、layout、ZIP、字体/图片以及创建输出之前；纯参数引用不算内容消费。worker 的更精确边界按第 7.3 节执行。

### 7.3 Worker transport

Opaque handle 不直接 structured clone。低层 worker protocol 可使用一个仅承载原始签名 token 的 advanced transport：

```ts
export interface JWordLicenseTransfer {
  readonly token: JWordLicenseToken
}

export function createJWordLicenseTransfer(
  license: JWordLicense
): JWordLicenseTransfer
```

规则：

1. `createJWordLicenseTransfer()` 先验证 handle 的 WeakMap identity，再从私有状态读取 token；不提供公开 token getter。
2. DOCX/PDF 分别新增 package-level `createDocxWorkerClient()`、`createPdfWorkerClient()` 高层 helper；helper 接收 handle、在主线程 assert，失败时不得调用 `postMessage()`。
3. DOCX/PDF worker request 使用独立纯 structured-clone DTO；不得复用含 callback、`AbortSignal` 或普通 runtime options 的公开 options。callback 留在主线程，progress/warning/error 由 response 映射；取消继续使用现有独立 cancel message。
4. 低层 advanced request 只携带 `JWordLicenseTransfer`，不携带平行 claims。消息可能已经跨线程，但 worker 必须在解析 ZIP、遍历 layout、加载字体/图片或创建输出前重新激活 token。
5. worker 只返回裁剪后的诊断，不回显 token、transfer 或原始异常 metadata。
6. 若未来要求“文档内容在验签成功后才跨线程”，需要两阶段 handshake；V1 不引入这层复杂度。

原始 token 不是终端用户认证凭证，但属于敏感 bearer license material；不得进入日志、URL、diagnostics、异常或 support bundle。

### 7.4 当前第二批：单 Host EditorShell

项目当前执行顺序已经冻结为：第一批先恢复根 `pnpm typecheck`，第二批实现单 Host `EditorShell`，之后进入 License 深模块。该顺序是开发批次顺序，不改变“任何收费 PoC 前必须完成 License Phase 1”的安全退出条件。

默认基础集成只传一个根元素：

```ts
const jword = createJWord({
  host: document.querySelector('#jword')!
})
```

`JWordEditorShell` 内部完成 `createEditor -> mount -> createJWordUi`，把调用方提供的专用空 `host` 直接作为 shell 容器，默认创建上方 toolbar、中间 editor、下方 status bar，不额外增加无行为价值的 wrapper；同时统一 dropdown、dialog、常规 panel、a11y 和 `destroy()`。除 `host` 外，基础编辑不要求调用方提供任何挂载位置；comments、outline、fullscreen 等外置位置只作为可选高级 `slots`。低层 `createEditor() + createJWordUi()` 继续作为 advanced interface。

基础编辑免费，因此最小调用不要求 license。付费格式能力需要时，调用方先激活 JWL2，再通过可选 `license` 交给 shell，由 shell 向格式 adapter 传递同一 WeakMap-branded handle；协作 license 仍只由服务端 deployment 持有，浏览器 shell 不接收或转发协作 entitlement。

EditorShell 复用现有自动 toolbar/status bar mount，不重写对应 controller。默认内部布局使用纵向 flex，不使用 grid 或 `gap`。构造中任一步失败时反序释放已创建资源，返回 handle 的 `destroy()` 必须幂等。

## 8. 协作授权改造

### 8.1 服务端持有部署 license

定义 HTTP 与 WebSocket 共用的 deployment admission port：

```ts
export interface JWordCollabAdmission {
  admit(input: {
    readonly requestId: string
    readonly transport: 'http' | 'websocket'
    readonly credential?: string
  }): Promise<
    | { readonly allow: true; readonly actorId: string }
    | { readonly allow: false; readonly diagnosticCode: string }
  >
}
```

server adapter 负责从 HTTP `Authorization` header 或 WebSocket auth token 提取 credential；cookie 认证由 OEM 反向代理先转换，不把 Node `IncomingMessage`、header map 或 cookie 泄漏给 admission port。成功的 `actorId` 进入统一 request context，并贯穿 document access、history author 与 relay；请求 body 中的 user/author 字段不能覆盖它。

同进程目标配置使用一个 deployment-level deep module：

```ts
const license = activateJWordLicense(readOemLicenseToken())

const deployment = createJWordCollabDeployment({
  license,
  admission
})

const httpServer = deployment.createHttpServer({ historyStorage })
const webSocketServer = deployment.createWebSocketServer()
```

V1 约束：

- 同进程 HTTP 与 WebSocket 从同一个 immutable deployment context 取得 license 与 admission，不允许两个独立 factory 各自传 license。
- 分进程部署时两个进程分别激活同一 license identity；readiness 暴露不可逆 license fingerprint，部署检查确认一致。不得通过进程全局 singleton 强制。
- 一个 deployment/data-plane instance 不得混用多个 OEM license；同进程的两个彼此隔离 deployment 对象不受此限制。
- factory 只做纯配置校验；`start()` 必须在绑定端口前检查已激活 handle 与 `collaboration.server`，失败时不监听。保留 `/health` 作为 liveness，新增 `/ready`；运行中到期后 liveness 仍成功、readiness 返回 503。
- `/version` 返回的 capabilities 是“license features 与部署显式开关的交集”，部署配置只能关闭 feature，不能扩权。
- history、auto-insert relay 和每次 WebSocket connect/write 在访问数据前按第 8.3 节矩阵检查固定 feature。
- license 到期后，新连接与新高级操作被拒绝；已有连接下一次写入时被拒绝并进入只读/断开策略。

### 8.2 删除客户端 entitlement

目标 `ConnectJWordCollaborationOptions`：

```ts
export interface ConnectJWordCollaborationOptions {
  readonly serverUrl: string
  readonly documentId: string
  readonly roomId: string
  readonly user: JWordCollaborationUser
  readonly credential: string
  readonly provider?: JWordCollabProviderAdapter
  readonly minimumServerVersion?: string
  readonly clientPackageVersion?: string
}
```

删除：

- `license`
- `features`
- `licenseValidation`
- `x-jword-entitlement` header、query 和 body 字段

客户端能力判断由 module 自己完成：

- connect 固定要求服务端 capability `collaboration.multiplayer`。
- history handle 调用时要求 `collaboration.history`。
- offline handle 是 Collaboration Add-on 配套的本地能力，不由服务端 capability 开关。
- 调用服务端 auto-insert relay 时要求 `automation.autoInsert`；本地 auto-insert helper 不作该检查。

这些客户端判断只用于清晰 UX；服务端仍是协作高级能力的权威 enforcement。

### 8.3 服务端 enforcement 顺序

每个受保护操作使用同一顺序：

```text
TLS / reverse proxy
→ deployment admission
→ 得到 actor/principal
→ authorizeDocumentAccess（V1 恒定 write）
→ assertJWordFeatureLicensed（操作固定 feature）
→ storage / Yjs / history / relay
```

任何拒绝都必须发生在读取 history、snapshot、正文 update 或 auto-insert chunk 之前。

唯一权威 feature—操作—执行位置矩阵如下；`/version` capability、server 实现、测试和产品文档必须引用本表，不各自解释：

| 操作/能力 | 必需 feature | 执行位置 | V1 强制性质 |
| --- | --- | --- | --- |
| server `start()` / `/ready` | `collaboration.server` | collab-server | 服务端权威 |
| WebSocket connect / update | `collaboration.server` + `collaboration.multiplayer` | collab-server | 服务端权威 |
| history list/record/preview | `collaboration.server` + `collaboration.history` | collab-server | 服务端权威 |
| auto-insert relay API | `collaboration.server` + `automation.autoInsert` | collab-server | 服务端权威 |
| offline handle / IndexedDB cache | 无独立 JWL2 feature | 浏览器 paid package | 分发与合同，不是 DRM |
| 本地 `startAutoInsertSession()` | 无独立服务端检查 | 浏览器 paid package | 分发与合同；普通 Yjs update 不标记来源 |

服务端不尝试从 Yjs update 猜测 auto-insert 来源。客户端 capability 只用于清晰 UX，服务端独立执行表中的全部组合检查。

### 8.4 部署准入不是文档权限

即使文档访问全部开放，也不能默认把服务暴露给整个互联网。V1 必须配置 deployment admission：

- OEM 签发的 bearer/session credential；或
- 私有网络部署中由反向代理换取的固定部署 credential。

admission 只防止外部盗用协作计算和存储资源，不判断用户对具体文档的角色。客户端 `user` 中的 name、color、avatar 只用于 presence 展示；history author ID 必须来自 admission 结果，不能由请求 body 覆盖。若 OEM 选择一个共享 credential，admission 仍需产生稳定的部署级 actorId，并在文档中明确“无法区分终端作者、无可信作者审计”的限制。

## 9. V1 开放文档访问

### 9.1 内部 interface

在 `packages/collab-server/src/document-access.ts` 建立唯一内部调用点：

```ts
interface AuthorizeDocumentAccessInput {
  readonly actorId: string
  readonly documentId: string
  readonly action: 'read' | 'write'
}

function authorizeDocumentAccess(
  input: AuthorizeDocumentAccessInput
): 'write'
```

V1 实现只返回：

```ts
return 'write'
```

`actorId` 必须来自 admission context；`action` 是内部 contract/audit 标签，不参与 V1 分支。通过最小 contract test 锁定 `actorId/documentId/action` 的传递，避免将来接 ACL 时重新从请求 body 推导 principal。

### 9.2 调用位置

必须覆盖：

- WebSocket connect。
- WebSocket update/write。
- history list。
- history record。
- history preview/read；当前 client restore 复用 preview 后在本地应用 update，服务端不存在 restore route。
- auto-insert relay。

### 9.3 不发布策略 adapter 的原因

目前只有恒定 write 一种实现。为了测试而发布 `DocumentAccessPolicy` 会形成浅 module 和虚假扩展点。等出现第二种真实策略，例如 OEM ACL adapter，再以协议版本升级把内部 seam 提升为公共 interface。

未来提升不需要改变 license claims，商业授权与文档访问继续保持正交；但 collab-server options、request context 和协议版本可能需要兼容扩展。

## 10. Package 与文件改造清单

### 10.1 `packages/license`

| 文件 | 改造 |
| --- | --- |
| `src/index.ts` | 收敛为稳定 re-export；删除测试 signer、raw entitlement 和调用方公钥 options |
| `src/features.ts`（新增） | `JWORD_FEATURES` 与 `JWordFeature` |
| `src/license.ts`（新增） | 实现 handle、`activateJWordLicense()`、`assertJWordFeatureLicensed()`、worker transfer |
| `src/jwl2.ts`（新增） | token 解析、schema 校验、canonical payload 和签名输入 |
| `src/trust-store.ts`（新增） | 内置生产 `issuer + keyId` trust set；不导出修改入口 |
| `src/errors.ts`（新增） | 稳定错误、metadata 和无敏感信息诊断 |
| `src/legacy-jwl1.ts`（条件新增） | 仅在确认存在真实 JWL1 客户后保留；不得使用测试默认 key |
| `src/crypto.ts` | 替换为成熟 Ed25519 adapter，或在审计完成前阻断 GA |
| `test/*` | test-only trust replacement、临时 key、golden vector；覆盖 JWL2、handle identity、时间、feature 和旧版迁移 |
| `package.json` | 增加选定密码依赖；确保正式 exports 不含 testing |

新文件继续遵守仓库中文头部说明和方法上方中文注释要求。`index.ts` 不再承担完整 codec 实现。

### 10.2 `packages/docx`

| 文件 | 改造 |
| --- | --- |
| `src/types.ts` | `license?: JWordLicense`；worker request 改为独立纯 structured-clone DTO 与 `JWordLicenseTransfer` |
| `src/import.ts` | 在读取 package 前检查 `docx.import` |
| `src/package.ts` | inspect/index 固定检查 `docx.import` |
| `src/export.ts` | 在读取 projection/opaque 内容前检查 `docx.export` |
| `src/worker.ts` | worker 内重新激活 transfer；删除 raw entitlement |
| `src/messages.ts`（新增） | 增加最小 worker request/response DTO；不复用 callback、`AbortSignal` 或 runtime options |
| `src/worker-client.ts`（新增） | `createDocxWorkerClient()` 高层 helper；主线程检查失败时不 dispatch |
| `src/plugin-adapter.ts` | 删除 `unknown as JWordLicenseEntitlement`，传递真实 handle |
| `test/public-api-license.test.ts` | 用 JWL2 fixture/handle 覆盖 import/export |
| `test/worker.test.ts` | 覆盖有效、篡改和缺失 transfer |

### 10.3 `packages/pdf`

| 文件 | 改造 |
| --- | --- |
| `src/types.ts` | `license?: JWordLicense`；worker request 改为独立纯 structured-clone DTO 与 transfer |
| `src/index.ts` | 固定检查 `pdf.export`，并保证检查早于字体/图片读取 |
| `src/worker-api.ts` | worker 内激活 transfer，不再验证 entitlement 对象 |
| `src/worker-client.ts`（新增） | `createPdfWorkerClient()` 高层 helper；主线程检查失败时不 dispatch |
| `src/plugin-adapter.ts` | 删除不安全类型断言，传递 handle |
| `test/public-api-license.test.ts` | 覆盖 JWL2 handle |
| `test/worker.test.ts` | 覆盖 worker 独立验签和错误裁剪 |

### 10.4 `packages/collab`

| 文件 | 改造 |
| --- | --- |
| `src/client-types.ts` | 从 connect options 删除 license/features/licenseValidation |
| `src/client-sdk.ts` | 删除 raw entitlement；server-backed capability 用于 UX；offline 与本地 auto-insert 不伪装成服务端 enforcement |
| `src/client-history.ts` | 删除 `x-jword-entitlement`；只发送 admission credential 与文档 metadata |
| `src/index.ts` | deprecate/remove `createJWordCollabFeatureGate` 和 Gate 常量别名 |
| `src/client-diagnostics.ts` | 保留服务端 license denial 到 collab diagnostic 的映射 |
| `test/public-client.test.ts` | 证明客户端不能自报 feature 或公钥 |
| `test/client-history-base64.test.ts` | 证明请求不携带 entitlement/token claims |

### 10.5 `packages/collab-server`

| 文件 | 改造 |
| --- | --- |
| `src/index.ts` | 新增 deployment-level factory；server options 不再各自接收 license，删除 document/tenant entitlement `licenseHook` |
| `src/deployment.ts`（新增） | immutable license/admission context，装配同进程 HTTP 与 WebSocket server |
| `src/license-context.ts`（新增） | 内部 feature enforcement、capability 交集和不可逆 license fingerprint |
| `src/health-routes.ts`（新增） | 区分 `/health` liveness 与 `/ready` readiness；到期后 readiness 503 |
| `src/document-access.ts`（新增） | V1 恒定 write 的内部 policy seam |
| `src/request-guards.ts` | 把 auth 语义收敛为 deployment admission port，并产出共享 request context/actor ID |
| `src/http-utils.ts` | 删除 entitlement URL/header/parser 和 CORS header；token 不进入 URL |
| `src/history-routes.ts` | admission → open/write → history feature → storage |
| `src/auto-insert-relay.ts` | admission → open/write → server + autoInsert feature → relay；不声称保护本地 inserter |
| `src/hocuspocus-server.ts` | 使用部署 license；成功 admission 后 V1 role 固定 write |
| `Dockerfile` | 删除 allow-all licenseHook；从只读 secret/file 读取 token；缺失时 `/ready` 返回 503 |
| `README.md` | 记录单 OEM/实例、documentId 唯一、开放写入和安全边界 |
| `test/*` | 覆盖启动、到期、feature、open/write 和无客户端 entitlement |

当前 `tenantId`/`tenantHook` 不应继续被描述为完整多租户能力。因为仓库尚为 `0.0.0/private`，推荐在本次协议升级中直接删除；若确认已有外部集成，则仅保留一个 deprecated 兼容窗口，并要求 `documentId` 在整个部署内唯一。

### 10.6 工具、示例和文档

| 文件 | 改造 |
| --- | --- |
| `tools/license/issue-license.mjs` | 只签 JWL2；严格校验日期、期限、feature、issuer、keyId，并与 runtime golden vector 锁定 |
| `tools/license/verify-license.mjs`（新增） | 离线验签/裁剪检查工具，不输出 token |
| `fixtures/license/*` | 固定测试 token/key；测试私钥不被正式 package 接受 |
| `examples/docx/src/main.ts` | 用 demo 专用 JWL2 激活流程，不从生产根入口签发 |
| `examples/collab/*` | server 持有 license；client 不再传 entitlement/features |
| `docs/sdk/licensing.md` | OEM 口径、JWL2、feature matrix、错误码和限制 |
| `docs/sdk/advanced-formats.md` | handle 与 worker transfer 接入 |
| `docs/sdk/collaboration.md` | 删除浏览器 entitlement 示例 |
| `docs/sdk/collab-server.md` | 部署 license、admission、open/write、单实例约束 |
| `tests/types/*` | 锁定新公开 interface、admission port 和 deprecated 窗口 |
| `tools/release/check-gate5-commercial-pack.mjs` | 禁止测试 signer、私钥、fixture key 进入产物 |
| `tools/release/check-gate6-commercial-pack.mjs` | 同上，并检查 server 不含 allow-all preset |

## 11. 分阶段实施任务

### 项目级前置批次

本节 Phase 0 至 Phase 5 描述 OEM 授权工作流；在进入 Phase 1 代码迁移前，项目先执行两个小批次：

1. 修复根 `pnpm typecheck` 中 vanilla demo hook 可选性错误，并以同一命令验证退出 0。
2. 实现第 7.4 节单 Host EditorShell，更新 Quickstart 与默认 demo，并用最少测试锁定上中下结构、高级 slot 优先级、构造回滚和统一 destroy。

Phase 0 的商业与协议决策可与上述批次并行；Phase 1 仍是任何收费 PoC 前必须完成的安全阻断。

### Phase 0：冻结商业与协议输入

目标：避免代码完成后再修改收费口径。

任务：

- [ ] LIC-000 确认一级 OEM 是唯一 licensee，合同允许 compiled-product-only 下游交付。
- [ ] LIC-001 冻结 JWL2 七个 feature 字符串值，并确认 `collaboration.offline` 不进入 catalog、`automation.autoInsert` 仅代表 relay API。
- [ ] LIC-002 冻结所有 V1 收费 license 必填 `expiresAt`、最大签发期限、续期提前量；不签永久离线 token。
- [ ] LIC-003 盘点是否已向真实客户签发 JWL1；记录 licenseId、客户、key 和到期日，不记录私钥。
- [ ] LIC-004 确认生产 issuer、第一把 `keyId` 和受控签发环境。
- [ ] LIC-005 明确协作 V1 为一个实例/一个 OEM license、全部署 documentId 唯一。
- [ ] LIC-006 冻结 Base 的商业许可、OEM 嵌入/转售权，以及 paid package 的私有 registry/交付包策略；“免费”不自动等于可 OEM 转售。
- [ ] LIC-007 分别冻结 SaaS、私有化和离线交付形态；允许二级客户取得一级客户完整产品中不可分离的浏览器 runtime/worker asset，但禁止独立 SDK、源码、registry 凭证、开发权、提取复用和再次分发。
- [ ] LIC-008 冻结版本线、维护期、major upgrade、新 feature 与 L2/L3 支持权益；旧版本可运行不等于自动获得新 major 或新 feature。

退出标准：

- 商业、feature、有效期、交付形态、版本权益和部署口径写入审批记录。
- 若没有真实 JWL1 客户，批准直接 breaking cutover；若存在，生成明确的兼容截止日期。

### Phase 1：重建 License 深模块

依赖：Phase 0。

任务：

- [ ] LIC-100 先写最小红灯测试：仓库公开测试私钥签发的 token 在生产入口必须失败。
- [ ] LIC-101 拆分 feature、error、JWL2、trust store 和 handle 文件。
- [ ] LIC-102 实现 JWL2 parser、固定签名输入和严格 schema 校验。
- [ ] LIC-103 实现内置 `issuer + keyId` trust store，删除默认测试公钥回退。
- [ ] LIC-104 实现 WeakMap-branded opaque handle、集中 `is/assert` 和运行时时间检查。
- [ ] LIC-105 实现 identity-checked worker transfer；确保 token/claims 不进入 `toJSON`、structured clone、error 或日志。
- [ ] LIC-106 移除根入口测试 signer；测试签发移入 test-only support。
- [ ] LIC-107 替换/审计 Ed25519 实现并补标准向量。
- [ ] LIC-108 更新签发工具，只允许已登记 feature、规范 UTC 时间、固定期限和协议资源上限。
- [ ] LIC-109 增加新诊断并保留必要的旧 code 映射。
- [ ] LIC-110 建立 test-only trust replacement、临时 key 与 signer/runtime golden vector；正式 root export 不提供信任根注入。
- [ ] LIC-111 锁定单一 license runtime 依赖，增加重复 runtime/伪造 handle 的第三方消费验证。

退出标准：

- 缺失、篡改、未知 key、错误 issuer、不规范 payload、未来生效、过期、缺 feature 全部稳定拒绝。
- 正式入口不接受测试 trust root，也不能由调用方传入自己的公钥。
- license package tarball 不含私钥、测试 signer 或测试 trust store。

### Phase 2：迁移 DOCX、PDF 与 worker

依赖：Phase 1。

任务：

- [ ] LIC-200 把 DOCX/PDF options 从 entitlement 改为 handle。
- [ ] LIC-201 每个公开入口固定自己的 feature，不接受调用方 feature 参数。
- [ ] LIC-202 删除 plugin adapter 中的 raw license 类型断言。
- [ ] LIC-203 修改 DOCX worker request/dispatcher，worker 内独立激活。
- [ ] LIC-204 修改 PDF worker request/dispatcher，worker 内独立激活。
- [ ] LIC-205 为 DOCX/PDF 新增纯 structured-clone DTO 和 package-level worker client；callback 留主线程，取消走独立 cancel message。
- [ ] LIC-206 更新格式 demo、fixtures 和类型测试。
- [ ] LIC-207 增加“高层 helper 未授权不 dispatch；低层 worker 未授权不解析/遍历/加载/创建输出”的最小回归测试。

退出标准：

- 主线程和 worker 对同一 token 得到一致结果。
- 高层 helper 无授权时不发送内容；低层 advanced API 无授权时不解析 DOCX ZIP、不遍历 layout、不加载字体/图片、不创建输出。
- 调用方只传 handle/transfer，不再拼装 claims。

### Phase 3：迁移协作服务端、客户端与开放写入

依赖：Phase 1；可与 Phase 2 并行，但 server/client 需在同一协议版本合并。

任务：

- [ ] LIC-300 建立 deployment-level factory，接收一个 license 与 admission；HTTP/WS factory 不再各自接收 license。
- [ ] LIC-301 建立共享 immutable context；`start()` 在绑定端口前检查 `collaboration.server`，HTTP/WS/history/relay 复用；新增 `/ready` 并保留 `/health` liveness。
- [ ] LIC-302 删除客户端 entitlement header/query/body 和服务端 parser。
- [ ] LIC-303 从 connect options 删除 license/features/licenseValidation。
- [ ] LIC-304 服务端 capabilities 取 license 与部署开关交集，并逐项遵守第 8.3 节操作矩阵。
- [ ] LIC-305 实现统一 admission port、credential 提取和可信 request context；禁止 body 覆盖 history author。
- [ ] LIC-306 新增内部 `authorizeDocumentAccess()`，所有 action 恒定返回 write。
- [ ] LIC-307 WebSocket 成功 admission 后 role 固定 write；license 到期后的下一次写入被拒绝。
- [ ] LIC-308 删除或限时 deprecate tenant 传输字段，声明 documentId 全部署唯一。
- [ ] LIC-309 改造 Docker/启动示例，缺 license 时 production preset 不监听；运行中失效时 `/ready` 返回 503；production 不提供 allow-all preset。
- [ ] LIC-310 更新协作 diagnostics registry 和协议版本。
- [ ] LIC-311 删除 `collaboration.offline` 的运行时 feature gate；把本地 offline/auto-insert helper 的分发与合同边界写入 SDK 文档。

退出标准：

- 浏览器伪造 entitlement、公钥或 feature 列表不能解锁服务端能力。
- history 请求不包含 `x-jword-entitlement`。
- 两个通过 admission 的用户可以进入同一 documentId 并写入。
- 未通过 admission 的请求在数据读取前被拒绝。
- 缺少 history/auto-insert relay feature 时对应服务端 API 失败，普通 multiplayer、本地 offline 与本地 auto-insert helper 的技术行为不受其伪控制。

### Phase 4：JWL1 与公开 interface 迁移

依赖：Phase 1 至 Phase 3。

推荐路径：仓库当前为 `0.0.0/private`，若 Phase 0 未发现真实 JWL1 客户，直接删除生产 JWL1 支持，只在测试中保留拒绝用例。

若确有真实 JWL1 客户：

- [ ] LIC-400 增加内部 token dispatcher，JWL2 走生产 trust store。
- [ ] LIC-401 JWL1 只允许预登记 legacy issuer/key：未验签 issuer 仅作为固定 allowlist 的候选 key hint，验签成功前不信任任何 claim。
- [ ] LIC-402 deprecated overload 只提取 `signature ?? licenseToken`；customer/features 等全部以签名 payload 为准，并删除 `status: server-unavailable` 与 offline grace 语义。
- [ ] LIC-403 对 raw entitlement overload 标记 deprecated，保留一个明确版本窗口。
- [ ] LIC-404 新签发全部使用 JWL2；为有效 JWL1 客户重签。
- [ ] LIC-405 达到截止日期后删除 legacy parser、types 和测试 alias。

无论采用哪条路径，生产运行时都不得继续接受仓库测试公钥。

### Phase 5：商业发布、密钥与运营闭环

依赖：前四阶段完成，且全项目 P0 发布阻断另行关闭。

任务：

- [ ] LIC-500 建立签发台账：licenseId、OEM、features、issuedAt、expiresAt、keyId、token hash、审批人。
- [ ] LIC-501 私钥进入 KMS/HSM/离线环境，签发操作双人审批；仓库与 CI 不保存私钥。
- [ ] LIC-502 演练 signing → verify-only → removed 的 key rotation；只有最后一个有效 token 到期后才普通移除旧 key。
- [ ] LIC-503 定义续期提醒、到期行为和人工重签流程。
- [ ] LIC-504 定义紧急撤销边界：V1 不提供单 license 技术撤销；单 license 只能停止续期、制品与支持，只有 key compromise 才通过安全更新禁用整把 key。
- [ ] LIC-505 完成 OEM Agreement、下游 EULA 保护条款、LICENSE/NOTICE 和 package metadata。
- [ ] LIC-506 执行 Phase 0 冻结的 Base/paid package 分发策略；二级客户可取得完整产品中的不可分离 runtime，不得获得独立 SDK、registry credential、源码或签发工具。
- [ ] LIC-507 在干净 RC 上执行 tarball/no-alias/secret scan/第三方消费验证。

退出标准：

- 能从受控签发、OEM 接收、SDK 激活到服务端检查完成一次端到端演练。
- 完成一次 key rotation 和一次过期续期演练。
- 正式产物不含私钥、测试 signer、source map secret 或 allow-all production preset。
- 合同、产品文档和运行时行为对“免费、高级、开放写入、非 DRM”口径一致。

## 12. JWL1 迁移兼容表

| 当前 interface | 目标 | 兼容策略 |
| --- | --- | --- |
| `JWordLicenseEntitlement` | `JWordLicenseToken` + `JWordLicense` | 无真实客户则直接删除；否则 deprecated 一窗 |
| `assertJWordFeatureEntitled()` | `assertJWordFeatureLicensed()` | 旧 overload 内部激活，截止后删除 |
| `JWordLicenseValidationOptions.publicKeyBase64Url` | 无公开替代 | 立即删除，trust store 内置 |
| `allowInsecureFixtureLicense` | test-only support | 不进入正式 root export |
| `createInsecureTestOnlyJWordLicenseSignature()` | test support/固定 fixture | 从正式 package 移除 |
| `GATE5_FORMAT_FEATURES` | `JWORD_FEATURES` | deprecated alias |
| `GATE6_COLLAB_FEATURES` | `JWORD_FEATURES` | 可映射项保留 deprecated alias；旧 offline key 仅用于 JWL1 迁移识别，不进入 JWL2 |
| collab `license/features/licenseValidation` | server capabilities | client/server 同步协议迁移 |
| collab `token` | `credential` | admission credential 重命名，避免与 OEM license token 混用 |
| `x-jword-entitlement` | 无 | 删除，不提供兼容透传 |
| server `licenseHook` | 部署级 `license` | 若需刷新，未来另立真实 port |

不保留“旧 interface 包一层新 interface、旧实现仍然执行”的双栈。迁移窗口内只有一个 verifier 和一个 feature 判定实现，避免浅 wrapper 长期存在。

## 13. 最小测试矩阵

### 13.1 License unit

| 场景 | 预期 |
| --- | --- |
| test-only trust replacement + 完整 JWL2 | 正式 activation 路径成功 |
| 受控 production canary token + 正式 artifact | 发布环境 smoke 成功，不提交 token |
| 测试 key 走生产入口 | 拒绝 |
| payload/signature 任一字节变化 | `SIGNATURE_INVALID` |
| 未知 issuer/keyId | 稳定拒绝 |
| 非法 RFC 3339、未来 issuedAt、expiresAt 早于 issuedAt | 稳定拒绝 |
| 已过期 | `EXPIRED` |
| feature 缺失 | `FEATURE_NOT_ENTITLED` |
| 缺少 expiresAt | 严格拒绝 |
| 手工伪造 handle | assert 拒绝 |
| structured clone/copy handle | assert 拒绝且不泄漏 claims/token |
| 重复 JSON key、未知字段、非规范 base64url、错误长度/排序/上限 | 严格拒绝 |
| signer golden vector | runtime、worker 和 server 结果一致 |

### 13.2 Format integration

- DOCX import/export/PDF export 各保留一个成功用例。
- 三类入口各保留一个缺 feature 用例。
- DOCX/PDF worker 各保留一个有效 transfer 和一个篡改 transfer 用例。
- 使用 fake worker 证明高层 helper 无授权时不 dispatch；使用 spy 证明低层 worker 不解析/遍历/加载/创建输出。

### 13.3 Collaboration integration

- 缺失/过期/缺 `collaboration.server` 时 `start()` 在绑定端口前失败；运行中到期时 `/health` 成功、`/ready` 返回 503。
- server capabilities 不得超过 license claims。
- client connect 不再需要 license/features，admission credential 字段与 OEM license token 命名明确分离。
- history/relay 请求不存在 entitlement header、URL 和 body。
- admission 成功的两个 actor 对同一文档均获得 write。
- admission 失败时 storage 未被调用。
- 缺 history feature 不影响普通 multiplayer。
- 进程运行期间 license 到期后下一次高级操作失败。
- WS connect/update 必须同时满足 server + multiplayer；history/relay 必须满足第 8.3 节组合 feature。
- offline 与本地 auto-insert 不被服务端虚假 capability gate；relay 缺 feature 时独立拒绝。

### 13.4 Release/security

- package exports 不含 testing signer。
- `npm pack --json` 文件清单不含任何 private key/seed/test signer，也不含被生产 verifier 信任的测试公钥或 `src`/`test` 泄漏；正式 public trust set 必须存在。
- secret scan 不命中生产私钥。
- 本地 tarball 第三方项目完成正式 signer golden vector → activate → DOCX/PDF worker/collaboration smoke，并验证依赖图只有一份 license runtime。

测试数量按以上关键行为保持最少；不为每个内部 helper 重复写单测，主要通过 deep module interface 验证。

## 14. 验收命令

实施期间先运行 focused 命令：

```bash
pnpm --filter @4xian/jword-license typecheck
pnpm --filter @4xian/jword-license test

pnpm --filter @4xian/jword-docx typecheck
pnpm --filter @4xian/jword-docx test
pnpm --filter @4xian/jword-pdf typecheck
pnpm --filter @4xian/jword-pdf test

pnpm --filter @4xian/jword-collab typecheck
pnpm --filter @4xian/jword-collab test
pnpm --filter @4xian/jword-collab-server typecheck
pnpm --filter @4xian/jword-collab-server test

pnpm test:types
```

发布候选再运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
node tools/release/check-gate5-commercial-pack.mjs
node tools/release/check-gate6-commercial-pack.mjs
node tools/release/check-gate5-third-party-smoke.mjs
node tools/release/check-gate6-third-party-smoke.mjs
node tools/release/check-gate7-third-party-smoke.mjs
```

所有发布证据必须绑定同一干净 commit SHA 和同一 artifact hash。当前全项目审查中的 Quickstart、dist import、tarball 依赖、协作持久化等其它 P0 仍需独立关闭；仅完成本授权方案不等于整个产品达到企业 GA。

## 15. 诊断与可观测性

### 15.1 稳定诊断

建议保留/新增以下语义：

- `JWORD_LICENSE_MISSING`
- `JWORD_LICENSE_TOKEN_INVALID`
- `JWORD_LICENSE_SIGNATURE_INVALID`
- `JWORD_LICENSE_ISSUER_INVALID`
- `JWORD_LICENSE_KEY_UNKNOWN`
- `JWORD_LICENSE_NOT_YET_VALID`
- `JWORD_LICENSE_EXPIRED`
- `JWORD_FEATURE_NOT_ENTITLED`
- `JWORD_LICENSE_HANDLE_INVALID`

`JWORD_LICENSE_SERVER_UNAVAILABLE` 仅属于旧在线状态假象；JWL2 V1 纯离线验签不再产生该 code。

### 15.2 日志与指标

允许记录：

- requestId。
- 使用部署私有 observability key 计算的 licenseId HMAC 裁剪值；禁止普通 SHA-256。
- keyId。
- feature。
- valid/expired/not-entitled 等结果。
- 距到期天数的非负区间桶，例如 `0-1/2-7/8-30/31+`。

禁止记录：

- 完整 token、signature、Authorization、cookie。
- 私钥、测试 seed。
- 文档正文、DOCX bytes、Yjs update。
- 终端用户与 license 的计费关联。
- 展开 request、options、worker transfer、handle、原始异常对象或任意未知 metadata。

建议指标：

- `jword_license_check_total{feature,result}`。
- `jword_license_days_to_expiry`。
- `jword_collab_operation_denied_total{operation,reason}`。

licenseId、oemCustomerId 和 documentId 不作为指标 label，避免敏感信息与高基数。
admission denial 与 license denial 分开计数。统一 error/logger serializer 只接受 allowlist metadata；验证 `JSON.stringify(handle)`、`structuredClone(handle)`、worker error、日志与 support bundle 均不泄漏 token 或完整 claims。

## 16. 发布、轮换、续期与回滚

### 16.1 签发

1. 商务审批 OEM 与购买 features。
2. 签发工具生成 canonical JWL2。
3. 受控 signer 使用当前 signing key 签名。
4. 台账记录 claims 摘要、token hash 和审批人。
5. token 通过 secret manager/加密渠道交付一级 OEM。
6. 二级客户只获得一级客户编译产物，不获得 SDK 凭证或签发材料。

### 16.2 Key rotation

1. 在签发台账把 new key 标成 signing、old key 标成 verify-only，并发布同时信任两者的 SDK/server 版本。
2. 等 OEM 升级到该版本。
3. 新 token 改用 new key。
4. 等待 old key 签发的最后一个 token 到期。
5. 之后才发布移除 old key 的版本。
6. 停止使用 old signer，并保留审计记录。

若因 key compromise 在仍有有效 token 时禁用 old key，这是破坏性的整 key 撤销，会同时影响该 key 签发的所有许可证；必须有独立影响清单、客户通知和重签流程。

### 16.3 续期

- 年度 license 在到期前 30/14/7/1 天产生管理员提示。
- 新旧 token 允许短期部署重叠，但每个 token 自己仍按 `expiresAt` 判定。
- V1 不支持运行时热替换 token；续期通过更新 secret 后重启/滚动部署生效，并以 readiness 与 license fingerprint 验收。
- 基础 `.jword` 打开和编辑不因高级 license 到期而锁死，避免数据 hostage。
- 到期后只阻止高级操作或协作新写入，并给出可恢复诊断。
- 协作到期造成的本地未同步内容必须在 client diagnostics 中明确提示，不得显示为已保存。

### 16.4 撤销限制

V1 离线 token 无法即时撤销，也无法可靠阻止宿主修改浏览器 bundle 或回拨本地时间。对外必须明确：

- 浏览器本地 enforcement 是签名防篡改和误配置防护，不是 DRM。
- 强商业控制依赖 paid package 私有分发、协作服务端检查、合同与运营。
- V1 不提供按 `licenseId` 的技术 denylist；单许可证处理依赖停止续期、停止制品/registry/support 权限。
- 只有 signing key compromise 才通过安全更新禁用整把 key；删除 key 不能伪装成单许可证撤销。
- 需要实时撤销时再建设 V1.1 签名状态清单或 V2 在线 activation，不在本期暗中加入半成品网络校验。

### 16.5 回滚

- JWL2 rollout 前保留上一版 SDK artifact 和签发台账。
- 代码回滚不能重新启用测试默认公钥或 allow-all server hook。
- 如果新 verifier 误拒绝，回滚到仍使用生产 trust store 的上一候选版本，或重新签发 token。
- 数据格式未改变；license 回滚不得修改用户文档、history 或 Yjs state。

## 17. 商业与合同配套

机器 token 只表达高级 feature，不替代 OEM 合同。合同至少明确：

- 一级 OEM 是唯一 JWord licensee。
- 允许把 object code 嵌入一级客户完整产品并交付二级客户。
- 二级客户不能抽取、单独销售、再次分发 JWord SDK。
- 二级客户可以获得一级客户完整产品中不可分离的浏览器 runtime、worker 和其它 object-code asset；不得取得独立 SDK distribution、源码、registry 凭证、开发权、提取复用权或再次分发权。
- 不得共享私有 registry credential、签发工具或私钥。
- 基础版免费是价格分层，不等于未定义的开源或无限再授权。
- Base 的 OEM 嵌入/转售权、paid package 分发方式以及 SaaS/私有化/离线交付边界必须在 Phase 0 冻结。
- white-label、源码访问、额外产品线和支持等级另行约定；V1 不销售永久离线 token。
- 合同明确已交付版本运行权、维护期、major upgrade、新 feature 和 L2/L3 支持互不自动包含。
- 一级客户负责终端用户身份、文档访问、数据合规和 L1 支持；JWord 提供约定的 L2/L3 支持。
- DOCX 只承诺经过验证的兼容子集；协作未完成生产数据面前不承诺 HA/SLA。

## 18. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| OEM 控制浏览器代码，可 patch 本地检查 | 私有 paid package、服务端 enforcement、合同；禁止 DRM 宣传 |
| Opaque handle 可被结构伪造或跨 worker 不可克隆 | WeakMap identity + 单一 runtime；只传 identity-checked 签名 token transfer，worker 独立激活 |
| 多个模块各自实现 feature 检查 | 集中 `assertJWordFeatureLicensed()`，module 只声明固定 feature |
| Key rotation 要求 OEM 升级 | 提前发布双 key trust set，保留重叠窗口 |
| 年度离线 token 无法实时撤销或抵抗宿主回拨时钟 | 合同与制品控制；需要可信时间/实时撤销时再立项在线 activation |
| JWL1 兼容拖成长双栈 | Phase 0 盘点，明确截止版本；没有真实客户则直接删除 |
| open/write 被误解为匿名公开 | 文档区分 deployment admission 与 document ACL |
| 单实例承载多个 OEM 导致 license/数据混淆 | V1 明确一个实例一个 OEM；启动时禁止动态切换 |
| documentId 冲突 | OEM 在部署内保证全局唯一；日志和测试覆盖冲突诊断 |
| offline/本地 auto-insert 被误称为服务端可强制收费 | 从权威 feature 矩阵移除；以 paid package 分发与合同控制，relay 单独授权 |
| signer 与 verifier canonical codec 漂移 | 固定 golden vector，并让 release smoke 使用正式签发工具输出 |
| 只修 license 就误判可售 | 发布 gate 同时引用全项目 P0，不单独宣布企业 GA |

## 19. 禁止宣传与可准确宣传

完成本方案后仍不得宣称：

- 不可破解、防复制或 DRM。
- 实时在线激活/撤销。
- 永久离线许可证。
- 自动隔离二级客户。
- 企业级文档 ACL、可信作者审计、SSO/SCIM。
- 生产多租户协作、HA 或 SLA。
- 无损 Word roundtrip。

可以准确描述为：

> JWord 提供面向一级 OEM 客户的签名 feature 授权。基础编辑免费，高级格式和协作能力按 license feature 启用；协作服务端独立执行付费能力检查。V1 文档访问策略为通过部署准入后全部可写，不包含细粒度文档权限。

其中“协作服务端独立执行”仅适用于第 8.3 节明确列出的 server、multiplayer、history 与 auto-insert relay；浏览器 offline 和本地 auto-insert helper 属于 paid package 能力，不宣称为不可绕过的运行时 enforcement。

## 20. 后续演进触发条件

只有出现对应真实需求时再扩展：

| 触发条件 | 后续方案 |
| --- | --- |
| 需要限制部署数量 | 增加 deployment activation/台账，不用 hostname 猜测 |
| 需要实时吊销 | 签名状态清单或在线 license service |
| 需要多个 OEM 共用 JWord 云 | 引入 `licenseeId + documentId` scope 和多 license 路由 |
| 需要文档 ACL | 版本化提升内部 access seam，新增 OEM policy adapter 与 collab-server API；license schema 保持正交 |
| 需要可信审计 | admission 产出权威 principal，服务端写入不可篡改 audit event |
| 需要二级渠道继续转售 | 新商业模型和单独证书链设计，不复用本期 token |
| 需要按量计费 | 独立 metering/结算设计，不把 PII 塞入离线 token |

## 21. ADR 摘要

### Decision

采用 JWord 直接签发的有期限 JWL2 一级 OEM feature license；本地格式使用 WeakMap-branded opaque handle，协作服务端使用 deployment context；V1 文档访问内部恒定 write。

### Drivers

- 售卖对象只有一级 OEM。
- 基础免费、高级按功能收费。
- 不按用户或文档计量。
- 浏览器 SDK 无法形成不可绕过 DRM。
- 当前 interface 暴露过多 claims、信任配置和 host 责任。

### Alternatives considered

1. 一级客户委托证书链：否决。用户不要求 JWord 管理下游许可证，安全和运营复杂度不必要。
2. 通用 subject/customer hierarchy：否决。会提前引入二级客户、tenant 和 sublicense 模型。
3. 每请求发送 entitlement：否决。扩大泄漏面并把部署授权错误地下放到浏览器。
4. 立即公开 DocumentAccessPolicy：否决。V1 只有一个恒定策略，尚未形成真实 adapter seam。
5. 仅隐藏前端按钮：否决。不是收费 enforcement。

### Consequences

- public interface 显著收窄，调用方不再拼 claims 或选择公钥。
- 协作 client 与 server 需要一次协议级 breaking migration。
- V1 部署简单，但不支持一个服务实例承载多个 OEM。
- 离线 license 运维简单，但不能承诺即时撤销。
- 文档权限以后可以在不修改 OEM license schema 的前提下演进，但可能需要版本化扩展 collab-server 公共 adapter/interface。

### Follow-ups

- 项目代码先完成 typecheck 修复和单 Host EditorShell，再按 Phase 0 至 Phase 5 推进授权工作；Phase 0 商业决策可以并行。
- 与全项目审查 P0 发布、协作数据面和 DOCX 兼容整改并行管理。
- 在任何收费 PoC 前优先完成 Phase 1，并验证仓库测试私钥不再被生产入口接受。
