# 类 Word 编辑器商业模式调研与 JWord OEM 方案审查

> 日期：2026-07-14
>
> 状态：市场调研与实施前审查快照；本报告提出的 Phase 0 整改已由后续决策记录关闭，最终法律文本仍待审核
>
> 范围：UMO Editor、ONLYOFFICE Docs Developer、CKEditor 5、TinyMCE 8、Tiptap、Collabora Online 的官方资料，以及 JWord 当前代码、package metadata 和 `docs/current-implementation/` 文档链
>
> 价格说明：本文中的公开价格是 2026-07-14 的官网快照，只用于识别计费模型，不构成报价建议。官网未公开的 OEM、集群、源码或 air-gap 条款统一标记为需询价，不作推断。

## 1. 审查结论

本报告审查当时对 `oem-licensing-open-access-implementation-plan.md` 的结论是 **REQUEST CHANGES**。该结论保留为整改来源；当前批准状态以 [Phase 0 决策记录](oem-licensing-phase0-decision-record.md)和已校准的 [OEM 实施方案](oem-licensing-open-access-implementation-plan.md)为准。

现有方案的安全方向基本正确，特别是固定生产信任根、隔离测试私钥、服务端持有协作 license、区分商业授权与用户准入、禁止 DRM 宣传、限制 token 和正文进入日志等内容，应继续保留。

需要调整的不是这些安全原则，而是方案把尚未完成的商业决策提前写成了既定产品事实：

1. “免费基础版”尚无法律和 package metadata 支撑。当前 12 个 package 均为 `0.0.0`、`private: true`，且没有 `license` 字段。
2. 方案明确排除了 seat、MAU、文档数、并发数和部署数，却没有给出替代的报价单位，无法形成可执行的 OEM 报价。
3. 七个 JWL2 runtime feature 被同时当成技术能力和商业套餐边界，套餐调整会被不必要地放大为协议迁移。
4. 开发、测试、预发布、生产、试用、灾备、白标、源码访问和 Named Product 等常见授权维度尚未定义。
5. 强制所有收费 license 到期且不提供永久运行权，是一种可选商业策略，不是市场通行前提；应由 Phase 0 决策，而不是在决策前冻结。
6. 文档开头称一级 OEM、单部署、无计量等为“已确定决策”，Phase 0 又要求确认同一批事项，状态自相矛盾。

因此，在当时不宜直接进入 License Phase 1，必须先修订 Phase 0：把源码/分发许可证、商业 SKU 与计费、JWL2 runtime enforcement 拆成三层，并确认哪一层真正需要进入 token schema。该前置修订现已完成，但 License Phase 1 代码实施仍未开始。

## 2. 市场事实

### 2.1 代表产品对照

| 产品 | 开源与商业结构 | 主要计费或范围单位 | OEM、白标与交付 | 对 JWord 的启示 |
| --- | --- | --- | --- | --- |
| UMO Editor / Next | Editor 开源核心采用 MIT；Next、Server、源码版和 OEM 版商业销售 | 基础版一次性、商业源码版一次性加年度更新费、OEM 定制版单独报价 | 基础版交付编译产物和 Server 源码；源码版提供私有仓库；通用商业协议禁止 OEM/白标，OEM 使用独立协议 | 开源核心、商业源码、OEM 再分发是三种不同权利，不能只靠 runtime feature token 表达 |
| ONLYOFFICE Docs Developer | Community 为 AGPLv3；Enterprise/Developer 为专有商业版本 | 开发服务器、生产服务器、集群和同时连接数；生产许可按期续订 | Developer 面向嵌入 SaaS/私有部署，支持 White Label；开发与生产许可明确分开 | 完整 Office 引擎通常按部署容量收费，并单列开发环境和生产分发权 |
| CKEditor 5 | GPL 2+ 与商业许可双轨；高级能力按套餐或 add-on 销售 | 标准云套餐按 editor load；自托管、多个应用、OEM 和替代计量需询价 | 商业套餐提供白标和支持；OEM/转售不是标准套餐自动包含 | 商业 SKU 与技术插件可以映射，但不需要让每个插件名成为价格项 |
| TinyMCE 8 | GPLv2+ 开源核心；Cloud、自托管商业版和 OEM/SaaS 协议分开 | 标准云套餐按 editor load；Enterprise、自托管、OEM/SaaS 需询价 | OEM/SaaS 协议允许嵌入具有显著附加功能的产品；商业 key 与 GPL 模式分开 | OEM 再分发必须是明确许可，不应从“可下载”或“免费”推导 |
| Tiptap | Editor 与 Hocuspocus 为 MIT；Platform 和 Pro 扩展商业销售 | 开发者许可、云文档数和环境；自托管文档不计入云额度 | Pro 扩展经私有 registry 交付，可嵌入但禁止单独分发；Enterprise 支持 private/on-prem | 私有包交付、开发者权利和托管用量是不同维度，适合分层销售 |
| Collabora Online | 主要组件采用 MPLv2；CODE 免费但不建议生产；商业版提供维护、LTS 和 SLA | 用户数/年，多年合同询价；不按同时打开文档收费 | 支持自托管、集成和合作伙伴转售；商业价值集中在受支持版本和服务 | 开源代码仍可通过稳定版本、维护、安全更新和支持形成商业产品 |

