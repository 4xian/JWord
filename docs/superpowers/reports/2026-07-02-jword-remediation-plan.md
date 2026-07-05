# JWord 全项目审查修复计划（2026-07-02）

## 背景与使用说明

本计划基于 2026-07-02 完成的 7 份并行代码审查报告，将全部审查发现去重、归并后按修复阶段组织。来源报告（均在 `docs/superpowers/reports/`）：

| 报告 | 范围 | 问题规模 |
|------|------|----------|
| `2026-07-02-plan-review.md` | 规划文档整体审查 | 3 Critical + 10 Major + 17 建议（R2 +4 Major +7 建议） |
| `2026-07-02-gate0-gate1-review.md` | 工程基座 + 状态模型/事务 | 41 项（18 主要；R2 +2 主要 +1 提示，P0/主要全部核实属实） |
| `2026-07-02-gate2-gate3-review.md` | 分页布局/渲染 + 输入/编辑 | 50 项（R2 +3；2 P0 / 8 P1 全部核实属实） |
| `2026-07-02-gate4-review.md` | 块级结构 | 18 项（R2 +1 低；BUG/高 全部核实属实） |
| `2026-07-02-gate45-gate5-review.md` | 原生格式 + DOCX/PDF 互通 | 5 P1（N-1 经 R2 降级 P2）+ 约 18 P2 + 若干 P3（R2 +5，含 zip 炸弹防护） |
| `2026-07-02-gate6-review.md` | 协作/离线/自动插入 | 4 HIGH / 6 MEDIUM / 4 LOW（R2 +1 HIGH +1 LOW，G6-M3 升级为安全项） |
| `2026-07-02-gate7-review.md` | SDK 稳定化方案（未实施） | 12 项方案问题（R2 +4，含错误码单一真源 HIGH）+ 差距分析 |

R2 第二轮复审说明（2026-07-02）：四个方向的独立复审已把增补条目并入本计划（标注「（R2 复审补充）」）；首轮全部 阻断/P0/BUG/HIGH 级发现经逐条源码核实均属实、无一推翻，另有约 16 处订正已就地标注（如 N-1 降级、bundle 实测数字修正、G3-18 死代码范围收窄）。计划文档层面的 R2 新增问题（CI 纸面门禁、checkbox 状态失真、WPS-only 商业错位、Beta 欠账）也已在对应 Phase 落任务。

R3 子代理复审说明（2026-07-02）：按用户要求开启 5 个 `gpt-5.5 / xhigh` 子代理并行审查 Gate 0-1、Gate 2-3、Gate 4-5、Gate 6、Gate 7/全局计划；主进程对返回结果去重后并入本计划。新增重点包括：vitest worker alias 顺序失效、shared transaction selection 未 resolve、公开 range snapshot 稳定性边界、跨 section 删除失败、inline object 布局/dirty page 缺口、DOMPurify link/table paste 未闭环、license FNV 提升为 GA blocker、Gate 6 restoreVersion 语义错误、WebSocket tenant/auth 隔离缺口、Gate 7 no-alias 发布验证缺失。

任务编号规则：沿用来源报告编号（如 `G3-01`、`D-1`、`N-2`、`G6-H1`），方便回溯问题详情。每个任务包含：涉及文件、问题简述、具体修复方案、验证方式、工作量（S 半天内 / M 1-2 天 / L 3-5 天 / XL 1 周以上）、依赖关系。

后续执行建议：每个任务领取时补 `Owner/Lane`（core、ui、docx/pdf、collab、release/docs）、产物路径与精确验收命令；Phase 6 发布类任务必须额外标明是否需要 external no-alias project smoke 和 Kimi/真实浏览器验收。

执行补充（2026-07-03）：大工作量（L/XL）任务的子步骤拆解、设计类任务的方案定稿与产品/商业默认决策（D1-D9）统一收录在 `2026-07-03-remediation-execution-supplement.md`。凡该补充文档任务映射表收录的任务，以补充文档为准执行；其余任务按本文档条目执行。

约束提醒：所有修复必须遵守架构不变式——Y.Doc 唯一真源、所有变更走 Transaction Pipeline、core 包禁止导入 UI/docx/pdf/collab/框架、Layout 只读 Projection、Renderer 只消费 LayoutBox。修复不得为绕过 `tests/architecture/` 门禁而放宽测试。

---

## Phase 0 - P0 阻断修复（用户可感知的功能破坏，立即执行）

### 任务清单

- [x] **[G3-01] 实现 Shift+Arrow 键盘选区扩展** —— 完成 2026-07-03：先落地 G1-03 文档序方向推断，再让 Arrow/Home/End 读取 `shiftKey` 并在扩展时保持 anchor、移动 focus；验证 `pnpm exec vitest run packages/core/test/model/selection.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts packages/core/test/editor/mount-lifecycle.test.ts`（4 files, 40 passed）、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium`（10 passed, 1 skipped）。
  - 文件：`packages/core/src/editor/input-runtime.ts`
  - 问题：Shift+方向键选区扩展完全缺失，用户无法通过键盘选中文本，属基础编辑能力硬缺口。
  - 修复方案：在 keyboard handler 的方向键分支读取 `event.shiftKey`；为真时保持 selection anchor 不动、仅移动 focus（复用现有 caret 移动定位逻辑计算新 focus 位置），构造 `SelectionState { anchor, focus, direction }` 后走 selection command 更新；同时覆盖 Shift+Home/End（扩展到行首/行尾）。
  - 验证：新增单测覆盖 Shift+Left/Right/Up/Down/Home/End 六种扩展；e2e 里验证 Shift+Right 三次后选中 3 个字符并可整体删除。
  - 工作量：M。依赖：无（建议与 G1-03 选区方向修复同批做，见 Phase 1）。

- [x] **[G3-02] 修复有选区时 Enter 键无效** —— 完成 2026-07-03：`splitParagraphFromRuntime` 在非折叠选区下同一 command 内先 deleteRange 再 splitBlock，undo 一步恢复；验证 `pnpm exec vitest run packages/core/test/model/selection.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts packages/core/test/editor/mount-lifecycle.test.ts`（4 files, 40 passed）、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium`（10 passed, 1 skipped）。
  - 文件：`packages/core/src/editor/text-editing-runtime.ts:1330` 附近
  - 问题：存在非折叠选区时按 Enter 无任何反应；预期行为是先删除选区内容再分段。
  - 修复方案：Enter 处理分支在 `selection.isCollapsed === false` 时，先构造 `deleteRange` 再 `splitBlock`，两个 operation 放入同一 command/同一 `ydoc.transact`，保证 undo 一步回滚。
  - 验证：单测：选中跨 run/跨段文本按 Enter，断言删除+分段一次事务完成、undo 一步恢复；e2e 补一条选中后回车用例。
  - 工作量：S-M。依赖：若选区跨 run，需 G1-02（deleteRange 跨 run 支持）先行或同批完成。
  - R3 追加同批处理：跨 section / 跨容器 selection delete/cut/paste replace 失败（`text-editing-runtime.ts` delete plan 复用起始 sectionId，`mergeBlock` 只支持同容器相邻段落）。应让 selected target 携带真实 section/container，跨 section merge 明确语义或返回稳定 unsupported error。（已决策 D9：1.0 返回稳定 unsupported 错误，跨节合并留 post-1.0；见补充文档）

- [x] **[G4-BUG] 修复浮动工具栏格式按钮始终隐藏** —— 完成 2026-07-03：拆分格式按钮与链接按钮显隐逻辑，保留粗体/斜体/下划线/删除线/颜色控件可见，并在格式命令前冻结浮动工具栏位置避免首个格式改动漂移；验证 `pnpm exec vitest run packages/ui/test/selection-actions-dom.test.ts packages/ui/test/selection-actions-controller.test.ts`（2 files, 11 passed）、`pnpm exec playwright test examples/vanilla/tests/gate4-selection-actions.e2e.ts --project=chromium`（5 passed）。
  - 文件：`packages/ui/src/selection-actions/dom.ts`（`syncLinkActionVisibility()`）
  - 问题：选区浮动工具栏中的粗体/斜体等格式按钮被无条件隐藏，只剩链接按钮逻辑生效。
  - 修复方案：`syncLinkActionVisibility()` 只应控制链接相关按钮的显隐，格式按钮显隐改为独立函数按选区状态（非折叠即显示）控制；排查是否 CSS 类名/初始 `display:none` 未被清除。
  - 验证：UI 单测断言选中文本后浮动工具栏包含可见的加粗/斜体按钮；vanilla 示例手动确认。
  - 工作量：S。依赖：无。

**Phase 0 里程碑**：三项完成 + `pnpm lint && pnpm typecheck && pnpm test` 全绿，即可解除"基础编辑不可用"状态。

---

## Phase 1 - P1 严重缺陷修复

### 1A. 内存泄漏与事件生命周期（core）

- [x] **[G1-01 / G3-04] destroy 时移除 focus/blur 监听器** —— 完成 2026-07-03：`MountedEditorDom` 保存 focus/blur 与统一 `AbortController`，所有 mount 事件监听改走同一 signal，destroy 中一次 abort 清理；验证 `pnpm exec vitest run packages/core/test/editor/mount-lifecycle.test.ts`（3 passed）、focused 合集 `pnpm exec vitest run packages/core/test/model/selection.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts packages/core/test/editor/mount-lifecycle.test.ts packages/core/test/operations/operation-adapter.test.ts packages/core/test/canvas/pool.test.ts`（6 files, 57 passed）。
  - 文件：`packages/core/src/editor/mount-facade-runtime.ts`（约 204-205 行注册、273-286 行 destroy）
  - 修复方案：注册监听时统一用一个 `AbortController`，`addEventListener(..., { signal })`，destroy 中 `controller.abort()` 一次清空；顺带盘点同文件所有 `addEventListener` 是否全部走该 signal。
  - （R2 补充根因）`handleFocus`/`handleBlur` 从未被写入 `mountedDom` 对象字面量（约 209-257 行），destroy 侧本就无引用可移除；修复须先补这两个字段，再统一走 AbortController 清理。
  - 验证：单测 mount→destroy 两轮后对 window/document 派发 focus/blur，断言旧回调不触发（可用 spy 计数）。
  - 工作量：S。依赖：无。

