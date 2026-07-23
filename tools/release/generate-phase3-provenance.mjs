/**
 * 职责：从已验证 run-a manifest 生成未签名 in-toto/SLSA v1 provenance Statement。
 * 边界：只转换结构化 identity，不签名、不创建 DSSE envelope。
 * 协作模块：Phase 3 release gate runner 与最终 verifier。
 * 性能/安全约束：subject、resolved dependency 和 byproduct 集合固定且可重算。
 */
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** 生成固定字段的未签 SLSA v1 Statement。 */
export function generatePhase3Provenance(manifest, manifestSha256, checksumSha256) {
  const identity = manifest.artifactIdentity
  assertHash(manifestSha256, 'artifact manifest hash')
  assertHash(checksumSha256, 'checksum hash')

  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: identity.packages.map(function createSubject(packageEntry) {
      return { name: packageEntry.tarballFile, digest: { sha256: packageEntry.tarballSha256 } }
    }).sort(compareName),
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'urn:jword:build-type:phase3-artifact-set:v1',
        externalParameters: {
          artifactSetId: manifest.artifactSetId,
          gitSha: identity.gitSha,
          lockfileSha256: identity.lockfileSha256,
          contractSha256: identity.contractSha256
        },
        internalParameters: {
          builderSha256: identity.builderSha256,
          environment: identity.environment
        },
        resolvedDependencies: [
          descriptor('urn:jword:source:git', 'gitCommit', identity.gitSha),
          descriptor('urn:jword:source:pnpm-lock', 'sha256', identity.lockfileSha256),
          descriptor('urn:jword:source:package-artifact-contract', 'sha256', identity.contractSha256),
          descriptor('urn:jword:source:phase3-builder', 'sha256', identity.builderSha256)
        ].sort(compareUri)
      },
      runDetails: {
        builder: { id: 'urn:jword:builder:phase3-artifacts:v1' },
        metadata: { invocationId: manifest.runMetadata.executionRunId },
        byproducts: [
          descriptor('urn:jword:artifact:artifact-manifest', 'sha256', manifestSha256),
          descriptor('urn:jword:artifact:sha256sums', 'sha256', checksumSha256)
        ].sort(compareUri)
      }
    }
  }
}

/** 创建一个 SLSA ResourceDescriptor。 */
function descriptor(uri, algorithm, digest) {
  assertHash(digest, `${uri} digest`)
  return { uri, digest: { [algorithm]: digest } }
}

/** 按 subject name 排序。 */
function compareName(left, right) { return left.name < right.name ? -1 : left.name > right.name ? 1 : 0 }

/** 按 resource URI 排序。 */
function compareUri(left, right) { return left.uri < right.uri ? -1 : left.uri > right.uri ? 1 : 0 }

/** 校验 SHA-256 或 Git SHA hex。 */
function assertHash(value, label) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40,64}$/u.test(value)) throw new Error(`${label} is invalid`)
}

/** 禁止把生成器误当作无参数发布入口。 */
function main() {
  console.error('generate-phase3-provenance.mjs is an internal library; use check-phase3-release-gates.mjs')
  process.exitCode = 1
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
