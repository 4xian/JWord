/**
 * 职责：定义 Gate 4 表格 toolbar 的最小状态推导与纯函数 helper。
 * 边界：只处理行列输入、按钮可用性和摘要文案，不访问 DOM，也不调用 editor 或宿主 adapter。
 * 协作模块：table controller 维护状态，table dom 只消费这里归一化后的数据。
 * 性能/安全约束：状态保持轻量可序列化，避免把 projection 细节长期缓存在 UI 层。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.7。
 */
import type {
  JWordTableBorderPreset,
  JWordTableSelectionScope,
  JWordTableSelectionTarget
} from '../types'

/** table 输入行列维度的最小值。 */
export const MIN_TABLE_DIMENSION = 1

/** table 输入行列维度的最大值。 */
export const MAX_TABLE_DIMENSION = 12

/** 根据当前选中目标生成摘要文案。 */
export function readTableSelectionSummary(
  target: JWordTableSelectionTarget | null,
  scope: JWordTableSelectionScope
): string {
  if (target === null) {
    return '当前未命中表格单元格。先插入表格，或把光标放到已有单元格内。'
  }

  const scopeLabel = scope === 'row'
    ? '整行'
    : scope === 'column'
      ? '整列'
      : '单元格'

  return `当前表格 ${target.rowCount} x ${target.columnCount}，第 ${target.rowIndex + 1} 行第 ${target.columnIndex + 1} 列，作用范围：${scopeLabel}。`
}

/** 读取“宿主尚未对接命令”时的默认提示。 */
export function readDefaultDeferredMessage(actionLabel: string): string {
  return `${actionLabel} 已触发，但宿主尚未接入表格命令适配器。`
}

/** 把用户输入归一化成安全的表格维度。 */
export function normalizeTableDimension(rawValue: string, fallbackValue: number): number {
  const parsedValue = Number.parseInt(rawValue, 10)

  if (!Number.isFinite(parsedValue)) {
    return clampTableDimension(fallbackValue)
  }

  return clampTableDimension(parsedValue)
}

/** 把行列维度钳制在当前 UI 允许范围内。 */
export function clampTableDimension(value: number): number {
  return Math.min(MAX_TABLE_DIMENSION, Math.max(MIN_TABLE_DIMENSION, Math.round(value)))
}

/** 当前目标是否允许删除整行。 */
export function canDeleteTargetRow(target: JWordTableSelectionTarget | null): boolean {
  return target !== null && target.rowCount > 1
}

/** 当前目标是否允许删除整列。 */
export function canDeleteTargetColumn(target: JWordTableSelectionTarget | null): boolean {
  return target !== null && target.columnCount > 1
}

/** 当前目标是否允许向右合并。 */
export function canMergeCellWithRight(target: JWordTableSelectionTarget | null): boolean {
  return target !== null && target.cellIndex < target.rowCellCount - 1
}

/** 读取边框预设的中文标签。 */
export function readBorderPresetLabel(preset: JWordTableBorderPreset): string {
  switch (preset) {
    case 'all':
      return '全部边框'
    case 'outer':
      return '仅外框'
    case 'innerHorizontal':
      return '横向内框'
    case 'innerVertical':
      return '纵向内框'
    case 'none':
      return '无边框'
  }
}
