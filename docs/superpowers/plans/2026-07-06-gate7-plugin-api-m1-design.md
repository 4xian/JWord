# Gate 7 Plugin API M1 设计冻结

## 1. 目标与边界

本设计用于 Phase 6 `[gate7 2.1] Plugin 扩展点前置改造` 的 M1 冻结。目标是在不提前承诺完整 Gate 7 对外 API 的前提下，先冻结 core / ui 需要预留的扩展点形状，供 M2-M6 分批落地。

### 目标

- 在 `@4xian/jword-core` 中建立插件注册、命令扩展、命令拦截、生命周期事件、快捷键注册和诊断上报的最小骨架。
- 在 `@4xian/jword-ui` 中预留 toolbar / menu 扩展宿主，但 UI 扩展实际落地放到 M4。
- 所有插件异常都被隔离为 diagnostics / error event，不破坏 core 状态、selection、history 或协作连接。
- 通过 `createEditor({ plugins: [...] })` 注册插件，保持现有 `createEditor(options?: EditorOptions)` 入口兼容。

### 非目标

- M1 不实现代码，只冻结设计。
- M2 不引入自定义 Operation union，不允许插件写 Y.Doc、document-store 或 projection。
- Decorations 标记为 `experimental`，不阻塞 1.0；M3 只允许只读 layout/render 装饰。
- React/Vue wrapper、devtools、文档站正文仍按后续 Gate 7 条目推进。

## 2. 现状约束

### core 现状

- `createEditor(options?: EditorOptions)` 当前直接 `new JWordEditor(options)`，`EditorOptions` 只有 label、initialText、layout、page、resources、initialFocusPosition、resourceUrlPolicy、resourceAdapter、currentUser。
- `JWordEditorState` 持有 `pipeline`、`history`、`listeners`、`mountedDom`、selection 和 layout cache；当前没有插件 host。
- `executeCommand(command, options)` 直接计算 history metadata、dirty range 后调用 `this.pipeline.run(command, metadata)`。
- 输入和键盘路径分散在 `JWordEditorInputRuntime` / `JWordEditorKeyboardTextRuntime`，快捷键目前是内建硬编码路径。
- 当前 `TransactionEvent` 已有 `commandName`、`origin`、`operationKinds`、`projection`、`dirty`、`diagnostic`，适合作为 `afterTransaction` 事件的第一版载体。

### UI 现状

- `JWordToolbarToolId` 是固定联合类型，`JWordToolbarOptions.visibleTools/hiddenTools` 只能声明内建工具。
- `createToolbarController()` 内部已有 `createToolbarExtensionHost(dom.bar, 'media' | 'table' | 'link' | 'panel')` 一类内置 extension host，但没有对插件开放的 toolbar item registry。

### 设计约束

- 插件只能消费公开 facade、只读 projection、layout 快照和注册回调，不接触 Y.Doc、document-store、DOM Range、canvas 内部对象。
- 插件执行顺序必须稳定：按 `plugins` 数组顺序 setup；dispose 反序执行；同类 middleware / keybinding 按注册顺序处理。
- 插件 API 必须可被类型测试锁定，新增对外类型统一从包入口导出。

## 3. 外部参考口径

- Tiptap Extension：扩展有 `name`，通过 editor 初始化时的 extensions 数组注册，并可声明 commands 与 keyboard shortcuts。
- ProseMirror Plugin / keymap：插件可组合，keymap 插件顺序决定处理优先级，先注册者优先处理。
- Monaco Editor：采用 editor 实例级 command/action 注册和 disposable 清理模型；JWord 采用同类 disposable 概念，但不复制 Monaco 的编辑模型。

参考链接：

- https://tiptap.dev/docs/editor/extensions/custom-extensions/create-new/extension
- https://prosemirror.net/docs/ref/#state.PluginSpec
- https://microsoft.github.io/monaco-editor/docs.html

## 4. Core API 草案

### 4.1 PluginDefinition

```ts
export interface PluginDefinition {
  readonly name: string
  readonly version: string
  readonly setup: (context: PluginContext) => void | PluginDisposable | readonly PluginDisposable[]
}
```

规则：

- `name` 必须是稳定唯一 ID，建议格式为 `vendor.feature`。
- `version` 用于 diagnostics、support bundle 和未来兼容策略，不在 M2 做 semver enforcement。
- `setup()` 在 editor 构造完成、初始文档创建完成后运行；需要 DOM 的插件必须监听 `mount` 事件，不能在 setup 里读取 DOM。
- `setup()` 返回的 disposable 在 editor `destroy()` 时反序执行。

