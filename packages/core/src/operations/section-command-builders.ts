/**
 * 职责：构造 Gate 4 分节、页眉页脚和页码基础命令。
 * 边界：只生成 section properties 操作，不执行事务、不访问 DOM、不处理页眉页脚正文编辑。
 * 协作模块：transaction pipeline、operation adapter、projection 与 layout 共同消费这些 section 语义。
 * 性能/安全约束：builder 只定位现有 section，不扫描正文内容或生成额外模型节点。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Step 4.13。
 */

import type { DocumentProjection } from '../model/projection'
import type { Section } from '../model/types'
import type { Command } from './transaction'

export interface SectionPropertiesInput {
  readonly breakType?: Section['breakType']
  readonly page?: Section['page']
  readonly columns?: number
  readonly headerIds?: readonly string[]
  readonly footerIds?: readonly string[]
  readonly headerFooterSameAsPrevious?: boolean
  readonly pageNumbering?: Section['pageNumbering'] | null
}

/**
 * 构造设置 section 属性的命令。
 */
export function buildSetSectionPropertiesCommand(
  projection: DocumentProjection,
  sectionId: string,
  input: SectionPropertiesInput
): Command | null {
  const section = projection.document.sections.find((candidate) => candidate.id === sectionId)

  if (section === undefined) {
    return null
  }

  return {
    name: 'setSectionProperties',
    operations: [{
      kind: 'setSectionProperties',
      sectionId,
      properties: {
        ...(input.breakType === undefined ? {} : { breakType: input.breakType }),
        ...(input.page === undefined ? {} : { page: input.page }),
        ...(input.columns === undefined ? {} : { columns: input.columns }),
        ...(input.headerFooterSameAsPrevious === undefined
          ? {}
          : { headerFooterSameAsPrevious: input.headerFooterSameAsPrevious }),
        ...(input.pageNumbering === undefined ? {} : { pageNumbering: input.pageNumbering })
      },
      ...(input.headerIds === undefined ? {} : { headerIds: input.headerIds }),
      ...(input.footerIds === undefined ? {} : { footerIds: input.footerIds })
    }]
  }
}
