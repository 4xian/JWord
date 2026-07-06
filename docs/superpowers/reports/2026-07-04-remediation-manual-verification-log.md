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
## 2026-07-05 Phase 4 阶段报告：GX-01 投影增量更新

1. 已完成任务：
   - GX-01：事务投影从每次完整 `createDocumentProjection()` 改为按 operation dirty scope 增量复用未变 section/block 快照；远端未知 update 与资源/批注/修订等文档级副作用仍完整投影。
   - 行数预算：新增 `packages/core/src/operations/projection-dirty-scope.ts` 承载 dirty scope 折算，避免 `transaction.ts` 超过 1000 行。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：报告原描述“每事务全树重建”仍属实；按当前 transaction pipeline 现状新增增量 projection helper，并保留 unknown update 完整重建兜底。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 benchmark 已改善但仍未达最终 <50ms：`pnpm bench` 当前 inputHotPathP95 76.5ms、transactionP95 50.27ms、layoutP95 29.06ms。
   - 浏览器 perf 门禁仍失败：`largeDocumentInsertP95Ms=782.4ms > 140ms`，保持在 [计划审查 1.2] 未完成证据中。
4. 视觉基线变更清单：
   - 无。
5. 全量回归结果与下一批计划：
   - Focused 红灯/绿灯：`pnpm exec vitest run packages/core/test/operations/transaction.test.ts --testNamePattern "输入事务只重建"` 修前 1 failed，修后 1 passed。
   - Focused：`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/operations/transaction.test.ts packages/core/test/model/projection.test.ts`，3 files / 15 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 164 files / 820 tests passed。
   - Benchmark：`pnpm bench` 通过；phase4 inputHotPathP95 76.5ms、transactionP95 50.27ms、layoutP95 29.06ms。
   - 下一批计划：继续 Phase 4，优先执行 G2-05 段落 advance 去 O(n²)，并保留 GX-03 `readUpdateByteLength` 作为 transaction P95 仍贴近 50ms 的后续候选。


## 2026-07-05 Phase 4 阶段报告：G2-05 段落 advance 去 O(n²)

1. 已完成任务：
   - G2-05：`createAdvanceTwips()` 从重复测量递增前缀改为单 grapheme 宽度线性累加，末端仍使用整段总宽，避免片段总宽漂移。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：报告定位仍属实；当前实现的长词 advance 确实会测量 `a/ab/abc/...` 前缀，已按现状最小修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 全局 benchmark 仍未达最终 <50ms：`pnpm bench` 当前 inputHotPathP95 79.63ms、transactionP95 50.39ms、layoutP95 29.13ms；G2-05 对当前 200 页 fixture 的 P95 收益未稳定超过 5%，后续瓶颈继续看 GX-03 `readUpdateByteLength`。
4. 视觉基线变更清单：
   - 无。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/layout/text-segments.test.ts --testNamePattern "重复测量递增前缀"` 修前 1 failed，修后 1 passed。
   - Focused：`pnpm exec vitest run packages/core/test/layout/text-segments.test.ts packages/core/test/layout/runtime.test.ts packages/core/test/layout/query.test.ts`，3 files / 37 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 165 files / 821 tests passed。
   - Benchmark：`node benchmarks/phase4-input-hotpath-benchmark.mjs` 通过；`pnpm bench` 通过，phase4 inputHotPathP95 79.63ms、transactionP95 50.39ms、layoutP95 29.13ms。
   - 下一批计划：继续 Phase 4，优先执行 GX-03 `readUpdateByteLength`，再看 GX-04 与 G2-19/G2-22。


## 2026-07-05 Phase 4 阶段报告：GX-03 readUpdateByteLength

1. 已完成任务：
   - GX-03：事务 `updateByteLength` 诊断改为显式 `updateByteLengthDiagnostics` opt-in；默认本地事务、mutation 与 apply update 不再把 update byte length 编码放入热路径。
   - Gate 6 benchmark：auto inserter update 指标改为通过公开 `editor.encodeSyncUpdate()` 显式计量，避免继续读取默认已关闭的事务诊断字段。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：报告中“每次事务后计算 readUpdateByteLength”仍属实；修复后 `diagnostic.updateByteLength` 默认返回 0，历史需要长度诊断的测试改为显式开启。`pnpm bench` 初次暴露 Gate 6 benchmark 仍依赖诊断字段导致 empty update metrics，已按 benchmark 现状改为显式公开 facade 计量。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 全局 benchmark 仍未达最终 <50ms：`pnpm bench` 当前 inputHotPathP95 76.09ms、transactionP95 55.82ms、layoutP95 26.15ms；GX-03 已让样本 `updateByteLength` 归零，但整体收益未稳定超过 5%，后续继续 GX-04 与可见页查找候选。
4. 视觉基线变更清单：
   - 无。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/operations/transaction.test.ts --testNamePattern "默认本地事务不编码"` 修前 1 failed（expected 0 / received 23），修后 1 passed。
   - Focused：`pnpm exec vitest run packages/core/test/operations/transaction.test.ts packages/core/test/collaboration/transaction-update.test.ts packages/core/test/collaboration/editor-update.test.ts tests/architecture/gate6-benchmark.test.ts`，4 files / 14 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 165 files / 822 tests passed。
   - Benchmark：`pnpm bench` 通过，phase4 inputHotPathP95 76.09ms、transactionP95 55.82ms、layoutP95 26.15ms。
   - 下一批计划：继续 Phase 4，执行 GX-04 延迟渲染改用 requestAnimationFrame。


## 2026-07-05 Phase 4 阶段报告：GX-04 requestAnimationFrame 延迟渲染

1. 已完成任务：
   - GX-04：`pointer-runtime` 的 deferred layout chunk 调度、续排 reschedule 与取消逻辑改为可取消的 `requestAnimationFrame` 视觉任务；非浏览器或 rAF 不可用时回退 `setTimeout(0)`。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：明细报告定位的 `pointer-runtime.ts` 两处 `setTimeout(0)` 在修前仍属实，已按当前 mounted runtime 结构最小修复，并补齐 `layout-runtime` 中同步 continuation 时的同源 reschedule。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 全局 benchmark 仍未达最终 <50ms：`pnpm bench` 当前 inputHotPathP95 73.43ms、transactionP95 50.28ms、layoutP95 29.74ms；GX-04 对 Node hotpath 收益未稳定超过 5%，后续继续可见页查找二分/Map 化候选。
4. 视觉基线变更清单：
   - 无；`pnpm test:visual` 8 passed，未刷新任何视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/editor/runtime.test.ts --testNamePattern "deferred chunks"` 修前 1 failed（rAF 调用 0），修后 1 passed。
   - Focused：`pnpm exec vitest run packages/core/test/editor/runtime.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/comment-rendering-runtime.test.ts tests/architecture/core-boundary.test.ts`，4 files / 57 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 165 files / 822 tests passed。
   - Visual：`pnpm test:visual` 通过，8 Playwright visual tests passed。
   - Benchmark：`pnpm bench` 通过，phase4 inputHotPathP95 73.43ms、transactionP95 50.28ms、layoutP95 29.74ms。
   - 下一批计划：继续 Phase 4，执行 G2-19/G2-22 可见页查找二分/Map 化。


## 2026-07-05 Phase 4 阶段报告：G2-19/G2-22 可见页查找二分化

1. 已完成任务：
   - G2-19：`computeViewportPages()` 从全量 filter 改为基于页面 top/bottom 的二分查找可见 range。
   - G2-22：buffer 扩展按连续数组位置读取 pageIndex，不再为每个可见页做全量 `indexOf` 反查。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：明细报告定位仍属实；当前实现会读取 1000 页全部几何信息并构造全量 pageIndexes，已用 getter 计数红灯锁定后最小替换为 range/二分实现。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 已知性能候选 GX-01、G2-05、GX-03、GX-04、G2-19/G2-22 均已闭环，但 `pnpm bench` 当前 inputHotPathP95 77.92ms、transactionP95 50.87ms、layoutP95 24.76ms，专项仍未达最终 <50ms；后续需要重新基于 benchmark 定位新瓶颈，不在本项中盲目新增优化。
4. 视觉基线变更清单：
   - 无；`pnpm test:visual` 8 passed，未刷新任何视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/canvas/viewport-virtualizer.test.ts --testNamePattern "大文档视口"` 修前 1 failed（geometry reads 2002 未低于 120），修后 1 passed。
   - Focused：`pnpm exec vitest run packages/core/test/canvas/viewport-virtualizer.test.ts packages/core/test/canvas/renderer.test.ts packages/core/test/editor/runtime.test.ts tests/phase4-input-hotpath-benchmark.test.ts`，4 files / 42 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 165 files / 823 tests passed。
   - Visual：`pnpm test:visual` 通过，8 Playwright visual tests passed。
   - Benchmark：`pnpm bench` 通过，phase4 inputHotPathP95 77.92ms、transactionP95 50.87ms、layoutP95 24.76ms。
   - 下一批计划：继续 Phase 4 剩余项，下一项按修复计划为 gate45 P2/P3 DOCX/PDF 媒体内存优化；[计划审查 1.2] 保持未完成，后续另行重新定位新瓶颈。


## 2026-07-05 Phase 4 阶段报告：gate45 P2/P3 DOCX/PDF 媒体内存优化

1. 已完成任务：
   - gate45 P2/P3 DOCX 媒体内存优化：DOCX import media 中间模型改为 Uint8Array，worker import-result 转移媒体 ArrayBuffer；`bytesToBase64` 改为 0x8000 分块编码。
   - gate45 P2/P3 PDF 图片/输出内存优化：图片输入按页面引用延迟读取，按 resourceId 复用已嵌入 PDFImage；`readOwnedArrayBuffer` 对完整 Uint8Array 直接复用底层 ArrayBuffer。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：明细报告定位仍属实；修前 DOCX media bytes 仍为 Array 且 data URL 编码逐字节拼接，PDF 仍预加载未引用图片、重复嵌入相同 resourceId，并复制 pdf-lib save 结果。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/docx/test/public-api-core-conversion.test.ts packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/export-memory.test.ts --testNamePattern "bounded chunks|imports inline drawing images|reuses one embedded|unused image|owned pdf-lib"` 修前 5 failed；修后相关新/迁移用例通过。
   - Focused：`pnpm exec vitest run packages/docx/test/public-api-core-conversion.test.ts packages/docx/test/public-api-import.test.ts packages/docx/test/public-api-package.test.ts packages/docx/test/t1-fixtures.test.ts packages/docx/test/export-rich-blocks.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/image-memory.test.ts packages/pdf/test/export-memory.test.ts tests/architecture/gate5-pdf-file-budget.test.ts`，9 files / 53 passed。
   - Package typecheck：`pnpm --filter @4xian/jword-docx typecheck && pnpm --filter @4xian/jword-pdf typecheck` 通过。
   - 全量：`pnpm lint && pnpm typecheck && pnpm test` 通过；`pnpm test` 为 167 files / 827 tests passed。
   - 下一批计划：继续 Phase 4，下一项按修复计划为 [计划审查 3.14] 内存回归门禁。


## 2026-07-05 Phase 4 阶段报告：GX-02 增量布局字体兼容性 probe 缓存

1. 已完成任务：
   - GX-02：`createFontManager()` 为内置字体管理器维护兼容性签名，增量 layout 在 previous/next 签名相同时跳过全文 run 样式收集和 5 组字体 probe；字体 register/available 变化会刷新签名，自定义 `textMeasurer` 按对象签名保守比较。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：明细报告定位仍属实；修前等价的新 `FontManager` 实例会对全文 80 个唯一字体样式执行 probe，产生 405 次 cache miss。当前 editor hotpath 多数使用同一 fontManager 对象，主 benchmark 对该点收益不稳定；但公开 layout API 的等价新实例路径仍按报告最小修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Phase 4 全局 benchmark 仍未达最终 <50ms：`node benchmarks/phase4-input-hotpath-benchmark.mjs` 当前 inputHotPathP95 77.45ms、transactionP95 54.77ms、layoutP95 25.14ms；`pnpm bench` 本轮 phase4 inputHotPathP95 94.21ms、transactionP95 60.59ms、layoutP95 38.35ms，存在波动且专项保持未完成。
   - `pnpm test` 与 `pnpm test:visual` 并行执行时曾因资源竞争导致两条 Gate 5 架构测试 5000ms timeout；单独重跑失败测试与随后顺序全量 `pnpm test` 均通过，判定为并发验证噪声，不改测试。
4. 视觉基线变更清单：
   - 无；`pnpm test:visual` 8 passed，未刷新任何视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/layout/incremental-font-manager.test.ts --testNamePattern "相同内置字体管理器签名"` 修前 1 failed（405 cache misses），修后 1 passed。
   - Focused：`pnpm exec vitest run packages/core/test/layout/incremental-font-manager.test.ts packages/core/test/layout/runtime.test.ts packages/core/test/layout/font-manager.test.ts`，3 files / 40 passed。
   - Focused benchmark guard：`pnpm exec vitest run tests/phase4-input-hotpath-benchmark.test.ts tests/architecture/core-file-budget.test.ts`，2 files / 5 passed。
   - 失败复核：`pnpm exec vitest run tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate5-compatibility-runner-external-evidence.test.ts`，2 files / 13 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 为 168 files / 828 tests passed。
   - Visual：`pnpm test:visual` 通过，8 Playwright visual tests passed。
   - Benchmark：`pnpm bench` 通过；`node benchmarks/phase4-input-hotpath-benchmark.mjs` 通过。
   - 下一批计划：继续 Phase 4；因 [计划审查 1.2] 仍未达 <50ms，先重新基于 benchmark 定位 transaction P95 仍超过 50ms 的新瓶颈，再决定是否进入 [计划审查 3.14] 内存回归门禁。

