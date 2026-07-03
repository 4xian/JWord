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

- [ ] **[G3-01] 实现 Shift+Arrow 键盘选区扩展**
  - 文件：`packages/core/src/editor/input-runtime.ts`
  - 问题：Shift+方向键选区扩展完全缺失，用户无法通过键盘选中文本，属基础编辑能力硬缺口。
  - 修复方案：在 keyboard handler 的方向键分支读取 `event.shiftKey`；为真时保持 selection anchor 不动、仅移动 focus（复用现有 caret 移动定位逻辑计算新 focus 位置），构造 `SelectionState { anchor, focus, direction }` 后走 selection command 更新；同时覆盖 Shift+Home/End（扩展到行首/行尾）。
  - 验证：新增单测覆盖 Shift+Left/Right/Up/Down/Home/End 六种扩展；e2e 里验证 Shift+Right 三次后选中 3 个字符并可整体删除。
  - 工作量：M。依赖：无（建议与 G1-03 选区方向修复同批做，见 Phase 1）。

- [ ] **[G3-02] 修复有选区时 Enter 键无效**
  - 文件：`packages/core/src/editor/text-editing-runtime.ts:1330` 附近
  - 问题：存在非折叠选区时按 Enter 无任何反应；预期行为是先删除选区内容再分段。
  - 修复方案：Enter 处理分支在 `selection.isCollapsed === false` 时，先构造 `deleteRange` 再 `splitBlock`，两个 operation 放入同一 command/同一 `ydoc.transact`，保证 undo 一步回滚。
  - 验证：单测：选中跨 run/跨段文本按 Enter，断言删除+分段一次事务完成、undo 一步恢复；e2e 补一条选中后回车用例。
  - 工作量：S-M。依赖：若选区跨 run，需 G1-02（deleteRange 跨 run 支持）先行或同批完成。
  - R3 追加同批处理：跨 section / 跨容器 selection delete/cut/paste replace 失败（`text-editing-runtime.ts` delete plan 复用起始 sectionId，`mergeBlock` 只支持同容器相邻段落）。应让 selected target 携带真实 section/container，跨 section merge 明确语义或返回稳定 unsupported error。（已决策 D9：1.0 返回稳定 unsupported 错误，跨节合并留 post-1.0；见补充文档）

- [ ] **[G4-BUG] 修复浮动工具栏格式按钮始终隐藏**
  - 文件：`packages/ui/src/selection-actions/dom.ts`（`syncLinkActionVisibility()`）
  - 问题：选区浮动工具栏中的粗体/斜体等格式按钮被无条件隐藏，只剩链接按钮逻辑生效。
  - 修复方案：`syncLinkActionVisibility()` 只应控制链接相关按钮的显隐，格式按钮显隐改为独立函数按选区状态（非折叠即显示）控制；排查是否 CSS 类名/初始 `display:none` 未被清除。
  - 验证：UI 单测断言选中文本后浮动工具栏包含可见的加粗/斜体按钮；vanilla 示例手动确认。
  - 工作量：S。依赖：无。

**Phase 0 里程碑**：三项完成 + `pnpm lint && pnpm typecheck && pnpm test` 全绿，即可解除"基础编辑不可用"状态。

---

## Phase 1 - P1 严重缺陷修复

### 1A. 内存泄漏与事件生命周期（core）

- [ ] **[G1-01 / G3-04] destroy 时移除 focus/blur 监听器**
  - 文件：`packages/core/src/editor/mount-facade-runtime.ts`（约 204-205 行注册、273-286 行 destroy）
  - 修复方案：注册监听时统一用一个 `AbortController`，`addEventListener(..., { signal })`，destroy 中 `controller.abort()` 一次清空；顺带盘点同文件所有 `addEventListener` 是否全部走该 signal。
  - （R2 补充根因）`handleFocus`/`handleBlur` 从未被写入 `mountedDom` 对象字面量（约 209-257 行），destroy 侧本就无引用可移除；修复须先补这两个字段，再统一走 AbortController 清理。
  - 验证：单测 mount→destroy 两轮后对 window/document 派发 focus/blur，断言旧回调不触发（可用 spy 计数）。
  - 工作量：S。依赖：无。

- [ ] **[G3-03] mouseup 改注册到 document**
  - 文件：`packages/core/src/editor/mount-facade-runtime.ts:193`
  - 问题：mouseup 挂在 canvasContainer 上，拖拽选区时指针移出编辑器再松开，选区停留在"拖拽中"状态。
  - 修复方案：mousedown 仍挂容器；mousedown 触发后把 mousemove/mouseup 临时挂到 `document`（同样走 AbortController），mouseup 后立即解除。
  - 验证：e2e：从编辑器内按下、拖到编辑器外松开，断言选区正确结束且后续点击行为正常。
  - 工作量：S。依赖：与 G1-01 同一文件，建议同一 PR。

