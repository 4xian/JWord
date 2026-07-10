/**
 * 职责：提供 Gate 6 client/server 握手使用的轻量 semver 比较。
 * 边界：只处理版本字符串排序，不读取网络、授权或 provider 状态。
 * 协作模块：client-sdk.ts 在版本握手时调用，collab-server 的 /version 响应提供待比较版本。
 * 性能/安全约束：比较必须为同步纯函数，预发布版本必须低于相同主版本的正式版。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

interface ParsedVersion {
  readonly coreParts: readonly number[]
  readonly prereleaseParts: readonly string[]
}

/** 比较 semver 字符串，返回 -1、0 或 1。 */
export function compareVersions(left: string, right: string): number {
  const leftVersion = readVersionParts(left)
  const rightVersion = readVersionParts(right)
  const coreComparison = compareNumericParts(leftVersion.coreParts, rightVersion.coreParts)

  if (coreComparison !== 0) {
    return coreComparison
  }

  return comparePrereleaseParts(leftVersion.prereleaseParts, rightVersion.prereleaseParts)
}

/** 读取版本号主版本段与预发布段，忽略 build metadata。 */
function readVersionParts(version: string): ParsedVersion {
  const buildSeparatorIndex = version.indexOf('+')
  const withoutBuild = buildSeparatorIndex === -1 ? version : version.slice(0, buildSeparatorIndex)
  const prereleaseSeparatorIndex = withoutBuild.indexOf('-')
  const core = prereleaseSeparatorIndex === -1 ? withoutBuild : withoutBuild.slice(0, prereleaseSeparatorIndex)
  const prerelease = prereleaseSeparatorIndex === -1 ? '' : withoutBuild.slice(prereleaseSeparatorIndex + 1)

  return {
    coreParts: core.split('.').map(readNumericPart),
    prereleaseParts: prerelease.length === 0 ? [] : prerelease.split('.')
  }
}

/** 比较主版本、次版本与修订版本数字段。 */
function compareNumericParts(leftParts: readonly number[], rightParts: readonly number[]): number {
  const maxLength = Math.max(leftParts.length, rightParts.length)

  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0

    if (leftPart !== rightPart) {
      return leftPart < rightPart ? -1 : 1
    }
  }

  return 0
}

/** 比较 semver 预发布标识；正式版高于同主版本预发布版。 */
function comparePrereleaseParts(leftParts: readonly string[], rightParts: readonly string[]): number {
  if (leftParts.length === 0 || rightParts.length === 0) {
    return leftParts.length === rightParts.length ? 0 : leftParts.length === 0 ? 1 : -1
  }

  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const leftPart = leftParts[index]
    const rightPart = rightParts[index]

    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === undefined ? -1 : 1
    }

    const comparison = comparePrereleasePart(leftPart, rightPart)
    if (comparison !== 0) {
      return comparison
    }
  }

  return 0
}

/** 比较单个预发布标识，数字标识低于非数字标识。 */
function comparePrereleasePart(left: string, right: string): number {
  const leftNumber = readPrereleaseNumber(left)
  const rightNumber = readPrereleaseNumber(right)

  if (leftNumber !== null && rightNumber !== null) {
    return leftNumber === rightNumber ? 0 : leftNumber < rightNumber ? -1 : 1
  }
  if (leftNumber !== null || rightNumber !== null) {
    return leftNumber !== null ? -1 : 1
  }

  return left === right ? 0 : left < right ? -1 : 1
}

/** 读取版本数字段，非法段按 0 处理，保持旧容错语义。 */
function readNumericPart(part: string): number {
  const value = Number.parseInt(part, 10)

  return Number.isFinite(value) ? value : 0
}

/** 读取预发布数字标识，非纯数字标识按字符串比较。 */
function readPrereleaseNumber(part: string): number | null {
  return /^(0|[1-9][0-9]*)$/u.test(part) ? Number.parseInt(part, 10) : null
}
