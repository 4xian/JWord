/**
 * @fileoverview 职责: 用真实浏览器覆盖 Gate 4 目录跳转与查找替换官方 UI 的最小验收路径。
 * 边界: 只验证 vanilla demo 中 createJWordUi 装配的 headingOutline/findReplace 面板，不实现 demo-only 查找逻辑。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/heading、packages/ui/src/find-replace 与 core heading/find helper。
 * 约束: 所有断言来自真实 DOM、window.__jwordTestFixture 公开 facade 或 editor projection；替换不得绕过 transaction pipeline。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface StructureFindProbe {
  readonly selectionBlockId: string | null
  readonly selectionOffsets: readonly [number, number] | null
  readonly paragraphTexts: readonly string[]
  readonly transactionNames: readonly string[]
}

test('Gate 4 heading outline clicks stable anchor and find replace UI writes through transactions', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForStructureFindDemoReady(page)
  await prepareStructureFindDocument(page)

  await page.locator('[data-jword-toggle-heading-outline]').click()

  await expect(page.locator('[data-jword-heading-outline-item="paragraph-1:heading"]')).toHaveText('第一章')
  await expect(page.locator('[data-jword-heading-outline-item="paragraph-3:heading"]')).toHaveText('第二章 alpha')

  await page.locator('[data-jword-heading-outline-item="paragraph-3:heading"]').click()
  await expect.poll(() => readStructureFindProbe(page)).toMatchObject({
    selectionBlockId: 'paragraph-3',
    selectionOffsets: [0, 0]
  })

  await page.locator('[data-jword-hidden-textarea]').focus()
  await page.keyboard.press('Control+F')
  await expect(page.locator('[data-jword-find-replace]')).toBeVisible()
  await expect(page.locator('[data-jword-find-query-input]')).toBeFocused()

  await page.locator('[data-jword-find-close-button]').click()
  await page.locator('[data-jword-hidden-textarea]').focus()
  await page.keyboard.press('Control+H')
  await expect(page.locator('[data-jword-find-replace]')).toBeVisible()
  await expect(page.locator('[data-jword-find-replacement-input]')).toBeFocused()
  await page.locator('[data-jword-find-close-button]').click()

  await page.locator('[data-jword-open-find-replace]').click()
  await expect(page.locator('[data-jword-find-status]')).toBeHidden()

  await page.locator('[data-jword-find-query-input]').fill('alpha')
  await page.locator('[data-jword-find-replacement-input]').fill('ALPHA')
  await page.locator('[data-jword-find-button]').click()

  await expect(page.locator('[data-jword-find-status]')).toHaveText('1 / 3')
  await expect(page.locator('[data-jword-find-status]')).toBeVisible()
  await expect(page.locator('[data-jword-find-match-index]')).toHaveCount(3)
  await expect(page.locator('[data-jword-find-active="true"]')).toHaveAttribute('data-jword-find-match-index', '0')
  await expect(page.locator('[data-jword-find-replace-overlay]')).toHaveCSS('pointer-events', 'none')
  await expect(page.locator('[data-jword-find-match-index]').first()).toHaveCSS('outline-style', 'none')
  await expect(page.locator('[data-jword-find-match-index]').first()).toHaveCSS('border-top-width', '0px')
  await expect(page.locator('[data-jword-find-active="false"]').first()).toHaveCSS('outline-style', 'none')
  await expect(page.locator('[data-jword-find-active="false"]').first()).toHaveCSS('border-top-width', '0px')
  expect(await readFindOverlayHitProbe(page)).toMatchObject({
    activeAndInactiveBackgroundDiffer: true,
    pointerTargetInsideFindOverlay: false
  })
  await expect.poll(() => readStructureFindProbe(page)).toMatchObject({
    selectionBlockId: 'paragraph-2',
    selectionOffsets: [0, 5]
  })

  await page.locator('[data-jword-find-next-button]').click()
  await expect(page.locator('[data-jword-find-active="true"]')).toHaveAttribute('data-jword-find-match-index', '1')
  await page.locator('[data-jword-find-previous-button]').click()
  await expect(page.locator('[data-jword-find-active="true"]')).toHaveAttribute('data-jword-find-match-index', '0')

  await page.locator('[data-jword-replace-button]').click()
  await expect(page.locator('[data-jword-find-status]')).toHaveText('1 / 2')
  await expect(page.locator('[data-jword-find-match-index]')).toHaveCount(2)
  await expect(page.locator('[data-jword-find-active="true"]')).toHaveAttribute('data-jword-find-match-index', '0')
  await expect.poll(() => readStructureFindProbe(page)).toMatchObject({
    paragraphTexts: ['第一章', 'ALPHA beta alpha', '第二章 alpha']
  })

  await page.locator('[data-jword-replace-all-button]').click()
  await expect(page.locator('[data-jword-find-status]')).toBeHidden()
  await expect(page.locator('[data-jword-find-match-index]')).toHaveCount(0)

  const probe = await readStructureFindProbe(page)

  expect(probe.paragraphTexts).toEqual(['第一章', 'ALPHA beta ALPHA', '第二章 ALPHA'])
  expect(probe.transactionNames.filter((name) => name === 'replaceTextMatch')).toHaveLength(3)
})

test('Gate 4 heading outline collapse hides child rows', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForStructureFindDemoReady(page)
  await prepareNestedHeadingDocument(page)

  await page.locator('[data-jword-toggle-heading-outline]').click()

  await expect(page.locator('[data-jword-heading-outline-item="paragraph-1:heading"]')).toHaveText('第一章')
  await expect(page.locator('[data-jword-heading-outline-item="paragraph-2:heading"]')).toHaveText('第一节')

  await page.locator('[data-jword-heading-outline-item="paragraph-1:heading"] [data-jword-heading-outline-toggle]').click()
  await expect(page.locator('[data-jword-heading-outline-item="paragraph-2:heading"]')).toBeHidden()

  await page.locator('[data-jword-heading-outline-item="paragraph-1:heading"] [data-jword-heading-outline-toggle]').click()
  await expect(page.locator('[data-jword-heading-outline-item="paragraph-2:heading"]')).toBeVisible()
})

/** 等待 demo、目录面板与查找替换面板完成挂载。 */
async function waitForStructureFindDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
  await expect(page.locator('[data-jword-heading-outline]')).toHaveCount(1)
  await expect(page.locator('[data-jword-find-replace]')).toHaveCount(1)
}

