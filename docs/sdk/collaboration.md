# Gate 6 协作客户端集成

## 范围与 edition

多人协作、离线、历史版本和自动插入属于 paid collaboration edition。客户端通过 `@4xian/jword-collab` 接入；持久化和离线缓存通过 `@4xian/jword-persistence` 接入；授权 feature key 来自 `GATE6_COLLAB_FEATURES`。

## 稳定入口

```ts
import {
  GATE6_COLLAB_FEATURES,
  connectJWordCollaboration,
  createMemoryCollabProviderAdapter
} from '@4xian/jword-collab'
```

Gate 6 对外稳定 interface 包括：`connectJWordCollaboration()`、`ConnectJWordCollaborationOptions`、`JWordCollaborationConnection`、`JWordCollaborationHandshake`、`JWordCollaborationOfflineState`、`JWordCollaborationHistoryVersion`、`JWordCollaborationAutoInsertSession`、`createMemoryCollabProviderAdapter()` 和 `GATE6_COLLAB_FEATURES`。

## 初始化

宿主必须显式传入 `documentId`、`roomId`、`user`、provider adapter、license 和版本信息。`user` 至少包含 `id`、`name` 和 `color`，远端 cursor、typing label 与 awareness 排序只消费这些公开字段。

```ts
const connection = await connectJWordCollaboration({
  editor,
  documentId: 'doc-1',
  roomId: 'room-1',
  user: {
    id: 'u-1',
    name: 'Ada',
    color: '#2563eb'
  },
  provider: createMemoryCollabProviderAdapter(),
  license,
  features: [GATE6_COLLAB_FEATURES.multiplayer]
})
```

## 远端 cursor、offline、history 和自动插入

- 远端 cursor 与 typing label 通过 awareness snapshot 渲染，不写入版本历史。
- offline cache 不可用时，在线协作仍应可用并产生 recoverable diagnostic。
- 历史预览与恢复必须使用隔离 Y.Doc 和受控替换，禁止依赖 `Y.Snapshot` 或关闭 Yjs GC 来模拟恢复。
- `startAutoInsertSession()` 只消费显式 position/range，不读取 live caret、不抢 focus、不修改用户 selection。

## 版本握手与 diagnostics

客户端和服务端版本、protocol、feature flags 不匹配时必须 fail-fast，并返回稳定 code：`COLLAB_PROTOCOL_MISMATCH`、`COLLAB_SERVER_TOO_OLD`、`COLLAB_CLIENT_TOO_OLD`、`COLLAB_FEATURE_FLAGS_MISSING`。完整恢复建议见 [`diagnostic-codes.md`](./diagnostic-codes.md) 和 [`migration.md`](./migration.md)。

## Experimental provider

Hocuspocus adapter 位于 `@4xian/jword-collab/experimental`。它可以作为宿主 provider adapter，但不能把 Hocuspocus provider 类型、Y.Doc store 或 demo runtime 暴露为 stable API。
