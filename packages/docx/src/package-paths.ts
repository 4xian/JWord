/**
 * 职责：封装 DOCX OPC part path 解析和稳定 import id 生成。
 * 边界：只处理字符串路径，不读取 ZIP、XML 或 package 内容。
 * 协作模块：package.ts 和 import.ts 复用这些路径工具。
 * 性能/安全约束：纯函数，无运行时副作用。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

/** 读取某个 part 对应的 relationships part 路径。 */
export function readRelationshipPartPath(part: string): string {
  const slashIndex = part.lastIndexOf('/')
  const directory = slashIndex === -1 ? '' : `${part.slice(0, slashIndex)}/`
  const filename = slashIndex === -1 ? part : part.slice(slashIndex + 1)

  return `${directory}_rels/${filename}.rels`
}

/** 根据 relationship target 和来源 part 解析 package 内目标路径。 */
export function resolvePartTarget(sourcePart: string, target: string): string {
  if (target.startsWith('/')) {
    return target.slice(1)
  }

  const slashIndex = sourcePart.lastIndexOf('/')
  const directory = slashIndex === -1 ? '' : `${sourcePart.slice(0, slashIndex)}/`

  return normalizePartPath(`${directory}${target}`)
}

/** 规范化 OPC part 路径中的简单相对片段。 */
export function normalizePartPath(path: string): string {
  return normalizePartPathWithDiagnostics(path).path
}

export interface NormalizePartPathDiagnostics {
  readonly path: string
  readonly traversalOverflow: boolean
}

/** 规范化 OPC part 路径并标记是否向上越过 package 根。 */
export function normalizePartPathWithDiagnostics(path: string): NormalizePartPathDiagnostics {
  const segments: string[] = []
  let traversalOverflow = false

  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') {
      continue
    }

    if (segment === '..') {
      if (segments.length === 0) {
        traversalOverflow = true
      } else {
        segments.pop()
      }
      continue
    }

    segments.push(segment)
  }

  return {
    path: segments.join('/'),
    traversalOverflow
  }
}
/** 生成当前作用域下稳定的 DOCX id。 */
export function readScopedDocxId(scope: string, kind: 'paragraph' | 'table' | 'run' | 'row' | 'cell', index: number): string {
  const suffix = `${kind}-${index}`

  return scope === '' ? suffix : `${scope}-${suffix}`
}
