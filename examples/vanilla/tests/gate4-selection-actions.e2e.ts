/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 4 选区浮动工具栏、右键菜单、快捷键和失焦收起路径。
 * 边界: 只覆盖 selection-actions 与 vanilla demo 的公开协作，不验证图片 overlay、系统剪贴板权限或后续批注/链接闭环。
 * 协作: examples/vanilla/src/main.ts、window.__jwordDemo、packages/ui/src/selection-actions/* 与 core Editor facade。
 * 约束: 断言来自真实 DOM 和公开 facade，不读取 controller 私有状态。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Iteration 1 后续收尾。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface TextSelectionTarget {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly anchorGraphemeIndex: number
  readonly focusGraphemeIndex: number
}

test.describe.configure({ mode: 'serial' })

test('Gate 4 selection actions show hide rebind and handle shortcut plus context clear', async ({ page }) => {
  await page.goto('/')
  await waitForSelectionActionDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  const firstSelection = await readTextSelectionTarget(page, 0, 3)
  const floatingToolbar = page.locator('[data-jword-floating-toolbar="true"]')
  const contextMenu = page.locator('[data-jword-context-menu="true"]')
  const hiddenTextarea = page.locator('[data-jword-hidden-textarea]')

  await hiddenTextarea.focus()
  await selectTextRange(page, firstSelection)
  await expect(floatingToolbar).toBeVisible()
  await expect(contextMenu).toBeHidden()

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+U' : 'Control+U')
  await expect(page.locator('[data-jword-selection-action="format.underline"]')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => readSelectionUnderline(page)).toBe(true)

  await rightClickEditor(page)
  await expect(contextMenu).toBeVisible()
  await expect(floatingToolbar).toBeHidden()
  await expect(contextMenu).toContainText('剪切')
  await expect(contextMenu).toContainText('⌘+X')
  const firstContextKey = await contextMenu.getAttribute('data-jword-selection-key')

  await page.locator('[data-jword-context-action="format.clear"]').click()
  await expect.poll(() => readSelectionUnderline(page)).toBe(false)

  const secondSelection = await readTextSelectionTarget(page, 1, 4)

  await selectTextRange(page, secondSelection)
  await rightClickEditor(page)
  await expect(contextMenu).toBeVisible()
  await expect.poll(async () => contextMenu.getAttribute('data-jword-selection-key')).not.toBe(firstContextKey)

  await page.mouse.click(8, 8)
  await expect(floatingToolbar).toBeHidden()
  await expect(contextMenu).toBeHidden()
})

/** 等待 demo、toolbar 和 selection actions DOM 都完成挂载。 */
async function waitForSelectionActionDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.locator('[data-jword-floating-toolbar="true"]')).toHaveCount(1)
  await expect(page.locator('[data-jword-context-menu="true"]')).toHaveCount(1)
}

/** 从首个段落 run 构造当前测试需要的文本选区。 */
async function readTextSelectionTarget(
  page: Page,
  anchorGraphemeIndex: number,
  focusGraphemeIndex: number
): Promise<TextSelectionTarget> {
  return page.evaluate((input) => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 4 demo 测试钩子')
    }

    const firstSection = demo.editor.getProjection().document.sections[0]
    const firstBlock = firstSection?.blocks[0]
    const firstRun = firstBlock?.kind === 'paragraph' ? firstBlock.runs[0] : undefined

    if (firstSection === undefined || firstBlock === undefined || firstBlock.kind !== 'paragraph' || firstRun === undefined) {
      throw new Error('缺少首段文本选区目标')
    }

    const textLength = firstRun.inlines.reduce((length, inline) => {
      if (inline.kind !== 'text') {
        return length
      }

      return length + Array.from(inline.text).length
    }, 0)
    const anchorIndex = Math.min(input.anchorGraphemeIndex, Math.max(0, textLength - 1))
    const focusIndex = Math.min(input.focusGraphemeIndex, textLength)

    if (anchorIndex === focusIndex) {
      throw new Error('测试选区不能折叠')
    }

    return {
      sectionId: firstSection.id,
      blockId: firstBlock.id,
      runId: firstRun.id,
      anchorGraphemeIndex: anchorIndex,
      focusGraphemeIndex: focusIndex
    }
  }, {
    anchorGraphemeIndex,
    focusGraphemeIndex
  })
}

/** 通过公开 demo hook 选择一段文本。 */
async function selectTextRange(page: Page, selection: TextSelectionTarget): Promise<void> {
  await page.evaluate((selectionInput) => {
    window.__jwordDemo?.selectTextRange(selectionInput)
  }, selection)
}

/** 在 editor 区域触发真实右键事件。 */
async function rightClickEditor(page: Page): Promise<void> {
  const editorBox = await page.locator('#jword-editor').boundingBox()

  if (editorBox === null) {
    throw new Error('缺少 #jword-editor 位置')
  }

  await page.mouse.click(editorBox.x + 120, editorBox.y + 120, { button: 'right' })
}

/** 读取当前选区 underline 状态。 */
async function readSelectionUnderline(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const underline = window.__jwordDemo?.editor.getSelectionFormattingState().run?.underline

    return underline === undefined || underline.mixed ? null : underline.value === true
  })
}
