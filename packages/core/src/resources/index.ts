/**
 * 职责：汇总资源表与 URL allowlist 的公开入口。
 * 边界：只 re-export resources 类型与纯函数，不承载 editor/runtime 逻辑。
 * 协作模块：root index、media UI 和后续导入导出适配层通过这里消费资源语义。
 * 性能/安全约束：聚合文件不引入运行时副作用。
 */

export * from './types'
