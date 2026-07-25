/**
 * @vitest-environment node
 *
 * 职责：锁定发布演练、无别名外部空项目验收和体积预算单一真源。
 * 边界：只读取脚本和 package manifest，不执行构建、pack、浏览器或发布命令。
 * 协作模块：tools/release、tools/size、package export map、SDK 矩阵和 current-implementation 文档共同提供发布前护栏。
 * 约束：脚本只能 dry-run / smoke，不允许自动 publish、tag、push 或修改 registry。
 */

import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { describe, expect, it } from 'vitest'

const releaseDryRunPath = 'tools/release/gate7-release-dry-run.mjs'
const noAliasSmokePath = 'tools/release/check-gate7-third-party-smoke.mjs'
const stableMatrixPath = 'docs/sdk/stable-e2e-matrix.md'
const publicApiPath = 'docs/sdk/public-api.md'
const packageManifests = [
  'packages/core/package.json',
  'packages/ui/package.json',
  'packages/native/package.json',
  'packages/docx/package.json',
  'packages/pdf/package.json',
  'packages/license/package.json',
  'packages/persistence/package.json',
  'packages/collab/package.json',
  'packages/collab-server/package.json',
  'packages/devtools/package.json',
  'packages/react/package.json',
  'packages/vue/package.json'
] as const

describe('Gate 7 release readiness', () => {
  /** 校验 Gate 7 默认入口只读且不能发布。 */
  function verifyGate7ArtifactScanner() {
    expect(existsSync(releaseDryRunPath)).toBe(true)
    const source = readFileSync(releaseDryRunPath, 'utf8')
    const execution = runWithPackCommandTrap(releaseDryRunPath)
    const report = JSON.parse(execution.output) as {
      readonly status: string
      readonly mode: string
      readonly packCommands: number
      readonly publish: string
      readonly packages: readonly unknown[]
    }

    const expectedMode = process.env.JWORD_PHASE3_ARTIFACT_MANIFEST === undefined ? 'source' : 'artifact'

    expect(report).toMatchObject({ status: 'ok', mode: expectedMode, packCommands: 0, publish: 'not-run' })
    expect(report.packages).toHaveLength(12)
    expect(execution.commands).toEqual([])
    expect(source).toContain('check-package-artifacts.mjs')

    for (const forbidden of ['npm publish', 'pnpm publish', 'git tag', 'git push']) {
      expect(source, forbidden).not.toContain(forbidden)
    }
  }

  it('provides a release dry-run script that cannot publish automatically', verifyGate7ArtifactScanner)

  it('keeps the no-alias compatibility entry inventory-only for all Gate 7 packages', () => {
    const source = readFileSync(noAliasSmokePath, 'utf8')
    const contract = JSON.parse(readFileSync('tools/release/package-artifact-contract.json', 'utf8')) as {
      readonly packages: readonly { readonly name: string }[]
    }
    const contractPackageNames = contract.packages.map(readContractPackageName).sort()

    expect(contractPackageNames).toEqual([
      '@4xian/jword-core',
      '@4xian/jword-devtools',
      '@4xian/jword-docx',
      '@4xian/jword-license',
      '@4xian/jword-native',
      '@4xian/jword-pdf',
      '@4xian/jword-persistence',
      '@4xian/jword-react',
      '@4xian/jword-ui',
      '@4xian/jword-vue',
      '@4xian/jword-collab',
      '@4xian/jword-collab-server'
    ].sort())
    for (const token of [
      'check-gate7-third-party-smoke.mjs',
      'runLegacyConsumerCli',
      'check-phase3-third-party-consumers.mjs'
    ]) {
      expect(source, token).toContain(token)
    }
    expect(source).not.toMatch(/(?:npm|pnpm)\s+pack/u)
  })

  it('keeps package manifests on dist files and public export maps', () => {
    for (const manifestPath of packageManifests) {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
      const exportMap = JSON.stringify(manifest.exports)

      expect(manifest.type, manifestPath).toBe('module')
      expect(manifest.main, manifestPath).toBe('./dist/index.js')
      expect(manifest.module, manifestPath).toBe('./dist/index.js')
      expect(manifest.types, manifestPath).toBe('./dist/index.d.ts')
      expect(manifest.files, manifestPath).toContain('dist')
      expect(exportMap, manifestPath).not.toContain('/src/')
      expect(exportMap, manifestPath).not.toContain('packages/')
    }
  })

  it('records the size source of truth and stable E2E matrix in public docs', () => {
    const sdkDocs = [
      readFileSync(stableMatrixPath, 'utf8'),
      readFileSync('docs/sdk/index.md', 'utf8'),
      readFileSync(publicApiPath, 'utf8')
    ].join('\n')

    const sizeCheck = readFileSync('tools/size/check-size.mjs', 'utf8')

    expect(sizeCheck).toContain('sizeBudgetRoadmap')
    expect(sizeCheck).toContain('coreEntryByteLimit')
    expect(sizeCheck).toContain('demoFirstScreenByteLimit')
    expect(sdkDocs).toContain('node tools/release/gate7-release-dry-run.mjs')
    expect(sdkDocs).toContain('node tools/release/check-gate7-third-party-smoke.mjs')
    expect(sdkDocs).toContain('Gate 7 收口前必须同时满足')
  })
})

/** 读取 package contract 的 package name。 */
function readContractPackageName(packageEntry: { readonly name: string }): string {
  return packageEntry.name
}

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
