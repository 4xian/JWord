# Gate 7 Bundle Size 预算校准方案（2026-07-06）

## 1. 背景与目标

来源：修复计划 Phase 6 `[gate7 2.6] bundle size 预算校准`、`2026-07-02-gate7-review.md` §6b.1 与主计划 Step 7.19。

目标不是把体积问题隐藏掉，而是把已经过时的 Gate 2 预算更新为“当前 fresh build 实测 + 后续收紧路线图”：

1. 重新执行 fresh build，确认 core / vanilla 首屏体积破线是当前真实产物，不是 5 月旧 dist。
2. `pnpm size` 继续检查 fresh build 证据、禁止高级包进入免费首屏、禁止重依赖 token。
3. 体积阈值按当前实测设置少量 buffer，避免校准后立即红灯。
4. 在脚本输出中写入下一阶段收紧目标，后续 Gate 7 wrapper/theme/devtools 和 API freeze 后继续降预算。
5. 不在本项直接做大规模拆包或裁剪；如果要拆 core export 面或 demo 首屏 lazy-load，需要单独任务和浏览器回归。

## 2. Fresh build 实测

命令：`pnpm size`。

结果：修前先失败，原因是旧阈值仍为 `260000` / `330000`：

| 指标 | Fresh build 实测 | 旧阈值 | 结论 |
|---|---:|---:|---|
| `packages/core/dist/index.js` | 638269 bytes | 260000 bytes | 当前真实产物已远超旧 Gate 2 预算 |
| vanilla 首屏 JS + CSS | 687669 bytes | 330000 bytes | 当前真实产物已远超旧 Gate 2 预算 |

Freshness 证据：`tools/size/check-size.mjs` 输出 `freshness.core.isFresh = true`、`freshness.demo.isFresh = true`，且 `pnpm size` 在同一命令内重新执行 root build 与 vanilla build。因此本次破线不是旧 dist mtime 问题，而是当前 Phase 4-6 增量功能后的真实体积。

## 3. 校准后的预算

| 指标 | 当前实测 | Gate 7 校准阈值 | 下一阶段目标 |
|---|---:|---:|---:|
| Core entry | 638269 bytes | 650000 bytes | 520000 bytes |
| Vanilla first screen | 687669 bytes | 700000 bytes | 560000 bytes |

阈值策略：

- 校准阈值只保留约 2% buffer，用于吸收构建工具和 hash/微小实现波动。
- 下一阶段目标不作为当前红线；它是 Gate 7 API freeze 后的收紧目标。
- 若后续任一普通修复超过当前校准阈值，必须解释新增体积来源，不能直接调大预算。

## 4. 收紧路线图

1. **Core entry 650KB → 520KB**：Gate 7 API freeze 后复核 core root export 面，识别 plugin/diagnostics/decorations 是否可拆到 experimental 子入口或按需入口。
2. **Vanilla first screen 700KB → 560KB**：继续保持 DOCX/PDF/collab/hocuspocus/license/native/server/React/Vue/devtools 不进入免费默认首屏；wrapper/theme/devtools 落地时必须 lazy-load 或单独示例入口。
3. **工具收敛**：当前 `tools/size/check-size.mjs` 是免费基础首屏预算真源；`tools/size/check-native-bundle.mjs` 只保留为 native 资源专项护栏，`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏，不与基础首屏预算合并。
4. **Gate 7 R2 计划修订结论**：Step 7.19 不再新增会阻断 CI 的第三套 `size-limit` 预算真源；后续若引入 size-limit，只能作为非阻断分析报告，预算口径仍回写 `tools/size/check-size.mjs`。

## 5. 验收

- `pnpm size` 必须通过，并输出当前实测、校准阈值、roadmap。
- `node tools/size/check-size.mjs` 必须在 fresh dist 上通过。
- `pnpm lint` 和 `pnpm typecheck` 必须通过。
