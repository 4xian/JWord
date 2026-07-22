/**
 * @vitest-environment node
 *
 * 职责：锁定 Gate 7 示例矩阵只能通过 package 入口消费 SDK，不导入 monorepo 内部源码。
 * 边界：只扫描 examples 源码与指定 E2E fixture 的导入，并检查所需公开示例 token；不执行浏览器或构建。
 * 协作模块：vanilla/react/vue/vue2/docx/collab 示例、public API catalog 和 no-alias release smoke。
 * 约束：examples 可以在 Vite config 中为 workspace 开发态配置 alias，但业务源码必须像第三方项目一样写 package specifier。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const exampleRoots = [
  'examples/vanilla',
  'examples/react',
  'examples/vue',
  'examples/vue2',
  'examples/docx',
  'examples/collab'
] as const

const additionalPublicImportFiles = [
  'examples/vanilla/tests/fixtures/test-fixture.ts'
] as const

const requiredExampleTokens = [
  ['examples/vanilla/tests/fixtures/test-fixture.ts', "import('@4xian/jword-devtools')"],
  ['examples/vanilla/tests/fixtures/test-fixture.ts', 'readDemoThemeOptions'],
  ['examples/vanilla/tests/fixtures/test-fixture.ts', 'readDemoI18nOptions'],
  ['examples/react/src/App.tsx', '@4xian/jword-react'],
  ['examples/react/src/App.tsx', '<main className="jword-react-example"'],
  ['examples/vue/src/App.vue', '@4xian/jword-vue'],
  ['examples/vue/src/App.vue', '<template>'],
  ['examples/vue2/src/App.vue', '@4xian/jword-core'],
  ['examples/vue2/src/App.vue', '@4xian/jword-ui'],
  ['examples/vue2/src/App.vue', '@4xian/jword-native'],
  ['examples/vue2/src/App.vue', '<template>'],
  ['examples/vue2/src/App.vue', 'Vue.extend({'],
  ['examples/vue2/src/App.vue', 'data(): JWordVue2ExampleState'],
  ['examples/vue2/src/App.vue', 'mounted()'],
  ['examples/vue2/src/App.vue', 'beforeDestroy()'],
  ['examples/vue2/src/App.vue', 'methods:'],
  ['examples/docx/src/main.ts', '@4xian/jword-docx'],
  ['examples/collab/src/runtime.ts', '@4xian/jword-collab']
] as const

describe('Gate 7 examples public import matrix', () => {
  it('keeps example source imports on package entrypoints instead of monorepo internals', () => {
    const failures: string[] = []
    const scannedFiles: string[] = []

    for (const root of exampleRoots) {
      for (const file of listSourceFiles(join(root, 'src'))) {
        scannedFiles.push(file)
        collectInternalImportFailures(file, readFileSync(file, 'utf8'), failures)
      }
    }

    for (const file of additionalPublicImportFiles) {
      scannedFiles.push(file)
      collectInternalImportFailures(file, readFileSync(file, 'utf8'), failures)
    }

    expect(scannedFiles).toContain('examples/vanilla/tests/fixtures/test-fixture.ts')
    expect(failures).toEqual([])
  })

  it('records the required vanilla/react/vue/vue2/docx/collab example paths', () => {
    for (const [file, token] of requiredExampleTokens) {
      expect(existsSync(file), file).toBe(true)
      expect(readFileSync(file, 'utf8'), `${file}:${token}`).toContain(token)
    }
  })

  it('keeps framework examples on common component syntax instead of render helpers', () => {
    const reactExample = readFileSync('examples/react/src/App.tsx', 'utf8')
    const vueExample = readFileSync('examples/vue/src/App.vue', 'utf8')
    const vue2Example = readFileSync('examples/vue2/src/App.vue', 'utf8')

    expect(reactExample).toContain('<JWordReactEditor')
    expect(reactExample).not.toContain('createElement(')
    expect(vueExample).toContain('<JWordVueEditor')
    expect(vueExample).not.toContain('return () => h(')
    expect(vue2Example).toContain('export default Vue.extend({')
    expect(vue2Example).not.toContain('render(')
    expect(vue2Example).not.toContain('createElement(')
  })
})

/** 递归列出源码文件。 */
function listSourceFiles(directory: string): readonly string[] {
  if (!existsSync(directory)) {
    return []
  }

  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const next = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listSourceFiles(next)
    }

    return entry.isFile() && /\.(ts|tsx|js|jsx|vue)$/u.test(next) ? [next] : []
  })
}

/** 收集导入内部源码的违规。 */
function collectInternalImportFailures(file: string, source: string, failures: string[]): void {
  const forbiddenPatterns = [
    /from\s+['"][^'"]*packages\/[^'"]*\/src\/[^'"]*['"]/u,
    /import\(\s*['"][^'"]*packages\/[^'"]*\/src\/[^'"]*['"]\s*\)/u,
    /from\s+['"]@4xian\/jword-[^'"]*\/src\/[^'"]*['"]/u,
    /from\s+['"]@4xian\/jword-[^'"]*\/internal[^'"]*['"]/u
  ]

  for (const pattern of forbiddenPatterns) {
    if (pattern.test(source)) {
      failures.push(`${file}: forbidden internal import ${pattern}`)
    }
  }
}
