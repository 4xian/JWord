/**
 * 职责：提供 @4xian/jword-ui 的单入口装配函数。
 * 边界：只组装 toolbar controller、media panel 与 assistive 子模块，不实现 demo 场景逻辑。
 * 协作模块：index 公开此入口，宿主把 editor/toolbarHost/assistive host 传给这里。
 * 性能/安全约束：入口保持轻量，无顶层 DOM 副作用，重复调用由宿主自行管理生命周期。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#5-4xianjword-ui-的目标公开面。
 */
import type { Block, DocumentProjection, Paragraph, Run } from '@4xian/jword-core'
import { createLiveRegion } from './assistive/live-region'
import { createTextMirror } from './assistive/text-mirror'
import { createMediaController } from './media/controller'
import { createToolbarController } from './toolbar/controller'
import type { CreateJWordUiOptions, JWordUiInstance } from './types'

/** 创建并挂载最小 JWord 官方 UI。 */
export function createJWordUi(options: CreateJWordUiOptions): JWordUiInstance {
  const liveRegion = createLiveRegion({
    host: options.liveRegionHost ?? null
  })
  const textMirror = options.assistiveMirrorHost === undefined || options.assistiveMirrorHost === null
    ? null
    : createTextMirror({
      host: options.assistiveMirrorHost,
      readText: () => readProjectionPlainText(options.editor.getProjection()),
      shouldDeferSync: () => options.editor.getLayout().pages.length > 4
    })

  const toolbar = createToolbarController({
    ...options,
    assistive: {
      liveRegion,
      textMirror
    }
  })
  const media = options.media === undefined
    ? null
    : createMediaController({
      editor: options.editor,
      host: toolbar.mediaHost ?? options.toolbarHost,
      media: options.media,
      assistive: {
        liveRegion
      }
    })

  return {
    elements: {
      ...toolbar.elements,
      mediaPanel: media?.elements ?? null
    },
    refresh(): void {
      toolbar.refresh()
      media?.refresh()
    },
    destroy(): void {
      media?.destroy()
      toolbar.destroy()
    }
  }
}

function readProjectionPlainText(projection: DocumentProjection): string {
  return projection.document.sections
    .map((section) => section.blocks.map(readBlockPlainText).join('\n'))
    .join('\n\n')
}

function readBlockPlainText(block: Block): string {
  if (block.kind === 'paragraph') {
    return readParagraphPlainText(block)
  }

  return block.rows
    .map((row) => row.cells.map((cell) => cell.blocks.map(readBlockPlainText).join('\n')).join('\t'))
    .join('\n')
}

function readParagraphPlainText(paragraph: Paragraph): string {
  return paragraph.runs.map(readRunPlainText).join('')
}

function readRunPlainText(run: Run): string {
  return run.inlines
    .map((inline) => {
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
    })
    .join('')
}
