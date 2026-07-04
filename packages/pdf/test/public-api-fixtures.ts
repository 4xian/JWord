/**
 * @vitest-environment node
 *
 * 职责：提供 Gate 5 PDF public API 测试复用的图片和字体 fixture。
 * 边界：只读取测试输入，不断言 PDF 输出、不触发渲染。
 * 协作模块：packages/pdf/test/public-api.test.ts 与 fixtures/pdf/inputs。
 * 约束：所有 fixture 读取保持同步、显式，避免在测试主体里堆叠文件系统细节。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md#iteration-23---实现-pdf-中文字体图片表格线和页眉页脚。
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createInsecureTestOnlyJWordLicenseSignature,
  type JWordLicenseEntitlement
} from '@4xian/jword-license'
import { INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED } from '../../../fixtures/license/insecure-test-only-keys'

export const ONE_PIXEL_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lYgWtwAAAABJRU5ErkJggg=='

export const ONE_PIXEL_JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k='

const requireFromTest = createRequire(import.meta.url)
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url))

export interface PdfChineseFontFixture {
  readonly font: {
    readonly family: string
    readonly path: string
  }
  readonly document: {
    readonly id: string
    readonly sectionId: string
    readonly paragraphId: string
    readonly runId: string
    readonly text: string
  }
  readonly pageConfig: {
    readonly widthTwips: number
    readonly heightTwips: number
    readonly marginTwips: {
      readonly top: number
      readonly right: number
      readonly bottom: number
      readonly left: number
    }
  }
  readonly expectation: {
    readonly pdfJsText: string
  }
}

/** 创建 PDF public API 测试使用的有效授权。 */
export function createPdfPublicApiLicense(features: readonly string[]): JWordLicenseEntitlement {
  const entitlement = {
    customerId: 'customer-pdf-public-api',
    licenseToken: 'token-pdf-public-api',
    issuer: 'jword-pdf-public-api-test',
    issuedAt: '2026-05-01T00:00:00Z',
    features,
    expiresAt: '2099-06-01T00:00:00Z',
    status: 'valid' as const
  }

  return {
    ...entitlement,
    signature: createInsecureTestOnlyJWordLicenseSignature(entitlement, INSECURE_TEST_ONLY_LICENSE_PRIVATE_KEY_SEED)
  }
}

/** 读取随 pdfjs-dist 发布的 LiberationSans 字体，作为稳定的自定义字体 fixture。 */
export function readTestFontBytes(): ArrayBuffer {
  const pdfJsPackagePath = requireFromTest.resolve('pdfjs-dist/package.json')
  const fontPath = join(dirname(pdfJsPackagePath), 'standard_fonts', 'LiberationSans-Regular.ttf')
  const bytes = readFileSync(fontPath)

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/** 读取 Gate 5 PDF 中文字体输入 fixture。 */
export function readChineseFontFixture(): PdfChineseFontFixture {
  const fixturePath = join(repoRoot, 'fixtures/pdf/inputs/pdf-chinese-font.json')

  return JSON.parse(readFileSync(fixturePath, 'utf8')) as PdfChineseFontFixture
}

/** 读取仓库内 fixture 二进制。 */
export function readFixtureBytes(path: string): ArrayBuffer {
  const fontPath = join(repoRoot, path)
  const bytes = readFileSync(fontPath)

  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
