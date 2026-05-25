# JWord Global Readonly Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not commit code; this repository currently forbids agent commits.

**Goal:** 为 `@4xian/jword-ui` 增加宿主可配置的全局只读模式，开启后只保留分页阅读能力，所有编辑入口、浮层操作、右键编辑菜单、键盘输入、粘贴、拖拽和命令式 UI 操作都被统一阻断。

**Architecture:** 全局只读模式放在 UI SDK 层，由一个 `readonly/interaction-guard` controller 统一接管 DOM 事件和 UI 控件禁用；core 仍保持 framework-agnostic，不新增顶层 DOM 依赖。2026-05-25 已删除独立移动端只读模式，只保留全局 `readonly` 作为唯一只读入口。

**Tech Stack:** TypeScript ESM、原生 DOM API、`@4xian/jword-core` Editor Facade、Vitest jsdom、Playwright Chromium。

---

## 1. 当前现状

- 2026-05-25 已删除移动端专属只读配置和实现文件。
- 只读能力统一使用 `CreateJWordUiOptions.readonly`，不再按移动视口自动切换。
- 当前事件分散在多个 controller：
  - core mount：`packages/core/src/editor/facade-runtime.ts` 绑定 canvas pointer、hidden textarea 输入、剪贴板和 composition。
  - selection-actions：`packages/ui/src/selection-actions/controller.ts` 绑定浮动工具栏、右键菜单、剪切/复制/粘贴、颜色、链接、批注入口。
  - table/media/comments/header-footer/find-replace/link 各自绑定 click / pointer / keydown / contextmenu。
- 如果在每个事件处理函数内零散判断 readonly，会继续扩大事件分散问题；因此本计划先建立统一 guard，再逐步让编辑入口消费 guard。

## 2. 范围边界

### 2.1 本计划要做

- 新增全局只读配置：`createJWordUi({ readonly: true })` 或等价对象配置。
- 新增统一交互 guard：在 capture 阶段阻断编辑类 DOM 事件，并向各 controller 暴露统一的 `canEdit()` / `blockEdit()` 能力。
- 全局只读开启后：
  - hidden textarea 设为 `readOnly`。
  - toolbar 编辑控件禁用或隐藏。
  - selection-actions 浮动工具栏和右键编辑菜单不出现。
  - table/media/image/link/header-footer/comments/revisions 的编辑入口不可执行。
  - 保留分页 canvas 滚动阅读。
  - 可选保留只读类跳转能力，例如目录跳转和查找定位；查找替换中的替换按钮必须禁用。
- 增加 focused tests 和浏览器回归，证明只读模式不会修改 projection。

### 2.2 本计划不做

- 不实现移动端完整编辑。
- 不改变 core transaction pipeline。
- 不把 core editor 变成 DOM 只读控制器；core 仍只负责编辑 facade 和事务。
- 不实现权限系统、协同权限或用户角色模型；只做宿主级只读开关。
- 不提交代码。

## 3. 目标 API

### 3.1 `packages/ui/src/types.ts`

新增：

```ts
/** 全局只读模式配置。 */
export interface JWordReadonlyOptions {
  /** 开启后只允许阅读、滚动和只读定位，不允许编辑。 */
  readonly enabled?: boolean
  /** 只读时是否隐藏 toolbar；默认隐藏。 */
  readonly hideToolbar?: boolean
  /** 只读时是否允许目录和查找定位；默认允许。 */
  readonly allowNavigation?: boolean
}
```

扩展：

```ts
export interface CreateJWordUiOptions {
  readonly readonly?: boolean | JWordReadonlyOptions
}
```

已删除旧的移动端专属只读入口：

- 移动端专属只读公开配置。
- 移动端专属只读实现文件。

## 4. 文件结构

### 4.1 新增文件

- `packages/ui/src/readonly/interaction-guard.ts`
  - 统一判断只读状态。
  - 统一阻断 DOM 编辑事件。
  - 暴露给其他 controller 的 `JWordInteractionGuard`。

