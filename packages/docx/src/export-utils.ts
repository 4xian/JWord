/**
 * 职责：提供 DOCX export 写 XML 时复用的表格边框、样式、编号和转义工具。
 * 边界：不创建 ZIP，不遍历文档 projection，不读取媒体资源。
 * 协作模块：export.ts 调用这些 helper 输出稳定 OOXML 片段。
 * 性能/安全约束：纯字符串/数值转换，避免 DOM、Node-only API 和运行时副作用。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-18---实现-t1-docx-export列表表格图片。
 */

import type { TableBorder } from '@4xian/jword-core'

const WORD_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

interface ExportNumberingDefinition {
  readonly numberingId: string
  readonly abstractNumberingId: string
  readonly maxLevel: number
}

/** 写表格边框 XML。 */
export function writeTableBordersXml(border: TableBorder | undefined, elementName: 'tblBorders' | 'tcBorders'): string {
  if (border === undefined) {
    return ''
  }

  const color = readBorderColor(border)
  const size = readBorderSize(border)
  const attributes = ` w:val="single"${size === undefined ? '' : ` w:sz="${size}"`}${color === undefined ? '' : ` w:color="${color}"`}`
  const sides = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']

  return `<w:${elementName}>${sides.map((side) => `<w:${side}${attributes}/>`).join('')}</w:${elementName}>`
}

/** 读取表格边框快照。 */
export function readTableBorderSnapshot(
  border: TableBorder | undefined,
  properties: Readonly<Record<string, unknown>> | undefined
): TableBorder | undefined {
  if (border !== undefined) {
    return border
  }

  const value = properties?.border

  if (!isRecord(value)) {
    return undefined
  }

  const color = typeof value.color === 'string' ? value.color : undefined
  const widthTwips = typeof value.widthTwips === 'number' && Number.isFinite(value.widthTwips)
    ? value.widthTwips
    : undefined

  if (color === undefined && widthTwips === undefined) {
    return undefined
  }

  return {
    ...(color === undefined ? {} : { color }),
    ...(widthTwips === undefined ? {} : { widthTwips })
  }
}

/** 读取边框颜色属性。 */
function readBorderColor(border: TableBorder): string | undefined {
  const color = border.color?.startsWith('#') === true ? border.color.slice(1) : border.color

  return color === undefined || color.length === 0 ? undefined : escapeXmlAttribute(color.toUpperCase())
}

/** 读取 OOXML 八分之一点边框宽度。 */
function readBorderSize(border: TableBorder): number | undefined {
  if (border.widthTwips === undefined || !Number.isFinite(border.widthTwips) || border.widthTwips <= 0) {
    return undefined
  }

  return Math.max(1, Math.round(border.widthTwips * 2 / 5))
}

/** 读取正数 twips。 */
export function readPositiveTwips(value: number | undefined): number | undefined {
  return value === undefined || !Number.isFinite(value) || value <= 0 ? undefined : Math.round(value)
}

/** 把 twips 换算成 DrawingML EMU。 */
export function twipsToEmu(twips: number): number {
  return Math.max(1, Math.round(twips * 635))
}

/** 按 tab 拆分文本 inline，避免把制表符写成普通文本。 */
export function splitTextInlineXml(text: string): readonly string[] {
  return text.split(/(\t)/u).flatMap((part) => {
    if (part === '') {
      return []
    }

    return part === '\t' ? ['<w:tab/>'] : [writeTextXml(part)]
  })
}

/** 写文本节点 XML，并在需要时保留空格语义。 */
function writeTextXml(text: string): string {
  const preserveSpace = /^\s|\s$|\s{2,}/u.test(text)

  return `<w:t${preserveSpace ? ' xml:space="preserve"' : ''}>${escapeXmlText(text)}</w:t>`
}