/** 准备带 Heading1/Heading2 与多个 alpha 结果的小文档。 */
async function prepareStructureFindDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

    if (demo === undefined) {
      throw new Error('缺少 JWord demo facade。')
    }

    const demoFacade = demo

    demoFacade.editor.createDocument({
      text: '第一章\n\nalpha beta alpha\n\n第二章 alpha'
    })

    const transactionNames: string[] = []
    const unsubscribe = demoFacade.editor.subscribe((event) => {
      if (event.kind === 'transaction') {
        transactionNames.push(event.transaction.commandName)
      }
    })

    window.__jwordGate4StructureFindProbe = {
      transactionNames,
      unsubscribe
    }
    setParagraphStyleByIndex(0, 'Heading1')
    setParagraphStyleByIndex(2, 'Heading2')

    /** 给指定段落设置样式，复用公开 demo selection hook 和 editor command。 */
    function setParagraphStyleByIndex(paragraphIndex: number, styleId: string): void {
      const section = demoFacade.editor.getProjection().document.sections[0]
      const block = section?.blocks[paragraphIndex]
      const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

      if (section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
        throw new Error('缺少 heading 测试段落。')
      }

      demoFacade.selectTextRange({
        sectionId: section.id,
        blockId: block.id,
        runId: run.id,
        anchorGraphemeIndex: 0,
        focusGraphemeIndex: 0
      })
      demoFacade.editor.setParagraphStyle(styleId)
    }
  })
}

/** 准备带父子标题的小文档。 */
async function prepareNestedHeadingDocument(page: Page): Promise<void> {
  await page.evaluate(() => {
    const demo = window.__jwordTestFixture

    if (demo === undefined) {
      throw new Error('缺少 JWord demo facade。')
    }

    const readyDemo = demo

    readyDemo.editor.createDocument({
      text: '第一章\n\n第一节\n\n正文'
    })

    setParagraphStyleByIndex(0, 'Heading1')
    setParagraphStyleByIndex(1, 'Heading2')

    /** 给指定段落设置样式，复用公开 demo selection hook 和 editor command。 */
    function setParagraphStyleByIndex(paragraphIndex: number, styleId: string): void {
      const section = readyDemo.editor.getProjection().document.sections[0]
      const block = section?.blocks[paragraphIndex]
      const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

      if (section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
        throw new Error('缺少 heading 测试段落。')
      }

      readyDemo.selectTextRange({
        sectionId: section.id,
        blockId: block.id,
        runId: run.id,
        anchorGraphemeIndex: 0,
        focusGraphemeIndex: 0
      })
      readyDemo.editor.setParagraphStyle(styleId)
    }
  })
}

/** 读取结构与查找替换关键结果。 */
async function readStructureFindProbe(page: Page): Promise<StructureFindProbe> {
  return page.evaluate(() => {
    const demo = window.__jwordTestFixture
    const selection = demo?.editor.getSelection()
    const anchorPosition = selection === null || selection === undefined
      ? null
      : demo?.editor.resolveTextPosition(selection.anchor) ?? null
    const focusPosition = selection === null || selection === undefined
      ? null
      : demo?.editor.resolveTextPosition(selection.focus) ?? null
    const blocks = demo?.editor.getProjection().document.sections[0]?.blocks ?? []
    const paragraphTexts = blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.flatMap((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])).join('')]
      : [])

    return {
      selectionBlockId: anchorPosition?.blockId ?? null,
      selectionOffsets: anchorPosition === null || focusPosition === null
        ? null
        : [anchorPosition.graphemeIndex, focusPosition.graphemeIndex],
      paragraphTexts,
      transactionNames: window.__jwordGate4StructureFindProbe?.transactionNames ?? []
    }
  })
}

/** 读取查找 overlay 在真实 hit-test 下是否挡住底层页面。 */
async function readFindOverlayHitProbe(page: Page): Promise<{
  readonly activeAndInactiveBackgroundDiffer: boolean
  readonly pointerTargetInsideFindOverlay: boolean
}> {
  return page.evaluate(() => {
    const active = document.querySelector<HTMLElement>('[data-jword-find-active="true"]')
    const inactive = document.querySelector<HTMLElement>('[data-jword-find-active="false"]')

    if (active === null || inactive === null) {
      return {
        activeAndInactiveBackgroundDiffer: false,
        pointerTargetInsideFindOverlay: true
      }
    }

    const activeRect = active.getBoundingClientRect()
    const target = document.elementFromPoint(
      activeRect.left + activeRect.width / 2,
      activeRect.top + activeRect.height / 2
    )

    return {
      activeAndInactiveBackgroundDiffer:
        getComputedStyle(active).backgroundColor !== getComputedStyle(inactive).backgroundColor,
      pointerTargetInsideFindOverlay:
        target instanceof Element && target.closest('[data-jword-find-replace-overlay]') !== null
    }
  })
}

declare global {
  interface Window {
    __jwordGate4StructureFindProbe?: {
      readonly transactionNames: string[]
      readonly unsubscribe: () => void
    }
  }
}
