/**
 * 职责：提供 Gate 7 Vue 3 wrapper 的生命周期、事件桥接和 expose 公开入口。
 * 边界：只消费 @4xian/jword-core 与 @4xian/jword-ui package 入口，不读取内部 src、不保存第二份文档状态。
 * 协作模块：Vue 3、core Editor facade、UI 装配入口和 diagnostics export。
 * 性能/安全约束：SSR 阶段不访问 DOM；wrapper 只有显式 import 才进入宿主 bundle。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  computed,
  defineComponent,
  h,
  inject,
  onBeforeUnmount,
  onMounted,
  provide,
  readonly as readonlyRef,
  ref,
  shallowRef,
  watch,
  type InjectionKey,
  type PropType,
  type Ref
} from 'vue'
import {
  type Editor,
  type EditorDocumentInput,
  type EditorDocumentModelInput,
  type EditorEvent,
  type EditorOptions,
  type JWordDiagnosticsSnapshot
} from '@4xian/jword-core'
import {
  createJWord,
  type JWordEditorShell,
  type JWordEditorShellUiOptions
} from '@4xian/jword-ui'

export type JWordVueTransactionEvent = Extract<EditorEvent, { readonly kind: 'transaction' }>['transaction']
export type JWordVueSelectionChangeEvent = Extract<EditorEvent, { readonly kind: 'selectionChange' }>
export type JWordVueErrorEvent = Extract<EditorEvent, { readonly kind: 'error' }>

/** Vue wrapper 的公开 props，只描述生命周期、初始文档、事件桥接和 UI 装配选项。 */
export interface JWordVueEditorProps {
  /** 初始化文档；只在首次 mount 时消费，后续变更请通过 key 显式重建。 */
  readonly initialDocument?: EditorDocumentInput
  /** 非受控初始文档；优先级高于 initialDocument。 */
  readonly defaultValue?: EditorDocumentInput
  /** 受控文档模型；变化时以 document model 级别替换 editor 内容。 */
  readonly modelValue?: EditorDocumentModelInput
  /** 透传给 core createEditor 的配置；initialText/resources 由 wrapper 初始文档负责。 */
  readonly editorOptions?: Omit<EditorOptions, 'initialText' | 'resources'>
  /** 透传给 EditorShell 的 UI 配置；DOM 宿主由 wrapper 管理。 */
  readonly uiOptions?: JWordEditorShellUiOptions
  /** UI 只读模式；不是安全授权边界。 */
  readonly readonly?: boolean
}

/** Vue wrapper 通过 expose / provide 暴露给宿主的最小 editor 操作句柄。 */
export interface JWordVueEditorHandle {
  /** 当前 editor；SSR 或销毁后为 null。 */
  readonly editor: Editor | null
  /** 聚焦 editor 输入层。 */
  focus(): void
  /** 导出隐私裁剪 diagnostics；editor 不存在时返回 null。 */
  exportDiagnostics(): JWordDiagnosticsSnapshot | null
  /** 幂等销毁当前 wrapper 持有的 UI 和 editor。 */
  destroy(): void
}

interface RuntimeJWordVueEditorProps {
  readonly uiOptions: JWordVueEditorProps['uiOptions'] | undefined
  readonly readonly: boolean | undefined
}

type JWordVueEmit = (
  eventName: 'ready' | 'transaction' | 'selection-change' | 'error' | 'diagnostics-export',
  ...args: unknown[]
) => void

/** Vue provide / inject 使用的公开 editor handle 注入 key。 */
export const JWORD_VUE_EDITOR_KEY: InjectionKey<Readonly<Ref<JWordVueEditorHandle | null>>> = Symbol('JWORD_VUE_EDITOR_KEY')

const emptyHandleRef = readonlyRef(shallowRef<JWordVueEditorHandle | null>(null))

