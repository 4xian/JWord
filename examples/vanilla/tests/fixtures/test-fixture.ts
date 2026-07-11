/**
 * 职责：装配 Playwright 专用复杂场景，承载默认 vanilla 示例不需要的 Gate 验收能力。
 * 边界：不进入默认页面或客户 interface；toolbar DOM 和辅助技术行为仍由 `@4xian/jword-ui` 实现。
 * 协作模块：`@4xian/jword-core`、`@4xian/jword-ui` 与同目录测试适配器。
 * 性能/安全约束：只在入口层访问宿主 DOM，不回退到旧的 toolbar 内联实现。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import {
  buildAddRevisionMetadataCommand,
  buildInsertLinkCommand,
  createEditor,
  createSelectionState,
  type PluginDefinition
} from '@4xian/jword-core'
import { createJWordUi } from '@4xian/jword-ui'

import { createDemoControls, loadInitialDemoText } from './test-controls'
import { createDemoMediaSupport } from './test-media'
import { createNativeDemoPersistence } from './test-native'
import { createDemoTableSupport } from './test-table'
import type { JWordDemoRevisionInput } from './test-fixture-env'
import '@4xian/jword-ui/styles.css'
import './test-fixture.css'

const editorHost = requireElement<HTMLElement>('#jword-editor', 'JWord vanilla demo requires #jword-editor.')
const demoControlsHost = requireElement<HTMLElement>(
  '#jword-demo-controls',
  'JWord vanilla demo requires #jword-demo-controls.'
)
const statusHost = requireElement<HTMLElement>('#jword-status', 'JWord vanilla demo requires #jword-status.')
const demoParams = new URLSearchParams(window.location.search)
const readonlyMode = demoParams.get('readonly') === 'true'
const devtoolsEnabled = demoParams.get('devtools') === 'true'
const demoPluginDefinitions = createDemoPluginDefinitions()

const initialDemoText = await loadInitialDemoText()
const editor = createEditor({
  initialText: initialDemoText,
  plugins: demoPluginDefinitions,
  currentUser: {
    id: 'demo-user',
    displayName: 'Demo User',
    color: '#2563eb'
  },
  resourceUrlPolicy: {
    allowExternalUrl: isDemoSameOriginResourceUrl
  },
  layout: {
    keepLatinWordWholeOnWrap: true
  }
})
const demoMedia = createDemoMediaSupport()
const demoTable = createDemoTableSupport(editor)

editor.mount(editorHost)

const jwordUi = createJWordUi({
  editor,
  editorHost,
  ...readDemoThemeOptions(),
  ...readDemoI18nOptions(),
  // toolbar: false,
  ...(readonlyMode
    ? {
        readonly: {
          enabled: true,
          hideToolbar: false,
          allowNavigation: true
        }
      }
    : {}),
  user: {
    currentUser: {
      id: 'demo-user',
      name: 'Demo User',
      color: '#2563eb'
    },
    resolveUser(authorId) {
      return authorId === 'demo-user'
        ? {
            id: 'demo-user',
            name: 'Demo User',
            color: '#2563eb'
          }
        : null
    }
  },
  media: demoMedia.media,
  table: demoTable.table,
  comments: true,
  link: {
    openLink(url) {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  },
  headerFooter: {},
  findReplace: {}
  // revisions: {
  // }
})
const devtoolsHandle = devtoolsEnabled
  ? await attachDemoDevtools(editor)
  : null
const demoControls = createDemoControls({
  editor,
  host: demoControlsHost,
  statusHost,
  refreshUi: () => {
    jwordUi.refresh()
  }
})
const nativePersistence = createNativeDemoPersistence({
  editor,
  host: demoControlsHost,
  refreshUi: () => {
    jwordUi.refresh()
  }
})

window.__jwordTestFixture = Object.freeze({
  readonly: readonlyMode,
  destroy: destroyDemo,
  editor,
  selectTextRange: demoControls.selectTextRange,
  selectImageByResourceId: (resourceId: string) => {
    selectImageByResourceId(editor, resourceId)
  },
  media: demoMedia.hooks,
  table: demoTable.hooks,
  comments: {
    readThreadCount: () => editor.getProjection().document.comments?.length ?? 0
  },
  native: nativePersistence,
  devtools: {
    isAttached: () => devtoolsHandle !== null,
    refresh: () => devtoolsHandle?.refresh() ?? editor.exportDiagnostics()
  },
  link: {
    /** 为只读浏览器回归预置一段链接文本。 */
    seedFirstRunLink(target: string) {
      const selection = createFirstRunSelection(editor, 1, 3)
      const command = buildInsertLinkCommand(editor.getProjection(), selection, {
        target
      })

      if (command === null) {
        return false
      }

      editor.executeCommand(command, {
        selectionAfter: selection
      })
      jwordUi.refresh()

      return true
    },
    readActiveLink: () => {
      const selection = editor.getSelection()

      if (selection === null) {
        return null
      }

      const position = editor.resolveTextPosition(selection.focus)
      const projection = editor.getProjection()

      for (const section of projection.document.sections) {
        for (const block of section.blocks) {
          if (block.kind !== 'paragraph') {
            continue
          }

          const run = block.runs.find((candidate) => candidate.id === position.runId)

          if (run?.link !== undefined) {
            return run.link
          }
        }
      }

      return null
    }
  },
  revisions: {
    addRevision(input: JWordDemoRevisionInput) {
      const selection = editor.getSelection()
      const command = buildAddRevisionMetadataCommand(editor.getProjection(), selection, input)

      if (command === null) {
        return false
      }

      editor.executeCommand(command, {
        selectionAfter: selection
      })
      jwordUi.refresh()

      return true
    },
    readRevisionCount: () => editor.getProjection().document.revisions?.length ?? 0,
    readSelectionOffsets: () => {
      const selection = editor.getSelection()

      if (selection === null) {
        return null
      }

      return [
        editor.resolveTextPosition(selection.anchor).graphemeIndex,
        editor.resolveTextPosition(selection.focus).graphemeIndex
      ] as const
    }
  }
})

