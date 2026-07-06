# JWord 修复执行补充：预置决策与大任务拆解（2026-07-03）

> 本文档是 `2026-07-02-jword-remediation-plan.md`（下称"修复计划"）的执行补充。
> 修复计划回答"修什么、按什么顺序"；本文档回答"怎么修"——把修复计划中工作量为 L/XL 的任务拆成可直接执行的子步骤，把设计类任务的方案定稿，把产品/商业类悬而未决的问题预先做出默认决策。
> **优先级规则：凡本文档收录的任务，以本文档的拆解与决策为准；未收录的任务仍按修复计划条目执行。**
> 决策标注"（可推翻）"的条目，如人工给出不同结论，以人工结论为准并回写本文档。
> 2026-07-04 执行调整：后续修复不再因原"人工检查点"暂停；需人工复核的节点统一登记到 `2026-07-04-remediation-manual-verification-log.md`，并继续执行下一项。

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
| gate7 R3 Observability/error boundary/telemetry | §3.14 | 设计定稿 + 拆解 |
| gate7 2.6 bundle size 预算校准 | §3.15 | 设计定稿 + 拆解 |
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
- **D6（浏览器支持矩阵，建议默认值，终值需登记人工验证点）**：桌面编辑：Chrome/Edge ≥ 114、Firefox ≥ 115（ESR）、Safari ≥ 16.4；移动端仅承诺只读分页预览。构建 target 与该矩阵对齐（es2022 级），E2E 矩阵维持 Chromium/Firefox/WebKit 最新版 + 该承诺的回归说明。
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
- `onAuthenticate` 解析出 `{ tenantId, documentId, userId, token }` 后调用宿主 `authHook`，返回 `{ allow: boolean, role: 'read' | 'comment' | 'write' }`；默认拒绝（与 G6-M4 对齐）。
- `beforeSync` / 消息处理层：只有 `role === 'write'` 可提交 Yjs update，`read` / `comment` 写入统一拒绝并返回稳定诊断 `COLLAB_PERMISSION_DENIED`；跨 tenant 访问直接拒绝。
- **已知边界（写入文档）**：1.0 服务端可识别 read/comment/write 角色，但 comment 级精确写入授权因批注同样是 Y.Doc update、服务端无法低成本区分，明确列为 post-1.0；1.0 中 comment 角色按非 writer 处理。客户端 `readonly` 不具备安全语义，文档中显式声明。

**实施步骤**：
1. 现状确认 `packages/collab-server/src/hocuspocus-server.ts` 的连接与消息钩子。
2. 红灯测试：跨 tenant 连接被拒；read 角色写 update 被拒且诊断码稳定；write 角色正常收发；无 authHook 时默认拒绝。
3. 实现解析 + hook 接线 + 诊断码登记（依赖 Phase 6 错误码 registry 项的落点，若未做则先登记进现有 `fixtures/collab/diagnostics-registry.json`）。
4. **验收**：`pnpm --filter @4xian/jword-collab-server test` 全绿 + examples/collab 的 Chromium smoke 不回归。
5. **完成 2026-07-06**：补 `docs/superpowers/plans/2026-07-06-gate6-collab-permission-granularity.md`，root server 包公开 Hocuspocus auth hook / role 类型；`comment` 角色按非 writer 处理并以 `COLLAB_PERMISSION_DENIED` 拒绝 update；公开 API 和 README 均声明客户端 `readonly` 不是安全边界。focused 验证 `tests/architecture/gate7-public-api-catalog.test.ts`、`packages/collab-server/test/server.test.ts --testNamePattern "comment-only|read-only|auth hook"`、`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` 与 `pnpm --filter @4xian/jword-collab-server test` 通过。

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
   - GX-02 字体兼容性 probe 签名缓存（S，补做 [计划审查 1.2] 原文候选）
   - GX-03 `readUpdateByteLength`（S）
   - GX-04 `setTimeout(0)` → rAF（S）
   - G2-19/G2-22 可见页查找二分/Map 化（S）
