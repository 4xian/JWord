/**
 * 职责：集中校验 native package 读写两侧共用的 ZIP entry 名称规则。
 * 边界：不解析 ZIP 记录，不读取 entry 内容，也不执行 URL decode。
 * 协作模块：zip-preflight.ts、bounded-zip-reader.ts 和 package-codec.ts。
 * 性能/安全约束：名称按 UTF-8 bytes 计量，拒绝路径穿越和规范化冲突。
 * 实现说明：目录只允许一个末尾斜杠，文件路径不允许空 segment。
 */

import { createPackageError } from './diagnostics.js'
import { JWORD_NATIVE_PACKAGE_LIMITS, assertNativePackageLimit } from './package-read-budget.js'
import type { JWordPackageErrorCode } from './types.js'

const textEncoder = new TextEncoder()

/** 校验单个 entry 名称并返回 NFC 规范化 key。 */
export function validateNativePackageEntryName(
  name: string,
  directory: boolean,
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_PACKAGE_INVALID'
): string {
  assertNativePackageLimit(textEncoder.encode(name).byteLength, JWORD_NATIVE_PACKAGE_LIMITS.entryNameBytes, requestId)

  if (
    name.length === 0 ||
    name.startsWith('/') ||
    /^[A-Za-z]:\//u.test(name) ||
    name.includes('\\') ||
    name.includes('\0')
  ) {
    throwInvalidEntryName(requestId, invalidCode)
  }

  const hasTrailingSlash = name.endsWith('/')

  if (hasTrailingSlash !== directory) {
    throwInvalidEntryName(requestId, invalidCode)
  }

  const segments = (directory ? name.slice(0, -1) : name).split('/')

  if (segments.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    throwInvalidEntryName(requestId, invalidCode)
  }

  return name.normalize('NFC')
}

/** 校验全部 entry 名称无重复或规范化冲突。 */
export function validateUniqueNativePackageEntryNames(
  entries: readonly { readonly name: string, readonly directory: boolean }[],
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_PACKAGE_INVALID'
): void {
  const names = new Map<string, string>()

  for (const entry of entries) {
    const canonical = validateNativePackageEntryName(entry.name, entry.directory, requestId, invalidCode)
    const existing = names.get(canonical)

    if (existing !== undefined) {
      throwInvalidEntryName(requestId, invalidCode)
    }

    names.set(canonical, entry.name)
  }
}

/** 抛出不包含原始 entry 名称的稳定错误。 */
function throwInvalidEntryName(
  requestId?: string,
  invalidCode: JWordPackageErrorCode = 'JWORD_NATIVE_PACKAGE_INVALID'
): never {
  throw createPackageError(
    invalidCode,
    invalidCode,
    requestId
  )
}
