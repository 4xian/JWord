# 一级 OEM 功能授权与开放文档访问实施方案

> 文档状态：Phase 0 产品与技术输入已冻结；License Phase 1 尚未开始；正式发布仍等待法律审核
>
> 编写日期：2026-07-10
>
> 适用范围：`@4xian/jword-license`、DOCX/PDF 高级格式、协作客户端与协作服务端
>
> 基线：当前仓库仍为 `0.0.0`、所有 package 均为 `private: true`；本文描述目标方案，不代表这些能力已经完成或可以直接售卖。
>
> 决策来源：[OEM License Phase 0 商业与协议决策记录](oem-licensing-phase0-decision-record.md)。市场证据见[类 Word 编辑器商业模式调研与 JWord OEM 方案审查](word-editor-commercial-model-research-2026-07-14.md)。

## 1. 结论

Phase 0 已冻结 Licensee、SKU、期限、环境、交付权、首期范围和 JWL2 claims。固定生产信任根、测试密钥隔离、opaque handle、商业模块集中检查 feature 和服务端持有协作 license 是后续实现基线。本文不是合同或当前实现说明；`LIC-013` 仍为 `Deferred`，所以可以继续内部技术实施，但不能据此正式发布 npm package 或商业签约。

已批准方向是：

1. 每份标准授权面向一个一级 OEM 和一个 Named Product；二级客户只能取得完整产品中不可分离的 runtime。
2. Base 目标为免费、源码闭源的专有公开 npm 包；商业模块使用私有 npm，并同时执行 JWL2 runtime 校验。
3. 商业授权按年订阅，订阅结束后提供 15 天宽限期，最终到期后商业模块不可继续使用。
4. JWL2 只登记 `professional.editing`、`formats`、`collaboration` 三个模块级 feature；Commercial Full 在签发时展开，不成为额外 runtime feature。
5. 首期范围是 Base、Professional Editing 和 Formats；DOCX 先承诺经验证的受限兼容子集，Collaboration 及自动插入延后。
6. 商业授权与终端用户身份、文档访问和数据合规保持正交。

当前实现不能直接承载该售卖模式。`packages/license/src/index.ts:147` 内置的默认公钥对应仓库公开测试私钥，且 DOCX/PDF 默认调用路径无法配置正式信任根，任何持有仓库测试私钥的人都可以生成当前运行时接受的 token。修复该问题是所有收费 PoC 之前的 P0 阻断。

## 2. Phase 0 已批准基线

### 2.1 商业与技术范围

| 事项 | 已批准范围 |
| --- | --- |
| 许可证主体 | 一个一级 OEM + 一个 Named Product |
| 许可证粒度 | 模块级 `professional.editing`、`formats`、`collaboration`；Commercial Full 签发时展开 |
| Base | 免费、源码闭源的专有公开 npm 包，不要求 runtime token；最终法律文本等待 `LIC-013` |
| Professional Editing | 商业私有 npm 模块，固定检查 `professional.editing` |
| Formats | DOCX/PDF 商业私有 npm 模块，固定检查 `formats` |
| Collaboration | 延后销售；服务端持有 license，浏览器不提交 deployment entitlement；自动插入归入本模块 |
| 二级客户 | 只取得完整产品中不可分离 runtime，不取得独立 SDK、源码或 registry credential |
| 终端用户 | 只作为协作 actor/presence，不作为收费主体或 token subject |
| 文档权限 | deployment admission 成功后固定 `write`，不等于匿名公开 |
| 部署模型 | 一个协作 deployment instance 绑定一个一级 OEM license |
| 文档命名 | `documentId` 在 deployment 内唯一 |
| 计量与报价 | 一级 OEM + Named Product + 交付模式 + 已购模块 + 年度期限；不按用户、文档或 editor load 计量 |
| 环境 | `evaluation`、`nonProduction`、`production`、`disasterRecovery` 分开签发 |
| 有效期 | 按年订阅，15 天宽限；试用 30 天且无宽限；`expiresAt` 后商业模块不可使用 |
| 撤销 | V1 离线许可证不承诺实时撤销 |

### 2.2 已确认的安全边界

以下原则不依赖具体价格和 SKU，可以继续作为技术约束：

- 禁止由一级客户持有 JWord 根私钥、通用签发私钥或委托签发证书。
- 禁止把浏览器本地验签宣传为不可绕过的 DRM。
- 禁止把水印、品牌 DOM 恢复或 UI readonly 当作商业授权边界。
- 禁止把商业 license 当成终端用户身份、文档 ACL 或 tenant 隔离证明。
- 禁止在日志、指标或 support bundle 中记录完整 token、签名、正文或 Yjs update。
- 禁止让调用方注入生产公钥、verifier 或自行声明已购买 feature。

### 2.3 法律发布门禁

产品和技术输入以 [Phase 0 决策记录](oem-licensing-phase0-decision-record.md)为准。`LIC-013` 仍需法律审核 Base 专有许可证、OEM Agreement、下游条款、责任限制、价格和支持文案；审核关闭前允许内部 Phase 1–4 实施和发布演练，但禁止正式公开 Base npm、交付商业 package 或签署商业合同。

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

当前全项目风险背景参见 [当前全项目审查](reviews/current-full-review/README.md) 和 [安全与授权审查](reviews/current-full-review/02-security-and-licensing.md)。

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

## 5. Runtime 能力与 SKU

### 5.1 稳定 feature catalog

以下 catalog 已由 `LIC-001`、`LIC-010` 和 `LIC-012` 冻结。它只表达购买的商业模块，不把按钮、操作或服务端子能力变成价格项：

```ts
export const JWORD_FEATURES = {
  professionalEditing: 'professional.editing',
  formats: 'formats',
  collaboration: 'collaboration'
} as const

export type JWordFeature =
  typeof JWORD_FEATURES[keyof typeof JWORD_FEATURES]
```

