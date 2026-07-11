/**
 * 职责：验证 vanilla 默认页面只通过单 Host EditorShell 完成最小集成。
 * 边界：只检查默认 `/`，不加载测试夹具或复用其全局桥接。
 * 协作模块：examples/vanilla/index.html、src/main.ts 与 @4xian/jword-ui createJWord()。
 * 约束：直属区域顺序固定为 toolbar、editor、status bar，默认页面不得暴露测试全局。
 * 实现说明：本用例是默认示例迁移后的最小浏览器 smoke。
 */
import { expect, test } from '@playwright/test'

test('vanilla 默认页只提供单 Host EditorShell', async ({ page }) => {
  await page.goto('/')

  const host = page.locator('#jword')
  const regions = host.locator(':scope > [data-jword-shell-region]')

  await expect(host).toHaveAttribute('data-jword-editor-shell', 'true')
  await expect(regions).toHaveCount(3)
  await expect(regions.nth(0)).toHaveAttribute('data-jword-shell-region', 'toolbar')
  await expect(regions.nth(1)).toHaveAttribute('data-jword-shell-region', 'editor')
  await expect(regions.nth(2)).toHaveAttribute('data-jword-shell-region', 'status-bar')
  await expect(host.locator('[data-jword-editor]')).toHaveCount(1)
  await expect(host.locator('[data-jword-hidden-textarea]')).toBeFocused()
  await expect(host.locator('[data-jword-shell-live-region-host]')).toHaveCount(0)
  await expect(host.locator('[data-jword-shell-text-mirror-host]')).toHaveCount(0)
  expect(await page.evaluate(() => Reflect.has(window, '__jwordDemo'))).toBe(false)
  expect(await page.evaluate(() => Reflect.has(window, '__jwordTestFixture'))).toBe(false)
})

test('连续输入时滚动视口跟随光标且不撑高 EditorShell', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const canvasContainer = page.locator('[data-jword-canvas-container]')

  await canvasContainer.click({ position: { x: 720, y: 300 } })

  for (let index = 0; index < 40; index += 1) {
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
  }

  await expect(canvasContainer).toHaveAttribute('data-jword-page-count', '1')
  expect(await canvasContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)

  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.type('1')
    await page.keyboard.press('Enter')
  }

  await expect(canvasContainer).toHaveAttribute('data-jword-page-count', '2')

  const probe = await page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('#jword')
    const editorHost = document.querySelector<HTMLElement>('[data-jword-shell-region="editor"]')
    const viewport = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const input = document.querySelector<HTMLElement>('[data-jword-hidden-textarea]')

    if (root === null || editorHost === null || viewport === null || input === null) {
      throw new Error('缺少连续输入滚动探针所需的 EditorShell 节点。')
    }

    const viewportRect = viewport.getBoundingClientRect()
    const inputRect = input.getBoundingClientRect()

    return {
      scrollTop: viewport.scrollTop,
      caretVisible: inputRect.top >= viewportRect.top && inputRect.bottom <= viewportRect.bottom,
      rootContained: root.scrollHeight <= root.clientHeight,
      editorContained: editorHost.scrollHeight <= editorHost.clientHeight
    }
  })

  expect(probe.scrollTop).toBeGreaterThan(0)
  expect(probe.caretVisible).toBe(true)
  expect(probe.rootContained).toBe(true)
  expect(probe.editorContained).toBe(true)

  await canvasContainer.evaluate((element) => {
    element.scrollTop = 0
  })
  await page.waitForTimeout(600)
  expect(await canvasContainer.evaluate((element) => element.scrollTop)).toBe(0)

  await page.keyboard.type('1')
  expect(await canvasContainer.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
})
