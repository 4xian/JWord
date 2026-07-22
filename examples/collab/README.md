# JWord Collab Example

`examples/collab` 是 Gate 6 商业协作的浏览器 SDK 与仓库开发 harness。页面先按基础 editor/UI 初始化，再按需加载高级协作 client，连接本地开发 server，并传入 `user`、`license`、`roomId`、`documentId`、`serverUrl` 和 `features`。本地 Node server 不代表客户生产集成；正式服务端统一通过版本化 Docker 镜像交付。

## Scope

- 浏览器侧只通过公开 API 接入 `@4xian/jword-collab`、`@4xian/jword-license` 和 `@4xian/jword-persistence`；`@4xian/jword-collab-server` 仅用于仓库本地 server harness。
- 不把 `packages/collab/src`、`packages/collab-server/src`、demo runtime 内部文件或 core 内部 store 当成第三方 API。
- 覆盖真实浏览器双页面协作、presence、离线恢复、历史版本、自动插入和未授权失败路径。

## Third-Party Flow

1. 客户应用安装基础包、高级协作包、授权包和浏览器侧 persistence；客户运维侧部署 JWord 正式 Docker 镜像。
2. 用基础包创建 editor 和 UI。
3. 浏览器 SDK 使用已部署镜像提供的 HTTP/WSS endpoint；本仓库可用 `dev:server` 启动仅供开发的 server harness。
4. 用 `connectJWordCollaboration()` 连接协作 client。
5. 用 `connection.history.recordVersion()` 记录历史版本。
6. 用 `connection.startAutoInsertSession()` 在显式位置启动自动插入。
7. 用缺失 license 复核未授权失败，期望协作 client 原样返回 `JWORD_LICENSE_MISSING`。

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

本地默认端口下也可以只传 `ws=ws://127.0.0.1:4188`，demo 会自动推导 `serverUrl=http://127.0.0.1:4189`。生产集成时应显式传入版本化 Docker 镜像对外提供的 SDK HTTP `serverUrl` 和 WSS endpoint。
