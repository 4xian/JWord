/**
 * @vitest-environment node
 *
 * 职责：验证 Vue wrapper SSR 阶段只渲染空壳，不访问 DOM 或创建 editor。
 * 边界：只使用 @vue/server-renderer 渲染字符串，不执行浏览器 mount。
 * 协作：@4xian/jword-vue、Vue server renderer。
 * 约束：SSR 输出不能依赖 window/document/HTMLElement。
 */

import { h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { describe, expect, it } from 'vitest'

import { JWordVueEditor } from '../src/index'

describe('JWordVueEditor SSR', () => {
  it('在 Node SSR 环境输出空壳且不创建 editor', async () => {
    const html = await renderToString(h(JWordVueEditor, {
      defaultValue: { text: 'SSR text' }
    }))

    expect(html).toContain('data-jword-vue="ssr"')
    expect(html).toContain('data-jword-vue-host="true"')
    expect(html).not.toContain('data-jword-vue-toolbar')
    expect(html).not.toContain('data-jword-vue-editor')
  })
})
