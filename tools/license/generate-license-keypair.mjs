/**
 * 职责：在本机生成 JWord 生产 Ed25519 密钥对并只输出公钥元数据。
 * 边界：私钥只写入当前用户的仓库外专用目录，不修改生产 trust store 或签发 token。
 * 协作模块：LIC-103 读取公钥，LIC-108 的签发工具使用受控私钥。
 * 性能/安全约束：私钥文件权限固定为 0600，禁止覆盖已有文件或写入仓库。
 * 实现说明：使用 Node 原生 Ed25519，公钥输出为无 padding 的 32-byte base64url。
 */

import { generateKeyPairSync } from 'node:crypto'
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ISSUER = 'jword'
const KEY_ID = 'jword-prod-2026-k1'
const REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PRIVATE_KEY_PATH = join(homedir(), '.config/jword/keys', `${KEY_ID}-private.pem`)

try {
  generateLicenseKeyPair(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${readErrorMessage(error)}\n`)
  process.exitCode = 1
}

/** 生成密钥对、保存私钥并输出公钥元数据。 */
function generateLicenseKeyPair(args) {
  const privateKeyPath = preparePrivateKeyPath(args)
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const publicKeyBase64Url = readRawPublicKey(publicKey)

  writeFileSync(
    privateKeyPath,
    privateKey.export({ format: 'pem', type: 'pkcs8' }),
    { flag: 'wx', mode: 0o600 }
  )
  chmodSync(privateKeyPath, 0o600)

  process.stdout.write(`${JSON.stringify({
    issuer: ISSUER,
    keyId: KEY_ID,
    algorithm: 'Ed25519',
    publicKeyBase64Url,
    privateKeyPath
  }, null, 2)}\n`)
}

/** 创建专用密钥目录并校验固定私钥路径。 */
function preparePrivateKeyPath(args) {
  if (args.length !== 0) {
    throw new Error('Usage: node tools/license/generate-license-keypair.mjs')
  }

  const privateKeyDirectory = dirname(PRIVATE_KEY_PATH)
  mkdirSync(privateKeyDirectory, { recursive: true, mode: 0o700 })

  const realPrivateKeyDirectory = realpathSync(privateKeyDirectory)
  const realPrivateKeyPath = join(realPrivateKeyDirectory, basename(PRIVATE_KEY_PATH))
  const repositoryRelativePath = relative(realpathSync(REPOSITORY_ROOT), realPrivateKeyPath)

  if (repositoryRelativePath === '' || (!repositoryRelativePath.startsWith('..') && !isAbsolute(repositoryRelativePath))) {
    throw new Error('Private key path must be outside the repository')
  }

  chmodSync(realPrivateKeyDirectory, 0o700)

  return realPrivateKeyPath
}

/** 从 Node 公钥对象读取规范的 32-byte base64url 值。 */
function readRawPublicKey(publicKey) {
  const publicJwk = publicKey.export({ format: 'jwk' })

  if (typeof publicJwk.x !== 'string') {
    throw new Error('Unable to export Ed25519 public key')
  }

  const publicKeyBytes = Buffer.from(publicJwk.x, 'base64url')
  if (publicKeyBytes.length !== 32 || publicKeyBytes.toString('base64url') !== publicJwk.x) {
    throw new Error('Ed25519 public key must be canonical 32-byte base64url')
  }

  return publicJwk.x
}

/** 把未知异常转换为稳定 CLI 错误消息。 */
function readErrorMessage(error) {
  return error instanceof Error ? error.message : 'Unable to generate license key pair'
}
