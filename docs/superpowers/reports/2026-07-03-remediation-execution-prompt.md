# JWord 审查修复任务执行提示词（v2，2026-07-03）

> 用途：将本文档全文作为提示词交给执行修复的 AI。
> 配套文档：`2026-07-02-jword-remediation-plan.md`（执行清单）、`2026-07-03-remediation-execution-supplement.md`（预置决策与大任务拆解）。

---

## 角色与目标

你是 JWord 项目的修复工程师。JWord 是一个 Word 风格的文档编辑器 SDK（pnpm monorepo、TypeScript、Y.Doc 唯一真源 + 自研分页排版引擎 + 按页 Canvas 渲染）。项目在 2026-07-02 完成了全项目代码审查（首轮 + R2 + R3 三轮复核），全部发现已归并为修复计划；所有需要预先决策和拆解的事项已在执行补充文档中定稿。你的任务：按文档逐项修复，让每一项修复可验证、可追溯。所有产品/商业/设计决策已预先做出（D1-D9），执行中不要就这些事再提问。

## 必读文档（开工前按顺序读完）

1. `docs/superpowers/reports/2026-07-02-jword-remediation-plan.md`
   —— 执行清单（Phase 0-6 + 文末 15 项"下一步行动"顺序）。
2. `docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md`
   —— 执行补充：预置决策 D1-D9、时点漂移处理规范（§2）、大任务拆解（§3）、人工验证点记录规范（§4）。**优先级规则：凡其任务映射表收录的任务，以补充文档为准；两文档冲突时以补充文档为准。**
3. 项目根 `CLAUDE.md` —— 架构不变式、代码规范、机器强制门禁。
4. 做某任务前按编号回溯明细报告读完整上下文：
   - `G0/G1-xx` → `2026-07-02-gate0-gate1-review.md`
   - `G2/G3-xx` → `2026-07-02-gate2-gate3-review.md`
   - `G4-xx` → `2026-07-02-gate4-review.md`
   - `N-x/D-x/P-x/LIC` → `2026-07-02-gate45-gate5-review.md`
   - `G6-xx` → `2026-07-02-gate6-review.md`
   - `gate7/计划审查 x.x` → `2026-07-02-gate7-review.md` / `2026-07-02-plan-review.md`

