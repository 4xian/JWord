/**
 * 职责：装配 vanilla demo 宿主，只创建 editor、挂载官方 UI、接入 demo-only controls，并暴露测试钩子。
 * 边界：不实现 toolbar DOM、assistive 同步或 demo 场景细节；这些逻辑分别交给 `@4xian/jword-ui` 和 `demo-controls.ts`。
 * 协作模块：`@4xian/jword-core` 的 Editor facade、`@4xian/jword-ui` 的 `createJWordUi(...)` 入口，以及 demo-only 控件模块。
 * 性能/安全约束：只在入口层访问宿主 DOM，不回退到旧的 toolbar 内联实现。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import { createEditor } from '@4xian/jword-core'
import { createJWordUi } from '@4xian/jword-ui'

import { createDemoControls, loadInitialDemoText } from './demo-controls'
import { createDemoMediaSupport } from './demo-media'
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

editor.mount(editorHost)

const jwordUi = createJWordUi({
  editor,
  toolbarHost,
  liveRegionHost: statusHost,
  assistiveMirrorHost,
  media: demoMedia.media
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
  media: demoMedia.hooks
})

requestAnimationFrame(() => {
  editor.focus()
})

window.addEventListener(
  'beforeunload',
  () => {
    demoControls.destroy()
    demoMedia.destroy()
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
