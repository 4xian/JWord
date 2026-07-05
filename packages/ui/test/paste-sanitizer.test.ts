/**
 * @vitest-environment jsdom
 *
 * 职责：验证 Gate 4 DOMPurify 粘贴清洗把 Word HTML 转成 core 可消费的安全富文本片段。
 * 边界：只覆盖 HTML 清洗和格式提取，不触发真实 clipboard 事件或 editor 事务。
 * 协作：packages/ui/src/paste/sanitizer.ts 与 @4xian/jword-core 富文本粘贴类型。
 * 约束：不把清洗后的 HTML 回插页面，只读取安全文本和格式子集。
 */

import { describe, expect, test } from 'vitest'

import {
  sanitizePastedHtmlToRichTextFragment,
  sanitizePastedHtmlToRichTextFragmentWithWarnings
} from '../src/paste/sanitizer'

describe('paste sanitizer', () => {
  test('keeps Word-like run and paragraph formats while removing active content', () => {
    const fragment = sanitizePastedHtmlToRichTextFragment(`
      <!--StartFragment-->
      <p class="MsoNormal" style="text-align:center;margin:0">
        <b><i><span style="color:#C00000;background-color:#FFF2CC" onclick="alert(1)">Word</span></i></b>
        <span style="text-decoration:underline;font-size:14pt"> 片段</span>
        <script>alert('xss')</script>
      </p>
      <ul>
        <li><span style="font-family:Calibri">列表</span><img src=x onerror="alert(2)"></li>
      </ul>
      <!--EndFragment-->
    `)

    expect(fragment).toMatchObject({
      paragraphs: [{
        properties: {
          alignment: 'center'
        },
        runs: [{
          text: 'Word',
          properties: {
            bold: true,
            italic: true,
            color: '#c00000',
            backgroundColor: '#fff2cc'
          }
        }, {
          text: ' 片段',
          properties: {
            underline: true,
            fontSizeTwips: 280
          }
        }]
      }, {
        properties: {
          listNumberingId: 'paste-bullet',
          listLevel: 0
        },
        runs: [{
          text: '列表',
          properties: {
            fontFamily: 'Calibri'
          }
        }]
      }]
    })
    expect(JSON.stringify(fragment)).not.toContain('alert')
    expect(JSON.stringify(fragment)).not.toContain('onerror')
  })

  test('returns null for empty html so callers can fall back to plain text', () => {
    expect(sanitizePastedHtmlToRichTextFragment('')).toBeNull()
    expect(sanitizePastedHtmlToRichTextFragment('<script>alert(1)</script>')).toBeNull()
  })

  test('keeps safe links and converts simple tables into paragraphs', () => {
    const result = sanitizePastedHtmlToRichTextFragmentWithWarnings(`
      <p>Before <a href="https://example.com/docs">docs</a> <a href="javascript:alert(1)">bad</a></p>
      <table>
        <tr><th>Head</th><td><b>Value</b></td></tr>
        <tr><td>A</td><td>B</td></tr>
      </table>
    `)

    expect(result.fragment).toMatchObject({
      paragraphs: [{
        runs: [{
          text: 'Before '
        }, {
          text: 'docs'
        }, {
          text: 'bad'
        }]
      }, {
        runs: [{
          text: 'Head\t'
        }, {
          text: 'Value',
          properties: {
            bold: true
          }
        }]
      }, {
        runs: [{
          text: 'A\tB'
        }]
      }]
    })
    expect(result.warnings).toEqual([{
      code: 'PASTE_TABLE_FLATTENED',
      message: '粘贴表格结构暂按制表符文本降级。',
      fallback: 'tab-separated-text',
      recoverable: true
    }])
    expect(JSON.stringify(result.fragment)).not.toContain('javascript:')
  })
})
