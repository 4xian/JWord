# JWord 底部状态栏与视图控制栏 MVP 实施方案

> 快照日期：2026-07-09。
> 本文描述首批底部状态栏能力、落地步骤和当前实施进度，不记录历史实施计划，也不依赖已删除资料。

## 1. 目标

为 `@4xian/jword-ui` 增加官方底部状态栏，承载基础文档状态和视图控制能力。首批目标是让第三方宿主在直接使用 `createJWordUi({ editor, editorHost })` 时默认获得可直接使用的顶部工具栏和底部状态栏，而不是在 demo 内自行拼装。

首批能力：

- 左侧：品牌/版权文案、字数、字符数、段落数、当前页/总页数、选区统计。
- 右侧：全屏、基础演示模式、缩放滑块、缩放百分比、还原 100%、自适应页面宽度、自适应整页、主题切换、语言切换。
- 可访问性：键盘可达、状态变化可播报、控件有明确 `aria-label`。

## 2. 不在首批范围

- 不实现协作在线人数、保存状态、批注/修订汇总；这些进入 `JW-ROADMAP-016`。
- 不实现权限、敏感性标签、管理员策略、授权运营；这些进入 `JW-ROADMAP-017`。
- 不实现 AI 助手入口；该能力进入 `JW-ROADMAP-019`。
- 不改变 core 文档模型、事务、分页、渲染和协作主路径。
- 不新增复杂页面视图模式，例如多页并排、书本模式、独立阅读模式。

## 3. 当前可复用能力

- `Editor.getProjection()`：读取只读文档投影，可统计段落、run 文本、表格单元格文本。
- `Editor.getLayout()`：读取分页布局，可获取总页数、页面尺寸和当前 selection 对应页面。
- `Editor.getPageConfig()`：读取当前页面配置和 `scale`。
- `Editor.setPageConfig({ scale })`：更新页面缩放并触发重排与重绘。
- `Editor.getSelection()` / `Editor.resolveTextPosition(...)`：读取当前选区和文本位置。
- `Editor.subscribe(...)`：监听 `transaction`、`selectionChange`、`destroyed`。
- `createJWordUi(...)`：当前已装配 toolbar、statusBar、comments、link、find-replace、revisions、theme、i18n 和 live region。
- `applyJWordUiTheme(...)` / `JWordUiInstance.setTheme(...)`：当前可在 UI 创建时应用主题，也可在创建后动态刷新 toolbar/statusBar 和相关宿主样式。
- `resolveJWordUiI18n(...)` / `JWordUiInstance.setLocale(...)`：当前可在 UI 创建时合并字典，也可在创建后动态刷新 toolbar/statusBar；首批内建语言锁定为 `zh-CN` / `en-US`。

## 4. 公开 API 设计

### 4.1 `CreateJWordUiOptions`

新增：

```ts
interface CreateJWordUiOptions {
  readonly statusBar?: true | false | JWordStatusBarOptions
}
```

默认行为：

- `statusBar` 缺省：启用默认状态栏。
- `statusBar: true`：显式启用默认状态栏。
- `statusBar: false`：明确禁用。
- `statusBar: { ... }`：启用并按配置覆盖显示项、品牌、缩放范围和宿主节点。
- SDK 接收的是 `HTMLElement`，不是 CSS selector 或 id；demo 中的 `#jword-toolbar`、`#jword-editor` 只属于示例查找方式。

### 4.2 `JWordStatusBarOptions`

建议类型：

```ts
interface JWordStatusBarOptions {
  readonly host?: HTMLElement
  readonly fullscreenHost?: HTMLElement
  readonly visibleItems?: readonly JWordStatusBarItemId[]
  readonly hiddenItems?: readonly JWordStatusBarItemId[]
  readonly brand?: false | JWordStatusBarBrandOptions
  readonly zoom?: JWordStatusBarZoomOptions
  readonly themeSwitcher?: false | JWordStatusBarThemeSwitcherOptions
  readonly localeSwitcher?: false | JWordStatusBarLocaleSwitcherOptions
}
```

首批 item id 固定为：

