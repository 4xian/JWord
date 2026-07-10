/**
 * 职责：提供底部状态栏阶段 A 的纯状态计算函数。
 * 边界：只读取 projection 和配置输入，不创建 DOM、不订阅 editor、不调用命令。
 * 协作模块：status-bar controller 后续消费这里的统计、显隐、缩放和 locale 结果。
 * 性能/安全约束：函数保持同步纯计算，不访问 window/document，不引入运行时副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { countGraphemes } from '@4xian/jword-core'
import type { Block, DocumentProjection, Paragraph, Run } from '@4xian/jword-core'

import type {
  JWordStatusBarDocumentStats,
  JWordStatusBarItemId,
  JWordStatusBarLocale,
  JWordStatusBarOptions,
  JWordStatusBarZoomOptions
} from '../types'

export const DEFAULT_STATUS_BAR_MIN_ZOOM_PERCENT = 20
export const DEFAULT_STATUS_BAR_MAX_ZOOM_PERCENT = 400
export const DEFAULT_STATUS_BAR_ZOOM_STEP_PERCENT = 10

export const DEFAULT_STATUS_BAR_ITEM_IDS = [
  'brand',
  'wordCount',
  'characterCount',
  'paragraphCount',
  'page',
  'selection',
  'fullscreen',
  'presentation',
  'zoomSlider',
  'zoomPercent',
  'zoomReset',
  'fitWidth',
  'fitPage',
  'themeSwitcher',
  'localeSwitcher'
] as const satisfies readonly JWordStatusBarItemId[]

export const DEFAULT_STATUS_BAR_LOCALES = [
  'zh-CN',
  'en-US'
] as const satisfies readonly JWordStatusBarLocale[]

export interface ResolvedStatusBarZoomOptions {
  readonly minPercent: number
  readonly maxPercent: number
  readonly stepPercent: number
}

export interface StatusBarTextStats {
  readonly words: number
  readonly characters: number
}

/** 读取文档投影的状态栏统计。 */
export function createStatusBarDocumentStats(projection: DocumentProjection): JWordStatusBarDocumentStats {
  const textParts: string[] = []
  let paragraphs = 0

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      const result = readBlockStatsInput(block)

      paragraphs += result.paragraphs
      textParts.push(...result.textParts)
    }
  }

  const text = textParts.join('\n')
  const textStats = createStatusBarTextStats(text)

  return {
    words: textStats.words,
    characters: textStats.characters,
    paragraphs
  }
}

/** 读取一段文本的状态栏词数和字符数。 */
export function createStatusBarTextStats(text: string): StatusBarTextStats {
  return {
    words: countStatusBarWords(text),
    characters: countStatusBarCharacters(text)
  }
}

/** 解析状态栏 item 顺序与显隐过滤。 */
export function resolveStatusBarItems(
  options: Pick<JWordStatusBarOptions, 'visibleItems' | 'hiddenItems'> = {}
): readonly JWordStatusBarItemId[] {
  const baseItems = options.visibleItems === undefined
    ? DEFAULT_STATUS_BAR_ITEM_IDS
    : dedupeStatusBarItems(options.visibleItems)
  const hiddenItems = new Set(options.hiddenItems ?? [])

  return baseItems.filter((itemId) => !hiddenItems.has(itemId))
}

/** 解析状态栏缩放配置，默认锁定在 20% 到 400%。 */
export function resolveStatusBarZoomOptions(options: JWordStatusBarZoomOptions = {}): ResolvedStatusBarZoomOptions {
  const minPercent = clampStatusBarZoomPercent(options.minPercent ?? DEFAULT_STATUS_BAR_MIN_ZOOM_PERCENT)
  const maxPercent = clampStatusBarZoomPercent(options.maxPercent ?? DEFAULT_STATUS_BAR_MAX_ZOOM_PERCENT)

  return {
    minPercent: Math.min(minPercent, maxPercent),
    maxPercent: Math.max(minPercent, maxPercent),
    stepPercent: readStatusBarZoomStep(options.stepPercent)
  }
}

