/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 7 vanilla 示例可通过公开 createJWordUi options 接入 theme 和 i18n。
 * 边界: 不做截图基线，不读取 UI 私有 controller 状态。
 * 协作: examples/vanilla/src/main.ts、@4xian/jword-ui theme/i18n contract。
 * 约束: 只断言公开 DOM 类名、主题属性、样式变量和辅助文案。
 */
import { expect, test } from '@playwright/test'

test('Gate 7 vanilla theme and i18n query path customizes public UI surface', async ({ page }) => {
  await page.goto('/test-fixture.html?theme=dark&i18n=en')
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)

  const toolbar = page.locator('[data-jword-toolbar="true"]')

  await expect(toolbar).toHaveAttribute('data-theme', 'dark')
  await expect(toolbar).toHaveAttribute('aria-label', 'JWord editing toolbar')
  await expect(toolbar).toHaveAttribute('lang', 'en-US')
  await expect(toolbar.getByRole('button', { name: 'Bold' })).toBeVisible()
  await toolbar.getByRole('tab', { name: 'Insert' }).click()
  await expect(toolbar.getByRole('button', { name: 'Image' })).toBeVisible()
  await toolbar.getByRole('tab', { name: 'Table' }).click()
  await expect(toolbar.getByRole('button', { name: 'Table' })).toBeVisible()
  await expect(toolbar).toHaveCSS('color', 'rgb(250, 250, 250)')
})
