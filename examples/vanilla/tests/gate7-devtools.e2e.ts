/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 7 Devtools 只能通过 vanilla opt-in 路径加载并展示 diagnostics export。
 * 边界: 不实现 Chrome Extension，不读取 editor 内部 runtime 或 monorepo src 子路径。
 * 协作: examples/vanilla/src/main.ts、@4xian/jword-devtools 与 core diagnostics export。
 * 约束: 断言来自页面 DOM 和公开 window.__jwordTestFixture hook，不包含正文、token 或 license private key。
 */
import { expect, test } from '@playwright/test'

test('Gate 7 vanilla opt-in devtools renders diagnostics summary without document text', async ({ page }) => {
  await page.goto('/test-fixture.html?devtools=true')
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined && window.__jwordTestFixture.devtools.isAttached())

  const panel = page.locator('[data-jword-devtools-panel="true"]')

  await expect(panel).toBeVisible()
  await expect(panel).toContainText('@4xian/jword-core')
  await expect(panel).toContainText('diagnostics.export')
  await expect(panel).toContainText('transactionCount')
  await expect(panel).not.toContainText('Alpha')

  const snapshot = await page.evaluate(() => window.__jwordTestFixture?.devtools.refresh())

  expect(snapshot?.privacy.contentIncluded).toBe(false)
  expect(snapshot?.packageVersions.some((item) => item.name === '@4xian/jword-core')).toBe(true)
})
