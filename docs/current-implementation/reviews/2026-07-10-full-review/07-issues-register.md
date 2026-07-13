# 全量问题台账

> 本台账收录本轮审查识别并去重后的问题。`状态` 初始均为 Open；整改后应补 PR/commit、验证命令、证据 artifact 和关闭日期。优先级表示当前产品目标下的处置顺序，不等同 CVSS。

## 新版执行优先级与范围覆盖

- 第一批已于 2026-07-10 完成：`JWR-P0-006` 中的 `pnpm typecheck` 子任务。
- 第二批已于 2026-07-10 完成：合并处理 `JWR-P0-005`、`JWR-P1-103`、`JWR-P1-106` 和 `JWR-P2-201`，交付单 Host `EditorShell`；其中 `JWR-P0-005` 的 tarball 空项目消费仍待后续发布批次验证。
- 第二批于 2026-07-12 补齐默认能力装配与临时浮层生命周期：工具栏配置中可见的批注、链接、页眉/页脚/页码、查找替换、目录和修订入口不再依赖调用方额外传入 UI controller 配置或 Host；查找替换锚定工具栏按钮，修订在编辑区内完整显示，链接、文档面板、水印和 select 不再同时保持多个临时弹层。
- 2026-07-12 完成左右工作区、Toast、debug 与当前中英文 i18n 治理方案：目录/修订具备标题和独立关闭入口，五批用户文案迁移及 architecture 防回退门禁通过；RTL 和更广语言矩阵仍归 `JWR-P2-211`。
- 阶段 0A 已于 2026-07-11 完成：关闭 `JWR-P0-006` 文件预算红灯和 `JWR-P0-008` 基础 consumer smoke，完成 `JWR-P2-206` 的三个当前目标文件拆分；未进入 OEM License 阶段。
- 第三批 OEM License 深模块尚未开始。
- `JWR-P0-002` 改为删除/deprecate 虚假的 tenant 表面能力并建立单 OEM deployment 契约，不再建设 `(tenantId, documentId)`。
- `JWR-P0-003` 改为统一 deployment admission 和可信 `actorId`。
- `JWR-P1-108`、`JWR-P1-120` 为 V1 明确非目标，保留发现但不阻塞当前 OEM 方案。
- 其余授权、格式和协作整改以[一级 OEM 功能授权与开放文档访问实施方案](../../oem-licensing-open-access-implementation-plan.md)为准。

## P0：阻断当前商业交付

