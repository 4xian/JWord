/**
 * @vitest-environment node
 *
 * 职责：验证本机 Ed25519 License 密钥生成 CLI 的公开行为。
 * 边界：只通过 CLI 生成临时密钥，不读取真实项目密钥或生产 trust store。
 * 协作模块：tools/license/generate-license-keypair.mjs 与 LIC-103 生产 trust lookup。
 * 性能/安全约束：私钥只写入系统临时目录，测试确认 CLI 输出不包含私钥内容。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

import { execFileSync, spawnSync } from 'node:child_process'
import { createPrivateKey, createPublicKey } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const SCRIPT_PATH = fileURLToPath(new URL('./generate-license-keypair.mjs', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))

describe('generate-license-keypair CLI', () => {
  it('writes a protected private key, prints only its matching public key, and refuses overwrite', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jword-license-keypair-'))
    const privateKeyPath = join(directory, '.config/jword/keys/jword-prod-2026-k1-private.pem')
    const environment = { ...process.env, HOME: directory }

    try {
      const stdout = execFileSync(process.execPath, [SCRIPT_PATH], {
        encoding: 'utf8',
        env: environment
      })
      const result = JSON.parse(stdout) as {
        readonly issuer: string
        readonly keyId: string
        readonly algorithm: string
        readonly publicKeyBase64Url: string
        readonly privateKeyPath: string
      }
      const privateKey = createPrivateKey(readFileSync(privateKeyPath))
      const publicJwk = createPublicKey(privateKey).export({ format: 'jwk' })

      expect(result.issuer).toBe('jword')
      expect(result.keyId).toBe('jword-prod-2026-k1')
      expect(result.algorithm).toBe('Ed25519')
      expect(result.privateKeyPath).toBe(realpathSync(privateKeyPath))
      expect(result.publicKeyBase64Url).toBe(publicJwk.x)
      expect(result.publicKeyBase64Url).toMatch(/^[A-Za-z0-9_-]{43}$/u)
      expect(statSync(privateKeyPath).mode & 0o777).toBe(0o600)
      expect(statSync(dirname(privateKeyPath)).mode & 0o777).toBe(0o700)
      expect(stdout).not.toContain('BEGIN PRIVATE KEY')

      const overwrite = spawnSync(process.execPath, [SCRIPT_PATH], {
        encoding: 'utf8',
        env: environment
      })

      expect(overwrite.status).toBe(1)
      expect(overwrite.stderr).toContain('EEXIST')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('rejects a key directory symlink that resolves into the repository', () => {
    const directory = mkdtempSync(join(tmpdir(), 'jword-license-keypair-link-'))
    const keyDirectory = join(directory, '.config/jword/keys')
    const repositoryKeyPath = join(REPOSITORY_ROOT, 'jword-prod-2026-k1-private.pem')

    try {
      mkdirSync(dirname(keyDirectory), { recursive: true })
      symlinkSync(REPOSITORY_ROOT, keyDirectory, 'dir')

      const result = spawnSync(process.execPath, [SCRIPT_PATH], {
        encoding: 'utf8',
        env: { ...process.env, HOME: directory }
      })

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Private key path must be outside the repository')
      expect(existsSync(repositoryKeyPath)).toBe(false)
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
