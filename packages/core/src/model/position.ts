/**
 * 职责：定义 Gate 1 的 ID、twip、grapheme、AnchorRef 和 RangeRef 基础边界类型。
 * 边界：这里只定义边界，Yjs index、UTF-16、grapheme 转换与锚点解析 helper 分开处理。
 * 协作模块：selection、comment、revision、auto inserter 和 remote cursor 后续复用 AnchorRef/RangeRef。
 * 性能/安全约束：不在 top-level 访问 DOM 或文档状态，创建函数只做品牌化和不可变包装。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import * as Y from 'yjs'

import {
  graphemeIndexToUtf16Index,
  utf16IndexToGraphemeIndex
} from '../shared/grapheme'

declare const opaqueBrand: unique symbol
const anchorStateSymbol = Symbol('jword.anchor.state')

export type Opaque<Value, Name extends string> = Value & {
  readonly [opaqueBrand]: Name
}

/** 文档 ID，运行时仍是字符串。 */
export type DocumentId = Opaque<string, 'DocumentId'>

/** 节 ID，运行时仍是字符串。 */
export type SectionId = Opaque<string, 'SectionId'>

/** 块 ID，运行时仍是字符串。 */
export type BlockId = Opaque<string, 'BlockId'>

/** Run ID，运行时仍是字符串。 */
export type RunId = Opaque<string, 'RunId'>

/** 批注 ID，运行时仍是字符串。 */
export type CommentId = Opaque<string, 'CommentId'>

/** 修订 ID，运行时仍是字符串。 */
export type RevisionId = Opaque<string, 'RevisionId'>

/** twip 布局单位，运行时仍是数字。 */
export type Twip = Opaque<number, 'Twip'>

/** 文本 grapheme 边界下标，运行时仍是数字。 */
export type GraphemeIndex = Opaque<number, 'GraphemeIndex'>

/**
 * 创建 AnchorRef 所需的文本位置边界。
 *
 * @remarks
 * `graphemeIndex` 表示 run 内 grapheme 边界，不是 UTF-16 offset 或 Yjs index。
 */
export interface AnchorRefInput {
  readonly documentId: DocumentId
  readonly sectionId: SectionId
  readonly blockId: BlockId
  readonly runId: RunId
  readonly graphemeIndex: GraphemeIndex
}

/**
 * text 锚点输入。
 *
 * @remarks
 * 这里保存 Y.Text 句柄，仅用于创建相对位置，外部不会通过 AnchorRef 直接持有可写容器。
 */
export interface TextAnchorRefInput extends AnchorRefInput {
  readonly text: Y.Text
  readonly assoc?: number
}

/** core 内部读取 AnchorRef 时使用的不可变快照。 */
export interface AnchorRefSnapshot extends AnchorRefInput {
  readonly kind: 'block' | 'text'
  readonly assoc?: number
  readonly relativePosition?: Y.RelativePosition
}

/**
 * AnchorRef 是可变句柄，外层对象冻结只保证宿主不能直接改写内部状态。
 *
 * @remarks
 * 内部状态仅迁移/解析路径可变：Operation adapter 迁移文本锚点时会改写 block/run/text，
 * resolveAnchorRef 会同步刷新 graphemeIndex。对外读取必须继续通过防御性快照。
 */
interface AnchorRefState {
  kind: 'block' | 'text'
  documentId: DocumentId
  sectionId: SectionId
  blockId: BlockId
  runId: RunId
  graphemeIndex: GraphemeIndex
  text: Y.Text | undefined
  assoc: number
  relativePosition: Y.RelativePosition | undefined
}

interface AnchorRefRuntime {
  readonly [anchorStateSymbol]: AnchorRefState
}

export interface TextAnchorMigrationTarget {
  readonly sectionId?: SectionId
  readonly blockId: BlockId
  readonly runId: RunId
  readonly text: Y.Text
}

