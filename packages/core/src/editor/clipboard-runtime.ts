/**
 * 职责：封装 editor runtime 的全选范围与 HTML 剪贴板片段序列化。
 * 边界：不绑定 DOM 事件，不执行事务，不读取画布布局。
 * 协作模块：selection targets 提供选区 run，text-runtime 提供段落上下文和 runtime anchor。
 * 性能/安全约束：只基于当前只读 projection 派生字符串，不保留可写模型引用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { splitGraphemes } from '../shared/grapheme'
import { createSelectionState, isSelectionCollapsed } from '../model/selection'
import type { SelectionState } from '../model/selection'
import { collectSelectionTargets } from '../model/selection-targets'
import type { DocumentProjection } from '../model/projection'
import type { ModelProperties, Paragraph } from '../model/types'
import { collectParagraphRuntimeContexts, createRuntimeAnchor } from './text-runtime'

type RuntimeParagraph = ReturnType<typeof collectParagraphRuntimeContexts>[number]

/**
 * 从当前 projection 和 selection 读取 HTML 剪贴板片段。
 */
export function readSelectionHtmlFromProjection(
  projection: DocumentProjection,
  selection: SelectionState | null
): string {
  if (selection === null || isSelectionCollapsed(selection)) {
    return ''
  }

  const targets = collectSelectionTargets(projection, selection)

  if (targets.runs.length === 0) {
    return ''
  }

  const paragraphById = new Map(targets.paragraphs.map((target) => [target.paragraph.id, target.paragraph]))
  const paragraphs: string[] = []
  let currentParagraphId: string | undefined
  let currentRuns: string[] = []

  for (const target of targets.runs) {
    if (currentParagraphId !== undefined && currentParagraphId !== target.paragraphId) {
      paragraphs.push(formatClipboardParagraph(paragraphById.get(currentParagraphId), currentRuns))
      currentRuns = []
    }

    currentParagraphId = target.paragraphId
    currentRuns.push(formatClipboardRun(
      splitGraphemes(
        target.run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
      )
        .slice(target.selectedStartGraphemeIndex, target.selectedEndGraphemeIndex)
        .join(''),
      target.run.properties
    ))
  }

  if (currentParagraphId !== undefined) {
    paragraphs.push(formatClipboardParagraph(paragraphById.get(currentParagraphId), currentRuns))
  }

  return paragraphs.join('')
}

/**
 * 创建覆盖整篇文档文本的 selection。
 */
export function createAllTextSelection(
  projection: DocumentProjection,
  documentId: string
): SelectionState | undefined {
  const paragraphs = collectParagraphRuntimeContexts(projection)
  const first = findFirstRuntimeRun(paragraphs)
  const last = findLastRuntimeRun(paragraphs)

  if (first === undefined || last === undefined) {
    return undefined
  }

  const anchor = createRuntimeAnchor({
    documentId,
    sectionId: first.sectionId,
    blockId: first.blockId,
    runId: first.runId,
    graphemeIndex: 0
  })
  const focus = createRuntimeAnchor({
    documentId,
    sectionId: last.sectionId,
    blockId: last.blockId,
    runId: last.runId,
    graphemeIndex: last.graphemeLength,
    assoc: -1
  })

  return createSelectionState(anchor, focus)
}

/**
 * 查找文档顺序里的第一个 run。
 */
function findFirstRuntimeRun(paragraphs: readonly RuntimeParagraph[]): Readonly<{
  sectionId: string
  blockId: string
  runId: string
  graphemeLength: number
}> | undefined {
  for (const paragraph of paragraphs) {
    for (const run of paragraph.runs) {
      if (run.graphemeLength <= 0) {
        continue
      }

      return {
        sectionId: paragraph.sectionId,
        blockId: paragraph.blockId,
        runId: run.id,
        graphemeLength: run.graphemeLength
      }
    }
  }

  return undefined
}

/**
 * 查找文档顺序里的最后一个 run。
 */
function findLastRuntimeRun(paragraphs: readonly RuntimeParagraph[]): Readonly<{
  sectionId: string
  blockId: string
  runId: string
  graphemeLength: number
}> | undefined {
  for (let paragraphIndex = paragraphs.length - 1; paragraphIndex >= 0; paragraphIndex -= 1) {
    const paragraph = paragraphs[paragraphIndex]
    
    if (paragraph === undefined) {
      continue
    }

    for (let runIndex = paragraph.runs.length - 1; runIndex >= 0; runIndex -= 1) {
      const run = paragraph.runs[runIndex]

      if (run === undefined || run.graphemeLength <= 0) {
        continue
      }

      return {
        sectionId: paragraph.sectionId,
        blockId: paragraph.blockId,
        runId: run.id,
        graphemeLength: run.graphemeLength
      }
    }
  }

  return undefined
}

