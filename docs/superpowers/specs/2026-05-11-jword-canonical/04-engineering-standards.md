# 04 - Engineering Standards

本文件是后续开发必须遵守的工程规范。若与旧 `11-code-style.md` 冲突，以本文件为准。

## 4.1 基本原则

1. 清晰优先，不为单次使用制造抽象。
2. 代码只做当前 gate 明确要求的能力，不提前实现未验收功能。
3. 所有编辑必须走 transaction pipeline。
4. 所有 DOM 访问必须延迟到 mount。
5. 所有公开 API 必须有类型、文档、测试。
6. 所有风险性技术承诺必须有 fixture 或 benchmark。

## 4.2 TypeScript

必须启用：

- `strict: true`
- `noUncheckedIndexedAccess: true`
- `exactOptionalPropertyTypes: true`
- `noImplicitOverride: true`
- `useUnknownInCatchVariables: true`

规则：

- 核心代码禁止 `any`；确有边界输入时使用 `unknown` 并显式 narrow。
- 公开 API 类型必须显式导出。
- 联合类型、映射类型、品牌类型使用 `type`。
- 可扩展对象形态使用 `interface`。
- Opaque 类型用于 `AnchorRef`、`RangeRef`、内部 ID。

## 4.3 文件与命名

| 项 | 规范 |
|---|---|
| 文件名 | `kebab-case.ts` |
| 目录名 | `kebab-case` |
| class/interface/type | `PascalCase` |
| 函数/变量 | `camelCase` |
| 布尔值 | `is` / `has` / `can` / `should` 开头 |
| 全局常量 | `UPPER_SNAKE_CASE` |
| CSS 类 | `jw-` 前缀 + BEM |

禁止不明确缩写。允许通用缩写：`ctx`、`id`、`url`、`api`、`xml`、`docx`、`pdf`。

JavaScript 与 TypeScript 源码统一使用单引号、无尾逗号、无分号。格式化与自动修复由 ESLint 规则负责，不手工约定另一套风格。

## 4.4 注释

代码注释必须使用中文说明。允许保留代码标识符、包名、URL、TSDoc 标签、lint 指令和必要英文专有名词，但不得写成英文说明段落。

每个 `.ts` 文件必须有文件头注释，说明：

- 职责。
- 不做什么。
- 关键协作模块。
- 性能或安全约束。
- 相关决策编号或 specs 链接。

所有公开 API 必须有 JSDoc/TSDoc，说明：

- 参数。
- 返回值。
- 可能错误。
- 副作用。
- 使用示例。

复杂内部逻辑必须解释“为什么这么做”，不要注释代码字面意思。

禁止：

- 过期注释。
- 无 issue 或无方案的 TODO。
- 被注释掉的死代码。
- “增加变量”“循环数组”这类无信息注释。

## 4.5 模块边界

`@4xian/jword-core`：

- 可以依赖 Yjs。
- 不得依赖 React、Vue、docx、pdf、hocuspocus、UI 包。
- 不得在 top-level 访问 `window`、`document`、`HTMLElement` 实例。
- 可定义 DOM 类型，但实际 DOM 创建必须在 mount 后。

`@4xian/jword-ui`：

- 依赖 core。
- 原生 TS + DOM API。
- 不使用 Shadow DOM 作为默认隔离策略。
- 所有类名使用 `jw-` + BEM。

Wrapper：

- 只负责生命周期、props 到 EditorOptions、事件桥接。
- 不保存第二份编辑状态。
- SSR 阶段渲染空壳，客户端 mount。

互通包：

- 不进入 core 首屏 bundle。
- import/export 通过 worker。
- 不绕过 transaction pipeline。

## 4.6 API 稳定性

- `0.x` 阶段允许 breaking change，但必须写 changelog。
- `1.0` 后遵守 SemVer。
- 只有 README 和 API 文档列出的符号是公开 API。
- Future API 不能提前写进兼容承诺。
- 内部类型必须放在 internal 路径或不导出。

## 4.7 安全

必须覆盖：

- HTML 粘贴。
- docx 导入中的 HTML 或链接。
- 图片、视频、附件资源 URL。
- hyperlink protocol。
- 插件注入内容。
- SVG/icon 生成。

规则：

- 保格式 HTML 清洗使用 DOMPurify。
- 纯文本粘贴使用 DOMParser 或临时节点读取 `textContent`，不使用正则 sanitizer。
- 链接协议默认只允许 `http:`、`https:`、`mailto:`。
- 图片资源默认只允许 blob URL、data URL 的受控场景和集成方白名单。
- 不使用 `innerHTML` 构造 UI，除非输入经过清洗且有测试覆盖。

## 4.8 可访问性

Canvas 编辑器必须有 a11y 方案：

- 编辑区有明确 role、label、focus 状态。
- toolbar、menu、dialog 可键盘操作。
- 颜色对比满足 WCAG AA。
- v1 最少提供 aria-live 和隐藏文本镜像。
- 只读预览必须可被屏幕阅读器读取核心文本。
- a11y 检查纳入 CI。

## 4.9 测试纪律

每个 gate 必须有自动化测试。

测试文件必须集中放在测试目录中。包内测试放在该包的 `test/` 目录，仓库级架构、集成或端到端测试放在根 `tests/` 目录；禁止把 `*.test.*` 或 `*.spec.*` 放在 `src/` 源码目录旁边。

新增能力至少包含：

- 正常路径。
- 失败路径。
- undo/redo 或状态恢复路径。
- 边界输入。
- 与 transaction pipeline 的集成验证。

修复 bug 必须先有复现测试。

## 4.10 提交与发布

文档和实现计划不得要求代理自动 commit 或 publish。

规则：

- commit、tag、publish、npm release 必须人工审批。
- CI 可以验证可发布性，但不自动发布正式包。
- changesets 可以生成草稿，但发布由人工触发。

## 4.11 文档规范

需求文档写 what/why/boundary。

架构文档写 stable design。

开发计划写可执行任务。

公开参考集中放 `07-references.md`，不要把长篇 research notes 混进需求正文。
