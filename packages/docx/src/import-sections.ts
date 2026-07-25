/**
 * 职责：读取 DOCX section properties、分页、页边距、页眉页脚引用和页码设置。
 * 边界：不遍历 body block，不读取 run/table 内容，不访问 ZIP。
 * 协作模块：import.ts 在切分 section 时调用本模块。
 * 性能/安全约束：只产生 JSON-compatible section metadata 和 warning。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type {
  DocxImportSectionMargins,
  DocxImportSectionPage,
  DocxImportSectionPageNumbering,
  DocxWarning
} from './types.js'
import {
  readPositiveNumber,
  resolvePartTarget,
  type DocxHeaderFooterSourceIdIndex,
  type DocxRelationship
} from './package.js'
import {
  type XmlElementNode,
  readXmlAttribute,
  readXmlChildren
} from './xml.js'

export interface DocxImportSectionProperties {
  readonly breakType?: 'continuous' | 'next-page'
  readonly page?: DocxImportSectionPage
  readonly headerIds?: readonly string[]
  readonly footerIds?: readonly string[]
  readonly pageNumbering?: DocxImportSectionPageNumbering
}
/** 读取 section properties，保留最小 page setup 与 section break 信息。 */
export function readSectionProperties(
  element: XmlElementNode | undefined,
  warnings: DocxWarning[],
  part: string,
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  headerFooterSourceIds: DocxHeaderFooterSourceIdIndex
): DocxImportSectionProperties {
  if (element === undefined) {
    return {}
  }

  const pageSize = readSectionPageSize(element, warnings, part)
  const pageMargins = readSectionPageMargins(element)
  const breakType = readSectionBreakType(element, warnings, part)
  const columns = readSectionColumns(element, warnings, part)
  const headerIds = readSectionReferenceTargets(
    element,
    'headerReference',
    relationshipsById,
    part,
    headerFooterSourceIds.headers
  )
  const footerIds = readSectionReferenceTargets(
    element,
    'footerReference',
    relationshipsById,
    part,
    headerFooterSourceIds.footers
  )
  const pageNumbering = readSectionPageNumbering(element)
  const page = pageSize === undefined && pageMargins === undefined && columns === undefined
    ? undefined
    : {
      ...(pageSize === undefined ? {} : pageSize),
      ...(pageMargins === undefined ? {} : { marginTwips: pageMargins }),
      ...(columns === undefined ? {} : { columns })
    }

  return {
    ...(breakType === undefined ? {} : { breakType }),
    ...(page === undefined ? {} : { page }),
    ...(headerIds.length === 0 ? {} : { headerIds }),
    ...(footerIds.length === 0 ? {} : { footerIds }),
    ...(pageNumbering === undefined ? {} : { pageNumbering })
  }
}

/** 读取 section 的 page size。 */
function readSectionPageSize(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): Pick<DocxImportSectionPage, 'widthTwips' | 'heightTwips'> | undefined {
  const pageSize = readXmlChildren(element).find((child) => child.localName === 'pgSz')

  if (pageSize === undefined) {
    return undefined
  }

  const widthTwips = readPositiveNumber(readXmlAttribute(pageSize, 'w:w'))
  const heightTwips = readPositiveNumber(readXmlAttribute(pageSize, 'w:h'))
  const orient = readXmlAttribute(pageSize, 'w:orient')

  if (orient === 'landscape') {
    if (widthTwips !== undefined && heightTwips !== undefined && widthTwips < heightTwips) {
      warnings.push({
        code: 'DOCX_SECTION_ORIENTATION_UNSUPPORTED',
        severity: 'warning',
        part,
        path: 'sectPr',
        message: 'DOCX section page orientation does not match page size: landscape',
        fallback: 'normalize-landscape-page-size',
        recoverable: true
      })
      return {
        widthTwips: heightTwips,
        heightTwips: widthTwips
      }
    }

    if (widthTwips !== undefined || heightTwips !== undefined) {
      return {
        ...(widthTwips === undefined ? {} : { widthTwips }),
        ...(heightTwips === undefined ? {} : { heightTwips })
      }
    }
  }

  if (orient !== undefined && orient !== 'portrait' && orient !== 'landscape') {
    warnings.push({
      code: 'DOCX_SECTION_ORIENTATION_UNSUPPORTED',
      severity: 'warning',
      part,
      path: 'sectPr',
      message: `DOCX section page orientation is not supported: ${orient}`,
      fallback: 'ignore-section-orientation',
      recoverable: true
    })
  }

  return {
    ...(widthTwips === undefined ? {} : { widthTwips }),
    ...(heightTwips === undefined ? {} : { heightTwips })
  }
}