```ts
type JWordStatusBarItemId =
  | 'brand'
  | 'wordCount'
  | 'characterCount'
  | 'paragraphCount'
  | 'page'
  | 'selection'
  | 'fullscreen'
  | 'presentation'
  | 'zoomSlider'
  | 'zoomPercent'
  | 'zoomReset'
  | 'fitWidth'
  | 'fitPage'
  | 'themeSwitcher'
  | 'localeSwitcher'
```

首批附属配置固定为：

```ts
interface JWordStatusBarBrandOptions {
  readonly label?: string
}

interface JWordStatusBarZoomOptions {
  readonly minPercent?: number
  readonly maxPercent?: number
  readonly stepPercent?: number
}

interface JWordStatusBarThemeSwitcherOptions {
  readonly themes?: readonly JWordUiThemeName[]
}

interface JWordStatusBarLocaleSwitcherOptions {
  readonly locales?: readonly JWordStatusBarLocale[]
}

type JWordStatusBarLocale = 'zh-CN' | 'en-US'
```

说明：

- `host` 缺省时由 `createJWordUi(...)` 在 `editorHost` 内自动创建，位置在 editor shell 之后。
- `fullscreenHost` 缺省为 `editorHost`，宿主可传 workspace 容器。
- `visibleItems` 存在时严格按顺序显示；`hiddenItems` 用于过滤默认项。
- `brand: false` 用于隐藏品牌文案，但不等同于企业白标授权；企业白标策略后续单独做。
- 默认显示顺序为左侧 `brand`、`wordCount`、`characterCount`、`paragraphCount`、`page`、`selection`，右侧 `fullscreen`、`presentation`、`zoomSlider`、`zoomPercent`、`zoomReset`、`fitWidth`、`fitPage`、`themeSwitcher`、`localeSwitcher`。
- `visibleItems` 与 `hiddenItems` 同时存在时，先按 `visibleItems` 取顺序，再按 `hiddenItems` 过滤。
- `zoom.minPercent`、`zoom.maxPercent`、`zoom.stepPercent` 当前默认分别为 `20`、`400`、`10`，内部调用 `editor.setPageConfig({ scale })` 时统一转换为 `percent / 100`。
- `themeSwitcher.themes` 首批默认 `['light', 'dark']`，当前状态栏不暴露高对比主题入口。
- `localeSwitcher.locales` 首批默认 `['zh-CN', 'en-US']`；状态栏语言切换只承诺中文和英文两种内建语言。

### 4.3 返回实例

`JWordUiInstance.elements` 新增：

```ts
interface JWordUiElements {
  readonly statusBar?: JWordStatusBarElements | null
}
```

`JWordUiInstance` 首批新增轻量动态 API：

```ts
interface JWordUiInstance {
  setTheme(theme: JWordUiThemeOptions): void
  setLocale(locale: 'zh-CN' | 'en-US', messages?: JWordUiI18nDictionary): void
}
```

### 4.4 默认挂载布局和 demo-only 区域

宿主未显式传入 `toolbarHost` 和 `statusBar.host` 时，`editorHost` 作为官方 UI 总容器使用。前提是宿主已经先执行 `editor.mount(editorHost)`。

目标自动 DOM 顺序：

```text
editorHost
├── [data-jword-toolbar-host="true"]
├── [data-jword-editor]
└── [data-jword-status-bar-host="true"]
```

布局规则：

- `editorHost` 由 SDK 设置为纵向 flex 容器。
- toolbar host 固定在 editor shell 上方。
- editor shell 使用 `flex: 1 1 auto`、`min-height: 0` 承载中间编辑区域。
- status bar host 固定在 editor shell 下方。
- 自动创建的 toolbar/statusBar host 在 `destroy()` 时移除，并恢复 SDK 写入前的 `editorHost` 与 editor shell 行内样式。
- 如果宿主显式传入 `toolbarHost` 或 `statusBar.host`，SDK 尊重宿主传入位置，不主动移动这些元素。
- vanilla demo 当前夹在 toolbar 与 editor 之间的 `#jword-demo-controls` 是 demo-only 控制区，不属于 `@4xian/jword-ui` 官方 UI；生产默认布局不包含这块区域。

