/**
 * 职责：承接 vanilla demo 的场景控件、Alpha / Gate2 样例切换与测试辅助选区钩子。
 * 边界：不实现官方 toolbar、assistive mirror 或格式同步；这里只处理 demo-only 行为。
 * 协作模块：`@4xian/jword-core` Editor facade、fixtures/plain-text 与 `window.__jwordDemo` 测试钩子。
 * 性能/安全约束：避免在 demo-only 控件里访问 core 私有状态；只通过公开 facade 读写文档与选区。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md。
 */
import { createGate2FixtureEditorText } from '../../../fixtures/plain-text/gate2-fixture.mjs'

import type { Editor, RangeRef, SelectionState } from '@4xian/jword-core'

import type { JWordDemoSelectionInput } from './vite-env'

interface CreateDemoControlsOptions {
  readonly editor: Editor
  readonly host: HTMLElement
  readonly statusHost: HTMLElement | null
  readonly refreshUi?: () => void
}

interface DemoControlElements {
  readonly loadAlphaSampleButton: HTMLButtonElement
  readonly restoreGate2FixtureButton: HTMLButtonElement
  readonly selectSampleButton: HTMLButtonElement
  readonly clearSelectionButton: HTMLButtonElement
}

interface DemoControlsHandle {
  readonly destroy: () => void
  readonly selectTextRange: (input: JWordDemoSelectionInput) => SelectionState
}

const DEMO_SELECT_ENABLED_MAX_PAGE_COUNT = 4

/**
 * 职责：根据查询参数加载 demo 初始文本，保留 `?fixture=gate2` 入口契约。
 */
export async function loadInitialDemoText(): Promise<string> {
  if (new URLSearchParams(window.location.search).get('fixture') === 'gate2') {
    return createGate2DemoText(await loadGate2FixtureText())
  }

  return createDefaultDemoText()
}

/**
 * 职责：把 demo-only 场景按钮绑定到公开 Editor facade，并维持按钮禁用状态。
 */
export function createDemoControls(input: CreateDemoControlsOptions): DemoControlsHandle {
  const elements = queryDemoControlElements(input.host)
  const signalController = new AbortController()
  const alphaDemoText = createAlphaDemoText()
  const unsubscribeEditor = input.editor.subscribe((event) => {
    if (event.kind === 'destroyed') {
      return
    }

    renderControlsState(input.editor, elements)
  })

  elements.loadAlphaSampleButton.addEventListener(
    'click',
    () => {
      input.editor.createDocument({ text: alphaDemoText })
      input.refreshUi?.()
      renderControlsState(input.editor, elements)
      announceStatus(input.statusHost, '已加载 Alpha 工具栏样例。')
    },
    { signal: signalController.signal }
  )

  elements.restoreGate2FixtureButton.addEventListener(
    'click',
    () => {
      void restoreGate2Fixture(input)
    },
    { signal: signalController.signal }
  )

  elements.selectSampleButton.addEventListener(
    'click',
    () => {
      if (input.editor.getLayout().pages.length > DEMO_SELECT_ENABLED_MAX_PAGE_COUNT) {
        announceStatus(input.statusHost, 'BLOCKED: 当前 Gate 2 大夹具上的选区体验先禁用；请先加载 Alpha 样例。')
        return
      }

      const selectionInput = findFirstFragmentSelectionInput(input.editor)

      if (selectionInput === null) {
        announceStatus(input.statusHost, 'BLOCKED: 当前分页布局没有可选文本片段。')
        return
      }

      selectTextRange(input.editor, selectionInput)
    },
    { signal: signalController.signal }
  )

  elements.clearSelectionButton.addEventListener(
    'click',
    () => {
      input.editor.setSelection(null)
      announceStatus(input.statusHost, '选区已清空。')
    },
    { signal: signalController.signal }
  )

  renderControlsState(input.editor, elements)

  return {
    destroy: () => {
      signalController.abort()
      unsubscribeEditor()
    },
    selectTextRange: (selectionInput) => {
      return selectTextRange(input.editor, selectionInput)
    }
  }
}

/**
 * 职责：读取 demo-only 按钮节点，确保主入口不再手工拼装场景控件 DOM。
 */
function queryDemoControlElements(host: HTMLElement): DemoControlElements {
  return {
    loadAlphaSampleButton: requireButton(host, '[data-jword-load-alpha]', 'JWord vanilla demo requires [data-jword-load-alpha].'),
    restoreGate2FixtureButton: requireButton(
      host,
      '[data-jword-restore-gate2]',
      'JWord vanilla demo requires [data-jword-restore-gate2].'
    ),
    selectSampleButton: requireButton(
      host,
      '[data-jword-select-sample]',
      'JWord vanilla demo requires [data-jword-select-sample].'
    ),
    clearSelectionButton: requireButton(
      host,
      '[data-jword-clear-selection]',
      'JWord vanilla demo requires [data-jword-clear-selection].'
    )
  }
}