/**
 * 序列化剪贴板段落。
 */
function formatClipboardParagraph(paragraph: Paragraph | undefined, runs: readonly string[]): string {
  const style = formatClipboardParagraphStyle(paragraph?.properties)
  const body = runs.join('') || '<br>'

  return `<p${style.length === 0 ? '' : ` style="${escapeHtmlAttribute(style)}"`}>${body}</p>`
}

/**
 * 序列化剪贴板 run。
 */
function formatClipboardRun(text: string, properties: ModelProperties | undefined): string {
  const style = formatClipboardRunStyle(properties)
  const content = escapeHtmlText(text)

  return `<span${style.length === 0 ? '' : ` style="${escapeHtmlAttribute(style)}"`}>${content}</span>`
}

/**
 * 生成段落级剪贴板样式。
 */
function formatClipboardParagraphStyle(properties: ModelProperties | undefined): string {
  const declarations = ['margin: 0', 'white-space: pre-wrap']
  const alignment = readStringProperty(properties, 'alignment')
  const indentLeftTwips = readNumberProperty(properties, 'indentLeftTwips')

  if (alignment === 'center' || alignment === 'right' || alignment === 'justify') {
    declarations.push(`text-align: ${alignment}`)
  }

  if (indentLeftTwips !== undefined && indentLeftTwips > 0) {
    declarations.push(`margin-left: ${formatTwipsAsPoints(indentLeftTwips)}`)
  }

  return declarations.join('; ')
}

/**
 * 生成 run 级剪贴板样式。
 */
function formatClipboardRunStyle(properties: ModelProperties | undefined): string {
  const declarations: string[] = []
  const decorations: string[] = []
  const fontFamily = readStringProperty(properties, 'fontFamily')
  const fontSizePx = readNumberProperty(properties, 'fontSizePx')
  const fontSizeTwips = readNumberProperty(properties, 'fontSizeTwips')
  const color = readStringProperty(properties, 'color')
  const backgroundColor = readStringProperty(properties, 'backgroundColor')

  if (readBooleanProperty(properties, 'bold') === true) {
    declarations.push('font-weight: 700')
  }

  if (readBooleanProperty(properties, 'italic') === true) {
    declarations.push('font-style: italic')
  }

  if (readBooleanProperty(properties, 'underline') === true) {
    decorations.push('underline')
  }

  if (readBooleanProperty(properties, 'strike') === true) {
    decorations.push('line-through')
  }

  if (decorations.length > 0) {
    declarations.push(`text-decoration: ${decorations.join(' ')}`)
  }

  if (fontFamily !== undefined && fontFamily.length > 0) {
    declarations.push(`font-family: ${formatCssFontFamily(fontFamily)}`)
  }

  if (fontSizeTwips !== undefined && fontSizeTwips > 0) {
    declarations.push(`font-size: ${formatTwipsAsPoints(fontSizeTwips)}`)
  } else if (fontSizePx !== undefined && fontSizePx > 0) {
    declarations.push(`font-size: ${formatCssNumber(fontSizePx)}px`)
  }

  if (color !== undefined && color.length > 0) {
    declarations.push(`color: ${color}`)
  }

  if (backgroundColor !== undefined && backgroundColor.length > 0) {
    declarations.push(`background-color: ${backgroundColor}`)
  }

  return declarations.join('; ')
}

/**
 * 读取字符串属性。
 */
function readStringProperty(properties: ModelProperties | undefined, key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

/**
 * 读取数值属性。
 */
function readNumberProperty(properties: ModelProperties | undefined, key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' ? value : undefined
}

/**
 * 读取布尔属性。
 */
function readBooleanProperty(properties: ModelProperties | undefined, key: string): boolean | undefined {
  const value = properties?.[key]

  return typeof value === 'boolean' ? value : undefined
}

/**
 * 格式化 CSS 字体族。
 */
function formatCssFontFamily(value: string): string {
  return value
    .split(',')
    .map((item) => `"${item.trim().replace(/\\/gu, '\\\\').replace(/"/gu, '\\"')}"`)
    .join(', ')
}

/**
 * 把 twips 转成 pt 字符串。
 */
function formatTwipsAsPoints(value: number): string {
  return `${formatCssNumber(value / 20)}pt`
}

/**
 * 格式化 CSS 数字。
 */
function formatCssNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/u, '').replace(/\.$/u, '')
}

/**
 * 转义 HTML 文本。
 */
function escapeHtmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

/**
 * 转义 HTML 属性。
 */
function escapeHtmlAttribute(value: string): string {
  return escapeHtmlText(value)
    .replace(/"/gu, '&quot;')
}
