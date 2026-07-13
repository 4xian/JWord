# 本轮验证证据与边界

## 快照标识

| 项目 | 值 |
| --- | --- |
| 日期 | 2026-07-10 |
| 分支 | `feature/review_questions` |
| HEAD | `fb4d8a830d04d4935dc2f076fcc05b9a4b636893` |
| 审查开始时变更路径 | 755 |
| 变更分类 | 588 `M`、119 `A`、39 `D`、7 `MM`、1 `AM`、1 `R` |
| 审查行为 | 只读检查和新增本报告；未改业务源码、未 commit、未 publish |

本报告新增后，`git status` 的路径数量会高于 755；755 是代码审查基线，不包含本报告文件。

## 代码理解与静态取证

- 先完整阅读 `docs/current-implementation/README.md` 及其 package/backlog/verification/release 入口。
- 当前仓库存在 `.codegraph`，结构审查先使用 CodeGraph；索引约 653 files、10355 nodes、24904 edges。
- 对公开 API、控制流、字符串、package metadata、CI 和 line budget 使用精确源码读取、`rg` 与 `wc -l` 复核。
- 三个并行审查方向：架构/Host、产品/企业能力、工程/安全；主进程对重叠发现做去重和严重度校准。

## 本轮实际执行结果

### 基础门禁

| 命令 | Exit | 结果 |
| --- | ---: | --- |
| `pnpm lint` | 1 | `examples/vanilla/src/main.ts:26,29,31,34` 的英文注释触发 comment lint。 |
| `pnpm typecheck` | 2 | `examples/vanilla/src/main.ts:133` 的 `window.__jwordDemo` 缺 `selectTextRange`、`native`。 |
| `pnpm test:types` | 0 | 通过；只证明当前类型 fixture 编译。 |

### 2026-07-10 后续 typecheck 复验

在本次产品决策同步期间再次执行：

```bash
pnpm typecheck
```

结果为 exit 2，共 32 个错误：18 个 `TS2722` 和 14 个 `TS18048`。错误全部位于 `examples/vanilla/tests`，集中在 `window.__jwordDemo.selectTextRange` 与 `window.__jwordDemo.native` 的可选性没有被调用侧窄化。该结果取代上表中“仅 `main.ts:133` 缺字段”的旧错误形态，说明此前类型声明已被局部调整，但根 typecheck 尚未恢复。

### 2026-07-10 第一批 typecheck 修复复验

本批次先在当前工作树复现同一失败：

```bash
pnpm typecheck
```

修复前结果为 exit 2，共 32 个错误，其中 18 个 `TS2722`、14 个 `TS18048`；涉及 `examples/vanilla/tests` 对 `window.__jwordDemo.selectTextRange` 与 `window.__jwordDemo.native` 的必选调用。

核对运行时后确认，`demo-controls.ts` 已提供 `selectTextRange` bridge，`demo-native.ts` 已提供 native persistence bridge；native 只有内部 worker runtime 在首次保存/打开时懒加载。最近改动删除了 `main.ts` 中两个 bridge 的创建、暴露和销毁接线，并把 `vite-env.d.ts` 中相应字段改成可选，导致运行时对象、全局声明与测试调用不一致。

恢复两个既有 bridge 的入口接线，并把两个始终存在的字段恢复为必选后，再次执行：

| 日期 | 命令 | Exit | 结果 |
| --- | --- | ---: | --- |
| 2026-07-10 | `pnpm typecheck` | 0 | 通过；根 TypeScript 检查无错误。 |

该 exit 0 结果 supersede 本文当前 `pnpm typecheck` 失败状态；上方两次历史失败记录继续保留。此次只关闭 `JWR-P0-006` 的 typecheck 子任务，不覆盖 lint 与 focused file-budget 红灯，也不代表其它 P0/P1/P2 问题已关闭。

### 2026-07-10 第二批 EditorShell 复验