3. 任何一项若测量显示收益 < 5%，记录数据后跳过，不为改而改。
   - 2026-07-05 §3.9-2 / GX-01 执行结果：事务 projection 已改为 operation dirty scope 增量刷新并复用未变 section/block；`pnpm bench` 的 phase4 inputHotPathP95 从 §3.9-1 的 140.49ms 降到 76.5ms，transactionP95 从 112.07ms 降到 50.27ms，layoutP95 从 47.89ms 降到 29.06ms。收益超过 5%，保留；专项仍未达 <50ms，继续 G2-05 与 GX-03 候选。
   - 2026-07-05 §3.9-3 / G2-05 执行结果：`createAdvanceTwips()` 已从重复前缀测量改为单 grapheme 线性累加，focused 测试锁定修前 `ab/abc/abcd` 递增前缀不再出现。`pnpm bench` 当前 phase4 inputHotPathP95 79.63ms、transactionP95 50.39ms、layoutP95 29.13ms，相比 GX-01 后基线未形成稳定 >5% 全局收益，视为大文档 fixture 波动内；但最坏情况 O(n²) 已由红灯用例清除，专项仍未达 <50ms，继续 GX-03。
   - 2026-07-05 §3.9-4 / GX-03 执行结果：事务 `updateByteLength` 诊断已改为显式 `updateByteLengthDiagnostics` opt-in；默认输入热路径不再编码 state-as-update，focused 红灯锁定默认本地事务 `diagnostic.updateByteLength = 0`。Gate 6 benchmark 改为用公开 `editor.encodeSyncUpdate()` 显式计量 auto inserter update 大小，避免重新依赖事务诊断。`pnpm bench` 当前 phase4 inputHotPathP95 76.09ms、transactionP95 55.82ms、layoutP95 26.15ms；样本 `updateByteLength` 为 0，但全局收益未稳定超过 5%，专项仍未达 <50ms，继续 GX-04。
   - 2026-07-05 §3.9-5 / GX-04 执行结果：deferred layout chunk 调度已从 `setTimeout(0)` 改为浏览器 `requestAnimationFrame`，并保留非浏览器 fallback；focused 红灯锁定延迟 chunk 进入 rAF 队列后才续排。`pnpm bench` 当前 phase4 inputHotPathP95 73.43ms、transactionP95 50.28ms、layoutP95 29.74ms；Node benchmark 收益未稳定超过 5%，但浏览器视觉更新调度问题已闭环，专项仍未达 <50ms，继续 G2-19/G2-22。
   - 2026-07-05 §3.9-6 / G2-19/G2-22 执行结果：`computeViewportPages()` 已用二分定位可见页 range，buffer 扩展按数组位置读取，不再全量 filter 或循环内 `indexOf`；红灯用 getter 计数锁定 1000 页场景不线性读取全部页面。`pnpm bench` 当前 phase4 inputHotPathP95 77.92ms、transactionP95 50.87ms、layoutP95 24.76ms；收益未稳定超过 5%，但 G2-19/G2-22 的 O(n) / O(visible×n) 已闭环。§3.9 初始候选执行完后专项仍未达 <50ms，后续需重新基于 benchmark 定位新瓶颈。
   - 2026-07-05 §3.9-7 / GX-02 执行结果：补做 [计划审查 1.2] 原文提到的字体兼容性候选；`createFontManager()` 为内置字体管理器维护兼容性签名，签名一致时增量 layout 跳过全文样式收集与 probe。focused 红灯从 80 个唯一字体样式下 405 次 cache miss 降到低于 40；`node benchmarks/phase4-input-hotpath-benchmark.mjs` 当前 inputHotPathP95 77.45ms、transactionP95 54.77ms、layoutP95 25.14ms。由于主 benchmark 使用同一 fontManager 对象，本项对全局 hotpath 收益未稳定超过 5%，但公开 layout API 的“等价新字体管理器”全文 probe 已闭环。专项仍未达 <50ms。
   - 2026-07-05 §3.9-8 / UI demo 输入热路径执行结果：浏览器 profiling 继续定位到 toolbar/UI/demo 事件订阅同步 `editor.getLayout()`，已改为 DOM 页数快照与空 overlay 早返回，折叠选区格式状态只读取命中段落；`perf-chromium` 输入热路径阈值写死为 50ms 并连续三次通过，largeDocumentInsertP95Ms=35.3/35.3/35.3。顺序 `pnpm build && pnpm bench` 当前 phase4 inputHotPathP95 47.89ms、transactionP95 2.92ms、layoutP95 46ms；[计划审查 1.2] 达标。
   - 2026-07-05 [计划审查 3.14] 执行结果：新增 Phase 4 memory perf 门禁，CDP 采样覆盖创建-编辑-销毁 5 次与 Gate 2 50 页长滚动 36 次，`pnpm exec playwright test examples/vanilla/tests/phase4-memory.perf.e2e.ts --project=perf-chromium` 通过；补架构测试锁定门禁入口和关键字段。
4. **达标判定**：perf-chromium 下输入热路径 P95 < 50ms 连续 3 次通过；阈值写死进 perf e2e 成为回归门禁。
5. 内存回归门禁（[计划审查 3.14]：mount/destroy ×N 与 50 页长滚动两条采样护栏）在性能达标后最后加。

### 3.10 [Phase 5 超大文件拆分目标结构]

规则：一次只拆一个文件；公开导出面不变（原文件保留为 re-export / 装配入口）；**拆分批次禁止夹带任何逻辑变更**；每拆完一个跑该文件对应 focused 验证与全量回归；全部拆完后收紧行数预算豁免清单。拆分时若触达 `packages/core/src` / `packages/core/test`，必须同步移除或收紧 `tests/architecture/core-file-budget.test.ts` 中对应 legacy 预算。

2026-07-04 复核口径：扫描 `packages`、`examples`、`tests`、`tools`、`benchmarks` 下 `.ts/.tsx/.js/.mjs` 文件，排除 `dist` 与 `node_modules`。当前超 1000 行文件共 16 个，Phase 5 拆分专项按下表执行。

