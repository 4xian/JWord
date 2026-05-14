/**
 * 职责：计算 Gate 3 toolbar 第一版需要的 run/paragraph 只读格式状态。
 * 边界：只从 projection + selection 读取聚合状态，不执行命令、不修改 Y.Doc、不接触 DOM。
 * 协作模块：toolbar 状态同步、快捷键高亮和后续命令面板可直接消费这里的 tri-state 结果。
 * 性能/安全约束：按当前选区覆盖的最小目标集合聚合属性，未解析出目标时返回 null 状态。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#step-39实现-toolbar-状态同步selection-改变时显示当前-runparagraph-状态。
 */

import { collectSelectionTargets } from './selection-targets'
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
import type { ModelProperties } from './model'
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

  return {
    run: targets.runs.length === 0
      ? null
      : {
          bold: readBooleanState(targets.runs.map((target) => target.run.properties), 'bold'),
          italic: readBooleanState(targets.runs.map((target) => target.run.properties), 'italic'),
          underline: readBooleanState(targets.runs.map((target) => target.run.properties), 'underline'),
          strike: readBooleanState(targets.runs.map((target) => target.run.properties), 'strike'),
          fontFamily: readStringState(targets.runs.map((target) => target.run.properties), 'fontFamily'),
          fontSizeTwips: readNumberState(targets.runs.map((target) => target.run.properties), 'fontSizeTwips'),
          color: readStringState(targets.runs.map((target) => target.run.properties), 'color'),
          backgroundColor: readStringState(targets.runs.map((target) => target.run.properties), 'backgroundColor')
        },
    paragraph: targets.paragraphs.length === 0
      ? null
      : {
          alignment: readParagraphAlignmentState(
            targets.paragraphs.map((target) => target.paragraph.properties),
            'alignment'
          ),
          indentLeftTwips: readNumberState(
            targets.paragraphs.map((target) => target.paragraph.properties),
            'indentLeftTwips'
          )
        }
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
