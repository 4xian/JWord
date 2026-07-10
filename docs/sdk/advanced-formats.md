# Gate 5 高级格式互通

## 范围与 edition

DOCX import/export 与 PDF export 属于 paid format edition。免费基础版只承诺 `.jword` 保存/打开；高级格式必须经过 `@4xian/jword-license` feature entitlement，并通过 package 入口按需加载，不能进入免费首屏 bundle。

| 能力 | Package | Feature key |
|---|---|---|
| DOCX import | `@4xian/jword-docx` | `GATE5_FORMAT_FEATURES.docxImport` (`docx.import`) |
| DOCX export | `@4xian/jword-docx` | `GATE5_FORMAT_FEATURES.docxExport` (`docx.export`) |
| PDF export | `@4xian/jword-pdf` | `GATE5_FORMAT_FEATURES.pdfExport` (`pdf.export`) |

## DOCX import/export

```ts
import { importDocx, exportDocx } from '@4xian/jword-docx'
import { GATE5_FORMAT_FEATURES, assertJWordFeatureEntitled } from '@4xian/jword-license'

assertJWordFeatureEntitled(license, GATE5_FORMAT_FEATURES.docxImport)
const imported = await importDocx(file, { requestId: 'docx-import-1', license })

assertJWordFeatureEntitled(license, GATE5_FORMAT_FEATURES.docxExport)
const exported = await exportDocx(editor.getProjection(), { requestId: 'docx-export-1', license })
```

DOCX 结果必须以 `warnings`、`diagnostics` 和 compatibility report 解释 unsupported OOXML；unsupported 内容不会被冒充成可编辑协同内容。


## `.doc` 边界

当前 `@4xian/jword-docx` 只实现 DOCX zip / OOXML import/export，不实现旧二进制 Word `.doc` 的直接导入或导出。`.doc` 只进入 Microsoft Word 人工兼容验证：先用当前 DOCX fixture 在 Word 中打开、编辑、保存、重开，再按代表性样本另存为 `.doc` 并记录 Word 是否可重开、主要可见差异和阻断问题。SDK 文档、示例和 API 不得把 `.doc` 写成当前已实现格式。

## PDF export

```ts
import { exportPdfFromLayout } from '@4xian/jword-pdf'
import { GATE5_FORMAT_FEATURES, assertJWordFeatureEntitled } from '@4xian/jword-license'

assertJWordFeatureEntitled(license, GATE5_FORMAT_FEATURES.pdfExport)
const result = await exportPdfFromLayout(editor.getLayout(), {
  requestId: 'pdf-export-1',
  license,
  onProgress(event) {
    console.log(event.stage, event.loaded, event.total)
  }
})
```

PDF export 只消费 `DocumentLayout`，不提供 PDF 导入、PDF 编辑或 viewer。字体、图片、表格线、页眉页脚通过 structured warning 暴露边界。

## Worker 能力与取消

DOCX、PDF 和 native worker 都提供 capability detection：`detectDocxWorkerCapability()`、`detectPdfWorkerCapability()`、`detectJWordNativeWorkerCapability()`。Worker 不可用时返回 `fallback: 'none'` 和稳定 code：`DOCX_WORKER_UNAVAILABLE`、`PDF_WORKER_UNAVAILABLE`、`JWORD_NATIVE_WORKER_UNAVAILABLE`。

取消请求使用对应 worker request helper，例如 `createCancelDocxRequest()`、`createCancelPdfWorkerRequest()`、`createCancelJWordNativeRequest()`。取消不会变成成功导出。

## 未授权失败

未授权、过期、feature 不匹配或授权服务不可用时，必须以 `JWORD_LICENSE_MISSING`、`JWORD_LICENSE_EXPIRED`、`JWORD_FEATURE_NOT_ENTITLED`、`JWORD_LICENSE_SERVER_UNAVAILABLE` 或 `JWORD_LICENSE_SIGNATURE_INVALID` 结束，不读取或泄漏文档正文。

## 验收证据

- DOCX fixture diff 与 compatibility evidence 由 Gate 5 工具维护。
- PDF visual report 和截图对比由 Gate 5 视觉门禁维护。
- Worker fallback none 由 Gate 7 worker capability test 锁定。
- 当前 `fixtures/docx/compatibility-results.json` 中 14 个 T1/T2 DOCX 导出 fixture 已通过自动 package graph、roundtrip diff 与 Open XML validator 检查。
- 当前 Microsoft Word 桌面版人工证据仍不是闭环：14 个 DOCX fixture 均为 `pending/not-run`。
- Microsoft Word 桌面人工证据未补齐时保持 pending，不把 automated fixture 结果写成桌面 Word 全兼容；`.doc` 只作为 Word 另存人工观察，不是当前 SDK 读写能力；历史边界摘要见 `docs/current-implementation/historical-verification-summary.md`。
