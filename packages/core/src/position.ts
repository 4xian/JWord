/**
 * 职责：定义 Gate 1 的 ID、twip、grapheme、AnchorRef 和 RangeRef 基础边界类型。
 * 边界：这里只定义边界，Yjs index、UTF-16、grapheme 转换与锚点解析 helper 分开处理。
 * 协作模块：selection、comment、revision、auto inserter 和 remote cursor 后续复用 AnchorRef/RangeRef。
 * 性能/安全约束：不在 top-level 访问 DOM 或文档状态，创建函数只做品牌化和不可变包装。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/03-architecture.md#35-anchor-与-selection。
 */

import * as Y from 'yjs'

declare const opaqueBrand: unique symbol

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
  return Object.freeze({
    kind: 'block',
    ...input
  }) as unknown as AnchorRef
}

/**
 * 创建携带 Y.RelativePosition 的 text 锚点。
 *
 * @param input 文档、节、块、run、grapheme 边界和对应 Y.Text。
 * @returns 不暴露可变内部结构的 AnchorRef。
 */
export function createTextAnchorRef(input: TextAnchorRefInput): AnchorRef {
  return Object.freeze({
    kind: 'text',
    documentId: input.documentId,
    sectionId: input.sectionId,
    blockId: input.blockId,
    runId: input.runId,
    graphemeIndex: input.graphemeIndex,
    relativePosition: Y.createRelativePositionFromTypeIndex(
      input.text,
      Number(input.graphemeIndex),
      input.assoc ?? 0
    )
  }) as unknown as AnchorRef
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
  return anchor as unknown as AnchorRefSnapshot
}

/**
 * 解析锚点的当前位置。
 *
 * @param anchor 稳定锚点。
 * @param doc 需要解析相对位置的 Y.Doc。
 * @returns 解析后的快照；若相对位置已失效则返回 undefined。
 */
export function resolveAnchorRef(anchor: AnchorRef, doc: Y.Doc): AnchorRefSnapshot | undefined {
  const snapshot = readAnchorRefSnapshot(anchor)

  if (snapshot.relativePosition === undefined) {
    return snapshot
  }

  const absolute = Y.createAbsolutePositionFromRelativePosition(snapshot.relativePosition, doc)

  if (absolute === null) {
    return undefined
  }

  return {
    ...snapshot,
    graphemeIndex: createGraphemeIndex(absolute.index)
  }
}
