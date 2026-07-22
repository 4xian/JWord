/**
 * 职责：在 JSON.parse 前严格扫描 JSON 语法、重复解码 key 和固定结构预算。
 * 边界：只返回顶层 JSON object，不解释 manifest、checksum 或 document 业务字段。
 * 协作模块：package-readers.ts、package-read-budget.ts 和 diagnostics.ts。
 * 性能/安全约束：递归深度与 value 数在扫描期间受固定预算约束，不复制原始输入到错误。
 * 实现说明：使用递归下降扫描器处理字符串 escape 和嵌套值，不使用正则近似 object 结构。
 */

import { createPackageError } from './diagnostics.js'
import { JWORD_NATIVE_PACKAGE_LIMITS, assertNativePackageLimit } from './package-read-budget.js'
import { JWordNativePackageError } from './types.js'
import { isRecord, type JsonRecord } from './utils.js'
import type { JWordPackageErrorCode } from './types.js'

interface StrictJsonOptions {
  readonly entry: string
  readonly invalidCode: JWordPackageErrorCode
  readonly requestId?: string
}

/** 在 JSON.parse 前完成严格扫描并返回顶层对象。 */
export function parseStrictJsonRecord(text: string, options: StrictJsonOptions): JsonRecord {
  try {
    new StrictJsonScanner(text, options).scan()
    const parsed = JSON.parse(text) as unknown

    if (!isRecord(parsed)) {
      throwInvalidJson(options)
    }

    return parsed
  } catch (error) {
    if (error instanceof JWordNativePackageError) {
      throw error
    }

    throwInvalidJson(options)
  }
}

class StrictJsonScanner {
  private index = 0
  private valueCount = 0

  /** 创建绑定单个 JSON entry 的扫描器。 */
  constructor(
    private readonly text: string,
    private readonly options: StrictJsonOptions
  ) {}

  /** 扫描唯一顶层 value 并要求输入完整消费。 */
  scan(): void {
    this.skipWhitespace()
    this.scanValue(0)
    this.skipWhitespace()

    if (this.index !== this.text.length) {
      this.fail()
    }
  }

  /** 扫描一个 JSON value 并累计固定 value 预算。 */
  private scanValue(depth: number): void {
    this.valueCount += 1
    assertNativePackageLimit(
      this.valueCount,
      JWORD_NATIVE_PACKAGE_LIMITS.jsonValueCount,
      this.options.requestId,
      this.options.entry
    )

    const token = this.text[this.index]

    if (token === '{') {
      this.scanObject(depth + 1)
      return
    }
    if (token === '[') {
      this.scanArray(depth + 1)
      return
    }
    if (token === '"') {
      this.scanString()
      return
    }
    if (token === '-' || isDigit(token)) {
      this.scanNumber()
      return
    }
    if (token === 't') {
      this.scanLiteral('true')
      return
    }
    if (token === 'f') {
      this.scanLiteral('false')
      return
    }
    if (token === 'n') {
      this.scanLiteral('null')
      return
    }

    this.fail()
  }

  /** 扫描 object，并在当前层按解码后的 key 检测重复。 */
  private scanObject(depth: number): void {
    this.assertDepth(depth)
    this.index += 1
    this.skipWhitespace()

    if (this.consume('}')) {
      return
    }

    const keys = new Set<string>()

    while (true) {
      if (this.text[this.index] !== '"') {
        this.fail()
      }

      const key = this.scanString()

      if (keys.has(key)) {
        this.fail()
      }
      keys.add(key)
      this.skipWhitespace()

      if (!this.consume(':')) {
        this.fail()
      }

      this.skipWhitespace()
      this.scanValue(depth)
      this.skipWhitespace()

      if (this.consume('}')) {
        return
      }
      if (!this.consume(',')) {
        this.fail()
      }
      this.skipWhitespace()
    }
  }

  /** 扫描 array 及其中全部嵌套 value。 */
  private scanArray(depth: number): void {
    this.assertDepth(depth)
    this.index += 1
    this.skipWhitespace()

    if (this.consume(']')) {
      return
    }

    while (true) {
      this.scanValue(depth)
      this.skipWhitespace()

      if (this.consume(']')) {
        return
      }
      if (!this.consume(',')) {
        this.fail()
      }
      this.skipWhitespace()
    }
  }

