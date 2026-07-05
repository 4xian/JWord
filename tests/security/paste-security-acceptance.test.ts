/**
 * @vitest-environment jsdom
 *
 * 职责：固化 Beta 保格式粘贴安全验收清单，覆盖 HTML 粘贴与 DOCX 外链图片防护。
 * 边界：只验证公开 UI/DOCX 入口的安全结果，不读取 sanitizer、controller 或 importer 私有状态。
 * 协作模块：@4xian/jword-ui、@4xian/jword-core 与 @4xian/jword-docx 共同提供验收证据。
 * 性能/安全约束：不执行真实网络请求，不把不可信 HTML 回插页面，危险 HTML 必须走纯文本降级。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md#64-安全验收。
 */

import { createEditor, createSelectionState, type Editor, type Run } from '@4xian/jword-core'
import { importDocx } from '@4xian/jword-docx'
import { createJWordUi } from '@4xian/jword-ui'
import { describe, expect, test } from 'vitest'

import { createDocxImagePackage, createDocxPublicApiLicense } from '../../packages/docx/test/public-api-fixtures'

describe('Beta paste security acceptance', () => {
  test('keeps safe Word formatting while removing mso styles and active content', () => {
    const harness = createHarness('ab')

    try {
      harness.editor.setSelection(createCollapsedSelection(harness.editor, 1))

      const wordPaste = dispatchPaste(harness.editorHost, {
        html: '<p class="MsoNormal" style="mso-list:l0 level1 lfo1;color:#C00000;background-image:url(javascript:alert(1))"><b>Word</b><script>alert(1)</script></p>',
        text: 'Word'
      })

      expect(wordPaste.defaultPrevented).toBe(true)
      expect(readParagraphTexts(harness.editor)).toEqual(['aWordb'])
      expect(readInsertedRunProperties(harness.editor, 'Word')).toMatchObject({
        bold: true,
        color: '#c00000'
      })
      expect(JSON.stringify(harness.editor.getProjection())).not.toContain('mso-list')
      expect(JSON.stringify(harness.editor.getProjection())).not.toContain('javascript:')
      expect(JSON.stringify(harness.editor.getProjection())).not.toContain('alert')
    } finally {
      harness.destroy()
    }
  })

  test('falls back to plain text for SVG payloads and data URL images', () => {
    const svgHarness = createHarness('ab')

    try {
      svgHarness.editor.setSelection(createCollapsedSelection(svgHarness.editor, 1))

      const svgPaste = dispatchPaste(svgHarness.editorHost, {
        html: '<svg><script>alert(1)</script><text>SVG</text></svg>',
        text: 'SVG fallback'
      })

      expect(svgPaste.defaultPrevented).toBe(true)
      expect(readParagraphTexts(svgHarness.editor)).toEqual(['aSVG fallbackb'])
      expect(JSON.stringify(svgHarness.editor.getProjection())).not.toContain('<svg')
      expect(JSON.stringify(svgHarness.editor.getProjection())).not.toContain('alert')
    } finally {
      svgHarness.destroy()
    }

    const imageHarness = createHarness('ab')

    try {
      imageHarness.editor.setSelection(createCollapsedSelection(imageHarness.editor, 1))

      const dataImagePaste = dispatchPaste(imageHarness.editorHost, {
        html: '<p><b><img src="data:image/svg+xml,<svg onload=alert(1)>">Image fallback</b></p>',
        text: 'Image fallback'
      })

      expect(dataImagePaste.defaultPrevented).toBe(true)
      expect(readParagraphTexts(imageHarness.editor)).toEqual(['aImage fallbackb'])
      expect(readInsertedRunProperties(imageHarness.editor, 'Image fallback')).not.toMatchObject({
        bold: true
      })
      expect(JSON.stringify(imageHarness.editor.getProjection())).not.toContain('data:image')
      expect(JSON.stringify(imageHarness.editor.getProjection())).not.toContain('<svg')
      expect(JSON.stringify(imageHarness.editor.getProjection())).not.toContain('alert')
    } finally {
      imageHarness.destroy()
    }
  })

  test('does not fetch DOCX external images and preserves warning evidence', async () => {
    const result = await importDocx(await createDocxImagePackage(), {
      license: createDocxPublicApiLicense(['docx.import'])
    })

    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'DOCX_IMAGE_EXTERNAL_UNSUPPORTED',
      fallback: 'preserve-alt-text',
      recoverable: true
    }))
    expect(result.document.resources.map((resource) => resource.resourceId)).toEqual(['word/media/image1.png'])
    expect(JSON.stringify(result.document.resources)).not.toContain('https://example.com/external.png')
  })
})

interface Harness {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  destroy(): void
}

/** 创建带 UI 粘贴 controller 的最小验收环境。 */
function createHarness(initialText: string): Harness {
  const editorHost = document.createElement('div')
  const toolbarHost = document.createElement('div')
  const liveRegionHost = document.createElement('div')
  const editor = createEditor({ initialText })

  document.body.append(editorHost, toolbarHost, liveRegionHost)
  editor.mount(editorHost)

  const ui = createJWordUi({
    editor,
    editorHost,
    toolbarHost,
    liveRegionHost
  })

  return {
    editor,
    editorHost,
    destroy(): void {
      ui.destroy()
      editor.destroy()
      editorHost.remove()
      toolbarHost.remove()
      liveRegionHost.remove()
    }
  }
}

/** 分发带 text/html 和 text/plain 的 paste 事件。 */
function dispatchPaste(
  editorHost: HTMLElement,
  input: Readonly<{ html: string, text: string }>
): Event {
  const textarea = requireTextarea(editorHost)
  const event = new Event('paste', {
    bubbles: true,
    cancelable: true
  })

  Object.defineProperty(event, 'clipboardData', {
    value: {
      getData(type: string): string {
        if (type === 'text/html') {
          return input.html
        }

        if (type === 'text/plain') {
          return input.text
        }

        return ''
      },
      setData(): void {}
    }
  })

  textarea.dispatchEvent(event)

  return event
}

/** 创建初始同一 run 内的折叠选区。 */
function createCollapsedSelection(editor: Editor, graphemeIndex: number) {
  const anchor = editor.createTextAnchor({
    sectionId: 'section-1',
    blockId: 'paragraph-1',
    runId: 'run-1',
    graphemeIndex
  })

  return createSelectionState(anchor, anchor)
}

/** 读取段落纯文本。 */
function readParagraphTexts(editor: Editor): readonly string[] {
  return editor.getProjection().document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map(readRunText).join('')]
      : [])
  )
}

/** 读取指定插入文本 run 的属性。 */
function readInsertedRunProperties(editor: Editor, text: string): unknown {
  const block = editor.getProjection().document.sections[0]?.blocks[0]

  if (block?.kind !== 'paragraph') {
    return undefined
  }

  return block.runs.find((run) => readRunText(run) === text)?.properties
}

/** 读取 run 内可见文本。 */
function readRunText(run: Run): string {
  return run.inlines.map((inline) => {
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
  }).join('')
}

/** 读取必需隐藏文本域。 */
function requireTextarea(host: HTMLElement): HTMLTextAreaElement {
  const textarea = host.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('缺少 hidden textarea。')
  }

  return textarea
}
