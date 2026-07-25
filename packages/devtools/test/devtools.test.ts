/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 7 Step 7.10 Devtools 面板只消费公开 editor diagnostics 并可幂等销毁。
 * 边界：不实现浏览器扩展，不读取 editor 内部 runtime 或 package src 子路径。
 * 协作模块：@4xian/jword-devtools、@4xian/jword-core Editor facade 和 diagnostics export schema。
 * 约束：Devtools 错误不得影响 editor，面板内容不得包含正文、token 或 license private key。
 */

import { createEditor } from '@4xian/jword-core'
import { describe, expect, it } from 'vitest'

import { attachJWordDevtools } from '../src/index'

describe('JWord devtools panel', () => {
  it('attaches a floating panel, renders diagnostics summaries and removes DOM on destroy', () => {
    const host = document.createElement('div')
    const editor = createEditor({ initialText: 'devtools secret text' })

    document.body.append(host)

    try {
      const devtools = attachJWordDevtools(editor, { host })
      const panel = host.querySelector<HTMLElement>('[data-jword-devtools-panel="true"]')

      expect(panel).not.toBeNull()
      expect(panel?.textContent).toContain('@4xian/jword-core')
      expect(panel?.textContent).toContain('diagnostics.export')
      expect(panel?.textContent).toContain('not-configured')
      expect(panel?.textContent).not.toContain('devtools secret text')

      editor.toggleBold()
      devtools.refresh()

      expect(panel?.textContent).toContain('transactionCount')

      devtools.destroy()
      expect(host.querySelector('[data-jword-devtools-panel="true"]')).toBeNull()
      editor.toggleItalic()
    } finally {
      editor.destroy()
      host.remove()
    }
  })
})
