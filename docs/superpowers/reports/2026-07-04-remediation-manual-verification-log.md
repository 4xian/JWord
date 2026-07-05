# JWord 修复人工验证点记录（2026-07-04 起）

> 本文件记录修复执行过程中原本需要暂停等待人工确认的节点。自 2026-07-04 起，执行流程改为：到点记录人工验证事项，但不暂停后续修复；真实 publish 仍永久禁止自动执行。

## 记录格式

- 日期：
- 关联任务：
- 需要人工验证的事项：
- 已完成的自动验证：
- 后续处理建议：

---

## 2026-07-04 流程调整

- 日期：2026-07-04
- 关联任务：修复执行流程
- 需要人工验证的事项：确认 `2026-07-03-remediation-execution-prompt.md` 与 `2026-07-03-remediation-execution-supplement.md` 已从“人工检查点暂停确认”调整为“人工验证点记录不暂停”。
- 已完成的自动验证：文档已新增本记录文件，后续任务遇到基线报告、阶段报告、Plugin API M1/M5、D6 浏览器矩阵、字体度量阶段二、发布审批等节点时只登记到本文件。
- 后续处理建议：人工可异步审阅本文件；修复执行继续推进 Phase 3 剩余任务。

## 2026-07-04 Phase 3A 批次进展：G2-03

- 日期：2026-07-04
- 关联任务：G2-03 执行 widow/orphan 控制
- 需要人工验证的事项：本项涉及分页语义，自动视觉测试未刷新基线；人工可异步抽查长段落在页面边界处的孤行/寡行表现是否符合产品预期。
- 已完成的自动验证：`pnpm exec vitest run packages/core/test/layout/pagination-remediation.test.ts --testNamePattern "orphan|widow"`、布局 focused 回归、`pnpm typecheck`、`pnpm lint`、`pnpm test:visual`、`pnpm test` 均通过。
- 后续处理建议：继续 Phase 3A 下一项 G2-04 字体度量阶段一；若人工发现产品期望不同，再按现状补充策略阈值。
## 2026-07-05 Phase 3A 批次进展：G2-04/G2-06

- 日期：2026-07-05
- 关联任务：G2-04 字体度量改为真实测量；G2-06 字体度量缓存 LRU 上限；G2-07 缓存 key 收敛
- 需要人工验证的事项：本项已切换浏览器运行时 canvas 真实字体度量并刷新视觉基线，人工可异步抽查非 Arial 字体文档的换行断点、hit-test、光标定位、选区矩形与视觉预期是否一致；若宿主接入自定义字体，需确认字体加载完成后重新布局策略是否满足产品预期。
- 已完成的自动验证：`pnpm exec vitest run packages/core/test/layout/font-manager.test.ts`、`pnpm exec vitest run packages/core/test/editor/font-measurer-runtime.test.ts tests/architecture/core-file-budget.test.ts`、focused layout/render/API/architecture 合集、`pnpm exec playwright test examples/vanilla/tests/gate2.visual.ts examples/vanilla/tests/gate4.visual.ts --project=visual-chromium --update-snapshots`、`pnpm test:visual`、`pnpm typecheck`、`pnpm lint`、`pnpm test` 均通过；视觉基线刷新文件已逐项记录在修复计划 G2-04。
- 后续处理建议：继续 Phase 3A 下一项 G2-15 选区绘制层级修正；若人工发现字体加载时序差异，再补宿主字体 ready 后刷新布局的公开指南或 API。
## 2026-07-05 Phase 3B 人工验证点：页眉页脚富文本编辑后置

- 日期：2026-07-05
- 关联任务：G4-中 页眉页脚富文本编辑
- 需要人工验证的事项：补充文档 D3 已决定本轮不实施页眉页脚富文本编辑，移入 post-1.0；人工可异步确认 1.0 是否接受仅保留当前页眉页脚纯文本能力。
- 已完成的自动验证：复核修复计划条目、补充文档任务映射表和 D3 决策；本项未改代码，无需新增自动化测试。
- 后续处理建议：若产品侧推翻 D3，再作为 post-1.0 或单独变更重新拆解输入管线复用方案。


## 2026-07-05 Phase 3C 人工验证点：OpenXML validator 与 Word 矩阵

- 日期：2026-07-05
- 关联任务：gate45 P2 导出 schema 合规 + validator 证据；计划审查 2.9 Microsoft Word 桌面版 T1/T2 导出矩阵补验
- 需要人工验证的事项：本轮已用本地 @xarsh/ooxml-validator 自动验证 14 个 DOCX 兼容 fixture 全部通过，OpenXML pending 证据已清零；但 Microsoft Word 桌面版真实打开、编辑、保存、重开矩阵仍需人工在安装 Word 的环境补证。当前机器未发现 `/Applications/Microsoft Word.app`，runner 保留 Word evidenceRequests 为 pending。
- 已完成的自动验证：`pnpm build && node tools/compat/run-gate5-docx-compatibility.mjs` 生成 `fixtures/docx/compatibility-results.json`，Open XML validator `pass: 14`、OpenXML 补证请求 0；相关 Vitest/docx/typecheck/lint focused 验证均通过。
- 后续处理建议：继续自动化修复下一项；人工可异步在 Word 环境按 `fixtures/docx/evidence-templates` 模板补齐 Word T1/T2 证据，或后续由计划审查 2.9 条目专门收口。