## 2026-07-05 Phase 4 阶段报告：计划审查 1.2 达标收口与 3.14 内存回归门禁

1. 已完成任务：
   - [计划审查 1.2]：输入热路径 P95 < 50ms 达标；UI/demo 事件订阅不再在输入事务中同步完整 layout，perf e2e 阈值固定为 50ms，`perf-chromium` 连续三次通过。
   - [计划审查 3.14]：新增浏览器内存回归门禁，覆盖创建-销毁 5 次和 Gate 2 50 页长滚动 36 次，CDP 采样 JS heap、DOM nodes、event listeners 与 canvas 峰值。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：[计划审查 1.2] 初始候选闭环后，浏览器 profiling 显示热路径瓶颈已转移到 UI/demo 层同步 `editor.getLayout()`；按现状补红灯并最小修复。3.14 原报告缺门禁属实，按当前 Playwright perf 项目新增采样护栏。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；`pnpm test:visual` 8 passed，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：[计划审查 1.2] `pnpm exec vitest run examples/vanilla/tests/demo-controls.test.ts --testNamePattern "事务状态刷新"`、`pnpm exec vitest run packages/ui/test/create-ui-toolbar.test.ts --testNamePattern "空 overlay"` 修前复现事务后同步 `getLayout()`，修后通过；[计划审查 3.14] `pnpm exec vitest run tests/architecture/phase4-memory-regression-gate.test.ts` 修前 1 failed，修后 2 passed。
   - Focused：`pnpm exec vitest run examples/vanilla/tests/demo-controls.test.ts packages/ui/test/create-ui-toolbar.test.ts packages/ui/test/create-ui-comments-link.test.ts packages/ui/test/create-ui-find-replace.test.ts packages/core/test/model/formatting-state.test.ts`，5 files / 39 passed；`pnpm exec vitest run tests/architecture/phase4-memory-regression-gate.test.ts examples/vanilla/tests/demo-controls.test.ts examples/vanilla/tests/vite-config.test.ts`，3 files / 5 passed。
   - Playwright：`pnpm exec playwright test examples/vanilla/tests/gate3.perf.e2e.ts --project=perf-chromium` 连续三次通过，largeDocumentInsertP95Ms=35.3/35.3/35.3；`pnpm exec playwright test examples/vanilla/tests/phase4-memory.perf.e2e.ts --project=perf-chromium` 通过，mountDestroyHeapDeltaBytes 19496、DOM/listener delta 0、longScrollHeapDeltaBytes 256888、peakCanvasCount 5。
   - 全量：`pnpm lint && pnpm typecheck && pnpm test` 通过；`pnpm test` 为 173 files / 836 tests passed。
   - Visual：`pnpm test:visual` 通过，8 Playwright visual tests passed。
   - Benchmark：`pnpm build && pnpm bench` 通过，phase4 inputHotPathP95 47.89ms、transactionP95 2.92ms、layoutP95 46ms。
   - 下一批计划：Phase 4 已完成；继续 Phase 5 超大文件拆分专项。

## 2026-07-05 Phase 5 阶段报告：§3.10 S1 `create-ui.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S1：`packages/ui/src/create-ui.ts` 保留 8 行公开入口，原装配逻辑拆入 `ui-lifecycle.ts`、`toolbar-setup.ts`、`media-setup.ts`、`table-setup.ts`、`comments-rail.ts`、`link-overlay.ts`、`heading-outline-setup.ts`，并补 `text-projection.ts`、`ui-geometry.ts` 承接跨模块只读 helper；`createJWordUi` 公开导出不变。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S1 快照为 2038 行；当前修前实际为 2114 行，按当前代码现状拆分，禁止为贴合快照回退 Phase 4 已完成改动。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 额外抽跑 `pnpm exec playwright test examples/vanilla/tests/gate4-structure-find.e2e.ts examples/vanilla/tests/gate4-media.e2e.ts examples/vanilla/tests/gate4-table.e2e.ts --project=chromium` 时，`gate4-table.e2e.ts` 的 “Gate 4 table toolbar inserts edits and supports undo redo” 失败在自定义尺寸弹层与 `#jword-editor` 的 x 偏移 41px；临时恢复拆分前 `/tmp/jword-create-ui-before-split.ts` 后单独复跑同用例仍失败，判定为既有 table 弹层定位问题，不在 S1 纯拆分中顺手修。
4. 视觉基线变更清单：
   - 无；本项只拆分 UI 装配源码，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts` 修前 1 failed（缺少 S1 目标模块且 `create-ui.ts` 超 400 行），修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test`，34 files / 126 passed。
   - Playwright：`pnpm exec playwright test examples/vanilla/tests/gate4-comments-link.e2e.ts examples/vanilla/tests/gate4-selection-actions.e2e.ts examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium`，22 passed；额外抽跑中 `gate4-structure-find.e2e.ts` 与 `gate4-media.e2e.ts` 通过，`gate4-table.e2e.ts` 既有失败如上。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 837 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S2，拆分 `packages/core/src/operations/command-builders.ts`，并同步收紧 core file budget legacy 预算。

## 2026-07-05 Phase 5 阶段报告：§3.10 S2 `command-builders.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S2：`packages/core/src/operations/command-builders.ts` 保留 15 行 re-export 聚合入口，按命令域拆入 `text-commands.ts`、`paragraph-commands.ts`、`resource-commands.ts`、`comment-commands.ts`、`link-commands.ts`、`image-commands.ts`、`table-commands.ts`，共享只读定位与 ID helper 下沉到 `command-builder-utils.ts`；公开导出面保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S2 快照为 1703 行；修前架构预算红灯同样复现 `command-builders.ts` 1703 行超 1000 行预算，按当前代码现状拆分，并同步移除 core file budget 中该文件 legacy allowance。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core command builder 源码，不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts` 修前 2 failed（缺少 S2 目标模块，且 `command-builders.ts` 超 1000 行预算）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/operations`，16 files / 69 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 838 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S3，拆分 `packages/core/src/editor/text-editing-runtime.ts`，并同步收紧 core file budget legacy 预算。

## 2026-07-05 Phase 5 阶段报告：§3.10 S3 `text-editing-runtime.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S3：`packages/core/src/editor/text-editing-runtime.ts` 保留 11 行 facade 入口，按输入编辑域拆入 `keyboard-editing.ts`、`delete-plan.ts`、`paragraph-split.ts`、`paste-plan.ts`、`rich-text-fragment.ts`、`runtime-selection.ts`；`JWordEditorTextEditingRuntime` 公开继承入口保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S3 快照为 1652 行；当前修前实际为 1615 行，仍超 1000 行预算，按当前代码现状拆分，并同步移除 core file budget 中该文件 legacy allowance。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core editor runtime 源码，不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts` 修前 2 failed（缺少 S3 目标模块，且 `text-editing-runtime.ts` 超 1000 行预算）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/editor/input-runtime.test.ts packages/core/test/editor/delete-range-runtime.test.ts`，4 files / 39 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 839 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S4，拆分 `packages/core/src/operations/operation-adapter.ts`，并同步收紧 core file budget legacy 预算。

## 2026-07-05 Phase 5 阶段报告：§3.10 S4 `operation-adapter.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S4：`packages/core/src/operations/operation-adapter.ts` 保留 192 行 `applyOperation` 调度入口，按 operation 域拆入 `resource-adapter.ts`、`comment-adapter.ts`、`revision-adapter.ts`、`text-adapter.ts`、`block-adapter.ts`、`image-adapter.ts`、`table-adapter.ts`；共享递归定位、run 拆分和批注范围迁移 helper 下沉到 `adapter-location.ts`。`createOperationAdapter` / `applyOperation` 公开入口保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S4 快照为 1551 行；当前修前实际为 1525 行，仍超 1000 行预算，按当前代码现状拆分，并同步移除 core file budget 中该文件 legacy allowance。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core operation adapter 源码，不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts` 修前 2 failed（缺少 S4 目标模块，且 `operation-adapter.ts` 超 1000 行预算）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/operations`，16 files / 71 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 840 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S5，拆分 `packages/ui/src/toolbar/controller.ts`。

## 2026-07-05 Phase 5 阶段报告：§3.10 S5 `toolbar/controller.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S5：`packages/ui/src/toolbar/controller.ts` 保留 372 行生命周期编排入口，按控件组拆入 `format-controls.ts`、`paragraph-controls.ts`、`insert-controls.ts`、`panel-lifecycle.ts`、`toolbar-state-sync.ts`；格式、段落、插入、面板生命周期与状态同步职责下沉到对应模块，公开 toolbar controller 创建入口保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S5 快照为 1537 行；当前修前实际为 1553 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前 toolbar/a11y/readonly 修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 UI toolbar controller 源码，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts` 修前 1 failed（缺少 S5 目标模块）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test/toolbar-controller.test.ts packages/ui/test/toolbar-controller-readonly.test.ts packages/ui/test/toolbar-dom.test.ts packages/ui/test/create-ui-toolbar.test.ts`，5 files / 28 passed；`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test`，34 files / 130 passed。
   - Playwright：`pnpm exec playwright test examples/vanilla/tests/gate3-toolbar.e2e.ts --project=chromium`，13 passed；`pnpm exec playwright test examples/vanilla/tests/gate4-selection-actions.e2e.ts --project=chromium`，5 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 841 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S6，拆分 `packages/core/src/model/document-store.ts`，并同步收紧 core file budget legacy 预算。

## 2026-07-05 Phase 5 阶段报告：§3.10 S6 `model/document-store.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S6：`packages/core/src/model/document-store.ts` 保留 96 行公开导出入口，按状态结构域拆入 `store-types.ts`、`store-schema.ts`、`store-record-factories.ts`、`store-json.ts`、`store-comments.ts`、`store-revisions.ts`；类型、schema 常量、记录工厂、JSON 读写、批注记录与修订记录职责下沉到对应模块，公开导出面保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S6 快照为 1155 行；当前修前实际为 1128 行，仍超 1000 行预算，按当前代码现状拆分，并同步移除 core file budget 中该文件 legacy allowance。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core model 源码，不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts` 修前 2 failed（缺少 S6 目标模块，且 `document-store.ts` 超 1000 行预算）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/model packages/core/test/operations`，22 files / 113 passed。
   - 全量：`pnpm typecheck`、`pnpm lint`、`pnpm test` 通过；`pnpm test` 含 build，174 files / 842 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S7，拆分 `packages/native/src/index.ts`。


## 2026-07-05 Phase 5 阶段报告：§3.10 S7 `native/src/index.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S7：`packages/native/src/index.ts` 保留 146 行公开 API 编排入口，保存流程拆入 `package-codec.ts`，读取/解析/完整性编排拆入 `package-readers.ts`，checksum 与资源摘要拆入 `package-validation.ts`，schema 迁移、诊断构造和进度/取消分别拆入 `schema-migrations.ts`、`diagnostics.ts`、`progress.ts`；公开 `saveJWordDocument`、`loadJWordDocument`、`validateJWordPackage` 与 types/messages 导出保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S7 快照为 1116 行；当前修前实际为 1115 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前 native 诊断与迁移修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 native package 源码，不涉及 Canvas 视觉输出，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/native/test` 修前 1 failed（缺少 `packages/native/src/package-readers.ts`）；修后通过。
   - Focused：`pnpm --filter @4xian/jword-native typecheck` 通过；`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/native/test`，3 files / 22 passed。
   - 全量：`pnpm typecheck && pnpm lint && pnpm test` 通过；`pnpm test` 含 build，174 files / 843 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S8，拆分 `packages/core/src/layout/engine.ts`，并同步收紧 core file budget legacy 预算。