  /** 扫描 JSON string 并返回 JSON 解码后的字符串值。 */
  private scanString(): string {
    const start = this.index

    this.index += 1

    while (this.index < this.text.length) {
      const token = this.text[this.index]

      if (token === '"') {
        this.index += 1

        try {
          return JSON.parse(this.text.slice(start, this.index)) as string
        } catch {
          this.fail()
        }
      }

      if (token === '\\') {
        this.scanEscape()
        continue
      }
      if (token === undefined || token.charCodeAt(0) <= 0x1f) {
        this.fail()
      }

      this.index += 1
    }

    this.fail()
  }

  /** 扫描 string 内一个合法 JSON escape。 */
  private scanEscape(): void {
    this.index += 1
    const escape = this.text[this.index]

    if (escape === 'u') {
      const hex = this.text.slice(this.index + 1, this.index + 5)

      if (hex.length !== 4 || !isHexQuad(hex)) {
        this.fail()
      }

      this.index += 5
      return
    }
    if (escape === undefined || !'"\\/bfnrt'.includes(escape)) {
      this.fail()
    }

    this.index += 1
  }

  /** 扫描符合 JSON grammar 且解析后为有限值的 number 文本。 */
  private scanNumber(): void {
    const start = this.index

    if (this.consume('-') && !isDigit(this.text[this.index])) {
      this.fail()
    }

    if (this.consume('0')) {
      if (isDigit(this.text[this.index])) {
        this.fail()
      }
    } else {
      if (!isNonZeroDigit(this.text[this.index])) {
        this.fail()
      }
      while (isDigit(this.text[this.index])) {
        this.index += 1
      }
    }

    if (this.consume('.')) {
      if (!isDigit(this.text[this.index])) {
        this.fail()
      }
      while (isDigit(this.text[this.index])) {
        this.index += 1
      }
    }

    const exponent = this.text[this.index]

    if (exponent === 'e' || exponent === 'E') {
      this.index += 1
      const sign = this.text[this.index]

      if (sign === '+' || sign === '-') {
        this.index += 1
      }
      if (!isDigit(this.text[this.index])) {
        this.fail()
      }
      while (isDigit(this.text[this.index])) {
        this.index += 1
      }
    }

    if (!Number.isFinite(Number(this.text.slice(start, this.index)))) {
      this.fail()
    }
  }

  /** 扫描 true、false 或 null 字面量。 */
  private scanLiteral(literal: 'true' | 'false' | 'null'): void {
    if (this.text.slice(this.index, this.index + literal.length) !== literal) {
      this.fail()
    }

    this.index += literal.length
  }

  /** 消费一个精确字符并报告是否命中。 */
  private consume(token: string): boolean {
    if (this.text[this.index] !== token) {
      return false
    }

    this.index += 1
    return true
  }

  /** 跳过 JSON grammar 允许的空白字符。 */
  private skipWhitespace(): void {
    while (isJsonWhitespace(this.text[this.index])) {
      this.index += 1
    }
  }

  /** 检查 object/array 当前嵌套深度预算。 */
  private assertDepth(depth: number): void {
    assertNativePackageLimit(
      depth,
      JWORD_NATIVE_PACKAGE_LIMITS.jsonDepth,
      this.options.requestId,
      this.options.entry
    )
  }

  /** 抛出不含原始 JSON 内容的稳定结构错误。 */
  private fail(): never {
    throwInvalidJson(this.options)
  }
}

/** 判断字符是否是十进制数字。 */
function isDigit(token: string | undefined): boolean {
  return token !== undefined && token >= '0' && token <= '9'
}

/** 判断字符是否是非零十进制数字。 */
function isNonZeroDigit(token: string | undefined): boolean {
  return token !== undefined && token >= '1' && token <= '9'
}

/** 判断四字符文本是否都是十六进制数字。 */
function isHexQuad(input: string): boolean {
  for (const token of input) {
    const decimal = token >= '0' && token <= '9'
    const lower = token >= 'a' && token <= 'f'
    const upper = token >= 'A' && token <= 'F'

    if (!decimal && !lower && !upper) {
      return false
    }
  }

  return true
}

/** 判断字符是否是 JSON grammar 允许的空白。 */
function isJsonWhitespace(token: string | undefined): boolean {
  return token === ' ' || token === '\t' || token === '\n' || token === '\r'
}

/** 抛出不含原始输入的稳定 JSON 结构错误。 */
function throwInvalidJson(options: StrictJsonOptions): never {
  throw createPackageError(
    options.invalidCode,
    options.invalidCode,
    options.requestId,
    options.entry
  )
}
