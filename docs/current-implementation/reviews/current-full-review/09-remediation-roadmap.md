# 统一整改阶段与实施路线

> 本文件是全项目唯一实施顺序。详细技术设计继续引用 OEM 实施方案和本目录分领域 finding，不在多个计划中重复维护同一状态。

## 1. 执行规则

1. 严格按阶段顺序执行；进入下一阶段前必须完成当前阶段退出标准和文档回写。
2. 每次只实施一个阶段或阶段内明确标记的子批次，不顺便修复相邻问题。
3. 开始前先用同一条聚焦验证复现；修改后复跑同一验证，再扩大到阶段矩阵。
4. 只修改当前阶段必需文件；发现新问题先登记，不自动扩大范围。
5. 不执行真实 publish，不自动提交代码。真实发布必须同时满足 `LIC-013` 和阶段 7 门禁。
6. i18n 是所有后续阶段的横切验收项：新增或修改用户可见文本、tooltip、aria-label 或 live region 时，必须同步提供 `zh-CN` / `en-US` 文案；跨层 diagnostic 在 runtime、worker、server、日志和协议中只使用语言无关的稳定 code 与必要结构化字段，由 UI、wrapper 或宿主展示层负责本地化。

## 2. 阶段总览

| 阶段 | 名称 | 状态 | 是否阻断下一步 |
| --- | --- | --- | --- |
| 0A | 基础反馈环和单 Host EditorShell | Completed | 已退出 |
| 0B | UI 工作区、Toast、debug、i18n | Completed | 已退出 |
| 0C | OEM Phase 0 产品与技术输入 | Completed / 法律 Deferred | 允许内部实施，阻断外部发布 |
| 1 | 重建 License 深模块 | **Completed for internal progression / LIC-107B2 manual certification deferred** | 已退出；最低浏览器人工认证仅阻断对应对外兼容声明和商业 GA |
| 2 | 不可信文件、恢复和 core 数据正确性 | Closed | Phase 2 已完成；下一步为 Phase 3 |
| 3 | 发布 artifact 与第三方消费基线 | Pending | 阻断客户交付 |
| 4 | Professional Editing、Formats 和 JWL1 移除 | Pending | 阻断首期商业模块发售 |
| 5 | Core、UI、wrapper 产品化 | Pending | 阻断公开承诺范围内的 SDK GA |
| 6 | Collaboration 授权与生产数据面 | Conditional | 只阻断 Collaboration 销售 |
| 7 | 商业发布、法律和运营闭环 | Pending | 阻断真实发布和签约 |
| 8 | 企业 GA 与后续能力 | Future | 不阻断明确受限的首期范围 |

## 3. 已完成前置阶段

### 阶段 0A：基础反馈环和单 Host EditorShell

已完成：根 typecheck/lint/build、文件预算、dist ESM baseline、单 Host `createJWord({ host })`、默认 controller 装配、构造失败回滚和统一 destroy。

剩余 tarball 完整用户旅程不在本阶段重开，归阶段 3。

### 阶段 0B：UI 工作区、Toast、debug、i18n

已完成既定中英文基础设施和 UI 模块接入。后续新增文案及本轮审查确认的遗留硬编码继续按执行规则在对应阶段关闭，不重开阶段 0B；RTL、更广语言、字体和输入法矩阵继续归阶段 8。

### 阶段 0C：OEM Phase 0

`LIC-000` 至 `LIC-012` 已批准。`LIC-013` 保持 `Deferred`：允许内部技术实施，但真实 npm 发布、商业 package 交付和签约必须 fail closed。

## 阶段 1：重建 License 深模块（已完成内部实施退出）

### 目标

关闭公开测试私钥可签发商业 token、调用方可替换信任根、测试 signer 进入正式入口和自研密码缺少审计证据的问题。

### 范围

- Finding：`SEC-01`、`SEC-06`。
- OEM：`LIC-100` 至 `LIC-111`。

### 前置输入

- 已获得批准的 `jword-prod-2026-k1` 生产公钥并用于关闭 `LIC-103`；只有公钥进入仓库。
- 测试 key、临时 key 或调用方注入 key 均不能作为生产 trust store；私钥不得进入仓库、测试或日志。