实施时应把当前 `toolbar-setup.ts` 中的 editor shell 自动布局逻辑抽成共享 helper，避免 toolbar 和 statusBar 各自保存/恢复同一批行内样式导致 cleanup 顺序冲突。

## 5. 前置任务

### 5.1 动态主题切换

当前问题：

- `applyJWordUiTheme(...)` 在创建 UI 时执行一次。
- 状态栏如果提供主题切换，不能靠销毁重建 UI。

实施步骤：

1. 在 `packages/ui/src/theme.ts` 增加可复用的主题控制器。
2. 控制器保存当前 cleanup，切换主题时先恢复旧 token，再应用新 token。
3. `createJWordUi(...)` 持有主题控制器，并在 `destroy()` 时统一清理。
4. 状态栏主题按钮调用控制器切换 `light`、`dark`。
5. 每次切换主题必须同时更新：
   - toolbar host、editorHost、statusBar host 的 `data-theme`。
   - 宿主自定义 class。
   - `--jw-*` CSS custom properties。
   - 状态栏自身可见样式，不能只改状态值不改 UI。
6. 测试覆盖：
   - 初始化主题写入 `data-theme`。
   - 切换主题后 toolbar、editorHost、statusBarHost 同步更新。
   - 切换主题后状态栏背景、文字、边框等 token 消费样式同步变化。
   - destroy 后恢复创建前 DOM 状态。

### 5.2 语言文案补充与动态语言切换

当前问题：

- `DEFAULT_JWORD_UI_I18N_DICTIONARY` 只覆盖很少 key。
- toolbar 内建文案大量依赖定义里的中文 fallback。
- 状态栏需要中英文切换，不能只靠局部 fallback。

实施步骤：

1. 在 `packages/ui/src/i18n.ts` 定义内建 `zh-CN` 和 `en-US` 字典。
2. 保持 `messages` 局部覆盖能力，宿主覆盖优先级高于内建字典。
3. 新增状态栏文案 key：
   - `statusBar.ariaLabel`
   - `statusBar.brand.label`
   - `statusBar.stats.words`
   - `statusBar.stats.characters`
   - `statusBar.stats.paragraphs`
   - `statusBar.stats.selection`
   - `statusBar.page.current`
   - `statusBar.zoom.label`
   - `statusBar.zoom.reset`
   - `statusBar.zoom.fitWidth`
   - `statusBar.zoom.fitPage`
   - `statusBar.view.fullscreen`
   - `statusBar.view.exitFullscreen`
   - `statusBar.view.presentation`
   - `statusBar.view.exitPresentation`
   - `statusBar.theme.label`
   - `statusBar.locale.label`
   - `a11y.statusBar.zoomChanged`
   - `a11y.statusBar.themeChanged`
   - `a11y.statusBar.localeChanged`
4. 设计 `setLocale(...)` 刷新 toolbar、statusBar 和可见 panel 文案。
5. 首批语言切换只支持 `zh-CN` 和 `en-US` 两种内建语言：
   - `localeSwitcher` 默认只渲染中文和英文两个选项。
   - 宿主可通过 `messages` 覆盖中英文内建 key。
   - 传入其他 locale 时不进入状态栏内建切换列表；后续多语言包单独扩展。
6. 测试覆盖：
   - 默认中文。
   - `locale: 'en-US'` 使用英文内建文案。
   - 宿主 `messages` 覆盖优先。
   - 动态切换语言后 DOM 文案更新，不销毁 editor。

### 5.3 文档统计口径

统计函数放在 `packages/ui/src/status-bar/state.ts`，保持纯函数，方便单测。

首批口径：

- 字符数：统计非空白 grapheme。
- 字数：英文/数字连续 token 按 1 个词；CJK 字符按单字计数；标点不计词。
- 段落数：递归统计 paragraph block，包含表格单元格内段落。
- 选区统计：优先从 selection 对应范围读取文本；如跨复杂结构难以准确抽取，首批显示不可用文案，不显示 `0` 冒充真实统计。
- 表格：统计单元格内 paragraph 文本。
- 页眉页脚：首批不统计，后续和 DOCX 兼容口径一起补。

