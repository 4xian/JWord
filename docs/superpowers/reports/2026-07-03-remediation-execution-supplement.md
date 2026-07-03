# JWord 修复执行补充：预置决策与大任务拆解（2026-07-03）

> 本文档是 `2026-07-02-jword-remediation-plan.md`（下称"修复计划"）的执行补充。
> 修复计划回答"修什么、按什么顺序"；本文档回答"怎么修"——把修复计划中工作量为 L/XL 的任务拆成可直接执行的子步骤，把设计类任务的方案定稿，把产品/商业类悬而未决的问题预先做出默认决策。
> **优先级规则：凡本文档收录的任务，以本文档的拆解与决策为准；未收录的任务仍按修复计划条目执行。**
> 决策标注"（可推翻）"的条目，如人工给出不同结论，以人工结论为准并回写本文档。

## 任务映射表

| 修复计划任务 | 本文档章节 | 性质 |
|---|---|---|
| G1-02 deleteRange 跨 run/跨块（含 G3-02 R3 跨 section） | §3.1 + D9 | 拆解 |
| G2-02 + G2-20 表格跨页与续排段前距 | §3.2 | 拆解 |
| P-1 PDF 文本样式渲染 | §3.3 | 拆解 |
| LIC-1 license 密码学签名 | §3.4 + D1 | 设计定稿 + 拆解 |
| G6-H5 + 计划审查 3.11 tenant 隔离与权限粒度 | §3.5 | 设计定稿 + 拆解 |
| G2-04/06/07 字体度量真实测量 | §3.6 | 拆解 |
| PDF 字体子集化 + fallback（Phase 3C） | §3.7 | 拆解 |
| 修订接受/拒绝（Phase 3B） | §3.8 + D4 | 决策 + 拆解 |
| Phase 4 性能专项（P95 < 50ms） | §3.9 | 拆解 |
| Phase 5 超大文件拆分 | §3.10 | 目标结构 |
| Phase 6 Plugin API 前置改造 | §3.11 | 里程碑拆解 |
| 计划审查 2.1 协同输入 rebase 评估 | §3.12 + D7 | 评估方法定稿 |
| gate7 R3 发布/no-alias 消费闭环 | §3.13 + D2 | 决策 + 拆解 |
| 页眉页脚富文本编辑（Phase 3B） | D3 | 决策：post-1.0 |
| 计划审查 3.12 Worker 降级 | D5 | 决策 |
| 计划审查 3.13 浏览器支持矩阵 | D6 | 建议默认值 |
| 计划审查 3.16 版本历史与 Yjs GC | D8 | 决策 |

---

## 一、预置决策记录（D1-D9）

