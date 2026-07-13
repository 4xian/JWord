# JWord 全项目审查差异与整改阶段（2026-07-11）

## 1. 当前结论

两轮审查的商业结论一致：JWord 已具备较宽的编辑 SDK 技术底座，但授权信任根、协作准入、数据安全、第三方交付和生产运维尚未闭环，当前仍是 `REQUEST CHANGES`，不能直接作为完整商业产品销售。

本计划以以下文档共同为基线：

- `docs/current-implementation/reviews/2026-07-10-full-review/06-remediation-roadmap.md`
- `docs/current-implementation/reviews/2026-07-10-full-review/07-issues-register.md`
- `docs/current-implementation/reviews/2026-07-10-full-review/08-verification-evidence.md`
- `docs/current-implementation/oem-licensing-open-access-implementation-plan.md`
- `docs/current-implementation/project-audit-2026-07-11.md`

产品范围以 OEM 方案为准：V1 是一个 deployment 对应一个 OEM license，`documentId` 在全部署唯一；通过 deployment admission 的用户固定获得 `write`。V1 不建设 tenant、RBAC、ACL、SSO 或 SCIM。

## 2. 两轮审查差异

| 项目 | 2026-07-10 full review | 2026-07-11 独立审查 | 当前处理 |
| --- | --- | --- | --- |
| 产品结论 | 不可直接销售，授权、协作、发布阻断 | 同样为 `REQUEST CHANGES` | 一致，继续执行整改 |
| 执行管理 | 有 JWR 编号、P0/P1/P2、关闭条件和 OEM Phase 0~5 | 更偏独立风险复核和行业对照 | 以 7 月 10 日台账管理关闭，以 7 月 11 日补充新问题 |
| 默认集成 | EditorShell 已完成 | 将默认集成视为已有较好基础 | 已完成源码阶段，不重复实施；仅补 tarball 消费验收 |
| 基础门禁 | typecheck/lint 已恢复，文件预算失败 | live 复验得到相同文件预算失败 | 阶段 0A 已按职责拆分并恢复 18/18 |
| dist/ESM | 当时 normalization 和 Node import 失败 | 7 月 11 日 build 通过但未单列最新 import 状态 | 当前已复验通过，JWR-P0-007 该子项可标完成 |
| 第三方消费 | 当时安装阶段请求 registry 包 | 未完整跑到浏览器 | 阶段 0A 已完成 tarball、no-alias、typecheck、build 和 Chromium；动态端口不复用 5173 |
| License | 测试私钥可伪造默认 token；已有详细 JWL2 深模块方案 | 同样列为 Critical，并补充 JWL1 时间/schema、query entitlement 问题 | 最高商业风险；基线恢复后立即处理 |
| 协作模型 | 已冻结为单 OEM deployment、open/write，不做 tenant/ACL | 调研中同时讨论通用 tenant/document ACL | 不采用通用多租户扩展；按 OEM 方案做 deployment admission 和可信 actorId |
| `.jword`/restore | ZIP 预算、资源重开、restore 原子性均已发现 | 再次确认 ZIP DoS 与 restore 风险 | 合并处理，不重复建项 |
| DOCX 安全 | 重点是能力子集、浮动图片和 Word 人工证据 | 新增 external hyperlink 协议 allowlist、opaque part 内存放大 | 新增到输入安全阶段 |
| 首发功能范围 | DOCX、协作按是否进入销售范围设为条件批次 | 倾向把完整修订、复杂表格等列为首版优先 | 以销售承诺为门槛；未承诺的高级 Word 功能不阻塞受控 PoC |

## 3. 已完成、部分完成与仍有效

### 已完成或当前已通过

- `pnpm typecheck`、`pnpm lint`、`pnpm build`。
- 单 Host `createJWord({ host })`、Quickstart、默认 vanilla、构造失败回滚和幂等 destroy。
- `node tools/release/normalize-dist-relative-imports.mjs --check`。
- `node --input-type=module -e "await import('./packages/core/dist/index.js')"`。
- release dry-run 当前退出 0；但它仍不能替代真实 consumer 和发布治理。
- 文件预算 architecture tests 已恢复为 18/18；`query.ts`、`runtime.test.ts`、`toolbar/controller.ts` 的门禁计数分别为 827、968、390。
- third-party tarball smoke 已在 5173 被既有 Vite 占用时完成 pack、install、no-alias、TypeScript、Vite build 和 Chromium 1/1。

