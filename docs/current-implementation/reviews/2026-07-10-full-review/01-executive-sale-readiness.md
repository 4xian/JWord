# 管理层结论与售卖就绪度

> 后续决策：本报告的整改口径以[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准。V1 不建设 tenant/RBAC/ACL；协作采用单 OEM deployment、deployment admission、可信 `actorId` 和文档 `open/write`。

## 直接结论

当前不能直接按以下三种产品售卖：

- 成熟企业级 Word 替代品。
- 面向公共 registry 的稳定 SDK GA。
- 可直接部署的生产级多人协作服务。

当前 checkout 甚至不适合作为安装包直接交给客户试用，因为基础门禁、Quickstart、发布产物导入和第三方 tarball 安装都未闭环。修完 P0 后，可以把产品定位为“受控环境下的嵌入式分页文档编辑器 SDK beta”，而不是 Office 完全兼容产品。

## 交付形态判定

| 交付形态 | 当前判定 | 前提或原因 |
| --- | --- | --- |
| 内部演示、技术验证 | 可以 | 由研发在 monorepo 环境控制启动、数据和已知限制。 |
| 单客户受控 PoC | 暂不直接交付 | 先修授权信任根、单 Host EditorShell、基础门禁和可安装产物；限定单 OEM deployment、非敏感数据和人工支持。 |
| 私有 SDK beta | P0 修完后可考虑 | 优先限定 `core + ui + native`，DOCX 只承诺受限子集，合同列明不支持项。 |
| 公共 SDK GA | 不可以 | 版本、license metadata、registry、tarball、wrapper、兼容与升级策略未闭环。 |
| 生产 self-host 协作 | 不可以 | deployment admission、可信 actor、并发持久化、WebSocket 文档存储、备份恢复、观测和 HA 未完成。 |
| 企业 Word 替代品 | 不可以 | DOCX 保真、修订、复杂版式、治理、无障碍和人工兼容矩阵不满足。 |

## 能力成熟度

| 能力 | 评价 | 依据 |
| --- | --- | --- |
| core 文档模型、事务、分页与输入 | 黄绿 | 主体架构合理、能力面较广，但当前仍有大文件门禁失败，完整回归未运行。 |
| 官方 DOM UI | 黄 | 功能丰富，但装配、Host、动态权限、跨 realm、销毁所有权和公开 DOM 契约需收敛。 |
| `.jword` 保存/打开 | 黄红 | 基础 ZIP/checksum/schema 存在；资源重开、解压限额和恢复原子性未闭环。 |
| PDF 导出 | 黄 | 基础导出已实现；CJK 字体配置、合规格式和人工验证仍有限。 |
| DOCX 互通 | 红 | 明确省略企业常用语义，复杂对象降级，Word 桌面矩阵 14/14 pending。 |
| React/Vue wrapper | 黄红 | 有生命周期壳和 SSR 字符串测试；readonly、动态主题/语言/权限和 hydration 未完成。 |
| 协作客户端 | 黄 | Yjs/provider/history/offline 等契约可用于试验，仍需与生产服务端共同验收。 |
| 协作服务端 | 红 | deployment admission、可信 actor、事务持久化、WS 存储和部署形态不满足生产要求。 |
| 授权与收费 | 红 | 默认信任根可被公开测试私钥伪造，是直接商业阻断。 |
| 企业治理与合规 | 红 | SSO/SCIM、组织权限、审计报表、保留/删除、legal hold 等仍是 backlog。 |
| 发布与运维 | 红 | 当前 dist 不可导入、no-alias 安装失败、包仍 private/0.0.0，CI 缺发布消费证据。 |

## 可以与不可以对外宣称的内容

当前可以在技术交流中描述：

- 框架无关的分页 Canvas 编辑器内核。
- 结构化文档模型、统一 command/transaction 写路径和只读 projection。
- 图片、基础表格、批注、查找替换、页眉页脚配置、修订 metadata 等基础能力。
- `.jword` 原生包、基础 PDF、受限 DOCX 子集和 Yjs 协作底座。
- React/Vue 集成预览、diagnostics 与插件扩展基础。

当前不应对外宣称：

- Office/Word 完全兼容或无损 DOCX roundtrip。
- 生产级多租户隔离、文档级权限、可信审计、企业治理或合规就绪；这些能力不在 V1 范围内。
- 可直接部署的 HA 协作平台、备份恢复或 SLA。
- 已完成 VoiceOver/NVDA/JAWS 认证或完整 RTL。
- 状态栏/水印防篡改属于 DRM、安全或授权边界。
- 当前 API 已达到 1.0 stable，或当前包可直接从 registry 安装。

## 企业级要求差距

企业级不只是“功能数量多”。本项目当前的主要差距集中在以下可验证维度：

1. **安全边界**：授权信任根、deployment admission、可信 actor 和不可信文件资源限额必须成立；V1 以 deployment 为隔离边界，不宣传 tenant/document ACL。
2. **数据完整性**：保存、恢复、协作追加需要事务性、幂等、并发控制和失败回滚。
3. **兼容承诺**：DOCX/Word 需要支持矩阵、降级策略、真实桌面应用打开-编辑-保存-重开证据。
4. **部署运维**：持久数据库、migration、备份恢复、HA、指标、trace、告警、容量和故障演练不可缺失。
5. **治理合规**：组织/角色/资源权限、SSO/SCIM、治理审计、保留删除和隐私边界属于未来 Enterprise Governance；实现前不得宣称具备，但不作为当前 V1 的关闭条件。
6. **开发者体验**：Quickstart、CSS、生命周期、单 Host 接入、wrapper、版本和迁移必须可复制。
7. **发布质量**：干净 RC、可导入 dist、真实 tarball 消费、依赖审计和完整 CI 证据必须绑定同一 SHA。

## 建议商业定位

短期定位应收敛为：

> 面向受控私有集成场景的 pre-GA 分页文档编辑器 SDK，提供基础编辑、原生 `.jword` 和有限格式互通；高级协作与企业治理仍处于产品化阶段。

这个定位允许项目继续获取客户反馈，也不会用“企业 Word 替代品”的承诺掩盖当前数据保真、安全和运维缺口。进入企业 GA 的具体条件见 [06-remediation-roadmap.md](06-remediation-roadmap.md)。