export interface RelativePositionSnapshot {
  readonly type?: {
    readonly client: number
    readonly clock: number
  }
  readonly tname?: string
  readonly item?: {
    readonly client: number
    readonly clock: number
  }
  readonly assoc?: number
}

export interface TextAnchorRecord {
  readonly documentId: string
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly graphemeIndex: number
  readonly assoc?: number
  readonly relativePosition: RelativePositionSnapshot
}

export interface TextRangeRecord {
  readonly id: string
  readonly anchor: TextAnchorRecord
  readonly focus: TextAnchorRecord
}

export type RangeSnapshotRecord = TextRangeRecord

export interface ResolvedTextAnchorRecord {
  readonly text: Y.Text
  readonly graphemeIndex: number
  readonly assoc?: number
}

const textAnchorRegistry = new WeakMap<Y.Text, Set<AnchorRefState>>()

/** 稳定锚点引用；外部不能依赖其内部结构。 */
export type AnchorRef = Readonly<{
  readonly [opaqueBrand]: 'AnchorRef'
}>

/** 稳定范围引用，只公开选区语义上的 anchor/focus。 */
export type RangeRef = Readonly<{
  readonly anchor: AnchorRef
  readonly focus: AnchorRef
  readonly [opaqueBrand]: 'RangeRef'
}>

/**
 * 创建 twip 品牌值。
 *
 * @param value twip 数值。
 * @returns 带 Twip 品牌的数值。
 */
export function createTwip(value: number): Twip {
  return value as Twip
}

/**
 * 创建 grapheme 边界下标品牌值。
 *
 * @param value grapheme 边界下标。
 * @returns 带 GraphemeIndex 品牌的数值。
 */
export function createGraphemeIndex(value: number): GraphemeIndex {
  return value as GraphemeIndex
}

/**
 * 创建不可变锚点引用。
 *
 * @param input 文档、节、块、run 和 grapheme 边界。
 * @returns 不暴露可变内部结构的 AnchorRef。
 */
export function createAnchorRef(input: AnchorRefInput): AnchorRef {
  return createAnchorRefFromState({
    kind: 'block',
    documentId: input.documentId,
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.graphemeIndex,
    text: undefined,
    assoc: 0,
    relativePosition: undefined
  })
}

/**
 * 创建携带 Y.RelativePosition 的 text 锚点。
 *
 * @remarks
 * Gate 1 只保证经 Operation adapter/replay 执行的结构性 split/merge 会迁移 AnchorRef；
 * 直接应用 raw Yjs 结构更新不会自动改写 AnchorRef 的 block/run 边界。
 *
 * @param input 文档、节、块、run、grapheme 边界和对应 Y.Text。
 * @returns 不暴露可变内部结构的 AnchorRef。
 */
export function createTextAnchorRef(input: TextAnchorRefInput): AnchorRef {
  const utf16Index = graphemeIndexToUtf16Index(input.text.toString(), Number(input.graphemeIndex))
  const state: AnchorRefState = {
    kind: 'text',
    documentId: input.documentId,
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.graphemeIndex,
    text: input.text,
    assoc: input.assoc ?? 0,
    relativePosition: Y.createRelativePositionFromTypeIndex(
      input.text,
      utf16Index,
      input.assoc ?? 0
    )
  }

  registerTextAnchorState(state)

  return createAnchorRefFromState(state)
}

/**
 * 创建不可变范围引用。
 *
 * @param anchor 选区起点。
 * @param focus 选区焦点。
 * @returns 包含 anchor/focus 的 RangeRef。
 */
export function createRangeRef(anchor: AnchorRef, focus: AnchorRef): RangeRef {
  return Object.freeze({
    anchor,
    focus
  }) as RangeRef
}

/**
 * 把运行时 AnchorRef 序列化为可持久化文本锚点记录。
 *
 * @param anchor 运行时锚点。
 * @returns JSON 兼容的文本锚点快照。
 */
