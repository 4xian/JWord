/**
 * @vitest-environment node
 *
 * 职责：验证 @4xian/jword-docx public API preservation diagnostics。
 * 边界：只覆盖拆分后的 focused public API 行为，不扩大 Gate 5 功能范围。
 * 协作模块：packages/docx/src/index.ts、fixtures helper 和 Gate 5 兼容验证复用这些契约。
 * 约束：测试文件保持小体量，避免一个 public API 文件承载全部 DOCX 纵线。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#gate-5docx-导入导出与-pdf-导出。
 */

import { describe, expect, it } from 'vitest'

import type {
  DocxBinaryInput,
  ImportDocxOptions,
  ImportDocxResult
} from '../src/index'
import { importDocx as importDocxPublic } from '../src/index'
import {
  createDocxPublicApiLicense,
  createDocxOpaquePackage,
  createDocxRevisionPackage,
  createDocxUnsupportedFormattingPackage
} from './public-api-fixtures'

/** 以有效授权调用 DOCX import，保持 preservation 测试聚焦于诊断内容。 */
function importDocx(input: DocxBinaryInput, options: ImportDocxOptions = {}): Promise<ImportDocxResult> {
  return importDocxPublic(input, {
    ...options,
    license: createDocxPublicApiLicense(['docx.import'])
  })
}

