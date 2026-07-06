/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 7 R3 observability 最小公开 seam。
 * 边界：只通过 createEditor、Editor facade、telemetry sink 和 diagnostics export 观察行为。
 * 协作模块：editor runtime、plugin host、插件诊断和隐私裁剪契约。
 * 性能/安全约束：telemetry 默认由宿主 opt-in，diagnostics export 不包含文档正文或插件私有字符串。
 * Specs：docs/superpowers/plans/2026-07-06-gate7-observability-telemetry-design.md。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'
import type { JWordTelemetryEvent, PluginDefinition } from '../../src/index'

describe('Gate 7 R3 observability contract', () => {
  it('opt-in telemetry 只发送隐私裁剪后的插件诊断事件', () => {
    const secret = '客户合同正文-禁止外传'
    const telemetryEvents: JWordTelemetryEvent[] = []
    const plugins: readonly PluginDefinition[] = [{
      name: 'privacy.throwing-command',
      version: '1.0.0',
      setup(context) {
        context.registerCommand({
          name: 'privacy.throw',
          execute() {
            throw new Error(secret)
          }
        })
      }
    }]
    const editor = createEditor({
      initialText: secret,
      telemetry: {
        sink(event) {
          telemetryEvents.push(event)
        }
      },
      plugins
    })

    editor.executePluginCommand('privacy.throw')

    expect(telemetryEvents).toHaveLength(1)
    expect(telemetryEvents[0]).toEqual(expect.objectContaining({
      kind: 'plugin.diagnostic',
      pluginName: 'privacy.throwing-command',
      code: 'PLUGIN_CALLBACK_FAILED',
      lifecycle: 'command',
      commandName: 'privacy.throw',
      recoverable: true
    }))
    expect(JSON.stringify(telemetryEvents)).not.toContain(secret)
    expect(JSON.stringify(telemetryEvents)).toContain('[redacted]')

    editor.destroy()
  })

  it('diagnostics export 不包含文档正文或插件 details 字符串', () => {
    const secret = '客户合同正文-禁止外传'
    const plugins: readonly PluginDefinition[] = [{
      name: 'privacy.diagnostics',
      version: '1.0.0',
      setup(context) {
        context.diagnostics.report({
          message: `插件诊断包含 ${secret}`,
          details: {
            documentText: secret,
            count: 1
          }
        })
      }
    }]
    const editor = createEditor({
      initialText: secret,
      plugins
    })

    const snapshot = editor.exportDiagnostics()
    const serialized = JSON.stringify(snapshot)

    expect(snapshot.privacy.contentIncluded).toBe(false)
    expect(snapshot.registry.source).toBe('fixtures/collab/diagnostics-registry.json')
    expect(snapshot.registry.codeCount).toBeGreaterThan(100)
    expect(snapshot.plugins).toContainEqual(expect.objectContaining({
      pluginName: 'privacy.diagnostics',
      code: 'PLUGIN_CALLBACK_FAILED',
      recoverable: true
    }))
    expect(serialized).not.toContain(secret)
    expect(serialized).not.toContain('documentText')
    expect(serialized).toContain('[redacted]')

    editor.destroy()
  })
})
