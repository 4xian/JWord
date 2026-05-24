/**
 * @fileoverview 职责: 用真实浏览器验证 Gate 4 全局只读模式不会通过官方 UI 修改 projection。
 * 边界: 只覆盖 vanilla demo 的 createJWordUi({ readonly }) 装配、DOM 输入阻断和只读导航入口。
 * 协作: examples/vanilla/src/main.ts、packages/ui/src/readonly、toolbar、selection-actions、find-replace 与 link controller。
 * 约束: 断言来自真实 DOM、window.__jwordDemo 公开 facade 和 editor projection，不读取 controller 私有状态。
 * Specs: docs/superpowers/plans/2026-05-24-jword-global-readonly-mode.md Task 5。
 */
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

interface CanvasScrollProbe {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly clientHeight: number
}

test('Gate 4 demo exposes a readonly example entry', async ({ page }) => {
  await page.goto('/')
  await waitForReadonlyDemoReady(page)

  const readonlyExampleButton = page.locator('[data-jword-open-readonly-example]')

  await expect(readonlyExampleButton).toBeVisible()
  await expect(readonlyExampleButton).toContainText('只读示例')

  await readonlyExampleButton.click()
  await page.waitForURL('**/?readonly=true')
  await waitForReadonlyDemoReady(page)

  expect(await page.evaluate(() => window.__jwordDemo?.readonly)).toBe(true)
  await expect(page.locator('#jword-editor')).toHaveAttribute('data-jword-readonly', 'true')
  await expect(page.locator('[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-trigger')).toBeDisabled()
  await expect(page.locator('[data-jword-open-find-replace]')).toBeEnabled()
  await expect(page.locator('[data-jword-media-trigger="true"]')).toBeDisabled()
  await expect(page.locator('[data-jword-hidden-textarea]')).not.toBeFocused()
})

test('Gate 4 global readonly blocks editing while keeping scroll and link open available', async ({ page }) => {
  await page.setViewportSize({
    width: 1024,
    height: 520
  })
  await page.goto('/?readonly=true')
  await waitForReadonlyDemoReady(page)

  expect(await page.evaluate(() => window.__jwordDemo?.readonly)).toBe(true)
  await expect(page.locator('#jword-toolbar')).toBeVisible()
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveJSProperty('readOnly', true)
  await expect(page.locator('#jword-editor')).toHaveAttribute('data-jword-readonly', 'true')
  await expect(page.locator('[data-jword-tool-id="document.pagePreset"] .jw-toolbar__select-trigger')).toBeDisabled()
  await expect(page.locator('[data-jword-format-bold]')).toBeDisabled()
  await expect(page.locator('[data-jword-insert-comment]')).toBeDisabled()
  await expect(page.locator('[data-jword-insert-link]')).toBeDisabled()
  await expect(page.locator('[data-jword-open-find-replace]')).toBeEnabled()
  await expect(page.locator('[data-jword-media-trigger="true"]')).toBeDisabled()
  await expect(page.locator('[data-jword-hidden-textarea]')).not.toBeFocused()

  const initialProjection = await readSerializedProjection(page)

  await dispatchReadonlyEditingEvents(page)
  await selectFirstRunRange(page, 1, 3)
  await clickReadonlyPage(page)

  await expect(page.locator('[data-jword-floating-toolbar="true"]')).toBeHidden()
  await expect(page.locator('[data-jword-context-menu="true"]')).toBeHidden()
  await expect(page.locator('[data-jword-hidden-textarea]')).not.toBeFocused()
  expect(await readSerializedProjection(page)).toBe(initialProjection)

  const scrollProbe = await scrollCanvas(page)

  expect(scrollProbe.scrollHeight).toBeGreaterThan(scrollProbe.clientHeight)
  expect(scrollProbe.scrollTop).toBeGreaterThan(0)

  await page.locator('[data-jword-open-find-replace]').click()
  await expect(page.locator('[data-jword-find-replace]')).toBeVisible()
  await expect(page.locator('[data-jword-replace-button]')).toBeDisabled()
  await expect(page.locator('[data-jword-replace-all-button]')).toBeDisabled()

  await seedReadonlyLink(page)
  const linkedProjection = await readSerializedProjection(page)
  const linkTarget = page.locator('[data-jword-link-target-index]').first()

  await expect(linkTarget).toBeVisible()
  await page.evaluate(() => {
    window.open = ((url: string | URL | undefined) => {
      document.body.setAttribute('data-jword-opened-url', String(url))
      return null
    }) as typeof window.open
  })
  await linkTarget.click()

  await expect(page.locator('[data-jword-link-quick-tools]')).toBeVisible()
  await expect(page.locator('[data-jword-link-open]')).toBeEnabled()
  await expect(page.locator('[data-jword-link-edit]')).toBeHidden()
  await expect(page.locator('[data-jword-link-remove]')).toBeHidden()

  await page.locator('[data-jword-link-open]').click()
  await expect(page.locator('body')).toHaveAttribute('data-jword-opened-url', 'https://example.com/jword-readonly')
  expect(await readSerializedProjection(page)).toBe(linkedProjection)
})

