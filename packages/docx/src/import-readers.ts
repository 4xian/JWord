/**
 * 职责：读取 DOCX import 过程中的段落、run、表格和 DrawingML 低层属性。
 * 边界：不遍历 document body，不建立 package/index，不写 core 文档。
 * 协作模块：import.ts 调用这些 reader 组装中间模型。
 * 性能/安全约束：只返回 JSON-compatible 属性和 warning，不保留 XML 节点引用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocxImportCommentRangeMarkerInline,
  DocxImportImageInline,
  DocxImportInline,
  DocxImportRun,
  DocxWarning
} from './types.js'
import {
  readChildVal,
  readElementText,
  readPositiveNumber,
  resolvePartTarget,
  type DocxRelationship
} from './package.js'
import {
  type XmlElementNode,
  readXmlAttribute,
  readXmlChildren,
  readXmlElementsByLocalName
} from './xml.js'

export interface DocxImportStyleContext {
  readonly paragraphStyleIds: ReadonlySet<string>
  readonly characterStyleIds: ReadonlySet<string>
  readonly defaultParagraphStyleId?: string
  readonly defaultRunStyleId?: string
}

/** 读取段落级批注范围 marker。 */
export function readImportCommentRangeMarker(
  element: XmlElementNode,
  edge: 'start' | 'end'
): DocxImportCommentRangeMarkerInline | undefined {
  const commentId = readXmlAttribute(element, 'w:id')

  if (commentId === undefined) {
    return undefined
  }

  return {
    kind: 'commentRangeMarker',
    commentId: `comment-thread-docx-${commentId}`,
    edge
  }
}
/** 读取 run 的最小格式属性。 */
export function readRunProperties(
  element: XmlElementNode,
  runId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): Readonly<Record<string, unknown>> | undefined {
  const runProperties = readXmlChildren(element).find((child) => child.localName === 'rPr')

  if (runProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const children = readXmlChildren(runProperties)
  const styleId = resolveImportRunStyleId(readChildVal(runProperties, 'rStyle'), runId, warnings, part, styleContext)

  appendUnsupportedRunPropertyWarnings(children, runId, warnings, part)

  if (styleId !== undefined) {
    properties.styleId = styleId
  }

  applyRunToggleProperty(properties, children.find((child) => child.localName === 'b'), 'bold', 'b', runId, warnings, part)
  applyRunToggleProperty(properties, children.find((child) => child.localName === 'i'), 'italic', 'i', runId, warnings, part)
  applyUnderlineProperty(properties, children.find((child) => child.localName === 'u'), runId, warnings, part)
  applyRunToggleProperty(properties, children.find((child) => child.localName === 'strike'), 'strike', 'strike', runId, warnings, part)
  const fontFamily = children.find((child) => child.localName === 'rFonts')
  const fontSize = children.find((child) => child.localName === 'sz')
  const shading = children.find((child) => child.localName === 'shd')
  const verticalAlign = children.find((child) => child.localName === 'vertAlign')
  const color = children.find((child) => child.localName === 'color')
    ? readXmlAttribute(children.find((child) => child.localName === 'color')!, 'w:val')
    : undefined

  if (color !== undefined) {
    properties.color = `#${color.toLowerCase()}`
  }
  if (fontFamily !== undefined) {
    const value = readXmlAttribute(fontFamily, 'w:ascii') ??
      readXmlAttribute(fontFamily, 'w:hAnsi') ??
      readXmlAttribute(fontFamily, 'w:eastAsia') ??
      readXmlAttribute(fontFamily, 'w:cs')

    if (value !== undefined) {
      properties.fontFamily = value
    }
  }
  if (fontSize !== undefined) {
    const value = readPositiveNumber(readXmlAttribute(fontSize, 'w:val'))

    if (value !== undefined) {
      properties.fontSizeTwips = value * 10
    }
  }
  if (shading !== undefined) {
    const fill = readXmlAttribute(shading, 'w:fill')

    if (fill !== undefined && fill !== 'auto') {
      properties.backgroundColor = `#${fill.toLowerCase()}`
    }
  }
  if (verticalAlign !== undefined) {
    const value = readXmlAttribute(verticalAlign, 'w:val')

    if (value === 'superscript') {
      properties.superscript = true
    }
    if (value === 'subscript') {
      properties.subscript = true
    }
  }

  return Object.freeze(properties)
}

/** 读取 run on/off toggle 属性，显式关闭时不误判为开启。 */
function applyRunToggleProperty(
  properties: Record<string, unknown>,
  element: XmlElementNode | undefined,
  propertyName: 'bold' | 'italic' | 'strike',
  localName: string,
  runId: string,
  warnings: DocxWarning[],
  part: string
): void {
  if (element === undefined) {
    return
  }

  if (readOnOffValue(element)) {
    properties[propertyName] = true
    return
  }

  appendRunPropertyUnsupportedWarning(
    runId,
    localName,
    warnings,
    part,
    `DOCX run property explicit disabled toggle is not represented yet: ${localName}`
  )
}

/** 读取下划线属性，区分 none 和暂未映射的线型。 */
function applyUnderlineProperty(
  properties: Record<string, unknown>,
  element: XmlElementNode | undefined,
  runId: string,
  warnings: DocxWarning[],
  part: string
): void {
  if (element === undefined) {
    return
  }

  const value = readXmlAttribute(element, 'w:val')?.toLowerCase()

  if (!readOnOffValue(element)) {
    appendRunPropertyUnsupportedWarning(
      runId,
      'u',
      warnings,
      part,
      'DOCX underline explicit disabled toggle is not represented yet.'
    )
    return
  }

  properties.underline = true

  if (
    value !== undefined &&
    value !== '1' &&
    value !== 'true' &&
    value !== 'on' &&
    value !== 'single'
  ) {
    appendRunPropertyUnsupportedWarning(
      runId,
      'u',
      warnings,
      part,
      `DOCX underline style is not mapped yet: ${value}`
    )
  }
}

/** 追加 run 属性降级 warning。 */
function appendRunPropertyUnsupportedWarning(
  runId: string,
  localName: string,
  warnings: DocxWarning[],
  part: string,
  message: string
): void {
  warnings.push({
    code: 'DOCX_RUN_PROPERTY_UNSUPPORTED',
    severity: 'warning',
    part,
    path: `${runId}/${localName}`,
    message,
    fallback: 'preserve-run-text',
    recoverable: true
  })
}

/** 对当前未映射的 run 属性输出稳定 warning。 */
function appendUnsupportedRunPropertyWarnings(
  children: readonly XmlElementNode[],
  runId: string,
  warnings: DocxWarning[],
  part: string
): void {
  const supported = new Set([
    'b',
    'color',
    'i',
    'rFonts',
    'rStyle',
    'shd',
    'strike',
    'sz',
    'u',
    'vertAlign'
  ])

  for (const child of children) {
    if (supported.has(child.localName)) {
      continue
    }

    warnings.push({
      code: 'DOCX_RUN_PROPERTY_UNSUPPORTED',
      severity: 'warning',
      part,
      path: `${runId}/${child.localName}`,
      message: `DOCX run property is not mapped yet: ${child.localName}`,
      fallback: 'preserve-run-text',
      recoverable: true
    })
  }
}

/** 读取 run 中最小 inline 序列。 */
export function readRunInlines(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): readonly DocxImportInline[] {
  const inlines: DocxImportInline[] = []

  for (const child of readXmlChildren(element)) {
    if (child.localName === 'commentReference') {
      continue
    }

    if (child.localName === 't') {
      inlines.push({
        kind: 'text',
        text: readElementText(child)
      })
      continue
    }

    if (child.localName === 'tab') {
      inlines.push({
        kind: 'text',
        text: '\t'
      })
      continue
    }

    if (child.localName === 'commentRangeStart' || child.localName === 'commentRangeEnd') {
      const marker = readImportCommentRangeMarker(
        child,
        child.localName === 'commentRangeStart' ? 'start' : 'end'
      )

      if (marker !== undefined) {
        inlines.push(marker)
      }
      continue
    }

    if (child.localName === 'br') {
      inlines.push({
        kind: 'break',
        breakType: readBreakType(child)
      })
      continue
    }

    if (child.localName === 'drawing') {
      inlines.push(
        ...readDrawingInlines(child, warnings, part, relationshipsPart, runId, relationshipsById)
      )
    }
  }

  return inlines
}

/** 读取 DrawingML inline 图片，浮动图片先降级警告。 */
function readDrawingInlines(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): readonly DocxImportInline[] {
  if (readXmlChildren(element).some((child) => child.localName === 'anchor')) {
    warnings.push({
      code: 'DOCX_DRAWING_FLOATING_UNSUPPORTED',
      severity: 'warning',
      part,
      path: runId,
      message: `DOCX floating image is not supported yet: ${runId}`,
      fallback: 'preserve-empty-inline',
      recoverable: true
    })
    return []
  }

  const inline = readXmlChildren(element).find((child) => child.localName === 'inline')
  if (inline === undefined) {
    return []
  }

  const image = readDrawingInlineImage(inline, warnings, part, relationshipsPart, runId, relationshipsById)

  return image === undefined ? [] : [image]
}

/** 读取 wp:inline 的图片引用。 */
function readDrawingInlineImage(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  relationshipsPart: string,
  runId: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>
): DocxImportImageInline | undefined {
  const blip = readXmlElementsByLocalName(element, 'blip')[0]
  const extent = readXmlChildren(element).find((child) => child.localName === 'extent')
  const docPr = readXmlChildren(element).find((child) => child.localName === 'docPr')
  const relationshipId = blip === undefined
    ? undefined
    : readXmlAttribute(blip, 'r:embed') ?? readXmlAttribute(blip, 'r:link')

  const alt = docPr === undefined ? undefined : readXmlAttribute(docPr, 'descr')
  const widthTwips = extent === undefined ? undefined : readTwipsFromEmu(readXmlAttribute(extent, 'cx'))
  const heightTwips = extent === undefined ? undefined : readTwipsFromEmu(readXmlAttribute(extent, 'cy'))

  if (relationshipId === undefined) {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: runId,
      message: `DOCX image relationship is missing from wp:inline: ${runId}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return undefined
  }

  const relationship = relationshipsById.get(relationshipId)

  if (relationship === undefined) {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_MISSING',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX image relationship target is missing: ${relationshipId}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  if (relationship.targetMode === 'External') {
    warnings.push({
      code: 'DOCX_IMAGE_EXTERNAL_UNSUPPORTED',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX external image is not fetched: ${relationship.target}`,
      fallback: 'preserve-alt-text',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  if (relationship.kind !== 'image') {
    warnings.push({
      code: 'DOCX_IMAGE_RELATIONSHIP_UNSUPPORTED',
      severity: 'warning',
      part: relationshipsPart,
      path: relationshipId,
      message: `DOCX image relationship kind is not supported: ${relationship.kind}`,
      fallback: 'omit-image',
      recoverable: true
    })
    return createDocxImportImageInline(relationshipId, alt, widthTwips, heightTwips)
  }

  return createDocxImportImageInline(
    resolvePartTarget(part, relationship.target),
    alt,
    widthTwips,
    heightTwips
  )
}

/** 创建行内图片中间模型。 */
function createDocxImportImageInline(
  resourceId: string,
  alt: string | undefined,
  widthTwips: number | undefined,
  heightTwips: number | undefined
): DocxImportImageInline {
  return {
    kind: 'image',
    resourceId,
    display: 'inline',
    ...(alt === undefined ? {} : { alt }),
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips })
  }
}

