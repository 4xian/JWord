/**
 * 职责：保留旧 demo 测试入口名称，并转发到正式 @4xian/jword-collab-server history service。
 * 边界：不再复制服务端 history 实现；真实逻辑只存在于正式 server 包。
 * 协作：@4xian/jword-collab-server 提供 storage-backed history service 与 document 级事务边界。
 * 约束：该文件仅供历史测试和本地 demo 兼容，不作为第三方集成 API。
 * 实现说明：本文件按当前源码职责实现，不依赖旧实施计划或需求文档。
 */

export {
  createJWordCollabHistoryService as createCollabHocuspocusHistoryService
} from '@4xian/jword-collab-server'
export type {
  CreateJWordCollabHistoryServiceOptions as CollabHocuspocusHistoryServiceOptions,
  JWordCollabHistoryService as CollabHocuspocusHistoryService,
  RecordJWordCollabHistoryVersionInput as RecordCollabHocuspocusHistoryVersionInput,
  RecordJWordCollabHistoryVersionResult as RecordCollabHocuspocusHistoryVersionResult
} from '@4xian/jword-collab-server'
