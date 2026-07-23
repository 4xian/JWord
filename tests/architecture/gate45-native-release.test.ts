/**
 * @vitest-environment node
 *
 * 职责：约束 Gate 4.5 native 包的 release dry-run 文件清单和 package 形态。
 * 边界：只检查 package.json 与 release 审计脚本，不运行 npm pack。
 * 协作模块：packages/native/package.json、packages/native/README.md、packages/native/fixtures、tools/release/check-native-pack.mjs。
 * 约束：native 包发布内容必须包含 dist、README 和 fixtures，且不暴露 src 或 test。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, expect, it } from 'vitest'

describe('Gate 4.5 native release dry-run', () => {
  it('declares a publishable file list without src or test paths', () => {
    const packageJson = JSON.parse(readFileSync('packages/native/package.json', 'utf8')) as {
      readonly files: readonly string[]
    }

    expect(packageJson.files).toEqual([
      'dist',
      'fixtures',
      'README.md'
    ])
  })

  it('ships the release dry-run audit script and package fixture registry', () => {
    expect(existsSync('tools/release/check-native-pack.mjs')).toBe(true)
    expect(existsSync('packages/native/README.md')).toBe(true)
    expect(existsSync('packages/native/fixtures/registry.json')).toBe(true)
  })

  /** 校验 native 默认入口只执行 source audit。 */
  function verifyNativeSourceAudit() {
    const execution = runWithPackCommandTrap('tools/release/check-native-pack.mjs')
    const report = JSON.parse(execution.output) as {
      readonly status: string
      readonly mode: string
      readonly packCommands: number
    }

    const expectedMode = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined ? 'source' : 'artifact'

    expect(report).toMatchObject({ status: 'ok', mode: expectedMode, packCommands: 0 })
    expect(execution.commands).toEqual([])
  }

  it('runs the default source audit without any npm or pnpm pack subprocess', verifyNativeSourceAudit)

  it('keeps the package fixture registry aligned with the root native registry', () => {
    const rootRegistry = JSON.parse(readFileSync('fixtures/native/registry.json', 'utf8')) as unknown
    const packageRegistry = JSON.parse(readFileSync('packages/native/fixtures/registry.json', 'utf8')) as unknown

    expect(packageRegistry).toEqual(rootRegistry)
  })
})

/** 在 npm/pnpm 命令 trap 下运行 release script 并读取可观测调用记录。 */
function runWithPackCommandTrap(scriptPath: string): { readonly output: string, readonly commands: readonly string[] } {
  const root = mkdtempSync(join(tmpdir(), 'jword-phase3-pack-trap-'))
  const binDirectory = join(root, 'bin')
  const logPath = join(root, 'commands.log')
  const trap = '#!/bin/sh\nprintf \'%s\\n\' "$0 $*" >> "$JWORD_PHASE3_PACK_COMMAND_LOG"\nexit 97\n'

  try {
    execFileSync('mkdir', ['-p', binDirectory])
    for (const command of ['npm', 'pnpm']) {
      const commandPath = join(binDirectory, command)

      writeFileSync(commandPath, trap)
      chmodSync(commandPath, 0o755)
    }

    const scriptArguments = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined
      ? [scriptPath]
      : [scriptPath, '--artifact-manifest', process.env.JWORD_PHASE3_ARTIFACT_MANIFEST]
    const output = execFileSync(process.execPath, scriptArguments, {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${binDirectory}${delimiter}${process.env.PATH ?? ''}`,
        JWORD_PHASE3_PACK_COMMAND_LOG: logPath
      }
    })
    const commands = existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean) : []

    return { output, commands }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
