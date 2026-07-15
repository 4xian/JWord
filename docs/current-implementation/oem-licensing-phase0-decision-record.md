# OEM License Phase 0 商业与协议决策记录

> 状态：产品、商业与技术输入已冻结；法律发布门禁待审核。
>
> 创建日期：2026-07-14。
>
> 作用：记录进入 License Phase 1 前必须冻结的商业、法律、交付和运行时输入。本文档是决策记录，不是合同、法律意见或当前实现说明。

## 1. 使用规则

1. 每项决策只能标记为 `Open`、`Approved`、`Rejected`、`Deferred` 或 `Not Applicable`。
2. `Approved` 必须同时记录决定、理由、合同执行方、runtime 执行方、负责人和确认日期。
3. 市场调研、技术建议和候选基线不能自动成为 `Approved`。
4. 产品负责人可以先批准商业方向与技术输入；代码许可证、OEM Agreement、下游条款和责任限制只有在 `LIC-013` 完成法律审核后才能成为对外法律文本。
5. 影响 JWL2 schema、feature catalog、信任根或迁移策略的事项未关闭前，不得进入 License Phase 1；`LIC-013` 为 `Deferred` 时允许内部技术实施，但禁止正式 npm 发布和商业签约。
6. 不需要机器权威执行的商业约束不得仅为了合同表达而加入 token claims。

## 2. 证据与文档关系

- [类 Word 编辑器商业模式调研与 JWord OEM 方案审查](word-editor-commercial-model-research-2026-07-14.md)提供市场事实和候选方案，不是 binding 决策。
- [一级 OEM 功能授权与开放文档访问实施方案](oem-licensing-open-access-implementation-plan.md)只能在本记录批准的输入范围内冻结技术实现。
- `packages/*`、`docs/current-implementation/packages/*` 和 `docs/current-implementation/sdk/*` 继续描述当前真实实现，不得提前写成 JWL2 已完成。

## 3. 当前已确认事实

以下是仓库或文档可以直接核验的当前事实，不代表商业决策已经完成：

- 12 个 workspace package 当前均为 `0.0.0`、`private: true`，并缺少 `license` metadata。
- 当前正式授权入口仍是 JWL1 raw entitlement；JWL2、固定 `issuer + keyId` trust store 和 opaque handle 尚未实现。
- 默认公钥对应仓库测试私钥，调用方仍可传入公钥，测试 signer 仍在正式入口导出。
- DOCX、PDF 和协作仍直接消费 raw entitlement；协作 history 仍传递 `x-jword-entitlement`。
- 生产协作数据面、统一 deployment admission、持久化、备份恢复和 HA 证据尚未闭环。
- 产品尚未对外发售，没有真实 JWL1 客户；Base 的最终法律文本、正式价格和 OEM 合同仍未完成法律审核。

## 4. 决策清单

