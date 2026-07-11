/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 7 Step 7.1 的公开 API 清单和对外分级。
 * 边界：只读取文档、package manifest 和公开入口源码，不执行 SDK 运行时。
 * 协作模块：packages/* 公开入口、Gate 5/6 商业包和 Gate 7 SDK 稳定化计划。
 * 约束：清单必须基于已实现包和导出面，不得记录未实现 Future API 为 stable。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
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
      'Experimental：',
      'Internal',
      'createEditor',
      'EditorSyncUpdateInput',
      'EditorApplyUpdateOptions',
      'PluginDefinition',
      'PluginContext',
      'PluginAdapterRegistry',
      'PluginAdapterSlot',
      'PluginPersistenceAdapterDescriptor',
      'PluginImportAdapterDescriptor',
      'PluginExportAdapterDescriptor',
      'PluginCollabProviderAdapterDescriptor',
      'PluginCommandMiddleware',
      'PluginKeyBindingDefinition',
      'PluginDiagnostic',
      'ExperimentalDecorationProvider',
      'PluginDecoration',
      'JWordTelemetryOptions',
      'JWordDiagnosticsSnapshot',
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
      'EditorSharedDocument',
      'PluginDefinition',
      'PluginContext',
      'PluginAdapterRegistry',
      'PluginAdapterSlot',
      'PluginPersistenceAdapterDescriptor',
      'PluginImportAdapterDescriptor',
      'PluginExportAdapterDescriptor',
      'PluginCollabProviderAdapterDescriptor',
      'PluginCommandMiddleware',
      'PluginKeyBindingDefinition',
      'PluginDiagnostic',
      'ExperimentalDecorationProvider',
      'PluginDecoration',
      'JWordTelemetryOptions',
      'JWordDiagnosticsSnapshot'
    ]
  },
  {
    packageName: '@4xian/jword-ui',
    entrypoint: 'packages/ui/src/index.ts',
    catalogTokens: [
      'Edition：free',
      'Stable',
      'createJWord',
      'JWordEditorShell',
      'Advanced',
      'createJWordUi',
      'createCoreMediaCommandAdapter',
      'createCoreTableCommandAdapter',
      'BUILTIN_JWORD_TOOL_IDS',
      'DEFAULT_JWORD_UI_THEME_TOKENS',
      'DEFAULT_JWORD_UI_I18N_DICTIONARY',
      'resolveJWordUiI18n',
      'JWordUiThemeOptions',
      'JWordUiThemeToken',
      'JWordUiI18nDictionary',
      'JWordUiI18nOptions',
      'JWordUiPluginExtension',
      'JWordToolbarPluginItem',
      'JWordMenuPluginAction',
      'JWordUiPluginRenderContext',
      'Internal'
    ],
    sourceTokens: [
      'createJWord',
      'JWordEditorShell',
      'createJWordUi',
      'createCoreMediaCommandAdapter',
      'createCoreTableCommandAdapter',
      'BUILTIN_JWORD_TOOL_IDS',
      'DEFAULT_JWORD_UI_THEME_TOKENS',
      'DEFAULT_JWORD_UI_I18N_DICTIONARY',
      'resolveJWordUiI18n',
      'JWordUiThemeOptions',
      'JWordUiThemeToken',
      'JWordUiI18nDictionary',
      'JWordUiI18nOptions',
      'JWordUiPluginExtension',
      'JWordToolbarPluginItem',
      'JWordMenuPluginAction',
      'JWordUiPluginRenderContext'
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
      'detectJWordNativeWorkerCapability',
      'JWORD_NATIVE_WORKER_CSP_DIRECTIVES',
      'JWORD_NATIVE_WORKER_UNAVAILABLE',
      './worker'
    ],
    sourceTokens: [
      'saveJWordDocument',
      'loadJWordDocument',
      'validateJWordPackage',
      'detectJWordNativeWorkerCapability',
      'JWORD_NATIVE_WORKER_CSP_DIRECTIVES'
    ]
  },
  {
    packageName: '@4xian/jword-docx',
    entrypoint: 'packages/docx/src/index.ts',
    catalogTokens: [
      'Edition：paid format',
      'importDocx',
      'exportDocx',
      'createDocxImportPluginAdapter',
      'createDocxExportPluginAdapter',
      'inspectDocxPackage',
      'detectDocxWorkerCapability',
      'DOCX_WORKER_CSP_DIRECTIVES',
      'DOCX_WORKER_UNAVAILABLE',
      'GATE5_FORMAT_FEATURES',
      './worker'
    ],
    sourceTokens: [
      'importDocx',
      'exportDocx',
      'createDocxImportPluginAdapter',
      'createDocxExportPluginAdapter',
      'inspectDocxPackage',
      'detectDocxWorkerCapability',
      'DOCX_WORKER_CSP_DIRECTIVES'
    ]
  },
  {
    packageName: '@4xian/jword-pdf',
    entrypoint: 'packages/pdf/src/index.ts',
    catalogTokens: [
      'Edition：paid format',
      'exportPdfFromLayout',
      'createPdfExportPluginAdapter',
      'detectPdfWorkerCapability',
      'PDF_WORKER_CSP_DIRECTIVES',
      'PDF_WORKER_UNAVAILABLE',
      'GATE5_FORMAT_FEATURES',
      './worker'
    ],
    sourceTokens: [
      'exportPdfFromLayout',
      'createPdfExportPluginAdapter',
      'detectPdfWorkerCapability',
      'PDF_WORKER_CSP_DIRECTIVES'
    ]
  },
  {
    packageName: '@4xian/jword-persistence',
    entrypoint: 'packages/persistence/src/index.ts',
    catalogTokens: [
      'Edition：free base contract',
      'createMemoryPersistenceAdapter',
      'createJWordPersistencePluginAdapter',
      'createStoragePersistenceAdapter',
      'createIndexedDbOfflineAdapter',
      'createUnavailableIndexedDbOfflineAdapter',
      'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
    ],
    sourceTokens: [
      'createMemoryPersistenceAdapter',
      'createJWordPersistencePluginAdapter',
      'createStoragePersistenceAdapter',
      'createIndexedDbOfflineAdapter',
      'createUnavailableIndexedDbOfflineAdapter',
      'PERSISTENCE_DIAGNOSTIC_CODE_METADATA'
    ]
  },
  {
    packageName: '@4xian/jword-react',
    entrypoint: 'packages/react/src/index.ts',
    catalogTokens: [
      'Edition：free wrapper',
      'JWordReactEditor',
      'JWordReactEditorProps',
      'JWordReactEditorHandle',
      'JWordReactErrorBoundary',
      'JWordEditorProvider',
      'useJWordEditor',
      'useJWordEditorHandle'
    ],
    sourceTokens: [
      'JWordReactEditor',
      'JWordReactEditorProps',
      'JWordReactEditorHandle',
      'JWordReactErrorBoundary',
      'JWordEditorProvider',
      'useJWordEditor',
      'useJWordEditorHandle'
    ]
  },
  {
    packageName: '@4xian/jword-vue',
    entrypoint: 'packages/vue/src/index.ts',
    catalogTokens: [
      'Edition：free wrapper',
      'JWordVueEditor',
      'JWordVueEditorProps',
      'JWordVueEditorHandle',
      'JWORD_VUE_EDITOR_KEY',
      'useJWordEditor',
      'useJWordEditorHandle'
    ],
    sourceTokens: [
      'JWordVueEditor',
      'JWordVueEditorProps',
      'JWordVueEditorHandle',
      'JWORD_VUE_EDITOR_KEY',
      'useJWordEditor',
      'useJWordEditorHandle'
    ]
  },

  {
    packageName: '@4xian/jword-devtools',
    entrypoint: 'packages/devtools/src/index.ts',
    catalogTokens: [
      'Edition：free diagnostics',
      'attachJWordDevtools',
      'AttachJWordDevtoolsOptions',
      'JWordDevtoolsHandle',
      'Editor.exportDiagnostics()'
    ],
    sourceTokens: [
      'attachJWordDevtools',
      'AttachJWordDevtoolsOptions',
      'JWordDevtoolsHandle'
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
      'createJWordCollabProviderPluginAdapter',
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
      'createJWordCollabProviderPluginAdapter',
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
      'JWordCollabServerState',
      'JWordCollabHocuspocusRole',
      'JWordCollabHocuspocusAuthHook',
      'read/comment/write'
    ],
    sourceTokens: [
      'createJWordCollabServer',
      'startJWordCollabServer',
      'createJWordCollabRequestHandler',
      'createJWordCollabHistoryService',
      'createJWordCollabHocuspocusServer',
      'CreateJWordCollabServerOptions',
      'JWordCollabServerState',
      'JWordCollabHocuspocusRole',
      'JWordCollabHocuspocusAuthHook'
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

const unimplementedFuturePackages = [] as const

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

  it('keeps PDF worker helpers out of the stable root API', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')
    const pdfSource = readFileSync('packages/pdf/src/index.ts', 'utf8')
    const pdfWorkerSource = readFileSync('packages/pdf/src/worker.ts', 'utf8')
    const workerHelpers = [
      'createPdfProgressResponse',
      'createPdfErrorResponse',
      'createCancelPdfWorkerRequest',
      'createPdfTransferables',
      'readPdfImageAsset',
      'handlePdfWorkerRequest'
    ]
    const pdfSection = catalog.slice(
      catalog.indexOf('## @4xian/jword-pdf'),
      catalog.indexOf('## @4xian/jword-persistence')
    )
    const stableSection = pdfSection.slice(
      pdfSection.indexOf('Stable：'),
      pdfSection.indexOf('Worker-only')
    )

    for (const helper of workerHelpers) {
      expect(stableSection, `stable root catalog:${helper}`).not.toContain(`\`${helper}()`)
      expect(pdfSource, `root source:${helper}`).not.toContain(`export function ${helper}`)
      expect(pdfWorkerSource, `worker source:${helper}`).toContain(helper)
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

  it('documents the Gate 7 no-alias third-party smoke command', () => {
    const catalog = readFileSync(publicApiCatalogPath, 'utf8')

    for (const token of [
      'node tools/release/check-gate7-third-party-smoke.mjs',
      '本地 tarball',
      'Chromium 浏览器 smoke',
      'pdf.export'
    ]) {
      expect(catalog, token).toContain(token)
    }
  })
})
