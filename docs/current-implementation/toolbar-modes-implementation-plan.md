# 顶部工具栏双模式实施方案

> 快照日期：2026-07-09。本文描述当前 `@4xian/jword-ui` 顶部工具栏从单行工具条演进为“专业多 Tab / 常用可配置”双模式的实施方案。实现必须复用现有 toolbar controller、命令绑定、readonly、i18n、theme、插件菜单和扩展面板，不维护第二套工具栏逻辑。

## 目标

- 默认工具栏切换为专业模式：顶部 Tab + 下方 ribbon 工具区。
- 支持常用模式：只展示一组常用工具，并允许宿主配置显示顺序和隐藏项。
- 专业模式提供模式切换按钮，可在专业 / 常用之间切换展示，不销毁 editor，不重建整套 UI。
- 当前已有内建工具按 Tab 分类，media/table/page/view/export 的官方入口默认显示，不要求宿主额外传入入口；图片未传宿主适配器时使用内建轻量适配器，本地文件转 data URL，URL 仍按 `urlPolicy` 校验。
- `media` / `table` 选项只用于宿主覆盖上传、命令适配器或标题文案，不是显示图片和表格入口的前置条件；`createJWordUi({ editor, editorHost })` 默认就应该有图片和表格入口。
- 所有可见文案、tooltip、aria、live region 和新样式必须同步覆盖 `zh-CN` / `en-US` 与亮色 / 暗色主题。

## 非目标

- 不引入第二套 editor 或移动端工具栏概念；窄屏只保证工具栏可滚动、不遮挡正文。
- 不把文档保存状态放入顶部工具栏；后续统一进入底部状态栏或宿主状态区。
- 不在 UI 包内直接依赖 `@4xian/jword-native`；导出原生格式入口只派发宿主可接管事件或给出未配置提示。
- 不把参考图中尚未存在的完整音视频、分栏、水印、复杂表格样式一次性补齐；先把现有能力按参考图分类和样式展示。

## 公开配置草案

```ts
export type JWordToolbarMode = 'professional' | 'common'

export type JWordToolbarTabId =
  | 'home'
  | 'insert'
  | 'table'
  | 'page'
  | 'tools'
  | 'view'
  | 'export'

export interface JWordToolbarOptions {
  readonly mode?: JWordToolbarMode
  readonly modeSwitcher?: boolean
  readonly common?: {
    readonly visibleTools?: readonly JWordToolbarToolId[]
    readonly hiddenTools?: readonly JWordToolbarToolId[]
  }
  readonly professional?: {
    readonly defaultTab?: JWordToolbarTabId
    readonly hiddenTabs?: readonly JWordToolbarTabId[]
    readonly tabTools?: Partial<Record<JWordToolbarTabId, readonly JWordToolbarToolId[]>>
  }
  readonly visibleTools?: readonly JWordToolbarToolId[]
  readonly hiddenTools?: readonly JWordToolbarToolId[]
}
```

兼容规则：

- 未传 `toolbar` 时默认 `professional`。
- 旧用法只传 `visibleTools` 时默认视为 `common`，保持只渲染声明工具。
- 旧用法只传 `visibleTools` 或 `common.visibleTools` 时保持严格声明语义，常用模式不额外插入 media/table 扩展入口。
- `hiddenTools` 对专业和常用模式都生效。
- `common.visibleTools` 优先于旧 `visibleTools`。
- `professional.tabTools` 只覆盖指定 Tab；未覆盖 Tab 使用内建默认分类。

## 默认 Tab 分类

| Tab | 内建工具 |
| --- | --- |
| 开始 `home` | `history.undo`、`history.redo`、`paragraph.style`、`format.fontFamily`、`format.fontSize`、字号增减、加粗/斜体/下划线/删除线、上下标、文字颜色、背景色、对齐、列表、缩进、行距、段前/段后、首行/悬挂缩进 |
| 插入 `insert` | `insert.link`、`insert.comment`、图片入口（media controller，默认显示；未传上传 adapter 时使用内建轻量适配器） |
| 表格 `table` | 插入表格、插入行/列、删除行/列、合并右侧等表格 controller 现有操作 |
| 页面 `page` | `document.pagePreset`、`document.pageOrientation`、`document.customPageSize`、`document.headerFooter`、`document.footer`、`document.pageNumber` |
| 工具 `tools` | `document.findReplace`、`document.headingOutline`、`document.revisions` |
| 视图 `view` | `view.fitWidth`、`view.fitPage`、`view.fullscreen`、`view.presentation`、`view.zoomReset`、`view.theme`、`view.locale` |
| 导出 `export` | `export.native`，默认显示原生 `.jword` 导出入口；UI 不直连 native 包，宿主可监听导出事件接管 |

