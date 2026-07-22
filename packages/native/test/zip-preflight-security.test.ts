/**
 * @vitest-environment node
 *
 * 职责：通过 native 公开 API 锁定原始 ZIP preflight 的拒绝矩阵。
 * 边界：不调用内部 preflight/helper，不提交大型二进制 fixture。
 * 协作模块：packages/native/src/index.ts 和 native-package-security-fixtures.ts。
 * 性能/安全约束：恶意 ZIP 在测试运行时动态生成。
 * 实现说明：每个失败输入同时覆盖 validate 返回与 load 抛错 seam。
 */

import { describe, it } from 'vitest'

import { createStoredJWordPackage } from './native-package-security-fixtures'
import { expectPublicPackageCode } from './public-api-security-assertions'

describe('@4xian/jword-native ZIP preflight security seam', () => {
  it('rejects duplicate document entries before the later value can replace the first', async () => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ duplicateDocument: true }),
      'JWORD_NATIVE_PACKAGE_INVALID'
    )
  })

  it.each([
    ['path traversal entry', 'path-traversal'],
    ['drive-qualified absolute entry', 'drive-absolute-path'],
    ['encrypted entry', 'encrypted-entry'],
    ['overlapping hidden entry', 'overlapping-entry'],
    ['directory entry with content', 'directory-content']
  ] as const)('rejects %s before reading package content', async (_label, malformed) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ malformed }),
      'JWORD_NATIVE_PACKAGE_INVALID'
    )
  })

  it.each([
    ['archive ZIP64 EOCD', 'archive-zip64-eocd'],
    ['archive ZIP64 locator', 'archive-zip64-locator'],
    ['archive EOCD entry-count sentinel', 'archive-zip64-entry-count'],
    ['archive EOCD central-size sentinel', 'archive-zip64-central-size'],
    ['archive EOCD central-offset sentinel', 'archive-zip64-central-offset'],
    ['central entry compressed-size sentinel', 'entry-zip64-central-compressed-size'],
    ['central entry uncompressed-size sentinel', 'entry-zip64-central-uncompressed-size'],
    ['central entry local-offset sentinel', 'entry-zip64-central-offset'],
    ['central entry disk-start sentinel', 'entry-zip64-central-disk-start'],
    ['central entry ZIP64 extra field', 'entry-zip64-central-extra'],
    ['local entry compressed-size sentinel', 'entry-zip64-local-compressed-size'],
    ['local entry uncompressed-size sentinel', 'entry-zip64-local-uncompressed-size'],
    ['local entry ZIP64 extra field', 'entry-zip64-local-extra']
  ] as const)('rejects %s through both public seams', async (_label, malformed) => {
    await expectPublicPackageCode(
      createStoredJWordPackage({ malformed }),
      'JWORD_NATIVE_PACKAGE_INVALID'
    )
  })
})