- [x] **[G3-03] mouseup 改注册到 document** —— 完成 2026-07-03：`mouseup` 改挂 `ownerDocument` 并纳入 AbortController 生命周期，拖拽移出编辑器后在 document mouseup 结束指针状态；验证 `pnpm exec vitest run packages/core/test/editor/mount-lifecycle.test.ts`（3 passed）、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium`（10 passed, 1 skipped）。
  - 文件：`packages/core/src/editor/mount-facade-runtime.ts:193`
  - 问题：mouseup 挂在 canvasContainer 上，拖拽选区时指针移出编辑器再松开，选区停留在"拖拽中"状态。
  - 修复方案：mousedown 仍挂容器；mousedown 触发后把 mousemove/mouseup 临时挂到 `document`（同样走 AbortController），mouseup 后立即解除。
  - 验证：e2e：从编辑器内按下、拖到编辑器外松开，断言选区正确结束且后续点击行为正常。
  - 工作量：S。依赖：与 G1-01 同一文件，建议同一 PR。

- [x] **[G2-13] Canvas 池补 dispose 并接入 editor destroy** —— 完成 2026-07-03：`CanvasPool.dispose()` 将 active/available canvas 宽高置 0、清空池并让后续 acquire 抛 `CANVAS_POOL_DISPOSED`，editor destroy 释放 mounted canvases 后调用 dispose；验证 `pnpm exec vitest run packages/core/test/canvas/pool.test.ts`（4 passed）、`pnpm exec vitest run packages/core/test/editor/mount-lifecycle.test.ts`（3 passed）。
  - 文件：`packages/core/src/canvas/pool.ts`
  - 修复方案：新增 `dispose()`：遍历池内 canvas，将宽高置 0（释放位图内存）、从 DOM 移除、清空内部数组；`destroy()` 流程调用；同时加双重释放防护（G2-14：release 已释放页时抛错或忽略并告警）。
  - 验证：单测：dispose 后池为空且再次 acquire 抛出明确错误；多次 mount/destroy 循环无 DOM 残留节点。
  - 工作量：S-M。依赖：无。

- [x] **[G3-05] 输入异常不再静默吞没** —— 完成 2026-07-04：`runProtectedInputHandler` 捕获异常后发布 `error` 事件，携带稳定错误码、命令名、message、details 与 recoverable 标记，输入流保持可恢复；开发模式输出 `console.error`。验证 `pnpm exec vitest run packages/core/test/editor/input-runtime.test.ts --testNamePattern "supports basic keyboard editing"`（1 passed / 30 skipped）、`pnpm exec vitest run packages/core/test/editor/input-runtime.test.ts`（31 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
  - 文件：`packages/core/src/editor/input-runtime.ts:408-424`
  - 修复方案：catch 块中通过 editor 事件总线发布 `error` 事件（携带稳定错误码与 command 名称），保留"不中断输入流"的行为但让宿主可观测；开发模式 `console.error`。
  - 验证：单测注入抛错的 command，断言 error 事件 payload 且后续输入仍可用。
  - 工作量：S。依赖：无。

### 1B. 编辑与选区核心正确性

- [x] **[G1-02] deleteRange 支持跨 run / 跨块删除** —— 完成 2026-07-03：按补充文档 §3.1 子步骤 1-5 实施，adapter 支持同段跨 run 与同 section 相邻段跨块三段式删除，跨表格单元格返回 `OPERATION_DELETE_RANGE_UNSUPPORTED_CONTAINER`，跨 section 按 D9 返回 `OPERATION_DELETE_RANGE_UNSUPPORTED_SECTION`，补 transaction undo 一步恢复；验证 `pnpm exec vitest run packages/core/test/operations/operation-adapter.test.ts`（13 passed）、`pnpm exec vitest run packages/core/test/editor/delete-range-runtime.test.ts`（2 passed）。
  - 文件：`packages/core/src/operations/operation-adapter.ts:519-524`
  - 修复方案：将 deleteRange adapter 从"仅同 run"扩展为三段式：首 run 尾部截断、中间 run/块整体删除、末 run 头部截断；跨块时对首尾块执行 mergeBlock 语义；全程单一 `ydoc.transact`。
  - 验证：fixture 覆盖同 run / 跨 run / 跨段 / 跨表格单元格边界（应拒绝并给稳定错误码）四类；undo 一步恢复。
  - 工作量：M-L。依赖：无；G3-02 依赖本项。
  - 拆解：见 `2026-07-03-remediation-execution-supplement.md` §3.1（含 D9 跨 section 语义决策）。

- [x] **[G1-03] 修复跨块选区方向恒为 forward** —— 完成 2026-07-03：`inferDirection` 改按 document/section/block/run/grapheme 稳定序比较并处理数字后缀 id，跨 run/跨段反向选区返回 backward；验证 `pnpm exec vitest run packages/core/test/model/selection.test.ts`（4 passed）、focused 合集 `pnpm exec vitest run packages/core/test/model/selection.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts packages/core/test/editor/mount-lifecycle.test.ts`（4 files, 40 passed）。
  - 文件：`packages/core/src/editor/selection.ts:120-140`
  - 修复方案：比较 anchor/focus 的文档序（块索引 + 块内 offset 组成的复合序），据此计算 `direction: 'forward' | 'backward'`，不再对跨块场景短路返回 forward。
  - 验证：单测：从后往前跨段拖选，断言 direction 为 backward，且 Shift+Arrow 在 backward 选区上收缩/扩展方向正确。
  - 工作量：S-M。依赖：G3-01 体验依赖本项。
  - R3 追加：shared transaction 后先 resolve 当前 selection 的 anchor/focus，再 emit selectionChange，避免 formattingState 使用旧 graphemeIndex。
  - R3 追加：公开 `EditorRangeSnapshot` / `EditorTextLocation` 标注 non-stable 或改用稳定 Anchor/Range 序列化，避免宿主把 runId+graphemeIndex 当长期锚点。

- [x] **[G3-20] 修订标记应用于选区全部 run** —— 完成 2026-07-04：`buildAddRevisionMetadataCommand` 改为枚举选区全部 run，同一 revision 生成多条 `addRevisionMetadata`；局部首尾 run 通过 `range` 拆分后只标记选中片段，并同步迁移 revision rangeSnapshot；验证 `pnpm exec vitest run packages/core/test/operations/revision-command-builders.test.ts --testNamePattern "marks every selected run"`（红灯先行，1 failed）、`pnpm exec vitest run packages/core/test/operations/revision-command-builders.test.ts`（3 passed）、`pnpm exec vitest run packages/core/test/operations/operation-adapter.test.ts packages/core/test/editor/delete-range-runtime.test.ts packages/core/test/operations/revision-command-builders.test.ts`（3 files, 18 passed）、`pnpm exec vitest run packages/ui/test/create-ui-revisions.test.ts`（1 passed，UI 点击按段落全局 offset 校验修订范围）、`pnpm typecheck`（通过）。
  - 文件：`packages/core/src/commands/revision-command-builders.ts:39`
  - 修复方案：命令构建时枚举选区覆盖的全部 run（含首尾部分覆盖时先 split run），对每个 run 写修订 metadata，同一事务提交。
  - 验证：fixture：跨 3 个 run 的选区标记插入型修订，断言 3 个 run 均带修订元数据。
  - 工作量：M。依赖：无。
  - （R2 补充）Gate 4/4.5/5 复审独立确认同一问题（`revision-command-builders.ts:39、63-64`）：`rangeSnapshot` 保存完整范围、定位不受影响，缺口仅在可见化（只有 runs[0] 带 revisionId 高亮），实际严重度略低于首轮判级，修复方案不变。

### 1C. 布局引擎

- [x] **[G2-01] 实现 Justify 两端对齐** —— 完成 2026-07-04：`paragraph-flow` 在软换行 flush 时对非末行执行 justify，按空格与 CJK 字符间可伸展间隙分配剩余宽度，末行/硬换行保持左对齐；新增 Gate 2 修复视觉样张覆盖 justify 与跨页表格组合。验证 `pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts`（1 file, 4 passed）、`pnpm exec vitest run packages/core/test/layout/runtime.test.ts packages/core/test/layout/table-layout-render-hit-test.test.ts packages/core/test/layout/query.test.ts packages/core/test/layout/pagination-remediation.test.ts`（4 files, 47 passed）、`pnpm exec playwright test examples/vanilla/tests/gate2.visual.ts --project=visual-chromium --grep "remediation" --update-snapshots`（1 passed，新增 `gate2-remediation-justify-table-baseline` 样张）、`pnpm test:visual`（8 passed）。
  - 文件：`packages/core/src/layout/paragraph-flow.ts:490-493`
  - 修复方案：行内 fragment 定位阶段，对 `justify` 段落计算行剩余宽度并按可伸展空隙（空格、CJK 字符间）均匀分配额外 advance；段落最后一行与硬换行行保持左对齐（Word 语义）。
  - 验证：布局单测：固定字体度量下断言 justify 行两端 x 坐标；视觉回归补一张 justify 样张。
  - 工作量：M。依赖：无。

- [x] **[G2-02] 表格跨页断行** —— 完成 2026-07-04：按补充文档 §3.2 子步骤 1-4、6-7 实施；`TableBox` 增加 `startRowIndex` 与延续标记，`layoutTable` 改为只在 layout 输出层按整行分页，当前页放不下首行时整表下移到下一页；`findBlockPageIndexes()` 已能返回跨页表格所在全部页。验证 `pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts`（1 file, 4 passed，覆盖 20 行表格跨 2 页、首行剩余空间不足整表下移、跨页表格页索引）、`pnpm exec vitest run packages/core/test/layout/runtime.test.ts packages/core/test/layout/table-layout-render-hit-test.test.ts packages/core/test/layout/query.test.ts packages/core/test/layout/pagination-remediation.test.ts`（4 files, 47 passed）、`pnpm exec playwright test examples/vanilla/tests/gate2.visual.ts --project=visual-chromium --grep "remediation" --update-snapshots`（1 passed，新增跨页表格视觉样张）、`pnpm test:visual`（8 passed）。
  - 文件：`packages/core/src/layout/engine.ts:564-567`
  - 修复方案：分页时表格高度超出当前页剩余空间则按行拆分：整行为最小拆分单元，当前页放不下首行时整表下移；拆分处生成延续 TableBox（可选重复表头行，作为后续增强）。禁止修改状态，仅在 layout 输出层拆分。
  - 验证：布局单测：20 行高表格跨 2 页，断言两页各有 TableBox 且行不截断；e2e 视觉样张。
  - 工作量：L。依赖：无（Gate 4 高风险项同源，一并解决）。（R2 提示：与 G2-20 同改 `ensureLineFits`/`startNewPage`，必须同批实施避免冲突。）
  - 拆解：见补充文档 §3.2。

- [x] **[G2-20] 跨页续排段前距策略（R2 复审补充）** —— 完成 2026-07-04：按补充文档 §3.2 子步骤 1、5、7 实施；`ensureLineFits` 在段前距后发现首行溢出时先丢弃上一页空段落盒，再 `startNewPage` 并在新页重新开始段落，续排页首不重复计段前距。验证 `pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts`（1 file, 4 passed，覆盖 spacingBefore 溢出时上一页无空段落盒且新页首行 y 等于 contentRect.y）、`pnpm exec vitest run packages/core/test/layout/runtime.test.ts packages/core/test/layout/table-layout-render-hit-test.test.ts packages/core/test/layout/query.test.ts packages/core/test/layout/pagination-remediation.test.ts`（4 files, 47 passed）。
  - 文件：`packages/core/src/layout/paragraph-flow.ts:202-209、238-242`
  - 问题：段落跨页续排时段前距既不忽略也不补偿，续排页首行的间距语义未定义。
  - 修复方案：`startNewPage` 后显式定义续排段前距策略（对齐 Word 语义：续排页不再重复计段前距），补跨页 fixture。
  - 验证：跨页段落布局单测断言续排页首行 y 起点。
  - 工作量：S。依赖：与 G2-01/G2-02/G2-03 共享跨页 fixture，建议同批实施。

### 1D. DOCX / PDF / Native 正确性

- [x] **[D-1] DOCX 导入尊重 w:val on/off 语义** —— 完成 2026-07-03：四类 run toggle 改读 `w:val`，`false/0/off/none` 不再误判开启；显式关闭与非 `single` 下划线线型产出 `DOCX_RUN_PROPERTY_UNSUPPORTED` warning，避免静默丢失；验证 `pnpm exec vitest run packages/docx/test/public-api-import.test.ts packages/docx/test/roundtrip-diff.test.ts`（2 files, 9 tests passed）。
  - 文件：`packages/docx/src/import-readers.ts:78-89`
  - 修复方案：bold/italic/underline/strike 四属性改用同文件已有的 `readOnOffValue`（406-409 行）读取 `w:val`，`false/0/none` 显式关闭；underline 还需读 `w:val` 样式值（single/none 等）。
  - 验证：fixture 增加 `<w:b w:val="false"/>` 样例，断言导入后 run 非加粗；roundtrip 测试同步更新。
  - 工作量：S。依赖：无。
  - （R2 同源合并）随 D-1 一并修复：toggle 被误判开启时完全不产 warning、数据静默丢失（`import-readers.ts:146-157`）；`<w:u w:val="none"/>` 及下划线线型被误读为开启（`import-readers.ts:84-86`）。fixture 同步覆盖三种场景。

- [x] **[D-2] 多 section 导出保留分节** —— 完成 2026-07-04：`writeDocumentXml` 改为按 section 顺序写正文；非末 section 将本节 `sectPr` 写入该节最后一个段落的 `pPr`，末 section 继续保留 body 尾部 `sectPr`，表格或空 section 以空段落承载分节属性；不再摊平静默丢失前序 section 页面设置。验证 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "multi section"`（红灯先行，1 failed；修复后 1 passed / 9 skipped）、`pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/roundtrip-diff.test.ts`（2 files, 12 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 64 passed）、`pnpm --filter @4xian/jword-docx typecheck`（通过）、`pnpm typecheck && pnpm lint`（通过）。
  - 文件：`packages/docx/src/export.ts:547-554`
  - 修复方案：`writeDocumentXml` 按 section 遍历：非末 section 的 `sectPr` 写入该节最后一个段落的 `pPr` 内（OOXML 段落级分节符语义），末 section 的 `sectPr` 保持写在 body 尾部。若短期不实现，至少先产出 `DOCX_EXPORT_SECTION_FLATTENED` warning 不再静默。
  - 验证：双 section fixture 导出后用 `inspectDocxPackage` 断言两个 `sectPr`；WPS 打开确认分页设置分别生效。
  - 工作量：M。依赖：无。
  - 补充 2026-07-04：全量回归重新生成 `docx-t2-section-breaks.docx`（sha256 `19efa454a0c300f266c668e59bcfc722d4ff32f579cf1d6aa9d73e9303a34925`），旧 WPS 手工证据绑定旧 hash，已在 `fixtures/docx/manual-compatibility-results.json` 标回 pending，等待人工重新打开验证。

- [x] **[P-1] PDF 导出渲染文本样式** —— 完成 2026-07-04：按补充文档 §3.3 子批 a-d 实施；PDF 标准字体按 regular/bold/italic/boldItalic 映射 Helvetica 变体，嵌入字体按 family + weight + style 登记且缺变体时回退 regular 并产 recoverable warning；`renderPdfTextFragment` 现在绘制背景色、underline/strike 装饰线，并用 core 共享上下标基线比例对齐 canvas renderer。为满足 Gate 5 文件预算，PDF 文本样式 helper 拆入 `text-style-renderer.ts`、几何换算拆入 `pdf-geometry.ts`，P-1 测试 helper 拆出 public-api-pdf-style-helpers。验证：红灯先行分别复现 `bold and italic`、`embedded regular font`、`underline and strike`、`background rectangles`、`superscript and subscript` 5 条样式缺失；修复后 `pnpm exec vitest run packages/pdf/test/public-api.test.ts --testNamePattern "bold and italic|embedded regular font|underline and strike|background rectangles|superscript and subscript"`（1 file, 5 passed / 17 skipped）；`pnpm --filter @4xian/jword-pdf test`（4 files, 36 passed）；`pnpm --filter @4xian/jword-pdf typecheck`（通过）；`pnpm exec vitest run tests/architecture/gate5-pdf-file-budget.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/visual-report.test.ts`（3 files, 26 passed）；`pnpm exec vitest run packages/core/test/canvas/renderer.test.ts packages/core/test/layout/font-manager.test.ts packages/core/test/index.test.ts`（3 files, 29 passed）；`pnpm typecheck`、`pnpm lint`、`pnpm test`（144 files, 736 passed）、`pnpm test:visual`（8 passed）。
  - 文件：`packages/pdf/src/index.ts:390-406`；样式定义 `packages/core/src/layout/font-manager.ts:13-34`
  - 修复方案：`renderPdfTextFragment` 消费完整 `ResolvedFontStyle`：bold/italic 选择对应字体变体（嵌入字体需支持按变体注册，标准字体映射 Helvetica-Bold 等）；underline/strike 在文本基线相对位置 `drawLine`；背景色先 `drawRectangle`；上下标调整 y 偏移与字号比例。
  - 验证：pdf 单测断言页面内容流包含线条与矩形操作；`tools/compat` 视觉报告样张对比。
  - 工作量：L。依赖：无。
  - 拆解：见补充文档 §3.3（四个子批）。

