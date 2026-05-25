/**
 * 职责：生成 Gate 5 DOCX 真实 fixture 文件，供 import/export/roundtrip 验收读取。
 * 边界：只写 fixtures/docx/inputs 下的确定性 .docx 文件，不读取编辑器运行时状态、不执行测试。
 * 协作模块：fixtures/docx/registry.json、packages/docx/test/t1-fixtures.test.ts 和 canonical Gate 5 计划复用输出。
 * 约束：生成内容必须是稳定 OOXML package，避免仓库只保留口头 fixture 占位。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import JSZip from 'jszip'

const fixtureDate = new Date('2026-05-25T00:00:00Z')
const fixtureDefinitions = [
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-paragraphs.docx',
    parts: createParagraphsParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-run-styles.docx',
    parts: createRunStylesParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-paragraph-formatting.docx',
    parts: createParagraphFormattingParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-headings.docx',
    parts: createHeadingsParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-lists.docx',
    parts: createListsParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-table-basic.docx',
    parts: createTableParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-inline-image.docx',
    parts: createInlineImageParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t1-page-setup.docx',
    parts: createPageSetupParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-header-footer.docx',
    parts: createHeaderFooterParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-page-number.docx',
    parts: createPageNumberParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-comments.docx',
    parts: createCommentsParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-links.docx',
    parts: createLinksParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-section-breaks.docx',
    parts: createSectionBreaksParts()
  },
  {
    outputPath: 'fixtures/docx/inputs/docx-t2-floating-object-warning.docx',
    parts: createFloatingObjectWarningParts()
  }
]

for (const definition of fixtureDefinitions) {
  await mkdir(dirname(definition.outputPath), { recursive: true })
  await writeFile(definition.outputPath, await createDocxFixture(definition.parts))

  console.log(`generated ${definition.outputPath}`)
}

/** 创建确定性 DOCX fixture 二进制。 */
async function createDocxFixture(parts) {
  const zip = new JSZip()

  for (const [path, content] of Object.entries(parts)) {
    zip.file(path, content, { date: fixtureDate, createFolders: false })
  }

  return zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  })
}

/** 创建 T1 paragraphs DOCX package 的确定性 part 内容。 */
function createParagraphsParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>First paragraph text.</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>Second paragraph text.</w:t></w:r></w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建 T1 run styles DOCX package 的确定性 part 内容。 */
function createRunStylesParts() {
  return {
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '</Types>'
    ].join(''),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
      '</Relationships>'
    ].join(''),
    'docProps/core.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">',
      '<dc:title>JWord Gate 5 T1 Run Styles Fixture</dc:title>',
      '<dc:creator>JWord</dc:creator>',
      '<dcterms:created>2026-05-25T00:00:00Z</dcterms:created>',
      '</cp:coreProperties>'
    ].join(''),
    'docProps/app.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
      '<Application>JWord fixture generator</Application>',
      '</Properties>'
    ].join(''),
    'word/document.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="Normal"/></w:pPr>',
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
      '<w:t>Styled run</w:t>',
      '</w:r>',
      '<w:r><w:rPr><w:vertAlign w:val="subscript"/></w:rPr><w:t>Subscript run</w:t></w:r>',
      '<w:r><w:rPr><w:rStyle w:val="Accent"/></w:rPr><w:t>Character style run</w:t></w:r>',
      '</w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
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
      '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>',
      '<w:style w:type="character" w:styleId="Accent"><w:name w:val="Accent"/></w:style>',
      '</w:styles>'
    ].join('')
  }
}

/** 创建 T1 paragraph formatting DOCX package 的确定性 part 内容。 */
function createParagraphFormattingParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:pPr>',
      '<w:pStyle w:val="Normal"/>',
      '<w:jc w:val="center"/>',
      '<w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/>',
      '<w:ind w:left="720" w:firstLine="360"/>',
      '</w:pPr>',
      '<w:r><w:t>Formatted paragraph</w:t></w:r>',
      '</w:p>',
      '<w:p>',
      '<w:pPr>',
      '<w:pStyle w:val="Normal"/>',
      '<w:jc w:val="right"/>',
      '<w:spacing w:before="60" w:after="180" w:line="480" w:lineRule="auto"/>',
      '<w:ind w:left="960" w:hanging="240"/>',
      '</w:pPr>',
      '<w:r><w:t>Hanging paragraph</w:t></w:r>',
      '</w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建 T1 headings DOCX package 的确定性 part 内容。 */
function createHeadingsParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Heading One</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Heading Two</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Heading3"/></w:pPr><w:r><w:t>Heading Three</w:t></w:r></w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>',
      '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>',
      '<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>',
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/></w:style>'
    ])
  })
}