| 批次 | 文件（当前行数） | 目标结构 | 最小验收 |
|---|---:|---|---|
| S1 | `packages/ui/src/create-ui.ts`（2038） | `toolbar-setup.ts` / `media-setup.ts` / `table-setup.ts` / `comments-rail.ts` / `link-overlay.ts` / `heading-outline-setup.ts` / `ui-lifecycle.ts`；`create-ui.ts` 保留装配入口 ≤ 400 行 | `pnpm exec vitest run packages/ui/test` + 受影响 vanilla e2e |
| S2 | `packages/core/src/operations/command-builders.ts`（1703） | 按 command 域拆：`text-commands.ts` / `paragraph-commands.ts` / `resource-commands.ts` / `comment-commands.ts` / `link-commands.ts` / `image-commands.ts` / `table-commands.ts`；原文件只 re-export | `pnpm exec vitest run packages/core/test/operations` + core file budget 收紧 |
| S3 | `packages/core/src/editor/text-editing-runtime.ts`（1652） | 按输入编辑域拆：`keyboard-editing.ts` / `delete-plan.ts` / `paragraph-split.ts` / `paste-plan.ts` / `rich-text-fragment.ts` / `runtime-selection.ts`；原文件保留 facade 级装配 | `pnpm exec vitest run packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts` + core file budget 收紧 |
| S4 | `packages/core/src/operations/operation-adapter.ts`（1551） | 按 operation kind 拆：`resource-adapter.ts` / `comment-adapter.ts` / `revision-adapter.ts` / `text-adapter.ts` / `block-adapter.ts` / `image-adapter.ts` / `table-adapter.ts` / `adapter-location.ts`；原文件保留 `applyOperation` 调度 | `pnpm exec vitest run packages/core/test/operations` + core file budget 收紧 |
| S5 | `packages/ui/src/toolbar/controller.ts`（1537） | 按控件组拆：`format-controls.ts` / `paragraph-controls.ts` / `insert-controls.ts` / `panel-lifecycle.ts` / `toolbar-state-sync.ts`；controller 保留生命周期编排 | `pnpm exec vitest run packages/ui/test` + 受影响 toolbar e2e |
| S6 | `packages/core/src/model/document-store.ts`（1155） | `store-types.ts` / `store-schema.ts` / `store-record-factories.ts` / `store-json.ts` / `store-comments.ts` / `store-revisions.ts`；`document-store.ts` 保留公开导出 | `pnpm exec vitest run packages/core/test/model packages/core/test/operations` + core file budget 收紧 |
| S7 | `packages/native/src/index.ts`（1116） | `package-codec.ts` / `package-readers.ts` / `package-validation.ts` / `schema-migrations.ts` / `diagnostics.ts` / `progress.ts`；`index.ts` 保留公开 API 与 re-export | `pnpm exec vitest run packages/native/test` + native typecheck |
| S8 | `packages/core/src/layout/engine.ts`（1028） | `inline-layout.ts` / `table-layout.ts` / `pagination-flow.ts` / `layout-anchors.ts`；`engine.ts` 保留 `layoutDocument` / `layoutDocumentIncrementally` 编排 | `pnpm exec vitest run packages/core/test/layout` + `pnpm test:visual` + core file budget 收紧 |
| S9 | `packages/ui/src/media/image-selection-controller.ts`（1126） | `image-selection-dom.ts` / `image-overlay-geometry.ts` / `image-resize-session.ts` / `image-drag-drop.ts`；controller 保留装配 | `pnpm exec vitest run packages/ui/test` + 图片相关 e2e |
| S10 | `packages/ui/src/selection-actions/controller.ts`（1124） | `selection-actions/commands.ts` / `selection-actions/clipboard.ts` / `selection-actions/geometry.ts` / `selection-actions/native-clipboard.ts`；controller 保留事件编排 | `pnpm exec vitest run packages/ui/test/selection-actions-*.test.ts` + gate4 selection actions e2e |
| S11 | `packages/ui/src/table/controller.ts`（1004） | `table-selection.ts` / `table-actions.ts` / `table-resize.ts` / `table-state-sync.ts`；controller 保留生命周期 | `pnpm exec vitest run packages/ui/test` + 表格相关 e2e |
| T1 | `packages/core/test/editor/input-runtime.test.ts`（2214） | 拆为 `input-runtime-keyboard.test.ts` / `input-runtime-clipboard.test.ts` / `input-runtime-composition.test.ts` / `input-runtime-pointer.test.ts` / `input-runtime-image.test.ts` / `input-runtime-errors.test.ts`，共享 helper 下沉到 `editor-test-helpers.ts` | 拆分后全部新测试文件通过 + core file budget 收紧 |
| T2 | `packages/core/test/layout/runtime.test.ts`（1904） | 拆为 `runtime-pagination.test.ts` / `runtime-wrapping.test.ts` / `runtime-table.test.ts` / `runtime-debug.test.ts`，共享 projection/font helper 下沉 | `pnpm exec vitest run packages/core/test/layout` + core file budget 收紧 |
| T3 | `packages/core/test/editor/facade-runtime.test.ts`（1148） | 拆为 `facade-document.test.ts` / `facade-command.test.ts` / `facade-history.test.ts` / `facade-load-replace.test.ts`，共享 projection 读取 helper 下沉 | `pnpm exec vitest run packages/core/test/editor` + core file budget 收紧 |
| T4 | `examples/vanilla/tests/gate3-toolbar.e2e.ts`（1210） | 按真实用户路径拆：`gate3-toolbar-format.e2e.ts` / `gate3-toolbar-paragraph.e2e.ts` / `gate3-toolbar-insert.e2e.ts` / `gate3-toolbar-panels.e2e.ts`，公共操作 helper 下沉 | `pnpm exec playwright test examples/vanilla/tests/gate3-toolbar-*.e2e.ts --project=chromium` |
| T5 | `examples/vanilla/tests/gate3-input.e2e.ts`（1124） | 按输入路径拆：`gate3-input-keyboard.e2e.ts` / `gate3-input-selection.e2e.ts` / `gate3-input-clipboard.e2e.ts` / `gate3-input-composition.e2e.ts` / `gate3-input-large-fixture.e2e.ts` | `pnpm exec playwright test examples/vanilla/tests/gate3-input-*.e2e.ts --project=chromium` |

2026-07-06 收口复核：原 16 个拆分项完成后，按同一扫描口径发现后续 Gate 5 测试增长使 `packages/pdf/test/public-api.test.ts` 达 1017 行；作为 current drift 纯测试拆分，新增 `packages/pdf/test/public-api-layout-fixtures.ts` 承接 layout fixture。复扫结果：上述路径下超 1000 行文件数为 0。

### 3.11 [Plugin API 前置改造]（Phase 6，XL，六个里程碑）

> gate7-review §2.1 已确认 core 无任何插件基础设施，且部分工作必须动 core 结构。分六个里程碑，**M1 与 M5 之后登记人工验证点但不暂停**。