### 实施顺序

1. `LIC-100`（Completed）：生产入口拒绝仓库测试私钥 token 的回归已完成；缺少可信生产 trust root 时保持 fail closed。
2. `LIC-101`（Completed）：已拆分 feature、error、JWL1 兼容、JWL2 数据形状、trust store 数据形状和未来 handle 承载文件；根入口公开导出与运行时行为保持不变。
3. `LIC-102`（Completed）：已实现两阶段严格 JWL2 parser、固定 `JWL2.<payload>` 签名输入、最小 claims、四种 `licenseClass`、三个模块 feature、资源上限和 canonical 校验；parser 输出仅是未验签内部数据，不建立可信授权 identity，也不得直接进入 handle 状态。
4. `LIC-103`（Completed）：已固定生产 `issuer + keyId` trust lookup，保持默认测试公钥已移除，删除调用方换根入口，并在完整 claims 解析前完成 Ed25519 验签。
5. `LIC-104`（Completed）：仅在 LIC-103 验签成功且时间关系有效后，把 `licenseClass`、module features 和期限登记到模块私有 WeakMap，再生成不可伪造 handle；手工调用 parser、普通对象、类型断言、对象复制或 structured clone 均不能获得可信 handle。
6. `LIC-105`（Completed）：可信 handle 通过 WeakMap identity 后才能创建只含原始 token 的 structured-clone transfer；接收侧复用既有激活路径重新验签、校验时间并创建新 handle。
7. `LIC-106`（Completed）：正式根入口、production src、dist 和 tarball 已删除测试 signer 与 Ed25519 签名入口；等价 JWL1 测试签发只存在于仓库 fixture support，浏览器示例和 `.mjs` smoke 只使用固定 fixture token。
8. `LIC-107`（Completed for internal progression）：实现、当前运行时和 Node 最低版本证据已收口；最低浏览器人工认证按明确风险接受延期，不再阻断后续内部阶段。
   - `LIC-107A`（Completed）：使用精确 `@noble/curves@2.2.0` 和 `@noble/curves/ed25519.js` 替换自研 verifier，保持同步 interface 与 `{ zip215: false }` 严格校验，并通过 RFC 8032、篡改、非法输入和 small-order/non-canonical 拒绝回归。
   - `LIC-107B1`（Completed）：独立 smoke 已从本地 tarball 安装到临时空项目，验证 Node、Vite ES2022、当前 Chromium/Firefox/WebKit、真实 module Dedicated Worker、transfer、篡改拒绝、no-alias 与单一 noble 依赖树。
   - `LIC-107B2`（Conditionally Accepted；manual certification deferred）：Node 20.19.0 已在固定 Docker 镜像中通过，当前 Chromium、Firefox、WebKit 和真实 module Dedicated Worker 自动回归也已通过。Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 尚未实测；该人工矩阵转为对外最低版本认证和商业 GA 前门禁，不再阻断内部阶段推进。最新版 Playwright 结果仍不得描述为最低版本实测证据。
9. `LIC-108`（Completed）：`LIC-108A` 严格 JWL2 signer 与 `LIC-108B` 离线验签/裁剪 CLI 均已按批准契约完成；CLI 固定生产 trust store，只输出裁剪 JSON 或稳定 code，不扩展公开 License API。
10. `LIC-109`（Completed）：JWL2 核心诊断、旧在线状态/offline grace/customerId 清理、DOCX/PDF worker DTO、Collab License alias 和 registry/docs 已收口；runtime/协议只把语言无关 code 与必要结构化字段作为契约。
11. `LIC-110`（Completed）：B1 建立隔离 JWL2 test-only trust/key，B2 迁移 `jwl2.test.ts` 到固定 JWL2 fixture，并在 Gate 5、dist、exports 与 tarball 扫描测试 seed、公钥、keyId、signer 和 fixture 泄漏；不迁移 DOCX/PDF/Collaboration，默认 production trust 继续拒绝测试 token。
12. `LIC-111`（Completed）：B1 将 DOCX、PDF、Collaboration 和 Collab Server 改为必需 License peer 与仓库 devDependency，并验证 pnpm/npm、Node 20.19.0 单 runtime 及双 runtime fail closed；B2 通过 Vite ES2022 `chunk.modules` 和当前 Chromium/Firefox/WebKit 证明三个浏览器消费包进入同一 License runtime module graph。当前浏览器结果不替代 LIC-107B2 最低版本证据。