### 2.2 公开价格快照

这些价格只用于说明市场分层，不建议直接换算为 JWord 定价：

- UMO：基础版 2.8 万元；商业源码版 9.8 万元并收取每年 2.8 万元更新费；OEM 定制版 26.8 万元起。
- ONLYOFFICE Developer 当前价格计算器默认项显示 1 台服务器、每台 20 个同时连接，总价 3,500 美元；生产 Single Server/Cluster 的价格取决于连接数和配置。
- CKEditor 当前标准商业云套餐按月度 editor load 分级；自托管、多个应用和 OEM 走 Custom。
- TinyMCE 当前标准商业云套餐按 editor load 分级；自托管、Enterprise 和 OEM/SaaS 需询价。
- Tiptap Platform 按套餐包含开发者数、云文档数和环境，额外开发者单独计费；Enterprise 需询价。
- Collabora Online 未公开标准单价，商业订阅按用户数/年和支持范围报价。

### 2.3 市场形成的五类模型

1. MIT 开源核心 + 商业源码/OEM，例如 UMO、Tiptap。
2. GPL/AGPL 双许可 + 商业授权，例如 CKEditor、TinyMCE、ONLYOFFICE。
3. 按 editor load 的云服务订阅，例如 CKEditor、TinyMCE。
4. 按开发者、云文档和环境收费的平台，例如 Tiptap Platform。
5. 按并发连接、服务器或年度用户数收费的完整 Office 引擎，例如 ONLYOFFICE、Collabora Online。

这些模式没有单一正确答案。它们的共同点是：**源码许可证、OEM 分发权、部署/用量范围、白标、支持维护和 runtime enforcement 被分别定义。**

## 3. JWord 当前事实

### 3.1 产品与发布事实

- 12 个 workspace package 均为 `0.0.0` 和 `private: true`。
- 所有 package manifest 当前都缺少 `license` 字段。
- `core`、`ui`、`native` 等 manifest 的目标 access 是 public，但尚未真实发布。
- `license`、`docx`、`pdf`、`persistence`、`collab`、`collab-server` 的目标 access 是 restricted，但私有 registry、下载授权、版本、合同和客户交付流程尚未冻结。
- third-party tarball smoke 已证明工程消费路径，不等于已经取得公开或 OEM 再分发许可。

因此，当前文档中的“免费基础”只能解释为“拟议中不要求 runtime feature token 的 Base 能力”，不能解释为开源、免费商用、免费 OEM 转售或已可公开下载。

### 3.2 当前 License 事实