- `packages/ui/test/readonly-interaction-guard.test.ts`
  - jsdom focused tests，验证事件阻断、toolbar 禁用、销毁恢复。

### 4.2 修改文件

- `packages/ui/src/types.ts`
  - 增加 `JWordReadonlyOptions` 和 `CreateJWordUiOptions.readonly`。

- `packages/ui/src/create-ui.ts`
  - 创建 `interactionGuard`。
  - 把 guard 传给 toolbar、selection-actions、table、media、comments、link、header-footer、paste。
  - destroy 时先销毁 guard 后销毁其他 controller，避免晚到事件继续写状态。

- `packages/ui/src/toolbar/controller.ts`
  - 在 refresh 时根据 guard 禁用编辑控件。
  - 只读下允许 navigation 类按钮，例如目录、查找打开；替换动作仍由 find-replace 自己禁用。

- `packages/ui/src/selection-actions/controller.ts`
  - 只读下不显示浮动工具栏和右键编辑菜单。
  - 剪切、粘贴、清除、插入链接、批注、格式等入口统一走 guard。

- `packages/ui/src/find-replace/controller.ts`
  - 只读下允许查找、上一个、下一个。
  - 禁用替换和全部替换。

- `packages/ui/src/table/controller.ts`
  - 只读下不显示表格 quick tools、右键菜单、行列操作。

- `packages/ui/src/media/controller.ts`
  - 只读下禁用图片插入/替换入口。

- `packages/ui/src/media/image-selection-controller.ts`
  - 只读下不显示 resize handle、delete/reset/rotate、拖拽 ghost。

- `packages/ui/src/comments/controller.ts`
  - 只读下允许查看/定位批注，禁止新建、回复、编辑、删除、解决/重开。

- `packages/ui/src/link/controller.ts`
  - 只读下允许打开链接。
  - 禁止插入、编辑、删除链接。

- `packages/ui/src/header-footer/controller.ts`
  - 只读下禁用页眉、页脚、页码写入操作。

- `packages/ui/test/create-ui-paste-readonly.test.ts`
  - 增加全局只读入口级测试。

- `examples/vanilla/tests/gate4-readonly.e2e.ts`
  - 新增浏览器级只读回归。

## 5. 交互 Guard 设计

### 5.1 Guard 接口

```ts
export interface JWordInteractionGuard {
  readonly readonly: boolean
  canEdit(): boolean
  blockEdit(message?: string): false
  destroy(): void
}
```

### 5.2 创建参数

```ts
export interface CreateJWordInteractionGuardOptions {
  readonly editorHost: HTMLElement
  readonly toolbarHost: HTMLElement
  readonly controls: Partial<Record<JWordToolbarToolId, JWordToolbarControlElement>>
  readonly readonly: JWordReadonlyOptions
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}
```

### 5.3 阻断事件

第一阶段阻断：

```ts
const BLOCKED_EDIT_EVENTS = [
  'beforeinput',
  'input',
  'paste',
  'cut',
  'drop',
  'keydown',
  'contextmenu',
  'dblclick'
] as const
```

后续如果图片拖拽或表格拖拽仍能穿透，再追加 `pointerdown / pointermove / pointerup` 的精确阻断，但第一阶段不直接吞掉所有 pointer，因为分页滚动和目录/链接打开可能需要 pointer。

### 5.4 统一事件原则

- DOM 原生输入类事件由 guard 在 `editorHost` capture 阶段阻断。
- UI controller 的 click handler 不直接判断 options，只调用 `guard.canEdit()` 或 `guard.blockEdit()`。
- `editor.executeCommand(...)` 暂不在 core 层禁用；只读模式是 UI 权限，不阻止宿主代码直接调用 core facade。后续如果需要 SDK 级硬只读，再单独增加 core command guard。

## 6. 任务拆分

### Task 1: 增加只读配置类型和 guard 骨架

**Files:**
- Create: `packages/ui/src/readonly/interaction-guard.ts`
- Modify: `packages/ui/src/types.ts`
- Test: `packages/ui/test/readonly-interaction-guard.test.ts`

- [x] **Step 1: 写 focused test**

覆盖：

