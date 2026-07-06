/**
 * 职责：提供 @4xian/jword-ui 的 createJWordUi 公开装配入口。
 * 边界：只保留入口导出，不承载具体 toolbar、comments、link 或 overlay 实现。
 * 协作模块：ui-lifecycle 负责实际装配，index 继续通过本文件暴露稳定公开符号。
 * 性能/安全约束：入口无顶层 DOM 副作用，保持公开导出面不变。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
export { createJWordUi } from './ui-lifecycle'
