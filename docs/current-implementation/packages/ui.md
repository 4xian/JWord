# @4xian/jword-ui 当前实现摘要

## 包职责

`@4xian/jword-ui` 是官方原生 TypeScript + DOM UI SDK。它依赖 `@4xian/jword-core` 的公开 facade、command builders、projection 和 geometry，不持有第二套编辑状态。它负责 toolbar、底部状态栏、左右浮动工作区、Toast、面板、浮层、批注栏、链接弹窗、图片/表格工具、查找替换、目录、页眉页脚、修订面板、粘贴清洗、只读交互、主题/i18n、debug 日志和 a11y 辅助层。

## 入口与导出

- 包名：`@4xian/jword-ui`
- Export map：`.` 与 `./styles.css`。
- CSS side effect：`./dist/styles/toolbar.css`。
- 当前 manifest：`private: true`，`publishConfig.access: public`。
- 运行依赖：`@4xian/jword-core`、`dompurify`。

## 公开 API 摘要

根入口主要导出：

- `createJWordUi()`、`CreateJWordUiOptions`、`JWordUiInstance`、`JWordUiElements`。
- Toolbar 配置、内建 tool IDs、toolbar elements、插件 toolbar/menu 扩展类型；默认支持专业 Tab 与常用双模式。
- StatusBar 配置、item IDs、statusBar elements、缩放范围、主题/语言切换类型。
- 编辑器实例级页面水印配置 `JWordWatermarkOptions`，以及 `JWordUiInstance.setWatermark(...)` / `clearWatermark()` / `getWatermark()`。
- Theme/i18n contract：主题 token、默认主题 token、默认 i18n 字典、字典合并；支持 `setTheme(...)` / `setLocale(...)` 动态刷新 toolbar/statusBar。
- `JWordUiInstance.toast({ message, type, duration })` 顶部通知，以及 `debug: true | JWordDebugOptions` 实例级调试日志。
- Media/table 默认 core command adapter。
- Find/replace、header/footer、heading outline controller。
- Comments、link、revision、readonly、user、media、table options 与元素类型。
- Media/link URL policy。
- `@4xian/jword-ui/styles.css` 样式入口。

## 主要模块目录

- `assistive/`：live region、隐藏纯文本镜像。
- `debug/`：默认关闭的结构化 UI 调试日志和 console adapter。
- `toast/`：顶部单实例 Toast、定时关闭和 live-region 同步。
- `toolbar/`：内建工具注册、DOM、专业/常用模式、状态同步、格式/段落/插入/页面/视图/导出动作、插件扩展。
- `status-bar/`：底部状态栏 DOM、controller、mount 和状态统计。
- `watermark/`：编辑器实例级页面水印与内置版权水印 DOM controller。
- `comments/` 与 `comments-rail.ts`：批注 sidebar、状态、DOM、正文锚点 overlay。
- `find-replace/`：查找替换面板。
- `header-footer/`：页眉页脚/页码菜单。
- `heading/` 与 `heading-outline-setup.ts`：目录面板。
- `link/` 与 `link-overlay.ts`：链接弹窗、快捷工具、URL policy。
- `media/` 与 `media-setup.ts`：图片上传入口、URL 插入、图片选择/拖拽/resize overlay、core command adapter。
- `table/` 与 `table-setup.ts`：表格面板、表格选择、右键菜单、resize、core command adapter。
- `paste/`：DOMPurify HTML 清洗与粘贴 controller。
- `readonly/`：只读模式 DOM guard。
- `revisions/`：修订 metadata 面板。
- `selection-actions/`：选区浮动工具栏、右键菜单、剪贴板动作。
- 根级 helper：`ui-lifecycle.ts`、`theme.ts`、`i18n.ts`、`view-state.ts`、`ui-shell-layout.ts`、`text-projection.ts`、`selection-rebind.ts`、`ui-geometry.ts`。

## 已实现能力

### UI 装配

