# 架构、Host 与公开 API 审查

> 后续决策：单 Host `EditorShell` 已从 P2 结构优化提升为当前第二执行批次，仅晚于 `pnpm typecheck` 修复。本文后续建议按该决策理解。

## 总体评价

包级拆分和 core 内部主路径总体合理：core 保持框架无关，DOM 延迟到 `editor.mount()`；写入统一经过 command、plugin middleware、transaction pipeline 和 operation adapter；读取侧通过 projection/layout 隔离 Y.Doc 内部结构。`core / ui / native / docx / pdf / collab / persistence / license / wrappers` 的拆包本身不是主要过度设计。

主要问题出现在组合层：内部 DOM seam 被暴露为普通集成参数，Host 优先级不一致，主题、无障碍和销毁没有统一所有权，wrapper 又重复装配内部节点。结果是底层模块边界清楚，但客户接入面仍然偏深。

## Host 问题的直接答案

用户的判断基本正确：**普通集成只应提供一个编辑器根 Host；工具栏、状态栏、下拉框和常规面板应绑定同一编辑器实例，由官方 UI 内部创建和销毁。**

当前代码其实已经具备这条路径：

- `CreateJWordUiOptions.toolbarHost` 是可选项：`packages/ui/src/types.ts:741-752`。
- 未传 `toolbarHost` 时，`resolveToolbarMount()` 会在已挂载的 `editorHost` 内自动创建：`packages/ui/src/toolbar-setup.ts:19-53`。
- 未传 `statusBar.host` 时，`resolveStatusBarMount()` 会自动放在 editor shell 后：`packages/ui/src/status-bar/mount.ts:17-59`。
- comments、link、header/footer、find/replace、revisions 等 feature host 的类型也是可选：`packages/ui/src/types.ts:678-725`。

因此，“工具栏、状态栏、下拉框都必须由业务方提供 Host”没有必要，也不是当前低层实现的真实强制条件。内部使用多个 DOM 容器隔离 controller 是合理实现细节；过度设计发生在这些细节进入普通公开路径后，消费者必须理解装配顺序和所有权。

## 已冻结的 EditorShell 默认契约

普通集成只要求一个根元素：

```ts
const jword = createJWord({
  host: document.querySelector('#jword')!
})
```

返回的 `JWordEditorShell` 是默认深模块；它隐藏 `createEditor -> mount -> createJWordUi` 的装配顺序、自动 Host、订阅、异常回滚和销毁顺序。除 `host` 外，基础编辑器不要求调用方提供任何挂载位置。

默认 DOM 结构保持上中下三段：

```text
root host（EditorShell 专用容器）
├── toolbar host
├── editor shell / canvas host
└── status bar host
```

- 根 Host 是调用方提供的专用空容器；EditorShell 管理其内部节点，不额外引入没有行为价值的 wrapper。
- shell 内部使用纵向 flex 布局，不使用 grid 或 `gap`。
- toolbar、dropdown、dialog、常规 panel 和 status bar 都由 shell 内部定位和销毁；live region 与 text mirror 复用 core editor 已创建的视觉隐藏节点。
- 下拉框与弹层默认挂在 shell 的 editor 区域内，不额外创建包装元素，也不要求普通调用方再传 Host。
- comments、outline、fullscreen 等确实需要参与宿主页面布局的位置，才作为可选高级 `slots`。
- 高级 slot 必须继承根 Host 的 `ownerDocument`、theme、locale、focus、z-index 和 destroy 契约。
- `createEditor()` + `createJWordUi()` 继续作为 advanced interface，兼容需要完全控制 DOM 的集成；官方 Quickstart 和 demo 不再使用它展示默认接入方式。

## 建议的 Host 分类

| 类型 | 建议 |
| --- | --- |
| 唯一必需 Host | 一个 editor/root host；高层入口内部完成 editor mount。 |
| 默认内部创建 | toolbar、status bar；live region、text mirror 复用 core editor 的视觉隐藏节点。 |
| 高级可选 slot | comments rail、heading outline、fullscreen；这些确实可能参与宿主页面布局。 |
| 内部普通面板 | link、header/footer、find/replace、revisions 固定使用 editor 区域，不公开额外挂载 slot。 |
| 纯内部 seam | media/table/dropdown controller 的 extension host，不进入普通公开配置。 |

## 已确认的架构与 API 问题

### 1. 显式 panel Host 被内部 Host 覆盖

