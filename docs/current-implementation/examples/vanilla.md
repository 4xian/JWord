# Vanilla 示例当前实现摘要

## Demo 做什么

`examples/vanilla` 是基础浏览器宿主 demo。它用 `@4xian/jword-core` 创建 editor facade，用 `@4xian/jword-ui` 装配官方 toolbar、底部状态栏、live region、assistive mirror 和各类面板，并提供 demo-only 控件与测试钩子，覆盖分页预览、基础编辑、toolbar、状态栏、媒体、表格、批注/链接、查找/目录、页眉页脚、修订、只读、窄屏适配、`.jword` 保存打开、theme/i18n 和 opt-in devtools。

## 依赖哪些包

运行依赖来自 `examples/vanilla/package.json`：

- `@4xian/jword-core`
- `@4xian/jword-ui`
- `@4xian/jword-native`
- `@4xian/jword-devtools`

开发依赖：`typescript`、`vite`。Vite 开发态通过 alias 指向 workspace 源码：core、ui、ui styles、native、native worker、devtools。

## 真实代码入口

- 页面入口：`examples/vanilla/index.html`
- 浏览器入口：`examples/vanilla/src/main.ts`
- Demo 控件：`examples/vanilla/src/demo-controls.ts`
- 图片/media 演示：`examples/vanilla/src/demo-media.ts`
- 表格演示：`examples/vanilla/src/demo-table.ts`
- `.jword` 保存/打开：`examples/vanilla/src/demo-native.ts`
- Native worker 入口：`examples/vanilla/src/native-worker.ts`
- Vite 配置：`examples/vanilla/vite.config.ts`
- 样式入口：`examples/vanilla/src/styles.css` 与 `@4xian/jword-ui/styles.css`

## 功能点

- `main.ts` 创建 editor、挂载 editor host、调用 `createJWordUi()`，并把 status/live region/assistive mirror 接到页面 DOM。
- 官方 UI 启用 toolbar、默认底部状态栏、media、table、comments、link、header/footer、heading outline、find/replace、revisions、readonly、theme 和 i18n。
- Demo 显式传入 `toolbarHost`，所以 demo-only 控件仍位于 toolbar 和 editor 之间；未传 `statusBar` 时官方状态栏自动挂入 `editorHost` 底部。
- Demo-only 控件包括：加载 Alpha 样例、恢复 Gate 2 大夹具、选择首页片段、清除选区、打开只读示例、保存 `.jword`、打开 `.jword`。
- Media demo 使用 `createCoreMediaCommandAdapter()`，提供同源 fixture URL、异步上传进度、失败/重试场景和上传日志测试钩子。
- Native demo 按需加载 `@4xian/jword-native` / `@4xian/jword-native/worker`，把当前 canonical document 保存为 `.jword`，并可从文件输入重新加载。
- Devtools 仅在 `?devtools=true` 时动态 import `@4xian/jword-devtools`，默认首屏不加载。
- `window.__jwordDemo` 暴露浏览器测试钩子：editor、destroy、选区、media、table、comments、native、devtools、link、revisions。

## 启动命令

```bash
pnpm --filter @4xian/jword-example-vanilla dev
pnpm --filter @4xian/jword-example-vanilla typecheck
pnpm --filter @4xian/jword-example-vanilla build
pnpm --filter @4xian/jword-example-vanilla preview
```

根命令 `pnpm dev` 当前也会委托到 vanilla demo。

## 使用方式

常用页面入口：

- `/`：默认 Alpha 文档和官方 UI。
- `/?fixture=gate2`：加载 Gate 2 大文档夹具。
- `/?readonly=true`：装配只读交互 guard。
- `/?devtools=true`：动态加载 devtools 面板。
- `/?theme=dark`：演示暗色 UI theme。
- `/?i18n=en`：演示英文 i18n 覆盖。
- `/?pluginError=throwing-command` / `?pluginError=throwing-adapter`：演示插件错误 diagnostics。

页面 DOM 入口包括 `#jword-toolbar`、`#jword-demo-controls`、`#jword-editor`、`#jword-status`、`#jword-assistive-mirror`。其中 `#jword-demo-controls` 是 demo-only 控制区，不属于 `@4xian/jword-ui` 自动三段式官方 UI。

## 测试/验证命令

Focused 单测/结构验证：

```bash
pnpm exec vitest run examples/vanilla/tests/demo-controls.test.ts examples/vanilla/tests/vite-config.test.ts examples/vanilla/tests/gate4_5-native-boundary.test.ts
```

Focused 浏览器验证示例：

```bash
pnpm exec playwright test examples/vanilla/tests/gate2.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate3-input.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate4-media.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate4-table.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate4-paste-narrow-viewport.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate4_5-native.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate7-devtools.e2e.ts --project=chromium
pnpm exec playwright test examples/vanilla/tests/gate7-theme-i18n.e2e.ts --project=chromium
```

待补 focused 状态栏验证：

```bash
pnpm exec playwright test examples/vanilla/tests/gate7-status-bar.e2e.ts --project=chromium
```

该 E2E 应覆盖默认状态栏显示、字数/页码/缩放、100% 还原、适应宽度、演示模式进入/退出、底部边缘唤出状态栏、暗色主题和英文语言。

视觉/性能入口：

```bash
pnpm exec playwright test examples/vanilla/tests/gate2.visual.ts --project=visual-chromium
pnpm exec playwright test examples/vanilla/tests/gate4.visual.ts --project=visual-chromium
pnpm exec playwright test examples/vanilla/tests/gate2.perf.e2e.ts --project=perf-chromium
pnpm exec playwright test examples/vanilla/tests/gate4.perf.e2e.ts --project=perf-chromium
```

## 当前限制

- 这是 monorepo 开发 demo，Vite alias 指向 workspace 源码，不等同外部 no-alias 消费验证。
- Demo-only 控件和 `window.__jwordDemo` 是验收钩子，不是 SDK 稳定 API。
- 图片上传是本地 demo adapter；默认 URL policy 只放行同源资源。
- `.jword` 保存/打开只覆盖 native package 路径，不保存协作 provider 状态或 history update log。
- 选择首页片段在大页数夹具上会主动禁用，避免把 demo 便捷选区当成大文档交互承诺。
- Devtools 必须显式 `?devtools=true`，不会自动进入默认首屏。
- 当前还缺少专门的 vanilla status bar focused E2E；状态栏主体行为已有 `packages/ui/test/create-ui-status-bar.test.ts` 和 `packages/ui/test/status-bar-state.test.ts` 覆盖。
