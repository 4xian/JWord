/**
 * 职责：提供 editor 富文本粘贴与插入命令构造使用的纯辅助函数。
 * 边界：不读取 DOM，不执行 transaction，只归一化结构化片段并分配运行时 run id。
 * 协作模块：text-editing-runtime 调用这里生成富文本 operation 所需的安全输入。
 * 性能/安全约束：只消费 projection 与已清洗的富文本片段，不持有外部可变引用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { isAllowedLinkUrl } from '../link/policy'
import type { DocumentProjection } from '../model/projection'
import type { ModelProperties, RunLink } from '../model/types'
import type { Operation } from '../operations/transaction'
import type { EditorRichTextFragment, EditorRichTextRun } from './types'
import { collectParagraphRuntimeContexts, normalizePlainText } from './text-runtime'

export interface NormalizedRichTextRun {
  readonly text: string
  readonly properties: ModelProperties
  readonly link?: RunLink
}

export interface NormalizedRichTextParagraph {
  readonly properties: ModelProperties
  readonly runs: readonly NormalizedRichTextRun[]
}

export function collectProjectionRunIds(
  projection: DocumentProjection
): Set<string> {
  return new Set(
    collectParagraphRuntimeContexts(projection).flatMap((paragraph) => paragraph.runs.map((run) => run.id))
  )
}

export function allocateGeneratedRuntimeRunId(
  usedRunIds: Set<string>,
  runId: string,
  suffix: 'format' | 'tail' | 'link'
): string {
  let sequence = 1
  let candidate = `${runId}__${suffix}-${sequence}`

  while (usedRunIds.has(candidate)) {
    sequence += 1
    candidate = `${runId}__${suffix}-${sequence}`
  }

  usedRunIds.add(candidate)

  return candidate
}

/** 归一化富文本粘贴片段，丢弃空文本 run 和空段落。 */
export function normalizeRichTextParagraphs(fragment: EditorRichTextFragment): readonly NormalizedRichTextParagraph[] {
  return fragment.paragraphs.flatMap((paragraph) => {
    const runs = normalizeRichTextRuns(paragraph.runs)

    if (runs.length === 0) {
      return []
    }

    return [{
      properties: normalizeModelProperties(paragraph.properties),
      runs
    }]
  })
}

/** 归一化富文本 run，避免空字符串生成无效 operation。 */
function normalizeRichTextRuns(runs: readonly EditorRichTextRun[]): readonly NormalizedRichTextRun[] {
  return runs.flatMap((run) => {
    const text = normalizePlainText(run.text)

    if (text.length === 0) {
      return []
    }

    const link = readRichTextRunLink(run.properties)

    return [{
      text,
      properties: normalizeRichTextRunProperties(run.properties),
      ...(link === undefined ? {} : { link })
    }]
  })
}

/** 归一化 run 属性，并显式清掉上一段 split 继承来的常见格式。 */
function normalizeRichTextRunProperties(properties: ModelProperties | undefined): ModelProperties {
  const { link: _link, ...restProperties } = normalizeModelProperties(properties)

  return Object.freeze({
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    superscript: false,
    subscript: false,
    color: null,
    backgroundColor: null,
    fontFamily: null,
    fontSizePx: null,
    fontSizeTwips: null,
    ...restProperties
  })
}

/** 从富文本 run 属性读取安全链接元数据。 */
function readRichTextRunLink(properties: ModelProperties | undefined): RunLink | undefined {
  const link = properties?.link

  if (typeof link !== 'object' || link === null) {
    return undefined
  }

  const candidate = link as Partial<RunLink>

  return typeof candidate.target === 'string' && isAllowedLinkUrl(candidate.target)
    ? {
        target: candidate.target,
        ...(typeof candidate.tooltip === 'string' ? { tooltip: candidate.tooltip } : {})
      }
    : undefined
}

/** 复制模型属性对象，避免事务构造持有外部可变引用。 */
function normalizeModelProperties(properties: ModelProperties | undefined): ModelProperties {
  if (properties === undefined) {
    return {}
  }

  return Object.freeze({ ...properties })
}

/** 判断模型属性是否包含可写入字段。 */
export function hasModelProperties(properties: ModelProperties): boolean {
  return Object.keys(properties).length > 0
}

/** 把富文本段落属性追加到已生成的段落上。 */
export function appendRichTextParagraphPropertyOperations(
  operations: Operation[],
  paragraphs: readonly NormalizedRichTextParagraph[],
  paragraphIds: readonly string[]
): void {
  for (let index = 0; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index]
    const paragraphId = paragraphIds[index]

    if (paragraph === undefined || paragraphId === undefined || !hasModelProperties(paragraph.properties)) {
      continue
    }

    operations.push({
      kind: 'setParagraphProperties',
      paragraphId,
      properties: paragraph.properties
    })
  }
}
