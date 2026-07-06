/**
 * 职责：解析 createJWordUi 的表格工具配置和默认命令适配器。
 * 边界：不创建 table controller DOM，不直接执行表格命令。
 * 协作模块：ui-lifecycle 读取默认配置后交给 table/controller。
 * 性能/安全约束：默认命令适配器仍通过 core command builders 进入 transaction pipeline。
 * Specs：docs/superpowers/reports/2026-07-03-remediation-execution-supplement.md#310-phase-5-超大文件拆分目标结构。
 */
import { createCoreTableCommandAdapter } from './table/core-command-adapter'
import type { JWordTableOptions } from './types'

/** 解析表格工具配置；默认使用 core 表格命令适配器。 */
export function resolveTableOptions(table: JWordTableOptions | undefined): JWordTableOptions {
  if (table !== undefined) {
    return table
  }

  return Object.freeze({
    title: '表格',
    description: '默认表格工具使用 core 表格命令适配器。',
    commands: createCoreTableCommandAdapter()
  } satisfies JWordTableOptions)
}
