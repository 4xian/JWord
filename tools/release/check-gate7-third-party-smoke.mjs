/**
 * 职责：保留 Gate 7 third-party smoke 的 Phase 3 inventory-only 兼容入口。
 * 边界：只校验显式 artifact manifest/binding，不重新 build 或 pack。
 * 协作模块：check-phase3-third-party-consumers。
 * 性能/安全约束：该入口仅为 legacy-non-gating，最终证据由 Phase 3 consumer matrix 生成。
 */

import { runLegacyConsumerCli } from './check-phase3-third-party-consumers.mjs'

await runLegacyConsumerCli('check-gate7-third-party-smoke.mjs', process.argv.slice(2))
