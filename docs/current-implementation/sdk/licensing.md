# 授权与收费能力当前实现摘要

## 对应文档

- `docs/sdk/licensing.md`
- `docs/current-implementation/packages/license.md`
- `packages/license/src/index.ts`
- `tools/license/issue-license.mjs`

## 当前能力

`@4xian/jword-license` 提供：

- `GATE5_FORMAT_FEATURES`：`docx.import`、`docx.export`、`pdf.export`。
- `GATE6_COLLAB_FEATURES`：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
- `assertJWordFeatureEntitled()`：运行时 feature entitlement 检查。
- `createJWordLicenseError()` 与 metadata：稳定 license diagnostic。
- JWL1 token 签名验证：Ed25519 verifier、issuer、issuedAt、expiresAt、offlineGraceDays、signature。
- 测试专用 insecure signature helper，只允许 fixture 使用。

## enforcement 位置

- DOCX/PDF worker/package 执行层必须检查 paid format feature。
- collab client/server 在连接、history、auto-insert、server feature 上检查 paid collaboration feature。
- 浏览器按钮隐藏、示例状态提示、wrapper props 都不是授权边界。

## 当前限制

- 不包含客户门户、在线续费、usage metering、组织管理或远程 license server SDK。
- 真实私钥通过环境变量或文件传入 `tools/license/issue-license.mjs`；仓库只放测试 fixture。
- 所有付费包 manifest 仍为 `private: true`，真实发布需要人工审批。

## 验证入口

- `packages/license/test/entitlement.test.ts`
- `tests/architecture/gate5-commercial-readiness.test.ts`
- `tests/architecture/gate6-commercial-readiness.test.ts`
- `tools/release/check-gate5-commercial-pack.mjs`
- `tools/release/check-gate6-commercial-pack.mjs`
