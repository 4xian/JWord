# Gate 7 Wrapper / Theme / Devtools 详细设计（2026-07-06）

## 1. 背景与目标

来源：`2026-07-02-gate7-review.md` §2.2、§2.3、§2.4，`2026-07-02-plan-review.md` §1 / §3.2 / §3.20，以及修复计划 Phase 6 `[gate7 2.2/2.3/2.4]`。

本设计只冻结 Gate 7 后续实现方案，不创建 `packages/react`、`packages/vue` 或 `packages/devtools` 代码。后续实现必须保持：

1. wrapper 不保存第二份编辑状态，只负责生命周期、props 到 `EditorOptions`、事件桥接和 DOM mount。
2. theme / i18n 不引入重型 runtime，不进入 core；UI 仍以 CSS class + host options 消费。
3. devtools 独立包、显式 opt-in、按需加载，不进入 vanilla 免费首屏 bundle。
4. wrapper / devtools 只消费已经冻结或明确 experimental 的 core/UI API，不读取 `packages/*/src/*` 内部路径。
5. 前端样式实现时禁止 CSS grid 和 gap；布局使用 flex、margin、padding 和 CSS 变量。

## 2. 产物拆分

| 能力 | 包 / 示例 | 入口 | 本设计冻结范围 |
|---|---|---|---|
| React wrapper | `packages/react` / `examples/react` | `@4xian/jword-react` | 生命周期、ref、事件桥接、StrictMode、受控/非受控、错误边界 |
| Vue 3 wrapper | `packages/vue` / `examples/vue` | `@4xian/jword-vue` | `defineExpose`、provide/inject、composable、SSR 空壳 |
| Theme/i18n | `packages/ui` + wrappers 透传 | `createJWordUi({ theme, locale })` | CSS 变量、暗色模式、字典覆盖、a11y 文案 |
| Devtools | `packages/devtools` / demo opt-in | `@4xian/jword-devtools` | 浮动面板、operation/layout/selection/perf/license/diagnostics 面板 |

## 3. React wrapper 设计

### 3.1 API 草案

```ts
interface JWordReactEditorProps {
  readonly initialDocument?: EditorDocumentInput
  readonly value?: EditorDocumentModelInput
  readonly defaultValue?: EditorDocumentInput
  readonly editorOptions?: Omit<EditorOptions, 'initialText' | 'resources'>
  readonly uiOptions?: Omit<CreateJWordUiOptions, 'editor'>
  readonly className?: string
  readonly style?: React.CSSProperties
  readonly readOnly?: boolean
  readonly onEditorReady?: (editor: Editor) => void
  readonly onTransaction?: (event: TransactionEvent) => void
  readonly onSelectionChange?: (selection: SelectionState | null) => void
  readonly onError?: (event: Extract<EditorEvent, { kind: 'error' }>) => void
  readonly onDiagnosticsExport?: (snapshot: JWordDiagnosticsSnapshot) => void
}

interface JWordReactEditorHandle {
  readonly editor: Editor | null
  focus(): void
  exportDiagnostics(): JWordDiagnosticsSnapshot | null
  destroy(): void
}
```

### 3.2 生命周期

1. `useLayoutEffect` 在浏览器端创建 `Editor` 和 UI，挂载到 wrapper 内部 `div`。
2. `useEffect` 订阅 editor events，并在 cleanup 中按顺序销毁 UI 与 editor。
3. StrictMode 双挂载：每次 mount 都创建独立 editor；cleanup 必须幂等，避免复用已销毁 editor。
4. props 中影响 editor 初始化的字段变化时，默认不热重建；需要显式 `key` 触发重建。
5. `readOnly` 作为 UI/runtime option 透传；它不是安全授权边界。

### 3.3 ref 与上下文

- 使用 `forwardRef` + `useImperativeHandle` 暴露 `JWordReactEditorHandle`。
- 提供 `JWordEditorProvider` 与 `useJWordEditor()`；context 只暴露当前 `Editor | null` 和 diagnostics helper，不暴露内部 DOM。
- 禁止 wrapper 把 selection、projection 或 layout 复制到 React state 中作为第二真源；如需展示状态，只存轻量快照。

