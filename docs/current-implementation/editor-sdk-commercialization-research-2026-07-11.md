# JWord 文档编辑 SDK 商业化与产品能力调研

> 日期：2026-07-11。范围：官方/标准组织资料、当前仓库代码及 `docs/current-implementation/` 非 `reviews/` 文档。本文未读取 `docs/current-implementation/reviews/` 下的任何文档，也不把现有计划当成已实现事实。

## 1. 结论

JWord 当前更接近“功能较宽的私有预发布 SDK”，还不是可直接销售和交付的商业产品。编辑内核、UI、`.jword`、DOCX/PDF、协作客户端/服务端、持久化和本地签名授权都已有实现；真正缺口集中在商业控制面、生产协作部署模板、授权生命周期和真实兼容证据。

建议产品定位为：**可嵌入、框架无关、分页式文档编辑 SDK；免费基础编辑与原生格式，高级格式转换、协作、历史和自动插入按授权销售；支持客户自托管数据面。** 不应承诺“完全兼容 Microsoft Word”或“无法破解”，而应承诺明确的格式支持等级、签名授权、防普通滥用、服务端强制校验和可审计交付。

## 2. 可走通的商业授权链路

### 2.1 推荐分层

1. **供应商控制面**：客户/组织、合同、SKU、feature、席位/部署额度、授权签发、续期、吊销、激活、审计、下载权限。私钥和 registry token 只在该服务端。
2. **客户后端**：用供应商颁发的客户凭据换取短期 entitlement；把自己的用户、tenant、document 权限映射为短期协作 token。浏览器不得持有供应商私钥或长期 API secret。
3. **浏览器 SDK**：内置供应商公钥，验证短期或离线签名 entitlement；在读取文档内容前做 feature gate。浏览器校验属于提高绕过成本，不是最终信任边界。
4. **客户自托管协作服务**：每次连接和写操作校验用户身份、tenant/document 权限及 `collaboration.server` entitlement；生产数据存客户数据库/对象存储。

