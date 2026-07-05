/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 5 DOCX XML parser/serializer 抽象的最小可执行契约。
 * 边界：只覆盖 namespace-aware 读写、children 顺序和 parse error，不测试 OOXML mapping。
 * 协作模块：packages/docx/src/xml.ts 后续供 inspectDocxPackage 和 OOXML mapping 复用。
 * 约束：先写失败测试，再落最小 parser/serializer。
 */

import { describe, expect, it } from 'vitest'

import {
  parseXml,
  readXmlAttribute,
  readXmlChildren,
  readXmlElementsByLocalName,
  readXmlElementsByPrefix,
  readXmlText,
  serializeXml
} from '../src/xml'

describe('docx xml helper', () => {
  it('parses and serializes namespace-aware OOXML elements in order', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p r:id="rId1">',
      '<w:r><w:t>Hello</w:t></w:r>',
      '<w:bookmarkStart w:id="1" w:name="mark"/>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')

    const document = parseXml(xml)
    const words = readXmlElementsByPrefix(document.root, 'w').map((element) => element.name)
    const paragraph = readXmlElementsByPrefix(document.root, 'w').find((element) => element.name === 'w:p')

    expect(document.root.name).toBe('w:document')
    expect(words).toEqual([
      'w:document',
      'w:body',
      'w:p',
      'w:r',
      'w:t',
      'w:bookmarkStart'
    ])
    expect(paragraph).toBeDefined()
    expect(readXmlAttribute(paragraph!, 'r:id')).toBe('rId1')
    expect(readXmlChildren(paragraph!).map((element) => element.name)).toEqual([
      'w:r',
      'w:bookmarkStart'
    ])
    expect(readXmlText(paragraph!)).toBe('Hello')
    expect(serializeXml(document)).toBe(xml)
  })

  it('reads default-namespace relationship parts by local name', () => {
    const xml = [
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>',
      '</Relationships>'
    ].join('')

    const document = parseXml(xml)
    const relationships = readXmlElementsByLocalName(document.root, 'Relationship')

    expect(relationships).toHaveLength(1)
    expect(readXmlAttribute(relationships[0]!, 'Id')).toBe('rId1')
    expect(readXmlAttribute(relationships[0]!, 'Target')).toBe('word/document.xml')
    expect(serializeXml(document)).toBe(xml)
  })

  it('decodes predefined XML entities when reading text and attributes', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p w:hint="A &amp; B &quot;C&quot;">',
      '<w:r><w:t>A &amp; B &lt;tag&gt;</w:t></w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')

    const document = parseXml(xml)
    const paragraph = readXmlElementsByLocalName(document.root, 'p')[0]
    const text = readXmlElementsByLocalName(document.root, 't')[0]

    expect(readXmlAttribute(paragraph!, 'w:hint')).toBe('A & B "C"')
    expect(readXmlText(text!)).toBe('A & B <tag>')
    expect(serializeXml(document)).toBe(xml)
  })


  it('decodes numeric character references and CDATA text', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">',
      '<w:body>',
      '<w:p w:hint="A &#x26; B &#38; C">',
      '<w:r><w:t>Alpha &#x1F600; &#169;</w:t><![CDATA[<raw>&text]]></w:r>',
      '</w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')

    const document = parseXml(xml)
    const paragraph = readXmlElementsByLocalName(document.root, 'p')[0]
    const run = readXmlElementsByLocalName(document.root, 'r')[0]

    expect(readXmlAttribute(paragraph!, 'w:hint')).toBe('A & B & C')
    expect(readXmlText(run!)).toBe('Alpha 😀 ©<raw>&text')
  })

  it('inherits namespace declarations from ancestor elements', () => {
    const xml = [
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '<w:body>',
      '<w:p r:id="rId1"><w:r><w:t>Hello</w:t></w:r></w:p>',
      '</w:body>',
      '</w:document>'
    ].join('')

    const document = parseXml(xml)
    const paragraph = readXmlElementsByLocalName(document.root, 'p')[0]
    const relationshipId = paragraph!.attributes.find((attribute) => attribute.name === 'r:id')

    expect(paragraph!.namespaceUri).toBe('http://schemas.openxmlformats.org/wordprocessingml/2006/main')
    expect(relationshipId?.namespaceUri).toBe('http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  })

  it('throws a structured parse error for malformed XML', () => {
    expect(() => parseXml('<w:document><w:body></w:document>')).toThrowError(expect.objectContaining({
      name: 'XmlParseError',
      code: 'XML_PARSE_INVALID'
    }))
  })
})
