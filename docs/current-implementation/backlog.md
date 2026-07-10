# JWord 当前实现 Backlog

> 快照日期：2026-07-09。
> 本文只记录当前代码与当前文档体系尚未覆盖、尚需人工复验或适合作为后续路线图的事项。
> 本文可以作为 issue tracker 的导入草稿；每个条目都按“标题 / 背景 / 范围 / 验收标准 / 证据产出”拆分。

## 0. 状态与优先级规则

- 状态：`Backlog` 表示尚未开始；`Ready` 表示依赖齐备可直接执行；`In progress` 表示已有分支或文档正在推进；`Done` 表示已完成并有证据。
- 优先级：`P0` 发布前必须重新确认；`P1` 当前能力已暴露但证据或稳定性不足；`P2` 后续版本重要能力；`P3` 长期研究或商业化扩展。
- 当前所有条目默认状态为 `Backlog`，执行前应先核对真实源码、manifest、测试入口和 SDK 文档。
- 完成任一条目后，应把结果写回当前实现文档、SDK 文档或专门的验证记录，不应只保留在临时会话里。

## 1. 发布前与当前能力缺口

### JW-BACKLOG-001：屏幕阅读器人工验证矩阵

- 类型：verification / accessibility
- 优先级：P1
- 状态：Backlog
- 背景：当前已有自动化 a11y 与键盘 smoke 入口，但自动化结果不能替代屏幕阅读器真实朗读验证。批注、查找替换、协作光标、工具栏状态、选区操作等交互需要人工确认朗读顺序与语义是否可用。
- 范围：
  - 编辑器正文、分页预览、工具栏按钮与状态。
  - 批注侧栏、批注定位、批注选中与关闭。
  - 查找替换面板的输入、结果数量、上一条/下一条切换。
  - 协作 presence、远端光标或用户标记的可理解文本。
  - 只读模式、修订标记、选择浮层等状态提示。
- 不在范围：不要求本条实现新的屏幕阅读器专用 UI；只验证当前实现并记录必须修复的问题。
- 验收标准：
  - [x] 定义最小人工矩阵，至少覆盖 macOS VoiceOver 与一个 Windows 屏幕阅读器组合；见 `docs/current-implementation/screen-reader-manual-verification.md`。
  - [ ] 每个关键交互记录“可朗读 / 不可朗读 / 需修复”的结果。
  - [ ] 对严重阻断问题创建独立修复 issue，不把人工验证缺口直接标记为通过。
  - [x] 更新 `docs/sdk/browser-support.md` 或稳定矩阵文档中的 a11y 说明。
- 证据产出：人工验证记录、环境版本、浏览器版本、屏幕阅读器版本、失败截图或录屏说明。
- 操作手册：`docs/current-implementation/screen-reader-manual-verification.md`。

### JW-BACKLOG-002：Microsoft Word 桌面兼容证据（DOCX / DOC 边界）

- 类型：verification / docx compatibility
- 优先级：P1
- 状态：Backlog
- 背景：当前 `@4xian/jword-docx` 只实现 DOCX zip / OOXML import/export，不实现旧二进制 `.doc` 读写。当前公开口径只应承认自动 Open XML 校验、package graph、roundtrip diff；Microsoft Word 桌面版的真实打开、编辑、保存、重开证据仍需补齐。
- 范围：
  - 使用当前 `@4xian/jword-docx` 导出的 14 个 T1/T2 DOCX fixture。
  - 覆盖普通段落、样式、列表、表格、图片、批注、修订、页眉页脚等当前已实现或已降级的 DOCX 能力。
  - 在 Microsoft Word 桌面版中打开、编辑、保存、重开并记录差异。
  - `.doc` 只作为 Microsoft Word 另存为旧二进制格式后的人工观察项：记录 Word 是否可另存、重开以及主要差异；当前 JWord 不直接生成 `.doc`，也不解析 `.doc`。
- 不在范围：不验证非 Microsoft Word 办公套件；不要求一次性覆盖 Word 所有 OOXML 边界；不把 `.doc` 作为 SDK import/export API；复杂边界应拆到长期兼容 issue。
- 验收标准：
  - [x] 固化一组最小兼容 fixture 与导出命令。
  - [ ] 记录 Microsoft Word 桌面版真实验证结果，包含版本号和系统环境。
  - [ ] 每条 Word 证据绑定当前导出 artifact 的 path、byteLength 和 SHA-256。
  - [ ] 对代表性文件记录 Word 另存为 `.doc` 后的打开/重开/主要差异；若不验证则明确记为 `not-run`。
  - [ ] 把不兼容项分级为阻断、可接受差异或后续增强。
  - [x] 更新 `docs/sdk/advanced-formats.md` 的兼容范围，不夸大未验证能力。