| ID | 领域 | 证据 | 问题 | 主要位置 | 关闭条件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| JWR-P0-001 | 授权 | 静态确认 | 默认验签公钥对应仓库公开测试私钥，默认商业 token 可伪造；测试签发 helper 还在正式根入口。 | `packages/license/src/index.ts:147,233-245,287-311`；`fixtures/license/insecure-test-only-keys.ts:9-13` | 无默认测试信任根；生产内置 `issuer + keyId` trust store；调用方不能注入公钥；fixture 不进 tarball；伪造回归拒绝。 | Open |
| JWR-P0-002 | 旧 tenant 表面能力 | 静态确认/范围已变更 | tenant 只做准入，history/service/lock/storage 仍只按 `documentId`，所以现状不能宣称多租户隔离；新版 V1 也不建设 tenant。 | `packages/collab-server/src/history-routes.ts:99-152,240-253`；`history-service.ts:99-190`；`packages/persistence/src/storage-history-adapter.ts:38-51` | 删除或限时 deprecate `tenantId`/`tenantHook`；一个 deployment 绑定一个 OEM license；`documentId` 全 deployment 唯一；文档明确不支持多租户隔离。 | Open（目标已更新） |
| JWR-P0-003 | Deployment admission | 静态确认 | HTTP auth hook 读不到 credential；返回 userId 被丢弃；history authorId/createdAt 来自客户端。 | `packages/collab-server/src/index.ts:130-144,355-366`；`request-guards.ts:18-36`；`history-routes.ts:243-253` | HTTP/WS 共用 admission port；产生可信 `actorId` request context；body 不能覆盖作者，服务端不无条件信任客户端时间。 | Open（目标已更新） |
| JWR-P0-004 | 文件安全 | 静态确认 | `.jword` ZIP/JSON 解压没有输入、entry、单项、总量和压缩比预算，可造成资源耗尽。 | `packages/native/src/package-readers.ts:45-53,126-238` | 全部资源预算和稳定 diagnostic；ZIP bomb/大 JSON/重复 entry 测试通过。 | Open |
| JWR-P0-005 | 默认集成 | 动态复验/第二批完成并补正 | `createJWord({ host })` 已成为 Quickstart 和默认 vanilla 唯一集成入口；内部固定上中下结构并统一 destroy。最终工具栏配置会自动装配可见工具依赖的批注、链接、页眉/页脚/页码、查找替换、目录和修订 controller，调用方不需要额外 Host。查找替换锚定工具栏按钮下方，修订完整显示在中间编辑区域，临时下拉和弹框按同一时刻最多一个的规则收起。 | `packages/ui/src/editor-shell.ts`；`packages/ui/src/toolbar/panel-lifecycle.ts`；`packages/ui/src/link/controller.ts`；`packages/ui/src/styles/toolbar.css`；对应 UI/Chromium 测试 | 单 Host 源码集成、默认能力、弹层显隐与互斥、demo、Quickstart、销毁和 Chromium smoke 已通过；仍需在发布批次完成 tarball 空项目的编辑、重开和销毁消费验证。 | In Progress（第二批源码范围 Done；完整 tarball 旅程待 JWR-P1-111） |
| JWR-P0-006 | 基础门禁 | 运行复现/阶段 0A 完成 | `pnpm typecheck`、`pnpm lint`、`pnpm build` 和 focused file-budget 均已恢复；三个超预算文件按现有职责拆分，没有调整阈值或跳过检查。 | `packages/core/src/layout/query.ts`；`packages/core/src/layout/query-position.ts`；`packages/core/test/editor/runtime*.test.ts`；`packages/ui/src/toolbar/controller.ts` 及 focused 模块 | 两个 architecture 文件 18/18；门禁计数分别为 827、968、390；受影响 core/UI focused tests 通过。 | Closed（2026-07-11） |
| JWR-P0-007 | 发布产物 | 运行复现/基线已恢复 | fresh build、relative import normalization、core Node ESM import 和 release dry-run 已在阶段 0A 同一工作树通过；更广的发布 artifact/SHA 治理仍归 `JWR-P0-011`。 | `tools/release/gate7-release-dry-run.mjs`；`tools/release/normalize-dist-relative-imports.mjs`；`packages/core/dist/index.js` | 阶段 0A 当前基线 exit 0；正式发布仍需全部入口与 artifact 绑定证据。 | In Progress（dist/ESM baseline Done） |
| JWR-P0-008 | 第三方消费 | 运行复现/阶段 0A 完成 | no-alias smoke 已从本地 tarball 完成安装、解析、typecheck、Vite build 和 Chromium；smoke 使用动态端口，不复用已占用的 5173。 | `tools/release/check-gate7-third-party-smoke.mjs` | 完整 consumer smoke exit 0；Vite、webServer URL 和 baseURL 使用同一动态端口，`--strictPort` 且 `reuseExistingServer: false`。 | Closed（2026-07-11） |
| JWR-P0-009 | DOCX | 静态确认/能力缺口 | 导出省略页眉页脚、页码、批注、修订；浮动图片导入丢失；Word 14 项人工证据 pending。 | `packages/docx/src/export.ts:269-317`；`import-readers.ts:321-340`；`fixtures/docx/compatibility-results.json:17-130` | 明确受限子集且默认另存，或补齐 T2；Word roundtrip 矩阵有真实证据。 | Open |
| JWR-P0-010 | 协作交付 | 静态确认/目标已更新 | 默认 Docker 只启动 HTTP、volatile history、无 admission、license 全放行，不启动持久化 WS。 | `packages/collab-server/Dockerfile:15-23`；`hocuspocus-server.ts:53-70` | 若销售协作，提供真实 HTTP+WS deployment、DB、license context、admission/open-write、backup/restore 与重启验证；不要求 tenant/RBAC。 | Open（条件 P0） |
| JWR-P0-011 | 发布治理 | 静态确认 | 所有包仍 private/0.0.0，license metadata、registry、2FA、provenance、dist-tag、rollback 未完成。 | `docs/current-implementation/release-metadata-audit.md:10-16,76-84` | 正式版本与元数据齐全，runbook 演练通过，经人工审批才 publish。 | Open |
| JWR-P0-012 | 数据完整性 | 静态确认 | restore 先改 Y.Doc 再持久化；后续失败时 API 失败但文档已改变。 | `packages/persistence/src/index.ts:498-525`；`storage-history-adapter.ts:285-319` | 隔离准备+原子提交/CAS；故障注入后文档和历史均不变。 | Open |

