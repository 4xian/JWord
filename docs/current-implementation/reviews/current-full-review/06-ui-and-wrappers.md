# UI 与框架 wrapper 问题清单

> 范围：`packages/ui`、`packages/react`、`packages/vue`、`packages/devtools`。本文件只记录当前仍开放的问题；未完成性能实测的条目只按风险记录。

## UI-01（P1）Vue wrapper：未传 readonly 时 Boolean 归一为 false，覆盖 uiOptions.readonly

- 位置：`packages/vue/src/index.ts:95`（`readonly: Boolean`）+ `213-219`（`props.readonly ?? props.uiOptions?.readonly`）。
- 问题：`props: { readonly: Boolean }` 使 Vue 在宿主未传该 prop 时把它规范为 `false`（而非 undefined），`?? ` 短路失效，永远取到 false。
- 触发场景：宿主写 `<JWordVueEditor :ui-options="{ readonly: true }" />` 但不写 `:readonly`。
- 后果：只读配置被静默丢弃，编辑器变为可写。React 侧用可选 `boolean | undefined` prop 无此问题。
- 建议修复：`readonly` prop 用 `{ type: Boolean, default: undefined }` 保留三态。
- 当前结论：**确认**。Vue Boolean prop 缺省归一为 false，确实会让 `?? props.uiOptions?.readonly` 永远取不到 uiOptions 的 true。
- 详细修复步骤：
  1. 把 prop 改为带显式 `default: undefined` 的 Boolean 配置，保留“未传 / false / true”三态。
  2. 统一通过一个 `resolveReadonlyProp` 计算优先级：显式 prop 优先，未传时才回退到 `uiOptions.readonly`。
  3. 增加三个最小 wrapper 测试：只传 uiOptions=true、显式 false 覆盖 uiOptions=true、显式 true；断言 editor/UI 最终只读状态。

## UI-02（P1）React/Vue wrapper：readonly/theme/locale 运行时变更不生效，uiOptions 动态边界未定义

- 位置：`packages/react/src/index.ts:125-161`、`packages/vue/src/index.ts:136-172`。
- 问题：两个 wrapper 只在 mount 时 `createUiOptions(props)` 装配一次，运行期只覆盖了 value/modelValue，没有 effect 监听 readOnly/uiOptions/theme/locale 变化。shell 已提供 setTheme/setLocale 等命令，wrapper 未桥接。
- 触发场景：宿主运行时把 readOnly 从 false 切到 true，或切换主题/语言。
- 后果：UI 不响应；宿主须靠 React/Vue `key` 强制整体重建才能生效，重建会丢焦点与滚动位置。
- 建议修复：新增 effect 监听这些 prop，调用 shell 对应运行时 API（readonly 需 shell 层补充切换入口）。
- 当前结论：**部分正确**。`readOnly/theme/locale` 的运行时变更缺少桥接成立；但不能笼统承诺整个 `uiOptions` 对象都可热更新，结构性选项应继续要求 remount。
- 详细修复步骤：
  1. 先把动态契约限定为 `readOnly`、`theme`、`locale`；工具栏结构、插件等其余 uiOptions 在类型/文档中标为 mount-only。
  2. shell 增加幂等 `setReadOnly`，复用现有 `setTheme/setLocale`；调用时不得重建 editor、Y.Doc 或 UI root。
  3. React 用独立 effect、Vue 用 watch 监听解析后的三个标量值，跳过值未变化的重复调用并在 unmount 后停止更新。
  4. 各加一个聚焦测试，运行时切换三项并断言内容、selection、focus 和 scroll 不因 remount 丢失。

## UI-03（P1）comments-rail overlay 用全局 document，iframe/微前端下失败

- 位置：`packages/ui/src/comments-rail.ts:637,710,720`。
- 问题：`createCommentsAnchorOverlay` 与 `createCommentAnchorOverlayRect` 直接 `document.createElement(...)`，而非 `canvasContainer.ownerDocument` / `pageElement.ownerDocument`。
- 触发场景：宿主把 JWord 挂到 iframe 或独立 realm。
- 后果：overlay 节点由父 realm document 创建，`instanceof HTMLElement` 校验、样式继承与事件在子 realm 异常。
- 说明：这是全仓普遍模式（约 190 处全局 `document.createElement`，含 link-overlay.ts、find-replace、comments/dom.ts），comments-rail 是确定可复现的代表点。
- 建议修复：统一改用宿主 `ownerDocument` 创建节点，同类文件一并整改。
- 当前结论：**确认（跨 realm 兼容缺陷）**。当前精确统计为 `packages/ui/src` 内 188 次 `document.createElement`；comments-rail 的代表点直接使用全局 document。并非每一处都会立即报错，但跨 iframe realm 的节点构造器与类型判断确实不可靠。
- 详细修复步骤：
  1. 在 UI mount 根建立统一 `UiDomContext { ownerDocument, defaultView }`，由 host/root 生成并向 controller、overlay、clipboard 和 sanitizer 传递。
  2. 先改 comments-rail 代表链：节点由 canvas/page 的 ownerDocument 创建，构造器/事件/MutationObserver 从对应 defaultView 获取。
  3. 按模块逐批清理剩余全局调用，并增加 lint/架构检查禁止 UI 生产代码直接使用全局 `document/window`（明确允许的兼容 helper 除外）。
  4. 用 Playwright iframe E2E 验证挂载、批注 overlay、查找、粘贴与销毁；同时校验节点 `ownerDocument` 指向 iframe document。

