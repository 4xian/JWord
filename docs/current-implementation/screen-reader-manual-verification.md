# 屏幕阅读器人工验证手册

> 快照日期：2026-07-07。本文记录当前 JWord Web 编辑器的人工读屏验证方法。自动化 axe-core 与键盘 smoke 只能发现结构性问题，不能替代真实屏幕阅读器朗读验证。

## 当前实现入口

- 自动化 a11y：`tests/e2e/a11y-axe.ts`、`examples/vanilla/tests/gate4-a11y.e2e.ts`、`examples/collab/tests/collab-a11y.e2e.ts`。
- UI live region：`packages/ui/src/assistive/live-region.ts`。阻断、错误类文案会写入 `role="status"`，并在 `BLOCKED:`、失败、错误场景使用 `aria-live="assertive"`。
- UI text mirror：`packages/ui/src/assistive/text-mirror.ts`。用于维护隐藏纯文本镜像，避免 canvas-only 内容完全不可读。
- core mounted assistive DOM：`packages/core/src/editor/mounted-runtime.ts`、`packages/core/src/editor/dom.ts`。负责同步隐藏 textarea、文本镜像和 caret 位置。
- UI 状态播报：`packages/ui/src/ui-lifecycle.ts`。只读阻断、批注侧栏缺失、链接弹窗缺失等状态通过 `announceUiMessage()` 进入 live region。

## 最小验证矩阵

| 环境 | 浏览器 | 屏幕阅读器 | 状态 |
| --- | --- | --- | --- |
| macOS | Safari | VoiceOver | 必测 |
| macOS | Chrome | VoiceOver | 建议测 |
| Windows | Edge 或 Chrome | NVDA | 必测 |
| Windows | Edge 或 Chrome | JAWS | 可选，有授权环境时再测 |

通过前不得把 VoiceOver、NVDA 或 JAWS 写成已完成兼容；没有对应机器时记录 `not-run`，不要补假证据。

## 启动待测 demo

### vanilla 主路径

```bash
pnpm --filter @4xian/jword-example-vanilla dev
```

打开终端输出的本地地址，优先验证 vanilla，因为它覆盖 core、ui、native、devtools 的常规编辑路径。

### collab 协作路径

```bash
pnpm --filter @4xian/jword-example-collab dev:server
pnpm --filter @4xian/jword-example-collab dev
```

协作路径只验证 presence、远端光标、状态面板和服务端连接提示，不要求在本条中验证复杂并发。

## 通用记录模板

每次验证记录以下字段：

```md
- 日期：YYYY-MM-DD
- 操作系统与版本：
- 浏览器与版本：
- 屏幕阅读器与版本：
- demo 地址：
- 验证场景：
- 操作步骤：
- 期望朗读：
- 实际朗读：
- 结果：pass / fail / needs-fix / not-run
- 证据：截图、录屏路径或文字备注
- 后续 issue：
```

## macOS VoiceOver 操作参考

- 开关 VoiceOver：`Command + F5`，或支持 Touch ID 的设备三击 Touch ID。
- 焦点移动：`Tab` / `Shift + Tab`。
- VoiceOver 导航：`Control + Option + →` / `Control + Option + ←`。
- 激活当前项：`Control + Option + Space`。
- 打开 rotor：`Control + Option + U`，检查按钮、表单项、地标和标题是否可被列出。
- 记录实际朗读时，按屏幕阅读器输出原样摘要，不要只写“正常”。

## Windows NVDA 操作参考

- 启动 NVDA 后使用 Edge 或 Chrome 打开 demo。
- 焦点移动：`Tab` / `Shift + Tab`。
- 元素列表：`NVDA + F7`，检查按钮、表单项、标题是否有可理解名称。
- 浏览模式与焦点模式切换按 NVDA 默认策略处理；如果编辑区不能输入，先确认是否处于焦点模式。
- 记录 NVDA 朗读文本、是否重复播报、是否丢失状态。

## 必测场景

### 1. 进入编辑器与正文输入

1. 刷新 demo 页面。
2. 只用键盘 Tab 到编辑器或编辑器附近的首个可聚焦项。
3. 进入正文，输入一段中文和英文混排文本。
4. 使用方向键移动 caret。

期望：能理解当前位置是 JWord 编辑区域或正文输入区域；输入后不会出现阻断操作的重复播报；caret 移动不会导致整篇文档反复朗读。

### 2. 工具栏按钮和状态

1. Tab 到加粗、斜体、下划线、对齐、列表、插入表格等按钮。
2. 激活加粗，再回到正文输入文本。
3. 再次聚焦加粗按钮。

期望：按钮名称可理解；按钮角色清晰；可切换按钮能表达 pressed/selected 状态；无空名称按钮。

### 3. 批注流程

1. 选中正文中的一段文字。
2. 使用批注入口新建批注。
3. 在批注输入框填写文字。
4. 在正文锚点和批注侧栏之间切换。

期望：批注入口、批注输入框、提交/关闭按钮名称可理解；未选中文本时的阻断提示能被 live region 朗读；批注定位不会丢失键盘焦点。

### 4. 查找替换

1. 打开查找替换面板。
2. 输入关键词。
3. 使用上一条/下一条。
4. 修改替换文本并触发替换。

期望：查找输入、替换输入、结果数量、上一条/下一条按钮均可朗读；没有结果时有明确状态提示。

### 5. 表格与媒体入口

1. 打开插入表格入口。
2. 调整行列数或使用默认插入。
3. Tab 到表格相关操作按钮。
4. 如 demo 暴露图片入口，聚焦图片插入按钮和 URL/文件输入。

期望：表格尺寸输入有 label；插入按钮名称清晰；错误 URL 或不允许资源时能朗读阻断原因。

### 6. 只读模式

1. 在 demo 中切换只读状态。
2. 尝试输入、插入链接或新增批注。
3. 聚焦工具栏按钮。

期望：不可执行操作有 `BLOCKED:` 类状态提示；禁用按钮状态可辨识；只读不是静默失败。

### 7. 修订、链接和选择浮层

1. 打开链接弹窗，输入 URL，保存。
2. 聚焦已插入链接并打开链接相关操作。
3. 如果 demo 暴露修订入口，切换修订状态并执行一次文本修改。

期望：链接 URL 输入有名称；打开、编辑、删除链接入口可朗读；修订状态可理解；选择浮层不抢走无法恢复的焦点。

### 8. 协作 presence

1. 启动 collab demo 和本地 server。
2. 打开两个浏览器窗口或两个独立页面。
3. 在其中一个页面输入，另一个页面观察远端用户状态和光标。

期望：连接状态、用户标记、远端 presence 文本可理解；远端光标不应造成连续噪音播报。

## 判定标准

- `pass`：关键控件名称、角色、状态可理解；流程可只用键盘完成；没有阻断性重复播报。
- `needs-fix`：流程大体可走通，但存在空名称、状态缺失、重复播报或焦点顺序问题。
- `fail`：无法进入正文、无法完成关键流程、屏幕阅读器无法理解主要控件，或出现持续打断操作的播报。
- `not-run`：缺少对应 OS、浏览器、屏幕阅读器或授权环境。

## 失败处理

- 严重阻断必须新建独立 backlog/issue，并记录复现环境、步骤、实际朗读和证据。
- 只修文案或 aria 属性前，先用同一屏幕阅读器复现；修复后用同一环境回归。
- 不把 axe-core 通过、Playwright 通过或 DOM snapshot 通过写成屏幕阅读器通过。
