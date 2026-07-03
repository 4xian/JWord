# Gate 4 代码审查报告

**审查日期**：2026-07-02
**审查范围**：Gate 4 -- 块级结构与企业文档基础能力
**审查人**：AI 代码审查员

---

## 一、总体评估

Gate 4 在架构层面交付质量 **优秀**。所有块级对象（图片、表格、批注、超链接、目录、查找替换、页眉页脚、页码、修订、保格式粘贴）均已实现基础闭环，且全部遵循 Gate 1 确立的核心不变式：**Y.Doc 是唯一可写状态，所有变更走同一 Transaction Pipeline**。代码分层清晰（core 框架无关、UI 纯 DOM），测试覆盖充分（36 个相关测试文件）。

但在若干模块中存在功能缺失和设计局限，需在后续 Gate 或 post-1.0 中补齐。

---

## 二、逐模块审查

### 2.1 图片资源管理

**文件**：`packages/core/src/resources/`（3 文件，304 行）、`packages/ui/src/media/`（6 文件，2402 行）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 资源管理器（上传/替换/失败恢复） | **通过** | `controller.ts` 的 `runUpload()` 完整实现上传、替换、错误恢复和 `retryToken` 重试令牌 |
| URL allowlist | **通过** | 双层校验：core `isAllowedResourceUrl()` 和 UI `isAllowedJWordMediaUrl()` 均拒绝 `javascript:`、`file:` 等危险协议。外部 http/https URL 默认拒绝，需宿主显式 `allowExternalUrl` 回调 |
| 8 点位缩放手柄 | **通过** | `image-selection-controller.ts` 完整实现 8 个方位：`top-left`、`top-center`、`top-right`、`middle-left`、`middle-right`、`bottom-left`、`bottom-center`、`bottom-right` |
| 旋转 | **通过** | 每次旋转 90 度，重置归 0 度，角度归一化到 0-359 |
| 拖拽 | **通过** | 支持拖拽到新位置，3px 激活阈值，显示半透明幽灵图和插入光标，通过 `moveSelectedImage` 进入 transaction pipeline |
| Transaction Pipeline 集成 | **通过** | 所有图片操作（插入、替换、缩放、旋转、移动、删除）均通过 `editor.executeCommand()` |

**发现的问题**：

1. **[低] 无上传取消 UI**：`AbortSignalLike` 类型已定义但无取消按钮
2. **[低] 无上传超时**：长时间上传无超时机制
3. **[低] 缩放不锁定纵横比**：所有手柄均允许自由变形，无 Shift 键约束
4. **[信息] `data:` URL 默认允许**：无大小限制，可能注入超大内联图片
5. **[信息] `canvas-image-resolver.ts` 未二次校验 source URL**：依赖上传流程的前置校验

---

### 2.2 表格系统

**文件**：`packages/core/src/operations/table-operation-adapter.ts`（622 行）、`packages/core/src/layout/engine.ts`（表格布局部分）、`packages/ui/src/table/`（5 文件，2564 行）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| gridSpan（横向合并） | **通过** | 模型、操作、布局、渲染全链路支持 |
| rowSpan（纵向合并） | **缺失** | 模型中无 `rowSpan` 字段；docx 导入遇到 `vMerge` 时降级处理并警告 |
| 跨页策略 | **缺失** | 当前为整表不分割：表格超出当前页底时整体移至下一页，无按行拆分逻辑。超过一页高度的表格会溢出 |
| 编辑走 Transaction Pipeline | **通过** | 9 种表格操作全部通过 Y.Doc transact |
| 表格选择 | **基本** | 支持单单元格点击定位，不支持行选择、列选择或多单元格拖选 |
| Undo/Redo | **通过** | 自动通过 Y.UndoManager 跟踪 |
| Hit-test | **通过** | 两级命中测试：布局层 + UI 层，空单元格有兜底 |

**发现的问题**：

1. **[高] 表格跨页拆分未实现**：`TableBox` 始终属于单个 `pageIndex`，大表格无法正确分页。这是企业文档的常见需求
2. **[中] 纵向合并未实现**：无 `rowSpan` 支持，复杂表格导入会丢失纵向合并结构
3. **[中] 多单元格选择未实现**：无行/列/范围选择模型

---

### 2.3 批注系统

