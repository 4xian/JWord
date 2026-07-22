/**
 * 职责：在固定 Node 20.19.0 Docker 环境中复跑 License tarball 的公开入口验证。
 * 边界：只关闭 LIC-107B2 的 Node 行，不生成或替代最低浏览器版本证据。
 * 协作模块：License package build、Docker runtime 和 check-license-runtime-smoke.mjs。
 * 约束：仓库以只读方式挂载，临时安装只发生在容器 /tmp，不提交、发布或写入 workspace。
 * 实现说明：记录源码状态和镜像 digest，容器内固定 pnpm 9.14.2 并调用 --node-only。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('../..', import.meta.url))
const nodeImage = 'node:20.19.0-bookworm-slim'
const packPath = readPackPath(process.argv.slice(2))

/** 读取可选的既有 License tarball 路径。 */
function readPackPath(arguments_) {
  if (arguments_.length === 0) {
    return undefined
  }

  if (arguments_.length === 2 && arguments_[0] === '--pack-path') {
    const resolvedPath = resolve(arguments_[1])
    if (!existsSync(resolvedPath)) {
      throw new Error(`License tarball does not exist: ${resolvedPath}`)
    }

    return resolvedPath
  }

  throw new Error(`Unsupported License minimum Node arguments: ${arguments_.join(' ')}`)
}

/** 执行命令并返回去除首尾空白的文本。 */
function readCommand(command, arguments_, options = {}) {
  return execFileSync(command, arguments_, {
    cwd: repoRoot,
    encoding: 'utf8',
    ...options
  }).trim()
}

if (packPath === undefined) {
  execFileSync('pnpm', ['--filter', '@4xian/jword-license', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit'
  })
}
execFileSync('docker', ['pull', nodeImage], { stdio: 'inherit' })

const source = {
  commit: readCommand('git', ['rev-parse', 'HEAD']),
  dirty: readCommand('git', ['status', '--short']).length > 0
}
const image = {
  reference: nodeImage,
  id: readCommand('docker', ['image', 'inspect', '--format', '{{.Id}}', nodeImage]),
  repoDigests: JSON.parse(readCommand(
    'docker',
    ['image', 'inspect', '--format', '{{json .RepoDigests}}', nodeImage]
  )),
  platform: readCommand(
    'docker',
    ['image', 'inspect', '--format', '{{.Os}}/{{.Architecture}}', nodeImage]
  )
}

console.log(JSON.stringify({
  status: 'environment-ready',
  name: 'license-minimum-node',
  scope: 'LIC-107B2-node-20.19.0',
  source,
  image,
  input: {
    packPath: packPath ?? 'generated-inside-container'
  }
}, null, 2))

const containerCommand = [
  'mkdir -p /tmp/home /tmp/corepack',
  'corepack enable',
  'corepack prepare pnpm@9.14.2 --activate',
  packPath === undefined
    ? 'node tools/release/check-license-runtime-smoke.mjs --node-only'
    : 'node tools/release/check-license-runtime-smoke.mjs --node-only --pack-path "$JWORD_LICENSE_RUNTIME_PACK_PATH"'
].join(' && ')

execFileSync('docker', [
  'run',
  '--rm',
  '--env',
  'HOME=/tmp/home',
  '--env',
  'COREPACK_HOME=/tmp/corepack',
  ...(packPath === undefined
    ? []
    : [
        '--env',
        `JWORD_LICENSE_RUNTIME_PACK_PATH=/input/${basename(packPath)}`,
        '--mount',
        `type=bind,source=${dirname(packPath)},target=/input,readonly`
      ]),
  '--mount',
  `type=bind,source=${repoRoot},target=/workspace,readonly`,
  '--workdir',
  '/workspace',
  image.id,
  'sh',
  '-lc',
  containerCommand
], { stdio: 'inherit' })
