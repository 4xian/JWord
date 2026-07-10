# Vue 3 示例当前实现摘要

## Demo 做什么

`examples/vue` 是 Vue 3 wrapper 的最小第三方使用示例。它使用常见 Vue SFC 写法挂载 `JWordVueEditor`，通过组件 ref 读取 editor facade，演示写入示例文档、保存 `.jword`、导出 diagnostics、销毁 editor。示例不实现复杂业务 UI，也不把 Vue ref 作为文档真源。

## 依赖哪些包

运行依赖来自 `examples/vue/package.json`：

- `@4xian/jword-vue`
- `@4xian/jword-native`
- `@4xian/jword-ui`：用于显式引入 `@4xian/jword-ui/styles.css`
- `vue`

开发依赖：`@vitejs/plugin-vue`。Vite/tsconfig 在 workspace 开发态把 `@4xian/jword-vue`、`@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` alias 到源码入口；业务源码仍只写 package specifier。

## 真实代码入口

- 页面入口：`examples/vue/index.html`
- Vue 挂载入口：`examples/vue/src/main.ts`
- 主要组件：`examples/vue/src/App.vue`
- SFC 类型声明：`examples/vue/src/vite-env.d.ts`
- 示例样式：`examples/vue/src/styles.css`
- Vite 配置：`examples/vue/vite.config.ts`
- TypeScript 配置：`examples/vue/tsconfig.json`

## 实现方案

- `main.ts` 找到 `#app`，引入官方 UI CSS 与示例 CSS，然后执行 `createApp(JWordVueExampleApp).mount(root)`。
- `App.vue` 使用 `<template>` + `<script setup lang="ts">`，不再用 `defineComponent(... setup() { return () => h(...) })` 手写渲染函数。
- `JWordVueEditor` 通过 `:default-value="initialDocument"` 初始化。
- `ref<JWordVueEditorHandle | null>()` 保存 wrapper expose handle，只通过 `editorRef.value?.editor` 调用 core facade。
- `editor.createDocument({ text: 'Vue wrapper edited document' })` 写入示例文本，Vue ref 只保存按钮状态文案。
- `saveJWordDocument(editor, { requestId: 'vue-example-save' })` 保存当前文档，并在页面显示字节数。
- `editorRef.value?.exportDiagnostics()` 与 `@diagnostics-export` 更新 diagnostics 计数。
- `editorRef.value?.destroy()` 幂等销毁 wrapper 持有的 UI/editor。
- 示例 CSS 只负责 demo 外层布局和边框；官方工具栏样式来自 `@4xian/jword-ui/styles.css`。

## 启动命令

```bash
pnpm --filter @4xian/jword-example-vue dev
pnpm --filter @4xian/jword-example-vue typecheck
pnpm --filter @4xian/jword-example-vue build
```

## 使用方式

访问 Vue dev server 后，页面包含：

- `写入示例文本`：通过 wrapper ref 的 editor facade 写入文档。
- `保存 .jword`：调用 native package 保存当前文档。
- `导出 diagnostics`：读取 wrapper handle 的 diagnostics snapshot。
- `销毁 editor`：调用 wrapper handle 的 `destroy()`。

页面测试/定位属性包括 `data-jword-vue-example`、`data-jword-vue-input`、`data-jword-vue-document`、`data-jword-vue-save`、`data-jword-vue-save-status`、`data-jword-vue-diagnostics`、`data-jword-vue-destroy`、`data-jword-vue-destroy-status`。

## 测试/验证命令

示例目录当前没有独立 `tests/`。Focused 验证入口：

```bash
pnpm --filter @4xian/jword-example-vue typecheck
pnpm --filter @4xian/jword-example-vue build
pnpm exec vitest run packages/vue/test/vue-wrapper.test.ts packages/vue/test/vue-ssr.test.ts tests/architecture/gate7-vue-wrapper.test.ts tests/architecture/gate7-examples-public-imports.test.ts
```

## 当前限制

- 示例是 Vue 3 wrapper smoke，不覆盖复杂业务 UI、插件生态、协作或浏览器 E2E 流程。
- `build` 脚本只运行 `vite build`，不包含 typecheck；需要单独跑 `typecheck`。
- `tsc` 只校验入口脚本和 `.vue` 模块声明，SFC 模板由 Vite Vue 插件编译。
- Vite/tsconfig alias 指向 workspace 源码，不等同外部 no-alias 消费验证。
- 保存 `.jword` 只演示 native package 入口，不包含文件选择打开、history 或协作状态保存。
- `destroy()` 后页面只更新状态文案，不提供重新创建 editor 的 UI。