**文件**：`packages/core/src/operations/comment-command-builders.ts`（264 行）、`packages/ui/src/comments/`（4 文件，2758 行）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 锚点稳定性（非字符 offset） | **通过** | 使用 `Y.RelativePosition` 快照，编辑不漂移 |
| 完整生命周期 | **通过** | 添加 -> 回复 -> 编辑 -> 解决 -> 重开 -> 删除，6 种操作全部实现 |
| 侧边栏 UI | **通过** | 完整侧边栏：线程列表、详情面板、回复编辑器、页内 rail 定位 |
| 文本编辑后锚点存活 | **通过** | `Y.RelativePosition` 自动跟踪并发编辑 |
| currentUser 集成 | **通过** | `authorId` 贯穿 core 和 UI，驱动权限判断 |
| Transaction Pipeline | **通过** | 6 种 operation 全部注册在 pipeline |
| Y.Doc 存储 | **通过** | 独立 `Y.Map` 容器：`comments` 和 `commentRanges` |

**发现的问题**：

1. **[中] Canvas 层批注高亮缺失**：`CommentRangeMarkerInline` 在 layout 中已处理，但 canvas renderer 无批注区域高亮绘制。DOM overlay 存在但仅用于锚点标记，未对正文选区着色
2. **[低] 模块级序列计数器**：`commentThreadSequence` 等模块级 `let` 变量在模块重载时重置，可能产生 ID 碰撞（仅影响开发环境热重载）

---

### 2.4 超链接

**文件**：`packages/core/src/links/policy.ts`（35 行）、`packages/core/src/operations/link-command-builders.ts`（376 行）、`packages/ui/src/link/`（5 文件）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 协议 allowlist（拒绝 javascript:） | **通过** | 双层实现：core 和 UI 均只允许 `http:`、`https:`、`mailto:`。`javascript:`、`data:`、`file:` 全部拒绝 |
| URL 校验 | **通过** | `new URL()` 解析 + 空值检查 + trim 归一化 |
| CRUD 完整性 | **通过** | 设置/插入/编辑/删除四种命令完备 |
| Transaction Pipeline | **通过** | 所有链接操作生成标准 `Command` 对象 |
| 编辑 UI | **通过** | 弹窗包含显示文本、URL、tooltip 输入，支持快捷工具栏（打开/编辑/删除） |

**发现的问题**：

1. **[低] 双重 allowlist 实现**：core 和 UI 各有独立的协议 allowlist 实现，可能在维护中产生不一致。UI 版本接受可配置 `allowedProtocols`，理论上可被宿主误用重新启用危险协议
2. **[低] 模块级序列计数器**：`generatedLinkRunSequence` 同上

---

### 2.5 目录/标题导航

**文件**：`packages/core/src/heading/outline.ts`、`packages/ui/src/heading/`（2 文件）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 标题级别检测 | **通过** | 识别 Heading1-3，递归扫描表格单元格 |
| 目录生成 | **通过** | `buildHeadingOutline(editor)` 生成结构化条目，含稳定锚点 |
| 标题导航 | **通过** | 点击跳转 + 滚动定位 + 视口滚动同步高亮 |
| 标题变化后更新 | **部分** | 每次 `refresh()` 重新读取 projection，但无自动订阅文档变更事件 |

**发现的问题**：

1. **[低] 无自动刷新**：目录不监听文档变更事件，需要宿主显式调用 `refresh()`（实际 `create-ui` 已在 transaction 事件中调用 `headingOutline?.refresh()`）

---

### 2.6 查找替换

**文件**：`packages/core/src/find-replace/find-replace.ts`（267 行）、`packages/ui/src/find-replace/`（3 文件）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 查找使用 Projection（只读） | **通过** | 从 `editor.getProjection()` 读取，不缓存副本 |
| 替换走 Transaction Pipeline | **通过** | 生成 `deleteRange` + `insertText` 命令，通过 `editor.executeCommand()` 执行 |
| 大小写不敏感搜索 | **缺失** | 始终大小写敏感，无切换选项 |
| 正则搜索 | **缺失** | 纯 grapheme 逐字匹配 |
| 全部替换 | **通过** | 逆序遍历匹配结果避免位置漂移 |
| 匹配计数和当前位置 | **通过** | 显示 `"n / total"` 格式，`aria-live` 无障碍 |
| 匹配高亮 | **通过** | DOM overlay 层标记匹配矩形，活动匹配有区分样式 |
| 跨 run 搜索 | **缺失** | 仅在单个 run 内搜索，跨 run 的文本无法匹配（已在头部注释中声明为 Gate 4 范围外） |
| 快捷键（Ctrl+F/H） | **缺失** | 无全局键盘快捷键绑定 |

**发现的问题**：