Collaboration 内的 multiplayer、history、offline 和自动插入使用同一个 `collaboration` 模块授权；服务端依旧要在每个协作入口执行该模块检查，但不再区分 `collaboration.server`、`collaboration.history` 或 `automation.autoInsert` 等授权键。部署配置可以关闭某项能力，不能扩展 license 权限。

产品尚未发售且没有 JWL1 客户，`GATE5_FORMAT_FEATURES`、`GATE6_COLLAB_FEATURES` 和全部旧操作级 key 直接删除，不保留 deprecated alias 或 signer 映射。

### 5.2 SKU 映射

| 产品层 | package/能力 | license 与分发行为 |
| --- | --- | --- |
| Base | 基础 core、UI、native 和标准集成能力 | 公开 npm、免费、专有闭源；不要求 JWL2 |
| Professional Editing | 冻结后的高级编辑能力清单 | 私有 npm + 固定检查 `professional.editing` |
| Formats | DOCX import/export、PDF export、对应 worker | 私有 npm + 固定检查 `formats` |
| Collaboration | multiplayer、history、offline、server、自动插入 | 延后销售；私有 npm + 服务端固定检查 `collaboration` |
| Commercial Full | 当前全部商业模块的销售组合 | 签发时展开为模块 feature，不进入 catalog |
| 定制合同 | 定制功能、额外交付模式或未来独立模块 | 单独报价；不自动授予源码、白标或再次分发权 |
| Enterprise Governance | ACL、SSO/SCIM、可信审计、保留删除等 | 不在 V1，不进入当前 license claims |

首期只发布 Base、Professional Editing 和 Formats。Professional Editing 的具体能力清单必须在 Phase 2 开始前冻结到客户可见产品目录和 package 边界；清单调整不能新增操作级 license key。Collaboration 只有在生产数据面阶段退出后才能加入销售目录。

## 6. JWL2 token 设计

### 6.1 Token 形态

继续使用简单的三段式离线签名格式：

```text
JWL2.<base64url(canonical-json-claims)>.<base64url(ed25519-signature)>
```

JWL2 不是 JWT，不接受 `alg` 动态选择，不允许调用方指定 verifier。算法在协议版本中固定为 Ed25519。

### 6.2 最小签名 claims

以下 schema 已由 `LIC-002`、`LIC-009` 和 `LIC-012` 冻结。Named Product、OEM 客户、交付模式和部署数量由合同与签发台账执行，不进入本地 token：

```ts
type JWordLicenseClass =
  | 'evaluation'
  | 'nonProduction'
  | 'production'
  | 'disasterRecovery'

interface JWordLicenseClaimsV2 {
  readonly schemaVersion: 2
  readonly licenseId: string
  readonly issuer: string
  readonly keyId: string
  readonly licenseClass: JWordLicenseClass
  readonly features: readonly JWordFeature[]
  readonly issuedAt: string
  readonly subscriptionEndsAt?: string
  readonly expiresAt: string
}
```

字段语义：

| 字段 | 规则 |
| --- | --- |
| `licenseId` | 全局唯一，不复用；用于续期、支持与运营台账 |
| `issuer` | 固定为 `jword` |
| `keyId` | 首个生产值为 `jword-prod-2026-k1`；从内置可信 key set 选择公钥 |
| `licenseClass` | 只能是四个已登记环境类别之一；runtime 校验签名类别和类别期限，真实部署用途不由离线 token 自行识别 |
| `features` | 只能包含已登记模块 feature；签发时去重并按字典序排序 |
| `issuedAt` | RFC 3339 UTC 时间；V1 同时作为最早生效时间 |
| `subscriptionEndsAt` | 可选；记录付费订阅结束时间，不单独决定 runtime 是否可用 |
| `expiresAt` | 必填且晚于 `issuedAt`；年度订阅为订阅结束加 15 天，Evaluation 为 30 天且无宽限 |

二级客户、OEM 客户 ID、Named Product、交付模式、终端用户、tenant、文档 ID、角色和正文 usage 不进入本地 JWL2。获批环境类别只由签名 `licenseClass` 表达，不加入 `productId`、`deploymentId` 或计量字段。

`licenseClass` 的执行边界必须保持真实：签发器、审批和台账决定客户获得哪一类 token；runtime 严格拒绝未知类别并执行类别期限；Phase 3 的官方 production/disaster-recovery server preset 使用固定上下文拒绝类别不匹配的 token。浏览器 SDK 和离线 token 无法判断宿主实际运行在开发、试用还是生产环境，因此本地商业模块不接受宿主传入的“当前环境”作为权威输入，也不把该字段宣传为不可绕过的环境隔离。实际用途、Named Product 和部署范围仍由合同、制品访问、发布审批和签发台账执行。

调用方提供的 `status`、`offlineGraceUntil` 或其它未签名运行状态不进入 claims，也不能改变授权结论。

### 6.3 Canonical JSON

签发器与 verifier 使用同一固定字段顺序；`features` 排序且去重。Verifier 直接验证 token 中原始 payload bytes；验签后重新生成 canonical bytes 并逐字节比较，不规范 JSON、未知字段、重复 key、错误字段顺序、重复或未排序 feature 均拒绝。签发工具与 runtime 即使分开实现，也必须共享固定 golden vector，避免 canonical codec 漂移。

协议资源上限在 JWL2 首次发布前冻结为常量并由 signer/verifier 同时执行：

| 项目 | V1 上限/规则 |
| --- | --- |
| 完整 token | 最多 16 KiB；必须是恰好三段、无空段 |
| payload | 解码后最多 8 KiB，必须是 UTF-8 JSON object |
| signature/public key | 分别严格为 64/32 bytes |
| base64url | 只接受无 padding 的规范 URL-safe 编码；拒绝空白和多余字符 |
| `licenseId` | 1-128 个 `[A-Za-z0-9._:-]` 字符 |
| `issuer`、`keyId` | 1-64 个 `[A-Za-z0-9._:-]` 字符 |
| `licenseClass` | 必须来自固定四值 catalog |
| `features` | 1-3 项；必须来自 catalog、唯一并按字典序排列 |
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
8. 拒绝 `issuedAt > now + 5 分钟`、`expiresAt <= issuedAt`、`expiresAt <= now`，并校验可选 `subscriptionEndsAt` 的顺序和 license class 期限规则；不从浏览器或宿主自报信息推断真实部署环境。
9. 生成包含模块授权和期限状态的只读 opaque handle。

