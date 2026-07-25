/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 0 core 在导入和 createEditor 阶段不需要浏览器 DOM。
 * 边界：不测试 mount 后 DOM 行为，该部分由 jsdom 生命周期测试覆盖。
 * 协作模块：SSR wrapper、Node 测试环境和构建工具可安全导入 core。
 * 性能/安全约束：top-level 与 constructor 不访问 window/document/HTMLElement 实例。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/index'

describe('Editor DOM boundary', () => {
  it('can be created and destroyed without browser globals', () => {
    expect(globalThis.window).toBeUndefined()
    expect(globalThis.document).toBeUndefined()

    const editor = createEditor()

    expect(() => editor.destroy()).not.toThrow()
  })
})
