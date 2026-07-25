# Gate 7 Stable E2E 矩阵

## 自动化矩阵

| 场景 | 入口 | 验收命令 |
|---|---|---|
| vanilla free base | `examples/vanilla` | `pnpm exec playwright test examples/vanilla/tests/gate7-theme-i18n.e2e.ts examples/vanilla/tests/gate7-devtools.e2e.ts --project=chromium` |
| vanilla toolbar/status bar focused | `examples/vanilla` + `@4xian/jword-ui` | 当前主体回归：`pnpm exec vitest run packages/ui/test/create-ui-status-bar.test.ts packages/ui/test/status-bar-state.test.ts packages/ui/test/create-ui-toolbar.test.ts --root .`；待补浏览器入口：`pnpm exec playwright test examples/vanilla/tests/gate7-status-bar.e2e.ts --project=chromium` |
| React wrapper | `@4xian/jword-react` | `pnpm --filter @4xian/jword-react test` |
| Vue wrapper | `@4xian/jword-vue` | `pnpm --filter @4xian/jword-vue test` |
| Vue 2 direct integration demo | `examples/vue2` | `pnpm --filter @4xian/jword-example-vue2 typecheck && pnpm --filter @4xian/jword-example-vue2 build` |
| native save/open | `@4xian/jword-native` | `pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose` |
| DOCX/PDF | `@4xian/jword-docx` / `@4xian/jword-pdf` | Gate 5 fixture diff、PDF visual report、worker capability test |
| collab browser SDK / Docker server | `@4xian/jword-collab` / 镜像内部 `@4xian/jword-collab-server` | Gate 6 client/server focused tests；LIC-309 后增加正式镜像验收 |
| plugin | `@4xian/jword-core` plugin host | `pnpm exec playwright test examples/vanilla/tests/gate7-plugin-error.e2e.ts --project=chromium` |
| release/no-alias | downloaded canonical run-a external project | `: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}" && node tools/release/check-gate7-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"` |


## 2026-07-07 fresh run 状态

| 范围 | 命令 | 状态 | 摘要 |
|---|---|---|---|
| no-alias 第三方消费 | `: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}" && node tools/release/check-phase3-third-party-consumers.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json" --evidence-dir "$PHASE3_CONSUMER_EXPORT"` | B4 canonical run-a 前置 | 只消费下载的 run-a；npm/pnpm、Node、Vite/browser 和 Worker evidence 写入指定 consumer handoff。 |
| 体积预算 | `pnpm size` | fresh pass | core entry `606650` bytes；vanilla 首屏 `699953` bytes，均低于当前预算。 |
| 视觉快照 | `pnpm test:visual` | fresh pass | visual baseline 检查 `4` 个，Playwright `8 passed`。 |
| 三浏览器 E2E | `pnpm test:e2e` | fresh pass | Chromium / Firefox / WebKit `329 passed`、`7 skipped`；perf-chromium `4 passed`。 |
| benchmark | `pnpm bench` | fresh pass | Gate 4.5、Gate 2、Phase 4、Gate 5、Gate 6 benchmark 均 `status: ok`。 |

## 浏览器矩阵

Playwright Chromium / Firefox / WebKit 最新版是自动回归矩阵；最低版本承诺以 [`browser-support.md`](./browser-support.md) 为准。

License 的当前三浏览器和 Dedicated Worker 自动证据归 `LIC-107B1`；`LIC-107B2` 的 Node 20.19.0 已通过，Chrome 100、Edge 100、Firefox 128、Safari 16.4 真实最低版本人工认证为 Deferred。该状态不阻断内部阶段，但完成前不得对外宣称最低版本已经实测认证。

## 收口规则

Gate 7 收口前必须同时满足：公开 API catalog、类型测试、文档链接、bundle size、release dry-run、no-alias smoke 和本矩阵 focused 命令均通过。真实 publish 仍需人工审批。

## 非阻断 Post-1.0 边界

以下事项记录在 `docs/current-implementation/backlog.md` 的后续路线图中，不属于当前收口阻断：comment 级服务端可写批注、Chrome Extension devtools、完整 RTL 布局、插件自定义 Operation union / stable decorations、真实 worker host / CSP 实验室验证、Yjs Snapshot / Automerge / Loro 替代路线研究。窄屏只保留分页滚动预览与工具栏样式适配，不作为独立 backlog 能力线。
