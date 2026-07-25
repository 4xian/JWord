# 商业支持诊断包规范

## 目标

support bundle 是客户报障时可导出的 plain JSON 输入。它只包含版本、feature、license 摘要、server 摘要、diagnostics、operation 摘要和 layout 指标，不包含文档正文、token、私钥、完整用户输入或原始 HTML。

## 输入来源

| 来源 | 字段 |
|---|---|
| `Editor.exportDiagnostics()` | `packageVersions`、`featureFlags`、`license`、`operations`、`layout`、`selection`、`collaboration`、`server`、`plugins`。 |
| collab client | protocolVersion、feature flags、handshake 状态、offline/history 状态。 |
| collab server | health/version、auth/tenant/license/storage hook 摘要、requestId。 |
| license | status 和 featureKeys，不包含 license token、signature 或 private key。 |

## 隐私裁剪

- `privacy.contentIncluded` 必须固定为 `false`。
- 插件 diagnostics 不包含 `message`、字符串 details 或 details key。
- operation summary 只保留 command/origin、operation kind 和 count，不包含 payload。
- layout metrics 只保留计数，不包含文本。
- server summary 不包含 token、cookie、secret、Authorization header 或私钥。

## 最小 JSON 形状

```json
{
  "kind": "jword-support-bundle",
  "schemaVersion": 1,
  "diagnostics": {},
  "notes": "由宿主附加，不写入正文内容"
}
```

## 验证

- `packages/core/test/editor/observability.test.ts` 锁定 `Editor.exportDiagnostics()` 隐私裁剪。
- `tests/architecture/gate7-sdk-docs.test.ts` 锁定 support bundle 文档字段。
- 外部 no-alias smoke 只消费 package 入口，不读取 monorepo 源码。