- `packages/license/src/index.ts` 仍公开 JWL1 entitlement、raw claims、`publicKeyBase64Url` 和测试签发 helper。
- 默认公钥对应仓库公开测试私钥，生产信任根尚未成立。
- DOCX、PDF、collab 和 collab-server 直接消费 raw entitlement。
- collab client 仍可传 `license`、`features`、`licenseValidation`，history 仍发送 `x-jword-entitlement`。
- JWL2、固定 `issuer + keyId` trust store、opaque handle 和 deployment license context 都仍是目标设计，不是当前实现。

这说明 License Phase 1 的安全整改确有必要，但不能替代 Phase 0 商业决策。

## 4. 主要审查发现

### P0-1：“免费基础版”缺少法律定义

现有方案同时使用“基础编辑免费”“public package”“OEM 下游交付”等表述，但当前 package 没有许可证文本或 manifest `license` 字段。

必须先选择以下一种明确模式：

1. 专有 Base：无需 runtime token，但使用商业 EULA，不等于开源或无限再分发。
2. 开源 Base：明确选择 MIT、Apache-2.0、GPL 等真实许可证，并接受对应再分发义务。
3. 双许可 Base：同一代码提供开源与商业 OEM 两条授权路径。

在作出选择前，所有 current-implementation 文档应把“免费”改成“拟议 Base / 当前不要求 runtime token”，避免形成错误的对外授权承诺。

### P0-2：缺少可报价的商业单位

方案排除了用户、席位、文档、并发、用量、hostname 和 deploymentId，也没有按 OEM 产品、应用、部署或收入规模计价。这样虽然 token 简单，但销售无法回答“客户购买一份后可以用于多少产品、多少生产实例、多少下游交付”。

对当前 JWord，建议首期采用：

```text
一个一级 OEM 客户
+ 一个 Named Product / 应用线
+ 约定的生产部署范围
+ 包含的商业 SKU
+ 维护与支持期限
```

暂不建议按终端用户、文档数或正文 telemetry 计费。协作进入生产销售后，再根据容量成本决定是否增加连接档位或部署档位。

### P0-3：商业 SKU 与 runtime feature 混为一层

`docx.import`、`docx.export`、`pdf.export`、`collaboration.server` 等适合作为稳定技术 capability，但未必适合作为七个独立报价项。

应建立单独映射：

```text
商业 SKU / 合同套餐
  -> 一组稳定 runtime features
  -> 固定 enforcement 位置
```

首期可把 DOCX import/export 与 PDF export 作为一个 Formats SKU；Collaboration SKU 映射 server、multiplayer 和 history。`collaboration.server` 更像协作部署的基础技术依赖，不应默认作为客户单独购买的 SKU。`automation.autoInsert` 只有存在真实 relay 产品和客户时才应进入首期 catalog。

### P0-4：缺少环境和试用模型

市场上的 Developer、Evaluation、Production、Cluster/Enterprise 通常有不同权利。当前方案只有一种有期限收费 token，未定义：

- 试用 token 的期限和功能。
- 开发、CI、测试、预发布环境是否免费或包含在合同内。
- 生产实例和灾备实例如何计入范围。
- 测试数据和正式数据是否允许使用同一 token。
- 到期后开发环境、生产环境分别如何降级。

这些事项会影响 token 是否需要 `licenseClass`、`productId` 或 `environment`。在 Phase 0 决定前，不应提前认定这些字段永远不进入 JWL2。

### P0-5：OEM 再分发、白标和源码权利不完整

现有“compiled-product-only”对浏览器 JavaScript 不够精确。浏览器必然获得可执行 JavaScript、worker、CSS 和静态资源，客户也可能需要 source map 或私有调试构建。

合同与交付文档至少需要分别定义：

- 可嵌入并再分发的 browser runtime、worker、CSS 和字体/资源。
- 禁止单独提取、重新打包、转售 SDK 或共享 registry credential。
- 是否允许去除品牌，以及哪些版本包含白标权。
- 是否提供完整源码、部分源码、source map 或仅压缩产物。
- 源码访问是否包含修改权、生产使用权、更新权和二级客户交付权。

UMO 的公开产品线说明，源码版和 OEM 版本身可以是独立高价产品。JWord 不必首期提供源码，但必须明确“暂不提供”是商业选择，而不是被 runtime token 自动解决。