1. **[高] 无 Ctrl+F/Ctrl+H 快捷键**：用户只能通过工具栏按钮打开查找替换
2. **[中] 无大小写不敏感搜索**：企业文档常用功能缺失
3. **[中] 跨 run 搜索不支持**：加粗等格式化会拆分 run，导致格式化文本中的关键词搜索不到

---

### 2.7 页眉页脚 / 页码

**文件**：`packages/core/src/operations/section-command-builders.ts`（56 行）、`packages/core/src/layout/internal.ts`（页眉页脚布局）、`packages/core/src/canvas/renderer.ts`（页眉页脚渲染）、`packages/ui/src/header-footer/`（2 文件，646 行）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| Section 模型支持页眉页脚 | **通过** | `Section.headerIds`、`Section.footerIds`、`SectionPageNumbering` 均已定义 |
| 参与分页布局 | **通过** | `createHeaderFooterBoxes()` 在布局阶段为每页生成 `HeaderFooterBox`，占据 margin 区域 |
| 首页/奇偶页差异 | **缺失** | 无首页不同或奇偶页不同的概念，`headerFooterSameAsPrevious` 只控制是否继承前一节 |
| 页码插入 | **通过** | 支持 6 种位置（`top-left/center/right`、`bottom-left/center/right`），起始页码可配置 |
| 页眉页脚内容模型 | **基本** | `headerIds`/`footerIds` 仅为字符串标识数组，无富文本子文档模型。用户通过输入框填写标签文字，非 OOXML 的子文档（含段落/run）结构 |
| 页眉页脚编辑 | **基本** | 通过输入框设置字符串标识，不支持在 canvas 上直接内联编辑页眉页脚内容 |
| Canvas 渲染 | **通过** | `renderHeaderFooterBoxes()` 在每页绘制页眉页脚文本和页码 |

**发现的问题**：

1. **[中] 无富文本页眉页脚编辑**：当前页眉页脚只支持纯文本标识，不支持图片、格式化文本等内容
2. **[低] 无首页/奇偶页差异**：无法实现首页不同页眉或奇偶页不同页码

---

### 2.8 修订

**文件**：`packages/core/src/operations/revision-command-builders.ts`（103 行）、`packages/core/src/model/types.ts`（RevisionMetadata 定义）、`packages/ui/src/revisions/`（2 文件，232 行）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 记录 insert/delete/format | **通过** | `RevisionMetadata.type` 支持 `'insert' | 'delete' | 'format'` 三种类型 |
| 作者和时间戳 | **通过** | `authorId` + `createdAt` 字段完备 |
| 接受/拒绝 | **缺失** | 当前只能创建修订 metadata，无接受或拒绝流程（文件头部明确声明不实现） |
| 修订面板 | **通过** | 列表显示修订条目，点击定位到对应选区 |
| currentUser 集成 | **通过** | `authorId` 从 `AddRevisionMetadataInput` 传入 |
| Y.Doc 存储 | **通过** | 独立 `Y.Map` 容器：`revisions`，修订 ID 同步到 run 和 block 级别 |

**发现的问题**：

1. **[中] 无接受/拒绝流程**：修订 metadata 只能添加和查看，不能接受或拒绝。这是修订追踪的核心交互，当前实现等同于标记
2. **[低] 修订只标记第一个选区 run**：`buildAddRevisionMetadataCommand` 只取 `collectSelectionTargets().runs[0]`，多 run 选区只标记首个

---

### 2.9 保格式粘贴

**文件**：`packages/ui/src/paste/sanitizer.ts`、`packages/ui/src/paste/controller.ts`

| 审查项 | 结论 | 说明 |
|--------|------|------|
| DOMPurify 使用 | **通过** | 正确调用 `DOMPurify(window).sanitize(html, config)` |
| XSS 防护 | **通过（依据已订正）** | `FORBID_TAGS` 包含 `script`、`iframe`、`object`、`embed`、`img`、`svg`；`FORBID_ATTR` 包含 `onclick`、`onerror`、`onload`；不允许 `data-*` 属性；真实安全依据是清洗后只提取结构化文本与白名单格式，HTML/CSS 不回插 |
| Transaction Pipeline | **通过** | `editor.pasteRichTextFragment(fragment)` 走标准事务管线 |
| 格式保留 | **通过** | 保留粗体、斜体、下划线、删除线、颜色、背景色、字体、字号、对齐、列表结构 |
| 允许/阻止的元素 | 合理 | 允许：`b, br, div, em, i, li, ol, p, s, span, strike, strong, u, ul`；阻止：`script, style, iframe, object, embed, img, svg, math` 及所有其他标签 |

