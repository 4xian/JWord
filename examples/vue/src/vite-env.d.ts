/**
 * 职责：补充 Vue SFC 和 Vite 客户端的示例工程类型声明。
 * 边界：只服务 examples/vue 的 TypeScript 编译，不改变 @4xian/jword-vue 公开类型。
 * 协作：Vite 客户端类型、Vue 组件类型和 App.vue 导入。
 * 约束：SFC 模板由 Vite Vue 插件编译，tsc 只校验入口脚本与模块边界。
 */

/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'

  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
