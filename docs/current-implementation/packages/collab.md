# @4xian/jword-collab 当前实现摘要

## 包职责

`@4xian/jword-collab` 是协同客户端 SDK 模块，负责协同客户端公开接口、provider adapter 契约、awareness/presence 数据结构、client/server 版本握手、history/offline handle、自动插入 session、协同 diagnostics 与 license feature gate。稳定入口不暴露 Hocuspocus provider 类型、Y.Doc store 或 demo runtime；真实 Hocuspocus provider 放在 `@4xian/jword-collab/experimental` 子路径。

## 入口与导出

- 包名：`@4xian/jword-collab`
- Export map：`.` 与 `./experimental`。
- 当前 manifest：`private: true`。
- 运行依赖：`@4xian/jword-core`、`@4xian/jword-license`、`@hocuspocus/provider`、`y-protocols`、`yjs`。

## 公开 API 摘要

稳定入口主要导出：

- `connectJWordCollaboration()`
- `GATE6_COLLAB_FEATURES`
- `JWORD_COLLAB_CLIENT_PROTOCOL_VERSION = 'gate6-collab-v1'`
- `JWORD_COLLAB_CLIENT_PACKAGE_VERSION = '0.0.0'`
- `createMemoryCollabProviderAdapter()`
- `resetMemoryCollabRooms()`
- `createJWordCollabFeatureGate()`
- `createJWordCollabProviderPluginAdapter()`
- collaboration connection、awareness、history、offline、auto-insert 类型。

Experimental 子路径主要导出：

- `createHocuspocusCollabProviderAdapter()`
- `CreateHocuspocusCollabProviderAdapterOptions`

## 已实现能力

### Client SDK

- `connectJWordCollaboration(editor, options)` 连接 core editor 与 provider adapter。
- 连接前校验参数、license、server `/version` protocol、server/client minimum version 和 featureFlags。
- 失败时返回 error connection 与 diagnostics，不连接 provider。
- 稳定 SDK 通过 `JWordCollaborationEditor` 消费 core 的中立 facade：`encodeSyncUpdate()`、`applySyncUpdate()`、可选 `replaceSyncUpdate()`、`subscribe()`、`createTextAnchor()`、`resolveTextPosition()`、`executeCommand()`。

### Update 同步

- 本地事务发布只监听 `local-user` / `user` origin。
- 本地事务编码当前 sync update 后调用 provider `sendUpdate()`。
- 远端 update 以 `remote-user` origin 进入 `editor.applySyncUpdate()`。
- Restore 优先调用 core `editor.replaceSyncUpdate()`，避免旧 Yjs update 与当前文档合并而不能真正回退。

### Awareness / presence

- Awareness 支持 user、cursor、rangeSnapshot、viewport、selectionLabel。
- 非法 rangeSnapshot 可降级为 presence-only，并记录 `COLLAB_AWARENESS_ANCHOR_UNRESOLVED`。

### History / offline

- History handle 提供 `listVersions()`、`recordVersion()`、`previewVersion()`、`restoreVersion()`。
- History client 访问 HTTP：`GET /history/versions`、`POST /history/versions`、`POST /history/preview`。
- 自动把 `ws:`/`wss:` serverUrl 转为 `http:`/`https:`，并发送 authorization、document、entitlement headers。
- 服务端 history 失败会记录 `COLLAB_HISTORY_SERVER_FALLBACK`，降级到当前 connection 内存版本数组。
- Offline handle 只根据 provider status 与 pending operation 计数返回 `synced` / `offline` / `pending`；真实 IndexedDB offline adapter 在 persistence 包。

### Hocuspocus experimental adapter

- 包装 `@hocuspocus/provider`。
- `HocuspocusProviderWebsocket` 固定 `autoConnect: false`。
- 构造阶段不连接；`connect()` 中先 `provider.attach()` 再显式 `websocketProvider.connect()`。
- `sendUpdate()` 对宿主传入的 Y.Doc 执行 `Y.applyUpdate()`，origin 归一到 `local-user` / `remote-user` / `version-restore`。
- close reason `COLLAB_UPDATE_REJECTED`、`COLLAB_PERMISSION_DENIED` 映射为 provider error/diagnostic。

