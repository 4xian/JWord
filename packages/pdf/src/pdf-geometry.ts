/**
 * 职责：集中提供 PDF renderer 使用的基础几何单位转换。
 * 边界：只处理纯数值转换，不读取 layout、不访问 pdf-lib 文档状态。
 * 协作模块：index.ts、text-style-renderer.ts 和后续 PDF 视觉报告复用 points 转换。
 * 性能/安全约束：纯函数无副作用，避免在多个 PDF 渲染模块中重复定义单位换算。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

/** twips 转 PDF points。 */
export function twipsToPdfPoints(twips: number): number {
  return twips / 20
}
