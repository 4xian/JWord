/**
 * @vitest-environment node
 *
 * 职责：通过真实进程验证离线 JWL2 验签 CLI 的输入、时间、错误码与裁剪输出。
 * 边界：只消费固定 production golden token，不读取私钥、不替换 trust store、不调用 signer。
 * 协作模块：tools/license/verify-license.mjs 与 @4xian/jword-license 的公开激活入口。
 * 性能/安全约束：任何失败输出都不得包含 token、签名或密钥材料，临时文件仅保存公开 token。
 * 实现说明：固定历史时间用于复跑已过期 golden token，不作为当前 runtime 授权凭据。
 */

import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

const SCRIPT_PATH = fileURLToPath(new URL('./verify-license.mjs', import.meta.url))
const TEMPORARY_DIRECTORY = mkdtempSync(join(tmpdir(), 'jword-verify-license-'))
const TOKEN_FILE_PATH = join(TEMPORARY_DIRECTORY, 'license.jwl2')
const OVERSIZED_TOKEN_FILE_PATH = join(TEMPORARY_DIRECTORY, 'oversized-license.jwl2')
const CHECKED_AT = '2026-01-15T00:00:00.000Z'
const PRODUCTION_GOLDEN_TOKEN = 'JWL2.eyJzY2hlbWFWZXJzaW9uIjoyLCJsaWNlbnNlSWQiOiJsaWMtMTAzLWdvbGRlbi1leHBpcmVkIiwiaXNzdWVyIjoiandvcmQiLCJrZXlJZCI6Imp3b3JkLXByb2QtMjAyNi1rMSIsImxpY2Vuc2VDbGFzcyI6ImV2YWx1YXRpb24iLCJmZWF0dXJlcyI6WyJmb3JtYXRzIl0sImlzc3VlZEF0IjoiMjAyNi0wMS0wMVQwMDowMDowMC4wMDBaIiwiZXhwaXJlc0F0IjoiMjAyNi0wMS0zMVQwMDowMDowMC4wMDBaIn0.kV6uaOYbb40qoekidoGmab_FfhGPDS3AsrGKZr4l_m9PwyJ8rNIpf4xNHEO66onSFhA6_7YSvTm00R6EazkiAw'
const GOLDEN_SIGNATURE = PRODUCTION_GOLDEN_TOKEN.split('.')[2] ?? ''

writeFileSync(TOKEN_FILE_PATH, `${PRODUCTION_GOLDEN_TOKEN}\n`, 'utf8')
writeFileSync(OVERSIZED_TOKEN_FILE_PATH, 'A'.repeat(16 * 1024 + 3), 'utf8')

afterAll(() => {
  rmSync(TEMPORARY_DIRECTORY, { recursive: true, force: true })
})

