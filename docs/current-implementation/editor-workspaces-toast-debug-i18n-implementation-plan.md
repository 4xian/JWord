# JWord 左右工作区、Toast、调试日志与 i18n 治理实施方案

> 快照日期：2026-07-12。
> 本文以当前源码和真实测试为基线，描述四个相互独立、由 `createJWordUi(...)` 统一编排的 UI 模块。实施必须按本文步骤逐项验证，不改变 core 文档模型、分页 Canvas、批注几何定位或公开命令语义。

## 1. 目标与固定决策

本方案完成以下目标：

1. 在 EditorShell 编辑区域提供左右两个浮动工作区。
2. 左侧工作区固定承载目录，右侧工作区固定承载修订记录。
3. 两侧工作区通过绝对定位覆盖在编辑区域边缘，不参与正文宽度计算，不改变 `.jw-editor` 的真实布局宽度。
4. 批注继续使用按每页 Canvas 创建的 page rail，不迁入右侧工作区。
5. 提供通用 `toast({ message, type, duration })` 能力，并先接入“批注前必须选择文本”的可见提示。
6. 提供实例级、默认关闭的 debug 日志能力，开启后统一输出来源、事件和内容。
7. 建立全项目用户可见文案的 i18n 分类、迁移顺序和防回退规则。

固定挂载结构：

```text
[data-jword-shell-region="editor"]
├── .jw-editor
├── [data-jword-side-workspace="left"]
│   └── heading outline
├── [data-jword-side-workspace="right"]
│   └── revisions
└── [data-jword-toast-host]
```

`.jw-root` 是主题样式 class，不作为挂载语义。`.jw-editor` 由 core 持有，不直接承载新增的 UI 工作区。左右工作区和 Toast 均挂到 EditorShell 的 editor region，与 `.jw-editor` 为兄弟节点。

## 2. 明确非目标

- 不把批注改造成固定右侧栏。
- 不改变批注 range、page rail、Canvas overlay 或滚动同步算法。
- 不让左右工作区挤压、缩放或重排正文。
- 不改变查找替换、链接、页眉页脚等锚定面板的位置语义。
- 不把所有 live-region 播报都显示为 Toast。
- 不把开发者异常机械翻译成用户文案。
- 不引入外部 i18n、日志或通知依赖。
- 不处理 License、DOCX、PDF、协作部署或商业发布。

## 3. 左右浮动工作区模块

### 3.1 Seam 与职责

工作区模块的 seam 位于 UI 装配层。模块只负责：

- 根据 `left` / `right` 创建稳定宿主。
- 把宿主放入 editor region。
- 设置可识别的 data attribute。
- 在销毁时只移除自身创建的宿主。
- 显式外部 `host` 存在时不创建默认工作区。

目录和修订 controller 继续只负责自身数据、交互和可见性，不读取 EditorShell 内部结构。

### 3.2 布局约束

- editor region 使用 `position: relative`，但不改变正文流式尺寸。
- 左右宿主使用 `position: absolute`，`top`、`bottom` 保持一致，因此可占满编辑区域可用高度。
- 左侧宿主贴左，右侧宿主贴右。
- 宿主自身 `pointer-events: none`，可见面板恢复 `pointer-events: auto`。
- 目录和修订各自滚动，不接管正文滚动。
- 窄屏保持覆盖式行为，不挤压正文；面板宽度受编辑区域宽度限制。
- 两侧可以同时显示，因为它们承载不同功能且不占真实布局位置。

### 3.3 默认与高级集成

- `createJWord({ host })`：工具配置包含目录或修订时自动创建对应侧工作区。
- 低层 `createJWordUi(...)`：传入 `editorHost` 且未显式传面板 `host` 时创建默认侧工作区。
- 显式传入 `headingOutline.host` 或 `revisions.host` 时尊重宿主位置，不移动传入节点。
- `destroy()` 后不得残留默认左右宿主。

## 4. Toast 模块

### 4.1 公开接口

```ts
type JWordToastType = 'info' | 'success' | 'warning' | 'error'

interface JWordToastOptions {
  readonly message: string
  readonly type: JWordToastType
  readonly duration: number
}

interface JWordUiInstance {
  toast(options: JWordToastOptions): void
}
```

`duration` 使用毫秒。小于等于 `0` 表示不自动关闭；新 Toast 替换当前 Toast，并清理旧定时器。

### 4.2 默认行为

- 默认挂在 editor region 顶部居中，不占真实布局位置。
- 同一编辑器实例同时最多显示一个 Toast。
- `type` 写入稳定 data attribute，用于样式和测试，不通过解析文案推断类型。
- Toast 文案由调用点通过当前 i18n 字典解析；Toast 模块不保存业务字典。
- Toast 同步写入 live region，`warning` / `error` 使用 assertive，其余使用 polite。
- `destroy()` 清理 DOM 和定时器。
- 首个内建接入点是无选区点击批注；其他高频状态播报暂不改成 Toast。

## 5. Debug 日志模块

### 5.1 公开配置

