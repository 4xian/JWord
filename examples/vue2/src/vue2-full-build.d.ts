/**
 * 职责：为 Vue 2 full build 与 SFC 导入提供示例级最小类型声明。
 * 边界：只覆盖 examples/vue2 挂载入口使用到的 components、template 和 $mount。
 * 协作：vue/dist/vue.esm.js 运行时、App.vue 和 Vue 2 Options API 示例入口。
 * 约束：不把该声明暴露为 SDK 类型，也不替代正式 Vue 2 类型系统。
 */

declare module '*.vue' {
  const vue2Component: object
  export default vue2Component
}

declare module 'vue/dist/vue.esm.js' {
  interface Vue2ComponentOptions {
    components?: Record<string, object>
    template?: string
  }

  interface Vue2RootInstance {
    $mount(element: Element): void
  }

  interface Vue2Constructor {
    new(options: Vue2ComponentOptions): Vue2RootInstance
  }

  const Vue: Vue2Constructor
  export default Vue
}
