# Plugin / decorations / observability API 稳定化评审

> 快照日期：2026-07-07。
> 本文对应 `JW-BACKLOG-004`。评审对象仅限当前源码和公开 SDK 文档中已经暴露的插件、装饰和观测接口。

## 结论

当前实现可用，但不应整体升为 1.0 stable：

- Plugin command、middleware、keybinding、adapter registry、lifecycle、diagnostics 已有实现和测试，但仍缺少版本迁移承诺、TSDoc 完整覆盖和第三方长期兼容策略。
- Decoration API 文件名和类型名已经明确带 `ExperimentalDecorationProvider`，当前只能作为 experimental 能力。
- Observability / telemetry 默认关闭、隐私裁剪已有测试，但事件 union 当前只有 `plugin.diagnostic`，后续扩展面尚未冻结，仍应保持 experimental。
- `Editor.exportDiagnostics()` 已具备当前可用实现和隐私测试；作为 support/devtools seam 可继续使用，但公开兼容级别仍保持 experimental，直到字段稳定策略和版本迁移规则补齐。

## 公开面分级

| 能力 | 当前公开入口 | 建议级别 | 依据 |
| --- | --- | --- | --- |
| 插件注册 | `EditorOptions.plugins`、`PluginDefinition`、`PluginContext` | experimental | 可用但 setup 生命周期、dispose 顺序和 API 版本策略尚未冻结。 |
| 插件命令 | `PluginCommandDefinition`、`Editor.executePluginCommand()` | experimental | 命令执行、拒绝、异常隔离已有测试；命令命名、输入 schema、长期兼容未冻结。 |
| 命令中间件 | `PluginCommandMiddleware`、`PluginCommandMiddlewareInput` | experimental | 可拒绝事务且不写文档；后续还需明确 middleware 顺序与迁移承诺。 |
| 插件快捷键 | `PluginKeyBindingDefinition`、`PluginKeyBindingPredicate` | experimental | 已接入 DOM keydown；组合键语法和平台差异仍需稳定文档。 |
| 生命周期监听 | `PluginLifecycleEventName`、`PluginLifecycleEventMap`、`PluginLifecycleListener` | experimental | mount / destroy / afterTransaction / error 可用；事件 payload 仍可能扩展。 |
| Adapter registry | `PluginAdapterRegistry` 与 resource / persistence / import / export / collabProvider slot | experimental | 已有注册、resolve、重复注册、异常隔离测试；跨包 adapter contract 仍需版本策略。 |
| Decoration provider | `ExperimentalDecorationProvider`、`PluginDecoration`、`PluginResolvedDecoration` | experimental | 类型名明确 experimental，只读 snapshot 和异常隔离已有测试，但渲染语义未冻结。 |
| Plugin diagnostics | `PluginDiagnostic`、`PluginDiagnosticCode`、`Editor.getPluginDiagnostics()` | experimental | 已纳入 diagnostics 和 telemetry；诊断码登记已有单一真源，但插件诊断载荷仍随 plugin API 演进。 |
| Telemetry sink | `EditorOptions.telemetry`、`JWordTelemetrySink`、`JWordTelemetryEvent` | experimental | 默认 opt-in 且 sink 异常不破坏编辑器；事件 union 尚未稳定。 |
| Diagnostics export | `Editor.exportDiagnostics()`、`JWordDiagnosticsSnapshot` | experimental | 隐私裁剪和字段存在性已有测试；support bundle 字段版本化策略需继续收口。 |

## 实现证据

