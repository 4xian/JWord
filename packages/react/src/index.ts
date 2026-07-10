/**
 * 职责：提供 Gate 7 React wrapper 的生命周期、事件桥接和 ref 公开入口。
 * 边界：只消费 @4xian/jword-core 与 @4xian/jword-ui package 入口，不读取内部 src、不保存第二份文档状态。
 * 协作模块：React、core Editor facade、UI 装配入口和 diagnostics export。
 * 性能/安全约束：SSR 阶段不访问 DOM；wrapper 只有显式 import 才进入宿主 bundle。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import * as React from 'react'
import {
  createEditor,
  type Editor,
  type EditorDocumentInput,
  type EditorDocumentModelInput,
  type EditorEvent,
  type EditorOptions,
  type JWordDiagnosticsSnapshot
} from '@4xian/jword-core'
import { createJWordUi, type CreateJWordUiOptions, type JWordUiInstance } from '@4xian/jword-ui'

export type JWordReactTransactionEvent = Extract<EditorEvent, { readonly kind: 'transaction' }>['transaction']
export type JWordReactSelectionChangeEvent = Extract<EditorEvent, { readonly kind: 'selectionChange' }>
export type JWordReactErrorEvent = Extract<EditorEvent, { readonly kind: 'error' }>

/** React wrapper 的公开 props，只描述生命周期、初始文档、事件桥接和 UI 装配选项。 */
export interface JWordReactEditorProps {
  /** 初始化文档；只在首次 mount 时消费，后续变更请通过 React key 显式重建。 */
  readonly initialDocument?: EditorDocumentInput
  /** 非受控初始文档；优先级高于 initialDocument。 */
  readonly defaultValue?: EditorDocumentInput
  /** 受控文档模型；变化时以 document model 级别替换 editor 内容。 */
  readonly value?: EditorDocumentModelInput
  /** 透传给 core createEditor 的配置；initialText/resources 由 wrapper 初始文档负责。 */
  readonly editorOptions?: Omit<EditorOptions, 'initialText' | 'resources'>
  /** 透传给 createJWordUi 的配置；DOM 宿主由 wrapper 管理。 */
  readonly uiOptions?: Omit<CreateJWordUiOptions, 'editor' | 'editorHost' | 'toolbarHost' | 'liveRegionHost' | 'assistiveMirrorHost'>
  /** wrapper 根节点 className。 */
  readonly className?: string
  /** wrapper 根节点 style。 */
  readonly style?: React.CSSProperties
  /** UI 只读模式；不是安全授权边界。 */
  readonly readOnly?: boolean
  /** editor 与 UI 创建完成后触发。 */
  readonly onReady?: (editor: Editor) => void
  /** transaction 事件桥接。 */
  readonly onTransaction?: (event: JWordReactTransactionEvent) => void
  /** selectionChange 事件桥接。 */
  readonly onSelectionChange?: (event: JWordReactSelectionChangeEvent) => void
  /** error 事件桥接。 */
  readonly onError?: (event: JWordReactErrorEvent) => void
  /** error 事件后导出的隐私裁剪 diagnostics 快照。 */
  readonly onDiagnostics?: (snapshot: JWordDiagnosticsSnapshot) => void
}

/** React wrapper 通过 ref 暴露给宿主的最小 editor 操作句柄。 */
export interface JWordReactEditorHandle {
  /** 当前 editor；SSR 或销毁后为 null。 */
  readonly editor: Editor | null
  /** 聚焦 editor 输入层。 */
  focus(): void
  /** 导出隐私裁剪 diagnostics；editor 不存在时返回 null。 */
  exportDiagnostics(): JWordDiagnosticsSnapshot | null
  /** 幂等销毁当前 wrapper 持有的 UI 和 editor。 */
  destroy(): void
}

export interface JWordEditorProviderProps {
  /** provider 向后代暴露的 wrapper handle。 */
  readonly value: JWordReactEditorHandle | null
  /** React 子节点。 */
  readonly children?: React.ReactNode
}

export interface JWordReactErrorBoundaryProps {
  /** React 子节点。 */
  readonly children?: React.ReactNode
  /** 捕获错误后渲染的 fallback。 */
  readonly fallback?: React.ReactNode | ((error: Error) => React.ReactNode)
  /** 捕获错误时通知宿主。 */
  readonly onError?: (error: Error, info: React.ErrorInfo) => void
}

interface JWordReactErrorBoundaryState {
  readonly error: Error | null
}

const JWordEditorContext = React.createContext<JWordReactEditorHandle | null>(null)
const useBrowserLayoutEffect = typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