运行时 feature 检查每次都重新判断 `expiresAt`，避免进程在激活后无限期继续使用。15 天宽限已经由 signer 计入 `expiresAt`，runtime 不接受 `offlineGraceUntil` 或调用方提供的宽限状态。V1 使用系统 wall clock，不承诺抵抗 OEM 宿主主动回拨时钟；这也是离线授权不能被宣传为 DRM 的原因。

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
- verify-only key 只有在它签发的最后一个 `expiresAt` 过去后才可从 runtime 移除。禁用仍有有效授权的 key 属于整 key 紧急撤销，不是普通轮换。

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

- `JWordLicense` 只暴露宿主确需显示的 `licenseId` 与必填 `expiresAt`；license class、feature set、原始 token 和完整 claims 不公开。
- license module 使用模块私有 `WeakMap<object, InternalLicenseState>` 登记每个 handle；`Object.freeze()` 只保证表面不可变，不作为身份或安全边界。
- `assertJWordFeatureLicensed()` 与 `isJWordFeatureLicensed()` 必须先从私有 WeakMap 验证 identity，再读取私有 module feature 与期限状态，不能信任调用方对象上的属性或方法；固定 server preset 的 class 检查使用内部签名状态，不接受宿主自报 class。
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
| `importDocx()`、`inspectDocxPackage()`、`createDocxIndexes()` | `formats` |
| `exportDocx()` | `formats` |
| `exportPdfFromLayout()` | `formats` |

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

项目当前执行顺序已经冻结为：前两批工程基线与单 Host `EditorShell` 已完成，Phase 0 产品与技术输入也已冻结；License Phase 1 尚未开始。该顺序不改变“任何收费 PoC 前必须完成 License Phase 1”的安全退出条件。

默认基础集成只传一个根元素：

```ts
const jword = createJWord({
  host: document.querySelector('#jword')!
})
```

`JWordEditorShell` 内部完成 `createEditor -> mount -> createJWordUi`，把调用方提供的专用空 `host` 直接作为 shell 容器，默认创建上方 toolbar、中间 editor、下方 status bar，不额外增加无行为价值的 wrapper；同时统一 dropdown、dialog、常规 panel、a11y 和 `destroy()`。除 `host` 外，基础编辑不要求调用方提供任何挂载位置；comments、outline、fullscreen 等外置位置只作为可选高级 `slots`。低层 `createEditor() + createJWordUi()` 继续作为 advanced interface。

Base 当前不要求 runtime license，因此最小调用不传 license。目标法律口径是免费、专有闭源并允许按最终 EULA 集成；在 `LIC-013` 完成前仍不得正式发布或推导未写入法律文本的再分发权。需要授权的 Professional Editing 与 Formats 由调用方先激活 JWL2，再把同一 WeakMap-branded handle 交给对应商业模块；协作 license 仍只由服务端 deployment 持有，浏览器 shell 不接收或转发协作 entitlement。

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
- factory 只做纯配置校验；`start()` 必须在绑定端口前检查已激活 handle 与 `collaboration`，失败时不监听。保留 `/health` 作为 liveness，新增 `/ready`；运行中到期后 liveness 仍成功、readiness 返回 503。
- `/version` 返回的业务 capabilities 由部署显式开关决定，但前提是 `collaboration` 模块有效；部署配置只能关闭能力，不能扩权。
- history、自动插入 relay 和每次 WebSocket connect/write 在访问数据前都检查同一个 `collaboration` 模块授权。
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

- connect 只在服务端声明 multiplayer capability 时启用对应 UX。
- history handle 只在服务端声明 history capability 时启用对应 UX。
- offline handle 是 Collaboration 模块配套的本地能力，不伪装成独立 JWL2 feature。
- 自动插入归入 Collaboration；服务端 relay 由服务端 `collaboration` 授权保护，本地 helper 不从普通 Yjs update 中伪造独立 enforcement。

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

| 操作/能力 | 必需模块 feature | 执行位置 | V1 强制性质 |
| --- | --- | --- | --- |
| server `start()` / `/ready` | `collaboration` | collab-server | 服务端权威 |
| WebSocket connect / update | `collaboration` | collab-server | 服务端权威 |
| history list/record/preview | `collaboration` | collab-server | 服务端权威 |
| auto-insert relay API | `collaboration` | collab-server | 服务端权威 |
| offline handle / IndexedDB cache | 无额外 feature | 浏览器商业 package | 私有分发与合同，不是独立 DRM |
| 本地 `startAutoInsertSession()` | 无额外 feature | 浏览器商业 package | 归属 Collaboration；普通 Yjs update 不标记来源 |

服务端不尝试从 Yjs update 猜测自动插入来源。客户端 capability 只用于清晰 UX，服务端对全部受保护入口独立执行 `collaboration` 检查。

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

已批准的 V1 实现只返回：

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
| `src/features.ts`（新增） | 三个模块级 `JWORD_FEATURES` 与 `JWordFeature` |
| `src/license.ts`（新增） | 实现 handle、`activateJWordLicense()`、`assertJWordFeatureLicensed()`、worker transfer |
| `src/jwl2.ts`（新增） | token 解析、schema 校验、canonical payload 和签名输入 |
| `src/trust-store.ts`（新增） | 内置生产 `issuer + keyId` trust set；不导出修改入口 |
| `src/errors.ts`（新增） | 稳定错误、metadata 和无敏感信息诊断 |
| `src/crypto.ts` | 替换为成熟 Ed25519 adapter，或在审计完成前阻断 GA |
| `test/*` | test-only trust replacement、临时 key、golden vector；覆盖 JWL2、handle identity、时间、模块 feature 和 JWL1 拒绝 |
| `package.json` | 增加选定密码依赖；确保正式 exports 不含 testing |

