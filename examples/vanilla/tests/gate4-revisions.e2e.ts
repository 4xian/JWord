/**
 * @fileoverview 职责: 用真实浏览器覆盖 Gate 4 修订 metadata 面板的最小验收路径。
 * 边界: 只验证官方 UI 在 vanilla host 的装配、revision metadata 落地、点击定位和基础 undo/redo，不实现接受/拒绝修订。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/revisions/*、core revision command 与 editor facade。
 * 约束: 断言来自真实 DOM 或 window.__jwordDemo.editor 公开 facade，不读取 controller 私有状态。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.14。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface RevisionProbe {
  readonly revisionCount: number
  readonly authorId: string | null
  readonly type: string | null
  readonly summary: string | null
  readonly rangeId: string | null
  readonly rangeSnapshotId: string | null
  readonly locatedRangeOffsets: readonly [number, number] | null
  readonly runRevisionId: string | null
  readonly selectionOffsets: readonly [number, number] | null
}

test('Gate 4 revisions panel shows metadata and restores selection from range snapshot', async ({ page }) => {
  await page.goto('/')
  await waitForRevisionDemoReady(page)

  await page.evaluate(() => {
    window.__jwordDemo?.selectTextRange({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      anchorGraphemeIndex: 1,
      focusGraphemeIndex: 4
    })
  })

  await expect.poll(() => addRevision(page)).toBe(true)
  await expect.poll(() => readRevisionProbe(page)).toMatchObject({
    revisionCount: 1,
    authorId: 'demo-user',
    type: 'format',
    summary: '设置加粗',
    rangeId: 'revision-range-1',
    rangeSnapshotId: 'revision-range-1',
    locatedRangeOffsets: [1, 4],
    runRevisionId: 'revision-1'
  })

  const item = page.locator('[data-jword-revision-item]').first()

  await expect(item).toBeVisible()
  await expect(item).toContainText('格式')
  await expect(item).toContainText('设置加粗')
  await expect(item).toContainText('demo-user')

  await page.evaluate(() => {
    window.__jwordDemo?.selectTextRange({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      anchorGraphemeIndex: 0,
      focusGraphemeIndex: 0
    })
  })
  await item.click()

  await expect.poll(() => readRevisionProbe(page)).toMatchObject({
    selectionOffsets: [1, 4]
  })

  await page.evaluate(() => window.__jwordDemo?.editor.undo())
  await expect.poll(() => readRevisionProbe(page)).toMatchObject({
    revisionCount: 0,
    runRevisionId: null
  })
  await expect(page.locator('[data-jword-revision-item]')).toHaveCount(0)

  await page.evaluate(() => window.__jwordDemo?.editor.redo())
  await expect.poll(() => readRevisionProbe(page)).toMatchObject({
    revisionCount: 1,
    runRevisionId: 'revision-1'
  })
})

/** 等待 demo、editor 和修订官方 UI 完成挂载。 */
async function waitForRevisionDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo?.revisions !== undefined)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
  await expect(page.locator('[data-jword-revisions-panel]')).toBeVisible()
}

/** 通过 demo hook 创建一条 revision metadata。 */
async function addRevision(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__jwordDemo?.revisions.addRevision({
    authorId: 'demo-user',
    createdAt: '2026-05-24T04:45:00.000Z',
    type: 'format',
    summary: '设置加粗'
  }) ?? false)
}

/** 读取 revision projection、run markup 和当前 selection。 */
async function readRevisionProbe(page: Page): Promise<RevisionProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordDemo
    const projection = demo?.editor.getProjection()
    const revision = projection?.document.revisions?.[0]
    const block = projection?.document.sections[0]?.blocks[0]
    const run = block?.kind === 'paragraph' ? block.runs[0] : undefined
    const locatedRange = revision === undefined ? null : demo?.editor.locateRangeSnapshot(revision.rangeSnapshot) ?? null

    return {
      revisionCount: demo?.revisions.readRevisionCount() ?? 0,
      authorId: revision?.authorId ?? null,
      type: revision?.type ?? null,
      summary: revision?.summary ?? null,
      rangeId: revision?.rangeId ?? null,
      rangeSnapshotId: revision?.rangeSnapshot.id ?? null,
      locatedRangeOffsets: locatedRange === null
        ? null
        : [locatedRange.anchor.graphemeIndex, locatedRange.focus.graphemeIndex],
      runRevisionId: run?.revisionId ?? null,
      selectionOffsets: demo?.revisions.readSelectionOffsets() ?? null
    }
  })
}