- [ ] **[G2-13] Canvas 池补 dispose 并接入 editor destroy**
  - 文件：`packages/core/src/canvas/pool.ts`
  - 修复方案：新增 `dispose()`：遍历池内 canvas，将宽高置 0（释放位图内存）、从 DOM 移除、清空内部数组；`destroy()` 流程调用；同时加双重释放防护（G2-14：release 已释放页时抛错或忽略并告警）。
  - 验证：单测：dispose 后池为空且再次 acquire 抛出明确错误；多次 mount/destroy 循环无 DOM 残留节点。
  - 工作量：S-M。依赖：无。

- [ ] **[G3-05] 输入异常不再静默吞没**
  - 文件：`packages/core/src/editor/input-runtime.ts:408-424`
  - 修复方案：catch 块中通过 editor 事件总线发布 `error` 事件（携带稳定错误码与 command 名称），保留"不中断输入流"的行为但让宿主可观测；开发模式 `console.error`。
  - 验证：单测注入抛错的 command，断言 error 事件 payload 且后续输入仍可用。
  - 工作量：S。依赖：无。

### 1B. 编辑与选区核心正确性

- [ ] **[G1-02] deleteRange 支持跨 run / 跨块删除**
  - 文件：`packages/core/src/operations/operation-adapter.ts:519-524`
  - 修复方案：将 deleteRange adapter 从"仅同 run"扩展为三段式：首 run 尾部截断、中间 run/块整体删除、末 run 头部截断；跨块时对首尾块执行 mergeBlock 语义；全程单一 `ydoc.transact`。
  - 验证：fixture 覆盖同 run / 跨 run / 跨段 / 跨表格单元格边界（应拒绝并给稳定错误码）四类；undo 一步恢复。
  - 工作量：M-L。依赖：无；G3-02 依赖本项。
  - 拆解：见 `2026-07-03-remediation-execution-supplement.md` §3.1（含 D9 跨 section 语义决策）。

- [ ] **[G1-03] 修复跨块选区方向恒为 forward**
  - 文件：`packages/core/src/editor/selection.ts:120-140`
  - 修复方案：比较 anchor/focus 的文档序（块索引 + 块内 offset 组成的复合序），据此计算 `direction: 'forward' | 'backward'`，不再对跨块场景短路返回 forward。
  - 验证：单测：从后往前跨段拖选，断言 direction 为 backward，且 Shift+Arrow 在 backward 选区上收缩/扩展方向正确。
  - 工作量：S-M。依赖：G3-01 体验依赖本项。
  - R3 追加：shared transaction 后先 resolve 当前 selection 的 anchor/focus，再 emit selectionChange，避免 formattingState 使用旧 graphemeIndex。
  - R3 追加：公开 `EditorRangeSnapshot` / `EditorTextLocation` 标注 non-stable 或改用稳定 Anchor/Range 序列化，避免宿主把 runId+graphemeIndex 当长期锚点。

- [ ] **[G3-20] 修订标记应用于选区全部 run**
  - 文件：`packages/core/src/commands/revision-command-builders.ts:39`
  - 修复方案：命令构建时枚举选区覆盖的全部 run（含首尾部分覆盖时先 split run），对每个 run 写修订 metadata，同一事务提交。
  - 验证：fixture：跨 3 个 run 的选区标记插入型修订，断言 3 个 run 均带修订元数据。
  - 工作量：M。依赖：无。
  - （R2 补充）Gate 4/4.5/5 复审独立确认同一问题（`revision-command-builders.ts:39、63-64`）：`rangeSnapshot` 保存完整范围、定位不受影响，缺口仅在可见化（只有 runs[0] 带 revisionId 高亮），实际严重度略低于首轮判级，修复方案不变。

### 1C. 布局引擎

- [ ] **[G2-01] 实现 Justify 两端对齐**
  - 文件：`packages/core/src/layout/paragraph-flow.ts:490-493`
  - 修复方案：行内 fragment 定位阶段，对 `justify` 段落计算行剩余宽度并按可伸展空隙（空格、CJK 字符间）均匀分配额外 advance；段落最后一行与硬换行行保持左对齐（Word 语义）。
  - 验证：布局单测：固定字体度量下断言 justify 行两端 x 坐标；视觉回归补一张 justify 样张。
  - 工作量：M。依赖：无。

- [ ] **[G2-02] 表格跨页断行**
  - 文件：`packages/core/src/layout/engine.ts:564-567`
  - 修复方案：分页时表格高度超出当前页剩余空间则按行拆分：整行为最小拆分单元，当前页放不下首行时整表下移；拆分处生成延续 TableBox（可选重复表头行，作为后续增强）。禁止修改状态，仅在 layout 输出层拆分。
  - 验证：布局单测：20 行高表格跨 2 页，断言两页各有 TableBox 且行不截断；e2e 视觉样张。
  - 工作量：L。依赖：无（Gate 4 高风险项同源，一并解决）。（R2 提示：与 G2-20 同改 `ensureLineFits`/`startNewPage`，必须同批实施避免冲突。）
  - 拆解：见补充文档 §3.2。

