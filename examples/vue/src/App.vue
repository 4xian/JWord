<!--
  职责：提供 Gate 7 Vue 3 wrapper 的第三方式 SFC 示例组件。
  边界：只从 @4xian/jword-vue 和 @4xian/jword-native package 入口消费，不访问 monorepo 内部路径。
  协作：Vue wrapper、native .jword 保存、core editor ref 和 diagnostics export。
  约束：示例不保存第二份文档状态，输入与保存能力通过 editor facade 暴露。
-->

<template>
  <main class="jword-vue-example" data-jword-vue-example="true">
    <h1>JWord Vue Example</h1>
    <section class="jword-vue-example__controls" aria-label="Vue 示例操作">
      <button type="button" data-jword-vue-input="true" @click="writeExampleDocument">
        写入示例文本
      </button>
      <output data-jword-vue-document="true">{{ documentStatus }}</output>
      <button type="button" data-jword-vue-save="true" @click="saveCurrentDocument">
        保存 .jword
      </button>
      <output data-jword-vue-save-status="true">{{ saveStatus }}</output>
      <button type="button" @click="exportDiagnostics">
        导出 diagnostics
      </button>
      <output data-jword-vue-diagnostics="true">{{ diagnosticCount }}</output>
      <button type="button" data-jword-vue-destroy="true" @click="destroyEditor">
        销毁 editor
      </button>
      <output data-jword-vue-destroy-status="true">{{ destroyStatus }}</output>
    </section>
    <JWordVueEditor
      ref="editorRef"
      class="jword-vue-example__editor"
      :default-value="initialDocument"
      @diagnostics-export="handleDiagnosticsExport"
    />
  </main>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { saveJWordDocument } from '@4xian/jword-native'
import { JWordVueEditor, type JWordVueEditorHandle } from '@4xian/jword-vue'

const editorRef = ref<JWordVueEditorHandle | null>(null)
const diagnosticCount = ref(0)
const documentStatus = ref('初始文档')
const saveStatus = ref('未保存')
const destroyStatus = ref('运行中')
const initialDocument = { text: 'Vue wrapper initial document' }

/** 将示例文本写入 editor facade，避免 Vue ref 成为文档真源。 */
function writeExampleDocument(): void {
  const editor = editorRef.value?.editor

  if (editor === null || editor === undefined) {
    documentStatus.value = 'editor 未挂载'
    return
  }

  editor.createDocument({ text: 'Vue wrapper edited document' })
  documentStatus.value = '已写入示例文本'
}

/** 通过 native package 入口保存当前 editor 为 .jword。 */
async function saveCurrentDocument(): Promise<void> {
  const editor = editorRef.value?.editor

  if (editor === null || editor === undefined) {
    saveStatus.value = 'editor 未挂载'
    return
  }

  const saved = await saveJWordDocument(editor, {
    requestId: 'vue-example-save'
  })

  saveStatus.value = `已保存 ${readSavedByteLength(saved)} bytes`
}

/** 幂等销毁 wrapper 持有的 UI 和 editor。 */
function destroyEditor(): void {
  editorRef.value?.destroy()
  destroyStatus.value = '已销毁'
}

/** 从 wrapper handle 导出隐私裁剪后的 diagnostics 计数。 */
function exportDiagnostics(): void {
  const snapshot = editorRef.value?.exportDiagnostics()

  diagnosticCount.value = snapshot?.plugins.length ?? 0
}

/** 接收 wrapper error 事件后附带导出的 diagnostics 快照。 */
function handleDiagnosticsExport(snapshot: Readonly<{ plugins: readonly unknown[] }>): void {
  diagnosticCount.value = snapshot.plugins.length
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
</script>
