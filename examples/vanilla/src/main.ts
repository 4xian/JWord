/**
 * 职责：启动无框架 Vite demo，并挂载 core Editor facade。
 * 边界：不实现 editing、contenteditable、输入系统或 Gate 3 行为。
 * 协作模块：@4xian/jword-core 的 Editor mount/destroy、分页 canvas 生命周期和 demo HTML host。
 * 性能/安全约束：只在 demo 入口访问 DOM，且不用 innerHTML 构造 UI。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md 与 05-implementation-gates.md。
 */
import { createEditor } from '@4xian/jword-core'
import type { RangeRef, SelectionState } from '@4xian/jword-core'
import type { JWordDemoSelectionInput } from './vite-env'
import gate2FixtureText from '../../../fixtures/plain-text/gate2-50-pages.txt?raw'
import './styles.css'

const editorHost = document.querySelector<HTMLElement>('#jword-editor')
const statusNode = document.querySelector<HTMLElement>('#jword-status')

if (editorHost === null) {
  throw new Error('JWord vanilla demo requires #jword-editor.')
}

const editor = createEditor({
  initialText: createGate2DemoText(gate2FixtureText)
})

editor.mount(editorHost)
window.__jwordDemo = Object.freeze({
  editor,
  selectTextRange
})

if (statusNode !== null) {
  statusNode.textContent = `Gate 2 paginated canvas mounted by @4xian/jword-core, pages: ${editor.getLayout().pages.length}.`
}

window.addEventListener(
  'beforeunload',
  () => {
    delete window.__jwordDemo
    editor.destroy()
  },
  { once: true }
)

function createGate2DemoText(fixtureText: string): string {
  const lines = fixtureText.trim().split(/\r?\n/u).filter((line) => line.length > 0)
  const rounds = Array.from({ length: 32 }, (_, roundIndex) => roundIndex + 1)

  return rounds
    .flatMap((round) => lines.map((line) => `${line} Repeat ${String(round).padStart(2, '0')}.`))
    .join('\n\n')
}

function selectTextRange(input: JWordDemoSelectionInput): SelectionState {
  const anchor = editor.createTextAnchor({
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.anchorGraphemeIndex
  })
  const focus = editor.createTextAnchor({
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.focusGraphemeIndex
  })
  const selection = Object.freeze({
    anchor,
    focus,
    range: Object.freeze({ anchor, focus }) as RangeRef,
    direction: input.anchorGraphemeIndex === input.focusGraphemeIndex
      ? 'none'
      : input.anchorGraphemeIndex < input.focusGraphemeIndex ? 'forward' : 'backward',
    affinity: 'none'
  }) satisfies SelectionState

  editor.setSelection(selection)

  return selection
}
