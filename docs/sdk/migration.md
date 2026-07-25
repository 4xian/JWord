# 迁移指南与兼容策略

## Semver

本文的 semver 口径用于 public API、native schema、collaboration protocol 和 license contract。

1. patch：只修复 bug、补文档或新增 recoverable diagnostic，不删除 stable API。
2. minor：可新增 stable API、feature flag 或 diagnostic code；旧 API 必须保留并标注 deprecation。
3. major：才允许移除 stable API、改变 `.jword` schema 兼容窗口或 collaboration protocol 兼容窗口。

## Deprecation

弃用 API 必须同时更新 public API catalog、类型测试、diagnostics 文档和迁移示例。wrapper、示例和文档站只能消费复核点 F 冻结面。

## Native schema migration

`.jword` 读取时根据 `JWORD_NATIVE_SCHEMA_VERSION` 和 manifest schema 执行迁移。未来 schema 返回 `JWORD_NATIVE_SCHEMA_FUTURE`，不静默打开；不支持 schema 返回 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`。

## Collaboration protocol

collab client/server 版本策略必须 fail-fast：`COLLAB_PROTOCOL_MISMATCH`、`COLLAB_SERVER_TOO_OLD`、`COLLAB_CLIENT_TOO_OLD`、`COLLAB_FEATURE_FLAGS_MISSING`。版本窗口和 feature flags 必须进入 support bundle，不记录 token 或正文。

## License contract migration

license token schema 变更必须保留明确诊断：envelope、canonical claims 或期限关系错误为 `JWORD_LICENSE_TOKEN_INVALID`，不受信 issuer 为 `JWORD_LICENSE_ISSUER_INVALID`，未知 keyId 为 `JWORD_LICENSE_KEY_UNKNOWN`，受信 key 的 Ed25519 验签失败为 `JWORD_LICENSE_SIGNATURE_INVALID`，feature key 缺失为 `JWORD_FEATURE_NOT_ENTITLED`。JWL2 V1 不访问在线授权服务；旧 JWL1 server 状态与签名路径继续 fail closed，旧 fixture 签名只能在显式 insecure test-only 选项下接受。

## 验证

- 类型兼容：`pnpm test:types`。
- 公开面：`pnpm exec vitest run tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-api-export-audit.test.ts --reporter=verbose`。
- no-alias：先运行 `: "${PHASE3_RUN_A_ROOT:?must point to downloaded run-a handoff}"`，再运行 `node tools/release/check-gate7-third-party-smoke.mjs --artifact-manifest "$PHASE3_RUN_A_ROOT/artifact-manifest.json" --binding "$PHASE3_RUN_A_ROOT/artifact-binding.json"`；run-a 来自 B4 canonical builder。