严重度：P1；证据：静态确认。

类型承诺 `headerFooter.host`、`findReplace.host`、`revisions.host` 可指定挂载点：`packages/ui/src/types.ts:700-725`。但装配顺序分别是：

```ts
toolbar.panelHost ?? options.headerFooter.host ?? toolbarHost
toolbar.panelHost ?? options.findReplace.host ?? toolbarHost
toolbar.panelHost ?? options.revisions.host ?? toolbarHost
```

见 `packages/ui/src/ui-lifecycle.ts:426-505`。只要启用相关功能，toolbar controller 就会创建 `panelHost`：`packages/ui/src/toolbar/controller.ts:176-182`。因此正常工具栏路径下，调用方显式传入的三个 Host 不生效。现有测试只覆盖 `toolbar: false` 时不创建面板：`packages/ui/test/create-ui-toolbar.test.ts:145-188`，没有覆盖可见 toolbar 与显式 Host 的契约。

最小修复是把三处优先级改为 `options.*.host ?? toolbar.panelHost ?? toolbarHost`，并各加一个 DOM 归属断言。

### 2. 单一生命周期所有权缺失

严重度：P1；证据：静态确认。

UI 的订阅、controller、observer、timer 和自动 Host 只有在 `ui.destroy()` 中完整释放：`packages/ui/src/ui-lifecycle.ts:745-770`。仅调用 `editor.destroy()` 不会自动销毁 UI；status bar 的品牌保护仍持有 MutationObserver 和 interval：`packages/ui/src/status-bar/controller.ts:394-437`。

React/Vue wrapper 已按 `ui -> editor` 顺序销毁，说明正确模式存在：`packages/react/src/index.ts:104-110`、`packages/vue/src/index.ts:110-117`。问题是低层客户需要自己记住两个 handle 和顺序，Quickstart 又没有保存 UI handle 或展示 cleanup。

### 3. a11y DOM 被重复创建并泄漏给消费者

严重度：P1；证据：静态确认。

core mount 已创建 `liveRegion` 和 `textMirror`：`packages/core/src/editor/mount-facade-runtime.ts:162-164,246-254`。React/Vue wrapper 又分别创建 toolbar、editor、live-region、assistive 四个 Host：`packages/react/src/index.ts:93-96,173-181`、`packages/vue/src/index.ts:102-105,184-191`。UI 在未传辅助 Host 时反而关闭自己的播报和 mirror：`packages/ui/src/ui-lifecycle.ts:94-103`。

这不是直接删除所有辅助 DOM 的理由，而是说明所有权应统一：高层 shell 只维护一套 a11y 通道，普通消费者不管理辅助节点。

### 4. 跨 realm/iframe 支持不一致

严重度：P1；证据：静态确认，尚未做 iframe 端到端复现。

core 正确从 `host.ownerDocument` 和对应 realm 取构造器：`packages/core/src/editor/mount-facade-runtime.ts:135-164`。UI 多处仍直接使用全局 `document`、`window`、`HTMLElement`、`Node` 或 `MutationObserver`，例如：

- `packages/ui/src/comments-rail.ts:630-642`
- `packages/ui/src/find-replace/controller.ts:326-332`
- `packages/ui/src/selection-actions/geometry.ts:179`
- `packages/ui/src/table/table-selection.ts:47-52`
- `packages/ui/src/media/image-selection-dom.ts:278`
- `packages/ui/src/toolbar-setup.ts:99`

在 iframe、微前端或多 Window 环境中，可能创建到错误 document、`instanceof` 失败，或把监听绑定到错误 realm。企业嵌入式 SDK 应统一从根 Host 派生 DOM 能力。

### 5. 外置 Host 的主题和默认行为不闭环

严重度：P2；证据：静态确认。

- link 类型说明默认挂到 toolbar 扩展区域：`packages/ui/src/types.ts:690-693`；实现却优先选择 `editorHost`：`packages/ui/src/ui-lifecycle.ts:351-355`。
- theme controller 的 Host 集合主要覆盖 toolbar、editor、status bar：`packages/ui/src/ui-lifecycle.ts:129-135`；外置 comments/outline 不一定继承同一 token。

如果保留高级 slots，就必须同时定义 ownerDocument、theme、i18n、z-index、focus 和 destroy 契约。

### 6. Wrapper 只在首次挂载消费运行时配置

严重度：P1；证据：静态确认和 Vue 最小运行时复现。