### P0-6：期限与永久运行权被过早冻结

年度到期 token 适合订阅和快速轮换，但 self-hosted、隔离网和 OEM 客户经常会要求“已购买版本永久运行、更新与支持按年续费”。ONLYOFFICE 的开发许可和 UMO 的源码/OEM方案也体现了运行权与更新服务可以分开。

Phase 0 应在以下模式中明确选择，而不是先写死“不签永久离线 token”：

1. 年度订阅，到期停止高级操作。
2. 永久使用已购 major，维护期控制更新、支持和新 feature。
3. 两者并存，按在线、私有化和 air-gap SKU 区分。

如果首期只选择年度订阅，文档应记录这是经过确认的销售策略及客户范围，不应写成技术必然。

### P1-1：单 OEM deployment 是可行默认值，但不是价格边界

一个 deployment context 只激活一个 OEM license，有利于简化协作代码和安全边界，应保留为 V1 技术约束。

但是当前 token 没有 `productId` 或 `deploymentId`，同一 token 在技术上可复制到该 OEM 的多个产品或部署。若合同允许无限部署，这没有问题；若报价按 Named Product 或部署数，必须在 Phase 0 决定由合同、交付台账、activation 还是 token claim 执行。

### P1-2：协作销售应继续保持条件阶段

ONLYOFFICE、Tiptap 和 Collabora 的协作价格都与服务端容量、托管文档、用户或支持成本相关。JWord 当前协作数据面仍缺生产持久化、统一 admission、备份恢复和 HA 证据。

因此：

- 可以先保留 Collaboration SKU 和 JWL2 feature 的设计位置。
- 在 production collab preset 完成前，不应冻结协作价格、容量承诺或 SLA。
- `open/write` 只是当前 V1 document access 技术策略，不是市场卖点，也不代表匿名公开。

### P1-3：现有商业化研究与 OEM 方案口径冲突

早期候选商业模型曾建议组织、SKU、席位/部署额度、短期 entitlement、在线续期、吊销和 tenant/document ACL；当前 OEM 方案随后选择单 OEM、无计量、纯离线 token 和 open/write。

两者可以作为不同方案对照，但不能同时作为 binding 决策。前者仅作为市场背景，不构成 binding 决策；后者在 Phase 0 确认后才成为执行约束。

### P2-1：JWL2 与 opaque handle 无需推翻

JWL2 的固定算法、严格 parser、资源上限、`issuer + keyId` trust store 和 canonical vector 是合理的离线 token设计。WeakMap handle 也能减少业务代码误信 raw claims。

需要保留两个边界：

- 自研 Ed25519 实现必须替换为成熟实现或完成独立审计。
- WeakMap identity 是误用防护和内部一致性机制，不是抵抗掌控宿主代码的 OEM 的 DRM。

## 5. 建议保留的现有设计

以下内容不因市场审查而改变：

1. 商业 license 与终端用户身份、文档 ACL 正交。
2. 协作部署由服务端持有 OEM license，浏览器不上传 deployment entitlement。
3. 调用方不能传入或覆盖生产公钥/verifier。
4. 使用固定 `issuer + keyId` trust store，并保留 key rotation 窗口。
5. 测试私钥、测试 signer 和测试 trust store 不进入正式 exports 或 tarball。
6. 未授权检查发生在解析 DOCX、遍历 layout、加载资源或访问协作数据之前。
7. token、signature、Authorization、正文和 Yjs update 不进入日志或 support bundle。
8. 不宣传不可破解、实时撤销、自动 tenant 隔离或 100% Word roundtrip。
9. `collaboration.offline` 不作为服务端可以权威执行的独立 feature。
10. V1 不为尚不存在的 ACL、SSO、SCIM 或多 OEM 云提前发布公共 adapter。

## 6. 建议的 JWord 首期商业模型

这不是最终报价，而是与当前项目成熟度匹配的 Phase 0 候选基线。

### 6.1 产品层

