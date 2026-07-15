# 统一整改阶段与实施路线

> 本文件是全项目唯一实施顺序。详细技术设计继续引用 OEM 实施方案和本目录分领域 finding，不在多个计划中重复维护同一状态。

## 1. 执行规则

1. 严格按阶段顺序执行；进入下一阶段前必须完成当前阶段退出标准和文档回写。
2. 每次只实施一个阶段或阶段内明确标记的子批次，不顺便修复相邻问题。
3. 开始前先用同一条聚焦验证复现；修改后复跑同一验证，再扩大到阶段矩阵。
4. 只修改当前阶段必需文件；发现新问题先登记，不自动扩大范围。
5. 不执行真实 publish，不自动提交代码。真实发布必须同时满足 `LIC-013` 和阶段 7 门禁。

## 2. 阶段总览

| 阶段 | 名称 | 状态 | 是否阻断下一步 |
| --- | --- | --- | --- |
| 0A | 基础反馈环和单 Host EditorShell | Completed | 已退出 |
| 0B | UI 工作区、Toast、debug、i18n | Completed | 已退出 |
| 0C | OEM Phase 0 产品与技术输入 | Completed / 法律 Deferred | 允许内部实施，阻断外部发布 |
| 1 | 重建 License 深模块 | **Next / Not Started** | 阻断收费 PoC 和商业模块迁移 |
| 2 | 不可信文件、恢复和 core 数据正确性 | Pending | 阻断可处理不可信文档和受控 PoC |
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

已完成既定中英文治理和 UI 模块接入。RTL、更广语言、字体和输入法矩阵继续归阶段 8，不重开已完成实施方案。

### 阶段 0C：OEM Phase 0

`LIC-000` 至 `LIC-012` 已批准。`LIC-013` 保持 `Deferred`：允许内部技术实施，但真实 npm 发布、商业 package 交付和签约必须 fail closed。

## 阶段 1：重建 License 深模块（当前下一步）

### 目标

关闭公开测试私钥可签发商业 token、调用方可替换信任根、测试 signer 进入正式入口和自研密码缺少审计证据的问题。

### 范围

- Finding：`SEC-01`、`SEC-06`。
- OEM：`LIC-100` 至 `LIC-111`。

### 前置输入

- 必须获得批准的 `jword-prod-2026-k1` 生产公钥，才能关闭 `LIC-103` 和本阶段。
- 生产公钥缺失时保持 fail closed；测试 key、临时 key 或调用方注入 key 均不能作为生产 trust store。

### 实施顺序

1. `LIC-100`：先增加生产入口拒绝仓库测试私钥 token 的红灯测试。
2. `LIC-101/102`：拆分 JWL2 schema、feature、error、trust store 和 handle；实现严格 parser。
3. `LIC-103/106/110`：固定生产 `issuer + keyId` trust store，移除默认测试公钥、正式 signer export 和调用方换根入口。
4. `LIC-104/105`：实现 WeakMap-branded handle、时间检查和 identity-checked worker transfer。
5. `LIC-107`：迁移成熟 Ed25519 实现，或完成独立审计、标准向量和必要的模糊验证。
6. `LIC-108/109/111`：收口签发工具、稳定 diagnostics 和单一 runtime identity。

### 最小退出标准

- 仓库测试私钥签发的 token 被生产入口拒绝。
- 生产 trust store 只包含批准的 `jword-prod-2026-k1` 公钥，未知 issuer/keyId 一律拒绝。
- 调用方不能传入公钥、verifier 或 trust replacement。
- 未知 issuer/keyId/class/feature、非规范时间、未来生效、过期和篡改 token 稳定拒绝。
- 正式 tarball 不含私钥、测试 signer、测试 trust store 或调用方换根入口；JWL1 接受路径在阶段 4C 删除。
- 标准向量、focused license tests、typecheck 和 package build 通过。

### 明确不做

不修改 DOCX/native 资源预算，不改协作 admission，不做 OEM Phase 2/3/4/5，不清理 UI 或 wrapper。

## 阶段 2：不可信文件、恢复和 core 数据正确性

### 目标

关闭首期本地文档链路中的资源耗尽、非原子恢复、资源重开和纯删除 update 不刷新投影问题。

### 子批次 2A：native 输入预算

- Finding：`SEC-03/FMT-01`、`FMT-04`、`FMT-06`、`FMT-10`。
- 增加输入 bytes、entry 数、单 entry、总解压体积、压缩比、JSON/checksum 和嵌套 schema 预算。
- 拒绝重复关键 entry、路径穿越、负数/小数计数字段和超预算包。
- 明确 JSZip hard cancel 的真实能力；无法中断的阶段不得虚假声明已取消。

### 子批次 2B：恢复与资源 roundtrip

- Finding：`SEC-04/PERS-01`、`FMT-03`、`PERS-03`。
- 在隔离 Y.Doc 中准备恢复，通过事务/CAS 原子提交。
- packed resource 重开后重建可渲染资源，并定义 object URL 生命周期。
- 通用 Y.Text attributes 的无损需求按 P2 独立处理，不把 JWord run.properties 误判为丢失。

### 子批次 2C：远端纯删除 update

- Finding：`CORE-01`、相关 `CORE-05` dirty 语义。
- 用纯删除 update 和幂等重放先建立回归测试，再统一真实 transaction 变化判定。

### 退出标准

- ZIP bomb、大 JSON、重复 entry、异常压缩比和错误嵌套 schema 稳定拒绝。
- 保存 -> 关闭 -> 重开 -> 图片渲染成功。
- 故障注入后当前文档和 history 均不变。
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
- DOCX 受限兼容矩阵、默认另存和用户可见 diagnostic 与销售材料一致。

## 阶段 5：Core、UI、wrapper 产品化

### 范围

- Core：`CORE-02`、`CORE-04`、`CORE-05`、`CORE-06`、`CORE-07`。
- UI/wrapper：`UI-01`、`UI-02`、`UI-03`、`UI-04`、`UI-05`、`UI-06`、`UI-07`、`UI-08`、`UI-09`。

### 实施原则

- 插件 setup 失败必须事务式回滚已注册能力。
- 查询首尾空格、dirty 语义和监听器异常必须有明确公开行为。
- UI DOM 从 root ownerDocument/defaultView 派生，禁止继续扩大跨 realm 全局 DOM 依赖。
- React/Vue 的 readonly、theme、locale、uiOptions 和 controlled value 按稳定契约更新。
- destroy 和构造失败使用独立清理步骤，单个失败不得跳过后续资源释放。
- 水印和 brand 不宣传为客户端不可绕过的安全边界。

### 退出标准

公开承诺的 Vanilla/React/Vue/iframe 路径有最少 runtime 回归；构造、更新、销毁和跨 realm 路径无资源残留或重复加载。

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
- 建立事务/CAS/幂等 history、Origin allowlist、可信代理和共享限流策略。
- 提供 HTTP+WSS、持久化、readiness/liveness、日志、metrics、备份恢复和 Docker/Compose runbook。

### 退出标准

未准入请求在 storage 前拒绝；双实例并发不丢更新；重启、断网重连、备份恢复和 license 到期路径通过；缺生产配置时拒绝启动。

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