if (!readonlyMode) {
  requestAnimationFrame(() => {
    editor.focus()
  })
}

window.addEventListener(
  'beforeunload',
  destroyDemo,
  { once: true }
)

let demoDestroyed = false

/** 销毁 vanilla demo 持有的 editor、UI 和 demo-only 资源，供页面卸载与内存门禁复用。 */
function destroyDemo(): void {
  if (demoDestroyed) {
    return
  }

  demoDestroyed = true
  demoControls.destroy()
  nativePersistence.destroy()
  devtoolsHandle?.destroy()
  demoMedia.destroy()
  demoTable.destroy()
  jwordUi.destroy()
  delete window.__jwordTestFixture
  editor.destroy()
}



/** 读取 demo 查询参数中的主题覆盖，只作为第三方集成示例。 */
function readDemoThemeOptions() {
  const theme = demoParams.get('theme')

  if (theme !== 'dark') {
    return {}
  }

  return {
    theme: { name: theme }
  } as const
}

/** 读取 demo 查询参数中的 i18n 覆盖，只作为第三方集成示例。 */
function readDemoI18nOptions() {
  if (demoParams.get('i18n') !== 'en') {
    return {}
  }

  return {
    i18n: {
      locale: 'en-US',
      dir: 'ltr',
      messages: {
        'toolbar.ariaLabel': 'JWord editing toolbar',
        'toolbar.format.bold.label': 'Bold'
      }
    }
  } as const
}

/** 按查询参数显式懒加载 devtools，避免默认首屏引入调试面板。 */
async function attachDemoDevtools(editorInstance: typeof editor) {
  const { attachJWordDevtools } = await import('@4xian/jword-devtools')

  return attachJWordDevtools(editorInstance)
}

