/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 3 基础 formatting command builder 会把 selection 映射成最小 operation 集。
 * 边界：只覆盖 command 构造和 transaction pipeline 语义，不测试 toolbar DOM、输入事件或 editor.ts 接线。
 * 协作模块：后续 toolbar 和快捷键可复用这些纯函数 builder，再交给 Editor facade 执行。
 * 性能/安全约束：测试只依赖内存中的 projection 和 Y.Doc，不访问 DOM、网络或磁盘。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md#gate-3---输入与基础编辑。
 */

import { describe, expect, it } from 'vitest'

import {
  buildSetBackgroundColorCommand,
  buildSetBoldCommand,
  buildSetFontFamilyCommand,
  buildSetFontSizeCommand,
  buildSetItalicCommand,
  buildSetParagraphAlignmentCommand,
  buildSetParagraphIndentCommand,
  buildSetStrikeCommand,
  buildSetTextColorCommand,
  buildSetUnderlineCommand
} from '../src/index'
import {
  DOCUMENT_STORE_FIELDS,
  type DocumentStoreJson,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getSectionBlocks
} from '../src/document-store'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import { createAnchorRef, createGraphemeIndex } from '../src/position'
import { createDocumentProjection } from '../src/projection'
import { createCollapsedSelection, createSelectionState } from '../src/selection'
import { createTransactionPipeline } from '../src/transaction'

describe('formatting command builders', () => {
  it('只为真正覆盖到的 grapheme 范围构造 run formatting commands', () => {
    const fixture = createFormattingFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 2)
    )

    const commandCases = [
      {
        command: buildSetBoldCommand(fixture.projection, selection, true),
        name: 'setBold',
        properties: { bold: true }
      },
      {
        command: buildSetItalicCommand(fixture.projection, selection, true),
        name: 'setItalic',
        properties: { italic: true }
      },
      {
        command: buildSetUnderlineCommand(fixture.projection, selection, true),
        name: 'setUnderline',
        properties: { underline: true }
      },
      {
        command: buildSetStrikeCommand(fixture.projection, selection, true),
        name: 'setStrike',
        properties: { strike: true }
      },
      {
        command: buildSetFontFamilyCommand(fixture.projection, selection, 'FangSong'),
        name: 'setFontFamily',
        properties: { fontFamily: 'FangSong' }
      },
      {
        command: buildSetFontSizeCommand(fixture.projection, selection, 360),
        name: 'setFontSize',
        properties: { fontSizeTwips: 360 }
      },
      {
        command: buildSetTextColorCommand(fixture.projection, selection, '#ff0000'),
        name: 'setTextColor',
        properties: { color: '#ff0000' }
      },
      {
        command: buildSetBackgroundColorCommand(fixture.projection, selection, '#fff59d'),
        name: 'setBackgroundColor',
        properties: { backgroundColor: '#fff59d' }
      }
    ] as const

    for (const testCase of commandCases) {
      expect(testCase.command?.name).toBe(testCase.name)
      expect(testCase.command?.operations).toHaveLength(3)
      expect(testCase.command?.operations[0]).toMatchObject({
        kind: 'setRunProperties',
        runId: 'run-1',
        properties: testCase.properties,
        range: {
          startGraphemeIndex: 1,
          endGraphemeIndex: 2,
          formattedRunId: expect.any(String)
        }
      })
      expect(testCase.command?.operations[1]).toEqual({
        kind: 'setRunProperties',
        runId: 'run-2',
        properties: testCase.properties
      })
      expect(testCase.command?.operations[2]).toMatchObject({
        kind: 'setRunProperties',
        runId: 'run-3',
        properties: testCase.properties,
        range: {
          startGraphemeIndex: 0,
          endGraphemeIndex: 2,
          trailingRunId: expect.any(String)
        }
      })
    }
  })

  it('对 paragraph 目标使用半开区间，结束于下一段开头时不误包含尾段', () => {
    const fixture = createFormattingFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 0)
    )

    expect(buildSetParagraphAlignmentCommand(fixture.projection, selection, 'right')).toEqual({
      name: 'setParagraphAlignment',
      operations: [
        {
          kind: 'setParagraphProperties',
          paragraphId: 'paragraph-1',
          properties: { alignment: 'right' }
        }
      ]
    })
  })

  it('在目标值与当前渲染语义等效时不构造 formatting command', () => {
    const fixture = createFormattingFixture()
    const paragraphSelection = createCollapsedSelection(fixture.createAnchor('paragraph-2', 'run-3', 1))
    const runSelection = createCollapsedSelection(fixture.createAnchor('paragraph-2', 'run-3', 1))

    expect(buildSetBoldCommand(fixture.projection, runSelection, false)).toBeNull()
    expect(buildSetParagraphAlignmentCommand(fixture.projection, paragraphSelection, 'center')).toBeNull()
  })

  it('builds paragraph formatting commands for every touched paragraph', () => {
    const fixture = createFormattingFixture()
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 2)
    )

    expect(buildSetParagraphIndentCommand(fixture.projection, selection, 720)).toEqual({
      name: 'setParagraphIndent',
      operations: [
        {
          kind: 'setParagraphProperties',
          paragraphId: 'paragraph-1',
          properties: { indentLeftTwips: 720 }
        },
        {
          kind: 'setParagraphProperties',
          paragraphId: 'paragraph-2',
          properties: { indentLeftTwips: 720 }
        }
      ]
    })
  })

  it('runs formatting commands through the existing transaction pipeline without touching projection directly', () => {
    const fixture = createFormattingFixture()
    const pipeline = createTransactionPipeline(fixture.store.doc)
    const selection = createSelectionState(
      fixture.createAnchor('paragraph-1', 'run-1', 1),
      fixture.createAnchor('paragraph-2', 'run-3', 2)
    )

    const boldCommand = buildSetBoldCommand(fixture.projection, selection, true)
    const alignmentCommand = buildSetParagraphAlignmentCommand(fixture.projection, selection, 'right')

    expect(boldCommand).not.toBeNull()
    expect(alignmentCommand).not.toBeNull()

    const boldResult = pipeline.run(boldCommand!, { origin: 'local-user' })
    const alignmentResult = pipeline.run(alignmentCommand!, { origin: 'local-user' })

    expect(readRunTexts(boldResult.projection)).toEqual(['你', '好', '世界', '工具', '栏'])
    expect(readRunProperties(boldResult.projection)).toEqual([
      {},
      { bold: true },
      { bold: true },
      { bold: true },
      {}
    ])
    expect(readParagraphProperties(alignmentResult.projection)).toEqual([
      { alignment: 'right' },
      { alignment: 'right' }
    ])
  })
})

