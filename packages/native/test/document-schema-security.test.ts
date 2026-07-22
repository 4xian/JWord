/**
 * @vitest-environment node
 *
 * 职责：通过 native 公开 API 锁定 document schema 与保存前校验行为。
 * 边界：不调用内部 parser/helper，不检查 ZIP 内部实现细节。
 * 协作模块：packages/native/src/index.ts 和 native-package-security-fixtures.ts。
 * 性能/安全约束：只构造小型内存文档与 ZIP fixture。
 * 实现说明：无效 document 同时覆盖 save、validate 和 load 三个公开 seam。
 */

import { describe, expect, it } from 'vitest'

import type { Document, Resource } from '@4xian/jword-core'
import {
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage,
  type JWordPackageErrorCode
} from '../src/index'
import { createStoredJWordPackage } from './native-package-security-fixtures'

describe('@4xian/jword-native document schema security seam', () => {
  it.each([
    ['document', { documentId: 'missing-document' }],
    ['section', { sectionId: 'missing-section' }],
    ['block', { blockId: 'missing-block' }],
    ['run', { runId: 'missing-run' }],
    [
      'ownership chain',
      {
        sectionId: 'section-anchor-a',
        blockId: 'paragraph-anchor-b',
        runId: 'run-anchor-b'
      }
    ]
  ] as const)('rejects a range anchor with an invalid %s reference', async (_label, overrides) => {
    const document = createAnchoredDocument([createComment('comment-invalid-anchor', 'range-invalid-anchor', overrides)])

    await expectDocumentRejected(document, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects duplicate range snapshot IDs across comment threads', async () => {
    const document = createAnchoredDocument([
      createComment('comment-range-first', 'duplicate-range'),
      createComment('comment-range-second', 'duplicate-range')
    ])

    await expectDocumentRejected(document, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects resource MIME containing only whitespace before saving', async () => {
    const document: Document = {
      kind: 'document',
      id: 'document-whitespace-resource-mime',
      resources: [{
        kind: 'resource',
        id: 'resource-whitespace-mime',
        mime: '   ',
        source: {
          kind: 'dataUrl',
          url: 'data:application/octet-stream;base64,QQ=='
        },
        status: 'success'
      }],
      sections: []
    }

    await expectDocumentRejected(document, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects non-finite numbers from JSON input and direct save', async () => {
    const documentText = '{"kind":"document","id":"document-non-finite","sections":[{"kind":"section","id":"section-non-finite","blocks":[{"kind":"paragraph","id":"paragraph-non-finite","properties":{"scale":1e999},"runs":[]}]}]}'
    const input = createStoredJWordPackage({ documentText })
    const validation = await validateJWordPackage(input)
    const document = {
      kind: 'document',
      id: 'document-non-finite-save',
      sections: [{
        kind: 'section',
        id: 'section-non-finite-save',
        blocks: [{
          kind: 'paragraph',
          id: 'paragraph-non-finite-save',
          properties: { scale: Number.POSITIVE_INFINITY },
          runs: []
        }]
      }]
    } as Document

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID'
    }))
    await expect(loadJWordDocument(input)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID'
    })
    await expect(saveJWordDocument(document)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      message: 'JWORD_NATIVE_DOCUMENT_INVALID'
    })
  })

  it('exposes a normalized schema path through validate and load diagnostics', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-path-diagnostic',
        sections: [{
          kind: 'section',
          id: 'section-path-diagnostic',
          blocks: {}
        }]
      })
    })

    const validation = await validateJWordPackage(input)

    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      entry: 'document.json',
      path: '/sections/0/blocks'
    }))
    await expect(loadJWordDocument(input)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      entry: 'document.json',
      path: '/sections/0/blocks'
    })
  })

  it('safely encodes dot-segment resource IDs and roundtrips them', async () => {
    const resources = ['.', '..'].map((id): Resource => ({
      kind: 'resource',
      id,
      mime: 'application/octet-stream',
      source: {
        kind: 'dataUrl',
        url: 'data:application/octet-stream;base64,QQ=='
      },
      status: 'success'
    }))
    const document: Document = {
      kind: 'document',
      id: 'document-native-dot-resource-ids',
      resourceIds: resources.map((resource) => resource.id),
      resources,
      sections: []
    }
    const saved = await saveJWordDocument(document)
    const loaded = await loadJWordDocument(saved.bytes)

    expect(saved.manifest.resources.map((resource) => resource.path)).toEqual([
      'resources/%2E',
      'resources/%2E%2E'
    ])
    expect(loaded.document.resources).toEqual(resources)
  })

  it.each([
    [
      'nested type',
      {
        kind: 'document',
        id: 'document-forged-save-structure',
        sections: [{
          kind: 'section',
          id: 'section-forged-save-structure',
          blocks: {}
        }]
      },
      'JWORD_NATIVE_DOCUMENT_INVALID'
    ],
    [
      'duplicate block ID',
      {
        kind: 'document',
        id: 'document-duplicate-save-block',
        sections: [{
          kind: 'section',
          id: 'section-duplicate-save-block',
          blocks: ['first', 'second'].map(() => ({
            kind: 'paragraph',
            id: 'duplicate-save-block',
            runs: []
          }))
        }]
      },
      'JWORD_NATIVE_DOCUMENT_INVALID'
    ],
    [
      'missing resource reference',
      {
        kind: 'document',
        id: 'document-missing-save-resource',
        resourceIds: ['missing-save-resource'],
        sections: []
      },
      'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING'
    ]
  ] as const)('rejects a forged document %s before saving package entries', async (_label, input, code) => {
    const document = input as unknown as Document

    await expect(saveJWordDocument(document)).rejects.toMatchObject({ code })
  })

  it('accepts metadata at the fixed byte limit and rejects the first byte over it', async () => {
    const document: Document = {
      kind: 'document',
      id: 'document-native-metadata-budget',
      sections: []
    }
    const metadata = createMetadataAtByteLength(1024 * 1024)
    const saved = await saveJWordDocument(document, { metadata })

    await expect(loadJWordDocument(saved.bytes)).resolves.toMatchObject({ metadata })
    await expect(saveJWordDocument(document, {
      metadata: {
        ...metadata,
        payload: `${String(metadata.payload)}x`
      }
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    })
  })
})

