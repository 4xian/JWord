/**
 * 职责：锁定 Gate 4.5 vanilla 原生保存/打开入口只能使用公开 native 包与 lazy import。
 * 边界：只做源码边界扫描，不验证 native 包内部格式语义。
 * 协作：examples/vanilla/src/demo-native.ts、examples/vanilla/src/main.ts 和 @4xian/jword-native 公开 API。
 * 约束：vanilla 不能直接读取 packages/native/src、core 私有 store，也不能把 native 放进首屏静态 import。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 4.5 Step 4.5.6-4.5.7。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const vanillaSourceRoot = join(process.cwd(), 'examples/vanilla/src')

describe('Gate 4.5 vanilla native boundary', () => {
  it('使用 demo-native worker bridge 承接 .jword 保存/打开入口', () => {
    const bridgePath = join(vanillaSourceRoot, 'demo-native.ts')
    const workerPath = join(vanillaSourceRoot, 'native-worker.ts')

    expect(existsSync(bridgePath)).toBe(true)
    expect(existsSync(workerPath)).toBe(true)

    const source = readFileSync(bridgePath, 'utf8')
    const workerSource = readFileSync(workerPath, 'utf8')

    expect(source).toContain("new Worker(new URL('./native-worker.ts'")
    expect(workerSource).toContain("from '@4xian/jword-native/worker'")
    expect(source).toContain('saveJWordDocument')
    expect(source).toContain('loadJWordDocument')
  })

  it('禁止 vanilla 静态 import native 或读取内部源码/store', () => {
    const failures: string[] = []

    for (const file of listTypeScriptFiles(vanillaSourceRoot)) {
      const source = readFileSync(file, 'utf8')

      collectStaticNativeImportFailures(file, source, failures)
      collectInternalImportFailures(file, source, failures)
    }

    expect(failures).toEqual([])
  })
})

/** 递归列出 vanilla src 下的 TypeScript 文件。 */
function listTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const next = join(directory, entry.name)

    if (entry.isDirectory()) {
      return listTypeScriptFiles(next)
    }

    return entry.isFile() && next.endsWith('.ts') ? [next] : []
  })
}

/** 收集首屏静态 native import 违规。 */
function collectStaticNativeImportFailures(file: string, source: string, failures: string[]): void {
  const staticNativeImportPattern = /^\s*import(?:\s+type)?[\s\S]*?from\s+['"](@4xian\/jword-native(?:\/[^'"]*)?)['"]/gmu

  for (const match of source.matchAll(staticNativeImportPattern)) {
    const specifier = match[1]

    if (file.endsWith('native-worker.ts') && specifier === '@4xian/jword-native/worker') {
      continue
    }

    failures.push(`${file}: forbidden static ${specifier} import`)
  }
}

/** 收集内部源码或私有 store 读取违规。 */
function collectInternalImportFailures(file: string, source: string, failures: string[]): void {
  const forbiddenSpecifiers = [
    'packages/native/src',
    '@4xian/jword-native/src',
    'packages/core/src/editor/state',
    'packages/core/src/editor/document',
    '@4xian/jword-core/src/editor/state',
    '@4xian/jword-core/src/editor/document'
  ]

  for (const specifier of forbiddenSpecifiers) {
    if (source.includes(specifier)) {
      failures.push(`${file}: forbidden internal import or path '${specifier}'`)
    }
  }
}