/**
 * 职责：按宿主根节点定位必需按钮，避免 demo-only 控件静默失效。
 */
function requireButton(host: HTMLElement, selector: string, errorMessage: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(selector)

  if (button === null) {
    throw new Error(errorMessage)
  }

  return button
}

/**
 * 职责：把 demo-only 状态提示写入 assistive/status 区，补齐样例切换时的可见反馈。
 */
function announceStatus(statusHost: HTMLElement | null, message: string): void {
  if (statusHost === null) {
    return
  }

  statusHost.textContent = message
}

/**
 * 职责：同步 demo-only 控件的可用状态，保持既有大夹具/小文档行为。
 */
function renderControlsState(editor: Editor, elements: DemoControlElements): void {
  elements.selectSampleButton.disabled = editor.getLayout().pages.length > DEMO_SELECT_ENABLED_MAX_PAGE_COUNT
  elements.clearSelectionButton.disabled = editor.getSelection() === null
}

/**
 * 职责：恢复 Gate 2 50 页夹具，并通知 UI 重新同步状态。
 */
async function restoreGate2Fixture(input: CreateDemoControlsOptions): Promise<void> {
  input.editor.createDocument({
    text: createGate2DemoText(await loadGate2FixtureText())
  })
  input.refreshUi?.()
  renderControlsState(input.editor, queryDemoControlElements(input.host))
  announceStatus(input.statusHost, '已恢复 Gate 2 50 页夹具。')
}

/**
 * 职责：通过公开 text anchor API 建立测试用选区，保留 `window.__jwordDemo.selectTextRange(...)` 契约。
 */
function selectTextRange(editor: Editor, input: JWordDemoSelectionInput): SelectionState {
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

/**
 * 职责：从当前首个可见文本片段生成稳定的 demo 选区输入，保持“选择首页片段”行为不变。
 */
function findFirstFragmentSelectionInput(editor: Editor): JWordDemoSelectionInput | null {
  const firstPage = editor.getLayout().pages[0]
  const firstLine = firstPage?.lines.find((line) => line.fragments.length > 0)
  const firstFragment = firstLine?.fragments[0]

  if (firstFragment === undefined) {
    return null
  }

  const focusGraphemeIndex = Math.min(firstFragment.end.graphemeIndex, firstFragment.start.graphemeIndex + 4)

  return {
    sectionId: firstFragment.sectionId,
    blockId: firstFragment.blockId,
    runId: firstFragment.runId,
    anchorGraphemeIndex: firstFragment.start.graphemeIndex,
    focusGraphemeIndex
  }
}

/**
 * 职责：生成 Gate 2 夹具 demo 文本，延续现有分页校验样本格式。
 */
function createGate2DemoText(fixtureText: string): string {
  return createGate2FixtureEditorText(fixtureText)
}

/**
 * 职责：生成默认 demo 文本，保留当前混排样例内容与可观察行为。
 */
function createDefaultDemoText(): string {
  return [
    '默认混排样例 2026：中文段落用于检查字形宽度，English text checks proportional spacing, 数字 13579 与 24680 交替出现。',
    '第二段随机组合：排版引擎 layout engine 需要同时处理中文、Latin words、SKU-2026-AX19、百分比 38.5% 和标点。',
    '第三段输入验证：请在这里继续输入 abcdefghijklmnopqrstuvwxyz，观察英文光标、鼠标命中点和 canvas 文本是否保持一致。'
  ].join('\n\n')
}

/**
 * 职责：生成 Alpha 小文档样例，保留 Gate 3 工具栏验证文本。
 */
function createAlphaDemoText(): string {
  return [
    'Alpha toolbar sample 第一段：用于验证单 run 选区、撤销重做以及基础格式、颜色与字体状态同步。',
    '第二段：保持分页 canvas 路线，但把交互样例收敛到小文档，避免大夹具的 selection 热路径拖慢体验。'
  ].join('\n\n')
}

/**
 * 职责：按原始 raw fixture 路径读取 Gate 2 文本，保持现有 fixture 契约。
 */
async function loadGate2FixtureText(): Promise<string> {
  const fixture = await import('../../../fixtures/plain-text/gate2-50-pages.txt?raw')

  return fixture.default
}