- 证据产出：导出文件、Word 打开截图、重保存文件、roundtrip 差异摘要、`.doc` 另存观察、兼容结论。

### JW-BACKLOG-003：发布前 fresh verification run

- 类型：verification / release readiness
- 优先级：P0
- 状态：Done（基础命令和长矩阵 fresh run 已通过；真实发布不在范围）
- 背景：当前文档记录的是仓库已有能力和历史验证入口，不能替代发布前在当前 checkout 上重新执行完整验证。
- 范围：
  - 基础质量：`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm build`。
  - 类型示例：`pnpm test:types`。
  - 浏览器路径：相关 focused Playwright、`pnpm test:e2e`、`pnpm test:visual`。
  - 性能与体积：`pnpm bench`、`pnpm size`。
  - 发布演练：release dry-run、第三方 no-alias tarball smoke。
- 不在范围：不执行真实发布；真实发布拆到 `JW-BACKLOG-006`。
- 验收标准：
  - [x] 在当前 checkout 上执行发布前命令矩阵；第三方 tarball smoke 使用临时空项目 fresh install。
  - [x] 记录 Node、pnpm、OS、Playwright 版本和命令输出摘要。
  - [x] 红灯已修复并重跑：Firefox 全选选区渲染问题已在 `packages/core/src/editor/runtime-selection.ts` 收口，focused 与全量 E2E 通过。
  - [x] 更新稳定矩阵文档，区分 fresh pass、known failure、not run。
- 证据产出：命令输出摘要、本地日志索引、失败重跑摘要、稳定矩阵更新。
- 当前记录：基础命令和长矩阵结果见 `docs/current-implementation/verification-2026-07-07.md`；真实 publish 未执行，仍归 `JW-BACKLOG-006` 和人工审批。

### JW-BACKLOG-004：Plugin、decorations、observability 公开 API 稳定化评审

- 类型：api review / sdk
- 优先级：P1
- 状态：Done（评审完成，结论为继续保持 experimental）
- 背景：当前 core 与 SDK 文档已暴露 plugin、decorations、observability/telemetry 相关能力，但部分口径仍属于 experimental 或试用。若要作为 1.0 stable，需要单独评审公开类型、错误隔离和迁移承诺。
- 范围：
  - `packages/core/src/plugins/*` 的 host、adapter registry、builtin plugin 能力。
  - decorations 的输入输出类型、生命周期、渲染边界。
  - observability/telemetry hook 的事件结构、隐私边界和错误隔离。
  - SDK 文档中的 stable / experimental / internal 分级。
- 不在范围：不引入插件写模型、插件自定义 operation union；这些属于长期路线图。
- 验收标准：
  - [x] 列出公开插件、decorations、observability / diagnostics 入口的稳定级别；当前结论为继续保持 experimental。
  - [x] stable 项已有 `pnpm test:types`、公开 API catalog 与 package export audit 入口。
  - [x] experimental 项已在 `docs/current-implementation/api-stability-review.md` 和 `docs/sdk/public-api.md` 明确命名、文档口径和迁移风险。
  - [x] 插件命令、middleware、keybinding、decoration、lifecycle 与 telemetry sink 的错误隔离已有 focused 测试证据。
  - [x] 已更新 `docs/sdk/public-api.md`、`docs/current-implementation/api-stability-review.md` 与对应包实现摘要。
- 证据产出：API 审计表、类型测试、错误隔离测试、SDK 文档更新。
- 当前记录：评审结果见 `docs/current-implementation/api-stability-review.md`；当前不升 stable，后续升 stable 前置条件已在评审文档中列出。

### JW-BACKLOG-005：全局工程硬约束证据审计

- 类型：architecture / documentation
- 优先级：P1
- 状态：Done
- 背景：当前仓库已有大量架构测试、SDK 文档和包实现摘要，但仍需要一个不依赖历史计划的全局约束审计，明确哪些约束已有自动化证据，哪些只是文档约定。
- 范围：
  - 包边界、public export map、no-alias 使用、`private: true` 状态。
  - core 框架无关边界、DOM 顶层访问限制、依赖方向限制。
  - 文件头说明、注释规范、包版本一致性和发布脚本入口。
  - diagnostics registry、support bundle、browser matrix、release dry-run 证据。
