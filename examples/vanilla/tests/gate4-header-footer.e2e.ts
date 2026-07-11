/**
 * @fileoverview 职责: 用真实浏览器覆盖 Gate 4 页眉页脚、分节和页码的最小验收路径。
 * 边界: 只验证官方 UI 在 vanilla host 的装配、section properties 落地和 layout 可读输出，不实现页眉页脚正文编辑器。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/header-footer/*、core section command 与 layout。
 * 约束: 断言来自真实 DOM 或 window.__jwordTestFixture.editor 公开 facade，不读取 controller 私有状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface HeaderFooterProbe {
  readonly sectionBreakType: string | null
  readonly sectionHeaderIds: readonly string[]
  readonly sectionFooterIds: readonly string[]
  readonly pageNumberingMode: string | null
  readonly pageNumberingStart: number | null
  readonly layoutPageNumber: number | null
  readonly layoutHeaderIds: readonly string[]
  readonly layoutFooterIds: readonly string[]
  readonly headerFooterBoxRoles: readonly string[]
}

test('Gate 4 header footer panel writes section metadata and layout exposes page fields', async ({ page }) => {
  await recordCanvasTextCalls(page)
  await page.goto('/test-fixture.html')
  await waitForHeaderFooterDemoReady(page)

  await page.locator('[data-jword-toggle-header-footer]').click()
  await page.locator('[data-jword-header-id-input]').fill('header-main')
  await page.locator('[data-jword-toggle-footer]').click()
  await page.locator('[data-jword-footer-id-input]').fill('footer-main')
  await page.locator('[data-jword-toggle-page-number]').click()
  await page.locator('[data-jword-page-start-input]').fill('7')
  await page.locator('[data-jword-toggle-header-footer]').click()
  await page.locator('[data-jword-section-break-next-page]').click()

  await expect.poll(() => readHeaderFooterProbe(page)).toMatchObject({
    sectionBreakType: 'next-page',
    sectionHeaderIds: ['header-main'],
    sectionFooterIds: ['footer-main'],
    pageNumberingMode: 'restart',
    pageNumberingStart: 7,
    layoutPageNumber: 7,
    layoutHeaderIds: ['header-main'],
    layoutFooterIds: ['footer-main'],
    headerFooterBoxRoles: ['header', 'footer']
  })
  await expect.poll(() => readCanvasTextCalls(page)).toEqual(expect.arrayContaining([
    'header-main',
    'footer-main'
  ]))

  await page.locator('[data-jword-toggle-page-number]').click()
  await page.locator('[data-jword-page-number-top-right]').click()

  await expect(page.locator('[data-jword-header-id-input]')).toHaveValue('header-main')
  await expect(page.locator('[data-jword-footer-id-input]')).toHaveValue('footer-main')
  await expect.poll(() => readHeaderFooterProbe(page)).toMatchObject({
    sectionHeaderIds: ['header-main', 'page-number-top-right'],
    sectionFooterIds: ['footer-main'],
    pageNumberingMode: 'restart',
    pageNumberingStart: 7,
    layoutHeaderIds: ['header-main', 'page-number-top-right'],
    layoutFooterIds: ['footer-main'],
    headerFooterBoxRoles: ['header', 'header', 'footer']
  })
  await expect.poll(() => readCanvasTextCalls(page)).toEqual(expect.arrayContaining([
    'header-main',
    'footer-main',
    '7'
  ]))

  const canvasTextCalls = await readCanvasTextCalls(page)

  expect(canvasTextCalls.some((text) => text.includes('page-number-'))).toBe(false)
})

/** 在页面加载前记录 canvas fillText 调用，用来验证页眉页脚确实进入真实浏览器绘制路径。 */
async function recordCanvasTextCalls(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const textCalls: string[] = []
    const originalFillText = CanvasRenderingContext2D.prototype.fillText

    window.__jwordCanvasTextCalls = textCalls
    CanvasRenderingContext2D.prototype.fillText = function fillTextRecorder(
      text: string,
      x: number,
      y: number,
      maxWidth?: number
    ): void {
      textCalls.push(String(text))

      if (maxWidth === undefined) {
        originalFillText.call(this, text, x, y)
        return
      }

      originalFillText.call(this, text, x, y, maxWidth)
    }
  })
}

/** 等待 demo、editor 和页眉页脚官方 UI 完成挂载。 */
async function waitForHeaderFooterDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
  await expect(page.locator('[data-jword-header-footer]')).toBeAttached()
}

/** 读取真实浏览器 canvas 文本绘制记录。 */
async function readCanvasTextCalls(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__jwordCanvasTextCalls ?? [])
}

/** 读取 section projection 与 layout 页级输出。 */
async function readHeaderFooterProbe(page: Page): Promise<HeaderFooterProbe> {
  return page.evaluate(() => {
    const projection = window.__jwordTestFixture?.editor.getProjection()
    const layout = window.__jwordTestFixture?.editor.getLayout()
    const section = projection?.document.sections[0]
    const firstPage = layout?.pages[0]

    return {
      sectionBreakType: section?.breakType ?? null,
      sectionHeaderIds: section?.headerIds ?? [],
      sectionFooterIds: section?.footerIds ?? [],
      pageNumberingMode: section?.pageNumbering?.mode ?? null,
      pageNumberingStart: section?.pageNumbering?.start ?? null,
      layoutPageNumber: firstPage?.pageNumber ?? null,
      layoutHeaderIds: firstPage?.headerIds ?? [],
      layoutFooterIds: firstPage?.footerIds ?? [],
      headerFooterBoxRoles: firstPage?.headerFooterBoxes.map((box) => box.role) ?? []
    }
  })
}

declare global {
  interface Window {
    __jwordCanvasTextCalls?: string[]
  }
}
