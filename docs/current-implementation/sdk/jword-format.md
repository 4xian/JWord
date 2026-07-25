# .jword 原生格式当前实现摘要

## 对应文档

- `docs/sdk/jword-format.md`
- `docs/current-implementation/packages/native.md`
- `packages/native/src/index.ts`
- `packages/native/src/package-codec.ts`
- `packages/native/src/package-validation.ts`

## 当前格式

`.jword` 是免费基础版原生包格式，由 `@4xian/jword-native` 实现。包内固定保存：

- `manifest.json`：format/schema/version/resource entry。
- `document.json`：core canonical document JSON。
- `metadata.json`：宿主 metadata。
- `checksums.json`：entry hash、byteLength、mime。
- `resources/*`：文档资源二进制。

不保存 DOM、Canvas 位图、layout cache、provider 状态、协作 awareness 或 Yjs update log。

## 实现方案

- 使用 `JSZip` 读写 package。
- `saveJWordDocument()` 从 editor projection 或传入 document 生成 package。
- `loadJWordDocument()` 解析 package、校验 manifest/schema/checksum，再返回 document/metadata/resources/diagnostics。
- `validateJWordPackage()` 只做校验，不改变当前 editor。
- worker 入口位于 `@4xian/jword-native/worker`，主线程可用 message helpers 编排进度与取消。

## 诊断与兼容

- schema 未来版本返回 `JWORD_NATIVE_SCHEMA_FUTURE`。
- 不支持 schema 返回 `JWORD_NATIVE_SCHEMA_UNSUPPORTED`。
- checksum、manifest、document、metadata 缺失都有稳定 diagnostic。
- Native 资源/解压预算超限返回 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`；schema diagnostic 的可选 `path` 是 parser 生成的安全 JSON Pointer，只包含已知字段和数字索引。
- Worker/runtime/protocol 的跨层 `message` 使用稳定 code；`zh-CN` / `en-US` 文案由 UI、wrapper 或宿主展示层按 code 本地化。
- worker 不可用返回 `JWORD_NATIVE_WORKER_UNAVAILABLE`，当前不提供同线程 fallback 承诺。

## 验证入口

- `packages/native/test/public-api.test.ts`
- `packages/native/test/worker.test.ts`
- `examples/vanilla/tests/gate4_5-native.e2e.ts`
- `tests/architecture/gate7-worker-capability.test.ts`