- [ ] **[G2-20] 跨页续排段前距策略（R2 复审补充）**
  - 文件：`packages/core/src/layout/paragraph-flow.ts:202-209、238-242`
  - 问题：段落跨页续排时段前距既不忽略也不补偿，续排页首行的间距语义未定义。
  - 修复方案：`startNewPage` 后显式定义续排段前距策略（对齐 Word 语义：续排页不再重复计段前距），补跨页 fixture。
  - 验证：跨页段落布局单测断言续排页首行 y 起点。
  - 工作量：S。依赖：与 G2-01/G2-02/G2-03 共享跨页 fixture，建议同批实施。

### 1D. DOCX / PDF / Native 正确性

- [ ] **[D-1] DOCX 导入尊重 w:val on/off 语义**
  - 文件：`packages/docx/src/import-readers.ts:78-89`
  - 修复方案：bold/italic/underline/strike 四属性改用同文件已有的 `readOnOffValue`（406-409 行）读取 `w:val`，`false/0/none` 显式关闭；underline 还需读 `w:val` 样式值（single/none 等）。
  - 验证：fixture 增加 `<w:b w:val="false"/>` 样例，断言导入后 run 非加粗；roundtrip 测试同步更新。
  - 工作量：S。依赖：无。
  - （R2 同源合并）随 D-1 一并修复：toggle 被误判开启时完全不产 warning、数据静默丢失（`import-readers.ts:146-157`）；`<w:u w:val="none"/>` 及下划线线型被误读为开启（`import-readers.ts:84-86`）。fixture 同步覆盖三种场景。

- [ ] **[D-2] 多 section 导出保留分节**
  - 文件：`packages/docx/src/export.ts:547-554`
  - 修复方案：`writeDocumentXml` 按 section 遍历：非末 section 的 `sectPr` 写入该节最后一个段落的 `pPr` 内（OOXML 段落级分节符语义），末 section 的 `sectPr` 保持写在 body 尾部。若短期不实现，至少先产出 `DOCX_EXPORT_SECTION_FLATTENED` warning 不再静默。
  - 验证：双 section fixture 导出后用 `inspectDocxPackage` 断言两个 `sectPr`；WPS 打开确认分页设置分别生效。
  - 工作量：M。依赖：无。

- [ ] **[P-1] PDF 导出渲染文本样式**
  - 文件：`packages/pdf/src/index.ts:390-406`；样式定义 `packages/core/src/layout/font-manager.ts:13-34`
  - 修复方案：`renderPdfTextFragment` 消费完整 `ResolvedFontStyle`：bold/italic 选择对应字体变体（嵌入字体需支持按变体注册，标准字体映射 Helvetica-Bold 等）；underline/strike 在文本基线相对位置 `drawLine`；背景色先 `drawRectangle`；上下标调整 y 偏移与字号比例。
  - 验证：pdf 单测断言页面内容流包含线条与矩形操作；`tools/compat` 视觉报告样张对比。
  - 工作量：L。依赖：无。
  - 拆解：见补充文档 §3.3（四个子批）。

- [ ] **[P-2] 修复 Latin-1 文本被误判需嵌入字体**
  - 文件：`packages/pdf/src/index.ts:757-827`
  - 修复方案：`containsNonAsciiText` 的阈值从 `codePoint > 127` 改为"标准 14 字体 WinAnsi 可编码集之外"（可用 pdf-lib 标准字体的 encode 尝试或维护 WinAnsi 码表判断）；不可编码字符才要求嵌入字体。
  - 验证：单测：含 é/ü 文本、无嵌入字体配置导出成功；含中文无嵌入字体仍抛 `PDF_FONT_MISSING`。
  - 工作量：S-M。依赖：无。

- [ ] **[N-1] native 错误码按解析对象细分**
  - 文件：`packages/native/src/index.ts:630、808-841`
  - 修复方案：新增 `JWORD_NATIVE_METADATA_INVALID`、`JWORD_NATIVE_DOCUMENT_INVALID`、`JWORD_NATIVE_CHECKSUMS_INVALID` 错误码，各解析分支抛对应码，`JWORD_NATIVE_MANIFEST_INVALID` 只留给 manifest 本身；错误码目录文档同步。
  - 验证：损坏 fixture 分别触发三种错误码的单测。
  - 工作量：S。依赖：无。
  - （R2 订正，P1 → P2）document/checksums 的细分错误码已在当前代码中存在；残留问题仅 `readMetadata` 的 catch（`index.ts:630`）仍误报 `MANIFEST_INVALID`。范围缩小后可降级至 Phase 3C 顺带修复。

