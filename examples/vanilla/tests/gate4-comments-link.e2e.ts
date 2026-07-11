/**
 * @fileoverview 职责: 用真实浏览器补齐 Gate 4 批注 anchor 与链接 allowlist 的最小 E2E 回归。
 * 边界: 只覆盖 vanilla demo 中官方 comments/link UI 到 core projection 的公开链路，不测试 controller 私有状态。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/comments、packages/ui/src/link 与 core command builders。
 * 约束: 所有断言来自真实 DOM、window.__jwordTestFixture 公开 facade 或 editor projection；不绕过 transaction pipeline 修改状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface CommentAnchorProbe {
  readonly threadCount: number
  readonly resolved: boolean | null
  readonly locatedOffsets: readonly [number, number] | null
  readonly firstParagraphText: string
}

interface LinkProbe {
  readonly activeTarget: string | null
  readonly linkedText: string | null
  readonly serializedProjection: string
}

test('Gate 4 comments keep anchor stable after preceding text edits and support resolve reopen', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate4ContentDemoReady(page)
  await selectFirstRunRange(page, 1, 3)

  await page.locator('[data-jword-insert-comment]').click()
  const draftInput = page.locator('[data-jword-comment-input="draft"]').first()

  await expect(draftInput).toBeVisible()
  await draftInput.fill('批注 anchor 回归')
  await page.locator('[data-jword-comment-action="confirm-draft"]').first().click()

  await expect.poll(() => readCommentAnchorProbe(page)).toMatchObject({
    threadCount: 1,
    locatedOffsets: [1, 3]
  })
  await expect(page.locator('[data-jword-comment-thread-id]').first()).toContainText('批注 anchor 回归')

  await insertTextAtFirstRunStart(page, '前')
  await expect.poll(() => readCommentAnchorProbe(page)).toMatchObject({
    threadCount: 1,
    locatedOffsets: [2, 4],
    firstParagraphText: expect.stringContaining('前')
  })

  await page.locator('[data-jword-comment-action="toggle-resolved"]').first().click()
  await expect.poll(() => readCommentAnchorProbe(page)).toMatchObject({
    resolved: true
  })

  await page.locator('[data-jword-comment-action="toggle-resolved"]').first().click()
  await expect.poll(() => readCommentAnchorProbe(page)).toMatchObject({
    resolved: false
  })
})

test('Gate 4 link dialog rejects unsafe urls and inserts an allowlisted link through toolbar UI', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate4ContentDemoReady(page)
  await selectFirstRunRange(page, 1, 3)

  await page.locator('[data-jword-insert-link]').click()
  await expect(page.locator('[data-jword-link-dialog]')).toBeVisible()
  await expect(page.locator('[data-jword-link-visible-text-input]')).toHaveValue('认混')
  await expect(page.locator('[data-jword-link-tooltip-input]')).toHaveCount(0)

  await page.locator('[data-jword-link-url-input]').fill('javascript:alert(1)')
  await expect(page.locator('[data-jword-link-confirm]')).toBeDisabled()
  await expect(page.locator('[data-jword-link-error]')).toContainText('协议')

  await page.locator('[data-jword-link-url-input]').fill('https://example.com/jword')
  await page.locator('[data-jword-link-confirm]').click()

  await expect.poll(() => readLinkProbe(page)).toMatchObject({
    activeTarget: 'https://example.com/jword',
    linkedText: '认混'
  })
  expect((await readLinkProbe(page)).serializedProjection).not.toContain('javascript:alert')
})

test('Gate 4 link overlay click toggles quick tools after a selected link is hidden', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate4ContentDemoReady(page)
  await selectFirstRunRange(page, 1, 3)

  await page.locator('[data-jword-insert-link]').click()
  await page.locator('[data-jword-link-url-input]').fill('https://example.com/jword')
  await page.locator('[data-jword-link-confirm]').click()

  const linkTarget = page.locator('[data-jword-link-target-index]').first()
  const quickTools = page.locator('[data-jword-link-quick-tools]')
  const floatingToolbar = page.locator('[data-jword-floating-toolbar]')

  await expect(linkTarget).toBeVisible()
  await linkTarget.click()
  await expect(quickTools).toBeVisible()
  await expect(floatingToolbar).toBeVisible()
  await expect(page.locator('[data-jword-link-open]')).toHaveAttribute('aria-label', '打开链接')
  await expect(page.locator('[data-jword-link-open] [data-jword-icon="openLink"]')).toHaveCount(1)
  await expect(page.locator('[data-jword-link-open] [data-jword-icon="link"]')).toHaveCount(0)
  await expect(page.locator('[data-jword-floating-toolbar] [data-jword-selection-action="insert.link"]')).toBeHidden()
  await expect(page.locator('[data-jword-floating-toolbar] [data-jword-selection-action="insert.link"]')).toBeDisabled()
  await expect(page.locator('[data-jword-floating-toolbar] [data-jword-selection-action="link.open"]')).toBeVisible()
  await expect(page.locator('[data-jword-floating-toolbar] [data-jword-selection-action="link.open"]')).toBeEnabled()

  await linkTarget.click()
  await expect(quickTools).toBeHidden()
  await expect(floatingToolbar).toBeHidden()

  await linkTarget.click()
  await expect(quickTools).toBeVisible()
  await expect(floatingToolbar).toBeVisible()
})

test('Gate 4 link target context menu uses the hit link state instead of stale selection state', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForGate4ContentDemoReady(page)
  await selectFirstRunRange(page, 1, 3)

  await page.locator('[data-jword-insert-link]').click()
  await page.locator('[data-jword-link-url-input]').fill('https://example.com/jword')
  await page.locator('[data-jword-link-confirm]').click()

  const linkTarget = page.locator('[data-jword-link-target-index]').first()

  await expect(linkTarget).toBeVisible()
  await selectFirstRunRange(page, 0, 1)
  await linkTarget.click({
    button: 'right'
  })

  const contextMenu = page.locator('[data-jword-context-menu]')

  await expect(contextMenu).toBeVisible()
  await expect(contextMenu.locator('[data-jword-context-action="insert.link"]')).toBeHidden()
  await expect(contextMenu.locator('[data-jword-context-action="insert.link"]')).toBeDisabled()
  await expect(contextMenu.locator('[data-jword-context-action="link.open"]')).toBeVisible()
  await expect(contextMenu.locator('[data-jword-context-action="link.open"]')).toBeEnabled()
  await expect(contextMenu.locator('[data-jword-context-action="link.edit"]')).toBeVisible()
  await expect(contextMenu.locator('[data-jword-context-action="link.edit"]')).toBeEnabled()
  await expect(contextMenu.locator('[data-jword-context-action="link.remove"]')).toBeVisible()
  await expect(contextMenu.locator('[data-jword-context-action="link.remove"]')).toBeEnabled()
})

/** 等待 demo、toolbar、批注与链接官方 UI 都完成挂载。 */
async function waitForGate4ContentDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.locator('[data-jword-comments-sidebar]')).toHaveCount(1)
  await expect(page.locator('[data-jword-link-panel]')).toHaveCount(1)
}

