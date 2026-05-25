# JWord UI SDK And Gate 4 Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `examples/vanilla` 中已经验证过的官方 UI 胶水层抽成 `@4xian/jword-ui`，让 demo 回到“宿主装配 + 场景展示 + 测试钩子”职责，并为 Gate 4 的图片、表格、批注、超链接等 UI 能力提供统一落点。第一版 toolbar 视觉与交互需对齐腾讯文档 `https://docs.qq.com/doc/DWUJhZktBc0J1d1RB` 的轻量风格，而不是延续当前 demo 的厚卡片样式。

**Architecture:** `@4xian/jword-core` 继续负责状态、事务、命令、排版、渲染和 Editor Facade；`@4xian/jword-ui` 只依赖 core 的公开 facade，负责原生 TS + DOM UI、状态同步、命令分发和基础可访问性支架；`examples/vanilla` 退化为 host app，创建 editor、挂载 UI、提供 demo-only 场景控件和浏览器验证入口。当前 demo 中的 UI 逻辑不能整块平移，必须先按“官方可复用 UI / demo-only 场景逻辑 / 浏览器验证钩子”三类拆开，再提炼成小文件 SDK。

**Tech Stack:** pnpm workspace、TypeScript ESM、原生 TS + DOM API、现有 Editor Facade、Vite、Playwright、真实浏览器手工 smoke。

**Baseline 2026-05-17:** `packages/ui` 已作为 workspace 包落地，并由 `examples/vanilla` 通过 `createJWordUi(...)` 与 `@4xian/jword-ui/styles.css` 真实消费；`examples/vanilla/src/main.ts` 已退化为 host app 装配层，demo-only 场景逻辑迁入 `demo-controls.ts`；Gate 2 demo 宿主高度约束已修复，50 页夹具重新回到 viewport virtualization 语义，真实 Chromium 采样表现为首屏仅挂载 `2` 个 canvas，滚到末页后仅保留页 `48`、`49`；`pnpm lint`、`pnpm typecheck`、`pnpm build`、`pnpm exec playwright test examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium --project=firefox --project=webkit`、`pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium --project=firefox --project=webkit`、`pnpm test:e2e` 与 `pnpm test:visual` 均已通过。

---

## 1. 当前现状与问题

- `packages/core` 已经暴露出 UI 可消费的 facade 能力，例如 `undo`、`redo`、`toggleBold`、`setFontFamily`、`getSelectionFormattingState`、`subscribe` 等，说明 core 边界本身是可承接 UI 包的。
- `examples/vanilla/src/main.ts` 当前同时承担了宿主启动、官方 toolbar、状态同步、aria-live、文本镜像、demo 场景按钮、fixture 恢复、测试钩子等多重职责，已经偏离“demo 只做集成展示”的目标。
- 当前 toolbar 第一版已经通过真实浏览器验证，但其 DOM 构造、图标、按钮状态、颜色冻结选区、summary 文案和样式都散落在 demo 文件中，难以复用到 Gate 4。
- `examples/vanilla/src/styles.css` 同时包含 demo 外壳、toolbar、editor host、文本镜像等样式，后续继续叠加会使 UI 与 demo 外壳边界越来越模糊。
- `examples/vanilla/tests/gate3-toolbar.e2e.ts` 已经形成了真实 DOM 契约，后续重构必须以“可观察行为不变”为前提，而不是只看 TypeScript 编译通过。

## 2. 本次方案的边界

### 2.1 这次要完成的事

- 定义 `@4xian/jword-ui` 的最小公开边界和文件结构。
- 明确哪些逻辑迁入 `ui` 包，哪些逻辑留在 `examples/vanilla`。
- 定义第一版 toolbar 的显隐配置方案，支持“显示哪些工具、隐藏哪些工具”。
- 规划 Gate 4 中图片、表格、批注、超链接等 UI 能力如何接入 `ui` 包。
- 把工具链需要跟随调整的点一并纳入计划，避免出现“包拆出来了，但 dev/build/size/test 断裂”。

### 2.2 这次明确不做的事

