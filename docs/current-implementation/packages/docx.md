# @4xian/jword-docx 当前实现摘要

## 包职责

`@4xian/jword-docx` 是商业格式包，负责 DOCX import/export、OPC package inspect、OOXML 索引、DOCX 中间模型到 core canonical document 的转换、roundtrip diff、compatibility report、worker 编排和 plugin adapter。当前实现不直接访问 core 内部 store 或 Y.Doc。

## 入口与导出

- 包名：`@4xian/jword-docx`
- Export map：`.` 与 `./worker`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`@4xian/jword-license`、`jszip`。

## 公开 API 摘要

根入口主要导出：

- `importDocx()`
- `exportDocx()`
- `inspectDocxPackage()`
- `createDocxIndexes()`
- `convertDocxImportDocumentToCoreDocument()`
- `diffDocxRoundtrip()`
- `createDocxCompatibilityReport()`
- `createDocxImportPluginAdapter()`
- `createDocxExportPluginAdapter()`
- worker capability、messages、diagnostics metadata 与公开类型。

`./worker` 提供 DOCX worker runtime 和消息处理入口。

## 主要模块

- `import.ts`、`import-readers.ts`、`import-sections.ts`：DOCX import 与 OOXML 映射。
- `export.ts`、`export-utils.ts`、`export-table.ts`：DOCX Transitional export。
- `package.ts`、`package-part-graph.ts`、`package-paths.ts`、`package-xml-readers.ts`、`xml.ts`：OPC/ZIP/XML 读取与索引。
- `model.ts`：DOCX import model 到 core `Document`。
- `roundtrip.ts`、`compatibility.ts`：回环 diff 与兼容性报告。
- `worker.ts`、`worker-capability.ts`、`messages.ts`：worker 运行时、能力检测与消息。
- `plugin-adapter.ts`：Plugin adapter descriptor。
- `types.ts`、`diagnostics.ts`：公开类型与 warning/error schema。

## 已实现能力

- DOCX 二进制导入为结构化中间模型。
- 中间模型转换为 core canonical `Document`。
- 从 core `DocumentProjection` 导出 DOCX package。
- 只读检查 DOCX package graph 与 relationship。
- 建立 OOXML indexes。
- import -> core -> export -> reimport 的 roundtrip diff。
- compatibility report，包含 package graph、roundtrip diff、Open XML validator/app result schema。
- worker import/export/inspect/progress/cancel。
- plugin import/export adapter。
- 商业授权校验：`docx.import` / `docx.export`。

## 内部实现方案

- 使用 `JSZip` 读取/生成 DOCX package。
- Import 路径先读取 OPC package context，再创建 style、numbering、comments、media、relationship 等索引，最后映射到 JSON-compatible DOCX import model。
- Export 路径生成最小 DOCX Transitional package：`[Content_Types].xml`、rels、`word/document.xml`、styles、numbering、media 等。
- Unsupported OOXML 通过 warning 和 opaque preservation 表达。
- 安全 opaque part/relationship 可在 export 时保留，不安全项会 warning 后跳过。
- Worker 在读取/输出用户内容前做 license feature 校验。
- Worker capability 固定 `fallback: 'none'`，不做同线程 fallback。

## 与其它包关系

- 依赖 core：消费 `DocumentProjection`，生成 core `Document`。
- 依赖 license：执行 paid format entitlement。
- 与 PDF 同属商业格式能力。
- 与 native 边界分离：`.jword` 不是 DOCX 替代。
- 示例 `examples/docx` 通过 worker host 演示导入、导出和 roundtrip。

## 主要测试/验收入口

- `packages/docx/test/`
- `examples/docx/tests/gate5-docx-demo.e2e.ts`
- `tests/architecture/gate5-docx-file-budget.test.ts`
- `tests/architecture/gate5-diagnostics-schema.test.ts`
- `tests/architecture/gate5-fixture-registry.test.ts`
- `tests/architecture/gate5-compatibility-runner.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/architecture/gate7-worker-capability.test.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-docx typecheck`：校验 DOCX import/export/worker/plugin adapter 类型。
- `pnpm --filter @4xian/jword-docx test`：运行 DOCX 包内 public API、import/export、roundtrip、compatibility、worker 和 XML 测试。
- `pnpm --filter @4xian/jword-docx build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate5-docx-file-budget.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate5-commercial-readiness.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-worker-capability.test.ts`：回归 DOCX 文件预算、诊断 schema、商业边界、公开 API 与 worker 能力。
- `node tools/compat/run-gate5-docx-compatibility.mjs`：按当前兼容性 runner 生成 DOCX 互通证据。

## 当前限制/注意点

- DOCX 属于商业格式，需要 license entitlement。
- 只实现 DOCX zip / OOXML import/export，不实现旧二进制 `.doc` 直接导入或导出；`.doc` 只作为 Microsoft Word 另存人工观察边界。
- 不承诺任意复杂 DOCX 100% 保真；unsupported OOXML 用 warning/opaque preservation 表达。
- 浮动 drawing、外链图片、复杂 section/formatting、部分 export metadata 仍以 warning 或降级处理。
- `./worker` 是公开 worker 入口；worker 不可用时不会静默 fallback。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/docx/package.json`
- `packages/docx/src/index.ts`
- `packages/docx/src/import.ts`
- `packages/docx/src/export.ts`
- `packages/docx/src/package.ts`
- `packages/docx/src/model.ts`
- `packages/docx/src/roundtrip.ts`
- `packages/docx/src/compatibility.ts`
- `packages/docx/src/worker.ts`
- `packages/docx/src/worker-capability.ts`
- `packages/docx/src/plugin-adapter.ts`
- `packages/docx/src/diagnostics.ts`

