# Gate 7 风险复核点 F：公开面冻结

日期：2026-07-06  
对应问题：`docs/superpowers/reports/2026-07-02-plan-review.md` §3.15、修复计划 Phase 6 `[计划审查 3.15]`。  
落点：`docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` 风险控制与 Gate 7 Iteration 0、`docs/sdk/public-api.md`。

## 目标

Gate 7 进入文档站、类型测试、React/Vue wrapper、示例矩阵和 release dry-run 之前，必须先通过复核点 F。复核点 F 只做一次性冻结，不在后续 wrapper 或文档任务中边写边改公开 contract。

## 冻结范围

1. **Edition matrix**：free、free base contract、paid format、paid collaboration、paid entitlement 的包归属与收费边界。
2. **导出面**：每个 package 的 stable / experimental / internal 分级、允许的 export map 子路径、禁止的内部源码路径。
3. **事件 payload**：Editor events、plugin diagnostics/telemetry、collab/server handshake、license diagnostics、support bundle 中允许公开的字段名与隐私裁剪规则。
4. **Diagnostics 命名**：统一 registry、生成文档、运行时 summary 和测试护栏必须同源；新增错误码先登记 registry，再进入运行时或文档。
5. **Feature key**：Gate 5 format feature、Gate 6 collaboration feature、license entitlement 统一命名，示例和文档不得自造别名。
6. **浏览器支持矩阵**：桌面最低版本、移动端只读边界、ES2022 target 与 Playwright 浏览器族回归说明。

## 权威来源

复核点 F 通过时，以以下文件作为冻结面来源：

- `docs/sdk/public-api.md`：edition matrix、package 导出分级、导入边界、no-alias 验收。
- `fixtures/collab/diagnostics-registry.json`：diagnostics 命名单一真源。
- `docs/sdk/diagnostic-codes.md`：由 registry 生成的公开错误码清单。
- `docs/sdk/browser-support.md`：公开浏览器支持矩阵。
- `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md`：Gate 7 Iteration 0、执行顺序和风险复核点。

## 通过条件

复核点 F 可以勾选前，必须同时满足：

1. Gate 7 Iteration 0 中导出分级、edition matrix、package/example 落点、事件 payload/diagnostics/support bundle 命名、浏览器支持矩阵均有公开来源。
2. `tests/architecture/gate7-public-api-catalog.test.ts` 覆盖当前 package 清单和导出分级。
3. `tests/architecture/gate7-diagnostics-registry.test.ts` 与 `node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` 证明 diagnostics registry、生成文档和 runtime summary 同步。
4. `tests/architecture/gate7-plan-revision.test.ts` 覆盖复核点 F 本身，防止计划回退到无公开面冻结节点。
5. 文档站、类型测试、wrapper、示例和 release smoke 的后续任务只消费上述冻结来源；确需新增/改名时，先更新冻结来源和护栏测试，再更新消费者。

## 当前状态

本次只补齐复核点 F 的计划、公开来源说明和护栏测试，不把 Gate 7 Iteration 0 冒认为已完成。当前 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` 中复核点 F 保持未勾选，直到 Iteration 0 全部冻结项和对应护栏都具备可复查证据后再勾选。

## 验收

- 红灯先行：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 修前失败，缺复核点 F 与公开冻结面消费规则。
- 修复后 focused：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`。
- 回归：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-browser-support.test.ts tests/architecture/gate7-diagnostics-registry.test.ts --reporter=verbose`。
- 追加：`pnpm typecheck`、`pnpm lint`、相关文件 `git diff --check`。