- 不在这次方案里直接设计完整第三方 Plugin API。
- 不把 `@4xian/jword-ui` 做成 React/Vue wrapper。
- 不改变当前命令语义、transaction pipeline、按钮 enable/disable 规则、mixed state 规则和历史行为。
- 不把 demo-only 场景按钮包装成官方 UI 能力。
- 不预先创建 Gate 4 所有空目录或空组件，只在对应阶段落到具体功能时再创建。

### 2.3 新增视觉与交互约束

- toolbar 样式参考腾讯文档真实页面 `https://docs.qq.com/doc/DWUJhZktBc0J1d1RB` 与截图 `/Users/jian/Downloads/docsqq-toolbar-reference_2026-05-17T00-42-32-096Z.png`，不再沿用当前 demo 的重阴影、大圆角、强渐变卡片风格。
- 已确认的真实页面特征包括：
  - 容器为白底、1px 浅边框、约 `8px` 圆角、轻阴影、约 `13px` 字号。
  - 工具项整体是轻量按钮 / 字段组合，视觉密度更高，分隔更细。
  - 每个工具外层都挂有 tooltip wrapper，tooltip 是基础交互，不是可选装饰。
- `@4xian/jword-ui` 第一版 toolbar 必须支持鼠标悬浮提示框。
- toolbar 不能强制单行；必须根据编辑器宽度自动换行，并在窄宽度下保持可用。
- 这次换行实现只允许用 flex 流式换行，不使用 grid。

## 3. 目标分层

目标分层保持为：

`Host App / Demo`
-> `@4xian/jword-ui`
-> `@4xian/jword-core`

本阶段不把 `ui` 包做成 plugin。更合理的关系是：

- `@4xian/jword-ui` 是官方原生 UI SDK。
- `@4xian/jword-core` 未来在 Gate 7 提供 Plugin API。
- `@4xian/jword-ui` 后续可以消费 Plugin API 暴露的扩展点，但本阶段不把两者混成同一层。

## 4. 迁移边界

### 4.1 必须迁入 `packages/ui` 的内容

- toolbar 的 DOM 构造逻辑。
- toolbar 的按钮、下拉框、颜色控件、图标、summary、字段容器等可复用视图层。
- toolbar 的 tooltip、分组换行与溢出时的布局策略。
- toolbar 的状态同步逻辑，包括 run/paragraph formatting state、undo/redo、page preset、aria-pressed、mixed state、disabled state。
- toolbar 绑定到 facade 命令的逻辑，包括加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进、纸张切换。
- 颜色选择器冻结选区的 UI 行为，因为它属于可复用的控件语义，不属于 demo 场景逻辑。
- aria-live 与隐藏文本镜像第一版，因为它们是 Gate 3 已验证的 UI / a11y 支架，不应永久留在 demo 文件里。
- toolbar 专属样式和未来 Gate 4 共用的 UI 基础样式。

### 4.2 必须留在 `examples/vanilla` 的内容

- `loadAlphaSample`、`restoreGate2Fixture`、`selectSample` 这类 demo-only 场景按钮。
- `window.__jwordDemo` 这类浏览器测试钩子。
- fixture 文本加载、样例文本装配、Gate 2 大夹具恢复逻辑。
- demo 页面外壳、展示性布局和非产品级说明文案。
- 只服务于 demo 的状态播报文案，例如“已恢复 Gate 2 50 页夹具”“已加载 Alpha 工具栏样例”。

### 4.3 这次不能直接平移的内容

- 当前 `createToolbar()` 里的“产品工具 + demo 场景按钮”混合布局不能原样搬入 `ui` 包，必须拆开。
- 当前 `styles.css` 里的所有 `.jw-toolbar__*` 规则不能整文件搬运，必须和 `.jw-demo__*` 外壳规则拆开。
- 当前 `main.ts` 里的 summary 文案、blocked 文案、文本镜像同步、页面 preset、颜色冻结选区等逻辑不能继续堆在一个文件里，必须按职责拆成小模块。
- 当前 demo 的 toolbar 视觉是“厚卡片 + 大间距 + 强装饰”，不能直接继承到 `ui` 包；抽离时要顺便收敛到腾讯文档参考风格，但不能改变原始业务逻辑。

