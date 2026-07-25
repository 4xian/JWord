/**
 * @vitest-environment jsdom
 *
 * 职责：验证编辑器实例级水印 controller 的公开行为。
 * 边界：只测试 UI 水印层，不触碰 core 文档模型。
 * 协作模块：ui-lifecycle 与 toolbar 通过该 controller 设置/清除水印。
 * 性能/安全约束：测试 MutationObserver 恢复行为，避免依赖真实 canvas。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { afterEach, describe, expect, it } from 'vitest'

import { createWatermarkController } from '../src/watermark/controller'

/** 等待 MutationObserver 回调执行。 */
async function waitForMutationObserver(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

/** 等待周期完整性检查执行。 */
async function waitForIntegrityCheck(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 550))
  await waitForMutationObserver()
}

const cleanupControllers: Array<{ destroy(): void }> = []

describe('watermark controller', () => {
  afterEach(() => {
    for (const controller of cleanupControllers.splice(0)) {
      controller.destroy()
    }
  })

  it('设置、读取并清除多行用户水印', () => {
    const { editorHost, canvas, pages } = createWatermarkHost(2)
    const controller = createWatermarkController(editorHost)
    cleanupControllers.push(controller)

    controller.setWatermark({
      text: '内部资料\n禁止外传',
      fontSizePx: 32,
      color: '#ff0000'
    })

    const layer = pages[0]?.querySelector<HTMLElement>('[data-jword-watermark-layer="user"]') ?? null

    expect(layer).not.toBeNull()
    expect(layer?.parentElement).toBe(pages[0])
    expect(pages[0]?.style.position).toBe('relative')
    expect([...canvas.children].some((child) => child.getAttribute('data-jword-watermark-layer') === 'user')).toBe(false)
    expect(pages[1]?.querySelector('[data-jword-watermark-layer="user"]')).not.toBeNull()
    expect(controller.getWatermark()).toMatchObject({
      text: '内部资料\n禁止外传',
      fontSizePx: 32,
      color: '#ff0000'
    })
    expect(layer?.style.pointerEvents).toBe('none')
    controller.clearWatermark()
    expect(controller.getWatermark()).toBeNull()
    expect(canvas.querySelector('[data-jword-watermark-layer="user"]')).toBeNull()
    controller.destroy()
  })


  it('水印层属性、样式和外部 class 样式被篡改后会自动恢复', async () => {
    const { editorHost, pages } = createWatermarkHost(1)
    const style = document.createElement('style')
    const controller = createWatermarkController(editorHost)

    cleanupControllers.push(controller)
    style.textContent = '.tampered-watermark { display: none !important; opacity: 0 !important; }'
    document.head.append(style)
    controller.setWatermark({ text: '用户水印' })

    const layer = pages[0]?.querySelector<HTMLElement>('[data-jword-watermark-layer="user"]') ?? null

    expect(layer).not.toBeNull()
    if (layer === null) {
      throw new Error('测试水印层未创建')
    }

    layer.className = 'tampered-watermark'
    layer.setAttribute('data-jword-watermark-layer', 'tampered')
    layer.setAttribute('data-extra', 'tampered')
    layer.removeAttribute('aria-hidden')
    layer.style.cssText = 'display: none; visibility: hidden; opacity: 0; background-image: none; transform: scale(0);'
    await waitForIntegrityCheck()

    expect(layer.className).toBe('jw-watermark-layer jw-watermark-layer--user')
    expect(layer.getAttribute('data-jword-watermark-layer')).toBe('user')
    expect(layer.hasAttribute('data-extra')).toBe(false)
    expect(layer.getAttribute('aria-hidden')).toBe('true')
    expect(layer.style.display).toBe('block')
    expect(layer.style.visibility).toBe('visible')
    expect(layer.style.opacity).toBe('1')
    expect(layer.style.transform).toBe('')
    expect(layer.style.backgroundImage).toContain('data:image/svg+xml')

    layer.className = 'tampered-watermark'
    await waitForIntegrityCheck()

    expect(layer.className).toBe('jw-watermark-layer jw-watermark-layer--user')
    expect(layer.style.display).toBe('block')
    expect(layer.style.getPropertyPriority('display')).toBe('important')

    style.textContent = '.jw-watermark-layer { display: none !important; opacity: 0 !important; }'
    await waitForIntegrityCheck()
    expect(layer.className).toBe('jw-watermark-layer jw-watermark-layer--user')
    expect(layer.style.display).toBe('block')
    expect(layer.style.opacity).toBe('1')
    style.remove()
    controller.destroy()
  })

  it('用户水印被删除后自动恢复，且不清除品牌水印', async () => {
    const { editorHost, canvas, pages } = createWatermarkHost(2)
    const controller = createWatermarkController(editorHost)

    cleanupControllers.push(controller)
    controller.setWatermark({ text: '用户水印' })
    controller.setBrandWatermark('Powered by JWord')
    pages[0]?.querySelector<HTMLElement>('[data-jword-watermark-layer="user"]')?.remove()
    await waitForMutationObserver()

    expect(pages[0]?.querySelector('[data-jword-watermark-layer="user"]')).not.toBeNull()
    expect(pages[1]?.querySelector('[data-jword-watermark-layer="user"]')).not.toBeNull()
    controller.clearWatermark()
    expect(canvas.querySelector('[data-jword-watermark-layer="user"]')).toBeNull()
    expect(pages[0]?.querySelector('[data-jword-watermark-layer="brand"]')).not.toBeNull()
    expect(pages[1]?.querySelector('[data-jword-watermark-layer="brand"]')).not.toBeNull()
    controller.destroy()
  })
})

/** 创建带分页 canvas 的水印测试宿主。 */
function createWatermarkHost(pageCount: number): {
  readonly editorHost: HTMLElement
  readonly canvas: HTMLElement
  readonly pages: readonly HTMLElement[]
} {
  const editorHost = document.createElement('div')
  const canvas = document.createElement('div')
  const pages: HTMLElement[] = []

  canvas.setAttribute('data-jword-canvas-container', '')
  editorHost.append(canvas)
  for (let index = 0; index < pageCount; index += 1) {
    const page = document.createElement('div')
    const pageCanvas = document.createElement('canvas')

    page.className = 'jw-editor__page'
    page.setAttribute('data-jword-page', String(index))
    page.append(pageCanvas)
    canvas.append(page)
    pages.push(page)
  }

  return {
    editorHost,
    canvas,
    pages
  }
}
