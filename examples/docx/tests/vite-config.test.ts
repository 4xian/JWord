/**
 * 职责：锁定 Gate 5 examples/docx 手动验收入口的最小宿主契约。
 * 边界：只验证示例入口文件、Vite alias、关键控件和样式禁用项，不覆盖真实浏览器交互。
 * 协作模块：examples/docx、packages/core、packages/ui、packages/docx 和 packages/pdf。
 * 约束：测试先行，手动验收入口必须可构建且不把互通逻辑混入 vanilla 首屏。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-25---建立-examplesdocx-手动验收入口。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { describe, expect, it } from 'vitest'

describe('docx demo host contract', () => {
  it('提供独立 examples/docx package 和 Vite source alias', async () => {
    const packageJson = readWorkspaceJson('examples/docx/package.json') as {
      readonly name?: string
      readonly scripts?: Readonly<Record<string, string>>
      readonly dependencies?: Readonly<Record<string, string>>
    }
    const configModule = await loadViteConfigModule()
    const aliasList = normalizeAliasList(configModule.createDocxDemoViteConfig().resolve?.alias)

    expect(packageJson.name).toBe('@4xian/jword-example-docx')
    expect(packageJson.scripts).toMatchObject({
      dev: expect.any(String),
      build: expect.any(String),
      typecheck: expect.any(String)
    })
    expect(packageJson.dependencies).toMatchObject({
      '@4xian/jword-core': 'workspace:*',
      '@4xian/jword-ui': 'workspace:*',
      '@4xian/jword-docx': 'workspace:*',
      '@4xian/jword-pdf': 'workspace:*'
    })
    expect(aliasList).toEqual(expect.arrayContaining([
      {
        find: '@4xian/jword-core',
        replacement: resolve(process.cwd(), 'packages/core/src/index.ts')
      },
      {
        find: '@4xian/jword-ui',
        replacement: resolve(process.cwd(), 'packages/ui/src/index.ts')
      },
      {
        find: '@4xian/jword-docx',
        replacement: resolve(process.cwd(), 'packages/docx/src/index.ts')
      },
      {
        find: '@4xian/jword-pdf',
        replacement: resolve(process.cwd(), 'packages/pdf/src/index.ts')
      }
    ]))
  })

  it('HTML 入口包含 Gate 5 手动验收所需控件和面板', () => {
    const html = readWorkspaceText('examples/docx/index.html')

    for (const id of [
      'jword-docx-file',
      'jword-docx-fixture',
      'jword-docx-import',
      'jword-docx-export',
      'jword-pdf-export',
      'jword-task-cancel',
      'jword-docx-warnings',
      'jword-docx-roundtrip',
      'jword-docx-output',
      'jword-pdf-output',
      'jword-toolbar',
      'jword-editor',
      'jword-status'
    ]) {
      expect(html).toContain(`id="${id}"`)
    }
  })

  it('样式不使用 grid 或 gap，并保留移动端断点', () => {
    const css = readWorkspaceText('examples/docx/src/styles.css')

    expect(css).not.toMatch(/\bdisplay\s*:\s*grid\b/u)
    expect(css).not.toMatch(/\bgap\s*:/u)
    expect(css).toContain('@media')
  })

  it('DOCX/PDF runtime 只通过动态 import 进入手动验收入口', () => {
    const source = readWorkspaceText('examples/docx/src/main.ts')
    const runtimeDocxImportPattern = /^\s*import(?!\s+type\b)[^\n]*from\s+'@4xian\/jword-docx'/mu
    const runtimePdfImportPattern = /^\s*import(?!\s+type\b)[^\n]*from\s+'@4xian\/jword-pdf'/mu

    expect(source).not.toMatch(runtimeDocxImportPattern)
    expect(source).not.toMatch(runtimePdfImportPattern)
    expect(source).toContain("import('@4xian/jword-docx')")
    expect(source).toContain("import('@4xian/jword-pdf')")
  })

  it('启用官方目录入口，支撑 Heading 导入后的 toolbar 和 outline 验收', () => {
    const source = readWorkspaceText('examples/docx/src/main.ts')

    expect(source).toContain('headingOutline')
    expect(source).toContain('host: toolbarHost')
  })

  it('导入导出任务接入取消 signal 和提交 guard', () => {
    const source = readWorkspaceText('examples/docx/src/main.ts')

    expect(source).toContain('createDocxDemoTaskController')
    expect(source).toContain('cancelActiveTask')
    expect(source).toContain('session.signal')
    expect(source).toContain('session.canCommit()')
    expect(source).toContain('finishTask(session.requestId)')
  })

  it('导入 DOCX 后同步第一节页面设置到 editor page config，支撑分页截图验收', () => {
    const source = readWorkspaceText('examples/docx/src/main.ts')

    expect(source).toContain('syncEditorPageConfigFromDocument(document)')
    expect(source).toContain('editor.setPageConfig')
  })
})

async function loadViteConfigModule(): Promise<{
  createDocxDemoViteConfig: () => {
    readonly resolve?: {
      readonly alias?: AliasEntry | readonly AliasEntry[]
    }
  }
}> {
  const configPath = resolve(process.cwd(), 'examples/docx/vite.config.ts')

  expect(existsSync(configPath)).toBe(true)

  return import(pathToFileURL(configPath).href) as Promise<{
    createDocxDemoViteConfig: () => {
      readonly resolve?: {
        readonly alias?: AliasEntry | readonly AliasEntry[]
      }
    }
  }>
}

function readWorkspaceText(path: string): string {
  const resolved = resolve(process.cwd(), path)

  expect(existsSync(resolved)).toBe(true)

  return readFileSync(resolved, 'utf8')
}

function readWorkspaceJson(path: string): unknown {
  return JSON.parse(readWorkspaceText(path))
}

function normalizeAliasList(alias: AliasEntry | readonly AliasEntry[] | undefined): readonly AliasEntry[] {
  if (alias === undefined) {
    return []
  }

  if (isAliasEntryList(alias)) {
    return alias
  }

  return [alias]
}

/** 判断 Vite alias 配置是否是数组形式。 */
function isAliasEntryList(alias: AliasEntry | readonly AliasEntry[]): alias is readonly AliasEntry[] {
  return Array.isArray(alias)
}

interface AliasEntry {
  readonly find: string | RegExp
  readonly replacement: string
}
