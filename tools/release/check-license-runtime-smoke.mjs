/**
 * 职责：验证 Phase 3 License runtime smoke 只消费显式 artifact inventory。
 * 边界：不在兼容入口内部 build、pack、install 或生成 License token。
 * 协作模块：check-phase3-third-party-consumers 与 artifact manifest/binding。
 * 性能/安全约束：legacy `--pack-path` 只读外部 tarball，禁止 registry 写入和 workspace fallback。
 */

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { readConsumerArtifact } from './check-phase3-third-party-consumers.mjs'

/** 读取 License runtime smoke 参数并拒绝隐式 workspace 路径。 */
function readOptions(args) {
  const artifactManifestPath = readOption(args, '--artifact-manifest')
  const bindingPath = readOption(args, '--binding')

  if (args.length === 4 && artifactManifestPath !== undefined && bindingPath !== undefined) {
    return { mode: 'artifact', artifactManifestPath, bindingPath }
  }
  if (args.length === 2 && args[0] === '--pack-path' && args[1] !== '') {
    return { mode: 'legacy-non-gating', packPath: resolve(args[1]) }
  }
  if (
    args.length === 3 &&
    (args[0] === '--node-only' || args[0] === '--prepare-browser') &&
    args[1] === '--pack-path' &&
    args[2] !== ''
  ) {
    return { mode: 'legacy-non-gating', legacyMode: args[0].slice(2), packPath: resolve(args[2]) }
  }
  throw new Error('usage: check-license-runtime-smoke.mjs --artifact-manifest <path> --binding <path> | --pack-path <path>')
}

/** 读取一个不允许重复的 option。 */
function readOption(args, name) {
  const index = args.indexOf(name)
  return index >= 0 && args.indexOf(name, index + 1) < 0 ? args[index + 1] : undefined
}

/** 执行只读 License runtime 兼容入口校验。 */
function main() {
  const options = readOptions(process.argv.slice(2))
  if (options.mode === 'legacy-non-gating') {
    const bytes = readFileSync(options.packPath)
    console.log(JSON.stringify({
      status: 'ok',
      name: 'license-runtime-smoke',
      mode: options.mode,
      legacyMode: options.legacyMode ?? 'full',
      packPath: options.packPath,
      packSha256: createHash('sha256').update(bytes).digest('hex'),
      repacks: 0
    }, null, 2))
    return
  }

  const { manifest } = readConsumerArtifact(options.artifactManifestPath, options.bindingPath)
  console.log(JSON.stringify({
    status: 'ok',
    name: 'license-runtime-smoke',
    mode: 'legacy-non-gating',
    artifactSetId: manifest.artifactSetId,
    verification: 'delegated-to-phase3-consumer',
    repacks: 0,
    workspaceLinks: 0
  }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
