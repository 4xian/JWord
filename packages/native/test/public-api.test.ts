/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 4.5 原生 .jword 公开保存、打开、校验契约。
 * 边界：只验证 native 包公开 API，不接入 vanilla demo，也不导入 DOCX/PDF/collab。
 * 协作模块：packages/native/src/index.ts、core createEditor/loadDocumentModel、fixtures/native。
 * 约束：测试使用最小样例覆盖关键路径，损坏资源和 schema 兼容由稳定诊断判定。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { describe, expect, it, vi } from 'vitest'
import JSZip from 'jszip'

import {
  createEditor,
  type Document,
  type Resource
} from '@4xian/jword-core'

import {
  loadJWordDocument,
  saveJWordDocument,
  validateJWordPackage,
  type JWordPackageWarning
} from '../src/index'

describe('@4xian/jword-native public API', () => {
  it('writes fixed package entries and validates the generated package', async () => {
    const result = await saveJWordDocument(createTextDocument('document-native-entry', '原生保存'))
    const zip = await JSZip.loadAsync(result.bytes)
    const validation = await validateJWordPackage(result.bytes)

    expect(Object.keys(zip.files).sort()).toEqual([
      'checksums.json',
      'document.json',
      'manifest.json',
      'metadata.json',
      'resources/'
    ])
    expect(result.manifest).toMatchObject({
      formatVersion: 2,
      schemaVersion: 2,
      minimumReaderVersion: 2,
      packageEntries: [
        'manifest.json',
        'document.json',
        'metadata.json',
        'checksums.json',
        'resources/'
      ]
    })
    expect(validation.valid).toBe(true)
    expect(validation.diagnostics).toEqual([])
  })

  it('roundtrips save to load to save and restores through editor.loadDocumentModel', async () => {
    const sourceEditor = createEditor({ initialText: '第一段' })
    const firstSave = await saveJWordDocument(sourceEditor, {
      metadata: {
        title: 'roundtrip'
      }
    })
    const loaded = await loadJWordDocument(firstSave.bytes)
    const targetEditor = createEditor({ initialText: '旧内容' })
    const projection = targetEditor.loadDocumentModel({ document: loaded.document })
    const secondSave = await saveJWordDocument(projection)
    const secondLoaded = await loadJWordDocument(secondSave.bytes)

    expect(loaded.metadata.title).toBe('roundtrip')
    expect(projection.document).toEqual(loaded.document)
    expect(secondLoaded.document).toEqual(loaded.document)

    sourceEditor.destroy()
    targetEditor.destroy()
  })

  it('preserves current rich canonical model fields through native roundtrip', async () => {
    const source = createRichDocument()
    const firstSave = await saveJWordDocument(source)
    const loaded = await loadJWordDocument(firstSave.bytes)
    const secondSave = await saveJWordDocument(loaded.document)
    const reloaded = await loadJWordDocument(secondSave.bytes)

    expect(loaded.document).toEqual(source)
    expect(reloaded.document).toEqual(source)
  })

  it('packs dataUrl resources with checksums and warns for unpacked resource sources', async () => {
    const packedResource = createPngResource('image-packed', 'data:image/png;base64,QUJDRA==')
    const externalResource: Resource = {
      kind: 'resource',
      id: 'image-external',
      mime: 'image/png',
      source: {
        kind: 'externalUrl',
        url: 'https://example.invalid/image.png'
      },
      status: 'success'
    }
    const save = await saveJWordDocument(createImageDocument([packedResource, externalResource]), {
      requestId: 'native-resource-save'
    })
    const zip = await JSZip.loadAsync(save.bytes)
    const checksums = JSON.parse(await zip.file('checksums.json')?.async('string') ?? '{}') as {
      readonly entries: Record<string, { readonly mime: string, readonly byteLength: number, readonly sha256: string }>
    }
    const packageDocument = JSON.parse(await zip.file('document.json')?.async('string') ?? '{}') as Document
    const loaded = await loadJWordDocument(save.bytes)
    const secondSave = await saveJWordDocument(loaded.document)
    const secondZip = await JSZip.loadAsync(secondSave.bytes)
    const secondDocumentJson = await secondZip.file('document.json')?.async('string') ?? ''
    const secondPackageDocument = JSON.parse(secondDocumentJson) as Document

    expect(zip.file('resources/image-packed')).not.toBeNull()
    expect(zip.file('resources/image-external')).toBeNull()
    expect(checksums.entries['resources/image-packed']).toMatchObject({
      mime: 'image/png',
      byteLength: 4
    })
    expect(save.warnings.map(readWarningCode)).toContain('JWORD_NATIVE_RESOURCE_UNPACKED')
    expect(packageDocument.resources?.[0]?.source).toEqual({
      kind: 'packedResource',
      url: 'resources/image-packed'
    })
    expect(loaded.document.resources?.[0]?.source).toEqual({
      kind: 'dataUrl',
      url: 'data:image/png;base64,QUJDRA=='
    })
    expect(secondPackageDocument.resources?.[0]?.source).toEqual({
      kind: 'packedResource',
      url: 'resources/image-packed'
    })
    expect(secondDocumentJson).not.toContain('QUJDRA==')
    expect(loaded.resources).toEqual([
      {
        id: 'image-packed',
        path: 'resources/image-packed',
        mime: 'image/png',
        byteLength: 4,
        packed: true
      },
      {
        id: 'image-external',
        mime: 'image/png',
        packed: false
      }
    ])
  })

  /** 验证格式 1 的内联 source 与 packed entry 仍按旧 reader 语义加载。 */
  it('loads legacy format 1 resource packages without exposing logical references', async () => {
    const legacyPackage = await createLegacyFormat1ResourcePackage()
    const loaded = await loadJWordDocument(legacyPackage)
    const missingPackage = await removeZipEntry(legacyPackage, 'resources/image-legacy-format-1')
    const missingLoaded = await loadJWordDocument(missingPackage)

    expect(loaded.document.resources?.[0]?.source).toEqual({
      kind: 'dataUrl',
      url: 'data:image/png;base64,QUJDRA=='
    })
    expect(loaded.migrationReport).toMatchObject({
      sourceVersion: 1,
      targetVersion: 2,
      appliedSteps: ['schema-1-to-2']
    })
    expect(missingLoaded.document.resources?.[0]?.source).toEqual({
      kind: 'dataUrl',
      url: 'data:image/png;base64,QUJDRA=='
    })
    expect(missingLoaded.warnings.map(readWarningCode)).toContain('JWORD_NATIVE_RESOURCE_MISSING')
  })

  it.each([
    ['percent encoding', 'data:image/png,%E0%A4%A'],
    ['base64', 'data:image/png;base64,%%%']
  ] as const)('maps invalid data URL %s to a stable document error', async (_label, url) => {
    await expect(saveJWordDocument(createImageDocument([
      createPngResource('image-invalid-data-url', url)
    ]), {
      requestId: 'native-invalid-data-url'
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID',
      message: 'JWORD_NATIVE_DOCUMENT_INVALID',
      requestId: 'native-invalid-data-url',
      entry: 'document.json'
    })
  })

  it('packs blobUrl resources from nativeBytesBase64 metadata fallback', async () => {
    const resource: Resource = {
      kind: 'resource',
      id: 'image-blob-fallback',
      mime: 'image/png',
      source: {
        kind: 'blobUrl',
        url: 'blob:https://example.invalid/native-image'
      },
      status: 'success',
      metadata: {
        nativeBytesBase64: 'QUJDRA=='
      }
    }
    const save = await saveJWordDocument(createImageDocument([resource]), {
      requestId: 'native-blob-fallback-save'
    })
    const zip = await JSZip.loadAsync(save.bytes)
    const packageDocumentJson = await zip.file('document.json')?.async('string') ?? ''
    const packageDocument = JSON.parse(packageDocumentJson) as Document
    const validation = await validateJWordPackage(save.bytes)
    const loaded = await loadJWordDocument(save.bytes)

    expect(zip.file('resources/image-blob-fallback')).not.toBeNull()
    expect(save.warnings).toEqual([])
    expect(validation.valid).toBe(true)
    expect(validation.diagnostics).toEqual([])
    expect(packageDocument.resources?.[0]?.source).toEqual({
      kind: 'packedResource',
      url: 'resources/image-blob-fallback'
    })
    expect(packageDocumentJson).not.toContain('nativeBytesBase64')
    expect(packageDocumentJson).not.toContain('QUJDRA==')
    expect(loaded.document.resources?.[0]?.source).toEqual({
      kind: 'dataUrl',
      url: 'data:image/png;base64,QUJDRA=='
    })
    expect(loaded.resources).toEqual([
      {
        id: 'image-blob-fallback',
        path: 'resources/image-blob-fallback',
        mime: 'image/png',
        byteLength: 4,
        packed: true
      }
    ])
  })

  /** 验证无 fallback bytes 的 blob URL 被稳定拒绝且不会触发网络读取。 */
  it('rejects blobUrl resources without fallback bytes and does not fetch the URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const resource: Resource = {
      kind: 'resource',
      id: 'image-blob-without-bytes',
      mime: 'image/png',
      source: {
        kind: 'blobUrl',
        url: 'blob:https://example.invalid/no-fallback'
      },
      status: 'success'
    }

    try {
      await expect(saveJWordDocument(createImageDocument([resource]), {
        requestId: 'native-blob-without-bytes'
      })).rejects.toMatchObject({
        code: 'JWORD_NATIVE_DOCUMENT_INVALID',
        message: 'JWORD_NATIVE_DOCUMENT_INVALID',
        requestId: 'native-blob-without-bytes',
        entry: 'document.json'
      })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  /** 验证运行时 data URL 预算在首次 base64 分配前执行。 */
  it('rejects data URL materialization before base64 allocation exceeds the total budget', async () => {
    const save = await saveJWordDocument(createImageDocument([
      createPngResource('image-budget-a', 'data:image/png;base64,QQ=='),
      createPngResource('image-budget-b', 'data:image/png;base64,QQ==')
    ]))
    const zip = await JSZip.loadAsync(save.bytes)
    const checksums = JSON.parse(await zip.file('checksums.json')?.async('string') ?? '{}') as {
      entries: Record<string, { mime: string, byteLength: number, sha256: string }>
    }
    const resourceBytes = new Uint8Array(30 * 1024 * 1024)
    const resourceHash = await sha256ForTest(resourceBytes)

    for (const path of ['resources/image-budget-a', 'resources/image-budget-b']) {
      zip.file(path, resourceBytes)
      checksums.entries[path] = {
        mime: 'image/png',
        byteLength: resourceBytes.byteLength,
        sha256: resourceHash
      }
    }

    zip.file('checksums.json', JSON.stringify(checksums, null, 2))

    const oversizedMaterializationPackage = await zip.generateAsync({ type: 'uint8array' })
    const btoaSpy = vi.spyOn(globalThis, 'btoa')

    try {
      await expect(loadJWordDocument(oversizedMaterializationPackage)).rejects.toMatchObject({
        code: 'JWORD_NATIVE_PACKAGE_RESOURCE_LIMIT_EXCEEDED'
      })
      expect(btoaSpy).not.toHaveBeenCalled()
    } finally {
      btoaSpy.mockRestore()
    }
  })

  /** 验证格式 2 的逻辑资源缺失与 checksum 损坏均不可恢复。 */
  it('rejects missing logical packed resources and hash mismatches as corrupt errors', async () => {
    const save = await saveJWordDocument(createImageDocument([
      createPngResource('image-missing', 'data:image/png;base64,QUJDRA==')
    ]))
    const missingPackage = await removeZipEntry(save.bytes, 'resources/image-missing')
    const missingValidation = await validateJWordPackage(missingPackage)
    const corruptPackage = await overwriteZipEntry(save.bytes, 'resources/image-missing', new Uint8Array([1, 2, 3]))

    expect(missingValidation.valid).toBe(false)
    expect(missingValidation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      recoverable: false
    }))
    expect(JSON.stringify(missingValidation.diagnostics)).not.toContain('resources/image-missing')
    await expect(loadJWordDocument(missingPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING'
    })
    await expect(loadJWordDocument(corruptPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_HASH_MISMATCH'
    })
  })

  it('uses stable diagnostic codes as public message values', async () => {
    const save = await saveJWordDocument(createTextDocument('document-native-stable-message', 'stable message'))
    const missingManifestPackage = await removeZipEntry(save.bytes, 'manifest.json')
    const validation = await validateJWordPackage(missingManifestPackage)

    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_MANIFEST_MISSING',
      message: 'JWORD_NATIVE_MANIFEST_MISSING'
    }))
    await expect(loadJWordDocument(missingManifestPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_MANIFEST_MISSING',
      message: 'JWORD_NATIVE_MANIFEST_MISSING'
    })

    const controller = new AbortController()

    controller.abort()

    await expect(saveJWordDocument(createTextDocument('document-native-stable-cancel', 'cancel'), {
      signal: controller.signal
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      message: 'JWORD_NATIVE_USER_CANCELLED'
    })
  })

  it('rejects incompatible manifest versions and incomplete package entry declarations', async () => {
    const save = await saveJWordDocument(createTextDocument('document-native-manifest-integrity', 'manifest'))
    const unsupportedFormatPackage = await replaceZipJsonEntry(save.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      formatVersion: 999
    }))
    const futureReaderPackage = await replaceZipJsonEntry(save.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      minimumReaderVersion: 999
    }))
    const missingPackageEntry = await replaceZipJsonEntry(save.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      packageEntries: ['manifest.json', 'document.json', 'metadata.json']
    }))
    const logicalReferenceSave = await saveJWordDocument(createImageDocument([
      createPngResource('image-format-2-only', 'data:image/png;base64,QQ==')
    ]))
    const legacyLogicalReferencePackage = await replaceZipJsonEntry(logicalReferenceSave.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      formatVersion: 1,
      minimumReaderVersion: 1
    }))

    expect((await validateJWordPackage(unsupportedFormatPackage)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_FORMAT_UNSUPPORTED',
      message: 'JWORD_NATIVE_FORMAT_UNSUPPORTED',
      recoverable: false
    }))
    expect((await validateJWordPackage(futureReaderPackage)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_READER_UNSUPPORTED',
      recoverable: false
    }))
    expect((await validateJWordPackage(missingPackageEntry)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_PACKAGE_ENTRY_MISSING',
      entry: 'checksums.json',
      recoverable: false
    }))
    await expect(loadJWordDocument(unsupportedFormatPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_FORMAT_UNSUPPORTED'
    })
    await expect(loadJWordDocument(legacyLogicalReferencePackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_DOCUMENT_INVALID'
    })
  })

  it('reports corrupted metadata with metadata-specific diagnostics', async () => {
    const save = await saveJWordDocument(createTextDocument('document-native-metadata-invalid', 'metadata'))
    const zip = await JSZip.loadAsync(save.bytes)
    const metadataText = await zip.file('metadata.json')?.async('string') ?? ''
    const invalidMetadata = `["${'x'.repeat(metadataText.length - 4)}"]`
    const corruptedMetadataPackage = await overwriteZipEntry(
      save.bytes,
      'metadata.json',
      new TextEncoder().encode(invalidMetadata)
    )
    const validation = await validateJWordPackage(corruptedMetadataPackage)

    expect(validation.diagnostics).toHaveLength(1)
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_METADATA_INVALID',
      entry: 'metadata.json',
      recoverable: false
    }))
    await expect(loadJWordDocument(corruptedMetadataPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_METADATA_INVALID',
      entry: 'metadata.json'
    })
  })

  it('rejects mismatched resource MIME and missing document resource references', async () => {
    const save = await saveJWordDocument(createImageDocument([
      createPngResource('image-integrity', 'data:image/png;base64,QUJDRA==')
    ]))
    const mimeMismatchPackage = await replaceZipJsonEntry(save.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      resources: [{
        id: 'image-integrity',
        path: 'resources/image-integrity',
        mime: 'image/jpeg',
        packed: true
      }]
    }))
    const missingDocumentRef = {
      ...createTextDocument('document-native-missing-resource-ref', 'missing resource ref'),
      resourceIds: ['image-missing-from-manifest'],
      resources: []
    }
    const externalResource: Resource = {
      kind: 'resource',
      id: 'image-external-integrity',
      mime: 'image/png',
      source: {
        kind: 'externalUrl',
        url: 'https://example.invalid/integrity.png'
      },
      status: 'success'
    }
    const externalSave = await saveJWordDocument(createImageDocument([externalResource]))
    const externalMimeMismatchPackage = await replaceZipJsonEntry(
      externalSave.bytes,
      'manifest.json',
      (manifest) => ({
        ...manifest,
        resources: [{
          id: 'image-external-integrity',
          mime: 'image/jpeg',
          packed: false
        }]
      })
    )
    const extraManifestResourcePackage = await replaceZipJsonEntry(save.bytes, 'manifest.json', (manifest) => ({
      ...manifest,
      resources: [
        ...manifest.resources as readonly unknown[],
        {
          id: 'image-manifest-only',
          mime: 'image/png',
          packed: false
        }
      ]
    }))

    expect((await validateJWordPackage(mimeMismatchPackage)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_RESOURCE_MIME_MISMATCH',
      entry: 'document.json',
      recoverable: false
    }))
    expect((await validateJWordPackage(externalMimeMismatchPackage)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_RESOURCE_MIME_MISMATCH',
      entry: 'document.json',
      recoverable: false
    }))
    expect((await validateJWordPackage(extraManifestResourcePackage)).diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING',
      entry: 'document.json',
      recoverable: false
    }))
    await expect(saveJWordDocument(missingDocumentRef)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_RESOURCE_REFERENCE_MISSING'
    })
  })

  it('migrates old schema packages and rejects unsupported schema versions with diagnostics', async () => {
    const oldPackage = await createPackageWithSchemaVersion(0)
    const migrated = await loadJWordDocument(oldPackage)
    const oldValidation = await validateJWordPackage(oldPackage)
    const unsupportedOldPackage = await createPackageWithSchemaVersion(-1)
    const unsupportedValidation = await validateJWordPackage(unsupportedOldPackage)
    const futurePackage = await createPackageWithSchemaVersion(999)
    const validation = await validateJWordPackage(futurePackage)

    expect(migrated.migrationReport).toEqual({
      sourceVersion: 0,
      targetVersion: 2,
      appliedSteps: ['schema-0-to-1', 'schema-1-to-2'],
      warnings: [
        expect.objectContaining({
          code: 'JWORD_NATIVE_OLD_SCHEMA_MIGRATED'
        })
      ]
    })
    expect(oldValidation.valid).toBe(true)
    expect(oldValidation.warnings).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_OLD_SCHEMA_MIGRATED',
      message: 'JWORD_NATIVE_OLD_SCHEMA_MIGRATED'
    }))
    expect(oldValidation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_OLD_SCHEMA_MIGRATED'
    }))
    expect(unsupportedValidation.valid).toBe(false)
    expect(unsupportedValidation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_MANIFEST_INVALID',
      recoverable: false
    }))
    await expect(loadJWordDocument(unsupportedOldPackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_MANIFEST_INVALID'
    })
    expect(validation.valid).toBe(false)
    expect(validation.diagnostics).toContainEqual(expect.objectContaining({
      code: 'JWORD_NATIVE_SCHEMA_FUTURE',
      recoverable: false
    }))
    await expect(loadJWordDocument(futurePackage)).rejects.toMatchObject({
      code: 'JWORD_NATIVE_SCHEMA_FUTURE'
    })
  })

  it('aborts save operations through AbortSignal with a stable diagnostic', async () => {
    const controller = new AbortController()

    controller.abort()

    await expect(saveJWordDocument(createTextDocument('document-native-cancel', '取消'), {
      signal: controller.signal,
      requestId: 'native-cancel-save'
    })).rejects.toMatchObject({
      code: 'JWORD_NATIVE_USER_CANCELLED',
      requestId: 'native-cancel-save'
    })
  })
})