### 4.2 PluginContext

```ts
export interface PluginContext {
  readonly name: string
  readonly version: string
  readonly editor: Editor
  registerCommand(command: PluginCommandDefinition): PluginDisposable
  interceptCommand(middleware: PluginCommandMiddleware): PluginDisposable
  registerKeyBinding(binding: PluginKeyBindingDefinition): PluginDisposable
  on<EventName extends PluginLifecycleEventName>(
    eventName: EventName,
    listener: PluginLifecycleListener<EventName>
  ): PluginDisposable
  diagnostics: PluginDiagnosticsReporter
}
```

限制：

- `editor` 只暴露当前 `Editor` facade；插件不得假定具体 class 或访问 protected runtime。
- `registerCommand()` 只能注册插件命令，不扩展 core Operation union。
- `interceptCommand()` 可拒绝、替换或透传已有 command，但返回值必须是受控结构，不能直接执行 Y.Doc 写入。
- `on()` 第一版只稳定 `mount`、`destroy`、`afterTransaction`、`error`；`beforeTransaction` 与 `afterLayout` 先保留为 internal/experimental 评估项。

### 4.3 命令注册与拦截

```ts
export interface PluginCommandDefinition<Input = unknown> {
  readonly name: string
  readonly execute: (input: Input, context: PluginCommandContext) => Command | TransactionResult | void
}

export type PluginCommandMiddleware = (
  input: PluginCommandMiddlewareInput,
  next: PluginCommandNext
) => TransactionResult
```

M2 落地顺序：

1. `executeCommand()` 进入 pipeline 前先经过 plugin middleware chain。
2. middleware 可返回 `next(input)`、返回替换后的 command、或返回被拒绝的 diagnostic result。
3. 插件命令最终仍转换为现有 `Command` 或调用公开 `editor.executeCommand()`；M2 不允许新增自定义 operation kind。
4. 所有 middleware callback 包一层 plugin error boundary。

拒绝语义：

- 插件拒绝命令时，transaction 不应进入 pipeline，不写 history。
- 拒绝结果必须包含 `pluginName`、`commandName`、`reasonCode`，并通过 diagnostics 上报。

### 4.4 生命周期事件

稳定事件：

| 事件 | 触发点 | 载荷 |
|---|---|---|
| `mount` | editor DOM mount 完成后 | host、只读 projection、只读 layout summary |
| `destroy` | editor destroy 开始前 | reason、plugin disposal summary |
| `afterTransaction` | pipeline run 后、selection refresh 后 | `TransactionEvent` |
| `error` | 插件 callback 抛错或返回非法结果 | `PluginErrorEvent` |

暂缓事件：

- `beforeTransaction`：容易诱导插件直接更改 command / history 语义，先由 command middleware 覆盖主要需求。
- `afterLayout`：需要稳定 layout snapshot 与性能预算，先在 M3 decorations 中评估。

### 4.5 快捷键注册

```ts
export interface PluginKeyBindingDefinition {
  readonly key: string
  readonly command: string
  readonly when?: PluginKeyBindingPredicate
  readonly preventDefault?: boolean
}
```

规则：

- `key` 采用平台无关字符串，例如 `Mod-B`、`Shift-Mod-K`。
- 插件快捷键优先级低于内建编辑安全快捷键，高于宿主未处理的默认行为。
- 同一 key 多个插件命中时，按 plugins 数组顺序处理；第一个返回 handled 的 binding 截断后续处理。
- `when` 只能读取只读 projection、selection snapshot 和 editor readonly/mounted 状态。

### 4.6 diagnostics

```ts
export interface PluginDiagnosticsReporter {
  report(input: PluginDiagnosticInput): void
}
```

规则：

- 诊断 code 先进入 Gate 7 错误码单一真源生成管线；M2 临时 code 必须以 `PLUGIN_` 前缀登记。
- 插件异常统一转换为 `PLUGIN_CALLBACK_FAILED` 或更细 code，附带 plugin name、lifecycle/command/keybinding 和 message。
- 默认不自动 disable 插件；同一插件连续异常的禁用策略留到 M6 公开面收口。

## 5. Decorations experimental 草案

```ts
export interface ExperimentalDecorationProvider {
  readonly name: string
  readonly read: (input: DecorationReadInput) => readonly EditorDecoration[]
}
```

