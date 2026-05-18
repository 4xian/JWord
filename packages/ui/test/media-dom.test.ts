/**
 * @vitest-environment jsdom
 *
 * 职责：锁定 toolbar 图片入口复用统一的紧凑下拉菜单类名，避免视觉密度再次偏离其他 select。
 * 边界：只覆盖 media DOM 结构，不验证 controller 事件或上传流程。
 * 协作：packages/ui/src/media/dom.ts 与 packages/ui/src/styles/toolbar.css。
 */

import { describe, expect, test } from 'vitest'
import { createMediaPanelDom, destroyMediaPanel } from '../src/media/dom'

describe('media panel dom', () => {
  test('reuses compact toolbar menu classes for image actions', () => {
    const host = document.createElement('div')
    const dom = createMediaPanelDom(host, '图片')

    try {
      expect(dom.menu.classList.contains('jw-toolbar__select-menu')).toBe(true)
      expect(dom.fileActionButton.classList.contains('jw-toolbar__select-option')).toBe(true)
      expect(dom.urlActionButton.classList.contains('jw-toolbar__select-option')).toBe(true)
    } finally {
      destroyMediaPanel(dom)
    }
  })
})