测试覆盖：

- 中文纯文本。
- 英文纯文本。
- 中英文混排和标点。
- 多段落。
- 表格内文本。
- 空文档。

### 5.4 缩放与自适应计算口径

缩放范围：

- 默认最小 20%，最大 400%。
- range input 使用 `min=20`、`max=400`、`step=10`。
- UI 显示整数百分比，内部 scale 使用 `percent / 100`。
- 100% 按钮固定调用 `editor.setPageConfig({ scale: 1 })`。
- 当前范围按产品要求固定为 20% - 400%。

自适应页面宽度：

- 读取 `editorHost` 内 `[data-jword-canvas-container]` 的可视宽度。
- 读取 `editor.getPageConfig().widthTwips`，用 `twipsToCssPx(widthTwips, 1)` 得到 100% 页面宽度。
- 预留左右页边可视留白，例如 48px。
- `scale = clamp((containerWidth - 48) / pageWidthAt100, 0.2, 4)`。
- 状态栏显示值使用 `Math.round(scale * 100)`。
- 适应宽度激活后再次点击，必须清除适应模式并统一还原到 100% 缩放。

自适应整页：

- 同时读取容器宽高。
- 用页面 100% 宽高计算宽度比例和高度比例。
- 取较小比例并按 20% - 400% clamp。
- 适应整页激活后再次点击，必须清除适应模式并统一还原到 100% 缩放。

Resize 行为：

- 首批只在点击“适应宽度/整页”时计算一次。
- 后续如果要持续跟随窗口变化，再增加 `ResizeObserver` 和 fit mode 状态。

### 5.5 状态刷新模型

状态栏首批只维护 UI 状态，不写 core 文档模型。刷新来源：

- `editor.subscribe('transaction')`：刷新字数、字符数、段落数、页数、缩放显示、可用态。
- `editor.subscribe('selectionChange')`：刷新选区统计和当前页。
- canvas container `scroll`：刷新当前可视页；不强制重新统计全文。
- `window.resize` 或宿主容器 resize：刷新当前可视页和按钮可用态；不自动重新执行“适应宽度/整页”。
- 状态栏自己调用 `editor.setPageConfig({ scale })` 后必须立即刷新状态栏显示；不能等待 transaction 事件。
- `createJWordUi().refresh()` 必须同步刷新 toolbar、panel 和 statusBar。
- toolbar/statusBar 的缩放、适应宽度、适应整页、全屏、演示模式必须走同一套视图控制逻辑，状态通过同一个 view state host 和 `jword-view-statechange` 事件同步。

当前页口径：

- 有可解析选区时，当前页优先取 selection focus 所在页。
- 无选区或选区页不可解析时，取 canvas container 可视区域中心所在页。
- 页码显示为 `currentPage / totalPages`，页码从 1 开始。

选区统计口径：

- 可准确抽取同 run 或已支持范围文本时显示真实统计。
- 跨复杂结构暂不能安全抽取时显示不可用文案，不显示 `0` 冒充真实统计。

### 5.6 全屏和基础演示模式

- 全屏按钮默认作用于 `fullscreenHost ?? editorHost`；顶部工具栏与底部状态栏必须解析到同一个 fullscreen/view state host。
- 全屏状态通过 Fullscreen API、按钮 `aria-pressed`、`data-jword-status-bar-action="fullscreen"` 和 live region 同步表达。
- headless 或浏览器不支持 Fullscreen API 时，按钮可禁用或展示不可用状态，测试允许该分支。
- 基础演示模式不新增独立阅读器，不改变 core 只读/编辑状态，不改变分页主路径。
- 演示模式开启后，toolbar host 与 statusBar host/root 写入 `data-jword-presentation-hidden="true"` 并隐藏，只保留编辑器内容。
- 演示模式下按 Esc 必须退出，并同步刷新 toolbar/statusBar 的 `aria-pressed`、图标和文案。
- 演示模式下鼠标进入 `fullscreenHost ?? editorHost` 底部边缘时，statusBar host/root 写入 `data-jword-presentation-peek="true"` 临时显示；鼠标离开底部边缘或状态栏后移除该属性并隐藏。
- vanilla demo 可以用该属性隐藏 demo-only 控制区；官方 SDK 不默认创建 demo controls。