## 默认常用工具

```ts
[
  'history.undo',
  'history.redo',
  'paragraph.style',
  'format.fontFamily',
  'format.fontSize',
  'format.bold',
  'format.italic',
  'format.underline',
  'format.textColor',
  'format.backgroundColor',
  'paragraph.alignment',
  'paragraph.list',
  'insert.link',
  'insert.comment',
  'document.findReplace'
]
```

## 实施步骤

### 阶段 A：配置模型与文档

- 扩展 toolbar options 类型。
- `resolveToolbarConfig()` 输出 mode、modeSwitcher、tabs、commonToolIds 和 toolIds。
- 补本文档、README 索引和 backlog 条目。
- 单测覆盖默认专业模式、旧 `visibleTools` 兼容、常用工具配置、隐藏 Tab / 工具。

### 阶段 B：专业模式 Tab DOM

- `createToolbarDom()` 渲染 tablist、tabpanel 和现有控件。
- 保留现有 `data-jword-tool-id`、tooltip、roving tabindex 和 state sync。
- Tab 切换只改 DOM 显隐和 aria 状态，不重建 editor/controller。
- 补亮色/暗色主题样式和窄屏横向滚动。

### 阶段 C：常用模式与切换按钮

- 渲染固定在 `.jw-toolbar` 右侧的模式选择器，按钮采用图标 + 文案 + 下拉箭头。
- 点击模式选择器只展开专业 / 常用下拉项；选中下拉项后再切换模式，并高亮当前模式。
- 切到常用模式时隐藏 `.jw-toolbar__top-row` 和 Tab，只展示 `commonToolIds` 对应工具。
- 切回专业模式时恢复 Tab 和当前 active tab。
- 切换时写入 live region。

### 阶段 D：扩展入口迁移与参考图分类收口

- 为 media/table/panel/plugin extension host 增加稳定 Tab 扩展槽位，`renderCurrentToolbarLayout()` 只重排内建工具，不清空扩展槽位。
- 插入 Tab 默认承接图片入口；表格 Tab 默认承接插入表格和行/列/删除/合并等现有表格操作。
- 非 `home` Tab 采用参考图 ribbon 大按钮样式：上方图标、下方 label；`home` Tab 继续保持紧凑单图标/字段工具条。
- 模式选择器作为 `.jw-toolbar` 直接子级绝对定位在右侧；专业模式垂直居中于 Tab 行，常用模式隐藏 `.jw-toolbar__top-row` 后垂直居中于常用工具条右侧；窄屏时 Tab 区域横向滚动，右侧模式选择器仍固定可见。
- 常用模式切换时复用同一份 media/table controller DOM；图片和插入表格入口移动到常用面板扩展槽，不创建第二套上传/表格逻辑。

### 阶段 E：页面、视图与导出官方入口

- 页面 Tab 显式提供页面大小、页面方向和自定义页面大小入口；自定义页面复用现有弹窗，切换预设时恢复对应预设默认边距。
- 视图 Tab 显式提供适应宽度、适应整页、全屏、演示、还原 100%、主题和语言入口；主题/语言仍调用同一套 UI 主题与 i18n 切换逻辑。
- 导出 Tab 显式提供原生 `.jword` 导出入口；UI 层派发宿主可接管事件，不新增 native 包依赖。
- 所有新增可见文案、tooltip、aria、下拉项和 live region 需同步补齐 `zh-CN` / `en-US`，所有新增样式需覆盖亮色/暗色主题。

### 阶段 F：E2E 和发布前验证

- Vanilla focused E2E 覆盖默认专业模式、Tab 切换、常用模式切换、页面 Tab 自定义纸张。
- 回归 `theme-i18n`，确认英文与暗色主题下 Tab、按钮、tooltip、弹窗均同步。
- 发布前跑 typecheck、UI 单测、toolbar focused E2E。

## 首轮验收标准

