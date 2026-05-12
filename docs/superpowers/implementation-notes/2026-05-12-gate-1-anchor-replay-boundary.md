# Gate 1 Anchor Replay Boundary

本文件记录 Gate 1.x 复核点 A 的边界收口。

## Decision

Gate 1 只保证经 Operation adapter 或 operation fixture replay 执行的结构性 `splitBlock` / `mergeBlock` 会迁移运行时 `AnchorRef`。

raw Yjs structural update 不属于 Gate 1 的 AnchorRef 自动迁移保证。后续 Gate 6 provider 如果接收远端结构性变化，需要先转换成 Gate 1 `Operation` 并复用同一条 adapter/replay 路径。

## Evidence

- `packages/core/test/operation-adapter.test.ts` 覆盖 split 后续 run 的 anchor 迁移。
- `packages/core/test/operation-adapter.test.ts` 覆盖 raw Yjs 结构直改不承诺迁移到新 block/run。
- `packages/core/src/position.ts` 的 AnchorRef 迁移 helper 注释声明它们是 Operation adapter/replay 边界，不是 raw Yjs observer。
