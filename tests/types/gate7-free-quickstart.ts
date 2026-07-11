/**
 * 职责：提供 Gate 7 Step 7.4 免费基础版 quickstart 的可编译类型示例。
 * 边界：只覆盖 core、ui、native 三个免费基础包入口，不运行 SDK、不导入付费包或内部源码。
 * 协作模块：docs/sdk/quickstart.md、public API 清单和类型测试共同验证免费基础版外部接入路径。
 * 约束：本文件只能使用 package 名称导入；示例必须覆盖初始化、基础编辑、保存、打开、继续编辑和基础错误处理。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  JWordError,
  type Editor
} from '@4xian/jword-core'
import {
  createJWord,
  type JWordEditorShell
} from '@4xian/jword-ui'
import {
  JWordNativePackageError,
  loadJWordDocument,
  saveJWordDocument,
  type LoadJWordDocumentResult,
  type SaveJWordDocumentResult
} from '@4xian/jword-native'

declare const host: HTMLElement
declare const packageBlob: Blob

/** 通过单个根 Host 初始化 EditorShell 并写入第一段文本。 */
export function createFreeBaseEditor(): JWordEditorShell {
  const jword = createJWord({
    host,
    editor: {
      initialText: '第一段内容'
    }
  })

  jword.editor.createDocument({
    text: '可以继续编辑的正文'
  })

  return jword
}

/** 保存当前 `.jword` 文档。 */
export function saveCurrentDocument(editor: Editor): Promise<SaveJWordDocumentResult> {
  return saveJWordDocument(editor, {
    requestId: 'quickstart-save-1'
  })
}

/** 打开 `.jword` 文档并把内容加载回 editor，以便继续编辑。 */
export async function continueEditingAfterOpen(editor: Editor): Promise<LoadJWordDocumentResult> {
  const opened = await loadJWordDocument(packageBlob, {
    requestId: 'quickstart-load-1'
  })

  editor.loadDocumentModel({
    document: opened.document
  })
  editor.createDocument({
    text: '重新打开后继续编辑'
  })

  return opened
}

/** 处理 quickstart 中需要展示给宿主的基础错误。 */
export function handleBasicError(error: unknown): string {
  if (error instanceof JWordNativePackageError) {
    return `${error.code}:${error.recoverable ? 'recoverable' : 'fatal'}`
  }
  if (error instanceof JWordError) {
    return `${error.code}:${error.message}`
  }
  if (error instanceof Error) {
    return error.message
  }

  return 'unknown-error'
}