**发现的问题**：无严重 XSS 漏洞，但首轮结论理由不准确。

1. **（R2 订正）首轮关于 CSS `url()` 被过滤的表述无代码依据**：复核 `packages/ui/src/paste/sanitizer.ts:39-60`，实际配置为 `ALLOWED_ATTR: ['class', 'style']`（**允许 style 属性通过**），`FORBID_ATTR: ['onclick', 'onerror', 'onload', 'style-src']`——其中 `'style-src'` 并不是任何 HTML 属性名，是无效配置，代码中**没有任何显式拒绝 CSS `url()` 的逻辑**。因此把粘贴 XSS 结论建立在 CSS 过滤上找不到实现支撑。
2. **（R2 复审补充）XSS 防护的真实机制是"只提取结构化文本"而非 CSS 过滤**：`collectRichTextRuns`（`sanitizer.ts:106-133`）只从清洗后的 DOM 读取 `textContent` 与经 `mergeInlineStyle` 解析出的 bold/color 等格式，转成 core 富文本 run 交给 `editor.pasteRichTextFragment`；清洗后的 HTML/CSS 字符串**永远不会被原样插回文档**，core 消费的是结构化 run 而非 HTML。因此即便 `style` 属性含 `url()`/`expression()`，也不会被浏览器当 CSS 执行——XSS 防护结论仍成立，但依据应更正为"输出侧只承载结构化文本 + 白名单格式属性"，而不是"CSS 值拒绝 url()"。建议同时删除无效的 `'style-src'` FORBID_ATTR 项，避免误导后续维护者以为已做 CSS 净化。
3. **（R3 子代理复审补充）link/table paste 仍未闭环**：Gate 4 Step 4.15 计划要求简单表格、链接 allowlist 与 jsdom 覆盖链接/表格；当前 `packages/ui/src/paste/sanitizer.ts` 的 allowlist 没有 `a/table/tr/td/th`，`ALLOWED_ATTR` 没有 `href`，`BLOCK_SELECTOR` 也只有 `p, div, li`；`RichTextFragment` 只有 paragraphs/runs，测试未覆盖 link/table paste。实际粘贴会丢 href 与表格结构，不能宣称 DOMPurify 粘贴完整实施。

---

### 2.10 全局只读模式

**文件**：`packages/ui/src/readonly/interaction-guard.ts`

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 完整阻止编辑 | **通过** | 在 capture 阶段拦截 `beforeinput`、`input`、`paste`、`cut`、`drop`、`keydown`、`mousedown`、`contextmenu`、`dblclick`，执行 `preventDefault()` + `stopImmediatePropagation()` |
| 工具栏禁用 | **通过** | 工具栏隐藏或禁用，导航工具（查找替换、目录）可选保留 |
| 选择仍可用 | **部分** | `mousedown` 被拦截导致鼠标选择文本不可用；程序化 `setSelection()` 不受限 |
| 运行时切换 | **不支持** | `enabled` 在创建时固化为闭包常量，切换需销毁重建 UI |
| 键盘快捷键阻止 | **通过** | `keydown` 在 capture 阶段被拦截 |
| hidden textarea | **通过** | 设置 `readOnly = true` 和 `aria-readonly` |

**发现的问题**：

1. **[中] 只读模式下无法鼠标选择文本**：`mousedown` 被阻止导致用户无法选择文本进行复制
2. **[低] 不支持运行时切换**：需要销毁重建 UI
3. **[设计说明] Core 无只读概念**：只读仅在 UI 层实施，直接调用 `editor.executeCommand()` 仍可写入

---

### 2.11 选区浮动工具栏

**文件**：`packages/ui/src/selection-actions/`（4 文件）

| 审查项 | 结论 | 说明 |
|--------|------|------|
| 选区浮动工具栏 | **通过** | 非折叠选区时在选区上方居中显示 |
| 可用操作 | **部分** | 链接操作可见；**格式按钮（加粗/斜体/下划线/删除线/颜色）始终被隐藏** |
| 右键菜单 | **通过** | 剪切/复制/粘贴/清除格式/链接/批注 |
| 定位正确性 | **通过** | 基于 `editor.getSelectionRects()` 定位，边界裁剪到 editorHost 内 |

**发现的问题**：

