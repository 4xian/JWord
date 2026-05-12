/**
 * 职责：启动无框架 Vite demo，并挂载 core Editor facade。
 * 边界：不实现 editing、contenteditable、输入系统或 Gate 3 行为。
 * 协作模块：@4xian/jword-core 的 Editor mount/destroy、分页 canvas 生命周期和 demo HTML host。
 * 性能/安全约束：只在 demo 入口访问 DOM，且不用 innerHTML 构造 UI。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */
import { createEditor } from '@4xian/jword-core'
import './styles.css'

const editorHost = document.querySelector<HTMLElement>('#jword-editor')
const statusNode = document.querySelector<HTMLElement>('#jword-status')

if (editorHost === null) {
  throw new Error('JWord vanilla demo requires #jword-editor.')
}

const editor = createEditor({
  initialText: 'JWord Gate 2\n\n分页 layout 与每页独立 canvas renderer 已接入 vanilla demo。'
})

editor.mount(editorHost)

if (statusNode !== null) {
  statusNode.textContent = 'Gate 2 paginated canvas mounted by @4xian/jword-core.'
}

window.addEventListener(
  'beforeunload',
  () => {
    editor.destroy()
  },
  { once: true }
)
