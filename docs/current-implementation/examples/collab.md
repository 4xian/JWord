# Collab 示例当前实现摘要

## Demo 做什么

`examples/collab` 是协作能力的浏览器 SDK 与仓库开发 harness。页面先创建基础 editor/UI，再按 URL 参数懒加载内存 runtime 或真实 Hocuspocus runtime，覆盖协作连接、presence/awareness、离线状态、版本历史、自动插入、DOCX 导入到协作文档、本地 self-host Hocuspocus 服务和 HTTP history API。其本地 Node server 不是客户生产集成方式；正式服务端必须由版本化 Docker 镜像提供。

## 依赖哪些包

运行依赖来自 `examples/collab/package.json`；其中 server 依赖只服务仓库本地 harness 和镜像前置验证：

- `@4xian/jword-core`
- `@4xian/jword-ui`
- `@4xian/jword-collab`
- `@4xian/jword-collab-server`
- `@4xian/jword-persistence`
- `@4xian/jword-license`
- `@4xian/jword-docx`
- `@hocuspocus/server`
- `y-protocols`
- `yjs`

开发依赖：`typescript`、`vite`。Vite 只给 core、ui、ui styles、docx 保留源码 alias；collab、collab-server、license、persistence 在浏览器 demo 侧按 package entry 消费。

## 真实代码入口

- 页面入口：`examples/collab/index.html`
- 浏览器入口：`examples/collab/src/main.ts`
- 懒加载边界：`examples/collab/src/lazy-runtime.ts`
- 内存 runtime：`examples/collab/src/runtime.ts`
- Hocuspocus runtime：`examples/collab/src/runtime/hocuspocus-runtime.ts`
- Hocuspocus auto-insert：`examples/collab/src/runtime/hocuspocus-auto-insert.ts`
- Hocuspocus server history client：`examples/collab/src/runtime/hocuspocus-server-history.ts`
- 本地服务 CLI：`examples/collab/server/dev-server.ts`
- 本地服务组合器：`examples/collab/server/hocuspocus-service.ts`
- Legacy/demo history API：`examples/collab/server/hocuspocus-history-api.ts`
- Vite 配置：`examples/collab/vite.config.ts`
- 使用说明：`examples/collab/README.md`

## 功能点

- `main.ts` 创建基础 editor/UI，启用 comments、link、headerFooter、headingOutline、findReplace、revisions，并把状态面板绑定到页面 DOM。
- 默认不带 `provider=hocuspocus` 时，`lazy-runtime.ts` 加载纯内存 runtime，模拟双 client 文本、awareness、offline、version history 和 auto insert。
- 带 `provider=hocuspocus` 时，页面创建 shared Y.Doc editor，加载 `createHocuspocusDemoRuntime()`，通过 `connectJWordCollaboration()` 和 `createHocuspocusCollabProviderAdapter()` 连接真实 provider。
- 可选 `offline=indexeddb` 时接入 `createIndexedDbOfflineAdapter()`，否则只展示 provider/offline 状态。
- History 可通过 SDK HTTP serverUrl 或 `history` 参数访问服务端 history；Hocuspocus runtime 也维护本地 bridge 和服务端 history client。
- Auto insert 使用显式位置/range，能在 provider 断开时进入 pending/offline 状态，重连后继续刷新 diagnostics/history。
- 本地 `dev:server` 同时启动 WebSocket Hocuspocus server 和 SDK HTTP server；demo `authHook`/`licenseHook` 默认放行，仅用于本地验收。
- `window.__jwordCollabDemo` 暴露浏览器验收钩子：读取状态、presence、offline、history、格式/批注 range，启动/取消/重试自动插入，模拟断连/重连，更新文本/选区，导入 DOCX。

## 启动命令

页面：

```bash
pnpm --filter @4xian/jword-example-collab dev
```

本地 Hocuspocus + HTTP history 服务：

```bash
pnpm --filter @4xian/jword-example-collab dev:server
```

其它脚本：

```bash
pnpm --filter @4xian/jword-example-collab typecheck
pnpm --filter @4xian/jword-example-collab build
pnpm --filter @4xian/jword-example-collab preview
```

`dev:server` 支持环境变量：`JWORD_COLLAB_PORT`、`JWORD_COLLAB_HTTP_PORT`、`JWORD_COLLAB_HOST`、`JWORD_COLLAB_ROOM_PREFIX`。默认 WebSocket 端口为 `4188`，SDK HTTP 端口为 `4189`。

## 使用方式

默认内存 demo：

```text
http://127.0.0.1:5173/
```

真实 Hocuspocus 双标签页示例，两个页面使用同一 room、不同 client：

```text
http://127.0.0.1:5173/?provider=hocuspocus&ws=ws%3A%2F%2F127.0.0.1%3A4188&serverUrl=http%3A%2F%2F127.0.0.1%3A4189&room=jword-collab-demo&client=client-a
http://127.0.0.1:5173/?provider=hocuspocus&ws=ws%3A%2F%2F127.0.0.1%3A4188&serverUrl=http%3A%2F%2F127.0.0.1%3A4189&room=jword-collab-demo&client=client-b
```

常用 URL 参数：

- `provider=hocuspocus`：启用真实 Hocuspocus runtime。
- `ws=`：WebSocket provider 地址；本地 `ws://127.0.0.1:4188` 会自动推导 `serverUrl=http://127.0.0.1:4189`。
- `serverUrl=` 或 `history=`：SDK HTTP/history 服务地址。
- `room=`、`documentId=`、`client=`：协作 room/document/client 身份。
- `userId=`、`userName=`、`userColor=`：demo 用户信息。
- `features=`：逗号分隔 feature 列表；未传时启用 demo 所需的 DOCX import、collaboration、history、server、autoInsert。
- `offline=indexeddb`：启用 IndexedDB offline adapter。
- `token=`：传给 Hocuspocus provider/server 的 token。

页面 DOM 入口包括 `#jword-collab-editor`、`#jword-collab-status`、`#jword-collab-awareness`、`#jword-collab-offline`、`#jword-collab-history`、`#jword-collab-auto`。

## 测试/验证命令

Focused 单测/结构验证：

```bash
pnpm exec vitest run examples/collab/tests/vite-config.test.ts examples/collab/tests/hocuspocus-service.test.ts examples/collab/tests/hocuspocus-provider.test.ts examples/collab/tests/hocuspocus-history-service.test.ts examples/collab/tests/hocuspocus-history.test.ts examples/collab/tests/hocuspocus-server-history.test.ts examples/collab/tests/collab-input-rebase-stress.test.ts
```

Focused 浏览器验证示例：

```bash
pnpm exec playwright test examples/collab/tests/collab-smoke.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-handshake.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-history-api.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-awareness.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-concurrency.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-auto-insert-concurrency.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-docx-provider-history.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-visible-editor.e2e.ts --project=chromium
pnpm exec playwright test examples/collab/tests/collab-a11y.e2e.ts --project=chromium
```

## 当前限制

- 内存 runtime 是模拟，不能作为真实网络协同、真实 IndexedDB 离线或生产 history 闭环的证据。
- 本地 Hocuspocus 服务默认 auth/license hook 放行，只用于 demo；生产必须注入真实租户、认证、授权和持久化。
- Demo license 使用 insecure test-only fixture 签名。
- `historyStorage` 默认是 volatile storage；进程退出后 history 消失。
- Hocuspocus demo 只接受 `client-a` 到 `client-e` 这组 demo client id。
- Vite alias 仍覆盖 core/ui/docx 源码；collab 相关包虽然走 package entry，但整体仍不是完整外部 no-alias 工程。
