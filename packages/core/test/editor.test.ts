/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 0 最小 Editor facade 的浏览器生命周期。
 * 边界：只覆盖 create/mount/destroy，不进入 Gate 1 模型、事务或输入能力。
 * 协作模块：后续 examples/vanilla 和 UI 包通过公开 facade 挂载编辑器。
 * 性能/安全约束：DOM 创建必须延迟到 mount，destroy 必须移除自身 DOM。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md#45-模块边界。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../src/index'

describe('createEditor', () => {
  it('creates an editor without touching host DOM', () => {
    const host = document.createElement('div')

    const editor = createEditor()

    expect(host.childElementCount).toBe(0)
    editor.destroy()
  })
})

describe('Editor mount/destroy lifecycle', () => {
  it('mounts a recognizable editor shell and canvas container', () => {
    const host = document.createElement('div')
    const editor = createEditor({ label: 'Test document' })

    editor.mount(host)

    const shell = host.querySelector('[data-jword-editor]')
    const canvasContainer = host.querySelector('[data-jword-canvas-container]')

    expect(shell).toBeInstanceOf(HTMLElement)
    expect(shell?.getAttribute('aria-label')).toBe('Test document')
    expect(canvasContainer).toBeInstanceOf(HTMLElement)
    expect(shell?.contains(canvasContainer)).toBe(true)
  })

  it('rejects mounting an already mounted editor', () => {
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    const editor = createEditor()

    editor.mount(firstHost)

    expect(() => editor.mount(secondHost)).toThrow(/already mounted/i)
    expect(secondHost.childElementCount).toBe(0)
  })

  it('removes its own DOM on destroy and allows repeated destroy calls', () => {
    const host = document.createElement('div')
    const editor = createEditor()

    editor.mount(host)
    editor.destroy()
    editor.destroy()

    expect(host.childElementCount).toBe(0)
  })
})
