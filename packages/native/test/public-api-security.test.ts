/**
 * @vitest-environment node
 *
 * 职责：通过 native 公开 API 锁定 Phase 2A 不可信 package 的安全行为。
 * 边界：不调用内部 reader/helper，不提交大型二进制 fixture。
 * 协作模块：packages/native/src/index.ts 和 native-package-security-fixtures.ts。
 * 性能/安全约束：恶意 ZIP 在测试运行时动态生成。
 * 实现说明：每个失败输入同时覆盖 validate 返回与 load 抛错 seam。
 */

import { describe, expect, it } from 'vitest'

import {
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage
} from '../src/index'
import {
  createStoredJWordPackage,
  type StoredJWordPackageOptions
} from './native-package-security-fixtures'
import { expectPublicPackageCode } from './public-api-security-assertions'

describe('@4xian/jword-native public security seam', () => {
  it.each([
    ['oversized metadata JSON', 'oversized-metadata'],
    ['forged declared size with continuing output', 'forged-document-output']
  ] as const)('rejects %s with the stable resource limit code', async (_label, malformed) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ malformed }),
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    )
  })

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid checksum byteLength %s through both public seams',
    async (byteLength) => {
      await expectPublicPackageCode(
        createStoredJWordPackage({
          checksumEntries: {
            'document.json': {
              sha256: '0'.repeat(64),
              byteLength,
              mime: 'application/json'
            }
          }
        }),
        'JWORD_NATIVE_CHECKSUMS_INVALID'
      )
    }
  )

  it('rejects checksum hashes outside lowercase SHA-256 hex', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        checksumEntries: {
          'document.json': {
            sha256: 'A'.repeat(64),
            byteLength: 67,
            mime: 'application/json'
          }
        }
      }),
      'JWORD_NATIVE_CHECKSUMS_INVALID'
    )
  })

  it('rejects checksum MIME containing only whitespace', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        checksumEntries: {
          'document.json': {
            sha256: '0'.repeat(64),
            byteLength: 67,
            mime: '   '
          }
        }
      }),
      'JWORD_NATIVE_CHECKSUMS_INVALID'
    )
  })

  it('rejects checksum keys outside core entries and packed resources', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        checksumEntries: {
          'hidden.bin': {
            sha256: '0'.repeat(64),
            byteLength: 0,
            mime: 'application/octet-stream'
          }
        }
      }),
      'JWORD_NATIVE_CHECKSUMS_INVALID'
    )
  })

  it('rejects checksum item counts above the fixed budget', async () => {
    const checksumEntries = Object.fromEntries(Array.from({ length: 1025 }, (_, index) => [
      `hidden-${index}`,
      {
        sha256: '0'.repeat(64),
        byteLength: 0,
        mime: 'application/octet-stream'
      }
    ]))

    await expectPublicPackageCode(
      createStoredJWordPackage({ checksumEntries }),
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    )
  })

  it('rejects decoded duplicate checksum entry keys before JSON.parse', async () => {
    const checksum = '{"sha256":"0000000000000000000000000000000000000000000000000000000000000000","byteLength":0,"mime":"application/json"}'

    await expectPublicPackageCode(
      createStoredJWordPackage({
        checksumsText: `{"entries":{"document.json":${checksum},"document\\u002ejson":${checksum}}}`
      }),
      'JWORD_NATIVE_CHECKSUMS_INVALID'
    )
  })

  it.each([
    [
      'manifest resource object',
      {
        manifestText: createManifestJson('[{"id":"resource-a","\\u0069d":"resource-b","mime":"image/png","packed":false}]')
      },
      'JWORD_NATIVE_MANIFEST_INVALID'
    ],
    [
      'checksum entry object',
      {
        checksumsText: createChecksumsJson(
          '"sha256":"0000000000000000000000000000000000000000000000000000000000000000","\\u0073ha256":"0000000000000000000000000000000000000000000000000000000000000000","byteLength":0,"mime":"application/json"'
        )
      },
      'JWORD_NATIVE_CHECKSUMS_INVALID'
    ]
  ] as const)('rejects decoded duplicate keys in a nested %s', async (_label, options, code) => {
    await expectPublicPackageCode(
      createStoredJWordPackage(options as StoredJWordPackageOptions),
      code
    )
  })

  it('rejects declared checksum length before decompressing the large target entry', async () => {
    const input = createStoredJWordPackage({
      documentChecksumByteLengthDelta: -1,
      documentPaddingBytes: 512 * 1024
    })
    const validateProgress: number[] = []
    const validation = await validateJWordPackage(input, {
      /** 记录 validate 在 hash mismatch 前接受的输出。 */
      onProgress(event) {
        validateProgress.push(event.loaded)
      }
    })

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toHaveLength(1)
    expect(validation.diagnostics[0]?.code).toBe('JWORD_NATIVE_HASH_MISMATCH')
    expect(Math.max(...validateProgress)).toBeLessThan(64 * 1024)

    const loadProgress: number[] = []
    await expect(loadJWordDocument(input, {
      /** 记录 load 在 hash mismatch 前接受的输出。 */
      onProgress(event) {
        loadProgress.push(event.loaded)
      }
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_HASH_MISMATCH'
    })
    expect(Math.max(...loadProgress)).toBeLessThan(64 * 1024)
  })

  it('returns only the first terminal code when checksum and format both fail', async () => {
    const input = createStoredJWordPackage({
      checksumEntries: {
        'document.json': {
          sha256: '0'.repeat(64),
          byteLength: 73,
          mime: 'application/json'
        }
      },
      manifestOverrides: {
        formatVersion: 999
      }
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_HASH_MISMATCH')
  })

  it('rejects a section whose blocks field is not an array', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-invalid-section-blocks',
        sections: [{
          kind: 'section',
          id: 'section-invalid-blocks',
          blocks: {}
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it.each([
    [
      'block',
      [{ kind: 'unknown-block', id: 'unknown-block' }]
    ],
    [
      'inline',
      [{
        kind: 'paragraph',
        id: 'paragraph-unknown-inline',
        runs: [{
          kind: 'run',
          id: 'run-unknown-inline',
          inlines: [{ kind: 'unknown-inline' }]
        }]
      }]
    ]
  ] as const)('rejects an unknown %s kind', async (_label, blocks) => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-unknown-kind',
        sections: [{
          kind: 'section',
          id: 'section-unknown-kind',
          blocks
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it.each([
    [
      'block',
      {
        kind: 'document',
        id: 'document-duplicate-block',
        sections: [{
          kind: 'section',
          id: 'section-duplicate-block',
          blocks: ['first', 'second'].map(() => ({
            kind: 'paragraph',
            id: 'duplicate-document-block',
            runs: []
          }))
        }]
      }
    ],
    [
      'run',
      {
        kind: 'document',
        id: 'document-duplicate-run',
        sections: [{
          kind: 'section',
          id: 'section-duplicate-run',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-duplicate-run',
            runs: ['first', 'second'].map(() => ({
              kind: 'run',
              id: 'duplicate-document-run',
              inlines: []
            }))
          }]
        }]
      }
    ],
    [
      'resource',
      {
        kind: 'document',
        id: 'document-duplicate-resource',
        resources: ['first', 'second'].map((url) => ({
          kind: 'resource',
          id: 'duplicate-document-resource',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: `data:image/png;base64,${url}`
          },
          status: 'success'
        })),
        sections: []
      }
    ]
  ] as const)('rejects duplicate %s IDs in the document schema', async (_label, document) => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify(document)
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects decoded duplicate keys in document JSON before JSON.parse', async () => {
    const documentText = '{"kind":"document","id":"document-duplicate-json-key","sections":[{"kind":"section","id":"section-duplicate-json-key","blocks":[],"\\u0062locks":[]}]}'

    await expectPublicPackageCode(
      createStoredJWordPackage({ documentText }),
      'JWORD_NATIVE_DOCUMENT_INVALID'
    )
  })

  it.each([
    ['empty', ''],
    ['over 256 UTF-8 bytes', '界'.repeat(86)]
  ])('rejects an %s document ID', async (_label, id) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        documentText: JSON.stringify({
          kind: 'document',
          id,
          sections: []
        })
      }),
      'JWORD_NATIVE_DOCUMENT_INVALID'
    )
  })

  it('rejects an invalid blocks field in a table cell', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-invalid-table-cell',
        sections: [{
          kind: 'section',
          id: 'section-invalid-table-cell',
          blocks: [{
            kind: 'table',
            id: 'table-invalid-cell',
            rows: [{
              id: 'row-invalid-cell',
              cells: [{
                id: 'cell-invalid-blocks',
                blocks: {}
              }]
            }]
          }]
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects fractional section column counts', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-fractional-columns',
        sections: [{
          kind: 'section',
          id: 'section-fractional-columns',
          columns: 1.5,
          blocks: []
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects a comment marker that references a missing comment thread', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-missing-comment-reference',
        sections: [{
          kind: 'section',
          id: 'section-missing-comment-reference',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-missing-comment-reference',
            runs: [{
              kind: 'run',
              id: 'run-missing-comment-reference',
              inlines: [{
                kind: 'commentRangeMarker',
                commentId: 'missing-comment',
                edge: 'start'
              }]
            }]
          }]
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects an incomplete comment thread structure', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-incomplete-comment',
        sections: [],
        comments: [{
          kind: 'commentThread',
          id: 'incomplete-comment'
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it('rejects an incomplete revision metadata structure', async () => {
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-incomplete-revision',
        sections: [],
        revisions: [{
          kind: 'revision',
          id: 'incomplete-revision'
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_DOCUMENT_INVALID')
  })

  it.each([
    [
      'run revision',
      {
        kind: 'document',
        id: 'document-missing-run-revision',
        sections: [{
          kind: 'section',
          id: 'section-missing-run-revision',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-missing-run-revision',
            runs: [{
              kind: 'run',
              id: 'run-missing-run-revision',
              revisionId: 'missing-run-revision',
              inlines: []
            }]
          }]
        }]
      }
    ],
    [
      'format snapshot run',
      {
        kind: 'document',
        id: 'document-missing-format-run',
        sections: [{
          kind: 'section',
          id: 'section-missing-format-run',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-missing-format-run',
            runs: [{
              kind: 'run',
              id: 'run-existing-format-target',
              revisionId: 'revision-missing-format-run',
              inlines: []
            }]
          }]
        }],
        revisions: [{
          kind: 'revision',
          id: 'revision-missing-format-run',
          authorId: 'author-missing-format-run',
          createdAt: '2026-07-18T00:00:00.000Z',
          type: 'format',
          rangeId: 'range-missing-format-run',
          rangeSnapshot: createDocumentRangeSnapshot('range-missing-format-run'),
          summary: 'missing format run',
          formatSnapshots: [{
            runId: 'missing-format-run',
            previousProperties: {}
          }]
        }]
      }
    ]
  ] as const)('rejects a dangling %s reference', async (_label, document) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ documentText: JSON.stringify(document) }),
      'JWORD_NATIVE_DOCUMENT_INVALID'
    )
  })

  it('rejects an image whose resource is missing from the document', async () => {
    const input = createStoredJWordPackage({
      manifestOverrides: {
        resources: [{
          id: 'missing-document-image',
          mime: 'image/png',
          packed: false
        }]
      },
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-missing-image-resource',
        sections: [{
          kind: 'section',
          id: 'section-missing-image-resource',
          blocks: [{
            kind: 'paragraph',
            id: 'paragraph-missing-image-resource',
            runs: [{
              kind: 'run',
              id: 'run-missing-image-resource',
              inlines: [{
                kind: 'image',
                resourceId: 'missing-document-image'
              }]
            }]
          }]
        }]
      })
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING')
  })

  /** 验证攻击者控制的缺失资源标识不会进入公开诊断。 */
  it.each(['validate', 'load'] as const)('does not expose a missing attacker-controlled resourceId through the public %s seam', async (seam) => {
    const resourceId = '../../attacker/entry'
    const input = createStoredJWordPackage({
      documentText: JSON.stringify({
        kind: 'document',
        id: 'document-missing-attacker-resource',
        resourceIds: [resourceId],
        resources: [{
          kind: 'resource',
          id: resourceId,
          mime: 'image/png',
          source: {
            kind: 'externalUrl',
            url: 'https://example.invalid/attacker.png'
          },
          status: 'success'
        }],
        sections: []
      })
    })
    let publicDiagnostic: unknown

    if (seam === 'validate') {
      const validation = await validateJWordPackage(input)
      expect(validation.valid).toBe(false)
      publicDiagnostic = validation.diagnostics.find(
        (diagnostic) => diagnostic.code === 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING'
      )
      expect(JSON.stringify(validation.diagnostics)).not.toContain(resourceId)
    } else {
      try {
        await loadJWordDocument(input)
      } catch (error) {
        publicDiagnostic = error
      }
    }

    expect(publicDiagnostic).toMatchObject({
      code: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      message: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      entry: 'document.json'
    })
    expect(JSON.stringify(publicDiagnostic)).not.toContain(resourceId)
  })

  it('rejects metadata beyond the fixed JSON depth on read and save', async () => {
    const metadata = createNestedRecord(65)

    await expectPublicPackageCode(
      createStoredJWordPackage({ metadataText: JSON.stringify(metadata) }),
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    )
    await expect(saveJWordDocument({
      kind: 'document',
      id: 'document-deep-save-metadata',
      sections: []
    }, { metadata })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    })
  })

  it.each([
    ['formatVersion', 1.5],
    ['schemaVersion', -1],
    ['minimumReaderVersion', Number.MAX_SAFE_INTEGER + 1]
  ] as const)('rejects invalid manifest %s before support checks', async (field, value) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ manifestOverrides: { [field]: value } }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects decoded duplicate keys in manifest JSON before JSON.parse', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestText: '{"formatVersion":1,"\\u0066ormatVersion":1,"schemaVersion":1,"createdBy":"@4xian/jword-native","minimumReaderVersion":1,"featureFlags":[],"packageEntries":["manifest.json","document.json","metadata.json","checksums.json","resources/"],"resources":[]}'
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects the whole manifest when a resource field has an invalid type', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          resources: [{
            id: 7,
            mime: 'image/png',
            packed: false
          }]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects packed manifest resources without a path', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          resources: [{
            id: 'image-missing-path',
            mime: 'image/png',
            packed: true
          }]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects nested packed resource paths in the manifest', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        checksumEntries: {},
        manifestOverrides: {
          packageEntries: [
            'manifest.json',
            'document.json',
            'metadata.json',
            'checksums.json',
            'resources/',
            'resources/nested/file'
          ],
          resources: [{
            id: 'image-nested-path',
            path: 'resources/nested/file',
            mime: 'image/png',
            packed: true
          }]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it.each([
    ['path on unpacked resource', { id: 'unpacked-path', path: 'resources/unpacked-path', mime: 'image/png', packed: false }],
    ['empty packed filename', { id: 'empty-path', path: 'resources/', mime: 'image/png', packed: true }],
    ['core entry packed path', { id: 'core-path', path: 'document.json', mime: 'image/png', packed: true }],
    ['dot-segment packed path', { id: 'dot-path', path: 'resources/.', mime: 'image/png', packed: true }],
    ['undeclared packed path', { id: 'undeclared-path', path: 'resources/undeclared', mime: 'image/png', packed: true }]
  ] as const)('rejects manifest resource with %s', async (_label, resource) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ manifestOverrides: { resources: [resource] } }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects manifest resource MIME containing only whitespace', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          resources: [{
            id: 'image-empty-mime',
            mime: '  ',
            packed: false
          }]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects duplicate manifest packageEntries', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          packageEntries: [
            'manifest.json',
            'document.json',
            'document.json',
            'metadata.json',
            'checksums.json',
            'resources/'
          ]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects manifest packageEntries above the fixed item budget', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          packageEntries: Array.from({ length: 1025 }, (_, index) => `entry-${index}`)
        }
      }),
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    )
  })

  it('rejects duplicate manifest resource IDs', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          resources: [
            { id: 'duplicate-resource', mime: 'image/png', packed: false },
            { id: 'duplicate-resource', mime: 'image/jpeg', packed: false }
          ]
        }
      }),
      'JWORD_NATIVE_MANIFEST_INVALID'
    )
  })

  it('rejects duplicate packed resource paths', async () => {
    const path = 'resources/duplicate-path'
    const input = createStoredJWordPackage({
      manifestOverrides: {
        packageEntries: [
          'manifest.json',
          'document.json',
          'metadata.json',
          'checksums.json',
          'resources/',
          path
        ],
        resources: [
          { id: 'resource-a', path, mime: 'image/png', packed: true },
          { id: 'resource-b', path, mime: 'image/png', packed: true }
        ]
      }
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_MANIFEST_INVALID')
  })

  it('rejects NFC-normalized packageEntries conflicts', async () => {
    const input = createStoredJWordPackage({
      manifestOverrides: {
        packageEntries: [
          'manifest.json',
          'document.json',
          'metadata.json',
          'checksums.json',
          'resources/',
          'resources/\u00e9',
          'resources/e\u0301'
        ]
      }
    })

    await expectPublicPackageCode(input, 'JWORD_NATIVE_MANIFEST_INVALID')
  })

  it('rejects manifest resources above the fixed item budget', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({
        manifestOverrides: {
          resources: Array.from({ length: 1025 }, (_, index) => ({
            id: `resource-${index}`,
            mime: 'application/octet-stream',
            packed: false
          }))
        }
      }),
      'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    )
  })

  it('rejects oversized Blob input before materializing its ArrayBuffer', async () => {
    let materialized = false
    const input = {
      size: 64 * 1024 * 1024 + 1,
      /** 标记超大 Blob 是否被错误物化。 */
      async arrayBuffer() {
        materialized = true
        return new ArrayBuffer(0)
      }
    } as Blob
    const validation = await validateJWordPackage(input)

    expect(materialized).toBe(false)
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toHaveLength(1)
    expect(validation.diagnostics[0]?.code).toBe('JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED')
    await expect(loadJWordDocument(input)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    })
    expect(materialized).toBe(false)
  })

  it('stops actual document output at the production limit and does not grow after rejection', async () => {
    const input = createStoredJWordPackage({ malformed: 'document-output-limit' })
    const validateProgress: number[] = []
    const validateStartedAt = Date.now()
    const validation = await validateJWordPackage(input, {
      /** 记录 validate 在输出上限前接受的正数进度。 */
      onProgress(event) {
        if (event.loaded > 0) {
          validateProgress.push(event.loaded)
        }
      }
    })
    const validateSettledIn = Date.now() - validateStartedAt
    const validateSnapshot = [...validateProgress]

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toHaveLength(1)
    expect(validation.diagnostics[0]?.code).toBe('JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED')
    expect(validateProgress.length).toBeGreaterThan(0)
    expect(Math.max(...validateProgress)).toBeLessThanOrEqual(20 * 1024 * 1024)
    expect(validateSettledIn).toBeLessThan(2000)
    await waitForOutputStopObservation()
    expect(validateProgress).toEqual(validateSnapshot)

    const loadProgress: number[] = []
    const loadStartedAt = Date.now()
    const loadPromise = loadJWordDocument(input, {
      /** 记录 load 在输出上限前接受的正数进度。 */
      onProgress(event) {
        if (event.loaded > 0) {
          loadProgress.push(event.loaded)
        }
      }
    })

    await expect(loadPromise).rejects.toMatchObject({
      code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
    })
    expect(Date.now() - loadStartedAt).toBeLessThan(2000)
    const loadSnapshot = [...loadProgress]

    await waitForOutputStopObservation()
    expect(loadProgress).toEqual(loadSnapshot)
  })

})

