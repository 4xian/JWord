/**
 * @fileoverview 职责: 用真实浏览器补齐 Gate 4 图片、表格、批注、页眉页脚、修订和移动视口的视觉回归入口。
 * 边界: 固定 Chromium 截图基线与 canvas/DOM 探针，不把长表格基线宣称为行级跨页拆分支持。
 * 协作: vanilla demo、@4xian/jword-ui 官方控件、core renderer 与 Playwright visual-chromium 项目。
 * 约束: 验证必须来自真实 canvas 像素、DOM 可见状态和公开 editor facade。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.17。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface Gate4VisualProbe {
  readonly canvasCount: number
  readonly nonWhitePixels: number
  readonly imageCount: number
  readonly tableCount: number
  readonly commentThreadCount: number
  readonly revisionCount: number
  readonly headerFooterBoxCount: number
  readonly visibleHeadingItems: number
  readonly findStatusText: string
  readonly visibleCommentCards: number
  readonly visibleRevisionItems: number
}

test('Gate 4 desktop visual baseline paints feature markup without blank canvas', async ({ page }) => {
  await page.setViewportSize({
    width: 1366,
    height: 900
  })
  await page.goto('/')
  await waitForGate4VisualReady(page)
  await createFixtureHeading(page)
  await insertFixtureImage(page)
  await insertFixtureTable(page)
  await createFixtureComment(page)
  await createFixtureRevision(page)
  await applyHeaderFooter(page)
  await applyFindVisualState(page)

  const probe = await readGate4VisualProbe(page)

  expect(probe.canvasCount).toBeGreaterThan(0)
  expect(probe.nonWhitePixels).toBeGreaterThan(100)
  expect(probe.imageCount).toBe(1)
  expect(probe.tableCount).toBe(1)
  expect(probe.commentThreadCount).toBe(1)
  expect(probe.revisionCount).toBe(1)
  expect(probe.headerFooterBoxCount).toBeGreaterThanOrEqual(2)
  expect(probe.visibleHeadingItems).toBeGreaterThan(0)
  expect(probe.findStatusText).toBe('1 / 1')
  expect(probe.visibleCommentCards).toBeGreaterThan(0)
  expect(probe.visibleRevisionItems).toBe(1)
  await expect(page.locator('.jw-demo__workspace')).toHaveScreenshot('gate4-desktop-feature-baseline.png', {
    animations: 'disabled',
    caret: 'hide',
    mask: [
      page.locator('.jw-comments-sidebar__time, .jw-comments-sidebar__detail-time, .jw-comments-sidebar__message-time')
    ],
    maxDiffPixelRatio: 0.02
  })
})

test('Gate 4 media failure visual baseline keeps recoverable url dialog visible', async ({ page }) => {
  await page.setViewportSize({
    width: 1280,
    height: 820
  })
  await page.goto('/')
  await waitForGate4VisualReady(page)
  await openRetryFailureDialog(page)

  const failureProbe = await page.evaluate(() => {
    const dialog = document.querySelector<HTMLElement>('[data-jword-media-url-dialog="true"]')
    const error = document.querySelector<HTMLElement>('[data-jword-media-url-dialog-error="true"]')
    const uploadLog = window.__jwordDemo?.media.readUploadLog() ?? []

    return {
      dialogVisible: dialog?.hidden === false,
      errorText: error?.textContent ?? '',
      uploadLogLength: uploadLog.length,
      firstOutcome: uploadLog[0]?.outcome ?? null
    }
  })

  expect(failureProbe.dialogVisible).toBe(true)
  expect(failureProbe.errorText).toContain('首次上传临时失败')
  expect(failureProbe.uploadLogLength).toBe(1)
  expect(failureProbe.firstOutcome).toBe('failed')
  await expect(page.locator('.jw-demo__workspace')).toHaveScreenshot('gate4-media-failure-baseline.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02
  })
})

test('Gate 4 long table visual baseline records current page-boundary behavior', async ({ page }) => {
  await page.setViewportSize({
    width: 1280,
    height: 900
  })
  await page.goto('/')
  await waitForGate4VisualReady(page)
  await insertLongFixtureTable(page)

  const tableProbe = await page.evaluate(() => {
    const tableBoxes = window.__jwordDemo?.editor.getLayout().pages
      .flatMap((pageBox) => pageBox.blocks)
      .filter((block) => block.kind === 'table') ?? []

    return {
      tableBoxCount: tableBoxes.length,
      tablePageIndexes: tableBoxes.map((tableBox) => tableBox.pageIndex),
      tableRowCount: tableBoxes[0]?.rowCount ?? 0,
      pageCount: window.__jwordDemo?.editor.getLayout().pages.length ?? 0
    }
  })

  expect(tableProbe.tableBoxCount).toBe(1)
  expect(tableProbe.tableRowCount).toBe(8)
  expect(tableProbe.pageCount).toBeGreaterThanOrEqual(1)
  await expect(page.locator('.jw-demo__workspace')).toHaveScreenshot('gate4-long-table-baseline.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02
  })
})

test('Gate 4 mobile visual baseline keeps paged canvas readable without toolbar overlap', async ({ page }) => {
  await page.setViewportSize({
    width: 390,
    height: 780
  })
  await page.goto('/')
  await waitForGate4VisualReady(page)

  const mobileProbe = await page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('#jword-toolbar')
    const container = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const canvas = document.querySelector<HTMLCanvasElement>('.jw-editor__page-canvas')
    const context = canvas?.getContext('2d')
    const image = canvas === null || context === null || context === undefined
      ? new Uint8ClampedArray()
      : context.getImageData(0, 0, canvas.width, canvas.height).data
    let nonWhitePixels = 0

    for (let index = 0; index < image.length; index += 4) {
      const red = image[index] ?? 0
      const green = image[index + 1] ?? 0
      const blue = image[index + 2] ?? 0
      const alpha = image[index + 3] ?? 0

      if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
        nonWhitePixels += 1
      }
    }

    return {
      toolbarHidden: toolbar?.hidden ?? false,
      canvasOverflow: container?.style.overflow ?? '',
      canvasWidth: canvas?.width ?? 0,
      nonWhitePixels
    }
  })

  expect(mobileProbe.toolbarHidden).toBe(false)
  expect(mobileProbe.canvasOverflow).toBe('auto')
  expect(mobileProbe.canvasWidth).toBeGreaterThan(0)
  expect(mobileProbe.nonWhitePixels).toBeGreaterThan(100)
  await expect(page.locator('.jw-demo__workspace')).toHaveScreenshot('gate4-mobile-baseline.png', {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02
  })
})

/** 等待 demo 与首个 canvas 挂载。 */
async function waitForGate4VisualReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('.jw-editor__page-canvas').length)).toBeGreaterThan(0)
}