| ID | 决策主题 | 必须回答的问题 | 批准决定 | 状态 |
| --- | --- | --- | --- | --- |
| LIC-000 | Licensee 与下游权利 | 是否只授权一级 OEM；一个授权覆盖多少 Named Product；二级客户能否取得完整产品中的 runtime | 一级 OEM + 一个 Named Product；二级客户只取得完整产品中不可分离的 runtime | Approved |
| LIC-001 | SKU 与 feature 映射 | 首期销售哪些 SKU；每个 SKU 映射哪些稳定 runtime features | 模块级 `professional.editing`、`formats`、`collaboration`；Commercial Full 在签发时展开 | Approved |
| LIC-002 | 期限与续期 | 年度订阅、永久已购 major 或并存；宽限期和到期行为 | 按年订阅；15 天宽限；到期后商业模块不可使用 | Approved |
| LIC-003 | JWL1 客户盘点 | 是否已向真实客户签发 JWL1；兼容窗口和重签截止日期是什么 | 尚未发售、无真实 JWL1 客户，直接迁移 JWL2 | Approved |
| LIC-004 | 签发与信任根 | 生产 issuer、首个 keyId、签发环境、审批与轮换责任 | `issuer=jword`、`keyId=jword-prod-2026-k1`；KMS/HSM 优先，职责分离 | Approved |
| LIC-005 | 部署技术边界 | 一个协作实例是否只绑定一个 OEM license；documentId 唯一范围是什么 | 单 deployment context、单 OEM license、`documentId` 全部署唯一 | Approved |
| LIC-006 | Base 法律许可证 | Base 是专有、开源还是双许可；“无需 runtime token”意味着什么 | 免费、源码闭源的专有公开 npm 包；不采用 GPL/AGPL，不宣传开源 | Approved |
| LIC-007 | 交付、OEM、白标与源码 | 编译产物、source map、源码、修改和再次分发分别授予什么权利 | Base 公开 npm、商业模块私有 npm；只交付编译产物，可在授权主体内镜像 | Approved |
| LIC-008 | 版本、维护与支持 | major、新 feature、更新和 SLA 如何划分 | 订阅期内包含已购模块更新和 major；新独立模块另购；标准订阅无 SLA | Approved |
| LIC-009 | 环境与试用 | Evaluation、非生产、生产和灾备如何授权 | 四类分开；试用 30 天无宽限；非生产和冷灾备包含在订阅权益内 | Approved |
| LIC-010 | 首期销售范围 | 首期销售哪些模块；DOCX 和协作分别达到什么边界 | Base、Professional Editing、Formats；DOCX 先受限兼容，协作及自动插入延后 | Approved |
| LIC-011 | 报价与范围单位 | 按什么单位报价；是否采集 usage | 一级 OEM + Named Product + 交付模式 + 商业模块 + 年度期限；不按 usage 计量 | Approved |
| LIC-012 | JWL2 claims 边界 | 哪些字段需要 runtime 权威执行 | 固定最小 claims；商业模块只用模块级 features | Approved |
| LIC-013 | 法律与商业批准 | 谁批准代码许可证、OEM Agreement、下游条款、价格和支持承诺 | 等待法律审核；审核完成前禁止正式发布和商业签约 | Deferred |

## 5. 单项决策记录

以下 `Approved` 表示产品和技术输入已经由项目/产品负责人确认，不替代 `LIC-013` 要求的法律审核。统一确认日期为 2026-07-14，统一产品决策证据为本轮逐项确认记录；正式发布前必须把最终法律文本和审批编号补入 `LIC-013`。

### LIC-000：Licensee 与下游权利

- 决定：每份授权面向一个一级 OEM 和一个 Named Product；二级客户只能随完整产品取得不可分离 runtime，不能取得独立 SDK。
- 理由：保持一级授权链和可审计的产品范围，避免引入二级证书链。
- 执行：Named Product、下游交付和不可分离要求由合同执行；runtime 不加入二级客户 claim。
- 兼容：未来新增 Named Product 或下游再分发层级时另签授权，不复用本授权。
- 负责人：项目/产品负责人。

### LIC-001：SKU 与 feature 映射

- 决定：JWL2 只登记 `professional.editing`、`formats`、`collaboration` 三个模块级 feature；Commercial Full 是销售组合，签发时展开为已购买模块，不成为第四个 runtime feature。
- 理由：降低授权校验和套餐演进复杂度，避免每个按钮或操作形成长期协议键。
- 执行：合同记录购买模块；各商业模块在统一 license deep module 中检查自己的固定模块 feature。自动插入归入 Collaboration，不设独立 Automation Relay feature。
- 兼容：没有 JWL1 客户，不保留旧操作级或 Gate feature alias。
- 负责人：项目/产品负责人。

### LIC-002：期限与续期

- 决定：商业模块按年订阅；正常订阅结束后有 15 天宽限期；`expiresAt` 到达后已购商业模块不可继续使用。定制功能在订阅之外单独报价。
- 理由：形成可持续的版本和维护收入，同时给客户留出续签部署时间。
- 执行：合同记录订阅期限；签发器把合同结束时间写入可选 `subscriptionEndsAt`，把含宽限期的最终失效时间写入必填 `expiresAt`；runtime 只以签名时间字段判定，不接受调用方自报宽限状态。
- 兼容：不提供永久授权；Base 不因商业订阅到期而锁死。
- 负责人：项目/产品负责人。

### LIC-003：JWL1 客户盘点

- 决定：产品尚未对外发售，没有真实 JWL1 客户，直接迁移到 JWL2。
- 理由：没有外部兼容义务，保留双栈只会增加攻击面和维护成本。
- 执行：合同无迁移要求；runtime 删除 JWL1 parser、raw entitlement、旧 alias 和兼容 overload，并保留“JWL1 被拒绝”的最小测试。
- 兼容：不设置兼容窗口或重签截止日期。
- 负责人：项目/产品负责人。

