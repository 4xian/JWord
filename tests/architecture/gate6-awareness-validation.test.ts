/**
 * 职责：约束 Gate 6 awareness schema 校验只能维护一份内部实现。
 * 边界：只做源码级重复实现检查，不验证 Hocuspocus 运行时行为。
 * 协作模块：packages/collab/src/index.ts、packages/collab/src/hocuspocus-adapter.ts 和 awareness 校验共享模块。
 * 约束：Hocuspocus adapter 必须复用共享校验函数，避免后续 schema 漂移。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const sharedValidationPath = 'packages/collab/src/awareness-validation.ts'
const hocuspocusAdapterPath = 'packages/collab/src/hocuspocus-adapter.ts'
const collabEntryPath = 'packages/collab/src/index.ts'

const duplicatedValidatorNames = [
  'isAwarenessState',
  'isAwarenessUser',
  'isAwarenessCursor',
  'isAwarenessAnchor',
  'isAwarenessRangeSnapshot',
  'isAwarenessTextAnchorRecord',
  'isAwarenessRelativePositionSnapshot',
  'isAwarenessRelativePositionId',
  'isAwarenessViewport'
]

describe('Gate 6 awareness validation sharing', () => {
  it('keeps awareness schema guards in one shared collab module', () => {
    const sharedSource = readFileSync(sharedValidationPath, 'utf8')
    const hocuspocusSource = readFileSync(hocuspocusAdapterPath, 'utf8')
    const entrySource = readFileSync(collabEntryPath, 'utf8')

    expect(hocuspocusSource).toContain("from './awareness-validation.js'")
    expect(entrySource).toContain("from './awareness-validation.js'")

    for (const validatorName of duplicatedValidatorNames) {
      expect(sharedSource).toContain(`function ${validatorName}(`)
      expect(hocuspocusSource).not.toContain(`function ${validatorName}(`)
      expect(entrySource).not.toContain(`function ${validatorName}(`)
    }
  })
})