- 不在范围：不重写所有实现摘要；只建立约束到证据入口的索引。
- 验收标准：
  - [x] 形成一份 current-only 的工程约束清单。
  - [x] 每条约束已指向源码、manifest、测试、脚本或 SDK 文档中的当前证据。
  - [x] 无证据或需人工复验的约束已进入 backlog，不继续作为已满足事实表述。
  - [x] 删除或归档旧资料后，工程约束仍可通过当前文档独立理解。
- 证据产出：工程约束审计文档、缺口 issue 列表、相关测试链接。
- 当前记录：工程约束证据索引见 `docs/current-implementation/engineering-constraints.md`。

### JW-BACKLOG-006：真实 registry publish readiness

- 类型：release / packaging
- 优先级：P1
- 状态：Done（dry-run 审计完成；真实 publish 仍需人工审批）
- 背景：当前 release 能力只覆盖 dry-run 与 tarball smoke；所有 package manifest 仍为 `private: true`。真实 npm 或私有 registry 发布需要单独准备和人工审批。
- 范围：
  - 包名、版本、license、files、exports、types、sideEffects、peerDependencies。
  - `private` 标记移除策略和分包发布顺序。
  - provenance、registry、token、2FA、dist-tag 和 rollback 策略。
  - 发布前 tarball 内容审计与第三方消费 smoke。
- 不在范围：不在本 issue 中执行 `npm publish` 或任何真实发布命令。
- 验收标准：
  - [x] 明确首批 dry-run 候选包、paid/restricted 包与真实发布前仍需人工确认的包状态。
  - [x] 每个包都有发布元数据审计结果。
  - [x] release dry-run 与第三方消费 smoke 已通过；完整 fresh run 结果记录在 `docs/current-implementation/verification-2026-07-07.md`。
  - [x] 形成真实发布前人工审批清单，包含 registry、版本、license metadata、token、2FA、provenance、dist-tag 与 rollback 策略确认点。
  - [x] 未经人工确认不执行真实 publish；当前所有包仍为 `private: true`。
- 证据产出：package publish audit、dry-run 日志、runbook。
- 当前记录：发布元数据审计与 dry-run 结果见 `docs/current-implementation/release-metadata-audit.md`；真实 registry 发布仍不得自动执行。

### JW-BACKLOG-007：历史验证摘要归档

- 类型：documentation / audit trail
- 优先级：P2
- 状态：Done
- 背景：旧过程文档中包含红灯、收口原因、人工验证边界和范围取舍。删除旧资料前，需要把仍有审计价值的结论整理成不依赖历史目录的摘要，避免只保留最终状态而丢失原因。
- 范围：
  - 发布前命令矩阵的历史红灯与后续收口结论。
  - Microsoft Word pending、屏幕阅读器 pending、no-publish dry-run 的范围原因。
  - 窄屏适配不等同于独立移动端产品线的产品边界。
- 不在范围：不迁移逐步执行日志和长篇过程讨论。
- 验收标准：
  - [x] 形成 current-only 的历史验证摘要。
  - [x] 每条摘要都有当前可核对的事实入口或明确标为历史背景。
  - [x] 删除旧资料后，代码审查仍能理解为什么存在这些范围限制。
- 证据产出：历史验证摘要文档、SDK 文档中的限制说明更新。
- 当前记录：历史验证摘要见 `docs/current-implementation/historical-verification-summary.md`；SDK 侧限制说明已由 `docs/sdk/browser-support.md`、`docs/sdk/advanced-formats.md`、`docs/sdk/public-api.md` 和 `docs/sdk/stable-e2e-matrix.md` 承载。

## 2. 后续版本路线图

### JW-ROADMAP-001：完整修订互通与复杂审阅流

- 类型：feature / document review
- 优先级：P2
- 状态：Backlog
- 背景：当前实现已有修订相关数据结构和 UI 入口，但复杂审阅流、接受/拒绝深度流程和复杂 track changes roundtrip 仍不是完整能力。
- 范围：接受/拒绝单条与批量修订、嵌套修订、跨段落修订、DOCX roundtrip、冲突提示。
- 验收标准：
  - [ ] 定义修订模型与 UI 交互的完整状态机。
  - [ ] 覆盖 DOCX 导入导出 roundtrip fixture。
  - [ ] 补齐核心命令、UI 和测试矩阵。

### JW-ROADMAP-002：脚注、尾注、交叉引用与题注