/** 创建 T1 lists DOCX package 的确定性 part 内容。 */
function createListsParts() {
  const parts = createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>Bullet item</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="6"/></w:numPr></w:pPr><w:r><w:t>Ordered item</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:pStyle w:val="Normal"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="5"/></w:numPr></w:pPr><w:r><w:t>Nested bullet item</w:t></w:r></w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })

  return {
    ...parts,
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '</Types>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdNumbering" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>',
      '</Relationships>'
    ].join(''),
    'word/numbering.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:abstractNum w:abstractNumId="1">',
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>',
      '<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/></w:lvl>',
      '</w:abstractNum>',
      '<w:abstractNum w:abstractNumId="2">',
      '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl>',
      '</w:abstractNum>',
      '<w:num w:numId="5"><w:abstractNumId w:val="1"/></w:num>',
      '<w:num w:numId="6"><w:abstractNumId w:val="2"/></w:num>',
      '</w:numbering>'
    ].join('')
  }
}

/** 创建 T1 basic table DOCX package 的确定性 part 内容。 */
function createTableParts() {
  return createBasicDocxParts({
    documentXml: [
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
      '<w:tblGrid><w:gridCol w:w="1600"/><w:gridCol w:w="1600"/></w:tblGrid>',
      '<w:tr>',
      '<w:tc><w:p><w:r><w:t>Cell A1</w:t></w:r></w:p></w:tc>',
      '<w:tc><w:p><w:r><w:t>Cell B1</w:t></w:r></w:p></w:tc>',
      '</w:tr>',
      '<w:tr>',
      '<w:tc><w:p><w:r><w:t>Cell A2</w:t></w:r></w:p></w:tc>',
      '<w:tc><w:p><w:r><w:t>Cell B2</w:t></w:r></w:p></w:tc>',
      '</w:tr>',
      '</w:tbl>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建 T1 inline image DOCX package 的确定性 part 内容。 */
function createInlineImageParts() {
  const parts = createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0">',
      '<wp:extent cx="2286000" cy="1143000"/>',
      '<wp:docPr id="1" name="Inline image" descr="Inline image fixture"/>',
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
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })

  return {
    ...parts,
    '[Content_Types].xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
      '<Default Extension="xml" ContentType="application/xml"/>',
      '<Default Extension="png" ContentType="image/png"/>',
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
      '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
      '</Types>'
    ].join(''),
    'word/_rels/document.xml.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdImage1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>',
      '</Relationships>'
    ].join(''),
    'word/media/image1.png': Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lG5T9QAAAABJRU5ErkJggg==',
      'base64'
    )
  }
}

/** 创建 T1 page setup DOCX package 的确定性 part 内容。 */
function createPageSetupParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:pPr><w:pStyle w:val="Normal"/></w:pPr>',
      '<w:r>',
      '<w:t>First page</w:t>',
      '<w:br w:type="page"/>',
      '<w:t>Second page</w:t>',
      '</w:r>',
      '</w:p>',
      '<w:sectPr>',
      '<w:pgSz w:w="10080" w:h="12960"/>',
      '<w:pgMar w:top="720" w:right="960" w:bottom="1080" w:left="1200"/>',
      '</w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建 T2 header/footer DOCX package 的确定性 part 内容。 */
function createHeaderFooterParts() {
  return createHeaderFooterDocxParts({
    documentXml: createDocumentWithSectionProperties([
      '<w:headerReference w:type="default" r:id="rIdHeader1"/>',
      '<w:footerReference w:type="default" r:id="rIdFooter1"/>'
    ]),
    headerXml: createHeaderXml('Gate 5 header text'),
    footerXml: createFooterXml('Gate 5 footer text')
  })
}

/** 创建 T2 page number DOCX package 的确定性 part 内容。 */
function createPageNumberParts() {
  return createHeaderFooterDocxParts({
    documentXml: createDocumentWithSectionProperties([
      '<w:footerReference w:type="default" r:id="rIdFooter1"/>',
      '<w:pgNumType w:start="1"/>'
    ]),
    footerXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:p><w:fldSimple w:instr="PAGE"/></w:p>',
      '</w:ftr>'
    ].join('')
  })
}

/** 创建 T2 comments DOCX package 的确定性 part 内容。 */
function createCommentsParts() {
  const parts = createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p>',
      '<w:commentRangeStart w:id="1"/>',
      '<w:r><w:t>Commented text</w:t></w:r>',
      '<w:commentRangeEnd w:id="1"/>',
      '<w:r><w:commentReference w:id="1"/></w:r>',
      '</w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })

  return {
    ...parts,
    '[Content_Types].xml': createContentTypesXml([
      '<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>'
    ]),
    'word/_rels/document.xml.rels': createDocumentRelationshipsXml([
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>'
    ]),
    'word/comments.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:comment w:id="1" w:author="JWord" w:date="2026-05-25T00:00:00Z">',
      '<w:p><w:r><w:t>Gate 5 comment body.</w:t></w:r></w:p>',
      '</w:comment>',
      '</w:comments>'
    ].join('')
  }
}

