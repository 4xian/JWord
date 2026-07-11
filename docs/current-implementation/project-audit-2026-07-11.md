# JWord 全项目审查（2026-07-11）

> 范围：当前工作区代码、配置、测试，以及 `docs/current-implementation/` 中除 `reviews/` 外的文档。
> 明确未读取、未引用 `docs/current-implementation/reviews/` 下任何文件。
> 结论基于当前未提交工作区；未提交代码，未修改现有实现。

## 1. 总结结论

JWord 当前最准确的定位是：**可嵌入、框架无关、分页式类 Word 编辑 SDK；免费基础编辑与 `.jword` 原生格式，高级格式和协作能力按授权提供，并面向客户自托管协作数据面。**

项目已不是早期 demo：12 个 package 已覆盖 core、官方 UI、native、DOCX/PDF、license、collab、collab-server、persistence、React/Vue 和 devtools，基础编辑功能面较宽，代码边界与测试体系也较完整。

但它仍不适合直接销售：

- 基础编辑 SDK：后期 Alpha / 内部 Beta，尚未真实发布。
- DOCX/PDF：兼容子集 Beta，不能宣称 Word 无损兼容。
- 协作：单实例开发与集成 PoC，不是生产协作平台。
- OEM 授权、购买、交付、续期、轮换和审计：方案阶段。
- 商业可售状态：**未达到，结论为 `REQUEST CHANGES`。**

当前最重要的工作不是继续增加 toolbar、状态栏或插件能力，而是走通：

```text
购买/审批 -> 受控签发 -> 获取 SDK -> 激活高级能力
-> 部署协作服务 -> 用户与文档准入 -> 持久化/备份
-> 续期/过期/轮换 -> 审计与升级
```

## 2. 关键发现

| 严重度 | 发现 | 证据与影响 | 建议 |
| --- | --- | --- | --- |
| Critical | 生产默认信任根可被公开测试私钥伪造 | `packages/license/src/index.ts:145-148,233-245,287-311` 默认使用公开 fixture 公钥并从正式入口导出 signer；对应 seed 在 `fixtures/license/insecure-test-only-keys.ts:9-10`。任何拿到仓库的人都可签发高级 feature token。 | 收费 PoC 前完成生产 trust store、`keyId`/轮换、测试签发入口隔离；正式产物必须拒绝 fixture token。 |
| Critical | HTTP auth hook 无法完成真实用户—文档授权 | `packages/collab-server/src/index.ts:130-144` 的 auth 输入只有 requestId/method/path；`request-guards.ts:18-55` 不传 credential、documentId，也不把认证 principal 交给 tenant/history。 | 建立统一 admission context：credential -> principal -> document access -> license -> storage/audit；服务端覆盖 authorId。 |
| High | 多租户 history 校验与存储主键脱节 | `history-routes.ts:99-152,173-253,277-354` 校验 tenant 后仍只以 `documentId` 访问；history/storage/lock 同样只按 documentId。不同 tenant 使用同名文档会进入同一版本链。 | 若支持多租户，统一使用不可伪造的 `tenantId + documentId` canonical key；若 V1 单实例单 OEM，则删除多租户承诺并设部署硬约束。 |
| High | JWL1 时间与 HTTP entitlement 链路不完整 | `license/src/index.ts:429-455,484-505` 不校验 issuedAt、RFC3339 和 Invalid Date；`collab-server/src/http-utils.ts:90-113` 又丢弃 issuer、issuedAt、signature 等字段，且允许 entitlement 进入 query。 | 严格时间/schema/长度校验；浏览器不再上传部署 license，token 不进 URL；server 使用部署级 license context。 |
| High | `.jword` 打开缺少 ZIP 资源预算 | `packages/native/src/package-readers.ts:45-61,126-249` 直接加载并完整解压 JSON/checksum entry，没有 entry 数、单 entry、总解压大小或压缩比限制。 | 复用 DOCX 的资源预算思路，增加实际读取字节复核和恶意压缩包测试。 |
| High | DOCX 不可信输入仍有危险链接和内存放大面 | `docx/src/import.ts:603-658` 原样接纳 external hyperlink；`ui/src/ui-lifecycle.ts:230-240` 打开前未二次校验。`docx/src/package.ts:384-507` 并行解压全部 opaque part，并把二进制转成 number 数组。 | import/model/UI 三层执行 URL allowlist；opaque bytes 保持 `Uint8Array`，限制并发、总量、数量与压缩比。 |
| High | 协作数据面仍是开发级组合 | HTTP 与 WS 为两个独立 factory；Hocuspocus 未内置生产持久化/备份/HA 组合；默认 history 可为 volatile。当前不能承诺重启不丢状态、多实例或 SLA。 | 提供 production preset：统一 license/admission context、持久化 adapter、WSS/Origin、限额、日志、备份恢复和升级 runbook；缺关键配置时拒绝启动。 |
| Medium | history 作者和 restore 完整性不足 | history 的 authorId/clientId/origin 来自请求体；`persistence/src/storage-history-adapter.ts:285-329` 先修改 live doc，再持久化，保存失败不会回滚。 | principal 决定作者；restore 改为持久化成功后应用，或失败时确定性回滚。 |
| Medium | 依赖审计存在 5 moderate / 4 low | `dompurify@3.4.2` 命中多项 moderate advisory；当前代码使用字符串输入、未使用报告中的 IN_PLACE/hook 前提，未确认可利用，但版本过旧。Vue 2 示例另有 low ReDoS。 | 发布前升级 DOMPurify 至已修复版本并复跑 paste security；Vue 2 仅保留明确的 legacy 示例边界。 |
| Medium | 当前代码拆分闸门失败 | `pnpm test` 当前失败：`packages/core/src/layout/query.ts` 1039/1000、`packages/core/test/editor/runtime.test.ts` 1060/1000；`packages/ui/src/toolbar/controller.ts` 1024/400。另有 `toolbar/dom.ts` 1548、`ui/types.ts` 1074 行。 | 只按职责拆分这些热点；不要借机重构无关代码。 |

