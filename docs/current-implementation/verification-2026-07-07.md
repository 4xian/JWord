# JWord fresh verification 记录

> 快照日期：2026-07-07。
> 本文对应 `JW-BACKLOG-003`，记录当前 checkout 的基础命令层和发布前长矩阵结果。
> 本次未执行真实 registry publish；真实发布仍以人工审批和 `JW-BACKLOG-006` 为准。

## 执行环境

| 项目 | 值 |
| --- | --- |
| cwd | `/Users/jian/Desktop/tools/JWord` |
| Node | `v24.14.0` |
| pnpm | `9.14.2` |
| Playwright | `1.59.1` |
| OS | `macOS 26.5.1 (25F80)` |
| 执行日期 | 2026-07-07 |

说明：第三方空项目 smoke 会在临时目录重新安装 tarball 依赖；该临时项目实际输出 `pnpm v10.33.0`，根项目命令仍以仓库 `packageManager` 记录的 `pnpm 9.14.2` 执行。

## 本地证据日志

本轮命令日志保存在 `.logs/jw-backlog-003-2026-07-07/`。该目录是本地验证产物，不入库；本文保留可审查的命令、结果和关键摘要。

| 范围 | 日志文件 |
| --- | --- |
| 环境 | `environment.log` |
| 基础质量 | `pnpm-lint-final.log`、`pnpm-typecheck-handoff-verify.log`、`pnpm-test-types-final.log`、`pnpm-build-final.log`、`pnpm-test-final.log`、`gate7-release-dry-run-final.log` |
| 第三方 tarball smoke | `gate7-third-party-smoke-final.log` |
| 体积 | `pnpm-size-final-rerun.log` |
| 视觉 | `pnpm-test-visual-final.log` |
| E2E / perf | `pnpm-test-e2e-after-size-fix.log` |
| benchmark | `pnpm-bench-final.log` |
| Firefox focused 回归 | `e2e-firefox-select-all-handoff-verify.log` |

## 基础命令矩阵

| 命令 | 结果 | 摘要 |
| --- | --- | --- |
| `node -v` | 通过 | `v24.14.0` |
| `pnpm -v` | 通过 | `9.14.2` |
| `pnpm lint` | 通过 | ESLint、package 依赖版本、core boundary、代码注释语言检查均通过。 |
| `pnpm typecheck` | 通过 | `tsc -p tsconfig.json --noEmit` 通过；修复后再次执行仍通过。 |
| `pnpm test:types` | 通过 | 公开 API 类型 fixture 通过。 |
| `pnpm build` | 通过 | 12 个 package 入口和 worker/experimental 子入口完成 Rollup 构建。 |
| `pnpm test` | 通过 | 先执行 `pnpm build`，随后 Vitest `218` 个测试文件、`956` 个测试通过；jsdom 输出 canvas getContext not implemented 提示但退出码为 0。 |
| `node tools/release/gate7-release-dry-run.mjs` | 通过 | JSON 报告 `status: ok`，`publish: not-run`，`manualApprovalRequired: true`，12 个包 `failures: []`。 |

## 长矩阵 fresh run

| 命令 | 结果 | 摘要 |
| --- | --- | --- |
| `node tools/release/check-gate7-third-party-smoke.mjs` | 通过 | 重新 pack `@4xian/jword-*` 12 个本地 tarball，在第三方空项目安装，执行 `typecheck`、Vite build 和 Chromium smoke；浏览器 smoke `1 passed`，脚本 JSON `status: ok`。Vite 对 `@4xian/jword-pdf` 的 `node:*` 依赖给出 browser externalized 提示，但构建退出码为 0。 |
| `pnpm size` | 通过 | fresh build 后 `packages/core/dist/index.js` 为 `606650` bytes，低于 `650000`；vanilla 首屏 JS/CSS 总计 `699953` bytes，低于 `700000`；首屏静态 import 图只含 `dompurify`、`yjs`。 |
| `pnpm test:visual` | 通过 | 视觉 baseline 文件检查 `4` 个；Playwright `visual-chromium` 共 `8 passed`。 |
| `pnpm test:e2e` | 通过 | Chromium / Firefox / WebKit 共 `329 passed`、`7 skipped`；随后 `perf-chromium` 共 `4 passed`。关键 perf 输出：`largeDocumentInsertP95Ms=33.8`、`selectionSyncMs=33.4`、`toggleBoldP95Ms=33.4`、`undoP95Ms=33.7`、`redoP95Ms=33.5`。 |
| `pnpm bench` | 通过 | `gate45-native` totals：save `13.51ms`、load `7.51ms`、validate `6.08ms`；`gate2-render`：layout `253.09ms`、render `70.29ms`、scrollFps `754.02`、maxCanvasCount `5`；`phase4-input-hotpath`：P95 `44.09ms`；Gate 5 / Gate 6 benchmark 均输出 `status: ok`。 |

## 红灯与修复记录

| 阶段 | 现象 | 处理结果 |
| --- | --- | --- |
| 首次 `pnpm test:e2e` | Firefox 下 `Gate 3 runtime keeps keyboard Enter and select-all working after clicking page whitespace` 失败，`selectionPixels` 为 `0`。 | focused Firefox 重跑稳定复现；`packages/core/src/editor/runtime-selection.ts` 在全文选择前调用 `ensureCurrentLayout()`，避免段落拆分后的待续增量布局导致选区渲染读取旧 layout。focused Firefox 与最终全量 `pnpm test:e2e` 均通过。 |
| 中间版 `pnpm size` | 条件判断版修复让 vanilla 首屏体积为 `700021 > 700000`。 | 将实现收敛为一次直接 `ensureCurrentLayout()` 调用，最终首屏体积为 `699953`，`pnpm size` 通过。 |

## 非阻断输出

- Playwright 与 Vite 多次输出 `NO_COLOR` / `FORCE_COLOR` 提示，不影响退出码。
- 协作 E2E 中的 `[onAuthenticate] ... auth failed` 与 `[beforeSync] ... update rejected` 来自负向诊断用例，相关用例本身通过。
- Vite 对大型 chunk 的体积提示仍存在；当前 `pnpm size` 以仓库脚本预算为准并已通过。

## 结论

`JW-BACKLOG-003` 当前 checkout 的命令矩阵已经完成：基础命令、no-alias 第三方 smoke、bundle size、视觉快照、三浏览器 E2E、perf E2E 和 benchmark 均为退出码 0。

真实发布、registry token、2FA、dist-tag 和 rollback 不在本记录范围内，仍按真实发布 runbook 与人工审批处理。
