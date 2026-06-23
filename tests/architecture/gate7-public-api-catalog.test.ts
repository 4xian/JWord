/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 7 Step 7.1 的公开 API 清单和对外分级。
 * 边界：只读取文档、package manifest 和公开入口源码，不执行 SDK 运行时。
 * 协作模块：packages/* 公开入口、Gate 5/6 商业包和 Gate 7 SDK 稳定化计划。
 * 约束：清单必须基于已实现包和导出面，不得记录未实现 Future API 为 stable。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#step-71整理公开-api-清单。
 */

import { existsSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const publicApiCatalogPath = 'docs/sdk/public-api.md'

const packageCatalogExpectations = [
  {
    packageName: '@4xian/jword-core',
    entrypoint: 'packages/core/src/index.ts',
    catalogTokens: [
      'Edition：free',
      'Stable',
      'Experimental：当前无',
      'Internal',
      'createEditor',
      'EditorSyncUpdateInput',
      'EditorApplyUpdateOptions',
      'createTextInserter',
      'TextInserterRetryInput',
      'createRangeRef',
      'createDocumentProjection',
      'createEditorSharedDocument',
      'createEditorWithSharedDocument',
      'readEditorSharedDocument',
      'refreshEditorSharedDocument',
      'EditorSharedDocument'
    ],
    sourceTokens: [
      'createEditor',
      'EditorSyncUpdateInput',
      'EditorApplyUpdateOptions',
      'createTextInserter',
      'TextInserterRetryInput',
      'createRangeRef',
      'createDocumentProjection',
      'createEditorSharedDocument',
      'createEditorWithSharedDocument',
      'readEditorSharedDocument',
      'refreshEditorSharedDocument',
      'EditorSharedDocument'
    ]
  },
  {
    packageName: '@4xian/jword-ui',
    entrypoint: 'packages/ui/src/index.ts',
    catalogTokens: [
      'Edition：free',
      'Stable',
      'createJWordUi',
      'createCoreMediaCommandAdapter',
      'createCoreTableCommandAdapter',
      'BUILTIN_JWORD_TOOL_IDS',
      'Internal'
    ],
    sourceTokens: [
      'createJWordUi',
      'createCoreMediaCommandAdapter',
      'createCoreTableCommandAdapter',
      'BUILTIN_JWORD_TOOL_IDS'
    ]
  },
  {
    packageName: '@4xian/jword-native',
    entrypoint: 'packages/native/src/index.ts',
    catalogTokens: [
      'Edition：free',
      'saveJWordDocument',
      'loadJWordDocument',
      'validateJWordPackage',
      './worker'
    ],
    sourceTokens: [
      'saveJWordDocument',
      'loadJWordDocument',
      'validateJWordPackage'
    ]
  },
  {
    packageName: '@4xian/jword-docx',
    entrypoint: 'packages/docx/src/index.ts',
    catalogTokens: [
      'Edition：paid format',
      'importDocx',
      'exportDocx',
      'inspectDocxPackage',
      'GATE5_FORMAT_FEATURES',
      './worker'
    ],
    sourceTokens: [
      'importDocx',
      'exportDocx',
      'inspectDocxPackage'
    ]
  },
  {
    packageName: '@4xian/jword-pdf',
    entrypoint: 'packages/pdf/src/index.ts',
    catalogTokens: [
      'Edition：paid format',
      'exportPdfFromLayout',
      'GATE5_FORMAT_FEATURES',
      './worker'
    ],
    sourceTokens: [
      'exportPdfFromLayout'
    ]
  },
  {
    packageName: '@4xian/jword-persistence',
    entrypoint: 'packages/persistence/src/index.ts',
    catalogTokens: [
      'Edition：free base contract',
      'createMemoryPersistenceAdapter',
      'createStoragePersistenceAdapter',
      'createIndexedDbOfflineAdapter',
      'createUnavailableIndexedDbOfflineAdapter',
      'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
    ],
    sourceTokens: [
      'createMemoryPersistenceAdapter',
      'createStoragePersistenceAdapter',
      'createIndexedDbOfflineAdapter',
      'createUnavailableIndexedDbOfflineAdapter',
      'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
    ]
  },
  {
    packageName: '@4xian/jword-collab',
    entrypoint: 'packages/collab/src/index.ts',
    catalogTokens: [
      'Edition：paid collaboration',
      'connectJWordCollaboration',
      'ConnectJWordCollaborationOptions',
      'JWordCollaborationConnection',
      'JWordCollaborationHandshake',
      'JWordCollaborationOfflineState',
      'JWordCollaborationHistoryVersion',
      'JWordCollaborationAutoInsertSession',
      'createMemoryCollabProviderAdapter',
      'GATE6_COLLAB_FEATURES',
      './experimental',
      'createHocuspocusCollabProviderAdapter'
    ],
    sourceTokens: [
      'connectJWordCollaboration',
      'ConnectJWordCollaborationOptions',
      'JWordCollaborationConnection',
      'JWordCollaborationHandshake',
      'JWordCollaborationOfflineState',
      'JWordCollaborationHistoryVersion',
      'JWordCollaborationAutoInsertSession',
      'createMemoryCollabProviderAdapter',
      'GATE6_COLLAB_FEATURES'
    ]
  },
  {
    packageName: '@4xian/jword-collab-server',
    entrypoint: 'packages/collab-server/src/index.ts',
    catalogTokens: [
      'Edition：paid collaboration',
      'createJWordCollabServer',
      'startJWordCollabServer',
      'createJWordCollabRequestHandler',
      'createJWordCollabHistoryService',
      'createJWordCollabHocuspocusServer',
      'CreateJWordCollabServerOptions',
      'JWordCollabServerState'
    ],
    sourceTokens: [
      'createJWordCollabServer',
      'startJWordCollabServer',
      'createJWordCollabRequestHandler',
      'createJWordCollabHistoryService',
      'createJWordCollabHocuspocusServer',
      'CreateJWordCollabServerOptions',
      'JWordCollabServerState'
    ]
  },
  {
    packageName: '@4xian/jword-license',
    entrypoint: 'packages/license/src/index.ts',
    catalogTokens: [
      'Edition：paid entitlement',
      'GATE5_FORMAT_FEATURES',
      'GATE6_COLLAB_FEATURES',
      'assertJWordFeatureEntitled',
      'JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA',
      'JWordLicenseDiagnosticCode'
    ],
    sourceTokens: [
      'GATE5_FORMAT_FEATURES',
      'GATE6_COLLAB_FEATURES',
      'assertJWordFeatureEntitled',
      'JWORD_LICENSE_DIAGNOSTIC_CODE_METADATA',
      'JWordLicenseDiagnosticCode'
    ]
  }
] as const

const unimplementedFuturePackages = [
  '@4xian/jword-react',
  '@4xian/jword-vue',
  '@4xian/jword-devtools'
] as const

describe('Gate 7 public API catalog', () => {
  it('ships a catalog for the currently implemented public packages', () => {
    expect(existsSync(publicApiCatalogPath)).toBe(true)

    const catalog = readFileSync(publicApiCatalogPath, 'utf8')

    for (const expectation of packageCatalogExpectations) {
      expect(catalog, expectation.packageName).toContain(`## ${expectation.packageName}`)

      for (const token of expectation.catalogTokens) {
        expect(catalog, `${expectation.packageName}:${token}`).toContain(token)
      }
    }
  })

  it('keeps catalog stable symbols aligned with current package entrypoints', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')

    for (const expectation of packageCatalogExpectations) {
      const source = readFileSync(expectation.entrypoint, 'utf8')

      for (const token of expectation.sourceTokens) {
        expect(source, `${expectation.entrypoint}:${token}`).toContain(token)
        expect(catalog, `${expectation.packageName}:${token}`).toContain(token)
      }
    }
  })

  it('marks future wrapper and devtools packages as unimplemented instead of stable', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')

    for (const packageName of unimplementedFuturePackages) {
      expect(catalog, packageName).toContain(`## ${packageName}`)
      expect(catalog, packageName).toContain('状态：未实现，不能作为 stable API 使用')
    }
  })

  it('documents export map boundaries and forbids internal source paths in public integration', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const internalSourcePathPattern = `packages/${'*'}/src/${'*'}`

    for (const token of [
      '只允许从 package export map 入口导入',
      `禁止第三方导入 \`${internalSourcePathPattern}\``,
      [
        '禁止公开 Y.Doc store',
        'provider 内部类型',
        'worker 内部 helper 和',
        'demo runtime'
      ].join('、').replace(' 和、', ' 和 ')
    ]) {
      expect(catalog, token).toContain(token)
    }

    const boundaryLevels = [
      'stable',
      'experimental',
      'internal'
    ]

    for (const token of boundaryLevels) {
      expect(catalog, token).toContain(token)
    }
  })
})