- `readonly.enabled = true` 时 `beforeinput` 被 preventDefault。
- hidden textarea readOnly。
- toolbar controls disabled。
- destroy 后恢复 toolbar hidden 和 textarea readOnly。

- [x] **Step 2: 实现 guard**

最小实现：

- 读取 editorHost 内 `[data-jword-hidden-textarea]`。
- 记录 previous readonly / toolbar hidden。
- capture 阻断 `BLOCKED_EDIT_EVENTS`。
- `blockEdit()` 统一播报“当前为只读模式。”。

- [x] **Step 3: 运行 focused test**

Run:

```bash
pnpm exec vitest run packages/ui/test/readonly-interaction-guard.test.ts --maxWorkers=1
```

Expected: tests pass。

### Task 2: 接入 createJWordUi

**Files:**
- Modify: `packages/ui/src/create-ui.ts`
- Test: `packages/ui/test/create-ui-paste-readonly.test.ts`

- [x] **Step 1: 写入口级 test**

覆盖：

- `createJWordUi({ readonly: true })` 后 toolbar 隐藏或禁用。
- `beforeinput / paste / cut / contextmenu` 被阻断。
- projection 不变。
- 不再创建或依赖移动端专属只读入口。

- [x] **Step 2: 在 create-ui 创建 guard**

规则：

- 如果 `readonly === true`，构造 `{ enabled: true }`。
- 如果 `readonly` 是对象，按对象字段构造。
- 如果没传，guard 为 disabled handle，避免其他 controller 判断 null。

- [x] **Step 3: 删除移动端专属只读模式**

2026-05-25 已删除移动端专属只读模式；移动视口仍使用同一套分页 canvas，宿主如需移动只读需自行传入全局 `readonly`。

- [x] **Step 4: 运行入口测试**

Run:

```bash
pnpm exec vitest run packages/ui/test/create-ui-paste-readonly.test.ts packages/ui/test/readonly-interaction-guard.test.ts --maxWorkers=1
```

Expected: tests pass。

### Task 3: 接入 toolbar 与 selection-actions

**Files:**
- Modify: `packages/ui/src/toolbar/controller.ts`
- Modify: `packages/ui/src/selection-actions/controller.ts`
- Modify: `packages/ui/src/selection-actions/state.ts`
- Test: `packages/ui/test/toolbar-controller.test.ts`
- Test: `packages/ui/test/selection-actions-controller.test.ts`

- [x] **Step 1: toolbar test**

覆盖：

- 只读下格式按钮、插入链接、批注、表格、图片、页眉页脚、页码禁用。
- 目录按钮和查找按钮可按 `allowNavigation` 保持可用。

- [x] **Step 2: selection-actions test**

覆盖：

- 只读下非折叠选区不显示浮动格式工具栏。
- 只读下右键菜单不显示编辑动作。

- [x] **Step 3: 实现 controller 接入**

规则：

- 所有编辑 handler 开头调用 `if (!guard.canEdit()) { guard.blockEdit(); return }`。
- 渲染层也根据 readonly 隐藏编辑工具，避免用户看到可点入口。

- [x] **Step 4: 运行 focused tests**

Run:

```bash
pnpm exec vitest run packages/ui/test/toolbar-controller.test.ts packages/ui/test/selection-actions-controller.test.ts --maxWorkers=1
```

Expected: tests pass。

### Task 4: 接入编辑型功能面板

**Files:**
- Modify: `packages/ui/src/find-replace/controller.ts`
- Modify: `packages/ui/src/table/controller.ts`
- Modify: `packages/ui/src/media/controller.ts`
- Modify: `packages/ui/src/media/image-selection-controller.ts`
- Modify: `packages/ui/src/comments/controller.ts`
- Modify: `packages/ui/src/link/controller.ts`
- Modify: `packages/ui/src/header-footer/controller.ts`
- Tests: existing focused tests under `packages/ui/test/`

- [x] **Step 1: 查找替换只读规则**

只读下：

- 查找、上一个、下一个可用。
- 替换、全部替换禁用。
- overlay 高亮不受影响。

