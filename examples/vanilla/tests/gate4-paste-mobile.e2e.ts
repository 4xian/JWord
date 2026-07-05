/**
 * @fileoverview 职责: 用真实浏览器覆盖 Gate 4 富文本粘贴与移动视口分页的最小验收路径。
 * 边界: 只验证 demo 装配层、hidden textarea paste 事件、projection 输出和移动视口分页，不覆盖完整移动编辑。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/paste/* 与 core editor facade。
 * 约束: 断言来自真实 DOM 或 window.__jwordDemo.editor 公开 facade，不读取 controller 私有状态。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.15/4.16。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface PasteProjectionProbe {
  readonly firstParagraphText: string
  readonly insertedRunProperties: Readonly<Record<string, unknown>> | null
  readonly serializedProjection: string
}

interface MobileViewportProbe {
  readonly toolbarHidden: boolean
  readonly textareaReadonly: boolean
  readonly canvasOverflow: string
  readonly firstParagraphText: string
}

interface LinkTablePasteProbe {
  readonly paragraphTexts: readonly string[]
  readonly docsLinkTarget: string | null
  readonly serializedProjection: string
}

test('Gate 4 paste sanitizer keeps safe Word-like formats and falls back to plain text', async ({ page }) => {
  await page.goto('/')
  await waitForPasteMobileDemoReady(page)
  await collapseAtFirstParagraphIndex(page, 1)

  await dispatchPaste(page, {
    html: '<p><b><i><span style="color:#C00000;background-color:#FFF2CC">Word</span></i></b><script>alert(1)</script></p>',
    text: 'Word'
  })

  await expect.poll(() => readPasteProjectionProbe(page)).toMatchObject({
    insertedRunProperties: {
      bold: true,
      italic: true,
      color: '#c00000',
      backgroundColor: '#fff2cc'
    }
  })

  const richProbe = await readPasteProjectionProbe(page)

  expect(richProbe.firstParagraphText).toContain('默Word认混排样例')
  expect(richProbe.serializedProjection).not.toContain('alert')

  await dispatchPaste(page, {
    html: '<script>alert(2)</script>',
    text: 'fallback'
  })

  const fallbackProbe = await readPasteProjectionProbe(page)

  expect(fallbackProbe.firstParagraphText).toContain('默Wordfallback认混排样例')
  expect(fallbackProbe.serializedProjection).not.toContain('alert')
})

test('Gate 4 paste sanitizer keeps safe links and flattens simple tables', async ({ page }) => {
  await page.goto('/')
  await waitForPasteMobileDemoReady(page)
  await collapseAtFirstParagraphIndex(page, 1)

  await dispatchPaste(page, {
    html: [
      '<p>Before <a href="https://example.com/docs">docs</a> <a href="javascript:alert(1)">bad</a></p>',
      '<table><tr><th>Head</th><td><b>Value</b></td></tr><tr><td>A</td><td>B</td></tr></table>'
    ].join(''),
    text: 'Before docs bad\nHead\tValue\nA\tB'
  })

  const probe = await readLinkTablePasteProbe(page)

  expect(probe.paragraphTexts[0]).toBe('默Before docsbad')
  expect(probe.paragraphTexts[1]).toBe('Head\tValue')
  expect(probe.paragraphTexts[2]).toContain('A\tB认混排样例')
  expect(probe.docsLinkTarget).toBe('https://example.com/docs')
  expect(probe.serializedProjection).not.toContain('javascript:')
})

test('Gate 4 mobile viewport keeps paged canvas scrollable without implicit readonly mode', async ({ page }) => {
  await page.setViewportSize({
    width: 390,
    height: 780
  })
  await page.goto('/')
  await waitForPasteMobileDemoReady(page)

  const probe = await readMobileViewportProbe(page)

  expect(probe.toolbarHidden).toBe(false)
  expect(probe.textareaReadonly).toBe(false)
  expect(probe.canvasOverflow).toBe('auto')
  expect(probe.firstParagraphText).toContain('默认混排样例')
})

/** 等待 demo、editor 和 toolbar 完成挂载。 */
async function waitForPasteMobileDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
}