- **M1 设计冻结（先做，产出文档并登记人工验证点后继续动代码）**：通读 gate7-review §2.1 全文；参考 Tiptap Extension / ProseMirror plugin / Monaco extension 模式；产出设计文档，至少定义：`PluginDefinition`（name/version/setup(ctx)/dispose）、`PluginContext`（registerCommand、registerKeyBinding、on(lifecycle event)、diagnostics）、错误隔离契约、与 `createEditor({ plugins: [...] })` 的注册方式。装饰层（decorations）按审查建议标记 `experimental`，不阻塞 1.0。
  - 进展 2026-07-06：M1 设计冻结完成，产物为 `docs/superpowers/plans/2026-07-06-gate7-plugin-api-m1-design.md`；已登记 M1 人工验证点，后续按 M2 继续动 core 插件 host 骨架。
- **M2 core 扩展点骨架**：command 注册/拦截中间件链 + 生命周期钩子（onMount/onDestroy/afterTransaction）+ 插件错误隔离（try/catch → error 事件，不破坏 core 状态）。
  - 进展 2026-07-06：M2 core 扩展点骨架完成，落点为 `packages/core/src/plugins/types.ts` / `host.ts`、`EditorOptions.plugins`、`executePluginCommand()`、生命周期分发、快捷键 runtime 接线和插件 diagnostics/error event；focused 验证见主修复计划 `[gate7 2.1]` M2 记录。
- **M3 装饰层（experimental）**：layout/render 挂钩只读装饰，禁止写状态。
  - 进展 2026-07-06：M3 experimental decorations read path 完成，落点为 `PluginContext.registerDecorationProvider()`、`ExperimentalDecorationProvider`、`PluginHost.readDecorations()` 与 `renderPageCanvas` 的归一化 decoration 消费；provider 只拿 projection/layout/selection 快照，不接触 canvas context，异常隔离为插件诊断。
- **M4 UI 扩展**：工具栏/菜单注册 API（ui 包）。
  - 进展 2026-07-06：M4 UI toolbar/menu extension registry 完成，落点为 `packages/ui/src/toolbar/plugin-extensions.ts`、`CreateJWordUiOptions.pluginExtensions` 和 UI 插件类型导出；插件按钮/菜单使用独立 runtime key，状态刷新只读 projection/selection，触发命令统一走 core `editor.executePluginCommand()`；focused 验证见主修复计划 `[gate7 2.1]` M4 记录。
- **M5 首个内部消费者**：把现有 UI 的 1-2 个菜单迁移为 plugin 实现，验证 API 形状是否够用；发现的 API 缺口回改 M1 设计。**此后登记人工验证点但不暂停**。
  - 进展 2026-07-06：M5 首个内部消费者完成，默认页面尺寸菜单改由内部 `jword.ui` 插件菜单提供，core 内置插件命令 `jword.ui.setPagePreset` 执行现有 `editor.setPageConfig()`；M5 验证暴露 UI 插件 action 需要保留原内建菜单 live region 播报，已回改 M1 设计并在 `JWordToolbarPluginItem` / `JWordMenuPluginAction` 补可选 `announce(context)`。已登记 M5 人工验证点，后续按 M6 类型/TSDoc/公开面收口。
- **M6 公开面收口**：类型测试、TSDoc、错误隔离 e2e、`docs/sdk/public-api.md` 登记。
  - 完成 2026-07-06：M6 公开面收口完成，`docs/sdk/public-api.md` 将 core/plugin host、decorations 与 UI toolbar/menu extension 明确登记为 experimental，`tests/architecture/gate7-public-api-catalog.test.ts` 锁定当前导出符号和分级；vanilla demo 新增 opt-in `?pluginError=throwing-command` 测试插件，Chromium E2E 证明插件命令抛错被隔离为 `PLUGIN_CALLBACK_FAILED` diagnostics 后内部页面尺寸插件仍可工作。注意：本项只完成 Phase 6 前置插件骨架，不等同于 Gate 7 Step 7.5 完整 stable plugin API（resource upload、persistence、import/export adapter、collab provider adapter contract 仍留 Gate 7 正式阶段）。

### 3.12 [协同输入 rebase 评估]（Phase 6，M，按 D7 执行）

1. 写并发压测脚本：双 client 通过真实 Hocuspocus 连接，随机化执行 N 轮（≥200）三类冲突场景——同位置同时输入、一方删除另一方正在插入的区域、格式化与文本编辑重叠区。
2. 每轮结束断言双端最终文本与格式完全一致；统计一致率。
3. 一致率 = 100% → 在计划审查 2.1 条目记录"评估通过 + 压测证据"，保留现有路径并把压测脚本固化为回归测试。
4. 一致率 < 100% → 按 D7 直接实施替代方案：本地输入经 core command 写本地 Y.Doc，远端更新仅 `Y.applyUpdate` 后刷新 projection/layout/render，textarea 不再做 value diff/rebase；`examples/collab/src/runtime/hocuspocus-text-command.ts` 的 rebase 逻辑随之删除。
5. 无论结论如何，产出一页评估记录附数据，回写修复计划条目。
   - 完成 2026-07-06：产出 `docs/superpowers/plans/2026-07-06-gate6-collab-input-rebase-evaluation.md`，并新增 `examples/collab/tests/collab-input-rebase-stress.test.ts` 固化 210 轮固定 seed 压测。实测 `seed=1779900449`、`rounds=210`、场景分布为同位置输入 76 / 删除-插入重叠 66 / 格式-文本重叠 68，`consistentRounds=210`、`consistencyRate=1`、`failures=[]`。按 D7 口径未触发替代方案，保留现有 `hocuspocus-text-command.ts` rebase 路径；若后续一致率低于 100%，再切换到 Y.RelativePosition / core command 定位方案。

### 3.13 [发布/no-alias 消费闭环]（Phase 6，M，按 D2 执行）