- **D1（LIC-1 签名方案与密钥管理）**：license token 采用 Ed25519 非对称签名；运行环境 WebCrypto 不支持 Ed25519 时，SDK 内置零依赖纯 JS 验签实现作为 fallback（只验签、不签名）。若实施中确认兼容成本过高，允许改用 ECDSA P-256（WebCrypto 全平台支持），改动需回写本决策。私钥绝不进入仓库：签发走 `tools/license/issue-license.mjs` 本地脚本，从环境变量或文件路径读取私钥；仓库内只保留测试密钥对 fixture，文件名与 API 均显式标注 `insecure-test-only`。（可推翻）
- **D2（发布形态）**：1.0 的目标分发形态为**私有 npm registry**；但 1.0 验收门槛先以**本地 tarball no-alias 冒烟**为准（`pnpm pack` → 外部空项目安装 → typecheck/build/浏览器 smoke）。移除可发布包 `private: true`、配置 `publishConfig` 在 tarball 冒烟通过后执行；真实 publish 永远人工审批。（可推翻）
- **D3（页眉页脚富文本编辑）**：移入 post-1.0，本轮修复不实施。理由：工作量 L、复用主编辑管线涉及输入系统改造，且修复计划自己标注"先确认产品优先级"；页眉页脚当前的纯文本编辑能力满足 1.0 需求文档。（可推翻）
- **D4（修订接受/拒绝）**：基础版（单条接受/拒绝）纳入 Phase 3B 末位，允许后置执行、不阻塞里程碑 B；"全部接受/拒绝"与嵌套修订保持 post-1.0。前置依赖：G3-20（修订标记覆盖全部 run）必须先完成。
- **D5（Worker 不可用降级）**：不做同线程 fallback。实施内容收敛为三件事：环境能力检测 API、`WORKER_UNAVAILABLE` 类稳定诊断（失败可观测、不静默挂起）、文档声明 CSP 环境要求（`worker-src` / `blob:` 指令清单）。
- **D6（浏览器支持矩阵，建议默认值，终值需人工确认）**：桌面编辑：Chrome/Edge ≥ 114、Firefox ≥ 115（ESR）、Safari ≥ 16.4；移动端仅承诺只读分页预览。构建 target 与该矩阵对齐（es2022 级），E2E 矩阵维持 Chromium/Firefox/WebKit 最新版 + 该承诺的回归说明。
- **D7（协同输入 rebase）**：先按 §3.12 的方法做并发压测评估；只要最终一致率不是 100%，即切换到替代方案（输入直接经 core command 写本地 Y.Doc，远端仅 `Y.applyUpdate`，textarea 不做 value diff），不再修补 diff/rebase 路径。
- **D8（版本历史与 Yjs GC）**：版本历史**禁止依赖 `Y.Snapshot`**（该路线要求全生命周期 `gc = false`，长文档 tombstone 持续膨胀），固定走"update log + 隔离 Y.Doc 重放"路线。update log 治理默认参数：每 200 个 update 或 5 分钟生成一个 snapshot；compaction 保留最近 50 个 snapshot；更旧数据通过宿主 storage hook 归档。此决策写入技术决策文档，防止后续维护者误引入 Y.Snapshot 依赖。
- **D9（跨 section 删除语义）**：1.0 对跨 section 的删除/剪切/粘贴替换返回**稳定的 unsupported 错误码**（不得静默失败、不得半执行）；真正的跨节合并语义留给 post-1.0。同 section 内的跨段删除必须支持（属 G1-02 范围）。

## 二、时点漂移标准处理流程

审查报告与修复计划是 2026-07-02 的代码快照。执行任何任务时：

1. **定位以文件 + 符号名（函数/类/常量名）为准，行号只作参考**。
2. 修复前必须先在当前代码复现问题（优先写一个失败的单测作为复现证据）。
3. 复现不了时按序处理：
   a. 用 `git log -S "<关键符号>"` 与阅读现行代码确认问题是否已被后续改动修复；
   b. 已修复 → 在修复计划勾选该项并注明"复核确认已自愈（YYYY-MM-DD）+ 证据"，不改代码；
   c. 现状与报告描述不同但问题仍存在 → 按现状修，修复记录中说明差异；
   d. 现状与报告矛盾且无法判断 → 不改代码，记入阶段报告的"待人工裁决"清单，跳到下一项。
4. 任何情况下**以代码现状为准**，禁止为了对齐报告描述而改坏现有正确行为。

## 三、大任务与设计类任务拆解

每个任务的子步骤都要求：红灯测试先行、最小改动、每步有独立验收。步骤间如无标注可按序单人执行。

### 3.1 [G1-02] deleteRange 跨 run / 跨块（Phase 1B，M-L）

前置依赖：无。G3-02（选区回车）依赖本项。

1. **现状确认**：读 `packages/core/src/operations/operation-adapter.ts` 的 deleteRange adapter（报告锚点 519-524 行附近）与 `text-editing-runtime.ts` 中 delete plan 的构造路径；列出当前所有拒绝/错误分支（含 `OPERATION_MERGE_BLOCK_NOT_ADJACENT`）。产出：现状笔记（写进任务记录，不建新文档）。
2. **红灯 fixture 单测**（先全部写完再实现）：同 run 删除（回归基线）、跨 run 同段删除、跨段落删除、跨表格单元格删除（预期：稳定错误码拒绝）、跨 section 删除（预期：按 D9 返回稳定 unsupported 错误）。每类都断言 undo 一步完整恢复。
3. **实现三段式删除**：首 run 尾部截断 → 中间 run/块整体删除 → 末 run 头部截断；跨段时对首尾段执行 mergeBlock 语义；全程单一 `ydoc.transact`。
4. **R3 追加同批**：delete plan / selected target 携带真实 section 与 container id，不再复用起始 sectionId；跨 section 场景按 D9 返回稳定错误。
5. **验收**：步骤 2 的全部单测转绿；`pnpm vitest run packages/core/test/operations/` 相关文件通过；与 G3-02 联调的 e2e（选中跨段文本按 Enter）通过。