| 产品层 | 建议权利 | 当前进入条件 |
| --- | --- | --- |
| Evaluation / Development | 非生产集成、CI 和测试；有限期限；禁止下游分发 | License Phase 1 后即可提供 |
| Editor SDK | 一个 Named Product 内嵌 Base editor 与 `.jword`；约定开发/测试/生产范围 | 发布 metadata、EULA、tarball 消费闭环完成 |
| Formats Add-on | DOCX import/export 与 PDF export 作为一个初始 SKU | 格式授权迁移和兼容合同完成 |
| Collaboration Add-on | multiplayer、server、history；offline 作为配套能力 | production collab preset、持久化和恢复证据完成 |
| OEM / Source / White-label | 更广下游分发、品牌权、源码或定制支持 | 单独合同和交付流程，不默认包含 |

Automation Relay 暂不建议作为首发独立 SKU，除非已经存在明确客户、服务端 relay 产品和成本模型。

### 6.2 建议的首期报价单位

优先使用“Named Product + 生产部署范围 + SKU + 维护支持期限”，而不是立即建设终端用户、文档或正文 usage metering。

协作如果形成明显容量成本，可以在后续合同中增加服务器/连接档位；不要把该档位提前写进编辑器本地 JWL2，除非服务端确实需要权威执行。

### 6.3 三层模型

```text
源码与分发许可证
  决定能否复制、修改、白标、OEM 再分发和取得源码

商业合同与 SKU
  决定 Named Product、部署范围、期限、维护、支持和购买的产品包

JWL2 runtime features
  只执行适合机器稳定判断的高级能力，不替代合同
```

## 7. Phase 0 应重写为哪些步骤

### 步骤 1：确认真实销售事实

- 是否已经存在客户、PoC、报价或合同承诺。
- 是否已经签发 JWL1。
- 目标客户是 SaaS、私有化还是完全离线。
- 首期是否真实销售 DOCX、PDF 或协作。

### 步骤 2：冻结代码许可证与分发权

- Base 是专有、开源还是双许可。
- 一级 OEM、二级客户和终端用户分别能取得什么产物。
- 是否允许白标、源码访问、修改和再分发。
- 私有 registry、离线交付包和 browser asset 的交付边界。

### 步骤 3：冻结 SKU 和报价单位

- Editor SDK、Formats、Collaboration、OEM/Source 是否为首期产品层。
- 每个 SKU 包含哪些技术 features。
- 价格按 Named Product、部署、连接、开发者或其它单位。
- 开发、测试、预发布、生产和灾备环境如何授权。

### 步骤 4：冻结期限、维护与支持

- 年度订阅还是永久已购版本运行权。
- 续期提前量、到期行为和维护期。
- major upgrade、新 feature、L1/L2/L3 支持和 SLA 权益。

### 步骤 5：把商业决策映射到 JWL2

- 先确定稳定技术 feature catalog，再确定 SKU 到 feature 的映射。
- 只有需要 runtime 权威执行的范围才进入 claims。
- 冻结 `issuer`、首个 `keyId`、生产 trust store 和签发环境。
- 确定是否需要 `licenseClass`、`productId`、`environment` 或其它 scope claim；没有真实执行需求则不增加。

### 步骤 6：形成审批记录

每项决策至少记录：决定、理由、合同执行方、runtime 执行方、兼容要求、负责人和确认日期。完成后才能冻结 JWL2 schema，并进入 License Phase 1。

## 8. 现有文档调整矩阵

| 文档 | 建议调整 | 优先级 |
| --- | --- | --- |
| `oem-licensing-open-access-implementation-plan.md` | 把“已确定决策”改为“待 Phase 0 确认的候选基线”；增加三层模型、报价单位、环境/试用、白标/源码和 SKU-feature 映射；重新编号 Phase 0 | P0 |
| full-review `README.md`、`01`、`04`、`06`、`07` | 不再把未经 Phase 0 确认的一级 OEM、无计量和 open/write 全部描述为已冻结商业事实；技术安全事实继续保留 | P0 |
| `sdk/public-api.md`、`sdk/quickstart.md`、`sdk/jword-format.md`、`packages/native.md` | 在真实许可证落地前，将“免费”改为“当前不要求 runtime license 的 Base 能力”，避免暗示再分发权 | P1 |
| `release-metadata-audit.md` | 保持现有阻断结论；Phase 0 决策后补真实 license metadata 和 registry 方案 | P1 |
| `packages/license.md`、`sdk/licensing.md` | 当前实现摘要暂不提前写 JWL2；Phase 1 实施后再按真实 API 更新 | P2 |