1. **tarball 冒烟先行**：新增 `tools/release/check-gate7-third-party-smoke.mjs`——`pnpm pack` 全部可发布包 → 临时目录建外部空项目（不使用 monorepo alias）→ 从本地 tarball 安装 → `tsc` typecheck + `vite build` + 一条真实浏览器 smoke（免费基础路径 + 一条付费路径）。
2. 修复已知发布配置问题（与 gate7 2.7 合批）：`packages/ui` 的 `"./styles.css"` export 改指 dist 产物；core 等包 `files` 白名单收敛到 `dist` + README/LICENSE；PDF worker helper 移出 stable root API（同步更新 `docs/sdk/public-api.md` 与类型测试）。
3. tarball 冒烟通过后：可发布包移除 `private: true`、补 `publishConfig`（registry URL 留占位，由人工填写）。
4. Stable E2E 矩阵中登记 no-alias smoke 为必跑项。
5. **红线**：任何情况下不执行真实 `npm publish` / `pnpm publish`。

### 3.14 [Observability/error boundary/telemetry]（Phase 6，M，按 R3 执行）

1. **O1 contract / schema / privacy redaction**：新增 `docs/superpowers/plans/2026-07-06-gate7-observability-telemetry-design.md`，冻结 telemetry 事件 schema；当前只开放 `plugin.diagnostic`，不发送插件 message，details 字符串值与对象 key 必须裁剪。
   - 完成 2026-07-06：新增 `packages/core/src/editor/observability.ts`，定义 `JWordTelemetryEvent`、`JWordTelemetryOptions`、`JWordDiagnosticsSnapshot` 等类型和裁剪工具。
2. **O2 core diagnostics export 最小安全快照**：在 `Editor` facade 增加 `exportDiagnostics()`，返回不包含 projection/model/run text 的安全快照；`getPluginDiagnostics()` 继续作为本地原始运行时诊断。
   - 完成 2026-07-06：`Editor.exportDiagnostics()` 通过 `PluginHost.exportDiagnostics()` 导出 `contentIncluded: false` 快照，测试断言正文、插件 message 与 details key 不出现在 JSON 中。
3. **O3 telemetry 默认关闭 + opt-in sink**：`EditorOptions.telemetry.sink` 为唯一发送入口；未配置时不发送 telemetry；sink 抛错不得影响 editor 或递归上报。
   - 完成 2026-07-06：`PluginHost.reportDiagnostic()` 在诊断入队后仅当宿主提供 sink 才发送裁剪后的 `plugin.diagnostic`。
4. **O4 wrapper error boundary 设计占位**：React/Vue wrapper 真实代码不在本项实施；设计文档冻结 wrapper boundary seam：只捕获 wrapper 自身错误、只附带 `editor.exportDiagnostics()` 安全快照、不读取 DOM `innerText` 或 document model 正文。
5. **O5 内容隐私审计测试**：新增 focused test 覆盖 opt-in telemetry 与 diagnostics export 隐私裁剪；插件异常隔离继续复用 `plugin-runtime.test.ts`。
   - 完成 2026-07-06：新增 `packages/core/test/editor/observability.test.ts`，并更新 `docs/sdk/public-api.md` / `tests/architecture/gate7-public-api-catalog.test.ts` 登记 experimental observability API。

### 3.15 [Bundle size 预算校准]（Phase 6，S，按 gate7-review §6b.1 执行）

1. **B1 fresh build 复测**：先跑 `pnpm size`，用 root build + vanilla build 生成 fresh dist；若仍因旧阈值失败，记录 core entry 与首屏 JS/CSS 实测值和 freshness 证据。
   - 完成 2026-07-06：修前 `pnpm size` 失败，fresh `packages/core/dist/index.js = 638269 bytes`，vanilla 首屏 JS+CSS `= 687669 bytes`，证明当前破线是 Phase 4-6 后真实产物，不是旧 dist。
2. **B2 预算方案文档**：产出 `docs/superpowers/plans/2026-07-06-gate7-bundle-size-calibration.md`，明确当前实测、校准阈值、下一阶段收紧目标和三套 size 工具边界。
   - 完成 2026-07-06：当前校准阈值为 core 650000 bytes、vanilla first screen 700000 bytes；下一阶段目标分别为 520000 / 560000 bytes。
3. **B3 门禁脚本校准**：更新 `tools/size/check-size.mjs`，保留 fresh build、重依赖 token、禁止高级包进入免费首屏的检查，只替换过时 byte ceiling，并在 JSON 输出中包含 `measuredAt` 和 `roadmap`。
   - 完成 2026-07-06：`node tools/size/check-size.mjs` 在 fresh dist 上输出 `status: ok`、`thresholds.roadmap` 与两项校准预算。
4. **B4 验证与回写**：`pnpm size` 必须变绿；同步回写修复计划和人工验证日志。注意：本项不等同于完成主计划 Step 7.19 全量 size-limit / bundle 分析，React/Vue/devtools 等尚未实现能力仍留后续 Gate 7。

### 3.16 [Wrapper / Theme / Devtools 详细设计]（Phase 6，M，按 gate7-review §2.2/2.3/2.4 执行）