/** React wrapper 组件，负责创建 core editor、挂载 UI 并桥接事件。 */
export const JWordReactEditor = React.forwardRef<JWordReactEditorHandle, JWordReactEditorProps>(
  function JWordReactEditorComponent(props, forwardedRef) {
    const editorHostRef = React.useRef<HTMLDivElement | null>(null)
    const toolbarHostRef = React.useRef<HTMLDivElement | null>(null)
    const liveRegionHostRef = React.useRef<HTMLDivElement | null>(null)
    const assistiveMirrorHostRef = React.useRef<HTMLDivElement | null>(null)
    const editorRef = React.useRef<Editor | null>(null)
    const uiRef = React.useRef<JWordUiInstance | null>(null)
    const unsubscribeRef = React.useRef<(() => void) | null>(null)
    const callbacksRef = React.useRef(props)

    callbacksRef.current = props

    const destroyRuntime = React.useCallback(() => {
      unsubscribeRef.current?.()
      unsubscribeRef.current = null
      uiRef.current?.destroy()
      uiRef.current = null
      editorRef.current?.destroy()
      editorRef.current = null
    }, [])

    React.useImperativeHandle(forwardedRef, () => ({
      get editor() {
        return editorRef.current
      },
      focus() {
        editorRef.current?.focus()
      },
      exportDiagnostics() {
        return editorRef.current?.exportDiagnostics() ?? null
      },
      destroy() {
        destroyRuntime()
      }
    }), [destroyRuntime])

    useBrowserLayoutEffect(() => {
      const editorHost = editorHostRef.current
      const toolbarHost = toolbarHostRef.current

      if (editorHost === null || toolbarHost === null) {
        return undefined
      }

      const initialDocument = props.defaultValue ?? props.initialDocument
      const editor = createEditor(createEditorOptions(props.editorOptions, initialDocument))

      if (props.value !== undefined) {
        editor.loadDocumentModel(props.value)
      } else if (shouldCreateInitialDocument(initialDocument)) {
        editor.createDocument(initialDocument)
      }

      editor.mount(editorHost)
      const ui = createJWordUi(createUiOptions({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost: liveRegionHostRef.current,
        assistiveMirrorHost: assistiveMirrorHostRef.current,
        props
      }))

      editorRef.current = editor
      uiRef.current = ui
      unsubscribeRef.current = editor.subscribe((event) => {
        dispatchReactEditorEvent(event, editor, callbacksRef.current)
      })
      props.onReady?.(editor)

      return () => {
        destroyRuntime()
      }
    }, [])

    React.useEffect(() => {
      if (props.value !== undefined) {
        editorRef.current?.loadDocumentModel(props.value)
      }
    }, [props.value])

    return React.createElement('div', {
      className: props.className,
      style: props.style,
      'data-jword-react': typeof window === 'undefined' ? 'ssr' : 'client'
    },
    React.createElement('div', { ref: toolbarHostRef, 'data-jword-react-toolbar': 'true' }),
    React.createElement('div', { ref: editorHostRef, 'data-jword-react-editor': 'true' }),
    React.createElement('div', { ref: liveRegionHostRef, 'data-jword-react-live-region': 'true' }),
    React.createElement('div', { ref: assistiveMirrorHostRef, 'data-jword-react-assistive': 'true' }))
  }
)

/** React context provider，只暴露 wrapper handle，不暴露内部 DOM。 */
export function JWordEditorProvider(props: JWordEditorProviderProps): React.ReactElement {
  return React.createElement(JWordEditorContext.Provider, { value: props.value }, props.children)
}

/** 读取当前 React wrapper handle。 */
export function useJWordEditorHandle(): JWordReactEditorHandle | null {
  return React.useContext(JWordEditorContext)
}

/** 读取当前 editor facade；未挂载时返回 null。 */
export function useJWordEditor(): Editor | null {
  return React.useContext(JWordEditorContext)?.editor ?? null
}

/** React 错误边界，只捕获 wrapper 渲染树错误。 */
export class JWordReactErrorBoundary extends React.Component<
  JWordReactErrorBoundaryProps,
  JWordReactErrorBoundaryState
> {
  override state: JWordReactErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): JWordReactErrorBoundaryState {
    return { error }
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    this.props.onError?.(error, info)
  }

  override render(): React.ReactNode {
    if (this.state.error !== null) {
      if (typeof this.props.fallback === 'function') {
        return this.props.fallback(this.state.error)
      }

      return this.props.fallback ?? null
    }

    return this.props.children ?? null
  }
}

/** 创建 core editor options，避免 wrapper 覆盖宿主显式选项以外的字段。 */
function createEditorOptions(
  editorOptions: JWordReactEditorProps['editorOptions'],
  initialDocument: EditorDocumentInput | undefined
): EditorOptions {
  return {
    ...(editorOptions ?? {}),
    ...(initialDocument?.text === undefined ? {} : { initialText: initialDocument.text }),
    ...(initialDocument?.resources === undefined ? {} : { resources: initialDocument.resources })
  }
}

/** 判断是否需要额外 createDocument 以保留 documentId 或 sectionId。 */
function shouldCreateInitialDocument(input: EditorDocumentInput | undefined): input is EditorDocumentInput {
  return input?.documentId !== undefined || input?.sectionId !== undefined
}

/** 创建 UI options，DOM 宿主由 React wrapper 管理。 */
function createUiOptions(input: Readonly<{
  editor: Editor
  editorHost: HTMLElement
  toolbarHost: HTMLElement
  liveRegionHost: HTMLElement | null
  assistiveMirrorHost: HTMLElement | null
  props: JWordReactEditorProps
}>): CreateJWordUiOptions {
  const readonlyMode = input.props.readOnly ?? input.props.uiOptions?.readonly

  return {
    ...(input.props.uiOptions ?? {}),
    editor: input.editor,
    editorHost: input.editorHost,
    toolbarHost: input.toolbarHost,
    ...(input.liveRegionHost === null ? {} : { liveRegionHost: input.liveRegionHost }),
    ...(input.assistiveMirrorHost === null ? {} : { assistiveMirrorHost: input.assistiveMirrorHost }),
    ...(readonlyMode === undefined ? {} : { readonly: readonlyMode })
  }
}

/** 将 editor 事件桥接给 React 宿主。 */
function dispatchReactEditorEvent(
  event: EditorEvent,
  editor: Editor,
  props: JWordReactEditorProps
): void {
  if (event.kind === 'transaction') {
    props.onTransaction?.(event.transaction)
    return
  }

  if (event.kind === 'selectionChange') {
    props.onSelectionChange?.(event)
    return
  }

  if (event.kind === 'error') {
    props.onError?.(event)
    props.onDiagnostics?.(editor.exportDiagnostics())
  }
}
