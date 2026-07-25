/**
 * 职责：集中提供 DOCX public API focused tests 复用的内存 projection 和 OPC package fixture。
 * 边界：只构造测试输入，不包含断言、不读取磁盘、不执行浏览器流程。
 * 协作模块：public-api*.test.ts 通过这些 helper 复用同一 DOCX 输入模型。
 * 约束：fixture helper 只服务 Gate 5 public API 测试，避免测试文件重复超限。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { createHash } from 'node:crypto'

import type { DocumentProjection } from '@4xian/jword-core'
import {
  type JWordLicenseEntitlement
} from '@4xian/jword-license'
import JSZip from 'jszip'
import { createTestOnlyJWordLicenseEntitlement } from '../../../fixtures/license/test-only-entitlement-fixture.mjs'

/** 创建 DOCX public API 业务测试使用的 test-only entitlement。 */
export function createDocxPublicApiLicense(features: readonly string[]): JWordLicenseEntitlement {
  return createTestOnlyJWordLicenseEntitlement(features, {
    customerId: 'customer-docx-public-api'
  })
}

/** 创建公开 API 测试使用的最小只读文档投影。 */
export function createProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-empty',
      sections: []
    }
  }
}

/** 创建带 data URL 图片资源的最小只读文档投影。 */
export function createProjectionWithPngResource(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-export',
      resources: [
        {
          kind: 'resource',
          id: 'resource-png-1',
          mime: 'image/png',
          source: {
            kind: 'dataUrl',
            url: 'data:image/png;base64,iVBORw0KGgo='
          },
          status: 'success'
        }
      ],
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-1',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Hello export'
                    },
                    {
                      kind: 'image',
                      resourceId: 'resource-png-1',
                      alt: 'Exported image',
                      display: 'inline',
                      widthTwips: 1440,
                      heightTwips: 1440
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
}

