/**
 * 职责：连接 toolbar DOM、core editor facade 和 assistive 句柄，保持 Gate 3 命令语义不变。
 * 边界：不创建 demo-only 场景控件，不修改 core 命令实现，也不实现 assistive 模块内部细节。
 * 协作模块：config 解析显隐，dom 管理节点，state 负责只读状态与文案，assistive 通过句柄协作。
 * 性能/安全约束：所有格式命令继续走 facade/transaction pipeline，不生成第二套编辑状态。
 * Specs：docs/superpowers/plans/2026-05-17-jword-ui-sdk-gate4-integration.md#41-必须迁入-packagesui-的内容。
 */
import {
  buildSetBackgroundColorCommand,
  buildSetTextColorCommand,
  type Editor,
  type PagePreset,
  type SelectionState
} from '@4xian/jword-core'
import type {
  CreateJWordUiOptions,
  JWordToolbarControlElement,
  JWordUiInstance
} from '../types'
import type { LiveRegionController } from '../assistive/live-region'
import type { TextMirrorController } from '../assistive/text-mirror'
import {
  INDENT_STEP_TWIPS,
  FONT_FAMILY_EMPTY_VALUE,
  FONT_FAMILY_MIXED_VALUE,
  FONT_SIZE_EMPTY_VALUE,
  FONT_SIZE_MIXED_VALUE
} from './builtin-tools'
import { resolveToolbarConfig } from './config'
import {
  createToolbarDom,
  destroyToolbarDom,
  renderToolbarState
} from './dom'
import {
  buildToolbarState,
  cloneSelection,
  isRunNumberFormatAlreadyApplied,
  isRunStringFormatAlreadyApplied,
  normalizeHexColor,
  readPagePresetAnnouncement,
  readSelectionAnnouncement,
  readSelectionFormattingState,
  readTransactionAnnouncement,
  shouldAnnounceTransaction
} from './state'

interface ToolbarControllerAssistive {
  readonly liveRegion: LiveRegionController
  readonly textMirror: TextMirrorController | null
}

interface CreateToolbarControllerOptions extends CreateJWordUiOptions {
  readonly assistive: ToolbarControllerAssistive
}