- [x] **Step 2: 表格/图片只读规则**

只读下：

- 不显示 table quick tools / context menu。
- 不显示 image handles / drag ghost / delete reset rotate。
- 插入图片入口禁用。

- [x] **Step 3: 批注/链接/页眉页脚只读规则**

只读下：

- 批注可查看定位，不可新建、回复、编辑、删除、解决、重开。
- 链接可打开，不可插入、编辑、删除。
- 页眉页脚和页码菜单不允许写入。

- [x] **Step 4: 运行 focused tests**

Run:

```bash
pnpm exec vitest run packages/ui/test/create-ui-find-replace.test.ts packages/ui/test/create-ui-comments-link.test.ts packages/ui/test/create-ui-header-footer.test.ts packages/ui/test/link-controller.test.ts packages/ui/test/header-footer-controller.test.ts --maxWorkers=1
```

Expected: tests pass。

### Task 5: 浏览器回归

**Files:**
- Create: `examples/vanilla/tests/gate4-readonly.e2e.ts`
- Modify: `examples/vanilla/src/main.ts`

- [x] **Step 1: 增加 demo 测试入口**

通过 query 参数或 `window.__jwordDemo` test hook 开启 readonly，不把只读模式做成第二套 demo。

- [x] **Step 2: 写 Playwright 测试**

覆盖：

- toolbar 编辑入口不可用。
- 键盘输入、粘贴、右键菜单、双击编辑都不改变 projection。
- canvas 可滚动。
- 目录跳转和查找定位按 `allowNavigation` 规则工作。
- 链接只允许打开，不允许编辑/删除。

- [x] **Step 3: 运行浏览器验证**

Run:

```bash
pnpm playwright test examples/vanilla/tests/gate4-readonly.e2e.ts --project=chromium --workers=1
```

Expected: tests pass。

### Task 6: 收口验证

- [x] **Step 1: UI typecheck**

Run:

```bash
pnpm --filter @4xian/jword-ui typecheck
```

Expected: pass。

- [x] **Step 2: focused readonly matrix**

Run:

```bash
pnpm exec vitest run packages/ui/test/readonly-interaction-guard.test.ts packages/ui/test/create-ui-paste-readonly.test.ts packages/ui/test/toolbar-controller.test.ts packages/ui/test/selection-actions-controller.test.ts --maxWorkers=1
```

Expected: pass。

- [x] **Step 3: 真实浏览器 proof**

优先使用 Kimi WebBridge 或 Playwright Chromium，在真实页面验证：

- `readonly: true` 后输入、粘贴、右键编辑都不会改变 projection。
- canvas 仍可滚动。
- 导航类能力按配置工作。

## 7. 风险与决策

- **风险：只在 UI 层阻断，宿主仍可直接调用 `editor.executeCommand`。**  
  决策：第一阶段接受，因为这是 UI SDK 只读模式；硬权限需要后续 core command guard。

- **风险：capture 阶段阻断 pointer 会破坏滚动和链接打开。**  
  决策：第一阶段不全量阻断 pointer，只阻断输入、剪贴板、右键、双击和各 controller 编辑入口。

- **风险：移动端专属只读和全局只读重复。**  
  决策：2026-05-25 删除移动端专属只读模式，只保留全局 `readonly`。

- **风险：控制器分散导致漏入口。**  
  决策：先把 toolbar、selection-actions、table、media、comments、link、header-footer、find-replace 全部列入任务和测试矩阵。

## 8. 验收标准

- `createJWordUi({ readonly: true })` 在桌面和移动视口都生效。
- 用户不能通过键盘、粘贴、右键菜单、浮动工具栏、顶部 toolbar、表格/图片辅助工具、批注/链接/页眉页脚面板修改文档。
- `editor.getProjection()` 在只读交互后保持不变。
- 分页 canvas 保持可滚动阅读。
- 只读下的目录跳转、查找定位、打开链接是否可用由 `allowNavigation` 和链接只读策略控制。
- focused Vitest、UI typecheck、Playwright Chromium readonly e2e 均通过。