1. **[BUG] 浮动工具栏格式按钮始终隐藏**：`dom.ts` 中 `syncLinkActionVisibility()` 无条件将 `bold`、`italic`、`underline`、`strike`、`textColor`、`backgroundColor` 按钮的 `hidden` 属性设为 `true`。按钮存在于 DOM 中且状态正确设置，但始终不可见。浮动工具栏事实上只显示链接相关操作

---

### 2.12 用户身份（currentUser）统一性

| 模块 | 是否集成 | 说明 |
|------|----------|------|
| Editor facade | 是 | `EditorOptions.currentUser`、`Editor.getCurrentUser()` |
| 批注 | 是 | `authorId` 驱动创建/回复/权限 |
| 修订 | 是 | `authorId` 记录修订作者 |
| 协同 | 是 | `authorId` 进入 transaction metadata |
| UI 层 | 是 | `resolveCurrentUiUser()` 统一回退到 core editor user |

**结论**：**通过**。`currentUser` 身份从 core 到 UI 统一贯穿，`authorId` 是主键。

---

## 三、Gate 4 验收条件对照

| 验收条件（来自规范） | 状态 | 说明 |
|----------------------|------|------|
| 表格内文本编辑与 undo/redo 正确 | **通过** | 单元格文本编辑通过 transaction pipeline，undo/redo 由 Y.UndoManager 自动覆盖 |
| 图片上传成功可替换资源，失败可恢复 | **通过** | 上传、替换、错误恢复和 retryToken 完备 |
| 批注 anchor 在文本编辑后仍定位正确 | **通过** | Y.RelativePosition 实现，编辑不漂移 |
| 粘贴 HTML 不产生 XSS | **部分通过** | DOMPurify + 结构化 fragment 输出可防 XSS；但 link/table paste 未闭环，且不能把安全依据写成 CSS 层显式过滤 |

| 禁止条件（来自规范） | 状态 | 说明 |
|---------------------|------|------|
| 图片 URL 直接信任外部输入 | **未违反** | 双层 URL allowlist，外部 URL 默认拒绝 |
| 批注使用不稳定字符 offset | **未违反** | 使用 Y.RelativePosition 锚点 |

---

## 四、风险矩阵

| 严重度 | 模块 | 问题 |
|--------|------|------|
| **高** | 表格 | 无跨页拆分，大表格溢出页面 |
| **高** | 查找替换 | 无 Ctrl+F/Ctrl+H 快捷键 |
| **BUG** | 浮动工具栏 | 格式按钮（粗体/斜体等）始终隐藏 |
| **中** | 表格 | 无纵向合并（rowSpan） |
| **中** | 表格 | 无多单元格范围选择 |
| **中** | 查找替换 | 无大小写不敏感搜索 |
| **中** | 查找替换 | 跨 run 搜索不支持 |
| **中** | 修订 | 无接受/拒绝流程 |
| **中** | 页眉页脚 | 无富文本编辑 |
| **中** | 只读 | 鼠标选择文本被阻止，无法复制 |
| **中** | 批注 | Canvas 层无批注区域高亮绘制 |
| **低** | 图片 | 无上传取消/超时 |
| **低** | 图片 | 缩放不锁定纵横比 |
| **低** | 超链接 | core 和 UI 双重 allowlist 实现可能不一致 |
| **低** | 修订 | 只标记首个 run |
| **低** | 页眉页脚 | 无首页/奇偶页差异 |
| **低** | 只读 | 不支持运行时切换 |

### R2 复审补充与订正

| 严重度 | 模块 | 问题 | 状态 |
|--------|------|------|------|
| **低（R2 复审补充）** | 修订 | `buildAddRevisionMetadataCommand`（`packages/core/src/operations/revision-command-builders.ts:39,49,63-64`）的 `rangeSnapshot` 保存了**完整选区**，但 `revisionId` 只写入 `collectSelectionTargets(...).runs[0]`。多 run 选区的修订：定位（依赖 rangeSnapshot）完整、但 run 级 `revisionId` 标记只落在首个 run，若可见化依赖 run 级标记则只有首 run 显示。这是首轮"低：只标记首个 run"发现的更精确根因，确认属实，严重度维持低（定位不受影响）。 | 属实 |
| **信息（R2 订正）** | 保格式粘贴 | 首轮关于 CSS `url()` 被过滤的表述无代码依据；XSS 防护实际靠"输出侧只承载结构化文本"实现，详见 2.9 订正条目。 | 订正 |

**已核实的首轮 BUG/高级发现（R2 结论）**：


### R3 子代理复审补充与订正（2026-07-02）

