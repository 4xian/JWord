# JWord Collab Example

`examples/collab` 是 Gate 6 商业协作的第三方宿主演示。页面先按基础 editor/UI 初始化，再按需加载高级协作 client，连接 self-host server，并传入 `user`、`license`、`roomId`、`documentId`、`serverUrl` 和 `features`。

## Scope

- 只通过公开 API 接入 `@4xian/jword-collab`、`@4xian/jword-collab-server`、`@4xian/jword-license` 和 `@4xian/jword-persistence`。
- 不把 `packages/collab/src`、`packages/collab-server/src`、demo runtime 内部文件或 core 内部 store 当成第三方 API。
- 覆盖真实浏览器双页面协作、presence、离线恢复、历史版本、自动插入和未授权失败路径。

## Third-Party Flow

1. 从空项目安装基础包、高级协作包、授权包、persistence 包和 server 包。
2. 用基础包创建 editor 和 UI。
3. 用 `createJWordCollabServer()` 启动 self-host server。
4. 用 `connectJWordCollaboration()` 连接协作 client。
5. 用 `connection.history.recordVersion()` 记录历史版本。
6. 用 `connection.startAutoInsertSession()` 在显式位置启动自动插入。
7. 用缺失 license 复核未授权失败，期望从 `JWORD_LICENSE_MISSING` 归一为 `COLLAB_LICENSE_MISSING`。

## Commands

```sh
pnpm --filter @4xian/jword-example-collab dev
pnpm --filter @4xian/jword-example-collab dev:server
pnpm --filter @4xian/jword-example-collab typecheck
node tools/release/check-gate6-third-party-smoke.mjs
```

## Local Hocuspocus Demo

1. 先启动浏览器页面：

```sh
pnpm --filter @4xian/jword-example-collab dev
```

2. 再启动本地协作服务：

```sh
pnpm --filter @4xian/jword-example-collab dev:server
```

默认服务会打印两个地址：

- WebSocket provider：`ws://127.0.0.1:4188`
- SDK HTTP service：`http://127.0.0.1:4189`

3. 打开两个浏览器标签页，`room` 相同、`client` 不同：

```text
http://127.0.0.1:5173/?provider=hocuspocus&ws=ws%3A%2F%2F127.0.0.1%3A4188&serverUrl=http%3A%2F%2F127.0.0.1%3A4189&room=jword-collab-demo&client=client-a
http://127.0.0.1:5173/?provider=hocuspocus&ws=ws%3A%2F%2F127.0.0.1%3A4188&serverUrl=http%3A%2F%2F127.0.0.1%3A4189&room=jword-collab-demo&client=client-b
```

本地默认端口下也可以只传 `ws=ws://127.0.0.1:4188`，demo 会自动推导 `serverUrl=http://127.0.0.1:4189`。生产或第三方集成时应显式传入 SDK HTTP `serverUrl`。