Keygen 的官方离线授权方案同样采用公私钥签名、客户端公钥验证、带 TTL 的 license snapshot；TTL 用于让续期、暂停、吊销等状态最终传播。浮动授权则通过 activation/lease、heartbeat 和失联回收席位实现。[离线密码学](https://keygen.sh/docs/api/cryptography) · [离线模式](https://keygen.sh/docs/choosing-a-licensing-model/offline-licenses) · [浮动授权](https://keygen.sh/docs/choosing-a-licensing-model/floating-licenses)

### 2.2 在线与离线产品策略

| 模式 | 适合客户 | 建议机制 |
| --- | --- | --- |
| 在线订阅 | 普通 SaaS/联网内网 | 1~24 小时短期 entitlement；定期刷新；吊销/降级快速生效；服务端记录激活和使用事件 |
| 弱联网 | 偶尔断网部署 | 签名 entitlement + 7~30 天 TTL/宽限；联网后刷新；超期只关闭高级入口，不损坏已有文档 |
| 完全离线 | 隔离网/政企 | 客户提交部署指纹，供应商离线签发；明确到期、feature、部署数；通过文件人工续期；接受吊销传播慢的事实 |

必须明确：签名可以阻止伪造 license/keygen，但所有运行在客户设备上的应用都可能被修改以绕过校验。官方资料也将目标表述为“加固、降低滥用”，不是绝对防破解。[Keygen licensing glossary](https://keygen.sh/beginners-guide-to-software-licensing/glossary) · [Secure license keys](https://keygen.sh/blog/how-to-generate-license-keys)

因此商业保护应组合：私有包下载权限、签名 entitlement、短 TTL/激活额度、协作与可选转换服务端校验、版本更新/支持权益、合同与审计。水印或前端隐藏按钮不能作为授权根。

## 3. 当前授权实现对照

已具备：

- `packages/license/src/index.ts` 已有 Ed25519 `JWL1`、issuer/issuedAt/expiresAt/offlineGraceDays、硬编码默认公钥和 feature matrix。
- DOCX、PDF、协作客户端/服务端在执行层调用 entitlement 校验，不只依赖 UI；未授权时使用稳定 diagnostic。
- `packages/collab-server` 已有 `authHook`、`tenantHook`、`licenseHook`、read/comment/write 角色、HTTP payload/rate-limit、history storage seam。
- `tools/license/issue-license.mjs` 已提供签发入口，私钥不应进入仓库。

尚未形成闭环：

- 无客户门户、订单/SKU、组织成员、激活/席位、在线续期、吊销、usage metering、webhook 或授权审计服务。
- 所有 package 仍为 `private: true`；没有“购买后如何获得包、版本和文档”的交付链路。
- `JWordLicenseValidationOptions.publicKeyBase64Url` 是公开运行时参数，collab client 也公开透传 `licenseValidation`。若目标是供应商统一信任根，客户代码可替换公钥；应把 OEM 自有密钥能力与标准发行版拆开，标准发行版不接受运行时换根。
- 本地 entitlement 的 `status: server-unavailable` 由宿主传入，不等于真实在线状态；需要供应商控制面签发的短期状态证明。

## 4. 客户自托管协作服务应如何交付

Tiptap/Hocuspocus 官方做法是在 `onAuthenticate` 校验用户是否有权访问当前文档，并可把连接设为只读；其文档明确建议安全关键场景使用认证 hook。[Hocuspocus collaborative editing](https://tiptap.dev/docs/hocuspocus/guides/collaborative-editing) · [server hooks](https://tiptap.dev/docs/hocuspocus/server/hooks)

建议提供一个可部署参考栈，而不只提供库：

```text
客户应用后端 -> 签发短期 user/tenant/document/role token
浏览器 SDK -> WSS -> JWord collab gateway
                         |- auth + tenant/document ACL
                         |- vendor entitlement cache
                         |- Yjs sync
                         |- history/update storage
                         |- audit/metrics/rate limits
```

生产必需项：TLS/WSS、Origin allowlist、短期 token、每次写入的文档级授权、tenant 复合存储键、持久化数据库、备份/恢复、连接/拒绝/限流/异常断开审计、消息和连接大小限制、健康检查与版本兼容。OWASP 对 WebSocket 同样要求 WSS、Origin 验证、消息级授权、输入/大小限制、限流及安全事件日志，且不得记录完整文档或 token。[OWASP WebSocket Security](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)

当前 reality check：HTTP 入口已有较多防护 seam；Hocuspocus 入口仍未暴露明确的 Origin allowlist、消息大小/连接限额和审计 logger。`tenantHook` 缺失时仅按 room 前缀解析后放行，volatile history 也只是 demo fallback。应新增“production preset”：缺少 tenant/auth/license/persistent storage/allowed origins 任一项即拒绝启动。

## 5. DOCX 兼容策略

DOCX 是 OOXML/OPC 包，不是单一 HTML 格式。ECMA-376 包含词汇、打包、Markup Compatibility and Extensibility、Transitional migration 四部分；不同生产者和版本还会带不同 feature set。[ECMA-376](https://ecma-international.org/publications-and-standards/standards/ecma-376) · [Microsoft markup compatibility](https://learn.microsoft.com/en-us/office/open-xml/general/introduction-to-markup-compatibility)

成熟转换产品也公开“不支持/部分支持”矩阵：CKEditor 的导入会按编辑器插件过滤内容，分页不能恢复 Word 原始分页；导出仍列出 media、公式、部分修订和 widget comments 等限制。[Import from Word](https://ckeditor.com/docs/ckeditor5/latest/features/converters/import-word/import-word.html) · [features comparison](https://ckeditor.com/docs/ckeditor5/latest/features/converters/import-word/features-comparison.html) · [Export to Word known issues](https://ckeditor.com/docs/ckeditor5/latest/features/converters/export-word.html)

因此 JWord 不应追求模糊的“100% 兼容”，应定义四级合同：

- **L1 可编辑保真**：段落/run、标题、列表、基础表格、图片、链接、分页参数、页眉页脚。
- **L2 结构保留/可编辑降级**：批注、修订、复杂列表/表格、字段、书签、分节。
- **L3 opaque roundtrip**：编辑器不理解，但安全 part/relationship 原样保留；编辑后可能失效的内容必须 warning。
- **L4 不支持**：宏、OLE、外链危险资源、旧二进制 `.doc`、无法安全保留的复杂 drawing。

当前实现已经采用 warning、opaque preservation、roundtrip diff，是正确方向；但仍缺 Microsoft Word 桌面真实打开—编辑—保存—重开证据，复杂浮动对象、脚注尾注、交叉引用、复杂修订/表格也未完成。旧 `.doc` 建议长期明确不做原生解析；确有客户需求时采用隔离的服务端 LibreOffice/商业转换器，并把转换器版本、恶意文件扫描、超时和沙箱作为独立产品能力。

## 6. 类 Word 能力分级与 JWord 现状

主流编辑器把基础编辑保持模块化，把 comments、track changes、版本历史、协作、Word 转换、分页、脚注等作为高级/付费能力。CKEditor 和 Tiptap 的官方功能目录也采用这种分层。[CKEditor features](https://ckeditor.com/ckeditor-5/features) · [Tiptap docs](https://tiptap.dev/docs)

| 层级 | 建议能力 | JWord 判断 |
| --- | --- | --- |
| 免费必需 | 输入/IME、选区、撤销重做、复制粘贴清洗、基础文字/段落、标题、列表、表格、图片、链接、查找替换、只读、保存打开、a11y、窄屏适配 | 大部分已有；重点应转为真实浏览器、屏幕阅读器和大文档质量，而非继续扩面 |
| 文档型必需 | 分页、页边距/纸张、页眉页脚/页码、打印/PDF、样式一致性、Word 粘贴 | 已有较多实现；实际 Word/PDF 视觉证据仍不足 |
| 付费核心 | DOCX/PDF、高质量评论/修订、多人协作、presence、权限、历史、离线、服务端部署 | 模块已存在，但生产部署、完整 review flow 与商业授权闭环未完成 |
| 可选增强 | 脚注尾注、目录、交叉引用/题注、公式、复杂浮动对象、模板/合并字段、拼写语法、AI 自动插入 | 应由客户场景驱动，不应阻塞首个商业版本 |
| 不建议近期投入 | 旧 `.doc` 原生解析、宏/VBA、Word 全格式 100% 保真、重型插件平台 | 成本和安全边界过大，不符合首发闭环 |

目前 plugin/decorations/telemetry/devtools、复杂水印防篡改等投入相对领先于客户购买、激活、部署和运维流程。它们不是无价值，但在首个商业版本前属于次优先级；尤其水印不能替代服务端授权。

## 7. 建议推进顺序

1. **先定义可卖 SKU 与兼容合同**：Free、Formats、Collaboration、Automation；列清 feature、期限、部署/席位和 L1~L4 DOCX 范围。
2. **补最小授权控制面**：组织/客户、license、activation、短期 entitlement、吊销、审计 API；标准发行版冻结信任根。
3. **交付 production collab preset**：Docker/Compose、PostgreSQL/对象存储 adapter、反向代理/WSS、强制 hooks、Origin/限额/日志、备份恢复 runbook。
4. **建立销售级证据**：第三方安装、购买后取包、在线/离线激活、过期/吊销、跨 tenant 拒绝、Word fixture、故障恢复完整演练。
5. **再补高价值业务缺口**：完整修订接受/拒绝、复杂表格、脚注/目录/交叉引用；按客户需求逐项扩展，不以“Word 功能总量”作为路线图。

按目标衡量，当前可粗分为：编辑 SDK 技术底座约进入后期，商业可交付链路仍处早期。下一阶段的成功标准不是再增加一批 toolbar 功能，而是让一个新客户能够完成“购买 -> 获取 SDK -> 激活 -> 集成 -> 自托管协作 -> 续期/吊销 -> 审计与升级”的端到端演练。
