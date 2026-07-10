/**
 * @vitest-environment node
 *
 * 职责：为编辑器门面拆分测试提供投影读取辅助函数。
 * 边界：只服务 packages/core/test/editor 下的测试文件，不进入生产代码导出面。
 * 协作模块：文档投影类型与门面运行时测试。
 * 性能/安全约束：辅助函数只读取只读投影，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { DocumentProjection } from '../../src/model/projection'

/** 读取每个段落中每个 run 的纯文本。 */
export function readParagraphRunTexts(projection: DocumentProjection) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))]
      : [])
  )
}

/** 读取每个段落中每个 run 的格式属性。 */
export function readParagraphRunProperties(projection: DocumentProjection) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map((run) => run.properties ?? {})]
      : [])
  )
}

/** 读取每个段落的段落属性。 */
export function readParagraphProperties(projection: DocumentProjection) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.properties ?? {}]
      : [])
  )
}