### LIC-004：签发与信任根

- 决定：生产 `issuer` 固定为 `jword`，首个 `keyId` 固定为 `jword-prod-2026-k1`；私钥优先放入 KMS/HSM。审批、签发操作和台账管理分离。
- 理由：建立不可由客户替换的生产信任根和可轮换的签发链。
- 执行：合同不授予签发权；runtime 内置固定 trust store，签发环境、审批和台账由不同角色负责，正式运营前指定具体人员。
- 兼容：测试 key、测试 signer 和调用方公钥注入不得进入生产包。
- 负责人：项目/产品负责人；签发运维负责人在 Phase 5 前指定。

### LIC-005：部署技术边界

- 决定：一个协作部署实例绑定一个一级 OEM license，`documentId` 在该 deployment 内唯一；admission 后文档访问固定为 `write`。
- 理由：与当前数据键和 V1 产品范围一致，避免虚假的 tenant/ACL 承诺。
- 执行：部署合同说明单 OEM 实例；collab-server 用 immutable deployment context、统一 admission 和内部 `authorizeDocumentAccess()` 执行。
- 兼容：删除旧 tenant/role 表面能力；未来多 OEM 或文档 ACL 另立版本化方案。
- 负责人：项目/产品负责人。

### LIC-006：Base 法律许可证

- 决定：Base 目标为免费、源码闭源的专有公开 npm 包；不采用 GPL/AGPL，不对外宣传开源或 source-available。
- 理由：允许低门槛集成和推广，同时保持源码私有性。
- 执行：最终免费使用、嵌入和再分发边界由法律审核后的专有许可证/EULA 执行；Base 不要求 JWL2 runtime token。
- 兼容：正式公开 npm 前必须完成 `LIC-013`，不能先用未审核的许可证文本发布。
- 负责人：项目/产品负责人。

### LIC-007：交付、OEM、白标与源码

- 决定：Base 通过公开 npm 分发，商业模块通过私有 npm 分发；只交付编译产物，不交付 TypeScript 源码、仓库、构建脚本或 source map。授权主体可以建立内部镜像，但不能向外提供 registry credential 或独立 SDK。
- 理由：让下载权限和 JWL2 runtime 校验形成双层控制，并保护源码与供应链凭证。
- 执行：合同约束下游交付、内部镜像和凭证；registry 控制商业包下载，runtime 继续执行 JWL2。标准订阅不授予源码修改、白标或再分发权。
- 兼容：未来源码、白标或更广分发只能通过单独定制合同和法律审核新增。
- 负责人：项目/产品负责人。

### LIC-008：版本、维护与支持

- 决定：订阅期内可使用已购模块的后续版本和 major，以及该模块内新增的普通功能；新独立商业模块需要另购。标准订阅不含 SLA。
- 理由：把模块内持续演进纳入订阅价值，同时保留新产品线独立定价。
- 执行：合同只表述会不定期修复问题和维护更新，不承诺维护频率、修复范围、时效、安全修复或兼容结果；定制交付另行报价。
- 兼容：订阅到期按 `LIC-002` 失效，不产生永久版本运行权。
- 负责人：项目/产品负责人。

### LIC-009：环境与试用

- 决定：`evaluation`、`nonProduction`、`production`、`disasterRecovery` 分开签发；试用期 30 天且没有宽限。开发、CI、测试、预发布和冷灾备属于有效订阅包含的环境权益。
- 理由：区分试用、日常研发、生产和灾备用途，同时不按开发者或 CI 节点收费。
- 执行：合同定义环境用途，审批和签发台账记录实际获批类别；签发器只生成已审批的 `licenseClass`，runtime 严格校验固定枚举、类别期限和过期状态。Phase 3 的官方 production/disaster-recovery preset 使用固定运行上下文拒绝类别不匹配的 token，不接受宿主传入“按 production 处理”等自报开关。
- 技术边界：浏览器 SDK 和离线 token 无法识别宿主真实部署环境，不能把 `licenseClass` 宣传为防止客户把 evaluation 或 nonProduction 制品用于生产的强隔离。真实环境、Named Product 和部署用途仍由合同、制品权限、发布审批与签发台账执行。
- 兼容：不采集终端用户、文档或 editor load telemetry。
- 负责人：项目/产品负责人。

