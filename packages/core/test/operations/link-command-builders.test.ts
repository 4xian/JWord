/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 link policy 与 link command builder 的最小 core 闭环。
 * 边界：只覆盖协议 allowlist、插入、编辑与删除，不测试 UI dialog 或宿主打开行为。
 * 协作模块：link policy、command builder、projection 与 transaction pipeline 共同提供 link 纵线。
 * 性能/安全约束：测试只依赖内存文档，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import { createEditor } from '../../src/editor/runtime'
import { isAllowedLinkUrl } from '../../src/link/policy'
import { createSelectionState } from '../../src/model/selection'
import {
  buildDeleteLinkCommand,
  buildEditLinkCommand,
  buildInsertLinkCommand,
  buildSetLinkCommand
} from '../../src/operations/link-command-builders'

describe('link command builders', () => {
  it('allows only http https and mailto', () => {
    expect(isAllowedLinkUrl('http://example.com')).toBe(true)
    expect(isAllowedLinkUrl('https://example.com')).toBe(true)
    expect(isAllowedLinkUrl('mailto:test@example.com')).toBe(true)
    expect(isAllowedLinkUrl('javascript:alert(1)')).toBe(false)
    expect(isAllowedLinkUrl('data:text/plain,hello')).toBe(false)
    expect(isAllowedLinkUrl('file:///tmp/demo.txt')).toBe(false)
    expect(isAllowedLinkUrl('not-a-url')).toBe(false)
  })

  it('applies link metadata to selected text, supports editing, and removes it from projection', () => {
    const editor = createEditor({ initialText: 'hello' })
    const initialSelection = createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 1
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: 'run-1',
        graphemeIndex: 4
      })
    )
    const setCommand = buildSetLinkCommand(editor.getProjection(), initialSelection, {
      target: 'https://example.com',
      tooltip: '示例链接'
    })

    expect(setCommand).not.toBeNull()

    const setResult = editor.executeCommand(setCommand!)
    const linkedRunId = readLinkedRunId(setResult.projection, 'https://example.com')

    expect(readParagraphRuns(setResult.projection)).toEqual([
      {
        text: 'h'
      },
      {
        text: 'ell',
        link: {
          target: 'https://example.com',
          tooltip: '示例链接'
        }
      },
      {
        text: 'o'
      }
    ])

    const linkedSelection = createSelectionState(
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: linkedRunId!,
        graphemeIndex: 0
      }),
      editor.createTextAnchor({
        sectionId: 'section-1',
        blockId: 'paragraph-1',
        runId: linkedRunId!,
        graphemeIndex: 3
      })
    )
    const editResult = editor.executeCommand(buildEditLinkCommand(
      setResult.projection,
      linkedSelection,
      {
        target: 'mailto:test@example.com',
        tooltip: '邮件链接'
      }
    )!)

    expect(readParagraphRuns(editResult.projection)).toEqual([
      {
        text: 'h'
      },
      {
        text: 'ell',
        link: {
          target: 'mailto:test@example.com',
          tooltip: '邮件链接'
        }
      },
      {
        text: 'o'
      }
    ])

    const deleteResult = editor.executeCommand(buildDeleteLinkCommand(
      editResult.projection,
      linkedSelection
    )!)

    expect(readParagraphRuns(deleteResult.projection)).toEqual([
      {
        text: 'h'
      },
      {
        text: 'ell'
      },
      {
        text: 'o'
      }
    ])

    editor.destroy()
  })

  it('inserts displayText at a collapsed selection and applies link metadata in one command', () => {
    const editor = createEditor({ initialText: 'ab' })
    const caret = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 1
    })
    const collapsedSelection = createSelectionState(caret, caret)
    const command = buildInsertLinkCommand(editor.getProjection(), collapsedSelection, {
      displayText: 'XYZ',
      target: 'https://example.com/path',
      tooltip: '插入链接'
    })

    expect(command).not.toBeNull()

    const result = editor.executeCommand(command!)

    expect(readParagraphRuns(result.projection)).toEqual([
      {
        text: 'a'
      },
      {
        text: 'XYZ',
        link: {
          target: 'https://example.com/path',
          tooltip: '插入链接'
        }
      },
      {
        text: 'b'
      }
    ])

    editor.destroy()
  })
})

interface ParagraphRunSnapshot {
  readonly text: string
  readonly link?: {
    readonly target: string
    readonly tooltip?: string
  }
}

/** 读取第一段所有 run 的最小文本与链接快照。 */
function readParagraphRuns(
  projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>
): readonly ParagraphRunSnapshot[] {
  const paragraph = projection.document.sections[0]?.blocks[0]

  if (paragraph?.kind !== 'paragraph') {
    return []
  }

  return paragraph.runs.map((run) => ({
    text: run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''),
    ...(run.link === undefined ? {} : { link: run.link })
  }))
}

/** 读取带指定 target 的 runId，供后续选区构造使用。 */
function readLinkedRunId(
  projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>,
  target: string
): string | undefined {
  const paragraph = projection.document.sections[0]?.blocks[0]

  if (paragraph?.kind !== 'paragraph') {
    return undefined
  }

  return paragraph.runs.find((run) => run.link?.target === target)?.id
}