| 证据类型 | 路径 | 覆盖内容 |
| --- | --- | --- |
| 公开导出 | `packages/core/src/index.ts` | 导出 plugin、adapter、decoration、telemetry、diagnostics 类型。 |
| 插件类型 | `packages/core/src/plugins/types.ts` | 定义 `PluginDefinition`、命令、中间件、快捷键、decoration、lifecycle、diagnostics。 |
| Adapter 类型 | `packages/core/src/plugins/adapter-types.ts` | 定义 `PluginAdapterRegistry` 和各 slot。 |
| 插件宿主 | `packages/core/src/plugins/host.ts` | 实现 setup、dispose、命令、middleware、keybinding、decoration、adapter、telemetry 错误隔离。 |
| Editor 入口 | `packages/core/src/editor/types.ts`、`packages/core/src/editor/facade-runtime.ts` | 暴露 `plugins`、`telemetry`、`executePluginCommand()`、`getPluginDiagnostics()`、`exportDiagnostics()`。 |
| Observability | `packages/core/src/editor/observability.ts` | 定义 telemetry event、diagnostics snapshot、隐私裁剪。 |
| 渲染接入 | `packages/core/src/editor/mounted-runtime.ts`、`packages/core/src/editor/rendering.ts`、`packages/core/src/canvas/renderer.ts` | 将 resolved decoration 输入渲染路径。 |
| 单测 | `packages/core/test/editor/plugin-runtime.test.ts` | 覆盖生命周期、命令拒绝、异常隔离、快捷键、decoration、adapter。 |
| 单测 | `packages/core/test/editor/observability.test.ts` | 覆盖 telemetry opt-in、diagnostics 隐私裁剪、summary 字段。 |
| 文档 | `docs/sdk/public-api.md` | 将 plugin、decoration、observability 标为 experimental。 |

## 错误隔离审计

| 场景 | 当前行为 | 证据 | 结论 |
| --- | --- | --- | --- |
| plugin setup 抛错 | 转成 plugin diagnostic 与 editor error event。 | `packages/core/src/plugins/host.ts`、`plugin-runtime.test.ts` | 已有隔离。 |
| command execute 抛错 | `executePluginCommand()` 返回 `undefined`，记录 diagnostic。 | `packages/core/src/plugins/host.ts` | 已有隔离。 |
| middleware 抛错 | 返回 rejected transaction result，不进入写入。 | `packages/core/src/plugins/host.ts`、`plugin-runtime.test.ts` | 已有隔离。 |
| keybinding predicate 抛错 | 不触发命令，记录 callback diagnostic。 | `packages/core/src/plugins/host.ts` | 已有隔离。 |
| decoration read 抛错 | 不阻断挂载/渲染，记录 decoration diagnostic。 | `plugin-runtime.test.ts` | 已有隔离。 |
| lifecycle listener 抛错 | 记录 callback diagnostic，已完成事务不回滚。 | `plugin-runtime.test.ts` | 已有隔离。 |
| telemetry sink 抛错 | 捕获并丢弃，不递归产生诊断。 | `packages/core/src/plugins/host.ts` | 已有隔离。 |

## 不升 stable 的原因

- 插件输入/输出 schema 未提供 semver 迁移承诺。
- decoration 渲染语义仍偏实现细节：颜色、overlay、page rect、viewport refresh reason 后续可能调整。
- telemetry event union 只有 `plugin.diagnostic`，后续如果加入 transaction、layout、worker、collab 事件，需要先定义版本策略。
- adapter registry 的跨包 slot 还没有面向第三方的完整示例和迁移约束。
- 当前测试足以说明“可用和错误隔离”，还不足以承诺“长期稳定不破坏”。

## 后续升 stable 前置条件

- [ ] 为 stable 候选类型补齐 TSDoc 和 SDK 示例。
- [ ] 为 plugin command input/output 定义推荐 schema 和命名规范。
- [ ] 为 telemetry event 增加事件版本字段或事件扩展策略。
- [ ] 为 diagnostics snapshot 字段定义新增、弃用和删除规则。
- [ ] 为 adapter registry 增加跨包第三方示例和类型测试。
- [ ] 明确 decorations 是继续 experimental，还是拆出 stable 的只读 highlight 子集。

## 文档口径

当前应保持：

- `docs/sdk/public-api.md`：plugin、decoration、observability/telemetry 继续列在 Experimental。
- `docs/current-implementation/packages/core.md`：说明能力已实现，但仍需稳定化审查，不写成 1.0 stable。
- `docs/current-implementation/packages/devtools.md`：devtools 只消费 diagnostics snapshot，不代表 telemetry 平台稳定。