## 2026-07-05 Phase 3C 人工验证点：计划审查 2.9 Word 桌面版 T1/T2 补验

- 日期：2026-07-05
- 关联任务：计划审查 2.9 Microsoft Word 桌面版 T1/T2 导出矩阵补验
- 需要人工验证的事项：当前机器未安装 `/Applications/Microsoft Word.app`，无法自动完成 Microsoft Word 桌面版真实打开、编辑、保存、重开矩阵；14 个 T1/T2 导出 fixture 的 Word 结果仍保留 `pending/not-run`，需人工在安装 Word 的环境按 `fixtures/docx/evidence-templates/manual-compatibility-results.template.json` 补齐 artifact 绑定证据。
- 已完成的自动验证：`fixtures/docx/compatibility-results.json` 当前记录 14/14 个 Open XML validator 自动检查为 pass，Word appResults 为 14/14 pending；`docs/sdk/public-api.md` 已明示当前仅 WPS 有人工办公套件证据，Word/LibreOffice 不得对外声明已验证。
- 后续处理建议：继续自动化修复 Phase 3D；人工补 Word 证据后运行 `pnpm build && node tools/compat/run-gate5-docx-compatibility.mjs` 刷新 compatibility report，并复跑 Gate 5 compatibility runner tests。

## 2026-07-05 Phase 3 收尾阶段报告

1. 已完成任务：
   - Phase 3 整体：修复计划 Phase 3 已完成 37/37，当前正式停在 Phase 4 性能与内存优化前。
   - G6-M5：history document lock 增加队列深度背压，超限返回 `JWORD_COLLAB_HISTORY_LOCK_QUEUE_EXCEEDED`；验证 `history-queue.test.ts`、collab-server focused、Gate 6 architecture tests 通过。
   - G6-M6：history list 授权 metadata 与 record/preview 对齐；验证 `history-list-auth.test.ts`、collab-server package test/typecheck 通过。
   - G6-M7：`rateLimit` 公开选项落地为最小滑窗限流，公开 health/version 不限流；验证 `rate-limit.test.ts` 与 Gate 6 focused 通过。
   - G6-M8：history record/preview 与 auto-insert relay 校验 body tenant 与 metadata tenant 一致；验证 `metadata-mismatch.test.ts` 与 collab-server focused 通过。
   - G6-M9：IndexedDB load 临时 `restoredDoc` 在 finally 中显式 destroy；验证 `indexeddb-adapter.test.ts`、persistence package test/typecheck 通过。
   - Phase 3 收尾门禁：全量 `pnpm test` 暴露 core/DOCX 文件行数预算红灯后，按纯搬移方式拆出 focused helper 文件，未放宽 architecture tests；验证 Gate 0/Gate 5 file budget focused 通过。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：全量回归暴露的行数预算失败按代码现状修复，拆分 `rich-text-runtime-helpers.ts`、`document-store-json.ts`、`operation-record-utils.ts`、`input-runtime-test-helpers.ts`、`export-table.ts`、`package-part-graph.ts`、`package-xml-readers.ts`，保持运行语义与公开入口不变。
   - 待人工裁决：无阻塞项；Word 桌面版 T1/T2 真实矩阵仍按既有人工验证点异步补证。
3. 修复中新发现的问题：
   - 无未修复新增问题；jsdom 仍输出既有 `HTMLCanvasElement.getContext()` not implemented 噪声，但不影响测试结果。
4. 视觉基线变更清单：
   - 本次 Phase 3 收尾拆分未新增视觉基线。
   - Phase 3A G2-04 已刷新并记录：`gate2-remediation-justify-table-baseline-visual-chromium-darwin.png`、`gate4-desktop-feature-baseline-visual-chromium-darwin.png`、`gate4-long-table-baseline-visual-chromium-darwin.png`、`gate4-mobile-baseline-visual-chromium-darwin.png`。
5. 全量回归结果与下一批计划：
   - Focused：`pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/core-file-budget.test.ts tests/architecture/gate5-docx-file-budget.test.ts`，3 files / 8 tests passed。
   - Focused：`pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/gate5-docx-file-budget.test.ts packages/core/test/editor/input-runtime.test.ts packages/docx/test/public-api-package.test.ts packages/docx/test/public-api.test.ts`，5 files / 52 tests passed。
   - 全量：`pnpm lint && pnpm typecheck && pnpm test` 通过；`pnpm test` 为 163 files / 816 tests passed。
   - 下一批计划：按目标停在 Phase 4；继续时从 Phase 4 `[计划审查 1.2] 输入热路径 P95 < 50ms 达标专项` 开始。
