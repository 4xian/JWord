/**
 * 职责：提供 DOCX package/index 阶段复用的 XML 读值小工具。
 * 边界：不读取 ZIP，不建立 indexes，只从已解析 XML 节点读取文本、属性和值。
 * 协作模块：package.ts 和 import readers 复用这里保持 OOXML 读取语义一致。
 * 性能/安全约束：只消费内存中的 XmlElementNode，不访问 DOM、文件系统或网络。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-5---实现-opc-package-reader-与-xml-解析骨架。
 */

import type { XmlElementNode } from './xml.js'
import { readXmlAttribute, readXmlChildren } from './xml.js'

/** 读取直接子元素的 w:val。 */
export function readChildVal(element: XmlElementNode, localName: string): string | undefined {
  return readXmlChildren(element)
    .find((child) => child.localName === localName)
    ?.[
      'attributes'
    ].find((attribute) => attribute.name === 'w:val')?.value
}

/** 将直接子元素 w:val 映射到对象字段。 */
export function readChildValue<Key extends string>(
  element: XmlElementNode,
  localName: string,
  key: Key
): Partial<Record<Key, string>> {
  const value = readChildVal(element, localName)

  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>
}

/** 读取可选属性并映射为对象字段。 */
export function readOptionalAttribute<Key extends string>(
  element: XmlElementNode,
  attributeName: string,
  key: Key
): Partial<Record<Key, string>> {
  const value = readXmlAttribute(element, attributeName)

  return value === undefined ? {} : { [key]: value } as Partial<Record<Key, string>>
}


/** 读取元素下所有文本节点。 */
export function readElementText(element: XmlElementNode): string {
  return element.children.map((child) => child.kind === 'text' ? child.text : readElementText(child)).join('')
}

/** 读取正数或返回 undefined。 */
export function readPositiveNumber(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  const number = Number(value)

  return Number.isFinite(number) && number > 0 ? number : undefined
}
