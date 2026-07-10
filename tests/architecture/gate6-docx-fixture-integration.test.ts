/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 6 DOCX 导入 fixture 不只是登记项，而是真实进入同一 Editor/Y.Doc、协同 update、历史和自动插入路径。
 * 边界：只覆盖 Gate 5 已有 DOCX fixture 的 JWord 导入后 Gate 6 内存路径，不声明真实 provider、IndexedDB 或双窗口完成。
 * 协作模块：packages/docx、packages/core、packages/persistence 和 fixtures/collab registry。
 * 约束：T1 fixture 必须无 warning；T2 warning fixture 必须保留可诊断降级信息但仍能进入普通 JWord 文档路径。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { readFileSync } from 'node:fs'

import {
  createEditor,
  createDocumentProjection,
  createTextInserter,
  type Editor
} from '@4xian/jword-core'
import {
  convertDocxImportDocumentToCoreDocument,
  importDocx
} from '@4xian/jword-docx'
import { createInsecureTestOnlyJWordLicenseSignature, type JWordLicenseEntitlement, type JWordLicenseSignaturePayload } from '@4xian/jword-license'
import {
  createMemoryPersistenceAdapter,
  createUnavailableIndexedDbOfflineAdapter
} from '@4xian/jword-persistence'
import { describe, expect, it } from 'vitest'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../fixtures/license/insecure-test-only-keys'

describe('Gate 6 DOCX imported fixture integration', () => {
  it('loads the T1 imported DOCX fixture into the same Y.Doc path for collab, history and auto insert', async () => {
    const fixture = await loadGate6DocxFixture('docx-import-t1-collab')

    expect(fixture.importWarnings).toEqual([])
    expect(fixture.initialText.length).toBeGreaterThan(0)
    expect(fixture.remoteText).toContain('Gate6远端')
    expect(fixture.autoInsertedText).toContain('Gate6自动')
    expect(fixture.previewText).toBe(fixture.remoteText)
    expect(fixture.restoredText).toBe(fixture.remoteText)
    expect(fixture.versionLabels).toEqual(['docx-import-t1-collab:update'])
    expect(fixture.offlineDiagnosticCodes).toEqual([
      'PERSISTENCE_INDEXEDDB_UNAVAILABLE',
      'PERSISTENCE_INDEXEDDB_UNAVAILABLE'
    ])
  })

  it('loads the T2 warning DOCX fixture as an editable JWord document while preserving warning diagnostics', async () => {
    const fixture = await loadGate6DocxFixture('docx-import-t2-warning')

    expect(fixture.importWarnings.length).toBeGreaterThan(0)
    expect(fixture.importWarnings).toEqual(expect.arrayContaining([
      'DOCX_DRAWING_FLOATING_UNSUPPORTED'
    ]))
    expect(fixture.remoteText).toContain('Gate6远端')
    expect(fixture.autoInsertedText).toContain('Gate6自动')
    expect(fixture.previewText).toBe(fixture.remoteText)
    expect(fixture.restoredText).toBe(fixture.remoteText)
    expect(fixture.offlineDiagnosticCodes).toContain('PERSISTENCE_INDEXEDDB_UNAVAILABLE')
  })
})

interface Gate6CollabRegistry {
  readonly fixtures: readonly Gate6CollabFixture[]
}

interface Gate6CollabFixture {
  readonly id: string
  readonly input?: {
    readonly kind?: string
    readonly source?: string
  }
}

interface Gate6DocxFixtureIntegrationResult {
  readonly importWarnings: readonly string[]
  readonly initialText: string
  readonly remoteText: string
  readonly autoInsertedText: string
  readonly previewText: string
  readonly restoredText: string
  readonly versionLabels: readonly string[]
  readonly offlineDiagnosticCodes: readonly string[]
}