```ts
type JWordLogLevel = 'debug' | 'info' | 'warning' | 'error'

interface JWordLogEntry {
  readonly level: JWordLogLevel
  readonly scope: string
  readonly event: string
  readonly message: string
  readonly details?: Readonly<Record<string, unknown>>
}

interface JWordLogger {
  write(entry: JWordLogEntry): void
}

interface JWordDebugOptions {
  readonly enabled?: boolean
  readonly logger?: JWordLogger
}

interface CreateJWordUiOptions {
  readonly debug?: boolean | JWordDebugOptions
}
```

### 5.2 输出规则

- 默认 `debug` 关闭，不新增 console 输出。
- `debug: true` 使用内建 console adapter。
- 自定义 `logger` 时把结构化 entry 交给宿主，不直接写 console。
- 内建格式固定为 `[JWord][scope][event] message`。
- `debug` / `info` / `warning` / `error` 分别使用对应 console 方法；浏览器没有 `console.debug` 时不做额外兼容抽象。
- 日志必须标明功能来源，例如 `comments/selection-required`、`toast/show`、`revisions/open`。
- 默认不把正文、选区文本、批注正文、授权 token、完整 URL 或文件内容放入 `details`。
- debug 仅用于开发和问题定位，不作为用户提示的替代品。

### 5.3 第一阶段接入

第一阶段接入以下事件：

- UI 创建、语言切换、主题切换、销毁。
- 左右工作区创建和面板开关。
- Toast 显示、替换、超时关闭。
- 批注因无选区被阻止。
- 现有 live-region 播报的统一兜底日志，未迁移调用点使用 `scope: 'ui'`。

后续按功能域把兜底 `ui` scope 收敛成明确来源，不一次改写所有 controller。

## 6. i18n 整体治理

### 6.1 文案分类

必须进入 i18n：

- 可见按钮、标题、占位符、空状态和验证提示。
- Toast 内容。
- aria-label、live-region 和屏幕阅读器状态播报。
- 面向最终用户的 warning/error。

不直接进入 i18n：

- 开发者 invariant 和不可恢复编程错误。
- 内部错误码、诊断 event 名称和 debug scope。
- 测试名称、代码注释和开发脚本输出。

### 6.2 字典与调用规则

- 继续复用 `packages/ui/src/i18n.ts`，不引入外部 runtime。
- 内建语言保持 `zh-CN` 与 `en-US`。
- 调用点使用稳定 key；i18n callback 自动以中文内建字典作为 fallback，不再接受调用点传入的兜底值。
- 两套内建字典必须同步包含新增 key。
- 动态 `setLocale(...)` 必须刷新当前可见面板和后续 Toast 所读取的字典。
- Debug 日志不是用户界面文案，不进入 i18n 字典，也不要求随 locale 切换。
- 日志的 `scope` / `event` 保持稳定英文标识；只有在记录已经产生的用户反馈时，`message` 才可能包含调用点当时已经解析好的可见文案。

### 6.3 分批迁移顺序

1. 本方案新增 Toast 文案、左右工作区 aria 文案、修订操作结果。
2. toolbar 撤销/重做、格式、段落和只读阻断消息。
3. selection actions、剪贴板、链接与批注错误消息。
4. 表格、媒体、粘贴、页眉页脚消息。
5. architecture 检查：阻止 UI 源码新增直接用户可见中文，同时允许注释、测试和开发者错误。

每批只添加证明该批动态切换和宿主覆盖行为所需的最少测试。

## 7. 分步实施与验证

### 步骤 1：冻结设计与修改前基线

- 保存本文档并加入 current-implementation 索引。
- 验证现有 EditorShell、目录、修订、toolbar 和状态栏测试。
- 失败时停止，不进入运行代码修改。

### 步骤 2：实现左右浮动工作区

- 新增工作区挂载 helper。
- 目录默认挂左，修订默认挂右。
- 修改 editor region 和面板样式。
- 增加默认挂载、外部 host、同时显示和 destroy 测试。

Focused 验证：

```bash
pnpm exec vitest run \
  packages/ui/test/editor-shell.test.ts \
  packages/ui/test/create-ui-heading-outline.test.ts \
  packages/ui/test/create-ui-revisions.test.ts
```

### 步骤 3：实现 Toast 与批注提示

- 新增 Toast controller。
- 在 `JWordUiInstance` 暴露 `toast(...)`。
- 无选区批注同时显示 Toast 和 live-region 消息。
- 增加替换、超时、类型、动态语言和 destroy 测试。

Focused 验证：

```bash
pnpm exec vitest run \
  packages/ui/test/create-ui-toolbar.test.ts \
  packages/ui/test/editor-shell.test.ts \
  packages/ui/test/create-ui-i18n.test.ts
```

### 步骤 4：实现 Debug 日志

- 新增 logger 类型、console adapter 和 controller。
- 接入 UI 生命周期、Toast、左右工作区和批注阻断。
- 验证默认静默、debug 输出、自定义 logger 和敏感 details 边界。

Focused 验证：

```bash
pnpm exec vitest run packages/ui/test/create-ui-debug.test.ts
```

