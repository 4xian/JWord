/**
 * 职责：定义 Gate 1 文档模型的最小纯数据类型骨架。
 * 边界：只描述 OOXML 对齐结构，不实现事务、布局、渲染、输入或导入导出。
 * 协作模块：后续事务管线、投影、布局和互通包通过这些类型约束数据形状。
 * 约束：core 保持框架无关，不引入浏览器、docx、PDF、协同 provider 或 demo 依赖。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/02-technical-decisions.md#25-文档模型决策。
 */

import type { Resource } from '../resources/types'
import type { TextRangeRecord } from './position'

export const DOCUMENT_MODEL_SCHEMA_VERSION = 1

export type ModelProperties = Readonly<Record<string, unknown>>

export type DocumentMetadata = Readonly<Record<string, string>>

/** JWord 公开文档模型根节点，只描述可序列化内容，不暴露内部 Y.Doc 容器。 */
export interface Document {
  readonly kind: 'document'
  readonly id: string
  readonly metadata?: DocumentMetadata
  readonly styleIds?: readonly string[]
  readonly resourceIds?: readonly string[]
  readonly resources?: readonly Resource[]
  readonly sections: readonly Section[]
  readonly comments?: readonly Comment[]
  readonly revisions?: readonly RevisionMetadata[]
}

export interface Section {
  readonly kind: 'section'
  readonly id: string
  readonly breakType?: SectionBreakType
  readonly page?: SectionPageLayout
  readonly columns?: number
  readonly headerIds?: readonly string[]
  readonly footerIds?: readonly string[]
  readonly headerFooterSameAsPrevious?: boolean
  readonly pageNumbering?: SectionPageNumbering
  readonly blocks: readonly Block[]
}

export type SectionBreakType = 'continuous' | 'next-page'

export interface SectionPageLayout {
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly marginTwips?: PageMargins
}

export interface SectionPageNumbering {
  readonly mode: 'continue' | 'restart'
  readonly start?: number
}

export interface PageMargins {
  readonly top?: number
  readonly right?: number
  readonly bottom?: number
  readonly left?: number
}

export type Block = Paragraph | Table

export interface Paragraph {
  readonly kind: 'paragraph'
  readonly id: string
  readonly properties?: ModelProperties
  readonly styleId?: string
  readonly list?: ParagraphList
  readonly tabs?: readonly number[]
  readonly runs: readonly Run[]
}

export interface ParagraphList {
  readonly numberingId: string
  readonly level: number
}

export interface Run {
  readonly kind: 'run'
  readonly id: string
  readonly properties?: ModelProperties
  readonly field?: RunField
  readonly link?: RunLink
  readonly revisionId?: string
  readonly inlines: readonly Inline[]
}

export interface RunField {
  readonly code: string
  readonly result?: string
}

export interface RunLink {
  readonly target: string
  readonly tooltip?: string
}

export type Inline =
  | TextInline
  | ImageInline
  | BreakInline
  | BookmarkInline
  | CommentRangeMarkerInline

export interface TextInline {
  readonly kind: 'text'
  readonly text: string
}

export interface ImageInline {
  readonly kind: 'image'
  readonly resourceId: string
  readonly alt?: string
  readonly display?: 'inline'
  readonly widthTwips?: number
  readonly heightTwips?: number
  readonly rotationDegrees?: number
}

export interface BreakInline {
  readonly kind: 'break'
  readonly breakType: 'line' | 'page' | 'column'
}

export interface BookmarkInline {
  readonly kind: 'bookmark'
  readonly id: string
  readonly name: string
  readonly edge: 'start' | 'end'
}

export interface CommentRangeMarkerInline {
  readonly kind: 'commentRangeMarker'
  readonly commentId: string
  readonly edge: 'start' | 'end'
}

export interface Table {
  readonly kind: 'table'
  readonly id: string
  readonly properties?: ModelProperties
  readonly grid?: readonly number[]
  readonly border?: TableBorder
  readonly rows: readonly TableRow[]
}

export interface TableRow {
  readonly id: string
  readonly properties?: ModelProperties
  readonly cells: readonly TableCell[]
}

export interface TableCell {
  readonly id: string
  readonly properties?: ModelProperties
  readonly border?: TableBorder
  readonly gridSpan?: number
  readonly blocks: readonly Block[]
}

export interface TableBorder {
  readonly color?: string
  readonly widthTwips?: number
}

export interface CommentMessage {
  readonly id: string
  readonly authorId: string
  readonly createdAt: string
  readonly anchorRangeId: string
  readonly text: string
  readonly editedAt?: string
}

export interface CommentThread {
  readonly kind: 'commentThread'
  readonly id: string
  readonly authorId: string
  readonly createdAt: string
  readonly anchorRangeId: string
  readonly resolved: boolean
  readonly rangeSnapshot: TextRangeRecord
  readonly messages: readonly CommentMessage[]
}

export type Comment = CommentThread

export interface RevisionMetadata {
  readonly kind: 'revision'
  readonly id: string
  readonly authorId: string
  readonly createdAt: string
  readonly type: 'insert' | 'delete' | 'format'
  readonly rangeId?: string
  readonly rangeSnapshot: TextRangeRecord
  readonly summary: string
  readonly formatSnapshots?: readonly RevisionFormatSnapshot[]
}

/** 格式修订拒绝时用于恢复的原始 run 属性快照。 */
export interface RevisionFormatSnapshot {
  readonly runId: string
  readonly previousProperties: ModelProperties
}
