/**
 * 职责：提供 DOCX XML 的最小 namespace-aware 解析和序列化抽象。
 * 边界：只负责 XML 字符串、元素树和少量 helper，不负责 OOXML 语义映射。
 * 协作模块：inspectDocxPackage、未来 style/numbering/mapping 复用这些 helper。
 * 约束：保持原始标签顺序、属性顺序、prefix 信息和 text node 顺序可复查。
 */

export interface XmlDocumentNode {
  readonly root: XmlElementNode
}

export interface XmlElementNode {
  readonly kind: 'element'
  readonly name: string
  readonly localName: string
  readonly prefix?: string
  readonly namespaceUri?: string
  readonly attributes: readonly XmlAttributeNode[]
  readonly children: readonly XmlNode[]
}

export interface XmlTextNode {
  readonly kind: 'text'
  readonly text: string
}

export interface XmlAttributeNode {
  readonly name: string
  readonly localName: string
  readonly prefix?: string
  readonly namespaceUri?: string
  readonly value: string
}

export type XmlNode = XmlElementNode | XmlTextNode

export interface XmlParseError extends Error {
  readonly name: 'XmlParseError'
  readonly code: 'XML_PARSE_INVALID'
}

/** 解析 XML 字符串为可复查的元素树。 */
export function parseXml(xml: string): XmlDocumentNode {
  const state = {
    input: xml,
    index: 0
  }
  skipXmlPrelude(state)
  const root = parseElement(state, new Map())

  skipWhitespace(state)
  if (state.index !== state.input.length) {
    throw createXmlParseError()
  }

  return { root }
}

/** 序列化 XML 元素树回字符串。 */
export function serializeXml(document: XmlDocumentNode): string {
  return serializeElement(document.root)
}

/** 读取元素指定属性值。 */
export function readXmlAttribute(element: XmlElementNode, name: string): string | undefined {
  return element.attributes.find((attribute) => attribute.name === name)?.value
}

/** 读取元素直接子元素。 */
export function readXmlChildren(element: XmlElementNode): readonly XmlElementNode[] {
  return element.children.filter(isElementNode)
}

/** 读取元素直接文本内容。 */
export function readXmlText(element: XmlElementNode): string {
  return element.children.map((child) => child.kind === 'text' ? child.text : readXmlText(child)).join('')
}

/** 按 prefix 读取当前节点及所有后代元素。 */
export function readXmlElementsByPrefix(
  element: XmlElementNode,
  prefix: string
): readonly XmlElementNode[] {
  return walkElements(element).filter((current) => current.prefix === prefix || current.name === `${prefix}:${current.localName}`)
}

/** 按 localName 读取当前节点及所有后代元素。 */
export function readXmlElementsByLocalName(
  element: XmlElementNode,
  localName: string
): readonly XmlElementNode[] {
  return walkElements(element).filter((current) => current.localName === localName)
}

interface ParserState {
  readonly input: string
  index: number
}

interface RawXmlAttributeNode {
  readonly name: string
  readonly value: string
}

function parseElement(
  state: ParserState,
  inheritedNamespaces: ReadonlyMap<string, string>
): XmlElementNode {
  skipWhitespace(state)
  expect(state, '<')

  const name = readName(state)
  const rawAttributes = readAttributes(state)
  const namespaces = readNamespaceContext(inheritedNamespaces, rawAttributes)
  const attributes = rawAttributes.map((attribute) => createAttribute(attribute.name, attribute.value, namespaces))
  const selfClosing = readSelfClosing(state)

  if (selfClosing) {
    return createElement(name, attributes, [], namespaces)
  }

  expect(state, '>')
  const children: XmlNode[] = []

  while (!startsWith(state, `</${name}>`)) {
    if (state.index >= state.input.length) {
      throw createXmlParseError()
    }

    if (peek(state) === '<') {
      if (startsWith(state, '<!--')) {
        skipComment(state)
        continue
      }

      if (startsWith(state, '<?')) {
        skipProcessingInstruction(state)
        continue
      }

      if (startsWith(state, '<![CDATA[')) {
        const text = readCdata(state)
        if (text !== '') {
          children.push({
            kind: 'text',
            text
          })
        }
        continue
      }

      children.push(parseElement(state, namespaces))
      continue
    }

    const text = readText(state)
    if (text !== '') {
      children.push({
        kind: 'text',
        text: decodeXml(text)
      })
    }
  }

  expect(state, `</${name}>`)

  return createElement(name, attributes, children, namespaces)
}

