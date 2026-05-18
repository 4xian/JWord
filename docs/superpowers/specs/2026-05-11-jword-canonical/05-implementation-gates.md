# 05 - Implementation Gates

本文件定义能力落地顺序。Gate 是内部建设阶段，不等于每个阶段都要公开发版。

## Gate 0 - 工程基座

目标：搭建可长期维护的 monorepo 和质量门禁。

完成物：

- pnpm workspace。
- TypeScript 6 strict 配置。
- ESLint 10 flat config。
- Rollup 包构建。
- Vite demo。
- Vitest 单测。
- Playwright E2E/visual 基础设施。
- fixtures、benchmarks、examples 目录。
- 架构边界测试。

验收：

- `pnpm install --frozen-lockfile` 可复现。
- `pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build` 可运行。
- vanilla demo 在本阶段存在，后续 gate 都能直接验证。
- core 包边界测试能阻止 React/Vue/docx/pdf 依赖进入 core。

禁止：

- 自动 commit/publish。
- 引入 `^` 依赖版本。
- 先建无法验证的空包。

## Gate 1 - 权威状态模型与事务

目标：建立不会被协同/docx/undo 推翻的内核。

完成物：

- Y.Doc 状态结构。
- OOXML 语义 Document schema。
- DocumentProjection。
- Operation schema。
- AnchorRef/RangeRef/SelectionState。
- Transaction pipeline。
- History metadata。
- 基础 Editor facade。

验收：

- 本地单人模式能在 Y.Doc 中完成文本增删和样式变更。
- Projection 可稳定派生段落和 run。
- Anchor 在前方插入/删除后不漂移。
- Operation fixture 可序列化、可回放。
- undo/redo 不丢样式、不破坏 selection restore。

禁止：

- 写第二套可写 Model 和 Y.Doc 双向同步。
- 使用临时 path 作为公开位置 API。
- 只为 demo 绕过 transaction pipeline。

## Gate 2 - 分页 Layout 与 Canvas Render

目标：从第一版渲染开始就是分页架构。

完成物：

- PageBox、ParagraphBox、LineBox、TextFragment、InlineBox。
- 字体加载与 metrics cache。
- 行内断行和基础分页。
- 每页独立 canvas。
- viewport 虚拟化。
- canvas 回收。
- hit-test：point -> AnchorRef。
- rect mapping：AnchorRef -> caret/selection rect。

验收：

- 50 页纯文本 fixture 可滚动。
- 非可视页不保留大 canvas 画布。
- Safari/iOS 不创建超大 canvas。
- 点击定位、选区、高亮、caret 正确。
- 中文、英文、emoji 混排基本正确。

禁止：

- 单长 canvas。
- 全页按 font/color 排序破坏层级。
- 默认 main/overlay 双 canvas。

## Gate 3 - 输入与基础编辑

目标：达到可日常编辑小文档的闭环。

完成物：

- hidden textarea。
- IME composition handler。
- keyboard handler。
- pointer selection。
- clipboard plain text。
- 基础 commands。
- toolbar。
- aria-live 和隐藏文本镜像基础方案。

验收：

- macOS 和 Windows 中文输入可用。
- 输入、删除、回车、方向键、选择、复制粘贴可用。
- 加粗、斜体、下划线、删除线、字体、字号、颜色、对齐、缩进可用。
- undo/redo 覆盖基础编辑和格式。
- 1-2 万字文档编辑不卡顿。

禁止：

- 直接操作 Projection。
- 正则清洗 HTML。
- 构造函数 top-level 访问 DOM。

## Gate 4 - 块级结构

目标：补齐企业文档常用结构能力。

完成物：

- 图片资源管理器。
- inline image 渲染和调整。
- 简单表格编辑。
- 批注模型、侧边栏、定位、解决。
- 超链接。
- 基础目录。
- 移动只读分页预览。
- DOMPurify 保格式粘贴 v1。

验收：

- 表格内文本编辑与 undo/redo 正确。
- 图片上传成功可替换资源，失败可恢复。
- 批注 anchor 在文本编辑后仍定位正确。
- 粘贴 HTML 不产生 XSS。

禁止：

- 图片 URL 直接信任外部输入。
- 批注使用不稳定字符 offset。

## Gate 5 - docx/PDF 互通

目标：建立可演进的 OOXML/PDF 互通层。

完成物：

- docx worker。
- OOXML parser。
- style、numbering、rels、media 索引。
- T1 docx import。
- T1 docx export。
- PDF worker。
- LayoutBox -> PDF。
- 字体配置 API。
- fixture diff 工具。

验收：

- T1 fixture 导入后结构和样式可验证。
- 导出 docx 能被 Word/WPS/LibreOffice 打开。
- PDF 中文字体正确或返回明确缺字体错误。
- import/export 过程可取消、有 progress、不阻塞输入。

禁止：

- Mammoth 作为主路径。
- 用浏览器打印代替 PDF 导出主路径。
- 互通逻辑直接进 core 首屏 bundle。

## Gate 6 - 协同、离线、自动插入

目标：完成在线文档和 AI 写入的关键能力。

完成物：

- collab provider adapter。
- hocuspocus 示例。
- awareness。
- remote cursor。
- y-indexeddb 本地恢复。
- snapshot adapter。
- createInserter API。
- origin 和 undo scope 策略。

验收：

- 双窗口同时编辑最终一致。
- 断网编辑后恢复同步。
- 远端光标和选区可见。
- AI 自动插入不阻塞本地输入。
- 用户 undo 默认不撤销 remote/AI 内容。

禁止：

- 协同层绕过 Editor transaction。
- 自动插入使用普通字符 offset。

## Gate 7 - SDK 稳定化

目标：交付可集成、可诊断、可维护的 SDK。

完成物：

- Public API 整理。
- Plugin API。
- React wrapper。
- Vue wrapper。
- 主题和 i18n。
- Devtools 面板。
- 文档站。
- 错误诊断导出。
- size-limit。

验收：

- vanilla/react/vue demo 可运行。
- 外部项目可安装和集成。
- 首屏 bundle 不包含 docx/pdf/collab。
- 插件错误被隔离。
- 公开 API 有类型、TSDoc 和类型测试。

禁止：

- wrapper 持有第二份状态。
- 公开未实现 Future API。

## 公开里程碑

- `0.1-alpha`：Gate 0-3。
- `0.5-beta`：Gate 4-5 的 T1 能力。
- `1.0-stable`：Gate 6-7。
- `post-1.0`：复杂 OOXML、深度修订、复杂表格、脚注尾注、复杂浮动对象。