/** 把选区折叠到第一段指定位置。 */
async function selectFirstRunRange(page: Page, anchorGraphemeIndex: number, focusGraphemeIndex: number): Promise<void> {
  await page.evaluate(({ anchorIndex, focusIndex }) => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 4 visual demo hook。')
    }

    const selectionTarget = readTextSelectionTarget(demo, Math.max(anchorIndex, focusIndex))

    if (selectionTarget === null) {
      throw new Error('缺少 Gate 4 visual 文本选区目标。')
    }

    demo.selectTextRange({
      sectionId: selectionTarget.sectionId,
      blockId: selectionTarget.blockId,
      runId: selectionTarget.runId,
      anchorGraphemeIndex: anchorIndex,
      focusGraphemeIndex: focusIndex
    })

    function readTextSelectionTarget(demoInstance: NonNullable<typeof window.__jwordDemo>, requiredLength: number) {
      for (const section of demoInstance.editor.getProjection().document.sections) {
        for (const block of section.blocks) {
          if (block.kind !== 'paragraph') {
            continue
          }

          for (const run of block.runs) {
            const textLength = run.inlines.reduce((length, inline) => {
              return inline.kind === 'text' ? length + Array.from(inline.text).length : length
            }, 0)

            if (textLength >= requiredLength) {
              return {
                sectionId: section.id,
                blockId: block.id,
                runId: run.id
              }
            }
          }
        }
      }

      return null
    }
  }, {
    anchorIndex: anchorGraphemeIndex,
    focusIndex: focusGraphemeIndex
  })
}

