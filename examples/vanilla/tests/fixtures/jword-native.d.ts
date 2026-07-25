/**
 * 职责：声明 vanilla demo 依赖的 `@4xian/jword-native` 公开 API 契约。
 * 边界：只覆盖第三方宿主调用所需的最小类型，不声明 native 包内部模块。
 * 协作模块：examples/vanilla/tests/fixtures/test-native.ts、@4xian/jword-core 公开 Editor 与 Document 类型。
 * 性能/安全约束：仅提供类型信息，没有运行时副作用或首屏静态依赖。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
declare module '@4xian/jword-native' {
  export interface JWordNativeProgressEvent {
    readonly stage?: string
    readonly message?: string
    readonly loaded?: number
    readonly total?: number
  }

  export interface JWordNativeWarning {
    readonly code?: string
    readonly message?: string
    readonly path?: string
  }

  export interface JWordNativeTaskOptions {
    readonly requestId: string
    readonly signal?: AbortSignal
    readonly onProgress?: (event: JWordNativeProgressEvent) => void
    readonly onWarning?: (warning: JWordNativeWarning) => void
  }

  export interface JWordNativeSaveResult {
    readonly blob?: Blob
    readonly bytes?: ArrayBuffer | Uint8Array
    readonly warnings?: readonly JWordNativeWarning[]
  }

  export interface JWordNativeLoadResult {
    readonly document: import('@4xian/jword-core').Document
    readonly warnings?: readonly JWordNativeWarning[]
    readonly migration?: unknown
  }

  export function saveJWordDocument(
    editorOrModel: import('@4xian/jword-core').Editor,
    options?: JWordNativeTaskOptions
  ): Promise<JWordNativeSaveResult | Blob | ArrayBuffer | Uint8Array>

  export function loadJWordDocument(
    input: Blob | ArrayBuffer | Uint8Array,
    options?: JWordNativeTaskOptions
  ): Promise<JWordNativeLoadResult>

  export function validateJWordPackage(
    input: Blob | ArrayBuffer | Uint8Array,
    options?: JWordNativeTaskOptions
  ): Promise<unknown>
}
