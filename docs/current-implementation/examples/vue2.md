# Vue 2 示例当前实现摘要

## Demo 做什么

`examples/vue2` 是 Vue 2 集成示例。当前仓库没有 Vue 2 wrapper 包，因此该示例不使用 `@4xian/jword-vue`，而是在 Vue 2 Options API 生命周期里直接组合 `@4xian/jword-core`、`@4xian/jword-ui` 和 `@4xian/jword-native`。它演示 Vue 2 项目如何创建 editor、挂载官方 DOM UI、写入示例文档、保存 `.jword`、导出 diagnostics、销毁 editor。

当前状态：已完成。示例采用 Vue 2 SFC `<template>` 与 Options API，已通过 typecheck、build 和示例公共导入/常见组件语法架构检查；本地验证日志见 `.logs/jw-vue2-demo-2026-07-07/`。

## 依赖哪些包

运行依赖来自 `examples/vue2/package.json`：

- `@4xian/jword-core`
- `@4xian/jword-ui`
- `@4xian/jword-native`
- `vue` 2.7.16

开发依赖：

- `@vitejs/plugin-vue2`：编译 Vue 2 SFC。
- Vite/esbuild 由 workspace 根依赖提供，示例自身只声明 Vue 2 SFC 插件。

当前 `vite build` 会打印 `transformWithEsbuild` deprecation 提示和大 chunk 提示，但 `pnpm --filter @4xian/jword-example-vue2 build` 可以完成构建。

## 真实代码入口

- 页面入口：`examples/vue2/index.html`
- Vue 2 挂载入口：`examples/vue2/src/main.ts`
- Vue 2 组件：`examples/vue2/src/App.vue`
- 示例样式：`examples/vue2/src/styles.css`
- Vue 2 full build / SFC 类型声明：`examples/vue2/src/vue2-full-build.d.ts`
- Vite 配置：`examples/vue2/vite.config.ts`
- TypeScript 配置：`examples/vue2/tsconfig.json`

## 实现方案

- `main.ts` 从 `vue/dist/vue.esm.js` 导入 Vue 2 full build，找到 `#app`，引入官方 UI CSS 与示例 CSS，然后用模板 `<JWordVue2ExampleApp />` 挂载 SFC。
- `App.vue` 使用 `<template>` 模板和 Vue 2 Options API：`data()`、`mounted()`、`beforeDestroy()`、`methods`。
- 示例源码不使用 `render()`、`createElement()` 或 Vue 3 `h()` 写 UI 树；模板结构直接保留在 SFC `<template>` 中。
- `mounted()` 读取 `toolbarHost`、`editorHost`、`liveRegionHost`、`assistiveMirrorHost` refs。
- `createEditor({ initialText: 'Vue 2 integration initial document' })` 创建 core editor，`editor.mount(editorHost)` 挂载编辑器正文。
- `createJWordUi({ editor, editorHost, toolbarHost, liveRegionHost, assistiveMirrorHost })` 装配官方 toolbar、live region 与辅助镜像。
- Vue data 只保存 `diagnosticCount`、`documentStatus`、`saveStatus`、`destroyStatus`，不保存文档副本。
- `writeExampleDocument()` 通过 `runtime.editor?.createDocument()` 写入示例文本。
- `saveCurrentDocument()` 通过 `saveJWordDocument(editor, { requestId: 'vue2-example-save' })` 保存 `.jword`。
- `exportDiagnostics()` 读取 `runtime.editor?.exportDiagnostics()`。
- `destroyRuntime()` 先销毁 UI，再销毁 editor；`beforeDestroy()` 和按钮都复用该清理逻辑。

## 启动命令

```bash
pnpm --filter @4xian/jword-example-vue2 dev
pnpm --filter @4xian/jword-example-vue2 typecheck
pnpm --filter @4xian/jword-example-vue2 build
```

## 使用方式

访问 Vue 2 dev server 后，页面包含：

- `写入示例文本`：通过 core editor facade 写入文档。
- `保存 .jword`：调用 native package 保存当前文档。
- `导出 diagnostics`：读取 editor facade 的 diagnostics snapshot。
- `销毁 editor`：销毁 UI 与 editor runtime。

页面测试/定位属性包括 `data-jword-vue2-example`、`data-jword-vue2-input`、`data-jword-vue2-document`、`data-jword-vue2-save`、`data-jword-vue2-save-status`、`data-jword-vue2-diagnostics`、`data-jword-vue2-destroy`、`data-jword-vue2-destroy-status`。

## 测试/验证命令

当前 focused 验证入口：

```bash
pnpm --filter @4xian/jword-example-vue2 typecheck
pnpm --filter @4xian/jword-example-vue2 build
pnpm exec vitest run tests/architecture/gate7-examples-public-imports.test.ts
```

2026-07-07 focused 验证结果：

| 命令 | 状态 | 说明 |
| --- | --- | --- |
| `pnpm --filter @4xian/jword-example-vue2 typecheck` | 通过 | `tsc -p tsconfig.json --noEmit` 退出码 0。 |
| `pnpm --filter @4xian/jword-example-vue2 build` | 通过 | Vite build 退出码 0；保留 `transformWithEsbuild` deprecation 和大 chunk 提示作为非阻断输出。 |
| `pnpm exec vitest run tests/architecture/gate7-examples-public-imports.test.ts --reporter=verbose` | 通过 | 3 个架构测试通过，锁定 Vue 2 示例使用 package 入口、SFC `<template>` 与 Options API，且不使用 `render()` / `createElement()`。 |

## 当前限制

- 这是 Vue 2 SFC 直接集成示例，不是 Vue 2 wrapper 包，也不提供 Vue 2 SSR wrapper。
- 示例不覆盖复杂业务 UI、插件生态、协作或浏览器 E2E 流程。
- `build` 脚本只运行 `vite build`，不包含 typecheck；需要单独跑 `typecheck`。
- 根 `pnpm typecheck` 不把 Vue 2 SFC ambient 与 Vue 3 SFC ambient 放在同一个 TS project 中校验；Vue 2 示例以 `pnpm --filter @4xian/jword-example-vue2 typecheck` 为准。
- Vite/tsconfig alias 指向 workspace 源码，不等同外部 no-alias 消费验证。
- 保存 `.jword` 只演示 native package 入口，不包含文件选择打开、history 或协作状态保存。
