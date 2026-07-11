/**
 * 职责：展示 JWord 单 Host EditorShell 的最小 vanilla 集成。
 * 边界：只使用 createJWord() 公开入口，不装配测试桥接、场景控件或高级能力。
 * 协作模块：@4xian/jword-ui 与页面中的专用空根元素 #jword。
 * 性能/安全约束：页面卸载时统一销毁 EditorShell 持有的资源。
 * 实现说明：默认示例保持最小集成，复杂验收场景由独立测试夹具承载。
 */
import { createJWord } from '@4xian/jword-ui'

import '@4xian/jword-ui/styles.css'
import './styles.css'

const host = document.querySelector<HTMLElement>('#jword')

if (host === null) {
  throw new Error('JWord vanilla example requires #jword.')
}

const jword = createJWord({ host })

window.addEventListener('beforeunload', destroyJWordExample, { once: true })

/** 页面卸载时统一销毁 EditorShell。 */
function destroyJWordExample(): void {
  jword.destroy()
}
