/**
 * 职责：提供 native package schema 迁移链和迁移可达性诊断。
 * 边界：不读取 zip，不创建 package entry，不处理资源 checksum。
 * 协作模块：包读取阶段调用迁移可达性检查，加载阶段调用迁移执行入口。
 * 性能/安全约束：迁移只处理 canonical document 快照，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { JWORD_NATIVE_SCHEMA_VERSION } from './types.js'
import { createPackageError, createWarning } from './diagnostics.js'
import type { VersionedJWordDocument } from './document-schema.js'
import type {
  JWordPackageMigrationReport
} from './types.js'

interface SchemaMigrationStep {
  readonly id: string
  readonly from: number
  readonly to: number
  readonly migrate: (document: unknown) => unknown
}

const SCHEMA_MIGRATION_STEPS: readonly SchemaMigrationStep[] = [
  {
    id: 'schema-0-to-1',
    from: 0,
    to: 1,
    migrate: migrateSchema0To1
  },
  {
    id: 'schema-1-to-2',
    from: 1,
    to: 2,
    migrate: migrateSchema1To2
  }
]

/** 对已通过来源版本 parser 的 document 执行 schema migration。 */
export function migrateJWordDocument(
  document: VersionedJWordDocument,
  sourceVersion: number,
  requestId?: string
): {
  readonly document: VersionedJWordDocument
  readonly report: JWordPackageMigrationReport
} {
  const appliedSteps: string[] = []
  let currentDocument = document.value
  let currentVersion = sourceVersion

  if (document.schemaVersion !== sourceVersion) {
    throw createPackageError(
      'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
      'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
      requestId,
      'manifest.json'
    )
  }

  while (currentVersion !== JWORD_NATIVE_SCHEMA_VERSION) {
    const step = findSchemaMigrationStep(currentVersion)

    if (step === undefined) {
      throw createPackageError(
        currentVersion > JWORD_NATIVE_SCHEMA_VERSION ? 'JWORD_NATIVE_SCHEMA_FUTURE' : 'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
        `schemaVersion ${sourceVersion} 无法迁移到当前 schema ${JWORD_NATIVE_SCHEMA_VERSION}`,
        requestId,
        'manifest.json'
      )
    }

    if (step.to <= currentVersion || step.to > JWORD_NATIVE_SCHEMA_VERSION) {
      throw createPackageError(
        'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
        `schema migration ${step.id} 目标版本无效`,
        requestId,
        'manifest.json'
      )
    }

    currentDocument = step.migrate(currentDocument)
    currentVersion = step.to
    appliedSteps.push(step.id)
  }

  const warnings = appliedSteps.length === 0
    ? []
    : [
        createWarning(
          'JWORD_NATIVE_OLD_SCHEMA_MIGRATED',
          `旧 schemaVersion ${sourceVersion} 已迁移到当前 schema。`,
          requestId,
          'manifest.json'
        )
      ]

  return {
    document: {
      schemaVersion: currentVersion,
      value: currentDocument
    },
    report: {
      sourceVersion,
      targetVersion: JWORD_NATIVE_SCHEMA_VERSION,
      appliedSteps,
      warnings
    }
  }
}

/** 查找从指定 schema 版本出发的迁移步骤。 */
function findSchemaMigrationStep(sourceVersion: number): SchemaMigrationStep | undefined {
  return SCHEMA_MIGRATION_STEPS.find((step) => step.from === sourceVersion)
}

/** 执行 schema 0 到 1 的显式空迁移。 */
function migrateSchema0To1(document: unknown): unknown {
  // schema 0 与 1 的 canonical document 结构一致，此步骤仅冻结迁移链语义。
  return document
}

/** 执行 schema 1 到 2 的显式空迁移。 */
function migrateSchema1To2(document: unknown): unknown {
  // schema 2 新增 package 逻辑资源引用，旧 document 无需改写即可进入当前 parser。
  return document
}