/** 读取 Gate 6 registry 中指定 DOCX fixture 并执行真实导入和 Gate 6 内存路径。 */
async function loadGate6DocxFixture(fixtureId: string): Promise<Gate6DocxFixtureIntegrationResult> {
  const fixture = readGate6CollabFixture(fixtureId)
  const bytes = readFileSync(fixture.input!.source!)
  const importResult = await importDocx(bytes, {
    requestId: `${fixture.id}-gate6-docx-import`,
    license: createGate6DocxFixtureLicense()
  })
  const document = convertDocxImportDocumentToCoreDocument(importResult.document)
  const sourceEditor = createEditor()
  const targetEditor = createEditor()
  const persistence = createMemoryPersistenceAdapter()

  try {
    sourceEditor.loadDocumentModel({ document })
    targetEditor.applySyncUpdate(sourceEditor.encodeSyncUpdate(), {
      origin: 'remote-user',
      requestId: `${fixture.id}-initial-sync`,
      roomId: `${fixture.id}-room`,
      clientId: 'remote-user-b'
    })

    const firstAnchor = createFirstTextAnchor(targetEditor, 0)

    targetEditor.executeCommand(
      {
        name: `${fixture.id}-remote-insert`,
        operations: [{
          kind: 'insertText',
          at: targetEditor.resolveTextPosition(firstAnchor),
          text: 'Gate6远端'
        }]
      },
      {
        origin: 'remote-user',
        requestId: `${fixture.id}-remote-insert`,
        roomId: `${fixture.id}-room`,
        clientId: 'remote-user-b'
      }
    )

    const remoteText = readDocumentText(targetEditor)
    const update = targetEditor.encodeSyncUpdate()
    const appendResult = await persistence.appendUpdate({
      documentId: fixture.id,
      roomId: `${fixture.id}-room`,
      clientId: 'remote-user-b',
      update,
      label: `${fixture.id}:update`,
      origin: 'remote-user'
    })
    const preview = await persistence.createPreview({
      documentId: fixture.id,
      versionId: appendResult.version.versionId
    })
    const loadedVersion = await persistence.loadVersion({
      documentId: fixture.id,
      versionId: appendResult.version.versionId
    })
    const restoredEditor = createEditor()
    const offlineAdapter = createUnavailableIndexedDbOfflineAdapter()

    try {
      const restoreResult = restoredEditor.applySyncUpdate(loadedVersion.update, {
        origin: 'version-restore',
        requestId: `${fixture.id}-version-restore`,
        roomId: `${fixture.id}-room`,
        versionId: appendResult.version.versionId
      })
      const offlineStoreResult = await offlineAdapter.storeUpdate({
        documentId: fixture.id,
        update
      })
      const offlineLoadResult = await offlineAdapter.load(fixture.id)
      const versions = await persistence.listVersions(fixture.id)

      if (loadedVersion.diagnostics.length > 0 || restoreResult.dirty !== true) {
        throw new Error(`Gate 6 DOCX fixture restore failed for ${fixture.id}.`)
      }

      const inserter = createTextInserter(targetEditor, {
        requestId: `${fixture.id}-auto-insert`,
        anchor: createFirstTextAnchor(targetEditor, readFirstParagraphLength(targetEditor))
      })
      const insertResult = inserter.write('Gate6自动')

      if (insertResult === null) {
        throw new Error(`Gate 6 DOCX fixture auto inserter did not write for ${fixture.id}.`)
      }

      return {
        importWarnings: importResult.warnings.map((warning) => warning.code),
        initialText: readDocumentText(sourceEditor),
        remoteText,
        autoInsertedText: readDocumentText(targetEditor),
        previewText: readProjectionText(createDocumentProjection(preview.doc)),
        restoredText: readStateUpdateText(loadedVersion.update),
        versionLabels: versions.map((version) => version.label ?? version.versionId),
        offlineDiagnosticCodes: [
          ...offlineStoreResult.diagnostics,
          ...offlineLoadResult.diagnostics
        ].map((diagnostic) => diagnostic.code)
      }
    } finally {
      preview.doc.destroy()
      restoredEditor.destroy()
    }
  } finally {
    sourceEditor.destroy()
    targetEditor.destroy()
  }
}

/** 创建 Gate 6 DOCX fixture 导入测试使用的有效授权。 */
function createGate6DocxFixtureLicense(): JWordLicenseEntitlement {
  const entitlement: JWordLicenseSignaturePayload = {
    customerId: 'customer-gate6-docx-fixture',
    licenseToken: 'token-gate6-docx-fixture',
    features: ['docx.import'],
    issuer: 'jword-test-issuer',
    issuedAt: '2026-05-01T00:00:00Z',
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid'
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 从 registry 中读取指定 DOCX fixture。 */
function readGate6CollabFixture(fixtureId: string): Gate6CollabFixture {
  const registry = JSON.parse(readFileSync('fixtures/collab/registry.json', 'utf8')) as Gate6CollabRegistry
  const fixture = registry.fixtures.find((candidate) => candidate.id === fixtureId)

  if (fixture === undefined || fixture.input?.kind !== 'docx-import' || fixture.input.source === undefined) {
    throw new Error(`Missing Gate 6 DOCX fixture ${fixtureId}.`)
  }

  return fixture
}

/** 创建首个段落里的公开文本锚点。 */
function createFirstTextAnchor(editor: Editor, graphemeIndex: number) {
  const projection = editor.getProjection()
  const section = projection.document.sections.find((candidate) =>
    candidate.blocks.some((block) => block.kind === 'paragraph')
  )
  const paragraph = section?.blocks.find((block) => block.kind === 'paragraph')
  const run = paragraph?.kind === 'paragraph'
    ? paragraph.runs.find((candidate) => candidate.inlines.some((inline) => inline.kind === 'text')) ?? paragraph.runs[0]
    : undefined

  if (section === undefined || paragraph === undefined || paragraph.kind !== 'paragraph' || run === undefined) {
    throw new Error('Gate 6 DOCX fixture does not contain a text paragraph.')
  }

  return editor.createTextAnchor({
    sectionId: section.id,
    blockId: paragraph.id,
    runId: run.id,
    graphemeIndex
  })
}

/** 读取第一段文本长度。 */
function readFirstParagraphLength(editor: Editor): number {
  return readParagraphTexts(editor)[0]?.length ?? 0
}

/** 读取当前文档全部段落文本。 */
function readDocumentText(editor: Editor): string {
  return readProjectionText(editor.getProjection())
}

/** 读取当前文档全部段落文本数组。 */
function readParagraphTexts(editor: Editor): string[] {
  return readProjectionParagraphTexts(editor.getProjection())
}

/** 读取投影中的全部段落文本。 */
function readProjectionText(projection: ReturnType<Editor['getProjection']>): string {
  return readProjectionParagraphTexts(projection).join('\n')
}

/** 读取投影中的全部段落文本数组。 */
function readProjectionParagraphTexts(projection: ReturnType<Editor['getProjection']>): string[] {
  return projection.document.sections.flatMap((section) =>
    section.blocks.flatMap((block) => block.kind === 'paragraph'
      ? [block.runs.flatMap((run) =>
        run.inlines.flatMap((inline) => inline.kind === 'text' ? [inline.text] : [])
      ).join('')]
      : [])
  )
}

/** 从 state update 读取隔离 Y.Doc 投影文本。 */
function readStateUpdateText(update: Uint8Array): string {
  const editor = createEditor()

  try {
    editor.replaceSyncUpdate(update, {
      origin: 'version-restore',
      requestId: 'gate6-fixture-state-update-read'
    })

    return readDocumentText(editor)
  } finally {
    editor.destroy()
  }
}
