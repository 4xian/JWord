# @4xian/jword-license 当前实现摘要

## 包职责

`@4xian/jword-license` 提供商业能力 entitlement、feature matrix、JWL1 token 校验、offline grace、授权错误归一和稳定诊断。它只做本地 entitlement 判定，不联网、不读取用户文档内容，也不绑定 DOCX/PDF runtime。

## 入口与导出

- 包名：`@4xian/jword-license`
- Export map：仅 `.`。
- 当前 manifest：`private: true`。
- 运行依赖：无。

## 公开 API 摘要

根入口主要导出：

- `GATE5_FORMAT_FEATURES`
- `GATE6_COLLAB_FEATURES`
- `assertJWordFeatureEntitled()`
- `createJWordLicenseError()`
- `createInsecureTestOnlyJWordLicenseSignature()`
- `isJWordLicenseDiagnosticCode()`
- `JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA`
- license entitlement、feature、diagnostic、validation 类型
- `JWordLicenseError`

## 主要模块

- `index.ts`：feature matrix、entitlement contract、JWL1 token 解析/校验、offline grace、错误对象。
- `crypto.ts`：零依赖 base64url、UTF-8、SHA-512、Ed25519 sign/verify helper，仅供 license 内部使用。
- `test/entitlement.test.ts`：授权 contract 测试。

## 已实现能力

- 商业格式 feature keys：`docx.import`、`docx.export`、`pdf.export`。
- 协作 feature keys：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。
- 本地 entitlement 校验：缺失、签名无效、payload 不匹配、server unavailable、feature 不匹配、过期。
- Offline grace：过期但仍在宽限期内可返回 `offlineGrace: true`。
- JWL1 Ed25519 token 验签。
- 显式 test-only fixture token 签发 helper。
- Legacy insecure fixture 仅在 `allowInsecureFixtureLicense` 下接受，并发 warning。

## 内部实现方案

- `assertJWordFeatureEntitled()` 是 paid feature 的执行层断言入口。
- JWL1 token 格式使用 `JWL1.payload.signature`，payload 以稳定 JSON 签名。
- Entitlement 明文字段必须与签名 payload 一致，避免宿主篡改未签字段。
- `status: 'server-unavailable'` 直接转为 `JWORD_LICENSE_SERVER_UNAVAILABLE`，不会放行。
- Crypto helper 为同步纯函数，不依赖第三方包或 Node 内置 crypto。

## 与其它包关系

- DOCX/PDF 执行层调用 license 做 paid format entitlement。
- Collab/collab-server 复用协作 feature matrix 和授权错误口径。
- 包本身无运行时 dependencies，可被浏览器/Node 侧同步调用。

## 主要测试/验收入口

- `packages/license/test/entitlement.test.ts`
- `tests/architecture/gate5-commercial-readiness.test.ts`
- `tests/architecture/gate6-commercial-readiness.test.ts`
- `tests/architecture/gate6-package-exports.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-license typecheck`：校验授权 feature、entitlement、诊断和 crypto helper 类型。
- `pnpm --filter @4xian/jword-license test`：运行 license entitlement、JWL1 token、offline grace 和 fixture token 测试。
- `pnpm --filter @4xian/jword-license build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate6-commercial-readiness.test.ts tests/architecture/gate6-package-exports.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归商业授权边界、包导出和公开 API catalog。

## 当前限制/注意点

- 不联网，不实现 customer portal 或 future network license validation。
- 不读取或携带用户文档正文。
- `createInsecureTestOnlyJWordLicenseSignature()` 只用于 fixture/test，不应写成生产签发 API。
- Legacy FNV fixture 只有显式允许时才通过。
- 授权失败返回稳定 diagnostic code，不能仅靠 UI 按钮隐藏作为权限边界。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/license/package.json`
- `packages/license/src/index.ts`
- `packages/license/src/crypto.ts`
- `packages/license/test/entitlement.test.ts`

