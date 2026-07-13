/**
 * 职责：封装 toolbar 段落格式控件动作。
 * 边界：只处理段落对齐、缩进、行距、间距、样式和列表命令，不处理 run 格式或面板入口。
 * 协作模块：controller 绑定 DOM 事件，toolbar-state-sync 提供统一 action 上下文。
 * 性能/安全约束：段落变更继续走 editor facade/transaction pipeline，不直接改 DOM 文档状态。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildSetParagraphIndentCommand,
  type Block,
  type Command,
  type Editor,
  type FormattingStateValue,
  type Paragraph,
  type ParagraphAlignment,
  type ParagraphList,
  type SelectionState
} from '@4xian/jword-core'
import { readJWordUiText } from '../i18n'
import type { JWordToolbarToolId } from '../types'
import {
  isToolbarPlaceholderSelectValue,
  parseParagraphListSelectValue,
  readParagraphAlignmentLabel as readParagraphAlignmentText
} from './builtin-tools'
import type { ToolbarActionContext } from './toolbar-state-sync'
import {
  bindToolbarButton,
  bindToolbarSelect,
  readNumericToolbarSelectValue,
  readSelect
} from './toolbar-state-sync'

/** 绑定段落格式相关 toolbar 控件。 */
export function bindParagraphControls(context: ToolbarActionContext): void {
  const { dom } = context

  bindToolbarSelect(context, dom.controls['paragraph.alignment'], () => {
    const control = readSelect(dom.controls['paragraph.alignment'])
    const value = control === null ? null : parseParagraphAlignmentValue(control.value)

    if (value === null) {
      context.render()
      return
    }

    applyParagraphAlignment(
      context,
      value,
      readJWordUiText(
        context.readI18n(),
        `toolbar.paragraph.alignment.option.${value}`
      )
    )
  })
  bindToolbarButton(context, dom.controls['paragraph.indentDecrease'], () => {
    adjustParagraphIndentBy(context, -360)
  })
  bindToolbarButton(context, dom.controls['paragraph.indentIncrease'], () => {
    adjustParagraphIndentBy(context, 360)
  })
  bindToolbarSelect(context, dom.controls['paragraph.indentLeft'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.indentLeft'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphIndentLeft(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.lineHeight'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.lineHeight'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphLineHeight(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.spacingBefore'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.spacingBefore'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphSpacingBefore(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.spacingAfter'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.spacingAfter'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphSpacingAfter(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.firstLineIndent'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.firstLineIndent'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphFirstLineIndent(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.hangingIndent'], () => {
    const value = readNumericToolbarSelectValue(dom.controls['paragraph.hangingIndent'])

    if (value === null) {
      context.render()
      return
    }

    applyParagraphHangingIndent(context, value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.style'], () => {
    const control = readSelect(dom.controls['paragraph.style'])

    if (control === null || isToolbarPlaceholderSelectValue(control.value)) {
      context.render()
      return
    }

    applyParagraphStyle(context, control.value)
  })
  bindToolbarSelect(context, dom.controls['paragraph.list'], () => {
    const control = readSelect(dom.controls['paragraph.list'])
    const value = control === null ? undefined : parseParagraphListSelectValue(control.value)

    if (value === undefined) {
      context.render()
      return
    }

    applyParagraphList(context, value)
  })
}

/** 把段落对齐 select 的字符串值收敛成 facade 可接受的枚举。 */
function parseParagraphAlignmentValue(value: string): ParagraphAlignment | null {
  switch (value) {
    case 'left':
    case 'center':
    case 'right':
    case 'justify':
      return value
    default:
      return null
  }
}

/** 应用段落对齐。 */
function applyParagraphAlignment(context: ToolbarActionContext, value: 'left' | 'center' | 'right' | 'justify', label: string): void {
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (formattingState.paragraph.alignment.mixed !== true && formattingState.paragraph.alignment.value === value) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphAlignment(value)
}

/** 应用段落左缩进。 */
function applyParagraphIndentLeft(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.indentLeft')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (formattingState.paragraph.indentLeftTwips.mixed !== true && (formattingState.paragraph.indentLeftTwips.value ?? 0) === value) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  const command = buildSetParagraphIndentCommand(context.editor.getProjection(), selection, value)

  if (command === null) {
    context.announce(readJWordUiText(
      context.readI18n(),
      'a11y.toolbar.paragraph.targetUnavailable'
    ).replace('{label}', label))
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.executeCommand(command, {
    selectionAfter: selection
  })
}

/** 按腾讯文档式按钮对当前段落做缩进步进，并在 0 处钳制。 */
function adjustParagraphIndentBy(context: ToolbarActionContext, deltaTwips: number): void {
  const label = readParagraphControlLabel(
    context,
    deltaTwips > 0 ? 'paragraph.indentIncrease' : 'paragraph.indentDecrease'
  )
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  const command = buildAdjustParagraphIndentCommand(context.editor, selection, deltaTwips)

  if (command === null) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.executeCommand(command, {
    selectionAfter: selection
  })
}

/** 应用段落行距。 */
function applyParagraphLineHeight(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.lineHeight')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.lineHeight, value)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphLineHeight(value)
}

/** 应用段前间距。 */
function applyParagraphSpacingBefore(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.spacingBefore')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.spacingBeforeTwips, value)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphSpacingBefore(value)
}

/** 应用段后间距。 */
function applyParagraphSpacingAfter(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.spacingAfter')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.spacingAfterTwips, value)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphSpacingAfter(value)
}

/** 应用首行缩进。 */
function applyParagraphFirstLineIndent(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.firstLineIndent')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.firstLineIndentTwips, value)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphFirstLineIndent(value)
}

/** 应用悬挂缩进。 */
function applyParagraphHangingIndent(context: ToolbarActionContext, value: number): void {
  const label = readParagraphControlLabel(context, 'paragraph.hangingIndent')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (isParagraphNumberStateAlreadyApplied(formattingState.paragraph.hangingIndentTwips, value)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphHangingIndent(value)
}

/** 应用段落样式。 */
function applyParagraphStyle(context: ToolbarActionContext, value: string): void {
  const label = readParagraphControlLabel(context, 'paragraph.style')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (formattingState.paragraph.styleId.mixed !== true && formattingState.paragraph.styleId.value === value) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphStyle(value)
}

/** 应用段落列表；清空列表时先走当前 UI 层兼容 command。 */
function applyParagraphList(context: ToolbarActionContext, value: ParagraphList | null): void {
  const label = readParagraphControlLabel(context, 'paragraph.list')
  const selection = context.editor.getSelection()
  const formattingState = context.editor.getSelectionFormattingState()

  if (selection === null || formattingState.paragraph === null) {
    announceParagraphSelectionRequired(context, label)
    context.render()
    return
  }

  if (areParagraphListsEquivalent(formattingState.paragraph.list.value ?? null, value, formattingState.paragraph.list.mixed)) {
    announceParagraphAlreadyApplied(context, label)
    context.render()
    return
  }

  if (value === null) {
    const command = buildClearParagraphListCommand(context.editor, selection)

    if (command === null) {
      context.announce(readJWordUiText(
        context.readI18n(),
        'a11y.toolbar.paragraph.clearListUnavailable'
      ))
      context.render()
      return
    }

    context.markToolbarTransaction()
    context.editor.executeCommand(command, {
      selectionAfter: selection
    })
    return
  }

  context.markToolbarTransaction()
  context.editor.setParagraphList(value)
}

/** 读取当前语言的段落工具名称。 */
function readParagraphControlLabel(
  context: ToolbarActionContext,
  toolId: JWordToolbarToolId
): string {
  return readJWordUiText(context.readI18n(), `toolbar.${toolId}.label`)
}

/** 播报段落格式缺少有效选区。 */
function announceParagraphSelectionRequired(context: ToolbarActionContext, label: string): void {
  context.announce(readJWordUiText(
    context.readI18n(),
    'a11y.toolbar.paragraph.selectionRequired'
  ).replace('{label}', label))
}

/** 播报段落格式已经处于目标状态。 */
function announceParagraphAlreadyApplied(context: ToolbarActionContext, label: string): void {
  context.announce(readJWordUiText(
    context.readI18n(),
    'a11y.toolbar.paragraph.alreadyApplied'
  ).replace('{label}', label))
}

/** 判断段落数字格式是否已处于目标状态。 */
function isParagraphNumberStateAlreadyApplied(value: FormattingStateValue<number>, target: number): boolean {
  return value.mixed !== true && value.value === target
}

/** 判断段落列表是否已处于目标状态。 */
function areParagraphListsEquivalent(
  current: ParagraphList | null,
  target: ParagraphList | null,
  mixed: boolean
): boolean {
  if (mixed) {
    return false
  }

  if (current === null || target === null) {
    return current === target
  }

  return current.numberingId === target.numberingId && current.level === target.level
}

/** 为缩进步进按钮构造带 0 下限钳制的 command。 */
function buildAdjustParagraphIndentCommand(editor: Editor, selection: SelectionState, deltaTwips: number): Command | null {
  if (deltaTwips === 0) {
    return null
  }

  const operations = collectSelectedParagraphs(editor, selection).flatMap((paragraph) => {
    const currentIndent = typeof paragraph.properties?.indentLeftTwips === 'number'
      ? paragraph.properties.indentLeftTwips
      : 0
    const nextIndent = Math.max(0, currentIndent + deltaTwips)

    return currentIndent === nextIndent
      ? []
      : [{
          kind: 'setParagraphProperties' as const,
          paragraphId: paragraph.id,
          properties: {
            indentLeftTwips: nextIndent
          }
        }]
  })

  return operations.length === 0
    ? null
    : {
        name: 'adjustParagraphIndent',
        operations
      }
}

/** 为 clear-list 构造当前 UI 层的兼容 command。 */
function buildClearParagraphListCommand(editor: Editor, selection: SelectionState): Command | null {
  const paragraphs = collectSelectedParagraphs(editor, selection)
  const operations = paragraphs
    .filter((paragraph) => !isParagraphPropertiesEquivalent(paragraph, {
      listNumberingId: null,
      listLevel: null
    }))
    .map((paragraph) => ({
      kind: 'setParagraphProperties' as const,
      paragraphId: paragraph.id,
      properties: {
        listNumberingId: null,
        listLevel: null
      }
    }))

  if (operations.length === 0) {
    return null
  }

  return {
    name: 'setParagraphList',
    operations
  }
}

/** 以文档顺序收集当前选区覆盖的段落。 */
function collectSelectedParagraphs(editor: Editor, selection: SelectionState): readonly Paragraph[] {
  const projection = editor.getProjection()
  const paragraphs = flattenParagraphs(projection.document.sections.flatMap((section) => section.blocks))
  const anchorPosition = editor.resolveTextPosition(selection.anchor)
  const focusPosition = editor.resolveTextPosition(selection.focus)
  const anchorIndex = paragraphs.findIndex((paragraph) => paragraph.id === anchorPosition.blockId)
  const focusIndex = paragraphs.findIndex((paragraph) => paragraph.id === focusPosition.blockId)

  if (anchorIndex < 0 || focusIndex < 0) {
    return []
  }

  const startIndex = Math.min(anchorIndex, focusIndex)
  const endIndex = Math.max(anchorIndex, focusIndex)

  return paragraphs.slice(startIndex, endIndex + 1)
}

/** 把 block 树拍平成文档顺序段落数组。 */
function flattenParagraphs(blocks: readonly Block[]): readonly Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const block of blocks) {
    if (block.kind === 'paragraph') {
      paragraphs.push(block)
      continue
    }

    for (const row of block.rows) {
      for (const cell of row.cells) {
        paragraphs.push(...flattenParagraphs(cell.blocks))
      }
    }
  }

  return paragraphs
}

/** 判断段落属性是否已经等价于目标值；null 与缺失统一视为“已清空”。 */
function isParagraphPropertiesEquivalent(
  paragraph: Paragraph,
  properties: Readonly<Record<string, string | number | null>>
): boolean {
  return Object.entries(properties).every(([key, value]) => {
    const currentValue = paragraph.properties?.[key]

    if (value === null) {
      return currentValue === null || currentValue === undefined
    }

    return Object.is(currentValue, value)
  })
}