1. **W1 React wrapper 设计**：产出 `docs/superpowers/plans/2026-07-06-gate7-wrapper-theme-devtools-design.md`，冻结 `JWordReactEditorProps`、`JWordReactEditorHandle`、`forwardRef` / `useImperativeHandle`、React Context、默认非受控、文档模型级受控、StrictMode 双挂载幂等 cleanup、SSR 空壳、Suspense 边界和 wrapper error boundary seam。
2. **W2 Vue wrapper 设计**：同一设计文档冻结 Vue 3 props / emits、`onMounted` / `onBeforeUnmount` 生命周期、`defineExpose({ editor, focus, exportDiagnostics, destroy })`、provide/inject、`useJWordEditor()` composable、SSR 容器空壳与 `modelValue` 文档模型级替换规则。
3. **W3 Theme/i18n 设计**：主题走 `packages/ui` CSS custom properties、`data-theme="light|dark"` 与 host class 透传；i18n 走轻量 key-value 字典和 `createJWordUi({ locale })` 局部覆盖，不引入重型 runtime，不进入 core。首批覆盖 toolbar、menu、dialog、a11y label、live region 与常见错误提示。
4. **W4 Devtools 设计**：`@4xian/jword-devtools` 独立包、宿主显式 import 或动态 import、默认关闭；浮动面板消费 `editor.subscribe()`、公开 selection/layout/diagnostics API 和 `editor.exportDiagnostics()`，operation/layout/selection/perf/license/diagnostics 面板均不得记录正文内容，关闭时不订阅 editor。
5. **W5 验收与后续顺序**：后续实现按 Theme/i18n → React/Vue wrapper → Devtools 顺序推进；每个包落地后补 no-alias external smoke、SSR smoke、focused framework tests、浏览器路径和 `pnpm size` 证据。本项只完成 Gate 7 可执行设计冻结，不创建 `packages/react`、`packages/vue` 或 `packages/devtools`，不等同于 wrapper/theme/devtools 的真实实现完成。

### 3.17 [A11y 系统性验收补课]（Phase 6，M-L，按 plan-review §2.4 执行）

1. **A1 验收清单**：产出 `docs/superpowers/plans/2026-07-06-gate7-a11y-validation.md`，把 specs §4.8 / §6.7 的要求拆到 Gate 4 表格、批注、查找替换与 Gate 6 协作光标，区分自动化门禁和后续屏幕阅读器人工矩阵。
2. **A2 axe-core 接入**：新增 root devDependency `axe-core`，并通过 `tests/e2e/a11y-axe.ts` 注入 Playwright 页面，默认阻断 serious / critical violation；`tests/architecture/gate7-a11y-e2e.test.ts` 锁定依赖、helper 和 E2E 覆盖文件。
3. **A3 Gate 4 E2E 覆盖**：新增 `examples/vanilla/tests/gate4-a11y.e2e.ts`，对初始 editor/toolbar、表格自定义尺寸 dialog、批注草稿输入、查找替换面板运行 axe scan。
4. **A4 Gate 6 E2E 覆盖**：新增 `examples/collab/tests/collab-a11y.e2e.ts`，用独立 collab demo 端口覆盖远端光标、远端选区和状态面板。
5. **A5 红灯修复**：修复 axe 暴露的 serious 问题：toolbar empty select label 对比度不足、canvas container 可滚动但不可聚焦、collab 远端选区文字对比度随用户色不足、collab debug pre 可滚动但不可聚焦。本项不声明完整 WCAG 合规，只完成 Gate 4-6 当前 serious/critical 自动化门禁和人工复核清单。

### 3.18 [Gate 7 诊断码单一真源生成管线]（Phase 6，M，按 gate7-review R2 HIGH 执行）

> 详细设计冻结在 `docs/superpowers/plans/2026-07-06-gate7-diagnostics-registry-pipeline.md`。本项把原 Gate 6 registry 升级为跨包公开诊断码单一真源，不另起错误码文档。

1. **Dg1 registry 扩容**：保留 `fixtures/collab/diagnostics-registry.json` 原路径和 Gate 6 条目顺序，追加 `core`、`docx`、`pdf`、`native`、`license` owner；每条 code 必须带 severity、recoverable、fallback、description 和 domains。
2. **Dg2 生成管线**：新增 `tools/diagnostics/generate-diagnostics-artifacts.mjs`，从 registry 生成 `docs/sdk/diagnostic-codes.md` 与 `packages/core/src/editor/diagnostics-registry.ts` 摘要，并支持 `--check`。
3. **Dg3 diagnostics export 接线**：`Editor.exportDiagnostics()` 的安全快照携带 registry 摘要；不把完整 code 表打入 core runtime，不改变正文隐私裁剪。
4. **Dg4 护栏测试**：新增 Gate 7 架构测试覆盖跨包 code 登记、生成产物同步、metadata 完整性和文档清单；Gate 6 原测试改为过滤 Gate 6 子集。
5. **完成 2026-07-06**：registry 当前登记 182 个 code；`docs/sdk/public-api.md` 链接生成清单；focused 验证 `pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts tests/architecture/gate6-diagnostics-registry.test.ts packages/core/test/editor/observability.test.ts` 通过。

### 3.19 [Gate 7 R2 计划修订两小项]（Phase 6，S，按 gate7-review R2 执行）

1. **P1 persistence edition / export tier 冻结**：主计划 Iteration 0 补 `packages/persistence/src/` 落点，并把 `@4xian/jword-persistence` 标为 `free base contract`；stable 为基础 storage contract、diagnostics、memory/storage history adapter 类型和不可用 IndexedDB fallback，experimental 为 browser IndexedDB adapter 行为，internal 为 Yjs reconstruction、SHA-256 helper、storage serialization helper 和实现类。
2. **P2 Step 7.19 size 工具收敛**：`tools/size/check-size.mjs` 是免费基础首屏预算真源；`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏；`tools/size/check-native-bundle.mjs` 只保留为 native 资源专项护栏；不再新增第三套会阻断 CI 的 `size-limit` 预算真源。
3. **P3 护栏测试**：新增 `tests/architecture/gate7-plan-revision.test.ts`，锁定 canonical plan 与 public API catalog 的 persistence 分级和 size 工具收敛口径。
4. **完成 2026-07-06**：同步回写 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`、`docs/sdk/public-api.md`、`docs/superpowers/plans/2026-07-06-gate7-bundle-size-calibration.md` 与修复计划；focused 验证 `pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts` 通过。