### 3.4 受控 / 非受控

- 第一版默认非受控：`defaultValue` / `initialDocument` 初始化 editor，之后由 editor 内部 transaction 管理。
- 受控 `value` 只用于宿主明确接管文档模型的场景；更新时调用 `editor.loadDocumentModel()`，并要求宿主处理 transaction echo 防抖。
- 不提供逐字符 `onChange(value)` 默认模式，避免 React state 成为第二份编辑状态。

### 3.5 SSR / Suspense / 错误边界

- SSR 输出空壳 `<div data-jword-react="ssr" />`，不访问 `window`、`document` 或 `HTMLElement`。
- Suspense 不参与 editor 内部加载；外部可用 Suspense 包裹动态 import wrapper。
- `JWordReactErrorBoundary` 只捕获 wrapper render/mount/update 错误，附件只能使用 `editor.exportDiagnostics()` 安全快照。

### 3.6 验收

- Vitest + jsdom：StrictMode 双挂载创建/销毁次数成对、ref 暴露 editor、事件桥接不重复。
- Playwright：`examples/react` 初始化、输入、toolbar 操作、diagnostics export。
- Type tests：第三方项目只从 `@4xian/jword-react` 导入，不使用 monorepo alias。

## 4. Vue 3 wrapper 设计

### 4.1 API 草案

```ts
interface JWordVueEditorProps {
  readonly initialDocument?: EditorDocumentInput
  readonly modelValue?: EditorDocumentModelInput
  readonly defaultValue?: EditorDocumentInput
  readonly editorOptions?: Omit<EditorOptions, 'initialText' | 'resources'>
  readonly uiOptions?: Omit<CreateJWordUiOptions, 'editor'>
  readonly readonly?: boolean
}
```

组件事件：`ready(editor)`、`transaction(event)`、`selection-change(selection)`、`error(event)`、`diagnostics-export(snapshot)`。

### 4.2 生命周期与暴露

1. `onMounted` 创建 editor/UI 并 mount 到 `ref<HTMLElement>()`。
2. `onBeforeUnmount` 幂等销毁 UI/editor。
3. `defineExpose({ editor, focus, exportDiagnostics, destroy })` 暴露实例方法。
4. `provide(JWORD_EDITOR_KEY, editorRef)`，`useJWordEditor()` 通过 inject 返回 readonly ref。

### 4.3 SSR 空壳

- SSR 只渲染容器，不创建 editor。
- hydration 后再在 `onMounted` 创建 editor。
- 任何读取 DOM、ResizeObserver、Canvas 的逻辑都只能在 mounted 后运行。

### 4.4 受控 / 非受控

- 默认非受控，`defaultValue` 初始化。
- `modelValue` 只支持文档模型级替换，不做逐字符 v-model。
- 当 `modelValue` 与当前 documentId / version 相同，wrapper 不重复 load，避免 transaction loop。

### 4.5 验收

- Vitest + Vue Test Utils：mount/unmount、`defineExpose`、provide/inject、事件桥接。
- SSR smoke：服务端 render 不访问 DOM。
- Playwright：`examples/vue` 初始化、输入、toolbar、diagnostics export。

## 5. Theme / i18n 设计

### 5.1 Theme token

Theme 使用 CSS custom properties，落点在 `packages/ui/src/styles/toolbar.css` 与后续 UI 样式文件：

```css
.jw-root {
  --jw-color-surface: #ffffff;
  --jw-color-surface-muted: #f8fafc;
  --jw-color-text: #0f172a;
  --jw-color-border: #cbd5e1;
  --jw-color-accent: #2563eb;
  --jw-focus-ring: #1d4ed8;
}

.jw-root[data-theme="dark"] {
  --jw-color-surface: #0f172a;
  --jw-color-text: #e2e8f0;
}
```

规则：