## 6. 文件规划与落地状态

已新增：

```text
packages/ui/src/ui-shell-layout.ts
packages/ui/src/view-state.ts
packages/ui/src/status-bar/controller.ts
packages/ui/src/status-bar/dom.ts
packages/ui/src/status-bar/mount.ts
packages/ui/src/status-bar/state.ts
packages/ui/test/status-bar-state.test.ts
packages/ui/test/create-ui-status-bar.test.ts
```

待补：

```text
examples/vanilla/tests/gate7-status-bar.e2e.ts
```

已修改并完成文档回写：

```text
packages/ui/src/types.ts
packages/ui/src/index.ts
packages/ui/src/toolbar-setup.ts
packages/ui/src/ui-lifecycle.ts
packages/ui/src/theme.ts
packages/ui/src/i18n.ts
packages/ui/src/styles/toolbar.css
examples/vanilla/index.html
examples/vanilla/src/main.ts
examples/vanilla/src/styles.css
docs/current-implementation/packages/ui.md
docs/current-implementation/examples/vanilla.md
docs/current-implementation/sdk/public-api.md
docs/current-implementation/sdk/browser-and-e2e.md
docs/sdk/public-api.md
docs/sdk/stable-e2e-matrix.md
```

样式约束：

- 使用 flex 和 margin，不使用 `grid` 和 `gap`。
- 控件高度固定，避免影响编辑器初始行高或 canvas 布局。
- 状态栏应在 editor shell 外侧或 host 自动创建区域，不覆盖 canvas。

## 7. 代码实施步骤

实施总规则：

- 每个阶段先写最小红灯测试，再做最小实现，再运行对应 focused 验证。
- 不一次性做完整 UI；阶段 A 只落类型和纯函数，阶段 B 只落主题/i18n 动态能力，阶段 C-D 再接 DOM 和 lifecycle。
- 不引入 demo-only 依赖到 `packages/ui`。
- 前端样式使用 flex 和 margin，不使用 `grid` 和 `gap`。

### 阶段 A：类型和纯状态

1. 在 `packages/ui/src/types.ts` 定义公开 statusBar 类型，在 `packages/ui/src/status-bar/*` 保持 DOM/controller/state 内部实现。
2. 在 `packages/ui/src/status-bar/state.ts` 实现文档统计、缩放显示、按钮启用态、当前页状态、item 过滤。
3. 导出必要类型到 `packages/ui/src/types.ts` 和 `packages/ui/src/index.ts`。
4. 写最小单测：
   - 文档统计。
   - visible / hidden item 过滤。
   - zoom clamp 到 20% - 400%。
   - 只支持 `zh-CN` / `en-US` locale id。

验收命令：

```bash
pnpm exec vitest run packages/ui/test/status-bar-state.test.ts --reporter=verbose
pnpm typecheck
```

### 阶段 B：主题和语言前置能力

1. 改造 `theme.ts`，提供动态主题控制器。
2. 扩展 `i18n.ts`，补齐状态栏中英文 key，并锁定首批内建 locale 为 `zh-CN` / `en-US`。
3. 让 `ui-lifecycle.ts` 能把动态主题和动态 i18n 传给 toolbar/statusBar。
4. `JWordUiInstance.setTheme(...)` 必须同步更新属性与样式 token。
5. `JWordUiInstance.setLocale(...)` 必须刷新 toolbar/statusBar 可见 DOM 文案。
6. 补 focused 测试：
   - theme 切换。
   - locale 切换。
   - 宿主覆盖优先。
   - 不支持 locale 不出现在状态栏内建切换项中。

验收命令：

```bash
pnpm exec vitest run packages/ui/test/theme-i18n.test.ts --reporter=verbose
pnpm typecheck
```

### 阶段 C：状态栏 DOM 和 controller

1. `ui-shell-layout.ts` / `status-bar/mount.ts` 落地自动三段式布局：
   - toolbar 在上。
   - editor shell 在中。
   - statusBar 在下。
   - demo controls 不属于官方 UI。