新文件继续遵守仓库中文头部说明和方法上方中文注释要求。`index.ts` 不再承担完整 codec 实现。

### 10.2 `packages/docx`

| 文件 | 改造 |
| --- | --- |
| `src/types.ts` | `license?: JWordLicense`；worker request 改为独立纯 structured-clone DTO 与 `JWordLicenseTransfer` |
| `src/import.ts` | 在读取 package 前检查 `formats` |
| `src/package.ts` | inspect/index 固定检查 `formats` |
| `src/export.ts` | 在读取 projection/opaque 内容前检查 `formats` |
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
| `src/index.ts` | 固定检查 `formats`，并保证检查早于字体/图片读取 |
| `src/worker-api.ts` | worker 内激活 transfer，不再验证 entitlement 对象 |
| `src/worker-client.ts`（新增） | `createPdfWorkerClient()` 高层 helper；主线程检查失败时不 dispatch |
| `src/plugin-adapter.ts` | 删除不安全类型断言，传递 handle |
| `test/public-api-license.test.ts` | 覆盖 JWL2 handle |
| `test/worker.test.ts` | 覆盖 worker 独立验签和错误裁剪 |

### 10.4 `packages/collab`

| 文件 | 改造 |
| --- | --- |
| `src/client-types.ts` | 从 connect options 删除 license/features/licenseValidation |
| `src/client-sdk.ts` | 删除 raw entitlement；server-backed capability 用于 UX；offline 与本地自动插入不伪装成独立 enforcement |
| `src/client-history.ts` | 删除 `x-jword-entitlement`；只发送 admission credential 与文档 metadata |
| `src/index.ts` | 删除 `createJWordCollabFeatureGate`、旧操作级 feature 和 Gate 常量别名 |
| `src/client-diagnostics.ts` | 保留服务端 license denial 到 collab diagnostic 的映射 |
| `test/public-client.test.ts` | 证明客户端不能自报 feature 或公钥 |
| `test/client-history-base64.test.ts` | 证明请求不携带 entitlement/token claims |

### 10.5 `packages/collab-server`

| 文件 | 改造 |
| --- | --- |
| `src/index.ts` | 新增 deployment-level factory；server options 不再各自接收 license，删除 document/tenant entitlement `licenseHook` |
| `src/deployment.ts`（新增） | immutable license/admission context，装配同进程 HTTP 与 WebSocket server |
| `src/license-context.ts`（新增） | 内部 `collaboration` enforcement、部署 capability 和不可逆 license fingerprint |
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

当前 `tenantId`/`tenantHook` 不应继续被描述为完整多租户能力。产品尚未发售且没有外部兼容义务，本次协议升级直接删除，不保留 deprecated 窗口；`documentId` 在整个部署内唯一。

### 10.6 工具、示例和文档

| 文件 | 改造 |
| --- | --- |
| `tools/license/issue-license.mjs` | 只签 JWL2；严格校验模块、class、期限、`issuer=jword`、`keyId`，并与 runtime golden vector 锁定 |
| `tools/license/verify-license.mjs`（新增） | 离线验签/裁剪检查工具，不输出 token |
| `fixtures/license/*` | 固定测试 token/key；测试私钥不被正式 package 接受 |
| `examples/docx/src/main.ts` | 用 demo 专用 JWL2 激活流程，不从生产根入口签发 |
| `examples/collab/*` | server 持有 license；client 不再传 entitlement/features |
| `docs/sdk/licensing.md` | OEM 口径、JWL2、feature matrix、错误码和限制 |
| `docs/sdk/advanced-formats.md` | handle 与 worker transfer 接入 |
| `docs/sdk/collaboration.md` | 删除浏览器 entitlement 示例 |
| `docs/sdk/collab-server.md` | 部署 license、admission、open/write、单实例约束 |
| `tests/types/*` | 锁定新公开 interface、admission port 和旧 interface 已删除 |
| `tools/release/check-gate5-commercial-pack.mjs` | 禁止测试 signer、私钥、fixture key 进入产物 |
| `tools/release/check-gate6-commercial-pack.mjs` | 同上，并检查 server 不含 allow-all preset |

## 11. 分阶段实施任务

### 项目级前置批次

本节 Phase 0 至 Phase 5 描述 OEM 授权工作流；在进入 Phase 1 代码迁移前，项目先执行两个小批次：

1. 修复根 `pnpm typecheck` 中 vanilla demo hook 可选性错误，并以同一命令验证退出 0。
2. 实现第 7.4 节单 Host EditorShell，更新 Quickstart 与默认 demo，并用最少测试锁定上中下结构、高级 slot 优先级、构造回滚和统一 destroy。

项目级前置批次已经完成。Phase 0 产品与技术输入已关闭；本次只回写文档，Phase 1 尚未开始。Phase 1 仍是任何收费 PoC 前必须完成的安全阻断。

### Phase 0：冻结商业与协议输入

目标：先冻结源码私有性与分发方向、商业 SKU/报价以及 runtime enforcement 输入，避免代码完成后再修改收费口径或 token schema；最终许可证/EULA 文本继续由 `LIC-013` 法律审核关闭。

任务：

- [x] 在 [Phase 0 决策记录](oem-licensing-phase0-decision-record.md)中逐项关闭 `LIC-000` 至 `LIC-013` 的 `Open` 状态。
- [x] 区分已确认事实、产品批准决定和待法律审核项，不用市场调研替代法律审批。
- [x] 冻结模块级 SKU-feature、JWL2 claims、年度期限、环境类别和签发信任根。
- [x] 确认无真实 JWL1 客户，固定生产 `issuer=jword`、首个 `keyId=jword-prod-2026-k1` 和 KMS/HSM 优先的受控签发方向。

退出标准：