- class 继续使用 `jw-` 前缀，不引入 CSS-in-JS。
- 主题切换通过 `data-theme="light|dark"` 和可选 host class；wrapper 只透传。
- 插件 UI 扩展只能消费变量，不写全局样式。
- 暗色模式首批只覆盖 editor shell、toolbar、menu、dialog、selection action、comments/find-replace/table/media 控件。
- WCAG AA 对比度写入后续 visual/a11y 验收。

### 5.2 i18n 字典

```ts
type JWordLocaleMessages = Readonly<Record<JWordLocaleKey, string>>

interface JWordLocaleOptions {
  readonly locale?: string
  readonly messages?: Partial<JWordLocaleMessages>
}
```

规则：

- 默认字典放在 `packages/ui`，不引入 i18next 等重依赖。
- `createJWordUi({ locale })` 接收局部覆盖，缺失 key 回退默认中文。
- 覆盖范围：toolbar label、menu item、dialog button、a11y label、live region、常见错误提示。
- core 错误码不本地化；UI 根据 code 映射为可本地化文案。
- RTL 布局不作为 1.0 默认承诺，只保留 `dir` 透传和文本对齐不破坏。

### 5.3 验收

- 单测：缺失 key 回退默认字典，局部覆盖生效。
- a11y：button aria-label 和 live region 使用 locale 文案。
- 视觉：light/dark 两套 token 在 Chromium 下截图不破版。

## 6. Devtools 设计

### 6.1 包边界

- 独立包：`@4xian/jword-devtools`。
- 入口：`createJWordDevtools({ editor, mount, position, initialOpen })`。
- devtools 必须由宿主显式 import 或动态 import，禁止被 `createEditor()`、`createJWordUi()` 或 vanilla 默认入口静态导入。
- Chrome Extension 进入 post-1.0；1.0 只做浮动面板。

### 6.2 数据来源

| 面板 | 数据来源 | 隐私规则 |
|---|---|---|
| Operation log | `editor.subscribe('transaction')` | 记录 commandName、origin、operationKinds、diagnostic，不记录文本内容 |
| Selection / anchor | `editor.getSelection()`、公开 location API | 只显示 ID / grapheme index，不显示选中文本 |
| Layout overlay | `editor.getLayout()` 摘要 + overlay 开关 | 可显示 page/line/box 几何，不显示 run text |
| Performance | transaction duration、layout/render measure、bundle metadata | 数字指标，不含正文 |
| Package versions | package metadata | 版本号与 edition |
| License / feature | license diagnostics / feature flags | 不显示 token 原文 |
| Diagnostics export | `editor.exportDiagnostics()` | 使用安全快照 |

### 6.3 性能预算

- 默认关闭；关闭时不订阅 editor。
- 开启后 operation log ring buffer 默认 200 条。
- layout overlay 只在用户打开 overlay 时读取 layout。
- 每次 transaction 的 devtools 处理目标 < 2ms；超出时记录 devtools 自身 warning，不影响 editor。

### 6.4 UI 方案

- 浮动面板固定在 host 容器内；拖拽/停靠可后置。
- 样式使用 flex + margin/padding，不使用 CSS grid 或 gap。
- 面板必须可键盘关闭、切换 tab，并保持 aria label。

### 6.5 验收

- Vitest：ring buffer、diagnostics export 隐私、禁文本内容。
- Playwright：动态 import 后浮动面板可打开，operation log 增长，overlay 开关不破坏编辑。
- Size：`pnpm size` 证明 devtools token 不进入 vanilla 免费首屏。

## 7. 实施顺序

1. Theme/i18n 先落 `packages/ui` 轻量 contract，避免 wrapper 先复制硬编码文案。
2. React/Vue wrapper 基于同一 `createEditor` + `createJWordUi` 装配 helper 实现，不拆第二套 runtime。
3. Devtools 只消费 public/experimental API；若发现需要新增 diagnostics 字段，先回到 Gate 7 diagnostics/export 任务冻结 schema。
4. 每个包落地后都要补 no-alias external smoke，不能只靠 monorepo examples。