## 5. `@4xian/jword-ui` 的目标公开面

第一阶段不做一个巨大的“全家桶入口”，但也不继续暴露零散函数。建议把 `ui` 包收敛成一个清晰的装配入口：

- `createJWordUi(...)`
- 输入：`editor`、`toolbarHost`、`liveRegionHost`、`assistiveMirrorHost`、`toolbar` 配置
- 输出：`destroy()`、`refresh()`、只读的 `elements` / `handles`

这样做的原因：

- 当前 toolbar 和 assistive mirror 共用同一套 editor 订阅，拆成多个互不知晓的入口会让宿主重新承担同步责任。
- Gate 4 会新增评论侧栏、超链接弹窗、图片上传 UI，这些都适合挂在同一个 `ui` 组合层下，而不是继续塞回 demo。
- 入口只有一个，但内部实现必须拆成小文件，避免再出现单文件堆积。

## 6. 工具栏可配置性方案

### 6.1 第一阶段配置目标

第一阶段只解决两个核心需求：

- 配置哪些工具显示。
- 配置哪些工具隐藏。

不在这一阶段承诺：

- 任意第三方按钮注入。
- 任意自定义渲染函数。
- 任意级别的菜单、dialog、sidebar 插件扩展。

### 6.2 建议的最小配置形状

`toolbar` 配置保持最小且可预测：

- `visibleTools`
  - 含义：显式声明要显示的工具列表，同时作为显示顺序。
  - 字段存在时：严格采用该列表；空数组表示不显示任何工具。
- `hiddenTools`
  - 含义：未传 `visibleTools` 时从全部内建工具过滤，已传 `visibleTools` 时从该列表再过滤一层。
  - 用途：宿主快速裁剪功能，不需要重写整套布局。
- `toolbar: false`
  - 含义：隐藏整条官方 toolbar。

### 6.3 第一阶段内建工具 ID

第一阶段只为当前已验证的 Gate 3 能力建立内建工具 ID：

- `history.undo`
- `history.redo`
- `document.pagePreset`
- `format.bold`
- `format.italic`
- `format.underline`
- `format.strike`
- `format.fontFamily`
- `format.fontSize`
- `format.textColor`
- `format.backgroundColor`
- `paragraph.alignLeft`
- `paragraph.alignCenter`
- `paragraph.alignRight`
- `paragraph.alignJustify`
- `paragraph.indentDecrease`
- `paragraph.indentIncrease`

### 6.4 第一阶段不进入工具栏配置的控件

以下控件不进入 `ui` 包内建 toolbar 配置，它们保留在 demo host：

- `loadAlphaSample`
- `restoreGate2Fixture`
- `selectSample`

原因：

- 它们服务于 demo 场景，而不是产品级编辑器能力。
- 如果把它们混进 `ui` 包，后续 Gate 4 的图片、表格、批注 UI 仍会继续和 demo 场景耦合。
- 这一步本身就是“不能直接搬 demo UI 逻辑”的第一层优化。

## 7. 目标文件结构

### 7.1 仓库级文件

- 修改 `tsconfig.base.json`
  - 增加 `@4xian/jword-ui` 的 source path 映射。
- 修改 `rollup.config.mjs`
  - 继续自动发现 `packages/ui`。
  - 增加最小静态资源复制路径，让 `ui` 包可以导出 CSS 资产，而不是把样式重新塞回 demo。
- 修改 `tools/size/check-size.mjs`
  - 把 `@4xian/jword-ui` 加入 source graph alias，避免 demo 改为依赖 UI 包后，体积检查和 freshness 证据绕过 UI 源码。
- 视实现需要修改 `pnpm-workspace.yaml`
  - 通常不需要额外改动，但需确认 `packages/*` 已自然覆盖 `packages/ui`。

### 7.2 `packages/ui`

