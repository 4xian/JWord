# @4xian/jword-pdf 当前实现摘要

## 包职责

`@4xian/jword-pdf` 是商业格式包，负责从 core `DocumentLayout` / `PageBox` 导出 PDF，并提供字体、图片、文本样式、表格线、页眉页脚/页码、PDF.js visual report、worker 和 plugin adapter。它不实现 PDF import、PDF edit 或 PDF viewer。

## 入口与导出

- 包名：`@4xian/jword-pdf`
- Export map：`.` 与 `./worker`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`@4xian/jword-license`、`fontkit`、`pdf-lib`、`pdfjs-dist`。

## 公开 API 摘要

根入口主要导出：

- `exportPdfFromLayout()`
- `createPdfVisualReport()`
- `createPdfExportPluginAdapter()`
- `detectPdfWorkerCapability()`
- `PDF_WORKER_CSP_DIRECTIVES`
- PDF diagnostics metadata 与公开类型。

`./worker` 导出 worker-only helpers，例如 `handlePdfWorkerRequest()`、`createCancelPdfWorkerRequest()`、`readPdfImageAsset()`。

## 主要模块

- `index.ts`：PDF export 主渲染流程。
- `font-registry.ts`：标准字体、嵌入字体、fontkit、fallback、缺字检测。
- `image-assets.ts`：PNG/JPEG 图片输入解析。
- `text-style-renderer.ts`：颜色、背景、下划线、删除线、上下标基线。
- `visual-report.ts`：PDF.js 渲染与 JWord layout baseline 差异报告。
- `worker.ts`、`worker-api.ts`、`worker-capability.ts`：worker 请求、取消、transferable、能力检测。
- `plugin-adapter.ts`：Plugin export adapter。
- `types.ts`、`diagnostics.ts`：公开类型与 warning/error schema。

## 已实现能力

- 从 `DocumentLayout` 导出 PDF bytes。
- 支持基础页面、文本 fragment、inline 图片、表格边框、表格单元格文本、页眉页脚和页码。
- 支持标准字体与显式嵌入字体。
- 支持字体子集化、fallback 链、缺字 fail-fast。
- 支持 PNG/JPEG 图片输入。
- 支持文本颜色、背景、underline、strike、superscript/subscript。
- 支持 PDF.js visual report。
- 支持 worker export/cancel/progress 与 plugin export adapter。
- 商业授权校验：`pdf.export`。

## 内部实现方案

- 主路径是 `DocumentLayout/LayoutBox -> pdf-lib PDFDocument`，不使用浏览器打印或第三方办公套件转换。
- `exportPdfFromLayout()` 动态导入 `pdf-lib`，建立 PDF document、字体 registry、图片上下文后逐页渲染。
- 字体覆盖检查在输出前执行；无法覆盖文本时抛出 `PDF_FONT_MISSING`，避免生成乱码 PDF。
- 图片解析限制为 `image/png` 与 `image/jpeg`。
- 单页尺寸限制为 14400 points。
- `visual-report.ts` 使用 PDF.js legacy build 渲染 PDF，并与 JWord layout baseline 生成结构化差异。
- Worker API 在处理请求前校验 license feature，并把成功结果 bytes 作为 transferable。

## 与其它包关系

- 依赖 core：消费 `DocumentLayout`。
- 依赖 license：执行 paid format entitlement。
- 与 DOCX 同属商业格式能力。
- 示例 `examples/docx` 直接调用 PDF export 能力生成下载结果。

## 主要测试/验收入口

- `packages/pdf/test/`
- `tests/architecture/gate5-pdf-file-budget.test.ts`
- `tests/architecture/gate5-diagnostics-schema.test.ts`
- `tests/architecture/gate5-benchmark.test.ts`
- `tests/architecture/gate7-public-api-catalog.test.ts`
- `tests/architecture/gate7-worker-capability.test.ts`
- `examples/docx/tests/gate5-docx-demo.e2e.ts`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-pdf typecheck`：校验 PDF export、worker、visual report 与 plugin adapter 类型。
- `pnpm --filter @4xian/jword-pdf test`：运行 PDF 包内 export、font fallback、image、license、visual report 与 worker 测试。
- `pnpm --filter @4xian/jword-pdf build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate5-pdf-file-budget.test.ts tests/architecture/gate5-diagnostics-schema.test.ts tests/architecture/gate5-benchmark.test.ts tests/architecture/gate7-public-api-catalog.test.ts tests/architecture/gate7-worker-capability.test.ts`：回归 PDF 文件预算、诊断 schema、benchmark、公开 API 与 worker 能力。

## 当前限制/注意点

- 只支持 PDF export；不支持 PDF import/edit/viewer。
- CJK 或非标准字体需要显式字体配置，否则会以 `PDF_FONT_MISSING` fail-fast。
- 图片只支持 PNG/JPEG。
- 单页宽高超过 14400 points 会报 `PDF_PAGE_SIZE_EXCEEDED`。
- root API 不暴露 worker-only helper；worker helper 在 `./worker`。
- Worker capability 固定 `fallback: 'none'`。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/pdf/package.json`
- `packages/pdf/src/index.ts`
- `packages/pdf/src/font-registry.ts`
- `packages/pdf/src/image-assets.ts`
- `packages/pdf/src/text-style-renderer.ts`
- `packages/pdf/src/visual-report.ts`
- `packages/pdf/src/worker-api.ts`
- `packages/pdf/src/worker.ts`
- `packages/pdf/src/worker-capability.ts`
- `packages/pdf/src/plugin-adapter.ts`
- `packages/pdf/src/diagnostics.ts`

