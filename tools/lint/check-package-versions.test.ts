/**
 * @vitest-environment node
 *
 * 职责：验证 package 版本治理脚本覆盖根包、子包、示例包和 pnpm overrides。
 * 边界：通过临时 workspace 调用 check-package-versions.mjs CLI，不读取真实 package.json。
 * 协作模块：tools/lint/check-package-versions.mjs、pnpm-workspace.yaml 与 monorepo package manifest。
 * 性能/安全约束：测试只写入系统临时目录，失败输出必须定位到具体 package manifest 字段。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)
const CHECK_PACKAGE_VERSIONS_SCRIPT = new URL('./check-package-versions.mjs', import.meta.url)

describe('check-package-versions Gate 0 scan', () => {
  it('rejects loose child package versions, non-workspace internal deps and loose overrides', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'jword-package-versions-'))

    try {
      await writePackageJson(workspace, {
        packageManager: 'pnpm@9.14.2',
        devDependencies: {
          vitest: '4.1.5'
        },
        pnpm: {
          overrides: {
            jszip: '^3.10.1'
          }
        }
      })
      await writeFile(join(workspace, 'pnpm-workspace.yaml'), [
        'packages:',
        '  - "packages/*"',
        '  - "examples/*"',
        ''
      ].join('\n'))
      await mkdir(join(workspace, 'packages/core'), { recursive: true })
      await mkdir(join(workspace, 'packages/ui'), { recursive: true })
      await mkdir(join(workspace, 'examples/vanilla'), { recursive: true })
      await writePackageJson(join(workspace, 'packages/core'), {
        name: '@4xian/jword-core',
        version: '0.0.0',
        dependencies: {
          yjs: '^13.6.30'
        }
      })
      await writePackageJson(join(workspace, 'packages/ui'), {
        name: '@4xian/jword-ui',
        version: '0.0.0',
        dependencies: {
          '@4xian/jword-core': '0.0.0'
        }
      })
      await writePackageJson(join(workspace, 'examples/vanilla'), {
        name: '@4xian/jword-example-vanilla',
        version: '0.0.0',
        dependencies: {
          '@4xian/jword-ui': '0.0.0'
        }
      })

      const failure = await runVersionScanExpectingFailure(workspace)

      expect(failure.stderr).toContain('packages/core/package.json dependencies.yjs 使用宽松版本：^13.6.30')
      expect(failure.stderr).toContain('packages/ui/package.json dependencies.@4xian/jword-core 内部依赖必须使用 workspace: 协议：0.0.0')
      expect(failure.stderr).toContain('examples/vanilla/package.json dependencies.@4xian/jword-ui 内部依赖必须使用 workspace: 协议：0.0.0')
      expect(failure.stderr).toContain('package.json pnpm.overrides.jszip 使用宽松版本：^3.10.1')
    } finally {
      await rm(workspace, { recursive: true, force: true })
    }
  })
})

interface VersionScanFailure {
  readonly code: number | string
  readonly stderr: string
}

/** 写入测试 package.json。 */
async function writePackageJson(directory: string, value: unknown): Promise<void> {
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(value, null, 2)}\n`)
}

/** 执行版本脚本并返回失败输出。 */
async function runVersionScanExpectingFailure(workspace: string): Promise<VersionScanFailure> {
  try {
    await execFileAsync(process.execPath, [CHECK_PACKAGE_VERSIONS_SCRIPT.pathname], {
      cwd: workspace
    })
  } catch (error) {
    if (isVersionScanFailure(error)) {
      expect(error.code).toBe(1)

      return error
    }
    throw error
  }

  throw new Error('Expected check-package-versions.mjs to reject the temporary workspace.')
}

/** 判断 execFile 抛出的错误是否包含脚本输出。 */
function isVersionScanFailure(error: unknown): error is VersionScanFailure {
  return typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'stderr' in error &&
    typeof (error as { readonly stderr?: unknown }).stderr === 'string'
}
