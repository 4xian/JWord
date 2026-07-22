# JWord 当前实现与整改索引

> 本文档集只提供当前实现事实、binding 决策、当前问题和整改路线；计划或报告不能覆盖当前源码与可复跑验证。

## 当前权威入口

- 查看当前代码能力：进入 `packages/`、`examples/`、`sdk/`。
- 查看当前审查、问题台账和阶段路线：[reviews/current-full-review/README.md](reviews/current-full-review/README.md)。
- 查看明确的第一步、下一步和阶段退出标准：[统一整改路线](reviews/current-full-review/09-remediation-roadmap.md)。
- 查看产品、商业与法律批准状态：[OEM License Phase 0 决策记录](oem-licensing-phase0-decision-record.md)。
- 查看 JWL2、License runtime 和 OEM 专项技术设计：[OEM 实施方案](oem-licensing-open-access-implementation-plan.md)。
- 查看当前问题之外的人工验证与未来能力：[backlog.md](backlog.md)。

## 当前支持文档

- [发布元数据审计](release-metadata-audit.md)
- [LIC-107B2 最低浏览器人工验证](license-minimum-browser-manual-verification.md)
- [屏幕阅读器人工验证](screen-reader-manual-verification.md)

## 文档维护规则

- 新增 package 时，先补 export map，再同步 package 摘要、公开 API 文档、类型测试和 release dry-run 清单。
- 新增公开 API 时，先确定 stable、experimental 或 internal 分级，再同步 SDK 文档、类型测试和 export audit。
- 新增诊断码时，先修改 `fixtures/collab/diagnostics-registry.json`，再运行生成脚本并更新 SDK 文档。
- 新增或调整页面元素、工具栏、状态栏、弹窗、下拉菜单、按钮、图标、提示、可见文案或可见样式时，必须同步评估 i18n 与主题切换影响；若有影响，需补齐 `zh-CN` / `en-US` 语言数据、aria/live region 文案，以及亮色/暗色主题下的颜色、背景、hover、focus、disabled、overlay 等样式。
- 新增或调整跨层 diagnostic 时，runtime、worker、server 和协议只返回语言无关的稳定 code 与必要结构化字段，不把中文或英文文案固化为协议契约；UI、wrapper 或宿主展示层负责按 locale 映射用户可见文案，并同步覆盖 tooltip、aria-label 与 live region。诊断真源和阶段验收入口分别见 [诊断码与 support bundle](sdk/diagnostics-and-support.md) 和 [当前验证计划](reviews/current-full-review/10-verification-plan.md)。
- 新增工程约束时，必须指向当前源码、manifest、脚本、测试或 SDK 文档；没有证据的约束进入 backlog，不写成已满足事实。

## packages

- [core](packages/core.md)：框架无关编辑器内核、文档模型、事务、布局、渲染、协作桥接、插件与 diagnostics。
- [ui](packages/ui.md)：官方 DOM UI、toolbar、底部状态栏、面板、粘贴、只读、主题/i18n、a11y。
- [native](packages/native.md)：`.jword` 原生包保存、打开、校验、迁移、worker。
- [docx](packages/docx.md)：DOCX 导入/导出、OPC/OOXML、roundtrip、worker、插件 adapter。
- [pdf](packages/pdf.md)：从 core layout 导出 PDF、字体、图片、PDF.js visual report、worker。
- [collab](packages/collab.md)：协同客户端 SDK、provider adapter、awareness、history/offline、auto-insert。
- [collab-server](packages/collab-server.md)：协同 HTTP/WS server、history service、Hocuspocus server、权限 hooks。
- [persistence](packages/persistence.md)：Yjs update log、snapshot、版本预览/恢复、IndexedDB offline adapter。
- [license](packages/license.md)：JWL2 固定 trust 验签、公开激活、opaque handle、旧 entitlement 兼容和当前 fail-closed 边界。
- [devtools](packages/devtools.md)：opt-in diagnostics 浮动面板。
- [react](packages/react.md)：React wrapper、SSR 空壳、生命周期、ref/context。
- [vue](packages/vue.md)：Vue wrapper、SSR 空壳、生命周期、provide/inject。

## examples

- [vanilla](examples/vanilla.md)：基础 DOM demo，覆盖 core + ui + native + devtools。
- [collab](examples/collab.md)：协同 demo，覆盖内存 provider、Hocuspocus、本地服务、history/offline/auto-insert。
- [docx](examples/docx.md)：DOCX/PDF demo，覆盖导入、导出、roundtrip、worker、授权状态。
- [react](examples/react.md)：React wrapper smoke demo。
- [vue](examples/vue.md)：Vue 3 wrapper smoke demo。
- [vue2](examples/vue2.md)：Vue 2 直接集成 demo，组合 core + ui + native。

## SDK 文档

- [SDK 文档索引](sdk/README.md)：记录 `docs/sdk` 与真实代码/测试入口的对应关系。
- [公开 API 与导入边界](sdk/public-api.md)：package export map、stable/experimental/internal 分级、类型测试和 no-alias smoke。
- [基础 Quickstart](sdk/quickstart.md)：core + ui + native 的最小接入。
- [.jword 原生格式](sdk/jword-format.md)：native package entries、schema、checksum、worker。
- [DOCX/PDF 高级格式](sdk/advanced-formats.md)：docx/pdf worker、授权边界和兼容限制。
- [协作客户端](sdk/collaboration.md)：client SDK、provider adapter、history/offline/auto-insert。
- [协作服务端](sdk/collab-server.md)：self-host server、HTTP/WS、hooks、history service。
- [授权与收费能力](sdk/licensing.md)：module feature、JWL2 激活/handle、旧 entitlement 和 enforcement 迁移边界。
- [诊断码与 support bundle](sdk/diagnostics-and-support.md)：diagnostics registry、隐私裁剪、导出边界。
- [浏览器支持与稳定矩阵](sdk/browser-and-e2e.md)：最低浏览器版本、窄屏边界、发布前矩阵。
- [迁移与兼容策略](sdk/migration.md)：semver、schema、protocol、license contract。

## 当前边界

- 所有包的 `package.json` 当前均为 `private: true`；本文档描述实现能力，不等同于已经完成 registry 发布。
- 本文档集只描述当前真实实现、当前验证入口和当前 backlog。
- 这些摘要不是测试结果；验收状态仍应以实际运行对应命令为准。