- `LIC-000` 至 `LIC-012` 为 `Approved`，`LIC-013` 为明确阻断外部发布与签约的 `Deferred`。
- 产品、feature、期限、环境、交付形态、版本权益和部署口径均有负责人、日期与确认记录。
- 无真实 JWL1 客户，批准直接 breaking cutover，不建立兼容窗口。
- OEM 方案、整改路线图和问题台账已同步批准结果；内部可进入 Phase 1，正式发布仍等待法律审核。

### Phase 1：重建 License 深模块

依赖：Phase 0。

任务：

- [ ] LIC-100 先写最小红灯测试：仓库公开测试私钥签发的 token 在生产入口必须失败。
- [ ] LIC-101 拆分 module feature、error、JWL2、trust store 和 handle 文件。
- [ ] LIC-102 实现 JWL2 parser、固定签名输入和严格 schema；只接受已批准最小 claims、四种 `licenseClass` 和三个模块 feature，并把 class 保存在不可伪造的内部状态中。
- [ ] LIC-103 实现内置 `issuer=jword`、首个 `keyId=jword-prod-2026-k1` 的 trust store，删除默认测试公钥回退。
- [ ] LIC-104 实现 WeakMap-branded opaque handle、集中 `is/assert` 和运行时时间检查；`expiresAt` 必填，15 天宽限只由 signer 编入时间。
- [ ] LIC-105 实现 identity-checked worker transfer；确保 token/claims 不进入 `toJSON`、structured clone、error 或日志。
- [ ] LIC-106 移除根入口测试 signer；测试签发移入 test-only support。
- [ ] LIC-107 替换/审计 Ed25519 实现并补标准向量。
- [ ] LIC-108 更新签发工具，只允许已登记模块、规范 UTC 时间、审批输入中的 class/期限和协议资源上限；试用固定 30 天无宽限，订阅 `expiresAt` 包含 15 天宽限。签发工具和台账负责环境授权事实，runtime 不接收宿主自报的真实环境。
- [ ] LIC-109 增加 JWL2 稳定诊断，删除 JWL1-only、server-unavailable 和调用方宽限状态 code，不保留对外兼容映射。
- [ ] LIC-110 建立 test-only trust replacement、临时 key 与 signer/runtime golden vector；正式 root export 不提供信任根注入。
- [ ] LIC-111 锁定单一 license runtime 依赖，增加重复 runtime/伪造 handle 的第三方消费验证。

退出标准：

- 缺失、篡改、未知 key、错误 issuer、不规范 payload、未知 class、未来生效、过期、缺模块 feature 全部稳定拒绝；runtime 不声称能识别浏览器宿主的真实环境。
- 正式入口不接受测试 trust root，也不能由调用方传入自己的公钥。
- license package tarball 不含私钥、测试 signer 或测试 trust store。

### Phase 2：迁移 Professional Editing、Formats 与 worker

依赖：Phase 1。

任务：

- [ ] LIC-200 先冻结 Professional Editing 客户可见能力清单和私有 package 边界；Base 公开包不得内嵌可直接启用的商业实现。
- [ ] LIC-201 Professional Editing 的公开入口固定检查 `professional.editing`，不接受调用方 feature 参数。
- [ ] LIC-202 把 DOCX/PDF options 从 entitlement 改为 handle，所有格式入口固定检查 `formats`。
- [ ] LIC-203 删除 plugin adapter 中的 raw license 类型断言。
- [ ] LIC-204 修改 DOCX worker request/dispatcher，worker 内独立激活。
- [ ] LIC-205 修改 PDF worker request/dispatcher，worker 内独立激活。
- [ ] LIC-206 为 DOCX/PDF 新增纯 structured-clone DTO 和 package-level worker client；callback 留主线程，取消走独立 cancel message。
- [ ] LIC-207 更新商业模块 demo、fixtures、类型测试和“未授权不 dispatch/不消费内容”的最小回归测试。
- [ ] LIC-208 增加 package 边界与 tarball 清单检查：Base 可公开安装，商业包只含编译产物且不含源码、构建脚本或 source map。

退出标准：

- Professional Editing、主线程格式入口和 worker 对同一 token 得到一致结果。
- 高层 helper 无授权时不发送内容；低层 advanced API 无授权时不解析 DOCX ZIP、不遍历 layout、不加载字体/图片、不创建输出。
- 调用方只传 handle/transfer，不再拼装 claims。
- Base tarball 不包含商业实现；商业 tarball 不包含 TypeScript 源码、仓库文件、构建脚本或 source map。

### Phase 3：迁移协作服务端、客户端与开放写入（非首期销售）

依赖：Phase 1；可与 Phase 2 并行，但 server/client 需在同一协议版本合并。

任务：

- [ ] LIC-300 建立 deployment-level factory，接收一个 license 与 admission；HTTP/WS factory 不再各自接收 license。
- [ ] LIC-301 建立共享 immutable context；`start()` 在绑定端口前检查 `collaboration`，HTTP/WS/history/自动插入 relay 复用；新增 `/ready` 并保留 `/health` liveness。
- [ ] LIC-302 删除客户端 entitlement header/query/body 和服务端 parser。
- [ ] LIC-303 从 connect options 删除 license/features/licenseValidation。
- [ ] LIC-304 `collaboration` 无效时全部协作能力 fail closed；有效时 capabilities 只由部署开关收窄，并遵守第 8.3 节矩阵。
- [ ] LIC-305 实现统一 admission port、credential 提取和可信 request context；禁止 body 覆盖 history author。
- [ ] LIC-306 新增内部 `authorizeDocumentAccess()`，所有 action 恒定返回 write。
- [ ] LIC-307 WebSocket 成功 admission 后 role 固定 write；license 到期后的下一次写入被拒绝。
- [ ] LIC-308 直接删除 tenant 传输字段和旧角色表面能力，声明 documentId 全部署唯一。
- [ ] LIC-309 改造 Docker/启动示例，缺 license 或签名 `licenseClass` 不是 `production` 时 production preset 不监听；disaster-recovery preset 同样固定要求 `disasterRecovery`。运行中失效时 `/ready` 返回 503；production 不提供 allow-all preset，也不接受宿主传入 class 覆盖 preset 上下文。
- [ ] LIC-310 更新协作 diagnostics registry 和协议版本。
- [ ] LIC-311 删除全部协作操作级 feature gate；offline、history、multiplayer、server 和自动插入统一归属 `collaboration`，并在 SDK 文档说明本地 helper 不是独立 DRM。