2. `dom.ts` 创建状态栏 DOM：
   - 根节点：`data-jword-status-bar="true"`。
   - 左侧：`data-jword-status-bar-left="true"`。
   - 右侧：`data-jword-status-bar-right="true"`。
   - 每个控件都有稳定 `data-jword-status-bar-action`。
3. `controller.ts` 绑定 editor 事件、scroll、resize、按钮事件、input range 事件。
4. controller 只调用 editor facade，不直接读写 core 内部状态。
5. 状态变化通过 live region 播报。
6. destroy 时移除事件监听和自动创建的 host。

验收命令：

```bash
pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts --reporter=verbose
pnpm typecheck
```

### 阶段 D：接入 `createJWordUi(...)`

1. 在 `CreateJWordUiOptions` 增加 `statusBar`。
2. 在 `ui-lifecycle.ts` 中解析 statusBar mount。
3. `refresh()` 同步刷新 toolbar、panel 和 statusBar。
4. `destroy()` 统一销毁 statusBar。
5. 确认 `toolbar: false` 时仍可单独启用 statusBar。
6. 确认不传 `toolbarHost` / `statusBar.host` 时生成默认三段式 DOM 顺序。

验收命令：

```bash
pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/create-ui-toolbar.test.ts --reporter=verbose
pnpm typecheck
```

### 阶段 E：vanilla demo 接入

1. 在 `examples/vanilla/index.html` 增加状态栏宿主，或让 UI 自动创建并通过测试读取。
2. `examples/vanilla/src/main.ts` 可不传 `statusBar` 使用默认状态栏；如示例需要突出配置能力，也可显式传入 `statusBar: true` 或自定义配置。
3. 通过 demo 参数验证主题和语言：
   - `?theme=dark`
   - `?i18n=en`
4. 新增 focused E2E：
   - 初始显示字数、页数、缩放。
   - 点击 100% 后恢复缩放。
   - 点击适应宽度后 scale 改变。
   - 全屏按钮可进入/退出或在不支持环境下显示不可用。
   - 演示模式切换 `data-jword-presentation`，不改变文档编辑状态。
   - 语言切换后状态栏文案变更。
   - demo controls 仍是 demo-only，不进入 `@4xian/jword-ui` 自动挂载 DOM。

验收命令：

```bash
pnpm exec playwright test examples/vanilla/tests/gate7-status-bar.e2e.ts --project=chromium
```

### 阶段 F：文档回写

实现完成后更新：

- `docs/current-implementation/packages/ui.md`
- `docs/current-implementation/examples/vanilla.md`
- `docs/current-implementation/sdk/public-api.md`
- `docs/current-implementation/sdk/browser-and-e2e.md`
- `docs/sdk/public-api.md`
- `docs/sdk/browser-support.md`
- `docs/sdk/stable-e2e-matrix.md`
- `docs/current-implementation/backlog.md`

必须记录：

- 已实现项。
- 未实现项。
- 验证命令。
- 已知限制。

## 8. 验证矩阵

当前可跑的最小验证：

```bash
pnpm exec vitest run packages/ui/test/status-bar-state.test.ts packages/ui/test/create-ui-status-bar.test.ts --reporter=verbose
pnpm exec vitest run packages/ui/test/theme-i18n.test.ts --reporter=verbose
pnpm typecheck
pnpm lint:comments
```

待 `examples/vanilla/tests/gate7-status-bar.e2e.ts` 补齐后追加：

```bash
pnpm exec playwright test examples/vanilla/tests/gate7-status-bar.e2e.ts --project=chromium
```

如果改动触碰 toolbar lifecycle，再追加：

```bash
pnpm exec vitest run packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/toolbar-controller.test.ts --reporter=verbose
```

如果改动触碰 demo layout，再追加：

```bash
pnpm exec playwright test examples/vanilla/tests/gate7-theme-i18n.e2e.ts --project=chromium
```

## 9. 风险与处理

