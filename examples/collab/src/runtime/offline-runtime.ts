/**
 * 职责：提供 collab demo offline 分片的初始状态。
 * 边界：只声明内存离线面板初始快照，不实现 IndexedDB、重放队列或真实恢复。
 * 协作：lazy-runtime 动态加载本模块后把状态传给 createCollabDemoRuntime。
 * 约束：模块可被单独分包加载，顶层不访问 DOM、window 或浏览器存储。
 * Specs：docs/superpowers/plans/2026-05-11-jword-canonical-implementation.md Gate 6 collaboration/auto-insert。
 */
import type { OfflineStateSnapshot } from '../runtime'

/** 创建 demo offline 分片的初始快照。 */
export function createCollabDemoOfflineRuntimeSeed(): OfflineStateSnapshot {
  return {
    connected: true,
    queuedOperations: 0,
    lastEvent: 'connected'
  }
}
