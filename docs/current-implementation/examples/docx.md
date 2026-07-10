# DOCX 示例当前实现摘要

## Demo 做什么

`examples/docx` 是 DOCX/PDF 高级格式手动验收 demo。它在独立页面中装配 core editor 和官方 UI，演示 DOCX 导入、DOCX 导出、roundtrip diff、PDF 导出、warning/diagnostic 展示、下载链接、任务取消和授权错误路径。它不提供 PDF 导入、PDF 查看器或生产文件管理。

## 依赖哪些包

运行依赖来自 `examples/docx/package.json`：

- `@4xian/jword-core`
- `@4xian/jword-ui`
- `@4xian/jword-docx`
- `@4xian/jword-pdf`
- `@4xian/jword-license`

开发依赖：`typescript`、`vite`。Vite 开发态通过 alias 指向 core、ui、ui styles、license、docx、docx worker、pdf 源码。

## 真实代码入口

- 页面入口：`examples/docx/index.html`
- 浏览器入口：`examples/docx/src/main.ts`
- DOCX Worker host：`examples/docx/src/docx-worker-host.ts`
- 异步任务会话/取消 guard：`examples/docx/src/task-session.ts`
- Vite 配置：`examples/docx/vite.config.ts`
- 样式入口：`examples/docx/src/styles.css` 与 `@4xian/jword-ui/styles.css`

## 功能点

- 页面顶部提供文件选择、内置 fixture 选择、导入 DOCX、导出 DOCX、导出 PDF、取消任务。
- 默认 DOCX import/export 走真实 module worker：`new Worker(new URL('@4xian/jword-docx/worker', import.meta.url), { type: 'module' })`。
- `?docxRuntime=main-thread` 可切换到主线程对照路径；PDF 当前由页面直接动态 import `@4xian/jword-pdf` 后调用 `exportPdfFromLayout()`。
- 导入流程：读取文件或内置 `demo-basic` fixture → `importDocx()` → `convertDocxImportDocumentToCoreDocument()` → 同步第一节页面设置 → `editor.loadDocumentModel()` → 刷新 UI。
- 导出流程：`exportDocx(editor.getProjection())` 后更新下载链接，并运行 `diffDocxRoundtrip()` 写入 roundtrip 面板。
- PDF 流程：`exportPdfFromLayout(editor.getLayout())`，展示 progress 链并生成下载链接。
- `createDocxDemoTaskController()` 给每个导入/导出任务分配 requestId、AbortSignal 和 `canCommit()`，取消或新任务开始后旧任务不得再写 editor/面板。
- `window.__jwordDocxDemo` 暴露浏览器验收钩子：导入 fixture、导出 DOCX/PDF、取消任务、worker cancel probe、读取状态/warnings/roundtrip/worker events。

## 启动命令

```bash
pnpm --filter @4xian/jword-example-docx dev
pnpm --filter @4xian/jword-example-docx typecheck
pnpm --filter @4xian/jword-example-docx build
pnpm --filter @4xian/jword-example-docx preview
```

## 使用方式

常用页面入口：

- `/?license=valid`：默认有效授权，允许 DOCX import/export 和 PDF export。
- `/?license=missing`：缺少授权，导入/导出应返回稳定 license diagnostic。
- `/?license=expired`：过期授权路径。
- `/?license=feature-mismatch`：只含部分 feature 的授权，导入可成功但导出会失败。
- `/?license=server-unavailable`：server unavailable 授权状态路径。
- `/?docxRuntime=main-thread`：DOCX import/export 不走 worker，改走主线程动态 import。

页面 DOM 入口包括 `#jword-docx-file`、`#jword-docx-fixture`、`#jword-docx-import`、`#jword-docx-export`、`#jword-pdf-export`、`#jword-task-cancel`、`#jword-docx-warnings`、`#jword-docx-roundtrip`、`#jword-docx-output`、`#jword-pdf-output`、`#jword-toolbar`、`#jword-editor`、`#jword-status`。

## 测试/验证命令

Focused 单测/结构验证：

```bash
pnpm exec vitest run examples/docx/tests/task-session.test.ts examples/docx/tests/vite-config.test.ts
```

Focused 浏览器验证：

```bash
pnpm exec playwright test examples/docx/tests/gate5-docx-demo.e2e.ts --project=chromium
```

相关包级验证可按需补跑：

```bash
pnpm --filter @4xian/jword-docx test
pnpm --filter @4xian/jword-pdf test
```

## 当前限制

- 授权使用 demo 签名和 fixtures key，仅用于验收，不是生产签发链路。
- 默认 DOCX 路径使用 worker；worker 不可用时不会静默替换，除非显式使用 `?docxRuntime=main-thread`。
- PDF 只做导出和下载，不提供导入、查看或编辑。
- 未选择文件时使用内置 fixture；未知 fixture 值也回退到内置 fixture。
- Vite alias 指向 workspace 源码，不等同外部 no-alias 消费验证。
- Demo 只展示 warning/roundtrip/下载结果，不承诺任意复杂 DOCX 完全保真。
