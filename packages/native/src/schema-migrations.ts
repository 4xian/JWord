/**
 * 职责：提供 native package schema 迁移链和迁移可达性诊断。
 * 边界：不读取 zip，不创建 package entry，不处理资源 checksum。
 * 协作模块：包读取阶段调用迁移可达性检查，加载阶段调用迁移执行入口。
 * 性能/安全约束：迁移只处理 canonical document 快照，不访问 DOM、网络或磁盘。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import type { Document } from '@4xian/jword-core'

import { JWORD_NATIVE_SCHEMA_VERSION } from './types.js'
import { createDiagnostic, createPackageError, createWarning } from './diagnostics.js'
import type {
  JWordPackageDiagnostic,
  JWordPackageMigrationReport
} from './types.js'

interface SchemaMigrationStep {
  readonly id: string
  readonly from: number
  readonly to: number
  readonly migrate: (document: Document) => Document
}

const SCHEMA_MIGRATION_STEPS: readonly SchemaMigrationStep[] = [
  {
    id: 'schema-0-to-1',
    from: 0,
    to: 1,
    migrate: migrateSchema0To1
  }
]

/** 执行 schema migration。 */
export function migrateDocument(
  document: Document,
  sourceVersion: number,
  requestId?: string
): {
  readonly document: Document
  readonly report: JWordPackageMigrationReport
} {
  const appliedSteps: string[] = []
  let currentDocument = document
  let currentVersion = sourceVersion

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
    document: currentDocument,
    report: {
      sourceVersion,
      targetVersion: JWORD_NATIVE_SCHEMA_VERSION,
      appliedSteps,
      warnings
    }
  }
}

/** 检查 schema migration 是否存在可达路径。 */
export function inspectSchemaMigrationSupport(
  sourceVersion: number,
  diagnostics: JWordPackageDiagnostic[],
  requestId?: string
): void {
  if (sourceVersion >= JWORD_NATIVE_SCHEMA_VERSION || hasSchemaMigrationPath(sourceVersion)) {
    return
  }

  diagnostics.push(createDiagnostic({
    code: 'JWORD_NATIVE_SCHEMA_UNSUPPORTED',
    severity: 'error',
    recoverable: false,
    message: `schemaVersion ${sourceVersion} 无法迁移到当前 schema ${JWORD_NATIVE_SCHEMA_VERSION}`,
    entry: 'manifest.json',
    requestId
  }))
}

/** 判断 schema migration 是否可达当前版本。 */
function hasSchemaMigrationPath(sourceVersion: number): boolean {
  let currentVersion = sourceVersion

  while (currentVersion !== JWORD_NATIVE_SCHEMA_VERSION) {
    const step = findSchemaMigrationStep(currentVersion)

    if (step === undefined || step.to <= currentVersion || step.to > JWORD_NATIVE_SCHEMA_VERSION) {
      return false
    }

    currentVersion = step.to
  }

  return true
}

/** 查找从指定 schema 版本出发的迁移步骤。 */
function findSchemaMigrationStep(sourceVersion: number): SchemaMigrationStep | undefined {
  return SCHEMA_MIGRATION_STEPS.find((step) => step.from === sourceVersion)
}

/** 执行 schema 0 到 1 的显式空迁移。 */
function migrateSchema0To1(document: Document): Document {
  // schema 0 与 1 的 canonical document 结构一致，此步骤仅冻结迁移链语义。
  return document
}