- 类型：feature / advanced document model
- 优先级：P2
- 状态：Backlog
- 背景：这些结构属于高级文档语义，当前不是主路径能力。
- 范围：脚注、尾注、交叉引用、题注编号、导入导出、渲染定位。
- 验收标准：
  - [ ] 设计模型记录、布局锚点和命令 API。
  - [ ] 实现导入导出和渲染验证。
  - [ ] 在 SDK 文档中说明支持范围和限制。

### JW-ROADMAP-003：复杂浮动对象、文本框与艺术字

- 类型：feature / layout compatibility
- 优先级：P2
- 状态：Backlog
- 背景：当前布局和导出主路径不覆盖复杂浮动对象、文本框和艺术字的完整兼容。
- 范围：浮动锚点、环绕方式、层级、文本框内容、艺术字降级策略、DOCX/PDF 输出。
- 验收标准：
  - [ ] 定义支持与降级边界。
  - [ ] 建立 representative fixture。
  - [ ] 验证分页布局、DOCX roundtrip 和 PDF 输出。

### JW-ROADMAP-004：复杂表格、复杂 OOXML 与 Word 边界兼容

- 类型：feature / compatibility
- 优先级：P2
- 状态：Backlog
- 背景：当前表格和 DOCX 能力覆盖常用路径，不等同于 Word 所有边界兼容。
- 范围：复杂合并单元格、嵌套表格、跨页表格、条件样式、复杂 OOXML package parts。
- 验收标准：
  - [ ] 建立复杂表格 fixture 分级。
  - [ ] 明确每类 OOXML 边界的支持、保留或降级策略。
  - [ ] 补齐导入、编辑、导出和办公套件验证。

### JW-ROADMAP-005：Vue 2 直接集成示例已完成；独立 Vue 2 wrapper 暂不做

- 类型：integration / framework example
- 优先级：P3
- 状态：Done（直接集成 demo 已完成；独立 Vue 2 wrapper 不进入当前实现范围）
- 背景：当前已有 `examples/vue2` 直接集成示例，证明 Vue 2 项目可以通过 core + ui + native 使用 JWord。该示例使用 Vue 2 SFC `<template>` 和 Options API，不使用 `render()`、`createElement()` 或 Vue 3 `h()`。仓库仍没有独立 Vue 2 wrapper 包，也没有 Vue 2 SSR wrapper 行为；这属于未来可重新评估的独立产品取舍，不再作为当前 demo 缺口。
- 范围：Vue 2 SFC 直接集成示例、Options API 生命周期、core/ui/native package 入口消费、typecheck/build 和示例 import 架构检查。
- 不在范围：不新增独立 Vue 2 wrapper 包，不承诺 Vue 2 SSR wrapper，不把 `@4xian/jword-vue` 降级兼容到 Vue 2。
- 已有证据：`examples/vue2/src/main.ts`、`examples/vue2/src/App.vue`、`docs/current-implementation/examples/vue2.md`、`tests/architecture/gate7-examples-public-imports.test.ts`、`docs/sdk/stable-e2e-matrix.md`。
- 验收标准：
  - [x] 明确当前只提供 Vue 2 直接集成示例，不提供独立 Vue 2 wrapper 包或子路径导出。
  - [x] 示例使用 Vue 2 SFC `<template>` 与 Options API 编写，组合 `@4xian/jword-core`、`@4xian/jword-ui`、`@4xian/jword-native`。
  - [x] 补齐 Vue 2 示例的 typecheck、build 和公共 import / 常见组件语法 smoke。
- 证据产出：Vue 2 示例实现摘要、稳定矩阵条目、focused 验证日志。
- 当前记录：`docs/current-implementation/examples/vue2.md`；本地验证日志见 `.logs/jw-vue2-demo-2026-07-07/`。

### JW-ROADMAP-006：Chrome Extension 形态 Devtools

- 类型：developer tooling
- 优先级：P3
- 状态：Backlog
- 背景：当前 devtools 是 opt-in DOM 浮动面板；浏览器扩展形态需要独立架构和权限模型。
- 范围：Chrome Extension manifest、content script、panel UI、diagnostics 桥接、隐私边界。
- 验收标准：
  - [ ] 设计 extension 与页面 SDK 的通信协议。
  - [ ] 实现最小面板并读取 diagnostics。
  - [ ] 验证不泄露文档正文或敏感 support bundle 内容。

### JW-ROADMAP-007：完整 RTL 布局、视觉矩阵与屏幕阅读器矩阵