/** 创建 revision schema 回归使用的稳定 range snapshot。 */
function createDocumentRangeSnapshot(id: string): Readonly<Record<string, unknown>> {
  const anchor = {
    documentId: 'document-missing-format-run',
    sectionId: 'section-missing-format-run',
    blockId: 'paragraph-missing-format-run',
    runId: 'run-existing-format-target',
    graphemeIndex: 0,
    relativePosition: {}
  }

  return {
    id,
    anchor,
    focus: anchor
  }
}

/** 创建指定 JSON object 深度的小型 metadata。 */
function createNestedRecord(depth: number): Readonly<Record<string, unknown>> {
  let record: Readonly<Record<string, unknown>> = {}

  for (let index = 0; index < depth; index += 1) {
    record = { value: record }
  }

  return record
}

/** 等待固定观察窗口以确认拒绝后不再接受输出。 */
function waitForOutputStopObservation(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 100)
  })
}

/** 创建只替换 resources 文本的原始 manifest JSON。 */
function createManifestJson(resources: string): string {
  return `{"formatVersion":1,"schemaVersion":1,"createdBy":"@4xian/jword-native","minimumReaderVersion":1,"featureFlags":[],"packageEntries":["manifest.json","document.json","metadata.json","checksums.json","resources/"],"resources":${resources}}`
}

/** 创建只替换 document checksum 字段文本的原始 checksums JSON。 */
function createChecksumsJson(fields: string): string {
  return `{"entries":{"document.json":{${fields}}}}`
}
