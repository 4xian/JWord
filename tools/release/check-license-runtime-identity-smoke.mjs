/**
 * 职责：验证 Phase 3 License runtime identity 只消费显式 artifact inventory。
 * 边界：不在兼容入口内部 build、pack、install 或覆盖 runtime identity。
 * 协作模块：check-phase3-third-party-consumers 与 artifact manifest/binding。
 * 性能/安全约束：只返回 inventory 绑定的 identity 状态，不输出 token、私钥或 credential。
 */

import { readConsumerArtifact } from './check-phase3-third-party-consumers.mjs'

/** 读取 identity smoke 的显式 inventory 参数。 */
function readOptions(args) {
  const artifactManifestPath = readOption(args, '--artifact-manifest')
  const bindingPath = readOption(args, '--binding')

  if (args.length !== 4 || artifactManifestPath === undefined || bindingPath === undefined) {
    throw new Error('usage: check-license-runtime-identity-smoke.mjs --artifact-manifest <path> --binding <path>')
  }
  return { artifactManifestPath, bindingPath }
}

/** 读取一个不允许重复的 option。 */
function readOption(args, name) {
  const index = args.indexOf(name)
  return index >= 0 && args.indexOf(name, index + 1) < 0 ? args[index + 1] : undefined
}

/** 执行只读 License identity 兼容入口校验。 */
function main() {
  const options = readOptions(process.argv.slice(2))
  const { manifest } = readConsumerArtifact(options.artifactManifestPath, options.bindingPath)

  console.log(JSON.stringify({
    status: 'ok',
    name: 'license-runtime-identity-smoke',
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
