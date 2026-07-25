<!--
  职责：提供 Vue 2 Options API 集成 JWord core/ui/native 的示例组件。
  边界：不使用 Vue 3 wrapper，不访问 monorepo 内部源码路径，只从 package 入口消费 SDK。
  协作：Vue 2 SFC template、core Editor、官方 UI、native .jword 保存和 diagnostics export。
  约束：editor 是唯一文档真源，Vue data 只保存按钮状态和演示文案。
-->

<template>
  <main class="jword-vue2-example" data-jword-vue2-example="true">
    <h1>JWord Vue 2 Example</h1>
    <section class="jword-vue2-example__controls" aria-label="Vue 2 示例操作">
      <button type="button" data-jword-vue2-input="true" @click="writeExampleDocument">
        写入示例文本
      </button>
      <output data-jword-vue2-document="true">{{ documentStatus }}</output>
      <button type="button" data-jword-vue2-save="true" @click="saveCurrentDocument">
        保存 .jword
      </button>
      <output data-jword-vue2-save-status="true">{{ saveStatus }}</output>
      <button type="button" @click="exportDiagnostics">
        导出 diagnostics
      </button>
      <output data-jword-vue2-diagnostics="true">{{ diagnosticCount }}</output>
      <button type="button" data-jword-vue2-destroy="true" @click="destroyEditor">
        销毁 editor
      </button>
      <output data-jword-vue2-destroy-status="true">{{ destroyStatus }}</output>
    </section>
    <section class="jword-vue2-example__editor-shell" aria-label="JWord editor">
      <div ref="toolbarHost" data-jword-vue2-toolbar="true"></div>
      <div ref="editorHost" data-jword-vue2-editor="true"></div>
      <div ref="liveRegionHost" data-jword-vue2-live-region="true"></div>
      <div ref="assistiveMirrorHost" data-jword-vue2-assistive="true"></div>
    </section>
  </main>
</template>

<script lang="ts">
import Vue from 'vue'
import { createEditor, type Editor } from '@4xian/jword-core'
import { createJWordUi, type JWordUiInstance } from '@4xian/jword-ui'
import { saveJWordDocument } from '@4xian/jword-native'

interface JWordVue2ExampleState {
  diagnosticCount: number
  documentStatus: string
  saveStatus: string
  destroyStatus: string
}

interface JWordVue2Runtime {
  editor: Editor | null
  ui: JWordUiInstance | null
}

const runtime: JWordVue2Runtime = {
  editor: null,
  ui: null
}

export default Vue.extend({
  name: 'JWordVue2ExampleApp',
  data(): JWordVue2ExampleState {
    return {
      diagnosticCount: 0,
      documentStatus: '初始文档',
      saveStatus: '未保存',
      destroyStatus: '运行中'
    }
  },
  mounted() {
    this.mountEditor()
  },
  beforeDestroy() {
    this.destroyRuntime()
  },
  methods: {
    /** 创建 core editor 并把官方 UI 挂载到 Vue 2 模板 refs。 */
    mountEditor(): void {
      const editorHost = readElementRef(this, 'editorHost')
      const toolbarHost = readElementRef(this, 'toolbarHost')
      const liveRegionHost = readElementRef(this, 'liveRegionHost')
      const assistiveMirrorHost = readElementRef(this, 'assistiveMirrorHost')
      const editor = createEditor({ initialText: 'Vue 2 integration initial document' })

      editor.mount(editorHost)
      runtime.ui = createJWordUi({
        editor,
        editorHost,
        toolbarHost,
        liveRegionHost,
        assistiveMirrorHost
      })
      runtime.editor = editor
    },

    /** 将示例文本写入 editor facade，避免 Vue data 成为文档真源。 */
    writeExampleDocument(): void {
      const editor = runtime.editor

      if (editor === null) {
        this.documentStatus = 'editor 未挂载'
        return
      }

      editor.createDocument({ text: 'Vue 2 integration edited document' })
      this.documentStatus = '已写入示例文本'
    },

    /** 通过 native package 入口保存当前 editor 为 .jword。 */
    async saveCurrentDocument(): Promise<void> {
      const editor = runtime.editor

      if (editor === null) {
        this.saveStatus = 'editor 未挂载'
        return
      }

      const saved = await saveJWordDocument(editor, {
        requestId: 'vue2-example-save'
      })

      this.saveStatus = `已保存 ${readSavedByteLength(saved)} bytes`
    },

    /** 从 editor facade 导出隐私裁剪后的 diagnostics 计数。 */
    exportDiagnostics(): void {
      this.diagnosticCount = runtime.editor?.exportDiagnostics().plugins.length ?? 0
    },

    /** 按按钮语义销毁当前 Vue 2 示例持有的 UI 和 editor。 */
    destroyEditor(): void {
      this.destroyRuntime()
      this.destroyStatus = '已销毁'
    },

    /** 幂等销毁当前 Vue 2 示例持有的 UI 和 editor。 */
    destroyRuntime(): void {
      runtime.ui?.destroy()
      runtime.ui = null
      runtime.editor?.destroy()
      runtime.editor = null
    }
  }
})

/** 读取 Vue 2 模板 ref 并收窄为 HTMLElement。 */
function readElementRef(vm: Vue, name: string): HTMLElement {
  const value = vm.$refs[name]
  const element = Array.isArray(value) ? value[0] : value

  if (element instanceof HTMLElement) {
    return element
  }

  throw new Error(`Vue 2 example missing ${name}.`)
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
