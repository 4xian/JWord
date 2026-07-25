/**
 * 职责：提供 collab demo history 分片的初始版本历史。
 * 边界：只返回内存历史快照，不实现持久化 snapshot、IndexedDB 或只读预览隔离。
 * 协作：lazy-runtime 动态加载本模块后把初始版本传给 createCollabDemoRuntime。
 * 约束：模块可被单独分包加载，顶层不访问 DOM、window 或浏览器存储。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { VersionHistoryEntry } from '../runtime'

/** 创建 demo history 分片的初始版本。 */
export function createCollabDemoHistoryRuntimeSeed(text: string): readonly VersionHistoryEntry[] {
  return [
    {
      id: 'v1',
      label: 'Initial memory snapshot',
      revision: 1,
      text
    }
  ]
}
