/**
 * @vitest-environment node
 *
 * 职责：用固定 seed 的轻量属性序列验证 Gate 1 operation 不变量。
 * 边界：只覆盖单 section、单段落、短文本、split/merge 和 undo/redo，不做协同或大规模 fuzz。
 * 协作模块：Editor facade、transaction pipeline、projection 和 history 提供被测路径。
 * 性能/安全约束：测试规模固定且可复现，不访问 DOM、网络或外部随机源。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/06-acceptance-and-testing.md#63-测试矩阵。
 */

import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'

import {
  DOCUMENT_STORE_FIELDS,
  createDocumentStore,
  createParagraphRecord,
  createRunRecord,
  createSectionRecord,
  getParagraphRuns,
  getRunText,
  getSectionBlocks
} from '../src/document-store'
import { createEditor } from '../src/editor'
import { DEFAULT_HISTORY_ORIGIN, createHistoryManager } from '../src/history'
import type { BlockId, DocumentId, RunId, SectionId } from '../src/position'
import { createDocumentProjection } from '../src/projection'
import { createTransactionPipeline } from '../src/transaction'
import type { Operation, TextPosition } from '../src/transaction'

describe('Gate 1 operation property sequences', () => {
  it('keeps Y.Doc text and projection equal across seeded insert delete transactions', () => {
    const store = createPropertyStore('')
    const pipeline = createTransactionPipeline(store.store.doc)
    let expectedText = ''

    for (const step of createSeededTextSteps(0x20260511, 24)) {
      if (step.kind === 'insert') {
        const result = pipeline.run(
          {
            name: `seeded-ydoc-insert-${step.index}`,
            operations: [
              {
                kind: 'insertText',
                at: store.createPosition(step.index),
                text: step.text
              }
            ]
          },
          { origin: 'local-user' }
        )

        expectedText = `${expectedText.slice(0, step.index)}${step.text}${expectedText.slice(step.index)}`
        expect(getRunText(store.run).toString()).toBe(expectedText)
        expect(readProjectionText(result.projection)).toBe(expectedText)
      } else {
        const result = pipeline.run(
          {
            name: `seeded-ydoc-delete-${step.from}-${step.to}`,
            operations: [
              {
                kind: 'deleteRange',
                range: {
                  anchor: store.createPosition(step.from),
                  focus: store.createPosition(step.to)
                }
              }
            ]
          },
          { origin: 'local-user' }
        )

        expectedText = `${expectedText.slice(0, step.from)}${expectedText.slice(step.to)}`
        expect(getRunText(store.run).toString()).toBe(expectedText)
        expect(readProjectionText(result.projection)).toBe(expectedText)
      }
    }
  })

  it('keeps projection text equal to the seeded insert/delete model', () => {
    const editor = createEditor({ initialText: '' })
    let expectedText = ''

    for (const step of createSeededTextSteps(0x20260511, 24)) {
      if (step.kind === 'insert') {
        const anchor = editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: step.index
        })

        const result = editor.executeCommand({
          name: `seeded-insert-${step.index}`,
          operations: [{ kind: 'insertText', at: editor.resolveTextPosition(anchor), text: step.text }]
        })
        expectedText = `${expectedText.slice(0, step.index)}${step.text}${expectedText.slice(step.index)}`
        expect(readProjectionText(result.projection)).toBe(expectedText)
      } else {
        const anchor = editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: step.from
        })
        const focus = editor.createTextAnchor({
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: 'run-1',
          graphemeIndex: step.to
        })

        const result = editor.executeCommand({
          name: `seeded-delete-${step.from}-${step.to}`,
          operations: [
            {
              kind: 'deleteRange',
              range: {
                anchor: editor.resolveTextPosition(anchor),
                focus: editor.resolveTextPosition(focus)
              }
            }
          ]
        })
        expectedText = `${expectedText.slice(0, step.from)}${expectedText.slice(step.to)}`
        expect(readProjectionText(result.projection)).toBe(expectedText)
      }

      expect(readFirstParagraphText(editor)).toBe(expectedText)
    }

    editor.destroy()
  })

  it('keeps text anchors stable after insertions before the anchor', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const stableAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })

    editor.executeCommand({
      name: 'property-insert-before-anchor',
      operations: [
        {
          kind: 'insertText',
          at: editor.resolveTextPosition(editor.createTextAnchor({
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 0
          })),
          text: 'XX'
        }
      ]
    })
    editor.executeCommand({
      name: 'property-insert-at-stable-anchor',
      operations: [{ kind: 'insertText', at: editor.resolveTextPosition(stableAnchor), text: 'Z' }]
    })

    expect(readFirstParagraphText(editor)).toBe('XXabZcd')

    editor.destroy()
  })

  it('keeps text anchors stable after deletions before the anchor', () => {
    const editor = createEditor({ initialText: 'XXabcd' })
    const stableAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 4
    })

    editor.executeCommand({
      name: 'property-delete-before-anchor',
      operations: [
        {
          kind: 'deleteRange',
          range: {
            anchor: {
              sectionId: 'section-1',
              blockId: 'paragraph-1',
              runId: 'run-1',
              graphemeIndex: 0
            },
            focus: {
              sectionId: 'section-1',
              blockId: 'paragraph-1',
              runId: 'run-1',
              graphemeIndex: 2
            }
          }
        }
      ]
    })
    editor.executeCommand({
      name: 'property-insert-at-stable-anchor-after-delete',
      operations: [{ kind: 'insertText', at: editor.resolveTextPosition(stableAnchor), text: 'Z' }]
    })

    expect(readFirstParagraphText(editor)).toBe('abZcd')

    editor.destroy()
  })

  it('keeps text anchors stable when split moves text into a new paragraph', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const tailAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 5
    })

    editor.executeCommand({
      name: 'property-split-before-tail-anchor',
      operations: [
        {
          kind: 'splitBlock',
          at: editor.resolveTextPosition(editor.createTextAnchor({
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 3
          })),
          newBlockId: 'paragraph-2' as BlockId,
          newRunId: 'run-2' as RunId
        }
      ]
    })
    editor.executeCommand({
      name: 'property-insert-at-split-migrated-anchor',
      operations: [{ kind: 'insertText', at: editor.resolveTextPosition(tailAnchor), text: 'Z' }]
    })

    expect(readParagraphTexts(editor)).toEqual(['abc', 'deZf'])

    editor.destroy()
  })

  it('keeps text anchors stable when merge moves text back into the target paragraph', () => {
    const editor = createEditor({ initialText: 'abcdef' })

    editor.executeCommand({
      name: 'property-split-before-merge-anchor',
      operations: [
        {
          kind: 'splitBlock',
          at: editor.resolveTextPosition(editor.createTextAnchor({
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 3
          })),
          newBlockId: 'paragraph-2' as BlockId,
          newRunId: 'run-2' as RunId
        }
      ]
    })

    const sourceAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-2',
      runId: 'run-2',
      graphemeIndex: 2
    })

    editor.executeCommand({
      name: 'property-merge-before-source-anchor',
      operations: [
        {
          kind: 'mergeBlock',
          targetBlockId: 'paragraph-1' as BlockId,
          sourceBlockId: 'paragraph-2' as BlockId
        }
      ]
    })
    editor.executeCommand({
      name: 'property-insert-at-merge-migrated-anchor',
      operations: [{ kind: 'insertText', at: editor.resolveTextPosition(sourceAnchor), text: 'Z' }]
    })

    expect(readParagraphTexts(editor)).toEqual(['abcdeZf'])

    editor.destroy()
  })

  it('keeps Y.Doc text and projection equal across split merge undo redo', () => {
    const fixture = createPropertyStore('abcdef')
    const pipeline = createTransactionPipeline(fixture.store.doc)
    const history = createHistoryManager(fixture.store)

    runTracked(history, pipeline, 'property-ydoc-style-before-split', [
      {
        kind: 'setRunProperties',
        runId: 'run-1' as RunId,
        properties: { bold: true }
      }
    ])
    const splitResult = runTracked(history, pipeline, 'property-ydoc-split', [
      {
        kind: 'splitBlock',
        at: fixture.createPosition(3),
        newBlockId: 'paragraph-2' as BlockId,
        newRunId: 'run-2' as RunId
      }
    ])

    expect(readStoreParagraphTexts(fixture.store)).toEqual(['abc', 'def'])
    expect(readProjectionParagraphTexts(splitResult.projection)).toEqual(readStoreParagraphTexts(fixture.store))
    expect(readStoreRunProperties(fixture.store)).toEqual([{ bold: true }, { bold: true }])

    const mergeResult = runTracked(history, pipeline, 'property-ydoc-merge', [
      {
        kind: 'mergeBlock',
        targetBlockId: 'paragraph-1' as BlockId,
        sourceBlockId: 'paragraph-2' as BlockId
      }
    ])

    expect(readStoreParagraphTexts(fixture.store)).toEqual(['abcdef'])
    expect(readProjectionParagraphTexts(mergeResult.projection)).toEqual(readStoreParagraphTexts(fixture.store))
    expect(readStoreRunProperties(fixture.store)).toEqual([{ bold: true }, { bold: true }])

    history.undo()
    expect(readStoreParagraphTexts(fixture.store)).toEqual(['abc', 'def'])
    expect(readStoreRunProperties(fixture.store)).toEqual([{ bold: true }, { bold: true }])

    history.redo()
    expect(readStoreParagraphTexts(fixture.store)).toEqual(['abcdef'])
    expect(readStoreRunProperties(fixture.store)).toEqual([{ bold: true }, { bold: true }])
  })

  it('keeps Y.Doc projection and model equal across a seeded mixed edit sequence', () => {
    const fixture = createPropertyStore('abcdef')
    const pipeline = createTransactionPipeline(fixture.store.doc)
    const history = createHistoryManager(fixture.store)
    const model: ParagraphModel[] = [
      {
        blockId: 'paragraph-1',
        runs: [{ runId: 'run-1', text: 'abcdef' }]
      }
    ]
    let nextBlockIndex = 2
    let nextRunIndex = 2
    const random = createSeededRandom(0x20260512)
    const alphabet = ['A', 'B', 'C', '文', '字'] as const

    for (let stepIndex = 0; stepIndex < 18; stepIndex += 1) {
      const operation = createSeededMixedOperation(random, model, () => ({
        blockId: `paragraph-${nextBlockIndex++}`,
        runId: `run-${nextRunIndex++}`
      }), alphabet)
      const result = runTracked(history, pipeline, `property-mixed-${stepIndex}`, [operation])

      expect(readStoreParagraphTexts(fixture.store)).toEqual(readModelParagraphTexts(model))
      expect(readProjectionParagraphTexts(result.projection)).toEqual(readStoreParagraphTexts(fixture.store))
    }

    for (let index = 0; index < 18; index += 1) {
      history.undo()
      expect(readProjectionParagraphTexts(createDocumentProjection(fixture.store))).toEqual(
        readStoreParagraphTexts(fixture.store)
      )
    }

    for (let index = 0; index < 18; index += 1) {
      history.redo()
      expect(readProjectionParagraphTexts(createDocumentProjection(fixture.store))).toEqual(
        readStoreParagraphTexts(fixture.store)
      )
    }
  })

  it('roundtrips split merge and undo redo without losing run properties', () => {
    const editor = createEditor({ initialText: 'abcdef' })
    const splitAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 3
    })

    editor.executeCommand({
      name: 'property-style-before-split',
      operations: [
        {
          kind: 'setRunProperties',
          runId: 'run-1' as RunId,
          properties: { bold: true }
        }
      ]
    })
    editor.executeCommand({
      name: 'property-split',
      operations: [
        {
          kind: 'splitBlock',
          at: editor.resolveTextPosition(splitAnchor),
          newBlockId: 'paragraph-2' as BlockId,
          newRunId: 'run-2' as RunId
        }
      ]
    })
    expect(readParagraphTexts(editor)).toEqual(['abc', 'def'])
    expect(readRunProperties(editor)).toEqual([{ bold: true }, { bold: true }])

    editor.executeCommand({
      name: 'property-merge',
      operations: [
        {
          kind: 'mergeBlock',
          targetBlockId: 'paragraph-1' as BlockId,
          sourceBlockId: 'paragraph-2' as BlockId
        }
      ]
    })

    expect(readParagraphTexts(editor)).toEqual(['abcdef'])
    editor.undo()
    expect(readParagraphTexts(editor)).toEqual(['abc', 'def'])
    expect(readRunProperties(editor)).toEqual([{ bold: true }, { bold: true }])
    editor.redo()
    expect(readParagraphTexts(editor)).toEqual(['abcdef'])
    expect(readRunProperties(editor)).toEqual([{ bold: true }, { bold: true }])

    editor.destroy()
  })
})