- 创建 `packages/ui/package.json`
- 创建 `packages/ui/tsconfig.json`
- 创建 `packages/ui/src/index.ts`
- 创建 `packages/ui/src/types.ts`
- 创建 `packages/ui/src/create-ui.ts`
- 创建 `packages/ui/src/toolbar/config.ts`
- 创建 `packages/ui/src/toolbar/builtin-tools.ts`
- 创建 `packages/ui/src/toolbar/controller.ts`
- 创建 `packages/ui/src/toolbar/dom.ts`
- 创建 `packages/ui/src/toolbar/icons.ts`
- 创建 `packages/ui/src/toolbar/tooltip.ts`
- 创建 `packages/ui/src/toolbar/state.ts`
- 创建 `packages/ui/src/assistive/live-region.ts`
- 创建 `packages/ui/src/assistive/text-mirror.ts`
- 创建 `packages/ui/src/styles/toolbar.css`
- 创建 `packages/ui/test/toolbar-config.test.ts`

### 7.3 `examples/vanilla`

- 修改 `examples/vanilla/package.json`
  - 增加 `@4xian/jword-ui` workspace 依赖。
- 修改 `examples/vanilla/vite.config.ts`
  - serve 模式下增加 `@4xian/jword-ui` 源码 alias。
- 修改 `examples/vanilla/index.html`
  - 为官方 toolbar host 与 demo-only scenario controls 预留清晰挂载点。
- 修改 `examples/vanilla/src/main.ts`
  - 退化为 editor 创建、UI 挂载、demo-only 场景接线。
- 创建 `examples/vanilla/src/demo-controls.ts`
  - 收纳 Alpha 样例、Gate 2 fixture、测试辅助选择等 demo-only 逻辑。
- 修改 `examples/vanilla/src/styles.css`
  - 保留 demo shell 和 demo-only 控件样式。
- 由 demo 入口显式引入 `@4xian/jword-ui` 导出的 CSS 资产。

## 8. 分阶段实施步骤

## Phase 1 - 冻结当前可观察行为

- [x] 记录当前 `gate3-toolbar.e2e.ts` 覆盖的 DOM 契约、aria 契约、selector 契约和 observable state 契约。
  - DOM / selector 契约：`[data-jword-toolbar]`、`[data-jword-page-preset]`、`[data-jword-format-*]`、`[data-jword-history-*]` 保持稳定，可被浏览器回归直接消费；toolbar summary selector 已移除。
  - aria 契约：toolbar host 保留 `aria-label="JWord toolbar"`；toggle 按钮继续用 `aria-pressed=true|false|mixed` 表达 tri-state；真实浏览器继续按按钮可访问名称 `撤销`、`重做`、`加粗`、`斜体`、`下划线`、`删除线` 等断言。
  - observable state 契约：`gate3-toolbar.e2e.ts` 已覆盖撤销重做 enable/disable、facade 驱动的选区同步、cross-run mixed state、run formatting 字段值、颜色冻结选区、段落对齐/缩进、page preset 与真实页面几何变化。
- [x] 记录 toolbar 视觉契约：
  - 参考腾讯文档真实页面的白底、细边框、轻阴影、紧凑按钮密度
  - 宽度变小时允许多行换行
  - hover 后出现 tooltip
  - 2026-05-17 回填：`packages/ui/src/styles/toolbar.css` 已收敛到白底、`1px` 浅边框、`8px` 圆角、轻阴影、`13px` 字号、紧凑按钮密度；`.jw-toolbar__bar` 与 `.jw-toolbar__group` 使用 `flex-wrap`；所有控件通过 tooltip wrapper 暴露 hover/focus tooltip。
- [x] 明确“必须保持不变”的行为清单：
  - mixed state 语义
  - disabled state 语义
  - undo/redo 状态切换
  - 颜色选择器冻结选区行为
  - page preset 行为
  - 选区 summary / run summary / blocked summary 的现有观察结果
- [x] 明确“允许优化但不算行为变更”的范围：
  - DOM 组装文件拆分
  - 图标存放位置
  - demo-only 场景按钮位置
  - CSS 文件拆分

## Phase 2 - 搭建 `packages/ui` 基座

- [x] 创建 `packages/ui` 的 package、tsconfig、index 入口和最小构建路径。
- [x] 为 `@4xian/jword-ui` 增加 TypeScript path alias。
- [x] 为 demo dev server 增加 `@4xian/jword-ui` 源码 alias。
- [x] 为 UI 包补最小 CSS 资产导出路径，不做运行时 style 注入黑盒。
- [x] 为 size 检查接入 `@4xian/jword-ui` 源码图，避免 UI 包成为首屏重依赖的盲区。

