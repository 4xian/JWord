# @4xian/jword-native 当前实现摘要

## 包职责

`@4xian/jword-native` 提供免费基础版 `.jword` 原生 zip package 的保存、打开、校验、schema migration、资源打包、checksum、worker 和消息 helper。它只消费 core 公开 canonical document model，不保存 DOM、Canvas、layout cache、协作 provider 状态或 Yjs update log。

## 入口与导出

- 包名：`@4xian/jword-native`
- Export map：`.` 与 `./worker`。
- 当前 manifest：`private: true`，`publishConfig.access: public`。
- 运行依赖：`@4xian/jword-core`、`jszip`。

## 公开 API 摘要

根入口主要导出：

- `saveJWordDocument()`
- `loadJWordDocument()`
- `validateJWordPackage()`
- `detectJWordNativeWorkerCapability()`
- `JWORD_NATIVE_FORMAT_VERSION`
- `JWORD_NATIVE_SCHEMA_VERSION`
- `JWORD_NATIVE_CREATED_BY`
- worker message helpers
- package manifest、metadata、checksum、resource、diagnostic、migration、result 类型
- `JWordNativePackageError`

`./worker` 提供 native worker runtime 与消息处理入口，用于浏览器 worker 场景。

## 主要模块

- `index.ts`：公开 save/load/validate/worker capability 入口与类型导出。
- `package-codec.ts`：save、manifest、metadata、resource packing、checksums。
- `package-readers.ts`：zip entry 读取、JSON part 解析、checksum/schema/integrity 调用。
- `package-validation.ts`：checksum 与资源摘要。
- `validation.ts`：manifest、package entries、resource reference 完整性校验。
- `schema-migrations.ts`：schema migration chain。
- `worker.ts`、`worker-capability.ts`、`messages.ts`：worker runtime、能力检测、消息序列化。
- `types.ts`、`diagnostics.ts`、`progress.ts`、`utils.ts`：类型、错误、进度、工具函数。

## 已实现能力

- 将 `Editor`、`DocumentProjection` 或 canonical `Document` 保存为 `.jword` zip。
- package entries 包括 `manifest.json`、`document.json`、`metadata.json`、`checksums.json`、`resources/`。
- 资源打包支持 dataUrl；blobUrl 可使用 `metadata.nativeBytesBase64` fallback。
- 生成 SHA-256 checksum 与资源摘要。
- 打开 `.jword` 并返回 canonical document、metadata、manifest、checksums、migrationReport、resources。
- 只读校验 `.jword` package 结构、schema、checksum、resource reference。
- schema migration 当前存在 `0 -> 1` 显式空迁移。
- worker 支持 save/load/validate/cancel/progress/warning。
- worker capability detection 固定 `fallback: 'none'`。

## 内部实现方案

- 主格式是 `document.json` 的 canonical document model，不是 DOCX/PDF/Y.Doc binary。
- save 阶段 clone document，创建 metadata/manifest，收集可打包资源，写入 zip，再生成 checksums。
- load/validate 阶段先读取 ZIP part，再检查 checksum、manifest、schema migration support 和 document/resource 引用。
- future schema 或 unsupported schema fail-fast。
- checksum 用于完整性校验；资源缺失或 unpacked 通过 warning/diagnostic 暴露。
- worker runtime 绑定 message 分发和 AbortController；worker 不改变格式语义。

## B5 诊断契约

- Native package 读取和 schema parser 使用固定内部预算；超出资源或解压预算时返回 `JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED`。
- `JWordPackageDiagnostic`、`JWordNativePackageError` 和 Worker error shape 的可选 `path` 只接受 parser 生成的安全 JSON Pointer，不复制攻击者字段名、字段值、资源 ID 或依赖异常。
- Worker/runtime/protocol 的跨层 `message` 使用稳定 `code`；用户可见的 `zh-CN` / `en-US` 文案由 UI、wrapper 或宿主负责，本包不把本地化文本写入跨层 DTO。

## 与其它包关系

- 依赖 core 的 canonical `Document`、`Editor`、`DocumentProjection` 与资源类型。
- 不依赖 DOCX、PDF、license、collab 或 persistence。
- 与 persistence 分离：`.jword` 不保存 Yjs update log；版本历史由 persistence 管理。
- Vanilla/React/Vue 3/Vue 2 示例通过 native 保存 `.jword`。

## 主要测试/验收入口

- `packages/native/test/public-api.test.ts`
- `packages/native/test/worker.test.ts`
- `examples/vanilla/tests/gate4_5-native.e2e.ts`
- `examples/vanilla/tests/gate4_5-native-boundary.test.ts`
- `tests/architecture/gate45-native-boundary.test.ts`
- `tests/architecture/gate45-native-bundle.test.ts`
- `tests/architecture/gate45-native-release.test.ts`
- `tests/architecture/gate45-native-benchmark.test.ts`
- `tests/architecture/gate7-worker-capability.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-native typecheck`：校验 native save/load/validate/worker 类型。
- `pnpm --filter @4xian/jword-native test`：运行 native public API 与 worker 测试。
- `pnpm --filter @4xian/jword-native build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate45-native-boundary.test.ts tests/architecture/gate45-native-bundle.test.ts tests/architecture/gate45-native-release.test.ts tests/architecture/gate45-native-benchmark.test.ts tests/architecture/gate7-worker-capability.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归 native 架构、bundle、release、benchmark、worker 与公开 API。
- `node tools/release/check-native-pack.mjs`、`node tools/size/check-native-bundle.mjs`、`node benchmarks/gate45-native-benchmark.mjs`：验证 pack 内容、首屏 lazy 边界与 native benchmark。

## 当前限制/注意点

- `.jword` 不保存 DOM selection、canvas bitmap、layout cache、projection cache、协作 provider 状态或 Yjs update log。
- `.jword` 不是 DOCX/PDF/协作 history 格式。
- 资源只自动打包 dataUrl 或 blobUrl 的 `nativeBytesBase64` fallback；其它资源保留引用并产生 warning。
- checksum 是完整性校验，不是加密、签名或访问控制。
- future/unsupported schema 不静默降级。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/native/package.json`
- `packages/native/src/index.ts`
- `packages/native/src/package-codec.ts`
- `packages/native/src/package-readers.ts`
- `packages/native/src/package-validation.ts`
- `packages/native/src/validation.ts`
- `packages/native/src/schema-migrations.ts`
- `packages/native/src/worker.ts`
- `packages/native/src/worker-capability.ts`
- `packages/native/src/types.ts`
