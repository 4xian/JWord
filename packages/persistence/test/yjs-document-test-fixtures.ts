/**
 * 职责：提供 persistence restore 测试共用的嵌套 Yjs document fixture。
 * 边界：仅供 persistence package 测试使用，不进入生产源码或 package exports。
 * 协作模块：memory-adapter.test.ts 与 storage-history-adapter.test.ts 共用相同结构。
 * 约束：只构造和读取测试文档，不封装 adapter 行为或生产测试入口。
 * 实现说明：fixture 同时包含 Y.Text attributes 与 canonical properties 容器。
 */

import * as Y from 'yjs'

/** 创建带 Y.Text attributes 与 canonical properties 的嵌套正文 run。 */
export function createNestedFormattedRun(
  doc: Y.Doc
): { text: Y.Text, properties: Y.Map<unknown> } {
  const sections = doc.getArray<Y.Map<unknown>>('sections')
  const section = new Y.Map<unknown>()
  const blocks = new Y.Array<Y.Map<unknown>>()
  const paragraph = new Y.Map<unknown>()
  const runs = new Y.Array<Y.Map<unknown>>()
  const run = new Y.Map<unknown>()
  const text = new Y.Text()
  const properties = new Y.Map<unknown>()

  run.set('text', text)
  run.set('properties', properties)
  runs.push([run])
  paragraph.set('runs', runs)
  blocks.push([paragraph])
  section.set('blocks', blocks)
  sections.push([section])

  return { text, properties }
}

/** 读取恢复后的嵌套正文与 canonical properties。 */
export function readNestedFormattedRun(
  doc: Y.Doc
): { text: Y.Text, properties: Y.Map<unknown> } {
  const section = doc.getArray<Y.Map<unknown>>('sections').get(0)
  const blocks = section?.get('blocks')

  if (!(blocks instanceof Y.Array)) {
    throw new Error('恢复后的 section 应包含 blocks')
  }

  const paragraph = blocks.get(0)
  const runs = paragraph?.get('runs')

  if (!(runs instanceof Y.Array)) {
    throw new Error('恢复后的 paragraph 应包含 runs')
  }

  const run = runs.get(0)
  const text = run?.get('text')
  const properties = run?.get('properties')

  if (!(text instanceof Y.Text) || !(properties instanceof Y.Map)) {
    throw new Error('恢复后的 run 应包含 text 与 properties')
  }

  return { text, properties }
}