/** 把 DrawingML 的 EMU 尺寸换算成 twips。 */
function readTwipsFromEmu(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const emu = Number(value)

  if (!Number.isFinite(emu) || emu <= 0) {
    return undefined
  }

  return Math.max(1, Math.round(emu / 635))
}

/** 读取 DOCX line/page/column break 类型。 */
function readBreakType(element: XmlElementNode): 'line' | 'page' | 'column' {
  const type = readXmlAttribute(element, 'w:type')

  if (type === 'page' || type === 'column') {
    return type
  }

  return 'line'
}

/** 读取段落样式 ID。 */
export function readParagraphStyleId(element: XmlElementNode): string | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')
  if (paragraphProperties === undefined) {
    return undefined
  }

  return readChildVal(paragraphProperties, 'pStyle')
}

/** 读取 OOXML on/off 属性，缺省和空元素都按启用处理。 */
function readOnOffValue(element: XmlElementNode): boolean {
  const value = readXmlAttribute(element, 'w:val')?.toLowerCase()

  return value !== '0' && value !== 'false' && value !== 'off' && value !== 'none'
}

/** 校验段落样式是否在 style index 中，缺失时尽量回落到默认段落样式。 */
export function resolveImportParagraphStyleId(
  styleId: string | undefined,
  paragraphId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): string | undefined {
  if (styleId === undefined || styleContext === undefined) {
    return styleId
  }

  if (styleContext.paragraphStyleIds.has(styleId)) {
    return styleId
  }

  warnings.push({
    code: 'DOCX_STYLE_UNKNOWN',
    severity: 'warning',
    part,
    path: paragraphId,
    message: `DOCX paragraph style is missing from styles index: ${styleId}`,
    fallback: 'preserve-style-id',
    recoverable: true
  })

  return styleId
}