/** 写最小 styles part。 */
export function writeStylesXml(characterStyleIds: readonly string[]): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:styles xmlns:w="${WORD_NS}">`,
    writeParagraphStyleXml('Normal', 'Normal', true),
    writeParagraphStyleXml('Heading1', 'Heading 1', false),
    writeParagraphStyleXml('Heading2', 'Heading 2', false),
    writeParagraphStyleXml('Heading3', 'Heading 3', false),
    ...characterStyleIds.map((styleId) => writeCharacterStyleXml(styleId)),
    '</w:styles>'
  ].join('')
}

/** 写基础段落 style 定义。 */
function writeParagraphStyleXml(styleId: string, name: string, defaultStyle: boolean): string {
  return [
    `<w:style w:type="paragraph"${defaultStyle ? ' w:default="1"' : ''} w:styleId="${escapeXmlAttribute(styleId)}">`,
    `<w:name w:val="${escapeXmlAttribute(name)}"/>`,
    styleId === 'Normal' ? '' : '<w:basedOn w:val="Normal"/>',
    '</w:style>'
  ].join('')
}

/** 写基础 character style 定义。 */
function writeCharacterStyleXml(styleId: string): string {
  return [
    `<w:style w:type="character" w:styleId="${escapeXmlAttribute(styleId)}">`,
    `<w:name w:val="${escapeXmlAttribute(styleId)}"/>`,
    '</w:style>'
  ].join('')
}

/** 写 numbering part。 */
export function writeNumberingXml(definitions: readonly ExportNumberingDefinition[]): string {
  if (definitions.length === 0) {
    return [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      `<w:numbering xmlns:w="${WORD_NS}"/>`
    ].join('')
  }

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    `<w:numbering xmlns:w="${WORD_NS}">`,
    ...definitions.map(writeNumberingDefinitionXml),
    ...definitions.map(writeNumberingInstanceXml),
    '</w:numbering>'
  ].join('')
}

/** 写一个 abstract numbering 定义。 */
function writeNumberingDefinitionXml(definition: ExportNumberingDefinition): string {
  const levels = Array.from({ length: definition.maxLevel + 1 }, (_, level) => writeNumberingLevelXml(level))

  return [
    `<w:abstractNum w:abstractNumId="${escapeXmlAttribute(definition.abstractNumberingId)}">`,
    ...levels,
    '</w:abstractNum>'
  ].join('')
}

/** 写一个 numbering level。 */
function writeNumberingLevelXml(level: number): string {
  return [
    `<w:lvl w:ilvl="${level}">`,
    '<w:start w:val="1"/>',
    '<w:numFmt w:val="decimal"/>',
    `<w:lvlText w:val="%${level + 1}."/>`,
    '</w:lvl>'
  ].join('')
}

/** 写一个 numbering instance。 */
function writeNumberingInstanceXml(definition: ExportNumberingDefinition): string {
  return [
    `<w:num w:numId="${escapeXmlAttribute(definition.numberingId)}">`,
    `<w:abstractNumId w:val="${escapeXmlAttribute(definition.abstractNumberingId)}"/>`,
    '</w:num>'
  ].join('')
}

/** 写最小 core properties。 */
export function writeCorePropertiesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ',
    'xmlns:dc="http://purl.org/dc/elements/1.1/" ',
    'xmlns:dcterms="http://purl.org/dc/terms/" ',
    'xmlns:dcmitype="http://purl.org/dc/dcmitype/" ',
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">',
    '<dc:creator>JWord</dc:creator>',
    '<cp:lastModifiedBy>JWord</cp:lastModifiedBy>',
    '</cp:coreProperties>'
  ].join('')
}

/** 写最小 extended app properties。 */
export function writeAppPropertiesXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ',
    'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">',
    '<Application>JWord</Application>',
    '</Properties>'
  ].join('')
}

/** 转义 XML 文本节点。 */
export function escapeXmlText(value: string): string {
  return value
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
}

/** 转义 XML 属性值。 */
export function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/gu, '&quot;')
}

/** 判断值是否为对象记录。 */
export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null
}

/** 读取字符串属性。 */
export function readStringProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): string | undefined {
  const value = properties?.[key]

  return typeof value === 'string' ? value : undefined
}

/** 读取数字属性。 */
export function readNumberProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const value = properties?.[key]

  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

/** 读取布尔属性。 */
export function readBooleanProperty(properties: Readonly<Record<string, unknown>> | undefined, key: string): boolean {
  return properties?.[key] === true
}
