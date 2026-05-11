/**
 * 职责：通过根 pnpm dev 脚本启动 Gate 0 vanilla demo。
 * 边界：只委托 examples/vanilla，不启动包构建或发布任务。
 * 协作模块：examples/vanilla/package.json 与 pnpm workspace 过滤。
 * 性能/安全约束：只运行本地开发服务，绝不 commit、tag 或 publish。
 * Specs：docs/superpowers/specs/2026-05-11-jword-canonical/05-implementation-gates.md。
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const demoPackage = 'examples/vanilla/package.json'

if (!existsSync(demoPackage)) {
  console.log('examples/vanilla not present yet; dev skipped.')
  process.exit(0)
}

const result = spawnSync('pnpm', ['--dir', 'examples/vanilla', 'dev'], { stdio: 'inherit' })

process.exit(result.status ?? 1)
