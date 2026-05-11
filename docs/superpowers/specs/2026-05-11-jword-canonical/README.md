# JWord Canonical Specs

本目录是 JWord 后续开发的权威需求与解决方案基线。

旧目录 `docs/superpowers/specs/2026-05-10-jword-design/` 与
`docs/superpowers/review-2026-05-11.md` 仅作为历史资料和审查依据；若与本目录冲突，以本目录为准。

## 产品定位

JWord 是一款框架无关的类 Word 在线编辑器 SDK，以 npm 包形式发布，供第三方系统集成。目标体验对标腾讯文档、ONLYOFFICE、Google Docs、WPS 文字在线版中的文档编辑场景。

JWord 不是一个完整 SaaS，也不负责账号、权限、文件存储、审计审批、消息通知、企业组织架构。JWord 提供编辑器内核、UI 组件、互通能力、协同协议接口和示例服务，宿主系统负责业务闭环。

## 目标能力

- PC Web 完整编辑，移动 Web 只读预览和轻量批注。
- 类 Word 分页编辑，编辑、预览、PDF 导出、docx 导出复用同一排版结果。
- 基础文字编辑、样式、段落、列表、分页符、表格、图片、页眉页脚、页码、批注、修订、查找替换、目录、超链接。
- docx 导入导出和 PDF 导出，先达到 T1 常用文档互通，再向 T2 常用企业文档保真推进。
- 多人实时协同、离线恢复、远端光标、历史快照。
- 程序化自动插入，支持 AI 持续写入与用户手动编辑并发。
- Vanilla、React、Vue 适配，核心保持 framework-agnostic。

## 关键原则

1. 最终架构从第一天开始使用，不做后续需要推倒的临时架构。
2. 使用分页 Canvas，不做单长 canvas 版本。
3. 使用 Y.Doc 作为权威编辑状态，本地单人模式也走同一 transaction pipeline。
4. 所有位置使用 `AnchorRef` / `RangeRef`，内部可由 Y.RelativePosition 表达。
5. 文档模型对齐 OOXML 语义，不以 HTML 或 contenteditable 作为核心模型。
6. docx/PDF import/export 走 worker，不能阻塞主线程。
7. 需求、架构、工程规范、验收标准分文件维护；公开研究资料集中在 `07-references.md`。

## 文档结构

| 文件 | 内容 |
|---|---|
| `01-requirements.md` | 产品范围、功能需求、非目标 |
| `02-technical-decisions.md` | 技术选型和不可变更约束 |
| `03-architecture.md` | 状态、事务、排版、渲染、协同、互通架构 |
| `04-engineering-standards.md` | 工程、代码风格、包边界、安全规范 |
| `05-implementation-gates.md` | 从 0 到 1 的能力 gate，不含细粒度任务 |
| `06-acceptance-and-testing.md` | 验收、性能、安全、测试矩阵 |
| `07-references.md` | 公开技术参考与采用理由 |

## 版本口径

内部用 gate 控制建设顺序，对外只保留少量里程碑：

- `0.1-alpha`：分页架构和基础编辑闭环。
- `0.5-beta`：表格、图片、批注、docx/PDF T1 互通。
- `1.0-stable`：协同、自动插入、持久化、插件和框架 wrapper 稳定。
- `post-1.0`：复杂 OOXML、复杂表格、复杂浮动、脚注尾注、修订深度互通。

## 成功标准

- Alpha 阶段证明最终架构可行，而不是只做演示 UI。
- Beta 阶段证明常用企业文档能编辑和互通。
- Stable 阶段证明可被外部系统集成、可协同、可恢复、可扩展。
- 每个阶段必须有自动化验收和可复查 fixture，不接受只靠人工体验判断。
