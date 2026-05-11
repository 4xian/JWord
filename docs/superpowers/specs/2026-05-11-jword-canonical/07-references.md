# 07 - References

本文件保存公开资料与采用理由。需求正文只写结论，避免 research notes 混入需求边界。

## 腾讯文档 Doc Canvas 渲染引擎流程改造

链接：https://cloud.tencent.com/developer/article/2171385

可借鉴点：

- LayoutBox 树作为排版输出。
- 按可视区域裁剪收集渲染节点。
- 分页渲染把编辑脏区缩小到页。
- 流式模式也可拆成虚拟分页，统一渲染流程。
- 离屏页 canvas 通过 `width=1; height=1` 回收显存。
- 过度 canvas 分层和 drawImage 复用在移动端、Safari、浮动元素层级上有明显风险。

JWord 采用：

- 从第一天使用分页 Canvas。
- 使用 LayoutBox 作为 Layout 与 Render 边界。
- 不做单长 canvas。
- 默认不采用 main/overlay 双 canvas。
- 不把 drawImage 复用作为主滚动优化。

## 腾讯文档渲染优化之路

链接：https://tool.lu/en_US/deck/vA/detail

可借鉴点：

- Canvas 状态切换有显著成本。
- 频繁创建对象会导致 GC 抖动。
- 对象池可改善高频渲染对象的稳定性。
- FPS 统计需要自动化和精确采样。

JWord 采用：

- 在不破坏绘制顺序的前提下减少状态切换。
- LayoutBox、Rect、TextFragment 等高频对象可使用对象池。
- 性能验收纳入 benchmarks 和 Playwright/browser trace。

## Google Docs Canvas-based Rendering

链接：https://workspaceupdates.googleblog.com/2021/05/Google-Docs-Canvas-Based-Rendering-Update.html

可借鉴点：

- Google Docs 从 HTML rendering 迁移到 canvas-based rendering，用于提升性能和跨平台一致性。
- Canvas 化会影响依赖 DOM 结构的扩展。
- 可访问性需要额外设计，不会由 DOM 自动获得。

JWord 采用：

- Canvas 自绘是合理方向，但只用于需要强排版和一致性的编辑器场景。
- 插件 API 不承诺可读取内部 DOM。
- a11y 作为一等需求，使用隐藏文本镜像和 aria-live。

## ONLYOFFICE True WYSIWYG 与 OOXML

链接：https://www.onlyoffice.com/blog/2026/02/what-is-true-wysiwyg-editing

可借鉴点：

- 真 WYSIWYG 需要编辑、预览、导出使用同一布局和渲染语义。
- 直接表达 OOXML 结构比 HTML 代理更适合 office 文档。
- 分页、字体度量、对象定位的一致性是企业文档可信度关键。

JWord 采用：

- Document schema 对齐 OOXML。
- docx/PDF 互通复用 LayoutBox。
- 不使用 HTML/contenteditable 作为核心文档状态。

## Yjs RelativePosition 与 UndoManager

链接：https://docs.yjs.dev/api/undo-manager

补充链接：https://github.com/yjs/docs/blob/main/api/relative-positions.md

可借鉴点：

- UndoManager 支持 undo/redo、capture window、tracked origins。
- RelativePosition 表达的位置能在共享文档变更后保持语义稳定。
- origin 可区分本地、远端、程序化写入。

JWord 采用：

- 本地、远端、AI 写入都带 origin。
- 用户 undo 默认只跟踪本地用户操作。
- AnchorRef/RangeRef 内部可用 RelativePosition 表达。

## OWASP XSS Cheat Sheet

链接：https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html

可借鉴点：

- HTML sanitization 推荐成熟 sanitizer，例如 DOMPurify。
- 安全 sink 包括 `textContent`、`value`、`createTextNode`。
- 不可信内容不能直接进入 `innerHTML`。

JWord 采用：

- 保格式 HTML 粘贴使用 DOMPurify。
- 纯文本粘贴使用 textContent 路线。
- 禁止正则 HTML sanitizer。

## Mammoth / docx / pdfmake 的定位

结论：

- Mammoth 适合 docx 到 clean HTML 的语义转换，不适合作为 JWord 高保真 docx 主路径。
- `docx` 库适合生成 docx，不等于可控 roundtrip 编辑器模型。
- pdfmake 可生成 PDF，但中文字体需要 VFS 或显式嵌入；JWord 默认选择 LayoutBox -> PDF 且字体外置。

JWord 采用：

- 自研 OOXML parser/exporter。
- 外部库只能作为辅助工具，不决定核心文档模型。

## 版本核验

2026-05-11 通过 npm registry 核验：

| 包 | 版本 |
|---|---|
| TypeScript | 6.0.3 |
| ESLint | 10.3.0 |
| pnpm | 11.0.9 |
| Rollup | 4.60.3 |
| Vite | 8.0.12 |
| Vitest | 4.1.5 |
| Playwright | 1.59.1 |
| Yjs | 13.6.30 |

后续实现时应重新核验 npm latest，并固定精确版本。
