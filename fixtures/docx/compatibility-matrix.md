# Gate 5 DOCX Compatibility Matrix

> 复制模板行后填写。`Result` 使用 `pass`、`warn`、`fail`、`blocked` 或 `pending`。
> 机器可验证模板见 `fixtures/docx/compatibility-matrix.json`；Markdown 只用于人工验收时追加截图和备注。

| Fixture ID | Export Artifact | App | Version / Platform | Result | Editable | Repair Prompt | Main Visual Difference | Blocking Issue | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<fixture-id>` | `<path-to-exported-docx>` | Word | `<version>` | pending | pending | pending | pending | pending | `<screenshot-or-note>` |
| `<fixture-id>` | `<path-to-exported-docx>` | WPS | `<version>` | pending | pending | pending | pending | pending | `<screenshot-or-note>` |
| `<fixture-id>` | `<path-to-exported-docx>` | LibreOffice | `<version>` | pending | pending | pending | pending | pending | `<screenshot-or-note>` |

## Review Notes

- `Repair Prompt` 必须记录是否出现“修复/恢复内容”等提示。
- `Editable` 必须通过实际编辑一处文本或样式后保存确认。
- `Main Visual Difference` 只写主要可见差异，例如列表缩进、表格边框、图片尺寸、页边距。
- `Blocking Issue` 只写阻断继续验收的问题，例如打不开、内容丢失、保存后损坏。