- [ ] **[N-2] 建立可扩展 schema 迁移链**
  - 文件：`packages/native/src/index.ts:868-882`
  - 修复方案：迁移改为 step 注册表 `[{ from: 0, to: 1, migrate(doc) }]` 顺序执行；0→1 若确无变更则显式空实现并注释说明；报告的"已执行迁移"必须与实际执行的 step 列表一致；无路径可达目标版本时抛 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`。
  - 验证：单测：模拟 v0 文件升级到 v1 记录正确；伪造 v99 文件得到稳定错误。
  - 工作量：M。依赖：无。

### 1E. 协作（Gate 6 HIGH）

- [ ] **[G6-H1] 修复 base64 编码栈溢出**
  - 文件：`packages/collab/src/client-history.ts:478`
  - 修复方案：`String.fromCodePoint(...update)` 改为分块循环（每块 ≤ 0x8000 字节 `String.fromCharCode.apply`）或平台分支（Node 用 `Buffer.from(update).toString('base64')`，浏览器分块 + `btoa`）。
  - 验证：单测编码 1MB Uint8Array 不抛栈溢出且解码还原一致。
  - 工作量：S。依赖：无。

- [ ] **[G6-H2] IndexedDB update 监听去掉全量重编码**
  - 文件：`packages/persistence/src/indexeddb-adapter.ts:103-105`
  - 修复方案：不再每次 update 调 `Y.encodeStateAsUpdate(document)`；byteLength 统计改为累加事件自带 update 的长度，或对全量编码做 ≥500ms debounce 且仅在需要上报时执行。
  - 验证：基准测试：连续 1000 次小编辑，断言全量编码调用次数为 0（或 debounce 后 ≤ 次数上限）。
  - 工作量：S-M。依赖：无。

- [ ] **[G6-H3] 消除 Hocuspocus autoConnect 竞态**
  - 文件：`packages/collab/src/hocuspocus-adapter.ts:55-112`
  - 修复方案：构造 provider 时强制传 `connect: false`，连接动作只在 adapter 的 `connect()` 中显式发起；保证握手/授权检查先于任何网络连接。
  - 验证：单测断言构造后未发起连接（mock provider 的 attach 未被调）；连接前授权失败路径正确抛错。
  - 工作量：S。依赖：无。

- [ ] **[G6-H4] 修复 `restoreVersion()` 只 apply 旧 update 不能真正回退的问题（R3）**
  - 文件：`packages/collab/src/client-history.ts:122-157`、`packages/core/src/editor/collaboration-runtime.ts`
  - 修复方案：用隔离 Y.Doc 应用目标版本 update，再通过 core 受控替换当前 canonical document；不能直接把旧 update apply 到当前 doc。
  - 验证：record v1、record v2、restore v1 后断言 v2 文本消失，并保留 `version-restore` origin。
  - 工作量：M。依赖：无。

- [ ] **[G6-H5] Hocuspocus WebSocket 服务补 tenant/authHook 隔离（R3）**
  - 文件：`packages/collab-server/src/hocuspocus-server.ts`
  - 修复方案：解析 documentName 为 tenantId/documentId/roomId，onConnect/onAuthenticate/beforeSync 中调用宿主 auth/tenant hook，拒绝跨 tenant update。
  - 验证：跨 tenant/documentName 连接被拒，合法用户可进入对应 room。
  - 工作量：M。依赖：计划审查 3.11 权限粒度设计（设计已定稿）。
  - 拆解：见补充文档 §3.5（documentName 约定、read/write 两级权限、默认拒绝）。

- [ ] **[G6-R2-1] 用户身份缺失改为阻断性错误（R2 复审补充）**
  - 文件：`packages/collab/src/client-sdk.ts:690-698`
  - 问题：`user.id`/`name` 为空时只推送 `COLLAB_AWARENESS_STALE` warning 并继续连接，而 `user.id` 是 presence、auto-inserter actor id（:668）与 license authorId 的基础，诊断码语义也错配。
  - 修复方案：新增 `COLLAB_USER_IDENTITY_REQUIRED` 阻断性 error 码并登记 diagnostics registry，身份缺失时 fail-fast 不发起连接。
  - 验证：单测：缺 id/name 时连接被拒且诊断码稳定。
  - 工作量：S。依赖：诊断码 registry（见 Phase 6 错误码单一真源项）。

### 1F. 构建产物与商业阻塞

- [ ] **[G0-04] 补齐 rollup externals**
  - 文件：`rollup.config.mjs`（约第 8 行 externals 定义）
  - 修复方案：externals 覆盖全部生产依赖：`dompurify`、`jszip`、`pdf-lib`、`fontkit`、`pdfjs-dist`、`yjs`、`y-protocols`、`y-indexeddb`、`@hocuspocus/provider`、`@hocuspocus/server` 及所有 `@4xian/jword-*` 互引；建议改为函数式 external（读各包 package.json dependencies 自动生成），防再漂移。
  - 验证：`pnpm build` 后 grep 各包 dist 无第三方库源码内联；`pnpm size` 数值显著回落并更新基线。
  - 工作量：S-M。依赖：无；Phase 6 bundle size 预算更新依赖本项先完成。

- [ ] **[LIC-1] license 签名替换为密码学签名（GA 阻塞）**
  - 文件：`packages/license/src/index.ts:222-236`
  - 问题：32 位 FNV-1a 哈希 + 可推导 verifier material，知道 issuer 即可伪造合法 license。
  - 修复方案：license token 改为非对称签名（推荐 Ed25519：签发端私钥签名，SDK 内置公钥验签，Web Crypto 的 `crypto.subtle.verify` + Node `node:crypto` 双实现，保持 license 包零第三方依赖）；保留旧格式解析仅用于开发 fixture 且显式标记 `insecure`；`tests/architecture/gate5-commercial-readiness.test.ts` 增加"禁止 FNV 签名进入发布路径"检查项。
  - 验证：单测：篡改 payload 任一字段验签失败；伪造 issuer 无法通过；离线 grace 语义不回归。
  - 工作量：M-L。依赖：无，但必须在任何商业发布/对外试用之前完成。
  - 设计定稿与拆解：见补充文档 D1 / §3.4（Ed25519、密钥管理、迁移策略已定）。

**Phase 1 里程碑**：P1 全部关闭后，编辑器达到"日常可用、导入导出可信、协作不崩溃、产物干净"状态，可对内 dogfooding。

---

## Phase 2 - 工程门禁与防线加固（Gate 0 补强）

- [ ] **[G0-06 / G0-22] check-boundaries.mjs 封堵三种绕过通道**：匹配逻辑补 `export ... from`、副作用 `import 'pkg'`、动态 `import('pkg')` 三种形式（`tools/lint/check-boundaries.mjs:24` 起的正则改为覆盖三类语法或改用 es-module-lexer 解析）。验证：为三种绕过写故意违规的临时 fixture 断言脚本报错。工作量：S。（R2 实证补强：该绕过并非理论——`packages/core/src/index.ts:15、54、55、79、136` 正是 `export ... from` 再导出语法，lint 脚本与 ESLint `no-core-forbidden-imports`（只挂 ImportDeclaration）两道防线在此语法上同时失效；ESLint 规则需补 ExportNamedDeclaration/ExportAllDeclaration 的 `node.source` 检查。）
- [ ] **[G0-08 / G0-09] core-boundary.test.ts 与 lint 防线对齐**：`tests/architecture/core-boundary.test.ts:18-39` 禁止列表补 jszip/fontkit/pdf-lib/vite/playwright/@4xian/jword-ui 等，与 `check-boundaries.mjs` 单一来源共享清单（提取共享 JSON）；补顶层 DOM 访问检查（import 阶段断言无 `document`/`window` 引用）。工作量：M。依赖：G0-06 同批。（R2 补充 G0-23：DOM 全局名单当前仅 window/document/HTMLElement，`navigator`/`localStorage`/`sessionStorage`/`self`/`globalThis` 顶层出现均不被拦截；名单应抽为 tools/lint 共享常量供 ESLint 与脚本双方引用并扩项。）
  - R3 追加：`no-core-top-level-dom` 不得跳过 export initializer 与 class static field/block；DOM 全局名单扩充后由 ESLint 与 lint 脚本共用。
  - R3 追加：`check-boundaries.mjs` 扫描 root 从 `pnpm-workspace.yaml` 派生，覆盖 `benchmarks`/`fixtures`，并扩展 `.js/.mjs/.tsx` 与 dist/node_modules 排除。
- [ ] **[G0-07] check-package-versions.mjs 扩展到所有子包**：遍历 `packages/*/package.json`、`examples/*/package.json` 检查精确 semver 与内部依赖 `workspace:` 协议。工作量：S。
- [ ] **[G0-01 / G0-03 / G0-05] 依赖治理三联**：生产依赖从根 package.json 下沉到实际使用的子包（根只留工具链）；ESLint core 禁止列表补 dompurify；vitest alias 补 `@4xian/jword-ui`、`@4xian/jword-ui/styles.css`、`@4xian/jword-native/worker`，并修复 docx/pdf/native worker 子路径 alias 顺序（子路径在主包前或 exact/regex alias）；与 `tsconfig.base.json` paths 建立一致性检查（可写架构测试调用 Vite resolver 对 worker/style 子路径逐项断言）。工作量：M。依赖：G0-07 先行可互相验证。
- [ ] **[G0-02] 补 pre-commit 钩子**：husky pre-commit 跑 `pnpm lint && pnpm typecheck`（或 lint-staged 限于改动文件），commit-msg 已有 commitlint 不动。工作量：S。
- [ ] **[计划审查 2.10] CI 门禁修复（R2 复审补充）**：`.github/workflows/ci.yml` 没有任何 `playwright install` 步骤，E2E/visual 在全新 runner 上必然失败（CI 从未真实跑通，属纸面门禁）。补 `pnpm exec playwright install --with-deps` 并真实跑通一次完整 CI 作为验收；评估三浏览器 E2E 拆分 job 与浏览器二进制缓存控制时长；审视 `test:e2e` 中 `--pass-with-no-tests` 的静默放行。工作量：S-M。依赖：无。
- [ ] **[G0-10] packages/core 纳入文件行数预算**：`tests/architecture` 增加 core 行数预算测试（与其他包同基准）；当前超标文件（如 `command-builders.ts` 1703 行）列入豁免清单并在 Phase 5 拆分后收紧。工作量：S（测试）+ 拆分工作见 Phase 5。
- [ ] **[计划审查 1.1] 制定单文件拆分专项**：`packages/ui/src/create-ui.ts`（2037 行）、`packages/core/src/commands/command-builders.ts`（1703 行）等超千行文件登记拆分方案（按功能域拆子模块，保持公开导出面不变）。本 Phase 只产出拆分清单与目标结构，实际拆分在 Phase 5 执行。工作量：S（清单）。

**Phase 2 里程碑**：防线互相一致（lint、架构测试、依赖治理三方对齐），`pnpm lint` 能拦住全部已知绕过通道。

---

## Phase 3 - P2 质量与兼容性修复（按 Gate 分组）

### 3A. Gate 2/3（布局、输入、可访问性）

- [ ] **[G2-R3] 修复 inline object 与表格 dirty page 布局缺口**：表格单元格内支持/降级 line break、page break、inline image；正文 inline object 进入 line/page fit 流程，避免超宽/页尾图片溢出；`findBlockPageIndexes()` 能命中 `TableBox.tableId` 与单元格 blockIds。工作量：M。

- [ ] **[G3-06/07/08] 补齐键盘处理**：PageUp/PageDown（按视口高度滚动并移动 caret）、Ctrl/Alt+Arrow 逐词移动（用 `Intl.Segmenter` word 粒度）、Tab 键（段落缩进/表格单元格跳转）。工作量：M。
- [ ] **[G3-11/12] 三击选段 + 拖拽自动滚动**：pointer handler 记录点击计数扩展到三击选整段；拖拽至视口边缘按距离启动定时滚动。工作量：M。
- [ ] **[G3-09/10] 剪贴板健壮性**：`readClipboardData` 判空；`normalizePlainText` 过滤控制字符（保留 \n\t）。工作量：S。
- [ ] **[G3-16] 事务监听器异常隔离**：逐个 try/catch，异常转 error 事件，不阻断后续监听器。工作量：S。
- [ ] **[G2-03] 执行 widow/orphan 控制**：分页时应用已定义未执行的孤行寡行规则。工作量：M。
- [ ] **[G2-04] 字体度量改为真实测量**：用 OffscreenCanvas/`measureText` 按字体实测并缓存（core 无顶层 DOM 访问约束下通过注入的 measurer 接口实现，保持包边界）；G2-06 缓存加 LRU 上限一并处理。工作量：L。拆解：见补充文档 §3.6（必须两阶段执行，阶段二切换真实测量前有人工检查点）。
- [ ] **[G2-15] 选区绘制层级修正**：选区矩形绘制移到文本背景之后、文本之前（对齐 3.7 层级顺序）。工作量：S。
- [ ] **[G3-23/24/25/26/30/31] 工具栏与 a11y 系列**：`role="toolbar"` + roving tabindex 键盘导航、下拉 ARIA listbox/option、tooltip `aria-describedby`、aria-live destroy 清理、公告分级（错误用 assertive）。工作量：M-L（可拆多 PR）。
- [ ] **[G3-27] UI 事件监听统一 AbortController 清理**。工作量：S。
- [ ] **[G3-21] 修正 `discardNextTransactionMetadata` 方向语义**（与消费方向一致，防错弃元数据）。工作量：S。
- [ ] **[计划审查 2.8] 保格式粘贴 Beta 级安全验收套件（R2 复审补充）**：Beta 完成区「保格式粘贴通过安全验收」长期挂空；按 specs 06 安全清单落为可回归测试：SVG payload、data URL 图片、`mso-*` 样式、docx 外链图片、不可信 HTML 降级为纯文本路径。工作量：M。依赖：无。

### 3B. Gate 4（块级结构）

- [ ] **[G4-R3] DOMPurify link/table paste 闭环**：按计划补 `a[href]` allowlist 与简单 table 结构转换，或输出稳定 warning 并更新 Gate 4 口径；补 jsdom + Playwright paste 覆盖。工作量：M。

- [ ] **[G4-高2] 查找替换快捷键**：keyboard handler 注册 Ctrl/Cmd+F、Ctrl/Cmd+H 打开面板（可被宿主配置禁用）。工作量：S。
- [ ] **[G4-中] 只读模式允许选择复制**：只读拦截改为只拦编辑类命令与输入，保留 mousedown 选择与复制。工作量：S。
- [ ] **[G4-中] 查找替换大小写不敏感 + 跨 run 搜索**：搜索在段落聚合文本上执行（记录 run 边界映射回原位置），选项加 `caseSensitive`。工作量：M。
- [ ] **[G4-中] 修订接受/拒绝流程**：新增 `acceptRevision`/`rejectRevision` command + operation（接受=清除标记保留内容或执行删除；拒绝=反向），UI 修订面板加按钮。工作量：L。拆解：见补充文档 §3.8（决策 D4：可后置，不阻塞里程碑 B；依赖 G3-20 先行）。
- [ ] **[G4-中] 批注区域 Canvas 高亮**：renderer 在批注 anchor 覆盖范围绘制底色（层级在选区之下）。工作量：M。
- [ ] **[G4-中] 页眉页脚富文本编辑**：页眉页脚区进入编辑态时复用主编辑管线（限制块类型）。工作量：L。已决策（补充文档 D3）：移入 post-1.0，本轮不实施。

### 3C. Gate 4.5 / 5（native、DOCX、PDF）

- [ ] **[gate45 P2] DOCX 批注链路修复**：`package.ts:671-678` 批注文本读取逻辑修正（去掉多余 children 判断，统一走递归取文本）；`import.ts:427-439` `commentRangeEnd` 无 run 时附着到段落级 marker 或至少发 warning。工作量：S-M。（R2 补充：多个缺 `w:id` 的批注会共享空 id 相互覆盖（`package.ts:672`），缺 id 时应跳过该批注并发 warning。）
- [ ] **[D-R2] DOCX 解压资源防护（R2 复审补充，安全）**：`packages/docx/src/package.ts:253` 对不受信任的外部 `.docx` 直接 `JSZip.loadAsync` 解压，无条目数与解压总量上限，存在 zip 炸弹式内存放大风险；解压前校验条目数与累计 uncompressedSize，超阈值 fail-fast 并返回稳定诊断。工作量：M。依赖：无。
- [ ] **[gate45 P2] DOCX worker progress 接线 + cancel 竞态**：`worker.ts` 在解析/映射/写包阶段发送已定义的 `DocxProgressEvent`；native/docx 修复"cancel 先于任务注册到达"竞态（任务表登记提前到消息受理时）。工作量：M。
- [ ] **[gate45 P2] XML 解析器补全**：`xml.ts` 解码数值字符引用（`&#xNN;`/`&#NN;`）、支持 CDATA 段、namespaceUri 继承祖先声明。工作量：M。
- [ ] **[gate45 P2] 导出 schema 合规 + validator 证据**：`<w:u w:val="single"/>`、`<w:shd w:val="clear" w:fill>`；接入 OpenXML validator 到 `tools/compat` 把 pending 证据变为真实结果。工作量：M。
- [ ] **[gate45 P2] 其余导入健壮性**：负页边距支持（pgMar 改用带符号读取）、`normalizePartPath` 对多余 `..` 告警、图片导出不支持 MIME 发 warning 不静默跳过。工作量：S-M。
- [ ] **[P2#3/4] PDF 字体子集化 + fallback 链**：`embedFont(bytes, { subset: true })` 默认开启（暴露选项）；覆盖检查支持多字体组合（按字符逐字体匹配，任一覆盖即通过，渲染时按 run 切换字体）。工作量：L。拆解：见补充文档 §3.7（全量字体不入库，走下载脚本 + CI 缓存）。
- [ ] **[X-1] 示例与 e2e 打通 Worker 路径**：`examples/docx` 增加真实 `new Worker` 调用路径（保留主线程直调作对照），e2e 断言 worker 消息协议 progress/cancel 端到端可用，闭环"互通在 Worker 中执行"不变式。工作量：M。
- [ ] **[计划审查 2.9] Microsoft Word 桌面版 T1/T2 导出矩阵补验（R2 复审补充）**：当前兼容口径为 WPS-only，与「商业格式互通」对外承诺错位；与上方 OpenXML validator 证据项配套，补 Word 真实打开/编辑/保存/重开的 T1/T2 矩阵记录，validator 部分自动化纳入 CI；未验证目标在能力文档中明示。工作量：M（人工矩阵）+ S（validator 自动化）。依赖：validator 接入先行。

### 3D. Gate 6（协作）

- [ ] **[G6-M1] memoryCollabRooms 全局清理入口**：导出 `resetMemoryCollabRooms()` 供测试与宿主释放。工作量：S。
- [ ] **[G6-M2] awareness 校验函数去重**：约 200 行重复提取到包内共享模块。工作量：S。
- [ ] **[G6-M3] 版本比较支持预发布标识**：semver 比较处理 `-beta.1` 等后缀。工作量：S。（R2 升级：`packages/collab/src/client-sdk.ts:799、883-889` 的 `readVersionParts` 把 `1.0.0-beta` 解析为与 `1.0.0` 判等，预发布/过旧 client 可绕过最低版本与 `COLLAB_SERVER_TOO_OLD` 门禁，具安全含义；从「注释级」升为「改实现」，建议随 Phase 1E 协作批次同批完成。）
- [ ] **[G6-M4] auth/license hook 默认行为对齐**：统一"默认拒绝"并在文档中显式声明（auth 当前默认放行属隐患）。工作量：S。
- [ ] **[G6-M5] history document lock 队列深度限制**：超限快速失败并返回稳定错误码。工作量：S。
- [ ] **[G6-M6] history list 授权 metadata 对齐（R3）**：GET list 统一读取 header/query entitlement 并传入 licenseHook，补无 entitlement 被拒、有 entitlement 可 list 测试。工作量：S。
- [ ] **[G6-M7] collab-server `rateLimit` 公开选项落地或移除（R3）**：实现最小滑窗限流，或从 public API 移除避免安全承诺空洞。工作量：S。
- [ ] **[G6-M8] record/preview/relay 校验 body.tenantId 与 metadata 一致（R3）**：不一致返回稳定 metadata mismatch 诊断。工作量：S。
- [ ] **[G6-M9] IndexedDB load 中 restoredDoc 显式 destroy**。工作量：S。

**Phase 3 里程碑**：兼容性与体验类问题清零，OpenXML validator 证据入库，WPS/Word 双端手工验证一轮。

---

## Phase 4 - 性能与内存优化

- [ ] **[计划审查 1.2] 输入热路径 P95 < 50ms 达标专项**（Gate 3 遗留验收项）：先用 benchmark 定位瓶颈（投影重建 GX-01、布局字体检查 GX-02、`readUpdateByteLength` GX-03 是已知候选），再按测量结果修复；目标以 `benchmarks/` 固化回归基线。工作量：XL。依赖：Phase 1 完成（避免测量被泄漏干扰）。拆解：见补充文档 §3.9（先测量后优化，收益 <5% 的项记录后跳过）。
- [ ] **[GX-01] 投影增量更新**：从"每事务全树重建"改为按 dirty 块增量重建投影节点。工作量：L。
- [ ] **[G2-05] 段落 advance 计算去 O(n²)**：逐字符累加改为前缀和/单遍累计。工作量：S-M。
- [ ] **[G2-06] 字体度量缓存 LRU 上限**（与 G2-04 合并实施）。工作量：S。
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
- [ ] **[gate7 R3] 发布/no-alias 消费闭环**：明确 registry publish vs tarball distribution；若 registry 发布，移除可发布包 `private: true` 并配置 publishConfig；新增 external empty project smoke，从本地 pack 安装公开包，不使用 examples 源码 alias，跑 typecheck/build/浏览器 smoke。Owner/Lane：release/docs。产物路径：各 `packages/*/package.json`、`tools/release/*no-alias*` 或 `tools/release/check-gate7-third-party-smoke.mjs`、外部临时 fixture 文档。验收命令：`pnpm build`、`node tools/release/check-native-pack.mjs`、`node tools/release/check-gate5-commercial-pack.mjs`、`node tools/release/check-gate6-commercial-pack.mjs`、新增 no-alias smoke 命令；涉及 UI 时补真实浏览器/Kimi smoke。工作量：M。决策与拆解：见补充文档 D2 / §3.13（tarball 冒烟先行，私有 registry 为目标形态）。
- [ ] **[gate7 R3] Public API / pack 边界降噪**：PDF worker helper 移出 stable root API；`@4xian/jword-core` 等基础包 pack 白名单收敛到 dist/README/LICENSE 或明确 source distribution 口径；pack 审计覆盖 core/ui/native/docx/pdf/collab/license/persistence 全包。Owner/Lane：release/api。产物路径：`docs/sdk/public-api.md`、`packages/*/package.json`、`tests/architecture/*public-api*`、pack 审计脚本。验收命令：`pnpm typecheck`、`pnpm test -- tests/architecture`、全包 `npm pack --dry-run` 审计脚本。工作量：M。
- [ ] **[gate7 R3] Observability/error boundary/telemetry 子任务**：默认关闭 telemetry，宿主 opt-in；定义事件 schema 与隐私裁剪；插件异常隔离、wrapper error boundary、diagnostics export 不含正文内容。Owner/Lane：sdk/runtime/docs。产物路径：diagnostics/telemetry contract 文档、wrapper error boundary 设计、相关 tests。验收命令：插件抛错单测、wrapper error boundary 测试、diagnostics export 内容审计（断言不含正文内容），必要时补浏览器 smoke。工作量：M。
- [ ] **[gate7 2.6] bundle size 预算校准**：G0-04 修复后重测各包体积，把过时预算（core 260KB/首屏 330KB vs 实际 494KB/581KB）更新为"当前实测 + 收紧路线图"，`pnpm size` 门禁按新预算执行。依赖：G0-04。工作量：S。（R2 订正数字：实测 core dist 为 523,433 字节 ≈ 511KB、vanilla 首屏 index chunk 为 573,859 字节 ≈ 560KB 且未计 CSS，均已破 `check-size.mjs:34-35` 的 260KB/330KB 门禁线；校准前先查 core 体积翻倍根因——真实增长还是过时产物（当前 dist mtime 为 5 月 26/28）。）
- [ ] **[gate7 2.7] 发布配置修复**：`packages/ui` 的 `"./styles.css"` export 从 `src/styles/toolbar.css` 改指 dist 产物（构建复制）；core/native/ui 补 `publishConfig.access`；`npm pack --dry-run` 内容审计脚本入 `tools/release/`。工作量：S-M。（R2 补充证据：`packages/ui/package.json:17` export 指向 `src/styles/toolbar.css`，`:21` 的 `files` 含 `src/styles`，发布会把源码目录带出。）
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
13. [G6-H4] 修复 `restoreVersion()` 真实回退语义（R3，历史/恢复正确性）
14. [G6-H5] Hocuspocus WebSocket tenant/authHook 隔离（R3，服务端安全）
15. [gate7 R3] 发布/no-alias 外部消费 smoke（R3，1.0 发布证据前置）

每完成一批任务：跑 `pnpm lint && pnpm typecheck && pnpm test`，涉及交互的补对应 e2e；在本文档勾选对应 checkbox 并在任务行追加完成日期与验证记录（沿用主计划文档的记录风格）。