## Phase 3 - 抽离官方 UI，而不是整段平移

- [x] 把当前 `main.ts` 的职责拆成三层：
  - UI 入口层
  - toolbar controller / state 层
  - assistive 层
- [x] 先搬迁“产品级控制项”：
  - history
  - page preset
  - inline formatting
  - run value fields
  - paragraph controls
- [x] 先不搬迁 demo-only 场景按钮，把它们独立到 `demo-controls.ts`。
- [x] 把 `.jw-toolbar__*` 样式从 demo 样式中剥离到 `packages/ui/src/styles/toolbar.css`。
- [x] 把 toolbar 容器、按钮、字段、分隔、tooltip 样式收敛到腾讯文档参考风格。
- [x] 把 `.jw-demo__*`、editor shell、scenario controls 样式留在 demo。
- [x] 保留现有数据属性命名，避免无意义地改坏浏览器验证脚本。

## Phase 4 - 建立第一版可配置 toolbar

- [x] 在 `packages/ui` 内建立内建工具注册表，由注册表而不是手写长串 `createButton` 顺序驱动渲染。
- [x] 配置解析只支持 `visibleTools`、`hiddenTools` 和顶层 `toolbar: false`，不提前做复杂插件注入。
- [x] 默认顺序必须严格对齐当前 Gate 3 已验证顺序，避免“配置系统上线”顺便改变用户可见行为。
- [x] 对 `visibleTools` 做顺序校验和去重处理。
- [x] 对 `hiddenTools` 做最后一层过滤，并在过滤后自动剔除空 group。
- [x] 分组布局必须支持 flex wrap；工具被隐藏后，分组与换行结果仍要稳定，不出现孤立分隔线。
- [x] 不在这一阶段开放任意 callback 渲染、任意 JSX/模板插槽、任意第三方按钮扩展。

## Phase 5 - 缩小 demo 主文件

- [x] `examples/vanilla/src/main.ts` 只保留：
  - editor 创建
  - `createJWordUi(...)` 调用
  - demo-only scenario controls 装配
  - `window.__jwordDemo` 测试钩子
- [x] `loadAlphaSample`、`restoreGate2Fixture`、`selectSample`、测试辅助 selection helper 全部移出官方 UI 包。
- [x] 文本镜像和 live region 若被纳入 `ui` 包，则 demo 只负责传 host，不再自己做同步逻辑。
- [x] demo 的布局应清楚区分：
  - 官方 toolbar 区
  - demo-only scenario controls 区
  - canvas editor 区
  - 状态 / assistive 区

## Phase 6 - Gate 3 回归验证

- [x] 跑 `pnpm lint`
- [x] 跑 `pnpm typecheck`
- [x] 跑 `pnpm build`
- [x] 跑 `pnpm exec playwright test examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium --project=firefox --project=webkit`
- [x] 跑 `pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium --project=firefox --project=webkit`
- [x] 跑真实浏览器 smoke，确认 demo 页面上：
  - toolbar 渲染正常
  - toolbar 在窄宽度下可换行
  - toolbar hover tooltip 正常出现
  - scenario controls 正常
  - 文本镜像与 live region 不回退
  - page preset 与 formatting 交互不回退
- [x] 回归 Gate 2 demo 宿主 viewport，确认 50 页夹具重新只保留 viewport 附近的真实 canvas，而不是滚动后退化成 50 页全挂载。
- [ ] 用真实浏览器对照腾讯文档参考页，确认 toolbar 的整体视觉方向已经从“重卡片 demo 风格”收敛为“轻量办公文档风格”。

## 9. Gate 4 承接规划

### 9.1 Gate 4 中继续留在 `core` 的工作

以下步骤仍按“model / operation / layout / render”优先，不依赖 UI 拆分完成：