/** 校验 run 字符样式是否在 style index 中，缺失时尽量回落到默认字符样式。 */
function resolveImportRunStyleId(
  styleId: string | undefined,
  runId: string,
  warnings: DocxWarning[],
  part: string,
  styleContext: DocxImportStyleContext | undefined
): string | undefined {
  if (styleId === undefined) {
    return undefined
  }

  if (styleContext === undefined) {
    return styleId
  }

  if (styleContext.characterStyleIds.has(styleId)) {
    return styleId
  }

  warnings.push({
    code: 'DOCX_STYLE_UNKNOWN',
    severity: 'warning',
    part,
    path: runId,
    message: `DOCX run style is missing from styles index: ${styleId}`,
    fallback: 'preserve-style-id',
    recoverable: true
  })

  return styleId
}

/** 读取段落格式属性。 */
export function readParagraphProperties(
  element: XmlElementNode,
  paragraphId: string,
  warnings: DocxWarning[],
  part: string
): Readonly<Record<string, unknown>> | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')

  if (paragraphProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const children = readXmlChildren(paragraphProperties)
  const alignment = readChildVal(paragraphProperties, 'jc')
  const spacing = children.find((child) => child.localName === 'spacing')
  const indentation = children.find((child) => child.localName === 'ind')
  const numbering = children.find((child) => child.localName === 'numPr')
  const keepNext = children.find((child) => child.localName === 'keepNext')
  const keepLines = children.find((child) => child.localName === 'keepLines')
  const widowControl = children.find((child) => child.localName === 'widowControl')

  appendUnsupportedParagraphPropertyWarnings(children, paragraphId, warnings, part)

  if (alignment !== undefined) {
    properties.alignment = alignment === 'center' ? 'center' : alignment
  }
  if (spacing !== undefined) {
    const before = readXmlAttribute(spacing, 'w:before')
    const after = readXmlAttribute(spacing, 'w:after')

    if (before !== undefined) {
      properties.spacingBeforeTwips = Number(before)
    }
    if (after !== undefined) {
      properties.spacingAfterTwips = Number(after)
    }
  }
  if (indentation !== undefined) {
    const left = readXmlAttribute(indentation, 'w:left')
    const firstLine = readXmlAttribute(indentation, 'w:firstLine')
    const hanging = readXmlAttribute(indentation, 'w:hanging')

    if (left !== undefined) {
      properties.indentLeftTwips = Number(left)
    }
    if (firstLine !== undefined) {
      properties.firstLineIndentTwips = Number(firstLine)
    }
    if (hanging !== undefined) {
      properties.hangingIndentTwips = Number(hanging)
    }
  }
  if (numbering !== undefined) {
    const numberingId = readChildVal(numbering, 'numId')
    const level = readChildVal(numbering, 'ilvl')

    if (numberingId !== undefined) {
      properties.listNumberingId = numberingId
    }
    if (level !== undefined) {
      properties.listLevel = Number(level)
    }
  }
  if (keepNext !== undefined) {
    properties.keepWithNext = readOnOffValue(keepNext)
  }
  if (keepLines !== undefined) {
    properties.keepLines = readOnOffValue(keepLines)
  }
  if (widowControl !== undefined) {
    properties.widowControl = readOnOffValue(widowControl)
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 对当前未映射的段落属性输出稳定 warning。 */
function appendUnsupportedParagraphPropertyWarnings(
  children: readonly XmlElementNode[],
  paragraphId: string,
  warnings: DocxWarning[],
  part: string
): void {
  const supported = new Set([
    'ind',
    'jc',
    'keepLines',
    'keepNext',
    'numPr',
    'pStyle',
    'sectPr',
    'spacing',
    'widowControl'
  ])

  for (const child of children) {
    if (supported.has(child.localName)) {
      continue
    }

    warnings.push({
      code: 'DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED',
      severity: 'warning',
      part,
      path: `${paragraphId}/${child.localName}`,
      message: `DOCX paragraph property is not mapped yet: ${child.localName}`,
      fallback: 'preserve-paragraph-content',
      recoverable: true
    })
  }
}

/** 读取段落基础自动行距，OOXML auto line 以 240 分之一行为单位。 */
export function readParagraphLineHeight(element: XmlElementNode): number | undefined {
  const paragraphProperties = readXmlChildren(element).find((child) => child.localName === 'pPr')
  const spacing = paragraphProperties === undefined
    ? undefined
    : readXmlChildren(paragraphProperties).find((child) => child.localName === 'spacing')
  const line = spacing === undefined ? undefined : readPositiveNumber(readXmlAttribute(spacing, 'w:line'))
  const lineRule = spacing === undefined ? undefined : readXmlAttribute(spacing, 'w:lineRule')

  if (line === undefined || (lineRule !== undefined && lineRule !== 'auto')) {
    return undefined
  }

  return Number((line / 240).toFixed(4))
}

/** 读取表格属性。 */
export function readTableProperties(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  id: string
): Readonly<Record<string, unknown>> | undefined {
  const tableProperties = readXmlChildren(element).find((child) => child.localName === 'tblPr')

  if (tableProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const styleId = readChildVal(tableProperties, 'tblStyle')
  const border = readTableBorder(tableProperties, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])

  if (styleId !== undefined) {
    properties.styleId = styleId
    warnings.push({
      code: 'DOCX_TABLE_STYLE_UNSUPPORTED',
      severity: 'warning',
      part,
      ...(id === '' ? {} : { path: id }),
      message: `DOCX table style is not mapped yet: ${styleId}`,
      fallback: 'preserve-style-id',
      recoverable: true
    })
  }
  if (border !== undefined) {
    properties.border = border
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 读取表格单元格属性。 */
export function readTableCellProperties(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string,
  id: string
): Readonly<Record<string, unknown>> | undefined {
  const cellProperties = readXmlChildren(element).find((child) => child.localName === 'tcPr')

  if (cellProperties === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const border = readTableBorder(cellProperties, ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'])
  const hasComplexMerge = readXmlChildren(cellProperties).some((child) => child.localName === 'vMerge' || child.localName === 'hMerge')

  if (border !== undefined) {
    properties.border = border
  }
  if (hasComplexMerge) {
    warnings.push({
      code: 'DOCX_TABLE_COMPLEX_MERGE_UNSUPPORTED',
      severity: 'warning',
      part,
      ...(id === '' ? {} : { path: id }),
      message: `DOCX complex merge is not fully supported yet: ${id}`,
      fallback: 'preserve-grid-span-only',
      recoverable: true
    })
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}

/** 读取表格列宽网格。 */
export function readTableGrid(element: XmlElementNode): readonly number[] | undefined {
  const tableGrid = readXmlChildren(element).find((child) => child.localName === 'tblGrid')

  if (tableGrid === undefined) {
    return undefined
  }

  const grid = readXmlChildren(tableGrid)
    .filter((child) => child.localName === 'gridCol')
    .map((gridColumn) => readPositiveNumber(readXmlAttribute(gridColumn, 'w:w')))
    .filter((value): value is number => value !== undefined)

  return grid.length === 0 ? undefined : Object.freeze(grid)
}

/** 读取表格单元格 gridSpan。 */
export function readTableCellGridSpan(element: XmlElementNode): number | undefined {
  const cellProperties = readXmlChildren(element).find((child) => child.localName === 'tcPr')
  const gridSpan = cellProperties === undefined ? undefined : readChildVal(cellProperties, 'gridSpan')

  return gridSpan === undefined ? undefined : readPositiveNumber(gridSpan)
}

/** 读取表格边框。 */
function readTableBorder(
  element: XmlElementNode,
  borderNames: readonly string[]
): Readonly<{ color?: string, widthTwips?: number }> | undefined {
  const borderContainer = readXmlChildren(element).find((child) => child.localName === 'tblBorders' || child.localName === 'tcBorders')

  if (borderContainer === undefined) {
    return undefined
  }

  const borderElement = readXmlChildren(borderContainer).find((child) => borderNames.includes(child.localName))

  if (borderElement === undefined) {
    return undefined
  }

  const properties: Record<string, unknown> = {}
  const color = readXmlAttribute(borderElement, 'w:color')
  const size = readXmlAttribute(borderElement, 'w:sz')

  if (color !== undefined) {
    properties.color = color
  }
  if (size !== undefined) {
    const widthTwips = readPositiveNumber(size)

    if (widthTwips !== undefined) {
      properties.widthTwips = Math.round(widthTwips * 5 / 2)
    }
  }

  return Object.keys(properties).length === 0 ? undefined : Object.freeze(properties)
}
