# @4xian/jword-vue 当前实现摘要

## 包职责

`@4xian/jword-vue` 是 Vue 3 生命周期 wrapper。它负责 Vue mounted/unmounted 生命周期中的 editor/UI 创建与销毁、事件桥接、`expose` handle、provide/inject composable；不保存第二份文档状态，不读取 core/ui 内部路径。

## 入口与导出

- 包名：`@4xian/jword-vue`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`@4xian/jword-ui`。
- Peer dependency：`vue` 3.5.39。

## 公开 API 摘要

根入口导出：

- `JWordVueEditor`
- `JWordVueEditorProps`
- `JWordVueEditorHandle`
- `JWORD_VUE_EDITOR_KEY`
- `useJWordEditor()`
- `useJWordEditorHandle()`
- 事件类型别名：`JWordVueTransactionEvent`、`JWordVueSelectionChangeEvent`、`JWordVueErrorEvent`

## 主要组件/API

`JWordVueEditor` 是 `defineComponent` 组件。props 覆盖：

- 初始化：`initialDocument`、`defaultValue`
- 受控模型级替换：`modelValue`
- 配置透传：`editorOptions`、`uiOptions`
- 只读：`readonly`

Emits 覆盖：

- `ready`
- `transaction`
- `selection-change`
- `error`
- `diagnostics-export`

组件通过 `expose(handle)` 暴露 `editor` getter、`focus()`、`exportDiagnostics()`、`destroy()`。同时通过 `provide(JWORD_VUE_EDITOR_KEY, readonlyRef(handleRef))` 给 slot 子树提供 handle；`useJWordEditor()` 返回 computed readonly ref，未挂载或销毁后 editor 为 `null`。

## SSR/生命周期方案

- SSR 阶段只渲染容器 DOM，根节点标记 `data-jword-vue="ssr"`。
- Editor 创建逻辑只在 `onMounted()` 中执行，因此 SSR 不访问 DOM、Canvas、ResizeObserver 等浏览器对象。
- 浏览器 mounted 时读取 `editorHostRef`、`toolbarHostRef`，用 `createEditor()` 创建 core editor。
- `defaultValue` 优先于 `initialDocument`；若传入 `modelValue`，调用 `editor.loadDocumentModel(modelValue)`。
- 调用 `editor.mount(editorHost)`，再调用 `createJWordUi()` 装配 toolbar/live region/assistive mirror。
- 订阅 `editor.subscribe()`，将 transaction、selectionChange、error 转为 Vue emits；error 时同步 emit diagnostics snapshot。
- `onBeforeUnmount()` 调用 destroyRuntime，顺序为 unsubscribe -> `ui.destroy()` -> `editor.destroy()`。
- `watch(() => props.modelValue)` 在 `modelValue !== undefined` 时做 document model 级 `loadDocumentModel()`，不是逐字符 `v-model`。

## 内部实现方案

- `JWordVueEditor` 在 `onMounted()` 中创建 core editor，挂载 editor host 后再调用 `createJWordUi()` 装配 DOM UI。
- SSR 阶段只渲染容器 DOM，不访问 DOM、Canvas 或 ResizeObserver。
- 组件通过 `expose(handle)` 暴露 editor handle，并通过 provide/inject 向 slot 子树提供 readonly handle ref。
- 订阅 core editor event，把 transaction、selectionChange、error 转成 Vue emits；错误时同步 emit diagnostics snapshot。
- `onBeforeUnmount()` 按 unsubscribe、UI destroy、editor destroy 顺序清理。


## 与其它包关系

- 只从 core 导入 `createEditor` 和公开类型。
- 只从 UI 导入 `createJWordUi` 与公开 UI 类型。
- UI DOM 宿主由 Vue refs 管理，core editor 仍是唯一文档真源。
- `examples/vue` 只通过 package 入口使用 Vue 3 wrapper、native 和 UI 样式入口。

## 主要测试/验收入口

- `packages/vue/test/vue-ssr.test.ts`
- `packages/vue/test/vue-wrapper.test.ts`
- `tests/architecture/gate7-vue-wrapper.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/architecture/gate7-examples-public-imports.test.ts`
- `tests/types/gate7-public-api-entrypoints.ts`
- `examples/vue/src/App.vue`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-vue typecheck`：校验 Vue wrapper props、expose handle、provide/inject 与事件类型。
- `pnpm --filter @4xian/jword-vue test`：运行 Vue SSR 与 wrapper 生命周期测试。
- `pnpm --filter @4xian/jword-vue build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate7-vue-wrapper.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-examples-public-imports.test.ts`：回归 Vue wrapper 架构、公开 API catalog 与示例公开导入。
- `pnpm test:types`：验证第三方类型入口能从 package 名称消费 Vue wrapper 类型。

## 当前限制/注意点

- `defaultValue` / `initialDocument` 只在首次 mounted 消费；初始化相关 props 变化不会自动重建。
- `modelValue` 是 document model 级替换；当前 watch 不做 documentId/version 去重，宿主需避免 echo loop。
- `readonly` 顶层 prop 优先于 `uiOptions.readonly`，它是交互状态，不是安全授权边界。
- Wrapper 根节点目前只设置 `data-jword-vue`，没有 React wrapper 那样的 `className/style` props。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/vue/package.json`
- `packages/vue/src/index.ts`
- `packages/vue/test/vue-ssr.test.ts`
- `packages/vue/test/vue-wrapper.test.ts`
- `examples/vue/src/App.vue`