/** 创建 T2 external link DOCX package 的确定性 part 内容。 */
function createLinksParts() {
  const parts = createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p><w:hyperlink r:id="rIdLink1"><w:r><w:t>JWord external link</w:t></w:r></w:hyperlink></w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })

  return {
    ...parts,
    'word/_rels/document.xml.rels': createDocumentRelationshipsXml([
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      '<Relationship Id="rIdLink1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/jword-gate5" TargetMode="External"/>'
    ])
  }
}

/** 创建 T2 section breaks DOCX package 的确定性 part 内容。 */
function createSectionBreaksParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p><w:r><w:t>Section one text.</w:t></w:r></w:p>',
      '<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr><w:r><w:t>Section boundary paragraph.</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>Section two text.</w:t></w:r></w:p>',
      '<w:sectPr><w:type w:val="nextPage"/><w:pgSz w:w="10080" w:h="12960"/><w:pgMar w:top="720" w:right="960" w:bottom="1080" w:left="1200"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建 T2 floating object warning DOCX package 的确定性 part 内容。 */
function createFloatingObjectWarningParts() {
  return createBasicDocxParts({
    documentXml: [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p>',
      '<w:r>',
      '<w:drawing>',
      '<wp:anchor xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" simplePos="0" relativeHeight="0" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">',
      '<wp:simplePos x="0" y="0"/>',
      '<wp:extent cx="914400" cy="457200"/>',
      '<wp:docPr id="2" name="Floating warning shape"/>',
      '</wp:anchor>',
      '</w:drawing>',
      '</w:r>',
      '</w:p>',
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>',
      '</w:body>',
      '</w:document>'
    ].join(''),
    stylesXml: createStylesXml([
      '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
    ])
  })
}

/** 创建带 document/styles 的基础 DOCX package part 集合。 */
function createBasicDocxParts({ documentXml, stylesXml }) {
  return {
    '[Content_Types].xml': createContentTypesXml([]),
    '_rels/.rels': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>',
      '</Relationships>'
    ].join(''),
    'docProps/core.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/">',
      '<dc:title>JWord Gate 5 T1 Fixture</dc:title>',
      '<dc:creator>JWord</dc:creator>',
      '<dcterms:created>2026-05-25T00:00:00Z</dcterms:created>',
      '</cp:coreProperties>'
    ].join(''),
    'docProps/app.xml': [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">',
      '<Application>JWord fixture generator</Application>',
      '</Properties>'
    ].join(''),
    'word/document.xml': documentXml,
    'word/_rels/document.xml.rels': createDocumentRelationshipsXml([
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    ]),
    'word/styles.xml': stylesXml
  }
}

/** 创建带固定基础 part 的 content types XML。 */
function createContentTypesXml(extraOverrides) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
    ...extraOverrides,
    '</Types>'
  ].join('')
}

/** 创建 document.xml.rels 内容。 */
function createDocumentRelationshipsXml(relationships) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    ...relationships,
    '</Relationships>'
  ].join('')
}

/** 创建带 section properties 的单段正文。 */
function createDocumentWithSectionProperties(sectionProperties) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    '<w:body>',
    '<w:p><w:r><w:t>Gate 5 section body text.</w:t></w:r></w:p>',
    '<w:sectPr>',
    ...sectionProperties,
    '<w:pgSz w:w="12240" w:h="15840"/>',
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/>',
    '</w:sectPr>',
    '</w:body>',
    '</w:document>'
  ].join('')
}

/** 创建包含页眉页脚关系的 DOCX package。 */
function createHeaderFooterDocxParts({ documentXml, headerXml, footerXml }) {
  return {
    ...createBasicDocxParts({
      documentXml,
      stylesXml: createStylesXml([
        '<w:style w:type="paragraph" w:styleId="Normal" w:default="1"><w:name w:val="Normal"/></w:style>'
      ])
    }),
    '[Content_Types].xml': createContentTypesXml([
      ...(headerXml === undefined
        ? []
        : ['<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>']),
      ...(footerXml === undefined
        ? []
        : ['<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>'])
    ]),
    'word/_rels/document.xml.rels': createDocumentRelationshipsXml([
      '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>',
      ...(headerXml === undefined
        ? []
        : ['<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>']),
      ...(footerXml === undefined
        ? []
        : ['<Relationship Id="rIdFooter1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>'])
    ]),
    ...(headerXml === undefined ? {} : { 'word/header1.xml': headerXml }),
    ...(footerXml === undefined ? {} : { 'word/footer1.xml': footerXml })
  }
}

/** 创建基础 header XML。 */
function createHeaderXml(text) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
    '</w:hdr>'
  ].join('')
}

/** 创建基础 footer XML。 */
function createFooterXml(text) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
    '</w:ftr>'
  ].join('')
}

/** 创建 styles.xml 内容。 */
function createStylesXml(styleFragments) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
    ...styleFragments,
    '</w:styles>'
  ].join('')
}
