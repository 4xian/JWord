/**
 * @vitest-environment node
 *
 * 职责：提供 PDF public API 文本样式测试复用的 layout fixture 与内容流断言 helper。
 * 边界：只构造测试输入和读取 PDF 内容流，不调用导出入口、不承载业务断言。
 * 协作模块：packages/pdf/test/public-api.test.ts 复用这些 helper 覆盖 P-1 文本样式导出。
 * 约束：测试 helper 不放入 src，不访问网络，不依赖真实浏览器。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import {
  createFontManager,
  createPageConfig,
  layoutDocument,
  type DocumentLayout
} from '@4xian/jword-core'
import { inflateSync } from 'node:zlib'

export type StyledTextRunInput = Readonly<{
  id: string
  text: string
  properties?: Readonly<{
    bold?: boolean
    italic?: boolean
    underline?: boolean
    strike?: boolean
    superscript?: boolean
    subscript?: boolean
    color?: string
    backgroundColor?: string
    fontFamily?: string
    fontSizeTwips?: number
  }>
}>

/** 创建多样式文本 layout，用于验证 PDF renderer 是否消费完整 run style。 */
export function createStyledTextLayout(runs: readonly StyledTextRunInput[]): DocumentLayout {
  return layoutDocument({
    projection: {
      document: {
        kind: 'document',
        id: 'document-pdf-styled-text',
        sections: [
          {
            kind: 'section',
            id: 'section-pdf-styled-text',
            blocks: [
              {
                kind: 'paragraph',
                id: 'paragraph-pdf-styled-text',
                runs: runs.map((run) => ({
                  kind: 'run',
                  id: `run-pdf-styled-${run.id}`,
                  ...(run.properties === undefined ? {} : { properties: run.properties }),
                  inlines: [
                    {
                      kind: 'text',
                      text: run.text
                    }
                  ]
                }))
              }
            ]
          }
        ]
      }
    },
    pageConfig: createPageConfig({
      widthTwips: 7200,
      heightTwips: 10080,
      marginTwips: {
        top: 720,
        right: 720,
        bottom: 720,
        left: 720
      }
    }),
    fontManager: createFontManager({
      fallbackFontFamily: 'Arial',
      availableFontFamilies: ['Arial']
    })
  })
}

/** 判断内容流中是否包含 PDF stroke 操作。 */
export function hasPdfStrokeOperation(stream: string): boolean {
  return /(?:^|\s)S(?:\s|$)/u.test(stream)
}

/** 统计 PDF 内容流中的 stroke 操作数量。 */
export function countPdfStrokeOperations(stream: string): number {
  return [...stream.matchAll(/(?:^|\s)S(?:\s|$)/gu)].length
}

/** 读取指定文本绘制时最近一次设置的字体资源名。 */
export function readFontResourceForText(streams: readonly string[], text: string): string {
  const streamPrefix = readStreamPrefixForText(streams, text)
  const fontMatches = [...streamPrefix.matchAll(/\/(?<font>\S+)\s+[-0-9.]+\s+Tf/gu)]
  const lastFont = fontMatches.at(-1)?.groups?.font

  if (lastFont !== undefined) {
    return lastFont
  }

  throw new Error(`missing font resource for ${text}`)
}

/** 读取包含指定文本绘制指令的内容流。 */
export function readStreamForText(streams: readonly string[], text: string): string {
  const hex = Buffer.from(text, 'utf8').toString('hex').toUpperCase()
  const stream = streams.find((entry) => entry.includes(`<${hex}> Tj`))

  if (stream === undefined) {
    throw new Error(`missing stream for ${text}`)
  }

  return stream
}

/** 读取指定文本绘制前设置的 PDF 字号。 */
export function readFontSizeForText(streams: readonly string[], text: string): number {
  const streamPrefix = readStreamPrefixForText(streams, text)
  const fontMatches = [...streamPrefix.matchAll(/\/\S+\s+(?<size>[-0-9.]+)\s+Tf/gu)]
  const size = fontMatches.at(-1)?.groups?.size

  if (size === undefined) {
    throw new Error(`missing font size for ${text}`)
  }

  return Number.parseFloat(size)
}

/** 读取指定文本绘制前设置的文本矩阵 y 坐标。 */
export function readTextMatrixYForText(streams: readonly string[], text: string): number {
  const streamPrefix = readStreamPrefixForText(streams, text)
  const matrixMatches = [...streamPrefix.matchAll(/1 0 0 1 [-0-9.]+ (?<y>[-0-9.]+) Tm/gu)]
  const y = matrixMatches.at(-1)?.groups?.y

  if (y === undefined) {
    throw new Error(`missing text matrix for ${text}`)
  }

  return Number.parseFloat(y)
}

/** 解压 pdf-lib 生成的 Flate 内容流，供基础文本输出测试复查绘制操作。 */
export function readInflatedPdfStreams(bytes: ArrayBuffer): readonly string[] {
  const buffer = Buffer.from(bytes)
  const text = buffer.toString('latin1')
  const streams: string[] = []
  let index = 0

  while ((index = text.indexOf('stream', index)) !== -1) {
    let start = index + 'stream'.length
    if (text[start] === '\r' && text[start + 1] === '\n') {
      start += 2
    } else if (text[start] === '\n') {
      start += 1
    }

    const end = text.indexOf('endstream', start)
    if (end === -1) {
      break
    }

    try {
      streams.push(inflateSync(buffer.subarray(start, end)).toString('latin1'))
    } catch {
      streams.push(buffer.subarray(start, end).toString('latin1'))
    }

    index = end + 'endstream'.length
  }

  return streams
}

/** 读取指定文本绘制指令之前的内容流片段。 */
function readStreamPrefixForText(streams: readonly string[], text: string): string {
  const hex = Buffer.from(text, 'utf8').toString('hex').toUpperCase()
  const stream = readStreamForText(streams, text)
  const textIndex = stream.indexOf(`<${hex}> Tj`)

  return stream.slice(0, textIndex)
}
