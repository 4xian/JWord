/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 4 选区浮动工具栏、右键菜单、快捷键和失焦收起路径。
 * 边界: 只覆盖 selection-actions 与 vanilla demo 的公开协作，不验证图片 overlay、系统剪贴板权限或后续批注/链接闭环。
 * 协作: examples/vanilla/src/main.ts、window.__jwordTestFixture、packages/ui/src/selection-actions/* 与 core Editor facade。
 * 约束: 断言来自真实 DOM 和公开 facade，不读取 controller 私有状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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

test('Gate 4 selection actions appear immediately after middle pointer drag on alpha text and keep bold color working', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForSelectionActionDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  const dragStart = await readClientPointForGrapheme(page, 18)
  const dragEnd = await readClientPointForGrapheme(page, 28)

  await page.mouse.move(dragStart.clientX, dragStart.clientY)
  await page.mouse.down()
  await page.mouse.move(dragEnd.clientX, dragEnd.clientY, { steps: 10 })
  await page.mouse.up()

  await expect(page.locator('[data-jword-floating-toolbar="true"]')).toBeVisible()
  await expect.poll(() => readCurrentSelectionRange(page)).toBe('18→28')

  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.bold"]').click()
  await expect.poll(() => readSelectionBold(page)).toBe(true)

  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]').click()
  const colorToolbarBox = await readElementBox(page.locator('[data-jword-floating-toolbar="true"]'))
  await previewColorValue(
    page,
    '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]',
    '#ff0000'
  )
  await expect.poll(() => readSelectionTextColor(page)).toBe('#ff0000')
  await expect.poll(() => readElementBox(page.locator('[data-jword-floating-toolbar="true"]'))).toMatchObject(colorToolbarBox)
})

test('Gate 4 selection actions keep color controls open on first direct color click', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForSelectionActionDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  const selection = await readTextSelectionTarget(page, 0, 3)
  const floatingToolbar = page.locator('[data-jword-floating-toolbar="true"]')
  const textColor = floatingToolbar.locator('[data-jword-selection-action="format.textColor"]')
  const backgroundColor = floatingToolbar.locator('[data-jword-selection-action="format.backgroundColor"]')
  const hiddenTextarea = page.locator('[data-jword-hidden-textarea]')

  await hiddenTextarea.focus()
  await selectTextRange(page, selection)
  await expect(floatingToolbar).toBeVisible()
  await textColor.click()
  await expect(floatingToolbar).toBeVisible()
  const textToolbarBox = await readElementBox(floatingToolbar)

  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]', '#cc2200')
  await expect.poll(() => readSelectionTextColor(page)).toBe('#cc2200')
  await expect.poll(() => readElementBox(floatingToolbar)).toMatchObject(textToolbarBox)

  await selectTextRange(page, selection)
  await expect(floatingToolbar).toBeVisible()
  await backgroundColor.click()
  await expect(floatingToolbar).toBeVisible()
  const backgroundToolbarBox = await readElementBox(floatingToolbar)

  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]', '#00aa66')
  await expect.poll(() => readSelectionBackgroundColor(page)).toBe('#00aa66')
  await expect.poll(() => readElementBox(floatingToolbar)).toMatchObject(backgroundToolbarBox)
})

test('Gate 4 selection actions reuse toolbar color state for text and background colors', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForSelectionActionDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  const selection = await readTextSelectionTarget(page, 0, 3)
  const floatingToolbar = page.locator('[data-jword-floating-toolbar="true"]')
  const hiddenTextarea = page.locator('[data-jword-hidden-textarea]')
  const toolbarTextColor = page.locator('[data-jword-format-text-color]')
  const toolbarBackgroundColor = page.locator('[data-jword-format-background-color]')

  await hiddenTextarea.focus()
  await selectTextRange(page, selection)
  await expect(floatingToolbar).toBeVisible()

  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]').click()
  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]', '#2255cc')

  await expect.poll(() => readSelectionTextColor(page)).toBe('#2255cc')
  await expect(toolbarTextColor).toHaveValue('#2255cc')
  await expect.poll(() => readFirstRenderedFragmentStyle(page)).toMatchObject({
    color: '#2255cc'
  })

  await selectTextRange(page, selection)
  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]').click()
  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]', '#66aa00')

  await expect.poll(() => readSelectionBackgroundColor(page)).toBe('#66aa00')
  await expect(toolbarBackgroundColor).toHaveValue('#66aa00')
  await expect.poll(() => readFirstRenderedFragmentStyle(page)).toMatchObject({
    color: '#2255cc',
    backgroundColor: '#66aa00'
  })
})

test('Gate 4 selection actions keep final text and background colors after preview and editor refocus', async ({ page }) => {
  await page.goto('/test-fixture.html')
  await waitForSelectionActionDemoReady(page)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()

  const selection = await readTextSelectionTarget(page, 0, 3)
  const hiddenTextarea = page.locator('[data-jword-hidden-textarea]')

  await hiddenTextarea.focus()
  await selectTextRange(page, selection)
  await expect(page.locator('[data-jword-floating-toolbar="true"]')).toBeVisible()

  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]').click()
  await finalizeColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]', '#cc2200')
  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.textColor"]', '#2255cc')
  await page.locator('#jword-editor').click()

  await expect.poll(() => readFirstRenderedFragmentStyle(page)).toMatchObject({
    color: '#2255cc'
  })

  await hiddenTextarea.focus()
  await selectTextRange(page, selection)
  await page.locator('[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]').click()
  await finalizeColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]', '#00aa66')
  await previewColorValue(page, '[data-jword-floating-toolbar="true"] [data-jword-selection-action="format.backgroundColor"]', '#66aa00')
  await page.locator('#jword-editor').click()

  await expect.poll(() => readFirstRenderedFragmentStyle(page)).toMatchObject({
    color: '#2255cc',
    backgroundColor: '#66aa00'
  })
})

test('Gate 4 selection actions show hide rebind and handle shortcut plus context clear', async ({ page }) => {
  await page.goto('/test-fixture.html')
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

  const firstToolbarBox = await floatingToolbar.boundingBox()

  if (firstToolbarBox === null) {
    throw new Error('缺少浮动工具栏初始位置')
  }

  await page.locator('[data-jword-selection-action="format.bold"]').click()
  await expect(floatingToolbar).toBeVisible()
  await expect.poll(() => readSelectionBold(page)).toBe(true)

  const afterBoldToolbarBox = await floatingToolbar.boundingBox()

  if (afterBoldToolbarBox === null) {
    throw new Error('缺少浮动工具栏 bold 后位置')
  }

  expect(Math.abs(afterBoldToolbarBox.x - firstToolbarBox.x)).toBeLessThanOrEqual(1)
  expect(Math.abs(afterBoldToolbarBox.y - firstToolbarBox.y)).toBeLessThanOrEqual(1)

  await applyColorValue(page, '[data-jword-selection-action="format.textColor"]', '#ff0000')
  await expect(floatingToolbar).toBeVisible()
  await expect.poll(() => readSelectionTextColor(page)).toBe('#ff0000')

  await applyColorValue(page, '[data-jword-selection-action="format.backgroundColor"]', '#00ff88')
  await expect(floatingToolbar).toBeVisible()
  await expect.poll(() => readSelectionBackgroundColor(page)).toBe('#00ff88')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+U' : 'Control+U')
  await expect(floatingToolbar).toBeVisible()
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
  await page.waitForFunction(() => window.__jwordTestFixture !== undefined)
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
    const demo = window.__jwordTestFixture

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
    window.__jwordTestFixture?.selectTextRange(selectionInput)
  }, selection)
}

/** 读取 alpha 页面上指定 grapheme 的真实浏览器命中点，用真实 pointer drag 回归浮动工具栏时序。 */
async function readClientPointForGrapheme(
  page: Page,
  graphemeIndex: number,
  pageIndex = 0
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate(({ targetGraphemeIndex, targetPageIndex }) => {
    const demo = window.__jwordTestFixture
    const layout = demo?.editor.getLayout()
    const pageBox = layout?.pages[targetPageIndex]
    const wrapper = document.querySelector<HTMLElement>(`[data-jword-page="${targetPageIndex}"]`)

    if (demo === undefined || pageBox === undefined || wrapper === null) {
      throw new Error('缺少 Gate 4 pointer probe 所需的布局或 DOM')
    }

    const rect = wrapper.getBoundingClientRect()
    const scaleX = rect.width / pageBox.width
    const scaleY = rect.height / pageBox.height
    const fragmentMatches = pageBox.lines.flatMap((line) =>
      line.fragments.map((fragment) => ({
        line,
        fragment
      }))
    )
    const containingFragmentMatch = fragmentMatches.find(({ fragment }) => {
      return targetGraphemeIndex >= fragment.start.graphemeIndex
        && targetGraphemeIndex <= fragment.end.graphemeIndex
    })

    if (containingFragmentMatch === undefined) {
      throw new Error(`找不到 grapheme ${targetGraphemeIndex} 的布局片段`)
    }

    const { line, fragment } = containingFragmentMatch
    const graphemeOffset = targetGraphemeIndex - fragment.start.graphemeIndex
    const targetAdvance = fragment.advanceTwips[graphemeOffset] ?? fragment.width
    const previousAdvance = fragment.advanceTwips[Math.max(0, graphemeOffset - 1)] ?? 0
    const nextAdvance = fragment.advanceTwips[Math.min(fragment.advanceTwips.length - 1, graphemeOffset + 1)]
      ?? fragment.width
    const lowerBound = graphemeOffset <= 0
      ? 0
      : previousAdvance + ((targetAdvance - previousAdvance) / 2)
    const upperBound = graphemeOffset >= fragment.advanceTwips.length - 1
      ? fragment.width
      : targetAdvance + ((nextAdvance - targetAdvance) / 2)
    const targetOffset = lowerBound + ((upperBound - lowerBound) / 2)

    return {
      clientX: Math.round(rect.left + (fragment.x - pageBox.x + targetOffset) * scaleX),
      clientY: Math.round(rect.top + (line.y - pageBox.y + line.height * 0.5) * scaleY)
    }
  }, {
    targetGraphemeIndex: graphemeIndex,
    targetPageIndex: pageIndex
  })
}

