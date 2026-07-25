# .jword 原生格式

## 范围

`.jword` 是免费基础版的原生保存与打开格式，由 `@4xian/jword-native` 通过 package 入口提供。它保存 canonical document model、manifest、metadata、checksum 和资源摘要，不保存 DOM、Canvas 位图、layout cache、协作 provider 状态或 Yjs update log。

## 安装与入口

```ts
import {
  JWORD_NATIVE_FORMAT_VERSION,
  JWORD_NATIVE_SCHEMA_VERSION,
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage
} from '@4xian/jword-native'
```

## package entries

当前公开 package 结构固定为：

| Entry | 内容 | 说明 |
|---|---|---|
| `manifest.json` | `JWordPackageManifest` | `formatVersion`、`schemaVersion`、`minimumReaderVersion`、`featureFlags`、`packageEntries`、`resources`。 |
| `document.json` | `Document` | canonical 文档模型。 |
| `metadata.json` | `JWordPackageMetadata` | 宿主附加 JSON metadata。 |
| `checksums.json` | `JWordPackageChecksums` | 每个 entry 的 `sha256`、`byteLength`、`mime`。 |
| `resources/*` | 二进制资源 | 由 `JWordPackageResourceEntry` 记录 `id`、`path`、`mime`、`packed`。 |

`JWORD_NATIVE_FORMAT_VERSION` 与 `JWORD_NATIVE_SCHEMA_VERSION` 是文档、测试和迁移判断的单一公开常量。读取未来 schema 会返回 `JWORD_NATIVE_SCHEMA_FUTURE` 或 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`，不会静默降级。

## 保存

```ts
const result = await saveJWordDocument(editor, {
  requestId: 'save-main-document',
  metadata: {
    title: 'Quarterly plan'
  },
  onProgress(event) {
    console.log(event.phase, event.loaded, event.total)
  }
})

console.log(result.bytes.byteLength, result.manifest.schemaVersion)
```

保存结果包括 `bytes`、`blob`、`manifest`、`metadata`、`checksums`、`warnings`、`diagnostics` 和 `resources`。`SaveJWordDocumentOptions.signal` 可取消请求；取消后返回稳定 diagnostic，不会写半成品状态。

## 打开与继续编辑

```ts
const loaded = await loadJWordDocument(file, {
  requestId: 'open-main-document',
  onWarning(warning) {
    console.warn(warning.code)
  }
})

editor.loadDocumentModel(loaded.document)
```

`loadJWordDocument()` 会校验必需 entry、checksum、schema 迁移和资源引用。旧 schema 的可迁移变更会通过 `migrationReport` 与 `JWORD_NATIVE_OLD_SCHEMA_MIGRATED` warning 暴露给宿主。

## 校验

```ts
const validation = await validateJWordPackage(file, {
  requestId: 'validate-main-document'
})

if (!validation.valid) {
  console.table(validation.diagnostics)
}
```

`validateJWordPackage()` 只读取 package 结构和 checksum，不把内容加载进 editor。

## 诊断结构与本地化边界

Native package 的 `code` 是稳定契约；结构化 schema 错误可附带规范化 JSON Pointer `path`，例如 `/sections/0/blocks`。该 path 只由已知字段名和数字数组索引生成，不复制未知 key、输入值、资源 ID 或依赖异常。

Worker/runtime/protocol 的跨层 `message` 使用稳定 code，不把本地化文案或 ZIP 依赖错误作为契约。UI、wrapper 或宿主负责按 `zh-CN` / `en-US` 将 code 和结构化字段转换为用户可见提示。

## warning / error 口径

常见 warning：`JWORD_NATIVE_RESOURCE_UNPACKED`、`JWORD_NATIVE_RESOURCE_MISSING`、`JWORD_NATIVE_OLD_SCHEMA_MIGRATED`。

常见 error：`JWORD_NATIVE_MANIFEST_MISSING`、`JWORD_NATIVE_DOCUMENT_MISSING`、`JWORD_NATIVE_METADATA_MISSING`、`JWORD_NATIVE_CHECKSUMS_MISSING`、`JWORD_NATIVE_HASH_MISMATCH`、`JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`、`JWORD_NATIVE_WORKER_UNAVAILABLE`。

完整 code 清单见 [`diagnostic-codes.md`](./diagnostic-codes.md)。

## 安全限制

- `.jword` 不承诺保存 DOCX 原始 OOXML 坐标、PDF 渲染对象或协作 awareness。
- `.jword` 资源 checksum 只用于完整性校验，不是加密或访问控制。
- 协作历史由 `@4xian/jword-persistence` 管理；不要把 `.jword` 当作版本历史存储。
- 高级 DOCX/PDF 能力属于 paid format edition，见 [`advanced-formats.md`](./advanced-formats.md)。
