# Gate 7 Diagnostics Registry Single Source Pipeline（2026-07-06）

## 1. 目标

把 `fixtures/collab/diagnostics-registry.json` 从 Gate 6 局部登记表升级为 JWord 公开诊断码单一真源，覆盖 core、DOCX、PDF、native、license、collab 与 persistence。Gate 7 后续文档站、diagnostics export、wrapper/devtools 和类型测试只能消费这份 registry 或它的生成产物，不再手写第二套错误码清单。

## 2. 当前现状

- Gate 6 已有 `tests/architecture/gate6-diagnostics-registry.test.ts`，但它只检查协同、离线、history、auto-insert、server 与 persistence 前缀。
- core 已有 `JWordErrorCode` 和插件 `PluginDiagnosticCode`，但没有进入 registry。
- DOCX、PDF、license 已有各自 metadata 常量；native 只有公开 warning/error code union，没有 registry metadata。
- `Editor.exportDiagnostics()` 已有隐私裁剪快照，但未声明本快照依据哪份错误码 registry。

## 3. 实施方案

1. 保留原路径 `fixtures/collab/diagnostics-registry.json`，追加以下 owner：`core`、`docx`、`pdf`、`native`、`license`；原 Gate 6 条目顺序不变，便于现有 Gate 6 测试继续过滤验证。
2. 新增 `tools/diagnostics/generate-diagnostics-artifacts.mjs`：
   - 从 registry 生成 `docs/sdk/diagnostic-codes.md`。
   - 从 registry 生成 `packages/core/src/editor/diagnostics-registry.ts` 摘要，只包含 source、schemaVersion、codeCount、owners、domains，避免把完整错误码表打入 core runtime。
   - 支持 `--check`，用于架构测试防止生成产物漂移。
3. `Editor.exportDiagnostics()` 在安全快照中携带 registry 摘要；正文、插件 message 与 details 字符串仍按 observability 设计裁剪。
4. 新增 `tests/architecture/gate7-diagnostics-registry.test.ts`，锁定四条护栏：
   - core/docx/pdf/native/license 的公开诊断 code 必须都已登记。
   - 生成产物必须与 registry 同步。
   - registry 每条 code 必须有 owner、severity、recoverable、fallback、description、domains。
   - 生成文档必须包含每个 code，core 摘要必须包含 registry source 与 codeCount。
5. 调整 Gate 6 registry 测试为只过滤 Gate 6 子集，避免新增 owner/domains 破坏既有协同防线。

## 4. 验收命令

- 红灯先行：`pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts`，修前因 core code 未登记、生成产物缺失而失败。
- 修复后 focused：`pnpm exec vitest run tests/architecture/gate7-diagnostics-registry.test.ts tests/architecture/gate6-diagnostics-registry.test.ts packages/core/test/editor/observability.test.ts`。
- 类型与 lint：`pnpm typecheck`、`pnpm lint`。
- 生成检查：`node tools/diagnostics/generate-diagnostics-artifacts.mjs --check`。

## 5. 后续边界

- 本项只冻结错误码 registry 与生成管线，不实现完整文档站页面。
- `PDF_FONT_MISSING` 同时可作为 warning 与 error 出现，registry 先记录为同一稳定 code 的公开参考；如后续需要按 severity 拆分，应先调整 registry schema，再刷新生成产物和测试。
- 后续 Gate 7 wrapper/devtools 只引用 `Editor.exportDiagnostics().registry` 与 `docs/sdk/diagnostic-codes.md`，不得再维护手写错误码清单。