### 3.2 [G2-02 + G2-20] 表格跨页断行与续排段前距（Phase 1C，L）

前置依赖：无。两项共改 `ensureLineFits` / `startNewPage`，必须同批。

1. **现状确认**：读 `packages/core/src/layout/engine.ts` 表格分页短路逻辑（报告锚点 564-567 行）与 `paragraph-flow.ts` 的 `ensureLineFits` / `startNewPage`；确认 TableBox 输出结构。
2. **设计延续结构**（10 分钟纸面设计写进任务记录）：TableBox 增加延续标记（如 `continuesFromPreviousPage` / `continuesOnNextPage`）与起始行索引；**行为最小拆分单元**，行内不截断；当前页放不下表格首行时整表下移到下一页。只改 layout 输出层，禁止改文档状态。
3. **红灯布局单测**：20 行高表格跨 2 页——断言两页各有 TableBox、行分布正确、无行截断；首页剩余空间小于首行高时整表出现在第 2 页。
4. **实现行级拆分**。
5. **G2-20 同批**：`startNewPage` 后续排段落不重复计段前距（对齐 Word 语义）；补跨页段落 fixture，断言续排页首行 y 起点。
6. **联动检查**：表格跨页后 `findBlockPageIndexes()` 能命中两页（与 G2-25 dirty page 问题相邻，若 G2-25 未排期则本步只加断言暴露、不顺手扩改）。
7. **验收**：布局单测 + `pnpm test:visual` 新增跨页表格样张（刷新基线需在记录中列明）。表头行重复渲染列为可选后续，不做。

### 3.3 [P-1] PDF 文本样式渲染（Phase 1D，L）

前置依赖：无。拆四个子批，每批独立可验收、可分批提交。

1. **子批 a：bold/italic 字体变体**。字体注册表按 family + weight + style 维度组织：标准字体映射 Helvetica / Helvetica-Bold / Helvetica-Oblique / Helvetica-BoldOblique；嵌入字体在 `PdfFontConfig` 扩展变体注册（缺变体时回退常规变体并产 recoverable warning，不失败）。单测断言 content stream 选用了变体字体。
2. **子批 b：underline / strike**。依据 font metrics 在 baseline 相对位置 `drawLine`，线宽随字号缩放。单测断言内容流包含线条操作符。
3. **子批 c：背景色**。文本绘制前 `drawRectangle`。单测断言矩形先于文本。
4. **子批 d：上下标**。y 偏移 + 字号缩放比例与 canvas renderer 使用的常量对齐——先在 core 找到该比例常量，抽为共享导出再双端消费，禁止两处硬编码。
5. **验收**：四个子批单测全绿；`tools/compat` 视觉报告样张对比（样张包含全部样式组合的一页文档）；对照 canvas 渲染结果人工核对一次。

### 3.4 [LIC-1] license 密码学签名（Phase 1F，M-L，按 D1 执行）

**设计定稿**：
- Token 格式：`JWL1.<base64url(payload JSON)>.<base64url(signature)>`；payload 字段：`licenseId`、`customerId`、`issuer`、`features[]`、`issuedAt`、`expiresAt`、`offlineGraceDays`、`schemaVersion`。
- 验签：SDK 内置 Ed25519 公钥（允许宿主 override 以便测试）；浏览器走 `crypto.subtle.verify`，Node 走 `node:crypto`；WebCrypto 无 Ed25519 时用内置纯 JS 验签 fallback。license 包保持零第三方运行时依赖。
- 兼容迁移：旧 FNV 格式解析保留，但仅在显式 `allowInsecureFixtureLicense: true` 时接受且必产 warning；`tests/architecture/gate5-commercial-readiness.test.ts` 增加"FNV 签名禁止进入发布路径"检查。

