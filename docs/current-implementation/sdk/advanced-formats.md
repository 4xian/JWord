# DOCX/PDF 高级格式当前实现摘要

## 对应文档

- `docs/sdk/advanced-formats.md`
- `docs/current-implementation/packages/docx.md`
- `docs/current-implementation/packages/pdf.md`
- `docs/current-implementation/examples/docx.md`

## DOCX 当前能力

`@4xian/jword-docx` 负责：

- `importDocx()`：读取 DOCX zip、OPC relationships、styles、numbering、comments、media，并转换为 core document。
- `exportDocx()`：从 core projection 生成最小 DOCX Transitional package。
- `inspectDocxPackage()`：检查 package graph、relationship、content types。
- `createDocxCompatibilityReport()` 与 `diffDocxRoundtrip()`：输出兼容性与 roundtrip diff。
- `./worker`：提供 import/export/inspect worker runtime、progress、cancel、transferables。
- plugin adapter：为 core plugin adapter registry 提供 import/export descriptor。

## PDF 当前能力

`@4xian/jword-pdf` 负责：

- `exportPdfFromLayout()`：从 core layout 输出 PDF。
- 字体 registry、font fallback、fontkit adapter、图片 asset 读取。
- table line、页眉页脚、基础文字样式渲染。
- `createPdfVisualReport()`：生成 PDF.js 视觉报告。
- `./worker`：提供 PDF worker runtime、progress、cancel、transferables。
- plugin adapter：为 export 路径提供 descriptor。

## 授权边界

高级格式通过 `@4xian/jword-license` 的 `GATE5_FORMAT_FEATURES` 与 `assertJWordFeatureEntitled()` 校验。未授权、过期、feature 不匹配或授权服务不可用时必须返回稳定 diagnostic，不能读取或泄漏正文。

## 当前限制

- DOCX 不完整支持复杂浮动对象、复杂修订、脚注尾注、所有 OOXML 边界。
- Microsoft Word 桌面版人工证据仍不能宣称已完成；当前 JWord 只实现 DOCX，不实现旧二进制 `.doc` 直接读写。`.doc` 只作为 Word 另存人工观察边界。
- PDF 只实现导出，不实现 PDF 导入、编辑或 viewer API。
- worker capability 当前要求明确检测，不承诺自动同线程 fallback。

## 验证入口

- `packages/docx/test/*`
- `packages/pdf/test/*`
- `examples/docx/tests/gate5-docx-demo.e2e.ts`
- `tests/architecture/gate5-*.test.ts`
- `tools/compat/run-gate5-docx-compatibility.mjs`
- B4 canonical run-a 验收：`: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"` 后运行 `node tools/release/check-gate5-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"`；入口不自行 build 或 pack。