本批次新增 `createJWord({ host })` 与 `JWordEditorShell`，默认根 Host 直属 toolbar、editor、status bar 三个区域。Quickstart、vanilla 默认页和 React/Vue wrapper 已切换为单 Host；低层 `createEditor() + createJWordUi()` 保留为 advanced interface。默认 `/` 不再声明或接线 `__jwordDemo`，复杂 Gate、media/table/native 和测试 bridge 已迁入 `/test-fixture.html` 与 `examples/vanilla/tests/fixtures`，名称收口为 `__jwordTestFixture`。

后续 DOM 复核发现第二批曾在 editor 区域中额外创建无行为价值的包装元素，其未隐藏的 live-region Host 会把光标/选区播报显示为普通文本。该包装元素及独立 live-region/text-mirror Host 已删除；普通 panel 固定使用 editor 区域且不公开额外挂载 slot，UI 播报与 text mirror 复用 core editor 已创建的视觉隐藏节点。

构造失败反馈环覆盖两类真实泄漏：toolbar 内建 select 的 `destroy()` 曾在 `createControl()` 中被丢弃；toolbar 完成后其它 UI controller 抛错时，已创建资源曾因 `createJWordUi()` 未返回句柄而无法销毁。修复后 toolbar DOM 资源所有者保留 destroy，`createJWordUi()` 使用幂等反序清理栈，正常 destroy 与构造失败复用同一资源清单。外置 outline 另外显式绑定 editorHost，确保脱离 editor DOM 祖先关系后仍能按正文滚动同步高亮。

最终复验结果：

| 日期 | 命令 | Exit | 结果 |
| --- | --- | ---: | --- |
| 2026-07-10 | `pnpm typecheck` | 0 | 根 TypeScript 检查通过。 |
| 2026-07-10 | `pnpm test:types` | 0 | public API type fixture 通过，包含 EditorShell 新入口。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-example-vanilla typecheck` | 0 | 默认 demo 与独立测试夹具类型检查通过。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-ui test` | 0 | 40 files、175 tests 通过。 |
| 2026-07-10 | EditorShell/toolbar/outline focused Vitest | 0 | 4 files、28 tests 通过，包含深层和后置构造失败回滚。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-ui build` | 0 | 生成最新 UI declaration，供 wrapper 类型检查消费。 |
| 2026-07-10 | React/Vue package typecheck | 0 | 两个 wrapper 均通过。 |
| 2026-07-10 | 第二批 15 文件跨包/架构 Vitest | 0 | 15 files、63 tests 通过。 |
| 2026-07-10 | 两条 vanilla Chromium smoke | 0 | 2 tests 通过；默认 `/` 为单 Host、无测试 bridge 或额外辅助 Host，`/test-fixture.html` 可装配 theme/i18n 场景。 |
| 2026-07-10 | `pnpm lint` | 0 | ESLint、依赖版本、boundary 与中文注释检查通过；该结果 supersede 上方 lint 失败状态。 |
| 2026-07-10 | focused core/toolbar file-budget Vitest | 1 | 18 tests 中 2 失败：`layout/query.ts` 1039/1000、`runtime.test.ts` 1060/1000、toolbar controller 1024/400；本批次不做文件拆分。 |

根据最终产品决策，EditorShell 随后彻底删除普通 panel 的 portal 公共 seam；`JWordEditorShellSlots` 只保留 comments、outline、fullscreen，link、header/footer、find/replace、revisions 固定使用 editor 区域。代码、示例和测试中不再存在 portal selector、Host 或 slot；授权文档中的 license portal/customer portal 是不同业务概念，继续作为未来范围保留。

| 日期 | 命令 | Exit | 结果 |
| --- | --- | ---: | --- |
| 2026-07-10 | EditorShell 与四类 panel focused Vitest | 0 | 5 files、32 tests 通过；普通 panel DOM 归属和后置构造失败回滚通过。 |
| 2026-07-10 | `pnpm typecheck` | 0 | 删除 portal slot 后根 TypeScript 检查通过。 |
| 2026-07-10 | `pnpm test:types` | 0 | public API type fixture 通过，不再声明 portal slot。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-ui test` | 0 | 40 files、175 tests 通过。 |
| 2026-07-10 | `pnpm lint` | 0 | ESLint、依赖版本、boundary 与中文注释检查通过。 |
| 2026-07-10 | 两条 vanilla Chromium smoke | 0 | 2 tests 通过；默认 EditorShell 与 theme/i18n 测试夹具均正常。 |