/** 读取 warning code，保持断言聚焦在稳定诊断码。 */
function readWarningCode(warning: JWordPackageWarning): string {
  return warning.code
}

/** 使用独立 Web Crypto 路径生成测试 package 的已知 checksum。 */
async function sha256ForTest(bytes: Uint8Array): Promise<string> {
  const buffer = new Uint8Array(bytes).buffer
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer)

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** 创建最小纯文本文档。 */
function createTextDocument(documentId: string, text: string): Document {
  return {
    kind: 'document',
    id: documentId,
    sections: [
      {
        kind: 'section',
        id: `${documentId}-section`,
        blocks: [
          {
            kind: 'paragraph',
            id: `${documentId}-paragraph`,
            runs: [
              {
                kind: 'run',
                id: `${documentId}-run`,
                inlines: [
                  {
                    kind: 'text',
                    text
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }
}

/** 创建引用图片资源的文档。 */
function createImageDocument(resources: readonly Resource[]): Document {
  return {
    ...createTextDocument('document-native-image', '图片'),
    resourceIds: resources.map((resource) => resource.id),
    resources
  }
}

/** 创建覆盖表格、图片、批注、页眉页脚和修订 metadata 的 canonical 文档。 */
function createRichDocument(): Document {
  const rangeSnapshot = createRangeSnapshot('rich-range')
  const imageResource: Resource = {
    ...createPngResource('rich-image-resource', 'data:image/png;base64,QUJDRA=='),
    metadata: {
      futureResourceField: {
        nested: ['preserved']
      }
    }
  }

  return {
    kind: 'document',
    id: 'document-native-rich',
    metadata: {
      title: 'rich roundtrip'
    },
    styleIds: ['heading-1', 'normal'],
    resourceIds: [imageResource.id],
    resources: [imageResource],
    sections: [
      {
        kind: 'section',
        id: 'rich-section',
        headerIds: ['rich-header'],
        footerIds: ['rich-footer'],
        pageNumbering: {
          mode: 'restart',
          start: 1
        },
        blocks: [
          {
            kind: 'paragraph',
            id: 'rich-heading',
            properties: {
              futureParagraphField: {
                nested: [1, true, null]
              }
            },
            styleId: 'heading-1',
            runs: [
              {
                kind: 'run',
                id: 'rich-heading-run',
                inlines: [
                  {
                    kind: 'bookmark',
                    id: 'rich-outline-target',
                    name: '目录目标',
                    edge: 'start'
                  },
                  {
                    kind: 'text',
                    text: '目录目标'
                  },
                  {
                    kind: 'bookmark',
                    id: 'rich-outline-target',
                    name: '目录目标',
                    edge: 'end'
                  }
                ]
              }
            ]
          },
          {
            kind: 'paragraph',
            id: 'rich-paragraph',
            runs: [
              {
                kind: 'run',
                id: 'rich-comment-run',
                revisionId: 'rich-revision',
                inlines: [
                  {
                    kind: 'commentRangeMarker',
                    commentId: 'rich-comment',
                    edge: 'start'
                  },
                  {
                    kind: 'text',
                    text: '批注和修订'
                  },
                  {
                    kind: 'commentRangeMarker',
                    commentId: 'rich-comment',
                    edge: 'end'
                  },
                  {
                    kind: 'image',
                    resourceId: imageResource.id,
                    alt: 'native rich image',
                    display: 'inline',
                    widthTwips: 3600,
                    heightTwips: 1800
                  }
                ]
              }
            ]
          },
          {
            kind: 'table',
            id: 'rich-table',
            grid: [2400, 2400],
            border: {
              color: '#111111',
              widthTwips: 12
            },
            rows: [
              {
                id: 'rich-row',
                cells: [
                  createTableCell('rich-cell-a', 'A1'),
                  createTableCell('rich-cell-b', 'B1')
                ]
              }
            ]
          }
        ]
      }
    ],
    comments: [
      {
        kind: 'commentThread',
        id: 'rich-comment',
        authorId: 'demo-user',
        createdAt: '2026-05-27T00:00:00.000Z',
        anchorRangeId: rangeSnapshot.id,
        resolved: false,
        rangeSnapshot,
        messages: [
          {
            id: 'rich-comment-message',
            authorId: 'demo-user',
            createdAt: '2026-05-27T00:00:00.000Z',
            anchorRangeId: rangeSnapshot.id,
            text: '保留批注'
          }
        ]
      }
    ],
    revisions: [
      {
        kind: 'revision',
        id: 'rich-revision',
        authorId: 'demo-user',
        createdAt: '2026-05-27T00:00:00.000Z',
        type: 'format',
        rangeId: rangeSnapshot.id,
        rangeSnapshot,
        summary: '保留修订 metadata'
      }
    ]
  }
}

/** 创建最小表格单元格。 */
function createTableCell(id: string, text: string) {
  return {
    id,
    blocks: [
      {
        kind: 'paragraph' as const,
        id: `${id}-paragraph`,
        runs: [
          {
            kind: 'run' as const,
            id: `${id}-run`,
            inlines: [
              {
                kind: 'text' as const,
                text
              }
            ]
          }
        ]
      }
    ]
  }
}

/** 创建测试用稳定 range snapshot。 */
function createRangeSnapshot(id: string) {
  const anchor = {
    documentId: 'document-native-rich',
    sectionId: 'rich-section',
    blockId: 'rich-paragraph',
    runId: 'rich-comment-run',
    graphemeIndex: 0,
    relativePosition: {}
  }

  return {
    id,
    anchor,
    focus: {
      ...anchor,
      graphemeIndex: 6
    }
  }
}

/** 创建 dataUrl 图片资源。 */
function createPngResource(id: string, url: string): Resource {
  return {
    kind: 'resource',
    id,
    mime: 'image/png',
    source: {
      kind: 'dataUrl',
      url
    },
    status: 'success'
  }
}

/** 从 zip 中删除指定 entry。 */
async function removeZipEntry(bytes: Uint8Array, path: string): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)

  zip.remove(path)

  return zip.generateAsync({ type: 'uint8array' })
}

/** 覆盖 zip 中指定 entry 内容。 */
async function overwriteZipEntry(bytes: Uint8Array, path: string, content: Uint8Array): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)

  zip.file(path, content)

  return zip.generateAsync({ type: 'uint8array' })
}

/** 替换 zip 中指定 JSON entry 内容。 */
async function replaceZipJsonEntry(
  bytes: Uint8Array,
  path: string,
  update: (record: Record<string, unknown>) => Record<string, unknown>
): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes)
  const record = JSON.parse(await zip.file(path)?.async('string') ?? '{}') as Record<string, unknown>

  zip.file(path, JSON.stringify(update(record), null, 2))

  return zip.generateAsync({ type: 'uint8array' })
}

/** 创建 document 内联 data URL 且 ZIP 同时携带资源 entry 的真实格式 1 package。 */
async function createLegacyFormat1ResourcePackage(): Promise<Uint8Array> {
  const save = await saveJWordDocument(createImageDocument([
    createPngResource('image-legacy-format-1', 'data:image/png;base64,QUJDRA==')
  ]))
  const zip = await JSZip.loadAsync(save.bytes)
  const manifest = JSON.parse(await zip.file('manifest.json')?.async('string') ?? '{}') as {
    formatVersion: number
    schemaVersion: number
    minimumReaderVersion: number
  }
  const document = JSON.parse(await zip.file('document.json')?.async('string') ?? '{}') as Document
  const checksums = JSON.parse(await zip.file('checksums.json')?.async('string') ?? '{}') as {
    entries: Record<string, { mime: string, byteLength: number, sha256: string }>
  }

  if (document.resources === undefined) {
    throw new Error('expected legacy resource fixture')
  }

  const legacyDocument: Document = {
    ...document,
    resources: document.resources.map((resource) => ({
      ...resource,
      source: {
        kind: 'dataUrl',
        url: 'data:image/png;base64,QUJDRA=='
      }
    }))
  }
  const documentJson = `${JSON.stringify(legacyDocument, null, 2)}\n`
  const documentBytes = new TextEncoder().encode(documentJson)

  manifest.formatVersion = 1
  manifest.schemaVersion = 1
  manifest.minimumReaderVersion = 1
  checksums.entries['document.json'] = {
    mime: 'application/json',
    byteLength: documentBytes.byteLength,
    sha256: await sha256ForTest(documentBytes)
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))
  zip.file('document.json', documentJson)
  zip.file('checksums.json', JSON.stringify(checksums, null, 2))

  return zip.generateAsync({ type: 'uint8array' })
}

/** 创建指定 schemaVersion 的测试包。 */
async function createPackageWithSchemaVersion(schemaVersion: number): Promise<Uint8Array> {
  const save = await saveJWordDocument(createTextDocument(`document-native-schema-${schemaVersion}`, 'schema'))
  const zip = await JSZip.loadAsync(save.bytes)
  const manifest = JSON.parse(await zip.file('manifest.json')?.async('string') ?? '{}') as {
    formatVersion: number
    schemaVersion: number
    minimumReaderVersion: number
  }

  manifest.schemaVersion = schemaVersion
  if (schemaVersion === 0) {
    manifest.formatVersion = 1
    manifest.minimumReaderVersion = 1
  }
  zip.file('manifest.json', JSON.stringify(manifest, null, 2))

  return zip.generateAsync({ type: 'uint8array' })
}