export function createTextAnchorRecord(anchor: AnchorRef): TextAnchorRecord {
  const snapshot = readAnchorRefSnapshot(anchor)
  const relativePosition = snapshot.relativePosition

  if (relativePosition === undefined) {
    throw new Error('text anchor has no relative position')
  }

  return {
    documentId: String(snapshot.documentId),
    sectionId: String(snapshot.sectionId),
    blockId: String(snapshot.blockId),
    runId: String(snapshot.runId),
    graphemeIndex: Number(snapshot.graphemeIndex),
    ...(snapshot.assoc === undefined ? {} : { assoc: snapshot.assoc }),
    relativePosition: Y.relativePositionToJSON(relativePosition) as RelativePositionSnapshot
  }
}

/**
 * 把运行时 RangeRef 序列化为可持久化范围记录。
 *
 * @param id 范围记录 ID。
 * @param range 运行时范围。
 * @returns JSON 兼容的范围快照。
 */
export function createTextRangeRecord(id: string, range: RangeRef): TextRangeRecord {
  return {
    id,
    anchor: createTextAnchorRecord(range.anchor),
    focus: createTextAnchorRecord(range.focus)
  }
}

/**
 * 把可持久化相对位置快照恢复成 Y.RelativePosition。
 *
 * @param snapshot JSON 兼容的相对位置快照。
 * @returns 可用于绝对位置解析的相对位置对象。
 */
export function createRelativePositionFromSnapshot(snapshot: RelativePositionSnapshot): Y.RelativePosition {
  return Y.createRelativePositionFromJSON(snapshot)
}

/**
 * 解析持久化文本锚点记录的当前位置。
 *
 * @param record 文本锚点快照。
 * @param doc 当前文档。
 * @returns 当前共享文本与 grapheme 下标；失效时返回 undefined。
 */
export function resolveTextAnchorRecord(
  record: TextAnchorRecord,
  doc: Y.Doc
): ResolvedTextAnchorRecord | undefined {
  const absolute = Y.createAbsolutePositionFromRelativePosition(
    createRelativePositionFromSnapshot(record.relativePosition),
    doc
  )

  if (absolute === null || !(absolute.type instanceof Y.Text)) {
    return undefined
  }

  return {
    text: absolute.type,
    graphemeIndex: utf16IndexToGraphemeIndex(absolute.type.toString(), absolute.index),
    ...(record.assoc === undefined ? {} : { assoc: record.assoc })
  }
}

/**
 * 读取锚点内部快照。
 *
 * @remarks
 * 该函数只供 core 内部模块使用，不从包公共入口导出；外部仍只能把 AnchorRef 当作 opaque 值。
 *
 * @param anchor 稳定锚点。
 * @returns 锚点创建时的不可变边界信息。
 */
export function readAnchorRefSnapshot(anchor: AnchorRef): AnchorRefSnapshot {
  return createSnapshotFromState(readAnchorRefState(anchor))
}

/**
 * 解析锚点的当前位置。
 *
 * @remarks
 * resolveAnchorRef 会同步刷新内部 graphemeIndex，使句柄后续快照跟随 Y.RelativePosition。
 *
 * @param anchor 稳定锚点。
 * @param doc 需要解析相对位置的 Y.Doc。
 * @returns 解析后的快照；若相对位置已失效则返回 undefined。
 */
export function resolveAnchorRef(anchor: AnchorRef, doc: Y.Doc): AnchorRefSnapshot | undefined {
  const state = readAnchorRefState(anchor)
  const snapshot = createSnapshotFromState(state)

  if (snapshot.relativePosition === undefined) {
    return snapshot
  }

  const absolute = Y.createAbsolutePositionFromRelativePosition(snapshot.relativePosition, doc)

  if (absolute === null) {
    return undefined
  }

  state.graphemeIndex = createGraphemeIndex(utf16IndexToGraphemeIndex(state.text?.toString() ?? '', absolute.index))

  return createSnapshotFromState(state)
}