`LIC-103` 至 `LIC-111` 的命令、数量和失败边界统一记录在 [当前验证计划](10-verification-plan.md)。公开 JWL2 激活、WeakMap handle、时间关系、运行时 feature 检查、identity-checked worker transfer、正式 signer 移除、当前运行时 smoke、严格 JWL2 signer、离线 verifier、稳定诊断、test-only trust/key 产物隔离和单一 runtime identity 已完成。`LIC-107B2` 的最低浏览器人工认证已按明确风险接受转为发布前 Deferred 门禁，阶段 1 对内部研发视为完成并允许进入阶段 2；SEC-01 仍因 JWL1、`allowInsecureFixtureLicense` 和后续调用方迁移保持 Open。

### 最小退出标准

- 仓库测试私钥签发的 token 被生产入口拒绝。
- 生产 trust store 只包含批准的 `jword-prod-2026-k1` 公钥，未知 issuer/keyId 一律拒绝。
- 调用方不能传入公钥、verifier 或 trust replacement。
- 未知 issuer/keyId/class/feature、非规范时间、未来生效、过期和篡改 token 稳定拒绝。
- 正式 tarball 不含私钥、测试 signer、测试 trust store 或调用方换根入口；JWL1 接受路径在阶段 4C 删除。
- 标准向量、focused license tests、typecheck 和 package build 通过。
- Node 20.19.0 已有真实最低版本证据；Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 的人工认证按明确风险接受延期到对应对外兼容声明和商业 GA 前，当前最新版浏览器 smoke 不能替代或冒充该证据。

### 明确不做

不修改 DOCX/native 资源预算，不改协作 admission，不做 OEM Phase 2/3/4/5，不清理 UI 或 wrapper。

## 阶段 2：不可信文件、恢复和 core 数据正确性（Closed）

### 目标

关闭首期本地文档链路中的资源耗尽、非原子恢复、资源重开和纯删除 update 不刷新投影问题。

### 子批次 2A：native 输入预算

- Finding：`SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10`。
- 增加输入 bytes、entry 数、单 entry、总解压体积、压缩比、JSON/checksum 和嵌套 schema 预算。
- 拒绝重复关键 entry、路径穿越、负数/小数计数字段和超预算包。
- 明确 JSZip hard cancel 的真实能力；无法中断的阶段不得虚假声明已取消。

当前状态：Phase 2A、2B 保持 `Closed`。Phase 2C 原 B4 关单曾被多页公开 seam 反例推翻：后页 no-op 后的首页远端删除会让 layout 复用过期前缀。`CORE-01` 与 B3/B4 已完成重开修复、全量门禁和最终 Standards/Spec 双轴复审，Phase 2C 重新 `Closed`；下一边界为 Phase 3。

### 子批次 2B：恢复与资源 roundtrip

- Finding：`SEC-04/PERS-01`、`FMT-03`、`PERS-03`。
- 已在隔离 Y.Doc 中准备恢复；memory 与 storage 统一按 `prepared -> target-applied -> finalized` 编排，pending 不进入普通版本列表，旧 storage 在 restore 时仍 fail closed。
- 已使用格式/schema 2 的 packed-resource 逻辑引用，checksum/integrity 通过后重建运行时 data URL；本方案不引入 object URL owner。
- 两个正式 adapter 已无损复制通用 Y.Text attributes，并单独断言 JWord `run.properties` 不回归；collab 示例仍留作后续独立任务。
- 历史顺序与 append 屏障修复已通过 B2 Standards/Spec 双轴复审，均为 `PASS`、0 finding。B4 中 Persistence focused 为 2 文件/33 测试、package 为 4 文件/41 测试；Native focused 为 2 文件/24 测试、package 为 7 文件/141 测试；fresh build、Core、architecture、types、typecheck、lint 和 whitespace 均通过，B4 最终 Standards/Spec 复审也均为 `PASS`、0 finding。`TEST-BASELINE-01` 收口后根 `pnpm test` 为 235 文件、1238 测试全部通过，Phase 2B 已关单。通用 append CAS/幂等、multi-instance、外部 operation store 和完整 PERS-02 继续归入 Phase 6B。

