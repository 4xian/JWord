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
} from './grapheme'

declare const opaqueBrand: unique symbol
const anchorStateSymbol = Symbol('jword.anchor.state')

type Opaque<Value, Name extends string> = Value & {
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
  readonly relativePosition?: Y.RelativePosition
}

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