## P1：企业 GA 前必须完成

| ID | 领域 | 证据 | 问题 | 主要位置 | 关闭条件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| JWR-P1-101 | native 资源 | 静态确认 | packed bytes 写入 ZIP，但 load 不重建 resource URL；blob 图片跨会话可能失效。 | `packages/native/src/package-codec.ts:51-68,189-235`；`packages/native/src/index.ts:81-128` | 保存-关闭-重开-渲染 E2E 通过，object URL 生命周期明确。 | Open |
| JWR-P1-102 | history 并发 | 静态确认/风险 | 完整文档 load-modify-save + 单进程锁不支持多实例原子 append，可能丢更新或重复版本号。 | `packages/persistence/src/storage-history-adapter.ts:108-150`；`packages/collab-server/src/history-service.ts:99-102` | DB 事务/CAS/幂等 append；双实例竞争测试通过。 | Open |
| JWR-P1-103 | 高级 slot 契约 | 动态复验 | EditorShell 默认使用 editor 区域作为普通 panel 挂载范围，不创建额外包装；只保留 outline/comments/fullscreen 外置 slot，headerFooter/findReplace/revisions 不再被内部 panelHost 覆盖。 | `packages/ui/src/editor-shell.ts`；`packages/ui/src/ui-lifecycle.ts`；对应 create-ui 测试 | 显式外置位置优先，普通 panel DOM 归属、theme 与 destroy 测试通过。 | Closed（2026-07-10） |
| JWR-P1-104 | Vue wrapper | 运行时确认 | absent Boolean prop 归一为 false，覆盖 `uiOptions.readonly: true`。 | `packages/vue/src/index.ts:86-93,225-244` | 未传 prop 时保留 uiOptions；新增最小 wrapper 回归。 | Open |
| JWR-P1-105 | Wrapper 动态状态 | 静态确认 | React/Vue 只同步 value/modelValue，运行时 readonly、theme、locale、uiOptions 不响应。 | `packages/react/src/index.ts:128-171`；`packages/vue/src/index.ts:139-182` | 公开稳定更新 API或明确受控重建；权限/主题/语言动态测试通过。 | Open |
| JWR-P1-106 | 生命周期 | 故障注入/动态复验 | EditorShell 已成为默认唯一销毁所有者；`createJWordUi()` 使用幂等反序清理栈，toolbar 深层失败及 toolbar 完成后的后置 controller 失败都会回滚既有 DOM 和监听。 | `packages/ui/src/editor-shell.ts`；`packages/ui/src/ui-lifecycle.ts`；`packages/ui/test/editor-shell.test.ts` | 深层与后置故障注入后无残留 Shell DOM，登记的 document AbortSignal 全部中止；连续 destroy 不抛错。 | Closed（2026-07-10） |
| JWR-P1-107 | iframe/微前端 | 静态确认/待复现 | core 用 ownerDocument，UI 多处使用全局 DOM 构造器，跨 realm 可能失败。 | `packages/ui/src/comments-rail.ts:630-642` 等 | DOM 能力都从 root ownerDocument/defaultView 派生；iframe E2E 通过。 | Open |
| JWR-P1-108 | 未来文档权限 | 静态确认/范围已变更 | 原 `comment` role 不能形成 comment-only enforcement；新版 V1 对 admission 成功者恒定 write。 | `packages/collab-server/src/hocuspocus-server.ts:185-199` | V1 删除/停用虚假角色承诺并记录 open/write；未来 ACL 立项后再定义可验证 comment protocol。 | Deferred（V1 非目标） |
| JWR-P1-109 | 依赖安全 | 运行复现 | prod audit 有 5 moderate/4 low，主要含 DOMPurify 3.4.2；需要升级或正式豁免。 | `packages/ui/package.json:30-33`；`packages/ui/src/paste/sanitizer.ts:69-99` | 修复版本+粘贴安全回归，或有 owner/到期日的风险豁免。 | Open |
| JWR-P1-110 | 密码实现 | 静态确认/风险 | 自研约 556 行 SHA-512/Ed25519，无独立审计证据。 | `packages/license/src/crypto.ts` | 迁移成熟实现或完成独立密码学审计与向量/模糊测试。 | Open |
| JWR-P1-111 | 集成测试 | 静态确认 | Quickstart/架构测试多为字符串或 compile-only；第三方 smoke 不真实 mount wrapper。 | `tests/architecture/gate7-free-quickstart.test.ts:47-88`；`tools/release/check-gate7-third-party-smoke.mjs:282-482` | tarball runtime 用户旅程覆盖 vanilla/React/Vue/CSS/worker。 | Open |
| JWR-P1-112 | CI 发布门禁 | 静态确认 | CI 缺 test:types、prod audit、release/no-alias、ESM import 和 artifact SHA 证据。 | `.github/workflows/ci.yml:35-57` | fast/release/long matrix 分层，所有发布门禁绑定同一 artifact。 | Open |
| JWR-P1-113 | SSR | 风险/缺测试 | 服务端 attr=`ssr`、客户端首渲染 attr=`client`，只测 renderToString，无 hydration 验证。 | `packages/react/src/index.ts:173-181`；`packages/vue/src/index.ts:184-191` | React/Vue hydration 无 warning，mount/destroy/controlled value E2E 通过。 | Open |
| JWR-P1-114 | 无障碍 | 能力缺口 | 自动化基础存在，但 VoiceOver/NVDA/JAWS 人工矩阵未完成，a11y Host 所有权重复。 | `docs/current-implementation/screen-reader-manual-verification.md`；`ui-lifecycle.ts:94-103` | 发布支持矩阵、人工结果和已知限制齐全。 | Open |
| JWR-P1-115 | 服务防护 | 静态确认/风险 | 默认 CORS `*`；rate limit/锁均为内存且不理解可信代理或 admission actor。 | `packages/collab-server/src/http-utils.ts:136-164`；`index.ts:404-445` | 生产默认 allowlist，可信代理与按 deployment/actor 的分布式限流策略有测试。 | Open |
| JWR-P1-116 | 插件 | 静态确认 | plugin setup 抛错前注册的 command/middleware 不会回滚。 | `packages/core/src/plugins/host.ts:371-449` | 每插件注册事务，setup 失败反序释放，回归测试通过。 | Open |
| JWR-P1-117 | 文档状态 | 运行结果对照 | 7/7 verification/backlog Done 与当前红灯漂移，能力、历史通过、当前 RC 状态混在一起。 | `docs/current-implementation/verification-2026-07-07.md:35-56`；`backlog.md` | 验证记录含 SHA/dirty/artifact；旧记录标记 superseded。 | Open |
| JWR-P1-118 | Wrapper 兼容 | 静态确认 | peerDependencies 锁精确 patch；examples 使用源码 alias，Vue tsconfig 不覆盖 SFC，不能证明第三方兼容。 | `packages/react/package.json:31-34`；`packages/vue/package.json:31-33`；`examples/*/vite.config.ts` | 定义支持范围；tarball/SFC/runtime 矩阵通过。 | Open |
| JWR-P1-119 | 外置 UI | 静态确认/范围已收敛 | EditorShell 不再公开普通 panel 外置 seam；低层 `createJWordUi()` 的 link 默认 Host 文档与实现仍相反，comments/outline/fullscreen 的 ownerDocument/focus 契约仍需验证。 | `packages/ui/src/types.ts:690-693`；`ui-lifecycle.ts:129-135,351-355` | 修正文档与实现差异，并让保留的外置 slots 通过 theme/i18n/focus/destroy 测试。 | Open |
| JWR-P1-120 | 未来 Enterprise Governance | 能力缺口/范围已变更 | SSO/SCIM、组织/RBAC、文档 ACL、可信治理审计、保留删除/legal hold 尚未产品化，且明确不在 V1。 | `docs/current-implementation/backlog.md:285-319` | 不作为 V1 阻断；出现真实治理需求后建立独立 PRD、版本化 adapter/interface 和管理员工作流。 | Deferred（V1 非目标） |
| JWR-P1-121 | 生产运维 | 能力缺口 | 缺数据库 migration、备份恢复、HA、metrics/trace、配额、容量、RPO/RTO 和 runbook。 | `packages/collab-server/*`；`docs/current-implementation/backlog.md:285-307` | 双实例/重启/恢复/故障演练与运维手册通过。 | Open |

