/**
 * 职责：定义 Gate 3 基础格式命令和 toolbar 状态共享的公开类型。
 * 边界：只描述格式值和状态形状，不构造 command、不读取 projection、不访问 DOM。
 * 协作模块：command builder、toolbar 状态同步和外部 UI wrapper 通过这些类型对齐格式语义。
 * 性能/安全约束：纯类型模块，无副作用，不依赖浏览器或 Yjs 运行时。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-3---输入与基础编辑。
 */

/** Gate 3 当前最小段落对齐值。 */
export type ParagraphAlignment = 'left' | 'center' | 'right' | 'justify'

/** 需要按渲染语义归一化的布尔格式属性。 */
export type BooleanFormattingPropertyKey =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'

/** toolbar 读取单个格式值时使用的统一形状。 */
export interface FormattingStateValue<Value> {
  readonly value: Value | undefined
  readonly mixed: boolean
}

/** 当前选区聚合出的 run 级格式状态。 */
export interface RunFormattingState {
  readonly bold: FormattingStateValue<boolean>
  readonly italic: FormattingStateValue<boolean>
  readonly underline: FormattingStateValue<boolean>
  readonly strike: FormattingStateValue<boolean>
  readonly fontFamily: FormattingStateValue<string>
  readonly fontSizeTwips: FormattingStateValue<number>
  readonly color: FormattingStateValue<string>
  readonly backgroundColor: FormattingStateValue<string>
}

/** 当前选区聚合出的段落级格式状态。 */
export interface ParagraphFormattingState {
  readonly alignment: FormattingStateValue<ParagraphAlignment>
  readonly indentLeftTwips: FormattingStateValue<number>
}

/** toolbar 第一版需要的最小选区格式状态。 */
export interface SelectionFormattingState {
  readonly run: RunFormattingState | null
  readonly paragraph: ParagraphFormattingState | null
}

const BOOLEAN_FORMATTING_PROPERTY_KEYS = new Set<BooleanFormattingPropertyKey>([
  'bold',
  'italic',
  'underline',
  'strike'
])

/**
 * 判断属性键是否需要按布尔渲染语义处理。
 */
export function isBooleanFormattingPropertyKey(key: string): key is BooleanFormattingPropertyKey {
  return BOOLEAN_FORMATTING_PROPERTY_KEYS.has(key as BooleanFormattingPropertyKey)
}

/**
 * 把布尔格式值归一化为实际渲染语义。
 *
 * @remarks
 * 对当前 Gate 3 而言，`false` 与 `undefined` 都表示未启用对应样式。
 */
export function normalizeBooleanFormattingValue(value: unknown): boolean {
  return value === true
}

/**
 * 按属性语义归一化格式值。
 */
export function normalizeFormattingPropertyValue(key: string, value: unknown): unknown {
  return isBooleanFormattingPropertyKey(key)
    ? normalizeBooleanFormattingValue(value)
    : value
}

/**
 * 判断两个属性值在当前渲染语义下是否等效。
 */
export function areFormattingPropertyValuesEquivalent(
  key: string,
  left: unknown,
  right: unknown
): boolean {
  return Object.is(
    normalizeFormattingPropertyValue(key, left),
    normalizeFormattingPropertyValue(key, right)
  )
}