## 2026-07-05 Phase 5 阶段报告：§3.10 S8 `layout/engine.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S8：`packages/core/src/layout/engine.ts` 保留 112 行 layout pass 编排入口，run/inline/空段落锚点逻辑拆入 `inline-layout.ts`，块级调度拆入 `pagination-flow.ts`，section 与 inline 边界锚点拆入 `layout-anchors.ts`，表格分页编排迁入既有 `table-layout.ts`；公开 `layoutDocument` / `layoutDocumentIncrementally` 保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S8 快照为 1028 行；当前修前实际为 646 行，已低于 core 1000 行硬预算但仍高于 §3.10 入口 ≤400 行目标，按当前代码现状继续拆分，不回退 Phase 4 增量 layout 与性能修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；`pnpm test:visual` 8 passed，未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts` 修前 1 failed（缺少 `inline-layout.ts` / `pagination-flow.ts` / `layout-anchors.ts`）；修后通过。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/layout`，12 files / 85 passed；`pnpm typecheck` 通过。
   - 全量：`pnpm lint && pnpm typecheck && pnpm test` 通过；`pnpm test` 含 build，174 files / 844 tests passed。
   - Visual：`pnpm test:visual` 通过，8 Playwright visual tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S9，拆分 `packages/ui/src/media/image-selection-controller.ts`。


## 2026-07-05 Phase 5 阶段报告：§3.10 S9 `media/image-selection-controller.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S9：`packages/ui/src/media/image-selection-controller.ts` 保留 392 行 controller 装配入口，overlay DOM/事件绑定拆入 `image-selection-dom.ts`，layout/DOM 坐标换算与快照读取拆入 `image-overlay-geometry.ts`，缩放会话拆入 `image-resize-session.ts`，拖拽鬼影与 drop 锚点解析拆入 `image-drag-drop.ts`；`createImageSelectionController` 装配入口保持兼容。
2. 按 §2 流程分流的条目：
   - 自愈确认：无。
   - 按现状修：补充文档登记 S9 快照为 1126 行；当前修前实际为 1125 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前 media overlay 修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 UI media overlay 源码，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts` 修前 1 failed（缺少 S9 四个目标模块）；修后通过。
   - Focused：`pnpm typecheck` 通过；`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test`，34 files / 134 passed。
   - Playwright：`pnpm exec playwright test examples/vanilla/tests/gate4-media.e2e.ts examples/vanilla/tests/gate4.visual.ts --project=chromium`，7 passed。
   - 全量：`pnpm lint && pnpm typecheck && pnpm test` 通过；`pnpm test` 含 build，174 files / 845 tests passed。
   - 下一批计划：继续 Phase 5 §3.10 S10，拆分 `packages/ui/src/selection-actions/controller.ts`。


## 2026-07-05 Phase 5 阶段报告：§3.10 S10 `selection-actions/controller.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S10：`packages/ui/src/selection-actions/controller.ts` 保留 379 行事件编排入口，格式/颜色/右键动作拆入 `commands.ts`，剪贴板动作拆入 `clipboard.ts`，原生 clipboard 事件兼容层拆入 `native-clipboard.ts`，宿主元素查询、只读渲染与生命周期事件绑定拆入 `geometry.ts`；`createSelectionActionsController` 公开入口保持兼容。
2. §2 分流条目：
   - 按现状修：补充文档登记 S10 快照为 1124 行；当前修前实际为 1123 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前 selection-actions 修复。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts` 修前 1 failed（缺少 S10 四个目标模块）；修后通过。
   - Focused Vitest：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test/selection-actions-controller.test.ts packages/ui/test/selection-actions-controller-readonly.test.ts packages/ui/test/selection-actions-dom.test.ts`，4 files / 22 passed；`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test`，34 files / 135 passed。
   - Playwright：`pnpm exec playwright test examples/vanilla/tests/gate4-selection-actions.e2e.ts --project=chromium`，5 passed。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，174 files / 846 passed。
   - 下一批计划：继续 Phase 5 §3.10 S11，拆分 `packages/ui/src/table/controller.ts`。


## 2026-07-05 Phase 5 阶段报告：§3.10 S11 `table/controller.ts` 超大文件拆分

1. 已完成任务：
   - §3.10 S11：`packages/ui/src/table/controller.ts` 保留 187 行生命周期装配入口，表格状态同步拆入 `table-state-sync.ts`，工具栏/右键菜单动作与剪贴板拆入 `table-actions.ts`，表格命中选择与全局收起拆入 `table-selection.ts`，行列 resize 会话拆入 `table-resize.ts`；`createTableController` 公开装配入口保持兼容。
2. §2 分流条目：
   - 按现状修：补充文档登记 S11 快照为 1004 行；当前修前实际为 1003 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前表格分页、性能与 UI 装配修复。
   - 待人工裁决：`pnpm exec playwright test examples/vanilla/tests/gate4-table.e2e.ts --project=chromium` 仍失败在既有自定义尺寸弹层 x 偏移 41px（S1 已登记为拆分前同症状），本纯拆分项未顺手修。
3. 修复中新发现的问题：
   - 单跑 `pnpm exec playwright test examples/vanilla/tests/gate4-table.e2e.ts --project=chromium --grep "click resize"` 时，resize 预览线断言仍可能因默认 viewport 下 handle 起点落到视口底部外而失败；记录为后续 e2e 稳定性/表格交互验证问题，未在 S11 纯拆分中扩大修复范围。
4. 视觉基线变更清单：
   - 无；本项只拆分 UI table controller 源码，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "table controller"` 修前 1 failed（缺少 S11 四个目标模块）；修后 1 passed / 10 skipped。
   - Focused Vitest：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts packages/ui/test`，34 files / 136 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，174 files / 847 passed。
   - 下一批计划：继续 Phase 5 §3.10 T1，拆分 `packages/core/test/editor/input-runtime.test.ts`，并同步收紧 core file budget legacy 预算。


## 2026-07-05 Phase 5 阶段报告：§3.10 T1 `input-runtime.test.ts` 超大测试文件拆分

1. 已完成任务：
   - §3.10 T1：`packages/core/test/editor/input-runtime.test.ts` 保留 10 行历史入口说明，按输入路径拆入 `input-runtime-keyboard.test.ts`、`input-runtime-clipboard.test.ts`、`input-runtime-composition.test.ts`、`input-runtime-pointer.test.ts`、`input-runtime-image.test.ts`、`input-runtime-errors.test.ts`；共享 DOM 事件、投影读取、命中辅助函数迁入 `editor-test-helpers.ts`。
   - 同步收紧 `tests/architecture/core-file-budget.test.ts`：移除 `input-runtime.test.ts` legacy allowance，拆分后的 core editor 测试文件均低于 1000 行预算。
2. §2 分流条目：
   - 按现状修：补充文档登记 T1 快照为 2214 行；当前修前实际为 1846 行，仍超 1000 行预算，按当前代码现状拆分，不回退此前输入热路径、composition、inline image 与 clipboard 修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core editor 测试文件，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "input-runtime"` 修前 1 failed（缺少 T1 七个目标文件）；修后通过。
   - Focused Vitest：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/editor/input-runtime-keyboard.test.ts packages/core/test/editor/input-runtime-clipboard.test.ts packages/core/test/editor/input-runtime-composition.test.ts packages/core/test/editor/input-runtime-pointer.test.ts packages/core/test/editor/input-runtime-image.test.ts packages/core/test/editor/input-runtime-errors.test.ts`，8 files / 46 passed；`pnpm exec vitest run packages/core/test/editor`，24 files / 102 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 下一批计划：继续 Phase 5 §3.10 T2，拆分 `packages/core/test/layout/runtime.test.ts`，并同步收紧 core file budget legacy 预算。


## 2026-07-05 Phase 5 阶段报告：§3.10 T2 `layout/runtime.test.ts` 超大测试文件拆分

1. 已完成任务：
   - §3.10 T2：`packages/core/test/layout/runtime.test.ts` 保留 10 行历史入口说明，按布局关注点拆入 `runtime-pagination.test.ts`、`runtime-wrapping.test.ts`、`runtime-table.test.ts`、`runtime-debug.test.ts`；共享投影、字体度量、三页分页投影、计数型字体管理器和行文本读取辅助函数迁入 `runtime-test-helpers.ts`。
   - 同步收紧 `tests/architecture/core-file-budget.test.ts`：移除 `layout/runtime.test.ts` legacy allowance，拆分后的 layout runtime 测试文件均低于 1000 行预算。
2. §2 分流条目：
   - 按现状修：补充文档登记 T2 快照为 1904 行；当前修前实际为 1903 行，仍超 1000 行预算，按当前代码现状拆分，不回退此前表格跨页、字体度量、增量布局和性能修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core layout 测试文件，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "layout runtime"` 修前 1 failed（缺少 T2 五个目标文件）；修后通过。
   - Focused Vitest：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/layout`，16 files / 90 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，184 files / 849 passed。
   - 下一批计划：继续 Phase 5 §3.10 T3，拆分 `packages/core/test/editor/facade-runtime.test.ts`，并同步收紧 core file budget legacy 预算。


## 2026-07-05 Phase 5 阶段报告：§3.10 T3 `facade-runtime.test.ts` 超大测试文件拆分

1. 已完成任务：
   - §3.10 T3：`packages/core/test/editor/facade-runtime.test.ts` 保留 10 行历史入口说明，按门面关注点拆入 `facade-document.test.ts`、`facade-command.test.ts`、`facade-history.test.ts`、`facade-load-replace.test.ts`；共享投影读取辅助函数迁入 `facade-test-helpers.ts`。
   - 同步收紧 `tests/architecture/core-file-budget.test.ts`：移除最后一个 `facade-runtime.test.ts` legacy allowance，core 源码与测试文件均不再需要历史超标豁免。
2. §2 分流条目：
   - 按现状修：补充文档登记 T3 快照为 1148 行；当前修前实际为 1147 行，仍超 1000 行预算，按当前代码现状拆分，不回退此前门面命令、历史、选择和模型加载修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只拆分 core editor 测试文件，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "facade runtime"` 修前 1 failed（缺少 T3 五个目标文件）；修后通过。
   - Focused Vitest：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts packages/core/test/editor`，30 files / 118 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，188 files / 850 passed。
   - 下一批计划：继续 Phase 5 §3.10 T4，拆分 `examples/vanilla/tests/gate3-toolbar.e2e.ts`。


## 2026-07-05 Phase 5 阶段报告：§3.10 T4 `gate3-toolbar.e2e.ts` 超大 E2E 文件拆分

1. 已完成任务：
   - §3.10 T4：`examples/vanilla/tests/gate3-toolbar.e2e.ts` 保留 8 行历史入口说明，按真实用户路径拆入 `gate3-toolbar-format.e2e.ts`、`gate3-toolbar-paragraph.e2e.ts`、`gate3-toolbar-panels.e2e.ts`；公共 DOM、投影、布局、颜色与选区 helper 迁入 `gate3-toolbar-helpers.ts`。
   - `gate3-toolbar-insert.e2e.ts` 保留为插入路径占位入口；当前原始 `gate3-toolbar.e2e.ts` 没有插入路径断言，因此本纯拆分项未新增行为测试。
2. §2 分流条目：
   - 按现状修：补充文档登记 T4 快照为 1210 行；当前修前实际为 1209 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前 toolbar 控件、颜色和段落格式修复。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 当前 toolbar e2e 原始文件没有插入路径断言，只能保留占位入口；后续若新增插入控件验收，应落到 `gate3-toolbar-insert.e2e.ts`。
4. 视觉基线变更清单：
   - 无；本项只拆分 E2E 文件，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "gate3 toolbar"` 修前 1 failed（缺少 T4 五个目标文件）；修后 1 passed / 14 skipped。
   - Focused Playwright：`pnpm exec playwright test examples/vanilla/tests/gate3-toolbar-*.e2e.ts --project=chromium`，13 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 全量回归：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts`，15 passed；`pnpm lint && pnpm typecheck && pnpm test` 通过，188 files / 851 passed。
   - 下一批计划：继续 Phase 5 §3.10 T5，拆分 `examples/vanilla/tests/gate3-input.e2e.ts`。

## 2026-07-05 Phase 5 阶段报告：§3.10 T5 `gate3-input.e2e.ts` 超大 E2E 文件拆分

1. 已完成任务：
   - §3.10 T5：`examples/vanilla/tests/gate3-input.e2e.ts` 保留 8 行历史入口说明，按输入路径拆入 `gate3-input-keyboard.e2e.ts`、`gate3-input-selection.e2e.ts`、`gate3-input-clipboard.e2e.ts`、`gate3-input-composition.e2e.ts`、`gate3-input-large-fixture.e2e.ts`；公共浏览器探针、选区操作和事件模拟辅助函数迁入 `gate3-input-helpers.ts`。
   - §3.10 超大文件拆分专项 S1-S11、T1-T5 已全部执行完毕，`tests/architecture/phase5-file-split.test.ts` 当前 16 项全绿。