/** 把选区折叠到第一段指定 grapheme 位置。 */
async function collapseAtFirstParagraphIndex(page: Page, graphemeIndex: number): Promise<void> {
  await page.evaluate((index) => {
    window.__jwordDemo?.selectTextRange({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      anchorGraphemeIndex: index,
      focusGraphemeIndex: index
    })
  }, graphemeIndex)
}

/** 分发一条带 text/html 与 text/plain 的真实 DOM paste 事件。 */
async function dispatchPaste(
  page: Page,
  input: Readonly<{ html: string, text: string }>
): Promise<void> {
  await page.evaluate((clipboardInput) => {
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (textarea === null) {
      throw new Error('缺少 hidden textarea。')
    }

    const event = new Event('paste', {
      bubbles: true,
      cancelable: true
    })

    Object.defineProperty(event, 'clipboardData', {
      configurable: true,
      value: {
        getData(type: string): string {
          if (type === 'text/html') {
            return clipboardInput.html
          }

          if (type === 'text/plain') {
            return clipboardInput.text
          }

          return ''
        },
        setData(): void {}
      }
    })

    textarea.dispatchEvent(event)
  }, input)
}

/** 读取粘贴后的 projection 关键结果。 */
async function readPasteProjectionProbe(page: Page): Promise<PasteProjectionProbe> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()
    const firstBlock = projection?.document.sections[0]?.blocks[0]

    if (firstBlock?.kind !== 'paragraph') {
      throw new Error('缺少第一段。')
    }

    const firstParagraphText = firstBlock.runs.map((run) => run.inlines.map((inline) => {
      if (inline.kind === 'text') {
        return inline.text
      }

      if (inline.kind === 'break') {
        return '\n'
      }

      if (inline.kind === 'image') {
        return '[image]'
      }

      return ''
    }).join('')).join('')
    const insertedRun = firstBlock.runs.find((run) => run.inlines.some((inline) => {
      return inline.kind === 'text' && inline.text === 'Word'
    }))

    return {
      firstParagraphText,
      insertedRunProperties: insertedRun?.properties ?? null,
      serializedProjection: JSON.stringify(projection)
    }
  })
}

/** 读取移动视口下的 DOM 与 projection 状态。 */
async function readMobileViewportProbe(page: Page): Promise<MobileViewportProbe> {
  return page.evaluate(() => {
    const toolbarHost = document.querySelector<HTMLElement>('#jword-toolbar')
    const canvasContainer = document.querySelector<HTMLElement>('[data-jword-canvas-container]')
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (toolbarHost === null || canvasContainer === null || textarea === null) {
      throw new Error('移动视口测试缺少必要 DOM。')
    }

    const firstBlock = window.__jwordDemo?.editor.getProjection().document.sections[0]?.blocks[0]
    const firstParagraphText = firstBlock?.kind === 'paragraph'
      ? firstBlock.runs.map((run) => run.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('')).join('')
      : ''

    return {
      toolbarHidden: toolbarHost.hidden === true,
      textareaReadonly: textarea.readOnly,
      canvasOverflow: canvasContainer.style.overflow,
      firstParagraphText
    }
  })
}

/** 读取链接和简单表格粘贴后的 projection 证据。 */
async function readLinkTablePasteProbe(page: Page): Promise<LinkTablePasteProbe> {
  return page.evaluate(() => {
    const projection = window.__jwordDemo?.editor.getProjection()

    if (projection === undefined) {
      throw new Error('缺少 editor projection。')
    }

    const paragraphTexts = projection.document.sections.flatMap((section) =>
      section.blocks.flatMap((block) => block.kind === 'paragraph'
        ? [block.runs.map((run) => run.inlines.map((inline) => inline.kind === 'text' ? inline.text : '').join('')).join('')]
        : [])
    )
    const docsRun = projection.document.sections.flatMap((section) =>
      section.blocks.flatMap((block) => block.kind === 'paragraph'
        ? block.runs
        : [])
    ).find((run) => run.inlines.some((inline) => inline.kind === 'text' && inline.text === 'docs'))

    return {
      paragraphTexts: paragraphTexts.slice(0, 3),
      docsLinkTarget: docsRun?.link?.target ?? null,
      serializedProjection: JSON.stringify(projection)
    }
  })
}
