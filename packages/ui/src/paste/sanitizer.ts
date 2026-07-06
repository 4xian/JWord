/**
 * 职责：用 DOMPurify 清洗粘贴 HTML，并提取 core 可消费的安全富文本片段。
 * 边界：不监听 clipboard 事件、不执行 editor 事务、不把清洗后的 HTML 插回页面。
 * 协作模块：paste controller 调用这里，core pasteRichTextFragment 消费输出片段。
 * 性能/安全约束：只保留 Word HTML 常见文本格式子集，主动丢弃脚本、事件属性、媒体和危险 URL。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-415。
 */
import DOMPurify from 'dompurify'
import { isAllowedLinkUrl, type EditorRichTextFragment, type EditorRichTextRun } from '@4xian/jword-core'

type RichTextProperties = NonNullable<EditorRichTextRun['properties']>

export type PasteSanitizerWarningCode = 'PASTE_TABLE_FLATTENED'

export interface PasteSanitizerWarning {
  readonly code: PasteSanitizerWarningCode
  readonly message: string
  readonly fallback: 'tab-separated-text'
  readonly recoverable: true
}

export interface PasteSanitizerResult {
  readonly fragment: EditorRichTextFragment | null
  readonly warnings: readonly PasteSanitizerWarning[]
}

interface InlineStyleState {
  readonly bold: boolean
  readonly italic: boolean
  readonly underline: boolean
  readonly strike: boolean
  readonly color?: string
  readonly backgroundColor?: string
  readonly fontFamily?: string
  readonly fontSizeTwips?: number
  readonly fontSizePx?: number
  readonly link?: Readonly<{ target: string }>
}

const BLOCK_SELECTOR = 'p, div, li, tr'
const EMPTY_INLINE_STYLE: InlineStyleState = Object.freeze({
  bold: false,
  italic: false,
  underline: false,
  strike: false
})

/** 把粘贴 HTML 清洗并转换成 core 富文本片段。 */
export function sanitizePastedHtmlToRichTextFragment(html: string): EditorRichTextFragment | null {
  return sanitizePastedHtmlToRichTextFragmentWithWarnings(html).fragment
}

/** 把粘贴 HTML 清洗为富文本片段，并返回降级警告。 */
export function sanitizePastedHtmlToRichTextFragmentWithWarnings(html: string): PasteSanitizerResult {
  if (html.trim().length === 0) {
    return {
      fragment: null,
      warnings: []
    }
  }

  if (shouldFallbackToPlainText(html)) {
    return {
      fragment: null,
      warnings: []
    }
  }

  const sanitized = DOMPurify(window).sanitize(html, {
    ALLOWED_TAGS: [
      'a',
      'b',
      'br',
      'div',
      'em',
      'i',
      'li',
      'ol',
      'p',
      's',
      'span',
      'strike',
      'strong',
      'table',
      'tbody',
      'td',
      'tfoot',
      'th',
      'thead',
      'tr',
      'u',
      'ul'
    ],
    ALLOWED_ATTR: ['class', 'href'],
    ALLOW_DATA_ATTR: false,
    FORBID_ATTR: ['onclick', 'onerror', 'onload'],
    FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'img', 'svg', 'math']
  })

  if (typeof sanitized !== 'string' || sanitized.trim().length === 0) {
    return {
      fragment: null,
      warnings: []
    }
  }

  const template = document.createElement('template')

  template.innerHTML = sanitized

  const warnings = readPasteSanitizerWarnings(template.content)
  const paragraphs = collectRichTextParagraphs(template.content)

  return {
    fragment: paragraphs.length === 0
      ? null
      : {
          paragraphs
        },
    warnings
  }
}

/** 判断输入 HTML 是否必须交还纯文本粘贴路径处理。 */
function shouldFallbackToPlainText(html: string): boolean {
  const template = document.createElement('template')

  template.innerHTML = html

  return template.content.querySelector('svg, math') !== null
    || Array.from(template.content.querySelectorAll('img[src]')).some((image) => {
      return (image.getAttribute('src') ?? '').trim().toLowerCase().startsWith('data:')
    })
}

/** 读取清洗后 HTML 的结构降级 warning。 */
function readPasteSanitizerWarnings(root: DocumentFragment): readonly PasteSanitizerWarning[] {
  if (root.querySelector('table') === null) {
    return []
  }

  return [Object.freeze({
    code: 'PASTE_TABLE_FLATTENED' as const,
    message: '粘贴表格结构暂按制表符文本降级。',
    fallback: 'tab-separated-text' as const,
    recoverable: true as const
  })]
}

