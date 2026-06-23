# @4xian/jword-license

商业授权契约包只提供 feature key、entitlement 类型和本地授权诊断归一。它不联网、不读取文档内容，也不绑定 DOCX/PDF/协作运行时。

## Feature Keys

- `docx.import`
- `docx.export`
- `pdf.export`
- `collaboration.multiplayer`
- `collaboration.offline`
- `collaboration.history`
- `collaboration.server`
- `automation.autoInsert`

## Diagnostics

- `JWORD_LICENSE_MISSING`
- `JWORD_LICENSE_EXPIRED`
- `JWORD_FEATURE_NOT_ENTITLED`
- `JWORD_LICENSE_SERVER_UNAVAILABLE`

未授权失败路径必须先返回稳定 diagnostic，再阻止高级功能读取或写入用户文档内容。
