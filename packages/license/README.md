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
- `JWORD_LICENSE_SIGNATURE_INVALID`

未授权失败路径必须先返回稳定 diagnostic，再阻止高级功能读取或写入用户文档内容。

签名 token 使用 `JWL1.<payload>.<signature>` 格式和 Ed25519 验签；仓库测试只能通过 `createInsecureTestOnlyJWordLicenseSignature()` 生成 fixture token。