describe('verify-license JWL2 CLI', () => {
  it('prints only fixed trimmed claims for a production token valid at the audited time', () => {
    const result = verifyLicense(['--at', CHECKED_AT], `${PRODUCTION_GOLDEN_TOKEN}\n`)

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toBe(`${JSON.stringify({
      status: 'valid',
      checkedAt: CHECKED_AT,
      schemaVersion: 2,
      licenseId: 'lic-103-golden-expired',
      issuer: 'jword',
      keyId: 'jword-prod-2026-k1',
      licenseClass: 'evaluation',
      features: ['formats'],
      issuedAt: '2026-01-01T00:00:00.000Z',
      expiresAt: '2026-01-31T00:00:00.000Z'
    })}\n`)
    assertNoSensitiveOutput(result)
  })

  it.each([
    ['2025-12-31T23:54:59.999Z', 'JWORD_LICENSE_NOT_YET_VALID'],
    ['2026-01-31T00:00:00.000Z', 'JWORD_LICENSE_EXPIRED']
  ])('returns the stable time code at %s', (checkedAt, code) => {
    const result = verifyLicense(['--at', checkedAt], PRODUCTION_GOLDEN_TOKEN)

    expectFailure(result, 1, code)
  })

  it('uses the current system time when --at is omitted', () => {
    const result = verifyLicense([], PRODUCTION_GOLDEN_TOKEN)

    expectFailure(result, 1, 'JWORD_LICENSE_EXPIRED')
  })

  it.each([
    ['tampered payload', tamperPayload(PRODUCTION_GOLDEN_TOKEN)],
    ['tampered signature', tamperSignature(PRODUCTION_GOLDEN_TOKEN)],
    ['unknown issuer', replacePayloadText(PRODUCTION_GOLDEN_TOKEN, '"issuer":"jword"', '"issuer":"other"')],
    ['unknown keyId', replacePayloadText(PRODUCTION_GOLDEN_TOKEN, 'jword-prod-2026-k1', 'jword-prod-2026-k2')],
    ['duplicate key', createMalformedToken('{"schemaVersion":2,"issuer":"jword","issuer":"jword","keyId":"jword-prod-2026-k1"}')],
    ['invalid base64url', `JWL2.invalid+.${GOLDEN_SIGNATURE}`],
    ['invalid UTF-8', `JWL2.${Buffer.from([0xed, 0xa0, 0x80]).toString('base64url')}.${GOLDEN_SIGNATURE}`]
  ])('rejects %s without leaking signed material', (_label, token) => {
    const result = verifyLicense(['--at', CHECKED_AT], token)

    expectFailure(result, 1, 'JWORD_LICENSE_SIGNATURE_INVALID')
  })

  it('accepts the token-file input without consuming an empty stdin', () => {
    const result = verifyLicense(['--at', CHECKED_AT, '--token-file', TOKEN_FILE_PATH])

    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({
      status: 'valid',
      checkedAt: CHECKED_AT,
      licenseId: 'lic-103-golden-expired'
    })
    assertNoSensitiveOutput(result)
  })

  it.each([
    ['both input sources', ['--token-file', TOKEN_FILE_PATH, '--at', CHECKED_AT], PRODUCTION_GOLDEN_TOKEN, 'JWORD_LICENSE_CLI_USAGE_INVALID'],
    ['missing file', ['--token-file', join(TEMPORARY_DIRECTORY, 'missing.jwl2')], undefined, 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['oversized token file', ['--token-file', OVERSIZED_TOKEN_FILE_PATH], undefined, 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['empty stdin', [], '', 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['oversized token', [], `JWL2.${'A'.repeat(16 * 1024)}.${GOLDEN_SIGNATURE}`, 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['oversized input', [], `${'A'.repeat(16 * 1024 + 3)}\n`, 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['multiple tokens', [], `${PRODUCTION_GOLDEN_TOKEN}\n${PRODUCTION_GOLDEN_TOKEN}`, 'JWORD_LICENSE_CLI_INPUT_INVALID'],
    ['unknown option', ['--unknown'], PRODUCTION_GOLDEN_TOKEN, 'JWORD_LICENSE_CLI_USAGE_INVALID'],
    ['invalid at', ['--at', '2026-01-15T00:00:00Z'], PRODUCTION_GOLDEN_TOKEN, 'JWORD_LICENSE_CLI_USAGE_INVALID'],
    ['public key override', ['--public-key', 'attacker'], PRODUCTION_GOLDEN_TOKEN, 'JWORD_LICENSE_CLI_USAGE_INVALID'],
    ['trust root override', ['--trust-store', 'test'], PRODUCTION_GOLDEN_TOKEN, 'JWORD_LICENSE_CLI_USAGE_INVALID'],
    ['inline token', ['--token', PRODUCTION_GOLDEN_TOKEN], undefined, 'JWORD_LICENSE_CLI_USAGE_INVALID']
  ] as const)('rejects CLI/input error: %s', (_label, args, input, expectedCode) => {
    const result = verifyLicense(args, input)

    expectFailure(result, 2, expectedCode)
  })
})

/** 通过真实 Node 进程调用 CLI。 */
function verifyLicense(args: readonly string[], input?: string) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: 'utf8',
    input
  })
}

/** 断言失败只有单个稳定 code 且不泄漏签名材料。 */
function expectFailure(
  result: ReturnType<typeof verifyLicense>,
  status: number,
  code: string
): void {
  expect(result.status).toBe(status)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe(`${code}\n`)
  assertNoSensitiveOutput(result)
}

/** 断言标准输出和错误输出都没有敏感签名材料。 */
function assertNoSensitiveOutput(result: ReturnType<typeof verifyLicense>): void {
  const output = `${result.stdout}${result.stderr}`

  expect(output).not.toContain(PRODUCTION_GOLDEN_TOKEN)
  expect(output).not.toContain(GOLDEN_SIGNATURE)
  expect(output).not.toContain('BEGIN PRIVATE KEY')
}

/** 篡改 payload 内容并保留原签名。 */
function tamperPayload(token: string): string {
  return replacePayloadText(token, 'golden-expired', 'golden-altered')
}

/** 篡改一个签名字节。 */
function tamperSignature(token: string): string {
  const parts = token.split('.')
  const signature = Buffer.from(parts[2] ?? '', 'base64url')
  signature[0] = (signature[0] ?? 0) ^ 1
  return `${parts[0]}.${parts[1]}.${signature.toString('base64url')}`
}

/** 替换 payload JSON 文本并保留原签名。 */
function replacePayloadText(token: string, from: string, to: string): string {
  const parts = token.split('.')
  const payload = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8').replace(from, to)
  return `${parts[0]}.${Buffer.from(payload, 'utf8').toString('base64url')}.${parts[2]}`
}

/** 用指定 JSON 和固定长度签名构造 malformed token。 */
function createMalformedToken(payloadJson: string): string {
  return `JWL2.${Buffer.from(payloadJson, 'utf8').toString('base64url')}.${GOLDEN_SIGNATURE}`
}
