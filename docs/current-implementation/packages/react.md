# @4xian/jword-react 当前实现摘要

## 包职责

`@4xian/jword-react` 是 React 生命周期 wrapper。它负责创建 core `Editor`、挂载 UI、桥接 editor 事件、暴露 ref handle、提供 React context 读取入口和错误边界；不保存第二份文档状态，不读取 core/ui 内部 `src` 路径。

## 入口与导出

- 包名：`@4xian/jword-react`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`@4xian/jword-ui`。
- Peer dependencies：`react` 19.2.7、`react-dom` 19.2.7。

## 公开 API 摘要

根入口导出：

- `JWordReactEditor`
- `JWordReactEditorProps`
- `JWordReactEditorHandle`
- `JWordReactErrorBoundary`
- `JWordEditorProvider`
- `useJWordEditor()`
- `useJWordEditorHandle()`
- 事件类型别名：`JWordReactTransactionEvent`、`JWordReactSelectionChangeEvent`、`JWordReactErrorEvent`

## 主要组件/API

`JWordReactEditor` 使用 `forwardRef` 暴露 `JWordReactEditorHandle`。handle 提供：

- `editor` getter
- `focus()`
- `exportDiagnostics()`
- `destroy()`

Props 覆盖：

- 初始化：`initialDocument`、`defaultValue`
- 受控模型级替换：`value`
- 配置透传：`editorOptions`、`uiOptions`
- 外层：`className`、`style`
- 只读：`readOnly`
- 事件：`onReady`、`onTransaction`、`onSelectionChange`、`onError`、`onDiagnostics`

`JWordEditorProvider` / `useJWordEditorHandle()` / `useJWordEditor()` 只通过 React context 暴露 handle/editor，不暴露内部 DOM。

`JWordReactErrorBoundary` 只捕获 React wrapper 渲染树错误；它不是权限沙箱，插件仍运行在宿主同一 JS realm。

## SSR/生命周期方案

- SSR 阶段通过 `typeof window === 'undefined'` 切到 `React.useEffect`，渲染空壳 DOM，并标记 `data-jword-react="ssr"`。
- SSR 不创建 editor、不访问 DOM。
- 浏览器 mount 时读取 wrapper 内部 `editorHost`、`toolbarHost` 等 refs，用 `createEditor()` 创建 core editor。
- `defaultValue` 优先于 `initialDocument`；若传入 `value`，调用 `editor.loadDocumentModel(value)`。
- 调用 `editor.mount(editorHost)`，再调用 `createJWordUi()` 装配 toolbar/live region/assistive mirror。
- 订阅 `editor.subscribe()`，桥接 transaction、selectionChange、error；error 时同步导出 diagnostics。
- Cleanup 顺序为 unsubscribe -> `ui.destroy()` -> `editor.destroy()`，且 `destroy()` 可通过 ref 幂等触发。
- `value` 的后续变化只做 document model 级 `loadDocumentModel()`，不是逐字符 React 受控编辑模式。

## 内部实现方案

- `JWordReactEditor` 在浏览器 effect 中创建 core editor，挂载 editor host 后再调用 `createJWordUi()` 装配 DOM UI。
- SSR 阶段只渲染空壳 DOM，不创建 editor、不访问 DOM API。
- 组件通过 `forwardRef` 暴露 handle；context provider/composable 只共享 handle/editor 引用，不复制文档状态。
- 订阅 core editor event，把 transaction、selectionChange、error 转成 React props callback；错误时同步导出 diagnostics。
- Cleanup 按 unsubscribe、UI destroy、editor destroy 顺序执行，避免 UI 订阅悬挂。


## 与其它包关系

- 只从 core 导入 `createEditor` 和公开类型。
- 只从 UI 导入 `createJWordUi` 与公开 UI 类型。
- UI DOM 宿主由 wrapper 内部 refs 管理，core editor 仍是唯一文档真源。
- `examples/react` 只通过 package 入口使用 wrapper 和 native。

## 主要测试/验收入口

- `packages/react/test/react-ssr.test.ts`
- `packages/react/test/react-wrapper.test.ts`
- `tests/architecture/gate7-react-wrapper.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/architecture/gate7-examples-public-imports.test.ts`
- `tests/types/gate7-public-api-entrypoints.ts`
- `examples/react/src/App.tsx`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-react typecheck`：校验 React wrapper props、handle、context 与事件类型。
- `pnpm --filter @4xian/jword-react test`：运行 React SSR 与 wrapper 生命周期测试。
- `pnpm --filter @4xian/jword-react build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate7-react-wrapper.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-examples-public-imports.test.ts`：回归 React wrapper 架构、公开 API catalog 与示例公开导入。
- `pnpm test:types`：验证第三方类型入口能从 package 名称消费 React wrapper 类型。

## 当前限制/注意点

- `defaultValue` / `initialDocument` 只在首次 mount 消费；初始化相关 props 变化不会自动热重建，宿主需用 React `key` 显式重建。
- `value` 是 document model 级替换，不是逐字符 `onChange(value)` 模式；宿主需自行避免 transaction echo loop。
- Context provider 不由 `JWordReactEditor` 自动包裹子树；需要 context 的宿主应显式使用 `JWordEditorProvider`。
- `readOnly` 只作为 UI/runtime 交互状态透传，不是安全授权边界。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/react/package.json`
- `packages/react/src/index.ts`
- `packages/react/test/react-ssr.test.ts`
- `packages/react/test/react-wrapper.test.ts`
- `examples/react/src/App.tsx`

