/**
 * 职责：聚合导出 Gate 3/4 command builder 拆分模块。
 * 边界：只作为 re-export 入口，不承载命令构造逻辑、不执行事务。
 * 协作模块：文本、段落、资源、批注、链接、图片与表格命令模块。
 * 性能/安全约束：入口文件不访问 Projection、不访问 DOM，保持公开导出面兼容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export * from './text-commands'
export * from './paragraph-commands'
export * from './resource-commands'
export * from './comment-commands'
export * from './link-commands'
export * from './image-commands'
export * from './table-commands'
