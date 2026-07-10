/**
 * @vitest-environment node
 *
 * 职责：验证 React wrapper SSR 阶段只渲染空壳，不访问 DOM 或创建 editor。
 * 边界：只使用 react-dom/server 渲染字符串，不执行浏览器 mount。
 * 协作：@4xian/jword-react、React server renderer。
 * 约束：SSR 输出不能依赖 window/document/HTMLElement。
 */

import * as React from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { JWordReactEditor } from '../src/index'

describe('JWordReactEditor SSR', () => {
  it('在 Node SSR 环境输出空壳且不创建 editor', () => {
    const html = renderToString(React.createElement(JWordReactEditor, {
      defaultValue: { text: 'SSR text' }
    }))

    expect(html).toContain('data-jword-react="ssr"')
    expect(html).toContain('data-jword-react-editor="true"')
  })
})
