/**
 * 职责：根据 DOCX relationships 建立 part graph 并生成 relationship 诊断 warning。
 * 边界：不读取 ZIP，不解析 XML，只处理已经读取出的 relationship 与 part path。
 * 协作模块：package.ts 调用这里收敛 part graph 与缺失/越界 relationship warning。
 * 性能/安全约束：所有路径均通过 package-paths 归一化，不访问文件系统或网络。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-5---实现-opc-package-reader-与-xml-解析骨架。
 */

import { normalizePartPathWithDiagnostics, resolvePartTarget } from './package-paths.js'
import type { DocxPartGraph, DocxWarning } from './types.js'
import type { DocxRelationship } from './package.js'

/** 根据 document relationships 建立 Gate 5 第一版 part graph。 */
export function createDocxPartGraph(
  documentPart: string,
  relationships: readonly DocxRelationship[]
): DocxPartGraph {
  const resolved = relationships.map((relationship) => ({
    ...relationship,
    target: resolvePartTarget(documentPart, relationship.target)
  }))

  return {
    document: documentPart,
    ...readOptionalPart(resolved, 'styles', 'styles'),
    ...readOptionalPart(resolved, 'numbering', 'numbering'),
    ...readOptionalPart(resolved, 'settings', 'settings'),
    ...readOptionalPart(resolved, 'theme', 'theme'),
    headers: readRelationshipTargets(resolved, 'header'),
    footers: readRelationshipTargets(resolved, 'footer'),
    comments: readRelationshipTargets(resolved, 'comments'),
    media: resolved
      .filter((relationship) => relationship.kind === 'image' && relationship.targetMode !== 'External')
      .map((relationship) => relationship.target)
  }
}

/** 读取可选单例 part。 */
function readOptionalPart(
  relationships: readonly DocxRelationship[],
  property: 'styles' | 'numbering' | 'settings' | 'theme',
  kind: string
): Partial<Pick<DocxPartGraph, typeof property>> {
  const target = relationships.find((relationship) => relationship.kind === kind && relationship.targetMode !== 'External')?.target

  return target === undefined ? {} : { [property]: target }
}

/** 读取同类 relationship 目标路径。 */
function readRelationshipTargets(
  relationships: readonly DocxRelationship[],
  kind: string
): readonly string[] {
  return relationships
    .filter((relationship) => relationship.kind === kind && relationship.targetMode !== 'External')
    .map((relationship) => relationship.target)
}

/** 为断裂的 document relationships 生成可恢复 warning。 */
export function readMissingRelationshipWarnings(
  relationshipsPart: string,
  relationships: readonly DocxRelationship[],
  parts: readonly string[],
  sourcePart: string
): readonly DocxWarning[] {
  return relationships.flatMap((relationship) => {
    if (relationship.targetMode === 'External') {
      return []
    }

    const target = resolvePartTarget(sourcePart, relationship.target)

    if (parts.includes(target)) {
      return []
    }

    return [
      {
        code: 'DOCX_RELATIONSHIP_TARGET_MISSING',
        severity: 'warning',
        part: relationshipsPart,
        path: target,
        message: `DOCX relationship target is missing: ${target}`,
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      }
    ]
  })
}

/** 为越过 package 根的 document relationships 生成可恢复 warning。 */
export function readRelationshipTargetTraversalWarnings(
  relationshipsPart: string,
  relationships: readonly DocxRelationship[],
  sourcePart: string
): readonly DocxWarning[] {
  return relationships.flatMap((relationship) => {
    if (relationship.targetMode === 'External' || !readPartTargetTraversesAboveRoot(sourcePart, relationship.target)) {
      return []
    }

    return [
      {
        code: 'DOCX_RELATIONSHIP_TARGET_TRAVERSAL_UNSUPPORTED',
        severity: 'warning',
        part: relationshipsPart,
        path: relationship.target,
        message: `DOCX relationship target traverses above the package root: ${relationship.target}`,
        fallback: 'preserve-relationship-metadata',
        recoverable: true
      }
    ]
  })
}

/** 判断 relationship target 是否通过多余 .. 越过 package 根。 */
function readPartTargetTraversesAboveRoot(sourcePart: string, target: string): boolean {
  const path = target.startsWith('/')
    ? target.slice(1)
    : `${readPartDirectory(sourcePart)}${target}`

  return normalizePartPathWithDiagnostics(path).traversalOverflow
}

/** 读取 part 所在目录。 */
function readPartDirectory(part: string): string {
  const slashIndex = part.lastIndexOf('/')

  return slashIndex === -1 ? '' : `${part.slice(0, slashIndex)}/`
}