第二批退出标准已经满足，但这不是完整 RC 或销售结论。`JWR-P0-005` 的 tarball 空项目消费、`JWR-P1-119` 的低层 Host 文档及外置 slot 契约和 focused file-budget 仍保持 Open；OEM License 第三批尚未开始。

#### 第二批连续输入滚动补充验证

默认 EditorShell 连续输入时，core 现在按“折叠光标是否超出 canvas 可视区”决定纵向滚动，与是否跨页无关；同一页只显示局部页面和跨页输入都适用。`.jw-editor` 同时隔离隐藏 textarea 的绝对定位溢出，避免辅助输入节点扩大 EditorShell 祖先高度。用户主动滚离光标时，光标闪烁不会抢回视口；再次输入或真实选择变化后才恢复光标可见性。

| 日期 | 命令/范围 | Exit | 结果 |
| --- | --- | ---: | --- |
| 2026-07-10 | `pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts --project=chromium` | 0 | 2 tests 通过；同一页与跨页连续输入均触发滚动，光标保持可见，根 Host 和 editor Host 不被隐藏 textarea 撑高；手动滚动在光标闪烁后保持不变，再次输入才回到光标。 |
| 2026-07-10 | 真实 Chromium 200% 缩放单页连续输入 40 行 | 0 | 仍为 1 页时 `scrollTop=1197`，光标保持在 viewport 内，证明滚动条件不依赖跨页。 |
| 2026-07-10 | 真实 Chromium 连续输入 160 行 | 0 | 生成 4 页；`scrollTop=3417.5`，光标位于 viewport 内，根 Host 为 `802/802`、editor Host 和 `.jw-editor` 均为 `674/674`（clientHeight/scrollHeight），状态栏显示第 4 / 4 页。 |
| 2026-07-10 | `pnpm exec vitest run packages/core/test/editor/input-runtime-keyboard.test.ts` | 0 | 1 file、13 tests 通过。 |
| 2026-07-10 | `pnpm typecheck` | 0 | 根 TypeScript 检查通过。 |
| 2026-07-10 | `pnpm lint` | 0 | ESLint、依赖版本、boundary 与中文注释检查通过。 |
| 2026-07-10 | `pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts examples/vanilla/tests/gate7-theme-i18n.e2e.ts --project=chromium` | 0 | 3 tests 通过；EditorShell 滚动回归与 theme/i18n smoke 同时通过。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-core test` | 1 | 71 files、365 tests 通过；3 个既有空测试文件因 `No test suite found` 失败：`facade-runtime.test.ts`、`input-runtime.test.ts`、`layout/runtime.test.ts`。本次未修改这些文件。 |

#### 第二批 EditorShell 初始化聚焦补充验证

`initialFocusPosition` 的 core 契约和默认 `end` 未发生变化；问题是默认 `createJWord()` 完成 mount 和 UI 装配后没有调用 `editor.focus()`。EditorShell 现在只在全部装配成功后主动聚焦输入层，不改变 advanced `createEditor() + createJWordUi()` 的手动焦点控制语义。

| 日期 | 命令/范围 | Exit | 结果 |
| --- | --- | ---: | --- |
| 2026-07-10 | 修复前 `pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts --project=chromium` | 1 | 默认页面等待 5 秒后隐藏 textarea 仍为 inactive；连续输入滚动用例通过。 |
| 2026-07-10 | 修复后同一条 Chromium E2E | 0 | 2 tests 通过；默认页面加载后 core 隐藏输入层已聚焦，连续输入滚动回归继续通过。 |
| 2026-07-10 | EditorShell + core focus focused Vitest | 0 | 2 files、19 tests 通过；默认 `end` 落在索引 6，显式 `start` 落在索引 0。 |
| 2026-07-10 | `pnpm --filter @4xian/jword-ui test` | 0 | 40 files、176 tests 通过，包含 EditorShell 构造失败回滚。 |
| 2026-07-10 | `pnpm typecheck` | 0 | 根 TypeScript 检查通过。 |
| 2026-07-10 | `pnpm lint` | 0 | ESLint、依赖版本、boundary 与中文注释检查通过。 |
| 2026-07-10 | EditorShell 与 theme/i18n Chromium smoke | 0 | 3 tests 通过。 |

### 聚焦测试

| 命令/范围 | 结果 | 解释 |
| --- | --- | --- |
| `pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts packages/vue/test/vue-wrapper.test.ts` | 2 files、3 tests 通过 | 绿灯没有覆盖真实 mount、CSS 和 Vue readonly 默认值。 |
| Quickstart + React/Vue SSR + Vue wrapper 四文件聚焦运行 | 4 files、5 tests 通过 | 只证明现有测试声明的边界；没有 hydration 和动态 prop 路径。 |
| `pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts` | 18 tests，16 通过、2 失败 | core 两个文件超过 1000；toolbar controller 超过 400。 |

### 发布产物

| 命令 | Exit | 结果 |
| --- | ---: | --- |
| `node tools/release/gate7-release-dry-run.mjs` | 0 | 输出 `status: ok`，但只检查文件存在、manifest 和 pack 清单。 |
| `node tools/release/normalize-dist-relative-imports.mjs --check` | 1 | 多个 core `.js/.d.ts` 产物需要补相对 specifier 后缀。 |
| `node --input-type=module -e "import('./packages/core/dist/index.js')"` | 1 | `ERR_MODULE_NOT_FOUND`，无法解析 `packages/core/dist/canvas/pool`。 |
| `node tools/release/check-gate7-third-party-smoke.mjs` | 1 | pnpm 安装阶段请求未发布的 `@4xian/jword-*` registry 包，未进入 type/build/browser。 |

## 2026-07-11 阶段 0A 最新验证证据

本节以当前 HEAD `89eda9f328a5a73d8afadecbc80bab34428f847d` 的工作树实现为准，supersede 上述文件预算、dist/ESM 和基础 third-party smoke 的历史红灯；其它 License、DOCX、协作、安全和完整发布问题不受影响。本阶段没有 commit、push 或 PR。

### 文件预算和 focused 回归

| 命令/范围 | Exit | 结果 |
| --- | ---: | --- |
| Core query、runtime pagination、runtime initialization、runtime focused Vitest | 0 | 4 files、46 tests 通过。 |
| toolbar controller、readonly、create UI、EditorShell、theme/i18n focused Vitest | 0 | 5 files、31 tests 通过。 |
| `pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts` | 0 | 2 files、18/18 tests 通过；没有调整预算或跳过检查。 |

Architecture 使用的最终门禁计数：

| 文件 | 修复前 | 修复后 | 预算 |
| --- | ---: | ---: | ---: |
| `packages/core/src/layout/query.ts` | 1039 | 827 | 1000 |
| `packages/core/test/editor/runtime.test.ts` | 1060 | 968 | 1000 |
| `packages/ui/src/toolbar/controller.ts` | 1024 | 390 | 400 |

### 阶段级构建与发布基线

| 命令 | Exit | 结果 |
| --- | ---: | --- |
| `pnpm typecheck` | 0 | 根 TypeScript 检查通过；拆分文件精确复核也通过。 |
| `pnpm lint` | 0 | ESLint、依赖版本、boundary 和中文注释检查通过。 |
| 拆分涉及的 10 个 TypeScript 文件精确 ESLint | 0 | 未发现未使用 import、未使用类型导入或失效符号。 |
| `pnpm build` | 0 | 全部 public package Rollup 构建完成，并执行 dist import normalization。 |
| `node tools/release/normalize-dist-relative-imports.mjs --check` | 0 | 当前 dist 相对 import 已规范化。 |
| `node --input-type=module -e "await import('./packages/core/dist/index.js')"` | 0 | core Node ESM import 通过。 |
| `node tools/release/gate7-release-dry-run.mjs` | 0 | `status: ok`，未执行 publish，仍要求人工审批。 |

三个原文件另使用 TypeScript AST 逐项统计 import 在 import 区域之外的引用次数；发现并删除 `query.ts` 的 `createTableFragmentLine` 与 `toolbar/controller.ts` 的 `SelectionState` 两处无效导入。`runtime.test.ts` 的全部导入均有实际引用，清理后精确 ESLint、typecheck、focused tests、architecture、build 和 smoke 已重新通过。

### Third-party smoke 端口隔离

修复后的 smoke 主进程通过 `node:net` 在 `127.0.0.1:0` 申请一次动态端口，关闭探测 socket 后立即通过 `JWORD_GATE7_SMOKE_PORT` 传给 Playwright 的全部进程。生成配置使用同一端口构造 Vite `--port`、`webServer.url` 和 `use.baseURL`，Vite 启用 `--strictPort`，`reuseExistingServer` 保持 `false`。

执行期间 PID 61802 的既有 Vite 始终监听 5173，没有被停止或复用。最终：

| 阶段 | 结果 |
| --- | --- |
| 本地 package tarball pack | 通过 |
| 临时空项目 install | 通过 |
| no-alias resolve | 通过 |
| TypeScript typecheck | 通过 |
| Vite production build | 通过 |
| Playwright Chromium | 1/1 通过 |

实现过程中保留了两次真实失败证据：首次因临时项目缺少 Node types 停在 typecheck；补齐根项目锁定的 `@types/node` 后，第二次因 Playwright 多进程重复加载配置、分别申请端口而在 Chromium 得到 `ERR_CONNECTION_REFUSED`。最终方案改为由 smoke 主进程只申请一次并通过环境变量共享，随后 focused 和阶段级两次完整 smoke 均 exit 0，Playwright 管理的 Vite/worker 进程均正常退出。

临时 consumer 的实际安装输出使用 pnpm 10.33.0；该版本差异没有导致本次失败，不在阶段 0A 扩大处理，后续如需固定发布 runner 版本应归发布治理记录。

## 2026-07-12 单 Host EditorShell 默认能力补充验证

根因是 `createEditorShellUiOptions()` 只在调用方显式传入 `ui.comments/link/headerFooter/findReplace/headingOutline/revisions` 时创建对应 controller，而默认工具栏仍渲染这些入口。修复后先解析最终工具栏配置，再自动装配可见工具依赖的 controller；显式 UI 配置和高级 slots 保持优先，隐藏工具不额外装配。`export.native` 仍按既定契约派发宿主事件，不属于内部 panel controller。

后续真实页面复验又确认了两个独立缺陷。第一，查找替换虽然已创建，但作为 `editor` 区域普通流的末尾子节点位于 `y=686`、高度 `104px`，被 720px 高的 EditorShell 根容器裁切；现改为锚定工具栏按钮下方并限制在视口边缘内，修订面板继续在中间编辑区域内居中并限制最大高度。第二，共享文档面板把整条 toolbar 误判为内部点击，水印和链接也缺少完整的外部收起，因此不同临时弹层可以叠加；现保留同一触发器切换和弹层内部交互，打开其它工具或点击外部会关闭旧弹层，select 选择值后继续关闭。目录与批注按既有持续工作区契约保留，不纳入临时弹层互斥。

| 命令/范围 | Exit | 结果 |
| --- | ---: | --- |
| 修复前 `pnpm exec vitest run packages/ui/test/editor-shell.test.ts` | 1 | 7 tests 中 2 项按预期失败，默认及仅显示链接场景的 panel 均为 `null`。 |
| 修复后同一 EditorShell focused 命令 | 0 | 7/7 通过。 |
| 浮层互斥修复前 focused Vitest | 1 | 新增用例在“查找替换后打开页眉”处按预期失败；旧面板仍为可见。 |
| 查找替换定位修复前 Chromium | 1 | 面板可见但底部超出 editor 区域，完整可见性断言按预期失败。 |
| toolbar/link focused Vitest | 0 | 4 files、48/48 通过；覆盖内部点击、外部点击、切换新弹层和 select 选值关闭。 |
| `pnpm --filter @4xian/jword-ui test` | 0 | 40 files、178/178 通过。 |
| `pnpm exec playwright test examples/vanilla/tests/editor-shell.e2e.ts --project=chromium` | 0 | 3/3 通过；默认页实际打开批注、链接、页眉、页脚、页码、查找替换和修订，验证链接→页面、查找→修订、修订→字体的互斥、查找替换锚定工具栏按钮及修订面板完整位于编辑区。 |
| `pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts` | 0 | 18/18 通过。 |
| `pnpm typecheck` / `pnpm lint` / `pnpm build` | 0 | 类型、代码规范、注释、boundary 和全部 public package 构建通过。 |
| dist normalization check / core 与 UI Node ESM import | 0 | 产物相对 import 和 Node ESM 消费通过。 |
| release dry-run / third-party tarball smoke | 0 | dry-run `status: ok`；tarball install、typecheck、Vite build、Chromium 1/1 通过。 |

本次没有提交、push 或创建 PR，也没有进入 License、DOCX 或协作阶段。

## 2026-07-12 工作区、Toast、debug 与 i18n 方案完成证据

目录大纲和修订记录已增加顶部标题与独立关闭图标，关闭后同步更新对应工具栏按钮状态。i18n 已按方案完成五批迁移，最后一批覆盖表格、媒体、粘贴和页眉页脚用户消息；debug 日志保持稳定英文 scope/event，不纳入用户可见文案字典。新增 architecture 检查只约束稳定用户播报入口和中英 key 对齐，不扫描注释、测试、debug、开发者 invariant 或 sanitizer 诊断。

回归过程中 `phase5-file-split.test.ts` 曾发现 toolbar controller 为 416 行、超过 400 行预算。没有放宽阈值；撤销、重做和原生导出绑定按既有职责提取到 `packages/ui/src/toolbar/history-controls.ts` 后，controller 为 365 行，同一门禁重新通过。

| 命令/范围 | Exit | 结果 |
| --- | ---: | --- |
| 目录与修订 focused Vitest | 0 | 2 files、10/10 通过；覆盖标题、关闭、状态同步和中英文标签。 |
| toolbar i18n focused Vitest | 0 | 4 files、43/43 通过。 |
| selection actions、剪贴板、链接、批注 focused Vitest | 0 | 5 files、28/28 通过。 |
| 表格、媒体、粘贴、页眉页脚 focused Vitest | 0 | 现有相关测试全部通过；阶段中两次聚焦运行分别为 17/17 和 13/13。 |
| `pnpm --filter @4xian/jword-ui test` | 0 | 42 files、183/183 通过。 |
| `pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts tests/architecture/ui-i18n-user-text.test.ts` | 0 | 3 files、20/20 通过；未调整预算或跳过检查。 |
| `pnpm typecheck` | 0 | 根 TypeScript 检查通过。 |
| `pnpm lint` | 0 | ESLint、依赖版本、boundary 和中文注释检查通过。 |
| `pnpm build` | 0 | 全部 public package 构建完成。 |
| dist normalization check / core Node ESM import | 0 | 产物相对 import 和 Node ESM 消费通过。 |
| `node tools/release/gate7-release-dry-run.mjs` | 0 | `status: ok`，未 publish，仍要求人工审批。 |
| `node tools/release/check-gate7-third-party-smoke.mjs` | 0 | 本地 tarball install、no-alias、typecheck、Vite build、Chromium 1/1 全部通过；使用共享动态端口、`--strictPort` 和 `reuseExistingServer: false`。 |

本次没有提交、push 或创建 PR，没有进入 License、DOCX、协作或商业发布阶段。`JWR-P2-211` 的 RTL、更广语言、字体和输入法矩阵仍未完成，不能据此宣称完整国际化已关闭。

### 安全依赖

| 命令 | Exit | 结果 |
| --- | ---: | --- |
| `pnpm audit --prod` | 1 | 9 项：5 moderate、4 low；主要包含 DOMPurify 3.4.2，另有 Vue 2 示例低危项。 |

审查没有把 advisory 数量直接等同于可利用漏洞。`packages/ui/src/paste/sanitizer.ts:69-99` 的真实调用形状已单独检查；结论是发版前应升级/豁免和回归，而不是声称当前已有已验证 XSS。

## 静态确认但未执行攻击 PoC 的问题

以下由控制流直接确认，但本轮没有创建恶意 fixture 或攻击脚本：

- 默认 license 公钥与公开测试私钥匹配。
- 旧 tenant 没有进入 history/storage key；新版 V1 不再建设 tenant，而是删除/deprecate 表面能力并采用单 OEM deployment。
- admission/可信 `actorId` 尚未贯穿，authorId 来自 body。
- `.jword` reader 没有 ZIP/JSON 资源上限。
- restore 在持久化前已经替换目标文档。
- history load-modify-save 缺多实例事务语义。
- Hocuspocus 没有文档持久化 adapter，Docker 不启动 WS。
- panel Host 优先级导致三个显式 Host 被覆盖。

这些问题不依赖复杂运行条件，静态证据足以阻断发布；整改时仍应增加最小动态回归。

## 风险项，不写成已发生故障

- React/Vue hydration mismatch：当前只有 SSR 字符串测试，尚未动态 hydration 复现。
- iframe/跨 realm：全局 DOM 构造器使用已确认，但未跑 iframe E2E。
- 自研 Ed25519：缺审计是风险，不代表本轮已证明算法可破解。
- history 多实例竞争：契约无法保证原子性已确认，但未连接真实数据库做竞争 PoC。
- DOMPurify advisory：依赖版本受影响已确认，当前粘贴路径的实际可利用性没有被夸大。

## 本轮未执行项

未执行：

- 完整 `pnpm build`
- 完整 `pnpm test`
- 全量 `pnpm test:e2e`
- `pnpm test:visual`
- `pnpm bench`
- `pnpm size`
- 真实 registry publish
- Word 桌面人工兼容矩阵
- VoiceOver/NVDA/JAWS 人工矩阵

原因：当前 typecheck 已失败；`pnpm test` 会通过 pretest 先 build 并改写 `dist`；工作树已有大量用户改动，本轮不应为审查目的重写构建产物。未执行项统一标记为 unknown，不能引用 2026-07-07 的历史结果写成当前通过。

## 如何重做发布验收

整改完成后，应在干净 RC 上按以下顺序一次执行，并保留机器可读日志和 artifact：

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:types
pnpm build
node tools/release/normalize-dist-relative-imports.mjs --check
pnpm test
node tools/release/gate7-release-dry-run.mjs
node tools/release/check-gate7-third-party-smoke.mjs
pnpm audit --prod
pnpm test:e2e
pnpm test:visual
pnpm bench
pnpm size
```

随后再进行 Word 桌面、读屏、备份恢复、双实例协作和故障注入人工/集成矩阵。只有所有证据绑定同一 SHA 和 artifact，才能形成企业发布判断。
