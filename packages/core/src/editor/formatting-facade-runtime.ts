/**
 * 职责：承载 Editor facade 的格式命令公开方法。
 * 边界：只把公开格式 API 翻译为 Command，不处理文档加载、位置查询、DOM 或插件调度。
 * 协作模块：命令构建器、选择区目标收集、格式状态读取和事务执行入口。
 * 性能/安全约束：格式修改必须通过统一事务流水线，不直接写 Y.Doc 或 document-store。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetParagraphFirstLineIndentCommand,
  buildSetParagraphHangingIndentCommand,
  buildSetParagraphIndentCommand,
  buildSetParagraphLineHeightCommand,
  buildSetParagraphListCommand,
  buildSetParagraphSpacingAfterCommand,
  buildSetParagraphSpacingBeforeCommand,
  buildSetParagraphStyleCommand,
  buildSetSubscriptCommand,
  buildSetSuperscriptCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from '../operations/command-builders'
import type { ParagraphAlignment, SelectionFormattingState } from '../model/formatting-types'
import { isSelectionCollapsed } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { ParagraphList } from '../model/types'
import type { Command, TransactionResult } from '../operations/transaction'
import { JWordEditorState } from './state'
import type { EditorCommandOptions } from './types'

export abstract class JWordEditorFormattingFacadeRuntime extends JWordEditorState {
  /** 读取当前选择区的格式聚合状态。 */
  protected abstract readCurrentSelectionFormattingState(): SelectionFormattingState

  /** 切换折叠光标后的待输入上下标状态。 */
  protected abstract toggleCollapsedScriptFormatting(kind: 'superscript' | 'subscript'): void

  /** 执行格式命令。 */
  protected abstract executeFacadeFormattingCommand(command: Command | null): void

  /** 执行公开命令入口。 */
  abstract executeCommand(command: Command, options?: EditorCommandOptions): TransactionResult

  /** 切换当前选择区的加粗状态。 */
  toggleBold(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBoldCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.bold.value !== true
    ))
  }

  /** 切换当前选择区的斜体状态。 */
  toggleItalic(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetItalicCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.italic.value !== true
    ))
  }

  /** 切换当前选择区的下划线状态。 */
  toggleUnderline(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetUnderlineCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.underline.value !== true
    ))
  }

  /** 切换当前选择区的删除线状态。 */
  toggleStrike(): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetStrikeCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.strike.value !== true
    ))
  }

  /** 切换当前选择区的上标状态。 */
  toggleSuperscript(): void {
    this.assertActive()
    if (this.currentSelection !== null && isSelectionCollapsed(this.currentSelection)) {
      this.toggleCollapsedScriptFormatting('superscript')
      return
    }

    this.executeFacadeFormattingCommand(buildSetSuperscriptCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.superscript.value !== true
    ))
  }

  /** 切换当前选择区的下标状态。 */
  toggleSubscript(): void {
    this.assertActive()
    if (this.currentSelection !== null && isSelectionCollapsed(this.currentSelection)) {
      this.toggleCollapsedScriptFormatting('subscript')
      return
    }

    this.executeFacadeFormattingCommand(buildSetSubscriptCommand(
      this.currentProjection,
      this.currentSelection,
      this.readCurrentSelectionFormattingState().run?.subscript.value !== true
    ))
  }

  /** 设置当前选择区的字体名称。 */
  setFontFamily(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontFamilyCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区的字号。 */
  setFontSize(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetFontSizeCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区的文字颜色。 */
  setTextColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetTextColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区的背景颜色。 */
  setBackgroundColor(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetBackgroundColorCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的对齐方式。 */
  setParagraphAlignment(value: ParagraphAlignment): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphAlignmentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的左缩进。 */
  setParagraphIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的行距。 */
  setParagraphLineHeight(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphLineHeightCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的段前距。 */
  setParagraphSpacingBefore(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphSpacingBeforeCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的段后距。 */
  setParagraphSpacingAfter(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphSpacingAfterCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的首行缩进。 */
  setParagraphFirstLineIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphFirstLineIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的悬挂缩进。 */
  setParagraphHangingIndent(value: number): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphHangingIndentCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的稳定样式语义。 */
  setParagraphStyle(value: string): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphStyleCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 设置当前选择区段落的稳定列表语义。 */
  setParagraphList(value: ParagraphList | null): void {
    this.assertActive()
    this.executeFacadeFormattingCommand(buildSetParagraphListCommand(
      this.currentProjection,
      this.currentSelection,
      value
    ))
  }

  /** 按增量调整当前选择区段落左缩进。 */
  adjustParagraphIndent(deltaTwips: number): void {
    this.assertActive()

    if (deltaTwips === 0) {
      return
    }

    const targets = collectSelectionTargets(this.currentProjection, this.currentSelection)

    if (targets.paragraphs.length === 0) {
      return
    }

    const command = {
      name: 'adjustParagraphIndent',
      operations: targets.paragraphs.flatMap((target) => {
        const currentIndent = typeof target.paragraph.properties?.indentLeftTwips === 'number'
          ? target.paragraph.properties.indentLeftTwips
          : 0
        const nextIndent = currentIndent + deltaTwips

        return currentIndent === nextIndent
          ? []
          : [{
              kind: 'setParagraphProperties' as const,
              paragraphId: target.paragraph.id,
              properties: { indentLeftTwips: nextIndent }
            }]
      })
    }

    if (command.operations.length === 0) {
      return
    }

    this.executeCommand(command, {
      selectionAfter: this.currentSelection
    })
  }
}