2. §2 分流条目：
   - 按现状修：补充文档登记 T5 快照为 1124 行；当前修前实际为 1123 行，仍超拆分专项目标，按当前代码现状拆分，不回退此前输入热路径、Gate2 大夹具页数与 selection 修复。
   - 待人工裁决：`pnpm exec playwright test examples/vanilla/tests/gate3-input-*.e2e.ts --project=chromium` 当前 9 passed / 1 skipped / 1 failed；失败项为 `Gate 3 runtime pointer selection supports click drag and double click on the real canvas`，双击 `Alpha` 断言期望 `0→5`，实际摘要为 `选区：paragraph-1 / run-1 / 1→paragraph-1 / run-1__format-1 / 4`。本拆分未触达产品运行时代码，先登记为后续选区行为/测试稳定性裁决点，不在纯拆分项中顺手修。
3. 修复中新发现的问题：
   - Gate3 pointer double-click 在格式 run 边界附近的期望与当前 selection 摘要不一致；需后续结合选区行为语义判断是产品缺陷还是 E2E 断言需要改用跨 run 稳定范围读取。
4. 视觉基线变更清单：
   - 无；本项只拆分 E2E 文件，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts --testNamePattern "gate3 input"` 修前 1 failed（缺少 T5 六个目标文件）；修后 1 passed / 15 skipped。
   - Focused Vitest / 类型 / Lint：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts`，16 passed；`pnpm typecheck` 通过；`pnpm lint` 通过。
   - Focused Playwright：`pnpm exec playwright test examples/vanilla/tests/gate3-input-*.e2e.ts --project=chromium`，9 passed / 1 skipped / 1 failed，失败已登记为待人工裁决。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，188 files / 852 passed。
   - 下一批计划：继续 Phase 5，下一项为死代码清理。

## 2026-07-05 Phase 5 阶段报告：死代码清理

1. 已完成任务：
   - 死代码清理：删除 `packages/core/src/layout/inline-layout.ts` 中已漂移但仍无调用的 `resolveImageInlineSize`，删除 `packages/core/src/canvas/renderer.ts` 中无调用的 `renderRectBorder`，删除 `packages/docx/src/compatibility.ts` 中无调用的 `createPendingAppResults`。
   - G3-18：复核 `packages/core/src/operations/command-builders.ts` 当前已是 re-export 聚合入口，旧 `allocateGeneratedCommentThreadId`、`collectCommentThreadIds`、`findCommentThread` 死代码副本已随 §3.10 S2 自愈不存在；`comment-command-builders.ts` 中同名有效实现及调用者保留。
2. §2 分流条目：
   - 自愈确认：G3-18 命令构建器死代码当前已不存在，证据为 CodeGraph 未找到 `allocateGeneratedCommentThreadId`，`rg` 仅在 `comment-command-builders.ts` 和 UI comments state 中找到有效同名 helper。
   - 按现状修：G2-10 报告原路径为 `layout/engine.ts`，当前经 Phase 5 S8 拆分后符号位于 `layout/inline-layout.ts`，按符号名定位后删除当前残留实现。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只删除未调用 helper，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-dead-code.test.ts` 修前 1 failed（残留 `resolveImageInlineSize` / `renderRectBorder` / `createPendingAppResults`）；修后 1 passed。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-dead-code.test.ts packages/core/test/canvas/renderer.test.ts packages/core/test/layout packages/docx/test/compatibility-report.test.ts packages/core/test/operations`，31 files / 160 passed。
   - Type/Lint：`pnpm typecheck`、`pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，189 files / 853 passed。
   - 下一批计划：继续 Phase 5，下一项为重复实现收敛。

## 2026-07-05 Phase 5 阶段报告：重复实现收敛

1. 已完成任务：
   - 重复实现收敛：`packages/docx/src/roundtrip.ts` 删除本地 `readStringProperty/readNumberProperty` 副本，改为复用 `packages/docx/src/export-utils.ts`；`packages/pdf/src/visual-report.ts` 删除本地 `twipsToPdfPoints`，改为复用 `packages/pdf/src/pdf-geometry.ts`；`packages/ui/src/media/policy.ts` 改为委托 core `isAllowedResourceUrl`，并保留 `DEFAULT_JWORD_MEDIA_URL_POLICY` 作为 core 默认策略别名以兼容公开导出；`JWordMediaUrlPolicy` 改为 core `ResourceUrlPolicy` 类型别名。
2. §2 分流条目：
   - 自愈确认：PDF 颜色解析重复当前已不存在，`packages/pdf/src/index.ts`、`packages/pdf/src/text-style-renderer.ts`、`packages/pdf/src/visual-report.ts` 中仅剩 `packages/pdf/src/text-style-renderer.ts` 的 `function readPdfColor` 一个实现，本项只用架构测试锁定单一来源。
   - 按现状修：UI 仍保留 `DEFAULT_JWORD_MEDIA_URL_POLICY` 公开导出，避免移除既有 API；实现改为 core 默认策略别名，不再维护 UI 本地 allowlist 逻辑。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只收敛 helper 与 URL 策略复用，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-duplicate-implementations.test.ts` 修前 3 failed；修后 3 passed。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-duplicate-implementations.test.ts packages/docx/test/roundtrip-diff.test.ts packages/docx/test/t1-roundtrip-fixtures.test.ts packages/pdf/test/visual-report.test.ts packages/ui/test/media-state.test.ts`，5 files / 17 passed。
   - Type/Lint：`pnpm typecheck && pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，190 files / 856 passed。
   - 下一批计划：继续 Phase 5，下一项为架构纯度项（G1-04、G1-05/G3-19、G1-06/GX-06、G1-17）。

## 2026-07-05 Phase 5 阶段报告：架构纯度项

1. 已完成任务：
   - G1-04：`packages/core/src/model/position.ts` 导出 `Opaque`，`packages/core/src/model/store-types.ts` 删除第二套 `DocumentStoreId` / `documentStoreIdBrand`，资源、样式、批注范围 ID 统一复用 position 的 branded ID 基础类型。
   - G1-05/G3-19：`comment-command-builders.ts`、`link-command-builders.ts`、`revision-command-builders.ts`、`table-commands.ts` 移除模块级序号计数器，改为每次命令构造基于当前 projection/usedIds 从 1 开始分配，碰撞时局部递增。
   - G1-06/GX-06：`AnchorRefState` 与 `resolveAnchorRef` 注释明确 AnchorRef 是可变句柄，内部状态仅迁移/解析路径可变，对外仍通过防御性快照读取。
   - G1-17：`docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md` 记录 `mergeBlock` 仅支持同一容器中的相邻段落，不满足时返回 `OPERATION_MERGE_BLOCK_NOT_ADJACENT`。
2. §2 分流条目：
   - 按现状修：G1-05 原报告提到旧 `command-builders.ts` 表格计数器，当前已随 §3.10 S2/S11 漂移到 `table-commands.ts`，按当前文件落点修复；`textAnchorRegistry` 的 WeakMap 生命周期风险本计划项未点名要求实现清理 API，本批只落实可变契约文档化。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本项只调整类型品牌、ID 分配器和文档注释，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run tests/architecture/phase5-architecture-purity.test.ts` 修前 4 failed；修后 4 passed。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-architecture-purity.test.ts packages/core/test/model/position.test.ts packages/core/test/model/document-store.test.ts packages/core/test/operations/comment-command-builders.test.ts packages/core/test/operations/link-command-builders.test.ts packages/core/test/operations/revision-command-builders.test.ts packages/core/test/operations/table-command-builders.test.ts packages/core/test/operations/operation-adapter.test.ts`，8 files / 43 passed。
   - Type/Lint：`pnpm typecheck && pnpm lint` 通过。
   - 全量回归：`pnpm lint && pnpm typecheck && pnpm test` 通过，191 files / 860 passed。
   - 下一批计划：继续 Phase 5，下一项为小型正确性/风格项。


## 2026-07-06 Phase 5 阶段报告：小型正确性/风格项

1. 已完成任务：
   - 小型正确性/风格项：以 `tests/architecture/phase5-small-correctness.test.ts` 锁定 14 项小型护栏，覆盖 G1-14、G2-07/08、G2-11/12、G3-14/15/22/28/29/32、G6-LOW、gate45 P3 余项、G3-13/G2-21、G6 update origin、PDF 页眉页脚 baseline 与 paste sanitizer 无效 allowlist 清理。
   - 当前工作区已满足：selection target 不再发布后修改，layout resource lookup 不在 run 循环内重复构建，列表计数器语义显式化，caret 行匹配走共享容差 helper，history selection 恢复先校验 projection，UI grapheme 计算复用 core helper，paste sanitizer style-free 且 `<br>` 保留换行，toolbar readonly 状态来自 builtin tool registry，hidden text mirror 使用 `clipPath`，collab origin 使用冻结矩阵，Gate 6 生命周期/adapter cleanup 显式化，header/footer baseline 由 layout 输出并被 Canvas/PDF 消费，PDF/DOCX 小型护栏均已覆盖。
2. §2 分流条目：
   - 自愈确认：G2-07 已随字体度量缓存 LRU 上限批次完成，G3-18 已在死代码清理批次确认；本批通过小型护栏统一锁定当前结果，不重复改动已完成代码。
   - 按现状修：报告中的多个文件行号已随 Phase 5 拆分漂移，本批按符号与当前文件落点验收，例如 `runtime-selection.ts` / `keyboard-text-runtime.ts` 的 caret helper、`inline-layout.ts` / `pagination-flow.ts` 的 resource lookup、`hocuspocus-adapter.ts` 的 origin 归一化。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Focused Vitest 在 jsdom 环境仍打印 `HTMLCanvasElement.getContext()` 未实现提示，但命令退出码为 0，未阻塞本批验收。
4. 视觉基线变更清单：
   - 无；本批未刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 架构护栏：`pnpm exec vitest run tests/architecture/phase5-small-correctness.test.ts`，1 file / 14 passed。
   - Focused：`pnpm exec vitest run tests/architecture/phase5-small-correctness.test.ts packages/core/test/model/selection.test.ts packages/core/test/layout/font-manager.test.ts packages/core/test/layout/runtime-pagination.test.ts packages/core/test/layout/text-segments.test.ts packages/ui/test/paste-sanitizer.test.ts packages/ui/test/selection-rebind.test.ts packages/ui/test/toolbar-controller-readonly.test.ts packages/collab/test/hocuspocus-adapter.test.ts packages/pdf/test/public-api.test.ts packages/pdf/test/text-style-renderer.test.ts packages/docx/test/roundtrip-diff.test.ts`，12 files / 80 passed。
   - 下一批计划：继续 Phase 5，下一项为 [计划审查 2.6] 计划文档瘦身，并与 [计划审查 2.7] 主计划 checkbox 全量状态审计同批执行。

## 2026-07-06 Phase 5 阶段报告：计划文档瘦身与 checkbox 审计

1. 已完成任务：
   - [计划审查 2.6]：新增 `docs/superpowers/plans/2026-05-11-jword-canonical-execution-log.md`，把主计划中的 dated execution log、回写、补证和复核记录抽离为独立日志；主计划从 HEAD 基线 2759 行收敛到 2371 行，保留目标、任务状态、验收标准、禁止事项和当前基线摘要。
   - [计划审查 2.7]：主计划 0.3 增加 checkbox 语义规范，并把同一语义写入持续验证矩阵的 Gate 收口说明；审计并修正 0.3/0.4 包结构、Gate 1/3 禁止事项、Gate 3 Step 3.14-3.16 与验收状态、Alpha 完成区 P95/INP 状态。
   - 主计划头部移除过时的 superpowers 强制说明，改为要求遵守当前 `AGENTS.md` 与 remediation workflow。
2. §2 分流条目：
   - 按现状修：主计划仍保留当前基线摘要、验收要求和少量当前决策日期；已抽离详细执行过程，不把验收要求中的“真实浏览器证据 / 执行记录”字样误删。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - Alpha 完成区曾把 `输入热路径 P95 < 50ms` 勾选为完成，但 Step 3.13 与 carry-over 明确仍未达标；本批改回未勾选，避免 checkbox 语义漂移。
4. 视觉基线变更清单：
   - 无；本批只改文档。
5. 全量回归结果与下一批计划：
   - 文档瘦身复核：`rg -n "执行记录|续做|完成 2026|回写 2026|复核 2026|补证 2026|当前工作树|最终完成复核|验证 2026|进展 2026|进展（2026|收口 2026|调整 2026|复查 2026|早期|审计 2026|人工证据推进|遗留 2026|九项 remediation" docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` 仅剩 2 条必须保留的验收/流程要求。
   - 格式检查：`git diff --check -- docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md docs/superpowers/reports/2026-07-02-jword-remediation-plan.md docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md` 通过；同批用 Python 扫描新建 execution log 与本批四个文档 trailing whitespace，通过。
   - Focused 代码护栏复跑：`pnpm exec vitest run tests/architecture/phase5-small-correctness.test.ts`，1 file / 14 passed。
   - 下一批计划：Phase 5 已收口；继续 Phase 6，下一项为 [gate7 2.1] Plugin 扩展点前置改造，先产出 M1 设计冻结文档。