interface AnchorOverrides {
  readonly documentId?: string
  readonly sectionId?: string
  readonly blockId?: string
  readonly runId?: string
}

/** 创建含两个可用于归属链校验的段落位置的文档。 */
function createAnchoredDocument(comments: NonNullable<Document['comments']>): Document {
  return {
    kind: 'document',
    id: 'document-anchor-schema',
    sections: [
      createAnchorSection('a'),
      createAnchorSection('b')
    ],
    comments
  }
}

/** 创建一个包含单段落和单 run 的 anchor section。 */
function createAnchorSection(suffix: string): Document['sections'][number] {
  return {
    kind: 'section',
    id: `section-anchor-${suffix}`,
    blocks: [{
      kind: 'paragraph',
      id: `paragraph-anchor-${suffix}`,
      runs: [{
        kind: 'run',
        id: `run-anchor-${suffix}`,
        inlines: []
      }]
    }]
  }
}

/** 创建使用指定 range 与 anchor 覆盖值的 comment thread。 */
function createComment(
  id: string,
  rangeId: string,
  overrides: AnchorOverrides = {}
): NonNullable<Document['comments']>[number] {
  const anchor = {
    documentId: overrides.documentId ?? 'document-anchor-schema',
    sectionId: overrides.sectionId ?? 'section-anchor-a',
    blockId: overrides.blockId ?? 'paragraph-anchor-a',
    runId: overrides.runId ?? 'run-anchor-a',
    graphemeIndex: 0,
    relativePosition: {}
  }

  return {
    kind: 'commentThread',
    id,
    authorId: 'author-anchor-schema',
    createdAt: '2026-07-18T00:00:00.000Z',
    anchorRangeId: rangeId,
    resolved: false,
    rangeSnapshot: {
      id: rangeId,
      anchor,
      focus: anchor
    },
    messages: []
  }
}

/** 断言无效 document 在三个公开 seam 上返回同一稳定 code。 */
async function expectDocumentRejected(
  document: Document,
  code: JWordPackageErrorCode
): Promise<void> {
  const input = createStoredJWordPackage({ documentText: JSON.stringify(document) })
  const validation = await validateJWordPackage(input)

  expect(validation.valid).toBe(false)
  expect(validation.diagnostics).toHaveLength(1)
  expect(validation.diagnostics[0]?.code).toBe(code)
  await expect(loadJWordDocument(input)).rejects.toMatchObject({ code })
  await expect(saveJWordDocument(document)).rejects.toMatchObject({ code })
}

/** 创建序列化后恰好达到指定 UTF-8 byte 长度的 metadata。 */
function createMetadataAtByteLength(byteLength: number): Readonly<Record<string, unknown>> {
  const base = {
    createdAt: '',
    modifiedAt: '',
    application: '',
    payload: ''
  }
  const emptyLength = new TextEncoder().encode(`${JSON.stringify(base, null, 2)}\n`).byteLength

  return {
    ...base,
    payload: 'x'.repeat(byteLength - emptyLength)
  }
}
