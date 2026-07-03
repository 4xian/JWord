# Gate 2 & Gate 3 企业级代码审查报告

**审查日期**：2026-07-02
**审查范围**：Gate 2（分页 Layout 与 Canvas Render）、Gate 3（输入与基础编辑）
**审查人**：AI Code Reviewer

> **R2 复审说明（2026-07-02 第二轮独立复审）**：本轮对第一轮全部 阻断/P0/严重 发现逐条到源码核实（结论见文末「R2 复审：已有发现核实结论」），并补充遗漏问题、订正过时行号。新增条目以「（R2 复审补充）」标注，订正条目以「（R2 订正）」标注，均按原严重度体系就地插入对应章节。核实结论：第一轮全部 2 个 P0 与 8 个 P1 均**属实**，无夸大或误报。

---

## 目录

1. [严重程度定义](#严重程度定义)
2. [Gate 2：分页布局引擎](#gate-2分页布局引擎)
3. [Gate 2：Canvas 渲染器](#gate-2canvas-渲染器)
4. [Gate 2：Viewport 虚拟化](#gate-2viewport-虚拟化)
5. [Gate 3：输入系统](#gate-3输入系统)
6. [Gate 3：选区系统](#gate-3选区系统)
7. [Gate 3：剪贴板](#gate-3剪贴板)
8. [Gate 3：命令与事务管线](#gate-3命令与事务管线)
9. [Gate 3：撤销重做](#gate-3撤销重做)
10. [Gate 3：工具栏与 UI](#gate-3工具栏与-ui)
11. [Gate 3：可访问性](#gate-3可访问性)
12. [交叉关注：内存与性能](#交叉关注内存与性能)
13. [测试覆盖分析](#测试覆盖分析)
14. [总结](#总结)

---

## 严重程度定义

| 等级 | 定义 |
|------|------|
| **P0 阻断** | 功能不可用或数据丢失风险，必须修复 |
| **P1 严重** | 核心功能缺失或行为错误，影响日常使用 |
| **P2 中等** | 功能不完整或性能问题，可在近期迭代中解决 |
| **P3 轻微** | 代码质量、死代码或边缘场景，可计划修复 |
| **P4 建议** | 优化建议或设计改进，非必须 |

---

## Gate 2：分页布局引擎

### G2-01 [P1 严重] Justify 对齐方式未实现

- **文件**：`packages/core/src/layout/paragraph-flow.ts`
- **行号**：490-493
- **描述**：`alignLineToParagraph` 函数处理了 `right` 和 `center` 对齐，但 `justify`（两端对齐）没有实现。当段落设置为 `justify` 时，实际渲染效果为左对齐。两端对齐需要在单词/字符间分配额外空间，当前完全缺失该逻辑。
- **修复建议**：在 `alignLineToParagraph` 中增加 `justify` 分支，计算行内剩余空间并均匀分配到 fragment 间的间距中。非末行才应用两端对齐。

### G2-02 [P1 严重] 大表格无法跨页断行

- **文件**：`packages/core/src/layout/engine.ts`
- **行号**：564-567
- **描述**：当表格高度超过单页内容区高度时，整个表格被放置在新页上但会溢出页面边界。缺少行级别的分页逻辑。超过一页高度的表格会导致渲染越界。
- **修复建议**：实现表格行级分页：当当前行超出页面边界时，在行边界处插入分页，将剩余行移至下一页。需要在每行边界处检查剩余空间。

### G2-03 [P2 中等] Widow/Orphan 控制已定义但未执行

- **文件**：`packages/core/src/layout/paragraph-flow.ts`
- **行号**：223-245
- **描述**：`ParagraphPageBreakPolicy` 数据结构已定义，`resolveParagraphPageBreakPolicy`（`internal.ts:271-280`）也计算了策略，但 `ensureLineFits` 函数从未检查 orphan/widow 行数。分页时不会保证段首/段尾的最少行数。
- **修复建议**：在 `ensureLineFits` 中加入 orphan/widow 检查逻辑：当段落的前 N 行（orphan 阈值）会被孤立在上一页时，将整段移到下一页；当段落的最后 N 行（widow 阈值）会被孤立在下一页时，提前分页。

### G2-04 [P2 中等] 字体度量使用固定近似值，非 Arial 字体不准确

- **文件**：`packages/core/src/layout/font-manager.ts`
- **行号**：162, 242-283
- **描述**：
  - 基线位置硬编码为行高的 78%（行 162），不同字体家族的 ascender/descender 比例差异很大（CJK 字体通常 80-85%）
  - 字宽比率表（行 242-283）基于 Arial 近似值，对 Times New Roman、Courier New、宋体等字体会产生显著偏差
  - 空格宽度比率 0.33 比 Arial 实际空格宽度（~0.278）高约 19%，导致行断点偏早
- **影响**：hit-test 定位、光标位置、行断点在非 Arial 字体下都会不准确
- **修复建议**：
  1. 短期：增加主流字体家族的宽度比率表
  2. 长期：Gate 2 浏览器环境下使用 Canvas `measureText` 获取真实度量值

### G2-05 [P2 中等] 文本段落 advance 计算为 O(n^2)

- **文件**：`packages/core/src/layout/text-segments.ts`
- **行号**：177-194
- **描述**：`createAdvanceTwips` 为段内每个 grapheme 测量一次从开头到当前位置的前缀宽度。对长度为 n 的段，执行 n 次 `measureText` 调用，每次内部调用 `splitGraphemes`（O(k)），总复杂度 O(n^2)。长单词（如 34 字符的英文单词）会明显变慢。
- **修复建议**：改为增量累加方式：逐个 grapheme 测量宽度并累加，避免重复测量前缀。

### G2-06 [P2 中等] 字体度量缓存无限增长

- **文件**：`packages/core/src/layout/font-manager.ts`
- **行号**：82-84
- **描述**：`cache` Map 无容量限制，在大文档中随着唯一 text+style 组合增多会无限增长。只有 `resetCache()`（字体变更时）和 `clearCache()`（从未自动调用）可以清理。
- **修复建议**：引入 LRU 策略或定期清理低频条目。

### G2-07 [P3 轻微] 缓存键包含不影响度量的属性

- **文件**：`packages/core/src/layout/font-manager.ts`
- **行号**：431-448
- **描述**：缓存键包含 `underline`、`strike`、`color`、`backgroundColor`、`status` 等不影响文本宽高的属性。同一文本改变颜色会导致缓存未命中。
- **修复建议**：缓存键只包含影响度量的属性：`fontFamily`、`fontSizePx`、`bold`、`italic`。

### G2-08 [P3 轻微] resourceById Map 每个 run 都重建

- **文件**：`packages/core/src/layout/engine.ts`
- **行号**：221
- **描述**：`layoutRun` 内部每次调用都从 resources 数组创建新 Map。应在 `layoutBlock` 或 `layoutDocument` 级别创建一次。
- **修复建议**：将 `resourceById` 提升到外层作用域，只创建一次。

### G2-09 [P3 轻微] 零内容高度页面可能触发无限分页

- **文件**：`packages/core/src/layout/page-config.ts` + `paragraph-flow.ts`
- **行号**：page-config.ts:91-92, paragraph-flow.ts:223-245
- **描述**：`contentHeightTwips` 通过 `Math.max(0, ...)` 可以为零。此时 `ensureLineFits` 中每个 fragment 都会触发新页，没有无限循环防护。
- **修复建议**：在 `createPageConfig` 中校验 `contentHeightTwips > 0`，或在 `ensureLineFits` 中添加防护计数器。

### G2-10 [P3 轻微] 死代码：`resolveImageInlineSize`

- **文件**：`packages/core/src/layout/engine.ts`
- **行号**：530-545
- **描述**：函数已定义但从未调用，实际图片尺寸逻辑在 `paragraph-flow.ts` 的 `resolveInlineObjectGeometry` 中。
- **修复建议**：删除死代码。

### G2-11 [P3 轻微] 列表编号 ID 检测基于字符串 "bullet"

- **文件**：`packages/core/src/layout/paragraph-semantics.ts`
- **行号**：129
- **描述**：`numberingId.toLowerCase().includes('bullet')` 判断列表类型。如果 ID 碰巧包含 "bullet"（如 "anti-bullet-list"）会被误分类。
- **修复建议**：改用精确匹配或枚举式判断。

### G2-12 [P3 轻微] 非列表段落重置所有列表计数器

- **文件**：`packages/core/src/layout/paragraph-flow.ts`
- **行号**：184-185
- **描述**：非列表段落出现时 `delete cursor.listCounters` 重置所有计数器。Word 通常会跨非列表段落继续编号。
- **修复建议**：按 `numberingId` 维护独立计数器，非列表段落不清除。

### G2-20 [P2 中等] 分页跨页时段落 spacingBefore 未在新页重置（R2 复审补充）

- **文件**：`packages/core/src/layout/paragraph-flow.ts`
- **行号**：202-209（`applyParagraphSpacingBefore`）、238-242（`ensureLineFits` 跨页分支）
- **描述**：`ensureLineFits` 在 `cursor.y + nextHeight` 超出内容区时调用 `startNewPage` + `startParagraph` 开新页，但段前距 `applyParagraphSpacingBefore` 在段落起始时已把 `spacingBeforeTwips` 累加进上一页的 `cursor.y`。段落一旦在段前距之后被断到新页，新页顶部不会再重新计算段前距语义，导致跨页续排的段落在新页顶端缺少应有的间距处理逻辑一致性（Word 的行为是页首段落忽略段前距）。当前实现既未在页首忽略段前距，也未在续排页补偿，属于分页与段落间距的边界处理缺口。
- **修复建议**：在 `startNewPage` 后对续排段落显式定义段前距策略（页首忽略或续排补偿），并补充跨页 fixture 覆盖。
- **预估工作量**：0.5 天

### G2-21 [P3 轻微] `moveSelectionVertically` 与 `moveSelectionToLineBoundary` 共用的精确浮点匹配也影响本页布局查询（R2 复审补充，与 G3-13 同源）

- **文件**：`packages/core/src/editor/text-editing-runtime.ts`
- **行号**：1472-1476（`moveSelectionToLineBoundary` 中 `candidate.y === caretRect.y && candidate.height === caretRect.height`）
- **描述**：第一轮 G3-13 只指出 `moveSelectionVertically`（1426-1429）用精确浮点相等定位当前行；实际 Home/End 的 `moveSelectionToLineBoundary` 也用完全相同的 `=== ` 相等匹配（1472-1476）。修复 G3-13 时必须同时覆盖此处，否则 Home/End 在浮点抖动下同样会定位失败。
- **修复建议**：抽出统一的「按容差匹配当前行」辅助函数，两处共用。
- **预估工作量**：并入 G3-13 修复，无额外成本

---

### G2-23 [P2 中等] 表格单元格布局丢弃非 text inline（R3 子代理复审补充）

**文件**：`packages/core/src/layout/engine.ts`
**证据**：`layoutTableCellTextFragments()` 遇到 `inline.kind !== 'text'` 直接 `continue`。

**问题**：表格单元格内的 line/page break、inline image 等不会进入 `TextFragment` / `InlineBox`，layout、render、hit-test、selection rect 都丢失这些内容。既有 G2-02 只覆盖大表格跨页，不覆盖单元格内部 inline 语义。

**建议**：至少支持 `breakType: 'line'` 作为单元格内换行；对 page break 明确禁止或定义语义；inline image 复用正文 `InlineObjectBox` 布局或生成可命中的占位。

### G2-24 [P2 中等] 正文 inline object 不参与换行/分页适配（R3 子代理复审补充）

**文件**：`packages/core/src/layout/engine.ts`、`packages/core/src/layout/paragraph-flow.ts`
**证据**：正文 text measured segment 才进入 `ensureLineFits()`；非 text inline 直接 `appendNonTextInlineBox()`；`appendNonTextInlineBox()` 只推进 `cursor.x`，未做宽高适配；换行条件只看 `line.fragments.length`，不看 `line.inlines.length`。

**问题**：超宽/超高 inline image 可能横向溢出行、纵向溢出页；如果行内只有 image，后续文本也可能因 `fragments.length === 0` 不触发换行。

**建议**：非文本 inline 先计算 geometry，再进入与 text 相同的 line/page fit 流程；换行条件同时考虑 `line.fragments.length > 0 || line.inlines.length > 0`；补超宽图片、页尾图片 fixture。

## Gate 2：Canvas 渲染器

### G2-13 [P1 严重] Canvas 池无 `dispose()` 方法，销毁时内存泄漏

- **文件**：`packages/core/src/canvas/pool.ts`
- **行号**：42-73
- **描述**：`CanvasPool` 没有 `dispose()`/`clear()` 方法。编辑器销毁时，`available` 数组中的空闲 canvas 永远不会被释放。虽然 `mount-facade-runtime.ts:289-291` 释放了 `active` canvas，但 `available` 中缓存的 canvas 仍然持有 GPU 内存。
- **修复建议**：为 `CanvasPool` 添加 `dispose()` 方法，清空 `available` 和 `active`，将所有 canvas 的宽高设为 0。

### G2-14 [P2 中等] Canvas 池无双重释放防护

- **文件**：`packages/core/src/canvas/pool.ts`
- **行号**：63-71
- **描述**：如果同一个 canvas 被 `release()` 两次，`active.delete(canvas)` 在第二次时静默返回 `false`，但 canvas 仍被推入 `available`，导致 `available` 中出现重复条目。两个不同的消费者可能从 `acquire()` 获得同一个 canvas。
- **修复建议**：在 `release` 开头检查 `if (!active.has(canvas)) return`。

### G2-15 [P2 中等] 选区矩形绘制在文本背景之前

- **文件**：`packages/core/src/canvas/renderer.ts`
- **行号**：82-84
- **描述**：渲染顺序为：选区矩形 -> 文本背景 -> 表格边框 -> 文本 -> 内联对象 -> 光标。选区矩形在文本背景之前绘制，如果字符同时有背景色和选中态，文本背景会覆盖选区高亮，导致选区不可见。
- **正确顺序**：文本背景 -> 选区矩形 -> 文本 -> 光标
- **修复建议**：调整 `renderPageCanvas` 中的调用顺序，将 `renderTextBackgrounds` 移到 `renderSelectionRects` 之前。

### G2-16 [P3 轻微] `renderRectBorder` 函数为死代码

- **文件**：`packages/core/src/canvas/renderer.ts`
- **行号**：169-185
- **描述**：定义了 `renderRectBorder` 但从未被调用。
- **修复建议**：删除或标记为将来使用。

### G2-17 [P3 轻微] 页眉/页脚文本宽度估算不准确

- **文件**：`packages/core/src/canvas/renderer.ts`
- **行号**：299-301
- **描述**：使用固定 0.55 字符宽度比率估算文本宽度。对 CJK 等宽字符（实际约 1.0em）和窄字符（如 "i", "l"）误差较大，可能导致右对齐页码溢出或偏移。
- **修复建议**：使用 Canvas `measureText` API 获取真实文本宽度。

### G2-18 [P4 建议] `iteratePageTextFragments` 每页执行两次


### G2-25 [P2 中等] 表格操作 dirty page 定位查不到 tableId（R3 子代理复审补充）

**文件**：`packages/core/src/editor/rendering.ts`、`packages/core/src/layout/engine.ts`
**证据**：`insertTableRow/deleteTableRow/setTableCellText/...` 用 `findBlockPageIndexes(layout, operation.tableId)`；但 `findBlockPageIndexes()` 只查 paragraph 与 line fragments/inlines，不查 `page.blocks` 里的 `TableBox.tableId`。

**问题**：表格编辑命令可能重排/重绘错误页面；当 selection 不在目标表格页或表格 offscreen 时，真实表格页可能不被优先刷新。

**建议**：`findBlockPageIndexes()` 增加 `page.blocks.some(block.kind === 'table' && block.tableId === blockId)`；同时考虑 `TableCellBox.blockIds`，让单元格段落变更也能命中表格页。

- **文件**：`packages/core/src/canvas/renderer.ts`
- **行号**：83, 87
- **描述**：generator 为 `renderTextBackgrounds` 和 `renderTextFragments` 各执行一次。可缓存为数组避免双重迭代。
- **修复建议**：在 `renderPageCanvas` 中将 `iteratePageTextFragments` 结果缓存为数组。

---

## Gate 2：Viewport 虚拟化

### G2-19 [P4 建议] 可见页面查找使用线性扫描

- **文件**：`packages/core/src/canvas/viewport-virtualizer.ts`
- **行号**：30-31
- **描述**：`filter` 遍历所有页面判断可见性。对于 100+ 页的文档，二分查找首个可见页面会更高效（O(log n) vs O(n)）。
- **修复建议**：在大文档场景下使用二分查找优化。

### G2-22 [P4 建议] `expandWithBuffer` 对每个可见页做线性 `indexOf` 查找（R2 复审补充，与 G2-19 同源）

- **文件**：`packages/core/src/canvas/viewport-virtualizer.ts`
- **行号**：84-88（`pageIndexes.indexOf(visiblePageIndex)` 位于 `for (const visiblePageIndex of ...)` 循环内）
- **描述**：除了 G2-19 指出的 `computeViewportPages` 里 `filter` 全量扫描，`expandWithBuffer` 还在遍历可见页时对每个可见页调用 `pageIndexes.indexOf`（O(n) 线性查找），整体是 O(可见页数 × 总页数)。可见页通常连续，页索引本身即数组下标，无需线性反查。
- **修复建议**：`pageIndex` 与数组 position 若一一对应可直接用下标；否则预建一次 `Map<pageIndex, position>`。
- **预估工作量**：0.25 天

---

## Gate 3：输入系统

### G3-01 [P0 阻断] Shift+Arrow 选区扩展完全缺失

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：219-242
- **描述**：箭头键处理（ArrowLeft/Right/Up/Down）从未检查 `event.shiftKey`。按住 Shift 时不会扩展选区，而是与不按 Shift 行为相同（移动光标并折叠选区）。这是文本编辑器最基本的功能之一。
- **影响**：用户无法通过键盘选中文本，只能依赖鼠标拖拽。
- **修复建议**：在 `moveSelectionHorizontally`/`moveSelectionVertically`/`moveSelectionToLineBoundary` 中增加 `extending` 参数。当 `shiftKey` 为 true 时，保持 anchor 不变，只移动 focus。
- **R2 复审补充：计划基线声明偏差**。规划文档 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md:230` 的 Step 3.4 声称 keyboard handler「覆盖输入、删除、回车、方向键、快捷键、撤销重做」并已勾选 `[x]`，`:262` 验收项「输入、删除、回车、方向键、选择、复制粘贴可用」亦勾选。但源码证明 Shift+方向键选区扩展完全缺失，方向键仅实现了折叠光标移动。因此该 P0 不仅是功能缺陷，也意味着 Step 3.4 的完成勾选与实际实现不符，建议在修复的同时回写计划状态。

### G3-02 [P0 阻断] Enter 键在有选区时无效

- **文件**：`packages/core/src/editor/text-editing-runtime.ts`
- **行号**：1330
- **描述**：`splitParagraphFromRuntime` 在选区非折叠时直接 `return`。用户选中文本后按 Enter，期望先删除选区内容再分段，但实际什么也不发生。
- **修复建议**：在 `splitParagraphFromRuntime` 中，若选区非折叠，先调用 `deleteSelectedTextFromRuntime()` 删除选中内容，再执行分段。
- **R2 复审补充：受影响路径不止键盘 Enter**。`splitParagraphFromRuntime` 有两个调用入口，两者在有选区时都会静默失败：（1）`input-runtime.ts:213-217` 的 keydown Enter；（2）`input-runtime.ts:129-136` 的 `handleRuntimeBeforeInput`，浏览器原生 `insertParagraph`/`insertLineBreak`（含部分 IME/软键盘换行）也走此路径。此外 `Ctrl+A` 全选（`input-runtime.ts:176-182`）后按 Enter 是最常见触发场景。修复应放在 `splitParagraphFromRuntime` 内部，一次覆盖全部入口。

### G3-03 [P1 严重] `mouseup` 注册在 canvas 容器而非 document

- **文件**：`packages/core/src/editor/mount-facade-runtime.ts`
- **行号**：193
- **描述**：`mouseup` 事件监听注册在 `canvasContainer` 上。如果用户在编辑器内开始拖拽选区，鼠标移出编辑器区域后释放，`mouseup` 事件不会触发。`pointerState.anchor` 保持非 null，之后所有的 `mousemove` 都被当作拖拽操作，导致选区行为混乱。
- **修复建议**：将 `mouseup` 监听注册到 `document` 上。在 destroy 中也从 `document` 移除。

### G3-04 [P1 严重] `focus`/`blur` 事件监听器在 destroy 时未移除

- **文件**：`packages/core/src/editor/mount-facade-runtime.ts`
- **行号**：183-205（注册），273-286（销毁）
- **描述**：`handleFocus` 和 `handleBlur` 闭包在行 204-205 注册到 hiddenTextarea，但：
  1. 它们没有存储到 `mountedDom` 对象中
  2. `destroy()` 方法（行 273-286）移除了其他所有事件监听，但遗漏了 `focus` 和 `blur`
- **影响**：销毁后，闭包通过事件监听器持有编辑器实例引用，阻止 GC。由于 `shell.remove()` 会从 DOM 移除 textarea，实际泄漏有限，但设计上有缺陷。
- **修复建议**：将 `handleFocus`/`handleBlur` 存入 `mountedDom`，在 `destroy()` 中移除。

### G3-05 [P1 严重] 输入错误被静默吞没

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：408-424
- **描述**：`runProtectedInputHandler` 的 `catch` 块捕获所有异常后仅设置 `liveRegion.textContent = '输入失败'`，无日志输出、无 rethrow、宿主无法感知错误。这会隐藏生产环境中的严重 bug。
- **修复建议**：至少添加 `console.error` 日志输出异常堆栈；考虑通过 editor event 向宿主暴露错误。

### G3-06 [P2 中等] 缺少 PageUp/PageDown 键处理

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：200-255
- **描述**：`handleRuntimeKeyDown` 的 switch 语句不包含 `PageUp` 和 `PageDown`。按这两个键时什么也不发生（由于 textarea 被限制，也不会滚动）。
- **修复建议**：计算当前 viewport 高度，移动光标上/下一个 viewport 的距离。

### G3-07 [P2 中等] 缺少 Ctrl+Arrow 逐词移动

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：219-230
- **描述**：未检查 `event.ctrlKey`（Windows）或 `event.altKey`（macOS）来实现逐词移动。Ctrl+Backspace、Ctrl+Delete 逐词删除也缺失。
- **修复建议**：添加修饰键检测，实现 word boundary 跳转和删除。

### G3-08 [P2 中等] 缺少 Tab 键处理

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：200-255
- **描述**：Tab 键未被拦截，按 Tab 会导致焦点从 hidden textarea 移出编辑器。
- **修复建议**：拦截 Tab 键，根据上下文插入制表符或调整列表缩进。

### G3-09 [P2 中等] `readClipboardData` 未处理 null

- **文件**：`packages/core/src/editor/text-runtime.ts`
- **行号**：335
- **描述**：`ClipboardEvent.clipboardData` 在某些浏览器中可能为 `null` 而非 `undefined`。当前只检查 `=== undefined`，`null` 值会穿透导致后续空引用错误。
- **修复建议**：改为 `clipboardData == null`（双等号检查 null 和 undefined）。

### G3-10 [P3 轻微] `normalizePlainText` 未过滤控制字符

- **文件**：`packages/core/src/editor/text-runtime.ts`
- **行号**：258
- **描述**：仅规范化 `\r\n` 和 `\r` 为 `\n`，不过滤其他控制字符（U+0000-U+001F 除 \n, \r, \t 外）。粘贴时可能引入 null 字节等不可见字符。
- **修复建议**：增加过滤步骤 `text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/gu, '')`。

---

## Gate 3：选区系统

### G3-11 [P2 中等] 缺少三击选段功能

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：390-406
- **描述**：双击选词已实现（`handleRuntimeDoubleClick`），但三击选整段未实现。Word 编辑器标准行为是三击选中整个段落。
- **修复建议**：在 `handleRuntimePointerDown` 中检测快速三次点击（利用时间戳和位置），调用段落选中逻辑。

### G3-12 [P2 中等] 拖拽选区时无自动滚动

- **文件**：`packages/core/src/editor/input-runtime.ts`
- **行号**：332-354
- **描述**：`handleRuntimePointerMove` 不检查鼠标是否在 canvas 容器边缘附近。用户拖拽选区超出可见区域时，文档不会自动滚动。
- **修复建议**：在 `handleRuntimePointerMove` 中检测鼠标与 viewport 边缘的距离，当距离小于阈值时触发定时滚动。

### G3-13 [P2 中等] 垂直移动光标使用精确浮点比较定位当前行

- **文件**：`packages/core/src/editor/text-editing-runtime.ts`
- **行号**：1426-1429
- **描述**：`moveSelectionVertically` 通过 `line.pageIndex === caretRect.pageIndex && line.y === caretRect.y && line.height === caretRect.height` 精确匹配定位当前行。如果布局引擎存在浮点精度问题，匹配可能失败。
- **修复建议**：使用带容差的比较（例如 `Math.abs(line.y - caretRect.y) < 1`）。

### G3-14 [P3 轻微] UI 层 grapheme 长度计算使用 `Array.from` 而非 `Intl.Segmenter`

- **文件**：`packages/ui/src/selection-rebind.ts:176`，`packages/ui/src/create-ui.ts:1698, 1988`
- **描述**：`Array.from(inline.text).length` 按 code point 拆分，对组合 emoji（如 `'👨‍👩‍👧‍👦'`）会返回 7 而非 1。Core 层使用 `Intl.Segmenter` 做正确的 grapheme 拆分，但 UI 层未统一。
- **影响**：格式化命令后的选区重建在包含组合 emoji 时可能偏移。
- **修复建议**：统一使用 core 的 `countGraphemes` 或 `splitGraphemes` 函数。

---

### G3-33 [P1 严重] 跨 section / 跨容器选区删除、剪切、粘贴替换会失败（R3 子代理复审补充）

**文件**：`packages/core/src/editor/text-editing-runtime.ts`、`packages/core/src/operations/operation-adapter.ts`

**证据**：`buildDeleteSelectionPlan()` 为所有 selected target 的 `deleteRange.anchor/focus.sectionId` 写入 `range.start.sectionId`；跨段删除又无条件生成连续 `mergeBlock`。而 `operation-adapter.ts` 中 `deleteRange` 会按 `position.sectionId` 定位 section，`mergeBlock` 只支持同一容器相邻段落。

**问题**：跨 section 选区执行 Delete/Backspace/Cut/粘贴替换时，后续 section 的 run 会被错误地按起始 section 查找；跨 section/container merge 则可能抛 `OPERATION_MERGE_BLOCK_NOT_ADJACENT`。这属于用户可感知的编辑正确性问题，应高于普通 P2。

**建议**：`SelectedRunTarget` 或 delete plan 携带真实 section/container；deleteRange 使用 target 所属 section；merge 只在同一容器内执行，跨 section 明确语义（保留 section break、删除空 section，或返回稳定 unsupported error）。

## Gate 3：剪贴板

### G3-15 [P3 轻微] 粘贴 HTML 中 `<br>` 转为空格而非换行

- **文件**：`packages/ui/src/paste/sanitizer.ts`
- **行号**：121-126
- **描述**：`HTMLBRElement` 被转换为 `text: ' '`（空格），而非段落分隔或换行。复制包含 `<br>` 的 HTML 后粘贴，换行位置会变成空格。
- **修复建议**：将 `<br>` 处理为段落边界或保留为换行标记。

---

## Gate 3：命令与事务管线

### G3-16 [P2 中等] 事务监听器异常会阻断后续监听器

- **文件**：`packages/core/src/operations/transaction.ts`
- **行号**：738-754
- **描述**：`notifyListeners` 遍历所有监听器时没有 try/catch。如果某个监听器抛出异常，后续监听器不会被通知，且 Y.Doc 变更已提交无法回滚。调用方收到异常，但数据已变更。
- **修复建议**：在 `notifyListeners` 中为每个监听器调用包裹 try/catch，收集异常但不阻断遍历。

### G3-17 [P2 中等] `runMutation` 始终标记 dirty

- **文件**：`packages/core/src/operations/transaction.ts`
- **行号**：635
- **描述**：`runMutation` 硬编码 `dirty: true`，即使回调是空操作。这会导致不必要的布局/渲染刷新。
- **修复建议**：类似 `run` 方法，基于 `updateByteLength > 0` 判断 dirty。

### G3-18 [P3 轻微] 命令构建器中的死代码

- **文件**：`packages/core/src/operations/command-builders.ts`
- **行号**：1276-1278, 1330-1342, 1500-1502
- **描述**：`collectCommentThreadIds`、`allocateGeneratedCommentThreadId`、`findCommentThread` 三个函数已定义但从未调用。
- **修复建议**：删除死代码。
- **R2 订正**：`collectCommentThreadIds` 与 `findCommentThread` 是**同名多副本**，需精确限定为「`command-builders.ts` 内的副本是死代码」。`comment-command-builders.ts` 中的同名函数被大量调用（`findCommentThread` 有 7 处调用者，`collectCommentThreadIds` 被 `buildAddCommentThreadCommand` 调用）。因此删除范围仅限 `command-builders.ts:1276-1278` 与 `command-builders.ts:1500-1502` 两处副本，不得误删 `comment-command-builders.ts` 的实现。`allocateGeneratedCommentThreadId`（1330-1342）确为纯死代码。

### G3-19 [P3 轻微] 模块级可变计数器影响测试确定性

- **文件**：`command-builders.ts:41`，`comment-command-builders.ts:16-18`，`link-command-builders.ts:19`，`revision-command-builders.ts:17-18`
- **描述**：`tableCommandSequence`、`commentThreadSequence` 等模块级计数器在测试间不重置，导致 ID 不确定。
- **修复建议**：提供 `resetSequence()` 测试辅助函数或在创建时传入 ID 生成器。

### G3-20 [P3 轻微] 修订标记仅应用于选区的第一个 run

- **文件**：`packages/core/src/operations/revision-command-builders.ts`
- **行号**：39
- **描述**：`collectSelectionTargets(...).runs[0]` 仅取第一个 run。跨多个 run 的选区只有首个 run 被标记修订元数据。
- **修复建议**：遍历所有选中的 runs，为每个 run 生成修订操作。

---

## Gate 3：撤销重做

### G3-21 [P2 中等] `discardNextTransactionMetadata` 与消费方向不一致

- **文件**：`packages/core/src/operations/history.ts`
- **行号**：107-110
- **描述**：`captureNextTransaction` 使用 `push` 入队，`stack-item-added` 处理器使用 `shift` 消费（FIFO）。但 `discardNextTransactionMetadata` 使用 `pop`（LIFO）丢弃。当多个 metadata 排队时，`discard` 会丢弃错误的条目。
- **修复建议**：`discardNextTransactionMetadata` 改为 `this.pendingMetadata.shift()` 以保持 FIFO 语义。

### G3-22 [P3 轻微] `restoreSelection` 不验证文档状态一致性

- **文件**：`packages/core/src/model/selection.ts`
- **行号**：116-118
- **描述**：`restoreSelection` 直接返回快照的 selection，不验证其中引用的 block/run/grapheme 是否仍然存在。文档变更后恢复的选区可能指向已删除的位置。
- **修复建议**：在 facade 层恢复选区后增加有效性校验，无效时回退到文档首位置。

---

## Gate 3：工具栏与 UI

### G3-23 [P1 严重] 工具栏缺少 `role="toolbar"` ARIA 角色

- **文件**：`packages/ui/src/toolbar/dom.ts`
- **行号**：49
- **描述**：工具栏宿主元素设置了 `aria-label: 'JWord toolbar'`，但没有 `role="toolbar"`。屏幕阅读器无法识别该区域为工具栏。
- **修复建议**：在宿主元素上添加 `role="toolbar"`。

### G3-24 [P2 中等] 工具栏无键盘导航（Arrow Key roving tabindex）

- **文件**：`packages/ui/src/toolbar/dom.ts`
- **行号**：全文
- **描述**：WAI-ARIA toolbar 模式要求左右箭头键在工具栏项之间导航（roving tabindex）。当前实现依赖默认 Tab 顺序，不符合可访问性最佳实践。
- **修复建议**：实现 roving tabindex 模式：所有工具项 `tabindex="-1"`，当前焦点项 `tabindex="0"`，左右箭头移动焦点。

### G3-25 [P2 中等] 自定义下拉菜单缺少 ARIA listbox/option 角色

- **文件**：`packages/ui/src/toolbar/dom.ts`
- **行号**：279
- **描述**：自定义 select 的菜单面板（`<div>`）没有 `role="listbox"`，选项按钮没有 `role="option"`。屏幕阅读器无法将其理解为下拉选择控件。
- **修复建议**：菜单容器添加 `role="listbox"`，每个选项添加 `role="option"` 和 `aria-selected`。

### G3-26 [P2 中等] Tooltip 未通过 `aria-describedby` 关联控件

- **文件**：`packages/ui/src/toolbar/tooltip.ts`
- **行号**：23
- **描述**：tooltip 元素有 `role="tooltip"` 但没有 `id`，控件没有 `aria-describedby` 指向它。屏幕阅读器不会在控件获得焦点时朗读 tooltip 内容。
- **修复建议**：为 tooltip 添加唯一 `id`，在关联控件上设置 `aria-describedby`。

### G3-27 [P2 中等] 按钮/选择器/颜色控件事件监听未通过 AbortController 清理

> **R3 范围补充**：该问题还应覆盖 tooltip 事件监听。`wrapWithTooltip()` 注册 `mouseover/focusin/mouseout/focusout/mousedown/click`，但返回值没有 destroy 被 `createToolbarDom()` 收集，`destroyToolbarDom()` 只执行 control 自身 destroy 后 `replaceChildren()`。建议 `wrapWithTooltip()` 返回 `destroy()` 或接收 `AbortSignal`，并纳入 `destroyParts`。

- **文件**：`packages/ui/src/toolbar/controller.ts`
- **行号**：1298-1334
- **描述**：`bindButton`、`bindSelect`、`bindColorClick`、`bindColorInput` 直接添加事件监听，未传 `signal`。`destroy()` 调用 `signalController.abort()` 只能清理 `editorHost` 和 `document` 级别的监听器。按钮/选择器的监听器依赖 DOM 节点移除后由 GC 回收。
- **修复建议**：统一将所有事件监听的 `signal` 设为 `signalController.signal`。

### G3-28 [P3 轻微] `disableReadonlyToolbarControls` 维护硬编码工具列表

- **文件**：`packages/ui/src/toolbar/controller.ts`
- **行号**：203-238
- **描述**：只读模式禁用列表手动维护，与 `BUILTIN_TOOL_IDS` 需保持同步。新增工具时若遗漏，该工具在只读模式下仍可用。
- **修复建议**：改为禁用所有工具，仅对导航类工具使用显式允许列表。

### G3-29 [P3 轻微] `syncToolbarLinkInsertAvailability` 绕过工具栏渲染周期


### G3-34 [P3 轻微] Toolbar DOM/Tooltip 使用全局 document，不使用宿主 ownerDocument（R3 子代理复审补充）

**文件**：`packages/ui/src/toolbar/dom.ts`、`packages/ui/src/toolbar/tooltip.ts`

**问题**：`createToolbarDom(host, ...)` 接收宿主元素，但创建 toolbar 和控件时多处使用全局 `document.createElement()`；tooltip 也使用全局 document。iframe、多 document、嵌入式 SDK 或跨 window 测试环境中，节点可能创建到错误 document。

**建议**：`createToolbarDom()` 内统一 `const ownerDocument = host.ownerDocument` 并传给 helper；`wrapWithTooltip()` 使用 `control.ownerDocument`，跨 window 判断用 `ownerDocument.defaultView?.Node/Element`。

- **文件**：`packages/ui/src/create-ui.ts`
- **行号**：1707-1722
- **描述**：直接修改 `insert.link` 按钮的 `disabled` 和 `aria-disabled` 属性，与工具栏自身的状态/渲染循环产生两个真相来源。
- **修复建议**：通过工具栏的状态机制传递链接按钮的可用性。

---

## Gate 3：可访问性

### G3-30 [P2 中等] `aria-live` 区域 destroy 后不清除残留文本

- **文件**：`packages/ui/src/assistive/live-region.ts`
- **行号**：63
- **描述**：`destroy()` 设置 `destroyed = true` 但不清除 `host.textContent`。最后一条公告文本残留在 DOM 中，如果宿主元素继续存在，辅助技术可能重复读取过时内容。
- **修复建议**：在 `destroy()` 中添加 `host.textContent = ''`。
- **R2 订正**：当前 `live-region.ts` 是**外部宿主绑定版**，宿主经 `options.host` 传入且可能为 `null`。`destroy`（62-64 行）确实只置 `destroyed = true`、不清文本，结论与行号（63）均属实。修复应写为 `if (options.host !== null) options.host.textContent = ''`，不能假设 host 一定存在。

### G3-31 [P2 中等] 所有公告使用相同的 `aria-live="polite"` 优先级

- **文件**：`packages/ui/src/assistive/live-region.ts`
- **行号**：32
- **描述**：错误类公告（如 "BLOCKED: 当前为只读模式"）应使用 `aria-live="assertive"` 以确保立即朗读。当前所有公告使用 `polite`，错误提示可能被延迟或跳过。
- **修复建议**：`announce` 方法增加 `priority` 参数，错误公告使用 `assertive`。
- **R2 订正**：当前源码中 `aria-live="polite"` 硬编码在 `configureLiveRegionHost` 的第 **83** 行（并同时设 `role="status"`），`announce` 无 priority 分支在第 **36-50** 行；报告原标注的「行 32」在当前 checkout 不指向该逻辑。结论仍属实，行号更正为 83（属性设置）/36-50（announce）。此外该实现的宿主 `options.host` 可能为 `null`，priority 改造需同时处理 host 为 null 的分支。

### G3-32 [P3 轻微] 文本镜像使用已弃用的 `clip` CSS 属性

- **文件**：`packages/ui/src/assistive/text-mirror.ts`
- **行号**：159
- **描述**：视觉隐藏技术使用 `clip: rect(0 0 0 0)`，该属性已被 `clip-path: inset(50%)` 替代。
- **修复建议**：替换为 `clip-path: inset(50%)`。

---

## 交叉关注：内存与性能

### GX-01 [P2 中等] 投影重建每次遍历整个文档树

- **文件**：`packages/core/src/model/projection.ts`
- **行号**：全文
- **描述**：`createDocumentProjection` 在每次事务后完整遍历 Y.Doc 文档树并深冻结所有对象。对大文档（1000+ 段落），这是性能瓶颈。
- **修复建议**：引入增量投影更新：基于事务影响的路径，只重建变更部分。

### GX-02 [P2 中等] 增量布局字体兼容性检查遍历整个文档

- **文件**：`packages/core/src/layout/incremental.ts`
- **行号**：107-156
- **描述**：`isCompatibleLayoutFontManager` 收集全文档所有唯一 run 样式，然后对每种样式用 5 种探测文本做比较。100 种唯一样式 = 1000 次度量比较。每次增量布局都执行。
- **修复建议**：缓存上次成功的字体管理器哈希，只在字体列表变更时重新验证。

### GX-03 [P2 中等] 事务后 `readUpdateByteLength` 性能开销

- **文件**：`packages/core/src/operations/transaction.ts`
- **行号**：645-653
- **描述**：每次事务后编码 state vector（两次）并可能编码完整 state-as-update。对大文档，这是不必要的开销，尤其诊断信息是可选的。
- **修复建议**：仅在开启诊断模式时计算 `updateByteLength`。

### GX-04 [P3 轻微] 延迟渲染使用 `setTimeout(0)` 而非 `requestAnimationFrame`

- **文件**：`packages/core/src/editor/pointer-runtime.ts`
- **行号**：200-206, 291-297
- **描述**：视觉更新使用 `setTimeout(0)` 可能导致布局抖动。`requestAnimationFrame` 与浏览器绘制周期同步，更适合视觉更新。
- **修复建议**：将延迟渲染改为 `requestAnimationFrame`。

### GX-05 [P3 轻微] 布局运行时 `while(true)` 循环无安全计数器

- **文件**：`packages/core/src/editor/layout-runtime.ts`
- **行号**：169-192, 195-222, 225-270
- **描述**：`readTransientLayoutThroughPage`、`readTransientLayoutForPosition`、`readTransientLayoutForRange` 都使用无界 `while(true)` 循环等待增量布局完成。如果布局引擎持续产生 continuation，可能死循环。
- **修复建议**：添加最大迭代次数（如 1000）的安全退出。

### GX-06 [P3 轻微] `AnchorRef` 内部状态可变但外层被冻结

- **文件**：`packages/core/src/model/position.ts`
- **行号**：351, 519-553
- **描述**：`AnchorRef` 通过 `Object.freeze()` 冻结，但其内部 `AnchorRefState` 未冻结。`resolveAnchorRef` 和 `migrateTextAnchors` 会修改 state 字段。这违反了 `Object.freeze` 暗示的不可变契约。
- **影响**：虽然是有意设计（AnchorRef 是句柄而非值对象），但可能误导开发者。
- **修复建议**：文档中明确说明 AnchorRef 是可变句柄，或改用 Proxy 模式。

---

## 测试覆盖分析

### 已有测试

| 模块 | 测试文件 | 覆盖范围 |
|------|----------|----------|
| Layout | `layout/runtime.test.ts` | 布局算法基本功能 |
| Layout | `layout/page-config.test.ts` | 页面配置和单位转换 |
| Layout | `layout/font-manager.test.ts` | 字体管理器 |
| Layout | `layout/query.test.ts` | hit-test 和选区矩形 |
| Layout | `layout/scheduler.test.ts` | 调度计划 |
| Canvas | `canvas/pool.test.ts` | Canvas 池 |
| Canvas | `canvas/renderer.test.ts` | 渲染器 |
| Canvas | `canvas/viewport-virtualizer.test.ts` | 虚拟化 |
| Editor | `editor/input-runtime.test.ts` | 输入处理 |
| Editor | `editor/facade-runtime.test.ts` | Facade API |
| Gate 2 | `tests/gate2-fixture.test.ts` | 50 页 fixture 基线 |
| Toolbar | `toolbar-controller.test.ts` | 工具栏控制器 |

### 关键测试缺口

| 缺口 | 严重程度 | 说明 |
|------|----------|------|
| **Shift+Arrow 选区扩展** | P0 | 功能完全缺失，自然无测试 |
| **IME composition 跨浏览器** | P1 | 缺少 Chrome/Safari `compositionend` + `input` 事件序列差异的测试 |
| **拖拽超出 viewport** | P1 | 无 `mouseup` 在 canvas 外触发的测试 |
| **大表格跨页** | P1 | 无超过单页高度表格的布局测试 |
| **Justify 对齐** | P1 | 功能未实现，无测试 |
| **live-region.ts** | P2 | 零测试覆盖 |
| **text-mirror.ts** | P2 | 零测试覆盖 |
| **tooltip.ts** | P2 | 零测试覆盖 |
| **selection-rebind.ts** | P2 | 零测试覆盖 |
| **E2E 可访问性** | P2 | 无屏幕阅读器/键盘导航 E2E 测试 |

---

## 总结

### 统计

| 严重程度 | 数量（R1） | R2 新增 | 合计 |
|----------|------|------|------|
| P0 阻断 | 2 | 0 | 2 |
| P1 严重 | 8 | 0 | 8 |
| P2 中等 | 20 | 1（G2-20） | 21 |
| P3 轻微 | 15 | 1（G2-21） | 16 |
| P4 建议 | 2 | 1（G2-22） | 3 |
| **总计** | **47** | **3** | **50** |

> R2 另有 4 处订正（G3-18 死代码范围、G3-31 行号、G3-30 修复写法、G3-13/G2-21 同源扩展），不改变严重度计数。第一轮全部 P0/P1 核实属实。

### P0 问题清单（必须立即修复）

1. **G3-01**：Shift+Arrow 选区扩展完全缺失
2. **G3-02**：Enter 键在有选区时无效

### P1 问题清单（严重影响日常使用）

1. **G2-01**：Justify 对齐方式未实现
2. **G2-02**：大表格无法跨页断行
3. **G2-13**：Canvas 池无 dispose 方法
4. **G3-03**：mouseup 注册位置错误
5. **G3-04**：focus/blur 事件监听器泄漏
6. **G3-05**：输入错误被静默吞没
7. **G3-23**：工具栏缺少 role="toolbar"
8. **G3-20**：修订标记仅应用于首个 run

### 整体架构评价

**优势**：
- 事务管线设计严谨，所有变更通过 `doc.transact()` 统一管理
- 投影层 `Object.freeze` 深冻结，读写隔离清晰
- IME composition 的 `pendingPlainInputText` 去重机制设计巧妙
- Canvas 虚拟化和池化架构合理
- 错误码体系完善

**需要改进**：
- 字体度量依赖近似值而非真实测量，hit-test 和行断点的准确性受限
- 键盘交互功能不完整（选区扩展、逐词移动、PageUp/Down）
- 可访问性实现不完整（ARIA 角色、键盘导航、公告优先级）
- 部分跨文件代码重复（utility 函数、hit-test 函数）

---

## R2 复审：已有发现核实结论

对第一轮全部 阻断/P0/严重 发现逐条到源码核实，结论如下（均**属实**）。

| 编号 | 严重度 | 核实结论 | 证据 file:line |
|------|--------|----------|----------------|
| G3-01 | P0 | 属实。ArrowLeft/Right/Up/Down、Home/End 分支均不读 `event.shiftKey` | `input-runtime.ts:219-254` |
| G3-02 | P0 | 属实。选区非折叠直接 return；beforeinput 换行路径同样受影响 | `text-editing-runtime.ts:1330`、`input-runtime.ts:129-136` |
| G2-01 | P1 | 属实。只处理 right/center，justify 落入 offset=0 等同左对齐 | `paragraph-flow.ts:490-492` |
| G2-02 | P1 | 属实。仅整表放不下时开一次新页，无行级分页 | `engine.ts:564-567` |
| G2-13 | P1 | 属实。`CanvasPool` 接口无 dispose/clear，`available` 缓存无法释放 | `pool.ts:35-73` |
| G3-03 | P1 | 属实。`mouseup` 注册在 `canvasContainer` 非 document | `mount-facade-runtime.ts:193`、销毁对称在 276 |
| G3-04 | P1 | 属实。`handleFocus`/`handleBlur` 未存入 mountedDom，destroy 未移除 | `mount-facade-runtime.ts:183-205`、销毁 273-286 |
| G3-05 | P1 | 属实。catch 块无日志/无 rethrow，仅写 liveRegion | `input-runtime.ts:418-423` |
| G3-23 | P1 | 属实。仅设 aria-label，无 `role="toolbar"` | `toolbar/dom.ts:49` |
| G3-20 | P1 | 属实。`collectSelectionTargets(...).runs[0]` 仅取首个 run | `revision-command-builders.ts:39` |

无「不属实/夸大」条目。另抽查的 P2/P3（G2-03/05/06/07/09/12、G2-14/15/16、G3-09/10/13/14/15/16/17/21/22/26/27/30/31/32、GX-02/04/05）亦全部在源码中定位属实，仅 G3-18/G3-30/G3-31 需按上文订正范围或行号。

---

## R2 复审：新增问题列表（结构化）

| 严重度 | 编号 | 标题 | file:line | 一句话描述 | 修复方案 | 工作量 |
|--------|------|------|-----------|------------|----------|--------|
| P2 | G2-20 | 跨页续排段落段前距策略缺失 | `paragraph-flow.ts:202-209,238-242` | 段落被断到新页时段前距语义未定义，页首既不忽略也不补偿 | `startNewPage` 后显式定义续排段前距策略 + 跨页 fixture | 0.5 天 |
| P3 | G2-21 | Home/End 定位当前行同样用精确浮点相等（与 G3-13 同源） | `text-editing-runtime.ts:1472-1476` | `moveSelectionToLineBoundary` 精确 `===` 匹配，浮点抖动会失败 | 与 G3-13 共用容差匹配辅助函数 | 并入 G3-13 |
| P4 | G2-22 | `expandWithBuffer` 每可见页线性 indexOf（与 G2-19 同源） | `viewport-virtualizer.ts:84-88` | 循环内 O(n) 反查页索引，整体 O(可见页×总页) | 用数组下标或预建 Map | 0.25 天 |

---

## R2 复审：订正/撤销的已有结论

1. **G3-18（订正，非撤销）**：`collectCommentThreadIds`/`findCommentThread` 有同名多副本，死代码范围仅限 `command-builders.ts:1276-1278` 与 `:1500-1502`；`comment-command-builders.ts` 的同名实现被大量调用，删除时不得误删。`allocateGeneratedCommentThreadId` 确为死代码。
2. **G3-31（行号订正）**：`aria-live="polite"` 硬编码在第 83 行（`configureLiveRegionHost`），`announce` 无 priority 分支在 36-50 行；原「行 32」不准确。
3. **G3-30（修复写法订正）**：live-region 为外部宿主绑定版，`options.host` 可能为 null，清文本需判空。
4. **G3-13（范围扩展）**：修复须同时覆盖 `moveSelectionToLineBoundary`（见新增 G2-21）。

---

## R2 复审：建议加入修复计划的条目

按建议 Phase 排序（依赖关系已标注）。

**Phase A — Alpha 阻断（必须最先修，P0）**

- **G3-01 Shift+方向键选区扩展**：为水平/垂直/行首尾移动增加 `extending` 参数，shiftKey 时保持 anchor 只移 focus。验证：新增 Vitest 覆盖 Shift+Left/Right/Up/Down/Home/End 的 anchor 稳定性 + 三浏览器 E2E 键盘选区。依赖：无。同时回写计划 Step 3.4 状态。
- **G3-02 Enter 带选区**：在 `splitParagraphFromRuntime` 内部对非折叠选区先删后分段，一次覆盖 keydown 与 beforeinput 两个入口。验证：Vitest「选区 + Enter → 内容删除并分段」+ Ctrl+A→Enter E2E。依赖：可复用现有 `deleteSelectedTextFromRuntime`。

**Phase B — 严重功能/内存（P1）**

- **G3-03 mouseup 注册到 document** + **G3-04 focus/blur 清理**：同属 `mount-facade-runtime` 事件生命周期，建议同一改动一并修，把 mouseup 移到 document 且 focus/blur 存入 mountedDom 并在 destroy 移除。验证：destroy 后监听器计数归零的单测 + 拖拽移出编辑器释放的 E2E。依赖：无。
- **G2-13 CanvasPool dispose**：新增 `dispose()` 清空 available/active 并把尺寸置 0，在 `mount-facade-runtime` destroy 中调用。验证：pool 单测断言 dispose 后 canvas 宽高为 0。依赖：无。可顺带修 G2-14 双重释放防护。
- **G3-05 输入错误不再静默**：catch 中加 `console.error` 并通过 editor event 暴露。验证：注入抛错 handler 的单测断言事件被发出。依赖：无。
- **G3-23 role="toolbar"** + **G3-20 修订多 run**：两者独立，可与 A11y 批次或修订批次并行。

**Phase C — 布局正确性（P1/P2，可与 Gate 4 并行）**

- **G2-01 Justify**、**G2-02 表格跨页**、**G2-03 widow/orphan**、**G2-20 跨页段前距**：均属排版语义，建议合并为一个「分页正确性」批次，共享跨页 fixture 与视觉基线。依赖：G2-02 与 G2-20 都改 `ensureLineFits`/`startNewPage` 路径，需同批以免冲突。

**Phase D — 性能热路径（服务 Step 3.13 的 P95<50ms）**

- **G2-05 O(n²) advance**、**GX-01 投影全量重建**、**GX-02 字体兼容全量探测**、**GX-03 byteLength 开销**：直接影响输入热路径 P95，建议在 Alpha 性能收口前处理。依赖：GX-02 可先做（改为哈希缓存，改动局部）。

**Phase E — A11y 与轻量清理（P2/P3）**

- G3-24~G3-27、G3-30~G3-32、G3-13/G2-21、死代码 G2-10/G2-16/G3-18、G2-22 等，可批量清理，无相互依赖。