function runTracked(
  history: ReturnType<typeof createHistoryManager>,
  pipeline: ReturnType<typeof createTransactionPipeline>,
  name: string,
  operations: readonly Operation[]
) {
  history.stopCapturing()
  history.captureNextTransaction({
    commandName: name,
    origin: DEFAULT_HISTORY_ORIGIN
  })

  return pipeline.run({ name, operations }, { origin: DEFAULT_HISTORY_ORIGIN })
}

function createPropertyStore(initialText: string) {
  const store = createDocumentStore()
  const documentId = 'document-1' as DocumentId
  const sectionId = 'section-1' as SectionId
  const blockId = 'paragraph-1' as BlockId
  const runId = 'run-1' as RunId
  const section = createSectionRecord(sectionId)
  const paragraph = createParagraphRecord(blockId)
  const run = createRunRecord(runId, initialText)

  store.document.set(DOCUMENT_STORE_FIELDS.document.id, documentId)
  store.sections.push([section])
  getSectionBlocks(section).push([paragraph])
  getParagraphRuns(paragraph).push([run])

  return {
    store,
    run,
    createPosition(graphemeIndex: number): TextPosition {
      return {
        sectionId: String(sectionId),
        blockId: String(blockId),
        runId: String(runId),
        graphemeIndex
      }
    }
  }
}