### 3.20 [Worker 能力检测与降级口径]（Phase 6，S-M，按 D5 执行）

1. **Wc1 设计冻结**：新增 `docs/superpowers/plans/2026-07-06-gate7-worker-capability-downgrade.md`，明确 Worker 不可用时只返回稳定诊断，不做同线程 fallback。
2. **Wc2 公开能力检测 API**：`@4xian/jword-docx` 公开 `detectDocxWorkerCapability()` / `DOCX_WORKER_CSP_DIRECTIVES`；`@4xian/jword-pdf` 公开 `detectPdfWorkerCapability()` / `PDF_WORKER_CSP_DIRECTIVES`；`@4xian/jword-native` 公开 `detectJWordNativeWorkerCapability()` / `JWORD_NATIVE_WORKER_CSP_DIRECTIVES`。
3. **Wc3 稳定诊断**：新增 `DOCX_WORKER_UNAVAILABLE` 与 `JWORD_NATIVE_WORKER_UNAVAILABLE`，复用并收窄 `PDF_WORKER_UNAVAILABLE` 语义；统一 registry 生成 `docs/sdk/diagnostic-codes.md` 与 core diagnostics summary。
4. **Wc4 CSP 文档**：`docs/sdk/public-api.md` 与 `packages/native/README.md` 记录 `worker-src 'self' blob:`，Blob module worker 场景另需 `script-src 'self' blob:`。
5. **完成 2026-07-06**：新增 `tests/architecture/gate7-worker-capability.test.ts`，锁定 docx/pdf/native 三个检测入口在缺失 `Worker`、`Blob`、Blob URL、`ArrayBuffer` 时返回 `status: unavailable`、稳定诊断与 `fallback: none`；capable scope 下返回 `status: available` 且无诊断。

### 3.21 [计划审查 3.13 浏览器支持矩阵]（Phase 6，S，按 D6 执行）

1. **Bm1 公开矩阵**：新增 `docs/sdk/browser-support.md`，冻结桌面编辑 Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4；`docs/sdk/public-api.md` 链接该公开口径。
2. **Bm2 移动边界**：公开文档明确移动端仅承诺只读分页预览，不承诺移动端编辑、触摸选区、虚拟键盘 IME 或复杂工具栏交互。
3. **Bm3 构建 target**：发布包 `packages/*/tsconfig.json` 保持 ES2022；`examples/vanilla`、`examples/docx`、`examples/collab` 的 tsconfig 与 Vite build target 调整为 ES2022。
4. **Bm4 E2E 回归**：`package.json` 与 `playwright.config.ts` 继续保留 Chromium / Firefox / WebKit 最新版项目，并在公开文档中说明该矩阵是浏览器族回归，不等同于最低版本认证。
5. **完成 2026-07-06**：新增 `tests/architecture/gate7-browser-support.test.ts` 锁定公开文档、构建 target 和 Playwright 浏览器族；红灯先行证明缺公开矩阵且示例 target 仍为 ES2024，修复后 focused 验证通过。

### 3.22 [计划审查 3.15 风险复核点 F]（Phase 6，S，按 plan-review §3.15 执行）

1. **Rf1 复核点落档**：主计划风险控制与 Gate 7 Iteration 0 新增复核点 F，明确 Gate 7 Iteration 0 完成后一次性冻结 edition matrix、导出面、事件 payload 与 diagnostics 命名。
2. **Rf2 冻结面来源**：新增 `docs/superpowers/plans/2026-07-06-gate7-risk-checkpoint-f.md`，列出 public API catalog、diagnostics registry、生成错误码清单、browser support 与 canonical plan 作为冻结面来源。
3. **Rf3 消费规则**：`docs/sdk/public-api.md` 新增 `Gate 7 frozen surface sources`，要求文档站、类型测试、wrapper 和示例只能消费冻结来源；新增/改名必须先更新冻结来源和 architecture guard。
4. **Rf4 护栏测试**：扩展 `tests/architecture/gate7-plan-revision.test.ts`，锁定复核点 F、冻结面来源和消费规则。
5. **完成 2026-07-06**：红灯先行证明主计划缺复核点 F；修复后 focused 验证通过。当前只补齐复核点，不把 Gate 7 Iteration 0 冒认为已完成。

### 3.23 [计划审查 3.16 版本历史与 Yjs GC]（Phase 6，S，按 D8 执行）

1. **Hg1 技术决策落档**：新增 `docs/superpowers/plans/2026-07-06-gate6-history-yjs-gc-decision.md`，明确版本历史禁止依赖 `Y.Snapshot`，禁止为了预览或恢复把文档生命周期改成 `gc = false`。
2. **Hg2 主路径冻结**：canonical plan 同步固定 `update log + 隔离 Y.Doc 重放`，并说明 JWord snapshot record 只是 state update checkpoint，不等同于 Yjs Snapshot API。
3. **Hg3 增长治理**：默认每 200 个 update 或 5 分钟生成一个 snapshot；compaction 保留最近 50 个 snapshot；更旧数据通过宿主 storage hook 归档，归档缺失时返回稳定诊断。
4. **Hg4 护栏测试**：新增 `tests/architecture/gate6-history-yjs-gc-decision.test.ts`，锁定决策文档、canonical plan 回写和版本历史相关源码不得使用 Yjs Snapshot API 或 `gc=false`。
5. **完成 2026-07-06**：红灯先行证明缺技术决策文档与 canonical plan 回写；修复后 `pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts --reporter=verbose` 通过，1 file / 3 tests passed；`pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose` 通过，3 files / 12 tests passed；`pnpm typecheck`、`pnpm lint`、相关文件 `git diff --check` 通过。