### TEST-BASELINE-01：历史功能测试基线恢复（2026-07-19）

- 已完成：License test-only seam 与真实 public root marker 拒绝回归、Gate 7 vanilla fixture 路径及其内部导入扫描、3 个 Core 空测试入口删除及 Phase 5 split 断言同步；Gate 5 commercial readiness 通过 `vitest.config.ts` 的 `maxWorkers: 4` 稳定为 6/6。
- 当时根测试：`pnpm test` pretest build 通过；235 个文件、1238 个测试全部通过。该数字是 TEST-BASELINE-01 历史收口证据，不是 Phase 2C 最新根测试。
- Toolbar DOM 测试已移除没有独立设计规范的精确像素间距断言，保留结构分组和非绝对定位契约；Gate 0 Husky 测试按当前 pre-commit 只执行 `pnpm lint` 的真实契约收窄，focused 为 1/1。
- 状态：`Closed`。该基线不再阻断 Phase 2C；Phase 2C 最新根测试为 236 个文件、1244 个测试，见下方子批次 2C 重开证据。

### 子批次 2C：远端纯删除 update

- Finding：`CORE-01`、相关 `CORE-05` dirty 语义。
- 已用纯删除 update 和幂等重放建立公开 seam 回归，并让 `run()`、`applyUpdate()`、`runMutation()` 统一按真实 Yjs transaction 的 struct/state 推进或 delete set 判定 dirty。
- dirty false 已复用 projection/layout、过滤空 history 和 metadata，并避免 shared Editor 的 selection/document refresh；`selectionAfter` 保持独立 selection-only refresh。
- 原关闭状态已被多页反例推翻：后页 no-op 遗留的局部范围会污染后续首页 raw/shared 删除布局。当前已让 dirty `applySyncUpdate()` 和共享 Editor 接收其他实例 dirty 事务时从第一页全量失效，并清除 `layoutDirtyRange`。
- 状态：`Closed`。新增多页与同名本地 command 回归均由红转绿；focused 5 文件/24 测试、Core 73 文件/371 测试、architecture 3 文件/19 测试和根测试 236 文件/1244 测试全部通过，最终 Standards/Spec 均为 `PASS`、0 finding。

### 退出标准

- ZIP bomb、大 JSON、重复 entry、异常压缩比和错误嵌套 schema 稳定拒绝。
- 保存 -> 关闭 -> 重开后 packed bytes 重建为可渲染 data URL，save-load-save 不把 base64 写回 `document.json`。
- memory/storage 的 pending 创建、取消、finalize、CAS 冲突、提交后确认丢失、恢复重试与 observer 前后抛错矩阵证明：普通失败不留下已完成 restore，divergence/recovery-required 可后续收敛，成功只在已确认 finalize 后返回且重试不重复追加。
- 远端纯删除立即刷新 projection/layout，幂等 update 不产生虚假 dirty。

## 阶段 3：发布 artifact 与第三方消费基线

### 目标

形成可交付但尚不真实 publish 的统一 artifact，并证明普通客户项目不依赖 workspace alias 或仓库源码。

### 范围

- 范围：tarball 完整用户旅程、版本、metadata、registry 分层、CI release gate、2FA、provenance、dist-tag、changeset 和 rollback。

### 实施顺序

1. 在干净 SHA 上 fresh build，绑定 lockfile hash 和 artifact hash。
2. 完成 Vanilla/React/Vue/CSS/worker/EditorShell 的 tarball 空项目用户旅程。
3. CI 增加 type、prod audit、release consumer 和 artifact 证据。
4. Base 与商业包形成明确 package 清单；商业包不得包含 TypeScript 源码、构建脚本或 source map。

### 退出标准

同一 SHA 和 artifact 上完成 lint、typecheck、test、build、ESM import、dry-run、consumer smoke、audit 和所需 E2E；真实 publish 仍保持禁用。