type TextStep =
  | {
      readonly kind: 'insert'
      readonly index: number
      readonly text: string
    }
  | {
      readonly kind: 'delete'
      readonly from: number
      readonly to: number
    }

interface RunModel {
  readonly runId: string
  text: string
}

interface ParagraphModel {
  readonly blockId: string
  readonly runs: RunModel[]
}

function createSeededMixedOperation(
  random: () => number,
  model: ParagraphModel[],
  createIds: () => { readonly blockId: string, readonly runId: string },
  alphabet: readonly string[]
): Operation {
  const candidate = random() % 4

  if (candidate === 0 && hasText(model)) {
    return createMixedDeleteOperation(random, model)
  }

  if (candidate === 1) {
    return createMixedSplitOperation(random, model, createIds())
  }

  if (candidate === 2 && model.length > 1) {
    return createMixedMergeOperation(random, model)
  }

  return createMixedInsertOperation(random, model, readRequiredItem(alphabet, random() % alphabet.length))
}

function createMixedInsertOperation(random: () => number, model: ParagraphModel[], text: string): Operation {
  const { paragraph, run } = pickRun(random, model)
  const graphemeIndex = random() % (run.text.length + 1)

  run.text = `${run.text.slice(0, graphemeIndex)}${text}${run.text.slice(graphemeIndex)}`

  return {
    kind: 'insertText',
    at: createModelPosition(paragraph.blockId, run.runId, graphemeIndex),
    text
  }
}

