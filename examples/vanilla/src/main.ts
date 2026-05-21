/**
 * 职责：装配 vanilla demo 宿主，只创建 editor、挂载官方 UI、接入 demo-only controls，并暴露测试钩子。
 * 边界：不实现 toolbar DOM、assistive 同步或 demo 场景细节；这些逻辑分别交给 `@4xian/jword-ui` 和 `demo-controls.ts`。
 * 协作模块：`@4xian/jword-core` 的 Editor facade、`@4xian/jword-ui` 的 `createJWordUi(...)` 入口，以及 demo-only 控件模块。
 * 性能/安全约束：只在入口层访问宿主 DOM，不回退到旧的 toolbar 内联实现。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import { createEditor, createSelectionState } from '@4xian/jword-core'
import { createJWordUi } from '@4xian/jword-ui'

import { createDemoControls, loadInitialDemoText } from './demo-controls'
import { createDemoMediaSupport } from './demo-media'
import { createDemoTableSupport } from './demo-table'
import '@4xian/jword-ui/styles.css'
import './styles.css'

const editorHost = requireElement<HTMLElement>('#jword-editor', 'JWord vanilla demo requires #jword-editor.')
const toolbarHost = requireElement<HTMLElement>('#jword-toolbar', 'JWord vanilla demo requires #jword-toolbar.')
const demoControlsHost = requireElement<HTMLElement>(
  '#jword-demo-controls',
  'JWord vanilla demo requires #jword-demo-controls.'
)
const statusHost = requireElement<HTMLElement>('#jword-status', 'JWord vanilla demo requires #jword-status.')
const assistiveMirrorHost = requireElement<HTMLElement>(
  '#jword-assistive-mirror',
  'JWord vanilla demo requires #jword-assistive-mirror.'
)

const initialDemoText = await loadInitialDemoText()
const editor = createEditor({
  initialText: initialDemoText,
  layout: {
    keepLatinWordWholeOnWrap: true
  }
})
const demoMedia = createDemoMediaSupport()
const demoTable = createDemoTableSupport(editor)

editor.mount(editorHost)

const jwordUi = createJWordUi({
  editor,
  editorHost,
  toolbarHost,
  liveRegionHost: statusHost,
  assistiveMirrorHost,
  toolbar: {
    showSummaries: false
  },
  media: demoMedia.media,
  table: demoTable.table
})
const demoControls = createDemoControls({
  editor,
  host: demoControlsHost,
  statusHost,
  refreshUi: () => {
    jwordUi.refresh()
  }
})

window.__jwordDemo = Object.freeze({
  editor,
  selectTextRange: demoControls.selectTextRange,
  selectImageByResourceId: (resourceId: string) => {
    selectImageByResourceId(editor, resourceId)
  },
  media: demoMedia.hooks,
  table: demoTable.hooks
})

requestAnimationFrame(() => {
  editor.focus()
})

window.addEventListener(
  'beforeunload',
  () => {
    // demoControls.destroy()
    demoMedia.destroy()
    demoTable.destroy()
    jwordUi.destroy()
    delete window.__jwordDemo
    editor.destroy()
  },
  { once: true }
)

/**
 * 职责：按宿主选择器读取必需节点，避免入口逻辑反复写空值分支。
 */
function requireElement<ElementType extends HTMLElement>(selector: string, errorMessage: string): ElementType {
  const element = document.querySelector<ElementType>(selector)

  if (element === null) {
    throw new Error(errorMessage)
  }

  return element
}

/** 根据资源 id 直接把测试选区切到对应图片 run。 */
function selectImageByResourceId(editorInstance: typeof editor, resourceId: string): void {
  const projection = editorInstance.getProjection()

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const image = run.inlines.find((inline) => inline.kind === 'image' && inline.resourceId === resourceId)

        if (image === undefined) {
          continue
        }

        const anchor = editorInstance.createTextAnchor({
          sectionId: section.id,
          blockId: block.id,
          runId: run.id,
          graphemeIndex: 0
        })

        editorInstance.setSelection(createSelectionState(anchor, anchor))
        editorInstance.focus()
        return
      }
    }
  }

  throw new Error(`未找到资源 ${resourceId} 对应的图片 run`)
}
