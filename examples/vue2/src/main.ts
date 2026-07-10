/**
 * 职责：挂载 Vue 2 示例应用并引入示例样式。
 * 边界：只负责浏览器入口，不实现 SDK wrapper 逻辑。
 * 协作：Vue 2 full build、JWordVue2ExampleApp 与官方 UI 样式入口。
 * 约束：入口只在浏览器执行，Vue 2 集成逻辑在 App.vue 的 Options API 中维护。
 */

import Vue from 'vue/dist/vue.esm.js'

import JWordVue2ExampleApp from './App.vue'
import '@4xian/jword-ui/styles.css'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')

if (root === null) {
  throw new Error('Vue 2 example requires #app.')
}

new Vue({
  components: {
    JWordVue2ExampleApp
  },
  template: '<JWordVue2ExampleApp />'
}).$mount(root)