不要通读 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`（2758 行），只在任务引用某 Gate 时查对应章节。

## 硬性约束（任何一条冲突即停下报告，不得自行变通）

- 架构不变式：Y.Doc 是唯一可写真源；所有变更走同一 Transaction Pipeline 且带 origin；Layout 只读 DocumentProjection；Renderer 只消费 LayoutBox；`packages/core` 禁止导入 React/Vue/UI/docx/pdf/collab/jszip/pdf-lib 等，禁止顶层 DOM 访问。
- 禁止为通过 `tests/architecture/` 门禁而放宽、跳过或删除测试。
- 禁止 `git commit` / `tag` / `publish`；只改工作区，提交由人工审批。
- 注释一律简体中文；改动的 `.ts` 文件保持文件头注释（职责/边界/协作模块/约束/Specs）。
- 依赖精确版本（禁止 `^` 和 `~`）；测试文件禁止放进任何 `src` 目录。
- 时点漂移：报告是 2026-07-02 快照，**严格按补充文档 §2 的四步流程处理**——按符号名定位、修前必复现、复现不了按"自愈确认/按现状修/待人工裁决"分流，以代码现状为准，禁止为对齐报告描述而改坏现有行为。

## 第 0 步：验证底座（先于一切修复）

1. `pnpm install --frozen-lockfile`
2. 建立基线并记入汇报：`pnpm lint && pnpm typecheck && pnpm test && pnpm build`（预期全绿；不绿先停下报告，不要带病修复）
3. 执行 [计划审查 2.10]：`.github/workflows/ci.yml` 的 Install 步骤后补 `pnpm exec playwright install --with-deps`；本地也执行一次该命令，抽跑 1 条 e2e（`--project=chromium`）确认浏览器环境可用。
4. 输出"第 0 步基线报告"并继续修复；如存在需人工复核的环境或测试点，登记到 `docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md`，不得因此暂停。

## 执行顺序

严格按修复计划文末「下一步行动」15 项顺序推进，遵守依赖：

- 先 [G1-03] 选区方向 → 再 [G3-01] Shift+Arrow
- 先 [G1-02]（按补充文档 §3.1 拆解，含 D9 跨 section 语义）→ 再 [G3-02] 选区回车
- [G4-BUG] 浮动工具栏独立，可穿插先做
- [G1-01/G3-03/G3-04] 同文件监听器泄漏合为一个改动批次
- [LIC-1] 按补充文档 §3.4 的设计定稿直接实施（密钥管理按 D1，无需再问）

分批节奏：每完成一批（3-5 项）输出阶段报告并继续，不阻塞后续修复。第一批 = 下一步行动 1-6 项。15 项完成后继续 Phase 1 剩余 → Phase 2 → Phase 3…，大任务（表格跨页、PDF 样式、字体度量、性能专项、文件拆分、Plugin API 等）一律按补充文档 §3 对应章节的子步骤执行。凡原本要求人工确认的节点，只登记到 `docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md`，不阻塞后续修复。

## 人工验证点登记（补充文档 §4，到点只记录不暂停）

1. 第 0 步基线报告后：记录基线命令、结果与日期。
2. 每批阶段报告后：记录批次范围、已完成任务与全量回归结果。
3. Plugin API 的 M1 设计文档完成后与 M5 内部消费者验证后：记录设计文档路径、验证命令与待人工关注点。
4. D6 浏览器矩阵写入对外文档前：记录建议终值、写入位置与影响范围。
5. 字体度量 §3.6 阶段二（切换真实测量、大面积刷新视觉基线）动工前：记录阶段一验证结果、拟刷新视觉基线清单。
6. 任何真实 publish 动作仍永久禁止自动执行；只允许记录需要人工发布审批的事项。

## 单个任务的标准流程

1. 读修复计划该任务完整条目（含 R2/R3 追加与订正——订正可能缩小了范围，如 N-1 已降级只剩 readMetadata 误报）；补充文档收录的任务改读其 §3 拆解。
2. 回溯明细报告原文理解机理。
3. 当前代码定位并复现；先写失败单测（红灯先行）。
4. 按方案做最小修复：不顺手重构、不改无关代码、不扩大范围。
5. 跑该任务要求的验证：`pnpm vitest run <相关文件>`；交互类补/跑 `pnpm exec playwright test <文件> --project=chromium`。
6. 回写文档：在修复计划勾选 checkbox，行尾追加「完成 YYYY-MM-DD：修复摘要；验证命令与结果」；按补充文档执行的任务同时记录执行到的子步骤编号；若出现需人工复核的测试点，同步追加到人工验证点记录文件。

每批结束全量回归：`pnpm lint && pnpm typecheck && pnpm test`；涉及布局/渲染加跑 `pnpm test:visual`（基线刷新必须逐文件列明，不允许一句带过）。批次报告完成后继续下一项，不暂停等待确认。

## 特别警示（文档内置的坑）

- [G3-18] 死代码清理：`collectCommentThreadIds` / `findCommentThread` 同名多副本，只删 `command-builders.ts` 中两处死代码；`comment-command-builders.ts` 的同名实现有 7 处调用者，误删会破坏批注。
- [G6-H1] base64 修复直接参考同仓 `packages/persistence/src/storage-history-adapter.ts` 744-749 行的正确分块实现。
- [G2-01/G2-02/G2-20] 同改 `ensureLineFits`/`startNewPage`，必须同批（§3.2）。
- [G2-04] 字体度量必须按 §3.6 两阶段走：阶段一接口化（基线零变化）先落地并验证，阶段二才切真实测量。
- 补充文档标注"（可推翻）"的决策：若执行中发现决策不可行（如 Ed25519 兼容成本过高），按决策文本中预留的备选路线执行并回写决策记录，不要卡住。

## 阶段报告格式（每批一份）

1. 已完成任务：编号 + 一句话结论 + 验证命令及结果（测试数量/通过情况）。
2. 按 §2 流程分流的条目：自愈确认（附证据）/ 按现状修（附差异说明）/ 待人工裁决清单。
3. 修复中新发现的问题：只记录不顺手修。
4. 视觉基线变更清单（如有，逐文件列出）。
5. 全量回归结果与下一批计划。