- 类型：i18n / accessibility / layout
- 优先级：P2
- 状态：Backlog
- 背景：当前只保留 `dir` 透传和不破坏文本对齐的基础口径；完整 RTL 需要布局、输入、选择、渲染和辅助技术矩阵。
- 范围：RTL 段落、混排文本、选择命中、工具栏方向、PDF/DOCX 输出、视觉和屏幕阅读器验证。
- 验收标准：
  - [ ] 定义 RTL 支持范围和不支持边界。
  - [ ] 建立视觉与 E2E fixture。
  - [ ] 完成人工读屏验证并更新 browser support 文档。

### JW-ROADMAP-008：插件写模型能力与自定义 Operation union

- 类型：plugin platform
- 优先级：P2
- 状态：Backlog
- 背景：当前 plugin/decorations 偏向扩展 UI、渲染或观测；插件直接写模型、自定义 operation union 会影响事务、协作和兼容策略。
- 范围：插件命令、插件 operation schema、事务合并、历史记录、协作同步、迁移策略。
- 验收标准：
  - [ ] 完成插件写模型 RFC。
  - [ ] 明确 operation 序列化和版本兼容规则。
  - [ ] 补齐事务、undo/redo、collab rebase 测试。

### JW-ROADMAP-009：真实 worker host、CSP 验证与同线程 fallback

- 类型：runtime / security
- 优先级：P2
- 状态：Backlog
- 背景：当前 DOCX/PDF/native worker 能力需要进一步覆盖真实部署环境中的 worker host、CSP 与 fallback 策略。
- 范围：worker 加载路径、CSP header、跨源限制、同线程 fallback、错误诊断。
- 验收标准：
  - [ ] 建立 CSP 实验页面或测试环境。
  - [ ] 验证 worker host 在常见 bundler 与静态部署下可用。
  - [ ] 明确 fallback 的性能和功能限制。

### JW-ROADMAP-010：comment 级服务端可写批注精确权限

- 类型：collaboration / permission
- 优先级：P2
- 状态：Backlog
- 背景：当前协作服务端已有 auth hook 和 history 能力；comment 级写权限需要更细粒度的服务端校验和前端反馈。
- 范围：批注创建、编辑、删除、解决、恢复的权限策略与审计记录。
- 验收标准：
  - [ ] 设计 comment-level permission contract。
  - [ ] 服务端拒绝未授权写入并返回可诊断错误。
  - [ ] 客户端展示权限失败原因并保持本地状态一致。

### JW-ROADMAP-011：JWord 托管云协作服务

- 类型：product / cloud service
- 优先级：P3
- 状态：Backlog
- 背景：当前协作能力偏 self-host 和示例服务；托管云服务需要独立产品、SRE 和商业化设计。
- 范围：托管房间、租户隔离、数据保留、配额、监控、备份、SLA。
- 验收标准：
  - [ ] 完成托管服务 PRD 和架构设计。
  - [ ] 明确与 self-host SDK 的边界。
  - [ ] 建立最小可运营环境和监控指标。

### JW-ROADMAP-012：企业 SSO、SCIM、组织通讯录、复杂权限流与审计报表

- 类型：enterprise / admin
- 优先级：P3
- 状态：Backlog
- 背景：这些能力属于企业控制台和身份治理，不是当前编辑器 SDK 主路径。
- 范围：SAML/OIDC SSO、SCIM、组织成员同步、角色权限、审计报表。
- 验收标准：
  - [ ] 明确企业身份边界和目标客户场景。
  - [ ] 设计 tenant/user/group/resource 权限模型。
  - [ ] 完成审计事件 schema 和报表需求。

### JW-ROADMAP-013：高级授权运营能力

- 类型：licensing / commercial operations
- 优先级：P3
- 状态：Backlog
- 背景：当前 license 包提供本地 entitlement 校验；在线续费、离线授权包轮换和客户级 rollout 属于商业运营系统能力。
- 范围：在线续费、离线授权包轮换、客户级 feature rollout、license portal、授权审计。
- 验收标准：
  - [ ] 设计 license portal 与现有本地 token 的边界。
  - [ ] 定义客户级 rollout 和撤销策略。
  - [ ] 补齐运营审计与错误诊断。

### JW-ROADMAP-014：协作算法与归档方案研究

- 类型：research / collaboration
- 优先级：P3
- 状态：Backlog
- 背景：当前协作主路径基于 Yjs；自研 OT、Yjs Snapshot、Automerge、Loro、生产冷归档等属于研究或后续替代方案，不应影响当前主路径判断。
- 范围：算法对比、迁移成本、数据格式、性能、冲突语义、归档恢复能力。
- 验收标准：
  - [ ] 输出研究报告，明确是否值得进入原型阶段。
  - [ ] 如进入原型，先隔离在 throwaway demo 或实验包。
  - [ ] 不破坏当前 Yjs 主路径和现有协作 API。

