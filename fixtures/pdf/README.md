# JWord Gate 5 PDF Fixtures

本目录只保存 Gate 5 PDF fixture 的可审核 registry 和后续视觉基线入口。当前不预创建 `.pdf` 二进制空文件；registry 中的 `input.path` 是待补真实 projection/layout 输入的位置说明。

## Files

- `registry.json`：PDF fixture 清单，覆盖输入、projection/layout 摘要、warning、截图基线、DOCX roundtrip 占位和 PDF 视觉期望字段。
- `inputs/pdf-chinese-font.json`：中文字体导出输入 fixture，绑定 `fonts/NotoSansSC-gate5-subset.ttf`。
- `fonts/NotoSansSC-gate5-subset.ttf`：只覆盖 `中文PDF导出` 的小型 Noto Sans SC 子集字体。

## Rules

- PDF fixture 必须来自 JWord layout/projection，不使用浏览器打印或第三方办公套件转换作为导出主路径。
- 中文字体 fixture 必须显式记录字体覆盖预期；缺字体 fixture 必须期望可恢复错误或 warning，禁止乱码输出。
- 视觉期望必须能被截图或 PDF.js 渲染结果复查，不只写 pass/fail。
- 不提交无法复现的生成 PDF 或空白二进制占位。