退出标准：

- 浏览器伪造 entitlement、公钥或 feature 列表不能解锁服务端能力。
- history 请求不包含 `x-jword-entitlement`。
- 两个通过 admission 的用户可以进入同一 documentId 并写入。
- 未通过 admission 的请求在数据读取前被拒绝。
- `collaboration` 缺失或过期时全部服务端协作入口失败；模块有效时，部署 capability 可以关闭 history 或自动插入，但不能产生新的授权。
- 该阶段技术完成也不自动进入首期销售；还必须完成生产数据面、备份恢复和独立销售批准。

### Phase 4：删除 JWL1 与旧公开 interface

依赖：Phase 1 和 Phase 2。若 Phase 3 已开始，协作调用方在同一协议批次更新；若 Phase 3 尚未开始，协作 packages 必须保持 private/unpublished，且不能保留可进入正式产物的 JWL1 接受路径。

已确认产品尚未发售且没有真实 JWL1 客户，不实现 dispatcher、deprecated overload 或兼容窗口：

- [ ] LIC-400 删除 JWL1 parser、raw entitlement types、旧 signer、公开 validation options 和旧 error/status 语义。
- [ ] LIC-401 删除 `GATE5_FORMAT_FEATURES`、`GATE6_COLLAB_FEATURES`、操作级 feature key 和全部 alias。
- [ ] LIC-402 更新仓库内所有调用方、示例、fixtures、类型测试和 SDK 文档，只保留 JWL2 handle/transfer；尚未实施 Phase 3 的协作代码可以暂不具备可用部署路径，但不得继续接受 JWL1。
- [ ] LIC-403 增加最小拒绝测试，证明 JWL1、仓库测试 key、旧 raw entitlement 和调用方公钥注入均不能进入生产路径。
- [ ] LIC-404 对未进入首期销售的 collaboration packages 保持 private/unpublished，直到 Phase 3 和生产数据面退出条件完成。

退出标准：正式 package export、tarball、文档和 workspace 生产代码中不存在 JWL1 接受路径或兼容 alias；生产运行时只接受 JWL2。未完成 Phase 3 的协作 packages 继续保持 private/unpublished。

### Phase 5：商业发布、密钥与运营闭环

依赖：首期 Base/Professional Editing/Formats 发布要求 Phase 1、Phase 2、Phase 4 完成，并另行关闭全项目 P0 发布阻断。Phase 3 不是首期发布依赖；只有把 Collaboration 加入销售目录时，才要求 Phase 3、生产协作数据面和对应全项目退出标准全部完成。

任务：

- [ ] LIC-500 建立签发台账：licenseId、一级 OEM、Named Product、交付模式、licenseClass、模块 features、issuedAt、subscriptionEndsAt、expiresAt、keyId、token hash、审批人。
- [ ] LIC-501 私钥进入 KMS/HSM/离线环境，签发操作双人审批；仓库与 CI 不保存私钥。
- [ ] LIC-502 演练 signing → verify-only → removed 的 key rotation；只有旧 key 不再承载任何有效授权后才普通移除。
- [ ] LIC-503 演练年度续期、15 天宽限和到期禁用；提醒节奏由运营 runbook 配置，不写死为协议字段。
- [ ] LIC-504 定义紧急撤销边界：V1 不提供单 license 技术撤销；单 license 只能停止续期、制品与支持，只有 key compromise 才通过安全更新禁用整把 key。
- [ ] LIC-505 完成 `LIC-013` 法律审核：Base 专有许可证/EULA、OEM Agreement、下游保护条款、责任限制、价格/支持文案和 package metadata；完成前发布命令必须 fail closed。
- [ ] LIC-506 执行 Base 公开 npm、商业模块私有 npm 的双层分发；商业包只交付编译产物，授权主体可内部镜像，但不得获得独立再分发权、registry credential、源码、source map 或签发工具。
- [ ] LIC-507 在干净 RC 上执行 tarball/no-alias/secret/source-map scan/第三方消费验证；先完成内部 rehearsal，法律批准后才执行真实 publish。
- [ ] LIC-508 验证订阅期内已购模块可使用后续版本和 major，新独立模块不自动进入旧 token；对外文案只承诺不定期维护更新，不包含 SLA 或修复保证。

退出标准：

- 首期能从受控签发、OEM 接收、SDK 激活到 Professional Editing/Formats 固定模块检查完成一次端到端演练；后续销售 Collaboration 时再追加服务端检查链路。
- 完成一次 key rotation，以及年度续期、15 天宽限和到期失效演练。
- 正式产物不含私钥、测试 signer、任何 source map 或 allow-all production preset。
- Base 公开包、商业私有包、合同、产品文档和运行时对模块、期限、源码私有性、开放写入和非 DRM 口径一致。
- `LIC-013` 已从 `Deferred` 变为 `Approved`；否则 Phase 5 只能标记为内部演练完成，不能标记正式发布完成。

## 12. JWL1 直接删除表

| 当前 interface | 目标 | 处理策略 |
| --- | --- | --- |
| `JWordLicenseEntitlement` | `JWordLicenseToken` + `JWordLicense` | 直接删除，不保留 overload |
| `assertJWordFeatureEntitled()` | `assertJWordFeatureLicensed()` | 直接删除旧入口 |
| `JWordLicenseValidationOptions.publicKeyBase64Url` | 无公开替代 | 立即删除，trust store 内置 |
| `allowInsecureFixtureLicense` | test-only replacement | 从正式 root export 和 production tarball 删除 |
| `createInsecureTestOnlyJWordLicenseSignature()` | test-only signer | 从正式 package 删除，只在测试目录保留等价支持 |
| `GATE5_FORMAT_FEATURES` | `JWORD_FEATURES.formats` | 直接删除 alias |
| `GATE6_COLLAB_FEATURES` | `JWORD_FEATURES.collaboration` | 直接删除 alias 和旧操作级 key |
| collab `license/features/licenseValidation` | server capabilities | client/server 同步协议迁移 |
| collab `token` | `credential` | admission credential 重命名，避免与 OEM license token 混用 |
| `x-jword-entitlement` | 无 | 删除，不提供兼容透传 |
| server `licenseHook` | 部署级 `license` | 若需刷新，未来另立真实 port |