## UI-04（P2）paste sanitizer 用全局 window/document，跨 realm 清洗链断裂

- 位置：`packages/ui/src/paste/sanitizer.ts:69`（`DOMPurify(window).sanitize`）、`108`、`127`。
- 问题：清洗与后续结构化转换全程绑定全局 window/document；`shouldFallbackToPlainText`（127）用全局 `document.createElement('template')` 解析未清洗的原始 HTML。
- 触发场景：编辑器运行在非顶层 realm，或 window 被 polyfill/代理。
- 后果：清洗在错误 realm 执行，跨 realm 节点的 `instanceof` 返回 false，安全子集判定与 run 提取整体降级。XSS 本身：DOMPurify 默认剥离 `javascript:`/事件属性，href 还经 `isAllowedLinkUrl` 二次校验，未发现直接绕过；风险集中在 realm 绑定。
- 建议修复：sanitizer 接收 ownerDocument/defaultView，用其 `DOMPurify(view)` 与 `ownerDocument.createElement`。
- 当前结论：**确认（跨 realm 正确性），未确认 XSS 绕过**。报告正文对风险边界的校准是正确的。
- 详细修复步骤：
  1. sanitizer 改接收 UI-03 的 `UiDomContext`，DOMPurify 初始化、template、TreeWalker/Node 构造器都来自同一 realm。
  2. fallback 分析使用清洗后的 HTML/DOM，不再重新解析未经清洗的原始字符串；链接仍保留 `isAllowedLinkUrl` 二次校验。
  3. 避免在核心 sanitizer 内隐式读取全局 window，Node/worker 不支持场景返回现有稳定 fallback。
  4. 增加 iframe realm 的富文本粘贴测试，并保留 javascript URL、事件属性被剥离的安全回归。

## UI-05（P2）水印/品牌"防篡改"用 subtree observer + 500ms 轮询冒充安全边界

- 位置：`packages/ui/src/watermark/controller.ts:86,184-201,204-224`；`status-bar/controller.ts:426,428-433`。
- 问题：用 `MutationObserver({childList,subtree,attributes,characterData})` + `setInterval(...,500)` 监视自建 DOM，并对每页 `getComputedStyle` 逐项比对。
- 后果：（安全）纯客户端自校验对能改 DOM 的攻击者不构成边界，注释却表述为完整性保障；（性能）多页文档下全子树监听 + 500ms 轮询 + 每页 getComputedStyle 在滚动/输入时持续开销，自恢复写入可能再次触发 observer 造成抖动。
- 建议修复：明确其为 best-effort 显示保护而非安全边界；轮询降频或改按需校验；observer 范围缩小到水印层本身；授权留在 license/server。
- 当前结论：**部分确认**。机制与“不是安全边界”可静态确认；性能影响尚未通过 benchmark 验证，不能写成已复现的卡顿。
- 详细修复步骤：
  1. 删除代码/文档中的安全完整性表述，把 controller 定义为 best-effort 品牌显示恢复；授权与 entitlement 只由 license/server 决定。
  2. observer 只监听水印/status 节点及必要属性，恢复写入期间临时抑制自身 observer 回调，避免自触发循环。
  3. 移除固定 500ms 全页扫描，改为 mount、页增删、theme/license 状态变化等事件驱动校验；必须兜底时采用低频、页面可见时运行。
  4. 修改前后用多页 fixture 记录 observer 回调数、style read 数和输入期间耗时，达到基线后再决定是否保留轮询。

## UI-06（P2）EditorShell 销毁：ui.destroy() 抛错会跳过 editor.destroy() 与宿主清理

- 位置：`packages/ui/src/editor-shell.ts:103-113`。
- 问题：`destroyed=true` 先置位，`ui.destroy()` 若抛错则 `editor.destroy()` 与 `cleanupEditorShellHost` 不执行，二次调用因 destroyed 直接 return。
- 触发场景：某 controller 的 destroy 抛异常（如 UI-05 的 observer 状态异常）。
- 后果：editor 未销毁（Y.Doc/订阅泄漏），宿主根元素未还原，且重试销毁变 no-op，资源永久泄漏。
- 建议修复：用 try/finally 保证 editor.destroy 与宿主清理必然执行，或聚合错误后重抛。
- 当前结论：**确认**。当前置位顺序和串行调用使第一个异常跳过后续两个必需清理步骤。
- 详细修复步骤：
  1. 保留 `destroyed=true` 的幂等门禁，但把 `ui.destroy`、`editor.destroy`、`cleanupEditorShellHost` 作为三个独立清理动作逐个执行。
  2. 每个动作单独 try/catch 收集错误，后一个动作不受前一个失败影响；全部完成后再抛首错或 `AggregateError`。
  3. 宿主 DOM 还原放在最后一个不可跳过的 finally/cleanup 动作中，二次 destroy 继续 no-op。
  4. 注入 ui.destroy 与 editor.destroy 各自抛错的两个表驱动 case，断言其余清理仍执行且错误可见。

