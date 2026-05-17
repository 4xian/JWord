/**
 * 职责：声明 Gate 0 vanilla demo 使用的 Vite 资源模块。
 * 边界：只覆盖 demo 侧 CSS import，不暴露编辑器运行时 API。
 * 协作模块：examples/vanilla/src/main.ts 与 Vite client 类型。
 * 性能/安全约束：只提供类型声明，没有运行时副作用。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/04-engineering-standards.md。
 */
/// <reference types="vite/client" />

import type { Editor, SelectionState } from '@4xian/jword-core'

export interface JWordDemoSelectionInput {
  readonly sectionId: string
  readonly blockId: string
  readonly runId: string
  readonly anchorGraphemeIndex: number
  readonly focusGraphemeIndex: number
}

export interface JWordDemoMediaUploadLogEntry {
  readonly resourceId: string
  readonly sourceKind: 'file' | 'url'
  readonly sourceLabel: string
  readonly outcome: 'success' | 'failed'
  readonly retryToken?: string
}

declare global {
  interface Window {
    __jwordDemo?: Readonly<{
      readonly editor: Editor
      readonly selectTextRange: (input: JWordDemoSelectionInput) => SelectionState
      readonly media: {
        getFixtureUrl(): string
        buildScenarioUrl(scenario: 'success' | 'retry-once' | 'always-fail'): string
        readUploadLog(): readonly JWordDemoMediaUploadLogEntry[]
      }
    }>
  }
}