- [x] **[P-2] 修复 Latin-1 文本被误判需嵌入字体** —— 完成 2026-07-04：当前代码仍用 `codePoint > 127` 判断需嵌入字体，红灯复现为无嵌入字体导出 `Café über señor` 抛 `PDF_FONT_MISSING`；修复为仅当文本超出 PDF 标准字体 WinAnsi 覆盖范围（当前按 0-255 放行）才要求嵌入字体，Latin-1 走标准 Helvetica，中文无嵌入字体仍阻断。验证：`pnpm exec vitest run packages/pdf/test/public-api.test.ts --testNamePattern "Latin-1|Chinese text without"`（1 file, 2 passed / 21 skipped，修前 Latin-1 1 failed）；`pnpm --filter @4xian/jword-pdf test`（4 files, 37 passed）；`pnpm --filter @4xian/jword-pdf typecheck`（通过）；`pnpm exec vitest run tests/architecture/gate5-pdf-file-budget.test.ts`（1 file, 1 passed）；`pnpm typecheck`、`pnpm lint`（通过）。
  - 文件：`packages/pdf/src/index.ts:757-827`
  - 修复方案：`containsNonAsciiText` 的阈值从 `codePoint > 127` 改为"标准 14 字体 WinAnsi 可编码集之外"（可用 pdf-lib 标准字体的 encode 尝试或维护 WinAnsi 码表判断）；不可编码字符才要求嵌入字体。
  - 验证：单测：含 é/ü 文本、无嵌入字体配置导出成功；含中文无嵌入字体仍抛 `PDF_FONT_MISSING`。
  - 工作量：S-M。依赖：无。

- [x] **[N-1] native 错误码按解析对象细分** —— 完成 2026-07-04：按 R2 订正后的缩小范围实施，保留当前已存在的 document/checksums 细分错误码，仅补 `JWORD_NATIVE_METADATA_INVALID` 并让 `readMetadata` 的 JSON 对象校验与 catch fallback 都归类为 metadata invalid；同步把 native diagnostic/error/warning code 类型列入公开 API 清单。验证：红灯先行 `pnpm exec vitest run packages/native/test/public-api.test.ts --testNamePattern "metadata-specific"`（1 failed，metadata 非对象误报 `JWORD_NATIVE_MANIFEST_INVALID`）；修复后同命令（1 file, 1 passed / 10 skipped）；`pnpm exec vitest run packages/native/test`（2 files, 14 passed）；`pnpm --filter @4xian/jword-native typecheck`（通过）。
  - 文件：`packages/native/src/index.ts:630、808-841`
  - 修复方案：新增 `JWORD_NATIVE_METADATA_INVALID`、`JWORD_NATIVE_DOCUMENT_INVALID`、`JWORD_NATIVE_CHECKSUMS_INVALID` 错误码，各解析分支抛对应码，`JWORD_NATIVE_MANIFEST_INVALID` 只留给 manifest 本身；错误码目录文档同步。
  - 验证：损坏 fixture 分别触发三种错误码的单测。
  - 工作量：S。依赖：无。
  - （R2 订正，P1 → P2）document/checksums 的细分错误码已在当前代码中存在；残留问题仅 `readMetadata` 的 catch（`index.ts:630`）仍误报 `MANIFEST_INVALID`。范围缩小后可降级至 Phase 3C 顺带修复。

- [x] **[N-2] 建立可扩展 schema 迁移链** —— 完成 2026-07-04：`migrateDocument` 改为按 `SCHEMA_MIGRATION_STEPS` 注册表逐步迁移；0→1 作为显式空迁移步骤保留并用中文注释冻结"结构一致"语义，`appliedSteps` 只记录实际执行的 step；无路径可达当前 schema 的旧版本返回新增稳定错误码 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`，未来 schema 仍保持 `JWORD_NATIVE_SCHEMA_FUTURE`。验证：红灯先行 `pnpm exec vitest run packages/native/test/public-api.test.ts --testNamePattern "unsupported schema"`（1 failed，schema -1 validate 仍为 valid）；修复后同命令（1 file, 1 passed / 10 skipped）；`pnpm exec vitest run packages/native/test`（2 files, 14 passed）；`pnpm --filter @4xian/jword-native typecheck`（通过）；`pnpm exec vitest run tests/architecture/gate45-native-boundary.test.ts`（1 file, 4 passed）；`pnpm typecheck`、`pnpm lint`（通过）。
  - 文件：`packages/native/src/index.ts:868-882`
  - 修复方案：迁移改为 step 注册表 `[{ from: 0, to: 1, migrate(doc) }]` 顺序执行；0→1 若确无变更则显式空实现并注释说明；报告的"已执行迁移"必须与实际执行的 step 列表一致；无路径可达目标版本时抛 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`。
  - 验证：单测：模拟 v0 文件升级到 v1 记录正确；伪造 v99 文件得到稳定错误。
  - 工作量：M。依赖：无。

### 1E. 协作（Gate 6 HIGH）

- [x] **[G6-H1] 修复 base64 编码栈溢出** —— 完成 2026-07-03：参考 `packages/persistence/src/storage-history-adapter.ts` 的安全循环思路，`client-history` 改为 0x8000 分块编码并用循环解码，避免大 update 展开到调用栈；验证 `pnpm exec vitest run packages/collab/test/client-history-base64.test.ts packages/collab/test/public-client.test.ts`（2 files, 11 tests passed）。
  - 文件：`packages/collab/src/client-history.ts:478`
  - 修复方案：`String.fromCodePoint(...update)` 改为分块循环（每块 ≤ 0x8000 字节 `String.fromCharCode.apply`）或平台分支（Node 用 `Buffer.from(update).toString('base64')`，浏览器分块 + `btoa`）。
  - 验证：单测编码 1MB Uint8Array 不抛栈溢出且解码还原一致。
  - 工作量：S。依赖：无。

- [x] **[G6-H2] IndexedDB update 监听去掉全量重编码** —— 完成 2026-07-04：`BrowserIndexedDbOfflineAdapter` 的 `update` 监听改为累加事件自带 update 字节数，`whenSynced` 与 `storeUpdate` 不再调用 `Y.encodeStateAsUpdate(document)` 做全量重编码；Node 单测用模拟 y-indexeddb provider 复现连续 1000 次小编辑。验证：红灯先行 `pnpm exec vitest run packages/persistence/test/indexeddb-adapter.test.ts --testNamePattern "update bytes"`（1 failed，`encodeStateAsUpdate` 被调用 1001 次）；修复后同命令（1 file, 1 passed / 2 skipped）；`pnpm exec vitest run packages/persistence/test`（3 files, 16 passed）；`pnpm --filter @4xian/jword-persistence typecheck`（通过）；`pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-package-exports.test.ts`（2 files, 15 passed）；`pnpm typecheck`、`pnpm lint`（通过）。
  - 文件：`packages/persistence/src/indexeddb-adapter.ts:103-105`
  - 修复方案：不再每次 update 调 `Y.encodeStateAsUpdate(document)`；byteLength 统计改为累加事件自带 update 的长度，或对全量编码做 ≥500ms debounce 且仅在需要上报时执行。
  - 验证：基准测试：连续 1000 次小编辑，断言全量编码调用次数为 0（或 debounce 后 ≤ 次数上限）。
  - 工作量：S-M。依赖：无。

- [x] **[G6-H3] 消除 Hocuspocus autoConnect 竞态** —— 完成 2026-07-04：Hocuspocus WebSocket provider 构造固定 `autoConnect: false`，移除构造阶段 `provider.attach()`，连接统一在 adapter `connect()` 中先 attach 再显式 `websocketProvider.connect()`；同步更新真实 Hocuspocus 集成测试，直连 adapter 的测试场景改为显式 connect 后等待同步/错误。验证：红灯先行 `pnpm exec vitest run packages/collab/test/hocuspocus-adapter.test.ts --testNamePattern "construction"`（1 failed，构造时仍 autoConnect=true），修复后 `pnpm exec vitest run packages/collab/test/hocuspocus-adapter.test.ts`（1 file, 2 passed）、`pnpm exec vitest run packages/collab/test`（5 files, 23 passed）、`pnpm exec vitest run examples/collab/tests/hocuspocus-provider.test.ts`（1 file, 6 passed）、`pnpm exec vitest run packages/collab-server/test/server.test.ts`（1 file, 18 passed）、`pnpm --filter @4xian/jword-collab typecheck`（通过）、`pnpm exec vitest run tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-package-exports.test.ts`（2 files, 15 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（145 files, 741 passed）。
  - 文件：`packages/collab/src/hocuspocus-adapter.ts:55-112`
  - 修复方案：构造 WebSocket provider 时强制传 `autoConnect: false`，连接动作只在 adapter 的 `connect()` 中显式发起；保证握手/授权检查先于任何网络连接。
  - 验证：单测断言构造后未发起连接（mock provider 的 attach 未被调）；连接前授权失败路径正确抛错。
  - 工作量：S。依赖：无。

- [x] **[G6-H4] 修复 `restoreVersion()` 只 apply 旧 update 不能真正回退的问题（R3）**。完成 2026-07-03：新增 core `replaceSyncUpdate()` 受控替换路径，collab `restoreVersion()` 通过隔离 Y.Doc 重放目标 update 后替换当前 canonical document，保留 `version-restore` origin；验证：`pnpm exec vitest run packages/collab/test/public-client.test.ts packages/collab/test/public-client-restore.test.ts`（2 files / 11 tests passed）。
  - 文件：`packages/collab/src/client-history.ts:122-157`、`packages/core/src/editor/collaboration-runtime.ts`
  - 修复方案：用隔离 Y.Doc 应用目标版本 update，再通过 core 受控替换当前 canonical document；不能直接把旧 update apply 到当前 doc。
  - 验证：record v1、record v2、restore v1 后断言 v2 文本消失，并保留 `version-restore` origin。
  - 工作量：M。依赖：无。

- [x] **[G6-H5] Hocuspocus WebSocket 服务补 tenant/authHook 隔离（R3）**。完成 2026-07-03：按补充文档 §3.5 步骤 1-4 实施 `{tenantId}/{documentId}` 解析、tenantHook/authHook 默认拒绝、read/write 权限和 `COLLAB_PERMISSION_DENIED` 诊断；验证：`pnpm exec vitest run packages/collab-server/test/server.test.ts`（1 file / 18 tests passed）。
  - 文件：`packages/collab-server/src/hocuspocus-server.ts`
  - 修复方案：解析 documentName 为 tenantId/documentId/roomId，onConnect/onAuthenticate/beforeSync 中调用宿主 auth/tenant hook，拒绝跨 tenant update。
  - 验证：跨 tenant/documentName 连接被拒，合法用户可进入对应 room。
  - 工作量：M。依赖：计划审查 3.11 权限粒度设计（设计已定稿）。
  - 拆解：见补充文档 §3.5（documentName 约定、read/write 两级权限、默认拒绝）。

