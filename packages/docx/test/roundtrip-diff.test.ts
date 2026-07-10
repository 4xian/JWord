/**
 * @vitest-environment node
 *
 * 职责：覆盖 Gate 5 Iteration 19 的 DOCX roundtrip diff 契约。
 * 边界：只验证 T1 DOCX 导入、写入 JWord facade、导出、重新导入和结构差异比较。
 * 协作模块：packages/docx/src/roundtrip.ts、importDocx、exportDocx 和 core editor facade。
 * 约束：测试不读取磁盘 fixture，不声明 Microsoft Word 人工兼容性。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { diffDocxRoundtrip } from '../src/index'
import { createDocxPublicApiLicense } from './public-api-fixtures'

describe('@4xian/jword-docx roundtrip diff', () => {
  it('imports, writes, exports, reimports and compares T1 DOCX structure', async () => {
    const result = await diffDocxRoundtrip(await createRoundtripDocxPackage(), {
      requestId: 'docx-roundtrip-diff-1',
      license: createDocxPublicApiLicense(['docx.import', 'docx.export'])
    })

    expect(result.matches).toBe(true)
    expect(result.differences).toEqual([])
    expect(result.importWarnings).toEqual([])
    expect(result.exportWarnings).toEqual([])
    expect(result.reimportWarnings).toEqual([])
    expect(result.diagnostics).toEqual({
      requestId: 'docx-roundtrip-diff-1',
      mainDocumentPart: 'word/document.xml'
    })
    expect(result.original).toMatchObject({
      sectionCount: 1,
      blockCount: 4,
      paragraphs: [
        {
          text: 'Roundtrip Heading',
          styleId: 'Heading1',
          runProperties: [{ bold: true }]
        },
        {
          text: 'List item',
          listNumberingId: '5',
          listLevel: 1
        },
        {
          text: '',
          images: [
            {
              resourceId: 'word/media/image1.png',
              alt: 'Inline image',
              widthTwips: 3600,
              heightTwips: 1800
            }
          ]
        },
        {
          text: 'Cell'
        }
      ],
      tables: [
        {
          grid: [2400],
          rows: [
            {
              cells: [
                {
                  text: 'Cell'
                }
              ]
            }
          ]
        }
      ],
      resourceRefs: ['word/media/image1.png']
    })
    expect(result.roundtripped).toEqual(result.original)
  })

  it('keeps T2 warnings visible while allowing T1 roundtrip diff to pass', async () => {
    const result = await diffDocxRoundtrip(await createT2WarningDocxPackage(), {
      requestId: 'docx-roundtrip-t2-warning-1',
      license: createDocxPublicApiLicense(['docx.import', 'docx.export'])
    })

    expect(result.matches).toBe(true)
    expect(result.differences).toEqual([])
    expect(result.importWarnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      'DOCX_DRAWING_FLOATING_UNSUPPORTED',
      'DOCX_REVISION_METADATA_UNSUPPORTED',
      'DOCX_SECTION_BREAK_UNSUPPORTED'
    ]))
    expect(result.exportWarnings).toEqual([
      {
        code: 'DOCX_HEADER_FOOTER_EXPORT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'document.sections.header-footer',
        message: 'DOCX export does not write header/footer content yet',
        fallback: 'omit-header-footer',
        recoverable: true
      },
      {
        code: 'DOCX_PAGE_NUMBERING_EXPORT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'document.sections.page-numbering',
        message: 'DOCX export does not write section page numbering yet',
        fallback: 'omit-page-numbering',
        recoverable: true
      },
      {
        code: 'DOCX_COMMENTS_EXPORT_UNSUPPORTED',
        severity: 'warning',
        part: 'word/document.xml',
        path: 'document.comments',
        message: 'DOCX export does not write comments yet',
        fallback: 'omit-comments',
        recoverable: true
      }
    ])
    expect(result.reimportWarnings).toEqual([])
    expect(result.original).toMatchObject({
      sectionCount: 1,
      blockCount: 4,
      paragraphs: [
        {
          text: 'Roundtrip body'
        },
        {
          text: 'Commented'
        },
        {
          text: ''
        },
        {
          text: 'Stable'
        }
      ]
    })
    expect(result.roundtripped).toEqual(result.original)
  })
})

/** 创建覆盖 T1 roundtrip diff 的内存 DOCX package。 */
async function createRoundtripDocxPackage(): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const [name, content] of Object.entries({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      '<Override PartName="/word/media/image1.png" ContentType="image/png"/>',
      '</Types>'
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/document.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>',
      '<w:r><w:rPr><w:b/></w:rPr><w:t>Roundtrip Heading</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr></w:pPr>',
      '<w:r><w:t>List item</w:t></w:r>',
      '</w:p>',
      '<w:p><w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="2286000" cy="1143000"/>',
      '<wp:docPr id="1" name="Inline" descr="Inline image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill><a:blip r:embed="rIdImage1"/></pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r></w:p>',
      '<w:tbl>',
      '<w:tblGrid><w:gridCol w:w="2400"/></w:tblGrid>',
      '<w:tr><w:tc><w:p><w:r><w:t>Cell</w:t></w:r></w:p></w:tc></w:tr>',
      '</w:tbl>',
      '<w:sectPr/>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/></w:style>',
      '</w:styles>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>',
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%2."/></w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>',
      '</w:numbering>'
    ].join(''),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
  })) {
    zip.file(name, content)
  }

  return zip.generateAsync({ type: 'arraybuffer' })
}

/** 创建覆盖 T2 warning 和 T1 roundtrip 不阻断的内存 DOCX package。 */
async function createT2WarningDocxPackage(): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const [name, content] of Object.entries({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
      '</Types>'
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/document.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:hyperlink r:id="rIdLink1"><w:r><w:t>Roundtrip body</w:t></w:r></w:hyperlink>',
      '</w:p>',
      '<w:p>',
      '<w:commentRangeStart w:id="0"/>',
      '<w:r><w:t>Commented</w:t></w:r>',
      '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:commentReference w:id="0"/></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">',
      '<wp:extent cx="1524000" cy="762000"/>',
      '<wp:docPr id="3" name="Floating" descr="Floating image"/>',
      '</wp:anchor>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r><w:t>Stable</w:t></w:r>',
      '<w:ins w:id="1" w:author="Alice" w:date="2026-05-25T00:00:00Z">',
      '<w:r><w:t>Inserted</w:t></w:r>',
      '</w:ins>',
      '</w:p>',
      '<w:sectPr>',
      '<w:type w:val="oddPage"/>',
      '<w:headerReference r:id="rIdHeader1" w:type="default"/>',
      '<w:footerReference r:id="rIdFooter1" w:type="default"/>',
      '<w:pgNumType w:start="3"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/t2" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/comments.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:comment w:id="0" w:author="JWord" w:date="2026-05-25T00:00:00Z">',
      '<w:p><w:r><w:t>T2 note</w:t></w:r></w:p>',
      '</w:comment>',
      '</w:comments>'
    ].join(''),
    'word/header1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:p><w:r><w:t>Imported header</w:t></w:r></w:p>',
      '</w:hdr>'
    ].join(''),
    'word/footer1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:p><w:r><w:instrText> PAGE </w:instrText></w:r></w:p>',
      '</w:ftr>'
    ].join('')
  })) {
    zip.file(name, content)
  }

  return zip.generateAsync({ type: 'arraybuffer' })
}