/**
 * splitBlock 后迁移被移动到新 run 的 text anchors。
 *
 * @remarks
 * 该 helper 是 Operation adapter/replay 的内部边界，不是 raw Yjs update observer。
 */
export function migrateTextAnchorsAfterSplit(
  sourceText: Y.Text,
  doc: Y.Doc,
  boundaryUtf16Index: number,
  target: TextAnchorMigrationTarget
): void {
  migrateTextAnchors(sourceText, doc, target, (utf16Index, state) =>
    utf16Index > boundaryUtf16Index || (utf16Index === boundaryUtf16Index && state.assoc > 0)
      ? utf16Index - boundaryUtf16Index
      : undefined
  )
}

/**
 * 把 source Y.Text 上的 text anchors 迁到另一个 Y.Text。
 *
 * @remarks
 * Gate 1 的结构迁移必须由 Operation adapter/replay 显式调用；协同 provider 后续只能复用该路径。
 */
export function migrateTextAnchorsToText(
  sourceText: Y.Text,
  doc: Y.Doc,
  target: TextAnchorMigrationTarget
): void {
  migrateTextAnchors(sourceText, doc, target, (index) => index)
}

/**
 * 把持久化文本锚点在 split 后迁到新 run。
 *
 * @param record 待迁移的文本锚点记录。
 * @param doc 当前文档。
 * @param sourceText 迁移前的共享文本。
 * @param boundaryUtf16Index split 边界。
 * @param target 迁移目标。
 * @returns 迁移后的文本锚点记录。
 */
export function migrateTextAnchorRecordAfterSplit(
  record: TextAnchorRecord,
  doc: Y.Doc,
  sourceText: Y.Text,
  boundaryUtf16Index: number,
  target: TextAnchorMigrationTarget
): TextAnchorRecord {
  return migrateTextAnchorRecord(record, doc, sourceText, target, (utf16Index, assoc) =>
    utf16Index > boundaryUtf16Index || (utf16Index === boundaryUtf16Index && assoc > 0)
      ? utf16Index - boundaryUtf16Index
      : undefined
  )
}

/**
 * 把持久化文本锚点整段迁到另一段共享文本。
 *
 * @param record 待迁移的文本锚点记录。
 * @param doc 当前文档。
 * @param sourceText 迁移前的共享文本。
 * @param target 迁移目标。
 * @returns 迁移后的文本锚点记录。
 */
export function migrateTextAnchorRecordToText(
  record: TextAnchorRecord,
  doc: Y.Doc,
  sourceText: Y.Text,
  target: TextAnchorMigrationTarget
): TextAnchorRecord {
  return migrateTextAnchorRecord(record, doc, sourceText, target, (utf16Index) => utf16Index)
}

/**
 * 把持久化范围在 split 后迁到新 run。
 *
 * @param record 待迁移的范围记录。
 * @param doc 当前文档。
 * @param sourceText 迁移前的共享文本。
 * @param boundaryUtf16Index split 边界。
 * @param target 迁移目标。
 * @returns 迁移后的范围记录。
 */
export function migrateTextRangeRecordAfterSplit(
  record: TextRangeRecord,
  doc: Y.Doc,
  sourceText: Y.Text,
  boundaryUtf16Index: number,
  target: TextAnchorMigrationTarget
): TextRangeRecord {
  return {
    ...record,
    anchor: migrateTextAnchorRecordAfterSplit(record.anchor, doc, sourceText, boundaryUtf16Index, target),
    focus: migrateTextAnchorRecordAfterSplit(record.focus, doc, sourceText, boundaryUtf16Index, target)
  }
}

/**
 * 把持久化范围整段迁到另一段共享文本。
 *
 * @param record 待迁移的范围记录。
 * @param doc 当前文档。
 * @param sourceText 迁移前的共享文本。
 * @param target 迁移目标。
 * @returns 迁移后的范围记录。
 */