- **新增 P2**：DOMPurify 粘贴缺 link/table 闭环。计划要求 link allowlist 与简单表格粘贴，当前 sanitizer allowlist 与 fragment 类型均不支持，测试也未覆盖。修复时应复用 core link allowlist，表格转 core table commands；若不做完整实现，应输出稳定 warning 并更新计划口径。
- **订正**：目录“无自动刷新”应降级为 standalone controller 使用说明。官方 `createJWordUi` 已在 transaction 事件中调用 `headingOutline?.refresh()`，手动 `refresh()` 也会调用；裸 controller 不自带订阅，但官方装配路径已自动刷新。
- **订正**：Gate 4 并非没有 Playwright e2e；已有 `gate4-media/table/comments-link/header-footer/structure-find/revisions/paste-mobile/readonly/selection-actions/perf/visual` 等 Gate 4 e2e/perf/visual 文件。测试缺口应收窄到未覆盖能力和 flaky/baseline 问题。
- **订正**：验收表中把安全依据写成 CSS 层显式过滤是错误口径；真实依据是 sanitizer 结果只被转换为结构化文本/格式 fragment，HTML/CSS 不回插 DOM。

- **浮动工具栏格式按钮始终隐藏（BUG）— 属实**：`packages/ui/src/selection-actions/dom.ts:172-178` `syncLinkActionVisibility` 无条件 `dom.formatControls.bold/italic/underline/strike.hidden = true`，且 `dom.ts:26` 初始化也整体隐藏 `floatingToolbar`。
- **表格无跨页拆分（高）— 属实**（TableBox 属单一 pageIndex）。
- **查找替换无 Ctrl+F/Ctrl+H（高）— 属实**。

---

## 五、架构亮点

1. **Transaction Pipeline 一致性**：所有 Gate 4 模块的写入操作（图片、表格、批注、链接、页眉页脚、修订）均严格通过 `editor.executeCommand()` -> `TransactionPipeline.run()` -> `ydoc.transact(origin)` 路径，无旁路
2. **Y.RelativePosition 锚点**：批注系统使用 Yjs 原生的相对位置机制，是 CRDT 环境下位置稳定性的最佳实践
3. **安全纵深**：图片 URL、链接协议、粘贴 HTML 均有多层安全校验；粘贴路径的真实 XSS 防护来自结构化输出，不是完整 CSS sanitizer
4. **Operation 可序列化**：所有操作的输入和输出均为 JSON 兼容纯数据，支持 fixture 回放和远端传输
5. **core/UI 分离**：core 包无 DOM 依赖，UI 包纯 DOM 操作无框架绑定，边界清晰

---

## 六、建议优先级

### 建议立即修复（Gate 4 交付前）

1. **修复浮动工具栏格式按钮隐藏 BUG**：`selection-actions/dom.ts` 中 `syncLinkActionVisibility()` 应根据链接状态有条件地显示/隐藏格式按钮
2. **添加 Ctrl+F/Ctrl+H 快捷键**：在 keyboard handler 中注册全局快捷键打开查找替换面板
3. **只读模式允许鼠标选择**：将 `mousedown` 从阻止列表中移除或改为只阻止编辑相关的鼠标操作

### 建议 Gate 5-7 补齐

4. 表格跨页拆分（按行分割）
5. 查找替换大小写不敏感选项
6. 修订接受/拒绝流程
7. 批注 Canvas 高亮绘制
8. 页眉页脚富文本编辑

### 建议 post-1.0

9. 表格纵向合并（rowSpan）
10. 多单元格范围选择
11. 查找替换跨 run 搜索和正则
12. 首页/奇偶页页眉页脚差异

---

## 七、测试覆盖概览

Gate 4 相关测试文件共 36 个，涵盖 core operations（5 个）、core layout（2 个）、core 其他（2 个）、UI controllers/state/dom（27 个）。核心操作均有 command builder 和 operation adapter 层面的测试。UI 测试覆盖 controller 逻辑、DOM 输出和集成流程。

**测试覆盖订正（R3 子代理复审）**：Gate 4 已有 Playwright 覆盖。`examples/vanilla/tests` 已存在 `gate4-media/table/comments-link/header-footer/structure-find/revisions/paste-mobile/readonly/selection-actions/perf/visual` 等 Gate 4 e2e/perf/visual 文件。真实缺口应收窄为 link/table paste、表格跨页拆分、多单元格选择、部分视觉 baseline 与跨浏览器稳定性，而不是 Gate 4 全无浏览器覆盖。