/** 读取当前 editor 选区的 grapheme 范围，避免依赖 demo 调试摘要是否展示。 */
async function readCurrentSelectionRange(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = window.__jwordTestFixture?.editor
    const selection = editor?.getSelection()

    if (editor === undefined || selection === undefined || selection === null) {
      return ''
    }

    const anchor = editor.resolveTextPosition(selection.anchor)
    const focus = editor.resolveTextPosition(selection.focus)

    return `${anchor.graphemeIndex}→${focus.graphemeIndex}`
  })
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
    const underline = window.__jwordTestFixture?.editor.getSelectionFormattingState().run?.underline

    return underline === undefined || underline.mixed ? null : underline.value === true
  })
}

/** 读取当前选区 bold 状态。 */
async function readSelectionBold(page: Page): Promise<boolean | null> {
  return page.evaluate(() => {
    const bold = window.__jwordTestFixture?.editor.getSelectionFormattingState().run?.bold

    return bold === undefined || bold.mixed ? null : bold.value === true
  })
}

/** 读取当前选区文字颜色。 */
async function readSelectionTextColor(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const color = window.__jwordTestFixture?.editor.getSelectionFormattingState().run?.color

    return color === undefined || color.mixed ? null : color.value?.toLowerCase() ?? null
  })
}

