/**
 * 职责：提供 collab demo provider 分片的客户端、awareness 和自动插入种子数据。
 * 边界：只返回 demo 内存 provider 的初始快照，不连接真实 Hocuspocus、WebSocket 或 core 协同 provider。
 * 协作：lazy-runtime 动态加载本模块后把种子传给 createCollabDemoRuntime。
 * 约束：模块可被单独分包加载，顶层不访问 DOM、window 或网络。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */
import type { CollabDemoRuntimeProviderInput } from '../runtime'

/** 创建 demo provider 分片的初始快照。 */
export function createCollabDemoProviderRuntimeSeed(): CollabDemoRuntimeProviderInput {
  return {
    clients: [
      {
        id: 'client-a',
        name: 'Client A',
        text: 'Gate 6 memory collab draft',
        revision: 1
      },
      {
        id: 'client-b',
        name: 'Client B',
        text: 'Gate 6 memory collab draft',
        revision: 1
      }
    ],
    awarenessUsers: [
      {
        clientId: 'client-a',
        name: 'Alice',
        color: '#286fd6',
        cursorOffset: 8,
        selectionStart: 8,
        selectionEnd: 8,
        connected: true
      },
      {
        clientId: 'client-b',
        name: 'Bao',
        color: '#0f8f6a',
        cursorOffset: 16,
        selectionStart: 16,
        selectionEnd: 16,
        connected: true
      }
    ],
    autoInsertTokens: ['协同', '版本', '离线', '回放']
  }
}
