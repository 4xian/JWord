# 授权接入与收费能力边界

## Edition matrix

| Edition | 包 | 能力 |
|---|---|---|
| free base | `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native` | 基础编辑、UI、`.jword` 保存/打开、diagnostics export。 |
| paid format | `@4xian/jword-docx`、`@4xian/jword-pdf`、`@4xian/jword-license` | DOCX import/export、PDF export、worker progress/cancel、format warnings。 |
| paid collaboration | `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-persistence`、`@4xian/jword-license` | 多人协作、离线、历史、自动插入、self-host server。 |
| integration | `@4xian/jword-react`、`@4xian/jword-vue`、`@4xian/jword-devtools` | framework wrapper 与 opt-in diagnostics/devtools。 |

## Feature keys

`GATE5_FORMAT_FEATURES`：`docx.import`、`docx.export`、`pdf.export`。

`GATE6_COLLAB_FEATURES`：`collaboration.multiplayer`、`collaboration.offline`、`collaboration.history`、`collaboration.server`、`automation.autoInsert`。

## License token

授权 token 由 `JWordLicenseEntitlement` 提供，包含 `customerId`、`licenseToken`、`issuer`、`issuedAt`、`features`、`expiresAt`、`offlineGraceDays`、`status` 和 `signature`。生产路径必须使用签名校验；测试专用 `createInsecureTestOnlyJWordLicenseSignature()` 只能用于 fixture。

## Enforcement

付费能力必须在 worker、server 或 package 执行层调用 `assertJWordFeatureEntitled()`。浏览器按钮隐藏、文档提示或 wrapper props 不是授权边界。未授权时返回稳定错误，不读取正文。

```ts
assertJWordFeatureEntitled(license, GATE5_FORMAT_FEATURES.pdfExport)
```

## 未授权故障排查

| Code | 说明 |
|---|---|
| `JWORD_LICENSE_MISSING` | 未传 entitlement。 |
| `JWORD_LICENSE_EXPIRED` | 授权过期且不在 offline grace。 |
| `JWORD_FEATURE_NOT_ENTITLED` | feature key 不在授权中。 |
| `JWORD_LICENSE_SERVER_UNAVAILABLE` | 授权服务不可用。 |
| `JWORD_LICENSE_SIGNATURE_INVALID` | 签名缺失或校验失败。 |

完整 metadata 见 [`diagnostic-codes.md`](./diagnostic-codes.md)。

## 私有 registry

1. 先运行 `pnpm build`、`node tools/release/gate7-release-dry-run.mjs` 和 `node tools/release/check-gate7-third-party-smoke.mjs`。
2. 人工确认版本号、changeset、README/LICENSE、registry URL 和 access。
3. 只允许人工执行 publish；脚本不会自动 publish、tag 或 push。
