/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 DOCX demo 异步导入导出任务的取消会话语义。
 * 边界：只验证 demo host 的 session guard，不执行真实 DOCX/PDF 互通。
 * 协作模块：examples/docx/src/task-session.ts 与浏览器手动验收入口。
 * 约束：取消后的旧任务不得继续写入 editor 或输出面板。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it } from 'vitest'

import { createDocxDemoTaskController, isDocxDemoTaskCancelled } from '../src/task-session'

describe('docx demo task session', () => {
  it('取消后阻止旧任务提交写入', () => {
    const controller = createDocxDemoTaskController()
    const session = controller.start('import')

    controller.cancelActiveTask()

    expect(session.signal.aborted).toBe(true)
    expect(session.canCommit()).toBe(false)
    expect(controller.readActiveTask()).toBeNull()
  })

  it('新任务开始后阻止旧任务提交写入', () => {
    const controller = createDocxDemoTaskController()
    const first = controller.start('export-docx')
    const second = controller.start('export-pdf')

    expect(first.signal.aborted).toBe(true)
    expect(first.canCommit()).toBe(false)
    expect(second.canCommit()).toBe(true)
    expect(controller.readActiveTask()).toEqual({
      kind: 'export-pdf',
      requestId: second.requestId
    })
  })

  it('只允许当前任务完成时清理 active 状态', () => {
    const controller = createDocxDemoTaskController()
    const first = controller.start('import')
    const second = controller.start('export-docx')

    expect(controller.finishTask(first.requestId)).toBe(false)
    expect(controller.readActiveTask()).toEqual({
      kind: 'export-docx',
      requestId: second.requestId
    })

    expect(controller.finishTask(second.requestId)).toBe(true)
    expect(second.canCommit()).toBe(false)
    expect(controller.readActiveTask()).toBeNull()
  })

  it('识别 AbortSignal 取消错误，避免取消任务冒泡成未处理异常', () => {
    const controller = createDocxDemoTaskController()
    const session = controller.start('export-pdf')

    controller.cancelActiveTask()

    expect(isDocxDemoTaskCancelled(session, new DOMException('AbortError', 'AbortError'))).toBe(true)
    expect(isDocxDemoTaskCancelled(session, new Error('其它错误'))).toBe(false)
  })
})