/** 创建并接管官方 toolbar。 */
export function createToolbarController(options: CreateToolbarControllerOptions): JWordUiInstance {
  const toolbarConfig = resolveToolbarConfig(options.toolbar)
  const dom = createToolbarDom(options.toolbarHost, toolbarConfig)
  const assistive = options.assistive
  const editor = options.editor
  let suppressSelectionAnnouncementsUntil = 0
  let suppressAfterToolbarTransaction = false
  const frozenColorSelections = {
    text: null as SelectionState | null,
    background: null as SelectionState | null
  }
  const unsubscribeEditor = editor.subscribe((event) => {
    if (event.kind === 'selectionChange') {
      render()
      syncTextMirror()

      if (performance.now() >= suppressSelectionAnnouncementsUntil) {
        announce(readSelectionAnnouncement(editor, event.selection))
      }

      return
    }

    if (event.kind === 'transaction') {
      render()

      if (shouldAnnounceTransaction(event.transaction.commandName)) {
        if (suppressAfterToolbarTransaction) {
          suppressSelectionAnnouncementsUntil = performance.now() + 160
        }

        suppressAfterToolbarTransaction = false
        announce(readTransactionAnnouncement(editor, event.transaction.commandName), true)
      }

      return
    }

    if (event.kind === 'destroyed') {
      assistive?.liveRegion?.announce('JWord editor 已销毁。')
    }
  })

  /** 只重绘 toolbar，不触发额外 assistive 副作用。 */
  function render(): void {
    renderToolbarState(dom, buildToolbarState(editor))
  }

  /** 同步 assistive text mirror。 */
  function syncTextMirror(immediate = false): void {
    assistive.textMirror?.sync(immediate ? { immediate: true } : undefined)
  }

  /** 统一处理 live region 播报，并按需先刷新 text mirror。 */
  function announce(message: string, refreshMirror = false): void {
    if (refreshMirror) {
      syncTextMirror(true)
    }

    assistive.liveRegion.announce(message)
  }

  /** 标记下一次 toolbar 触发的事务应当压住紧随其后的选区播报。 */
  function markToolbarTransaction(): void {
    suppressAfterToolbarTransaction = true

    queueMicrotask(() => {
      suppressAfterToolbarTransaction = false
    })
  }

  /** 绑定所有实际挂载出来的控件事件。 */
  function bindEvents(): void {
    bindButton(dom.controls['history.undo'], () => {
      markToolbarTransaction()
      const result = editor.undo()

      refresh()
      announce(result.stackItem === null ? '没有可撤销的本地操作。' : '已撤销最近一次本地操作。', result.stackItem !== null)
    })
    bindButton(dom.controls['history.redo'], () => {
      markToolbarTransaction()
      const result = editor.redo()

      refresh()
      announce(result.stackItem === null ? '没有可重做的本地操作。' : '已重做最近一次本地操作。', result.stackItem !== null)
    })
    bindSelect(dom.controls['document.pagePreset'], () => {
      const control = readSelect(dom.controls['document.pagePreset'])

      if (control === null) {
        return
      }

      const nextPreset = control.value as PagePreset
      const currentPreset = editor.getPageConfig().preset

      if (currentPreset === nextPreset) {
        render()
        return
      }

      markToolbarTransaction()
      const nextPageConfig = editor.setPageConfig({
        preset: nextPreset
      })

      render()
      announce(readPagePresetAnnouncement(nextPreset, nextPageConfig), true)
    })
    bindButton(dom.controls['format.bold'], () => {
      toggleActiveRunBooleanFormat('bold', '加粗')
    })
    bindButton(dom.controls['format.italic'], () => {
      toggleActiveRunBooleanFormat('italic', '斜体')
    })
    bindButton(dom.controls['format.underline'], () => {
      toggleActiveRunBooleanFormat('underline', '下划线')
    })
    bindButton(dom.controls['format.strike'], () => {
      toggleActiveRunBooleanFormat('strike', '删除线')
    })
    bindSelect(dom.controls['format.fontFamily'], () => {
      const control = readSelect(dom.controls['format.fontFamily'])

      if (control === null) {
        return
      }

      const value = control.value

      if (value === FONT_FAMILY_EMPTY_VALUE || value === FONT_FAMILY_MIXED_VALUE) {
        render()
        return
      }

      applyRunStringFormat('fontFamily', '字体', value)
    })
    bindSelect(dom.controls['format.fontSize'], () => {
      const control = readSelect(dom.controls['format.fontSize'])

      if (control === null) {
        return
      }

      const value = control.value

      if (value === FONT_SIZE_EMPTY_VALUE || value === FONT_SIZE_MIXED_VALUE) {
        render()
        return
      }

      const parsedValue = Number.parseInt(value, 10)

      if (!Number.isFinite(parsedValue)) {
        announce(`BLOCKED: 无法识别字号值 ${value}。`)
        render()
        return
      }

      applyRunNumberFormat('字号', parsedValue)
    })
    bindColorClick(dom.controls['format.textColor'], () => {
      frozenColorSelections.text = cloneSelection(editor.getSelection())
    })
    bindColorClick(dom.controls['format.backgroundColor'], () => {
      frozenColorSelections.background = cloneSelection(editor.getSelection())
    })
    bindColorChange(dom.controls['format.textColor'], () => {
      const control = readColor(dom.controls['format.textColor'])

      if (control === null) {
        return
      }

      applyColorFormatFromFrozenSelection('textColor', '文字颜色', control.value.toLowerCase())
    })
    bindColorChange(dom.controls['format.backgroundColor'], () => {
      const control = readColor(dom.controls['format.backgroundColor'])

      if (control === null) {
        return
      }

      applyColorFormatFromFrozenSelection('backgroundColor', '背景色', control.value.toLowerCase())
    })
    bindButton(dom.controls['paragraph.alignLeft'], () => {
      applyParagraphAlignment('left', '左对齐')
    })
    bindButton(dom.controls['paragraph.alignCenter'], () => {
      applyParagraphAlignment('center', '居中对齐')
    })
    bindButton(dom.controls['paragraph.alignRight'], () => {
      applyParagraphAlignment('right', '右对齐')
    })
    bindButton(dom.controls['paragraph.alignJustify'], () => {
      applyParagraphAlignment('justify', '两端对齐')
    })
    bindButton(dom.controls['paragraph.indentDecrease'], () => {
      adjustParagraphIndent(-INDENT_STEP_TWIPS, '减少缩进')
    })
    bindButton(dom.controls['paragraph.indentIncrease'], () => {
      adjustParagraphIndent(INDENT_STEP_TWIPS, '增加缩进')
    })
  }

  /** 在当前选区上切换布尔格式。 */
  function toggleActiveRunBooleanFormat(
    property: 'bold' | 'italic' | 'underline' | 'strike',
    label: string
  ): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      return
    }

      switch (property) {
      case 'bold':
        markToolbarTransaction()
        editor.toggleBold()
        return
      case 'italic':
        markToolbarTransaction()
        editor.toggleItalic()
        return
      case 'underline':
        markToolbarTransaction()
        editor.toggleUnderline()
        return
      case 'strike':
        markToolbarTransaction()
        editor.toggleStrike()
        return
    }
  }

  /** 应用字符串格式。 */
  function applyRunStringFormat(
    property: 'fontFamily' | 'textColor' | 'backgroundColor',
    label: string,
    value: string
  ): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    if (isRunStringFormatAlreadyApplied(formattingState, property, value)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    switch (property) {
      case 'fontFamily':
        markToolbarTransaction()
        editor.setFontFamily(value)
        return
      case 'textColor':
        markToolbarTransaction()
        editor.setTextColor(value)
        return
      case 'backgroundColor':
        markToolbarTransaction()
        editor.setBackgroundColor(value)
        return
    }
  }

  /** 应用冻结选区上的颜色格式。 */
  function applyColorFormatFromFrozenSelection(
    property: 'textColor' | 'backgroundColor',
    label: string,
    value: string
  ): void {
    const selection = property === 'textColor'
      ? frozenColorSelections.text ?? editor.getSelection()
      : frozenColorSelections.background ?? editor.getSelection()
    const formattingState = selection === null ? null : readSelectionFormattingState(editor, selection)
    const normalizedValue = normalizeHexColor(value) ?? value

    if (selection === null || formattingState === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    if (isRunStringFormatAlreadyApplied(formattingState, property, normalizedValue)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    const command = property === 'textColor'
      ? buildSetTextColorCommand(editor.getProjection(), selection, normalizedValue)
      : buildSetBackgroundColorCommand(editor.getProjection(), selection, normalizedValue)

    if (command === null) {
      announce(`BLOCKED: ${label} 当前没有可应用的文本目标。`)
      render()
      clearFrozenColorSelection(property)
      return
    }

    markToolbarTransaction()
    editor.executeCommand(command, {
      selectionAfter: selection
    })
    clearFrozenColorSelection(property)
  }

  /** 应用字号格式。 */
  function applyRunNumberFormat(label: string, value: number): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.run === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的文本选区。`)
      render()
      return
    }

    if (isRunNumberFormatAlreadyApplied(formattingState, value)) {
      announce(`${label} 已经处于目标状态。`)
      render()
      return
    }

    markToolbarTransaction()
    editor.setFontSize(value)
  }

  /** 应用段落对齐。 */
  function applyParagraphAlignment(value: 'left' | 'center' | 'right' | 'justify', label: string): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的段落选区。`)
      return
    }

    if (formattingState.paragraph.alignment.mixed !== true && formattingState.paragraph.alignment.value === value) {
      announce(`${label} 已经处于目标状态。`)
      return
    }

    markToolbarTransaction()
    editor.setParagraphAlignment(value)
  }

  /** 调整段落缩进。 */
  function adjustParagraphIndent(deltaTwips: number, label: string): void {
    const selection = editor.getSelection()
    const formattingState = editor.getSelectionFormattingState()

    if (selection === null || formattingState.paragraph === null) {
      announce(`BLOCKED: ${label} 需要当前有可格式化的段落选区。`)
      return
    }

    const currentIndent = formattingState.paragraph.indentLeftTwips.mixed
      ? 0
      : formattingState.paragraph.indentLeftTwips.value ?? 0
    const nextIndent = Math.max(0, currentIndent + deltaTwips)

    if (currentIndent === nextIndent) {
      announce(`${label} 已经处于目标状态。`)
      return
    }

    markToolbarTransaction()
    editor.adjustParagraphIndent(deltaTwips)
  }

  /** 清除单次颜色冻结快照。 */
  function clearFrozenColorSelection(property: 'textColor' | 'backgroundColor'): void {
    if (property === 'textColor') {
      frozenColorSelections.text = null
      return
    }

    frozenColorSelections.background = null
  }

  /** 对宿主暴露的手动刷新入口，同时同步隐藏 mirror。 */
  function refresh(): void {
    render()
    syncTextMirror()
  }

  bindEvents()
  refresh()

  return {
    elements: dom,
    refresh,
    destroy(): void {
      unsubscribeEditor()
      assistive.liveRegion.destroy()
      assistive.textMirror?.destroy()
      destroyToolbarDom(dom)
    }
  }
}

/** 在按钮上绑定点击事件。 */
function bindButton(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLButtonElement)) {
    return
  }

  control.addEventListener('click', handler)
}

/** 在 select 上绑定 change 事件。 */
function bindSelect(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLSelectElement)) {
    return
  }

  control.addEventListener('change', handler)
}

/** 在颜色控件上绑定 click 事件。 */
function bindColorClick(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('click', handler)
}

/** 在颜色控件上绑定 change 事件。 */
function bindColorChange(control: JWordToolbarControlElement | undefined, handler: () => void): void {
  if (!(control instanceof HTMLInputElement)) {
    return
  }

  control.addEventListener('change', handler)
}

/** 安全读取 select 控件。 */
function readSelect(control: JWordToolbarControlElement | undefined): HTMLSelectElement | null {
  return control instanceof HTMLSelectElement ? control : null
}

/** 安全读取颜色控件。 */
function readColor(control: JWordToolbarControlElement | undefined): HTMLInputElement | null {
  return control instanceof HTMLInputElement ? control : null
}