## 原始 P2：结构收敛与完整产品阶段

> `JWR-P2-201` 保留原始 ID 便于追踪，但执行优先级已经提升为当前第二批；它不再等待其它 P2 项。

| ID | 领域 | 证据 | 问题 | 主要位置 | 关闭条件 | 状态 |
| --- | --- | --- | --- | --- | --- | --- |
| JWR-P2-201 | EditorShell interface | 动态复验 | 已提供 `createJWord({ host })` 与 `JWordEditorShell`；根 Host 直属 toolbar/editor/status bar，外置位置通过高级 slots，React/Vue wrapper 也只创建一个空 Host。 | `packages/ui/src/editor-shell.ts`；`packages/react/src/index.ts`；`packages/vue/src/index.ts` | 默认路径、固定结构、slots、wrapper 和 public type fixture 通过；`createEditor() + createJWordUi()` 保留为 advanced interface。 | Closed（2026-07-10） |
| JWR-P2-202 | 公开 DOM | 静态确认 | `JWordUiElements` 把大量按钮/menu/input 变成兼容承诺。 | `packages/ui/src/types.ts:816-1053` | 对外收敛到语义 API/粗粒度 slot，迁移说明完整。 | Open |
| JWR-P2-203 | 过度设计 | 静态确认 | 品牌和水印默认使用 subtree observer + 500ms interval，但不是可靠安全边界。 | `packages/ui/src/status-bar/controller.ts:394-470`；`watermark/controller.ts:34-87,183-224` | 默认无轮询；branding 作为可选展示，授权留在 license/server。 | Open |
| JWR-P2-204 | API 命名 | 静态确认 | 公开 API/协议泄露 Gate 5/6 内部阶段词。 | `packages/license/src/index.ts:18-37`；`packages/collab-server/src/index.ts:77-81` | 1.0 前迁移到客户语义名称和正常协议版本。 | Open |
| JWR-P2-205 | 虚假扩展点 | 静态确认 | `snapshotStorage?: unknown` 只有声明没有实现。 | `packages/collab-server/src/index.ts:99-112` | 删除，或提供强类型实现和行为测试。 | Open |
| JWR-P2-206 | 大文件 | 行数/门禁/阶段 0A 部分完成 | `layout/query.ts`、editor `runtime.test.ts` 和 toolbar `controller.ts` 已按 position、初始化测试、page/view/localization/panel/insert 职责拆分；其它登记的大文件不在阶段 0A 范围。 | `packages/core/src/layout/query-position.ts`；`packages/core/test/editor/runtime-initialization.test.ts`；`packages/ui/src/toolbar/{controller,page-controls,view-controls,localization}.ts` | 当前三个目标文件满足原门禁且行为/API focused tests 通过；其余大文件后续独立分批处理。 | In Progress（阶段 0A 目标 Done） |
| JWR-P2-207 | CI 效率 | 静态确认 | pretest/build/size 重复构建，全部长矩阵在单 job 串行，无并发取消/共享 artifact。 | `package.json:17-25`；`.github/workflows/ci.yml:12-57` | 快速反馈和长矩阵分层，复用同一 build artifact。 | Open |
| JWR-P2-208 | 产品状态 | 能力缺口 | 保存、同步、离线、权限、冲突、治理和 support 状态未形成统一 UX。 | `docs/current-implementation/backlog.md:161-331,421-498` | 关键状态可见、可操作、可诊断并有 E2E。 | Open |
| JWR-P2-209 | Word 高级语义 | 能力缺口 | 完整修订、脚注尾注、题注、交叉引用、浮动对象、文本框、复杂表格未完成。 | `docs/current-implementation/backlog.md`；DOCX diagnostics | 支持矩阵和真实 roundtrip 达到产品承诺。 | Open |
| JWR-P2-210 | PDF 合规 | 能力缺口 | 当前基础 export 不等于 PDF/A、PDF/UA、数字签名或合规归档。 | `docs/current-implementation/packages/pdf.md:84-92` | 按目标标准实现并经专用 validator/人工验收。 | Open |
| JWR-P2-211 | 国际化 | 当前中英文 UI 基线已治理/完整能力仍缺口 | 左右工作区、Toast、toolbar、selection actions、剪贴板、链接、批注、表格、媒体、粘贴和页眉页脚的用户可见消息已迁移到实例级中英字典，并增加定向防回退门禁；debug 日志不纳入 i18n。完整 RTL 和更广语言/字体/输入矩阵仍未完成。 | `docs/current-implementation/editor-workspaces-toast-debug-i18n-implementation-plan.md`；`packages/ui/src/i18n.ts`；`tests/architecture/ui-i18n-user-text.test.ts` | 当前计划的中英文 UI 基线完成；后续语言、RTL、字体和输入法支持矩阵通过后才能关闭完整问题。 | In Progress（当前中英文 UI 批次 Done） |
| JWR-P2-212 | AI | 产品顺序 | AI 助手仍是研究项，不应先于隐私、权限、审计和数据边界进入正式销售。 | `docs/current-implementation/backlog.md:485-498` | 独立 PRD、数据治理和审计策略完成后再立项。 | Open |

## 去重说明

- Quickstart 的 mount、CSS、覆盖已加载文档和错误调用形状统一归入 `JWR-P0-005`。
- dist normalization、真实 ESM import 和 dry-run 能力不足统一归入 `JWR-P0-007`；tarball 传递依赖单列 `JWR-P0-008`。
- 原 tenant hook/history/storage 不一致仍归入 `JWR-P0-002`，但新版关闭方式是删除虚假 tenant seam 并采用单 OEM deployment，不再建设 tenant scope。
- UI readonly 不是安全边界属于产品契约；Vue 默认值与动态 prop 分别记录为可复现 bug 和 API 缺口。
- DOCX 具体缺失功能统一归入 `JWR-P0-009`；完整高级 Word 能力作为后续 `JWR-P2-209`，避免重复计数。