### 部分完成

- JWR-P0-005：源码、示例和 Quickstart 已完成，空项目 tarball 的完整编辑/销毁旅程仍待关闭。

### 仍有效的主要阻断

- JWR-P0-001：生产默认测试信任根和正式 signer export。
- JWR-P0-003：统一 deployment admission、可信 `actorId`、服务端作者来源。
- JWR-P0-004 / P0-012 / P1-101：`.jword` 资源预算、原子恢复、资源重开。
- JWR-P0-009：DOCX 承诺范围和 Word 人工证据；另补外链协议与 opaque 内存预算。
- JWR-P0-010 / P1-102 / P1-121：生产协作数据面、事务 history、备份恢复和运维。
- JWR-P0-011 / P1-112：版本、私有分发、CI、provenance、rollback。

## 4. 完整处理阶段

### 阶段 0A：恢复可重复反馈环（2026-07-11 已完成）

范围：只按职责拆分三个超预算文件，不改变公开 API 和行为；同时修复 third-party smoke 的固定端口冲突，使其使用隔离端口或由 runner 分配端口。

关联：JWR-P0-006、JWR-P2-206、JWR-P0-008、JWR-P1-111。

验收：

```bash
pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts
pnpm typecheck
pnpm lint
node tools/release/check-gate7-third-party-smoke.mjs
```

退出标准：文件预算 18/18 通过；tarball consumer 完成 install、typecheck、build 和 Chromium，不依赖仓库 alias，也不与已有开发服务器抢端口。

完成证据：上述退出标准均已满足。smoke 主进程通过 `127.0.0.1:0` 申请一次动态端口，并以 `JWORD_GATE7_SMOKE_PORT` 传给全部 Playwright 进程；生成配置让 Vite `--port`、`webServer.url` 和 `use.baseURL` 使用同一端口，启用 `--strictPort` 并保持 `reuseExistingServer: false`。2026-07-12 另补齐第二批单 Host EditorShell 的默认能力装配：最终工具栏配置中可见的批注、链接、页眉/页脚/页码、查找替换、目录和修订工具会自动创建 controller 并使用内部 Host。查找替换面板已锚定工具栏按钮下方，修订面板在中间编辑区域完整显示，链接、文档面板、水印与 select 临时弹层已补齐互斥和外部点击关闭；目录和批注保持持续工作区语义。本阶段没有进入 License、DOCX 或协作整改。

### 阶段 0B：冻结首期销售合同（可与 0A 并行）

确定 Free、Formats、Collaboration、Automation Relay 的 feature、期限、交付方式、在线/弱联网/离线策略；明确首期是否销售 DOCX 和协作。DOCX 使用 L1~L4 兼容合同，禁止“100% Word 兼容”宣传。

退出标准：OEM 方案 LIC-001~LIC-008 有明确决定；未进入首期合同的能力不再作为当前 P0。

### 阶段 1：重建 License 信任根

执行 OEM Phase 1：移除默认测试公钥和正式 signer export；实现固定 `issuer + keyId` trust store、严格 JWL2 parser、时间/schema/长度校验、WeakMap-branded handle；采用成熟 Ed25519 实现或建立独立审计证据。

关联：JWR-P0-001、JWR-P1-110，以及 7 月 11 日新增的 JWL1 时间与 query entitlement 问题。

退出标准：公开测试私钥签发的 token 被正式入口拒绝；调用方不能换根；tarball 不含私钥、测试 signer/trust store；篡改、过期、未来时间、未知 issuer/keyId 均 fail closed。

### 阶段 2：本地高级格式授权迁移

执行 OEM Phase 2：DOCX/PDF 与 worker 从 raw entitlement 迁移到 opaque license handle；未授权时在解析 ZIP、加载字体/图片或 `postMessage` 前拒绝；worker 使用纯 structured-clone DTO。

退出标准：DOCX import/export、PDF export 和 worker 各有最少成功/拒绝/篡改测试；依赖图只有一份 license runtime。

### 阶段 3：不可信文件与恢复完整性

为 `.jword` 增加输入、entry 数、单 entry、总解压体积、JSON/checksum 和压缩比预算；拒绝重复关键 entry。restore 在隔离文档中准备并原子提交。packed resource 重开后恢复可渲染资源。

同时补 DOCX external hyperlink 协议 allowlist；opaque part 保持二进制表示，限制数量、总量、压缩比和并发，避免转成大 number 数组。