`createJWordUi()` 负责解析 toolbar/statusBar host、创建 live region/text mirror、应用主题、装配 toolbar/statusBar/media/table/comments/link/find-replace/header-footer/heading/revisions/selection-actions/paste/readonly，并返回 `elements`、`refresh()`、`destroy()`。未显式传 `statusBar: false` 时默认启用底部状态栏；未传 `toolbarHost` / `statusBar.host` 且已提供 `editorHost` 时，SDK 会形成 `toolbar / editor shell / statusBar` 三段式官方 UI 布局。

默认目录挂在 editor region 左侧浮动工作区，修订记录挂在右侧浮动工作区；两侧均使用绝对定位覆盖正文，不参与正文宽度计算。批注仍按每页 Canvas 创建 page rail，不使用右侧工作区。显式传入目录或修订 `host` 时，SDK 尊重外部宿主。

### Toast 与 debug 日志

- `JWordUiInstance.toast({ message, type, duration })` 同一时刻只显示一条顶部 Toast，新消息替换旧消息；`duration <= 0` 时不自动关闭。
- Toast 类型为 `info | success | warning | error`，并同步对应优先级的 live-region 播报。
- 无选区点击批注会显示当前语言的 warning Toast；其他高频 live-region 消息不会自动全部转换成 Toast。
- `debug` 默认关闭；`debug: true` 使用 console adapter，`debug: { enabled: true, logger }` 可由宿主接管结构化 entry。
- Debug 日志使用稳定 `scope` / `event`，不属于用户界面文案，不进入 i18n 字典。

### Toolbar

- 默认渲染专业 Tab ribbon：开始、插入、表格、页面、工具、视图、导出。
- 支持常用模式，`visibleTools` 旧配置兼容为常用工具列表。
- 图片和表格入口默认显示；`media` / `table` 配置用于覆盖适配器、命令或文案，不再是显示入口的前置条件。
- 页面 Tab 包含页面大小、页面方向、自定义页面、页眉页脚和页码入口；视图 Tab 包含适应宽度、适应整页、全屏、演示、还原、主题和语言入口；导出 Tab 提供原生 `.jword` 导出 seam。
- 工具 Tab 提供页面水印入口；支持设置多行水印内容、字体大小、字体颜色，并可清除用户水印。
- 订阅 editor selection/transaction/destroy 事件，同步按钮状态和 a11y 播报。
- 支持 hidden/visible tools 配置。
- 支持 plugin toolbar button 和 menu action 扩展。

### 底部状态栏与视图控制

- 默认显示品牌、字数、字符数、段落数、页码、选区统计、全屏、演示模式、缩放滑块、缩放百分比、100%、适应宽度、适应整页、主题和语言。
- `statusBar` 支持 `true | false | JWordStatusBarOptions`；`visibleItems` / `hiddenItems` 可控制显示项。
- `brand: false` 或 `brand.protection: 'hidden'` 隐藏版权；默认 `restore` 会在版权 DOM 被删除、隐藏或改写后恢复；`watermarkFallback` 会在多次篡改后挂载不可编辑的内置版权水印。
- 缩放范围为 20% - 400%，状态栏与 toolbar 共享 `view-state.ts`，统一处理缩放、适应宽度/整页、全屏和演示模式。
- 演示模式隐藏 toolbar/statusBar，仅保留编辑器内容；按 Esc 退出，鼠标靠近编辑器底部边缘时临时唤出状态栏。

### 图片与资源

- Media controller 调度宿主上传 adapter。
- 默认 command adapter 调用 core 图片 command builders。
- 支持行内插图、替换资源、调整大小、旋转、移动、删除。
- 默认 media URL policy 与 core 资源 URL policy 对齐。

### 表格 UI

- 默认 command adapter 调用 core 表格 command builders。
- 支持插入表格、增删行列、设置列宽/行高、边框 preset、单元格文本、合并右侧单元格。
- Controller 支持表格目标解析、右键菜单、resize overlay、选择同步。

### 批注/链接/修订