产品尚未对外发售，没有兼容窗口。仓库在一个协议迁移批次内更新所有调用方，只保留一个 JWL2 verifier 和一个模块 feature 判定实现。

## 13. 最小测试矩阵

### 13.1 License unit

| 场景 | 预期 |
| --- | --- |
| test-only trust replacement + 完整 JWL2 | 正式 activation 路径成功 |
| 受控 production canary token + 正式 artifact | 发布环境 smoke 成功，不提交 token |
| 测试 key 走生产入口 | 拒绝 |
| payload/signature 任一字节变化 | `SIGNATURE_INVALID` |
| 未知 issuer/keyId/licenseClass | 稳定拒绝 |
| 非法 RFC 3339、未来 issuedAt、expiresAt 早于 issuedAt | 稳定拒绝 |
| 已过期 | `EXPIRED` |
| 模块 feature 缺失 | `FEATURE_NOT_ENTITLED` |
| 缺少 expiresAt | 严格拒绝 |
| 订阅结束至 15 天宽限内 | 仍有效；以签名 `expiresAt` 为准 |
| 超过 15 天宽限 | `EXPIRED` |
| 30 天 Evaluation 到期 | 直接 `EXPIRED`，无宽限 |
| production/disaster-recovery preset 与签名 class 不匹配 | 绑定端口前稳定拒绝；宿主不能覆盖 preset 固定上下文 |
| 浏览器宿主自报当前环境 | 不作为授权输入；实际用途由合同、制品权限、审批和台账执行 |
| 手工伪造 handle | assert 拒绝 |
| structured clone/copy handle | assert 拒绝且不泄漏 claims/token |
| 重复 JSON key、未知字段、非规范 base64url、错误长度/排序/上限 | 严格拒绝 |
| signer golden vector | runtime、worker 和 server 结果一致 |

### 13.2 Format integration

- DOCX import/export/PDF export 各保留一个成功用例。
- Professional Editing 与 Formats 各保留一个缺模块 feature 用例。
- DOCX/PDF worker 各保留一个有效 transfer 和一个篡改 transfer 用例。
- 使用 fake worker 证明高层 helper 无授权时不 dispatch；使用 spy 证明低层 worker 不解析/遍历/加载/创建输出。

### 13.3 Collaboration integration

- 缺失/过期/缺 `collaboration` 时 `start()` 在绑定端口前失败；运行中到期时 `/health` 成功、`/ready` 返回 503。
- `collaboration` 无效时所有 server capabilities 不可用；有效时部署开关只能收窄。
- client connect 不再需要 license/features，admission credential 字段与 OEM license token 命名明确分离。
- history/relay 请求不存在 entitlement header、URL 和 body。
- admission 成功的两个 actor 对同一文档均获得 write。
- admission 失败时 storage 未被调用。
- 进程运行期间 license 到期后下一次高级操作失败。
- WS connect/update、history 和 relay 都必须满足 `collaboration`；部署 capability 可以单独关闭业务入口。
- offline 与本地自动插入不被描述成独立 feature，服务端 relay 仍受 `collaboration` 保护。

### 13.4 Release/security

- package exports 不含 testing signer。
- `npm pack --json` 文件清单不含任何 private key/seed/test signer，也不含被生产 verifier 信任的测试公钥、TypeScript 源码、仓库测试、构建脚本或 source map；正式 public trust set 必须存在。
- secret scan 不命中生产私钥。
- Base tarball 不含商业实现；商业 tarball 只能从私有分发流程取得。
- 本地 tarball 第三方项目完成正式 signer golden vector → activate → Professional Editing/Formats worker smoke，并验证依赖图只有一份 license runtime；Collaboration 在其条件阶段单独验证。

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
- 记录距必填 `expiresAt` 的非负区间桶，例如 `0-1/2-7/8-30/31+`。

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

licenseId、Named Product、一级 OEM 标识和 documentId 不作为指标 label，避免敏感信息与高基数。
admission denial 与 license denial 分开计数。统一 error/logger serializer 只接受 allowlist metadata；验证 `JSON.stringify(handle)`、`structuredClone(handle)`、worker error、日志与 support bundle 均不泄漏 token 或完整 claims。

## 16. 发布、轮换、续期与回滚

### 16.1 签发

1. 商务审批一级 OEM、Named Product、交付模式、license class 与购买模块。
2. 签发工具生成 canonical JWL2。
3. 受控 signer 使用当前 signing key 签名。
4. 台账记录 claims 摘要、token hash 和审批人。
5. token 通过 secret manager/加密渠道交付一级 OEM。
6. 二级客户只获得一级客户编译产物，不获得 SDK 凭证或签发材料。

### 16.2 Key rotation

1. 在签发台账把 new key 标成 signing、old key 标成 verify-only，并发布同时信任两者的 SDK/server 版本。
2. 等 OEM 升级到该版本。
3. 新 token 改用 new key。
4. 等待 old key 签发的全部 token 到达各自 `expiresAt`。
5. 确认不再承载任何有效授权后，才发布移除 old key 的版本。
6. 停止使用 old signer，并保留审计记录。

若因 key compromise 在仍有有效 token 时禁用 old key，这是破坏性的整 key 撤销，会同时影响该 key 签发的所有许可证；必须有独立影响清单、客户通知和重签流程。

### 16.3 续期

商业模块统一按年订阅，不提供永久授权：