## 阶段 4：Professional Editing、Formats 和 JWL1 移除

### 子批次 4A：OEM Phase 2

- OEM：`LIC-200` 至 `LIC-208`。
- Professional Editing 固定检查 `professional.editing`。
- DOCX/PDF 主线程和 worker 固定检查 `formats`。
- raw entitlement 迁移为 opaque handle/transfer；未授权时在解析、布局、资源加载和 `postMessage` 前拒绝。

### 子批次 4B：Formats 正确性与承诺边界

- Finding：`FMT-05`、`FMT-07`、`FMT-08`、`FMT-09`。
- `FMT-03/04/06` 若阶段 2 未关闭，不得进入本阶段发布验收。
- DOCX 对页眉页脚、页码、批注、修订和浮动图片明确修复、opaque 保留或受限兼容策略。
- PDF/大文档取消和坏图片容错按公开承诺范围验收。

### 子批次 4C：OEM Phase 4

- OEM：`LIC-400` 至 `LIC-404`。
- 删除 JWL1 parser、旧 entitlement、旧 signer、操作级 feature key 和调用方公钥注入。
- 未实施 Phase 3 的 collaboration packages 保持 private/unpublished。

### 退出标准

- Professional Editing、DOCX、PDF 和 worker 对同一 token 结果一致。
- Base artifact 不含商业实现，商业 artifact 不含源码/source map。
- 正式入口、tarball、示例和文档不存在 JWL1 接受路径。
- DOCX 受限兼容矩阵、默认另存和用户可见 diagnostic 与销售材料一致；底层 package/worker 保持语言无关 code，内建展示层补齐 `zh-CN` / `en-US`。

## 阶段 5：Core、UI、wrapper 产品化

### 范围

- Core：`CORE-02`、`CORE-04`、`CORE-05`、`CORE-06`、`CORE-07`。
- UI/wrapper：`UI-01`、`UI-02`、`UI-03`、`UI-04`、`UI-05`、`UI-06`、`UI-07`、`UI-08`、`UI-09`。

### 实施原则

- 插件 setup 失败必须事务式回滚已注册能力。
- 查询首尾空格、dirty 语义和监听器异常必须有明确公开行为。
- UI DOM 从 root ownerDocument/defaultView 派生，禁止继续扩大跨 realm 全局 DOM 依赖。
- React/Vue 的 readonly、theme、locale、uiOptions 和 controlled value 按稳定契约更新。
- UI-08 列出的硬编码文案迁入 i18n 字典；新增或修改的 tooltip、aria-label、live region 和错误提示同步补齐 `zh-CN` / `en-US`。
- destroy 和构造失败使用独立清理步骤，单个失败不得跳过后续资源释放。
- 水印和 brand 不宣传为客户端不可绕过的安全边界。

### 退出标准

公开承诺的 Vanilla/React/Vue/iframe 路径有最少 runtime 回归；构造、更新、销毁和跨 realm 路径无资源残留或重复加载。动态 locale 切换不得重建 editor 或 UI root；中文用户界面不得泄漏字典 key，英文用户界面不得残留硬编码中文；用户可见文本、tooltip、aria-label 和 live region 必须同步更新。

## 阶段 6：Collaboration 授权与生产数据面（条件阶段）

### 进入条件

只有明确批准继续协作技术整改或准备销售 Collaboration 时进入。它不是首期 Base + Professional Editing + Formats 的代码依赖。

### 子批次 6A：OEM Phase 3

- OEM：`LIC-300` 至 `LIC-311`。
- Finding：`SEC-02/COLLAB-01/COLLAB-02`、`COLLAB-04`。
- 建立 deployment-level license context 和统一 admission；credential 产生可信 `actorId`。
- body 不能覆盖 history author；删除 tenant/role 虚假表面能力，`documentId` 全部署唯一。

### 子批次 6B：生产数据面