describe('@4xian/jword-docx public API preservation diagnostics', () => {
  it('warns and preserves opaque data for unsupported DOCX content', async () => {
    const bytes = await createDocxOpaquePackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-opaque-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_RELATIONSHIP_TARGET_MISSING',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'word/missing-data.xml',
        message: 'DOCX relationship target is missing: word/missing-data.xml',
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      },
      {
        code: 'DOCX_RELATIONSHIP_UNSUPPORTED',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'rIdCustom',
        message: 'DOCX relationship is not mapped yet: customXml',
        fallback: 'preserve-opaque-relationship',
        recoverable: true
      },
      {
        code: 'DOCX_RELATIONSHIP_UNSUPPORTED',
        severity: 'warning',
        part: 'word/_rels/document.xml.rels',
        path: 'rIdExternalOle',
        message: 'DOCX relationship is not mapped yet: oleObject',
        fallback: 'preserve-opaque-relationship',
        recoverable: true
      },
      {
        code: 'DOCX_PART_UNSUPPORTED',
        severity: 'warning',
        part: 'word/embeddings/oleObject1.bin',
        message: 'DOCX part is not mapped yet: word/embeddings/oleObject1.bin',
        fallback: 'preserve-opaque-part',
        recoverable: true
      },
      {
        code: 'DOCX_PART_UNSUPPORTED',
        severity: 'warning',
        part: 'customXml/item1.xml',
        message: 'DOCX part is not mapped yet: customXml/item1.xml',
        fallback: 'preserve-opaque-part',
        recoverable: true
      },
      {
        code: 'DOCX_ELEMENT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'body/customContent',
        message: 'DOCX element is not mapped yet: customContent',
        fallback: 'preserve-opaque-element',
        recoverable: true
      },
      {
        code: 'DOCX_STYLE_UNKNOWN',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'run-1',
        message: 'DOCX run style is missing from styles index: MissingCharacterStyle',
        fallback: 'preserve-style-id',
        recoverable: true
      },
      {
        code: 'DOCX_STYLE_UNKNOWN',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1',
        message: 'DOCX paragraph style is missing from styles index: MissingStyle',
        fallback: 'preserve-style-id',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      id: 'paragraph-1',
      styleId: 'MissingStyle',
      runs: [
        {
          kind: 'run',
          id: 'run-1',
          properties: {
            styleId: 'MissingCharacterStyle'
          },
          inlines: [
            {
              kind: 'text',
              text: 'Opaque text'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque).toMatchObject({
      unsupportedParts: [
        {
          part: 'word/embeddings/oleObject1.bin',
          contentType: 'application/vnd.openxmlformats-officedocument.oleObject',
          bytes: [1, 2, 3],
          unsafeToPreserveAfterEdit: true
        },
        {
          part: 'customXml/item1.xml',
          contentType: 'application/xml',
          text: '<root><value>Opaque</value></root>',
          unsafeToPreserveAfterEdit: true
        }
      ],
      unsupportedRelationships: [
        {
          id: 'rIdCustom',
          kind: 'customXml',
          target: 'customXml/item1.xml',
          sourcePart: 'word/document.xml',
          unsafeToPreserveAfterEdit: true
        },
        {
          id: 'rIdExternalOle',
          kind: 'oleObject',
          target: 'https://example.com/ole',
          targetMode: 'External',
          sourcePart: 'word/document.xml',
          unsafeToPreserveAfterEdit: true
        }
      ],
      unsupportedElementFragments: [
        {
          part: 'word/document.xml',
          path: 'body/customContent',
          xml: '<w:customContent w:val="opaque"/>',
          unsafeToPreserveAfterEdit: true
        }
      ],
      originalStyleIds: ['Normal'],
      originalNumberingIds: []
    })
  })

  it('warns and preserves track changes revision metadata without importing edits silently', async () => {
    const bytes = await createDocxRevisionPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-revisions-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_REVISION_METADATA_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/ins',
        message: 'DOCX revision metadata is preserved but not imported yet: ins',
        fallback: 'preserve-opaque-revision',
        recoverable: true
      },
      {
        code: 'DOCX_REVISION_METADATA_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/del',
        message: 'DOCX revision metadata is preserved but not imported yet: del',
        fallback: 'preserve-opaque-revision',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      id: 'paragraph-1',
      runs: [
        {
          kind: 'run',
          id: 'run-1',
          inlines: [
            {
              kind: 'text',
              text: 'Stable'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque.unsupportedElementFragments).toEqual([
      {
        part: 'word/document.xml',
        path: 'paragraph-1/ins',
        xml: '<w:ins w:id="1" w:author="Alice" w:date="2026-05-25T00:00:00Z"><w:r><w:t>Inserted</w:t></w:r></w:ins>',
        unsafeToPreserveAfterEdit: true
      },
      {
        part: 'word/document.xml',
        path: 'paragraph-1/del',
        xml: '<w:del w:id="2" w:author="Bob" w:date="2026-05-25T00:01:00Z"><w:r><w:delText>Deleted</w:delText></w:r></w:del>',
        unsafeToPreserveAfterEdit: true
      }
    ])
  })

  it('warns for unsupported formatting while preserving degradable paragraph properties', async () => {
    const bytes = await createDocxUnsupportedFormattingPackage()
    const result = await importDocx(bytes, {
      requestId: 'docx-import-format-warnings-1'
    })

    expect(result.warnings).toEqual([
      {
        code: 'DOCX_NUMBERING_FORMAT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/numbering.xml',
        path: 'abstractNum-1/level-0',
        message: 'DOCX numbering format is not fully supported yet: lowerLetter',
        fallback: 'preserve-numbering-metadata',
        recoverable: true
      },
      {
        code: 'DOCX_RUN_PROPERTY_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'run-1/smallCaps',
        message: 'DOCX run property is not mapped yet: smallCaps',
        fallback: 'preserve-run-text',
        recoverable: true
      },
      {
        code: 'DOCX_PARAGRAPH_PROPERTY_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'paragraph-1/textDirection',
        message: 'DOCX paragraph property is not mapped yet: textDirection',
        fallback: 'preserve-paragraph-content',
        recoverable: true
      }
    ])
    expect(result.document.sections[0]?.blocks[0]).toMatchObject({
      kind: 'paragraph',
      properties: {
        keepWithNext: true,
        keepLines: true,
        widowControl: false,
        listNumberingId: '5',
        listLevel: 0
      },
      runs: [
        {
          inlines: [
            {
              kind: 'text',
              text: 'Unsupported formatting'
            }
          ]
        }
      ]
    })
    expect(result.document.opaque.originalNumberingIds).toEqual(['1', '5'])
  })
})
