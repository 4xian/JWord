/**
 * @vitest-environment jsdom
 *
 * 职责：验证单 Host EditorShell 的默认结构与统一销毁契约。
 * 边界：只通过 @4xian/jword-ui 公开入口和稳定 data attribute 断言，不读取内部 controller。
 * 协作：packages/ui/src/editor-shell.ts、createJWordUi 与 core editor mount 生命周期。
 * 约束：默认根元素只包含 toolbar、editor、status bar 三个直属区域，销毁必须幂等。
 */

import { describe, expect, test } from 'vitest'

import { createJWord } from '../src/index'

describe('createJWord EditorShell', () => {
  test('只传一个空根元素即可创建上中下结构并统一销毁', () => {
    const host = document.createElement('div')

    document.body.append(host)

    const jword = createJWord({
      host,
      editor: { initialText: 'abcdef' }
    })
    const selection = jword.editor.getSelection()

    expect(host.getAttribute('data-jword-editor-shell')).toBe('true')
    expect(Array.from(host.children).map((element) => element.getAttribute('data-jword-shell-region'))).toEqual([
      'toolbar',
      'editor',
      'status-bar'
    ])
    expect(host.querySelector('[data-jword-editor]')).not.toBeNull()
    expect(host.querySelector('[data-jword-shell-live-region-host]')).toBeNull()
    expect(host.querySelector('[data-jword-shell-text-mirror-host]')).toBeNull()
    expect(jword.ui.elements.commentsPanel).not.toBeNull()
    expect(jword.ui.elements.linkPanel).not.toBeNull()
    expect(jword.ui.elements.headerFooterPanel).not.toBeNull()
    expect(jword.ui.elements.headingOutlinePanel).not.toBeNull()
    expect(jword.ui.elements.findReplacePanel).not.toBeNull()
    expect(jword.ui.elements.revisionsPanel).not.toBeNull()
    expect(host.querySelector('[data-jword-shell-region="editor"] > [data-jword-side-workspace="left"]')).not.toBeNull()
    expect(host.querySelector('[data-jword-shell-region="editor"] > [data-jword-side-workspace="right"]')).not.toBeNull()
    expect(host.querySelector('[data-jword-editor] [data-jword-side-workspace]')).toBeNull()
    expect(document.activeElement).toBe(host.querySelector('[data-jword-hidden-textarea]'))
    expect(selection).not.toBeNull()
    expect(selection === null ? null : jword.editor.resolveTextPosition(selection.focus).graphemeIndex).toBe(6)

    jword.destroy()
    jword.destroy()

    expect(host.children).toHaveLength(0)
    expect(host.hasAttribute('data-jword-editor-shell')).toBe(false)
    host.remove()
  })

  test('只自动装配工具栏配置中可见工具依赖的面板能力', () => {
    const host = document.createElement('div')

    document.body.append(host)

    const jword = createJWord({
      host,
      ui: {
        toolbar: {
          mode: 'common',
          modeSwitcher: false,
          visibleTools: ['insert.link']
        }
      }
    })

    expect(jword.ui.elements.linkPanel).not.toBeNull()
    expect(jword.ui.elements.commentsPanel).toBeNull()
    expect(jword.ui.elements.headerFooterPanel).toBeNull()
    expect(jword.ui.elements.headingOutlinePanel).toBeNull()
    expect(jword.ui.elements.findReplacePanel).toBeNull()
    expect(jword.ui.elements.revisionsPanel).toBeNull()

    jword.destroy()
    host.remove()
  })

  test('显式配置首次聚焦位置为文档头部', () => {
    const host = document.createElement('div')

    document.body.append(host)

    const jword = createJWord({
      host,
      editor: {
        initialText: 'abcdef',
        initialFocusPosition: 'start'
      }
    })
    const selection = jword.editor.getSelection()

    expect(document.activeElement).toBe(host.querySelector('[data-jword-hidden-textarea]'))
    expect(selection).not.toBeNull()
    expect(selection === null ? null : jword.editor.resolveTextPosition(selection.focus).graphemeIndex).toBe(0)

    jword.destroy()
    host.remove()
  })

  test('构造失败时清理已创建内容并恢复根元素布局', () => {
    const host = document.createElement('div')

    host.style.display = 'block'
    document.body.append(host)

    expect(() => createJWord({
      host,
      ui: {
        /** 模拟 editor 已挂载后读取 UI 配置失败。 */
        get theme(): never {
          throw new Error('editor shell construction failed')
        }
      }
    })).toThrow('editor shell construction failed')
    expect(host.children).toHaveLength(0)
    expect(host.style.display).toBe('block')
    expect(host.hasAttribute('data-jword-editor-shell')).toBe(false)
    host.remove()
  })

  test('UI 深层装配失败时回滚 toolbar 监听与辅助资源', () => {
    const host = document.createElement('div')
    const registeredSignals: Array<{ readonly type: string, readonly signal: AbortSignal }> = []
    const addEventListener = document.addEventListener.bind(document)

    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (typeof options === 'object' && options.signal !== undefined) {
        registeredSignals.push({ type, signal: options.signal })
      }

      addEventListener(type, listener, options)
    }) as typeof document.addEventListener

    document.body.append(host)

    try {
      expect(() => createJWord({
        host,
        ui: {
          pluginExtensions: [{
            pluginName: 'editor-shell.failure',
            toolbarItems: [{
              name: 'failure',
              kind: 'button',
              label: '故障注入',
              commandName: 'editor-shell.failure',
              /** 在 toolbar 首次刷新时模拟深层 UI 装配失败。 */
              enabled(): never {
                throw new Error('editor shell toolbar construction failed')
              }
            }]
          }]
        }
      })).toThrow('editor shell toolbar construction failed')
      expect(host.children).toHaveLength(0)
      expect(document.querySelector('[data-jword-plugin-toolbar-host]')).toBeNull()
      expect(host.hasAttribute('data-jword-editor-shell')).toBe(false)
      expect(registeredSignals.length).toBeGreaterThan(0)
      expect(registeredSignals
        .filter((entry) => !entry.signal.aborted)
        .map((entry) => entry.type)).toEqual([])
    } finally {
      document.addEventListener = addEventListener
      host.remove()
    }
  })

  test('toolbar 完成后其它 UI 装配失败仍回滚既有资源', () => {
    const host = document.createElement('div')
    const registeredSignals: Array<{ readonly type: string, readonly signal: AbortSignal }> = []
    const addEventListener = document.addEventListener.bind(document)
    const append = HTMLElement.prototype.append

    /** 在 link panel 写入内部 editor 区域时模拟后置 UI 装配失败。 */
    HTMLElement.prototype.append = function (...nodes: (Node | string)[]): void {
      const linkPanel = nodes.find((node) => node instanceof HTMLElement && node.matches('[data-jword-link-panel]'))

      if (this.matches('[data-jword-shell-region="editor"]') && linkPanel !== undefined) {
        throw new Error('editor shell late ui construction failed')
      }

      Reflect.apply(append, this, nodes)
    }

    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (typeof options === 'object' && options.signal !== undefined) {
        registeredSignals.push({ type, signal: options.signal })
      }

      addEventListener(type, listener, options)
    }) as typeof document.addEventListener

    document.body.append(host)

    try {
      expect(() => createJWord({
        host,
        ui: {
          link: {}
        }
      })).toThrow('editor shell late ui construction failed')
      expect(host.children).toHaveLength(0)
      expect(host.hasAttribute('data-jword-editor-shell')).toBe(false)
      expect(registeredSignals.length).toBeGreaterThan(0)
      expect(registeredSignals
        .filter((entry) => !entry.signal.aborted)
        .map((entry) => entry.type)).toEqual([])
    } finally {
      HTMLElement.prototype.append = append
      document.addEventListener = addEventListener
      host.remove()
    }
  })

  test('高级 slots 优先接管外置面板和全屏宿主', async () => {
    const host = document.createElement('div')
    const comments = document.createElement('div')
    const outline = document.createElement('div')
    const fullscreen = document.createElement('div')
    let fullscreenRequested = false

    Object.defineProperty(fullscreen, 'requestFullscreen', {
      configurable: true,
      value: async () => {
        fullscreenRequested = true
      }
    })
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: async () => {}
    })

    document.body.append(host, comments, outline, fullscreen)

    const jword = createJWord({
      host,
      slots: {
        comments,
        outline,
        fullscreen
      },
      ui: {
        theme: { name: 'dark' },
        comments: true,
        headingOutline: {},
        link: {},
        headerFooter: {},
        findReplace: {},
        revisions: {}
      }
    })
    const editorHost = host.querySelector<HTMLElement>('[data-jword-shell-region="editor"]')

    expect(jword.ui.elements.commentsPanel?.root.parentElement).toBe(comments)
    expect(jword.ui.elements.headingOutlinePanel?.host).toBe(outline)
    expect(editorHost?.contains(jword.ui.elements.linkPanel?.host ?? null)).toBe(true)
    expect(editorHost?.contains(jword.ui.elements.headerFooterPanel?.root ?? null)).toBe(true)
    expect(editorHost?.contains(jword.ui.elements.findReplacePanel?.root ?? null)).toBe(true)
    expect(editorHost?.contains(jword.ui.elements.revisionsPanel?.root ?? null)).toBe(true)
    expect(comments.getAttribute('data-theme')).toBe('dark')
    expect(outline.getAttribute('data-theme')).toBe('dark')
    expect(editorHost?.getAttribute('data-theme')).toBe('dark')
    expect(jword.ui.elements.statusBar?.root.closest('[data-jword-shell-region="status-bar"]')).not.toBeNull()
    jword.ui.elements.statusBar?.controls.fullscreen?.click()
    await Promise.resolve()
    expect(fullscreenRequested).toBe(true)

    jword.destroy()

    expect(comments.children).toHaveLength(0)
    expect(outline.children).toHaveLength(0)
    expect(comments.getAttribute('data-theme')).toBeNull()
    expect(outline.getAttribute('data-theme')).toBeNull()
    document.body.replaceChildren()
  })
})
