/**
 * @vitest-environment jsdom
 *
 * 职责：验证中立 location 跳转 API 只滚动已挂载编辑器容器。
 * 边界：只覆盖 core facade 的 mounted scroll 行为，不测试 UI 包、provider 或浏览器用户事件。
 * 协作模块：location API、layout rect 和 mounted canvas container 共同完成普通编辑器跳转。
 * 性能/安全约束：测试不访问网络或真实文件，不把 DOM Range、canvas 坐标或 provider 状态暴露为公开返回值。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'

describe('editor location scroll API', () => {
  it('scrolls the mounted canvas container to a public query result without changing selection', () => {
    const host = document.createElement('div')
    host.style.width = '720px'
    host.style.height = '320px'
    document.body.append(host)

    const editor = createEditor({
      initialText: [
        'first line',
        '',
        'middle line',
        '',
        'target paragraph for location jump'
      ].join('\n'),
      page: {
        heightTwips: 2400,
        widthTwips: 2400,
        marginTwips: {
          top: 120,
          right: 120,
          bottom: 120,
          left: 120
        },
        scale: 0.2
      }
    })

    editor.mount(host)

    const canvasContainer = host.querySelector<HTMLElement>('[data-jword-canvas-container]')!
    const queryResult = editor.findTextLocations({ kind: 'text', text: 'target paragraph' })[0]!
    const beforeSelection = editor.readSelectionSnapshot()
    const didScroll = editor.scrollToLocation(queryResult)

    expect(didScroll).toBe(true)
    expect(canvasContainer.scrollTop).toBeGreaterThan(0)
    expect(editor.readSelectionSnapshot()).toEqual(beforeSelection)
    expect(JSON.stringify(editor.resolveLocation(queryResult))).not.toMatch(
      /RelativePosition|Yjs|Y\\.Text|document-store|DocumentStore|DOM Range|LayoutRect|canvas|provider|scrollTop/iu
    )

    editor.destroy()
    host.remove()
  })
})
