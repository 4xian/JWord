/**
 * @vitest-environment jsdom
 *
 * 职责：验证 JWord UI debug 日志默认静默、结构化来源和自定义 logger 接管。
 * 边界：只验证开发者诊断信息，不要求 debug message 参与 i18n。
 * 协作模块：EditorShell、UI logger、Toast 与 live region。
 * 约束：不记录正文、选区内容或其他用户数据。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createJWord, type JWordLogEntry } from '../src/index'

afterEach(() => {
  vi.restoreAllMocks()
  document.body.replaceChildren()
})

describe('createJWordUi debug logger', () => {
  test('debug 默认关闭且不会写入 console', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const host = document.createElement('div')

    document.body.append(host)
    const jword = createJWord({ host })

    jword.ui.toast({ message: '提示', type: 'warning', duration: 0 })
    jword.destroy()

    expect(consoleInfo).not.toHaveBeenCalled()
    expect(consoleWarn).not.toHaveBeenCalled()
  })

  test('debug 开启后由自定义 logger 接收稳定 scope 和 event', () => {
    const entries: JWordLogEntry[] = []
    const host = document.createElement('div')

    document.body.append(host)
    const jword = createJWord({
      host,
      editor: { initialText: '正文' },
      ui: {
        debug: {
          enabled: true,
          logger: {
            write(entry): void {
              entries.push(entry)
            }
          }
        }
      }
    })

    host.querySelector<HTMLButtonElement>('[data-jword-tool-id="insert.comment"]')?.click()
    jword.ui.setLocale('en-US')
    jword.ui.toast({ message: 'Host message', type: 'info', duration: 0 })
    jword.destroy()

    expect(entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ scope: 'ui', event: 'created' }),
      expect.objectContaining({ scope: 'comments', event: 'selection-required' }),
      expect.objectContaining({ scope: 'toast', event: 'show' }),
      expect.objectContaining({ scope: 'ui', event: 'locale-change' }),
      expect.objectContaining({ scope: 'ui', event: 'destroy' })
    ]))
    expect(entries.some((entry) => entry.details !== undefined && 'text' in entry.details)).toBe(false)
  })
})