### 3.24 [Gate 7 Step 7.2 API 导出审计和类型测试]（Gate 7，M，按 canonical plan 执行）

1. **A2-1 manifest 审计**：新增 `tests/architecture/gate7-api-export-audit.test.ts`，锁定当前公开 package 的 `files` 不含 `src` / examples / demo，`types` 指向 `./dist/index.d.ts`，export map target 只指向 `./dist/*`。
2. **A2-2 子路径审计**：同一 architecture test 禁止 public export key 暴露 `src`、internal、demo、provider、hocuspocus 或 yjs 子路径；`./worker`、`./experimental`、`./styles.css` 等已明确公开的子路径继续由 public API catalog 约束。
3. **A2-3 类型测试入口**：新增 `tests/types/gate7-public-api-entrypoints.ts` 与 `tests/types/tsconfig.gate7-public-api.json`，并在 `package.json` 暴露 `pnpm test:types`；fixture 只允许从 package 名称导入当前 stable API。根 `tsconfig.json` 排除 `tests/types/**/*.ts`，该外部式 fixture 由专门类型门禁验收，`tests/types/tsconfig.json` 仅供 lint project service 识别同一隔离配置。
4. **A2-4 文档同步**：`docs/sdk/public-api.md` 新增 Type tests / export audit 章节，要求新增或改名 stable API 时先更新清单、类型测试和 architecture guard。
5. **完成 2026-07-06**：红灯先行证明缺类型测试入口和文档记录；修复后 `pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts --reporter=verbose` 通过，1 file / 4 tests passed；`pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 通过，3 files / 13 tests passed；`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 和相关文件 whitespace check 通过。

### 3.25 [Gate 7 Step 7.3 TSDoc、最小示例和诊断载荷文档]（Gate 7，M，按 canonical plan 执行）

1. **A3-1 TSDoc 护栏**：新增 `tests/architecture/gate7-public-api-docs.test.ts`，使用 TypeScript checker 解析外部式类型 fixture 的 package 入口导入，并反查真实声明，要求稳定导入符号具备贴近自身声明的 TSDoc 文档注释。
2. **A3-2 最小示例**：新增 `docs/sdk/public-api-examples.md` 与 `tests/types/gate7-public-api-examples.ts`，覆盖免费基础版 editor/UI/native/persistence、Gate 5 docx/pdf/license、Gate 6 collab/collab-server/license 的最小外部消费路径；示例只允许 package 入口导入。
3. **A3-3 诊断载荷文档**：`docs/sdk/public-api.md` 新增 `Diagnostics payload contract`，固定 `code`、`severity`、`recoverable`、`recommendedAction`、`metadataTags`、`JWordDiagnosticsSnapshot`、feature key handoff 与隐私裁剪口径，并链接生成的 `docs/sdk/diagnostic-codes.md`。
4. **A3-4 TSDoc 补齐**：补齐当前类型示例实际消费的稳定符号文档注释，包括 `createEditor`、`EditorOptions`、`Document`、`EditorSharedDocument`、native/docx/pdf result、persistence diagnostic/version/adapter、collab client/server contract 和 license feature/diagnostic/entitlement 类型。
5. **完成 2026-07-06**：红灯先行证明缺示例 fixture、最小示例文档和 diagnostics payload contract；修复后 `pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts --reporter=verbose` 通过，1 file / 3 tests passed；`pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 通过，4 files / 16 tests passed；`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。

### 3.26 [Gate 7 Step 7.4 免费基础版 quickstart]（Gate 7，M，按 canonical plan 执行）

1. **A4-1 quickstart 文档**：新增 `docs/sdk/quickstart.md`，覆盖安装 `@4xian/jword-core` / `@4xian/jword-ui` / `@4xian/jword-native`、初始化 editor/UI、基础编辑、保存 `.jword`、打开 `.jword`、继续编辑和基础错误处理。
2. **A4-2 可编译示例**：新增 `tests/types/gate7-free-quickstart.ts` 并纳入 `pnpm test:types`，保证 quickstart 的公开导入和最小调用形状可被外部 TypeScript 项目消费。
3. **A4-3 文档护栏**：新增 `tests/architecture/gate7-free-quickstart.test.ts`，禁止 quickstart 导入内部路径、付费包、Yjs 或 Hocuspocus server，防止免费基础版 quickstart 漂移成 monorepo demo。
4. **完成 2026-07-06**：红灯先行证明缺 quickstart 文档和类型 fixture；修复后 `pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose` 通过，1 file / 2 tests passed；Gate 7 文档回归 `pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 通过，5 files / 18 tests passed；`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。

## 四、人工验证点记录规范

以下节点不再阻塞自动执行。AI 到点必须把人工复核事项追加到 `docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md`，随后继续下一项；若确需真实发布，仍永久禁止自动执行，只登记审批事项。

1. 第 0 步基线报告之后：记录基线命令、结果、日期和未覆盖项。
2. 每完成一批任务（3-5 项）的阶段报告之后：记录批次范围、全量回归命令、失败或跳过项。
3. Plugin API 的 M1 设计文档完成后、M5 内部消费者验证后（§3.11）：记录设计/验证产物路径、API 风险和需人工复核的问题。
4. D6 浏览器支持矩阵写入对外文档前：记录建议默认值、写入路径、构建 target / E2E 矩阵影响。
5. 发布 registry URL 填写与任何真实 publish 动作：记录需要人工审批的包、registry、命令草案；禁止执行真实 publish。
6. §3.6 阶段二（切换真实字体度量）动工前：记录阶段一零变化证据、拟刷新视觉基线清单和回归命令。
