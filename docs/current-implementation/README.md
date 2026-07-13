# JWord 当前实现摘要索引

> 快照日期：2026-07-09。本文档集记录当前仓库真实代码、package manifest、示例工程和现有验收入口，不把旧需求、计划或报告当作已实现事实。

## 使用方式

- 查看包能力：进入 `docs/current-implementation/packages/`。
- 查看示例用途和启动方式：进入 `docs/current-implementation/examples/`。
- 查看未完成事项和后续路线图：进入 [backlog.md](backlog.md)。
- 查看工程约束审计：[engineering-constraints.md](engineering-constraints.md)。
- 查看插件/观测 API 稳定性评审：[api-stability-review.md](api-stability-review.md)。
- 查看基础验证记录：[verification-2026-07-07.md](verification-2026-07-07.md)。
- 查看发布元数据审计：[release-metadata-audit.md](release-metadata-audit.md)。
- 查看历史验证摘要：[historical-verification-summary.md](historical-verification-summary.md)。
- 查看屏幕阅读器人工验证方法：[screen-reader-manual-verification.md](screen-reader-manual-verification.md)。
- 查看 2026-07-10 全项目审查：[reviews/2026-07-10-full-review/README.md](reviews/2026-07-10-full-review/README.md)。
- 查看一级 OEM 功能授权与开放文档访问实施方案：[oem-licensing-open-access-implementation-plan.md](oem-licensing-open-access-implementation-plan.md)。
- 查看底部状态栏首批实施方案：[status-bar-mvp-implementation-plan.md](status-bar-mvp-implementation-plan.md)。
- 查看顶部工具栏双模式实施方案：[toolbar-modes-implementation-plan.md](toolbar-modes-implementation-plan.md)。
- 查看页面水印与版权防篡改实施方案：[watermark-and-brand-protection-implementation-plan.md](watermark-and-brand-protection-implementation-plan.md)。
- 查看左右浮动工作区、Toast、调试日志与 i18n 治理方案：[editor-workspaces-toast-debug-i18n-implementation-plan.md](editor-workspaces-toast-debug-i18n-implementation-plan.md)。
- 做代码审查时，优先按每篇文档的“关键源码入口”和“主要测试/验收入口”回到源码核对。
- 后续如果删除旧需求/实施计划文档，这组文档应继续保留，作为“当前实现事实”的入口。

## packages

- [core](packages/core.md)：框架无关编辑器内核、文档模型、事务、布局、渲染、协作桥接、插件与 diagnostics。
- [ui](packages/ui.md)：官方 DOM UI、toolbar、底部状态栏、面板、粘贴、只读、主题/i18n、a11y。
- [native](packages/native.md)：免费 `.jword` 原生包保存、打开、校验、迁移、worker。
- [docx](packages/docx.md)：DOCX 导入/导出、OPC/OOXML、roundtrip、worker、插件 adapter。
- [pdf](packages/pdf.md)：从 core layout 导出 PDF、字体、图片、PDF.js visual report、worker。
- [collab](packages/collab.md)：协同客户端 SDK、provider adapter、awareness、history/offline、auto-insert。
- [collab-server](packages/collab-server.md)：协同 HTTP/WS server、history service、Hocuspocus server、权限 hooks。
- [persistence](packages/persistence.md)：Yjs update log、snapshot、版本预览/恢复、IndexedDB offline adapter。
- [license](packages/license.md)：商业能力 entitlement、JWL1 token、本地授权校验。
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
- [免费 Quickstart](sdk/quickstart.md)：core + ui + native 的最小接入。
- [.jword 原生格式](sdk/jword-format.md)：native package entries、schema、checksum、worker。
- [DOCX/PDF 高级格式](sdk/advanced-formats.md)：docx/pdf worker、授权边界和兼容限制。
- [协作客户端](sdk/collaboration.md)：client SDK、provider adapter、history/offline/auto-insert。
- [协作服务端](sdk/collab-server.md)：self-host server、HTTP/WS、hooks、history service。
- [授权与收费能力](sdk/licensing.md)：feature keys、JWL1 token、enforcement 位置。
- [诊断码与 support bundle](sdk/diagnostics-and-support.md)：diagnostics registry、隐私裁剪、导出边界。
- [浏览器支持与稳定矩阵](sdk/browser-and-e2e.md)：最低浏览器版本、窄屏边界、发布前矩阵。
- [迁移与兼容策略](sdk/migration.md)：semver、schema、protocol、license contract。

## 当前边界

- 所有包的 `package.json` 当前均为 `private: true`；本文档描述实现能力，不等同于已经完成 registry 发布。
- 本文档集只描述当前真实实现、当前验证入口和当前 backlog；不依赖历史实施资料。
- 这些摘要不是测试结果；验收状态仍应以实际运行对应命令为准。