**实施步骤**：
1. 现状确认：`packages/license/src/index.ts` 现有契约 + 全部调用方（docx/pdf/collab/collab-server 的 entitlement 校验点）。
2. 红灯单测：篡改 payload 任一字段验签失败；伪造 issuer 失败；过期 / offline grace 语义不回归；Node 与浏览器（jsdom + WebCrypto mock 或真实 e2e）双环境。
3. 实现 token codec + 双环境验签 + fallback。
4. 实现 `tools/license/issue-license.mjs` 签发脚本 + 重新生成全部测试 license fixture（insecure-test-only 命名）。
5. 更新架构测试与全链路授权 focused suites（docx/pdf/collab 的未授权/过期/feature-mismatch 路径）。
6. **验收**：上述测试全绿 + `node tools/release/check-gate5-commercial-pack.mjs`、`check-gate6-commercial-pack.mjs` 通过。密钥轮换、license portal 属 post-1.0，不做。

### 3.5 [G6-H5 + 计划审查 3.11] WebSocket tenant 隔离与权限粒度（Phase 1E，M）

**设计定稿**：
- documentName 约定：`{tenantId}/{documentId}`，缺 tenantId 段时归入 `default` 租户。
- `onAuthenticate` 解析出 `{ tenantId, documentId, userId, token }` 后调用宿主 `authHook`，返回 `{ allow: boolean, role: 'read' | 'write' }`；默认拒绝（与 G6-M4 对齐）。
- `beforeSync` / 消息处理层：`role !== 'write'` 时拒绝写入 update，返回稳定诊断 `COLLAB_PERMISSION_DENIED`；跨 tenant 访问直接拒绝。
- **已知边界（写入文档）**：1.0 权限粒度为 read/write 两级；comment 级权限因批注同样是 Y.Doc update、服务端无法低成本区分，明确列为 post-1.0。客户端 `readonly` 不具备安全语义，文档中显式声明。

**实施步骤**：
1. 现状确认 `packages/collab-server/src/hocuspocus-server.ts` 的连接与消息钩子。
2. 红灯测试：跨 tenant 连接被拒；read 角色写 update 被拒且诊断码稳定；write 角色正常收发；无 authHook 时默认拒绝。
3. 实现解析 + hook 接线 + 诊断码登记（依赖 Phase 6 错误码 registry 项的落点，若未做则先登记进现有 `fixtures/collab/diagnostics-registry.json`）。
4. **验收**：`pnpm --filter @4xian/jword-collab-server test` 全绿 + examples/collab 的 Chromium smoke 不回归。

### 3.6 [G2-04 + G2-06/07] 字体度量真实测量（Phase 3A，L）

**关键风险提示：切换真实度量会改变几乎全部布局结果与视觉基线，必须两阶段执行。**

1. **阶段一（接口化，基线不变）**：core 定义 `TextMeasurer` 注入接口（core 禁止顶层 DOM 访问，测量器由 mount 时注入）；默认实现仍用现有近似表——此阶段所有测试与视觉基线**必须零变化**，以此证明接口化无副作用。
2. 同批处理缓存问题：缓存键收敛为仅影响度量的属性（`fontFamily`/`fontSizePx`/`bold`/`italic`，修 G2-07）；缓存加 LRU 上限（修 G2-06）。
3. **阶段二（切换真实测量，单独批次）**：浏览器实现用 canvas `measureText`（含 actualBoundingBoxAscent/Descent），Node/测试环境保留确定性表驱动实现保证单测可复现。
4. 阶段二必然导致 visual baseline 变化：刷新全部受影响基线，并在任务记录中**逐一列出刷新了哪些基线文件**（不允许一句"已刷新"带过）。
5. **验收**：三浏览器 e2e 视觉回归通过；hit-test / 光标定位 focused 测试在非 Arial 字体 fixture 上通过；`pnpm bench` 布局耗时无明显回退（>10% 需说明）。

### 3.7 [PDF 字体子集化 + fallback 链]（Phase 3C，L）