/** 读取 section 的页边距。 */
function readSectionPageMargins(element: XmlElementNode): DocxImportSectionMargins | undefined {
  const pageMargins = readXmlChildren(element).find((child) => child.localName === 'pgMar')

  if (pageMargins === undefined) {
    return undefined
  }

  const top = readSignedNumber(readXmlAttribute(pageMargins, 'w:top'))
  const right = readSignedNumber(readXmlAttribute(pageMargins, 'w:right'))
  const bottom = readSignedNumber(readXmlAttribute(pageMargins, 'w:bottom'))
  const left = readSignedNumber(readXmlAttribute(pageMargins, 'w:left'))

  if (top === undefined && right === undefined && bottom === undefined && left === undefined) {
    return undefined
  }

  return {
    ...(top === undefined ? {} : { top }),
    ...(right === undefined ? {} : { right }),
    ...(bottom === undefined ? {} : { bottom }),
    ...(left === undefined ? {} : { left })
  }
}

/** 读取可带符号数字或返回 undefined。 */
function readSignedNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const number = Number(value)

  return Number.isFinite(number) ? number : undefined
}

/** 读取 section 的 type，默认 next-page。 */
function readSectionBreakType(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): 'continuous' | 'next-page' | undefined {
  const sectionType = readXmlChildren(element).find((child) => child.localName === 'type')

  if (sectionType === undefined) {
    return 'next-page'
  }

  const value = readXmlAttribute(sectionType, 'w:val')

  if (value === 'continuous') {
    return 'continuous'
  }

  if (value === 'nextPage' || value === 'next-page' || value === undefined) {
    return 'next-page'
  }

  warnings.push({
    code: 'DOCX_SECTION_BREAK_UNSUPPORTED',
    severity: 'warning',
    part,
    path: 'sectPr',
    message: `DOCX section break type is not fully supported: ${value}`,
    fallback: 'treat-as-next-page',
    recoverable: true
  })

  return 'next-page'
}

/** 读取 section columns。 */
function readSectionColumns(
  element: XmlElementNode,
  warnings: DocxWarning[],
  part: string
): number | undefined {
  const columns = readXmlChildren(element).find((child) => child.localName === 'cols')

  if (columns === undefined) {
    return undefined
  }

  const num = readPositiveNumber(readXmlAttribute(columns, 'w:num'))
  const hasExplicitColumns = readXmlChildren(columns).some((child) => child.localName === 'col')

  if (hasExplicitColumns || (num !== undefined && num > 1)) {
    warnings.push({
      code: 'DOCX_SECTION_COLUMNS_UNSUPPORTED',
      severity: 'warning',
      part,
      path: 'sectPr',
      message: `DOCX section columns are not fully supported: ${num ?? 'custom'}`,
      fallback: 'ignore-columns',
      recoverable: true
    })
  }

  return undefined
}

/** 读取 section header/footer 引用。 */
function readSectionReferenceTargets(
  element: XmlElementNode,
  localName: 'headerReference' | 'footerReference',
  relationshipsById: ReadonlyMap<string, DocxRelationship>,
  part: string,
  sourceIdsByPart: ReadonlyMap<string, readonly string[]>
): readonly string[] {
  return readXmlChildren(element)
    .filter((child) => child.localName === localName)
    .map((child) => readXmlAttribute(child, 'r:id'))
    .flatMap((relationshipId) => {
      if (relationshipId === undefined) {
        return []
      }

      const relationship = relationshipsById.get(relationshipId)

      if (relationship === undefined || relationship.targetMode === 'External') {
        return []
      }

      const targetPart = resolvePartTarget(part, relationship.target)
      const sourceIds = sourceIdsByPart.get(targetPart)

      return sourceIds === undefined || sourceIds.length === 0 ? [targetPart] : [...sourceIds]
    })
}

/** 读取 section page numbering。 */
function readSectionPageNumbering(
  element: XmlElementNode
): DocxImportSectionPageNumbering | undefined {
  const pageNumbering = readXmlChildren(element).find((child) => child.localName === 'pgNumType')

  if (pageNumbering === undefined) {
    return undefined
  }

  const start = readPositiveNumber(readXmlAttribute(pageNumbering, 'w:start'))
  const mode = start === undefined ? 'continue' : 'restart'

  return {
    mode,
    ...(start === undefined ? {} : { start })
  }
}