/** 创建双 section 导出测试使用的只读文档投影。 */
export function createMultiSectionProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-export-multi-section',
      sections: [
        {
          kind: 'section',
          id: 'section-export-first',
          page: {
            widthTwips: 10000,
            heightTwips: 12000,
            marginTwips: {
              top: 111,
              right: 222,
              bottom: 333,
              left: 444
            }
          },
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-export-first',
              runs: [
                {
                  kind: 'run',
                  id: 'run-export-first',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'First section'
                    }
                  ]
                }
              ]
            }
          ]
        },
        {
          kind: 'section',
          id: 'section-export-second',
          page: {
            widthTwips: 20000,
            heightTwips: 22000,
            marginTwips: {
              top: 555,
              right: 666,
              bottom: 777,
              left: 888
            }
          },
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-export-second',
              runs: [
                {
                  kind: 'run',
                  id: 'run-export-second',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Second section'
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
}

/** 计算二进制内容的 SHA-256 十六进制摘要。 */
export function createSha256Hex(bytes: ArrayBuffer): string {
  return createHash('sha256').update(Buffer.from(bytes)).digest('hex')
}

/** 创建覆盖 T1 export roundtrip 的只读文档投影。 */
export function createStyledTextProjection(): DocumentProjection {
  return {
    document: {
      kind: 'document',
      id: 'document-styled-export',
      sections: [
        {
          kind: 'section',
          id: 'section-1',
          blocks: [
            {
              kind: 'paragraph',
              id: 'paragraph-1',
              styleId: 'Heading1',
              properties: {
                alignment: 'center',
                spacingBeforeTwips: 240,
                spacingAfterTwips: 120,
                indentLeftTwips: 720,
                firstLineIndentTwips: 360
              },
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  properties: {
                    bold: true,
                    italic: true,
                    underline: true,
                    strike: true,
                    color: '#c00000',
                    fontFamily: 'Arial',
                    fontSizeTwips: 320,
                    backgroundColor: '#fff59d',
                    superscript: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'A & B <tag>'
                    },
                    {
                      kind: 'text',
                      text: '\t'
                    },
                    {
                      kind: 'break',
                      breakType: 'line'
                    },
                    {
                      kind: 'text',
                      text: 'Next'
                    }
                  ]
                },
                {
                  kind: 'run',
                  id: 'run-2',
                  properties: {
                    subscript: true
                  },
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Below'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-2',
              styleId: 'Heading2',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Second heading'
                    }
                  ]
                }
              ]
            },
            {
              kind: 'paragraph',
              id: 'paragraph-3',
              styleId: 'Heading3',
              runs: [
                {
                  kind: 'run',
                  id: 'run-1',
                  inlines: [
                    {
                      kind: 'text',
                      text: 'Third heading'
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
}

/** 创建测试用最小 DOCX OPC package。 */
export async function createMinimalDocxPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body>',
      '</w:document>'
    ].join(''),
      'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    ].join('')
  })
}

/** 创建内存 zip，测试不读取磁盘 fixture。 */
export async function createZip(parts: Readonly<Record<string, string | Uint8Array>>): Promise<ArrayBuffer> {
  const zip = new JSZip()

  for (const [name, content] of Object.entries(parts)) {
    zip.file(name, content)
  }

  return zip.generateAsync({ type: 'arraybuffer' })
}

/** 创建带 indexes 和 middle model 覆盖的 DOCX package。 */
export async function createDocxIndexPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>',
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
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
      '<w:pPr>',
      '<w:pStyle w:val="BodyText"/>',
      '<w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr>',
      '<w:jc w:val="center"/>',
      '<w:spacing w:before="240" w:after="120"/>',
      '<w:ind w:left="720" w:firstLine="360"/>',
      '</w:pPr>',
      '<w:r><w:t>Hello</w:t></w:r>',
      '<w:r>',
      '<w:rPr>',
      '<w:b/>',
      '<w:i/>',
      '<w:u w:val="single"/>',
      '<w:strike/>',
      '<w:color w:val="C00000"/>',
      '<w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Arial" w:cs="Arial"/>',
      '<w:sz w:val="32"/>',
      '<w:shd w:fill="FFF59D"/>',
      '<w:vertAlign w:val="superscript"/>',
      '</w:rPr>',
      '<w:t> Styled</w:t>',
      '<w:tab/>',
      '<w:t>Text</w:t>',
      '<w:br/>',
      '<w:t>Next</w:t>',
      '</w:r>',
      '<w:hyperlink r:id="rIdLink1">',
      '<w:r><w:t>Link</w:t></w:r>',
      '</w:hyperlink>',
      '<w:commentRangeStart w:id="0"/>',
      '<w:r><w:t>Commented</w:t></w:r>',
      '<w:commentRangeEnd w:id="0"/>',
      '<w:r><w:commentReference w:id="0"/></w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:headerReference r:id="rIdHeader1" w:type="default"/>',
      '<w:footerReference r:id="rIdFooter1" w:type="default"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>',
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="BodyText">',
      '<w:name w:val="Body Text"/>',
      '<w:basedOn w:val="Normal"/>',
      '</w:style>',
      '<w:style w:type="character" w:styleId="Accent">',
      '<w:name w:val="Accent"/>',
      '</w:style>',
      '</w:styles>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0">',
      '<w:numFmt w:val="bullet"/>',
      '<w:lvlText w:val="•"/>',
      '<w:start w:val="1"/>',
      '</w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5">',
      '<w:abstractNumId w:val="1"/>',
      '</w:num>',
      '</w:numbering>'
    ].join(''),
    'word/comments.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:comment w:id="0" w:author="JWord" w:date="2026-05-25T00:00:00Z">',
      '<w:p><w:r><w:t>Index note</w:t></w:r></w:p>',
      '</w:comment>',
      '</w:comments>'
    ].join(''),
    'word/header1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    ].join(''),
    'word/footer1.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>'
    ].join(''),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71])
  })
}

/** 创建包含页设置和分页符的 DOCX package。 */
export async function createDocxPageSetupPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:r><w:t>First page</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:t>Page break</w:t>',
      '<w:br w:type="page"/>',
      '<w:t>After break</w:t>',
      '</w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:type w:val="nextPage"/>',
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
      '<w:pgMar w:top="1800" w:right="1440" w:bottom="1080" w:left="1800" w:header="720" w:footer="720" w:gutter="0"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含基础页眉文本和页脚页码字段的 DOCX package。 */
export async function createDocxHeaderFooterTextPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>',
      '<w:sectPr>',
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
      '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>',
      '<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>',
      '</Relationships>'
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
      '<w:p>',
      '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
      '<w:r><w:instrText> PAGE </w:instrText></w:r>',
      '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
      '</w:p>',
      '</w:ftr>'
    ].join('')
  })
}

/** 创建包含段落级分节和不支持 section 设置的 DOCX package。 */
export async function createDocxParagraphSectionPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:pPr>',
      '<w:sectPr>',
      '<w:type w:val="continuous"/>',
      '<w:pgSz w:w="11906" w:h="16838" w:orient="landscape"/>',
      '</w:sectPr>',
      '</w:pPr>',
      '<w:r><w:t>First section</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r><w:t>Second section</w:t></w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:type w:val="oddPage"/>',
      '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>',
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>',
      '<w:cols w:num="2"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含基础表格的 DOCX package。 */