export function migrateTextRangeRecordToText(
  record: TextRangeRecord,
  doc: Y.Doc,
  sourceText: Y.Text,
  target: TextAnchorMigrationTarget
): TextRangeRecord {
  return {
    ...record,
    anchor: migrateTextAnchorRecordToText(record.anchor, doc, sourceText, target),
    focus: migrateTextAnchorRecordToText(record.focus, doc, sourceText, target)
  }
}

function createAnchorRefFromState(state: AnchorRefState): AnchorRef {
  return Object.freeze({
    [anchorStateSymbol]: state
  }) as unknown as AnchorRef
}

function readAnchorRefState(anchor: AnchorRef): AnchorRefState {
  return (anchor as unknown as AnchorRefRuntime)[anchorStateSymbol]
}

function createSnapshotFromState(state: AnchorRefState): AnchorRefSnapshot {
  return {
    kind: state.kind,
    documentId: state.documentId,
    sectionId: state.sectionId,
    blockId: state.blockId,
    runId: state.runId,
    graphemeIndex: state.graphemeIndex,
    ...(state.assoc === 0 ? {} : { assoc: state.assoc }),
    ...(state.relativePosition === undefined ? {} : { relativePosition: state.relativePosition })
  }
}

function registerTextAnchorState(state: AnchorRefState): void {
  if (state.text === undefined) {
    return
  }

  const states = textAnchorRegistry.get(state.text) ?? new Set<AnchorRefState>()

  states.add(state)
  textAnchorRegistry.set(state.text, states)
}

function unregisterTextAnchorState(state: AnchorRefState): void {
  if (state.text === undefined) {
    return
  }

  textAnchorRegistry.get(state.text)?.delete(state)
}

function migrateTextAnchors(
  sourceText: Y.Text,
  doc: Y.Doc,
  target: TextAnchorMigrationTarget,
  mapIndex: (utf16Index: number, state: AnchorRefState) => number | undefined
): void {
  const states = [...(textAnchorRegistry.get(sourceText) ?? [])]

  for (const state of states) {
    if (state.relativePosition === undefined) {
      continue
    }

    const absolute = Y.createAbsolutePositionFromRelativePosition(state.relativePosition, doc)

    if (absolute === null || absolute.type !== sourceText) {
      continue
    }

    const targetIndex = mapIndex(absolute.index, state)

    if (targetIndex === undefined) {
      continue
    }

    unregisterTextAnchorState(state)
    state.sectionId = target.sectionId ?? state.sectionId
    state.blockId = target.blockId
    state.runId = target.runId
    state.graphemeIndex = createGraphemeIndex(utf16IndexToGraphemeIndex(target.text.toString(), targetIndex))
    state.text = target.text
    state.relativePosition = Y.createRelativePositionFromTypeIndex(target.text, targetIndex, state.assoc)
    registerTextAnchorState(state)
  }
}

function migrateTextAnchorRecord(
  record: TextAnchorRecord,
  doc: Y.Doc,
  sourceText: Y.Text,
  target: TextAnchorMigrationTarget,
  mapIndex: (utf16Index: number, assoc: number) => number | undefined
): TextAnchorRecord {
  const assoc = record.assoc ?? 0
  const relativePosition = createRelativePositionFromSnapshot(record.relativePosition)
  const absolute = Y.createAbsolutePositionFromRelativePosition(relativePosition, doc)

  if (absolute === null || absolute.type !== sourceText) {
    return record
  }

  const targetIndex = mapIndex(absolute.index, assoc)

  if (targetIndex === undefined) {
    return record
  }

  return {
    ...record,
    sectionId: String(target.sectionId ?? record.sectionId),
    blockId: String(target.blockId),
    runId: String(target.runId),
    graphemeIndex: utf16IndexToGraphemeIndex(target.text.toString(), targetIndex),
    relativePosition: Y.relativePositionToJSON(
      Y.createRelativePositionFromTypeIndex(target.text, targetIndex, assoc)
    ) as RelativePositionSnapshot
  }
}