/** 等待只读 demo 与主要 UI 面板都完成挂载。 */
async function waitForReadonlyDemoReady(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__jwordDemo !== undefined)
  await expect(page.locator('[data-jword-toolbar]')).toBeVisible()
  await expect(page.locator('[data-jword-hidden-textarea]')).toHaveCount(1)
  await expect(page.locator('[data-jword-canvas-container]')).toBeVisible()
  await expect(page.locator('[data-jword-find-replace]')).toHaveCount(1)
  await expect(page.locator('[data-jword-link-panel]')).toHaveCount(1)
}

/** 读取当前 projection 的稳定 JSON 字符串。 */
async function readSerializedProjection(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify(window.__jwordDemo?.editor.getProjection()))
}

/** 通过公开 demo hook 选择第一段首个 run 的文本范围。 */
async function selectFirstRunRange(page: Page, anchorGraphemeIndex: number, focusGraphemeIndex: number): Promise<void> {
  await page.evaluate(({ anchorIndex, focusIndex }) => {
    const demo = window.__jwordDemo
    const section = demo?.editor.getProjection().document.sections[0]
    const block = section?.blocks[0]
    const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

    if (demo === undefined || section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
      throw new Error('缺少只读测试文本选区目标。')
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

/** 分发只读模式必须阻断的输入、剪贴板和编辑菜单事件。 */
async function dispatchReadonlyEditingEvents(page: Page): Promise<void> {
  await page.locator('[data-jword-hidden-textarea]').focus()
  await page.keyboard.type('readonly-blocked')
  await page.evaluate(() => {
    const editorHost = document.querySelector<HTMLElement>('#jword-editor')
    const textarea = document.querySelector<HTMLTextAreaElement>('[data-jword-hidden-textarea]')

    if (editorHost === null || textarea === null) {
      throw new Error('缺少只读输入测试 DOM。')
    }

    const beforeInput = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'x'
    })
    const input = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'x'
    })
    const paste = new Event('paste', {
      bubbles: true,
      cancelable: true
    })

    Object.defineProperty(paste, 'clipboardData', {
      configurable: true,
      value: {
        getData(type: string): string {
          return type === 'text/plain' ? 'blocked paste' : ''
        },
        setData(): void {}
      }
    })

    textarea.value = 'x'
    textarea.dispatchEvent(beforeInput)
    textarea.dispatchEvent(input)
    textarea.dispatchEvent(paste)
    textarea.dispatchEvent(new Event('cut', {
      bubbles: true,
      cancelable: true
    }))
    editorHost.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true
    }))
    editorHost.dispatchEvent(new MouseEvent('dblclick', {
      bubbles: true,
      cancelable: true
    }))
  })
}

/** 点击只读分页内容，验证不会重新激活编辑光标。 */
async function clickReadonlyPage(page: Page): Promise<void> {
  await page.locator('[data-jword-page]').first().click({
    position: {
      x: 120,
      y: 120
    }
  })
}

/** 滚动分页 canvas 容器并返回滚动状态。 */
async function scrollCanvas(page: Page): Promise<CanvasScrollProbe> {
  return page.evaluate(() => {
    const canvasContainer = document.querySelector<HTMLElement>('[data-jword-canvas-container]')

    if (canvasContainer === null) {
      throw new Error('缺少分页 canvas 容器。')
    }

    canvasContainer.scrollTop = 120

    return {
      scrollTop: canvasContainer.scrollTop,
      scrollHeight: canvasContainer.scrollHeight,
      clientHeight: canvasContainer.clientHeight
    }
  })
}

/** 用 demo hook 预置链接，供只读 quick tools 验证使用。 */
async function seedReadonlyLink(page: Page): Promise<void> {
  const seeded = await page.evaluate(() => {
    return window.__jwordDemo?.link.seedFirstRunLink('https://example.com/jword-readonly') ?? false
  })

  expect(seeded).toBe(true)
}
