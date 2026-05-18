/**
 * 职责：计算 Gate 3 toolbar 第一版需要的 run/paragraph 只读格式状态。
 * 边界：只从 projection + selection 读取聚合状态，不执行命令、不修改 Y.Doc、不接触 DOM。
 * 协作模块：toolbar 状态同步、快捷键高亮和后续命令面板可直接消费这里的 tri-state 结果。
 * 性能/安全约束：按当前选区覆盖的最小目标集合聚合属性，未解析出目标时返回 null 状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-39实现-toolbar-状态同步selection-改变时显示当前-runparagraph-状态。
 */

import { collectSelectionTargets } from './selection-targets'
import type { SelectedParagraphTarget } from './selection-targets'
import type {
  FormattingStateValue,
  ParagraphAlignment,
  ParagraphFormattingState,
  RunFormattingState,
  SelectionFormattingState
} from './formatting-types'
import {
  normalizeBooleanFormattingValue
} from './formatting-types'
import type { ModelProperties, ParagraphList } from './types'
import type { DocumentProjection } from './projection'
import type { SelectionState } from './selection'

/**
 * 计算当前选区的最小格式状态。
 *
 * @param projection 当前只读文档投影。
 * @param selection 当前选区。
 * @returns 供 toolbar 读取的 run/paragraph 聚合状态。
 */
export function createSelectionFormattingState(
  projection: DocumentProjection,
  selection: SelectionState | null
): SelectionFormattingState {
  const targets = collectSelectionTargets(projection, selection)
  const paragraphPropertiesList = targets.paragraphs.map((target) => target.paragraph.properties)
  const paragraphRunPropertiesList = collectParagraphRunProperties(targets.paragraphs)

  return {
    run: targets.runs.length === 0
      ? null
      : {
          bold: readBooleanState(targets.runs.map((target) => target.run.properties), 'bold'),
          italic: readBooleanState(targets.runs.map((target) => target.run.properties), 'italic'),
          underline: readBooleanState(targets.runs.map((target) => target.run.properties), 'underline'),
          strike: readBooleanState(targets.runs.map((target) => target.run.properties), 'strike'),
          superscript: readBooleanState(targets.runs.map((target) => target.run.properties), 'superscript'),
          subscript: readBooleanState(targets.runs.map((target) => target.run.properties), 'subscript'),
          fontFamily: readStringState(targets.runs.map((target) => target.run.properties), 'fontFamily'),
          fontSizeTwips: readNumberState(targets.runs.map((target) => target.run.properties), 'fontSizeTwips'),
          color: readStringState(targets.runs.map((target) => target.run.properties), 'color'),
          backgroundColor: readStringState(targets.runs.map((target) => target.run.properties), 'backgroundColor')
        },
    paragraph: targets.paragraphs.length === 0
      ? null
      : {
          alignment: readParagraphAlignmentState(
            paragraphPropertiesList,
            'alignment'
          ),
          lineHeight: readNumberState(paragraphRunPropertiesList, 'lineHeight'),
          indentLeftTwips: readNumberState(
            paragraphPropertiesList,
            'indentLeftTwips'
          ),
          spacingBeforeTwips: readNumberState(paragraphPropertiesList, 'spacingBeforeTwips'),
          spacingAfterTwips: readNumberState(paragraphPropertiesList, 'spacingAfterTwips'),
          firstLineIndentTwips: readNumberState(paragraphPropertiesList, 'firstLineIndentTwips'),
          hangingIndentTwips: readNumberState(paragraphPropertiesList, 'hangingIndentTwips'),
          styleId: readParagraphStyleState(targets.paragraphs),
          list: readParagraphListState(targets.paragraphs)
        }
  }
}

/**
 * 收集段落级行距读取需要的 run 属性列表。
 */
function collectParagraphRunProperties(
  paragraphs: readonly SelectedParagraphTarget[]
): readonly (ModelProperties | undefined)[] {
  return paragraphs.flatMap((target) => target.paragraph.runs.map((run) => run.properties))
}

/**
 * 读取段落样式语义，并把未设置归一成 null。
 */
function readParagraphStyleState(
  paragraphs: readonly SelectedParagraphTarget[]
): FormattingStateValue<string | null> {
  const firstValue = paragraphs[0]?.paragraph.styleId ?? null

  for (let index = 1; index < paragraphs.length; index += 1) {
    if ((paragraphs[index]?.paragraph.styleId ?? null) !== firstValue) {
      return {
        value: undefined,
        mixed: true
      }
    }
  }

  return {
    value: firstValue,
    mixed: false
  }
}

/**
 * 读取段落列表语义，并按结构值判断是否混合。
 */
function readParagraphListState(
  paragraphs: readonly SelectedParagraphTarget[]
): FormattingStateValue<ParagraphList | null> {
  const firstValue = paragraphs[0]?.paragraph.list ?? null

  for (let index = 1; index < paragraphs.length; index += 1) {
    if (!areParagraphListsEquivalent(firstValue, paragraphs[index]?.paragraph.list ?? null)) {
      return {
        value: undefined,
        mixed: true
      }
    }
  }

  return {
    value: firstValue,
    mixed: false
  }
}

function readBooleanState(
  propertiesList: readonly (ModelProperties | undefined)[],
  key: string
): FormattingStateValue<boolean> {
  return readFormattingState(propertiesList, key, (value) => normalizeBooleanFormattingValue(value))
}

function readNumberState(
  propertiesList: readonly (ModelProperties | undefined)[],
  key: string
): FormattingStateValue<number> {
  return readFormattingState(propertiesList, key, (value) => typeof value === 'number' ? value : undefined)
}

function readStringState(
  propertiesList: readonly (ModelProperties | undefined)[],
  key: string
): FormattingStateValue<string> {
  return readFormattingState(propertiesList, key, (value) => typeof value === 'string' ? value : undefined)
}

function readParagraphAlignmentState(
  propertiesList: readonly (ModelProperties | undefined)[],
  key: string
): FormattingStateValue<ParagraphAlignment> {
  return readFormattingState(propertiesList, key, (value) => (
    value === 'left' || value === 'center' || value === 'right' || value === 'justify'
      ? value
      : undefined
  ))
}

/**
 * 判断两个段落列表语义是否等效。
 */
function areParagraphListsEquivalent(
  left: ParagraphList | null,
  right: ParagraphList | null
): boolean {
  if (left === null || right === null) {
    return left === right
  }

  return left.numberingId === right.numberingId
    && left.level === right.level
}

function readFormattingState<Value>(
  propertiesList: readonly (ModelProperties | undefined)[],
  key: string,
  readValue: (value: unknown) => Value | undefined
): FormattingStateValue<Value> {
  const firstValue = readValue(propertiesList[0]?.[key])

  for (let index = 1; index < propertiesList.length; index += 1) {
    if (!Object.is(firstValue, readValue(propertiesList[index]?.[key]))) {
      return {
        value: undefined,
        mixed: true
      }
    }
  }

  return {
    value: firstValue,
    mixed: false
  }
}
