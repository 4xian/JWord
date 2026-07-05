/**
 * @vitest-environment node
 *
 * 职责：验证 Gate 0 边界扫描脚本能拦截 core 禁止导入、顶层浏览器全局与 workspace src 测试文件。
 * 边界：通过临时 workspace 调用 check-boundaries.mjs CLI，不读取真实 packages/core 源码。
 * 协作模块：tools/lint/check-boundaries.mjs 与 pnpm-workspace.yaml 扫描根派生逻辑。
 * 性能/安全约束：测试只写入系统临时目录，脚本失败输出必须包含具体违规文件。
 * Specs：docs/superpowers/reports/2026-07-02-gate0-gate1-review.md#g0-06-check-boundariesmjs-的-import-匹配存在绕过通道。
 */

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const CHECK_BOUNDARIES_SCRIPT = new URL('./check-boundaries.mjs', import.meta.url)

describe('check-boundaries Gate 0 scan', () => {
  it('rejects core export, side-effect, dynamic forbidden imports and workspace src tests', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'jword-boundary-'))

    try {
      await writeFile(join(workspace, 'pnpm-workspace.yaml'), [
        'packages:',
        '  - "packages/*"',
        '  - "examples/*"',
        '  - "tools/*"',
        '  - "fixtures"',
        '  - "benchmarks"',
        ''
      ].join('\n'))
      await mkdir(join(workspace, 'packages/core/src'), { recursive: true })
      await mkdir(join(workspace, 'benchmarks/src'), { recursive: true })
      await writeFile(join(workspace, 'packages/core/src/export-forbidden.ts'), [
        'export { createUI } from \'@4xian/jword-ui\'',
        'import \'vue\'',
        'export const loadPdf = () => import(\'pdf-lib\')',
        'export const userAgent = navigator.userAgent',
        ''
      ].join('\n'))
      await writeFile(join(workspace, 'benchmarks/src/misplaced.test.ts'), 'export const value = 1\n')

      const failure = await runBoundaryScanExpectingFailure(workspace)

      expect(failure.stderr).toContain('forbidden core import \'@4xian/jword-ui\'')
      expect(failure.stderr).toContain('forbidden core import \'vue\'')
      expect(failure.stderr).toContain('forbidden core import \'pdf-lib\'')
      expect(failure.stderr).toContain('possible top-level DOM access \'navigator\'')
      expect(failure.stderr).toContain('benchmarks/src/misplaced.test.ts')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

interface BoundaryScanFailure {
  readonly code: number | string
  readonly stderr: string
}

/** 执行边界脚本并返回失败输出。 */
async function runBoundaryScanExpectingFailure(workspace: string): Promise<BoundaryScanFailure> {
  try {
    await execFileAsync(process.execPath, [CHECK_BOUNDARIES_SCRIPT.pathname], {
      cwd: workspace
    })
  } catch (error) {
    if (isBoundaryScanFailure(error)) {
      expect(error.code).toBe(1)

      return error
    }
    throw error
  }

  throw new Error('Expected check-boundaries.mjs to reject the temporary workspace.')
}

/** 判断 execFile 抛出的错误是否包含脚本输出。 */
function isBoundaryScanFailure(error: unknown): error is BoundaryScanFailure {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'stderr' in error &&
    typeof (error as { readonly stderr?: unknown }).stderr === 'string'
}