/** 通过公开 demo hook 选择第一段首个 run 的文本范围。 */
async function selectFirstRunRange(page: Page, anchorGraphemeIndex: number, focusGraphemeIndex: number): Promise<void> {
  await page.evaluate(({ anchorIndex, focusIndex }) => {
    const demo = window.__jwordTestFixture
    const section = demo?.editor.getProjection().document.sections[0]
    const block = section?.blocks[0]
    const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

    if (demo === undefined || section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
      throw new Error('缺少 Gate 4 内容选区目标。')
    }

    demo.selectTextRange({
      sectionId: section.id,
      blockId: block.id,
      runId: run.id,
      anchorGraphemeIndex: anchorIndex,
      focusGraphemeIndex: focusIndex
    })
  }, {
    anchorIndex: anchorGraphemeIndex,
    focusIndex: focusGraphemeIndex
  })
}

/** 通过 hidden textarea 真实 input 事件在第一段开头插入文本。 */
async function insertTextAtFirstRunStart(page: Page, text: string): Promise<void> {
  await selectFirstRunRange(page, 0, 0)
  await page.evaluate((nextText) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 hidden textarea。')
    }

    input.focus()
    input.value = nextText
    input.dispatchEvent(new Event('input', {
      bubbles: true,
      cancelable: true
    }))
  }, text)
}

/** 读取批注 projection 与 range snapshot 定位结果。 */
async function readCommentAnchorProbe(page: Page): Promise<CommentAnchorProbe> {
  return page.evaluate(() => {
    const editor = window.__jwordTestFixture?.editor
    const projection = editor?.getProjection()
    const thread = projection?.document.comments?.[0]
    const located = thread === undefined ? null : editor?.locateRangeSnapshot(thread.rangeSnapshot) ?? null
    const firstBlock = projection?.document.sections[0]?.blocks[0]
    const firstParagraphText = firstBlock?.kind === 'paragraph'
      ? firstBlock.runs.map((run) => run.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('')).join('')
      : ''

    return {
      threadCount: projection?.document.comments?.length ?? 0,
      resolved: thread?.resolved ?? null,
      locatedOffsets: located === null || editor === undefined
        ? null
        : [
            located.anchor.graphemeIndex,
            located.focus.graphemeIndex
          ],
      firstParagraphText
    }
  })
}

/** 读取链接 projection 与当前活动链接。 */
async function readLinkProbe(page: Page): Promise<LinkProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const projection = demo?.editor.getProjection()
    const linkedRun = projection?.document.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'paragraph')
      .flatMap((block) => block.runs)
      .find((run) => run.link !== undefined)
    const linkedText = linkedRun?.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('') ?? null

    return {
      activeTarget: linkedRun?.link?.target ?? demo?.link.readActiveLink()?.target ?? null,
      linkedText,
      serializedProjection: JSON.stringify(projection)
    }
  })
}
