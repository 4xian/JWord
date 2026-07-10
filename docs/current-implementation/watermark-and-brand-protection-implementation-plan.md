# 页面水印与版权防篡改实施方案

> 快照日期：2026-07-09。
> 本文描述编辑器实例级页面水印和状态栏版权防篡改的首轮实现方案。首轮不修改 core 文档模型，不把水印写入协作事务；后续如果要让 `.jword`、DOCX、PDF 从文档模型天然保留水印，再单独推进文档模型级水印。

## 1. 目标

- 增加编辑器实例级页面水印：宿主可通过公开 API 设置、读取和清除水印。
- 在顶部工具栏专业模式的“工具” Tab 中增加“页面水印”下拉入口，样式为上方图标、下方 label、右侧下拉箭头。
- 水印下拉支持设置水印内容、字体大小、字体颜色，并支持多行内容。
- 水印层挂到编辑器 canvas 宿主内部，不影响编辑、选区、滚动和工具栏交互。
- 水印层具备轻量防篡改监听：被删除或隐藏时自动恢复。
- 状态栏版权支持防篡改策略：关闭显示版权、删除后恢复、多次删除后挂载内置版权水印。
- 用户自定义页面水印与内置版权保护水印互相独立，`clearWatermark()` 只清除用户水印，不清除版权保护水印。

## 2. 非目标

- 首轮不修改 `@4xian/jword-core` 的 `Document` / `Section` 模型。
- 首轮不把水印写入 undo/redo、协作同步或 `.jword` 文件。
- 首轮不承诺 DOCX/PDF 导出自动包含水印；只暴露 `getWatermark()` 供导出 seam 读取。
- 不实现真正禁止 DevTools、F12、右键或任意 JS 篡改；浏览器端只能做 best-effort 恢复。
- 不把版权保护水印暴露给用户编辑，不允许 toolbar 清除。

## 3. 公开 API 设计

### 3.1 编辑器实例水印

```ts
export interface JWordWatermarkOptions {
  readonly text: string
  readonly fontSizePx?: number
  readonly color?: string
  readonly opacity?: number
  readonly rotateDeg?: number
}

export interface JWordUiInstance {
  setWatermark(options: JWordWatermarkOptions): void
  clearWatermark(): void
  getWatermark(): JWordWatermarkOptions | null
}
```

规则：

- `text` 支持 `\n` 多行；空白文本视为清除水印。
- 默认 `fontSizePx = 28`、`color = '#9ca3af'`、`opacity = 0.18`、`rotateDeg = -30`。
- DOM 使用 SVG background 生成重复水印。
- `getWatermark()` 返回规范化后的用户水印配置；没有用户水印时返回 `null`。
- `setWatermark()` / `clearWatermark()` 必须同步刷新 toolbar 弹窗表单。

### 3.2 版权保护配置

```ts
export type JWordStatusBarBrandProtectionMode = 'hidden' | 'restore' | 'watermarkFallback'

export interface JWordStatusBarBrandOptions {
  readonly label?: string
  readonly protection?: JWordStatusBarBrandProtectionMode
}
```

兼容规则：

- `brand: false` 继续表示隐藏版权。
- `brand: { protection: 'hidden' }` 等同隐藏版权。
- 未传 `protection` 时默认 `restore`，保持显示并被删除后恢复。
- `restore`：版权被删除、文案被改或被隐藏时自动恢复。
- `watermarkFallback`：先恢复版权；短时间多次篡改后额外挂载不可编辑的内置版权水印。

## 4. DOM 与防篡改策略

水印挂载到 editor canvas container 内部：

```text
[data-jword-canvas-container]
├── pages/canvas
├── [data-jword-watermark-layer="user"]
└── [data-jword-watermark-layer="brand"]
```

水印层要求：

- `pointer-events: none`，不影响输入和选区。
- `position: absolute; inset: 0`，跟随 canvas container 滚动区域。
- 使用 `background-image: url("data:image/svg+xml,...")` 绘制重复水印。
- 用户水印和版权水印分别一个 layer；版权水印层在用户水印之上或之下均可，但不允许被用户 API 清除。
- `MutationObserver` 只监听 SDK 自己管理的 canvas container，不做全局监听。
- 被删、被改 `display:none`、`visibility:hidden`、`opacity:0` 时恢复。

## 5. Toolbar 交互