- 动态语言切换可能影响 toolbar 已创建 DOM：需要 controller 支持重新渲染文案，不能只更新字典对象。
- 自适应页面宽度依赖真实 DOM 尺寸：单元测试只测计算函数，真实尺寸用 Playwright 验证。
- 全屏 API 在 headless 或某些浏览器中可能受限：测试需要允许不可用分支，但 DOM 状态要清晰。
- 状态栏统计在超大文档上可能较慢：MVP 先做简单缓存，后续根据 transaction dirty scope 增量优化。
- 字数统计口径可能与 Word 不完全一致：文档必须明确当前口径，后续可提供统计 adapter。
- 状态栏不应遮挡 canvas 或改变 core 行高：必须放在 editor shell 外部，并用独立 flex 区域占位。

## 10. 当前实施进度

### 2026-07-08 阶段 A / B 基础

- 阶段 A 已有状态栏公开类型、纯统计、item 过滤、缩放 clamp 和 locale 白名单；focused 测试已通过。
- 阶段 B 已新增动态主题控制器，`JWordUiInstance.setTheme(...)` 可在不销毁 editor 的情况下同步 `data-theme`、宿主 class 和 `--jw-*` token。
- 主题切换 UI 已收口为 `light`、`dark`，状态栏 DOM 直接消费同一批 token，避免只切属性不切可见样式。
- 阶段 B 已补齐 `zh-CN` / `en-US` 内建字典，覆盖状态栏新增 key、已有 toolbar key、内部 page preset 菜单 key、当前 a11y/diagnostics key。
- `JWordUiInstance.setLocale(...)` 已可动态刷新 toolbar 可见文案；后续状态栏 DOM/controller 接入时复用了同一个 i18n 句柄。
- 已验证：
  - `pnpm exec vitest run packages/ui/test/status-bar-state.test.ts --reporter=verbose`
  - `pnpm exec vitest run packages/ui/test/theme-i18n.test.ts --reporter=verbose`
  - `pnpm exec vitest run packages/ui/test/status-bar-state.test.ts packages/ui/test/theme-i18n.test.ts --reporter=verbose`
  - `pnpm exec vitest run packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/toolbar-controller.test.ts --reporter=verbose`
  - `pnpm typecheck`
  - `pnpm lint:comments`

### 2026-07-08 阶段 C / D 默认状态栏基础

- 最新默认行为已调整：`createJWordUi({ editor, editorHost })` 在未显式传入 `statusBar: false` 时默认创建底部状态栏。
- 未传 `toolbarHost` 和 `statusBar.host` 时，SDK 通过共享 `ui-shell-layout.ts` 在 `editorHost` 内形成 `toolbar / editor shell / statusBar` 三段式布局，避免 toolbar/statusBar 重复恢复同一批行内样式。
- 已新增状态栏 DOM 和 controller：
  - 默认渲染品牌、字数、字符数、段落数、页码、选区统计、全屏、演示模式、缩放滑块、缩放百分比、100%、适应宽度、适应整页、主题、语言。
  - 缩放滑块、100%、适应宽度和适应整页均通过 `editor.setPageConfig({ scale })` 更新页面配置。
  - transaction、selectionChange、canvas scroll、window resize、fullscreenchange 和 `createJWordUi().refresh()` 均会刷新状态栏。
  - 状态栏常规刷新优先读取已挂载 canvas 的 `data-jword-page-count`，避免事务热路径强制 `editor.getLayout()`。
  - `setTheme(...)` 与 `setLocale(...)` 已同步 toolbar/statusBar，状态栏样式消费同一批主题 token。
- 已验证：
  - `pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts --reporter=verbose`
  - `pnpm exec vitest run packages/ui/test/status-bar-state.test.ts packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/theme-i18n.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/toolbar-controller.test.ts --reporter=verbose`
  - `pnpm typecheck`
  - `pnpm lint:comments`

### 2026-07-09 共享视图控制逻辑

- 已把 toolbar 与 statusBar 的视图行为收口到 `packages/ui/src/view-state.ts`：
  - 统一处理缩放百分比、10% 步进、20% - 400% clamp、适应宽度、适应整页、全屏和演示模式。
  - 统一写入 `data-jword-view-fit-mode`、`data-jword-presentation` 并派发 `jword-view-statechange`。
  - 顶部工具栏与底部状态栏两个入口只负责绑定 DOM 和渲染状态，不再各自实现一套 fit/fullscreen/presentation 逻辑。