/** 创建 demo-only 插件测试钩子，默认不启用且不影响普通示例。 */
function createDemoPluginDefinitions(): readonly PluginDefinition[] {
  const pluginError = demoParams.get('pluginError')

  if (pluginError !== 'throwing-command' && pluginError !== 'throwing-adapter') {
    return []
  }

  return [{
    name: 'demo.throwingPlugin',
    version: '0.0.0-test',
    setup(context) {
      context.registerCommand({
        name: 'demo.throwingPlugin.throw',
        execute() {
          throw new Error('demo plugin command failed')
        }
      })

      if (pluginError === 'throwing-adapter') {
        context.adapters.imports.register({
          kind: 'import',
          name: 'demo.throwingPlugin.import',
          format: 'docx',
          importDocument() {
            throw createDemoCodedError('DOCX_LICENSE_DENIED', 'demo plugin adapter failed')
          }
        }, { name: 'demo.throwingPlugin.import' })
        context.registerCommand({
          name: 'demo.throwingPlugin.adapter',
          execute() {
            const adapter = context.adapters.imports.resolveFormat('docx')

            if (adapter.status === 'available') {
              adapter.registration.adapter.importDocument(new Uint8Array())
            }
          }
        })
      }
    }
  }]
}

/** 创建 demo-only 带稳定 code 字段的错误，供 Gate 7 插件错误隔离 smoke 使用。 */
function createDemoCodedError(code: string, message: string): Error & { readonly code: string } {
  const error = new Error(message) as Error & { code: string }

  error.code = code

  return error
}

/**
 * 职责：按宿主选择器读取必需节点，避免入口逻辑反复写空值分支。
 */
function requireElement<ElementType extends HTMLElement>(selector: string, errorMessage: string): ElementType {
  const element = document.querySelector<ElementType>(selector)

  if (element === null) {
    throw new Error(errorMessage)
  }

  return element
}

/** 判断 demo 图片资源 URL 是否属于当前同源 fixture。 */
function isDemoSameOriginResourceUrl(url: URL): boolean {
  return url.origin === window.location.origin
}

/** 根据资源 id 直接把测试选区切到对应图片 run。 */
function selectImageByResourceId(editorInstance: typeof editor, resourceId: string): void {
  const projection = editorInstance.getProjection()

  for (const section of projection.document.sections) {
    for (const block of section.blocks) {
      if (block.kind !== 'paragraph') {
        continue
      }

      for (const run of block.runs) {
        const image = run.inlines.find((inline) => inline.kind === 'image' && inline.resourceId === resourceId)

        if (image === undefined) {
          continue
        }

        const anchor = editorInstance.createTextAnchor({
          sectionId: section.id,
          blockId: block.id,
          runId: run.id,
          graphemeIndex: 0
        })

        editorInstance.setSelection(createSelectionState(anchor, anchor))
        editorInstance.focus()
        return
      }
    }
  }

  throw new Error(`未找到资源 ${resourceId} 对应的图片 run`)
}

/** 构造 demo 首段首个 run 的文本选区。 */
function createFirstRunSelection(editorInstance: typeof editor, anchorIndex: number, focusIndex: number) {
  const section = editorInstance.getProjection().document.sections[0]
  const block = section?.blocks[0]
  const run = block?.kind === 'paragraph' ? block.runs[0] : undefined

  if (section === undefined || block === undefined || block.kind !== 'paragraph' || run === undefined) {
    throw new Error('缺少首段链接测试目标。')
  }

  const anchor = editorInstance.createTextAnchor({
    sectionId: section.id,
    blockId: block.id,
    runId: run.id,
    graphemeIndex: anchorIndex
  })
  const focus = editorInstance.createTextAnchor({
    sectionId: section.id,
    blockId: block.id,
    runId: run.id,
    graphemeIndex: focusIndex
  })

  return createSelectionState(anchor, focus)
}