- Finding：`PERS-02`、`SEC-05/COLLAB-05/COLLAB-06`、`COLLAB-07`。
- 为通用 append 建立事务/CAS/幂等 history，并处理 multi-instance、外部 operation store、Origin allowlist、可信代理和共享限流策略；不重复实现已在 2B 前移的 restore 专用 pending 协议与单进程 restore/append 屏障。
- 提供 HTTP+WSS、持久化、readiness/liveness、日志、metrics、备份恢复和 Docker/Compose runbook。
- 所有正式 JWord 服务端只通过不可变版本与 digest 的 Docker 镜像交付；Node 和 server npm package 只位于镜像内，客户应用代码只集成浏览器 SDK并连接 HTTP/WSS endpoint。

### LIC-309 实施编排

LIC-309 是阶段 6 的生产交付收口项，不是独立于 admission 和生产数据面的快捷 Docker 打包。按以下顺序分批批准和验收：

1. `LIC-309A` 生产镜像基础：多阶段构建、固定 Node runtime、非 root、最小运行层和敏感/测试资产排除。
2. `LIC-309B` HTTP/WSS 正式入口：同一镜像默认同时提供 HTTP 与 WebSocket；若拆 deployment，仍复用同一版本镜像、协议和内部 context。该项依赖 `LIC-300/301` 的 deployment factory 与共享 context。
3. `LIC-309C` License/secret：启动前 fail-closed、preset/class 固定、运行中过期 readiness 与写入拒绝。该项依赖 `LIC-301/304`，不得恢复 allow-all `licenseHook`。
4. `LIC-309D` 生产持久化：外部数据库/对象存储 adapter、事务/CAS、幂等、迁移、双实例、备份恢复。该项必须与子批次 6B 的 `PERS-02` 一并关闭。
5. `LIC-309E` 准入和运行治理：可信 `actorId`、Origin、代理、共享限流、health/readiness、日志与 metrics。该项依赖 `LIC-305` 和子批次 6B 的 `SEC-05/COLLAB-05/COLLAB-06`。
6. `LIC-309F` 部署模板与发布验收：Docker Compose 参考部署、同一 image digest 的端到端和故障恢复验证、SBOM、生产依赖清单与镜像扫描；Kubernetes/Helm 需按交付范围另行批准。

每个子批次完成后立即停止等待复核；不得因镜像能够 build/start 就跳过 admission、License、持久化或故障恢复门禁，也不得把现有 Dockerfile 描述为客户生产镜像。

### 退出标准

未准入请求在 storage 前拒绝；双实例并发不丢更新；重启、断网重连、备份恢复和 license 到期路径通过；缺生产配置时拒绝启动。客户宿主不需要直接安装 Node 或导入服务端 npm package，生产镜像不得包含 allow-all admission/license preset 或 volatile-only storage。`LIC-309A` 至 `LIC-309F` 均有同一不可变 image digest 下的可复核证据后，才能关闭 LIC-309。

## 阶段 7：商业发布、法律和运营闭环

### 范围

- OEM Phase 5：`LIC-500` 至 `LIC-508`。
- 法律：`LIC-013`。
- 发布：正式 package、签发台账、KMS/HSM、双人审批、轮换、续期、过期和回滚演练。

### 退出标准

- `LIC-013` 从 `Deferred` 变为 `Approved`。
- 同一干净 SHA 和 artifact 完成全部发布矩阵。
- 完成一次受控签发、客户取包、激活、使用、续期、到期和 key rotation 演练。
- 销售材料、合同、package metadata、SDK 文档和 runtime 对 SKU、期限、源码和兼容边界一致。

## 阶段 8：企业 GA 与后续能力

包括人工读屏矩阵、更广语言和 RTL、完整 Word 语义、复杂表格/脚注/交叉引用、PDF/A/PDF/UA、HA/SLA，以及未来真实需求驱动的 SSO/SCIM/RBAC/ACL。每项另立需求和退出标准，不回填到已关闭阶段。

## 4. 每阶段统一交付格式

阶段结束时必须记录：

1. 已关闭 finding 和 OEM LIC。
2. 实际修改文件及为什么是最小范围。
3. 复现命令、修复后同命令和扩大验证结果。
4. 当前 SHA、dirty flag、环境和 artifact hash。
5. 未执行验证、剩余风险和明确下一阶段。
6. 硬停止：未经确认不自动进入下一阶段。