关联：JWR-P0-004、JWR-P0-012、JWR-P1-101，以及 7 月 11 日新增 DOCX 输入安全项。

退出标准：ZIP bomb、大 JSON、重复 entry、危险链接、opaque 超预算均稳定拒绝；保存—关闭—重开—渲染成功；故障注入后当前文档和历史均不变。

### 阶段 4：统一协作准入与开放写入

执行 OEM Phase 3：建立 immutable deployment context，HTTP/WS 共用 license 与 admission；credential 产生可信 `actorId`，在数据读取前完成准入；history author 只能来自 context。删除或 deprecate tenant 表面能力，文档声明 `documentId` 全部署唯一和 open/write。

关联：JWR-P0-002、JWR-P0-003、JWR-P1-108。

退出标准：未准入请求在 storage 前拒绝；body 不能覆盖 author；两个已准入 actor 可写同一文档；浏览器不上传部署 license；不宣传 tenant/RBAC/ACL。

### 阶段 5：生产协作数据面（仅在首期销售协作时为 P0）

提供统一 deployment factory 和可部署 preset：HTTP+WSS、持久数据库、事务/CAS/幂等 history、Origin allowlist、连接与 payload 限额、健康/就绪检查、结构化日志、metrics、备份恢复和 Docker/Compose runbook。

关联：JWR-P0-010、JWR-P1-102、JWR-P1-115、JWR-P1-121。

退出标准：重启恢复、断网重连、双实例并发、备份恢复和 license/admission 拒绝路径通过；缺少关键生产配置时拒绝启动。

### 阶段 6：发布、分发与客户消费闭环

关闭版本和 metadata、私有 registry/离线交付包、2FA、provenance、dist-tag、changeset、rollback；CI 分层并绑定同一干净 SHA 和 artifact hash。第三方空项目覆盖 Vanilla、React、Vue、CSS、worker 和 EditorShell 用户旅程。

关联：JWR-P0-007、P0-008、P0-011、P1-111、P1-112、P1-117、P1-118。

退出标准：干净 RC 上 lint/typecheck/test/build/import/dry-run/consumer/audit/E2E 全部通过；客户能按 Quickstart 从正式 artifact 创建、编辑、保存、重开和销毁。

### 阶段 7：格式销售范围验收（条件阶段）

若首期销售 DOCX：先选“受限子集+默认另存”或“企业互通”路径；完成 14 项真实 Microsoft Word 打开—编辑—保存—重开证据和客户 corpus。PDF 明确是基础导出还是包含 PDF/A、PDF/UA 等合规承诺。

关联：JWR-P0-009、JWR-P2-209、JWR-P2-210。

退出标准：兼容矩阵与合同一致；不支持、降级和 opaque 内容都有用户可见诊断；未完成的高级 Word 语义不进入宣传。

### 阶段 8：私有 SDK Beta 与销售演练

用一个模拟新客户完成：审批/购买、取包、激活、集成、自托管协作、过期、续期、key rotation、吊销限制、升级和回滚；保留人工支持与已知限制。

退出标准：整条链路可复跑并有证据；任何步骤不依赖仓库源码 alias、测试私钥或开发默认配置。

### 阶段 9：企业 GA 与后续产品能力

按真实客户合同补 wrapper 动态状态/hydration、iframe、a11y 人工矩阵、RTL、复杂修订、复杂表格、脚注/目录/交叉引用、HA/SLA 等。SSO/SCIM、组织/RBAC、文档 ACL、AI、旧 `.doc` 原生解析继续作为独立未来项目，不阻塞当前 V1。

## 5. 当前立即执行顺序

1. 阶段 0A 已完成：三个文件预算红灯已关闭，third-party smoke 已使用隔离动态端口。
2. 同时完成 Phase 0 商业输入冻结，不写新 UI 功能。
3. 紧接着执行 License Phase 1；这是任何收费 PoC 前的最高安全阻断。
4. License 稳定后，按销售范围并行进入“本地格式授权迁移”和“协作 admission”。
5. 再完成文件安全、发布消费和条件性的生产协作/DOCX 证据。

在阶段 1、3、4、6 关闭之前，不应宣布“可商业销售”；在阶段 5 未关闭时，不应销售生产多人协作；在阶段 7 未关闭时，只能销售明确受限的 DOCX 兼容子集。