在专业模式 `tools` Tab 增加 `document.watermark`：

- icon：页面水印图标。
- label：`页面水印` / `Watermark`。
- tooltip：`设置页面水印` / `Set page watermark`。
- 按钮带下拉箭头。

下拉面板字段：

- 水印内容 textarea，支持多行。
- 字体大小 number input，单位 px。
- 字体颜色 color input。
- 操作按钮：应用水印、清除水印。

常用模式默认不展示 `document.watermark`，宿主可通过 `common.visibleTools` 显式加入。

## 6. i18n 与主题规则

- 所有新增 label、tooltip、aria、placeholder、按钮文案和 live region 播报必须覆盖 `zh-CN` / `en-US`。
- 暗色主题下菜单背景、文字、边框、输入框、按钮 hover 必须使用现有 `--jw-*` token。
- 水印默认颜色不随主题自动切换；用户未设置颜色时使用默认灰色。版权水印使用固定灰色且透明度较低。

## 7. 实施步骤

### 阶段 A：文档与类型

- 新增本文档并在 `README.md`、`backlog.md` 增加入口。
- 扩展 `JWordToolbarToolId`、`JWordStatusBarBrandOptions`、`JWordUiInstance` 和水印类型。
- 更新 SDK public API 文档。

### 阶段 B：水印 controller 与测试

- 新增 `packages/ui/src/watermark/controller.ts`。
- 实现 `setWatermark()`、`clearWatermark()`、`getWatermark()`、品牌水印设置和销毁。
- 单测覆盖：多行水印、清除水印、防删除恢复、用户水印与品牌水印互不影响。

### 阶段 C：Toolbar 菜单

- 在 `tools` Tab 增加 `document.watermark`。
- 新增 toolbar 水印下拉 DOM 与事件绑定。
- 支持从当前水印状态回填 textarea、字号和颜色。
- 单测覆盖：打开菜单、应用水印、清除水印、动态中英文切换。

### 阶段 D：品牌防篡改

- 状态栏 brand 创建后启动保护监听。
- `restore` 模式自动恢复版权 DOM/文案/可见样式。
- `watermarkFallback` 模式在多次篡改后调用品牌水印 setter。
- 单测覆盖三种模式。

### 阶段 E：验证与文档回写

- 运行 focused UI 单测、typecheck、lint comments。
- 回写 `packages/ui.md`、`sdk/public-api.md`、`toolbar-modes-implementation-plan.md` 和 backlog 状态。

## 8. 验收标准

- `createJWordUi(...).setWatermark({ text: '内部资料\n禁止外传' })` 能在编辑器区域显示多行重复水印。
- `clearWatermark()` 只清除用户水印，不清除品牌保护水印。
- `getWatermark()` 返回当前用户水印配置。
- 删除用户水印 DOM 后能自动恢复。
- 工具 Tab 的“页面水印”菜单可设置内容、字号、颜色并清除。
- `setLocale('en-US')` 后水印菜单文案切换为英文。
- 暗色主题下水印菜单可读，hover/按钮样式正常。
- `brand: false` 和 `brand.protection: 'hidden'` 都不显示版权。
- `brand.protection: 'restore'` 删除版权后恢复。
- `brand.protection: 'watermarkFallback'` 多次篡改后出现不可编辑版权水印。

## 9. 实施记录

- 2026-07-09：阶段 A-E 已完成首轮实现。
- 新增 `packages/ui/src/watermark/controller.ts`，负责用户水印和内置版权水印分层挂载、防删除/隐藏恢复与销毁。
- 新增 `packages/ui/src/toolbar/watermark-menu.ts`，在专业模式工具 Tab 的 `document.watermark` 下拉中支持多行内容、字号、颜色、应用和清除。
- `JWordUiInstance` 已暴露 `setWatermark(...)`、`clearWatermark()`、`getWatermark()`；`clearWatermark()` 只清除用户水印。
- 状态栏 `brand` 支持 `hidden`、`restore`、`watermarkFallback` 三种策略；兜底版权水印不经过用户水印 API。
- 已补齐 `zh-CN` / `en-US` 文案和 light / dark 菜单样式。
- 验证通过：
  - `pnpm exec vitest run packages/ui/test/watermark-controller.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/theme-i18n.test.ts --root . --reporter=verbose`
  - `pnpm exec tsc --noEmit --pretty false -p packages/ui/tsconfig.json`
