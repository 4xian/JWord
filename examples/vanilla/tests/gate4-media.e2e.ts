/**
 * @fileoverview 职责: 用真实浏览器冻结 Gate 4 图片入口收敛到 toolbar 的最小契约。
 * 边界: 只验证 toolbar 图片入口、URL 弹框、本地上传和 editor projection 的最小闭环，不覆盖后续图片编辑能力。
 * 协作: examples/vanilla/src/main.ts、demo media support、packages/ui/src/media/* 和 core image command builders。
 * 约束: 断言必须来自真实 DOM、window.__jwordDemo.media 钩子和 editor.getProjection()，所有插入都只允许是 inline。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 1 Step 4.1-4.3。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

test('Gate 4 media toolbar only exposes inline local upload and applies it successfully', async ({ page }) => {
  await page.goto('/')
  await waitForMediaDemoReady(page)
  await prepareInsertSelection(page)

  const trigger = page.locator('[data-jword-media-trigger="true"]')
  const menu = page.locator('[data-jword-media-menu="true"]')
  const fileAction = page.locator('[data-jword-media-action-file="true"]')
  const fileInput = page.locator('[data-jword-media-file-input="true"]')

  await trigger.click()
  await expect(menu).toBeVisible()
  await expect(fileAction).toContainText('本地上传')
  await expect(menu).not.toContainText('块级')
  await fileInput.setInputFiles('fixtures/gate4/media-inline.svg')

  await expect(menu).toBeHidden()
  await expect.poll(() => {
    return page.evaluate(() => window.__jwordDemo?.media?.readUploadLog().length ?? 0)
  }).toBe(1)

  await expect.poll(() => {
    return page.evaluate(() => {
      const demo = window.__jwordDemo
      const resourceId = demo?.media?.readUploadLog()[0]?.resourceId
      const projection = demo?.editor.getProjection()

      if (resourceId === undefined || projection === undefined) {
        return null
      }

      const image = projection.document.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'paragraph')
        .flatMap((block) => block.runs)
        .flatMap((run) => run.inlines)
        .find((inline): inline is {
          readonly kind: 'image'
          readonly resourceId: string
          readonly display?: 'inline' | 'block'
        } => inline.kind === 'image' && inline.resourceId === resourceId)

      return image === undefined
        ? null
        : {
            display: image.display ?? null
          }
    })
  }).toEqual({
    display: 'inline'
  })
})

test('Gate 4 media toolbar uses confirm/cancel url dialog and inserts inline image after confirm', async ({ page }) => {
  await page.goto('/')
  await waitForMediaDemoReady(page)
  await prepareInsertSelection(page)

  const trigger = page.locator('[data-jword-media-trigger="true"]')
  const urlAction = page.locator('[data-jword-media-action-url="true"]')
  const dialog = page.locator('[data-jword-media-url-dialog="true"]')
  const dialogInput = page.locator('[data-jword-media-url-dialog-input="true"]')
  const cancelButton = page.locator('[data-jword-media-url-dialog-cancel="true"]')
  const confirmButton = page.locator('[data-jword-media-url-dialog-confirm="true"]')

  await trigger.click()
  await urlAction.click()
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('网络地址')

  const fixtureUrl = await page.evaluate(() => {
    return window.__jwordDemo?.media?.getFixtureUrl() ?? ''
  })

  expect(fixtureUrl).not.toBe('')
  await dialogInput.fill(fixtureUrl)
  await cancelButton.click()
  await expect(dialog).toBeHidden()

  await trigger.click()
  await urlAction.click()
  await dialogInput.fill(fixtureUrl)
  await confirmButton.click()

  await expect(dialog).toBeHidden()
  await expect.poll(() => {
    return page.evaluate(() => window.__jwordDemo?.media?.readUploadLog().length ?? 0)
  }).toBe(1)

  await expect.poll(() => {
    return page.evaluate(() => {
      const demo = window.__jwordDemo
      const resourceId = demo?.media?.readUploadLog()[0]?.resourceId
      const projection = demo?.editor.getProjection()

      if (resourceId === undefined || projection === undefined) {
        return null
      }

      const image = projection.document.sections
        .flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'paragraph')
        .flatMap((block) => block.runs)
        .flatMap((run) => run.inlines)
        .find((inline): inline is {
          readonly kind: 'image'
          readonly resourceId: string
          readonly display?: 'inline' | 'block'
        } => inline.kind === 'image' && inline.resourceId === resourceId)

      return image === undefined
        ? null
        : {
            display: image.display ?? null
          }
    })
  }).toEqual({
    display: 'inline'
  })
})

/** 等待 toolbar 图片入口和 demo 测试钩子都挂载完成。 */
async function waitForMediaDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo?.media !== undefined)
  await expect(page.locator('[data-jword-media-toolbar="true"]')).toBeVisible()
  await expect(page.locator('[data-jword-media-panel="true"]')).toHaveCount(0)
}

/** 通过 demo 的 Alpha 样例和公开选区钩子，准备图片插入所需的折叠选区。 */
async function prepareInsertSelection(page: Page): Promise<void> {
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 4 demo 测试钩子')
    }

    const projection = demo.editor.getProjection()
    const firstSection = projection.document.sections[0]
    const firstBlock = firstSection?.blocks[0]
    const firstRun = firstBlock?.kind === 'paragraph' ? firstBlock.runs[0] : undefined

    if (firstSection === undefined || firstBlock === undefined || firstBlock.kind !== 'paragraph' || firstRun === undefined) {
      throw new Error('缺少图片插入选区目标')
    }

    demo.selectTextRange({
      sectionId: firstSection.id,
      blockId: firstBlock.id,
      runId: firstRun.id,
      anchorGraphemeIndex: 0,
      focusGraphemeIndex: 0
    })
  })
  await expect(page.locator('[data-jword-selection-summary]')).toContainText('0→0')
}