function createMixedDeleteOperation(random: () => number, model: ParagraphModel[]): Operation {
  const { paragraph, run } = pickRunWithText(random, model)
  const from = random() % run.text.length
  const to = from + 1 + (random() % (run.text.length - from))

  run.text = `${run.text.slice(0, from)}${run.text.slice(to)}`

  return {
    kind: 'deleteRange',
    range: {
      anchor: createModelPosition(paragraph.blockId, run.runId, from),
      focus: createModelPosition(paragraph.blockId, run.runId, to)
    }
  }
}

function createMixedSplitOperation(
  random: () => number,
  model: ParagraphModel[],
  ids: { readonly blockId: string, readonly runId: string }
): Operation {
  const paragraphIndex = random() % model.length
  const paragraph = readRequiredItem(model, paragraphIndex)
  const runIndex = random() % paragraph.runs.length
  const run = readRequiredItem(paragraph.runs, runIndex)
  const graphemeIndex = random() % (run.text.length + 1)
  const head = run.text.slice(0, graphemeIndex)
  const tail = run.text.slice(graphemeIndex)
  const followingRuns = paragraph.runs.splice(runIndex + 1)

  run.text = head
  model.splice(paragraphIndex + 1, 0, {
    blockId: ids.blockId,
    runs: [{ runId: ids.runId, text: tail }, ...followingRuns]
  })

  return {
    kind: 'splitBlock',
    at: createModelPosition(paragraph.blockId, run.runId, graphemeIndex),
    newBlockId: ids.blockId,
    newRunId: ids.runId
  }
}