## 9. 当前停止点

本报告形成后，Phase 0 决策记录、OEM 候选实施方案和整改文档链先按市场审查结论完成了候选口径校准；没有修改代码、测试、配置或 package metadata，也没有开始 License Phase 1。

2026-07-14 后续逐项确认已经完成：`LIC-000` 至 `LIC-012` 为 `Approved`，`LIC-013` 为法律审核 `Deferred`。最终决定与后续 Phase 1–5 以 [Phase 0 决策记录](oem-licensing-phase0-decision-record.md)和 [OEM 实施方案](oem-licensing-open-access-implementation-plan.md)为准；本市场报告中的候选 SKU、feature 和期限讨论只保留为调研过程，不覆盖最终决定。内部下一代码阶段是 License Phase 1，但本次文档回写没有开始代码实施；正式发布和商业签约继续等待法律审核。

## 10. 官方来源

访问日期均为 2026-07-14。

### UMO

- [MIT LICENSE](https://raw.githubusercontent.com/umodoc/editor/main/LICENSE)
- [官方仓库](https://github.com/umodoc/editor)
- [商业价格与版本](https://www.umodoc.com/business)
- [Umo Team 商业软件许可协议](https://dev.umodoc.com/cn/docs/license)
- [Umo Editor Server](https://dev.umodoc.com/en/docs/server)

### ONLYOFFICE

- [Community Edition FAQ](https://helpcenter.onlyoffice.com/docs/faq/docs-community.aspx)
- [Developer Edition 价格](https://www.onlyoffice.com/developer-edition-prices)
- [Developer Edition license FAQ](https://helpcenter.onlyoffice.com/docs/faq/developer.aspx)
- [版本比较](https://www.onlyoffice.com/compare-editions)
- [License API](https://api.onlyoffice.com/docs/docs-api/additional-api/command-service/license)
- [DocumentServer 官方仓库](https://github.com/ONLYOFFICE/DocumentServer)

### CKEditor

- [CKEditor licensing options](https://ckeditor.com/legal/ckeditor-licensing-options)
- [Pricing](https://ckeditor.com/pricing)
- [License key and activation](https://ckeditor.com/docs/ckeditor5/latest/getting-started/licensing/license-key-and-activation.html)
- [Update to version 44](https://ckeditor.com/docs/ckeditor5/latest/updating/guides/update-to-44.html)
- [Domains and usage](https://ckeditor.com/blog/how-many-domains-can-you-use-with-ckeditor)

### TinyMCE

- [License key](https://www.tiny.cloud/docs/tinymce/latest/license-key/)
- [Pricing](https://www.tiny.cloud/pricing/)
- [Self-hosted OEM/SaaS agreement](https://www.tiny.cloud/legal/tiny-self-hosted-oem-saas-agreement/)
- [Attribution requirements](https://www.tiny.cloud/legal/attribution-requirements)

### Tiptap

- [Open source to Platform](https://tiptap.dev/open-source-to-platform)
- [Pricing](https://tiptap.dev/pricing)
- [Feature comparison](https://tiptap.dev/feature-comparison)
- [Pro License](https://tiptap.dev/pro-license)
- [Pro extensions](https://tiptap.dev/docs/guides/pro-extensions)

### Collabora Online

- [FAQ](https://www.collaboraonline.com/faqs)
- [Partner programme](https://www.collaboraonline.com/become-partner)
- [End User License and Subscription Agreement](https://www.collaboraonline.com/end-user-license-and-subscription-agreement)