/** 通过 editor facade 创建一个可由官方目录面板读取的标题。 */
async function createFixtureHeading(page: Page): Promise<void> {
  await selectFirstRunRange(page, 0, 0)
  await page.evaluate(() => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 4 visual demo hook。')
    }

    demo.editor.setParagraphStyle('Heading1')
  })
  await expect.poll(() => page.evaluate(() => document.querySelectorAll('[data-jword-heading-outline-item]').length)).toBeGreaterThan(0)
}

/** 通过官方图片入口插入 fixture 图片。 */
async function insertFixtureImage(page: Page): Promise<void> {
  await selectFirstRunRange(page, 0, 0)
  await page.locator('[data-jword-media-trigger="true"]').click()
  await page.locator('[data-jword-media-file-input="true"]').setInputFiles('fixtures/gate4/media-inline.svg')
  await expect.poll(() => page.evaluate(() => window.__jwordDemo?.media.readUploadLog().length ?? 0)).toBeGreaterThan(0)
}

/** 通过官方表格入口插入 2 x 2 表格并写入首格文本。 */
async function insertFixtureTable(page: Page): Promise<void> {
  await page.locator('[data-jword-table-insert-trigger="true"]').click()
  await page.locator('[data-jword-table-preview-cell="true"][data-jword-rows="2"][data-jword-columns="2"]').click()
  await expect.poll(() => page.evaluate(() => window.__jwordDemo?.table.setCellText(0, 0, '视觉表格') ?? false)).toBe(true)
}

/** 通过官方自定义行列入口插入长表格，并写入首列可见文本。 */
async function insertLongFixtureTable(page: Page): Promise<void> {
  await page.locator('[data-jword-table-insert-trigger="true"]').click()
  await page.locator('[data-jword-table-custom-size="true"]').click()
  await page.locator('[data-jword-table-insert-rows="true"]').fill('8')
  await page.locator('[data-jword-table-insert-columns="true"]').fill('3')
  await page.locator('[data-jword-table-insert-confirm]').click()
  await expect.poll(() => page.evaluate(() => {
    const table = window.__jwordDemo?.editor.getProjection().document.sections
      .flatMap((section) => section.blocks)
      .find((block) => block.kind === 'table')

    return table?.kind === 'table' ? table.rows.length : 0
  })).toBe(8)

  for (let rowIndex = 0; rowIndex < 8; rowIndex += 1) {
    await expect.poll(() => page.evaluate((input) => {
      return window.__jwordDemo?.table.setCellText(input.rowIndex, 0, `视觉长表格 ${input.rowIndex + 1}`) ?? false
    }, { rowIndex })).toBe(true)
  }
}

/** 打开 URL 图片失败态弹窗，固定可恢复失败视觉状态。 */
async function openRetryFailureDialog(page: Page): Promise<void> {
  const retryOnceUrl = await page.evaluate(() => window.__jwordDemo?.media.buildScenarioUrl('retry-once') ?? '')

  expect(retryOnceUrl).not.toBe('')
  await page.locator('[data-jword-media-trigger="true"]').click()
  await page.locator('[data-jword-media-action-url="true"]').click()
  await page.locator('[data-jword-media-url-dialog-input="true"]').fill(retryOnceUrl)
  await page.locator('[data-jword-media-url-dialog-confirm="true"]').click()
  await expect(page.locator('[data-jword-media-url-dialog="true"]')).toBeVisible()
  await expect(page.locator('[data-jword-media-url-dialog-error="true"]')).toContainText('首次上传临时失败')
}

/** 通过官方批注入口创建一条页内批注卡片。 */
async function createFixtureComment(page: Page): Promise<void> {
  await selectFirstRunRange(page, 1, 4)
  await page.locator('[data-jword-insert-comment]').click()
  await page.locator('[data-jword-comment-input="draft"]').first().fill('视觉批注')
  await page.locator('[data-jword-comment-action="confirm-draft"]').first().click()
  await expect.poll(() => page.evaluate(() => window.__jwordDemo?.comments.readThreadCount() ?? 0)).toBe(1)
}