- [x] **[G6-R2-1] 用户身份缺失改为阻断性错误（R2 复审补充）** —— 完成 2026-07-03：`validateConnectionOptions` 对缺失 user.id/name 返回 `COLLAB_USER_IDENTITY_REQUIRED` error 并阻止 provider 连接，新增 diagnostics registry 登记与 public-client 回归；验证 `pnpm exec vitest run packages/collab/test/public-client.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（2 files, 16 passed）。
  - 文件：`packages/collab/src/client-sdk.ts:690-698`
  - 问题：`user.id`/`name` 为空时只推送 `COLLAB_AWARENESS_STALE` warning 并继续连接，而 `user.id` 是 presence、auto-inserter actor id（:668）与 license authorId 的基础，诊断码语义也错配。
  - 修复方案：新增 `COLLAB_USER_IDENTITY_REQUIRED` 阻断性 error 码并登记 diagnostics registry，身份缺失时 fail-fast 不发起连接。
  - 验证：单测：缺 id/name 时连接被拒且诊断码稳定。
  - 工作量：S。依赖：诊断码 registry（见 Phase 6 错误码单一真源项）。

### 1F. 构建产物与商业阻塞

- [x] **[G0-04] 补齐 rollup externals** —— 完成 2026-07-03：Rollup external 改为从 `packages/*/package.json` 的包名、dependencies、peerDependencies 动态生成，并保留 `node:`/React/Vue 外置前缀；新增架构测试防止生产依赖再次被打进 dist；验证 `pnpm exec vitest run tests/architecture/gate0-rollup-externals.test.ts`（1 passed）、`pnpm build`（通过）、dist 外置 import 与无内联源码 grep（通过）；`pnpm size` 已跑出新实测但仍因既有 [gate7 2.6] 预算未校准失败：core 528091 > 260000、首屏 613485 > 330000。
  - 文件：`rollup.config.mjs`（约第 8 行 externals 定义）
  - 修复方案：externals 覆盖全部生产依赖：`dompurify`、`jszip`、`pdf-lib`、`fontkit`、`pdfjs-dist`、`yjs`、`y-protocols`、`y-indexeddb`、`@hocuspocus/provider`、`@hocuspocus/server` 及所有 `@4xian/jword-*` 互引；建议改为函数式 external（读各包 package.json dependencies 自动生成），防再漂移。
  - 验证：`pnpm build` 后 grep 各包 dist 无第三方库源码内联；`pnpm size` 数值显著回落并更新基线。
  - 工作量：S-M。依赖：无；Phase 6 bundle size 预算更新依赖本项先完成。

- [x] **[LIC-1] license 签名替换为密码学签名（GA 阻塞）** —— 完成 2026-07-03：按补充文档 §3.4 子步骤 1-6 与 D1 实施 JWL1 Ed25519 token、零依赖验签、显式 `allowInsecureFixtureLicense` 旧 FNV 兼容 warning、insecure-test-only 测试签发 helper 和架构护栏；验证 `pnpm exec vitest run packages/license/test/entitlement.test.ts packages/docx/test/public-api-license.test.ts packages/docx/test/worker.test.ts packages/pdf/test/public-api-license.test.ts packages/pdf/test/worker.test.ts packages/collab/test/contract.test.ts packages/collab/test/public-client.test.ts packages/collab/test/client-history-base64.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts`（11 files, 62 passed）、`pnpm typecheck`（通过）、`pnpm build && node tools/release/check-gate5-commercial-pack.mjs && node tools/release/check-gate6-commercial-pack.mjs`（通过）。
  - 文件：`packages/license/src/index.ts:222-236`
  - 问题：32 位 FNV-1a 哈希 + 可推导 verifier material，知道 issuer 即可伪造合法 license。
  - 修复方案：license token 改为非对称签名（推荐 Ed25519：签发端私钥签名，SDK 内置公钥验签，Web Crypto 的 `crypto.subtle.verify` + Node `node:crypto` 双实现，保持 license 包零第三方依赖）；保留旧格式解析仅用于开发 fixture 且显式标记 `insecure`；`tests/architecture/gate5-commercial-readiness.test.ts` 增加"禁止 FNV 签名进入发布路径"检查项。
  - 验证：单测：篡改 payload 任一字段验签失败；伪造 issuer 无法通过；离线 grace 语义不回归。
  - 工作量：M-L。依赖：无，但必须在任何商业发布/对外试用之前完成。
  - 设计定稿与拆解：见补充文档 D1 / §3.4（Ed25519、密钥管理、迁移策略已定）。

**Phase 1 里程碑**：P1 全部关闭后，编辑器达到"日常可用、导入导出可信、协作不崩溃、产物干净"状态，可对内 dogfooding。

---

## Phase 2 - 工程门禁与防线加固（Gate 0 补强）

- [x] **[G0-06 / G0-22] check-boundaries.mjs 封堵三种绕过通道** —— 完成 2026-07-04：`check-boundaries.mjs` 改用 TypeScript AST 收集 `import` / `export ... from` / 副作用 import / dynamic import，并从 `pnpm-workspace.yaml` 派生扫描根覆盖 `packages/*`、`examples/*`、`tools/*`、`fixtures`、`benchmarks`，源码扩展到 `.ts/.tsx/.js/.mjs` 且排除 dist/node_modules/coverage；ESLint `no-core-forbidden-imports` 同步检查 ExportNamedDeclaration/ExportAllDeclaration/ImportExpression。验证：红灯先行 `pnpm exec vitest run tools/lint/check-boundaries.test.ts`（1 failed，临时 workspace 被错误放过）；修复后 `pnpm exec vitest run tools/lint/check-boundaries.test.ts tests/architecture/core-boundary.test.ts`（2 files, 6 passed）、临时 core fixture 执行 `pnpm exec eslint packages/core/src/__boundary-eslint-fixture.ts`（预期失败，2 errors，验证 export 与 navigator 均被 ESLint 拦截，fixture 已删除）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（146 files, 743 passed）。
- [x] **[G0-08 / G0-09] core-boundary.test.ts 与 lint 防线对齐** —— 完成 2026-07-04：新增 `tools/lint/core-boundary-policy.json` 作为 core 禁止导入与顶层浏览器全局单一真源，`check-boundaries.mjs`、`eslint.config.js`、`tests/architecture/core-boundary.test.ts` 共用；禁止列表补齐 jszip/fontkit/pdf-lib/vite/playwright/@4xian/jword-ui/dompurify/@hocuspocus/provider/@4xian/jword-persistence/@4xian/jword-collab-server 等，DOM 名单扩充 navigator/localStorage/sessionStorage/self/globalThis/requestAnimationFrame/fetch 等；架构测试新增 core 顶层浏览器全局 AST 扫描。验证：同 G0-06/G0-22 focused 与全量命令。
  - R3 追加：`no-core-top-level-dom` 不得跳过 export initializer 与 class static field/block；DOM 全局名单扩充后由 ESLint 与 lint 脚本共用。
  - R3 追加：`check-boundaries.mjs` 扫描 root 从 `pnpm-workspace.yaml` 派生，覆盖 `benchmarks`/`fixtures`，并扩展 `.js/.mjs/.tsx` 与 dist/node_modules 排除。
- [x] **[G0-07] check-package-versions.mjs 扩展到所有子包** —— 完成 2026-07-04：脚本从 `pnpm-workspace.yaml` 派生 workspace package 清单，覆盖根包、`packages/*`、`examples/*`、`tools/*` 等存在 package.json 的工作区；所有外部依赖/overrides 必须精确 semver，内部工作区依赖必须使用 `workspace:` 协议。验证：红灯先行 `pnpm exec vitest run tools/lint/check-package-versions.test.ts`（1 failed，临时 workspace 子包 loose 版本与内部非 workspace 被放过）；修复后 `pnpm exec vitest run tools/lint/check-package-versions.test.ts`（1 file, 1 passed）、`node tools/lint/check-package-versions.mjs`（通过）、`pnpm exec vitest run tools/lint/check-package-versions.test.ts tools/lint/check-boundaries.test.ts tests/architecture/core-boundary.test.ts`（3 files, 7 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（147 files, 744 passed）。
- [x] **[G0-01 / G0-03 / G0-05] 依赖治理三联** —— 完成 2026-07-04：根 `package.json` 移除运行时 `dependencies`，将 Hocuspocus peer 所需 `yjs`/`y-protocols` 下沉到 collab-server 与 collab 示例，`tools/fixtures` 独立声明 `jszip`；G0-03 按 §2 复核现状已由共享 `core-boundary-policy.json` 覆盖 `dompurify`，本次以架构测试锁定根无生产依赖和 Vitest/Vite resolver 与 `tsconfig.base.json` paths 对齐；`vitest.config.ts` 补 `@4xian/jword-ui`、`@4xian/jword-ui/styles.css`、`@4xian/jword-native/worker` 并把 docx/pdf/native worker 子路径排在主包前。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate0-dependency-governance.test.ts`（2 failed，根依赖与 docx worker alias 复现）；修复后 `pnpm exec vitest run tests/architecture/gate0-dependency-governance.test.ts tools/lint/check-package-versions.test.ts tests/architecture/core-boundary.test.ts tests/architecture/gate0-rollup-externals.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts`（6 files, 16 passed）、`node tools/lint/check-package-versions.mjs && node tools/lint/check-boundaries.mjs`（通过）、`pnpm install --frozen-lockfile`（通过）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（pretest build 通过，148 files, 746 passed）。
- [x] **[G0-02] 补 pre-commit 钩子** —— 完成 2026-07-04：新增 `.husky/pre-commit`，保持 commit-msg 不动，pre-commit 直接执行 `pnpm lint && pnpm typecheck` 并设置可执行位；新增 `tests/architecture/gate0-husky-hooks.test.ts` 锁定 hook 存在、命令顺序与可执行位。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate0-husky-hooks.test.ts`（1 failed，缺 `.husky/pre-commit`）；修复后同命令（1 file, 1 passed）、`sh .husky/pre-commit`（实际跑通 `pnpm lint` + `pnpm typecheck`）、`pnpm test`（pretest build 通过，149 files, 747 passed）。
- [x] **[计划审查 2.10] CI 门禁修复（R2 复审补充）** —— 完成 2026-07-03：按补充文档 §2 复核确认 `.github/workflows/ci.yml` Install 步骤现状已包含 `pnpm exec playwright install --with-deps`（自愈确认），本地复跑 `pnpm exec playwright install --with-deps`（通过）并抽跑 `pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium`（10 passed, 1 skipped）。原问题描述：`.github/workflows/ci.yml` 没有任何 `playwright install` 步骤，E2E/visual 在全新 runner 上必然失败（CI 从未真实跑通，属纸面门禁）。工作量：S-M。依赖：无。
- [x] **[G0-10] packages/core 纳入文件行数预算** —— 完成 2026-07-04：新增 `tests/architecture/core-file-budget.test.ts`，按 1000 行基准覆盖 `packages/core/src` 与 `packages/core/test`；当前 8 个历史超标文件登记为 legacy 行数预算并锁定当前行数，Phase 5 拆分后需移除/收紧。验证：红灯先行 `pnpm exec vitest run tests/architecture/core-file-budget.test.ts`（1 failed，复现 8 个 core 文件超 1000 行且无预算）；修复后同命令（1 file, 2 passed）。
- [x] **[计划审查 1.1] 制定单文件拆分专项** —— 完成 2026-07-04：按补充文档 §3.10 回写专项清单，复核当前 `packages`、`examples`、`tests`、`tools`、`benchmarks` 下 `.ts/.tsx/.js/.mjs` 文件后登记 16 个超 1000 行文件；拆分批次覆盖 UI 装配、core command/adapter/runtime/store/layout、native codec、UI 控制器与大测试文件，要求一次只拆一个文件、公开导出面不变、拆分批次禁止夹带逻辑变更，并在触达 core 时同步收紧 `core-file-budget` legacy 预算。验证：当前代码统计命令复现 16 个超标文件；`pnpm exec vitest run tests/architecture/core-file-budget.test.ts`（1 file, 2 passed）。

**Phase 2 里程碑**：防线互相一致（lint、架构测试、依赖治理三方对齐），`pnpm lint` 能拦住全部已知绕过通道。

---

## Phase 3 - P2 质量与兼容性修复（按 Gate 分组）

### 3A. Gate 2/3（布局、输入、可访问性）

- [x] **[G2-R3] 修复 inline object 与表格 dirty page 布局缺口** —— 完成 2026-07-04：表格单元格内容布局从仅文本片段扩展为文本片段 + inline object，支持 cell 内 `line` break 换行和 inline image 可见/可命中/可渲染；正文非文本 inline 先进入 line/page fit 流程，页尾图片会移入下一页而不纵向溢出；`findBlockPageIndexes()` 已同时命中 `TableBox.tableId` 与单元格 `blockIds`。验证：红灯先行 `pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts --testNamePattern "table cell line breaks|page-tail inline images"`（2 failed，复现 cell inline 丢失与页尾图片溢出）；修复后同命令（1 file, 2 passed / 4 skipped）、`pnpm exec tsc -p tsconfig.json --noEmit --pretty false`（通过）、`pnpm exec vitest run packages/core/test/layout/runtime.test.ts packages/core/test/layout/query.test.ts packages/core/test/layout/pagination-remediation.test.ts packages/core/test/canvas/renderer.test.ts`（4 files, 56 passed）。

- [x] **[G3-06/07/08] 补齐键盘处理** —— 完成 2026-07-04：新增键盘文本运行时承接 PageUp/PageDown、Ctrl/Alt+Arrow 逐词移动、Ctrl+Backspace/Delete 逐词删除、Tab 段落缩进与表格单元格前后跳转；`Intl.Segmenter` word 粒度统一封装在 text runtime，输入运行时只分发组合键。验证：红灯先行新增 `packages/core/test/editor/keyboard-runtime.test.ts` 覆盖上述缺口；修复后 `pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/keyboard-runtime.test.ts`（3 files, 38 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（151 files, 756 passed）。
- [x] **[G3-11/12] 三击选段 + 拖拽自动滚动** —— 完成 2026-07-04：新增指针运行时 focused 测试复现三击仍为折叠光标、拖拽到视口边缘不滚动两个缺口；实现三击选中整段，并在拖拽靠近 canvas 容器上下边缘时按距离启动定时滚动，松开/取消指针工作时统一清理滚动定时器。验证：红灯先行 `pnpm exec vitest run packages/core/test/editor/pointer-runtime.test.ts`（1 file, 2 failed，复现缺口）；修复后同命令（1 file, 2 passed）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/mount-lifecycle.test.ts packages/core/test/editor/pointer-runtime.test.ts`（4 files, 38 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium`（10 passed, 1 skipped）、`pnpm test`（152 files, 758 passed）。
- [x] **[G3-09/10] 剪贴板健壮性** —— 完成 2026-07-04：新增剪贴板 focused 测试复现 `clipboardData: null` 空引用与粘贴控制字符穿透；`readClipboardData` 统一把 `null/undefined` 视为不可用，`normalizePlainText` 在保留换行和制表符的前提下过滤其余 C0 控制字符，避免放宽 lint 的 `no-control-regex`。验证：红灯先行 `pnpm exec vitest run packages/core/test/editor/clipboard-runtime.test.ts`（1 file, 1 failed + 3 uncaught errors，复现两个缺口）；修复后同命令（1 file, 2 passed）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/clipboard-runtime.test.ts`（3 files, 35 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium --grep "copy cut paste"`（1 passed）、`pnpm test`（153 files, 760 passed）。
- [x] **[G3-16] 事务监听器异常隔离** —— 完成 2026-07-04：新增事务管线 focused 测试复现监听器抛错会让 `pipeline.run()` 抛出并阻断后续 listener；`notifyListeners` 改为逐个 try/catch 收集异常并继续通知，开发模式输出监听器异常，避免已提交 Y.Doc 事务因 listener 副作用被调用方误判回滚；按 §2 按现状修：当前 `TransactionEvent` 无 error 事件通道，本次不扩大公开 API，Plugin API/error event 统一留给 Phase 6 对应任务。验证：红灯先行 `pnpm exec vitest run packages/core/test/operations/transaction.test.ts --testNamePattern "isolates listener errors"`（1 failed，抛出 `监听器失败`）；修复后同命令（1 file, 1 passed / 3 skipped）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/operations/transaction.test.ts packages/core/test/editor/facade-runtime.test.ts`（3 files, 28 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（pretest build 通过，153 files, 761 passed）。
- [x] **[G2-03] 执行 widow/orphan 控制** —— 完成 2026-07-04：新增分页 focused 测试复现 `orphanLines`/`widowLines` 策略虽已解析但未参与分页；`ensureLineFits` 在页尾溢出前检查段首 orphan 行数，不足阈值时把当前段首行整体移到下一页；段落结束后执行 widow 控制，必要时把上一页段尾行前移到续排页，保证续排页不少于 widow 阈值且上一页保留 orphan 阈值。验证：红灯先行 `pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts --testNamePattern "orphan|widow"`（2 failed，页尾孤行与续排页寡行均复现）；修复后同命令（1 file, 2 passed / 6 skipped）、`pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts packages/core/test/layout/runtime.test.ts packages/core/test/layout/query.test.ts`（3 files, 44 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test:visual`（8 passed，视觉基线无刷新）、`pnpm test`（pretest build 通过，153 files, 763 passed）。
- [x] **[G2-04] 字体度量改为真实测量** —— 完成 2026-07-05：按补充文档 §3.6 阶段一/阶段二实施，core 新增 `TextMeasurer` 注入接口并保持默认无 DOM 近似测量，浏览器 `mount()` 后用 canvas `measureText` 注入真实测量器并刷新布局缓存；缓存键收敛到 text/fontFamily/fontSizePx/bold/italic（G2-07），同时加入默认 4096 项 LRU 上限（G2-06）。刷新视觉基线：`examples/vanilla/tests/gate2.visual.ts-snapshots/gate2-remediation-justify-table-baseline-visual-chromium-darwin.png`、`examples/vanilla/tests/gate4.visual.ts-snapshots/gate4-desktop-feature-baseline-visual-chromium-darwin.png`、`examples/vanilla/tests/gate4.visual.ts-snapshots/gate4-long-table-baseline-visual-chromium-darwin.png`、`examples/vanilla/tests/gate4.visual.ts-snapshots/gate4-mobile-baseline-visual-chromium-darwin.png`。验证：`pnpm exec vitest run packages/core/test/layout/font-manager.test.ts`（13 passed）、`pnpm exec vitest run packages/core/test/editor/font-measurer-runtime.test.ts tests/architecture/core-file-budget.test.ts`（2 files passed）、focused 合集 `pnpm exec vitest run packages/core/test/layout/font-manager.test.ts packages/core/test/editor/font-measurer-runtime.test.ts packages/core/test/editor/runtime.test.ts packages/core/test/index.test.ts packages/core/test/layout/runtime.test.ts packages/core/test/layout/pagination-remediation.test.ts packages/core/test/layout/query.test.ts packages/core/test/canvas/renderer.test.ts tests/architecture/core-boundary.test.ts tests/architecture/core-file-budget.test.ts tests/architecture/gate7-public-api-catalog.test.ts`（通过）、`pnpm exec playwright test examples/vanilla/tests/gate2.visual.ts examples/vanilla/tests/gate4.visual.ts --project=visual-chromium --update-snapshots`（7 passed）、`pnpm test:visual`（8 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（154 files, 769 passed）。
- [x] **[G2-15] 选区绘制层级修正** —— 完成 2026-07-05：按 Gate2/3 复核原文调整 canvas renderer 层级，`renderTextBackgrounds` 先绘制 run 背景，`renderSelectionRects` 再绘制选区高亮，最后绘制文本与光标，避免带背景色文本被选中时背景覆盖选区；同步把 renderer 单测改为红灯先行验证背景 < 选区 < 文本顺序。验证：红灯先行 `pnpm exec vitest run packages/core/test/canvas/renderer.test.ts --testNamePattern "背景之上"`（1 failed，复现选区早于背景绘制）；修复后 `pnpm exec vitest run packages/core/test/canvas/renderer.test.ts`（14 passed）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/canvas/renderer.test.ts`（2 files, 16 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test:visual`（8 passed，视觉基线无刷新）。
- [x] **[G3-23/24/25/26/30/31] 工具栏与 a11y 系列** —— 完成 2026-07-05：toolbar 宿主补 `role="toolbar"`，内建工具按 WAI-ARIA toolbar 模式实现 roving tabindex 并支持 Arrow/Home/End 导航；自绘 select 菜单补 `role="listbox"`、选项补 `role="option"` 与 `aria-selected`，trigger 通过 `aria-controls` 关联菜单；tooltip 生成稳定 id 并给真实可聚焦控件设置 `aria-describedby`，tooltip 事件由 destroy 收集清理；live region destroy 清空残留文本，`BLOCKED:`/失败/错误类公告默认切换 `aria-live="assertive"`。验证：红灯先行 `pnpm exec vitest run packages/ui/test/toolbar-dom.test.ts packages/ui/test/live-region.test.ts --testNamePattern "roving|listbox|tooltip ids|destroyed|assertive"`（5 failed，复现缺口）；修复后同命令（5 passed / 10 skipped）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/live-region.test.ts packages/ui/test/toolbar-controller.test.ts packages/ui/test/toolbar-controller-readonly.test.ts`（5 files, 21 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（155 files, 774 passed）、`pnpm test:visual`（8 passed，视觉基线无刷新）。
- [x] **[G3-27] UI 事件监听统一 AbortController 清理** —— 完成 2026-07-05：toolbar controller 的按钮、select、颜色 pointer/click/input/change 监听统一绑定 controller `AbortController.signal`，destroy 后不再响应保留节点上的旧事件；tooltip 监听在 G3-23/24/25/26/30/31 同批改为独立 AbortController 并纳入 `destroyToolbarDom()`。验证：红灯先行 `pnpm exec vitest run packages/ui/test/toolbar-controller.test.ts --testNamePattern "destroy removes"`（1 failed，destroy 后点击旧 findReplace 仍触发 panel action）；修复后同命令（1 passed / 3 skipped）、`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/live-region.test.ts packages/ui/test/toolbar-controller.test.ts packages/ui/test/toolbar-controller-readonly.test.ts packages/core/test/canvas/renderer.test.ts packages/core/test/layout/table-layout-render-hit-test.test.ts`（7 files, 43 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test`（155 files, 774 passed）、`pnpm test:visual`（8 passed）。
- [x] **[G3-21] 修正 `discardNextTransactionMetadata` 方向语义** —— 完成 2026-07-05：`discardNextTransactionMetadata()` 改为与 `stack-item-added` 消费一致的 FIFO `shift()`，避免多条 pending metadata 排队时丢弃最新项、保留过期项；新增 history 单测先复现 `pop()` 导致 undo metadata 仍为首条命令的问题。验证：红灯先行 `pnpm exec vitest run packages/core/test/operations/history.test.ts --testNamePattern "discards pending"`（1 failed，收到 `first-command`）；修复后同命令（1 passed / 2 skipped）、`pnpm exec vitest run packages/core/test/operations/history.test.ts`（3 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[计划审查 2.8] 保格式粘贴 Beta 级安全验收套件（R2 复审补充）** —— 完成 2026-07-05：按 specs 06 安全清单新增 `tests/security/paste-security-acceptance.test.ts`，通过 UI 公开入口覆盖 Word HTML `mso-*` 样式不入 projection、SVG payload 降级纯文本、data URL 图片降级纯文本且不继承危险富文本格式；复用 DOCX public API fixture 断言外链图片不拉取、只保留 warning 证据。实现上 `paste/sanitizer` 在遇到 `svg/math` 或 `img[src^="data:"]` 时返回 `null` 交还纯文本粘贴路径，并删除误导性的无效 `style-src` forbidden attr。验证：红灯先行 `pnpm exec vitest run tests/security/paste-security-acceptance.test.ts --testNamePattern "data URL images"`（1 failed，data URL 图片仍作为富文本路径并继承 `bold`）；修复后同命令（1 passed / 2 skipped）、`pnpm exec vitest run tests/security/paste-security-acceptance.test.ts`（3 passed）、`pnpm exec vitest run tests/security/paste-security-acceptance.test.ts packages/ui/test/paste-sanitizer.test.ts packages/ui/test/create-ui-paste-readonly.test.ts packages/docx/test/public-api-import.test.ts --testNamePattern "paste|security|image|Word-like|empty html|inline drawing"`（4 files, 8 passed / 6 skipped）、`pnpm exec playwright test examples/vanilla/tests/gate4-paste-mobile.e2e.ts --project=chromium`（2 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。

### 3B. Gate 4（块级结构）

- [x] **[G4-R3] DOMPurify link/table paste 闭环** —— 完成 2026-07-05：DOMPurify allowlist 补 `a[href]` 与 `table/tbody/thead/tfoot/tr/td/th`；链接复用 core `isAllowedLinkUrl`，安全链接进入 `EditorRichTextRun.properties.link` 并由 core `pasteRichTextFragment` 追加 `setRunLink` 落到 projection，`javascript:` 等危险链接只保留文本；简单表格按行转换为制表符分隔段落，并通过 `PASTE_TABLE_FLATTENED` 稳定 warning 暴露降级口径。验证：红灯先行 `pnpm exec vitest run packages/ui/test/paste-sanitizer.test.ts --testNamePattern "safe links"`（1 failed，链接/表格结构丢失）、`pnpm exec vitest run packages/core/test/editor/input-runtime.test.ts --testNamePattern "rich text links"`（1 failed，link 未落 projection）；修复后 `pnpm exec vitest run packages/core/test/editor/input-runtime.test.ts packages/ui/test/paste-sanitizer.test.ts packages/ui/test/create-ui-paste-readonly.test.ts tests/security/paste-security-acceptance.test.ts --testNamePattern "paste|rich text|safe links|security|empty html"`（4 files, 13 passed / 27 skipped）、`pnpm exec playwright test examples/vanilla/tests/gate4-paste-mobile.e2e.ts --project=chromium`（3 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。

- [x] **[G4-高2] 查找替换快捷键** —— 完成 2026-07-05：`createJWordUi` 在官方装配范围内注册 Ctrl/Cmd+F 与 Ctrl/Cmd+H，分别打开查找替换面板并聚焦查找词/替换词输入；`JWordFindReplaceOptions.keyboardShortcuts: false` 可由宿主禁用快捷键。验证：红灯先行 `pnpm exec vitest run packages/ui/test/create-ui-find-replace.test.ts --testNamePattern "快捷键|禁用查找替换快捷键"`（1 failed，Ctrl+F 未 preventDefault/未打开）；修复后同命令（2 passed / 6 skipped）、`pnpm exec vitest run packages/ui/test/create-ui-find-replace.test.ts packages/ui/test/find-replace-state.test.ts`（2 files, 9 passed）、`pnpm exec playwright test examples/vanilla/tests/gate4-structure-find.e2e.ts --project=chromium`（2 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G4-中] 只读模式允许选择复制** —— 完成 2026-07-05：`readonly/interaction-guard` 不再拦截 `mousedown`，保留 pointer selection；keydown 只阻断编辑键，放行复制快捷键、全选/查找导航与方向/分页移动键，仍阻断 Backspace 等编辑输入；Chromium 只读示例用真实鼠标拖选并通过 copy 事件读取选中文本。验证：红灯先行 `pnpm exec vitest run packages/ui/test/readonly-interaction-guard.test.ts --testNamePattern "允许选择和复制"`（1 failed，mousedown 被 capture 阻断）；修复后同命令（1 passed / 2 skipped）、`pnpm exec vitest run packages/ui/test/readonly-interaction-guard.test.ts packages/ui/test/create-ui-paste-readonly.test.ts packages/ui/test/create-ui-find-replace.test.ts`（3 files, 13 passed）、`pnpm exec playwright test examples/vanilla/tests/gate4-readonly.e2e.ts --project=chromium`（2 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G4-中] 查找替换大小写不敏感 + 跨 run 搜索** —— 完成 2026-07-05：core `findTextMatches` 改为按段落聚合 grapheme 搜索并记录 run 边界映射，匹配可跨格式拆分 run；新增 `FindTextOptions.caseSensitive`，`replaceAllMatches` 透传同一选项，UI `JWordFindReplaceOptions.caseSensitive` 可由宿主启用大小写不敏感搜索。默认仍保持大小写敏感以兼容既有 e2e，宿主传 `caseSensitive: false` 即开启不敏感模式。验证：红灯先行 `pnpm exec vitest run packages/core/test/find-replace/find-replace.test.ts --testNamePattern "大小写不敏感"`（1 failed，跨 run/不敏感均无匹配）；修复后同命令（1 passed / 2 skipped）、`pnpm exec vitest run packages/core/test/find-replace/find-replace.test.ts packages/ui/test/create-ui-find-replace.test.ts packages/ui/test/find-replace-state.test.ts`（3 files, 14 passed）、`pnpm exec playwright test examples/vanilla/tests/gate4-structure-find.e2e.ts --project=chromium`（2 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G4-中] 修订接受/拒绝流程** —— 完成 2026-07-05：按补充文档 §3.8 完成基础版单条流程，语义记录为 accept(insert)=清除标记保留内容、accept(delete)=执行删除、accept(format)=保留格式清除标记，reject 为对应反向；新增 `buildAcceptRevisionCommand`/`buildRejectRevisionCommand` 与 `acceptRevision`/`rejectRevision` operation，单事务清理 revision metadata、run 标记和索引，format 修订保存并使用 `formatSnapshots` 支持拒绝时恢复原格式；UI 修订面板新增接受/拒绝按钮。验证：红灯先行 `pnpm exec vitest run packages/core/test/operations/revision-command-builders.test.ts --testNamePattern "accepts and rejects"`（1 failed，builder 不存在）；修复后同命令（1 passed / 3 skipped）、`pnpm exec vitest run packages/core/test/operations/revision-command-builders.test.ts`（4 passed）、`pnpm exec vitest run packages/core/test/operations/revision-command-builders.test.ts packages/ui/test/create-ui-revisions.test.ts`（2 files, 6 passed）、`pnpm exec playwright test examples/vanilla/tests/gate4-revisions.e2e.ts --project=chromium`（2 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G4-中] 批注区域 Canvas 高亮** —— 完成 2026-07-05：renderer 新增 `commentRects` 批注范围底色，默认浅黄并在 run 背景之后、选区高亮之前绘制；`syncPageCanvases`、`renderPageBatch` 与挂载 layout runtime 透传未解决批注的 layout selection rects，pointer selection 基底 canvas 同步包含批注高亮。验证：红灯先行 `pnpm exec vitest run packages/core/test/canvas/renderer.test.ts --testNamePattern "批注"`（2 failed，复现 renderer 不绘制/不透传）；修复后同命令（2 passed / 14 skipped）、`pnpm exec vitest run packages/core/test/editor/comment-rendering-runtime.test.ts --testNamePattern "批注"`（1 passed）、`pnpm exec vitest run packages/core/test/canvas/renderer.test.ts packages/core/test/editor/comment-rendering-runtime.test.ts packages/core/test/editor/runtime.test.ts`（3 files, 36 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）、`pnpm test:visual`（8 passed，视觉基线无刷新）。
- [x] **[G4-中] 页眉页脚富文本编辑** —— 完成 2026-07-05：按补充文档任务映射表与 D3 执行，本轮不实施代码改造，保留当前页眉页脚纯文本能力，富文本编辑移入 post-1.0；已把需人工异步复核事项登记到 `2026-07-04-remediation-manual-verification-log.md`。验证：复核 `2026-07-03-remediation-execution-supplement.md` D3 与 Gate4 原报告风险矩阵/建议条目，未改代码、无需测试。

### 3C. Gate 4.5 / 5（native、DOCX、PDF）

- [x] **[gate45 P2] DOCX 批注链路修复** —— 完成 2026-07-05：`buildCommentsIndex` 改为跳过缺 `w:id` 的批注并通过 `DOCX_COMMENT_ID_MISSING` 输出稳定 warning，批注文本统一递归读取 `w:t` 后代文本；`commentRangeEnd` 在段落尚无 run 时进入 pending marker 并附着到后续 run，避免静默丢弃。验证：红灯先行 `pnpm exec vitest run packages/docx/test/public-api-import.test.ts --testNamePattern "comment text and markers"`（修前 1 failed，复现空 id 覆盖、含子节点文本被清空、段首 end marker 丢失；修后 1 passed / 7 skipped）、`pnpm exec vitest run packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts tests/architecture/gate5-diagnostics-schema.test.ts`（3 files, 17 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 65 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[D-R2] DOCX 解压资源防护（R2 复审补充，安全）** —— 完成 2026-07-05：`readDocxZip` 在 `JSZip.loadAsync` 后立即校验文件条目数、单 part 声明解压大小与累计声明解压大小，超限抛稳定 `DOCX_PACKAGE_RESOURCE_LIMIT_EXCEEDED`；`readPartText`/`readPartBytes` 在实际读取前补单 part / XML 文本读取上限，避免后续索引/opaque 读取绕过防护。验证：红灯先行 `pnpm exec vitest run packages/docx/test/public-api-package.test.ts --testNamePattern "resource limits"`（修前 1 failed，超 2000 条目仍被 inspect 接受；修后 1 passed / 4 skipped）、`pnpm exec vitest run packages/docx/test/public-api-package.test.ts packages/docx/test/public-api-import.test.ts tests/architecture/gate5-diagnostics-schema.test.ts`（3 files, 18 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 66 passed）、`pnpm --filter @4xian/jword-docx typecheck`（通过）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[gate45 P2] DOCX worker progress 接线 + cancel 竞态** —— 完成 2026-07-05：DOCX worker 对 export/import/inspect 投递 `queued` 与对应 `writing`/`reading`/`parsing`/`mapping`/`done` 进度事件；DOCX 与 native worker 增加预取消 requestId 集合，修复 cancel 先于任务登记到达后仍执行并回发 stale success 的竞态。验证：红灯先行 `pnpm exec vitest run packages/docx/test/worker.test.ts --testNamePattern "progress|cancel that arrives before"`（修前 3 failed，复现无 progress 与预取消失效；修后 3 passed / 6 skipped）、`pnpm exec vitest run packages/native/test/worker.test.ts --testNamePattern "cancel that arrives before"`（修前 1 failed，修后 1 passed / 3 skipped）、`pnpm exec vitest run packages/docx/test/worker.test.ts packages/native/test/worker.test.ts packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts tests/architecture/gate5-diagnostics-schema.test.ts`（5 files, 31 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 67 passed）、`pnpm --filter @4xian/jword-native test`（2 files, 15 passed）、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm --filter @4xian/jword-native typecheck`、`pnpm typecheck`、`pnpm lint`（均通过）。
- [x] **[gate45 P2] XML 解析器补全** —— 完成 2026-07-05：`parseXml` 支持十进制/十六进制数值字符引用解码、CDATA 文本节点读取，并在解析元素时继承祖先 namespace 声明，让后代元素与带 prefix 属性获得正确 `namespaceUri`。验证：红灯先行 `pnpm exec vitest run packages/docx/test/xml.test.ts --testNamePattern "numeric|namespace"`（修前 2 failed，复现 CDATA 解析失败与 namespaceUri 未继承；修后 4 passed / 2 skipped）、`pnpm exec vitest run packages/docx/test/xml.test.ts packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts`（3 files, 19 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 69 passed）、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm typecheck`、`pnpm lint`（均通过）。
- [x] **[gate45 P2] 导出 schema 合规 + validator 证据** —— 完成 2026-07-05：DOCX 导出下划线改写 `<w:u w:val="single"/>`，底纹改写 `<w:shd w:val="clear" w:color="auto" w:fill="..."/>`，并调整 `rPr` / `pPr` 子元素顺序以通过 OpenXML validator；`tools/compat/run-gate5-docx-compatibility.mjs` 默认发现 `node_modules/.bin/ooxml-validator` / `ooxml-validator`，支持 @xarsh/ooxml-validator `{ ok, errors }` JSON 输出并转换为结构化诊断；`fixtures/docx/compatibility-results.json` 已刷新为 14 个 fixture Open XML validator 全部 pass，OpenXML 补证请求清零。验证：红灯先行 `pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "T1 text|multi section"`（修前 schema 断言失败，修后 2 passed / 8 skipped）、`pnpm exec vitest run tests/architecture/gate5-compatibility-runner-external-evidence.test.ts --testNamePattern "ooxml-validator"`（修前 ooxml errors 被误判 pass，修后 1 passed / 6 skipped）；focused 回归 `pnpm exec vitest run packages/docx/test/public-api.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/public-api-import.test.ts tests/architecture/gate5-compatibility-runner-external-evidence.test.ts tests/architecture/gate5-compatibility-runner.test.ts`（5 files, 41 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 69 passed）、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm typecheck`、`pnpm lint` 均通过；`pnpm build && node tools/compat/run-gate5-docx-compatibility.mjs` 通过且 validator `pass: 14`。
- [x] **[gate45 P2] 其余导入健壮性** —— 完成 2026-07-05：`pgMar` 页边距改用带符号数字读取，保留 OOXML 允许的负 margin；`normalizePartPath` 增加 traversal 诊断路径，document relationship target 多余 `..` 越过 package 根时输出 `DOCX_RELATIONSHIP_TARGET_TRAVERSAL_UNSUPPORTED` warning；DOCX 导出扫描正文 image inline，对不支持的图片 MIME 输出 `DOCX_IMAGE_EXPORT_MIME_UNSUPPORTED` warning 且继续省略图片。验证：红灯先行 3 条 focused 用例分别复现负 margin 丢失、traversal 仅 missing warning、unsupported MIME 静默丢弃；修复后 `pnpm exec vitest run packages/docx/test/public-api-import.test.ts --testNamePattern "signed section page margins|pgMar|negative"`（1 passed / 8 skipped）、`pnpm exec vitest run packages/docx/test/public-api-package.test.ts --testNamePattern "traverse|traversal"`（1 passed / 5 skipped）、`pnpm exec vitest run packages/docx/test/public-api.test.ts --testNamePattern "unsupported MIME|unsupported image|image MIME"`（1 passed / 10 skipped）、`pnpm exec vitest run packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts packages/docx/test/public-api.test.ts tests/architecture/gate5-diagnostics-schema.test.ts`（4 files, 31 passed）、`pnpm --filter @4xian/jword-docx test`（13 files, 72 passed）、`pnpm --filter @4xian/jword-docx typecheck`、`pnpm typecheck`、`pnpm lint` 均通过。
- [x] **[P2#3/4] PDF 字体子集化 + fallback 链**：`embedFont(bytes, { subset: true })` 默认开启（暴露选项）；覆盖检查支持多字体组合（按字符逐字体匹配，任一覆盖即通过，渲染时按 run 切换字体）。工作量：L。拆解：见补充文档 §3.7（全量字体不入库，走下载脚本 + CI 缓存）。完成 2026-07-05：`PdfFontConfig.subset` 暴露并默认 true，fontkit 2 subset 适配 pdf-lib 1 所需 `encodeStream`；新增 PDF 字体 registry，按 grapheme 逐字符在多字体 fallback 链中选择首个覆盖字体并按 run 绘制，缺字聚合前 20 个 grapheme 后抛 `PDF_FONT_MISSING` 且携带 `missingTextSample`；恢复 PDF 入口拆分后丢失的图片、表格、页眉页脚渲染函数，诊断 schema 扫描纳入 `font-registry.ts`。验证：红灯先行 `pnpm exec vitest run packages/pdf/test/font-fallback.test.ts`（修前 2 failed，复现渲染入口缺失；修后 3 passed），`pnpm exec vitest run packages/pdf/test/public-api.test.ts packages/pdf/test/font-fallback.test.ts tests/architecture/gate5-pdf-file-budget.test.ts tests/architecture/gate5-diagnostics-schema.test.ts`（4 files, 32 passed），`pnpm --filter @4xian/jword-pdf test`（5 files, 40 passed），`pnpm --filter @4xian/jword-pdf typecheck`、`pnpm typecheck`、`pnpm lint` 均通过。
- [x] **[X-1] 示例与 e2e 打通 Worker 路径**：`examples/docx` 增加真实 `new Worker` 调用路径（保留主线程直调作对照），e2e 断言 worker 消息协议 progress/cancel 端到端可用，闭环"互通在 Worker 中执行"不变式。工作量：M。完成 2026-07-05：新增 `examples/docx/src/docx-worker-host.ts` 按需创建 `@4xian/jword-docx/worker` module worker，DOCX import/export 默认走真实 worker，`?docxRuntime=main-thread` 保留主线程对照；demo 暴露 worker 事件摘要与 cancel 探针，e2e 断言 export progress `queued/writing/done`、`export-result` 与 cancel 的 `DOCX_WORKER_CANCELLED` 端到端消息；Vite alias 补 `@4xian/jword-docx/worker` 源码入口且 worker host 避免首屏静态加载 DOCX 根 runtime。验证：红灯先行 `pnpm exec playwright test examples/docx/tests/gate5-docx-demo.e2e.ts --project=chromium`（修前 1 failed，复现 `readWorkerEvents` 缺失；实现中曾复现首屏静态 DOCX runtime 加载，修正后 3 passed），`pnpm --filter @4xian/jword-example-docx typecheck`、`pnpm exec vitest run examples/docx/tests/task-session.test.ts examples/docx/tests/vite-config.test.ts tests/architecture/gate5-commercial-readiness.test.ts`（3 files, 19 passed）、`pnpm typecheck`、`pnpm lint` 均通过。
- [x] **[计划审查 2.9] Microsoft Word 桌面版 T1/T2 导出矩阵补验（R2 复审补充）**：当前兼容口径为 WPS-only，与「商业格式互通」对外承诺错位；与上方 OpenXML validator 证据项配套，补 Word 真实打开/编辑/保存/重开的 T1/T2 矩阵记录，validator 部分自动化纳入 CI；未验证目标在能力文档中明示。工作量：M（人工矩阵）+ S（validator 自动化）。依赖：validator 接入先行。完成 2026-07-05：Open XML validator 已由前序 schema 合规项接入 runner 并在当前 `fixtures/docx/compatibility-results.json` 中 14/14 pass；本机未安装 `/Applications/Microsoft Word.app`，按 2026-07-04 流程调整不暂停，已在人工验证日志登记 Word 桌面版 T1/T2 打开/编辑/保存/重开补证要求，并在 `docs/sdk/public-api.md` 明示当前仅 WPS 有人工办公套件证据、Word/LibreOffice 为 `pending/not-run`，不得对外声明 Word 已验证；新增架构测试锁定 Word pending 口径，防止商业文档误写。验证：统计脚本确认 Word pending 14/14、OpenXML pass 14/14；`pnpm exec vitest run tests/architecture/gate5-compatibility-runner.test.ts tests/architecture/gate5-compatibility-runner-external-evidence.test.ts tests/architecture/gate5-commercial-readiness.test.ts`（3 files, 28 passed）、`pnpm typecheck`、`pnpm lint` 均通过。人工验证记录：`docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md#2026-07-05-phase-3c-人工验证点计划审查-29-word-桌面版-t1t2-补验`。

### 3D. Gate 6（协作）

- [x] **[G6-M1] memoryCollabRooms 全局清理入口**：导出 `resetMemoryCollabRooms()` 供测试与宿主释放。工作量：S。完成 2026-07-05：`packages/collab/src/index.ts` 导出 `resetMemoryCollabRooms()`，清空内存协作 room 全局 Map，供测试隔离与宿主释放内存 demo；contract 测试覆盖 reset 后旧 adapter 不再收到同 room 新连接 update、fresh awareness 为空。验证：红灯先行 `pnpm exec vitest run packages/collab/test/contract.test.ts --testNamePattern "resets global memory"`（修前 `resetMemoryCollabRooms is not a function`；修后 1 passed / 9 skipped），`pnpm exec vitest run packages/collab/test/contract.test.ts`（1 file, 10 passed）、`pnpm --filter @4xian/jword-collab test`（5 files, 24 passed）、`pnpm --filter @4xian/jword-collab typecheck`、`pnpm typecheck`、`pnpm lint` 均通过。
- [x] **[G6-M2] awareness 校验函数去重**：约 200 行重复提取到包内共享模块。工作量：S。完成 2026-07-05：新增 `packages/collab/src/awareness-validation.ts` 作为包内共享 schema guard，`index.ts` 与 `hocuspocus-adapter.ts` 统一复用 `isAwarenessState`、presence、range 与 `isRecord` 校验，删除两处重复 awareness validator 实现并新增 Gate 6 静态门禁防止漂移。验证：红灯先行 `pnpm exec vitest run tests/architecture/gate6-awareness-validation.test.ts`（修前 1 failed，复现共享模块缺失与重复实现；修后 1 passed），`pnpm exec vitest run packages/collab/test/contract.test.ts packages/collab/test/hocuspocus-adapter.test.ts tests/architecture/gate6-awareness-validation.test.ts`（3 files, 13 passed）、`pnpm --filter @4xian/jword-collab test`（5 files, 24 passed）、`pnpm --filter @4xian/jword-collab typecheck`（通过）、`pnpm exec vitest run tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（3 files, 16 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G6-M3] 版本比较支持预发布标识**：semver 比较处理 `-beta.1` 等后缀。工作量：S。（R2 升级：`packages/collab/src/client-sdk.ts:799、883-889` 的 `readVersionParts` 把 `1.0.0-beta` 解析为与 `1.0.0` 判等，预发布/过旧 client 可绕过最低版本与 `COLLAB_SERVER_TOO_OLD` 门禁，具安全含义；从「注释级」升为「改实现」，建议随 Phase 1E 协作批次同批完成。）完成 2026-07-05：新增 `packages/collab/src/version-compare.ts` 轻量 semver 比较器，忽略 build metadata、按数字主版本段比较，并实现预发布标识规则：同主版本正式版高于预发布版，预发布数字标识按数值排序且低于非数字标识；`client-sdk.ts` 的服务端/客户端最低版本握手改用该比较器。验证：红灯先行 `pnpm exec vitest run packages/collab/test/public-client.test.ts --testNamePattern "prerelease package"`（修前 2 failed，预发布 server/client 仍连接为 `synced`；修后 2 passed / 10 skipped）、`pnpm exec vitest run packages/collab/test/public-client.test.ts`（1 file, 12 passed）、`pnpm --filter @4xian/jword-collab test`（5 files, 26 passed）、`pnpm --filter @4xian/jword-collab typecheck`（通过）、`pnpm exec vitest run tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（3 files, 16 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G6-M4] auth/license hook 默认行为对齐**：统一"默认拒绝"并在文档中显式声明（auth 当前默认放行属隐患）。工作量：S。完成 2026-07-05：`checkJWordCollabRequestAuth` 在缺少 `authHook` 时改为默认拒绝受保护 HTTP 路由，返回稳定 `JWORD_COLLAB_AUTH_HOOK_REQUIRED`；保留 `/health`、`/version` 等公开只读路由不经 auth；需要测试/demo 放行的 `collab-server` 调用点显式传入 allow hook，并在 `packages/collab-server/README.md` 与 `docs/sdk/public-api.md` 记录 auth/license hook default-deny 语义。验证：红灯先行 `pnpm exec vitest run packages/collab-server/test/server.test.ts --testNamePattern "without auth hook"`（修前 1 failed，缺 authHook 时仍进入 body/license 后得到 500；修后 1 passed / 18 skipped）、`pnpm --filter @4xian/jword-collab-server test`（1 file, 19 passed）、`pnpm --filter @4xian/jword-collab-server typecheck`（通过）、`pnpm exec vitest run examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/vite-config.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（4 files, 29 passed）、`pnpm typecheck`（通过）、`pnpm lint`（通过）。
- [x] **[G6-M5] history document lock 队列深度限制**：超限快速失败并返回稳定错误码。工作量：S。完成 2026-07-05：`StorageBackedJWordCollabHistoryService` 为同一 document 的 history lock 增加可配置 `maxDocumentLockQueueDepth` 背压阈值，self-host server 公开 `maxHistoryDocumentLockQueueDepth` 选项；超限请求快速返回 HTTP 429 与稳定 `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED` 诊断码，不再无限挂在 promise 链上；同时抽出 collab-server 测试 helper，保持 Gate 6 文件行数预算。验证：红灯先行 `pnpm exec vitest run packages/collab-server/test/history-queue.test.ts`（修前 1 failed，复现第二个同文档请求未快速失败；修后 1 passed）、`pnpm exec vitest run packages/collab-server/test/history-queue.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（5 files, 36 passed）、`pnpm --filter @4xian/jword-collab-server typecheck`（通过）。
- [x] **[G6-M6] history list 授权 metadata 对齐（R3）**：GET list 统一读取 header/query entitlement 并传入 licenseHook，补无 entitlement 被拒、有 entitlement 可 list 测试。工作量：S。完成 2026-07-05：`handleListHistoryVersions()` 改为与 record/preview 路径一致，从 query/header 读取 entitlement 并传入 `licenseHook`；新增 history list 授权 focused 测试，严格 hook 下无 entitlement 返回 `JWORD_COLLAB_LICENSE_METADATA_REQUIRED`，header entitlement 可正常 list。验证：红灯先行 `pnpm exec vitest run packages/collab-server/test/history-list-auth.test.ts`（修前 1 failed，GET list 未转发 entitlement；修后 1 passed）、`pnpm exec vitest run packages/collab-server/test/history-list-auth.test.ts packages/collab-server/test/history-queue.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（6 files, 37 passed）、`pnpm --filter @4xian/jword-collab-server test`（3 files, 21 passed）、`pnpm --filter @4xian/jword-collab-server typecheck`（通过）。
- [x] **[G6-M7] collab-server `rateLimit` 公开选项落地或移除（R3）**：实现最小滑窗限流，或从 public API 移除避免安全承诺空洞。工作量：S。完成 2026-07-05：保留公开 `rateLimit` 选项并在 `createJWordCollabRequestHandler()` 内落地最小滑窗限流，`/health` 与 `/version` 继续公开不受限，受保护业务路由超限时快速返回 HTTP 429 与稳定 `JWORD_COLLAB_SERVER_RATE_LIMITED`，响应包含 `retryAfterMs`。验证：红灯先行 `pnpm exec vitest run packages/collab-server/test/rate-limit.test.ts`（修前 1 failed，第二个请求仍 200；修后 1 passed）、`pnpm exec vitest run packages/collab-server/test/rate-limit.test.ts packages/collab-server/test/history-list-auth.test.ts packages/collab-server/test/history-queue.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（7 files, 38 passed）、`pnpm --filter @4xian/jword-collab-server typecheck`（通过）。
- [x] **[G6-M8] record/preview/relay 校验 body.tenantId 与 metadata 一致（R3）**：不一致返回稳定 metadata mismatch 诊断。工作量：S。完成 2026-07-05：history record、history preview 与 auto-insert relay 在已通过 URL/header tenant/license metadata 授权后继续校验请求体 `tenantId`，若 body tenant 与授权 metadata tenant 不一致，分别返回 `JWORD_COLLAB_HISTORY_METADATA_MISMATCH` / `JWORD_COLLAB_AUTO_INSERT_RELAY_METADATA_MISMATCH`，避免审计与后续扩展中的跨 tenant 混淆。验证：红灯先行 `pnpm exec vitest run packages/collab-server/test/metadata-mismatch.test.ts`（修前 1 failed，tenant 不一致仍 200；修后 1 passed）、`pnpm exec vitest run packages/collab-server/test/metadata-mismatch.test.ts packages/collab-server/test/rate-limit.test.ts packages/collab-server/test/history-list-auth.test.ts packages/collab-server/test/history-queue.test.ts packages/collab-server/test/server.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（8 files, 39 passed）、`pnpm --filter @4xian/jword-collab-server test`、`pnpm --filter @4xian/jword-collab-server typecheck`（通过）。
- [x] **[G6-M9] IndexedDB load 中 restoredDoc 显式 destroy**。工作量：S。完成 2026-07-05：`BrowserIndexedDbOfflineAdapter.loadPersistedUpdate()` 的临时 `restoredDoc` 在 `finally` 中随 `restoredProvider.destroy()` 一起显式 `destroy()`，避免每次 IndexedDB load 后遗留 Y.Doc 内部监听与结构引用；新增 focused 测试用 `Y.Doc.prototype.destroy` spy 复现并锁定临时文档释放。验证：红灯先行 `pnpm exec vitest run packages/persistence/test/indexeddb-adapter.test.ts --testNamePattern "temporary restored"`（修前 1 failed，`destroy` 0 次；修后 1 passed / 3 skipped）、`pnpm exec vitest run packages/persistence/test/indexeddb-adapter.test.ts tests/architecture/gate6-file-budget.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts`（4 files, 20 passed）、`pnpm --filter @4xian/jword-persistence test`（3 files, 17 passed）、`pnpm --filter @4xian/jword-persistence typecheck`、`pnpm typecheck`、`pnpm lint`（通过）。

**Phase 3 里程碑**：兼容性与体验类问题清零，OpenXML validator 证据入库，WPS/Word 双端手工验证一轮。

---

## Phase 4 - 性能与内存优化

- [ ] **[计划审查 1.2] 输入热路径 P95 < 50ms 达标专项**（Gate 3 遗留验收项）：先用 benchmark 定位瓶颈（投影重建 GX-01、布局字体检查 GX-02、`readUpdateByteLength` GX-03 是已知候选），再按测量结果修复；目标以 `benchmarks/` 固化回归基线。工作量：XL。依赖：Phase 1 完成（避免测量被泄漏干扰）。拆解：见补充文档 §3.9（先测量后优化，收益 <5% 的项记录后跳过）。
- [ ] **[GX-01] 投影增量更新**：从"每事务全树重建"改为按 dirty 块增量重建投影节点。工作量：L。
- [ ] **[G2-05] 段落 advance 计算去 O(n²)**：逐字符累加改为前缀和/单遍累计。工作量：S-M。
- [x] **[G2-06] 字体度量缓存 LRU 上限** —— 完成 2026-07-05：与 G2-04 合并实施，字体度量缓存默认 4096 项，命中刷新 LRU 顺序、超过上限淘汰最旧 key；同时完成 G2-07 缓存 key 收敛，仅保留 text/fontFamily/fontSizePx/bold/italic。验证：`pnpm exec vitest run packages/core/test/layout/font-manager.test.ts`（13 passed）、`pnpm test`（154 files, 769 passed）。
- [ ] **[GX-04] 延迟渲染改用 requestAnimationFrame**（替换 `setTimeout(0)`）。工作量：S。
- [ ] **[gate45 P2/P3] DOCX 媒体内存优化**：`bytesToBase64` 分块拼接去 O(n²)；PDF 图片按 resourceId 去重缓存、按页流式读取替代全量预加载；`readOwnedArrayBuffer` 避免整体复制。工作量：M。
- [ ] **[G2-19] 可见页查找二分化**（线性扫描 → 按页 y 区间二分）。工作量：S。（R2 同源补充 G2-22：`viewport-virtualizer.ts:84-88` 的 `expandWithBuffer` 对每个可见页做线性 `indexOf`，一并改为数组下标或预建 Map。）
- [ ] **[计划审查 2.8] 建立 10 万字 / 200 页 benchmark fixture 与 Beta 性能报告（R2 复审补充）**：Beta 完成区长期欠账；fixture 入 `fixtures/`，性能报告产出纳入 `pnpm bench` 固化。工作量：M。依赖：Phase 1 泄漏修复先行（避免测量失真）。
- [ ] **[计划审查 3.14] 内存回归门禁（R2 复审补充）**：新增「创建-编辑-销毁 ×N 次」与「50 页滚动长时」两条内存采样护栏（Playwright + CDP heap 采样或 `performance.memory` 阈值），拦截泄漏类回归。工作量：M。依赖：G2-13、G1-01 等已知泄漏修复先行。

**Phase 4 里程碑**：`pnpm bench` 输入热路径 P95 < 50ms 达标并纳入 CI 回归；大文档（100 页级）滚动与导出内存曲线可控。

---

## Phase 5 - P3 改进与技术债清理

- [ ] **超大文件拆分执行**（按 Phase 2 登记的清单）：`create-ui.ts`、`command-builders.ts` 等按功能域拆分，公开导出面不变，拆完收紧行数预算豁免。工作量：L-XL（分批）。目标结构：见补充文档 §3.10（一次只拆一个文件，禁止夹带逻辑变更）。
- [ ] **死代码清理**：`resolveImageInlineSize`（G2-10）、`renderRectBorder`（G2-16）、`createPendingAppResults`（gate45 P3）、命令构建器死代码（G3-18）。工作量：S。
- [ ] **重复实现收敛**：docx `readStringProperty` 等 helper（export-utils/roundtrip 双份）、PDF `twipsToPdfPoints` 与颜色解析双份、超链接 core/UI 双 allowlist 统一为 core 单一来源。工作量：M。
- [ ] **架构纯度项**：双重 opaque ID branding 统一（G1-04）、模块级序号计数器改实例级（G1-05/G3-19）、`AnchorRefState` 可变契约文档化或改不可变（G1-06/GX-06）、`mergeBlock` 约束文档化（G1-17）。工作量：M。
- [ ] **小型正确性/风格项**：G1-14（readonly 对象 push 后修改）、G2-07/08、G2-11/12（列表计数器语义）、G3-14（`Intl.Segmenter` 统一）、G3-15（`<br>` 转换）、G3-22、G3-28/29、G3-32（clip 属性）、G6-LOW 三项、gate45 P3 余项（roundtrip 补 hyperlink/tabs/bookmark 快照、PDF 页面尺寸上限、颜色格式扩展、TTC 多子字体）、G3-13/G2-21（caret 行定位与 Home/End 的浮点精确相等改容差匹配，两处共用辅助函数，R2）、G6 sendUpdate fallback origin `'local'` 改 `'local-user'` 并断言属于冻结 origin 矩阵（`packages/collab/src/hocuspocus-adapter.ts:197`，R2）、PDF 页眉页脚 baseline 硬编码 0.6 改用 layout 真实 baseline（`packages/pdf/src/index.ts:538`，R2）、粘贴 sanitizer 无效允许项清理（`sanitizer.ts:56` 允许 `style` 属性但并无 CSS 过滤逻辑，XSS 防护实际由「输出侧只承载结构化文本、HTML/CSS 永不回插」机制保证，应删无效配置防误导，R2）。工作量：M（合并顺手处理）。
  - （R2 提示）G3-18 死代码清理注意范围：`collectCommentThreadIds`/`findCommentThread` 为同名多副本，死代码仅限 `command-builders.ts:1276-1278、1500-1502`；`comment-command-builders.ts` 中同名实现有 7 处调用者，不得误删。
- [ ] **[计划审查 2.6] 计划文档瘦身**：把 2026-05-11 主计划中的执行日志抽到独立 changelog 文档，主计划只留任务与验收状态。工作量：S。
- [ ] **[计划审查 2.7] 主计划 checkbox 全量状态审计（R2 复审补充）**：修正互斥/漏勾状态（如 Gate 3 验收三项 vs Step 3.14-3.16、0.4 包结构、Step 3.4 勾选与 Shift+方向键缺失不符），在文档头部定义 checkbox 语义规范（待办=实现完成、验收=证据存在、禁止事项=已核实未违反），并纳入 Gate 收口 checklist；与 2.6 瘦身同批执行。工作量：S。

---

## Phase 6 - Gate 7 前置准备（在 Gate 7 启动前完成）

- [ ] **[gate7 2.1] Plugin 扩展点前置改造（最大风险项，提前动工）**：在 core 中落地扩展点骨架——command 注册拦截、decoration 层（layout/render 挂钩）、生命周期钩子、快捷键注册、工具栏扩展注册；先内部使用（把现有 UI 菜单/工具栏迁移为首个消费者验证 API 形状），Gate 7 再冻结对外。工作量：XL（估 7-10 人周，建议与 Phase 3-5 并行排期）。里程碑拆解：见补充文档 §3.11（M1 设计冻结与 M5 内部消费者后设人工检查点）。
- [x] **[gate7 R3] 发布/no-alias 消费闭环**：明确 registry publish vs tarball distribution；若 registry 发布，移除可发布包 `private: true` 并配置 publishConfig；新增 external empty project smoke，从本地 pack 安装公开包，不使用 examples 源码 alias，跑 typecheck/build/浏览器 smoke。Owner/Lane：release/docs。产物路径：各 `packages/*/package.json`、`tools/release/*no-alias*` 或 `tools/release/check-gate7-third-party-smoke.mjs`、外部临时 fixture 文档。验收命令：`pnpm build`、`node tools/release/check-native-pack.mjs`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/release/check-gate6-commercial-pack.mjs`、新增 no-alias smoke 命令；涉及 UI 时补真实浏览器/Kimi smoke。工作量：M。决策与拆解：见补充文档 D2 / §3.13（tarball 冒烟先行，私有 registry 为目标形态）。完成 2026-07-03：按 §3.13 步骤 1、2、4 新增 `tools/release/check-gate7-third-party-smoke.mjs`，从本地 tarball 安装 core/ui/native/docx/pdf/license/persistence/collab/collab-server，执行 `tsc --noEmit`、`vite build` 和 Chromium browser smoke；按 D2 未移除 `private: true`、未执行 publish。验证：`pnpm build` 通过；`node tools/release/check-native-pack.mjs`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/release/check-gate6-commercial-pack.mjs` 均输出 `status: ok`；`node tools/release/check-gate7-third-party-smoke.mjs` 输出 `status: ok` 且 Chromium 1 passed。
- [x] **[gate7 R3] Public API / pack 边界降噪**：PDF worker helper 移出 stable root API；`@4xian/jword-core` 等基础包 pack 白名单收敛到 dist/README/LICENSE 或明确 source distribution 口径；pack 审计覆盖 core/ui/native/docx/pdf/collab/license/persistence 全包。Owner/Lane：release/api。产物路径：`docs/sdk/public-api.md`、`packages/*/package.json`、`tests/architecture/*public-api*`、pack 审计脚本。验收命令：`pnpm typecheck`、`pnpm test -- tests/architecture`、全包 `npm pack --dry-run` 审计脚本。工作量：M。完成 2026-07-03：PDF worker helper 移至 `@4xian/jword-pdf/worker`，root stable API 仅保留导出路径；pack manifest 收敛到 dist/README/fixtures 口径，并由 Gate 7 no-alias smoke 覆盖 core/ui/native/docx/pdf/license/persistence/collab/collab-server 本地 tarball。验证：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/worker.test.ts`（3 files / 31 tests passed）；`node tools/release/check-gate7-third-party-smoke.mjs` 输出 `status: ok` 且 Chromium 1 passed。
- [ ] **[gate7 R3] Observability/error boundary/telemetry 子任务**：默认关闭 telemetry，宿主 opt-in；定义事件 schema 与隐私裁剪；插件异常隔离、wrapper error boundary、diagnostics export 不含正文内容。Owner/Lane：sdk/runtime/docs。产物路径：diagnostics/telemetry contract 文档、wrapper error boundary 设计、相关 tests。验收命令：插件抛错单测、wrapper error boundary 测试、diagnostics export 内容审计（断言不含正文内容），必要时补浏览器 smoke。工作量：M。
- [ ] **[gate7 2.6] bundle size 预算校准**：G0-04 修复后重测各包体积，把过时预算（core 260KB/首屏 330KB vs 实际 494KB/581KB）更新为"当前实测 + 收紧路线图"，`pnpm size` 门禁按新预算执行。依赖：G0-04。工作量：S。（R2 订正数字：实测 core dist 为 523,433 字节 ≈ 511KB、vanilla 首屏 index chunk 为 573,859 字节 ≈ 560KB 且未计 CSS，均已破 `check-size.mjs:34-35` 的 260KB/330KB 门禁线；校准前先查 core 体积翻倍根因——真实增长还是过时产物（当前 dist mtime 为 5 月 26/28）。）
- [x] **[gate7 2.7] 发布配置修复**：`packages/ui` 的 `"./styles.css"` export 从 `src/styles/toolbar.css` 改指 dist 产物（构建复制）；core/native/ui 补 `publishConfig.access`；`npm pack --dry-run` 内容审计脚本入 `tools/release/`。工作量：S-M。（R2 补充证据：`packages/ui/package.json:17` export 指向 `src/styles/toolbar.css`，`:21` 的 `files` 含 `src/styles`，发布会把源码目录带出。）完成 2026-07-03：`@4xian/jword-ui/styles.css` 改为 `dist/styles/toolbar.css`，Rollup 构建复制 CSS 到 dist；core files 收敛为 `dist`，core/native/ui 补 `publishConfig.access: public`；Gate 7 smoke 对本地 tarball 执行 pack 内容与 no-alias 安装审计。验证：`pnpm build` 通过；`node tools/release/check-gate7-third-party-smoke.mjs` 输出 `status: ok`。
- [ ] **[gate7 2.2/2.3/2.4] 补齐 wrapper / theme / devtools 详细设计文档**：React wrapper 明确 ref 暴露、受控/非受控、StrictMode 双挂载兼容；Vue 明确 provide/inject 与 SSR 空壳；theme 明确 CSS 变量 + 暗色模式；devtools 明确面板与 diagnostics export 架构。产出设计文档供 Gate 7 直接执行。工作量：M。
- [ ] **[计划审查 2.4] a11y 系统性验收补课**：Gate 4-6 新功能（表格、批注、查找替换、协作光标）补 a11y 验收清单与自动化检查（axe-core 集成到 e2e）。工作量：M-L。
- [ ] **[计划审查 2.1] 协同输入 rebase 方案评估**：对 textarea value diff rebase 路径补充协同并发下的压力测试；若确认脆弱，设计以 Y.RelativePosition 为基准的输入定位替代方案（先出设计文档再改）。工作量：M（评估）。评估方法定稿：见补充文档 §3.12 与决策 D7（一致率 <100% 即切替代方案）。
- [ ] **[gate7 R2] 错误码单一真源生成管线（R2 复审补充，HIGH）**：以 `fixtures/collab/diagnostics-registry.json`（现 56 码）为唯一真源，把 core/docx/pdf/native 错误码并入同一 registry；Step 7.3/7.11/7.23 的错误码文档与 diagnostics export 一律从 registry 生成，防止运行时码与文档漂移；「错误码清单 + 护栏测试」在 Gate 7 Iteration 0 冻结，Step 7.11 只做 export 实现。工作量：M。依赖：无；G6-R2-1 新增码依赖本项落点。
- [ ] **[gate7 R2] Gate 7 计划修订两小项（R2 复审补充）**：① Iteration 0 冻结落点补 `@4xian/jword-persistence` 的导出分级（stable/experimental/internal）与 edition 归属；② Step 7.19 明确 size-limit 与既有 `check-size.mjs`、`check-gate6-collab-bundle.mjs` 三套体积工具的去留，收敛为单一工具与预算真源。工作量：S。
- [ ] **[计划审查 3.11] 协同权限粒度设计（R2 复审补充）**：collab-server auth hook contract 定义 per-user read/comment/write 权限，服务端在 `beforeSync` 层拒绝越权 update 并返回稳定 diagnostic；文档明确当前客户端 readonly 不具备安全语义。工作量：M（设计与实现分两步）。
- [ ] **[计划审查 3.12] Worker 能力检测与降级口径（R2 复审补充）**：为 docx/pdf/native 提供环境能力检测 API 与 `WORKER_UNAVAILABLE` 类稳定诊断；文档声明 CSP 环境要求（`worker-src`/`blob:` 指令清单）；评估同线程 fallback 或明确不支持。工作量：S-M。已决策（补充文档 D5）：不做同线程 fallback。
- [ ] **[计划审查 3.13] 对外浏览器支持矩阵冻结（R2 复审补充）**：Gate 7 冻结 browserslist 式最低版本承诺（含移动端只读预览范围），构建 target 与 E2E 矩阵与该承诺对齐。工作量：S。建议默认值：见补充文档 D6（写入对外文档前需人工确认终值）。
- [ ] **[计划审查 3.15] 补风险复核点 F（R2 复审补充）**：Gate 7 Iteration 0 完成后一次性冻结 edition matrix、导出面、事件 payload、diagnostics 命名，之后文档站/类型测试/wrapper 只消费冻结面。工作量：S。
- [ ] **[计划审查 3.16] 版本历史与 Yjs GC 技术决策落档（R2 复审补充）**：将「版本历史禁止依赖 Y.Snapshot + gc=false 路线」写为明确技术决策；补 update log 增长治理（compaction 周期、条目上限、冷数据归档）。工作量：S。治理默认参数已定：见补充文档 D8。

---

## 执行顺序与里程碑总览

```
Phase 0（P0，~1 周内）
  └─> Phase 1（P1，2-3 周）──> 里程碑 A：可 dogfooding
        ├─> Phase 2（门禁加固，1 周，可与 Phase 1 并行）
        └─> Phase 3（P2，3-4 周）──> 里程碑 B：兼容性可信（validator 证据入库）
              ├─> Phase 4（性能，2-3 周）──> 里程碑 C：性能达标入 CI
              ├─> Phase 5（技术债，穿插进行）
              └─> Phase 6（Gate 7 前置，Plugin 改造尽早启动）──> 里程碑 D：Gate 7 就绪
```

依赖要点：G3-02 依赖 G1-02；G3-01 体验依赖 G1-03；bundle 预算校准依赖 G0-04；Phase 4 测量依赖 Phase 1 泄漏修复；LIC-1 必须先于任何对外商业发布；Plugin 改造（Phase 6 首项)工期最长，建议 Phase 1 结束后立即并行启动。

## 下一步行动（第一批动手任务，建议顺序）

1. [G3-01] Shift+Arrow 选区扩展（先做 G1-03 选区方向作为地基）
2. [G1-02] deleteRange 跨 run/跨块（G3-02 的前置）
3. [G3-02] 有选区时 Enter 生效
4. [G4-BUG] 浮动工具栏格式按钮显示
5. [G1-01/G3-03/G3-04] mount 生命周期事件监听统一 AbortController（一个 PR）
6. [G2-13] Canvas 池 dispose
7. [G0-04] rollup externals 补齐（解锁 size 基线）
8. [D-1] DOCX w:val 语义（改动最小、数据正确性收益最大；R2：连带同源的 toggle 静默丢失 warning 与 underline `none` 一并修）
9. [G6-H1] base64 栈溢出（S 工作量、崩溃级收益；R2：可直接复用同仓 `storage-history-adapter.ts:744-749` 的正确实现）
10. [LIC-1] license 密码学签名（商业阻塞，尽早排期）
11. [计划审查 2.10] CI 补 `playwright install --with-deps` 并真实跑通一次（S 工作量，解锁全部门禁的真实性）
12. [G6-R2-1] 协同用户身份缺失 fail-fast（S 工作量，presence/授权/审计的身份底座）
13. [G6-H4] 修复 `restoreVersion()` 真实回退语义（R3，历史/恢复正确性）——完成 2026-07-03
14. [G6-H5] Hocuspocus WebSocket tenant/authHook 隔离（R3，服务端安全）——完成 2026-07-03
15. [gate7 R3] 发布/no-alias 外部消费 smoke（R3，1.0 发布证据前置）——完成 2026-07-03

每完成一批任务：跑 `pnpm lint && pnpm typecheck && pnpm test`，涉及交互的补对应 e2e；在本文档勾选对应 checkbox 并在任务行追加完成日期与验证记录（沿用主计划文档的记录风格）。
