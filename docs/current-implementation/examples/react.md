# React 示例当前实现摘要

## Demo 做什么

`examples/react` 是 React wrapper 的最小第三方使用示例。它使用常见 TSX 组件写法挂载 `JWordReactEditor`，通过 ref 读取 editor facade，演示写入示例文档、保存 `.jword`、导出 diagnostics、销毁 editor。示例不实现复杂业务 UI，也不把 React state 作为文档真源。

## 依赖哪些包

运行依赖来自 `examples/react/package.json`：

- `@4xian/jword-react`
- `@4xian/jword-native`
- `@4xian/jword-ui`：用于显式引入 `@4xian/jword-ui/styles.css`
- `react`
- `react-dom`

开发依赖：`@vitejs/plugin-react`。Vite/tsconfig 在 workspace 开发态把 `@4xian/jword-react`、`@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` alias 到源码入口；业务源码仍只写 package specifier。

## 真实代码入口

- 页面入口：`examples/react/index.html`
- React 挂载入口：`examples/react/src/main.tsx`
- 主要组件：`examples/react/src/App.tsx`
- 示例样式：`examples/react/src/styles.css`
- Vite 配置：`examples/react/vite.config.ts`
- TypeScript 配置：`examples/react/tsconfig.json`

## 实现方案

- `main.tsx` 找到 `#root`，引入官方 UI CSS 与示例 CSS，然后执行 `createRoot(root).render(<JWordReactExampleApp />)`。
- `App.tsx` 使用函数组件、hooks 和 JSX，不再用 `React.createElement()` 手写渲染树。
- `JWordReactEditor` 通过 `defaultValue={{ text: 'React wrapper initial document' }}` 初始化。
- `useRef<JWordReactEditorHandle | null>()` 保存 wrapper handle，只通过 `editorRef.current?.editor` 调用 core facade。
- `editor.createDocument({ text: 'React wrapper edited document' })` 写入示例文本，React state 只保存按钮状态文案。
- `saveJWordDocument(editor, { requestId: 'react-example-save' })` 保存当前文档，并在页面显示字节数。
- `editorRef.current?.exportDiagnostics()` 与 `onDiagnostics(snapshot)` 更新 diagnostics 计数。
- `editorRef.current?.destroy()` 幂等销毁 wrapper 持有的 UI/editor。
- 示例 CSS 只负责 demo 外层布局和边框；官方工具栏样式来自 `@4xian/jword-ui/styles.css`。

## 启动命令

```bash
pnpm --filter @4xian/jword-example-react dev
pnpm --filter @4xian/jword-example-react typecheck
pnpm --filter @4xian/jword-example-react build
```

## 使用方式

访问 React dev server 后，页面包含：

- `写入示例文本`：通过 wrapper ref 的 editor facade 写入文档。
- `保存 .jword`：调用 native package 保存当前文档。
- `导出 diagnostics`：读取 wrapper handle 的 diagnostics snapshot。
- `销毁 editor`：调用 wrapper handle 的 `destroy()`。

页面测试/定位属性包括 `data-jword-react-example`、`data-jword-react-input`、`data-jword-react-document`、`data-jword-react-save`、`data-jword-react-save-status`、`data-jword-react-diagnostics`、`data-jword-react-destroy`、`data-jword-react-destroy-status`。

## 测试/验证命令

示例目录当前没有独立 `tests/`。Focused 验证入口：

```bash
pnpm --filter @4xian/jword-example-react typecheck
pnpm --filter @4xian/jword-example-react build
pnpm exec vitest run packages/react/test/react-wrapper.test.ts packages/react/test/react-ssr.test.ts tests/architecture/gate7-react-wrapper.test.ts tests/architecture/gate7-examples-public-imports.test.ts
```

## 当前限制

- 示例是 wrapper smoke，不覆盖复杂业务 UI、插件生态、协作或浏览器 E2E 流程。
- `build` 脚本只运行 `vite build`，不包含 typecheck；需要单独跑 `typecheck`。
- Vite/tsconfig alias 指向 workspace 源码，不等同外部 no-alias 消费验证。
- 保存 `.jword` 只演示 native package 入口，不包含文件选择打开、history 或协作状态保存。
- `destroy()` 后页面只更新状态文案，不提供重新创建 editor 的 UI。
