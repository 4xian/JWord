/**
 * 职责：定义 Editor 中立位置 API 的公开纯数据类型。
 * 边界：只描述 selection、anchor、range 和 query result，不创建运行时对象。
 * 协作模块：Editor facade、跳转、批注、目录、查找替换和高级包共同消费这些类型。
 * 性能/安全约束：类型只包含 JSON 兼容字段，不暴露 AnchorRef、RangeRef、Yjs、DOM Range 或布局坐标。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { SelectionAffinity, SelectionDirection } from '../model/selection'

/**
 * 中立文本位置，供跳转、宿主业务和高级包复用。
 */
export interface EditorTextLocation {
  /** 目标节 ID。 */
  readonly sectionId: string
  /** 目标块 ID。 */
  readonly blockId: string
  /** 目标 run ID。 */
  readonly runId: string
  /** run 内 grapheme 边界下标。 */
  readonly graphemeIndex: number
  /** 边界关联方向。 */
  readonly assoc?: number
}

/**
 * 公开 anchor 快照，不暴露 AnchorRef 或 Yjs 相对位置。
 */
export interface EditorAnchorSnapshot {
  /** 快照类型。 */
  readonly kind: 'anchor'
  /** 当前可序列化文本位置。 */
  readonly location: EditorTextLocation
}

/**
 * 创建中立 range 快照时使用的公开输入。
 */
export interface EditorRangeSnapshotInput {
  /** 范围起点。 */
  readonly anchor: EditorTextLocation
  /** 范围焦点。 */
  readonly focus: EditorTextLocation
}

/**
 * 公开 range 快照，不暴露 RangeRef、TextRangeRecord 或内部相对位置。
 */
export interface EditorRangeSnapshot {
  /** 快照类型。 */
  readonly kind: 'range'
  /** 范围起点。 */
  readonly anchor: EditorTextLocation
  /** 范围焦点。 */
  readonly focus: EditorTextLocation
}

/**
 * 当前 selection 的公开快照。
 */
export interface EditorSelectionSnapshot {
  /** 快照类型。 */
  readonly kind: 'selection'
  /** 选区是否折叠。 */
  readonly collapsed: boolean
  /** 选择方向。 */
  readonly direction: SelectionDirection
  /** 光标亲和性。 */
  readonly affinity: SelectionAffinity
  /** 选择起点。 */
  readonly anchor: EditorAnchorSnapshot
  /** 选择焦点。 */
  readonly focus: EditorAnchorSnapshot
  /** 选择范围。 */
  readonly range: EditorRangeSnapshot
}

/**
 * 中立位置查询输入。
 */
export type EditorLocationQuery =
  | {
      readonly kind: 'text'
      readonly text: string
      readonly caseSensitive?: boolean
    }
  | {
      readonly kind: 'block'
      readonly blockId: string
    }
  | {
      readonly kind: 'heading'
      readonly blockId?: string
      readonly level?: 1 | 2 | 3
    }
  | {
      readonly kind: 'comment'
      readonly commentId: string
    }
  | {
      readonly kind: 'rangeSnapshot'
      readonly range: EditorRangeSnapshot
    }

/**
 * 中立位置查询结果。
 */
export interface EditorTextQueryResult {
  /** 结果类型。 */
  readonly kind: 'queryResult'
  /** 查询来源。 */
  readonly source: EditorLocationQuery['kind']
  /** 结果起点位置。 */
  readonly location: EditorTextLocation
  /** 结果范围。 */
  readonly range: EditorRangeSnapshot
  /** 命中的可见文本。 */
  readonly text?: string
  /** 查询内的命中序号。 */
  readonly index?: number
}

/**
 * 可被解析为当前文档位置的公开输入。
 */
export type EditorLocationTarget =
  | EditorTextLocation
  | EditorAnchorSnapshot
  | EditorRangeSnapshot
  | EditorSelectionSnapshot
  | EditorTextQueryResult

/**
 * 已解析的公开位置结果。
 */
export interface EditorResolvedLocation {
  /** 解析结果类型。 */
  readonly kind: 'resolvedLocation'
  /** 解析后的起点位置。 */
  readonly location: EditorTextLocation
  /** 解析后的范围。 */
  readonly range: EditorRangeSnapshot
}

/**
 * 滚动到公开位置时允许的可选行为。
 */
export interface EditorScrollToLocationOptions {
  /** 浏览器滚动行为。 */
  readonly behavior?: 'auto' | 'smooth'
}