1. `embedFont(bytes, { subset: true })` 改为默认开启，`PdfFontConfig` 暴露 `subset` 选项。单测：同文档子集导出体积显著小于全量导出。
2. 字体覆盖检查从"单字体全覆盖"改为逐字符多字体匹配：`fonts: [{ family, bytes }]` 数组顺序即优先级，字符归属首个覆盖它的字体；run 按字体归属切分为多个绘制段。
3. 全部字体都不覆盖时收集缺字清单，抛 `PDF_FONT_MISSING` 可恢复错误并携带缺字样本（前 20 个字符）。
4. benchmark：真实中文全量字体（约 10MB 级）嵌入耗时与输出体积（子集 vs 全量）纳入 `pnpm bench`。**全量字体文件不入库**：用下载脚本获取到本地缓存目录 + CI 缓存；仓库内单测继续用现有小子集并注明覆盖边界。
5. **验收**：中日韩混排 + 多字体组合 fixture 导出成功且视觉报告正常；缺字路径错误码稳定。

### 3.8 [修订接受/拒绝基础版]（Phase 3B，L，按 D4 可后置）

前置依赖：G3-20（修订标记覆盖选区全部 run）必须先完成。

1. 语义定义（写进任务记录）：accept(insert) = 清除标记保留内容；accept(delete) = 执行删除；accept(format) = 保留格式清除标记；reject 为各自反向。
2. 新增 `acceptRevision(revisionId)` / `rejectRevision(revisionId)` command + operation，单事务提交，undo 一步回滚。
3. 红灯单测覆盖 3 类 × 接受/拒绝 = 6 条路径 + undo。
4. UI 修订面板加接受/拒绝按钮 + Chromium e2e 一条。
5. 范围红线：单条操作；"全部接受/拒绝"与嵌套修订不做（post-1.0）。

### 3.9 [Phase 4 性能专项：输入热路径 P95 < 50ms]（XL）

前置依赖：Phase 1 泄漏修复完成（否则测量失真）。

1. **先建测量，禁止盲优化**：建 10 万字/200 页 fixture（即修复计划 [计划审查 2.8] 项，先做）；在 layout / projection / render 关键路径加 performance mark 分段计时；`pnpm bench` + perf e2e 输出 P50/P95 基线报告。
2. 按测量结果排序修复已知候选，每项独立批次、修完复跑 bench 记录 delta：
   - GX-01 投影增量更新（L，预计最大收益，单独批次）
   - G2-05 advance 前缀和（S）
   - GX-03 `readUpdateByteLength`（S）
   - GX-04 `setTimeout(0)` → rAF（S）
   - G2-19/G2-22 可见页查找二分/Map 化（S）
3. 任何一项若测量显示收益 < 5%，记录数据后跳过，不为改而改。
4. **达标判定**：perf-chromium 下输入热路径 P95 < 50ms 连续 3 次通过；阈值写死进 perf e2e 成为回归门禁。
5. 内存回归门禁（[计划审查 3.14]：mount/destroy ×N 与 50 页长滚动两条采样护栏）在性能达标后最后加。

### 3.10 [Phase 5 超大文件拆分目标结构]

规则：一次只拆一个文件；公开导出面不变（原文件保留为 re-export 装配入口）；**拆分批次禁止夹带任何逻辑变更**；每拆完一个跑全量回归；全部拆完后收紧行数预算豁免清单。

| 文件（当前行数） | 目标结构 |
|---|---|
| `packages/ui/src/create-ui.ts`（2037） | `toolbar-setup.ts` / `sidebar-setup.ts` / `overlay-setup.ts` / `ui-lifecycle.ts`；`create-ui.ts` 保留装配入口 ≤ 400 行 |
| `packages/core/src/operations/command-builders.ts`（1702） | 按 operation 域拆：`text-commands.ts` / `block-commands.ts` / `table-commands.ts` / `image-commands.ts` / `comment-commands.ts` 等 |
| `packages/core/src/editor/text-editing-runtime.ts`（1650） | 报告未给方案：先产拆分清单（按输入域：keyboard-plan / delete-plan / paste-plan / composition），清单进阶段报告确认后再拆 |
| `packages/ui/src/toolbar/controller.ts`（1536） | 按控件组拆（格式组 / 段落组 / 插入组 / 状态同步） |
| `packages/core/src/operations/operation-adapter.ts`（1361） | 按 operation kind 拆 |
| `packages/core/src/model/document-store.ts`（1154） | `store-readers.ts` / `store-writers.ts` |

### 3.11 [Plugin API 前置改造]（Phase 6，XL，六个里程碑）

