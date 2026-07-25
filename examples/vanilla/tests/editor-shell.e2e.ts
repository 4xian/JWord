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

test('默认工具栏面板无需额外 Host 即可打开', async ({ page }) => {
  await page.goto('/')

  const host = page.locator('#jword')

  await page.keyboard.type('abc')
  await page.keyboard.down('Shift')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.up('Shift')
  await page.getByRole('tab', { name: '插入' }).click()

  await page.getByRole('button', { name: '批注', exact: true }).click()
  await expect(page.getByRole('textbox', { name: '输入批注内容' })).toBeVisible()
  await page.getByRole('button', { name: '取消', exact: true }).click()

  await page.getByRole('button', { name: '链接', exact: true }).click()
  const linkDialog = host.locator('[data-jword-link-dialog]')

  await expect(linkDialog).toBeVisible()
  await page.getByRole('tab', { name: '页面' }).click()
  await expect(linkDialog).toBeHidden()
  for (const [name, menu] of [
    ['页眉', 'header'],
    ['页脚', 'footer'],
    ['页码', 'page-number']
  ] as const) {
    await page.getByRole('button', { name, exact: true }).click()
    await expect(host.locator('[data-jword-header-footer]')).toBeVisible()
    await expect(host.locator('[data-jword-header-footer]')).toHaveAttribute('data-jword-active-menu', menu)
  }

  await page.getByRole('tab', { name: '工具' }).click()
  const findReplaceButton = page.getByRole('button', { name: '查找替换', exact: true })

  await findReplaceButton.click()
  const findReplace = host.locator('[data-jword-find-replace]')

  await expect(findReplace).toBeVisible()
  const findReplaceButtonRect = await findReplaceButton.boundingBox()
  const findReplaceRect = await findReplace.boundingBox()
  const viewport = page.viewportSize()

  expect(findReplaceButtonRect).not.toBeNull()
  expect(findReplaceRect).not.toBeNull()
  expect(findReplaceRect?.y).toBeCloseTo((findReplaceButtonRect?.y ?? 0) + (findReplaceButtonRect?.height ?? 0) + 8, 0)
  expect(findReplaceRect?.x).toBeGreaterThanOrEqual(16)
  expect((findReplaceRect?.x ?? 0) + (findReplaceRect?.width ?? 0)).toBeLessThanOrEqual((viewport?.width ?? 0) - 16)
  await page.getByRole('button', { name: '修订记录', exact: true }).click()
  const revisions = host.locator('[data-jword-revisions-panel]')

  await expect(revisions).toBeVisible()
  await expect(findReplace).toBeHidden()
  expect(await revisions.evaluate((panel) => {
    const panelRect = panel.getBoundingClientRect()
    const editorRegion = panel.closest<HTMLElement>('[data-jword-shell-region="editor"]')
    const editorRect = editorRegion?.getBoundingClientRect()

    return editorRect !== undefined
      && panelRect.top >= editorRect.top
      && panelRect.bottom <= editorRect.bottom
  })).toBe(true)

  await page.getByRole('tab', { name: '开始' }).click()
  const fontTrigger = page.getByRole('button', { name: '字体', exact: true })
  const fontListbox = page.getByRole('listbox', { name: '字体', exact: true })

  await fontTrigger.click()
  await expect(revisions).toBeHidden()
  await expect(fontListbox).toBeVisible()
  await fontListbox.getByRole('option', { name: '宋体', exact: true }).click()
  await expect(fontListbox).toBeHidden()
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