function readAttributes(state: ParserState): readonly RawXmlAttributeNode[] {
  const attributes: RawXmlAttributeNode[] = []

  while (true) {
    skipWhitespace(state)
    const next = peek(state)
    if (next === '/' || next === '>') {
      return attributes
    }

    const name = readName(state)
    skipWhitespace(state)
    expect(state, '=')
    skipWhitespace(state)
    const quote = peek(state)
    if (quote !== '"' && quote !== "'") {
      throw createXmlParseError()
    }

    state.index += 1
    const value = readUntil(state, quote)
    expect(state, quote)
    attributes.push({
      name,
      value: decodeXml(value)
    })
  }
}

function readSelfClosing(state: ParserState): boolean {
  skipWhitespace(state)
  if (startsWith(state, '/>')) {
    state.index += 2
    return true
  }

  return false
}

function readText(state: ParserState): string {
  const start = state.index

  while (state.index < state.input.length && peek(state) !== '<') {
    state.index += 1
  }

  return state.input.slice(start, state.index)
}

/** 读取 CDATA 段文本并保持原始字符语义。 */
function readCdata(state: ParserState): string {
  expect(state, '<![CDATA[')
  const end = state.input.indexOf(']]>', state.index)
  if (end === -1) {
    throw createXmlParseError()
  }

  const value = state.input.slice(state.index, end)
  state.index = end + 3

  return value
}

function readName(state: ParserState): string {
  const start = state.index

  while (state.index < state.input.length) {
    const char = peek(state)
    if (!/[A-Za-z0-9_:.-]/u.test(char)) {
      break
    }
    state.index += 1
  }

  if (start === state.index) {
    throw createXmlParseError()
  }

  return state.input.slice(start, state.index)
}

function readUntil(state: ParserState, terminator: string): string {
  const index = state.input.indexOf(terminator, state.index)
  if (index === -1) {
    throw createXmlParseError()
  }

  const value = state.input.slice(state.index, index)
  state.index = index
  return value
}

function skipWhitespace(state: ParserState): void {
  while (state.index < state.input.length && /\s/u.test(peek(state))) {
    state.index += 1
  }
}

function startsWith(state: ParserState, pattern: string): boolean {
  return state.input.startsWith(pattern, state.index)
}

function expect(state: ParserState, pattern: string): void {
  if (!startsWith(state, pattern)) {
    throw createXmlParseError()
  }

  state.index += pattern.length
}

function peek(state: ParserState): string {
  return state.input[state.index] ?? ''
}

function createElement(
  name: string,
  attributes: readonly XmlAttributeNode[],
  children: readonly XmlNode[],
  namespaces: ReadonlyMap<string, string>
): XmlElementNode {
  const [prefix, localName] = splitName(name)
  const namespaceUri = readNamespaceUri(namespaces, prefix)

  return {
    kind: 'element',
    name,
    localName,
    ...(prefix === undefined ? {} : { prefix }),
    ...(namespaceUri === undefined ? {} : { namespaceUri }),
    attributes,
    children
  }
}

function createAttribute(
  name: string,
  value: string,
  namespaces: ReadonlyMap<string, string>
): XmlAttributeNode {
  const [prefix, localName] = splitName(name)
  const namespaceUri = readAttributeNamespaceUri(name, prefix, namespaces)

  return {
    name,
    localName,
    ...(prefix === undefined ? {} : { prefix }),
    ...(namespaceUri === undefined ? {} : { namespaceUri }),
    value
  }
}