/** 收集清洗后片段中的段落结构。 */
function collectRichTextParagraphs(root: DocumentFragment): EditorRichTextFragment['paragraphs'] {
  const blockElements = Array.from(root.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    .filter((element) => !hasBlockAncestor(element))
  const sourceBlocks = blockElements.length > 0 ? blockElements : [root]
  const paragraphs = sourceBlocks.flatMap((source) => {
    const runs = trimParagraphRuns(collectRichTextRuns(source, EMPTY_INLINE_STYLE))

    if (runs.length === 0) {
      return []
    }

    return [{
      properties: readParagraphProperties(source),
      runs
    }]
  })

  return Object.freeze(paragraphs)
}

/** 判断一个块是否已经嵌套在另一个块元素内。 */
function hasBlockAncestor(element: HTMLElement): boolean {
  return (element.parentElement?.closest(BLOCK_SELECTOR) ?? null) !== null
}

/** 从节点树递归提取连续文本 run。 */
function collectRichTextRuns(node: Node, inheritedStyle: InlineStyleState): readonly EditorRichTextRun[] {
  if (node.nodeType === Node.TEXT_NODE) {
    return createTextRun(node.textContent ?? '', inheritedStyle)
  }

  if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) {
    return []
  }

  const nextStyle = node instanceof HTMLElement
    ? mergeInlineStyle(inheritedStyle, node)
    : inheritedStyle
  const children = node instanceof HTMLTableRowElement
    ? collectTableRowTextNodes(node)
    : Array.from(node.childNodes)
  const runs: EditorRichTextRun[] = []

  for (const child of children) {
    if (child instanceof HTMLBRElement) {
      runs.push({
        text: '\n',
        properties: readInlineProperties(nextStyle)
      })
      continue
    }

    if (isTableCellSeparator(child)) {
      runs.push({
        text: '\t',
        properties: readInlineProperties(nextStyle)
      })
      continue
    }

    runs.push(...collectRichTextRuns(child, nextStyle))
  }

  return mergeAdjacentRuns(runs)
}

/** 收集简单表格行中的单元格文本节点，并用制表符分隔单元格。 */
function collectTableRowTextNodes(row: HTMLTableRowElement): readonly Node[] {
  const nodes: Node[] = []
  const cells = Array.from(row.children).filter((child) => child instanceof HTMLTableCellElement)

  cells.forEach((cell, index) => {
    if (index > 0) {
      nodes.push(document.createTextNode('\t'))
    }

    nodes.push(...Array.from(cell.childNodes))
  })

  return nodes
}

/** 判断节点是否是表格单元格分隔符。 */
function isTableCellSeparator(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && node.textContent === '\t'
}

/** 基于继承格式创建文本 run。 */
function createTextRun(text: string, style: InlineStyleState): readonly EditorRichTextRun[] {
  const normalizedText = text.replace(/[ \n\r\f\v]+/gu, ' ')

  if (normalizedText.trim().length === 0) {
    return []
  }

  return [{
    text: normalizedText,
    properties: readInlineProperties(style)
  }]
}

/** 合并相邻且格式一致的 run。 */
function mergeAdjacentRuns(runs: readonly EditorRichTextRun[]): readonly EditorRichTextRun[] {
  const merged: EditorRichTextRun[] = []

  for (const run of runs) {
    const previous = merged[merged.length - 1]

    if (previous !== undefined && arePropertiesEqual(previous.properties, run.properties)) {
      merged[merged.length - 1] = createRichTextRun(
        `${previous.text}${run.text}`,
        previous.properties
      )
      continue
    }

    merged.push(run)
  }

  return Object.freeze(merged)
}

/** 创建 run，并避免把 undefined 写入可选属性。 */
function createRichTextRun(text: string, properties: RichTextProperties | undefined): EditorRichTextRun {
  return properties === undefined
    ? {
        text
      }
    : {
        text,
        properties
      }
}

