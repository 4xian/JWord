# 诊断码与 support bundle 当前实现摘要

## 对应文档

- `docs/sdk/diagnostic-codes.md`
- `docs/sdk/support-bundle.md`
- `fixtures/collab/diagnostics-registry.json`
- `tools/diagnostics/generate-diagnostics-artifacts.mjs`

## 诊断码真源

`fixtures/collab/diagnostics-registry.json` 是当前诊断码 registry。`docs/sdk/diagnostic-codes.md` 由工具生成或对齐该 registry，覆盖：

- collab/provider/awareness/offline/history/auto-insert/server/license。
- persistence storage。
- core editor/document/operation/plugin。
- docx/pdf/native worker 与格式互通。
- license entitlement。

每个 code 记录 package、severity、recoverable、fallback、tags、description。

## Support bundle 实现边界

`Editor.exportDiagnostics()` 输出隐私裁剪后的 plain JSON：

- 包版本、feature flags、license state。
- operation summary、layout metrics、selection summary。
- collaboration/server 摘要。
- plugin diagnostics 裁剪后的字段。

不包含正文、token、私钥、原始 HTML、完整用户输入、插件 message/details 字符串。

## 验证入口

- `packages/core/test/editor/observability.test.ts`
- `tests/architecture/gate7-diagnostics-registry.test.ts`
- `tests/architecture/gate7-sdk-docs.test.ts`
- `tools/diagnostics/generate-diagnostics-artifacts.mjs`

## 当前限制

- Support bundle 是导出规范和 editor 级快照，不提供远程上传服务。
- 插件诊断只保留受控字段，不能作为插件业务日志存储。