## UI-07（P2）toolbar controller：DOM 与扩展宿主在 try 之前创建，构造失败无回滚

- 位置：`packages/ui/src/toolbar/controller.ts:129`（createToolbarDom）、`133`（createToolbarExtensionHosts），try 块始于 292。
- 问题：深层绑定在 try/catch 内，但 createToolbarDom/createToolbarExtensionHosts/createToolbarViewControls 在 try 之前。若这些抛错，toolbar 从未返回，上层 `ui-lifecycle.ts:433` 的 `cleanup.add(toolbar.destroy)` 从未登记，已插入 toolbarHost 的 DOM 泄漏。
- 后果：toolbar 深层构造失败回滚在 try 内成立，但 try 外这段是回滚盲区。
- 建议修复：把 DOM/扩展宿主创建纳入同一 try，或函数级 try 统一 destroyToolbarController。
- 当前结论：**确认**。DOM/extension/view controls 的创建发生在保护区外，上层只有函数成功返回后才拿到 destroy。
- 详细修复步骤：
  1. 函数入口先创建局部 cleanup 栈；每完成 DOM 插入、extension host、view controls 等一步就立即登记对应 cleanup。
  2. 把整个构造过程纳入一个 try/catch，失败时逆序清理并重抛原始错误；成功时把同一栈封装为返回 controller 的 destroy。
  3. 确保扩展 host 的 dispose、事件解绑和 toolbarHost DOM 移除都幂等。
  4. 对三个早期构造点各注入一次异常，最少用表驱动测试断言宿主 DOM 与订阅计数回到构造前状态。

## UI-08（P2）用户可见文案硬编码，绕过 i18n

- 位置：`comments-rail.ts:523`（`'锚点已失效'`）、`524`/`ui-lifecycle.ts:224`（`'选中文本'`）、`comments-rail.ts:723`（marker `'注'`）、`comments-rail.ts:66,71`（错误文案）。
- 触发场景：宿主设 `locale:'en-US'` 后查看失效锚点批注或批注锚点标记。
- 后果：中英文混排，marker 与错误文案在英文环境不可本地化。
- 建议修复：迁入 i18n 字典并通过 `readJWordUiText` 读取。
- 当前结论：**确认**。列出的中文字符串均在用户可见路径，未经过现有 i18n reader。
- 详细修复步骤：
  1. 为失效锚点、选中文本、批注 marker 和错误文案增加稳定 key，并同时补齐 zh-CN/en-US 字典。
  2. comments rail 与 lifecycle 只通过 `readJWordUiText` 读取，不在调用点保留硬编码 fallback 文案。
  3. 明确单字符 marker 的英文文案与可访问名称，避免只翻译视觉字符而遗漏 aria-label/title。
  4. 增加 locale 切换后的聚焦断言，确认中文环境无 key 泄漏、英文环境无中文残留。

## UI-09（P2）React 受控 value 在 mount 时被加载两次

- 位置：`packages/react/src/index.ts:140-144` 与 `157-161`。
- 问题：mount 的 layout effect 已 `loadDocumentModel(props.value)`，随后 `useEffect([props.value])` 首次挂载也执行一次，再次 loadDocumentModel。Vue 侧 `watch(modelValue)` 默认不 immediate，无此问题。
- 后果：首帧文档加载两次，多一次全量 projection/layout 计算与事件抖动；非崩溃但冗余。
- 建议修复：mount effect 内不加载 value，交由 useEffect 统一处理；或给 useEffect 加"跳过首次"判定。
- 当前结论：**确认**。layout effect 已同步加载初始 value，随后普通 effect 首次挂载必定再次处理同一个引用。
- 详细修复步骤：
  1. 保留 layout effect 的首帧同步加载，避免编辑器先以空文档绘制；用 `lastLoadedValueRef` 记录已加载引用/版本。
  2. value effect 只有在新值与 `lastLoadedValueRef.current` 不同时才调用 `loadDocumentModel`，加载后更新 ref。
  3. 明确受控 value 的相等策略（当前若按引用比较就保持一致），不要在 wrapper 内做昂贵深比较。
  4. 用 mock/spies 断言首次 mount 调用一次、prop 更新再调用一次，并确认 StrictMode 开发重放下最终没有重复业务加载。

## 说明

- devtools 包仅一个 `index.ts`，未见独立生命周期/安全缺陷。
- 跨 realm 全局 document/window 是全包系统性问题（约 190 处），UI-03/UI-04 是确定可复现的代表点，整改应成规模推进。