## 2026-07-06 Phase 6 阶段报告：Gate 7 Plugin API M1 设计冻结

1. 已完成任务：
   - [gate7 2.1] M1：通读 `docs/superpowers/reports/2026-07-02-gate7-review.md` §2.1 与 R2 核实段，并对照当前 core/editor runtime、transaction pipeline、keyboard runtime、toolbar 类型现状，产出 `docs/superpowers/plans/2026-07-06-gate7-plugin-api-m1-design.md`。
   - 设计冻结内容覆盖 `PluginDefinition`、`PluginContext`、命令注册/拦截、生命周期事件、快捷键注册、diagnostics、错误隔离契约、experimental decorations、UI toolbar/menu 扩展方向、`createEditor({ plugins })` 注册方式和 M2-M6 交付切分。
   - 已登记 M1 人工验证点：自定义 Operation union 不进 M2、decorations 保持 experimental、插件 toolbar runtime key 不并入内建 `JWordToolbarToolId`、插件异常默认只上报 diagnostics 不自动 disable。
2. §2 分流条目：
   - 按现状修：当前 `createEditor(options?: EditorOptions)`、`JWordEditorState.pipeline`、`executeCommand()`、`TransactionEvent`、keyboard runtime 和 `JWordToolbarToolId` 均无 plugin host；设计采用 composition `PluginHost`，避免继续加深 editor abstract class 继承链。
   - 待人工裁决：M1 人工验证点已登记但不暂停，按补充文档 §3.11 继续推进 M2。
3. 修复中新发现的问题：
   - 无代码修复；M1 只冻结设计。
4. 视觉基线变更清单：
   - 无；本批只改文档。
5. 全量回归结果与下一批计划：
   - 资料来源：`docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md` §3.11、`docs/superpowers/reports/2026-07-02-gate7-review.md` §2.1 / R2 核实段、CodeGraph 对 editor state / command / keyboard / toolbar seam 的结构索引、Tiptap / ProseMirror / Monaco 官方文档入口。
   - 下一批计划：继续 [gate7 2.1] M2 core 扩展点骨架，先落 `EditorOptions.plugins`、plugin host、command middleware、生命周期事件、快捷键注册和错误隔离 focused tests。


## 2026-07-06 Phase 6 阶段报告：Gate 7 Plugin API M2 core 扩展点骨架

1. 已完成任务：
   - [gate7 2.1] M2：新增 `packages/core/src/plugins/types.ts` / `host.ts`，通过 composition `PluginHost` 接入 core，不继续加深 editor 继承链。
   - `EditorOptions.plugins` 支持按声明顺序 setup；destroy 时先发布插件 `destroy` 生命周期，再反序 dispose。
   - `executeCommand()` 进入 transaction pipeline 前经过插件 middleware；插件可用 `input.reject()` 返回不写文档、不写 history 的拒绝结果，并同步发布 `PLUGIN_COMMAND_REJECTED` error 事件。
   - `executePluginCommand()`、插件命令注册、快捷键注册、`mount` / `destroy` / `afterTransaction` / `error` 生命周期和 `getPluginDiagnostics()` 已接入；插件回调异常统一转为 `PLUGIN_CALLBACK_FAILED`，不回滚已完成事务。
   - 为保持 Phase 5 core 行数预算，把 `facade-runtime.ts` 的格式命令公开方法拆入 `formatting-facade-runtime.ts`，公开 facade 行为不变。
2. §2 分流条目：
   - 按现状修：M2 未引入自定义 Operation union；插件命令必须返回现有 `Command` 或 `TransactionResult`，写操作仍通过统一 transaction pipeline。
   - 按现状修：快捷键只向插件暴露归一化 key、只读 projection、selection 和 mounted 状态，不暴露 DOM `KeyboardEvent`。
   - 待人工裁决：无；M1 人工验证点仍登记但不阻塞 M2-M6。
3. 修复中新发现的问题：
   - `facade-runtime.ts` 已超过 core 1000 行预算，M2 顺手触达该文件后必须同步拆分；已拆出 `formatting-facade-runtime.ts` 并由 `core-file-budget` 验证。
4. 视觉基线变更清单：
   - 无；本批只涉及 core 插件宿主和 facade 结构拆分，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - 红灯/绿灯：`pnpm exec vitest run packages/core/test/editor/plugin-runtime.test.ts` 修前 5 failed，修后 5 passed。
   - Focused：`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/editor/plugin-runtime.test.ts packages/core/test/editor/facade-command.test.ts packages/core/test/editor/input-runtime-keyboard.test.ts packages/core/test/editor/runtime.test.ts`，5 files / 44 passed。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - Public API guard：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts`，1 file / 6 passed。
   - 备注：jsdom 环境仍打印 `HTMLCanvasElement.getContext()` 未实现提示，命令退出码为 0，未阻塞验收。
   - 下一批计划：继续 [gate7 2.1] M3 experimental decorations read path，随后推进 M4 UI toolbar/menu extension registry。


## 2026-07-06 Phase 5 收口复核：超大文件零超标

1. 已完成任务：
   - 按补充文档 §3.10 同一口径复扫 `packages`、`examples`、`tests`、`tools`、`benchmarks` 下 `.ts/.tsx/.js/.mjs` 文件，发现 `packages/pdf/test/public-api.test.ts` 因后续 Gate 5 测试增长达到 1017 行。
   - 新增 `packages/pdf/test/public-api-layout-fixtures.ts`，只承接 PDF public API 测试的 layout fixture；`public-api.test.ts` 收敛为 576 行，未改运行时代码和 PDF 断言语义。
2. §2 分流条目：
   - 按现状修：该文件不在 2026-07-04 原始 16 项矩阵内，属于后续测试增长导致的 current drift；按当前上限要求补做纯测试拆分。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本批只拆测试 fixture，不刷新视觉基线。
5. 验证结果与下一批计划：
   - Focused：`pnpm exec vitest run packages/pdf/test/public-api.test.ts tests/architecture/phase5-file-split.test.ts tests/architecture/phase5-small-correctness.test.ts`，3 files / 54 passed。
   - Phase 5 聚焦总门禁：`pnpm exec vitest run tests/architecture/phase5-file-split.test.ts tests/architecture/core-file-budget.test.ts tests/architecture/phase5-dead-code.test.ts tests/architecture/phase5-duplicate-implementations.test.ts tests/architecture/phase5-architecture-purity.test.ts tests/architecture/phase5-small-correctness.test.ts`，6 files / 40 passed。
   - 当前复扫超 1000 行文件数：0。
   - 下一批计划：继续 Phase 6 `[gate7 2.1]`，下一项为 M3 experimental decorations read path。


## 2026-07-06 Phase 6 阶段报告：Gate 7 Plugin API M3 experimental decorations read path

1. 已完成任务：
   - [gate7 2.1] M3：新增 `PluginContext.registerDecorationProvider()`、`ExperimentalDecorationProvider`、`PluginDecorationReadInput`、text highlight 与 page overlay decoration 类型。
   - `PluginHost.readDecorations()` 在 render 前读取 provider，传入 projection/layout/selection 浅只读快照，按 layout range 归一化文本高亮 rect；provider 抛错被隔离为 `PLUGIN_CALLBACK_FAILED`，不阻断挂载渲染。
   - `renderPageCanvas()` / `syncPageCanvases()` 消费归一化 experimental decoration：text highlight 绘制在正文文字下方，page overlay marker 绘制在页面内容上方；插件永远不拿 canvas context。
   - `docs/sdk/public-api.md` 把 core decoration API 标为 experimental，避免被误写成 stable。
2. §2 分流条目：
   - 按现状修：M3 不引入 afterLayout 生命周期事件，也不开放自定义 operation；只通过 render read path 评估装饰层。
   - 待人工裁决：无；M1 中 decorations 保持 experimental 的人工关注点仍保留到 Gate 7 冻结复核。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本批只增加 renderer 指令级测试，不刷新视觉基线。
5. 全量回归结果与下一批计划：
   - Focused：`pnpm exec vitest run packages/core/test/editor/plugin-runtime.test.ts packages/core/test/canvas/renderer.test.ts tests/architecture/gate7-public-api-catalog.test.ts`，3 files / 30 passed。
   - Phase 5/6 guard：`pnpm exec vitest run tests/architecture/core-file-budget.test.ts tests/architecture/phase5-file-split.test.ts packages/core/test/editor/plugin-runtime.test.ts packages/core/test/canvas/renderer.test.ts tests/architecture/gate7-public-api-catalog.test.ts`，5 files / 48 passed。
   - `pnpm typecheck` 通过；`pnpm lint` 通过。
   - 备注：jsdom 环境仍打印 `HTMLCanvasElement.getContext()` 未实现提示，命令退出码为 0。
   - 下一批计划：继续 [gate7 2.1] M4 UI toolbar/menu extension registry。

## 2026-07-06 Phase 6 阶段报告：Gate 7 Plugin API M5/M6 内部消费者与公开面收口

1. 已完成任务：
   - [gate7 2.1] M5：默认页面尺寸菜单迁移为内部 `jword.ui` 插件消费者；core 内置 `jword.ui.setPagePreset` 插件命令继续调用现有 `editor.setPageConfig()`，UI 插件菜单通过 `active(context)` 同步 A3/A4/A5/Letter 选中态。
   - M5 验证中发现 UI 插件 action 缺少命令完成后的 live region 播报钩子；已回改 M1 设计，并在 `JWordToolbarPluginItem` / `JWordMenuPluginAction` 增加可选 `announce(context)`，页面尺寸菜单保留原有“已切换纸张”播报。
   - [gate7 2.1] M6：`docs/sdk/public-api.md` 将 core plugin host、experimental decorations、UI toolbar/menu extension 登记为 experimental；`tests/architecture/gate7-public-api-catalog.test.ts` 锁定当前导出符号和文档分级。
   - vanilla demo 增加 opt-in `?pluginError=throwing-command` 测试插件，Chromium E2E 验证插件命令抛错被隔离为 `PLUGIN_CALLBACK_FAILED` diagnostics 后，内部页面尺寸插件仍可继续更新真实页面几何。
2. §2 分流条目：
   - 按现状修：本次只完成 Phase 6 前置插件骨架，未把 Gate 7 Step 7.5 的 resource upload、persistence、import/export adapter、collab provider adapter contract 冒认为已完成。
   - 待人工裁决：请异步确认 M5 以默认页面尺寸菜单作为首个内部消费者是否足够代表 toolbar/menu API 形状；请确认 `announce(context)` 是否保留到后续 Gate 7 stable Plugin UI API，或在正式冻结前改为更通用的 host notification contract。
3. 修复中新发现的问题：
   - 插件菜单命令完成后的播报若立即写 live region，会被焦点归还触发的 selection announcement 覆盖；当前实现把插件播报排入后续 microtask，保持可见状态提示。
4. 视觉基线变更清单：
   - 无；本批只新增真实浏览器行为回归，不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - Focused Vitest：`pnpm exec vitest run packages/core/test/editor/plugin-runtime.test.ts packages/ui/test/create-ui-toolbar.test.ts tests/architecture/gate7-public-api-catalog.test.ts`，3 files / 22 passed。
   - Chromium E2E：`pnpm exec playwright test examples/vanilla/tests/gate3-toolbar-paragraph.e2e.ts --project=chromium --grep "Gate 7"`，2 passed。
   - 备注：jsdom 环境仍打印 `HTMLCanvasElement.getContext()` 未实现提示，命令退出码为 0。
   - 下一批计划：继续 Phase 6 下一项 `[gate7 R3] Observability/error boundary/telemetry 子任务`，先补 contract 方案，再按插件错误、wrapper error boundary、diagnostics export 隐私裁剪逐步验证。

## 2026-07-06 Phase 6 阶段报告：Gate 7 Observability / Telemetry 前置收口

1. 已完成任务：
   - [gate7 R3] Observability/error boundary/telemetry：新增 `docs/superpowers/plans/2026-07-06-gate7-observability-telemetry-design.md`，冻结 O1-O5 contract、默认关闭 telemetry、宿主 opt-in、diagnostics export 隐私裁剪和 wrapper error boundary seam。
   - Core 新增 `packages/core/src/editor/observability.ts`，定义 `JWordTelemetryEvent`、`JWordTelemetryOptions`、`JWordDiagnosticsSnapshot` 等类型；`EditorOptions.telemetry.sink` 是唯一 telemetry 发送入口。
   - `Editor.exportDiagnostics()` 返回 `contentIncluded: false` 的安全快照；telemetry 与 export 都不携带插件 message，details 字符串值和 details key 均裁剪，避免正文内容外泄。
   - `docs/sdk/public-api.md` 将 observability / telemetry API 登记为 experimental；`tests/architecture/gate7-public-api-catalog.test.ts` 同步锁定根入口导出。
2. §2 分流条目：
   - 按现状修：本项不实施 Gate 7 R2 错误码单一真源生成管线，不把当前 diagnostics export 误认为完整 Step 7.11/7.23 错误码文档生成能力。
   - 按现状修：React/Vue wrapper 尚未实现；本项只冻结 wrapper error boundary seam，真实 wrapper boundary 留 `[gate7 2.2/2.3/2.4]` 后续条目。
   - 待人工裁决：请后续 Gate 7 冻结前确认 telemetry `plugin.diagnostic` 是否需要增加采样、sessionId 或宿主自定义字段；当前 core 不内置网络发送、重试或批处理。
3. 修复中新发现的问题：
   - 既有插件诊断 `message` 可能来自 `Error.message`，存在正文片段风险；本次 telemetry/export 均不包含 message，只保留稳定 code、pluginName、lifecycle、commandName、reasonCode、recoverable 与裁剪 details。
4. 视觉基线变更清单：
   - 无；本批只改 core observability contract、测试和文档，不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run packages/core/test/editor/observability.test.ts`，2 failed（telemetry 未发送、`exportDiagnostics` 不存在）。
   - 修复后单测：`pnpm exec vitest run packages/core/test/editor/observability.test.ts`，1 file / 2 passed。
   - Focused：`pnpm exec vitest run packages/core/test/editor/observability.test.ts packages/core/test/editor/plugin-runtime.test.ts tests/architecture/gate7-public-api-catalog.test.ts`，3 files / 16 passed；jsdom 仍打印 `HTMLCanvasElement.getContext()` 未实现提示但命令退出码为 0。
   - Core 文件预算追加：`pnpm exec vitest run tests/architecture/core-file-budget.test.ts packages/core/test/editor/observability.test.ts packages/core/test/editor/plugin-runtime.test.ts tests/architecture/gate7-public-api-catalog.test.ts`，4 files / 18 passed。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - 下一批计划：继续 Phase 6 下一项 `[gate7 2.6] bundle size 预算校准`，先重测当前 dist/首屏体积并区分真实增长与过时产物。