- 默认 `createJWordUi({ editor, editorHost })` 生成专业 Tab 工具栏。
- 点击 `开始 / 页面 / 工具` 等 Tab 会切换对应工具区域。
- 专业模式右侧切换按钮可切到常用模式并再切回专业模式。
- `toolbar: { mode: 'common', common: { visibleTools } }` 只展示声明的常用工具。
- `setLocale('en-US')` 后 Tab、模式切换、tooltip 文案切到英文。
- `setTheme({ name: 'dark' })` 后 Tab、ribbon、常用模式按钮使用暗色 token。

## 首轮实施记录

- 2026-07-08：阶段 A-C 已落地到 `packages/ui`。默认 toolbar 解析为 `professional`，旧 `visibleTools` 兼容为 `common`。
- 2026-07-08：`createToolbarDom()` 已支持 Tab、tabpanel、常用模式面板和模式切换按钮；控件节点在专业 / 常用布局间移动，不复制第二套 controller。
- 2026-07-08：新增 Tab / 模式切换中英文文案、live region 播报和亮暗主题样式；窄屏下 toolbar tab 与 ribbon 支持横向滚动。
- 2026-07-08：已通过 focused 验证：
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-controller.test.ts --root .`
  - `pnpm exec tsc --noEmit -p tsconfig.json`
  - `pnpm exec eslint packages/ui/src/types.ts packages/ui/src/i18n.ts packages/ui/src/toolbar/config.ts packages/ui/src/toolbar/dom.ts packages/ui/src/toolbar/controller.ts packages/ui/test/toolbar-config.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-controller.test.ts`
- 2026-07-08：阶段 D-E 继续收口：图片和表格入口默认挂入对应专业 Tab；表格 Tab 固定显示插入行/列、删除行/列、合并右侧动作；非 `home` Tab 使用“上方图标 + 下方 label”的 ribbon 样式；插件扩展入口归入 `tools` Tab；默认图片适配器改为内建可用，不再要求宿主为了显示基础图片入口额外传入配置。
- 2026-07-08：页面 Tab 已显式包含页面大小、页面方向、自定义页面入口；视图 Tab 已显式包含适应宽度、适应整页、全屏、演示、还原视图、主题和语言入口；导出 Tab 已显式包含原生格式导出事件入口。
- 2026-07-08：阶段 D-E focused 验证通过：
  - `pnpm exec eslint packages/ui/src/media-setup.ts packages/ui/src/ui-lifecycle.ts packages/ui/src/i18n.ts packages/ui/src/toolbar/builtin-tools.ts packages/ui/src/toolbar/controller.ts packages/ui/src/table/dom.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/media-setup.test.ts`
  - `pnpm exec vitest run packages/ui/test/media-setup.test.ts packages/ui/test/toolbar-config.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-controller.test.ts --root .`
  - `pnpm exec tsc --noEmit -p tsconfig.json`
- 2026-07-08：补充默认入口口径：图片和表格不要求宿主传入 `media` / `table` 才显示；常用模式切换时移动同一份 media/table 扩展宿主到常用面板扩展槽，切回专业模式再归位到插入 / 表格 Tab；表格入口默认文案改为 `插入表格` / `Insert table`，与参考图一致。
- 2026-07-08：默认入口补丁 focused 验证通过：
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-dom.test.ts --root .`
  - `pnpm exec eslint packages/ui/src/toolbar/config.ts packages/ui/src/toolbar/panel-lifecycle.ts packages/ui/src/toolbar/dom.ts packages/ui/src/table/controller.ts packages/ui/src/types.ts packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts`
  - `pnpm exec tsc --noEmit -p tsconfig.json`

- 2026-07-08：模式切换入口从单按钮直接 toggle 改为右侧固定下拉选择器：`.jw-toolbar__mode-picker` 作为 `.jw-toolbar` 直接子级绝对定位；按钮使用图标 + `切换工具栏` / `Switch toolbar` + 下拉箭头；下拉项使用图标 + `专业工具栏` / `常用工具栏` 文案，当前模式写入 `data-jword-selected` 与 `aria-checked` 并显示选中图标。常用模式同步隐藏 `.jw-toolbar__top-row`，并为常用工具区保留右侧空间，避免模式按钮挤乱工具布局。
- 2026-07-08：模式选择器 focused 验证通过：
  - `pnpm exec vitest run packages/ui/test/toolbar-dom.test.ts --root .`
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-dom.test.ts --root .`
  - `pnpm exec eslint packages/ui/src/toolbar/dom.ts packages/ui/src/styles/toolbar.css packages/ui/src/i18n.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-toolbar.test.ts`（CSS 因当前 ESLint 配置未匹配样式文件，仅产生 ignored warning）
  - `pnpm exec tsc --noEmit -p tsconfig.json`

- 2026-07-08：补充常用模式表格工具边界：常用模式仍保留插入表格入口，但隐藏插入行、删除行、插入列、删除列、向右合并等表格结构操作；这些操作只在专业模式的表格 Tab 展示。
- 2026-07-08：常用模式表格操作隐藏 focused 验证通过：
  - `pnpm exec vitest run packages/ui/test/create-ui-toolbar.test.ts --root .`
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-dom.test.ts --root .`
  - `pnpm exec eslint packages/ui/src/table/controller.ts packages/ui/test/create-ui-toolbar.test.ts`
  - `pnpm exec tsc --noEmit -p tsconfig.json`