export async function createDocxTablePackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:tbl>',
      '<w:tblPr>',
      '<w:tblBorders>',
      '<w:top w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:left w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:bottom w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:right w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:insideH w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '<w:insideV w:val="single" w:sz="4" w:color="C0C0C0"/>',
      '</w:tblBorders>',
      '</w:tblPr>',
      '<w:tblGrid>',
      '<w:gridCol w:w="1600"/>',
      '<w:gridCol w:w="1600"/>',
      '<w:gridCol w:w="1600"/>',
      '</w:tblGrid>',
      '<w:tr>',
      '<w:tc>',
      '<w:tcPr><w:gridSpan w:val="2"/></w:tcPr>',
      '<w:p><w:r><w:t>Left</w:t></w:r></w:p>',
      '</w:tc>',
      '<w:tc>',
      '<w:p><w:r><w:t>Right</w:t></w:r></w:p>',
      '</w:tc>',
      '</w:tr>',
      '</w:tbl>',
      '<w:sectPr/>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}

/** 创建包含 inline 图、外链图和浮动图的 DOCX package。 */
export async function createDocxImagePackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="2286000" cy="1143000"/>',
      '<wp:docPr id="1" name="Inline" descr="Inline image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:embed="rIdImage1"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="1524000" cy="762000"/>',
      '<wp:docPr id="2" name="External" descr="External image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:link="rIdExternalImage"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:inline>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">',
      '<wp:extent cx="1524000" cy="762000"/>',
      '<wp:docPr id="3" name="Floating" descr="Floating image"/>',
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">',
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">',
      '<pic:blipFill>',
      '<a:blip r:embed="rIdImage1"/>',
      '</pic:blipFill>',
      '</pic:pic>',
      '</a:graphicData>',
      '</a:graphic>',
      '</wp:anchor>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '<Relationship Id="rIdExternalImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="https://example.com/external.png" TargetMode="External"/>',
      '</Relationships>'
    ].join(''),
    'word/media/image1.png': new Uint8Array([137, 80, 78, 71])
  })
}

/** 创建包含 T3 unsupported 内容的 DOCX package。 */
export async function createDocxOpaquePackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/embeddings/oleObject1.bin" ContentType="application/vnd.openxmlformats-officedocument.oleObject"/>',
      '<Override PartName="/customXml/item1.xml" ContentType="application/xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:customContent w:val="opaque"/>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="MissingStyle"/></w:pPr>',
      '<w:r><w:rPr><w:rStyle w:val="MissingCharacterStyle"/></w:rPr><w:t>Opaque text</w:t></w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdCustom" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/>',
      '<Relationship Id="rIdExternalOle" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="https://example.com/ole" TargetMode="External"/>',
      '<Relationship Id="rIdMissing" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="missing-data.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/styles.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1">',
      '<w:name w:val="Normal"/>',
      '</w:style>',
      '</w:styles>'
    ].join(''),
    'word/embeddings/oleObject1.bin': new Uint8Array([1, 2, 3]),
    'customXml/item1.xml': '<root><value>Opaque</value></root>'
  })
}

/** 创建包含未支持格式属性和复杂编号格式的 DOCX package。 */
export async function createDocxUnsupportedFormattingPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:pPr>',
      '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr>',
      '<w:keepNext/>',
      '<w:keepLines/>',
      '<w:widowControl w:val="0"/>',
      '<w:textDirection w:val="tbRl"/>',
      '</w:pPr>',
      '<w:r>',
      '<w:rPr><w:smallCaps/></w:rPr>',
      '<w:t>Unsupported formatting</w:t>',
      '</w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0">',
      '<w:numFmt w:val="lowerLetter"/>',
      '<w:lvlText w:val="%1."/>',
      '<w:start w:val="1"/>',
      '</w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5">',
      '<w:abstractNumId w:val="1"/>',
      '</w:num>',
      '</w:numbering>'
    ].join('')
  })
}

/** 创建包含修订 metadata 的 DOCX package。 */
export async function createDocxRevisionPackage(): Promise<ArrayBuffer> {
  return createZip({
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
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
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:r><w:t>Stable</w:t></w:r>',
      '<w:ins w:id="1" w:author="Alice" w:date="2026-05-25T00:00:00Z">',
      '<w:r><w:t>Inserted</w:t></w:r>',
      '</w:ins>',
      '<w:del w:id="2" w:author="Bob" w:date="2026-05-25T00:01:00Z">',
      '<w:r><w:delText>Deleted</w:delText></w:r>',
      '</w:del>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')
  })
}