## 2026-07-06 Phase 6 阶段报告：Gate 7 bundle size 预算校准

1. 已完成任务：
   - [gate7 2.6]：新增 `docs/superpowers/plans/2026-07-06-gate7-bundle-size-calibration.md`，记录 fresh build 实测、旧预算失效原因、校准阈值和后续收紧路线图。
   - `tools/size/check-size.mjs` 从旧 Gate 2 阈值 `260000` / `330000` 校准为 Gate 7 当前预算：core entry `650000` bytes、vanilla 首屏 JS+CSS `700000` bytes。
   - `check-size.mjs` 继续保留 fresh build 证据、禁止高级包进入免费首屏和重依赖 token 扫描，并在 JSON 输出中增加 `thresholds.measuredAt` 与 `thresholds.roadmap`。
2. §2 分流条目：
   - 按现状修：修前 `pnpm size` 在同一命令内 fresh build 后失败，`packages/core/dist/index.js = 638269 bytes`、vanilla 首屏 JS+CSS `= 687669 bytes`，且 freshness 均为 true；因此破线是当前真实产物，不是 5 月旧 dist。
   - 待人工裁决：无。本项只完成当前预算校准，不把主计划 Step 7.19 的完整 size-limit / bundle 分析冒认为完成；React/Vue/devtools 等未实现能力仍留后续 Gate 7。
3. 修复中新发现的问题：
   - 当前 vanilla 首屏 source graph 仍包含 `dompurify` 与 `yjs` 包级 import；它们不是 `check-size.mjs` 的禁止重依赖 token，本批不处理。
   - Vite 仍提示 `index-*.js` 超过 500KB chunk warning；本批按 remediation 口径只校准门禁并登记后续 560000 bytes 首屏收紧目标，不做大规模拆包。
4. 视觉基线变更清单：
   - 无；本批只改 size gate 脚本和文档，不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm size` 修前失败，报 `packages/core/dist/index.js 638269 > 260000`、`examples/vanilla/dist/index.html 首屏 JS/CSS 687669 > 330000`。
   - 修复后脚本：`node tools/size/check-size.mjs` 输出 `status: ok`、`coreEntry.bytes = 638269`、`demoFirstScreen.totalBytes = 687669`、`coreEntryMaxBytes = 650000`、`demoFirstScreenMaxBytes = 700000`。
   - Size gate：`pnpm size` 通过，并重新 build root 与 vanilla demo。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - 下一批计划：继续 Phase 6 下一项 `[gate7 2.2/2.3/2.4] 补齐 wrapper / theme / devtools 详细设计文档`。

## 2026-07-06 Phase 6 阶段报告：Gate 7 Wrapper / Theme / Devtools 设计冻结

1. 已完成任务：
   - [gate7 2.2/2.3/2.4]：新增 `docs/superpowers/plans/2026-07-06-gate7-wrapper-theme-devtools-design.md`，把 React wrapper、Vue wrapper、Theme/i18n 与 Devtools 四条 Gate 7 能力拆成可执行设计。
   - React wrapper 设计明确 `JWordReactEditorProps`、`JWordReactEditorHandle`、`forwardRef` / `useImperativeHandle`、Context、默认非受控、文档模型级受控、StrictMode 双挂载幂等 cleanup、SSR 空壳、Suspense 边界和 wrapper error boundary seam。
   - Vue wrapper 设计明确 props / emits、`defineExpose`、provide/inject、`useJWordEditor()` composable、SSR 容器空壳和 `modelValue` 文档模型级替换规则。
   - Theme/i18n 设计明确 CSS custom properties、`data-theme="light|dark"`、host class 透传、轻量 key-value 字典、局部覆盖、a11y label / live region 覆盖范围，并保持不进入 core。
   - Devtools 设计明确 `@4xian/jword-devtools` 独立包、宿主显式 import 或动态 import、默认关闭、浮动面板、operation/layout/selection/perf/license/diagnostics 面板、`editor.exportDiagnostics()` 安全快照和正文隐私规则。
2. §2 分流条目：
   - 按现状修：本项只冻结详细设计，不创建 `packages/react`、`packages/vue` 或 `packages/devtools`，不把真实 wrapper/theme/devtools 实现冒认为完成。
   - 按现状修：wrapper/devtools 后续只消费 public 或明确 experimental API；如发现 diagnostics 字段不足，先回到 Gate 7 diagnostics/export 任务冻结 schema。
   - 待人工裁决：后续 Gate 7 正式实现前，请确认 React/Vue wrapper 是否都以“默认非受控 + 文档模型级受控”为 1.0 口径，以及 Devtools Chrome Extension 是否继续放到 post-1.0。
3. 修复中新发现的问题：
   - 无；本批只补设计文档与计划回写。
4. 视觉基线变更清单：
   - 无；本批不改运行时代码、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 文档静态检查：确认设计文档对 React ref/StrictMode/受控非受控、Vue provide/inject/SSR、Theme CSS custom properties/暗色模式、Devtools diagnostics export 架构均有覆盖。
   - Whitespace：`git diff --check -- docs/superpowers/plans/2026-07-06-gate7-wrapper-theme-devtools-design.md docs/superpowers/reports/2026-07-02-jword-remediation-plan.md docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md docs/superpowers/reports/2026-07-04-remediation-manual-verification-log.md` 通过。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 2.4] a11y 系统性验收补课`。

## 2026-07-06 Phase 6 阶段报告：Gate 4-6 A11y 系统性验收补课

1. 已完成任务：
   - [计划审查 2.4]：新增 `docs/superpowers/plans/2026-07-06-gate7-a11y-validation.md`，把 Gate 4 表格、批注、查找替换与 Gate 6 协作光标拆成自动化门禁和人工屏幕阅读器复核矩阵。
   - 新增 root devDependency `axe-core`，并通过 `tests/e2e/a11y-axe.ts` 在 Playwright 中注入 axe，默认阻断 serious / critical violation。
   - 新增 `examples/vanilla/tests/gate4-a11y.e2e.ts` 覆盖初始 editor/toolbar、表格自定义尺寸 dialog、批注草稿输入和查找替换面板。
   - 新增 `examples/collab/tests/collab-a11y.e2e.ts` 覆盖协作远端光标、远端选区和状态面板；新增 `tests/architecture/gate7-a11y-e2e.test.ts` 锁定 a11y E2E 入口。
   - 修复 axe 红灯暴露的问题：toolbar empty select label 对比度不足、canvas viewport 可滚动但不可聚焦、collab 远端选区文字对比度随用户色不足、collab debug pre 可滚动但不可聚焦。
2. §2 分流条目：
   - 按现状修：当前已有多处零散 aria 属性和键盘测试，但缺少 Gate 4-6 统一 axe 门禁；本批补自动化严重问题扫描，不把它冒认为完整 WCAG 合规。
   - 待人工裁决：Gate 7 正式阶段仍需人工确认屏幕阅读器矩阵，尤其是批注线程状态、查找结果 live region 和协作光标朗读文案。
3. 修复中新发现的问题：
   - `axe-core` 在初始 vanilla demo 暴露 toolbar empty select label 对比度为 2.55、canvas container 不可聚焦；collab demo 暴露 client-b 远端选区对比度为 4.07、Awareness debug pre 不可聚焦。本批均已修复。
4. 视觉基线变更清单：
   - 无；颜色只调整 toolbar empty select placeholder 和 collab 远端选区文字颜色，未刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-a11y-e2e.test.ts` 修前 1 failed（缺 `tests/e2e/a11y-axe.ts`）。
   - 红灯先行：`pnpm exec playwright test examples/vanilla/tests/gate4-a11y.e2e.ts --project=chromium` 修前 failed，serious `color-contrast` / `scrollable-region-focusable`；修复后 1 passed。
   - 红灯先行：`pnpm exec playwright test examples/collab/tests/collab-a11y.e2e.ts --project=chromium` 修前 failed，serious `color-contrast` / `scrollable-region-focusable`；修复后 1 passed。
   - Architecture：`pnpm exec vitest run tests/architecture/gate7-a11y-e2e.test.ts`，1 file / 1 passed。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - Whitespace：相关 a11y 代码、测试和文档 `git diff --check` 通过。
   - Frozen install：`pnpm install --frozen-lockfile` 通过，lockfile up to date。
   - 全量：`pnpm test` 当前失败，失败项为既有非 a11y 路径：`tests/architecture/gate6-package-exports.test.ts`（stable collab API 出现 `Y.Doc` token）、`packages/core/test/editor/facade-history.test.ts`（undo 后 selection 对象不保持同一引用）、`packages/ui/test/create-ui-paste-readonly.test.ts` 与 `tests/security/paste-security-acceptance.test.ts`（Word paste color 期望 `#c00000`，实际 `null`）。本批 a11y focused/architecture/type/lint 均通过，未在 a11y 项顺手修上述旧失败。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 2.1] 协同输入 rebase 方案评估`。

## 2026-07-06 Phase 6 阶段报告：协同输入 rebase 方案评估

1. 已完成任务：
   - [计划审查 2.1]：新增 `docs/superpowers/plans/2026-07-06-gate6-collab-input-rebase-evaluation.md`，记录 §3.12 / D7 评估结论和压测数据。
   - 新增 `examples/collab/tests/collab-input-rebase-stress.test.ts`，启动真实本地 Hocuspocus 服务与双 client provider adapter，并按固定 seed `1779900449` 执行 210 轮冲突压测。
   - 压测覆盖同位置同时输入 76 轮、一方删除另一方正在插入区域 66 轮、格式化与文本编辑重叠区 68 轮；每轮断言双端最终文本和格式快照一致，并保留场景语义断言。
2. §2 分流条目：
   - 按现状修：本轮实测 `consistentRounds=210`、`consistencyRate=1`、`failures=[]`，未触发 D7 的“低于 100% 即切换替代方案”条件，因此保留现有 `examples/collab/src/runtime/hocuspocus-text-command.ts` rebase 路径。
   - 按现状修：本项只完成协同输入 rebase 评估和回归固化，不把它冒认为 Gate 6/Gate 7 的最终 stable 协同输入方案；后续若新增 textarea harness、IME beforeinput 细分或 multi-run rich text 输入路径，需要继续扩展矩阵。
   - 待人工裁决：无；后续若压测一致率低于 100%，按 D7 切换到 Y.RelativePosition / core command 输入定位方案。
3. 修复中新发现的问题：
   - Node harness 中直接使用 `Editor.executeCommand()` 后，实时 Hocuspocus provider 不稳定地作为 core 结构化 update 的唯一广播反馈环；压测最终锁定 D7 远端 `Y.applyUpdate` + projection refresh seam，以避免把 provider 推送时序误判为 rebase 语义失败。