> gate7-review §2.1 已确认 core 无任何插件基础设施，且部分工作必须动 core 结构。分六个里程碑，**M1 与 M5 之后设人工检查点**。

- **M1 设计冻结（先做，产出文档，人工确认后才动代码）**：通读 gate7-review §2.1 全文；参考 Tiptap Extension / ProseMirror plugin / Monaco extension 模式；产出设计文档，至少定义：`PluginDefinition`（name/version/setup(ctx)/dispose）、`PluginContext`（registerCommand、registerKeyBinding、on(lifecycle event)、diagnostics）、错误隔离契约、与 `createEditor({ plugins: [...] })` 的注册方式。装饰层（decorations）按审查建议标记 `experimental`，不阻塞 1.0。
- **M2 core 扩展点骨架**：command 注册/拦截中间件链 + 生命周期钩子（onMount/onDestroy/afterTransaction）+ 插件错误隔离（try/catch → error 事件，不破坏 core 状态）。
- **M3 装饰层（experimental）**：layout/render 挂钩只读装饰，禁止写状态。
- **M4 UI 扩展**：工具栏/菜单注册 API（ui 包）。
- **M5 首个内部消费者**：把现有 UI 的 1-2 个菜单迁移为 plugin 实现，验证 API 形状是否够用；发现的 API 缺口回改 M1 设计。**此后人工检查点**。
- **M6 公开面收口**：类型测试、TSDoc、错误隔离 e2e、`docs/sdk/public-api.md` 登记。

### 3.12 [协同输入 rebase 评估]（Phase 6，M，按 D7 执行）

1. 写并发压测脚本：双 client 通过真实 Hocuspocus 连接，随机化执行 N 轮（≥200）三类冲突场景——同位置同时输入、一方删除另一方正在插入的区域、格式化与文本编辑重叠区。
2. 每轮结束断言双端最终文本与格式完全一致；统计一致率。
3. 一致率 = 100% → 在计划审查 2.1 条目记录"评估通过 + 压测证据"，保留现有路径并把压测脚本固化为回归测试。
4. 一致率 < 100% → 按 D7 直接实施替代方案：本地输入经 core command 写本地 Y.Doc，远端更新仅 `Y.applyUpdate` 后刷新 projection/layout/render，textarea 不再做 value diff/rebase；`examples/collab/src/runtime/hocuspocus-text-command.ts` 的 rebase 逻辑随之删除。
5. 无论结论如何，产出一页评估记录附数据，回写修复计划条目。

### 3.13 [发布/no-alias 消费闭环]（Phase 6，M，按 D2 执行）

1. **tarball 冒烟先行**：新增 `tools/release/check-gate7-third-party-smoke.mjs`——`pnpm pack` 全部可发布包 → 临时目录建外部空项目（不使用 monorepo alias）→ 从本地 tarball 安装 → `tsc` typecheck + `vite build` + 一条真实浏览器 smoke（免费基础路径 + 一条付费路径）。
2. 修复已知发布配置问题（与 gate7 2.7 合批）：`packages/ui` 的 `"./styles.css"` export 改指 dist 产物；core 等包 `files` 白名单收敛到 `dist` + README/LICENSE；PDF worker helper 移出 stable root API（同步更新 `docs/sdk/public-api.md` 与类型测试）。
3. tarball 冒烟通过后：可发布包移除 `private: true`、补 `publishConfig`（registry URL 留占位，由人工填写）。
4. Stable E2E 矩阵中登记 no-alias smoke 为必跑项。
5. **红线**：任何情况下不执行真实 `npm publish` / `pnpm publish`。

## 四、保留的人工检查点

以下节点 AI 必须暂停、输出报告、等待人工确认后继续：

1. 第 0 步基线报告之后（确认基线绿再开始修复）。
2. 每完成一批任务（3-5 项）的阶段报告之后。
3. Plugin API 的 M1 设计文档完成后、M5 内部消费者验证后（§3.11）。
4. D6 浏览器支持矩阵写入对外文档前（建议值 → 终值确认）。
5. 发布 registry URL 填写与任何真实 publish 动作（永久人工）。
6. §3.6 阶段二（切换真实字体度量）动工前——因其会大面积刷新视觉基线。
