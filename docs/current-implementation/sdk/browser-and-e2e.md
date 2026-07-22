# 浏览器支持与稳定矩阵当前实现摘要

## 对应文档

- `docs/sdk/browser-support.md`
- `docs/sdk/stable-e2e-matrix.md`
- `playwright.config.ts`
- `tests/architecture/gate7-browser-support.test.ts`

## 浏览器支持口径

当前公开最低兼容目标（`LIC-107B2` 人工认证状态为 Deferred；内部阶段已条件性接受）：

- Chrome / Edge 100+
- Firefox 128+
- Safari 16.4+

构建 target 对齐 ES2022，但 target 不提供运行时 API polyfill。Playwright 的 Chromium/Firefox/WebKit 最新版和 `LIC-107B1` Dedicated Worker smoke 用于当前运行时回归，不等同于最低版本实验室认证；`LIC-107B2` 的 Node 20.19.0 已通过，Chrome 100、Edge 100、Firefox 128 和 Safari 16.4 仍需真实环境人工验证。该人工矩阵不阻断后续内部阶段，但在对应最低版本对外声明和商业 GA 前仍必须完成。

后续浏览器代码必须核对公开最低矩阵；JWord 自有源码优先采用 Chrome 92 已支持的写法，但直接依赖和完整 bundle 仍决定 SDK 公开下限，不能据此宣称 Chrome 92 完整支持。

## 窄屏边界

窄屏只承诺：

- 分页 canvas 可滚动预览。
- toolbar 样式不遮挡正文。
- 不建立单独移动端 editor/platform/product 口径。

## 稳定矩阵

当前稳定矩阵覆盖：

- vanilla free base，包括官方 toolbar、statusBar、theme/i18n 和 opt-in devtools 路径。
- React/Vue 3 wrapper。
- Vue 2 直接集成示例。
- native save/open。
- DOCX/PDF。
- collab client/server。
- plugin error isolation。
- release/no-alias。

## 验证入口

```bash
pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts --reporter=verbose
pnpm exec vitest run tests/architecture/gate7-sdk-docs.test.ts --reporter=verbose
node tools/release/gate7-release-dry-run.mjs
node tools/release/check-gate7-third-party-smoke.mjs
```

UI focused 补充入口：

```bash
pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/status-bar-state.test.ts packages/ui/test/create-ui-toolbar.test.ts --root .
pnpm exec playwright test examples/vanilla/tests/gate7-theme-i18n.e2e.ts --project=chromium
```

待补入口：

```bash
pnpm exec playwright test examples/vanilla/tests/gate7-status-bar.e2e.ts --project=chromium
```

## 当前限制

- 屏幕阅读器矩阵仍需按 `docs/current-implementation/screen-reader-manual-verification.md` 人工复核，自动化 a11y 不能替代朗读验证。
- 状态栏还缺专门 vanilla focused E2E；当前主体行为由 UI 单测和真实页面手测覆盖，发版前应补齐并记录。
- 完整 `pnpm test:e2e`、`pnpm test:visual`、`pnpm bench`、`pnpm size` 应在发布前 fresh run。