React 的 mount effect 固定为空依赖，后续只同步 `value`：`packages/react/src/index.ts:128-171`。Vue 也只 watch `modelValue`：`packages/vue/src/index.ts:139-182`。`readOnly/readonly`、`uiOptions`、theme 和 i18n 后续变化不会更新底层 UI。

Vue 还把 `readonly` 声明为 Boolean prop：`packages/vue/src/index.ts:86-93`。未传时 Vue 会归一为 `false`，随后 `props.readonly ?? props.uiOptions?.readonly` 会让这个 `false` 覆盖 `uiOptions.readonly: true`：`packages/vue/src/index.ts:225-244`。

企业权限实时降级是安全相关 UX，不能要求销毁整个 editor 才生效。底层已有 `setTheme()`、`setLocale()`：`packages/ui/src/types.ts:1056-1073`，但 wrapper handle 没有暴露；readonly 则还缺等价更新 API。

### 7. 公开 DOM 面过宽

严重度：P2；证据：静态确认。

`JWordUiElements` 及相关类型把大量按钮、菜单、input 和 panel 节点作为公开返回值：`packages/ui/src/types.ts:816-1053`。这会把内部 DOM 结构升级成兼容承诺，阻碍 UI 重构。对外应主要暴露语义命令、状态和粗粒度 slot handle；测试定位继续使用稳定 `data-*` 属性。

### 8. 组合层仍过深

严重度：P1/P2；证据：运行复现与行数统计。

- `packages/ui/src/toolbar/dom.ts`：1548 行。
- `packages/ui/src/types.ts`：1074 行。
- `packages/ui/src/toolbar/controller.ts`：1002 个物理行，门禁计数 1003，预算 400。
- `packages/ui/src/ui-lifecycle.ts`：846 行。
- `packages/core/src/layout/query.ts`：1038 个物理行。

`ui-lifecycle.ts` 同时负责十余个 feature、主题、i18n、a11y、面板、订阅和销毁顺序。应按 feature registry、普通面板、a11y 和 lifecycle 分批收敛，但不建议一次性重写 core 或全部 controller。

### 9. 插件 setup 缺少事务回滚

严重度：P1；证据：静态确认。

`packages/core/src/plugins/host.ts:371-387` 捕获 setup 异常，但插件在抛错前通过 context 注册的 command/middleware 已写入 runtime；setup 没有正常返回时，对应 disposable 也没有登记，见 `packages/core/src/plugins/host.ts:417-449`。应按插件记录注册动作，setup 失败时反序回滚。

### 10. 品牌/水印“防篡改”属于过度设计风险

严重度：P2；证据：静态确认。

状态栏默认品牌保护模式是 `restore`：`packages/ui/src/status-bar/controller.ts:463-470`，每个实例使用 subtree MutationObserver 和 500ms interval：`packages/ui/src/status-bar/controller.ts:394-437`。水印 controller 同样使用 MutationObserver 与 500ms 完整性检查：`packages/ui/src/watermark/controller.ts:34-87,183-224`。

宿主控制源码、DOM 和 CSS，这些机制不是可靠授权或安全边界，却引入常驻工作、跨 realm 复杂度和宿主样式冲突。商业 enforcement 应留在 license/server；UI 品牌和水印只作为可选展示，默认不做持续轮询。

## 最小 API 演进建议

不需要推翻现有 API。建议新增高层入口：

```ts
const jword = createJWord({ host })

jword.destroy()
```

`editorOptions`、`uiOptions` 和 `slots` 均为可选高级配置，不出现在最小示例中。高层入口负责 `createEditor -> mount -> createJWordUi`，构造失败时反序回滚，并只暴露一个 destroy。保留 `createEditor()` + `createJWordUi()` 作为 advanced interface。当前第二执行批次只需：

1. 建立 `JWordEditorShell` 与 `createJWord({ host })` 默认入口。
2. 复用现有自动 toolbar/status bar mount，锁定上中下三段顺序。
3. 统一 a11y 节点、构造回滚和销毁所有权。
4. 把真实外置位置收敛为明确的高级 slots，并修正三个显式高级 Host 的优先级。
5. 把 Quickstart 与 vanilla demo 改为只传根 Host 的最小集成；测试钩子仍留在 demo-only 文件，不进入产品 interface。

这个方案复用当前自动 toolbar/status bar 的实现，属于渐进演进，不是大重写。