/** 把任意缩放百分比 clamp 到状态栏首批范围。 */
export function clampStatusBarZoomPercent(percent: number, options?: ResolvedStatusBarZoomOptions): number {
  const minPercent = options?.minPercent ?? DEFAULT_STATUS_BAR_MIN_ZOOM_PERCENT
  const maxPercent = options?.maxPercent ?? DEFAULT_STATUS_BAR_MAX_ZOOM_PERCENT
  const rounded = Math.round(percent)

  return Math.min(maxPercent, Math.max(minPercent, rounded))
}

/** 把状态栏百分比转换成 core page scale。 */
export function statusBarZoomPercentToScale(percent: number): number {
  return clampStatusBarZoomPercent(percent) / 100
}

/** 把 core page scale 转换成状态栏整数百分比。 */
export function scaleToStatusBarZoomPercent(scale: number): number {
  return clampStatusBarZoomPercent(scale * 100)
}

/** 解析状态栏首批 locale 列表，只保留中文和英文。 */
export function resolveStatusBarLocaleOptions(
  locales: readonly JWordStatusBarLocale[] = DEFAULT_STATUS_BAR_LOCALES
): readonly JWordStatusBarLocale[] {
  const allowedLocales = new Set<JWordStatusBarLocale>(DEFAULT_STATUS_BAR_LOCALES)
  const resolved: JWordStatusBarLocale[] = []

  for (const locale of locales) {
    if (!allowedLocales.has(locale) || resolved.includes(locale)) {
      continue
    }

    resolved.push(locale)
  }

  return resolved
}

interface BlockStatsInput {
  readonly textParts: readonly string[]
  readonly paragraphs: number
}

/** 读取 block 内可参与统计的文本与段落数。 */
function readBlockStatsInput(block: Block): BlockStatsInput {
  if (block.kind === 'paragraph') {
    return {
      textParts: [readParagraphText(block)],
      paragraphs: 1
    }
  }

  const textParts: string[] = []
  let paragraphs = 0

  for (const row of block.rows) {
    for (const cell of row.cells) {
      for (const childBlock of cell.blocks) {
        const child = readBlockStatsInput(childBlock)

        paragraphs += child.paragraphs
        textParts.push(...child.textParts)
      }
    }
  }

  return {
    textParts,
    paragraphs
  }
}

/** 读取段落内的纯文本。 */
function readParagraphText(paragraph: Paragraph): string {
  return paragraph.runs.map(readRunText).join('')
}

/** 读取 run 内可参与状态栏统计的文本。 */
function readRunText(run: Run): string {
  return run.inlines
    .map((inline) => {
      if (inline.kind === 'text') {
        return inline.text
      }

      if (inline.kind === 'break') {
        return '\n'
      }

      return ''
    })
    .join('')
}

/** 统计非空白 grapheme 字符数。 */
function countStatusBarCharacters(text: string): number {
  return countGraphemes(text.replace(/\s/gu, ''))
}

/** 按状态栏 MVP 口径统计词数。 */
function countStatusBarWords(text: string): number {
  let words = 0
  let insideLatinToken = false

  for (const grapheme of Array.from(text)) {
    if (isCjkGrapheme(grapheme)) {
      words += 1
      insideLatinToken = false
      continue
    }

    if (isLatinWordGrapheme(grapheme)) {
      if (!insideLatinToken) {
        words += 1
      }

      insideLatinToken = true
      continue
    }

    insideLatinToken = false
  }

  return words
}

/** 判断是否为 CJK 词数单元。 */
function isCjkGrapheme(grapheme: string): boolean {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(grapheme)
}

/** 判断是否为英文或数字连续 token 的组成字符。 */
function isLatinWordGrapheme(grapheme: string): boolean {
  return /[\p{Letter}\p{Number}]/u.test(grapheme) && !isCjkGrapheme(grapheme)
}

/** 读取缩放 slider 步进。 */
function readStatusBarZoomStep(stepPercent: number | undefined): number {
  if (stepPercent === undefined || stepPercent <= 0) {
    return DEFAULT_STATUS_BAR_ZOOM_STEP_PERCENT
  }

  return Math.max(1, Math.round(stepPercent))
}

/** 去重并保留声明顺序。 */
function dedupeStatusBarItems(items: readonly JWordStatusBarItemId[]): readonly JWordStatusBarItemId[] {
  const resolved: JWordStatusBarItemId[] = []

  for (const item of items) {
    if (resolved.includes(item)) {
      continue
    }

    resolved.push(item)
  }

  return resolved
}
