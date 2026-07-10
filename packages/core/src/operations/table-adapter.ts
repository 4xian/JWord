/**
 * 职责：提供 operation-adapter 使用的表格 operation 分发入口。
 * 边界：保持现有 table-operation-adapter 行为不变，仅承接 Phase 5 目标文件名。
 * 协作模块：operation-adapter 调用本入口，table-operation-adapter 执行具体表格结构变更。
 * 性能/安全约束：不新增状态，不访问 DOM；所有写入继续发生在 transaction pipeline 内。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export { applyTableOperation } from './table-operation-adapter'
