/**
 * 职责：提供 Gate 7 React wrapper 的第三方式 TSX 示例组件。
 * 边界：只从 @4xian/jword-react 和 @4xian/jword-native package 入口消费，不访问 monorepo 内部路径。
 * 协作：React wrapper、native .jword 保存、core editor ref 和 diagnostics export。
 * 约束：示例不保存第二份文档状态，输入与保存能力通过 editor facade 暴露。
 */

import { useCallback, useRef, useState, type ReactElement } from 'react'
import { saveJWordDocument } from '@4xian/jword-native'
import { JWordReactEditor, type JWordReactEditorHandle } from '@4xian/jword-react'

export function JWordReactExampleApp(): ReactElement {
  const editorRef = useRef<JWordReactEditorHandle | null>(null)
  const [diagnosticCount, setDiagnosticCount] = useState(0)
  const [documentStatus, setDocumentStatus] = useState('初始文档')
  const [saveStatus, setSaveStatus] = useState('未保存')
  const [destroyStatus, setDestroyStatus] = useState('运行中')

  /** 将示例文本写入 editor facade，避免 React state 成为文档真源。 */
  const writeExampleDocument = useCallback(() => {
    const editor = editorRef.current?.editor

    if (editor === null || editor === undefined) {
      setDocumentStatus('editor 未挂载')
      return
    }

    editor.createDocument({ text: 'React wrapper edited document' })
    setDocumentStatus('已写入示例文本')
  }, [])

  /** 通过 native package 入口保存当前 editor 为 .jword。 */
  const saveCurrentDocument = useCallback(async () => {
    const editor = editorRef.current?.editor

    if (editor === null || editor === undefined) {
      setSaveStatus('editor 未挂载')
      return
    }

    const saved = await saveJWordDocument(editor, {
      requestId: 'react-example-save'
    })

    setSaveStatus(`已保存 ${readSavedByteLength(saved)} bytes`)
  }, [])

  /** 幂等销毁 wrapper 持有的 UI 和 editor。 */
  const destroyEditor = useCallback(() => {
    editorRef.current?.destroy()
    setDestroyStatus('已销毁')
  }, [])

  /** 从 wrapper handle 导出隐私裁剪后的 diagnostics 计数。 */
  const exportDiagnostics = useCallback(() => {
    const snapshot = editorRef.current?.exportDiagnostics()

    setDiagnosticCount(snapshot?.plugins.length ?? 0)
  }, [])

  return (
    <main className="jword-react-example" data-jword-react-example="true">
      <h1>JWord React Example</h1>
      <section className="jword-react-example__controls" aria-label="React 示例操作">
        <button type="button" data-jword-react-input="true" onClick={writeExampleDocument}>
          写入示例文本
        </button>
        <output data-jword-react-document="true">{documentStatus}</output>
        <button
          type="button"
          data-jword-react-save="true"
          onClick={() => {
            void saveCurrentDocument()
          }}
        >
          保存 .jword
        </button>
        <output data-jword-react-save-status="true">{saveStatus}</output>
        <button type="button" onClick={exportDiagnostics}>
          导出 diagnostics
        </button>
        <output data-jword-react-diagnostics="true">{diagnosticCount}</output>
        <button type="button" data-jword-react-destroy="true" onClick={destroyEditor}>
          销毁 editor
        </button>
        <output data-jword-react-destroy-status="true">{destroyStatus}</output>
      </section>
      <JWordReactEditor
        ref={editorRef}
        className="jword-react-example__editor"
        defaultValue={{ text: 'React wrapper initial document' }}
        onDiagnostics={(snapshot) => {
          setDiagnosticCount(snapshot.plugins.length)
        }}
      />
    </main>
  )
}

/** 读取 native 保存结果的字节数，兼容当前 demo ambient type 与正式 package result。 */
function readSavedByteLength(
  result: Blob | ArrayBuffer | Uint8Array | Readonly<{
    blob?: Blob
    bytes?: ArrayBuffer | Uint8Array
  }>
): number {
  if (result instanceof Blob) {
    return result.size
  }

  if (result instanceof ArrayBuffer || result instanceof Uint8Array) {
    return result.byteLength
  }

  return result.blob?.size ?? result.bytes?.byteLength ?? 0
}