4. 视觉基线变更清单：
   - 无；本批只新增 Node/Vitest 协同压测和文档，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - Focused stress：`pnpm exec vitest run examples/collab/tests/collab-input-rebase-stress.test.ts --reporter=verbose`，1 file / 1 test passed；输出 `JWORD_COLLAB_REBASE_STRESS_SUMMARY { seed: 1779900449, rounds: 210, consistentRounds: 210, consistencyRate: 1, scenarioCounts: { same-position-insert: 76, delete-over-remote-insert: 66, format-overlapping-edit: 68 }, failures: [] }`。
   - 下一批计划：继续 Phase 6 下一项 `[gate7 R2] 错误码单一真源生成管线（R2 复审补充，HIGH）`。

## 2026-07-06 Phase 6 阶段报告：Gate 7 诊断码单一真源生成管线

1. 已完成任务：
   - [gate7 R2]：新增 `docs/superpowers/plans/2026-07-06-gate7-diagnostics-registry-pipeline.md`，冻结 registry 扩容、生成管线、diagnostics export 接线和护栏测试方案。
   - `fixtures/collab/diagnostics-registry.json` 从 Gate 6 局部登记表扩展为跨 collab/persistence/core/docx/pdf/native/license 的统一 registry，当前登记 182 个 code。
   - 新增 `tools/diagnostics/generate-diagnostics-artifacts.mjs`，从 registry 生成 `docs/sdk/diagnostic-codes.md` 和 `packages/core/src/editor/diagnostics-registry.ts` 摘要，并支持 `--check` 防漂移。
   - `Editor.exportDiagnostics()` 的安全快照新增 registry 摘要；`docs/sdk/public-api.md` 链接生成错误码清单。
   - 新增 `tests/architecture/gate7-diagnostics-registry.test.ts`，并调整 `tests/architecture/gate6-diagnostics-registry.test.ts` 只过滤 Gate 6 子集。
2. §2 分流条目：
   - 按现状修：保留原 registry 路径和 Gate 6 条目顺序，避免破坏现有协同 fixture；新增 Gate 7 测试负责跨包单一真源约束。
   - 按现状修：`PDF_FONT_MISSING` 当前在 PDF warning/error metadata 中复用同一 code，本批 registry 先按同一稳定 code 登记，不扩大 schema；若后续要区分多 severity，需先升级 registry schema。
   - 待人工裁决：无。本项不实现完整文档站页面，后续文档站/devtools 只消费生成清单与 `Editor.exportDiagnostics().registry`。
3. 修复中新发现的问题：
   - Gate 6 registry 测试原先直接比较全量 domains；registry 扩容后必须过滤 Gate 6 子集，否则会把 core/docx/pdf/native/license domains 误判为协同域漂移。
   - `pnpm typecheck` 暴露前一批 `examples/collab/tests/collab-input-rebase-stress.test.ts` 的 `StressClient` 接口缺 `roomId` 字段；实际返回对象已从 `StressClientBase` 继承该字段，本批补类型声明以恢复全局 typecheck。
4. 视觉基线变更清单：
   - 无；本批只改 registry、生成脚本、core diagnostics export 摘要和文档，不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts` 修前 4 failed，复现 `CANVAS_POOL_DISPOSED` 未登记、生成产物缺失、owner 缺 core/docx/pdf/native/license。
   - Focused：`pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts tests/architecture/gate6-diagnostics-registry.test.ts packages/core/test/editor/observability.test.ts`，3 files / 11 passed。
   - 生成检查：`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` 通过。
   - Type/Lint：`pnpm typecheck` 通过；`pnpm lint` 通过。
   - Whitespace：相关 registry、生成脚本、文档、测试与 typecheck 修复文件 `git diff --check` 通过。
   - 下一批计划：继续 Phase 6 下一项 `[gate7 R2] Gate 7 计划修订两小项`。

## 2026-07-06 Phase 6 阶段报告：Gate 7 R2 计划修订两小项

1. 已完成任务：
   - [gate7 R2]：主计划 Iteration 0 新增 `packages/persistence/src/` 落点，并冻结 `@4xian/jword-persistence` 的 edition 与导出分级。
   - persistence 归属 `free base contract`；stable 覆盖基础 storage contract、diagnostics、memory/storage history adapter 类型和不可用 IndexedDB fallback；experimental 覆盖 browser IndexedDB adapter 行为；internal 覆盖 Yjs reconstruction、SHA-256 helper、storage serialization helper 和实现类。
   - Step 7.19 收敛 bundle size 工具口径：`tools/size/check-size.mjs` 是免费基础首屏预算真源；`tools/size/check-gate6-collab-bundle.mjs` 只保留为 paid collaboration lazy chunk 专项护栏；`tools/size/check-native-bundle.mjs` 只保留为 native 资源专项护栏；不新增第三套阻断 CI 的 `size-limit` 预算真源。
   - 新增 `tests/architecture/gate7-plan-revision.test.ts`，锁定 canonical plan 与 public API catalog 的冻结口径。
2. §2 分流条目：
   - 按现状修：本批只修计划和公开 API 口径，不改 `tools/size/*.mjs` 运行逻辑；Gate 7 2.6 已完成的校准阈值继续由 `check-size.mjs` 执行。
   - 按现状修：`size-limit` 若后续引入，只能作为非阻断分析报告；阻断预算仍回写 `check-size.mjs`，避免三套预算漂移。
   - 待人工裁决：无；后续 `[计划审查 3.11]` 进入协同权限粒度设计与实现拆分。
3. 修复中新发现的问题：
   - 无；本批为文档与架构测试护栏，不改运行时代码。
4. 视觉基线变更清单：
   - 无；本批不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 修前 2 failed，缺 persistence 分级与 Step 7.19 单一预算真源口径。
   - Focused：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`，1 file / 2 passed。
   - Public API 回归：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose`，2 files / 8 passed。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 3.11] 协同权限粒度设计`。

## 2026-07-06 Phase 6 阶段报告：协同权限粒度设计

1. 已完成任务：
   - [计划审查 3.11]：新增 `docs/superpowers/plans/2026-07-06-gate6-collab-permission-granularity.md`，冻结正式 Hocuspocus WebSocket 服务端的 tenant-scoped documentName、per-user read/comment/write 角色和 beforeSync 拒绝策略。
   - `@4xian/jword-collab-server` root 公开 `JWordCollabHocuspocusRole`、`JWordCollabHocuspocusAuthHook`、`JWordCollabHocuspocusAuthHookInput`、`JWordCollabHocuspocusAuthHookResult`，使第三方宿主能按公开入口实现 auth hook。
   - `JWordCollabHocuspocusRole` 扩展为 `read | comment | write`；`beforeSync` 只允许 `write` 提交 Yjs update，`read` 和 `comment` 写入都返回 `COLLAB_PERMISSION_DENIED`。
   - 更新 `docs/sdk/public-api.md`、`packages/collab-server/README.md`、diagnostics registry 生成产物，明确客户端 `readonly` 只属于 UX，不是服务端安全边界。
2. §2 分流条目：
   - 按现状修：当前批注也是 Yjs update，服务端无法在 `beforeSync` 低成本区分“只新增批注”和“修改正文”；本批冻结 comment 角色名称但按非 writer 处理，精确 comment enforcement 留 post-1.0。
   - 按现状修：G6-H5 已有 read/write 拒绝路径，本批补齐公开类型、comment 角色和文档边界，不重写 Hocuspocus 同步流程。
   - 待人工裁决：无。
3. 修复中新发现的问题：
   - 无；本批未新增运行时协议字段，只扩大公开 role union 并补契约文档。
4. 视觉基线变更清单：
   - 无；本批不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose` 修前 2 failed，缺 `JWordCollabHocuspocusRole` / `JWordCollabHocuspocusAuthHook` 公开面与 public API 文档。
   - Public API：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose`，1 file / 6 passed。
   - Focused server：`pnpm exec vitest run packages/collab-server/test/server.test.ts --testNamePattern "comment-only|read-only|auth hook" --reporter=verbose`，1 file / 5 passed / 15 skipped。
   - Diagnostics：`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` 通过。
   - Package：`pnpm --filter @4xian/jword-collab-server test`，5 files / 25 passed。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 3.12] Worker 能力检测与降级口径`。

## 2026-07-06 Phase 6 阶段报告：Worker 能力检测与降级口径

1. 已完成任务：
   - [计划审查 3.12]：新增 `docs/superpowers/plans/2026-07-06-gate7-worker-capability-downgrade.md`，冻结 Worker 不可用时只返回稳定诊断、不提供同线程 fallback 的 D5 口径。
   - `@4xian/jword-docx` root 公开 `detectDocxWorkerCapability()` 与 `DOCX_WORKER_CSP_DIRECTIVES`，不可用诊断为 `DOCX_WORKER_UNAVAILABLE`。
   - `@4xian/jword-pdf` root 公开 `detectPdfWorkerCapability()` 与 `PDF_WORKER_CSP_DIRECTIVES`，不可用诊断为 `PDF_WORKER_UNAVAILABLE`。
   - `@4xian/jword-native` root 公开 `detectJWordNativeWorkerCapability()` 与 `JWORD_NATIVE_WORKER_CSP_DIRECTIVES`，不可用诊断为 `JWORD_NATIVE_WORKER_UNAVAILABLE`。
   - `fixtures/collab/diagnostics-registry.json` 新增 DOCX/native worker unavailable 码并刷新 `docs/sdk/diagnostic-codes.md`、`packages/core/src/editor/diagnostics-registry.ts`；`docs/sdk/public-api.md` 与 `packages/native/README.md` 登记 CSP baseline。
2. §2 分流条目：
   - 按现状修：能力检测只做同步 feature detection，不创建真实 Worker，不验证运行期 CSP 是否被浏览器阻断；真实 CSP 验证留 Gate 7 外部集成 smoke。
   - 按现状修：`fallback` 固定为 `none`，调用方看到 unavailable 诊断后应停止对应导入、导出或 native package 任务，不走主线程降级执行。
   - 待人工裁决：无；后续若要支持非 Blob URL worker host，只能新增显式 host 配置，不改变当前 D5 的无同线程 fallback 决策。
3. 修复中新发现的问题：
   - PDF 之前已有 `PDF_WORKER_UNAVAILABLE`，但语义同时覆盖未知 worker 异常；本批文档与 registry 将其收窄为“环境缺能力或 worker 无法完成请求”，避免再新增重复 PDF code。
4. 视觉基线变更清单：
   - 无；本批不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-worker-capability.test.ts --reporter=verbose` 修前 2 failed，缺 `detectDocxWorkerCapability` 等公开 API。
   - Worker capability：`pnpm exec vitest run tests/architecture/gate7-worker-capability.test.ts --reporter=verbose`，1 file / 2 passed。
   - Diagnostics / public API：`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check` 通过；`pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-worker-capability.test.ts --reporter=verbose`，3 files / 12 passed。
   - Gate 5 diagnostics 回归：`pnpm exec vitest run tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate7-worker-capability.test.ts tests/architecture/gate7-diagnostics-registry.test.ts --reporter=verbose`，3 files / 11 passed。
   - Package：`pnpm --filter @4xian/jword-docx test`（13 files / 73 passed）、`pnpm --filter @4xian/jword-pdf test`（8 files / 45 passed）、`pnpm --filter @4xian/jword-native test`（2 files / 15 passed）。
   - Type/Lint/Whitespace：`pnpm typecheck`、`pnpm lint`、`git diff --check` 通过。
   - Full test：`pnpm test` 中 pretest build 通过，Vitest 197 files / 903 tests passed，但仍有 4 个非本项失败：`tests/architecture/gate6-package-exports.test.ts`（既有 stable collab source 含 `Y.Doc` 文本）、`packages/core/test/editor/facade-history.test.ts`（selection identity）、`packages/ui/test/create-ui-paste-readonly.test.ts` 与 `tests/security/paste-security-acceptance.test.ts`（paste color 期望）。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 3.13] 对外浏览器支持矩阵冻结`。

## 2026-07-06 Phase 6 阶段报告：对外浏览器支持矩阵冻结

1. 已完成任务：
   - [计划审查 3.13]：新增 `docs/superpowers/plans/2026-07-06-gate7-browser-support-matrix.md` 与 `docs/sdk/browser-support.md`，冻结 D6 建议默认值为正式公开口径：桌面编辑 Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4。
   - `docs/sdk/public-api.md` 新增浏览器支持矩阵入口，明确移动端仅承诺只读分页预览，不承诺移动端编辑。
   - `examples/vanilla`、`examples/docx`、`examples/collab` 的 tsconfig 与 Vite build target 对齐 ES2022；发布包 tsconfig 已保持 ES2022。
   - 新增 `tests/architecture/gate7-browser-support.test.ts`，锁定公开文档、示例构建 target、package target 和 Playwright Chromium / Firefox / WebKit 浏览器族。
2. D6 人工验证点：
   - 建议默认值：Chrome / Edge ≥ 114、Firefox ≥ 115 ESR、Safari ≥ 16.4；移动端仅只读分页预览。
   - 写入路径：`docs/sdk/browser-support.md`、`docs/sdk/public-api.md`、`docs/superpowers/plans/2026-07-06-gate7-browser-support-matrix.md`、主计划 Gate 7 Iteration 0。
   - 构建 target 影响：示例 tsconfig 从 ES2024 降到 ES2022，示例 Vite build target 新增 `es2022`；发布包继续使用 ES2022。
   - E2E 矩阵影响：维持 Chromium / Firefox / WebKit 最新版自动回归，并明确它不是最低版本认证。
3. §2 分流条目：
   - 按现状修：不新增旧浏览器 polyfill，不把 Playwright 最新版项目包装成最低版本实验室认证。
   - 待人工裁决：若商务后续要求移动编辑或更旧浏览器，需单独立项，不修改本次 1.0 支持矩阵。
4. 视觉基线变更清单：
   - 无；本批不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts --reporter=verbose` 修前 2 failed，缺 `docs/sdk/browser-support.md` 且示例 tsconfig 仍为 ES2024。
   - Browser support：`pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts --reporter=verbose`，1 file / 2 passed。
   - Public API 回归：`pnpm exec vitest run tests/architecture/gate7-browser-support.test.ts tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose`，2 files / 8 passed。
   - Type/Lint/Whitespace：`pnpm typecheck`、`pnpm lint`、相关文件 `git diff --check` 通过。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 3.15] 补风险复核点 F`。

## 2026-07-06 Phase 6 阶段报告：风险复核点 F

1. 已完成任务：
   - [计划审查 3.15]：新增 `docs/superpowers/plans/2026-07-06-gate7-risk-checkpoint-f.md`，冻结复核点 F 的目标、冻结范围、权威来源、通过条件和当前未完成状态。
   - 主计划 `docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md` 在 Gate 7 Iteration 0 与风险控制章节补复核点 F，明确 Gate 7 Iteration 0 完成后一次性冻结 edition matrix、导出面、事件 payload 与 diagnostics 命名。
   - `docs/sdk/public-api.md` 新增 `Gate 7 frozen surface sources`，要求文档站、类型测试、wrapper 和示例只消费 public API catalog、diagnostics registry / 生成清单、browser support 与 canonical plan 等冻结来源。
   - `tests/architecture/gate7-plan-revision.test.ts` 新增复核点 F 护栏，防止主计划再次缺公开面冻结节点。
2. §2 分流条目：
   - 按现状修：本批只补复核点 F 与消费规则，不把 Gate 7 Iteration 0 冒认为已完成；主计划中的复核点 F 保持未勾选，等待 Iteration 0 全部冻结项和护栏具备证据后再勾选。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本批只改文档和 architecture test，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose` 修前 1 failed，缺复核点 F 与冻结面消费规则。
   - Risk checkpoint F：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`，1 file / 3 passed。
   - Gate 7 冻结面回归：`pnpm exec vitest run tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-browser-support.test.ts tests/architecture/gate7-diagnostics-registry.test.ts --reporter=verbose`，4 files / 15 passed。
   - 下一批计划：继续 Phase 6 下一项 `[计划审查 3.16] 版本历史与 Yjs GC 技术决策落档`。

## 2026-07-06 Phase 6 阶段报告：版本历史与 Yjs GC 技术决策

1. 已完成任务：
   - [计划审查 3.16]：新增 `docs/superpowers/plans/2026-07-06-gate6-history-yjs-gc-decision.md`，明确版本历史禁止依赖 `Y.Snapshot`，禁止为了预览或恢复把文档生命周期改为 `gc = false`。
   - 主计划 Gate 6 版本历史段落、Iteration 5 和 Step 6.6 同步固定 `update log + 隔离 Y.Doc 重放`，并说明 JWord snapshot record 只是 state update checkpoint。
   - `docs/sdk/public-api.md` persistence 小节新增版本历史 GC 决策指针，避免公开 API 文档把 Yjs Snapshot 或 `gc=false` 暴露为集成能力。
   - 新增 `tests/architecture/gate6-history-yjs-gc-decision.test.ts`，锁定决策文档、canonical plan 回写和版本历史相关源码禁用 Yjs Snapshot API / `gc=false`。
2. D8 治理参数：
   - 每 200 个 update 或 5 分钟生成一个 snapshot，以先到者为准。
   - compaction 保留最近 50 个 snapshot。
   - 更旧数据通过宿主 storage hook 归档；归档后无法恢复时必须返回稳定 persistence diagnostic，不静默半写当前文档。
3. §2 分流条目：
   - 按现状修：本批只冻结技术决策与护栏，不新增生产冷归档实现；具体冷存储后端由宿主 storage hook 承担。
   - 按现状修：现有 `packages/persistence` 继续用 update log、JWord snapshot record 和隔离 `new Y.Doc()` 重建版本，不把旧 update 直接 apply 到当前 doc。
4. 视觉基线变更清单：
   - 无；本批只改文档和 architecture test，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts --reporter=verbose` 修前 2 failed，缺技术决策文档与 canonical plan 回写。
   - History / GC decision：`pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts --reporter=verbose`，1 file / 3 passed。
   - Gate 6/7 文档回归：`pnpm exec vitest run tests/architecture/gate6-history-yjs-gc-decision.test.ts tests/architecture/gate7-plan-revision.test.ts tests/architecture/gate7-public-api-catalog.test.ts --reporter=verbose`，3 files / 12 passed。
   - Type/Lint/Whitespace：`pnpm typecheck`、`pnpm lint`、相关文件 `git diff --check` 通过。
   - 下一批计划：继续 Phase 6 下一个未完成项。

## 2026-07-06 Gate 7 阶段报告：API 导出审计和类型测试

1. 已完成任务：
   - Step 7.2：新增 `tests/architecture/gate7-api-export-audit.test.ts`，审计公开 package manifest、`files` 白名单和 export map，禁止 `src`、provider/Yjs 内部、worker 内部 helper 或 demo runtime 进入 public export map。
   - 新增 `tests/types/gate7-public-api-entrypoints.ts` 与 `tests/types/tsconfig.gate7-public-api.json`，模拟第三方 TypeScript 项目只从 package 入口消费 core/ui/native/docx/pdf/persistence/collab/collab-server/license 的 stable API。
   - `package.json` 新增 `pnpm test:types`；`docs/sdk/public-api.md` 新增 Type tests / export audit 说明，要求新增或改名 stable API 时先更新清单、类型测试和 architecture guard。
2. §2 分流条目：
   - 按现状修：当前 no-alias smoke 已覆盖本地 tarball 安装和浏览器 smoke；本批补类型层和 manifest 层护栏，不替代后续 Step 7.21 外部空项目完整验收。
   - 按现状修：`@4xian/jword-ui/styles.css` 保持公开 CSS 子路径，类型测试暂不 import CSS，CSS 仍由 export map / package manifest 审计覆盖。
3. 修复中新发现的问题：
   - 类型测试初跑暴露 `JWORD_NATIVE_FORMAT_VERSION` 当前为 number、`GATE6_COLLAB_FEATURES` 的协作主 key 为 `multiplayer`，已按当前公开类型修正 fixture。
   - `pnpm typecheck` 初跑把 `tests/types/gate7-public-api-entrypoints.ts` 与 `examples/vanilla/src/jword-native.d.ts` 放入同一 TS program，旧 demo ambient declaration 会遮蔽 native root 的完整导出；已将 `tests/types/**/*.ts` 从根 `tsconfig.json` 排除，并新增 `tests/types/tsconfig.json` 让 lint 使用同一隔离配置，外部式类型测试继续由 `pnpm test:types` 专门验收。
4. 视觉基线变更清单：
   - 无；本批只改 package script、文档、architecture test 和类型测试 fixture，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts --reporter=verbose` 修前 2 failed，缺 `test:types` 脚本、类型测试 fixture 和 public API 文档记录。
   - API export audit：`pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts --reporter=verbose`，1 file / 4 passed。
   - Type tests：`pnpm test:types` 通过。
   - Gate 7 导出回归：`pnpm exec vitest run tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`，3 files / 13 passed。
   - Type/Lint/Whitespace：`pnpm typecheck`、`pnpm lint`、相关文件 whitespace check 通过。
   - 下一批计划：继续 Gate 7 Step 7.3，为 stable API 补 TSDoc、最小示例和 diagnostics payload 文档。