function createFormattingFixture() {
  const store = createDocumentStore()
  const section = createSectionRecord('section-1' as SectionId)
  const paragraphOne = createParagraphRecord('paragraph-1' as BlockId)
  const paragraphTwo = createParagraphRecord('paragraph-2' as BlockId)
  const runOne = createRunRecord('run-1' as RunId, '你好')
  const runTwo = createRunRecord('run-2' as RunId, '世界')
  const runThree = createRunRecord('run-3' as RunId, '工具栏')

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, 'document-1' as DocumentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraphOne, paragraphTwo])
  getParagraphRuns(paragraphOne).push([runOne, runTwo])
  getParagraphRuns(paragraphTwo).push([runThree])

  setRecordProperties(runTwo, DOCUMENT_STORE_FIELDS.run.properties, {
    bold: false
  })
  setRecordProperties(paragraphTwo, DOCUMENT_STORE_FIELDS.block.properties, {
    alignment: 'center'
  })

  const projection = createDocumentProjection(store)

  return {
    store,
    projection,
    createAnchor(blockId: string, runId: string, graphemeIndex: number) {
      return createAnchorRef({
        documentId: 'document-1' as DocumentId,
        sectionId: 'section-1' as SectionId,
        blockId: blockId as BlockId,
        runId: runId as RunId,
        graphemeIndex: createGraphemeIndex(graphemeIndex)
      })
    }
  }
}

function readRunTexts(projection: ReturnType<typeof createDocumentProjection>) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.map((run) => run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : []).join(''))
      : [])
  )
}

function readRunProperties(projection: ReturnType<typeof createDocumentProjection>) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? block.runs.map((run) => run.properties ?? {})
      : [])
  )
}

function readParagraphProperties(projection: ReturnType<typeof createDocumentProjection>) {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph' ? [block.properties ?? {}] : [])
  )
}

function setRecordProperties(
  record: { get(key: string): unknown },
  key: string,
  properties: Readonly<Record<string, DocumentStoreJson>>
) {
  const propertyMap = record.get(key)

  if (propertyMap === null || propertyMap === undefined || typeof propertyMap !== 'object' || typeof (propertyMap as { set?: unknown }).set !== 'function') {
    throw new Error('属性容器缺失')
  }

  for (const [propertyKey, value] of Object.entries(properties)) {
    ;(propertyMap as { set(name: string, value: DocumentStoreJson): void }).set(propertyKey, value)
  }
}