补充边界：未发现可确认的硬编码生产 secret、XXE、SSRF 或文件系统路径穿越；粘贴路径的现有 DOMPurify、协议 allowlist 与安全测试有效。插件是同进程可信扩展，不是安全沙箱。

## 3. 产品与功能审查

### 3.1 已达到较好基础的能力

- 输入/IME、选区、撤销重做、基础文字和段落格式、标题与列表。
- 分页 Canvas、纸张与页边距、图片、基础表格、链接、查找替换。
- 批注、基础修订 metadata、主题/i18n、只读交互、状态栏和窄屏适配。
- `.jword` 保存/打开、DOCX import/export、PDF export。
- Yjs 协作、presence、history/offline seam、React/Vue wrapper。
- 包边界、类型测试、no-alias smoke、diagnostics 和隐私裁剪。

### 3.2 首个商业版本应优先补齐

- 完整 track changes，而不是仅 metadata + 接受/拒绝入口。
- 页眉页脚正文编辑、完整 section/page number 行为。
- 表格粘贴、拆分、多方向合并、跨页与复杂表格。
- 保存状态、崩溃恢复、持久化失败恢复和备份恢复演练。
- 用户—文档准入、可信作者、服务端审计和生产协作部署。
- DOCX 真实 Word “打开—编辑—保存—重开”证据和客户文档 corpus。
- 打印/打印预览，或明确将 PDF export 定义为唯一打印交付路径。
- RTL/Bidi、屏幕阅读器人工矩阵、CSP/worker 真实部署验证。

### 3.3 可后置或按客户需求实现

- 脚注/尾注、交叉引用、题注、目录域、公式、拼写/语法。
- 复杂浮动对象、文本框、艺术字、邮件合并。
- Chrome Extension devtools、重型插件写模型、AI assistant。
- SSO/SCIM、复杂 ACL、托管云和审计报表；除非已有明确销售需求。
- 旧二进制 `.doc` 原生解析、宏/VBA 和“100% Word 保真”不建议作为近期目标。

DOCX 应采用四级兼容合同：L1 可编辑保真、L2 可编辑降级、L3 安全 opaque roundtrip、L4 明确不支持。当前 warning、opaque preservation 和 roundtrip diff 方向正确，但 14 个 Word 人工证据仍为 pending。

## 4. 是否存在过度设计

不是模块本身无价值，而是投资顺序失衡：plugin/decorations/telemetry、独立 devtools、双模式 toolbar、状态栏和品牌 DOM 恢复已经形成较大 API 面；与此同时，授权信任根、协作 admission、生产持久化和真实发布仍未闭环。

建议在 1.0/首个收费版本前冻结新的 UI 与 experimental API 扩面。水印和版权 DOM 恢复只能防误删，不能作为商业授权或 DRM。优先把现有模块变成可交付、可运维、可续期的产品。

## 5. 推荐最短推进顺序

1. **恢复当前基线**：修复 2 个架构测试红灯，保持 lint/typecheck/build/test 可重复。
2. **重建授权信任根**：正式 trust store、测试 key 隔离、严格 token/time/schema、签发/轮换/过期演练。
3. **统一协作部署边界**：一个 deployment factory，服务端持有 license；浏览器只持短期用户准入凭证。
4. **修复数据隔离与输入安全**：history canonical key、可信 author、`.jword`/DOCX 资源预算、危险链接、restore 原子性。
5. **交付 production collab preset**：持久化、WSS/Origin、限流、日志、备份恢复、健康/就绪检查、Docker/Compose runbook。
6. **冻结 SKU 与兼容合同**：Free、Formats、Collaboration、Automation；明确离线授权非 DRM、DOCX L1-L4。
7. **完成销售级端到端演练**：购买/审批、取包、激活、自托管、过期/续期、轮换、跨文档/租户拒绝、升级回滚。

## 6. 本次验证

通过：

- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`（由 `pnpm test` pretest 执行）
- 7 个 focused test files，49 tests passed：license、collab-server、DOCX license、native、paste security。
- 另一组安全审查 focused 验证：11 files / 58 tests passed。

失败：

- `pnpm test`：2 个架构测试失败，其余运行未显示业务测试失败。
- `phase5-file-split.test.ts`：toolbar controller 1024 行，预算 400。
- `core-file-budget.test.ts`：`layout/query.ts` 与 `runtime.test.ts` 超过 1000 行。

未执行：完整 Playwright E2E、视觉、benchmark、size、真实 Word、屏幕阅读器、多实例协作和真实发布。因此这些只能标记为缺少当前 fresh 证据，不能宣称通过，也不能直接判为代码 bug。

## 7. 外部调研

详细来源与行业对照见 [editor-sdk-commercialization-research-2026-07-11.md](editor-sdk-commercialization-research-2026-07-11.md)，主要引用 ECMA-376、Microsoft Open XML、Hocuspocus、OWASP WebSocket、CKEditor、Tiptap 和 Keygen 官方资料。