- Comments controller 管理批注侧栏状态、草稿、回复、编辑、resolve/reopen/delete，并与正文锚点 overlay 对齐。
- Link controller 管理链接插入/编辑/打开/删除 UI；打开链接走宿主回调，不直接打开窗口。
- Revisions controller 读取 projection revisions，支持定位、接受、拒绝。

### 查找替换、目录、页眉页脚

- Find/replace 调用 core 查找替换函数，结果可定位回 editor selection。
- Heading outline 基于 core `buildHeadingOutline()` 生成 Heading 1-3 目录。
- Header/footer controller 写 section 属性、header/footer IDs 和 page numbering。

### 粘贴、安全与只读

- `DOMPurify(window)` 清洗 text/html，最终输出 core `EditorRichTextFragment`。
- 常见文本格式、链接和表格标签可提取；表格粘贴按制表符文本降级并返回 warning。
- 只读 guard 阻断 beforeinput、input、paste、cut、drop、keydown、contextmenu、dblclick 等编辑入口，可禁用 toolbar，同时保留导航/复制/查找类入口。

### a11y、主题和 i18n

- Live region 去重播报，隐藏 text mirror 支持辅助读取。
- Theme 写 `jw-root`、`data-theme` 和 `--jw-*` CSS custom properties；内建主题切换首批只暴露 `light` / `dark`。
- i18n 合并宿主字典，缺省回退内建中文或调用点 fallback；状态栏语言切换首批只暴露 `zh-CN` / `en-US`。
- Toast、修订结果等本批用户可感知文案已接入中英文字典；其余历史直接中文播报仍按功能域分批迁移，不能视为全项目治理完成。
- `JWordUiInstance.setTheme(...)` / `setLocale(...)` 会刷新 toolbar、statusBar 和当前可见面板文案 / 样式。

### 页面水印

- `JWordUiInstance.setWatermark(...)` 会在 editor canvas container 内挂载用户水印层，内容支持换行。
- `getWatermark()` 返回规范化后的用户水印配置；无用户水印时返回 `null`。
- `clearWatermark()` 只清除用户水印，不清除状态栏版权保护触发的内置版权水印。
- 水印层使用 SVG background 重复绘制，`pointer-events: none`，不会接管输入、选区或滚动。
- 水印 controller 监听自身挂载容器；用户水印或版权水印被删除、隐藏时会 best-effort 恢复。

## 内部实现方案

- UI 不直接修改 projection；所有文档写入通过 core command builders 和 `editor.executeCommand()`。
- `create-ui.ts` 只做公开入口转发；`ui-lifecycle.ts` 做装配编排；具体 DOM/controller 分散到 focused 目录。
- 各 controller 使用 `AbortController` 或显式 destroy；`createJWordUi().destroy()` 统一清理订阅、面板、主题写入和 DOM。
- 图片上传、链接打开、部分批注持久化由宿主 adapter/回调提供；UI 只做状态、DOM 与 command dispatch。
- 清洗后的 HTML 不原样写回文档；最终写入 core 的是 paragraphs/runs/properties。
- 只读是 UI 层交互 guard，不改变 core transaction pipeline 本身。
- 主题只写 UI DOM 和 CSS custom properties，不进入 editor/document state。
- 格式命令后通过 `selection-rebind.ts` 按段落内 grapheme 位置重建选区，降低 run split 后旧 anchor 失效风险。

## 与其它包关系

- 直接依赖 `@4xian/jword-core` 和 `dompurify`。
- `react`、`vue` wrapper 通过 `createJWordUi()` 装配官方 DOM UI。
- `vanilla`、`collab`、`docx` 示例显式引入 `@4xian/jword-ui/styles.css` 并消费 UI。
- UI 的 media/table adapter 复用 core command builders；paste/link/media policy 复用 core 安全策略。

## 主要测试/验收入口