function createMixedMergeOperation(random: () => number, model: ParagraphModel[]): Operation {
  const targetIndex = random() % (model.length - 1)
  const target = readRequiredItem(model, targetIndex)
  const source = readRequiredItem(model, targetIndex + 1)

  target.runs.push(...source.runs)
  model.splice(targetIndex + 1, 1)

  return {
    kind: 'mergeBlock',
    targetBlockId: target.blockId,
    sourceBlockId: source.blockId
  }
}

function pickRun(random: () => number, model: ParagraphModel[]) {
  const paragraph = readRequiredItem(model, random() % model.length)
  const run = readRequiredItem(paragraph.runs, random() % paragraph.runs.length)

  return { paragraph, run }
}

function pickRunWithText(random: () => number, model: ParagraphModel[]) {
  const candidates = model.flatMap((paragraph) =>
    paragraph.runs
      .filter((run) => run.text.length > 0)
      .map((run) => ({ paragraph, run }))
  )

  return readRequiredItem(candidates, random() % candidates.length)
}

function readRequiredItem<Item>(items: readonly Item[], index: number): Item {
  const item = items[index]

  if (item === undefined) {
    throw new Error('测试模型缺少元素')
  }

  return item
}

function hasText(model: readonly ParagraphModel[]): boolean {
  return model.some((paragraph) => paragraph.runs.some((run) => run.text.length > 0))
}

function createModelPosition(blockId: string, runId: string, graphemeIndex: number): TextPosition {
  return {
    sectionId: 'section-1',
    blockId,
    runId,
    graphemeIndex
  }
}

function readModelParagraphTexts(model: readonly ParagraphModel[]): string[] {
  return model.map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
}

function createSeededTextSteps(seed: number, count: number): readonly TextStep[] {
  const random = createSeededRandom(seed)
  const alphabet = ['甲', '乙', '中', '文', 'A', 'B'] as const
  const steps: TextStep[] = []
  let length = 0

  for (let index = 0; index < count; index += 1) {
    const shouldDelete = length > 0 && random() % 4 === 0

    if (shouldDelete) {
      const from = random() % length
      const to = from + 1 + (random() % (length - from))

      steps.push({ kind: 'delete', from, to })
      length -= to - from
      continue
    }

    const insertIndex = length === 0 ? 0 : random() % (length + 1)
    const text = alphabet[random() % alphabet.length] ?? '甲'

    steps.push({ kind: 'insert', index: insertIndex, text })
    length += text.length
  }

  return steps
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0

  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0

    return state
  }
}

function readFirstParagraphText(editor: ReturnType<typeof createEditor>): string {
  return readParagraphTexts(editor)[0] ?? ''
}

function readParagraphTexts(editor: ReturnType<typeof createEditor>): string[] {
  return readProjectionParagraphTexts(editor.getProjection())
}

function readProjectionText(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>): string {
  return readProjectionParagraphTexts(projection)[0] ?? ''
}

function readProjectionParagraphTexts(projection: ReturnType<ReturnType<typeof createEditor>['getProjection']>): string[] {
  return projection.document.sections[0]?.blocks
    .filter((block) => block.kind === 'paragraph')
    .map((block) => block.runs.flatMap((run) => run.inlines)
      .filter((inline) => inline.kind === 'text')
      .map((inline) => inline.text)
      .join('')) ?? []
}

function readRunProperties(editor: ReturnType<typeof createEditor>) {
  return editor.getProjection().document.sections[0]?.blocks
    .filter((block) => block.kind === 'paragraph')
    .flatMap((block) => block.runs.map((run) => run.properties ?? {})) ?? []
}

function readStoreParagraphTexts(store: ReturnType<typeof createDocumentStore>): string[] {
  return store.sections.toArray()
    .flatMap((section) => getSectionBlocks(section).toArray())
    .filter((block) => block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph')
    .map((block) => getParagraphRuns(block).toArray()
      .map((run) => getRunText(run).toString())
      .join(''))
}

function readStoreRunProperties(store: ReturnType<typeof createDocumentStore>) {
  return store.sections.toArray()
    .flatMap((section) => getSectionBlocks(section).toArray())
    .filter((block) => block.get(DOCUMENT_STORE_FIELDS.block.kind) === 'paragraph')
    .flatMap((block) => getParagraphRuns(block).toArray())
    .map((run) => {
      const properties = run.get(DOCUMENT_STORE_FIELDS.run.properties)

      return properties instanceof Y.Map ? Object.fromEntries(properties.entries()) : {}
    })
}
