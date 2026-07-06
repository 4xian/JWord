/**
 * @fileoverview 职责：用 axe-core 和真实浏览器补齐 Gate 4 UI 的系统性 a11y 验收。
 * 边界：覆盖表格、批注、查找替换的公开 DOM 与键盘可达入口，不替代各功能行为 E2E。
 * 协作：tests/e2e/a11y-axe.ts、packages/ui 的 table/comments/find-replace 控件和 vanilla demo。
 * 约束：只断言 serious/critical 自动化问题；屏幕阅读器人工矩阵在 remediation 文档登记。
 * Specs：docs/superpowers/reports/2026-07-02-plan-review.md#24-可访问性a11y验收缺乏实质进展。
 */
import { expect, test, type Page } from '@playwright/test'

import { expectNoSeriousAxeViolations } from '../../../tests/e2e/a11y-axe'

test('Gate 4 表格、批注和查找替换没有 serious/critical axe violation', async ({ page }) => {
  await page.goto('/')
  await waitForA11yDemoReady(page)

  await expectNoSeriousAxeViolations(page, {
    label: 'Gate 4 初始编辑器与 toolbar',
    context: '.jw-demo'
  })

  await openTableCustomSizeDialog(page)
  await expectNoSeriousAxeViolations(page, {
    label: 'Gate 4 表格自定义尺寸 dialog',
    context: '.jw-demo'
  })
  await page.locator('[data-jword-table-custom-size-cancel="true"]').click()

  await openCommentDraft(page)
  await expectNoSeriousAxeViolations(page, {
    label: 'Gate 4 批注草稿输入',
    context: '.jw-demo'
  })
  await page.locator('[data-jword-comment-input="draft"]').first().fill('a11y 批注验收')
  await page.locator('[data-jword-comment-action="confirm-draft"]').first().click()

  await page.locator('[data-jword-open-find-replace]').click()
  await expect(page.locator('[data-jword-find-replace]')).toBeVisible()
  await expectNoSeriousAxeViolations(page, {
    label: 'Gate 4 查找替换面板',
    context: '.jw-demo'
  })
})

/** 等待 vanilla demo 的编辑器、toolbar 和 Gate 4 控件完成挂载。 */
async function waitForA11yDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('.jw-demo')).toBeVisible()
  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.locator('[data-jword-table-toolbar="true"]')).toBeVisible()
  await expect(page.locator('[data-jword-comments-sidebar]')).toHaveCount(1)
  await expect(page.locator('[data-jword-find-replace]')).toHaveCount(1)
}

/** 打开表格自定义尺寸面板，覆盖 Gate 4 表格 dialog a11y。 */
async function openTableCustomSizeDialog(page: Page): Promise<void> {
  await page.locator('[data-jword-table-insert-trigger="true"]').click()
  await page.locator('[data-jword-table-custom-size="true"]').click()
  await expect(page.locator('[data-jword-table-custom-size-dialog="true"]')).toBeVisible()
}

/** 通过公开 demo hook 选中文本并打开批注草稿。 */
async function openCommentDraft(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordDemo
    const section = demo?.editor.getProjection().document.sections[0]
    const block = section?.blocks[0]
    const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

    if (demo === undefined || section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
      throw new Error('缺少批注 a11y 测试选区。')
    }

    demo.selectTextRange({
      sectionId: section.id,
      blockId: block.id,
      runId: run.id,
      anchorGraphemeIndex: 0,
      focusGraphemeIndex: 2
    })
  })
  await page.locator('[data-jword-insert-comment]').click()
  await expect(page.locator('[data-jword-comment-input="draft"]').first()).toBeVisible()
}