约束：

- Decoration provider 只读 projection/layout/selection snapshot。
- 不允许 provider 调用 command、修改 selection 或访问 canvas context。
- render 管线只消费已归一化的装饰数据；具体绘制由 core renderer 负责。
- M3 先支持文本 range highlight 和 page overlay marker，两者都标记 `experimental`。

## 6. UI 扩展草案

M4 才落地 UI 扩展，但 M1 先冻结方向：

```ts
export interface JWordUiPluginExtension {
  readonly pluginName: string
  readonly toolbarItems?: readonly JWordToolbarPluginItem[]
  readonly menus?: readonly JWordMenuPluginItem[]
}
```

规则：

- `JWordToolbarToolId` 保持内建联合类型，插件工具用独立 `plugin:${pluginName}:${itemName}` 运行时键，不并入内建 union。
- 插件 toolbar item 必须声明 label、ariaLabel、kind、commandName、enabled/active 读取函数。
- M5 内部消费者迁移补充：插件 menu action 也需要 active 读取函数，用于页面尺寸这类互斥菜单的选中态。
- M5 内部消费者迁移补充：插件 toolbar item / menu action 需要可选 `announce(context)` 钩子，用于保留页面尺寸等内建菜单原有 live region 播报；播报在 command 执行和焦点归还后排入 microtask，避免被 selection announcement 覆盖。
- UI 包只负责渲染和触发 plugin command；命令执行仍回到 core plugin host。

## 7. 错误隔离契约

- setup、dispose、middleware、command、keybinding、lifecycle listener、decoration provider 全部进入 `runPluginCallback()`。
- 插件异常不向外抛出到用户输入路径；core 将异常转换为 diagnostics 与 `plugin:error` editor event。
- 如果异常发生在命令 middleware 之前，原命令不执行并返回失败 diagnostic。
- 如果异常发生在 `afterTransaction`，已提交事务不得回滚，只记录 recoverable diagnostic。
- 如果 dispose 抛错，继续清理剩余插件。

## 8. M2-M6 交付切分

| 里程碑 | 交付 | 最小验证 |
|---|---|---|
| M2 | core plugin host、`EditorOptions.plugins`、command middleware、lifecycle、keybinding、error boundary | focused Vitest 覆盖 setup/dispose、afterTransaction、middleware 拒绝、插件异常隔离、快捷键触发 |
| M3 | experimental decorations read path | renderer/layout focused Vitest，证明 decoration provider 只读且异常不影响 render |
| M4 | UI toolbar/menu extension registry | UI Vitest 覆盖插件工具渲染、disabled/active 状态、点击触发 core command |
| M5 | 迁移 1-2 个现有 UI 菜单为内部 plugin consumer | Chromium focused E2E + 人工验证点登记 |
| M6 | 类型测试、TSDoc、public API 清单、diagnostics code 收口 | `docs/sdk/public-api.md`、类型测试、错误隔离 E2E |

M5 回填结论（2026-07-06）：默认页面尺寸菜单已作为首个内部消费者迁移到 `jword.ui` 插件，验证中发现 UI 插件 action 缺少 command 后播报钩子，因此补充 `announce(context)` 作为 M6 公开面收口前必须评估的 UI 插件能力。

## 9. 人工验证点登记

M1 后登记但不暂停：

- 是否同意 M2 不支持自定义 Operation union，只允许插件 command 编译成现有 `Command`。
- 是否同意 decorations 在 1.0 前保持 `experimental`，不阻塞 stable。
- 是否同意 UI 插件工具 ID 不并入 `JWordToolbarToolId`，避免破坏内建工具 union。
- 是否同意插件异常默认只报 diagnostics，不自动 disable 插件。

## 10. M2 开工前检查清单

- 新增 `plugins?: readonly PluginDefinition[]` 到 `EditorOptions`。
- 新增 `packages/core/src/plugin/` 或 `packages/core/src/plugins/`，避免继续加深 editor 继承链。
- `JWordEditorState` 组合 `PluginHost`，不让插件 host 成为新的 abstract superclass。
- `executeCommand()` 只接入 middleware 调度，不改变现有 `createTransactionPipeline()` 的 operation adapter 语义。
- 键盘 runtime 只调用 `pluginHost.handleKeyBinding(event, snapshot)`，不把 DOM event 暴露给插件。
- mount/destroy 事件从现有 mounted runtime / facade destroy 路径发出。
