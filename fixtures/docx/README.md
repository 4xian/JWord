# JWord Gate 5 DOCX Fixtures

本目录只保存 Gate 5 DOCX fixture 的可审核 registry、人工兼容矩阵模板和后续真实输入文件。当前不预创建 `.docx` 二进制空文件；registry 中的 `input.path` 是待补真实文件的位置说明。

## Files

- `registry.json`：DOCX T1/T2 fixture 清单，覆盖输入文件、projection 摘要、warning、截图基线、DOCX roundtrip 和 PDF 视觉期望字段。
- `compatibility-matrix.md`：Word、WPS、LibreOffice 人工打开、编辑、修复提示和视觉差异记录模板。

## Rules

- 新增真实 `.docx` 输入前，先在 `registry.json` 中补充或更新对应 fixture。
- 不提交私有文档、无法复现的导出产物或空白二进制占位。
- T1 fixture 不应产生 unsupported warning；T2/T3 能力缺失必须有明确 warning 或 preserve 说明。
- 人工兼容记录只写可复查事实，不写“兼容百分比”。