/** 通过 demo hook 创建一条修订 metadata。 */
async function createFixtureRevision(page: Page): Promise<void> {
  await selectFirstRunRange(page, 2, 5)
  await expect.poll(() => {
    return page.evaluate(() => window.__jwordDemo?.revisions.addRevision({
      authorId: 'demo-user',
      createdAt: '2026-05-24T08:00:00.000Z',
      type: 'format',
      summary: '视觉修订'
    }) ?? false)
  }).toBe(true)
}

/** 通过官方页眉页脚入口写入最小 section 字段。 */
async function applyHeaderFooter(page: Page): Promise<void> {
  await page.locator('[data-jword-toggle-header-footer]').click()
  await page.locator('[data-jword-header-id-input]').fill('visual-header')
  await page.locator('[data-jword-toggle-footer]').click()
  await page.locator('[data-jword-footer-id-input]').fill('visual-footer')
  await page.locator('[data-jword-toggle-page-number]').click()
  await page.locator('[data-jword-page-start-input]').fill('3')
  await page.locator('[data-jword-toggle-header-footer]').click()
  await page.locator('[data-jword-section-break-next-page]').click()
  await page.keyboard.press('Escape')
}

/** 通过官方查找面板创建一个可见查找状态。 */
async function applyFindVisualState(page: Page): Promise<void> {
  await page.locator('[data-jword-open-find-replace]').click()
  await page.locator('[data-jword-find-query-input]').fill('视觉表格')
  await page.locator('[data-jword-find-button]').click()
  await expect(page.locator('[data-jword-find-status]')).toHaveText('1 / 1')
}

/** 采样 Gate 4 视觉 smoke 需要的 canvas 与 DOM 状态。 */
async function readGate4VisualProbe(page: Page): Promise<Gate4VisualProbe> {
  return page.evaluate(() => {
    const canvases = [...document.querySelectorAll<HTMLCanvasElement>('.jw-editor__page-canvas')]
    let nonWhitePixels = 0

    for (const canvas of canvases) {
      const context = canvas.getContext('2d')

      if (context === null) {
        continue
      }

      const image = context.getImageData(0, 0, canvas.width, canvas.height).data

      for (let index = 0; index < image.length; index += 4) {
        const red = image[index] ?? 0
        const green = image[index + 1] ?? 0
        const blue = image[index + 2] ?? 0
        const alpha = image[index + 3] ?? 0

        if (alpha > 0 && (red < 245 || green < 245 || blue < 245)) {
          nonWhitePixels += 1
        }
      }
    }

    const projection = window.__jwordDemo?.editor.getProjection()
    const layout = window.__jwordDemo?.editor.getLayout()

    return {
      canvasCount: canvases.length,
      nonWhitePixels,
      imageCount: projection?.document.sections.flatMap((section) => section.blocks)
        .filter((block) => block.kind === 'paragraph')
        .flatMap((block) => block.runs)
        .flatMap((run) => run.inlines)
        .filter((inline) => inline.kind === 'image').length ?? 0,
      tableCount: projection?.document.sections.flatMap((section) => section.blocks).filter((block) => block.kind === 'table').length ?? 0,
      commentThreadCount: projection?.document.comments?.length ?? 0,
      revisionCount: projection?.document.revisions?.length ?? 0,
      headerFooterBoxCount: layout?.pages[0]?.headerFooterBoxes.length ?? 0,
      visibleHeadingItems: document.querySelectorAll('[data-jword-heading-outline-item]').length,
      findStatusText: document.querySelector<HTMLOutputElement>('[data-jword-find-status]')?.textContent ?? '',
      visibleCommentCards: document.querySelectorAll('[data-jword-comment-thread-id]').length,
      visibleRevisionItems: document.querySelectorAll('[data-jword-revision-item]').length
    }
  })
}