- `packages/ui/test/`
- `packages/ui/test/create-ui-toolbar.test.ts`
- `packages/ui/test/create-ui-status-bar.test.ts`
- `packages/ui/test/status-bar-state.test.ts`
- `packages/ui/test/create-ui-comments-link.test.ts`
- `packages/ui/test/create-ui-find-replace.test.ts`
- `packages/ui/test/create-ui-header-footer.test.ts`
- `packages/ui/test/create-ui-heading-outline.test.ts`
- `packages/ui/test/create-ui-paste-readonly.test.ts`
- `packages/ui/test/create-ui-revisions.test.ts`
- `packages/ui/test/create-ui-toast.test.ts`
- `packages/ui/test/create-ui-debug.test.ts`
- `packages/ui/test/media-command-adapter.test.ts`
- `packages/ui/test/paste-sanitizer.test.ts`
- `packages/ui/test/readonly-interaction-guard.test.ts`
- `packages/ui/test/selection-actions-controller.test.ts`
- `packages/ui/test/selection-rebind.test.ts`
- `packages/ui/test/theme-i18n.test.ts`
- `tests/architecture/gate7-theme-i18n.test.ts`
- `tests/architecture/gate7-free-quickstart.test.ts`
- `tests/architecture/gate7-public-api-docs.test.ts`
- `tests/types/gate7-public-api-entrypoints.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-ui typecheck`：校验 UI options、controller、主题/i18n 与公开类型。
- `pnpm --filter @4xian/jword-ui test`：运行 UI 包内 toolbar、paste、readonly、comments/link/media/table/theme 等单测。
- `pnpm --filter @4xian/jword-ui build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate7-theme-i18n.test.ts tests/architecture/gate7-free-quickstart.test.ts tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归主题/i18n、quickstart、公开文档和 API catalog。
- `pnpm test:types`：验证 UI 公开类型可被第三方 TypeScript 项目通过 package 名称消费。

## 当前限制/注意点

- 当前 manifest 仍是 `private: true`，不能据此宣称已完成 registry 发布。
- UI 是 DOM SDK，不是 React/Vue wrapper；React/Vue 包只是消费 UI。
- 默认 media 配置提供轻量本地图片插入能力：本地文件转 data URL，URL 插入仍受 URL policy 控制；真实上传、持久 URL 和资源治理仍应由宿主 adapter 提供。
- 只读模式是 UI 交互阻断，不是 core 事务权限系统；宿主仍需避免在只读场景主动调用写命令。
- 粘贴当前会把 table 降级为制表符文本并发 warning，不是完整表格对象粘贴。
- Header/footer controller 当前写 section 属性、页眉页脚 ID 和页码配置，不等同于完整页眉页脚正文编辑器。
- Revisions controller 显示 metadata 并执行接受/拒绝，不是完整 track-changes 引擎。
- i18n 当前内建重点覆盖中文与英文，不等同完整多语言包。
- Debug 日志仅供开发诊断；开启时宿主仍应避免把正文、选区内容、token 或完整 URL 写入自定义 details。
- 状态栏 MVP 不包含保存、协作、批注/修订汇总、企业治理、support bundle 或 AI 助手入口。

## 关键文件

- `packages/ui/package.json`
- `packages/ui/src/index.ts`
- `packages/ui/src/create-ui.ts`
- `packages/ui/src/ui-lifecycle.ts`
- `packages/ui/src/types.ts`
- `packages/ui/src/toolbar/`
- `packages/ui/src/status-bar/`
- `packages/ui/src/view-state.ts`
- `packages/ui/src/ui-shell-layout.ts`
- `packages/ui/src/side-workspace.ts`
- `packages/ui/src/ui-positioning.ts`
- `packages/ui/src/toast/`
- `packages/ui/src/debug/`
- `packages/ui/src/media/`
- `packages/ui/src/table/`
- `packages/ui/src/paste/sanitizer.ts`
- `packages/ui/src/readonly/interaction-guard.ts`
- `packages/ui/src/theme.ts`
- `packages/ui/src/i18n.ts`
- `packages/ui/src/styles/toolbar.css`