## 2026-07-06 Gate 7 阶段报告：TSDoc、最小示例和诊断载荷文档

1. 已完成任务：
   - Step 7.3：新增 `tests/architecture/gate7-public-api-docs.test.ts`，锁定稳定类型测试导入符号具备贴近声明的 TSDoc 文档注释，并要求公开 API 示例与诊断载荷文档同步。
   - 新增 `tests/types/gate7-public-api-examples.ts` 并纳入 `tests/types/tsconfig.gate7-public-api.json`，以可编译 fixture 覆盖 free core/ui/native/persistence、Gate 5 docx/pdf/license、Gate 6 collab/collab-server/license 的 package 入口消费。
   - 新增 `docs/sdk/public-api-examples.md`；`docs/sdk/public-api.md` 新增 `Diagnostics payload contract`，固定 `code`、`severity`、`recoverable`、`recommendedAction`、`metadataTags`、`JWordDiagnosticsSnapshot`、feature key handoff 与隐私裁剪口径。
   - 补齐当前示例消费符号的 TSDoc：`createEditor`、`EditorOptions`、`Document`、`EditorSharedDocument`、native/docx/pdf result、persistence diagnostic/version/adapter、collab client/server contract 和 license feature/diagnostic/entitlement 类型。
2. §2 分流条目：
   - 按现状修：本批只冻结当前 Step 7.3 所需的稳定示例和诊断载荷口径，不把未来 React/Vue wrapper、完整文档站或外部空项目安装验收冒认为完成；这些仍留 Step 7.4、7.7、7.8、7.18、7.21。
   - 按现状修：diagnostic registry 生成文档当前列名为 `Fallback` / `Domains`；公开 API 文档把它们解释为宿主 recommended action 与 metadata tags，不改生成器字段名。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本批只改文档、类型 fixture、architecture test 和 TSDoc 注释，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts --reporter=verbose` 修前 3 failed，缺示例 fixture、最小示例文档和 diagnostics payload contract。
   - Public API docs：`pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts --reporter=verbose`，1 file / 3 passed。
   - Gate 7 公开面回归：`pnpm exec vitest run tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`，4 files / 16 passed。
   - Type/Lint：`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。
   - 下一批计划：继续 Gate 7 Step 7.4，建立免费基础版 quickstart。

## 2026-07-06 Gate 7 阶段报告：免费基础版 quickstart

1. 已完成任务：
   - Step 7.4：新增 `docs/sdk/quickstart.md`，覆盖安装、初始化 editor/UI、基础编辑、保存 `.jword`、打开 `.jword`、继续编辑和基础错误处理。
   - 新增 `tests/types/gate7-free-quickstart.ts` 并纳入 `tests/types/tsconfig.gate7-public-api.json`，以可编译 fixture 证明 quickstart 只从免费基础包入口消费。
   - 新增 `tests/architecture/gate7-free-quickstart.test.ts`，锁定 quickstart 不导入内部路径、付费包、Yjs、Hocuspocus server 或 demo runtime。
2. §2 分流条目：
   - 按现状修：quickstart 只覆盖 free base core/ui/native，不包含 docx/PDF/collab/license；高级格式和协作接入仍留 Step 7.12-7.17 与 Step 7.21。
3. 修复中新发现的问题：
   - 无。
4. 视觉基线变更清单：
   - 无；本批只改文档、类型 fixture 和 architecture test，不改 UI、不刷新 screenshot baseline。
5. 验证结果与下一批计划：
   - 红灯先行：`pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose` 修前 2 failed，缺 quickstart 文档和类型 fixture。
   - Free quickstart：`pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts --reporter=verbose`，1 file / 2 passed。
   - Gate 7 文档回归：`pnpm exec vitest run tests/architecture/gate7-free-quickstart.test.ts tests/architecture/gate7-public-api-docs.test.ts tests/architecture/gate7-api-export-audit.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-plan-revision.test.ts --reporter=verbose`，5 files / 18 passed。
   - Type/Lint：`pnpm test:types`、`pnpm typecheck`、`pnpm lint` 通过。
   - 下一批计划：继续 Gate 7 Step 7.5，正式实现 Plugin API 的 resource upload、persistence、import/export adapter、diagnostics 与 collab provider adapter contract。