### JW-ROADMAP-015：官方底部状态栏与视图控制栏 MVP

- 类型：feature / ui / view controls
- 优先级：P1
- 状态：In progress（MVP 代码能力可收口；剩余为 vanilla focused E2E、截图级人工验收和发布前 fresh run）
- 背景：当前 `@4xian/jword-ui` 已有 toolbar、主题 token、i18n 覆盖、live region、editor facade 订阅和 `editor.setPageConfig({ scale })` 能力，但还没有类似 Word / ONLYOFFICE / Umo Editor 的底部状态栏。企业版编辑器需要在底部集中承载文档统计、页码、缩放、视图模式、主题、语言和状态入口。
- 范围：
  - 底部状态栏容器：左侧文档/品牌状态，右侧视图控制。
  - 左侧 MVP：版权/品牌文案、总字数、字符数、段落数、当前页/总页数、选区统计。
  - 右侧 MVP：全屏、基础演示模式、缩放滑块、缩放百分比、还原 100%、自适应页面宽度、自适应整页。
  - 设置项 MVP：主题切换、语言切换。
  - 可访问性：按钮可键盘访问，状态变化写入 live region，状态栏有清晰 aria label。
- 已锁定设计决策：
  - [x] `statusBar` 公开配置支持 `true | false | JWordStatusBarOptions`；未传时默认创建状态栏，`statusBar: false` 明确禁用。
  - [x] 未传 `toolbarHost` / `statusBar.host` 时，官方 UI 目标默认布局为 `toolbar / editor shell / statusBar` 三段式；vanilla demo 中间的 demo controls 是 demo-only，不属于官方 UI。
  - [x] 动态主题切换首批公开在 `JWordUiInstance.setTheme(...)`，切换时必须同步 `data-theme`、class、CSS custom properties 和可见样式。
  - [x] 语言切换首批只支持 `zh-CN` 与 `en-US` 两种内建语言；宿主 `messages` 覆盖优先。
  - [x] 文档统计口径已定义：中英文混排 word count、非空白 grapheme 字符数、段落数、表格文本统计和复杂选区不可用显示。
  - [x] 缩放范围锁定为 20% - 400%，内部 scale 为 `percent / 100`；自适应宽度/整页按可视容器和页面 100% 尺寸计算后 clamp。
  - [x] 状态刷新来源包含 transaction、selectionChange、scroll、resize、状态栏自身 setPageConfig 后立即刷新和 `createJWordUi().refresh()`。
  - [x] 顶部工具栏和底部状态栏共用 `view-state.ts` 的视图控制逻辑，避免缩放、适应宽度/整页、全屏和演示模式出现两套行为。
  - [x] 演示模式开启后隐藏 toolbar/statusBar，仅保留编辑器内容；按 Esc 退出；鼠标靠近编辑器底部边缘时临时显示状态栏，离开后隐藏。
- 不在范围：
  - 不实现完整企业权限、敏感性标签、托管云协作或 AI 助手。
  - 不改变 core 文档模型和分页主路径。
  - 不把状态栏只写成 demo-only 控件；首批应落在 `packages/ui`，demo 只做消费示例。
- 验收标准：
  - [x] `createJWordUi(...)` 未显式传 `statusBar: false` 时可创建默认状态栏。
  - [x] 状态栏可根据 editor transaction、selectionChange、scroll、resize 更新文档统计、页码和缩放。
  - [x] 缩放滑块、100%、适应宽度、适应整页都通过 `editor.setPageConfig({ scale })` 更新页面配置。
  - [x] 全屏和基础演示模式可进入、退出，并有可复跑测试覆盖。
  - [x] 主题和语言切换不需要销毁重建整套 UI。
  - [x] vanilla demo 已默认接入官方状态栏并保留现有 toolbar、编辑、选择、保存 `.jword` 能力；demo controls 仍是 demo-only，不属于官方 UI。
  - [x] `packages/ui` focused 单元测试、typecheck 和当前实现文档已覆盖状态栏主体行为。
  - [ ] 新增 `examples/vanilla/tests/gate7-status-bar.e2e.ts`，覆盖初始统计/页码/缩放、100%、适应宽度、演示模式、主题和语言。
  - [ ] 发版前补截图级人工验收与 fresh run；`pnpm lint:comments`、UI focused test、typecheck 需重新执行并记录。
