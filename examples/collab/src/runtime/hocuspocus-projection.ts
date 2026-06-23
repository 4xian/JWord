/**
 * 职责：提供 Hocuspocus demo runtime 读取 projection 文本和位置的纯函数。
 * 边界：只读取只读 projection 或隔离 Y.Doc update，不执行编辑命令、不连接 provider。
 * 协作：hocuspocus-runtime.ts、hocuspocus-text-command.ts 和格式化 debug helper 共享这里的文本定位。
 * 约束：不暴露 Yjs 可写容器；所有返回值都是 demo 可序列化数据或 core TextPosition。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 Step 6.10。
 */
import { createDocumentProjection } from '@4xian/jword-core'
import type { DocumentProjection, Run, TextPosition, TextRange } from '@4xian/jword-core'
import * as Y from 'yjs'

/** 读取首个 paragraph run 的文本位置。 */
export function readFirstTextPosition(
  projection: DocumentProjection,
  graphemeIndex: number
): TextPosition | null {
  let offset = 0
  let paragraphSeen = false

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      if (paragraphSeen) {
        if (graphemeIndex === offset) {
          return readFirstParagraphPosition(section.id, block)
        }
        offset += 1
      }
      paragraphSeen = true
      for (const run of block.runs) {
        const runLength = countDemoGraphemes(readRunText(run))
        const runStart = offset
        const runEnd = runStart + runLength

        if (graphemeIndex >= runStart && graphemeIndex <= runEnd) {
          return {
            sectionId: section.id,
            blockId: block.id,
            runId: run.id,
            graphemeIndex: graphemeIndex - runStart
          }
        }

        offset = runEnd
      }
    }
  }

  return null
}

/** 从 projection 读取 demo 纯文本。 */
export function readProjectionText(projection: DocumentProjection): string {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.map(readRunText).join('')]
      : [])
  ).join('\n')
}

/** 从 projection 读取指定文本范围内的纯文本。 */
export function readProjectionTextRange(
  projection: DocumentProjection,
  range: TextRange
): string {
  const anchorOffset = findProjectionTextOffset(projection, range.anchor)
  const focusOffset = findProjectionTextOffset(projection, range.focus)

  if (anchorOffset === null || focusOffset === null) {
    return ''
  }

  const start = Math.min(anchorOffset, focusOffset)
  const end = Math.max(anchorOffset, focusOffset)

  return Array.from(readProjectionText(projection)).slice(start, end).join('')
}

/** 读取一个 run 的所有 text inline。 */
export function readRunText(run: Run): string {
  return run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join('')
}

/** 统计 demo 文本的 Unicode code point 数，匹配现有 smoke 文本。 */
export function countDemoGraphemes(text: string): number {
  return Array.from(text).length
}

/** 从 Yjs state update 中读取 demo 正文文本。 */
export function readBodyTextFromUpdate(update: Uint8Array): string {
  const restored = new Y.Doc()

  Y.applyUpdate(restored, update)
  return readProjectionText(createDocumentProjection(restored))
}

/** 查找指定文本位置在 demo 全局正文中的 grapheme offset。 */
export function findProjectionTextOffset(
  projection: DocumentProjection,
  position: TextPosition
): number | null {
  let offset = 0
  let paragraphSeen = false

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      if (paragraphSeen) {
        offset += 1
      }
      paragraphSeen = true
      for (const run of block.runs) {
        const length = countDemoGraphemes(readRunText(run))

        if (
          section.id === position.sectionId &&
          block.id === position.blockId &&
          run.id === position.runId
        ) {
          return offset + Math.min(Math.max(position.graphemeIndex, 0), length)
        }

        offset += length
      }
    }
  }

  return null
}

/** 读取段落开头的第一个文本位置，用于段落分隔符 offset 落点。 */
function readFirstParagraphPosition(sectionId: string, block: DocumentProjection['document']['sections'][number]['blocks'][number]): TextPosition | null {
  if (block.kind !== 'paragraph') {
    return null
  }

  const run = block.runs.find((candidate) => candidate.inlines.some((inline) => inline.kind === 'text')) ??
    block.runs[0]

  return run === undefined
    ? null
    : {
        sectionId,
        blockId: block.id,
        runId: run.id,
        graphemeIndex: 0
      }
}
