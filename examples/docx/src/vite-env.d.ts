/**
 * 职责：声明 Gate 5 DOCX demo 使用的 Vite 类型和浏览器测试钩子。
 * 边界：只覆盖 demo 侧 CSS import 与 window 调试入口，不暴露内部实现细节。
 * 协作模块：examples/docx/src/main.ts 与真实浏览器验收脚本。
 * 约束：声明文件无运行时副作用。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---建立-examplesdocx-手动验收入口。
 */
/// <reference types="vite/client" />

import type { Editor } from '@4xian/jword-core'
import type { DocxDemoTaskSnapshot } from './task-session'

declare global {
  interface Window {
    __jwordDocxDemo?: Readonly<{
      readonly editor: Editor
      importSelectedFixture(): Promise<void>
      exportDocx(): Promise<ArrayBuffer>
      exportPdf(): Promise<ArrayBuffer>
      cancelActiveTask(): boolean
      readActiveTask(): DocxDemoTaskSnapshot | null
      readStatus(): string
      readWarningsText(): string
      readRoundtripText(): string
    }>
  }
}

export {}