- 收口结论：当前不再继续扩大 MVP 功能范围；可继续实施的状态栏工程任务只剩专门 vanilla E2E，其余协作/保存/企业治理/diagnostics/AI 能力分别进入后续 roadmap。
- 实施方案：`docs/current-implementation/status-bar-mvp-implementation-plan.md`。


### JW-ROADMAP-020：顶部工具栏专业 / 常用双模式

- 类型：feature / ui / toolbar
- 优先级：P1
- 状态：Done（专业/常用模式、默认图片/表格入口、页面/视图/导出 Tab、模式选择器与共享视图控制已落地；真实页面手测已确认核心功能可用）
- 背景：当前官方 toolbar 已有内建工具、插件菜单、media/table 扩展、主题和 i18n，但展示形态仍偏单行工具条。后续需要支持类似 UmoDoc 的专业多 Tab ribbon，同时保留可配置的常用工具模式。
- 范围：
  - 专业模式：Tab + ribbon 工具区，默认启用。
  - 常用模式：只展示宿主配置或默认常用工具。
  - 模式切换：不销毁 editor，不重建 UI 状态。
  - i18n/theme：新增 Tab、切换按钮、tooltip、live region 和样式必须覆盖中英文与亮暗主题。
- 验收标准：
  - [x] 默认创建专业 Tab 工具栏。
  - [x] 常用模式支持 visibleTools / hiddenTools 配置。
  - [x] 模式切换按钮可在专业与常用之间切换，并播报状态。
  - [x] theme/i18n 动态切换后所有新增文案和样式同步更新。
  - [x] 插入、表格、页面、视图、导出 Tab 已按现有能力分类展示；常用模式隐藏表格结构操作。
  - [x] 真实页面手测确认功能基本可用；后续若发现问题按独立 bug 处理。
- 后续非阻断：
  - [ ] 如需发版归档，补截图级人工验收或 vanilla focused E2E，覆盖默认专业模式、Tab 切换、常用模式切换和页面 Tab 自定义纸张。
- 实施方案：`docs/current-implementation/toolbar-modes-implementation-plan.md`。


### JW-ROADMAP-021：页面水印与版权防篡改

- 类型：feature / ui / watermark / brand protection
- 优先级：P1
- 状态：Done
- 背景：企业文档编辑器需要页面水印能力，并需要对底部状态栏版权展示做 best-effort 防篡改恢复。该能力首轮作为编辑器实例级 UI 能力落地，不修改 core 文档模型。
- 范围：
  - `JWordUiInstance.setWatermark(...)`、`clearWatermark()`、`getWatermark()`。
  - 编辑器 canvas container 内部用户水印层，支持多行内容、字体大小和字体颜色。
  - 顶部工具栏“工具” Tab 增加“页面水印”下拉菜单，支持应用和清除水印。
  - 状态栏版权支持隐藏、删除后恢复、多次篡改后挂载内置版权水印。
  - i18n 覆盖 `zh-CN` / `en-US`，主题覆盖 light / dark。
- 不在范围：
  - 不把水印写入 core 文档模型、undo/redo 或协作事务。
  - 不承诺 DOCX/PDF/.jword 导出自动保留；首轮只暴露 `getWatermark()` 供导出 seam 读取。
  - 不实现禁止 F12 或阻止任意 JS 篡改。
- 验收标准：
  - [x] 公开 API 可设置、读取、清除用户水印。
  - [x] 删除用户水印 DOM 后自动恢复，且不影响编辑器输入和选区。
  - [x] 工具 Tab 水印菜单可设置多行内容、字体大小和颜色，并可清除。
  - [x] 版权 `hidden` / `restore` / `watermarkFallback` 三种策略有 focused 测试覆盖。
  - [x] 动态语言和暗色主题下菜单、tooltip、aria 与样式同步。
- 实施方案：`docs/current-implementation/watermark-and-brand-protection-implementation-plan.md`。


### JW-ROADMAP-016：底部栏协作、保存、批注与修订状态

- 类型：feature / collaboration / review
- 优先级：P2
- 状态：Backlog
- 背景：企业文档编辑器底部栏不仅展示视图控制，也应展示协作与审阅状态。当前协作、批注、修订能力分散在 collab package、comments panel 和 revisions panel 中，缺少统一的底部状态入口。
- 范围：
  - 保存状态：已保存、未保存、保存中、保存失败。
  - 协作状态：离线、连接中、已连接、同步中、已同步、重连中。
  - 协作者状态：在线人数、当前用户、远端用户摘要入口。
  - 批注状态：未解决批注数量、点击打开批注侧栏。
  - 修订状态：修订数量、审阅模式状态、点击打开修订面板。
  - 只读/审阅权限状态：只读、可评论、可管理修订、可编辑。
