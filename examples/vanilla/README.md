# JWord Vanilla Example

当前 `examples/vanilla` 是 JWord 的 host app demo，不再是 Gate 0 空壳。

## Current Scope

- 使用 `@4xian/jword-core` 创建和挂载 Editor facade。
- 使用 `@4xian/jword-ui` 装配官方 toolbar、summary、live region、assistive text mirror 和 Gate 4 第一版 media panel。
- 继续保持不使用 `contenteditable`，编辑能力仍走 hidden textarea + transaction pipeline。
- 承担 demo-only 场景逻辑、fixture 切换和浏览器测试钩子。

## Current Responsibilities

- [examples/vanilla/src/main.ts](/Users/jian/Desktop/tools/JWord/examples/vanilla/src/main.ts:1)：host app 装配层，只负责 editor 创建、UI 挂载、demo 控件接线和 `window.__jwordDemo` 暴露。
- [examples/vanilla/src/demo-controls.ts](/Users/jian/Desktop/tools/JWord/examples/vanilla/src/demo-controls.ts:1)：demo-only 场景按钮、样例切换、测试辅助选区钩子。
- [examples/vanilla/src/demo-media.ts](/Users/jian/Desktop/tools/JWord/examples/vanilla/src/demo-media.ts:1)：Gate 4 demo media adapter、core image command 最小闭环和浏览器测试钩子。
- [examples/vanilla/tests](./tests)：Gate 2 / Gate 3 浏览器 E2E、视觉回归和 perf 证据。

## Gate 4 Media Contract

- 官方 media panel 通过 `createJWordUi({ media })` 挂在 `#jword-toolbar` 下方，不属于 demo-only 场景按钮。
- 当前 demo 已接上 core image command 的最小闭环：成功上传会进入 `applied`，失败与重试仍按真实上传状态暴露。
- 浏览器测试钩子位于 `window.__jwordDemo.media`：
  - `getFixtureUrl()`：返回 Gate 4 本地图片 fixture URL。
  - `buildScenarioUrl('success' | 'retry-once' | 'always-fail')`：构建同源 URL 场景。
  - `readUploadLog()`：读取当前页面生命周期内的上传结果日志。
- assistive text mirror 的 UI 侧稳定 selector 改为 `[data-jword-ui-text-mirror="true"]`，避免与 core 内部 mirror 混淆。

## Commands

```sh
pnpm --filter @4xian/jword-example-vanilla dev
pnpm --filter @4xian/jword-example-vanilla build
pnpm --filter @4xian/jword-example-vanilla typecheck
```
