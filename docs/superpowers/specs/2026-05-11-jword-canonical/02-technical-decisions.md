# 02 - Technical Decisions

本文件记录必须遵守的技术选型。除非发现阻塞性事实，否则实现计划不得绕开这些决策。

## 2.1 不变路线

| 主题 | 决策 |
|---|---|
| 渲染 | 分页 Canvas，不使用 contenteditable，不做单长 canvas 版本 |
| 状态 | Y.Doc 是权威编辑状态，本地和协同走同一管线 |
| 模型 | 文档模型对齐 OOXML 语义，不以 HTML 作为核心状态 |
| 位置 | 公开 `AnchorRef` / `RangeRef`，内部用 Y.RelativePosition 或等价稳定位置 |
| 事务 | 所有编辑、协同、自动插入都走一个 transaction pipeline |
| 历史 | Y.UndoManager 做底层 undo/redo，JWord 保存 command metadata 和 selection restore |
| docx | 自研 OOXML parser/exporter 为主路径，Mammoth 只能作为实验性 fallback |
| PDF | 复用 LayoutBox，字体外置/按需加载 |
| 安全 | DOMPurify 或纯文本 textContent，禁止正则 HTML sanitizer |

## 2.2 工程栈

使用 pnpm 管理包，不使用 Bun 作为主工具链。

| 类别 | 选型 | 当前核验版本 |
|---|---|---|
| 包管理 | pnpm workspace | 11.0.9 |
| 语言 | TypeScript | 6.0.3 |
| Lint | ESLint flat config | 10.3.0 |
| 构建 | Rollup | 4.60.3 |
| Demo | Vite | 8.0.12 |
| 单测 | Vitest | 4.1.5 |
| E2E | Playwright | 1.59.1 |
| 协同 | Yjs | 13.6.30 |
| 服务示例 | hocuspocus | 4.x |
| 安全清洗 | DOMPurify | 3.x |
| docx zip | JSZip | 3.x |
| PDF | pdf-lib + fontkit | pdf-lib 1.x / fontkit 2.x |

依赖规则：

- `package.json` 中直接依赖必须固定精确版本，不写 `^` 或 `~`。
- 可通过集中依赖清单升级版本，但升级必须跑完整 CI。
- 生产包禁止隐式依赖 demo 包或测试包。

## 2.3 包结构

| 包 | 职责 |
|---|---|
| `@4xian/jword-core` | 状态、transaction、operation、projection、selection、layout、render、input、editor facade |
| `@4xian/jword-ui` | 原生 TS 工具栏、菜单、状态栏、批注栏、对话框 |
| `@4xian/jword-docx` | OOXML import/export、docx fixture diff 工具 |
| `@4xian/jword-pdf` | LayoutBox 到 PDF 的导出 |
| `@4xian/jword-collab` | Yjs provider binding、awareness、offline、snapshot adapter |
| `@4xian/jword-persistence` | IndexedDB、本地恢复、保存适配器 |
| `@4xian/jword-devtools` | 内嵌调试面板、operation log、layout overlay |
| `@4xian/jword-react` | React 生命周期 wrapper |
| `@4xian/jword-vue` | Vue 3 生命周期 wrapper |

Core 可依赖 Yjs，但不能依赖 UI 框架、docx、PDF、collab provider、demo。

## 2.4 渲染决策

采用分页 Canvas：

- 每个逻辑页对应独立 canvas。
- 可视区加 buffer 内页面才保留真实画布。
- 离屏页保留 DOM 占位，canvas 画布可回收为 `width=1; height=1`。
- 渲染输入是 LayoutBox 树，渲染器不直接读 Y.Doc。
- 脏区最小单位是页；当前页编辑优先，后续页分片增量重排。
- 绘制状态合并只能在不改变视觉层级的收集结果内进行，禁止全页按 font/color 打乱顺序。
- 不使用主内容/overlay 双 canvas 作为默认方案，避免浮动元素层级和显存问题。

## 2.5 文档模型决策

JWord model 必须能映射到 OOXML：

- `Document`：全局元信息、样式、资源表、修订表。
- `Section`：纸张、边距、页眉页脚、分栏、页码规则。
- `Paragraph`：段落属性、列表属性、tabs、runs。
- `Run`：文本、run properties、field、link。
- `Inline`：image、break、page break、bookmark、comment range marker。
- `Table`：row、cell、grid、border、cell props。
- `Comment`：anchor、thread、resolved 状态。
- `Revision`：作者、时间、类型、关联范围。

内部文本 offset 必须明确使用 grapheme 语义；与 Yjs index、UTF-16 index、OOXML run split 的转换必须集中在 adapter 层。

## 2.6 docx 决策

主路径：

1. `jszip` 解包 docx。
2. DOMParser 解析 OOXML XML。
3. 建立 style/numbering/relationship/media 索引。
4. 解析 document.xml 为 JWord model。
5. 导出时由 JWord model 生成 OOXML XML 字符串并打包。

要求：

- 导入导出都在 Worker。
- 任何未知 OOXML 节点必须记录 warning，不得静默吞掉。
- T1/T2 fixture 必须分别维护，不用单一百分比掩盖能力边界。
- Mammoth 仅可作为快速预览 fallback，不进入核心互通验收。

## 2.7 PDF 决策

PDF 导出必须复用 LayoutBox：

- 不另建独立排版引擎。
- 文本、图片、表格线、页眉页脚、页码按页输出。
- 中文字体、企业字体由集成方配置 URL、File 或 ArrayBuffer。
- 缺字体时必须返回可恢复错误，不能输出乱码 PDF。
- 可选 raster fallback 只用于复杂对象，不作为默认方案。

## 2.8 协同与自动插入决策

- Y.Doc 是本地和远端状态真源。
- transaction 必须带 origin。
- 默认 tracked origin 只包含用户本地操作。
- AI/程序化插入使用独立 origin，默认不进入用户 undo 栈。
- Selection、Comment、Auto Inserter 都使用稳定 anchor。
- 服务端只提供协议和 hocuspocus 示例，生产鉴权和存储由集成方实现。

## 2.9 变更规则

修改本文件中的技术决策必须：

1. 写明旧决策、新决策、原因、影响范围。
2. 同步更新架构、需求、gate 和验收文档。
3. 给出验证方式。
4. 不能只为了短期 demo 速度改变长期路线。