- `subscriptionEndsAt` 记录订阅结束时间，`expiresAt` 记录加 15 天宽限后的最终失效时间；Evaluation 为 30 天且无宽限。
- 提醒节奏属于运营配置，不进入 token schema，也不在本方案承诺固定天数。
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
- 如果新 verifier 误拒绝，回滚到仍使用生产 trust store 的上一版受控 artifact，或重新签发 token。
- 数据格式未改变；license 回滚不得修改用户文档、history 或 Yjs state。

## 17. 商业与合同配套

机器 token 只表达适合 runtime 权威执行的能力，不替代 OEM 合同。Phase 0 已冻结以下产品方向，最终法律措辞仍由 `LIC-013` 审核：

- Licensee、Named Product、生产部署范围和下游交付边界。
- browser runtime、worker、CSS 和资源只作为编译产物交付；不交付 source map、源码、仓库或构建脚本。
- 独立 SDK distribution、registry credential、签发工具和私钥的禁止或授权边界。
- 不得共享私有 registry credential、签发工具或私钥。
- Base 为免费专有闭源公开 npm，商业模块为私有 npm；授权主体内部镜像不等于外部分发权。
- Evaluation、nonProduction、production、disasterRecovery 分开；开发、CI、测试、预发布和冷灾备包含在有效订阅内。
- 商业模块按年订阅，订阅结束有 15 天宽限；不提供永久版本运行权。
- 订阅期内包含已购模块后续版本、major 和模块内普通新增功能；新独立模块、定制功能、源码、白标和额外产品线另行报价。
- 一级客户负责终端用户身份、文档访问、数据合规和 L1 支持；JWord 标准订阅只承诺不定期维护更新，不承诺 SLA、修复范围、时效、安全修复或兼容结果。
- DOCX 只承诺经过验证的兼容子集；协作未完成生产数据面前不承诺 HA/SLA。

## 18. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| OEM 控制浏览器代码，可 patch 本地检查 | 私有 paid package、服务端 enforcement、合同；禁止 DRM 宣传 |
| Opaque handle 可被结构伪造或跨 worker 不可克隆 | WeakMap identity + 单一 runtime；只传 identity-checked 签名 token transfer，worker 独立激活 |
| 多个模块各自实现 feature 检查 | 集中 `assertJWordFeatureLicensed()`，module 只声明固定 feature |
| Key rotation 要求 OEM 升级 | 提前发布双 key trust set，保留重叠窗口 |
| 离线 token 无法实时撤销或抵抗宿主回拨时钟 | 合同与制品控制；需要可信时间/实时撤销时再立项在线 activation |
| JWL1 兼容拖成长双栈 | Phase 0 盘点，明确截止版本；没有真实客户则直接删除 |
| open/write 被误解为匿名公开 | 文档区分 deployment admission 与 document ACL |
| 单实例承载多个 OEM 导致 license/数据混淆 | V1 明确一个实例一个 OEM；启动时禁止动态切换 |
| documentId 冲突 | OEM 在部署内保证全局唯一；日志和测试覆盖冲突诊断 |
| `licenseClass` 被误宣传为自动识别真实部署环境 | runtime 只校验签名类别、期限和固定 server preset 上下文；合同、制品权限、审批和台账执行实际用途 |
| offline/本地自动插入被误称为独立服务端 feature | 统一归入 Collaboration；私有分发与合同控制本地 helper，服务端 relay 检查同一个 `collaboration` 模块 |
| signer 与 verifier canonical codec 漂移 | 固定 golden vector，并让 release smoke 使用正式签发工具输出 |
| 只修 license 就误判可售 | 发布 gate 同时引用全项目 P0，不单独宣布企业 GA |

## 19. 禁止宣传与可准确宣传

完成本方案后仍不得宣称：

- 不可破解、防复制或 DRM。
- 实时在线激活/撤销。
- 永久运行权、固定维护频率、安全修复保证、兼容结果或 SLA。
- 自动隔离二级客户。
- 企业级文档 ACL、可信作者审计、SSO/SCIM。
- 生产多租户协作、HA 或 SLA。
- 无损 Word roundtrip。

Phase 0 产品输入已经冻结，但 `LIC-013` 和实现验收未完成，因此当前仍没有可直接对外发布的法律或销售文案。未来描述必须使用批准的 licensee、Base 权利、模块、年度期限和部署范围；“Base 免费”不等于开源、源码授权或无限再分发。

批准的技术描述为：JWord 使用签名模块授权启用 Professional Editing、Formats 和 Collaboration；协作服务端独立检查 `collaboration`。一个协作 deployment 绑定一个一级 OEM license，admission 后文档访问固定为 `write`。

其中“协作服务端独立执行”适用于第 8.3 节明确列出的 server、multiplayer、history 与自动插入 relay；浏览器 offline 和本地自动插入 helper 属于 Collaboration 商业 package 能力，不宣称为不可绕过的运行时 enforcement。

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

> ADR 状态：Accepted for internal implementation。正式发布仍受 `LIC-013` 法律门禁约束。

### Accepted Decision

采用 JWord 固定信任根签发的 JWL2 模块 license；本地商业模块使用 WeakMap-branded opaque handle，协作服务端使用 deployment context。每份标准授权绑定一级 OEM 与一个 Named Product，按年订阅并使用已冻结最小 claims；单 OEM deployment 与 `open/write` 按本方案执行。

### Drivers

- 售卖对象是一级 OEM，并按一个 Named Product、交付模式、商业模块和年度期限报价。
- Base 不要求 runtime token，目标为免费专有闭源公开 npm；法律文本仍待审核。
- 方案不采集终端用户、正文或文档 usage telemetry。
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

- 项目级前置工程批次和 Phase 0 文档冻结已经完成；获得单独代码实施授权后先执行 Phase 1，再按首期 Phase 2/4/5 与后续条件 Phase 3 的真实依赖推进。
- 与全项目审查 P0 发布、协作数据面和 DOCX 兼容整改并行管理。
- 在任何收费 PoC 前优先完成 Phase 1，并验证仓库测试私钥不再被生产入口接受。