### 步骤 5：实施 i18n 第一阶段

- 补齐本方案新增 key 和修订 controller 的硬编码用户消息。
- 验证默认中文、英文、宿主覆盖和动态切换。
- 记录剩余功能域，不把未迁移项写成完成。

Focused 验证：

```bash
pnpm exec vitest run \
  packages/ui/test/create-ui-i18n.test.ts \
  packages/ui/test/create-ui-revisions.test.ts
```

### 步骤 6：阶段回归

```bash
pnpm typecheck
pnpm lint
pnpm build
pnpm exec vitest run \
  packages/ui/test/editor-shell.test.ts \
  packages/ui/test/create-ui-heading-outline.test.ts \
  packages/ui/test/create-ui-revisions.test.ts \
  packages/ui/test/create-ui-toolbar.test.ts \
  packages/ui/test/create-ui-status-bar.test.ts
```

如运行代码影响到 vanilla 默认页，再执行对应 Chromium EditorShell E2E。任何 focused 验证失败时先停在当前步骤修复，不进入下一步。

## 8. 风险与控制

- **覆盖正文交互**：工作区宿主使用 `pointer-events: none`，只有面板恢复交互。
- **批注与右侧修订重叠**：两套机制保持独立；浏览器验证宽屏和窄屏覆盖关系，不移动 page rail。
- **外部 host 回归**：显式 host 测试确保 helper 不接管宿主所有权。
- **Toast 定时器泄漏**：替换和销毁都先清理旧 timer。
- **日志泄露内容**：结构化 details 不记录正文、选区内容、token 和完整 URL。
- **i18n key 漂移**：中文、英文、宿主覆盖和动态切换在同一 focused 测试验证。
- **当前未提交改动冲突**：仅在相关文件当前内容上做外科式补丁，不回退已有 panel、文件拆分或 smoke 修改。

## 9. 完成标准

- 左侧目录和右侧修订均覆盖式占满编辑区域高度，不改变正文宽度。
- 两侧可以同时打开；批注 page rail 行为不变。
- `ui.toast({ message, type, duration })` 可用，无选区批注有可见双语提示。
- debug 默认静默，开启后日志包含来源、事件和内容，自定义 logger 可接管输出。
- 新增用户文案均有中英文 key；修订第一阶段硬编码消息已迁移。
- focused tests、typecheck、lint、build 通过。
- 不提交代码，不进入 License 或其他后续阶段。

## 10. 当前实施状态与验证证据

2026-07-12 已完成本方案全部既定批次：

- 左侧目录和右侧修订记录使用独立绝对定位工作区，不改变正文真实宽度。
- 批注继续使用每页 Canvas page rail。
- 公开 `ui.toast({ message, type, duration })` 已实现，无选区批注已接入中英文 warning Toast。
- 实例级 debug 日志已实现，默认关闭，支持 console adapter 和宿主 `logger.write(entry)`；debug 文案不进入 i18n。
- 目录大纲和修订记录均增加顶部标题与关闭图标；关闭只影响对应工作区，工具栏 `aria-pressed` 同步更新，标题和关闭标签支持中英文动态切换。
- i18n 五个批次均已完成：Toast/工作区/修订、toolbar、selection actions/剪贴板/链接/批注、表格/媒体/粘贴/页眉页脚，以及 architecture 防回退检查。
- 表格和媒体内建 core adapter 通过当前实例字典生成用户结果消息；宿主 adapter 自己返回的错误文本保持宿主所有权。
- `tests/architecture/ui-i18n-user-text.test.ts` 阻止上述用户播报入口重新写入直接中文，并验证四个末批功能域的中英 key 对齐；注释、测试、debug、开发者 invariant 和 sanitizer 诊断不纳入该门禁。
- toolbar controller 的历史/导出绑定提取到 `toolbar/history-controls.ts`，当前 controller 为 365 行，继续满足 400 行 S5 预算。

实际验证：

```text
PASS  pnpm --filter @4xian/jword-ui test  (42 files, 183 tests)
PASS  pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts tests/architecture/ui-i18n-user-text.test.ts  (3 files, 20 tests)
PASS  pnpm typecheck
PASS  pnpm lint
PASS  pnpm build
PASS  node tools/release/normalize-dist-relative-imports.mjs --check
PASS  node --input-type=module -e "await import('./packages/core/dist/index.js')"
PASS  pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts --project=chromium  (3 tests)
PASS  node tools/release/gate7-release-dry-run.mjs
PASS  node tools/release/check-gate7-third-party-smoke.mjs  (pack/install/no-alias/typecheck/build/Chromium)
```

third-party smoke 安装期间 registry 曾返回一次 `ECONNRESET`，pnpm 自动重试后命令最终 exit code 为 0。未提交代码，未进入 License、DOCX 或协作阶段。

本方案完成不代表 `JWR-P2-211` 的完整国际化矩阵已关闭。RTL、更广语言、字体和输入法支持仍属于后续独立范围；debug 日志按既定决策不纳入 i18n。
