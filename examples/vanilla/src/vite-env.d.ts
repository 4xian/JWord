/**
 * 职责：声明 Gate 0 vanilla demo 使用的 Vite 资源模块。
 * 边界：只覆盖 demo 侧 CSS import，不暴露编辑器运行时 API。
 * 协作模块：examples/vanilla/src/main.ts 与 Vite client 类型。
 * 性能/安全约束：只提供类型声明，没有运行时副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
/// <reference types="vite/client" />

import type { Editor, JWordDiagnosticsSnapshot, RevisionMetadata, SelectionState } from '@4xian/jword-core'

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

export interface JWordDemoTableSnapshot {
  readonly tableId: string
  readonly rowCount: number
  readonly columnCount: number
  readonly firstRowCellCount: number
  readonly firstCellGridSpan: number
  readonly firstCellText: string
  readonly firstCellBorderColor: string | null
  readonly firstCellBorderWidthTwips: number | null
}

export interface JWordDemoRevisionInput {
  readonly authorId: string
  readonly createdAt: string
  readonly type: RevisionMetadata['type']
  readonly summary: string
}

export interface JWordDemoNativeWarning {
  readonly code?: string
  readonly message?: string
  readonly path?: string
}

declare global {
  interface Window {
    __jwordDemo?: Readonly<{
      readonly readonly: boolean
      readonly destroy: () => void
      readonly editor: Editor
      readonly selectTextRange?: (input: JWordDemoSelectionInput) => SelectionState
      readonly selectImageByResourceId: (resourceId: string) => void
      readonly media: {
        getFixtureUrl(): string
        buildScenarioUrl(scenario: 'success' | 'retry-once' | 'always-fail'): string
        readUploadLog(): readonly JWordDemoMediaUploadLogEntry[]
      }
      readonly table: {
        readSnapshot(): JWordDemoTableSnapshot | null
        readActiveTarget(): {
          tableId: string
          sectionId: string
          rowIndex: number
          columnIndex: number
          cellIndex: number
          rowCount: number
          columnCount: number
          rowCellCount: number
          cellId: string
          blockId: string
          runId: string
          cellGridSpan: number
        } | null
        selectCell(rowIndex: number, columnIndex: number): boolean
        setCellText(rowIndex: number, columnIndex: number, text: string): boolean
      }
      readonly comments: {
        readThreadCount(): number
      }
      readonly native?: {
        save(): Promise<Blob | null>
        openSelectedFile(): Promise<boolean>
        readStatus(): string
        readWarnings(): readonly JWordDemoNativeWarning[]
        readLastSavedByteLength(): number | null
        readRuntimeLoaded(): boolean
      }
      readonly devtools: {
        isAttached(): boolean
        refresh(): JWordDiagnosticsSnapshot
      }
      readonly link: {
        seedFirstRunLink(target: string): boolean
        readActiveLink(): {
          readonly target: string
          readonly tooltip?: string
        } | null
      }
      readonly revisions: {
        addRevision(input: JWordDemoRevisionInput): boolean
        readRevisionCount(): number
        readSelectionOffsets(): readonly [number, number] | null
      }
    }>
  }
}
