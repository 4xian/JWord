# Gate 5 PDF Visual Matrix

> 复制模板行后填写。`Result` 使用 `pass`、`warn`、`fail`、`blocked` 或 `pending`。

| Fixture ID | Export Artifact | Viewer | Version / Platform | Result | Page Count | Text Position Delta | Image/Table Delta | Font Result | Blocking Issue | Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<fixture-id>` | `<path-to-exported-pdf>` | PDF.js | `<version>` | pending | pending | pending | pending | pending | pending | `<screenshot-or-note>` |
| `<fixture-id>` | `<path-to-exported-pdf>` | Preview | `<version>` | pending | pending | pending | pending | pending | pending | `<screenshot-or-note>` |
| `<fixture-id>` | `<path-to-exported-pdf>` | Acrobat | `<version>` | pending | pending | pending | pending | pending | pending | `<screenshot-or-note>` |

## Review Notes

- `Text Position Delta` 记录文本框与 JWord Canvas baseline 的主要偏差。
- `Image/Table Delta` 记录图片边界、表格线位置和线宽差异。
- `Font Result` 必须说明字体已嵌入、缺字体被阻断，或字符覆盖不足被 warning。
- `Blocking Issue` 只写阻断继续验收的问题，例如打不开、乱码、页数不一致。
