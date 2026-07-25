# 协作客户端当前实现摘要

## 对应文档

- `docs/sdk/collaboration.md`
- `docs/current-implementation/packages/collab.md`
- `docs/current-implementation/examples/collab.md`

## 当前能力

`@4xian/jword-collab` 提供 paid collaboration 客户端 SDK：

- `connectJWordCollaboration()` 连接 editor 与 provider adapter。
- memory provider adapter 用于测试/demo。
- Hocuspocus provider adapter 位于 `@4xian/jword-collab/experimental`。
- awareness/presence：user、cursor、range snapshot、viewport、selectionLabel。
- history handle：list/record/preview/restore。
- offline handle：基于 provider status 与 pending operation 返回 synced/offline/pending。
- auto-insert session：只消费显式 position/range，不读取 live caret、不抢 focus、不修改用户 selection。
- version handshake：protocol、client/server minimum version、feature flags fail-fast。

## 实现方案

- 本地 update 只监听 `local-user` / `user` origin。
- 远端 update 以 `remote-user` origin 进入 editor。
- restore 优先调用 core `replaceSyncUpdate()`，避免把旧 update 合并进当前文档而无法真实回退。
- History client 把 `ws:`/`wss:` serverUrl 转为 `http:`/`https:` 并访问 HTTP history API。
- provider 错误、license 错误、protocol 错误都会转为稳定 diagnostic。

## 当前限制

- 稳定 API 不暴露具体 Hocuspocus provider 实例、Y.Doc store、demo runtime。
- Offline handle 本身不等于完整数据库；真实 IndexedDB offline adapter 在 persistence 包。
- comment 级服务端写权限仍不是当前稳定能力。

## 验证入口

- `packages/collab/test/public-client.test.ts`
- `packages/collab/test/public-client-restore.test.ts`
- `packages/collab/test/contract.test.ts`
- `packages/collab/test/hocuspocus-adapter.test.ts`
- `examples/collab/tests/*.e2e.ts`
- `tests/architecture/gate6-*.test.ts`
