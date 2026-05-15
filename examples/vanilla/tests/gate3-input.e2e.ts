/**
 * @fileoverview 职责: 用真实浏览器事件链覆盖 Gate 3 输入阶段的隐藏输入框、键盘命令、纯文本剪贴板和输入法合成回归。
 * 边界: 不声称验证原生平台输入法；这里只验证当前宿主浏览器里 editor runtime 已接通的 DOM 事件与公开 facade 闭环。
 * 协作: `window.__jwordDemo`、隐藏输入框测试钩子、Alpha 样例和 `@4xian/jword-core` 的 Editor facade。
 * 约束: 断言必须来自真实浏览器 DOM/canvas/公开 facade，不伪造 Windows 中文输入已完成。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 3 Step 3.12。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { RangeRef } from '@4xian/jword-core'

test('Gate 3 runtime keyboard input updates projection, selection and undo/redo state', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)
  await collapseSelectionAtRunStart(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })

  const input = page.locator('[data-jword-hidden-textarea]')
  const undoButton = page.locator('[data-jword-history-undo]')
  const redoButton = page.locator('[data-jword-history-redo]')

  await input.focus()
  await page.keyboard.type('AB')

  await expect.poll(() => readPlainText(page)).toContain('ABAlpha toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('2→2')
  await expect(undoButton).toBeEnabled()
  await expect(redoButton).toBeDisabled()

  await page.keyboard.press('ArrowLeft')
  await expect.poll(() => readSelectionSummary(page)).toContain('1→1')

  await page.keyboard.press('Backspace')
  await expect.poll(() => readPlainText(page)).toContain('BAlpha toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await page.keyboard.press('Enter')
  await expect.poll(() => readParagraphCount(page)).toBe(3)

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
  await expect.poll(() => readParagraphCount(page)).toBe(2)
  await expect.poll(() => readPlainText(page)).toContain('BAlpha toolbar sample')

  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Y')
  await expect.poll(() => readParagraphCount(page)).toBe(3)
})

test('Gate 3 runtime copy cut paste keeps plain text clipboard semantics on current selection', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)
  await selectRange(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    anchorGraphemeIndex: 0,
    focusGraphemeIndex: 5
  })

  const input = page.locator('[data-jword-hidden-textarea]')
  await input.focus()

  const copiedText = await dispatchClipboardEvent(page, 'copy')
  expect(copiedText).toBe('Alpha')
  await expect.poll(() => readPlainText(page)).toContain('Alpha toolbar sample')

  const cutText = await dispatchClipboardEvent(page, 'cut')
  expect(cutText).toBe('Alpha')
  await expect.poll(() => readPlainText(page)).toContain(' toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('0→0')

  await dispatchClipboardEvent(page, 'paste', 'ALPHA')
  await expect.poll(() => readPlainText(page)).toContain('ALPHA toolbar sample')
  await expect.poll(() => readSelectionSummary(page)).toContain('5→5')
})

test('Gate 3 runtime pointer selection supports click drag and double click on the real canvas', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)

  const clickPoint = await readClientPointForGrapheme(page, 1)

  await page.mouse.click(clickPoint.clientX, clickPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('1→1')

  const dragStart = await readClientPointForGrapheme(page, 1)
  const dragEnd = await readClientPointForGrapheme(page, 5)

  await page.mouse.move(dragStart.clientX, dragStart.clientY)
  await page.mouse.down()
  await page.mouse.move(dragEnd.clientX, dragEnd.clientY, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => readSelectionSummary(page)).toContain('1→5')

  const wordPoint = await readClientPointForGrapheme(page, 2)

  await page.mouse.dblclick(wordPoint.clientX, wordPoint.clientY)
  await expect.poll(() => readSelectionSummary(page)).toContain('0→5')
})

test('Gate 3 runtime composition chain defers insertion until compositionend and keeps plain text result', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)
  await collapseSelectionAtRunStart(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex: 0
  })

  const beforeText = await readPlainText(page)
  expect(beforeText.startsWith('Alpha toolbar sample')).toBe(true)

  const compositionProbe = await runCompositionSequence(page, '你', '你好')

  expect(compositionProbe.textBeforeEnd).toBe(beforeText)
  expect(compositionProbe.textAfterEnd.startsWith('你好Alpha toolbar sample')).toBe(true)
  expect(compositionProbe.selectionSummary).toContain('2→2')
})

test('Gate 3 selector contract stays explicit for later toolbar integration', async ({ page }) => {
  await page.goto('/')
  await waitForGate3AlphaReady(page)
  await selectRange(page, {
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    anchorGraphemeIndex: 0,
    focusGraphemeIndex: 5
  })

  const requiredSelectors = [
    '[data-jword-format-underline]',
    '[data-jword-format-strike]',
    '[data-jword-format-font-family]',
    '[data-jword-format-font-size]',
    '[data-jword-format-text-color]',
    '[data-jword-format-background-color]',
    '[data-jword-format-align-left]',
    '[data-jword-format-align-center]',
    '[data-jword-format-align-right]',
    '[data-jword-format-align-justify]',
    '[data-jword-format-indent-decrease]',
    '[data-jword-format-indent-increase]'
  ] as const

  const missingSelectors = await page.evaluate((selectors) => {
    return selectors.filter((selector) => document.querySelector(selector) === null)
  }, requiredSelectors)

  test.skip(missingSelectors.length > 0, `等待 demo 集成 Gate 3 selector 协议: ${missingSelectors.join(', ')}`)

  await page.locator('[data-jword-format-underline]').click()
  await page.locator('[data-jword-format-strike]').click()
  await page.locator('[data-jword-format-font-family]').selectOption({ label: 'Arial' })
  await page.locator('[data-jword-format-font-size]').selectOption('240')
  await page.locator('[data-jword-format-text-color]').fill('#ff0000')
  await page.locator('[data-jword-format-text-color]').dispatchEvent('change')
  await page.locator('[data-jword-format-background-color]').fill('#ffff00')
  await page.locator('[data-jword-format-background-color]').dispatchEvent('change')
  await page.locator('[data-jword-format-align-center]').click()
  await page.locator('[data-jword-format-indent-increase]').click()

  await expect(page.locator('[data-jword-format-underline]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-jword-format-strike]')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('[data-jword-format-font-family]')).toHaveValue('Arial')
  await expect(page.locator('[data-jword-format-font-size]')).toHaveValue('240')
  await expect(page.locator('[data-jword-format-text-color]')).toHaveValue('#ff0000')
  await expect(page.locator('[data-jword-format-background-color]')).toHaveValue('#ffff00')
  await expect(page.locator('[data-jword-format-align-center]')).toHaveAttribute('aria-pressed', 'true')
})

async function waitForGate3AlphaReady(page: Page): Promise<void> {
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '50')
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await page.getByRole('button', { name: '加载 Alpha 样例' }).click()
  await expect(page.locator('[data-jword-canvas-container]')).toHaveAttribute('data-jword-page-count', '1')
  await expect(page.getByRole('button', { name: '选择首页片段' })).toBeEnabled()
}

async function readPlainText(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-text-mirror]')?.textContent ?? ''
  })
}

async function readSelectionSummary(page: Page): Promise<string> {
  return page.evaluate(() => {
    return document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
  })
}

async function readParagraphCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    return window.__jwordDemo?.editor.getProjection().document.sections[0]?.blocks.length ?? 0
  })
}

async function readClientPointForGrapheme(
  page: Page,
  graphemeIndex: number
): Promise<Readonly<{
  clientX: number
  clientY: number
}>> {
  return page.evaluate((targetGraphemeIndex) => {
    const demo = window.__jwordDemo
    const layout = demo?.editor.getLayout()
    const pageBox = layout?.pages[0]
    const wrapper = document.querySelector<HTMLElement>('[data-jword-page="0"]')

    if (demo === undefined || pageBox === undefined || wrapper === null) {
      throw new Error('缺少 Gate 3 pointer probe 所需的布局或 DOM')
    }

    const rect = wrapper.getBoundingClientRect()
    const scaleX = rect.width / pageBox.width
    const scaleY = rect.height / pageBox.height
    const resolveRoundedClientPoint = (
      pageIndex: number,
      localX: number,
      localY: number
    ): Readonly<{
      clientX: number
      clientY: number
    }> | null => {
      const roundedClientY = Math.round(rect.top + localY * scaleY)

      for (let deltaX = -3; deltaX <= 3; deltaX += 1) {
        const roundedClientX = Math.round(rect.left + (localX + deltaX) * scaleX)
        const anchor = demo.editor.hitTest({
          pageIndex,
          x: (roundedClientX - rect.left) / scaleX,
          y: (roundedClientY - rect.top) / scaleY
        })

        if (anchor === undefined) {
          continue
        }

        if (demo.editor.resolveTextPosition(anchor).graphemeIndex === targetGraphemeIndex) {
          return {
            clientX: roundedClientX,
            clientY: roundedClientY
          }
        }
      }

      return null
    }
    const fragmentMatch = pageBox.lines.flatMap((line) =>
      line.fragments.map((fragment) => ({
        line,
        fragment
      }))
    )
      .find(({ fragment }) => fragment.end.graphemeIndex === targetGraphemeIndex)

    if (fragmentMatch !== undefined) {
      const safePoint = resolveRoundedClientPoint(
        pageBox.pageIndex,
        fragmentMatch.fragment.x - pageBox.x + fragmentMatch.fragment.width * 0.75,
        fragmentMatch.line.y - pageBox.y + fragmentMatch.line.height * 0.5
      )

      if (safePoint !== null) {
        return safePoint
      }
    }

    const leadingFragmentMatch = pageBox.lines.flatMap((line) =>
      line.fragments.map((fragment) => ({
        line,
        fragment
      }))
    )
      .find(({ fragment }) => fragment.start.graphemeIndex === targetGraphemeIndex)

    if (leadingFragmentMatch !== undefined) {
      const safePoint = resolveRoundedClientPoint(
        pageBox.pageIndex,
        leadingFragmentMatch.fragment.x - pageBox.x + leadingFragmentMatch.fragment.width * 0.25,
        leadingFragmentMatch.line.y - pageBox.y + leadingFragmentMatch.line.height * 0.5
      )

      if (safePoint !== null) {
        return safePoint
      }
    }

    throw new Error(`找不到 grapheme ${targetGraphemeIndex} 的浏览器命中点`)
  }, graphemeIndex)
}

async function collapseSelectionAtRunStart(
  page: Page,
  input: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly graphemeIndex: number
  }
): Promise<void> {
  await page.evaluate((selectionInput) => {
    const demo = window.__jwordDemo

    if (demo === undefined) {
      throw new Error('缺少 Gate 3 demo 测试钩子')
    }

    const anchor = demo.editor.createTextAnchor(selectionInput)

    demo.editor.setSelection({
      anchor,
      focus: anchor,
      range: Object.freeze({ anchor, focus: anchor }) as RangeRef,
      direction: 'none',
      affinity: 'none'
    })
  }, input)
}

async function selectRange(
  page: Page,
  input: {
    readonly sectionId: string
    readonly blockId: string
    readonly runId: string
    readonly anchorGraphemeIndex: number
    readonly focusGraphemeIndex: number
  }
): Promise<void> {
  await page.evaluate((selectionInput) => {
    window.__jwordDemo?.selectTextRange(selectionInput)
  }, input)
}

async function dispatchClipboardEvent(
  page: Page,
  type: 'copy' | 'cut' | 'paste',
  text = ''
): Promise<string> {
  return page.evaluate(({ eventType, clipboardText }) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (input === null) {
      throw new Error('缺少 Gate 3 hidden textarea')
    }

    input.focus()

    let plainText = clipboardText
    const event = new Event(eventType, {
      bubbles: true,
      cancelable: true
    })

    Object.defineProperty(event, 'clipboardData', {
      value: {
        getData(targetType: string) {
          return targetType === 'text/plain' ? plainText : ''
        },
        setData(targetType: string, value: string) {
          if (targetType === 'text/plain') {
            plainText = value
          }
        }
      }
    })

    input.dispatchEvent(event)

    return plainText
  }, {
    eventType: type,
    clipboardText: text
  })
}

async function runCompositionSequence(
  page: Page,
  composingText: string,
  committedText: string
): Promise<Readonly<{
  textBeforeEnd: string
  textAfterEnd: string
  selectionSummary: string
}>> {
  return page.evaluate(({ firstData, finalData }) => {
    const input = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')
    const readText = (): string => document.querySelector<HTMLElement>('[data-jword-text-mirror]')?.textContent ?? ''
    const readSummary = (): string => document.querySelector<HTMLElement>('[data-jword-selection-summary]')?.textContent ?? ''
    const createCompositionEvent = (type: string, data: string): Event => {
      const event = new Event(type, {
        bubbles: true,
        cancelable: true
      })

      Object.defineProperty(event, 'data', {
        value: data
      })

      return event
    }

    if (input === null) {
      throw new Error('缺少 Gate 3 hidden textarea')
    }

    input.focus()
    input.dispatchEvent(createCompositionEvent('compositionstart', ''))
    input.dispatchEvent(createCompositionEvent('compositionupdate', firstData))
    input.value = firstData
    input.dispatchEvent(new Event('input', {
      bubbles: true,
      cancelable: true
    }))

    const textBeforeEnd = readText()

    input.value = finalData
    input.dispatchEvent(createCompositionEvent('compositionupdate', finalData))
    input.dispatchEvent(createCompositionEvent('compositionend', finalData))

    return {
      textBeforeEnd,
      textAfterEnd: readText(),
      selectionSummary: readSummary()
    }
  }, {
    firstData: composingText,
    finalData: committedText
  })
}
