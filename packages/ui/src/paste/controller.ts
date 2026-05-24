/**
 * 职责：接管浏览器 text/html 粘贴事件，并把安全富文本片段交给 core facade。
 * 边界：只监听 hidden textarea 的 paste，不解析纯文本、不直接修改文档模型。
 * 协作模块：paste sanitizer 清洗 HTML，core pasteRichTextFragment 执行事务。
 * 性能/安全约束：只有 sanitizer 产出有效片段且 core 接受时才阻止默认事件，否则保留纯文本降级路径。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-415。
 */
import type { Editor } from '@4xian/jword-core'
import type { JWordUiLiveRegionController } from '../types'
import { sanitizePastedHtmlToRichTextFragment } from './sanitizer'

interface CreatePasteControllerOptions {
  readonly editor: Editor
  readonly editorHost: HTMLElement
  readonly assistive: {
    readonly liveRegion: JWordUiLiveRegionController | null
  }
}

interface PasteControllerHandle {
  destroy(): void
}

/** 创建富文本粘贴 controller。 */
export function createPasteController(options: CreatePasteControllerOptions): PasteControllerHandle {
  const signalController = new AbortController()
  const hiddenTextarea = requireHiddenTextarea(options.editorHost)

  hiddenTextarea.addEventListener('paste', (event) => {
    handlePasteEvent(options, event)
  }, {
    capture: true,
    signal: signalController.signal
  })

  return {
    destroy(): void {
      signalController.abort()
    }
  }
}

/** 处理一次 HTML 粘贴事件。 */
function handlePasteEvent(options: CreatePasteControllerOptions, event: ClipboardEvent): void {
  const html = event.clipboardData?.getData('text/html') ?? ''

  if (html.trim().length === 0) {
    return
  }

  const fragment = sanitizePastedHtmlToRichTextFragment(html)

  if (fragment === null) {
    return
  }

  if (!options.editor.pasteRichTextFragment(fragment)) {
    return
  }

  event.preventDefault()
  event.stopImmediatePropagation()
  options.assistive.liveRegion?.announce('已粘贴保留格式的安全富文本。', { force: true })
}

/** 读取 editor mount 后的隐藏输入框。 */
function requireHiddenTextarea(editorHost: HTMLElement): HTMLTextAreaElement {
  const textarea = editorHost.querySelector('[data-jword-hidden-textarea]')

  if (!(textarea instanceof HTMLTextAreaElement)) {
    throw new Error('paste controller 需要已挂载的 hidden textarea。')
  }

  return textarea
}
