# @4xian/jword-devtools 当前实现摘要

## 包职责

`@4xian/jword-devtools` 是 opt-in diagnostics 浮动面板包。它只消费 core `Editor.exportDiagnostics()` 的隐私裁剪 plain JSON snapshot，在宿主 DOM 中挂载 `<aside>` 面板；不读取 editor runtime、Y.Doc、provider、worker 或 package `src` 内部路径，也不依赖 `@4xian/jword-ui`。

## 入口与导出

- 包名：`@4xian/jword-devtools`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`。

## 公开 API 摘要

根入口导出：

- `attachJWordDevtools(editor, options)`
- `AttachJWordDevtoolsOptions`
- `JWordDevtoolsHandle`

## 主要 API

`attachJWordDevtools(editor, options)`：

- `options.host`：面板挂载宿主；缺省时使用 `document.body`。
- `options.className`：追加到默认 `jw-devtools` class 后。

返回 `JWordDevtoolsHandle`：

- `panel`：面板根 DOM。
- `refresh()`：重新调用 `editor.exportDiagnostics()` 并刷新面板；失败时渲染 devtools 自身错误并返回 `null`。
- `destroy()`：幂等移除面板 DOM。

面板展示 sections：

- `packageVersions`
- `featureFlags`
- `license`
- `operations`
- `layout`
- `selection`
- `collaboration`
- `server`
- `plugins`

## 生命周期方案

- 当前 devtools 是浏览器 DOM API 包，不是 SSR wrapper。
- 未传 `host` 时会读取 `document.body`，因此只应在浏览器环境或显式 DOM host 存在时调用。
- 调用后创建 `<aside data-jword-devtools-panel="true" role="complementary">`，应用内联基础样式，append 到 host，并立即执行一次 `refresh()`。
- 宿主可手动再次 `refresh()`。
- `destroy()` 设置 destroyed 标志并移除面板；destroy 后 `refresh()` 返回 `null`。

## 内部实现方案

- `attachJWordDevtools()` 接收 core `Editor`，创建 opt-in `<aside>` 面板并立即调用 `editor.exportDiagnostics()`。
- 面板只渲染 privacy-trimmed diagnostics snapshot 的 JSON summary，不订阅文档正文、不读取 Y.Doc、不访问 package 内部路径。
- `refresh()` 每次重新导出 diagnostics；导出失败时仅渲染 devtools 自身错误。
- `destroy()` 幂等移除面板 DOM；包无全局注册和自动注入逻辑。


## 与其它包关系

- 只从 core 消费 `Editor` 与 `JWordDiagnosticsSnapshot` 类型。
- 实际数据源是 `editor.exportDiagnostics()`。
- 面板展示的是已裁剪 diagnostics summary，不包含文档正文、token、license private key 或原始 HTML。
- 不导入 UI，也不会默认进入 vanilla 免费首屏；vanilla 示例仅在 `?devtools=true` 时动态 import。

## 主要测试/验收入口

- `packages/devtools/test/devtools.test.ts`
- `examples/vanilla/tests/gate7-devtools.e2e.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/architecture/gate7-api-export-audit.test.ts`
- `tests/architecture/gate7-examples-public-imports.test.ts`
- `tests/types/gate7-public-api-entrypoints.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-devtools typecheck`：校验 devtools handle、options 与 core diagnostics 类型。
- `pnpm --filter @4xian/jword-devtools test`：运行 devtools 包内挂载、刷新、销毁和错误渲染测试。
- `pnpm --filter @4xian/jword-devtools build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-examples-public-imports.test.ts`：回归公开 API catalog、导出审计与示例公开导入。

## 当前限制/注意点

- 当前实现是 opt-in 浮动面板，不是 Chrome Extension。
- 只渲染 `Editor.exportDiagnostics()` snapshot summary；没有独立 operation ring buffer、自动订阅刷新、可交互 layout overlay、tab 切换或拖拽停靠。
- `refresh()` 需要宿主手动调用；面板不会自动随每次 transaction 更新。
- 默认 host 依赖 `document.body`，不适合 SSR 阶段直接调用。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/devtools/package.json`
- `packages/devtools/src/index.ts`
- `packages/devtools/test/devtools.test.ts`
- `examples/vanilla/src/main.ts`
- `examples/vanilla/tests/gate7-devtools.e2e.ts`

