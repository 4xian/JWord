/**
 * 职责：汇总 layout 运行时公开入口。
 * 边界：只 re-export 子模块，不承载具体布局实现。
 * 协作模块：顶层 packages/core/src/layout.ts 通过这里保持既有导出兼容。
 * 性能/安全约束：禁止在聚合文件中加入运行时副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export * from './types'
export * from './engine'
export * from './query'
