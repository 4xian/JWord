/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 4 图片 builder 会沿用现有 transaction pipeline，并以独立 image run 表达最小图片纵线。
 * 边界：只覆盖公开 builder、selected image helper 和 editor 事务闭环，不测试 UI 上传面板或浏览器交互。
 * 协作模块：resources、projection、operation adapter、layout/query 和 root index 共同提供这组最小公开接口。
 * 性能/安全约束：测试只使用内存 projection / editor，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { describe, expect, it } from 'vitest'

import {
  buildDeleteSelectedImageCommand,
  buildInsertInlineImageCommand,
  buildMoveSelectedImageCommand,
  buildReplaceSelectedImageResourceCommand,
  buildResizeSelectedImageCommand,
  buildSetSelectedImageRotationCommand,
  buildUpsertResourceCommand,
  createEditor,
  resolveSelectedImageTarget
} from '../../src/index'
import { createSelectionState } from '../../src/model/selection'
import type { Resource } from '../../src/resources/types'

const INLINE_RESOURCE: Resource = {
  kind: 'resource',
  id: 'image-inline-1',
  mime: 'image/png',
  source: {
    kind: 'dataUrl',
    url: 'data:image/png;base64,AAAA'
  },
  status: 'success'
}

describe('image command builders', () => {
  it('builds a resource upsert command and rejects non-allowlisted external urls by default', () => {
    expect(buildUpsertResourceCommand(INLINE_RESOURCE)).toEqual({
      name: 'upsertResource',
      operations: [
        {
          kind: 'upsertResource',
          resource: INLINE_RESOURCE
        }
      ]
    })

    expect(() => buildUpsertResourceCommand({
      kind: 'resource',
      id: 'image-external',
      mime: 'image/png',
      source: {
        kind: 'externalUrl',
        url: 'https://example.com/unsafe.png'
      },
      status: 'success'
    })).toThrow()
  })

  it('inserts an inline image as an independent image run and resolves it as the selected target', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const selection = createSelectionState(textAnchor, textAnchor)
    const command = buildInsertInlineImageCommand(editor.getProjection(), selection, INLINE_RESOURCE, {
      alt: '示意图',
      widthTwips: 1440,
      heightTwips: 960
    })

    expect(command).toMatchObject({
      name: 'insertInlineImage',
      operations: [
        {
          kind: 'upsertResource',
          resource: INLINE_RESOURCE
        },
        {
          kind: 'insertImage',
          at: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 2
          },
          imageRunId: expect.any(String),
          trailingRunId: expect.any(String),
          mode: 'inline',
          image: {
            kind: 'image',
            resourceId: 'image-inline-1',
            alt: '示意图',
            display: 'inline',
            widthTwips: 1440,
            heightTwips: 960
          }
        }
      ]
    })

    editor.executeCommand(command!)

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    expect(paragraph.runs.map((run) => run.inlines)).toEqual([
      [
        {
          kind: 'text',
          text: 'ab'
        }
      ],
      [
        {
          kind: 'image',
          resourceId: 'image-inline-1',
          alt: '示意图',
          display: 'inline',
          widthTwips: 1440,
          heightTwips: 960
        }
      ],
      [
        {
          kind: 'text',
          text: 'cd'
        }
      ]
    ])

    const imageRunId = paragraph.runs[1]?.id

    expect(imageRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const target = resolveSelectedImageTarget(editor.getProjection(), imageSelection)

    expect(target).toMatchObject({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId,
      image: {
        resourceId: 'image-inline-1',
        alt: '示意图'
      },
      resource: INLINE_RESOURCE
    })

    const afterImageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0,
      assoc: -1
    })
    const afterImageSelection = createSelectionState(afterImageAnchor, afterImageAnchor)

    expect(resolveSelectedImageTarget(editor.getProjection(), afterImageSelection)).toBeNull()

    editor.destroy()
  })

  it('adds an empty trailing text run when an inline image is inserted at the end of the paragraph text', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const endAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 4
    })
    const selection = createSelectionState(endAnchor, endAnchor)
    const command = buildInsertInlineImageCommand(editor.getProjection(), selection, INLINE_RESOURCE, {
      widthTwips: 1440,
      heightTwips: 960
    })

    expect(command).toMatchObject({
      name: 'insertInlineImage',
      operations: [
        {
          kind: 'upsertResource',
          resource: INLINE_RESOURCE
        },
        {
          kind: 'insertImage',
          at: {
            sectionId: 'section-1',
            blockId: 'paragraph-1',
            runId: 'run-1',
            graphemeIndex: 4
          },
          imageRunId: expect.any(String),
          trailingRunId: expect.any(String),
          mode: 'inline'
        }
      ]
    })

    editor.executeCommand(command!)

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph block')
    }

    expect(paragraph.runs.map((run) => run.inlines)).toEqual([
      [
        {
          kind: 'text',
          text: 'abcd'
        }
      ],
      [
        {
          kind: 'image',
          resourceId: 'image-inline-1',
          display: 'inline',
          widthTwips: 1440,
          heightTwips: 960
        }
      ],
      [
        {
          kind: 'text',
          text: ''
        }
      ]
    ])

    editor.destroy()
  })

  it('replaces resizes and deletes the selected inline image through executeCommand', () => {
    const oldResource: Resource = {
      kind: 'resource',
      id: 'image-old',
      mime: 'image/png',
      source: {
        kind: 'dataUrl',
        url: 'data:image/png;base64,AAAA'
      },
      status: 'success'
    }
    const newResource: Resource = {
      kind: 'resource',
      id: 'image-new',
      mime: 'image/png',
      source: {
        kind: 'dataUrl',
        url: 'data:image/png;base64,BBBB'
      },
      status: 'success'
    }
    const editor = createEditor({
      initialText: 'abcd',
      resources: [oldResource]
    })
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const textSelection = createSelectionState(textAnchor, textAnchor)
    const insertCommand = buildInsertInlineImageCommand(editor.getProjection(), textSelection, oldResource, {
      widthTwips: 1800,
      heightTwips: 1200
    })

    editor.executeCommand(insertCommand!)

    const insertedParagraph = editor.getProjection().document.sections[0]?.blocks[0]
    const imageRunId = insertedParagraph?.kind === 'paragraph'
      ? insertedParagraph.runs[1]?.id
      : undefined

    expect(imageRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const replaceCommand = buildReplaceSelectedImageResourceCommand(editor.getProjection(), imageSelection, newResource)

    expect(replaceCommand).toEqual({
      name: 'replaceImageResource',
      operations: [
        {
          kind: 'upsertResource',
          resource: newResource
        },
        {
          kind: 'replaceImageResource',
          runId: imageRunId,
          resourceId: 'image-new'
        },
        {
          kind: 'deleteResource',
          resourceId: 'image-old'
        }
      ]
    })
    editor.executeCommand(replaceCommand!)

    let imageParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(imageParagraph?.kind).toBe('paragraph')
    if (imageParagraph?.kind !== 'paragraph') {
      throw new Error('expected inline image paragraph')
    }

    expect(imageParagraph.runs[1]?.inlines).toEqual([
      {
        kind: 'image',
        resourceId: 'image-new',
        display: 'inline',
        widthTwips: 1800,
        heightTwips: 1200
      }
    ])
    expect(editor.getProjection().document.resources).toEqual([newResource])

    const resizeCommand = buildResizeSelectedImageCommand(editor.getProjection(), imageSelection, {
      widthTwips: 2400,
      heightTwips: 1600
    })

    expect(resizeCommand).toEqual({
      name: 'resizeImage',
      operations: [
        {
          kind: 'resizeImage',
          runId: imageRunId,
          widthTwips: 2400,
          heightTwips: 1600
        }
      ]
    })
    editor.executeCommand(resizeCommand!)

    imageParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(imageParagraph?.kind).toBe('paragraph')
    if (imageParagraph?.kind !== 'paragraph') {
      throw new Error('expected resized inline image paragraph')
    }

    expect(imageParagraph.runs[1]?.inlines).toEqual([
      {
        kind: 'image',
        resourceId: 'image-new',
        display: 'inline',
        widthTwips: 2400,
        heightTwips: 1600
      }
    ])

    const deleteCommand = buildDeleteSelectedImageCommand(editor.getProjection(), imageSelection)

    expect(deleteCommand).toEqual({
      name: 'deleteImage',
      operations: [
        {
          kind: 'deleteImage',
          runId: imageRunId
        },
        {
          kind: 'deleteResource',
          resourceId: 'image-new'
        }
      ]
    })
    editor.executeCommand(deleteCommand!)

    imageParagraph = editor.getProjection().document.sections[0]?.blocks[0]
    expect(imageParagraph?.kind).toBe('paragraph')
    if (imageParagraph?.kind !== 'paragraph') {
      throw new Error('expected paragraph after deleting inline image')
    }

    expect(imageParagraph.runs.map((run) => run.inlines)).toEqual([
      [
        {
          kind: 'text',
          text: 'ab'
        }
      ],
      [
        {
          kind: 'text',
          text: 'cd'
        }
      ]
    ])
    expect(editor.getProjection().document.resources ?? []).toEqual([])

    editor.destroy()
  })

  it('rotates the selected inline image and allows resetting rotation to zero', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const textSelection = createSelectionState(textAnchor, textAnchor)
    const insertCommand = buildInsertInlineImageCommand(editor.getProjection(), textSelection, INLINE_RESOURCE, {
      widthTwips: 1800,
      heightTwips: 1200
    })

    editor.executeCommand(insertCommand!)

    const insertedParagraph = editor.getProjection().document.sections[0]?.blocks[0]
    const imageRunId = insertedParagraph?.kind === 'paragraph'
      ? insertedParagraph.runs[1]?.id
      : undefined

    expect(imageRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const rotateCommand = buildSetSelectedImageRotationCommand(editor.getProjection(), imageSelection, 90)

    expect(rotateCommand).toEqual({
      name: 'setImageRotation',
      operations: [{
        kind: 'setImageRotation',
        runId: imageRunId,
        rotationDegrees: 90
      }]
    })
    editor.executeCommand(rotateCommand!)

    let imageParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(imageParagraph?.kind).toBe('paragraph')
    if (imageParagraph?.kind !== 'paragraph') {
      throw new Error('expected rotated inline image paragraph')
    }

    expect(imageParagraph.runs[1]?.inlines).toEqual([{
      kind: 'image',
      resourceId: 'image-inline-1',
      display: 'inline',
      widthTwips: 1800,
      heightTwips: 1200,
      rotationDegrees: 90
    }])

    const resetCommand = buildSetSelectedImageRotationCommand(editor.getProjection(), imageSelection, 0)

    expect(resetCommand).toEqual({
      name: 'setImageRotation',
      operations: [{
        kind: 'setImageRotation',
        runId: imageRunId,
        rotationDegrees: 0
      }]
    })
    editor.executeCommand(resetCommand!)

    imageParagraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(imageParagraph?.kind).toBe('paragraph')
    if (imageParagraph?.kind !== 'paragraph') {
      throw new Error('expected reset inline image paragraph')
    }

    expect(imageParagraph.runs[1]?.inlines).toEqual([{
      kind: 'image',
      resourceId: 'image-inline-1',
      display: 'inline',
      widthTwips: 1800,
      heightTwips: 1200
    }])

    editor.destroy()
  })

  it('moves the selected inline image to the dropped text position and keeps the resource alive', () => {
    const editor = createEditor({ initialText: 'abcd' })
    const textAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: 'run-1',
      graphemeIndex: 2
    })
    const textSelection = createSelectionState(textAnchor, textAnchor)
    const insertCommand = buildInsertInlineImageCommand(editor.getProjection(), textSelection, INLINE_RESOURCE, {
      widthTwips: 1800,
      heightTwips: 1200
    })

    editor.executeCommand(insertCommand!)

    const insertedParagraph = editor.getProjection().document.sections[0]?.blocks[0]
    const imageRunId = insertedParagraph?.kind === 'paragraph'
      ? insertedParagraph.runs[1]?.id
      : undefined
    const trailingRunId = insertedParagraph?.kind === 'paragraph'
      ? insertedParagraph.runs[2]?.id
      : undefined

    expect(imageRunId).toBeDefined()
    expect(trailingRunId).toBeDefined()

    const imageAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: imageRunId!,
      graphemeIndex: 0
    })
    const imageSelection = createSelectionState(imageAnchor, imageAnchor)
    const dropAnchor = editor.createTextAnchor({
      sectionId: 'section-1',
      blockId: 'paragraph-1',
      runId: trailingRunId!,
      graphemeIndex: 2
    })
    const dropSelection = createSelectionState(dropAnchor, dropAnchor)
    const moveCommand = buildMoveSelectedImageCommand(editor.getProjection(), imageSelection, dropSelection)

    expect(moveCommand).toEqual({
      name: 'moveImage',
      operations: [{
        kind: 'insertImage',
        at: {
          sectionId: 'section-1',
          blockId: 'paragraph-1',
          runId: trailingRunId,
          graphemeIndex: 2
        },
        imageRunId: expect.any(String),
        trailingRunId: expect.any(String),
        mode: 'inline',
        image: {
          kind: 'image',
          resourceId: 'image-inline-1',
          display: 'inline',
          widthTwips: 1800,
          heightTwips: 1200
        }
      }, {
        kind: 'deleteImage',
        runId: imageRunId
      }]
    })

    editor.executeCommand(moveCommand!)

    const paragraph = editor.getProjection().document.sections[0]?.blocks[0]

    expect(paragraph?.kind).toBe('paragraph')
    if (paragraph?.kind !== 'paragraph') {
      throw new Error('expected moved inline image paragraph')
    }

    expect(paragraph.runs.map((run) => run.inlines)).toEqual([
      [{
        kind: 'text',
        text: 'ab'
      }],
      [{
        kind: 'text',
        text: 'cd'
      }],
      [{
        kind: 'image',
        resourceId: 'image-inline-1',
        display: 'inline',
        widthTwips: 1800,
        heightTwips: 1200
      }],
      [{
        kind: 'text',
        text: ''
      }]
    ])
    expect(editor.getProjection().document.resources).toEqual([INLINE_RESOURCE])

    editor.destroy()
  })
})