/** Vue wrapper 组件，负责创建 core editor、挂载 UI 并桥接事件。 */
export const JWordVueEditor = defineComponent({
  name: 'JWordVueEditor',
  props: {
    initialDocument: Object as PropType<EditorDocumentInput | undefined>,
    defaultValue: Object as PropType<EditorDocumentInput | undefined>,
    modelValue: Object as PropType<EditorDocumentModelInput | undefined>,
    editorOptions: Object as PropType<JWordVueEditorProps['editorOptions']>,
    uiOptions: Object as PropType<JWordVueEditorProps['uiOptions']>,
    readonly: Boolean as PropType<boolean | undefined>
  },
  emits: [
    'ready',
    'transaction',
    'selection-change',
    'error',
    'diagnostics-export'
  ],
  setup(props, { emit, expose, slots }) {
    const hostRef = ref<HTMLElement | null>(null)
    const shellRef = shallowRef<JWordEditorShell | null>(null)
    const unsubscribeRef = shallowRef<(() => void) | null>(null)

    /** 销毁当前 Vue wrapper 持有的 runtime。 */
    function destroyRuntime(): void {
      unsubscribeRef.value?.()
      unsubscribeRef.value = null
      shellRef.value?.destroy()
      shellRef.value = null
    }

    const handle: JWordVueEditorHandle = {
      get editor() {
        return shellRef.value?.editor ?? null
      },
      focus() {
        shellRef.value?.editor.focus()
      },
      exportDiagnostics() {
        return shellRef.value?.editor.exportDiagnostics() ?? null
      },
      destroy() {
        destroyRuntime()
      }
    }
    const handleRef = shallowRef<JWordVueEditorHandle | null>(handle)

    expose(handle)
    provide(JWORD_VUE_EDITOR_KEY, readonlyRef(handleRef))

    onMounted(() => {
      const host = hostRef.value

      if (host === null) {
        return
      }

      const initialDocument = props.defaultValue ?? props.initialDocument
      const shell = createJWord({
        host,
        editor: createEditorOptions(props.editorOptions, initialDocument),
        ui: createUiOptions(props)
      })
      const { editor } = shell

      if (props.modelValue !== undefined) {
        editor.loadDocumentModel(props.modelValue)
      } else if (shouldCreateInitialDocument(initialDocument)) {
        editor.createDocument(initialDocument)
      }

      shellRef.value = shell
      unsubscribeRef.value = editor.subscribe((event) => {
        dispatchVueEditorEvent(event, editor, emit)
      })
      emit('ready', editor)
    })

    onBeforeUnmount(() => {
      destroyRuntime()
    })

    watch(() => props.modelValue, (value) => {
      if (value !== undefined) {
        shellRef.value?.editor.loadDocumentModel(value)
      }
    })

    return () => h('div', {
      'data-jword-vue': typeof window === 'undefined' ? 'ssr' : 'client'
    }, [
      h('div', { ref: hostRef, 'data-jword-vue-host': 'true' }),
      ...(slots.default?.() ?? [])
    ])
  }
})

/** 读取当前 Vue wrapper handle。 */
export function useJWordEditorHandle(): Readonly<Ref<JWordVueEditorHandle | null>> {
  return inject(JWORD_VUE_EDITOR_KEY, emptyHandleRef)
}

/** 读取当前 editor facade；未挂载时返回 null。 */
export function useJWordEditor(): Readonly<Ref<Editor | null>> {
  const handle = useJWordEditorHandle()

  return computed(() => handle.value?.editor ?? null)
}

/** 创建 core editor options，避免 wrapper 覆盖宿主显式选项以外的字段。 */
function createEditorOptions(
  editorOptions: JWordVueEditorProps['editorOptions'],
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

/** 创建 EditorShell UI options，并让显式 readonly prop 保持原有优先级。 */
function createUiOptions(props: RuntimeJWordVueEditorProps): JWordEditorShellUiOptions {
  const readonlyMode = props.readonly ?? props.uiOptions?.readonly

  return {
    ...(props.uiOptions ?? {}),
    ...(readonlyMode === undefined ? {} : { readonly: readonlyMode })
  }
}

/** 将 editor 事件桥接给 Vue 宿主。 */
function dispatchVueEditorEvent(
  event: EditorEvent,
  editor: Editor,
  emit: JWordVueEmit
): void {
  if (event.kind === 'transaction') {
    emit('transaction', event.transaction)
    return
  }

  if (event.kind === 'selectionChange') {
    emit('selection-change', event)
    return
  }

  if (event.kind === 'error') {
    emit('error', event)
    emit('diagnostics-export', editor.exportDiagnostics())
  }
}
