/**
 * 职责：挂载 Vue 示例应用并引入示例样式。
 * 边界：只负责浏览器入口，不实现 SDK wrapper 逻辑。
 * 协作：Vue createApp、JWordVueExampleApp 与官方 UI 样式入口。
 * 约束：入口只在浏览器执行，SSR smoke 由 packages/vue 测试覆盖。
 */

import { createApp } from 'vue'

import JWordVueExampleApp from './App.vue'
import '@4xian/jword-ui/styles.css'
import './styles.css'

const root = document.querySelector<HTMLElement>('#app')

if (root === null) {
  throw new Error('Vue example requires #app.')
}

createApp(JWordVueExampleApp).mount(root)
