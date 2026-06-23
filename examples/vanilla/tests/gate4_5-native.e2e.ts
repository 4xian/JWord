/**
 * @fileoverview 职责: 用真实浏览器锁定 Gate 4.5 vanilla 原生 .jword 保存/打开宿主入口。
 * 边界: 只验证第三方宿主 UI、首屏 lazy 边界和编辑器可继续输入，不覆盖 native 包内部 zip 语义。
 * 协作: examples/vanilla/src/main.ts、demo-native bridge、@4xian/jword-native 公开 API。
 * 约束: 断言来自真实 DOM、网络请求和 window.__jwordDemo 钩子，不能读取 packages/native/src。
 * Specs: docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.5 Step 4.5.6。
 */
import { expect, test, type Page } from '@playwright/test'

test('Gate 4.5 native controls save and reopen through the lazy public runtime', async ({ page }) => {
  const runtimeRequests: string[] = []

  page.on('request', (request) => {
    const url = request.url()

    if (url.includes('@4xian/jword-native') || url.includes('/packages/native/')) {
      runtimeRequests.push(url)
    }
  })

  await page.goto('/')

  await expect(page.locator('[data-jword-native-save="true"]')).toBeVisible()
  await expect(page.locator('[data-jword-native-open-button="true"]')).toBeVisible()
  await expect(page.locator('[data-jword-native-file="true"]')).toHaveAttribute('accept', '.jword,application/vnd.jword')
  await expect(page.locator('[data-jword-native-status="true"]')).toContainText('原生保存/打开就绪')
  expect(runtimeRequests).toEqual([])

  await page.keyboard.type('GATE45_EDIT_PROOF')

  await expect.poll(() => readEditorText(page)).toContain('GATE45_EDIT_PROOF')

  const firstRoundtrip = await page.evaluate(async () => {
    const demo = window.__jwordDemo
    const fileInput = document.querySelector<HTMLInputElement>('[data-jword-native-file="true"]')

    if (demo === undefined || fileInput === null) {
      return {
        opened: false,
        savedSize: 0,
        status: 'missing demo',
        warningCount: -1
      }
    }

    const blob = await demo.native.save()

    if (blob === null) {
      return {
        opened: false,
        savedSize: 0,
        status: demo.native.readStatus(),
        warningCount: demo.native.readWarnings().length
      }
    }

    const transfer = new DataTransfer()
    const file = new File([blob], 'gate45-roundtrip.jword', { type: 'application/vnd.jword' })

    transfer.items.add(file)
    fileInput.files = transfer.files

    return {
      opened: await demo.native.openSelectedFile(),
      savedSize: blob.size,
      status: demo.native.readStatus(),
      warningCount: demo.native.readWarnings().length
    }
  })

  expect(firstRoundtrip).toMatchObject({
    opened: true,
    warningCount: 0
  })
  expect(firstRoundtrip.savedSize).toBeGreaterThan(0)
  expect(firstRoundtrip.status).toContain('.jword 打开完成')
  expect(runtimeRequests.some((url) => url.includes('@4xian/jword-native') || url.includes('/packages/native/'))).toBe(true)
  await expect.poll(() => readEditorText(page)).toContain('GATE45_EDIT_PROOF')

  await page.evaluate(() => window.__jwordDemo?.editor.focus())
  await page.keyboard.type('AFTER_OPEN_EDIT')

  await expect.poll(() => readEditorText(page)).toContain('AFTER_OPEN_EDIT')

  const secondSave = await page.evaluate(async () => {
    const blob = await window.__jwordDemo?.native.save()

    return {
      savedSize: blob?.size ?? 0,
      status: window.__jwordDemo?.native.readStatus() ?? ''
    }
  })

  expect(secondSave.savedSize).toBeGreaterThan(0)
  expect(secondSave.status).toContain('.jword 保存完成')
})

test('Gate 4.5 native save keeps uploaded file image resources across reopen', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.__jwordDemo?.media !== undefined)
  await page.locator('[data-jword-media-trigger="true"]').click()
  await page.locator('[data-jword-media-file-input="true"]').setInputFiles('fixtures/gate4/media-inline.svg')
  await expect.poll(() => page.evaluate(() => window.__jwordDemo?.media.readUploadLog().length ?? 0)).toBe(1)

  const beforeSave = await readFirstImageResource(page)

  expect(beforeSave).toMatchObject({
    sourceKind: 'dataUrl',
    status: 'success'
  })

  const roundtrip = await page.evaluate(async () => {
    const demo = window.__jwordDemo
    const fileInput = document.querySelector<HTMLInputElement>('[data-jword-native-file="true"]')

    if (demo === undefined || fileInput === null) {
      return {
        opened: false,
        savedSize: 0,
        warningCount: -1
      }
    }

    const blob = await demo.native.save()

    if (blob === null) {
      return {
        opened: false,
        savedSize: 0,
        warningCount: demo.native.readWarnings().length
      }
    }

    const transfer = new DataTransfer()
    const file = new File([blob], 'gate45-uploaded-image.jword', { type: 'application/vnd.jword' })

    transfer.items.add(file)
    fileInput.files = transfer.files

    return {
      opened: await demo.native.openSelectedFile(),
      savedSize: blob.size,
      warningCount: demo.native.readWarnings().length
    }
  })
  const afterOpen = await readFirstImageResource(page)

  expect(roundtrip.opened).toBe(true)
  expect(roundtrip.savedSize).toBeGreaterThan(0)
  expect(roundtrip.warningCount).toBe(0)
  expect(afterOpen).toEqual(beforeSave)
})

/** 读取当前编辑器 projection 中的正文文本。 */
function readEditorText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const documentModel = window.__jwordDemo?.editor.getProjection().document

    if (documentModel === undefined) {
      return ''
    }

    return documentModel.sections.flatMap((section) => {
      return section.blocks.flatMap((block) => {
        if (block.kind !== 'paragraph') {
          return []
        }

        return block.runs.flatMap((run) => {
          return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
        })
      })
    }).join('')
  })
}

/** 读取当前第一张图片引用的资源快照。 */
function readFirstImageResource(page: Page): Promise<{
  readonly resourceId: string
  readonly sourceKind: string
  readonly status: string
} | null> {
  return page.evaluate(() => {
    const documentModel = window.__jwordDemo?.editor.getProjection().document
    const image = documentModel?.sections
      .flatMap((section) => section.blocks)
      .filter((block) => block.kind === 'paragraph')
      .flatMap((block) => block.runs)
      .flatMap((run) => run.inlines)
      .find((inline): inline is {
        readonly kind: 'image'
        readonly resourceId: string
      } => inline.kind === 'image')
    const resource = documentModel?.resources?.find((item) => item.id === image?.resourceId)

    if (resource === undefined || image === undefined) {
      return null
    }

    return {
      resourceId: image.resourceId,
      sourceKind: resource.source.kind,
      status: resource.status
    }
  })
}