### LIC-010：首期销售范围

- 决定：首期产品层为 Base、Professional Editing 和 Formats。DOCX 首期只承诺经验证的受限兼容子集，长期路线是高保真 Word 格式兼容；Collaboration 及其中的自动插入延后。
- 理由：先销售当前更容易形成可验证交付闭环的本地能力，避免把未成熟生产协作作为首发承诺。
- 执行：合同排除未验证 DOCX 语义和 Collaboration；runtime 只给首期商业 token 签发 `professional.editing`、`formats`。
- 兼容：PDF 归入 Formats；Collaboration 达到生产数据面退出标准后再作为独立模块销售。
- 负责人：项目/产品负责人。

### LIC-011：报价与范围单位

- 决定：报价按一级 OEM、一个 Named Product、交付模式、已购商业模块和年度期限组合；定制功能单独报价。
- 理由：与 OEM 嵌入式 SDK 的价值和交付责任一致，避免建立当前不需要的用量计费平台。
- 执行：合同和报价单执行；runtime 不按用户、文档、连接、editor load 或 MAU 计量。
- 兼容：以后需要部署数或用量计费时另立激活/计量方案，不向当前 claims 塞入 telemetry。
- 负责人：项目/产品负责人。

### LIC-012：JWL2 claims 边界

- 决定：最小 claims 为 `schemaVersion`、`licenseId`、`issuer`、`keyId`、`licenseClass`、模块级 `features`、`issuedAt`、可选 `subscriptionEndsAt` 和必填 `expiresAt`。
- 理由：只让 runtime 执行稳定、可验证的模块和期限判断；Named Product、交付模式与客户信息留在合同和签发台账。
- 执行：签发器和 runtime 严格拒绝未知字段、未知 class、未知 module、非规范时间和过期 token；固定 server preset 可以检查签名 class 是否与 preset 上下文匹配，但 runtime 不推断真实环境。claims 不含 `oemCustomerId`、`productId`、`deploymentId`、tenant、用户或 usage。
- 兼容：JWL2 首次实现直接使用该 schema，不保留 JWL1 字段映射。
- 负责人：项目/产品负责人。

### LIC-013：法律与商业批准

- 决定：状态保持 `Deferred`，等待代码许可证、OEM Agreement、下游条款、责任限制、价格和支持文案的法律审核。
- 理由：产品尚未发售，可以先完成内部技术实施，但不能把产品决策当成正式法律意见。
- 执行：内部允许进入 License Phase 1；正式 Base npm 发布、商业 package 交付、签约和收费必须 fail closed。
- 兼容：法律审核如要求实质改变产品权利、claims 或分发模型，必须暂停对应实现并重新审批。
- 负责人：法律负责人待指定；项目/产品负责人负责在发布前取得审批。

## 6. Phase 0 退出标准

只有同时满足以下条件才能进入内部 License Phase 1：

1. `LIC-000` 至 `LIC-012` 为 `Approved`，`LIC-013` 至少为明确阻断对外发布的 `Deferred`。
2. Base 的专有闭源方向和下游分发产品边界已经明确；最终代码许可证/EULA 文本继续受 `LIC-013` 阻断。
3. 首期 SKU、报价范围、环境权利、期限和维护支持已经明确。
4. SKU 到 runtime feature 的映射已经明确。
5. JWL2 claims 只包含需要机器权威执行的稳定字段。
6. JWL1 客户盘点和迁移策略已经明确。
7. 生产 issuer、首个 `keyId`、签发环境和轮换责任已经明确。
8. OEM 实施方案、整改路线图和问题台账已同步批准结果。
9. 文档明确区分“允许内部技术实施”和“允许正式发布/商业签约”；后者必须等待 `LIC-013` 变为 `Approved`。

## 7. 非目标

本次 Phase 0 回写不实现 JWL2，不修改 DOCX/PDF/协作 API，不建设在线授权控制面，不发布 package，也不承诺 SLA。Phase 0 文档关闭后只解除内部 License Phase 1 的前置输入门禁，不自动授权代码实施、正式发布或商业签约。