/** 去掉段落边界处由 HTML 缩进带来的空白。 */
function trimParagraphRuns(runs: readonly EditorRichTextRun[]): readonly EditorRichTextRun[] {
  const trimmed = runs.map((run, index) => createRichTextRun(
    trimRunBoundaryText(run.text, index, runs.length),
    run.properties
  )).filter((run) => run.text.length > 0)

  return Object.freeze(trimmed)
}

/** 只修剪段首段尾空白，不破坏 run 内部空格。 */
function trimRunBoundaryText(text: string, index: number, length: number): string {
  let nextText = text

  if (index === 0) {
    nextText = nextText.replace(/^\s+/u, '')
  }

  if (index === length - 1) {
    nextText = nextText.replace(/\s+$/u, '')
  }

  return nextText
}

/** 合并父级格式和当前元素格式。 */
function mergeInlineStyle(parent: InlineStyleState, element: HTMLElement): InlineStyleState {
  const nextStyle: MutableInlineStyleState = {
    bold: parent.bold || isBoldElement(element),
    italic: parent.italic || isItalicElement(element),
    underline: parent.underline || isUnderlineElement(element) || readTextDecoration(element).includes('underline'),
    strike: parent.strike || isStrikeElement(element) || readTextDecoration(element).includes('line-through')
  }
  const link = readSafeLink(element) ?? parent.link

  const color = readCssColor(element, ['color']) ?? parent.color
  const backgroundColor = readCssColor(element, ['background-color', 'background']) ?? parent.backgroundColor
  const fontFamily = readFontFamily(element) ?? parent.fontFamily
  const fontSizeTwips = readFontSizeTwips(element) ?? parent.fontSizeTwips
  const fontSizePx = readFontSizePx(element) ?? parent.fontSizePx

  if (color !== undefined) {
    nextStyle.color = color
  }

  if (backgroundColor !== undefined) {
    nextStyle.backgroundColor = backgroundColor
  }

  if (fontFamily !== undefined) {
    nextStyle.fontFamily = fontFamily
  }

  if (fontSizeTwips !== undefined) {
    nextStyle.fontSizeTwips = fontSizeTwips
  }

  if (fontSizePx !== undefined) {
    nextStyle.fontSizePx = fontSizePx
  }

  if (link !== undefined) {
    nextStyle.link = link
  }

  return Object.freeze(nextStyle)
}

type MutableInlineStyleState = {
  -readonly [Key in keyof InlineStyleState]: InlineStyleState[Key]
}

/** 读取 inline 样式状态对应的 core 属性。 */
function readInlineProperties(style: InlineStyleState): RichTextProperties {
  const properties: Record<string, unknown> = {}

  if (style.bold) {
    properties.bold = true
  }

  if (style.italic) {
    properties.italic = true
  }

  if (style.underline) {
    properties.underline = true
  }

  if (style.strike) {
    properties.strike = true
  }

  if (style.color !== undefined) {
    properties.color = style.color
  }

  if (style.backgroundColor !== undefined) {
    properties.backgroundColor = style.backgroundColor
  }

  if (style.fontFamily !== undefined) {
    properties.fontFamily = style.fontFamily
  }

  if (style.fontSizeTwips !== undefined) {
    properties.fontSizeTwips = style.fontSizeTwips
  } else if (style.fontSizePx !== undefined) {
    properties.fontSizePx = style.fontSizePx
  }

  if (style.link !== undefined) {
    properties.link = style.link
  }

  return Object.freeze(properties)
}

/** 读取段落级格式属性。 */
function readParagraphProperties(source: HTMLElement | DocumentFragment): RichTextProperties {
  if (!(source instanceof HTMLElement)) {
    return {}
  }

  const properties: Record<string, unknown> = {}
  const alignment = readTextAlignment(source)

  if (alignment !== undefined) {
    properties.alignment = alignment
  }

  if (source.tagName.toLowerCase() === 'li') {
    properties.listNumberingId = readListNumberingId(source)
    properties.listLevel = readListLevel(source)
  }

  return Object.freeze(properties)
}

/** 判断属性对象是否完全一致。 */
function arePropertiesEqual(left: RichTextProperties | undefined, right: RichTextProperties | undefined): boolean {
  return JSON.stringify(left ?? {}) === JSON.stringify(right ?? {})
}

/** 判断元素是否代表加粗。 */
function isBoldElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase()
  const fontWeight = readStyleValue(element, 'font-weight')

  return tagName === 'b'
    || tagName === 'strong'
    || fontWeight === 'bold'
    || (fontWeight !== undefined && Number(fontWeight) >= 600)
}