- 已明确适应模式取消语义：`适应宽度` / `适应整页` 激活后再次点击，会清除选中态并还原到 100% 缩放；从顶部或底部入口触发都必须同步状态栏缩放百分比和滑块。
- 已验证：
  - `pnpm typecheck`
  - `pnpm exec eslint packages/ui/src/view-state.ts packages/ui/src/status-bar/controller.ts packages/ui/src/toolbar/controller.ts packages/ui/test/create-ui-status-bar.test.ts`
  - `pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/status-bar-state.test.ts packages/ui/test/toolbar-controller.test.ts`

### 2026-07-09 演示模式行为增强

- 已调整演示模式语义：开启后隐藏顶部工具栏与底部状态栏，只保留编辑器内容；Esc 退出演示模式。
- 已新增状态栏底部边缘唤出：鼠标靠近编辑器底部边缘时临时显示状态栏，离开底部边缘或状态栏后隐藏。
- 已验证：
  - `pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts --root . --reporter=verbose`

### 2026-07-09 收口核对

- MVP 代码能力可以收口：默认状态栏、三段式自动布局、状态栏 DOM/controller、20% - 400% 缩放、10% 步进、适应宽度/整页、全屏、演示模式、亮暗主题、`zh-CN` / `en-US` 语言切换均已接入。
- 状态栏与顶部工具栏的视图入口已经共用 `packages/ui/src/view-state.ts`，后续不再维护两套缩放、适应、全屏和演示逻辑。
- Vanilla demo 当前通过显式 `toolbarHost` 保留 demo controls 在 toolbar 与 editor 之间，官方状态栏在未传 `statusBar` 时默认自动挂入 `editorHost` 底部；demo controls 仍是 demo-only，不属于 `@4xian/jword-ui` 自动三段式官方 UI。
- 当前剩余项只属于验证和发布收口，不再扩大 MVP 功能范围：
  1. 新增 `examples/vanilla/tests/gate7-status-bar.e2e.ts`，覆盖初始统计/页码/缩放、缩放还原、适应宽度、演示模式、主题和语言。
  2. 发版前补一次截图级人工验收，确认真实页面下状态栏在亮色/暗色、中英文、专业/常用 toolbar、演示模式底部唤出时都可见且不遮挡正文。
  3. 发布前重新执行 focused 验证与 `pnpm lint:comments` / `pnpm --filter @4xian/jword-ui typecheck`，并把结果写入验证记录。
- 已完成文档回写：`packages/ui.md`、`examples/vanilla.md`、`docs/current-implementation/sdk/public-api.md`、`docs/current-implementation/sdk/browser-and-e2e.md`、`docs/sdk/public-api.md` 和 `docs/sdk/stable-e2e-matrix.md` 已记录 statusBar、toolbar 双模式和动态 theme/i18n 当前能力。
- 后续增强不属于 MVP：协作/保存/批注/修订状态进入 `JW-ROADMAP-016`，企业治理/白标进入 `JW-ROADMAP-017`，diagnostics/support bundle 入口进入 `JW-ROADMAP-018`，AI 助手入口进入 `JW-ROADMAP-019`。

### 2026-07-09 文档收口结论

- `JW-ROADMAP-015` 维持 `In progress`：不是因为状态栏主体功能未完成，而是因为还缺专门 vanilla 浏览器 E2E、截图级人工验收和发布前 fresh run。
- 可继续实施的唯一状态栏工程任务是补 `examples/vanilla/tests/gate7-status-bar.e2e.ts`；其他都是发布前验证或后续路线图，不应继续塞进 MVP。
- 如果后续发现暗色、英文、演示模式底部唤出、缩放同步等问题，按独立 bug 修复；修复时必须同步考虑 i18n 文案和 light/dark 主题样式。

本次文档收口已验证：

```bash
pnpm lint:comments
pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/status-bar-state.test.ts packages/ui/test/create-ui-toolbar.test.ts --root . --reporter=verbose
pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-sdk-docs.test.ts --reporter=verbose
```
