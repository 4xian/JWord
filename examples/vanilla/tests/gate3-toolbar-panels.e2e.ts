/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 3 工具栏渲染、选择同步和下拉面板外观。
 * 边界: 不覆盖文字格式矩阵、段落格式或插入工具专属路径。
 * 协作: vanilla demo、工具栏 DOM、编辑器公开门面和共享工具栏测试辅助函数。
 * 约束: 断言必须来自真实 DOM 和公开门面，不伪造工具栏状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { expect, test } from '@playwright/test'

import {
  readOfficialToolbar,
  readToolbarSelectFrameProbe,
  readToolbarSelectTriggerIconCount,
  waitForDemoReady
} from './gate3-toolbar-helpers'

test.describe.configure({ mode: 'serial' })

test('Gate 3 toolbar renders real controls and mirrors current selection state', async ({ page }) => {
  await page.goto('/')
  await waitForDemoReady(page)

  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.getByRole('button', { name: '撤销' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '重做' })).toBeDisabled()
  await expect(page.locator('[data-jword-selection-summary]')).toHaveCount(0)
  await expect(page.locator('[data-jword-run-summary]')).toHaveCount(0)
  await expect(page.locator('[data-jword-blocked-summary]')).toHaveCount(0)

  const mirrorLength = await page.evaluate(() =>
    document.querySelector<HTMLElement>('[data-jword-ui-text-mirror]')?.textContent?.length ?? 0
  )

  expect(mirrorLength).toBeGreaterThan(100)
  const textMirror = page.locator('[data-jword-ui-text-mirror="true"]')

  await expect(textMirror).toContainText('默认混排样例 2026')
  await expect(textMirror).toContainText('English text')
  await expect(textMirror).toContainText('13579')
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()
  await expect(readOfficialToolbar(page).getByRole('button', { name: '减小字号' })).toBeVisible()
  await expect(readOfficialToolbar(page).getByRole('button', { name: '增大字号' })).toBeVisible()
  await expect(readOfficialToolbar(page).getByRole('button', { name: '减少缩进' })).toBeVisible()
  await expect(readOfficialToolbar(page).getByRole('button', { name: '增加缩进' })).toBeVisible()
  await expect(page.locator('[data-jword-paragraph-indent-left]')).toHaveCount(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-alignment]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-line-height]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectTriggerIconCount(page, '[data-jword-paragraph-list]')).toBeGreaterThan(0)
  await expect.poll(() => readToolbarSelectFrameProbe(page, '[data-jword-format-font-family]')).toMatchObject({
    borderTopWidth: '1px',
    borderRightWidth: '1px'
  })
  await expect.poll(() => readToolbarSelectFrameProbe(page, '[data-jword-format-font-size]')).toMatchObject({
    borderTopWidth: '1px',
    borderRightWidth: '1px'
  })

  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()

  await page.getByRole('button', { name: '选择首页片段' }).click()

  await expect(readOfficialToolbar(page).getByRole('button', { name: '加粗' })).toBeEnabled()
  await expect(readOfficialToolbar(page).getByRole('button', { name: '斜体' })).toBeEnabled()
  await expect(page.locator('[data-jword-live-region]')).toContainText('选区')
})