- Step 4.1 资源表和 ResourceAdapter
- Step 4.2 图片 model / operation / layout / render
- Step 4.4 表格 model
- Step 4.5 表格 operation
- Step 4.6 表格 layout / render
- Step 4.8 批注 model / operation
- Step 4.11 标题结构与目录生成
- Step 4.12 查找替换的 RangeRef 与 transaction pipeline
- Step 4.13 页眉页脚 / 页码底层能力
- Step 4.14 修订 metadata 第一版
- Step 4.15 DOMPurify 保格式粘贴核心路径

### 9.2 Gate 4 中优先落到 `packages/ui` 的工作

以下步骤应以 `ui` 包作为第一落点，而不是继续扩张 demo 主文件：

- Step 4.3 图片插入 UI 和上传状态 UI
- Step 4.7 表格 UI
- Step 4.9 批注侧边栏
- Step 4.10 超链接编辑弹窗
- Step 4.12 查找替换面板
- Step 4.13 页眉页脚 / 页码控制 UI
- Step 4.16 移动视口分页预览的宿主 UI 外壳

### 9.3 Gate 4 的 UI 目录建议

等 Phase 1-6 完成后，再按具体功能逐步新增这些目录，不提前造空壳：

- `packages/ui/src/media/`
- `packages/ui/src/table/`
- `packages/ui/src/comments/`
- `packages/ui/src/link/`
- `packages/ui/src/find/`
- `packages/ui/src/header-footer/`

### 9.4 Gate 4 的节奏建议

- 先完成 UI 包基础抽离，再进入第一个 Gate 4 UI 子项。
- 第一个落地项建议优先做 Step 4.3 图片 UI，因为它能验证：
  - toolbar / panel / dialog 的新入口组织方式
  - 资源上传中的临时状态 UI
  - `ui` 包与 `core` 的命令边界
- 第二个落地项建议做 Step 4.9 批注侧边栏，因为它最能检验“非 toolbar UI 是否真的能从 demo 脱离出来”。

## 10. 验收标准

- [x] `examples/vanilla` 主文件不再包含大段 toolbar 视图构造和状态同步逻辑。
- [x] demo 页面仍能只靠 `@4xian/jword-core` + `@4xian/jword-ui` + demo-only 控件装配运行。
- [x] 当前 Gate 3 toolbar 浏览器回归全部通过。
- [x] `@4xian/jword-ui` 可以通过配置控制工具显示 / 隐藏，不改变当前默认行为。
- [ ] toolbar 样式已对齐腾讯文档参考方向，且支持 hover tooltip 与按编辑器宽度自动换行。
- [x] `loadAlphaSample`、`restoreGate2Fixture`、`selectSample` 不进入官方 UI 包。
- [x] Gate 4 的后续 UI 功能有明确落点，不需要重新把逻辑塞回 demo 主文件。
- [x] Gate 2 50 页夹具在 demo 中重新回到 viewport virtualization 语义，不再因为宿主高度回退导致 50 页 canvas 同时保留。

## 11. 禁止事项

- [ ] 不把整个 `examples/vanilla/src/main.ts` 原样拆文件后塞进 `packages/ui`。
- [ ] 不改变现有 command 语义、transaction pipeline、mixed state、颜色冻结选区或 undo/redo 业务行为。
- [ ] 不把 demo-only 场景按钮包装成“官方 toolbar 内建工具”。
- [ ] 不为了“可配置”提前做完整插件系统。
- [ ] 不让 `examples/vanilla` 继续承担 Gate 4 的长期 UI 主体实现。
- [ ] 不让 `@4xian/jword-ui` 反向依赖 demo、docx、pdf、collab、React、Vue。
- [ ] 不忽略真实浏览器回归，只看单测和类型检查。

## 12. 完成定义

当以下条件同时满足，才认为这条方案真正落地：

- `@4xian/jword-ui` 已作为 workspace 包存在，并被 demo 真实消费。
- demo 已退化为宿主装配壳，而不是继续承载官方可复用 UI 主逻辑。
- Gate 3 现有 toolbar/assistive 行为在真实浏览器中没有回退。
- Gate 4 的 UI 子项已经明确约束为“进入 `packages/ui`”，不再允许回到 `examples/vanilla/src/main.ts` 扩张。