- 2026-07-08：补充视图 Tab 与底部状态栏共享视图状态：`适应宽度`、`适应整页`、`全屏`、`演示模式` 在 toolbar/status bar 间同步 `aria-pressed` 选中态；适应宽度/整页再次点击会取消选中态，手动缩放/还原视图会清除适应模式；演示模式共享 `data-jword-presentation`，全屏状态同步监听 `fullscreenchange`。
- 2026-07-08：专业模式页面大小、页面方向、主题设置、语言设置等 select tile 的 hover/open 改为整体高亮，避免只高亮内部 trigger；状态栏视图按钮增加选中态样式，并继续使用亮/暗主题 token。
- 2026-07-08：视图状态同步 focused 验证通过：
  - `pnpm exec vitest run packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-status-bar.test.ts --root .`
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-status-bar.test.ts --root .`
  - `pnpm exec eslint packages/ui/src/view-state.ts packages/ui/src/toolbar/controller.ts packages/ui/src/status-bar/controller.ts packages/ui/src/status-bar/dom.ts packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/toolbar-dom.test.ts`
  - `pnpm exec tsc --noEmit -p tsconfig.json`
- 2026-07-09：补充视图适应取消语义：`适应宽度`、`适应整页` 激活后再次点击不仅清除选中态，还会统一还原到 `100%` 缩放；toolbar 与 status bar 两个入口行为一致。
- 2026-07-09：把顶部工具栏和底部状态栏的视图入口统一到 `packages/ui/src/view-state.ts`：专业模式视图 Tab 只调用共享 controller，缩放、适应宽度/整页、全屏、演示模式不再保留 toolbar/status bar 两套实现。
- 2026-07-09：演示模式开启后隐藏 toolbar/statusBar，仅显示编辑器内容；Esc 退出；鼠标靠近编辑器底部边缘时临时唤出状态栏，离开后隐藏。
- 2026-07-09：修复常用模式表格结构操作在真实样式下仍可见的问题：常用模式继续只展示插入表格入口，插入行、删除行、插入列、删除列、向右合并等结构操作通过 `hidden` 与内联 `display: none` 双重隐藏，切回专业模式恢复显示。
- 2026-07-09：视图取消与常用表格操作隐藏 focused 验证通过：
  - `pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts --root .`
  - `pnpm exec vitest run packages/ui/test/create-ui-toolbar.test.ts --root .`
  - `pnpm exec vitest run packages/ui/test/toolbar-config.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-status-bar.test.ts --root .`
  - `pnpm exec eslint packages/ui/src/toolbar/controller.ts packages/ui/src/status-bar/controller.ts packages/ui/src/table/controller.ts packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/create-ui-toolbar.test.ts`
  - `pnpm exec tsc --noEmit -p tsconfig.json`

## 收口状态

- 当前功能口径已收口：专业 / 常用双模式、默认图片 / 表格入口、页面 / 视图 / 导出 Tab、模式选择器、常用模式表格操作边界、主题 / i18n 和共享视图控制均已落地。
- 2026-07-09：工具 Tab 已补充页面水印入口；入口使用专业模式图标 + label + 下拉箭头形式，水印菜单本身由 `watermark-and-brand-protection-implementation-plan.md` 约束和验收。
- 用户真实页面手测已确认核心功能基本可用；后续发现的样式或交互问题按独立 bug 处理，不再扩大双模式首轮范围。
- 非阻断后续项：如需发版归档，可补截图级人工验收或 vanilla focused E2E，覆盖默认专业模式、Tab 切换、常用模式切换、页面尺寸自定义弹窗、暗色主题和中英文切换。