### Auto-insert

- Auto-insert session 必须传显式 `position` 或 `range`。
- 可用 core `createTextInserter()` 时走 core transaction pipeline。
- 否则 fallback 为 `auto-inserter` origin 的 `applySyncUpdate()`。

## 内部实现方案

- Stable API 只承诺 provider adapter contract，不承诺 Hocuspocus/Y.Doc 内部类型。
- License gate 通过 `assertJWordFeatureEntitled()` 执行，并把 `JWORD_*` 授权错误归一为 `COLLAB_*` diagnostic。
- History restore 优先走 replace sync update，避免 apply old update 造成“合并”而非“回退”。
- Provider、history、awareness、auto-insert 都返回稳定 diagnostics code，便于 SDK 文档和 e2e 断言。

## 与其它包关系

- 依赖 core 的协同接口和 `createTextInserter()`。
- 依赖 license 做 feature gate。
- `createJWordCollabProviderPluginAdapter()` 把 collab provider 包装成 core plugin adapter descriptor，core 只识别 `kind: 'collabProvider'`。
- 不直接依赖 DOCX；DOCX 导入后先转换为 core document，再进入同一 Editor/Y.Doc/update/history/auto-insert 路径。
- `examples/collab` 只通过公开包入口接入 collab、collab-server、license、persistence。

## 主要测试/验收入口

- `packages/collab/test/contract.test.ts`
- `packages/collab/test/public-client.test.ts`
- `packages/collab/test/public-client-restore.test.ts`
- `packages/collab/test/client-history-base64.test.ts`
- `packages/collab/test/hocuspocus-adapter.test.ts`
- `tests/architecture/gate6-package-exports.test.ts`
- `tests/architecture/gate6-diagnostics-registry.test.ts`
- `tests/architecture/gate6-awareness-validation.test.ts`
- `tests/architecture/gate6-docx-fixture-integration.test.ts`
- `examples/collab/tests/`
- `tools/release/check-gate6-third-party-smoke.mjs`
- `tools/size/check-gate6-collab-bundle.mjs`

## 运行/测试/验证命令

- `pnpm --filter @4xian/jword-collab typecheck`：校验协同客户端、provider adapter 与 experimental 子路径类型。
- `pnpm --filter @4xian/jword-collab test`：运行 collab 包内 provider contract、client/history/restore 与 Hocuspocus adapter 测试。
- `pnpm --filter @4xian/jword-collab build`：按 package `tsconfig.json` 输出 `dist`。
- `pnpm test -- tests/architecture/gate6-package-exports.test.ts tests/architecture/gate6-diagnostics-registry.test.ts tests/architecture/gate6-awareness-validation.test.ts tests/architecture/gate6-docx-fixture-integration.test.ts tests/architecture/gate7-public-api-catalog.test.ts`：回归协同导出、诊断、awareness、DOCX fixture 集成和公开 API catalog。
- `node tools/release/check-gate6-third-party-smoke.mjs`、`node tools/size/check-gate6-collab-bundle.mjs`：验证第三方消费与协同高级代码按需进入 bundle。

## 当前限制/注意点

- Hocuspocus adapter 仅在 `@4xian/jword-collab/experimental`。
- Hocuspocus adapter 的 `sendUpdate()` 会 apply 到宿主传入的 Y.Doc，调用方必须保证 update 属于目标文档。
- Offline handle 不是 IndexedDB adapter；离线恢复需要宿主组合 persistence 包。
- History server 不可用时只降级到当前 connection 的内存历史，不是跨进程持久化。
- Auto-insert 不读取 live caret；没有显式 position/range 会返回 `COLLAB_AUTO_INSERTER_POSITION_REQUIRED`。
- 当前 manifest 仍是 `private: true`。

## 关键文件

- `packages/collab/package.json`
- `packages/collab/src/index.ts`
- `packages/collab/src/client-types.ts`
- `packages/collab/src/client-sdk.ts`
- `packages/collab/src/client-history.ts`
- `packages/collab/src/hocuspocus-adapter.ts`
- `packages/collab/src/experimental.ts`
- `packages/core/src/editor/collaboration-runtime.ts`
- `packages/core/src/plugins/adapter-types.ts`

