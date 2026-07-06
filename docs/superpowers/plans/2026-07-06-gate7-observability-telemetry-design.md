# Gate 7 Observability / Error Boundary / Telemetry 前置设计（2026-07-06）

## 1. 背景与目标

来源：`2026-07-02-gate7-review.md` R3 补充、`2026-07-02-plan-review.md` §3.20、修复计划 Phase 6 `[gate7 R3] Observability/error boundary/telemetry 子任务`。

目标是把观测能力从差距表提升为可执行 contract：

1. telemetry 默认关闭，只能由宿主显式 opt-in。
2. 插件异常继续隔离，不破坏 editor transaction / render path。
3. diagnostics export 必须可复制、可归档，且不包含文档正文。
4. wrapper error boundary 先冻结设计 seam，React/Vue wrapper 正式实现留 Gate 7 wrapper 条目。
5. 本项不实现 Gate 7 R2 的错误码单一真源生成管线；错误码 registry 仍是后续独立任务。

## 2. 当前落点

| 能力 | 落点 | 状态 |
|---|---|---|
| Telemetry opt-in | `EditorOptions.telemetry.sink` | 已落地，默认关闭 |
| Telemetry event schema | `JWordTelemetryEvent` / `JWordPluginDiagnosticTelemetryEvent` | 已落地，当前仅开放 `plugin.diagnostic` |
| Diagnostics export | `Editor.exportDiagnostics()` / `JWordDiagnosticsSnapshot` | 已落地，导出隐私裁剪快照 |
| Privacy redaction | `packages/core/src/editor/observability.ts` | 已落地，字符串值与 details key 全部裁剪 |
| Plugin error isolation | `PluginHost.reportDiagnostic()` + 既有 `PLUGIN_CALLBACK_FAILED` | 已复用并接入 telemetry |
| Wrapper error boundary | 本设计 §5 | 设计冻结，代码留 Gate 7 wrapper 项 |

## 3. O1：事件 schema 与隐私裁剪

`JWordTelemetryEvent` 采用 discriminated union。当前 Phase 6 只发送：

```ts
type JWordTelemetryEvent = JWordPluginDiagnosticTelemetryEvent

interface JWordPluginDiagnosticTelemetryEvent {
  readonly kind: 'plugin.diagnostic'
  readonly timestamp: string
  readonly pluginName: string
  readonly code: PluginDiagnosticCode
  readonly lifecycle?: PluginDiagnostic['lifecycle']
  readonly commandName?: string
  readonly reasonCode?: string
  readonly recoverable: boolean
  readonly details?: JWordErrorDetails
}
```

隐私规则：

- telemetry event 不包含 `PluginDiagnostic.message`，因为该字段可能来自插件异常 message，可能包含正文片段。
- `details` 内所有字符串值替换为 `[redacted]`。
- `details` 对象 key 不保留原名，统一转为 `field0`、`field1`，避免插件把正文放进 key。
- 数字、布尔、`null` 保留；数组递归裁剪。
- 不导出 `projection`、`Document`、run text、paragraph text、selection 文本片段或资源二进制。

## 4. O2/O3：diagnostics export 与 telemetry 默认关闭

`EditorOptions.telemetry` 默认未定义；不提供 `sink` 时，core 不发送任何 telemetry。

宿主 opt-in：

```ts
const editor = createEditor({
  telemetry: {
    sink(event) {
      sendToHost(event)
    }
  }
})
```

`PluginHost` 在诊断入队后调用 sink；sink 抛错会被吞掉，不能递归生成诊断，也不能影响 editor。

`Editor.exportDiagnostics()` 返回：

```ts
interface JWordDiagnosticsSnapshot {
  readonly generatedAt: string
  readonly privacy: {
    readonly contentIncluded: false
    readonly stringValues: 'redacted'
    readonly detailKeys: 'redacted'
  }
  readonly plugins: readonly JWordDiagnosticsPluginEntry[]
}
```

`exportDiagnostics()` 是给宿主下载/上报的安全快照；`getPluginDiagnostics()` 仍保留原始运行时诊断，供本地 UI 即时显示和调试使用。

## 5. O4：wrapper error boundary 设计 seam

React/Vue wrapper 尚未实现，本项不创建 wrapper 包。后续 Gate 7 wrapper 项必须遵守以下 seam：

1. wrapper 捕获范围只包含 wrapper 自身的 render/mount/update/dispose 错误，不捕获业务页面全局错误。
2. wrapper 捕获错误后可读取 `editor.exportDiagnostics()` 作为安全附件，禁止把 children、props 中的正文、DOM `innerText` 或 document model 直接塞入上报。
3. wrapper 级 telemetry 事件后续扩展为 `wrapper.error`，字段只允许：`packageName`、`framework`、`phase`、`recoverable`、`diagnosticsSnapshot`、裁剪后的 details。
4. wrapper boundary 不自动销毁 editor；是否展示 fallback UI 由 wrapper 组件 props 决定。
5. React StrictMode 双挂载下，boundary 的 telemetry sink 需幂等；Vue SSR 空壳不得访问 DOM。

## 6. O5：验收测试

已落地的 focused tests：

- `packages/core/test/editor/observability.test.ts`
  - opt-in telemetry 只发送隐私裁剪后的 `plugin.diagnostic`。
  - `Editor.exportDiagnostics()` 不包含文档正文、插件 message 或 details key。
- 复用 `packages/core/test/editor/plugin-runtime.test.ts`
  - 插件 command / lifecycle / decoration 抛错隔离为 `PLUGIN_CALLBACK_FAILED`，不破坏事务与渲染。
- `tests/architecture/gate7-public-api-catalog.test.ts`
  - public API catalog 与根入口导出保持一致。

## 7. 后续非本项范围

1. Gate 7 R2 错误码单一真源生成管线：仍按修复计划独立执行。
2. React/Vue wrapper 真实 error boundary 组件：留 `[gate7 2.2/2.3/2.4]` wrapper 详细设计与实现。
3. Devtools diagnostics 面板与下载按钮：留 Gate 7 devtools 条目。
4. telemetry 网络 SDK、采样、批量发送、重试策略：不进入 core；宿主自行实现 sink。
