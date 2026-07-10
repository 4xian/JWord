# 迁移与兼容策略当前实现摘要

## 对应文档

- `docs/sdk/migration.md`
- `docs/sdk/public-api.md`
- `docs/sdk/jword-format.md`
- `docs/sdk/collaboration.md`

## Semver 口径

当前文档把兼容性分为：

- patch：bug 修复、文档、recoverable diagnostic 增补。
- minor：新增 stable API、feature flag、diagnostic code，同时保留旧 API。
- major：移除 stable API、改变 `.jword` schema 兼容窗口、改变协作 protocol 兼容窗口。

## 需要迁移保护的契约

- Public API：新增或改名要同步 public API catalog、类型测试、示例、export audit。
- Native schema：以 `JWORD_NATIVE_SCHEMA_VERSION`、manifest schema 和 migration report 为准。
- Collaboration protocol：client/server mismatch fail-fast，包含 protocol、minimum version、feature flags。
- License contract：签名失败、feature 缺失、server unavailable 都有稳定 diagnostic。
- Diagnostics：新增 code 要进入 registry 和 SDK 文档。

## 实现现状

- `.jword` future/unsupported schema 已有稳定 diagnostic。
- collab client/server protocol/version/feature flag mismatch 已有 diagnostic。
- package export map 已由 architecture tests 锁定，不暴露 `src`。
- no-alias third-party smoke 使用本地 tarball 验证外部消费路径。

## 当前限制

- 真实发布前仍需人工审批版本号、registry、access、README/LICENSE、changeset。
- 旧 fixture 签名只能在显式 insecure test-only 路径接受。