/** 读取当前选区背景色。 */
async function readSelectionBackgroundColor(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const color = window.__jwordTestFixture?.editor.getSelectionFormattingState().run?.backgroundColor

    return color === undefined || color.mixed ? null : color.value?.toLowerCase() ?? null
  })
}

/** 读取首个渲染 fragment 的样式，确认颜色最终进入内容区布局。 */
async function readFirstRenderedFragmentStyle(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const fragment = window.__jwordTestFixture?.editor.getLayout().pages[0]?.lines[0]?.fragments[0]

    if (fragment === undefined) {
      throw new Error('缺少首个渲染片段')
    }

    return { ...fragment.style }
  })
}

/** 读取元素位置，回归颜色预览时浮层不应漂移到页面顶部。 */
async function readElementBox(locator: ReturnType<Page['locator']>): Promise<Readonly<{
  x: number
  y: number
}>> {
  const box = await locator.boundingBox()

  if (box === null) {
    throw new Error('缺少可见元素位置')
  }

  return {
    x: Math.round(box.x),
    y: Math.round(box.y)
  }
}

/** 对隐藏颜色 input 直接写入值并派发 change，复现真实 picker 提交结果。 */
async function applyColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.dispatchEvent(new Event('click', { bubbles: true }))
    node.value = nextValue as string
    node.dispatchEvent(new Event('input', { bubbles: true }))
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** 模拟原生颜色面板派发 change 后仍保持面板打开的中间状态。 */
async function finalizeColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

/** 模拟原生颜色面板拖动/选择时的即时 input 事件。 */
async function previewColorValue(page: Page, selector: string, value: string): Promise<void> {
  await page.locator(selector).evaluate((input, nextValue) => {
    const node = input as HTMLInputElement

    node.value = nextValue as string
    node.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}
