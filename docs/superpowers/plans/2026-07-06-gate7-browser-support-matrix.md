# Gate 7 浏览器支持矩阵冻结

日期：2026-07-06  
对应问题：`docs/superpowers/reports/2026-07-02-plan-review.md` §3.13、修复计划 Phase 6 `[计划审查 3.13]`。  
公开落点：`docs/sdk/browser-support.md`、`docs/sdk/public-api.md`。

## 决策

1. 桌面编辑最低版本冻结为 Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4。
2. 移动端仅承诺只读分页预览，不承诺移动端编辑。
3. 构建 target 对齐 ES2022：发布包 tsconfig、示例 tsconfig 和示例 Vite build target 均保持 ES2022。
4. E2E 矩阵维持 Playwright Chromium / Firefox / WebKit 最新版；该矩阵是浏览器族回归，不替代最低版本实验室认证。
5. 低于矩阵的浏览器不由 SDK 内置 polyfill 兜底；需要旧浏览器时由宿主应用自行降级构建与补 polyfill。

## 构建与测试联动

- `packages/*/tsconfig.json` 已统一使用 `target: ES2022` 与 `lib: ES2022`。
- `examples/vanilla`、`examples/docx`、`examples/collab` 的 `tsconfig.json` 与 `vite.config.ts` 对齐 ES2022，避免示例/外部 smoke 产物高于公开支持矩阵。
- `package.json` 的 `test:e2e` 继续显式运行 `chromium`、`firefox`、`webkit`，`playwright.config.ts` 保留对应项目。
- `tests/architecture/gate7-browser-support.test.ts` 锁定公开文档、构建 target 和 Playwright 浏览器族，防止后续漂移。

## 移动端边界

移动端当前只承诺分页 canvas 可读、可滚动、不空白；不承诺触摸选区、虚拟键盘 IME、拖拽缩放、复杂工具栏编辑或移动端协作编辑。后续如要进入移动编辑，需要单独立项并新增移动输入、选区、布局和 a11y 验收矩阵。

## 验收

- 红灯先行：`pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts --reporter=verbose` 修前失败，缺 `docs/sdk/browser-support.md` 且示例 tsconfig 仍为 ES2024。
- 修复后 focused 验证：`pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts --reporter=verbose`。
- 追加验证：`pnpm typecheck`、`pnpm lint`、`git diff --check`。