/** 判断元素是否代表斜体。 */
function isItalicElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase()

  return tagName === 'i'
    || tagName === 'em'
    || readStyleValue(element, 'font-style') === 'italic'
}

/** 判断元素是否代表删除线。 */
function isStrikeElement(element: HTMLElement): boolean {
  const tagName = element.tagName.toLowerCase()

  return tagName === 's' || tagName === 'strike'
}

/** 判断元素是否代表下划线。 */
function isUnderlineElement(element: HTMLElement): boolean {
  return element.tagName.toLowerCase() === 'u'
}

/** 读取 allowlist 内的安全链接。 */
function readSafeLink(element: HTMLElement): Readonly<{ target: string }> | undefined {
  if (!(element instanceof HTMLAnchorElement)) {
    return undefined
  }

  const target = element.getAttribute('href')?.trim()

  if (target === undefined || !isAllowedLinkUrl(target)) {
    return undefined
  }

  return Object.freeze({ target })
}

/** 读取 text-decoration 原始值。 */
function readTextDecoration(element: HTMLElement): string {
  return readStyleValue(element, 'text-decoration')?.toLowerCase() ?? ''
}

/** 读取安全颜色值。 */
function readCssColor(element: HTMLElement, names: readonly string[]): string | undefined {
  for (const name of names) {
    const color = normalizeCssColor(readStyleValue(element, name))

    if (color !== undefined) {
      return color
    }
  }

  return undefined
}

/** 归一化安全 CSS 颜色值。 */
function normalizeCssColor(value: string | undefined): string | undefined {
  const color = value?.trim().toLowerCase()

  if (color === undefined || color.includes('url(')) {
    return undefined
  }

  if (/^#[0-9a-f]{3,8}$/u.test(color) || /^rgba?\([0-9.,%\s]+\)$/u.test(color)) {
    return color
  }

  return /^(black|blue|cyan|gray|green|grey|magenta|orange|purple|red|white|yellow)$/u.test(color)
    ? color
    : undefined
}

/** 读取首个字体族。 */
function readFontFamily(element: HTMLElement): string | undefined {
  const value = readStyleValue(element, 'font-family')

  if (value === undefined || value.includes('url(')) {
    return undefined
  }

  return value.split(',')[0]?.trim().replace(/^['"]|['"]$/gu, '')
}

/** 读取 pt 字号并转换为 twips。 */
function readFontSizeTwips(element: HTMLElement): number | undefined {
  const value = readStyleValue(element, 'font-size')
  const match = value === undefined ? null : /^([0-9]+(?:\.[0-9]+)?)pt$/u.exec(value.trim())

  return match === null ? undefined : Math.round(Number(match[1]) * 20)
}

/** 读取 px 字号。 */
function readFontSizePx(element: HTMLElement): number | undefined {
  const value = readStyleValue(element, 'font-size')
  const match = value === undefined ? null : /^([0-9]+(?:\.[0-9]+)?)px$/u.exec(value.trim())

  return match === null ? undefined : Number(match[1])
}

/** 读取段落对齐方式。 */
function readTextAlignment(element: HTMLElement): 'center' | 'right' | 'justify' | undefined {
  const value = readStyleValue(element, 'text-align')

  return value === 'center' || value === 'right' || value === 'justify' ? value : undefined
}

/** 读取列表编号类型。 */
function readListNumberingId(element: HTMLElement): string {
  return element.closest('ol') === null ? 'paste-bullet' : 'paste-ordered'
}

/** 读取列表层级。 */
function readListLevel(element: HTMLElement): number {
  return Math.max(0, element.parentElement === null ? 0 : Array.from(element.parentElement.querySelectorAll('li'))
    .filter((item) => item.contains(element) && item !== element).length)
}

/** 从 style 属性里读取指定声明。 */
function readStyleValue(element: HTMLElement, name: string): string | undefined {
  const declarations = (element.getAttribute('style') ?? '').split(';')

  for (const declaration of declarations) {
    const separatorIndex = declaration.indexOf(':')

    if (separatorIndex < 0) {
      continue
    }

    const propertyName = declaration.slice(0, separatorIndex).trim().toLowerCase()

    if (propertyName === name) {
      return declaration.slice(separatorIndex + 1).trim()
    }
  }

  return undefined
}