/** 合并祖先和当前元素的 namespace 声明。 */
function readNamespaceContext(
  inheritedNamespaces: ReadonlyMap<string, string>,
  attributes: readonly RawXmlAttributeNode[]
): ReadonlyMap<string, string> {
  const namespaces = new Map(inheritedNamespaces)

  for (const attribute of attributes) {
    if (attribute.name === 'xmlns') {
      namespaces.set('', attribute.value)
      continue
    }

    if (attribute.name.startsWith('xmlns:')) {
      namespaces.set(attribute.name.slice('xmlns:'.length), attribute.value)
    }
  }

  return namespaces
}

function splitName(name: string): readonly [string | undefined, string] {
  const index = name.indexOf(':')
  if (index === -1) {
    return [undefined, name]
  }

  return [name.slice(0, index), name.slice(index + 1)]
}

function readNamespaceUri(namespaces: ReadonlyMap<string, string>, prefix?: string): string | undefined {
  return namespaces.get(prefix ?? '')
}

/** 读取属性 namespace，默认 namespace 不作用于普通属性。 */
function readAttributeNamespaceUri(
  name: string,
  prefix: string | undefined,
  namespaces: ReadonlyMap<string, string>
): string | undefined {
  if (prefix === 'xml') {
    return 'http://www.w3.org/XML/1998/namespace'
  }

  if (name === 'xmlns' || prefix === 'xmlns') {
    return 'http://www.w3.org/2000/xmlns/'
  }

  return prefix === undefined ? undefined : namespaces.get(prefix)
}

function walkElements(element: XmlElementNode): readonly XmlElementNode[] {
  return [element, ...element.children.flatMap((child) => isElementNode(child) ? walkElements(child) : [])]
}

/** 序列化单个元素并保留属性顺序。 */
function serializeElement(element: XmlElementNode): string {
  const attrs = element.attributes.map((attribute) => `${attribute.name}="${escapeXml(attribute.value)}"`).join(' ')
  const attributeText = attrs === '' ? '' : ` ${attrs}`
  if (element.children.length === 0) {
    return `<${element.name}${attributeText}/>`
  }

  const children = element.children.map((child) => child.kind === 'text' ? escapeXml(child.text) : serializeElement(child)).join('')

  return `<${element.name}${attributeText}>${children}</${element.name}>`
}

function isElementNode(node: XmlNode): node is XmlElementNode {
  return node.kind === 'element'
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/** 解码 XML predefined entities，保持 parser 对 OOXML 文本和属性的真实值语义。 */
function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9A-Fa-f]+);/gu, (_, codePoint: string) => readNumericCharacterReference(codePoint, 16))
    .replace(/&#([0-9]+);/gu, (_, codePoint: string) => readNumericCharacterReference(codePoint, 10))
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}

/** 解码 XML 数值字符引用。 */
function readNumericCharacterReference(value: string, radix: number): string {
  const codePoint = Number.parseInt(value, radix)
  if (!Number.isInteger(codePoint) || codePoint < 0 || codePoint > 0x10FFFF) {
    throw createXmlParseError()
  }

  return String.fromCodePoint(codePoint)
}

/** 跳过 XML 声明、处理指令和前置空白。 */
function skipXmlPrelude(state: ParserState): void {
  while (true) {
    skipWhitespace(state)

    if (startsWith(state, '<?')) {
      skipProcessingInstruction(state)
      continue
    }

    if (startsWith(state, '<!--')) {
      skipComment(state)
      continue
    }

    break
  }
}

/** 跳过处理指令。 */
function skipProcessingInstruction(state: ParserState): void {
  expect(state, '<?')
  const end = state.input.indexOf('?>', state.index)
  if (end === -1) {
    throw createXmlParseError()
  }

  state.index = end + 2
}

/** 跳过注释。 */
function skipComment(state: ParserState): void {
  expect(state, '<!--')
  const end = state.input.indexOf('-->', state.index)
  if (end === -1) {
    throw createXmlParseError()
  }

  state.index = end + 3
}

function createXmlParseError(): XmlParseError {
  return Object.assign(new Error('XML_PARSE_INVALID'), {
    name: 'XmlParseError' as const,
    code: 'XML_PARSE_INVALID' as const
  }) as XmlParseError
}