- 前置任务：
  - [ ] 定义 `statusBar.collaboration` adapter 输入，不让 `@4xian/jword-ui` 直接依赖 collab package。
  - [ ] 定义 `statusBar.saveState` 宿主输入，不假设所有接入方都有保存服务。
  - [ ] 明确批注/修订计数从 projection 读取，还是由对应 controller 暴露状态。
- 验收标准：
  - [ ] 未启用协作时状态栏不显示误导性的在线状态。
  - [ ] collab demo 可展示真实 provider 状态和在线人数。
  - [ ] 批注和修订入口与现有 panel 状态同步。
  - [ ] 权限失败时 live region 有明确提示。

### JW-ROADMAP-017：企业治理状态栏能力

- 类型：feature / enterprise / governance
- 优先级：P3
- 状态：Backlog
- 背景：企业版编辑器通常需要在底部或固定状态区展示权限、安全、合规和授权信息。当前 license 包只有本地 entitlement 校验，权限和敏感性标签还没有统一产品模型。
- 范围：
  - 权限状态：可编辑、只读、仅评论、仅审阅、禁止复制、禁止导出。
  - 敏感性标签：公开、内部、机密、受限等标签展示。
  - 授权状态：免费版、企业版、授权过期、功能受限。
  - 管理员策略：强制隐藏版权、禁用全屏、禁用演示、固定语言、固定主题。
  - 白标配置：替换品牌文案、隐藏 Powered by、控制底部栏项显隐。
  - 审计提示：导出受限、复制受限、外链受限、数据保留策略提示。
- 前置任务：
  - [ ] 设计 tenant policy / entitlement / sensitivity label 的输入边界。
  - [ ] 确认哪些能力由 SDK 本地显示，哪些必须由服务端或宿主应用裁决。
  - [ ] 明确 license 包与 UI 状态栏之间不直接泄露授权 token。
- 验收标准：
  - [ ] 企业状态只显示宿主明确传入的数据，不在 UI 包中猜测权限。
  - [ ] 管理员策略可控制底部栏显示项和危险操作入口。
  - [ ] 授权、权限、敏感性标签均有可访问文本和 diagnostics 记录。

### JW-ROADMAP-018：底部 Support Bundle 与 diagnostics 入口

- 类型：feature / support / diagnostics
- 优先级：P2
- 状态：Backlog
- 背景：当前 core、devtools 和 SDK 文档已有 diagnostics / support bundle 基础，但用户遇到兼容、布局、协作或导入导出问题时，需要更清晰的入口收集隐私裁剪后的诊断信息。
- 范围：
  - 底部状态栏显示 diagnostics 状态：正常、存在警告、存在错误。
  - 点击打开 diagnostics 摘要或触发 support bundle 导出。
  - 支持显示当前浏览器、包版本、启用能力、layout metrics、最近错误码。
  - 不包含正文、选中文本或敏感文档内容。
- 前置任务：
  - [ ] 对齐 `editor.exportDiagnostics()`、devtools 面板和 SDK support bundle 文档。
  - [ ] 定义状态栏只显示摘要，详细导出仍走独立动作。
- 验收标准：
  - [ ] 用户可从底部栏发现 diagnostics 状态。
  - [ ] 导出内容继续满足隐私裁剪边界。
  - [ ] 错误状态可被测试稳定断言。

### JW-ROADMAP-019：底部 AI 助手入口研究

- 类型：research / ai / product
- 优先级：P3
- 状态：Backlog
- 背景：Google Docs 已有 Gemini 底部栏形态，企业文档编辑器后续可能需要 AI 写作、改写、摘要或审阅助手。但这类能力涉及模型接入、隐私、权限、审计和产品收费，不应混入状态栏 MVP。
- 范围：
  - 底部 AI 助手入口、浮动输入框、侧栏模式切换。
  - 文档上下文选择、选区改写、全文摘要、批注建议。
  - 企业隐私、模型供应商、审计、禁用策略。
- 验收标准：
  - [ ] 输出独立 PRD 或研究报告。
  - [ ] 明确 AI 助手与普通状态栏的 UI 边界。
  - [ ] 不影响状态栏 MVP 的实现节奏。
